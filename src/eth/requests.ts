import Web3 from 'web3' // TODO: remove this. Replace with native functions needed.
import { bigIntToNumber, numberToHex } from '../utils/bn'
import { createModuleDebug } from '@splunkdlt/debug-logging'
import { JsonRpcResponse } from './jsonrpc'
import {
  GethMemStats,
  GethMetrics,
  GethNodeInfoResponse,
  GethPeers,
  GethTxpool,
  ParityMode,
  ParityNodeKind,
  ParityPeers,
  ParityPendingTransaction,
  RawBlockResponse,
  RawTransactionReceipt,
  RawTransactionResponse,
  SyncStatus,
  RawFeeHistoryResponse,
  FeeHistoryResponse,
  RawTraceTransactionResult,
  RawBlockSlim,
  RawTraceTransactionItemResult
} from './responses'

const web3 = new Web3()
const { info, warn, error, debug } = createModuleDebug('eth:requests')

export interface EthRequest<P extends any[], R> {
  method: string
  params?: P
  response?: (r: JsonRpcResponse) => R
}

export interface EthTracerOptions {
  tracer: string
  tracerConfig?: {
    enableMemory?: boolean
    disableStack?: boolean
    disableStorage?: boolean
    enableReturnData?: boolean
    debug?: boolean
    limit?: number
  }
  timeout?: string // Durations, like '300ms', '1.5h', or '2h45m' https://pkg.go.dev/time#ParseDuration
  reexec?: number
}

export function decodeResponseType(type: string, data: string): any {
  if (type === 'hex') {
    if (data.startsWith('0x')) {
      return data
    }
    return `0x${data}`
  }
  if (type === 'string') {
    try {
      return web3.eth.abi.decodeParameter(type, data)
    } catch (e) {
      debug('Failed to decode string response, trying hexToAscii')
      return web3.utils.hexToAscii(data).replace(/\u0000/g, '')
    }
  }
  return web3.eth.abi.decodeParameter(type, data)
}

export function encodeParameter(value: number | string, type: string): string {
  return web3.eth.abi.encodeParameter(type, value)
}

function parseFeeHistoryResponse({ oldestBlock, baseFeePerGas, gasUsedRatio, reward: rawReward }: RawFeeHistoryResponse): FeeHistoryResponse {
  const reward = rawReward != null ? rawReward.map(rewards => rewards.map(bigIntToNumber)) : undefined
  return {
    oldestBlock: bigIntToNumber(oldestBlock),
    baseFeePerGas: baseFeePerGas.map(bigIntToNumber),
    gasUsedRatio,
    reward
  }
}

export const blockNumber = (): EthRequest<[], number> => ({
  method: 'eth_blockNumber',
  response: (r: JsonRpcResponse) => bigIntToNumber(r.result)
})

export const getBlock = <T extends boolean>(
  blockNumber: number | 'latest' | 'pending', includeTxns: T
): EthRequest<[string, boolean], T extends true ? RawBlockResponse : RawBlockSlim> => ({
  method: 'eth_getBlockByNumber',
  params: [typeof blockNumber === 'number' ? numberToHex(blockNumber) : blockNumber, includeTxns]
})

export const getBlockByHash = <T extends boolean>(
  blockHash: string, includeTxns: T
): EthRequest<[string, boolean], T extends true ? RawBlockResponse : RawBlockSlim> => ({
  method: 'eth_getBlockByHash',
  params: [blockHash, includeTxns]
})

export const getTransaction = (txHash: string): EthRequest<[string], RawTransactionResponse> => ({
  method: 'eth_getTransactionByHash',
  params: [txHash]
})

export const getTransactionReceipt = (txHash: string): EthRequest<[string], RawTransactionReceipt> => ({
  method: 'eth_getTransactionReceipt',
  params: [txHash]
})

export const traceTransaction = (
  txHash: string,
  traceOptions?: EthTracerOptions
): EthRequest<
  [string, EthTracerOptions | undefined], RawTraceTransactionResult
> => ({
  method: 'debug_traceTransaction',
  params: [txHash, traceOptions ?? { tracer: 'callTracer', timeout: '180s' }]
})

export const traceBlockByNumber = (
  blockNumber: number,
  traceOptions?: EthTracerOptions
): EthRequest<
  [string, EthTracerOptions | undefined], RawTraceTransactionItemResult[]
> => ({
  method: 'debug_traceBlockByNumber',
  params: [numberToHex(blockNumber), traceOptions ?? { tracer: 'callTracer', timeout: '180s' }]
})

export const getCode = (address: string): EthRequest<[string, string], string> => ({
  method: 'eth_getCode',
  params: [address, 'latest']
})

export const getStorageAt = (address: string, storageSlot: string): EthRequest<[string, string, string], string> => ({
  method: 'eth_getStorageAt',
  params: [address, storageSlot, 'latest']
})

export const pendingTransactions = (): EthRequest<[], RawTransactionResponse[]> => ({
  method: 'eth_pendingTransactions',
  params: []
})

