import { AbortHandle, sleep, linearBackoff, retry } from '@splunkdlt/async-tasks'
import { createModuleDebug } from '@splunkdlt/debug-logging'
import crypto from 'crypto'
import { checkError, createJsonRpcPayload, JsonRpcError, JsonRpcRequest, JsonRpcResponse } from './jsonrpc'
import { EthRequest } from './requests'
import { EthereumTransport } from './transport'
import { RuntimeError } from '../utils/error'
import { chunkArray } from '../utils/obj'
import { HttpTransportConfig } from '../config'

const { info, debug, warn, error } = createModuleDebug('eth:client')

interface BatchReq<P extends any[] = any[], R = any> {
  request: EthRequest<P, R>
  callback: (error: Error | null, result: R) => void
}

async function batchRequestWithFailover(
  reqs: JsonRpcRequest[],
  transport: EthereumTransport,
  splits: number = 1, // 1 is no split
  maxSplits: number = 10
): Promise<JsonRpcResponse[]> {
  if (splits < 1) {
    throw new RuntimeError(`batch request splits can't be less than 1`)
  }
  // const maxSplits = 10
  if (splits <= maxSplits) {
    if (splits > 1) {
      warn('Splitting batch into %d chunks', splits)
    }
    // try to send the batch
    const chunkSize = Math.ceil(reqs.length / splits)
    const reqChunks = chunkArray(reqs, chunkSize)
    // if it fails, split the batch and try again
    try {
      const responses: JsonRpcResponse[] = []
      for (const chunk of reqChunks) {
        const chunkResponses = await transport.sendBatch(chunk)
        for (const response of chunkResponses) {
          responses.push(response)
        }
      }
      return responses
    } catch (e) {
      const error: String = (e as any).toString()
      info('client batch request error: %s', error)
      const retryable = ['Socket timeout', 'too large', 'too big']
      let retry = false
      for (const retryableError of retryable) {
        if (error.includes(retryableError)) {
          retry = true
        }
      }
      if (retry) {
        return batchRequestWithFailover(reqs, transport, splits + 1)
      }
      return Promise.reject(e)
    }
  }
  throw new RuntimeError('Too many batch splits')
}

export function md5(data: Object | string): string {
  const stringValue = typeof data === 'string' ? data : JSON.stringify(data)
  return crypto
    .createHash('md5')
    .update(stringValue)
    .digest('hex')
}

async function singleRequests(transport: EthereumTransport, reqs: JsonRpcRequest[]): Promise<JsonRpcResponse[]> {
  const concurrent = 1
  const chunks = chunkArray(reqs, concurrent)
  const responses: JsonRpcResponse[] = []
  for (const chunk of chunks) {
    const chunkResponses = await Promise.all(chunk.map((req) => transport.send(req)))
    responses.push(...chunkResponses)
  }
  return responses
}

async function handleRpcResults(
  results: JsonRpcResponse[],
  reqs: Map<number, JsonRpcRequest>,
  reqOrder: { hash: string; batchItem: BatchReq }[],
  unique: Map<string, JsonRpcRequest>,
  resultsByHash: Map<string, JsonRpcResponse>,
  transport: EthereumTransport,
  attempt: number,
  maxAttempts: number
) {
  for (const result of results) {
    const req = reqs.get(result.id)
    if (req == null) {
      error(`Found unassociated batch item in batch response`)
      continue
    }
    const { method, params } = req
    const hash = params == null ? md5({ method, params: [] }) : md5({ method, params })
    resultsByHash.set(hash, result)
    reqs.delete(result.id)
  }
  const reqLength = reqOrder.length
  const missingItems: BatchReq[] = []
  for (let i = 0; i < reqLength; i++) {
    const req = reqOrder.shift()
    if (req == null) {
      error(`error processing batch requests`)
      continue
    }
    const { hash, batchItem } = req
    const result = resultsByHash.get(hash)
    if (result == null) {
      missingItems.push(batchItem)
      debug(JSON.stringify(req))
      error(`expected response not found`)
      continue
    }
    batchItem.callback(null, result)
  }
  if (reqs.size > 0) {
    warn(`Unprocessed batch request after receiving results`)
    // dump unprocessed batch items
    console.log(JSON.stringify(Array.from(reqs.entries())))
  }
  if (missingItems.length > 0) {
    if (attempt <= maxAttempts) {
      warn(`Retrying batch request (attempt ${attempt})`)
      // executeBatchRequest(missingItems, transport, abortHandle, waitAfterFailure, attempt + 1)
      const missingRequests: JsonRpcRequest[] = []
      for (const missing of missingItems) {
        const { method, params } = missing.request
        const hash = params == null ? md5({ method, params: [] }) : md5({ method, params })
        const req = unique.get(hash)
        if (req == null) {
          throw new RuntimeError('Request should not be missing from unique requests map')
        }
        missingRequests.push(req)
        reqOrder.push({ hash, batchItem: missing })
      }
      const singleResults = await singleRequests(transport, missingRequests)
      await handleRpcResults(singleResults, reqs, reqOrder, unique, resultsByHash, transport, attempt + 1, maxAttempts)
    } else {
      error(`Unprocessed batch request after receiving results`)
      for (const unprocessed of missingItems) {
        unprocessed.callback(new Error('Result missing from batch response'), null)
      }
    }
  }
}

