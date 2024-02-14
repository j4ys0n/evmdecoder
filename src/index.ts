import { retry, AbortHandle, WaitTime, exponentialBackoff } from '@splunkdlt/async-tasks'
import { LRUCache } from '@splunkdlt/cache'
import { createModuleDebug } from '@splunkdlt/debug-logging'
import { ManagedResource } from '@splunkdlt/managed-resource'
import { ContractInfo, ContractResources, contractInfo } from './abi/contract'
import { DecodedFunctionCall } from './abi/decode'
import { AbiRepository } from './abi/repo'
import { Config, DeepPartial } from './config'
import { BatchedEthereumClient, EthereumClient } from './eth/client'
import { HttpTransport } from './eth/http'
import { getBlock, getBlockReceipts, getTransaction, getTransactionReceipt } from './eth/requests'
import {
  RawBlockResponse,
  RawLogResponse,
  RawParityLogResponse,
  RawParityTransactionReceipt,
  RawTransactionResponse
} from './eth/responses'
import { FormattedBlock, FormattedLogEvent, FormattedPendingTransaction, FormattedTransaction } from './msgs'
import { bigIntToNumber } from './utils/bn'
import { Classification, ClassificationResources } from './utils/classification'
import { RuntimeError } from './utils/error'
import { formatBlock, formatLogEvent, formatPendingTransaction, formatTransaction, parseBlockTime } from './utils/format'
import { deepMerge } from './utils/obj'

const { info, warn, error } = createModuleDebug('evmdecoder:main')

const DEFAULT_CONFIG: DeepPartial<Config> = {
  eth: {
    http: {
      timeout: 60_000,
      validateCertificate: false,
      requestKeepAlive: true,
      maxSockets: 256
    },
    client: {
      maxBatchSize: 100,
      maxBatchTime: 0,
      individualReceipts: true,
      maxRetryTime: 10_000
    }
  },
  abi: {
    abiFileExtension: '.json',
    directory: './abis',
    searchRecursive: true,
    fingerprintContracts: true,
    requireContractMatch: false,
    decodeAnonymous: true,
    reconcileStructShapeFromTuples: true
  },
  contractInfo: {
    maxCacheEntries: 25_000
  },
  logging: {}
}

interface FullBlockResponse {
  block: FormattedBlock
  transactions: FormattedTransactionResponse[]
}

interface FormattedTransactionResponse {
  transaction: FormattedTransaction
  logEvents: FormattedLogEvent[]
}

const addressInfo = (contractInfo?: ContractInfo): ContractInfo | undefined => contractInfo ?? undefined

export class EvmDecoder {
  private config: Config
  private abortHandle: AbortHandle
  private abiRepo: AbiRepository
  private contractInfoCache: LRUCache<string, Promise<ContractInfo>>
  private resources: ManagedResource[] = []
  private waitAfterFailure: WaitTime

  public classification: Classification
  public ethClient: EthereumClient
  private contractResources: ContractResources

  constructor(config: DeepPartial<Config>) {
    this.config = deepMerge(DEFAULT_CONFIG, config) as Config
    this.abortHandle = new AbortHandle()
    this.waitAfterFailure = exponentialBackoff({ min: 0, max: this.config.eth.client.maxRetryTime })
    this.abiRepo = new AbiRepository(this.config.abi, this.config.logging)
    this.addResource(this.abiRepo)

    this.contractInfoCache = new LRUCache<string, Promise<ContractInfo>>({
      maxSize: this.config.contractInfo.maxCacheEntries
    })
    const transport = new HttpTransport(this.config.eth.url, this.config.eth.http)
    this.ethClient =
      this.config.eth.client.maxBatchSize > 1
        ? new BatchedEthereumClient(transport, {
            maxBatchSize: this.config.eth.client.maxBatchSize,
            maxBatchTime: this.config.eth.client.maxBatchTime
          })
        : new EthereumClient(transport)
    const classificationResources: ClassificationResources = {
      ethClient: this.ethClient,
      abiRepo: this.abiRepo,
      contractInfoCache: this.contractInfoCache
    }
    this.classification = new Classification(classificationResources, this.config.logging)
    this.contractResources =  {
      ethClient: this.ethClient,
      abiRepo: this.abiRepo,
      contractInfoCache: this.contractInfoCache,
      classification: this.classification
    }
  }

