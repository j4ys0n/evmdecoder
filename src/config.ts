export interface Config {
  /** Ethereum node configuration */
  eth: EthereumConfigSchema
  /** ABI repository configuration */
  abi: AbiRepositoryConfig
  /** Contract info cache settings */
  contractInfo: ContractInfoConfigSchema
}

/** General Ethereum configuration including client and transport, defining how evmdecoder talks to the ethereum node */
export interface EthereumConfigSchema {
  /** URL of JSON RPC endpoint */
  url: string
  /** HTTP transport configuration */
  http: HttpTransportConfig
  /** Ethereum client configuration */
  client: EthereumClientConfigSchema
}

export interface AbiRepositoryConfig {
  /** If specified, the ABI repository will recursively search this directory for ABI files */
  directory?: string
  /** `true` to search ABI directory recursively for ABI files */
  searchRecursive?: boolean
  /** Set to `.json` by default as the file extension for ABIs */
  abiFileExtension?: string
  /**
   * If enabled, the ABI repository will creates hashes of all function and event signatures of an ABI
   * (the hash is the fingerprint) and match it against the EVM bytecode obtained from live smart contracts
   * we encounter.
   */
  fingerprintContracts: boolean
  /**
   * If enabled, signature matches will be treated as anonymous (parameter names will be omitted from
   * the output) if a contract cannot be tied to an ABI definition via either a fingerprint match,
   * or a contract address match (when the ABI file includes the address of the deployed contract).
   * Enabled by default. Setting this to `false` will output parameter names for any matching signature.
   */
  requireContractMatch: boolean
  /**
   * If enabled, evmdecoder will attempt to decode function calls and event logs using a set of
   * common signatures as a fallback if no match against any supplied ABI definition was found.
   */
  decodeAnonymous: boolean
  /**
   * If enabled, evmdecoder will attempt to reconcile the shape of struct definitions from decoded tuples
   * data if the ABI definition contains names for each of the tuple components. This basically turns
   * the decoded array into an key-value map, where the keys are the names from the ABI definition.
   */
  reconcileStructShapeFromTuples: boolean
}

/**
 * evmdecoder can check each address it encounters and determines whether it is a smart contract by
 * attempting to retrieve the contract code. To reduce the performance hit by this operation, evmdecoder
 * can cache contract information in memory.
 */
export interface ContractInfoConfigSchema {
  /** Maximum number of contract info results to cache in memory. Set to 0 to disable the cache. */
  maxCacheEntries: number
}

export interface HttpTransportConfig {
  /** Time before failing JSON RPC requests. Specify a number in milliseconds. */
  timeout?: Duration
  /** If set to false, the HTTP client will ignore certificate errors (eg. when using self-signed certs) */
  validateCertificate?: boolean
  /** Keep sockets to JSON RPC open */
  requestKeepAlive?: boolean
  /** Maximum number of sockets HEC will use (per host) */
  maxSockets?: number
}

/** Ethereum client settings - configure batching multiple JSON RPC method calls into single HTTP requests */
export interface EthereumClientConfigSchema {
  /** Maximum number of JSON RPC requests to pack into a single batch. Set to `1` to disable batching. */
  maxBatchSize: number
  /** Maximum time to wait before submitting a batch of JSON RPC requests */
  maxBatchTime: Duration
  /** Request individual transaction receipts from RPC? Set to `false` for Alchemy */
  individualReceipts: boolean,
  //** Maximum time to wait before resubmitting a batch of JSON RPC requests, exponential backoff */
  maxRetryTime: number
}

export type Duration = number

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends Array<infer U>
    ? Array<DeepPartial<U>>
    : T[P] extends ReadonlyArray<infer U>
    ? ReadonlyArray<DeepPartial<U>>
    : DeepPartial<T[P]>
}