export async function executeBatchRequest(
  batch: BatchReq[],
  transport: EthereumTransport,
  abortHandle: AbortHandle,
  httpConfig: HttpTransportConfig,
  waitAfterFailure = linearBackoff({ min: 0, step: 2500, max: 120_000 }),
  attempt = 1
) {
  const maxAttempts = 5
  debug('Processing batch of %d JSON RPC requests', batch.length)
  if (batch.length > 0) {
    try {
      // const items = new Map<string, BatchReq>()
      const reqOrder: { hash: string, batchItem: BatchReq }[] = []
      const unique = new Map<string, JsonRpcRequest>()
      const reqs = new Map<number, JsonRpcRequest>() 
      for (const batchItem of batch) {
        const { method, params } = batchItem.request
        const hash = params == null ? md5({ method, params: [] }) : md5({ method, params })
        if (!unique.has(hash)) {
          const req = createJsonRpcPayload(method, params)
          unique.set(hash, req)
          reqs.set(req.id, req)
        }
        reqOrder.push({ hash, batchItem })
      }
      
      const results: JsonRpcResponse[] = await retry(
        () => batchRequestWithFailover(Array.from(reqs.values()), transport, 1, httpConfig.maxBatchSplits),
        {
          attempts: httpConfig.maxRetries,
          waitBetween: waitAfterFailure,
          taskName: `eth api batch request`,
          abortHandle: abortHandle,
          warnOnError: true,
          onError: e => {
            info('client batch request error: %s', e.toString())
            debug('requests: %s', Array.from(reqs.values().toString()))
          },
          onRetry: attmpt => warn('Retrying eth api batch request (attempt %d)', attmpt)
        }
      )
      await handleRpcResults(
        results,
        reqs,
        reqOrder,
        unique,
        new Map<string, JsonRpcResponse>(),
        transport,
        attempt,
        maxAttempts
      )
    } catch (e) {
      batch.forEach(({ callback }) => callback(e as any, null))
    }
  }
}

export class EthereumClient {
  public abortHandle = new AbortHandle()
  constructor(public readonly transport: EthereumTransport, public readonly httpConfig: HttpTransportConfig) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async request<P extends any[], R>(req: EthRequest<P, R>, options?: { immediate?: boolean, ignoreErrors?: boolean }): Promise<R> {
    const payload = createJsonRpcPayload(req.method, req.params)
    const res = await this.transport.send(payload)
    if (payload.id !== res.id) {
      throw new JsonRpcError(`JSON RPC Response ID mismatch. Expected ${payload.id} but got ${res.id}`)
    }
    if (options != null && !!options.ignoreErrors) {
      // ignore errors
    } else {
      checkError(res)
    }
    return typeof req.response === 'function' ? req.response(res) : res.result
  }

  async requestBatch<P extends any[], R>(reqs: EthRequest<P, R>[], options?: { ignoreErrors?: boolean }): Promise<R[]> {
    const batchReqs: BatchReq[] = []
    const promises = []
    for (const request of reqs) {
      promises.push(
        new Promise<R>((resolve, reject) => {
          batchReqs.push({
            request,
            callback: (e, result) => {
              if (e) {
                reject(e)
              }
              try {
                if (options != null && !!options.ignoreErrors) {
                  // ignore errors
                } else {
                  checkError(result)
                }
                resolve(typeof request.response === 'function' ? request.response(result) : result.result)
              } catch (e) {
                debug(`JSON RPC request method: %s failed`, request.method, e)
                reject(e)
              }
            }
          })
        })
      )
    }
    await sleep(0)
    await executeBatchRequest(batchReqs, this.transport, this.abortHandle, this.httpConfig)
    return await Promise.all(promises)
  }
}

export interface BatchedEthereumClientConfig {
  maxBatchTime: number
  maxBatchSize: number
}

export class BatchedEthereumClient extends EthereumClient {
  private config: BatchedEthereumClientConfig
  private queue: BatchReq<any[], any>[] = []
  private flushTimer: NodeJS.Timer | null = null
  constructor(transport: EthereumTransport, config: BatchedEthereumClientConfig, httpConfig: HttpTransportConfig) {
    super(transport, httpConfig)
    this.config = config
  }

  request<P extends any[], R>(req: EthRequest<P, R>, { immediate = false }: { immediate?: boolean } = {}): Promise<R> {
    if (immediate) {
      return super.request(req)
    }

    return new Promise((resolve, reject) => {
      this.queue.push({
        request: req,
        callback: (e, result) => {
          if (e) {
            reject(e)
            return
          }
          try {
            checkError(result)
            resolve(typeof req.response === 'function' ? req.response(result) : result.result)
          } catch (e) {
            debug(`JSON RPC request method: %s(%o) failed`, req.method, req.params, e)
            reject(e)
          }
        }
      })
      this.scheduleFlush()
    })
  }

  private processQueue = async () => {
    if (this.flushTimer != null) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.queue.length === 0) {
      return
    }
    const batch = this.queue
    this.queue = []
    return await executeBatchRequest(batch, this.transport, this.abortHandle, this.httpConfig)
  }

  private scheduleFlush() {
    if (this.queue.length >= this.config.maxBatchSize) {
      this.processQueue()
      return
    }
    if (this.flushTimer == null) {
      this.flushTimer = setTimeout(this.processQueue, this.config.maxBatchTime)
    }
  }
}
