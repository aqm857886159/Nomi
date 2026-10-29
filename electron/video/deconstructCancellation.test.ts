// 拆解取消 · 主进程侧（第一刀，2026-10-27；设计卡 docs/plan/2026-10-27-deconstruct-cancel.md）。
//
// 第 1 轮（同日）在这里钉过修前现状：四个时机取消之后，付费调用照样发满报价的 7 行，整次以「成功」收尾。
// 第一刀之后的口径（用户拍板）：
//   ① 点取消之后，不再有新的调用**过付费闸**（= 不再发新的付费调用），也不再新进闸（不扣钱），本机重活不再新起；
//   ② 取消那一刻已经过了付费闸的那几次照常结算：照常回来、结果作废——在途不断开是第二刀（0.25）的事；
//   ③ 取消不是失败：抛 DeconstructCancelledError，零条 *-failed 错误日志，回执记清楚过闸几次、没发几次。
// runTask 的替身照 runtime 的顺序走：[准备] → admission.spendGate（付费闸）→ 发出 → 回来。
// 令牌闸本身（TOKEN_ADMISSION）换成可挂起的替身；包在它外面那层「先看 signal」用的是真的 stoppableAdmission。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  type Held = { release: () => void; fail: (error: unknown) => void }
  const state = {
    /** 每一次子步骤调用：哪一步、参数里带没带 AbortSignal（带了是哪一个）。 */
    calls: [] as Array<{ step: string; signal?: AbortSignal }>,
    /** 此刻挂着没回来的调用（标签 → 放行 / 让它失败）。在途清单就是它的键。 */
    pending: new Map<string, Held>(),
    holdQuote: false,
    holdAudio: false,
    holdFrameOfShot: 0,
    /** runtime 还在准备（还没走到付费闸）。 */
    holdBeforeGate: false,
    /** 付费闸里在等人确认。 */
    holdInGate: false,
    /** 进了令牌闸的调用（= 会扣令牌预算）。 */
    gateEntered: [] as string[],
    /** 过了付费闸、发出去的调用（已发或未知）。 */
    sent: [] as string[],
    /** 发出去以后照常回来的调用（照常结算）。 */
    settled: [] as string[],
  }
  const abortError = () => Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
  const signalOf = (args: unknown[]): AbortSignal | undefined => {
    for (const arg of args) {
      if (arg instanceof AbortSignal) return arg
      if (arg && typeof arg === 'object') {
        const found = Object.values(arg as Record<string, unknown>).find((value) => value instanceof AbortSignal)
        if (found) return found as AbortSignal
      }
    }
    return undefined
  }
  const record = (step: string, args: unknown[]) => { state.calls.push({ step, signal: signalOf(args) }) }
  /**
   * 挂起一步，直到测试放行或让它失败。带 signal 的本机步骤（ffmpeg 子进程）在 abort 时照真的样子被杀：立刻失败。
   * 付费请求不带 signal（第一刀不断开在途），只能等测试放行。
   */
  const hold = <T>(label: string, held: boolean, value: T, signal?: AbortSignal): Promise<T> => {
    if (signal?.aborted) return Promise.reject(abortError())
    if (!held) return Promise.resolve(value)
    return new Promise<T>((resolve, reject) => {
      state.pending.set(label, { release: () => resolve(value), fail: reject })
      signal?.addEventListener('abort', () => { state.pending.delete(label); reject(abortError()) }, { once: true })
    })
  }
  /** 付费调用的标签：读图按帧图认是第几镜，转写就叫 transcribe。 */
  const labelOf = (extras: { referenceImages?: unknown } | undefined): string => {
    const first = Array.isArray(extras?.referenceImages) ? String(extras.referenceImages[0]) : ''
    const shot = /frame-(\d+)\.png/.exec(first)?.[1]
    return shot ? `vision#${shot}` : 'transcribe'
  }
  const optionsSignal = (options: unknown) => (options as { signal?: AbortSignal } | undefined)?.signal
  return { state, record, hold, labelOf, optionsSignal }
})

