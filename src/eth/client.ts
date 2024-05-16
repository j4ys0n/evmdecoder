import { AbortHandle, sleep, linearBackoff, retry } from '@splunkdlt/async-tasks'
import { createModuleDebug } from '@splunkdlt/debug-logging'
import { checkError, createJsonRpcPayload, JsonRpcError, JsonRpcRequest } from './jsonrpc'
import { EthRequest } from './requests'
import { EthereumTransport } from './transport'

const { info, debug, warn, error } = createModuleDebug('eth:client')

interface BatchReq<P extends any[] = any[], R = any> {
  request: EthRequest<P, R>
  callback: (error: Error | null, result: R) => void
}

export async function executeBatchRequest(
  batch: BatchReq[],
  transport: EthereumTransport,
  abortHandle: AbortHandle,
  waitAfterFailure = linearBackoff({ min: 0, step: 2500, max: 120_000 })
) {
  debug('Processing batch of %d JSON RPC requests', batch.length)
  if (batch.length > 0) {
    try {
      const items = new Map<number, BatchReq>()
      const reqs: JsonRpcRequest[] = []
      for (const batchItem of batch) {
        const req = createJsonRpcPayload(batchItem.request.method, batchItem.request.params)
        reqs.push(req)
        items.set(req.id, batchItem)
      }
      
      const results = await retry(() => transport.sendBatch(reqs), {
        attempts: 100,
        waitBetween: waitAfterFailure,
        taskName: `eth api batch request`,
        abortHandle: abortHandle,
        warnOnError: true,
        onError: e => {
          info('client batch request error: %s', e.toString())
          debug('requests: %s', reqs.toString())
        },
        onRetry: attempt => warn('Retrying eth api batch request (attempt %d)', attempt)
      })
      for (const result of results) {
        const batchItem = items.get(result.id)
        if (batchItem == null) {
          error(`Found unassociated batch item in batch response`)
          continue
        }
        batchItem.callback(null, result)
        items.delete(result.id)
      }
      if (items.size > 0) {
        error(`Unprocessed batch request after receiving results`)
        for (const unprocessed of items.values()) {
          unprocessed.callback(new Error('Result missing from batch response'), null)
        }
      }
    } catch (e) {
      batch.forEach(({ callback }) => callback(e as any, null))
    }
  }
}

export class EthereumClient {
  public abortHandle = new AbortHandle()
  constructor(public readonly transport: EthereumTransport) {}

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

  async requestBatch<P extends any[], R>(reqs: EthRequest<P, R>[]): Promise<R[]> {
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
                checkError(result)
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
    await executeBatchRequest(batchReqs, this.transport, this.abortHandle)
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
  constructor(transport: EthereumTransport, config: BatchedEthereumClientConfig) {
    super(transport)
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
    return await executeBatchRequest(batch, this.transport, this.abortHandle)
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
