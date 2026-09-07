/**
 * 「提取深度」—— 渲染层编排（这次运行的主循环住在这里）。
 *
 * 为什么编排在渲染层：推理必须跑在有 WebGPU 的渲染进程里，主进程只提供它做不到的那几段
 * （抽帧 / 权重下载 / 合成落盘）。所以这里拿着循环，主进程那五个原语是被调的一方，
 * 取消只有一个方向。见 electron/video/depthVideoJob.ts 的文件头。
 *
 * 依赖全部注入（bridge / worker 工厂 / 时钟），因此整条编排——含取消时机、进度节奏、
 * 失败分类——不需要 GPU、不需要 Electron 就能单测。
 */
import {
  estimateVideoDepthEtaSeconds,
  initialVideoDepthRunState,
  nextVideoDepthRunState,
  type VideoDepthErrorCode,
  type VideoDepthRunState,
} from '../../../../electron/shared/canvas/videoDepthRun'
import { VIDEO_DEPTH_RECIPE } from '../../../../electron/shared/canvas/videoDepth'
import { runVideoDepthBatches } from './videoDepthBatchRunner'
import {
  VIDEO_DEPTH_BATCH_FRAMES,
  newVideoDepthRequestId,
  type VideoDepthWorkerRequest,
  type VideoDepthWorkerResponse,
} from './workerProtocol'

/** worker 的最小可注入表面：一个收请求、回一条应答的通道。 */
export type VideoDepthWorkerChannel = {
  send: (request: VideoDepthWorkerRequest, transfer?: Transferable[]) => Promise<VideoDepthWorkerResponse>
  cancel: () => void
  dispose: () => void
}

export type VideoDepthBridge = {
  prepare: (payload: { projectId: string; nodeId: string; sourceUrl: string }) => Promise<{
    jobId: string
    totalFrames: number
    outWidth: number
    outHeight: number
    depthModelUrl: string
    ortWasmBaseUrl: string
  }>
  readFrames: (payload: { jobId: string; firstIndex: number; count: number }) => Promise<{ frames: Uint8Array[] }>
  writeFrames: (payload: { jobId: string; frames: Uint8Array[] }) => Promise<{ ok: true }>
  finish: (payload: { jobId: string }) => Promise<{ url: string; assetId?: string; frames: number }>
  cancel: (payload: { jobId: string }) => Promise<{ ok: true }>
}

export type VideoDepthRunInput = {
  projectId: string
  nodeId: string
  sourceUrl: string
}

export type VideoDepthRunDeps = {
  bridge: VideoDepthBridge
  createWorker: () => VideoDepthWorkerChannel
  onState: (state: VideoDepthRunState) => void
  /** 取消探针：编排在每批之间问一次。 */
  shouldCancel: () => boolean
  now?: () => number
  /**
   * 每批回传**一张**最新的裸帧，给界面画「它现在看到的是什么」。
   *
   * 纯观察口：不参与编排、不影响任何一次收场，实现里抛了也不该让这次运行失败
   * （所以调用点包了 try）。形状与 worker 回传的 rawFrames 逐字对应；
   * 一批 32 帧才给一张，节奏由批大小决定，不另设节流器（两个节流器 = 两份真相）。
   */
  onPreviewFrame?: (frame: { bytes: Uint8Array; width: number; height: number }) => void
}

function failureFrom(error: unknown): { code: VideoDepthErrorCode; message: string; retryable: boolean } {
  const raw = error as { code?: unknown; message?: unknown; retryable?: unknown } | null
  const code = typeof raw?.code === 'string' ? raw.code : ''
  // worker 的失败是一条**普通对象**应答（不是 Error 实例）——`error instanceof Error` 在它上面是 false，
  // 直接 String() 会印出 "[object Object]"，把唯一的线索洗掉。所以先读它自带的 message。
  const message =
    typeof raw?.message === 'string' && raw.message ? raw.message : error instanceof Error ? error.message : String(error)
  // worker 的失败码与运行阶段的失败码是同一族词表的两半，这里做一次显式映射，
  // 不用 `as` 硬转——硬转会让 worker 新增一个码时静默漏进 UI。
  if (code === 'webgpu-unavailable') return { code: 'webgpu-unavailable', message, retryable: false }
  if (code === 'model-unavailable') return { code: 'model-download-failed', message, retryable: true }
  if (
    code === 'source-unavailable' ||
    code === 'source-unmeasurable' ||
    code === 'over-budget' ||
    code === 'model-download-failed' ||
    code === 'media-failed' ||
    code === 'already-running'
  ) {
    return { code, message, retryable: raw?.retryable !== false }
  }
  return { code: 'inference-failed', message, retryable: true }
}

/**
 * 跑完一次深度处理。返回终态（done / failed / cancelled）——**不抛**：
 * 每一种收场都要在节点上留下一句能行动的话，抛出去只会被上层压成「处理失败」。
 */