// 6 镜（切点 2/4/6/8/10 秒，片长 12 秒），有音轨。framesPerShot=1 时第 n 镜在 (2n-1) 秒抽一帧。
vi.mock('../export/mediaProbe', () => ({
  probeMediaMetadata: vi.fn(async (...args: unknown[]) => { h.record('probe', args); return { durationSeconds: 12, hasAudio: true } }),
}))
vi.mock('./detectShotCuts', () => ({
  detectShotCuts: vi.fn(async (...args: unknown[]) => {
    h.record('cuts', args)
    return { cuts: [2, 4, 6, 8, 10].map((seconds) => ({ seconds, score: 0.9 })), coverage: { detectedCuts: 5, keptCuts: 5, appliedThreshold: 0.1, capped: false, coveredSeconds: 10, durationSeconds: 12 } }
  }),
}))
vi.mock('./extractVideoFrame', () => ({
  resolveVideoLocalPath: vi.fn(async (...args: unknown[]) => { h.record('resolve', args); return { filePath: '/isolated/video.mp4', cleanup: () => undefined } }),
  extractVideoFrameToAsset: vi.fn((...args: unknown[]) => {
    h.record('frame', args)
    const shot = Math.floor(Number((args[0] as { which: number }).which) / 2) + 1
    return h.hold(`frame#${shot}`, h.state.holdFrameOfShot === shot, { url: `nomi-local://isolated/frame-${shot}.png` }, h.optionsSignal(args[1]))
  }),
}))
vi.mock('./extractAudioTrack', () => ({
  extractAudioTrack: vi.fn((...args: unknown[]) => {
    h.record('audio', args)
    return h.hold('audio', h.state.holdAudio, { url: 'nomi-local://isolated/audio.mp3', hasAudio: true, durationSeconds: 12 }, h.optionsSignal(args[1]))
  }),
}))
// 两处付费出口：照 runtime 的顺序——[准备] → 付费闸 → 发出 → 挂着等测试放行（在途清单就是这一刻拍的）。
vi.mock('../runtime', () => ({
  runTask: vi.fn(async (payload: { vendor: string; request: { kind: string; extras: Record<string, unknown> } }, admission: { spendGate: (input: unknown) => Promise<void> }) => {
    h.record('runTask', [payload, admission])
    const { request } = payload
    const label = h.labelOf(request.extras)
    await h.hold(`pregate:${label}`, h.state.holdBeforeGate, undefined)
    await admission.spendGate({ grantId: request.extras.grantId, nodeId: request.extras.nodeId, projectId: request.extras.projectId, vendorKey: payload.vendor, modelKey: request.extras.modelKey, parameters: request.extras })
    h.state.sent.push(label)
    const value = await h.hold(label, true, label === 'transcribe'
      ? { raw: { text: 'hello', segments: [{ start: 0, end: 1, text: 'hello' }] } }
      : { raw: { choices: [{ message: { content: '{"shotSize":"中景","visual":"a door"}' } }] } })
    h.state.settled.push(label)
    return value
  }),
}))
// 令牌闸的替身：记「进了闸」，按需挂起（= 闸里在等人确认）。外面那层判 signal 的 stoppableAdmission 是真的。
vi.mock('../tasks/taskSpend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tasks/taskSpend')>()
  return {
    ...actual,
    TOKEN_ADMISSION: {
      spendGate: async (input: { parameters?: { referenceImages?: unknown } }) => {
        const label = h.labelOf(input.parameters)
        h.state.gateEntered.push(label)
        await h.hold(`gate:${label}`, h.state.holdInGate, undefined)
      },
    },
  }
})
vi.mock('./deconstructVisionLeg', () => ({ resolveVisionLeg: () => ({ ok: true, vendor: 'vision-vendor', modelKey: 'vision-model' }) }))
vi.mock('../catalog/executableModel', () => ({
  findExecutableModel: () => ({ vendor: { key: 'vision-vendor' }, model: { modelKey: 'vision-model' } }),
  findExecutableModelForMode: () => ({ vendor: { key: 'stt-vendor' }, model: { modelKey: 'stt-model' } }),
  findExecutableModelInMode: () => ({ vendor: { key: 'stt-vendor' }, model: { modelKey: 'stt-model' } }),
}))
vi.mock('../catalog/catalogStore', () => ({ readCatalog: () => ({ mappings: [] }) }))
vi.mock('../settings/vendorPreferenceSettings', () => ({ readVendorPreferenceSettings: () => ({ orderedVendorKeys: [] }) }))
vi.mock('../logging/logger', () => ({ logError: vi.fn(), logInfo: vi.fn(), logWarn: vi.fn() }))