  public async initialize() {
    await this.abiRepo.initialize()
  }

  private async _decodeFunctionCall({
    input,
    address,
    contractInfo
  }: {
    input: string;
    address?: string,
    contractInfo?: ContractInfo 
  }) {
    const decoded = this.abiRepo.decodeFunctionCall(input, {
      contractAddress: address,
      contractFingerprint: contractInfo != null ? contractInfo.fingerprint : undefined
    })
    if (address != null && decoded != null && contractInfo != null) {
      try {
        return this.classification.getExtraData(address, decoded, contractInfo, input)
      } catch (e) {
        warn('could not get extra data for transaction')
      }
    }
    return decoded
  }

  public async decodeFunctionCall({
    input,
    address
  }: {
    input: string;
    address?: string,
  }) {
    const contractInfo = address != null ? await this.contractInfo({ address }) : undefined
    const decoded = await this._decodeFunctionCall({ input, address, contractInfo })
    return decoded
  }

  public async decodeFunctionCallV2({ input, address }: { input: string; address?: string }) {
    const contractInfo = address != null ? await this.contractInfo({ address }) : undefined
    const decoded = await this._decodeFunctionCall({ input, address, contractInfo })
    return {
      decoded,
      contractInfo
    }
  }

  public async contractInfo({ address }: { address: string }) {
    return contractInfo({
      address,
      resources: this.contractResources
    })
  }

  public async getBlock(blockNumber: number): Promise<FullBlockResponse> {
    const block = await this.ethClient.request(getBlock(blockNumber))
    return await this.processBlock(block)
  }

  public async getBlocks(blockNumbers: number[]): Promise<FullBlockResponse[]> {
    const blocks = await this.ethClient
      .requestBatch(blockNumbers.map(blockNumber => getBlock(blockNumber)))
      .catch(e =>
        Promise.reject(new Error(`Failed to request batch of blocks ${blockNumbers.join(', ')}: ${e}`))
      )

    return await Promise.all(blocks.map(b => this.processBlock(b)))
  }

  public async getPendingTransaction(hash: string): Promise<FormattedPendingTransaction | undefined> {
    try {
      const transaction = await this.ethClient.request(getTransaction(hash), { ignoreErrors: true })
      return await this.processPendingTransaction(transaction)
    } catch (e) {
      return undefined
    }
  }

  public async getTransaction(hash: string): Promise<FormattedTransactionResponse> {
    const transaction = await this.ethClient.request(getTransaction(hash))
    return await this.processTransaction(transaction, true)
  }

  public async getTransactionReceipt(hash: string): Promise<FormattedLogEvent[]> {
    const receipt = await this.ethClient.request(getTransactionReceipt(hash))
    if (receipt) {
      return await Promise.all(
        receipt?.logs?.map((l: RawLogResponse | RawParityLogResponse) => this.processTransactionLog(l)) ?? []
      )
    }
    return []
  }

  private async processBlock(rawBlock: RawBlockResponse): Promise<FullBlockResponse> {
    const block = formatBlock(rawBlock)
    let receipts: RawParityTransactionReceipt[] = []
    let individualReceipts = this.config.eth.client.individualReceipts
    if (!individualReceipts) {
      try {
        receipts = await retry(() => this.ethClient.request(getBlockReceipts(block.number!)), {
          attempts: 3,
          waitBetween: this.waitAfterFailure,
          taskName: `getting receipts for block ${bigIntToNumber(block.number!)}`,
          abortHandle: this.abortHandle,
          warnOnError: true,
          onRetry: (attempt: number) =>
            warn('Retrying to get receipts for block %s (attempt %d)', bigIntToNumber(block.number!), attempt)
        })
      } catch (e) {
        warn(
          'unable to get receipts for full block %d, switching to individualReceipts mode',
          bigIntToNumber(block.number!)
        )
        individualReceipts = true
      }
    }

    const transactions = await this.abortHandle.race(
      Promise.all(
        rawBlock.transactions.map(tx =>
          this.processTransaction(
            tx,
            individualReceipts,
            !individualReceipts
              ? receipts.filter(r => r.transactionHash === (tx as RawTransactionResponse).hash)[0]
              : undefined
          )
        )
      )
    )
    return {
      block,
      transactions
    }
  }