export async function runVideoDepth(input: VideoDepthRunInput, deps: VideoDepthRunDeps): Promise<VideoDepthRunState> {
  const now = deps.now ?? (() => Date.now())
  let state = initialVideoDepthRunState('')
  const advance = (event: Parameters<typeof nextVideoDepthRunState>[1]): void => {
    state = nextVideoDepthRunState(state, event)
    deps.onState(state)
  }

  advance({ kind: 'enter', phase: 'downloading' })

  let prepared: Awaited<ReturnType<VideoDepthBridge['prepare']>>
  try {
    prepared = await deps.bridge.prepare({
      projectId: input.projectId,
      nodeId: input.nodeId,
      sourceUrl: input.sourceUrl,
    })
  } catch (error) {
    advance({ kind: 'fail', ...failureFrom(error) })
    return state
  }
  state = { ...state, jobId: prepared.jobId }

  const worker = deps.createWorker()
  const cancelEverything = async (): Promise<void> => {
    worker.cancel()
    try {
      await deps.bridge.cancel({ jobId: prepared.jobId })
    } catch {
      /* 主进程那侧已经收摊了 */
    }
  }

  try {
    let firstFrameAt = 0
    const result = await runVideoDepthBatches(
      prepared.totalFrames,
      {
        warm: async () => {
          advance({ kind: 'enter', phase: 'warming' })
          const response = await worker.send({
            kind: 'warm',
            requestId: newVideoDepthRequestId(),
            depthModelUrl: prepared.depthModelUrl,
            ortWasmBaseUrl: prepared.ortWasmBaseUrl,
            smoothingAlpha: VIDEO_DEPTH_RECIPE.temporalSmoothing,
          })
          if (response.kind === 'error') throw response
          advance({ kind: 'enter', phase: 'processing' })
          firstFrameAt = now()
        },
        processBatch: async ({ batchId, firstFrameIndex, frameCount }) => {
          const { frames } = await deps.bridge.readFrames({
            jobId: prepared.jobId,
            firstIndex: firstFrameIndex,
            count: frameCount,
          })
          const buffers = frames.map((frame) =>
            frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) as ArrayBuffer,
          )
          const response = await worker.send(
            {
              kind: 'processBatch',
              requestId: newVideoDepthRequestId(),
              batchId,
              firstFrameIndex,
              frames: buffers,
              depthDirection: VIDEO_DEPTH_RECIPE.depthDirection,
              outWidth: prepared.outWidth,
              outHeight: prepared.outHeight,
            },
            buffers,
          )
          if (response.kind === 'error') throw response
          if (response.kind !== 'batchResult') return
          const latest = response.rawFrames[response.rawFrames.length - 1]
          if (deps.onPreviewFrame && latest) {
            // 拷一份再交出去：下一行的 writeFrames 会把同一批帧包成 Uint8Array 走 IPC，
            // 观察口拿着的若是同一块内存，两边的生命周期就绑在一起了。
            try {
              deps.onPreviewFrame({
                bytes: new Uint8Array(latest.slice(0)),
                width: prepared.outWidth,
                height: prepared.outHeight,
              })
            } catch {
              /* 预览是锦上添花，坏了不该毁掉这次处理 */
            }
          }
          await deps.bridge.writeFrames({
            jobId: prepared.jobId,
            frames: response.rawFrames.map((buffer) => new Uint8Array(buffer)),
          })
        },
        onProgress: (doneFrames, totalFrames) => {
          advance({
            kind: 'frames',
            doneFrames,
            totalFrames,
            etaSeconds: estimateVideoDepthEtaSeconds({
              doneFrames,
              totalFrames,
              elapsedMsSinceFirstFrame: now() - firstFrameAt,
            }),
          })
        },
        shouldCancel: deps.shouldCancel,
      },
      VIDEO_DEPTH_BATCH_FRAMES,
    )

    if (!result.ok) {
      await cancelEverything()
      if (result.reason === 'cancelled') advance({ kind: 'cancel' })
      else advance({ kind: 'fail', ...failureFrom(result.error) })
      return state
    }

    advance({ kind: 'enter', phase: 'encoding' })
    const finished = await deps.bridge.finish({ jobId: prepared.jobId })
    advance({ kind: 'done', url: finished.url, assetId: finished.assetId })
    return state
  } catch (error) {
    await cancelEverything()
    advance({ kind: 'fail', ...failureFrom(error) })
    return state
  } finally {
    worker.dispose()
  }
}

/**
 * 真实 worker 通道：一条 request 对一条 response，按 requestId 配对。
 * 串行由编排保证（一次只有一个 in-flight），这里只负责把 `onerror` 也变成一条失败应答——
 * 否则 worker 加载失败会让 `send` 永远挂着，界面停在「预热中」不动。
 */
export function createVideoDepthWorkerChannel(): VideoDepthWorkerChannel {
  const worker = new Worker(new URL('./videoDepth.worker.ts', import.meta.url), {
    name: 'nomi-video-depth',
    type: 'module',
  })
  const pending = new Map<string, (response: VideoDepthWorkerResponse) => void>()

  worker.addEventListener('message', (event: MessageEvent<VideoDepthWorkerResponse>) => {
    const response = event.data
    const resolve = pending.get(response.requestId)
    if (!resolve) return
    pending.delete(response.requestId)
    resolve(response)
  })
  worker.addEventListener('error', (event) => {
    const message = event.message || 'video depth worker failed to load'
    for (const [requestId, resolve] of pending) {
      resolve({ kind: 'error', requestId, code: 'inference-failed', message, retryable: true })
    }
    pending.clear()
  })

  return {
    send: (request, transfer) =>
      new Promise<VideoDepthWorkerResponse>((resolve) => {
        pending.set(request.requestId, resolve)
        worker.postMessage(request, transfer ?? [])
      }),
    cancel: () => {
      worker.postMessage({ kind: 'cancel', requestId: newVideoDepthRequestId() })
    },
    dispose: () => {
      pending.clear()
      worker.terminate()
    },
  }
}
