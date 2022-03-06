import { LRUCache } from '@splunkdlt/cache'
import { ManagedResource } from '@splunkdlt/managed-resource'
import { Address, ContractInfo, contractInfo } from './abi/contract'
import { AbiRepository } from './abi/repo'
import { Config, DeepPartial } from './config'
import { BatchedEthereumClient, EthereumClient } from './eth/client'
import { HttpTransport } from './eth/http'
import { Classification } from './utils/classification'
import { deepMerge } from './utils/obj'

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
      maxBatchTime: 0
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
  }
}

export class EvmDecoder {
  private config: Config
  private abiRepo: AbiRepository
  private classification: Classification
  private ethBatchClient: EthereumClient
  private contractInfoCache: LRUCache<string, Promise<ContractInfo>>
  private resources: ManagedResource[] = []

  constructor(config: DeepPartial<Config>) {
    this.config = deepMerge(config, DEFAULT_CONFIG) as Config
    this.abiRepo = new AbiRepository(this.config.abi)
    this.addResource(this.abiRepo)

    this.contractInfoCache = new LRUCache<string, Promise<ContractInfo>>({
      maxSize: this.config.contractInfo.maxCacheEntries
    })
    const transport = new HttpTransport(this.config.eth.url, this.config.eth.http)
    this.ethBatchClient =
      this.config.eth.client.maxBatchSize > 1
        ? new BatchedEthereumClient(transport, {
            maxBatchSize: this.config.eth.client.maxBatchSize,
            maxBatchTime: this.config.eth.client.maxBatchTime
          })
        : new EthereumClient(transport)
    this.classification = new Classification(new EthereumClient(transport))
  }

  public async initialize() {
    await this.abiRepo.initialize()
  }

  public async decodeFunctionCall({ input, address }: { input: string; address?: string }) {
    const contractInfo = address != null ? await this.contractInfo({ address }) : undefined
    const decoded = this.abiRepo.decodeFunctionCall(input, {
      contractAddress: address,
      contractFingerprint: contractInfo != null ? contractInfo.fingerprint : undefined
    })
    if (address != null && decoded != null && contractInfo != null) {
      console.log('trying to get extra data')
      return this.classification.getExtraData(address, decoded, contractInfo, input)
    }
    return decoded
  }

  public async contractInfo({ address }: { address: string }) {
    return contractInfo({
      address,
      ethBatchClient: this.ethBatchClient,
      abiRepo: this.abiRepo,
      contractInfoCache: this.contractInfoCache,
      classification: this.classification
    })
  }

  private addResource<R extends ManagedResource>(r: R): R {
    this.resources.push(r)
    return r
  }
}
