import { toChecksumAddress } from '../abi/wasm'
import {
  RawBlockResponse,
  RawLogResponse,
  RawTransactionReceipt,
  RawTransactionResponse,
  RawParityLogResponse,
  RawBlockSlim,
  RawTraceTransactionResult
} from '../eth/responses'
import {
  AddressInfo,
  BaseFormattedTransaction,
  EventData,
  FormattedBlock,
  FormattedLogEvent,
  FormattedPendingTransaction,
  FormattedTransaction,
  FormattedTransactionTrace,
  FormattedTransactionTraceItem,
  FunctionCall,
  PrivateTransactionPayload
} from '../msgs'
import { bigIntToNumber, parseBigInt } from './bn'

export function parseBlockTime(timestamp: number | string): number {
  if (typeof timestamp === 'number') {
    return timestamp * 1000
  }

  if (typeof timestamp === 'string') {
    // Timestamp on Quorum/Raft nodes are emitted as nanoseconds since unix epoch
    // so translate it to milliseconds
    const ms = BigInt(timestamp) / BigInt(1_000_000)
    return bigIntToNumber(ms)
  }
  throw new Error(`Unable to parse block timestamp "${timestamp}"`)
}

export function formatBlock(rawBlock: RawBlockResponse | RawBlockSlim): FormattedBlock {
  return {
    timestamp: parseBigInt(rawBlock.timestamp),
    number: rawBlock.number != null ? bigIntToNumber(rawBlock.number) : null,
    hash: rawBlock.hash,
    parentHash: rawBlock.parentHash,
    sha3Uncles: rawBlock.sha3Uncles,
    miner: toChecksumAddress(rawBlock.miner),
    stateRoot: rawBlock.stateRoot,
    transactionsRoot: rawBlock.transactionsRoot,
    receiptsRoot: rawBlock.receiptsRoot,
    logsBloom: rawBlock.logsBloom,
    difficulty: parseBigInt(rawBlock.difficulty),
    gasLimit: parseBigInt(rawBlock.gasLimit),
    gasUsed: parseBigInt(rawBlock.gasUsed),
    baseFeePerGas: rawBlock.baseFeePerGas != null ? parseBigInt(rawBlock.baseFeePerGas) : null,
    extraData: rawBlock.extraData,
    nonce: rawBlock.nonce,
    totalDifficulty: rawBlock.totalDifficulty != null ? parseBigInt(rawBlock.totalDifficulty) : 0,
    size: bigIntToNumber(rawBlock.size),
    uncles: rawBlock.uncles,
    transactionCount: rawBlock.transactions == null ? 0 : rawBlock.transactions.length,
    transactions: <string[]>(
      (rawBlock.transactions == null
        ? []
        //@ts-ignore
        : rawBlock.transactions.map(txn => (typeof txn === 'string' ? txn : txn.hash)))
    ),
    blobGasUsed: rawBlock.blobGasUsed != null ? parseBigInt(rawBlock.blobGasUsed) : null,
    excessBlobGas: rawBlock.excessBlobGas != null ? parseBigInt(rawBlock.excessBlobGas) : null,
    mixHash: rawBlock.mixHash,
    parentBeaconBlockRoot: rawBlock.parentBeaconBlockRoot,
    withdrawals: rawBlock.withdrawals != null ? rawBlock.withdrawals.map(({ index, validatorIndex, address, amount}) => ({
      index: parseBigInt(index),
      validatorIndex: parseBigInt(index),
      address: toChecksumAddress(address),
      amount: parseBigInt(amount)
    })) : [],
    withdrawalsRoot: rawBlock.withdrawalsRoot
  }
}

function formatStatus(receiptStatus?: string): 'success' | 'failure' | null {
  if (receiptStatus != null) {
    const n = bigIntToNumber(receiptStatus)
    if (n === 0) {
      return 'failure'
    } else if (n === 1) {
      return 'success'
    } else {
      throw new Error(`Encountered invalid receipt status value: ${n} (expected 0 or 1)`)
    }
  }
  return null
}