import { deconstructVideo, type DeconstructSpendPlan } from './deconstructVideo'
import { logError, logInfo } from '../logging/logger'
// 转写腿在发请求前动态 import 进度总线：静态装进模块缓存，「让出事件循环」才拍得到稳定的在途清单。
import '../localSpeech/localSpeechProgressBus'

/** 让编排把能走的都走完、停在下一个挂起点上（不靠墙钟：只让出事件循环）。 */
async function letOrchestrationRun(): Promise<void> {
  for (let round = 0; round < 30; round += 1) await new Promise<void>((resolve) => setImmediate(resolve))
}

const inFlight = () => [...h.state.pending.keys()].sort()
const countOf = (step: string) => h.state.calls.filter((call) => call.step === step).length
const failureLogs = () => vi.mocked(logError).mock.calls.map(([, event]) => String(event)).filter((event) => event.endsWith('-failed'))
const cancelReceipt = () => vi.mocked(logInfo).mock.calls.find(([, event]) => event === 'deconstruct.cancelled')?.[2]

function start(signal: AbortSignal) {
  let plan: DeconstructSpendPlan | undefined
  const authorizeSpend = vi.fn(async (quoted: DeconstructSpendPlan) => {
    plan = quoted
    return h.hold('quote', h.state.holdQuote, 'grant-isolated')
  })
  const phases: number[] = []
  let settled = false
  const done = deconstructVideo(
    { videoUrl: 'nomi-local://isolated/video.mp4', projectId: 'isolated-project', nodeId: 'table-1', requestId: 'request-1', framesPerShot: 1 },
    { authorizeSpend, signal, onPhase: (phase) => { phases.push(phase) } },
  ).then((result) => ({ ok: true as const, result }), (error: unknown) => ({ ok: false as const, error: error as Error })).finally(() => { settled = true })
  return { done, plan: () => plan, settled: () => settled, authorizeSpend, phases }
}

/** 取消之后把挂着的全部放行，直到这次调用自己收尾。 */
async function releaseUntilSettled(settled: () => boolean): Promise<void> {
  for (let round = 0; round < 40 && !settled(); round += 1) {
    for (const [label, held] of [...h.state.pending]) { h.state.pending.delete(label); held.release() }
    await letOrchestrationRun()
  }
}

function take(label: string) {
  const held = h.state.pending.get(label)
  if (!held) throw new Error(`expected ${label} to be in flight, in flight: ${inFlight().join(', ')}`)
  h.state.pending.delete(label)
  return held
}

type Timing = {
  name: string
  hold: Partial<Pick<typeof h.state, 'holdQuote' | 'holdAudio' | 'holdFrameOfShot' | 'holdBeforeGate' | 'holdInGate'>>
  reach: () => Promise<void>
  inFlightAtCancel: string[]
  /** 取消那一刻过了付费闸的次数（之后不许再涨）。 */
  sentAtCancel: number
  /** 取消那一刻进过令牌闸的次数（之后不许再涨 = 不再扣钱）。 */
  gateEnteredAtCancel: number
  transcribe: 'none' | 'stopped' | 'settled'
}

