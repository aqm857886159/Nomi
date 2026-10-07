import { removeBackground as imglyRemoveBackground, type Config } from '@imgly/background-removal'
import { createDownloadTracker, type RemoveBackgroundFailure } from './removeBackgroundDownload'
import {
  REMOVE_BACKGROUND_MODEL,
  REMOVE_BACKGROUND_PUBLIC_PATH,
  REMOVE_BACKGROUND_RESOURCE_KEYS,
  REMOVE_BACKGROUND_STALL_MS,
} from './removeBackgroundModelSource'

// 抠图资源（isnet_quint8 模型 44.3MB + ort wasm 11.8MB）按需拉取：首次真正抠图时才下载，
// 从 Nomi 自己的镜像拉（removeBackgroundModelSource.ts 说了为什么）。
// 启动期不预热——绝大多数会话根本不抠图，却要为它付一次 ~56MB 下载 + ONNX session 构建。
// 代价转嫁给「第一次点抠图」，所以下载这一段必须对用户可见、有一条总进度、卡住会停（removeBackgroundDownload.ts）。
type WorkerRequest = { id: number; type: 'remove'; blob: Blob }

type WorkerResponse =
  | { id: number; type: 'done'; blob?: Blob }
  | { id: number; type: 'progress'; key: string; current: number; total: number }
  | { id: number; type: 'error'; error: string; reason: RemoveBackgroundFailure }

const workerScope = self as unknown as {
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<WorkerRequest>) => void,
  ) => void
  postMessage: (message: WorkerResponse) => void
  fetch: typeof fetch
}

// 当前正在处理的请求 id。progress 回调必须转发给「此刻这一次抠图」，见下面 CONFIG 的说明。
let activeRequestId: number | null = null

// 整个 worker 只用这一个 config 对象，progress 是一个稳定函数、内部再查当前请求 id。
//
// 为什么不能每次请求新建一个带 id 闭包的 config（那是最直觉的写法，也是原本的写法）：
// @imgly 的 init 是 memoize(initInference, (config) => JSON.stringify(config))，
// 而 JSON.stringify 会把函数字段整个丢掉 —— 于是每次请求的 memo key 完全相同，
// init 永远返回**第一次**那个 config，removeBackground 内部用的也是它
// （index.mjs:5335 `const { config } = await init(configuration)`，之后所有
// config.progress(...) 都打在第一次的闭包上）。结果：第二次及以后的抠图，
// 进度全部回流到早已结束的第一次请求，用户那边一条进度都收不到，整段等待没有任何反馈。
// 走查实测：第二次抠图 0 次回调。
// 保持 config 恒等还有一个附带好处——memo key 稳定，不会因 config 变形而重建 ONNX session。
const CONFIG: Config = {
  device: 'cpu',
  model: REMOVE_BACKGROUND_MODEL,
  publicPath: REMOVE_BACKGROUND_PUBLIC_PATH,
  output: {
    format: 'image/png',
    quality: 1,
  },
  progress: (key, current, total) => {
    if (activeRequestId === null) return
    // 下载这一段由下面的字节计数报（一条总进度）；@imgly 按资源各报各的那几条不再往外发。
    if (key.startsWith('fetch:')) return
    workerScope.postMessage({ id: activeRequestId, type: 'progress', key, current, total })
  },
}

// 下载段：字节级总进度 + 卡住判定。@imgly 在 worker 里用全局 fetch 拉镜像上的文件，所以在这里换掉它。
const download = createDownloadTracker({
  publicPath: REMOVE_BACKGROUND_PUBLIC_PATH,
  resourceKeys: REMOVE_BACKGROUND_RESOURCE_KEYS,
  stallMs: REMOVE_BACKGROUND_STALL_MS,
  now: () => Date.now(),
  baseFetch: workerScope.fetch.bind(self),
  onProgress: ({ received, total }) => {
    if (activeRequestId === null) return
    workerScope.postMessage({ id: activeRequestId, type: 'progress', key: 'fetch:all', current: received, total })
  },
})
workerScope.fetch = download.fetch as typeof fetch
setInterval(() => { download.checkStall() }, 2_000)

async function handleRequest(request: WorkerRequest): Promise<void> {
  try {
    activeRequestId = request.id
    download.reset()
    const blob = await imglyRemoveBackground(request.blob, CONFIG)
    workerScope.postMessage({ id: request.id, type: 'done', blob })
  } catch (error) {
    workerScope.postMessage({
      id: request.id,
      type: 'error',
      error: error instanceof Error && error.message ? error.message : 'Remove background failed',
      reason: download.failure() ?? 'failed',
    })
  } finally {
    activeRequestId = null
  }
}

// 串行执行：@imgly 的 session 是单例，且 progress 只能归属一个「当前请求」。
// 并发跑两次会让两条进度互相串台（后者把 activeRequestId 抢走，前者的进度记到后者头上）。
// 排队执行既避免串台，也避免同一个 ONNX session 被并发复用。
let queue: Promise<void> = Promise.resolve()

workerScope.addEventListener('message', (event) => {
  const request = event.data
  queue = queue.then(() => handleRequest(request))
})

export {}
