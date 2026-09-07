import { describe, expect, it, vi } from 'vitest'
import { runVideoDepth, type VideoDepthBridge, type VideoDepthWorkerChannel } from './videoDepthClient'
import { VIDEO_DEPTH_RECIPE } from '../../../../electron/shared/canvas/videoDepth'
import type { VideoDepthRunState } from '../../../../electron/shared/canvas/videoDepthRun'
import type { VideoDepthWorkerResponse } from './workerProtocol'

function fakeBridge(overrides: Partial<VideoDepthBridge> = {}, totalFrames = 70): {
  bridge: VideoDepthBridge
  written: number[]
  cancelled: string[]
} {
  const written: number[] = []
  const cancelled: string[] = []
  const bridge: VideoDepthBridge = {
    prepare: async () => ({
      jobId: 'job-1',
      totalFrames,
      outWidth: 518,
      outHeight: 290,
      depthModelUrl: 'nomi-local://model/depth.onnx',
      ortWasmBaseUrl: 'nomi-local://runtime/ort/',
    }),
    readFrames: async ({ count }) => ({ frames: Array.from({ length: count }, () => new Uint8Array([1, 2, 3])) }),
    writeFrames: async ({ frames }) => {
      written.push(frames.length)
      return { ok: true as const }
    },
    finish: async () => ({ url: 'nomi-local://asset/p/depth.mp4', assetId: 'a1', frames: totalFrames }),
    cancel: async ({ jobId }) => {
      cancelled.push(jobId)
      return { ok: true as const }
    },
    ...overrides,
  }
  return { bridge, written, cancelled }
}

function fakeWorker(respond?: (request: unknown) => VideoDepthWorkerResponse): {
  channel: VideoDepthWorkerChannel
  requests: Array<Record<string, unknown>>
  disposed: () => boolean
} {
  const requests: Array<Record<string, unknown>> = []
  let disposed = false
  const channel: VideoDepthWorkerChannel = {
    send: async (request) => {
      requests.push(request as unknown as Record<string, unknown>)
      if (respond) return respond(request)
      const requestId = (request as { requestId: string }).requestId
      if (request.kind === 'warm') return { kind: 'ready', requestId }
      return {
        kind: 'batchResult',
        requestId,
        batchId: (request as { batchId: string }).batchId,
        rawFrames: (request as { frames: ArrayBuffer[] }).frames.map(() => new ArrayBuffer(4)),
      }
    },
    cancel: () => {},
    dispose: () => {
      disposed = true
    },
  }
  return { channel, requests, disposed: () => disposed }
}

function collect(): { states: VideoDepthRunState[]; onState: (s: VideoDepthRunState) => void } {
  const states: VideoDepthRunState[] = []
  return { states, onState: (s) => states.push(s) }
}

const input = {
  projectId: 'p1',
  nodeId: 'n1',
  sourceUrl: 'nomi-local://asset/p1/clip.mp4',
}

