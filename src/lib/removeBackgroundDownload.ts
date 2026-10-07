// 抠图首次下载的**字节级**进度与卡住判定（worker 里用；纯逻辑，单测在 removeBackgroundDownload.test.ts）。
//
// 为什么要自己数字节，而不用 @imgly 的 progress 回调：
//   · 它按资源各报各的（`fetch:/models/…` 0→100，再 `fetch:/onnxruntime-web/…` 又从 0 开始），
//     而且只在**整块**（约 4MB）下完才报一次——慢网下几十秒一动不动，和「卡死」长得一模一样；
//   · 它没有超时：连接挂住不断开时，Promise 永远不结束，节点永远转圈（2026-10-06 用户「抠图没法用」）。
// 所以把 worker 里的 fetch 包一层：只管镜像根下面的请求，边读边数字节、记最后一次收到字节的时间；
// 下载中超过 `stallMs` 没收到一个字节，就把在途请求全部中止，并把这次失败标成「卡住」。

export type DownloadProgress = Readonly<{ received: number; total: number }>

export type DownloadFailure = 'download-stalled' | 'download-failed'

/** 一次抠图失败的原因：下载卡住 / 下载失败 / 别的（解码、推理……）。界面按它说人话（localImageOpPhase.ts）。 */
export type RemoveBackgroundFailure = DownloadFailure | 'failed'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type DownloadTracker = Readonly<{
  /** 替换 worker 的全局 fetch 用。镜像根以外的请求原样放行。 */
  fetch: FetchLike
  /** 定时调用：下载中超时没收到字节就中止在途请求。返回这次是否判了卡住。 */
  checkStall: () => boolean
  /** 这一次抠图失败，是不是下载这一段的原因（卡住 / 网络失败）；不是返回 null。 */
  failure: () => DownloadFailure | null
  /** 每次抠图开始前清零（字节数、失败标记）。 */
  reset: () => void
}>

const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

export function createDownloadTracker(options: {
  publicPath: string
  resourceKeys: readonly string[]
  stallMs: number
  now: () => number
  baseFetch: FetchLike
  onProgress: (progress: DownloadProgress) => void
}): DownloadTracker {
  const { publicPath, resourceKeys, stallMs, now, baseFetch, onProgress } = options
  let total = 0
  let received = 0
  let lastByteAt = 0
  let failure: DownloadFailure | null = null
  const inFlight = new Set<AbortController>()

  const report = (): void => { if (total > 0) onProgress({ received: Math.min(received, total), total }) }

  const readManifest = async (response: Response): Promise<void> => {
    try {
      const manifest = await response.clone().json() as Record<string, { size?: number }>
      const sum = resourceKeys.reduce((acc, key) => acc + (Number(manifest[key]?.size) || 0), 0)
      if (sum > 0) total = sum
    } catch {
      // 清单读不出来不影响下载本身（@imgly 自己会因为清单坏了报错）；只是这一次没有总进度。
    }
  }

  const trackedFetch: FetchLike = async (input, init) => {
    const url = requestUrl(input)
    if (!url.startsWith(publicPath)) return baseFetch(input, init)
    const controller = new AbortController()
    inFlight.add(controller)
    lastByteAt = now()
    let response: Response
    try {
      response = await baseFetch(input, { ...init, signal: controller.signal })
    } catch (error) {
      inFlight.delete(controller)
      failure ??= 'download-failed'
      throw error
    }
    if (!response.ok) {
      inFlight.delete(controller)
      failure ??= 'download-failed'
      return response
    }
    if (url.endsWith('resources.json')) {
      inFlight.delete(controller)
      await readManifest(response)
      return response
    }
    if (!response.body) {
      inFlight.delete(controller)
      return response
    }
    const reader = response.body.getReader()
    const counted = new ReadableStream<Uint8Array>({
      async pull(sink) {
        try {
          const { done, value } = await reader.read()
          if (done) {
            inFlight.delete(controller)
            sink.close()
            return
          }
          received += value.byteLength
          lastByteAt = now()
          report()
          sink.enqueue(value)
        } catch (error) {
          // 读到一半断了：被我们判卡住中止的，已经标过 stalled；别的（连接被重置 / 断网）算下载失败。
          inFlight.delete(controller)
          failure ??= 'download-failed'
          sink.error(error)
        }
      },
      cancel(reason) {
        inFlight.delete(controller)
        return reader.cancel(reason)
      },
    })
    return new Response(counted, { status: response.status, statusText: response.statusText, headers: response.headers })
  }

  return {
    fetch: trackedFetch,
    checkStall: () => {
      if (!inFlight.size || now() - lastByteAt < stallMs) return false
      failure = 'download-stalled'
      for (const controller of inFlight) controller.abort()
      inFlight.clear()
      return true
    },
    failure: () => failure,
    reset: () => {
      received = 0
      failure = null
    },
  }
}