function formatBaseTransaction(rawTx: RawTransactionResponse): BaseFormattedTransaction {
  const base: BaseFormattedTransaction = {
    hash: rawTx.hash,
    from: toChecksumAddress(rawTx.from),
    to: rawTx.to != null ? toChecksumAddress(rawTx.to) : null,
    gas: parseBigInt(rawTx.gas),
    gasPrice: parseBigInt(rawTx.gasPrice),
    input: rawTx.input,
    nonce: bigIntToNumber(rawTx.nonce),
    value: parseBigInt(rawTx.value),
    v: rawTx.v,
    r: rawTx.r,
    s: rawTx.s
  }
  if (rawTx.maxFeePerGas != null) {
    base.maxFeePerGas = parseBigInt(rawTx.maxFeePerGas)
  }
  if (rawTx.maxPriorityFeePerGas != null) {
    base.maxPriorityFeePerGas = parseBigInt(rawTx.maxPriorityFeePerGas)
  }
  return base
}

export function formatTransaction(
  rawTx: RawTransactionResponse,
  receipt: RawTransactionReceipt,
  fromInfo?: AddressInfo,
  toInfo?: AddressInfo,
  contractAddressInfo?: AddressInfo,
  call?: FunctionCall,
  privatePayload?: PrivateTransactionPayload
): FormattedTransaction {
  return {
    ...formatBaseTransaction(rawTx),
    blockHash: rawTx.blockHash,
    blockNumber: rawTx.blockNumber != null ? bigIntToNumber(rawTx.blockNumber) : null,
    transactionIndex: rawTx.transactionIndex != null ? bigIntToNumber(rawTx.transactionIndex) : null,
    status: formatStatus(receipt.status),
    contractAddress: receipt.contractAddress != null ? toChecksumAddress(receipt.contractAddress) : null,
    cumulativeGasUsed: parseBigInt(receipt.cumulativeGasUsed),
    gasUsed: parseBigInt(receipt.gasUsed),
    fromInfo,
    toInfo,
    contractAddressInfo,
    call,
    privatePayload
  }
}

export function formatPendingTransaction(
  rawTx: RawTransactionResponse,
  type: 'pending' | 'queued',
  fromInfo?: AddressInfo,
  toInfo?: AddressInfo,
  call?: FunctionCall
): FormattedPendingTransaction {
  return {
    type,
    ...formatBaseTransaction(rawTx),
    fromInfo,
    toInfo,
    call
  }
}

export function formatLogEvent(
  evt: RawLogResponse | RawParityLogResponse | FormattedLogEvent,
  addressInfo?: AddressInfo,
  event?: EventData
): FormattedLogEvent {
  return {
    removed: evt.removed,
    logIndex: evt.logIndex != null ? bigIntToNumber(evt.logIndex) : null,
    blockNumber: evt.blockNumber != null ? bigIntToNumber(evt.blockNumber) : null,
    blockHash: evt.blockHash,
    transactionHash: evt.transactionHash,
    transactionIndex: evt.transactionIndex != null ? bigIntToNumber(evt.transactionIndex) : null,
    address: toChecksumAddress(evt.address),
    data: evt.data,
    topics: evt.topics,
    addressInfo,
    event,
    timestamp: evt.timestamp
  }
}

export function formatTransactionTrace(
  trace: RawTraceTransactionResult,
  hash?: string
): FormattedTransactionTrace | FormattedTransactionTraceItem {
  return {
    hash,
    from: trace.from != null ? toChecksumAddress(trace.from) : '',
    gas: trace.gas != null ? parseBigInt(trace.gas) : 0,
    gasUsed: trace.gasUsed != null ? parseBigInt(trace.gasUsed) : 0,
    to: trace.to != null ? toChecksumAddress(trace.to) : '',
    input: trace.input,
    calls: trace.calls != null ? trace.calls.map(c => formatTransactionTrace(c)) : undefined,
    value: trace.value != null ? parseBigInt(trace.value) : 0,
    type: trace.type
  }
}

export function timestampMS(ts: string | number): number {
  return typeof ts === 'string' ? parseInt(ts, 10) * 1000 : ts * 1000
}