describe('runVideoDepth', () => {
  it('walks prepare → warm → batches → finish and lands a video asset', async () => {
    const { bridge, written } = fakeBridge()
    const { channel, requests } = fakeWorker()
    const { states, onState } = collect()

    const final = await runVideoDepth(input, {
      bridge,
      createWorker: () => channel,
      onState,
      shouldCancel: () => false,
    })

    expect(final.phase).toBe('done')
    expect(final.result?.url).toBe('nomi-local://asset/p/depth.mp4')
    // 70 帧 / 32 一批 = 32 + 32 + 6
    expect(written).toEqual([32, 32, 6])
    expect(states.map((s) => s.phase)).toEqual([
      'downloading',
      'warming',
      'processing',
      'processing',
      'processing',
      'processing',
      'encoding',
      'done',
    ])
    expect(requests[0].kind).toBe('warm')
  })

  it('warms with the one recipe and nothing else — no mode, no pose runtime, no frame clock', async () => {
    // 这条断言是骨架链的墓碑。它曾经带着 mode / poseWasmBaseUrl / poseModelUrl /
    // maxPeople / frameIntervalMs 五个字段过去，全部只为骨架而存在。
    const { bridge } = fakeBridge()
    const { channel, requests } = fakeWorker()
    await runVideoDepth(input, { bridge, createWorker: () => channel, onState: () => {}, shouldCancel: () => false })

    const warm = requests[0]
    expect(warm.kind).toBe('warm')
    expect(warm.depthModelUrl).toBe('nomi-local://model/depth.onnx')
    expect(warm.smoothingAlpha).toBe(VIDEO_DEPTH_RECIPE.temporalSmoothing)
    for (const gone of ['mode', 'poseWasmBaseUrl', 'poseModelUrl', 'maxPeople', 'frameIntervalMs']) {
      expect(warm).not.toHaveProperty(gone)
    }
    // 每一批也只带灰度方向，不再带 mode。
    expect(requests[1].depthDirection).toBe(VIDEO_DEPTH_RECIPE.depthDirection)
    expect(requests[1]).not.toHaveProperty('mode')
  })

  it('reports an ETA only after enough frames were measured, and derives it from the clock', async () => {
    const { bridge } = fakeBridge({}, 200)
    const { channel } = fakeWorker()
    const { states, onState } = collect()
    let clock = 1_000
    await runVideoDepth(input, {
      bridge,
      createWorker: () => channel,
      onState,
      shouldCancel: () => false,
      now: () => {
        clock += 1_000
        return clock
      },
    })
    const frameStates = states.filter((s) => s.progress?.kind === 'frames')
    expect(frameStates.length).toBeGreaterThan(1)
    for (const state of frameStates) {
      if (state.progress?.kind !== 'frames') throw new Error('unreachable')
      expect(state.progress.etaSeconds).not.toBeUndefined()
    }
  })

  it('cancels the main-process job when the probe flips mid-run', async () => {
    const { bridge, cancelled } = fakeBridge({}, 200)
    const { channel, disposed } = fakeWorker()
    let batches = 0
    const final = await runVideoDepth(input, {
      bridge,
      createWorker: () => channel,
      onState: () => {},
      shouldCancel: () => {
        batches += 1
        return batches > 3
      },
    })
    expect(final.phase).toBe('cancelled')
    expect(cancelled).toEqual(['job-1'])
    expect(disposed()).toBe(true)
  })

  it('surfaces webgpu-unavailable as its own non-retryable code, never as a generic failure', async () => {
    const { bridge } = fakeBridge()
    const { channel } = fakeWorker((request) => ({
      kind: 'error',
      requestId: (request as { requestId: string }).requestId,
      code: 'webgpu-unavailable',
      message: 'no adapter',
      retryable: false,
    }))
    const final = await runVideoDepth(input, {
      bridge,
      createWorker: () => channel,
      onState: () => {},
      shouldCancel: () => false,
    })
    expect(final.phase).toBe('failed')
    expect(final.error).toEqual({ code: 'webgpu-unavailable', message: 'no adapter', retryable: false })
  })

  it('keeps the main-process refusal code when prepare rejects', async () => {
    const overBudget = Object.assign(new Error('too big'), { code: 'over-budget', retryable: false })
    const { bridge } = fakeBridge({ prepare: () => Promise.reject(overBudget) })
    const { channel } = fakeWorker()
    const createWorker = vi.fn(() => channel)
    const final = await runVideoDepth(input, {
      bridge,
      createWorker,
      onState: () => {},
      shouldCancel: () => false,
    })
    expect(final.phase).toBe('failed')
    expect(final.error?.code).toBe('over-budget')
    // prepare 就失败了就不该起 worker（起了等于白白加载 50MB 模型）。
    expect(createWorker).not.toHaveBeenCalled()
  })

  it('cancels the job and disposes the worker when encoding fails', async () => {
    const { bridge, cancelled } = fakeBridge({
      finish: () => Promise.reject(Object.assign(new Error('ffmpeg exploded'), { code: 'media-failed' })),
    })
    const { channel, disposed } = fakeWorker()
    const final = await runVideoDepth(input, {
      bridge,
      createWorker: () => channel,
      onState: () => {},
      shouldCancel: () => false,
    })
    expect(final.phase).toBe('failed')
    expect(final.error?.code).toBe('media-failed')
    expect(cancelled).toEqual(['job-1'])
    expect(disposed()).toBe(true)
  })
})