  private async processTransaction(
    rawTx: RawTransactionResponse | string,
    individualReceipts: boolean,
    rawReceipt: RawParityTransactionReceipt | undefined = undefined
  ): Promise<FormattedTransactionResponse> {
    if (typeof rawTx === 'string') {
      warn('Received raw transaction %s from block %d')
      throw new RuntimeError(`Received raw transaction`)
    }

    const [receipt, toInfo, fromInfo] = await Promise.all([
      individualReceipts ? this.ethClient.request(getTransactionReceipt(rawTx.hash)) : rawReceipt,
      rawTx.to != null
        ? contractInfo({
            address: rawTx.to,
            resources: this.contractResources
          })
        : undefined,
      rawTx.from != null
        ? contractInfo({
            address: rawTx.from,
            resources: this.contractResources
          })
        : undefined
    ])

    const contractAddressInfo: ContractInfo | undefined =
      receipt?.contractAddress != null
        ? await contractInfo({
            address: receipt.contractAddress,
            resources: this.contractResources
          })
        : undefined

    const callInfo =
      toInfo && toInfo.isContract
        ? await this.decodeFunctionCall({ input: rawTx.input, address: rawTx.to! })
        : undefined

    const transaction = formatTransaction(
      rawTx,
      receipt!,
      addressInfo(fromInfo),
      addressInfo(toInfo),
      addressInfo(contractAddressInfo),
      callInfo
    )

    const logEvents =
      toInfo && toInfo.isContract
        ? await Promise.all(
            receipt?.logs?.map((l: RawLogResponse | RawParityLogResponse) => this.processTransactionLog(l)) ?? []
          )
        : []

    return {
      transaction,
      logEvents
    }
  }

  private async processPendingTransaction(
    rawTx: RawTransactionResponse | string
  ): Promise<FormattedPendingTransaction> {
    if (typeof rawTx === 'string') {
      warn('Received raw transaction %s')
      throw new RuntimeError(`Received raw transaction`)
    }

    const toInfo =
      rawTx.to != null
        ? await contractInfo({
            address: rawTx.to,
            resources: this.contractResources
          })
        : undefined

    const callInfo =
      toInfo && toInfo.isContract
        ? await this.decodeFunctionCall({ input: rawTx.input, address: rawTx.to! })
        : undefined

    return formatPendingTransaction(rawTx, 'pending', undefined, addressInfo(toInfo), callInfo)
  }

  public async processTransactionLog(evt: RawLogResponse | RawParityLogResponse | FormattedLogEvent): Promise<FormattedLogEvent> {
    const eventContractInfo = await contractInfo({
      address: evt.address,
      resources: this.contractResources
    })

    const decodedEventData = this.abiRepo.decodeLogEvent(evt, {
      contractAddress: evt.address,
      contractFingerprint: eventContractInfo?.fingerprint
    })
    if (evt.address != null && decodedEventData != null && eventContractInfo != null) {
      try {
        const decodedExtra = await this.classification.getExtraData(
          evt.address,
          decodedEventData,
          eventContractInfo
        )
        return formatLogEvent(evt, addressInfo(eventContractInfo), decodedExtra)
      } catch (e) {
        warn('could not get extra data for transaction log')
      }
    }
    return formatLogEvent(evt, addressInfo(eventContractInfo), decodedEventData)
  }

  private addResource<R extends ManagedResource>(r: R): R {
    this.resources.push(r)
    return r
  }
}
