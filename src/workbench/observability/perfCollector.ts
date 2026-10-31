// 「界面流畅度」采集：只挂浏览器标准的两个观察者，不自写剖析器。
//   · Event Timing（PerformanceObserver 'event'）——和 INP 同口径：点击 / 按键到下一帧画出来的耗时；
//   · Long Animation Frames（'long-animation-frame'）——超过 50ms 的长帧。
// 观察者回调里只做 O(1) 的记录；分位、分桶、发出去全在空闲时 / 会话边界做。
// 采集永远在跑、数据只在内存里：发不发由主进程按「用户同意的告知范围」决定
// （electron/telemetry/telemetryEvents.ts 的 TELEMETRY_EVENT_MIN_SCOPE），反馈面板则是用户点了才带。
// 观察者全进程只注册一次（`started` 守卫），页面 / 路由切换不会重复注册。
import { getDesktopBridge } from '../../desktop/bridge'
import {
  countBucket, cpuCoresBucket, interactionBucket, longFramesPerMinBucket, longestFrameBucket, memoryBucket, observedMinutesBucket, percentile,
  type PerfSummaryProps,
} from '../../../electron/shared/contracts/perfTelemetry'
import {
  STALL_RENDERER_FRAME_MIN_MS, STALL_REPORT_MAX_FRAMES, STALL_REPORT_MIN_GAP_MS, STALL_SCENE_POLL_MS,
  type StallReport, type StallReportFrame, type StallScene,
} from '../../../electron/shared/contracts/stallTimeline'

export type PerfScene = { page: PerfSummaryProps['page']; nodes: number; imageNodes: number; generating: boolean }

type ObserverLike = { observe(options: Record<string, unknown>): void; disconnect(): void }
export type PerfCollectorEnv = {
  createObserver(type: 'event' | 'long-animation-frame', onEntries: (entries: PerformanceEntry[]) => void, options: Record<string, unknown>): ObserverLike | null
  now(): number
  hardwareConcurrency: number | undefined
  deviceMemory: number | undefined
  onHidden(listener: () => void): () => void
  setInterval(callback: () => void, ms: number): () => void
  whenIdle(callback: () => void): void
  /** 发出去（桥）。返回值不关心。 */
  send(props: PerfSummaryProps): void
  /** 页面时钟（performance.now 口径）→ 墙钟毫秒，给卡顿时间线标时刻。 */
  epochOf(performanceTime: number): number
  /** 卡顿时间线：单向报给主进程（只写本机文件，不进遥测）。 */
  sendStall(report: StallReport): void
}

/** 一个窗口最多记多少个不同的交互；超过就丢最老的。内存上限 ≈ 几十 KB。 */
const MAX_INTERACTIONS = 1000
/** Event Timing 允许的最小阈值（16ms，且以 8ms 取整）；越小样本越全，p75 越不偏向慢的那几次。 */
const EVENT_DURATION_THRESHOLD_MS = 16
/** 短于这个时长的窗口不发（几秒钟的窗口分不出任何东西）。 */
const MIN_WINDOW_MS = 60_000
/** 一直开着不关时，每隔这么久汇总一次，不是每次交互一条。 */
const PERIODIC_FLUSH_MS = 30 * 60_000