export const allPendingTransactions = (): EthRequest<[], RawTransactionResponse[]> => ({
  method: 'eth_allPendingTransactions',
  params: []
})

/** Returns the current client version */
export const clientVersion = (): EthRequest<[], string> => ({
  method: 'web3_clientVersion'
})

/** Returns the current network id */
export const netVersion = (): EthRequest<[], number> => ({
  method: 'net_version',
  response: r => bigIntToNumber(r.result)
})

/** Returns the chain ID - see https://github.com/ethereum/EIPs/blob/master/EIPS/eip-695.md */
export const chainId = (): EthRequest<[], number> => ({
  method: 'eth_chainId',
  response: r => bigIntToNumber(r.result)
})

/** Returns the current ethereum protocol version */
export const protocolVersion = (): EthRequest<[], number> => ({
  method: 'eth_protocolVersion',
  response: r => bigIntToNumber(r.result)
})

/** Returns true if client is actively mining new blocks */
export const mining = (): EthRequest<[], boolean> => ({
  method: 'eth_mining'
})

/** Returns the number of hashes per second that the node is mining with */
export const hashRate = (): EthRequest<[], number> => ({
  method: 'eth_hashrate',
  response: r => bigIntToNumber(r.result)
})

/** Returns the current price per gas in wei */
export const gasPrice = (): EthRequest<[], number | string> => ({
  method: 'eth_gasPrice',
  response: r => bigIntToNumber(r.result)
})

export const feeHistory = (blockCount: number | string, newestBlock: string | number, rewardPercentiles: number[] = []): EthRequest<[string | number, string, Array<number>], FeeHistoryResponse> => ({
  method: 'eth_feeHistory',
  params: [
    blockCount,
    typeof newestBlock === 'number' ? numberToHex(newestBlock) : newestBlock,
    rewardPercentiles
  ],
  response: r => parseFeeHistoryResponse(r.result)
})

/** Returns number of peers currently connected to the client */
export const peerCount = (): EthRequest<[], number> => ({
  method: 'net_peerCount',
  response: r => bigIntToNumber(r.result)
})

/** Returns an object with sync status data or FALSE, when not syncing */
export const syncing = (): EthRequest<[], SyncStatus> => ({
  method: 'eth_syncing'
})

/** Returns the result from calling a method of a contract */
export const call = (
  to: string,
  method: string,
  responseType: string
): EthRequest<[{ to: string; data: string }, string], any> => ({
  method: 'eth_call',
  params: [{ to, data: `0x${method}` }, 'latest'],
  response: r => decodeResponseType(responseType, r.result)
})

// Geth specific requests

export const gethNodeInfo = (): EthRequest<[], GethNodeInfoResponse> => ({
  method: 'admin_nodeInfo'
})

export const gethPeers = (): EthRequest<[], GethPeers> => ({
  method: 'admin_peers'
})

export const gethMetrics = (param: boolean): EthRequest<[boolean], GethMetrics> => ({
  method: 'debug_metrics',
  params: [param]
})

export const gethMemStats = (): EthRequest<[], GethMemStats> => ({
  method: 'debug_memStats'
})

export const gethTxpool = (): EthRequest<[], GethTxpool> => ({
  method: 'txpool_content'
})

// Quorum specific requests

export const quorumIstanbulSnapshot = (): EthRequest<[], any> => ({
  method: 'istanbul_getSnapshot'
})

export const quorumIstanbulCandidates = (): EthRequest<[], any> => ({
  method: 'istanbul_candidates'
})

export const quorumRaftRole = (): EthRequest<[], any> => ({
  method: 'raft_role'
})

export const quorumRaftLeader = (): EthRequest<[], any> => ({
  method: 'raft_leader'
})

export const quorumRaftCluster = (): EthRequest<[], any> => ({
  method: 'raft_cluster'
})

export const quorumPrivateTransactionPayload = (id: string): EthRequest<[string], string> => ({
  method: 'eth_getQuorumPayload',
  params: [id]
})

// Parity specific requests

/** Returns the node enode URI */
export const parityEnode = (): EthRequest<[], string> => ({
  method: 'parity_enode'
})

export const parityMode = (): EthRequest<[], ParityMode> => ({
  method: 'parity_mode'
})

export const parityNodeKind = (): EthRequest<[], ParityNodeKind> => ({
  method: 'parity_nodeKind'
})

export const parityPeers = (): EthRequest<[], ParityPeers> => ({
  method: 'parity_netPeers'
})

export const parityPendingTransactions = (): EthRequest<[], ParityPendingTransaction[]> => ({
  method: 'parity_pendingTransactions'
})

export const getBlockReceipts = (
  blockNumber: number | string
): EthRequest<[string], RawTransactionReceipt[]> => ({
  method: 'eth_getBlockReceipts',
  params: [typeof blockNumber === 'number' ? numberToHex(blockNumber) : blockNumber]
})
