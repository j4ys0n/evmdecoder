import { retry, AbortHandle, WaitTime, exponentialBackoff } from '@splunkdlt/async-tasks'
import { LRUCache } from '@splunkdlt/cache'
import { createModuleDebug } from '@splunkdlt/debug-logging'
import { ManagedResource } from '@splunkdlt/managed-resource'
import { ContractInfo, ContractResources, contractInfo } from './abi/contract'
import { DecodedFunctionCall } from './abi/decode'
import { AbiRepository, TransactionLog } from './abi/repo'
import { Config, DeepPartial } from './config'
import { BatchedEthereumClient, EthereumClient } from './eth/client'
import { HttpTransport } from './eth/http'
import { getBlock, getBlockReceipts, getTransaction, getTransactionReceipt, blockNumber, traceTransaction, feeHistory, getBlockByHash, pendingTransactions, allPendingTransactions, traceBlockByNumber } from './eth/requests'
import {
  FeeHistoryResponse,
  RawBlock,
  RawBlockResponse,
  RawBlockSlim,
  RawLogEvent,
  RawLogResponse,
  RawTraceTransactionResult,
  RawTransaction,
  RawTransactionReceipt,
  RawTransactionResponse
} from './eth/responses'
import { DecodedTransactionTrace, DecodedTransactionTraceItem, FormattedBlock, FormattedLogEvent, FormattedPendingTransaction, FormattedTransaction, FormattedTransactionTrace, FormattedTransactionTraceItem } from './msgs'
import { bigIntToNumber } from './utils/bn'
import { Classification, ClassificationResources } from './utils/classification'
import { RuntimeError } from './utils/error'
import { formatBlock, formatLogEvent, formatPendingTransaction, formatTransaction, formatTransactionTrace, parseBlockTime, timestampMS } from './utils/format'
import { chunkArray, deepMerge } from './utils/obj'

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
  logging: {},
}

export interface RawFullBlock {
  block: RawBlockSlim
  transactions: RawFullTransaction[]
}

export interface RawFullTransaction {
  transaction: RawTransaction
  receipt: RawTransactionReceipt
}

function isRawFullBlock(b: unknown): b is RawFullBlock {
  const rfb = b as RawFullBlock
  return (rfb.block != null && rfb.transactions != null)
}

export interface FullBlockResponse {
  block: FormattedBlock
  transactions: FormattedTransactionResponse[]
}

export interface FormattedTransactionResponse {
  transaction: FormattedTransaction
  logEvents: FormattedLogEvent[]
}

const addressInfo = (contractInfo?: ContractInfo): ContractInfo | undefined => contractInfo ?? undefined

export class EvmDecoder {
  private config: Config
  private abortHandle: AbortHandle
  private abiRepo: AbiRepository
  private blockTimestampCache: LRUCache<string, number>
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