const releaseFirstShot = async () => { await letOrchestrationRun(); take('vision#1').release(); await letOrchestrationRun() }

const TIMINGS: Timing[] = [
  { name: '切点刚出、报价待定（还没铸令牌）', hold: { holdQuote: true }, reach: letOrchestrationRun,
    inFlightAtCancel: ['quote'], sentAtCancel: 0, gateEnteredAtCancel: 0, transcribe: 'none' },
  { name: '取音轨中（读图已并发 4 镜、都已过付费闸）', hold: { holdAudio: true }, reach: letOrchestrationRun,
    inFlightAtCancel: ['audio', 'vision#1', 'vision#2', 'vision#3', 'vision#4'], sentAtCancel: 4, gateEnteredAtCancel: 4, transcribe: 'stopped' },
  { name: '第一镜读完（第五镜已起跑、转写在途）', hold: {}, reach: releaseFirstShot,
    inFlightAtCancel: ['transcribe', 'vision#2', 'vision#3', 'vision#4', 'vision#5'], sentAtCancel: 6, gateEnteredAtCancel: 6, transcribe: 'settled' },
  { name: '下一镜即将起跑（第五镜抽帧中、读图未发）', hold: { holdFrameOfShot: 5 }, reach: releaseFirstShot,
    inFlightAtCancel: ['frame#5', 'transcribe', 'vision#2', 'vision#3', 'vision#4'], sentAtCancel: 5, gateEnteredAtCancel: 5, transcribe: 'settled' },
  { name: '读图与转写都还没进付费闸（runtime 还在准备）', hold: { holdBeforeGate: true }, reach: letOrchestrationRun,
    inFlightAtCancel: ['pregate:transcribe', 'pregate:vision#1', 'pregate:vision#2', 'pregate:vision#3', 'pregate:vision#4'], sentAtCancel: 0, gateEnteredAtCancel: 0, transcribe: 'stopped' },
  { name: '付费闸里等人确认（确认回来时已经取消）', hold: { holdInGate: true }, reach: letOrchestrationRun,
    inFlightAtCancel: ['gate:transcribe', 'gate:vision#1', 'gate:vision#2', 'gate:vision#3', 'gate:vision#4'], sentAtCancel: 0, gateEnteredAtCancel: 5, transcribe: 'stopped' },
]

beforeEach(() => {
  h.state.calls.length = 0
  h.state.pending.clear()
  h.state.gateEntered.length = 0
  h.state.sent.length = 0
  h.state.settled.length = 0
  Object.assign(h.state, { holdQuote: false, holdAudio: false, holdFrameOfShot: 0, holdBeforeGate: false, holdInGate: false })
  vi.mocked(logError).mockClear()
  vi.mocked(logInfo).mockClear()
})

