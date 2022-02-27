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
  RawParityTransactionReceipt,
  SyncStatus
} from './responses'

const web3 = new Web3()
const { info, warn, error, debug } = createModuleDebug('eth:requests')

export interface EthRequest<P extends any[], R> {
  method: string
  params?: P
  response?: (r: JsonRpcResponse) => R
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
      warn('Failed to decode string response, trying hexToAscii')
      return web3.utils.hexToAscii(data).replace(/\u0000/g, '')
    }
  }
  return web3.eth.abi.decodeParameter(type, data)
}

export function encodeParameter(value: number | string, type: string): string {
  return web3.eth.abi.encodeParameter(type, value)
}

export const blockNumber = (): EthRequest<[], number> => ({
  method: 'eth_blockNumber',
  response: (r: JsonRpcResponse) => bigIntToNumber(r.result)
})

export const getBlock = (
  blockNumber: number | 'latest' | 'pending'
): EthRequest<[string, boolean], RawBlockResponse> => ({
  method: 'eth_getBlockByNumber',
  params: [typeof blockNumber === 'number' ? numberToHex(blockNumber) : blockNumber, true]
})

export const getTransactionReceipt = (txHash: string): EthRequest<[string], RawTransactionReceipt> => ({
  method: 'eth_getTransactionReceipt',
  params: [txHash]
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
  method: 'eth_pendingTransactions'
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
): EthRequest<[string], RawParityTransactionReceipt[]> => ({
  method: 'parity_getBlockReceipts',
  params: [typeof blockNumber === 'number' ? numberToHex(blockNumber) : blockNumber]
})