    this.blockTimestampCache = new LRUCache<string, number>({
      maxSize: 2_500
    })
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
    this.contractResources = {
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
    input: string
    address?: string
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

  public async decodeFunctionCall({ input, address }: { input: string; address?: string }) {
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

  public async getBlock<T extends boolean>(blockNumber: number, decode?: T): Promise<T extends true ? FullBlockResponse : RawBlock>
  public async getBlock(blockNumber: number, decode: boolean = true) {
    const block = await this.ethClient.request(getBlock(blockNumber, true))
    if (decode) {
      return this.processBlock(block)
    } else {
      return block as RawBlock
    }
  }

  public async getSlimBlock<T extends boolean>(blockNumber: number, raw?: T): Promise<T extends true ? RawBlockSlim : FormattedBlock>
  public async getSlimBlock(blockNumber: number, raw: boolean = true) {
    const block = await this.ethClient.request(getBlock(blockNumber, false))
    if (raw) {
      return block
    } else {
      return formatBlock(block)
    }
  }

  public async getSlimBlockByHash<T extends boolean>(hash: string, raw?: T): Promise<T extends true ? RawBlockSlim : FormattedBlock>
  public async getSlimBlockByHash(hash: string, raw: boolean = true) {
    const block = await this.ethClient.request(getBlockByHash(hash, false))
    if (raw) {
      return block
    } else {
      return formatBlock(block)
    }
  }

  public async getFullBlock<T extends boolean>(blockNumber: number, decode?: T): Promise<T extends true ? FullBlockResponse : RawFullBlock>
  public async getFullBlock(blockNumber: number, decode: boolean = true) {
    const block = await this.ethClient.request(getBlock(blockNumber, true))
    block.transactions = block.transactions.map(t =>
      typeof t === 'string' ? t : ({ ...t, timestamp: timestampMS(block.timestamp)})
    )
    if (decode) {
      return this.processBlock(block)
    } else {
      return this.processRawFullBlock(block)
    }
  }

  private async processRawFullBlock(block: RawBlockResponse | RawBlock) {
    // const uncles = await this.ethClient.requestBatch()
    // last uncle block https://etherscan.io/uncle/0xf4af15465ca81e65866c6e64cbc446b735a06fb2118dda69a7c21d4ab0b1e217
    const allReceipts = await this.ethClient.requestBatch(
      block.transactions.map(txn =>
        typeof txn === 'string' ? getTransactionReceipt(txn) : getTransactionReceipt(txn.hash)
      )
    )
    const receiptMap = allReceipts.reduce((map, receipt) => {
      map[receipt.transactionHash] = receipt
      return map
    }, <{ [key: string]: RawTransactionReceipt }>{})

    const { transactions: txns, ...remainingBlockProps } = block
    const rawBlockSlim: RawBlockSlim = {
      ...remainingBlockProps,
      transactions: txns.map(txn => {
        if (typeof txn === 'string') {
          return txn
        }
        return txn.hash
      })
    }
    const rawFullBlock: RawFullBlock = {
      block: rawBlockSlim,
      transactions: txns.map((transaction: RawTransaction) => ({
        transaction,
        receipt: receiptMap[transaction.hash] ?? undefined
      }))
    }
    return rawFullBlock
  }

  public async getBlocks<T extends boolean>(blockNumbers: number[], decode?: T): Promise<T extends true ? Array<FullBlockResponse> : Array<RawBlock>>
  public async getBlocks(blockNumbers: number[], decode: boolean = true) {
    const blocks = await this.ethClient
      .requestBatch(blockNumbers.map(blockNumber => getBlock(blockNumber, true)))
      .catch(e =>
        Promise.reject(new Error(`Failed to request batch of blocks ${blockNumbers.join(', ')}: ${e}`))
      )
    
    for (let i = 0; i < blocks.length; i++) {
      const transactions = blocks[i].transactions.map(t => ({ ...t, timestamp: timestampMS(blocks[i].timestamp) }))
      blocks[i].transactions = transactions
    }
    if (decode) {
      return Promise.all(blocks.map(b => this.processBlock(b)))
    } else {
      return blocks as RawBlock[]
    }
  }

  public async getSlimBlocks(blockNumbers: number[]): Promise<Array<RawBlockSlim>> {
    return this.ethClient
      .requestBatch(blockNumbers.map(blockNumber => getBlock(blockNumber, false)))
      .catch(e =>
        Promise.reject(new Error(`Failed to request batch of blocks ${blockNumbers.join(', ')}: ${e}`))
      )
  }

  public async getSlimBlocksByHash(blockHashes: string[]): Promise<Array<RawBlockSlim>> {
    return this.ethClient
      .requestBatch(blockHashes.map(blockHash => getBlockByHash(blockHash, false)))
      .catch(e => Promise.reject(new Error(`Failed to request batch of blocks ${blockHashes.join(', ')}: ${e}`)))
  }

  public async getFullBlocks<T extends boolean>(blockNumbers: number[], decode?: T): Promise<T extends true ? Array<FullBlockResponse> : Array<RawFullBlock>>
  public async getFullBlocks(blockNumbers: number[], decode: boolean = true) {
    if (decode) {
      const blocks = await this.getBlocks(blockNumbers, true)
      return blocks
    } else {
      const blocks = await this.getBlocks(blockNumbers, false)
      const fullBlocks: RawFullBlock[] = []
      for (const b of blocks) {
        const block = await this.processRawFullBlock(b as RawBlock)
        fullBlocks.push(block)
      }
      return fullBlocks
    }
  }

  public async getPendingTransactions<T extends boolean>(decode?: T): Promise<T extends true ? Array<FormattedPendingTransaction> : Array<RawTransactionResponse>>
  public async getPendingTransactions(decode: boolean = true) {
    // pendingTransactions
    try {
      console.log('--> getting pending transactions')
      const req = this.config.experimental ? allPendingTransactions : pendingTransactions
      const pending = await this.ethClient.request(req())
      console.log(`--> got ${pending.length} pending transactions`)
      const hashes = pending.map(({ hash }) => hash)
      const chunks = chunkArray(hashes, 1000)
      let rawTransactions: RawTransactionResponse[] = []
      for (const chunk of chunks) {
        const reqChunk = chunk.map(hash => getTransaction(hash))
        const transactionsChunk = await this.ethClient.requestBatch(reqChunk, { ignoreErrors: true })
        rawTransactions = rawTransactions.concat(transactionsChunk)
      }
      if (decode) {
        const decoded: FormattedPendingTransaction[] = []
        for (const transaction of rawTransactions) {
          const decodedTxn = await this.processPendingTransaction(transaction)
          decoded.push(decodedTxn)
        }
        return decoded
      } else {
        return rawTransactions
      }
    } catch(e) {
      return []
    }
  }

  public async getPendingTransaction(hash: string, decode: boolean = true) {
    try {
      const transaction = await this.ethClient.request(getTransaction(hash), { ignoreErrors: true })
      if (decode) {
        return this.processPendingTransaction(transaction)
      }
      return transaction
    } catch (e) {
      return undefined
    }
  }

  public async getTransaction(hash: string, decode: boolean = true) {
    const transaction = await this.ethClient.request(getTransaction(hash))
    if (transaction.blockHash != null) {
      const cachedBlockTS = this.blockTimestampCache.get(transaction.blockHash)
      const timestamp = cachedBlockTS ?? timestampMS((await this.getSlimBlockByHash(transaction.blockHash)).timestamp)
      this.blockTimestampCache.set(transaction.blockHash, timestamp)
      transaction.timestamp = timestamp
    }
    if (decode) {
      return this.processTransaction(transaction, true)
    }
    return transaction as RawTransaction
  }

  public async getTransactionReceipt(hash: string, decode: boolean = true) {
    const receipt = await this.ethClient.request(getTransactionReceipt(hash))
    const cachedBlockTS = this.blockTimestampCache.get(receipt.blockHash)
    const timestamp = cachedBlockTS ?? timestampMS((await this.getSlimBlockByHash(receipt.blockHash)).timestamp)
    this.blockTimestampCache.set(receipt.blockHash, timestamp)
    receipt.timestamp = timestamp
    if (receipt && decode) {
      return Promise.all(
        receipt?.logs?.map((l: RawLogResponse) => this.processTransactionLog(l, receipt.timestamp)) ?? []
      )
    }
    if (receipt) {
      return receipt
    }
    return []
  }

  private async processRawBlock(rawBlock: RawBlockResponse | RawBlock) {
    const block = formatBlock(rawBlock)
    let receipts: RawTransactionReceipt[] = []
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

    const transactions =
      rawBlock.transactions.length === 0
        ? []
        : await this.abortHandle.race(
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

  public processRawFullTransaction(txn: RawFullTransaction) {
    const { transaction: rawTransaction, receipt } = txn
    return this.processTransaction(rawTransaction, false, receipt)
  }

  private async processRawBlockWithTransactions(rawFullBlock: RawFullBlock) {
    const { block: rawBlock, transactions: rawTransactions } = rawFullBlock
    const block = formatBlock(rawBlock)
    const transactions =
      rawTransactions.length === 0
        ? []
        : await this.abortHandle.race(
            Promise.all(rawTransactions.map(rawTxn => this.processRawFullTransaction(rawTxn)))
          )
    return {
      block,
      transactions
    }
  }

  public async processBlock(rawBlock: RawBlockResponse | RawFullBlock): Promise<FullBlockResponse> {
    if (isRawFullBlock(rawBlock)) {
      return this.processRawBlockWithTransactions(rawBlock)
    } else {
      return this.processRawBlock(rawBlock)
    }
  }

  public async processTransaction(
    rawTx: RawTransactionResponse | RawTransaction | string,
    fetchReceipts: boolean,
    rawReceipt:  RawTransactionReceipt | undefined = undefined
  ): Promise<FormattedTransactionResponse> {
    if (typeof rawTx === 'string') {
      warn('Received raw transaction %s from block %d')
      throw new RuntimeError(`Received raw transaction`)
    }

    const cachedBlockTS = this.blockTimestampCache.get(rawTx.blockHash ?? '')
    const timestamp = cachedBlockTS ?? timestampMS((await this.getSlimBlockByHash(rawTx.blockHash ?? '')).timestamp)
    this.blockTimestampCache.set(rawTx.blockHash ?? '', timestamp)
    rawTx.timestamp = timestamp

    const [receipt, toInfo, fromInfo] = await Promise.all([
      fetchReceipts ? this.ethClient.request(getTransactionReceipt(rawTx.hash)) : rawReceipt,
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
    if (receipt != null) {
      receipt.timestamp = timestamp
    }

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

    const logEvents: FormattedLogEvent[] =
      toInfo && toInfo.isContract
        ? await Promise.all(
            //@ts-ignore
            this.getLogs(receipt).map((l: RawLogResponse | RawParityLogResponse) =>
              this.processTransactionLog(l, receipt?.timestamp!)
            ) ?? []
          )
        : []

    return {
      transaction,
      logEvents
    }
  }

  private getLogs(receipt?: RawTransactionReceipt) {
    if (receipt == null || receipt.logs == null) {
      return []
    }
    return receipt.logs ?? []
  }

  public async processPendingTransaction(
    rawTx: RawTransactionResponse | string
  ): Promise<FormattedPendingTransaction> {
    if (typeof rawTx === 'string') {
      warn('Received raw transaction %s')
      throw new RuntimeError(`Received raw transaction`)
    }

    const { decoded, contractInfo } = await this.decodeFunctionCallV2({ input: rawTx.input, address: rawTx.to! })
    return formatPendingTransaction(rawTx, 'pending', undefined, addressInfo(contractInfo), decoded)
  }

  public async decodeLogEvent(evt: TransactionLog) {
    const { address } = evt
    const eventContractInfo = await contractInfo({
      address,
      resources: this.contractResources
    })
    const contractFingerprint = eventContractInfo == null ? undefined : eventContractInfo.fingerprint
    const decodedEventData =
      evt.topics != null && Array.isArray(evt.topics) && evt.topics.length > 0
        ? this.abiRepo.decodeLogEvent(evt, {
            contractAddress: address,
            contractFingerprint
          })
        : undefined
    return { eventContractInfo, decodedEventData }
  }

  public async processTransactionLog(
    evt: RawLogResponse | FormattedLogEvent,
    timestamp: number
  ): Promise<FormattedLogEvent> {
    const { eventContractInfo, decodedEventData } = await this.decodeLogEvent(evt)
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

  public async getInternalTransaction<T extends boolean>(hash: string, decode?: T): Promise<T extends true ? DecodedTransactionTrace : FormattedTransactionTrace>
  public async getInternalTransaction(hash: string, decode: boolean = true) {
    const trace = await this.ethClient.request(traceTransaction(hash, { tracer: 'callTracer' }))
    const formatted = formatTransactionTrace(trace, hash)
    if (decode) {
      return this.decodeTransactionTrace<DecodedTransactionTrace>(formatted)
    } else {
      return formatted
    }
  }

  public async getInternalTransactionsByBlock<T extends boolean>(blockNumber: number, decode?: T): Promise<T extends true ? Array<DecodedTransactionTrace> : Array<FormattedTransactionTrace>>
  public async getInternalTransactionsByBlock(blockNumber: number, decode: boolean = true) {
    const traces = await this.ethClient.request(traceBlockByNumber(blockNumber, { tracer: 'callTracer' }))
    const formattedTraces = traces.map(({ txHash, result }) => formatTransactionTrace(result, txHash))
    if (decode) {
      const decoded: DecodedTransactionTrace[] = []
      for (const trace of formattedTraces) {
        const dTrace = await this.decodeTransactionTrace<DecodedTransactionTrace>(trace)
        decoded.push(dTrace)
      }
      return decoded
    } else {
      return formattedTraces
    }
  }
  

  private async tryDecodeTraceFunctionCall(input: string, address: string) {
    try {
      const decoded = await this.decodeFunctionCallV2({ input, address })
      return decoded
    } catch(e) {
      const msg = e != null && (e as any).message != null ? (e as any).message : ''
      warn('could not decode function call from transaction trace %s', msg)
    }
    return { decoded: undefined, contractInfo: undefined }
  }


  public async decodeTransactionTrace<T extends DecodedTransactionTrace | DecodedTransactionTraceItem>(
    traceInput: FormattedTransactionTrace | FormattedTransactionTraceItem
  ): Promise<T> {
    const { input, to, calls, ...trace } = traceInput
    const { decoded, contractInfo } =
      input != null && input !== '0x' && to != null && to.startsWith('0x') && to.length === 42
        ? await this.tryDecodeTraceFunctionCall(input, to)
        : { decoded: undefined, contractInfo: undefined }
    const decodedCalls =
      calls != null
        ? await Promise.all(
            calls.map(async call => await this.decodeTransactionTrace<DecodedTransactionTraceItem>(call))
          )
        : undefined
    const response = {
        ...trace,
        to,
        input,
        calls: decodedCalls,
        decoded,
        contractInfo
      } as T
    return response
  }

  public async getFeeHistory(blockCount: number, blockTarget: number): Promise<FeeHistoryResponse> {
    return this.ethClient.request(feeHistory(blockCount, blockTarget))
  }

  public async getLatestBlockNumber(): Promise<number> {
    return this.ethClient.request(blockNumber())
  }

  private addResource<R extends ManagedResource>(r: R): R {
    this.resources.push(r)
    return r
  }
}