describe('第一刀：点取消之后不再发新的付费调用，已经发出去的那一次照常结算', () => {
  it.each(TIMINGS)('$name', async (timing) => {
    Object.assign(h.state, timing.hold)
    const controller = new AbortController()
    const run = start(controller.signal)
    await timing.reach()

    // 取消那一刻：在途清单、过闸与进闸次数（与第 1 轮同一套确定性挂起点，不靠墙钟）。
    expect(inFlight()).toEqual(timing.inFlightAtCancel)
    expect(h.state.sent).toHaveLength(timing.sentAtCancel)
    expect(h.state.gateEntered).toHaveLength(timing.gateEnteredAtCancel)
    const framesAtCancel = countOf('frame')
    const audioAtCancel = countOf('audio')
    const phasesAtCancel = run.phases.length

    controller.abort()
    await releaseUntilSettled(run.settled)
    const outcome = await run.done

    // ① 取消之后一次都没有新过付费闸，也没有新进闸（不扣钱）；本机重活不再新起；进度不再往上报。
    expect(run.plan()?.lines).toHaveLength(7)
    expect(h.state.sent).toHaveLength(timing.sentAtCancel)
    expect(h.state.gateEntered).toHaveLength(timing.gateEnteredAtCancel)
    expect(countOf('frame')).toBe(framesAtCancel)
    expect(countOf('audio')).toBe(audioAtCancel)
    expect(run.phases).toHaveLength(phasesAtCancel)
    // ② 取消那一刻已经过了付费闸的那几次照常结算：照常回来，结果作废（不交出去）。
    expect([...h.state.settled].sort()).toEqual([...h.state.sent].sort())
    // ③ 取消不是失败：专用错误、零条 *-failed 错误日志、回执记清楚过闸几次（已发或未知）、没发几次。
    expect(outcome.ok).toBe(false)
    expect(!outcome.ok && outcome.error.name).toBe('DeconstructCancelledError')
    expect(failureLogs()).toEqual([])
    expect(cancelReceipt()).toEqual({
      projectId: 'isolated-project', nodeId: 'table-1', requestId: 'request-1',
      quotedCalls: 7, sentOrUnknown: timing.sentAtCancel, neverSent: 7 - timing.sentAtCancel, transcribe: timing.transcribe,
    })
  })

  it('在途的转写在取消之后失败（本机转写报 LocalSpeechError）：按「已停」收，不记转写失败、不认成 local-speech', async () => {
    const controller = new AbortController()
    const run = start(controller.signal)
    await letOrchestrationRun()
    const transcription = take('transcribe')
    controller.abort()
    transcription.fail(Object.assign(new Error('local speech stopped'), { name: 'LocalSpeechError' }))
    await releaseUntilSettled(run.settled)
    const outcome = await run.done

    expect(!outcome.ok && outcome.error.name).toBe('DeconstructCancelledError')
    expect(failureLogs()).toEqual([])
    expect(cancelReceipt()).toMatchObject({ sentOrUnknown: 5, transcribe: 'stopped' })
  })

  it('一开始就给一个已 abort 的 signal：每一步都是 0 次，连报价都不出', async () => {
    const controller = new AbortController()
    controller.abort()
    const run = start(controller.signal)
    await letOrchestrationRun()
    const outcome = await run.done

    expect(!outcome.ok && outcome.error.name).toBe('DeconstructCancelledError')
    // 全集断言，不列步骤名：编排以后新加一个被 mock 的子步骤（再抽一张缩略图之类），不判 signal 就会落进 calls，这里自动红。
    expect(h.state.calls).toEqual([])
    expect(run.authorizeSpend).not.toHaveBeenCalled()
    expect(h.state.gateEntered).toEqual([])
    expect(run.phases).toEqual([])
    expect(cancelReceipt()).toMatchObject({ quotedCalls: 0, sentOrUnknown: 0, neverSent: 0, transcribe: 'none' })
  })

  it('不取消：照常发满报价的 7 行、全部过闸、结果交出去；同一个 signal 到达每一步本机重活，付费请求不带 signal', async () => {
    const controller = new AbortController()
    const run = start(controller.signal)
    await releaseUntilSettled(run.settled)
    const outcome = await run.done

    expect(outcome.ok).toBe(true)
    expect(outcome.ok && outcome.result.shots).toHaveLength(6)
    expect(h.state.sent).toHaveLength(7)
    expect(h.state.gateEntered).toHaveLength(7)
    expect(cancelReceipt()).toBeUndefined()
    for (const step of ['resolve', 'probe', 'cuts', 'frame', 'audio']) {
      const calls = h.state.calls.filter((call) => call.step === step)
      expect(calls.length).toBeGreaterThan(0)
      expect(calls.every((call) => call.signal === controller.signal)).toBe(true)
    }
    // 第一刀不把 signal 交给 runtime（在途不断开）：runTask 只拿到包了「先看 signal」那一层的 admission。
    expect(h.state.calls.filter((call) => call.step === 'runTask').every((call) => call.signal === undefined)).toBe(true)
  })
})