export function createPerfCollector(env: PerfCollectorEnv) {
  let started = false
  let windowStart = env.now()
  const interactions = new Map<number, number>()
  let longFrameCount = 0
  let longestFrameMs: number | null = null
  let scene: (() => PerfScene) | null = null
  let observers: ObserverLike[] = []
  let cleanups: Array<() => void> = []
  let supported = { event: false, loaf: false }
  // 卡顿时间线：≥200ms 的长帧挑最长的留一小批，最多每 30 秒发一批；场景只在变了才发。不加观察者、不加 rAF。
  let pendingFrames: StallReportFrame[] = []
  let lastStallReportAt = Number.NEGATIVE_INFINITY
  let lastSentScene: StallScene | null = null

  const onEvent = (entries: PerformanceEntry[]): void => {
    for (const entry of entries) {
      const id = (entry as PerformanceEntry & { interactionId?: number }).interactionId
      if (!id || id <= 0) continue
      const previous = interactions.get(id)
      if (previous === undefined) {
        if (interactions.size >= MAX_INTERACTIONS) interactions.delete(interactions.keys().next().value as number)
        interactions.set(id, entry.duration)
      } else if (entry.duration > previous) interactions.set(id, entry.duration)
    }
  }
  const stallScene = (): StallScene => {
    const current: PerfScene = scene ? scene() : { page: 'library', nodes: 0, imageNodes: 0, generating: false }
    return { page: current.page, nodes: countBucket(current.nodes), generating: current.generating }
  }
  const onLongFrame = (entries: PerformanceEntry[]): void => {
    for (const entry of entries) {
      longFrameCount += 1
      if (longestFrameMs === null || entry.duration > longestFrameMs) longestFrameMs = entry.duration
      if (entry.duration >= STALL_RENDERER_FRAME_MIN_MS) {
        pendingFrames.push({ endedAtMs: env.epochOf(entry.startTime + entry.duration), ms: Math.round(entry.duration), scene: stallScene() })
        if (pendingFrames.length > STALL_REPORT_MAX_FRAMES) pendingFrames = pendingFrames.sort((a, b) => b.ms - a.ms).slice(0, STALL_REPORT_MAX_FRAMES)
      }
    }
  }
  const sameScene = (a: StallScene | null, b: StallScene): boolean => a !== null && a.page === b.page && a.nodes === b.nodes && a.generating === b.generating
  /** 场景变了或到了发长帧的点才发；`force`（页面隐藏 / 关闭）绕过 30 秒间隔，免得最后一批丢掉。 */
  function reportStall(force = false): void {
    if (!started) return
    const current = stallScene()
    const framesDue = pendingFrames.length > 0 && (force || env.now() - lastStallReportAt >= STALL_REPORT_MIN_GAP_MS)
    if (sameScene(lastSentScene, current) && !framesDue) return
    const report: StallReport = { scene: current, ...(framesDue ? { longFrames: pendingFrames } : {}) }
    lastSentScene = current
    if (framesDue) { pendingFrames = []; lastStallReportAt = env.now() }
    env.sendStall(report)
  }

  const reset = (): void => {
    interactions.clear()
    longFrameCount = 0
    longestFrameMs = null
    windowStart = env.now()
  }

  /** 当前窗口的汇总。两个标准接口缺一个，就没法如实说「0 次长帧」，宁可不出。 */
  function snapshot(): PerfSummaryProps | null {
    if (!started || !supported.event || !supported.loaf) return null
    const minutes = (env.now() - windowStart) / 60_000
    const sorted = [...interactions.values()].sort((a, b) => a - b)
    const current: PerfScene = scene ? scene() : { page: 'library', nodes: 0, imageNodes: 0, generating: false }
    return {
      interactionP75: interactionBucket(percentile(sorted, 75)),
      interactionP95: interactionBucket(percentile(sorted, 95)),
      longFramesPerMin: longFramesPerMinBucket(longFrameCount, minutes),
      longestFrame: longestFrameBucket(longestFrameMs),
      observedMinutes: observedMinutesBucket(minutes),
      page: current.page,
      nodes: countBucket(current.nodes),
      imageNodes: countBucket(current.imageNodes),
      generating: current.generating,
      cpuCores: cpuCoresBucket(env.hardwareConcurrency),
      memoryGb: memoryBucket(env.deviceMemory),
    }
  }

  function flush(): void {
    if (env.now() - windowStart < MIN_WINDOW_MS) return
    const props = snapshot()
    if (!props) return
    reset()
    env.send(props)
  }

  return {
    setScene(source: (() => PerfScene) | null): void { scene = source },
    start(): void {
      if (started) return
      started = true
      reset()
      const event = env.createObserver('event', onEvent, { type: 'event', durationThreshold: EVENT_DURATION_THRESHOLD_MS, buffered: true })
      const loaf = env.createObserver('long-animation-frame', onLongFrame, { type: 'long-animation-frame', buffered: true })
      supported = { event: event !== null, loaf: loaf !== null }
      observers = [event, loaf].filter((item): item is ObserverLike => item !== null)
      cleanups = [
        env.onHidden(() => { env.whenIdle(flush); reportStall(true) }),
        env.setInterval(() => env.whenIdle(flush), PERIODIC_FLUSH_MS),
        env.setInterval(() => reportStall(), STALL_SCENE_POLL_MS),
      ]
    },
    snapshot,
    flush,
    stop(): void {
      observers.forEach((observer) => observer.disconnect())
      cleanups.forEach((cleanup) => cleanup())
      observers = []
      cleanups = []
      started = false
    },
  }
}

function realEnv(send: (props: PerfSummaryProps) => void): PerfCollectorEnv {
  return {
    createObserver(type, onEntries, options) {
      if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes(type)) return null
      try {
        const observer = new PerformanceObserver((list) => onEntries(list.getEntries()))
        observer.observe(options)
        return observer
      } catch { return null }
    },
    now: () => performance.now(),
    hardwareConcurrency: typeof navigator === 'undefined' ? undefined : navigator.hardwareConcurrency,
    deviceMemory: typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    onHidden(listener) {
      const handler = (): void => { if (document.visibilityState === 'hidden') listener() }
      document.addEventListener('visibilitychange', handler)
      window.addEventListener('pagehide', listener)
      return () => { document.removeEventListener('visibilitychange', handler); window.removeEventListener('pagehide', listener) }
    },
    setInterval(callback, ms) { const id = window.setInterval(callback, ms); return () => window.clearInterval(id) },
    whenIdle(callback) {
      // 页面正在隐藏 / 关闭时空闲回调可能等不到，那一刻直接做（计算量是几百个数的排序）。
      if (document.visibilityState === 'hidden' || typeof requestIdleCallback === 'undefined') callback()
      else requestIdleCallback(() => callback(), { timeout: 5000 })
    },
    send,
    epochOf: (performanceTime) => performance.timeOrigin + performanceTime,
    sendStall(report) { getDesktopBridge()?.diagnostics?.reportStall(report) },
  }
}

let singleton: ReturnType<typeof createPerfCollector> | null = null
function collector(): ReturnType<typeof createPerfCollector> {
  singleton ??= createPerfCollector(realEnv((props) => {
    void getDesktopBridge()?.telemetry?.track({ eventName: 'perf.session.summary', props })?.catch(() => undefined)
  }))
  return singleton
}

/** 全进程调一次（main.tsx）。重复调用无副作用。 */
export function startPerfCollector(): void { collector().start() }
export function setPerfScene(source: (() => PerfScene) | null): void { collector().setScene(source) }
/** 反馈面板用：用户点了「发送」才带。窗口太短 / 接口不支持时给 null。 */
export function snapshotPerfSummary(): PerfSummaryProps | null { return collector().snapshot() }
