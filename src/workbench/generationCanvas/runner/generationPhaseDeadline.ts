// 生成节点「每个非终态阶段最多停多久、到点怎么收场」——唯一一张表，加上唯一一个等待原语。
//
// 为什么要它（2026-09-28「生成完了却一直停在『正在存到你电脑上』」）：主进程取回一个被拒的大响应时会永远挂住
// （根因修在 electron/hardenedFetch.ts），而渲染层等查结果的 IPC 没有任何时限——硬超时只在每一轮轮询的开头查、
// 停止请求也只在每一轮开头问，于是一次不返回的 IPC 就让节点永远停在那一格，停止按钮也打不断。
// 根因修好了，这一层仍要兜住：将来主进程里再出现任何一个不返回的 await，节点也必须在有限时间内落到一个能继续的状态。
//
// 规矩：
//   ① 表是穷举 Record（同 narrate.ts 的 NARRATE_PROGRESS）：新增一个 GenerationProgressPhase 不在这里给出口，
//      typecheck 直接红——结构上不再允许「进去了就出不来」的阶段；
//   ② 计时从「最后一次报进度」起算：报一次进度就是「还活着」。轮询每一轮都报，所以对轮询来说它就是每一次查结果的时限；
//      主进程开始落地时会广播，节点切到 finalizing，正在等的那次查结果随之换成落地的时限；
//   ③ 生成运行里每一个等主进程的 await 都经 awaitWithinPhase：阶段到期或用户点停止，立刻不再等。
//      正在等的那个 IPC 留在后台（主进程侧自己的时限会让它结束），不再有人听它的结果。
import type { GenerationProgressPhase } from '../../observability/narrate'
import { PROVIDER_MEDIA_RETRIEVAL_MAX_MS } from '../../../../electron/shared/assets/providerMediaRetrievalBudget'
import i18n from '../../../i18n'

const MINUTE_MS = 60_000

/**
 * 排队只等本地簿记。旧运行记录中的 retrying 阶段仍可读取。
 */
const LOCAL_STEP_MAX_MS = 2 * MINUTE_MS

/**
 * 一轮轮询：等待间隔（429 退避封顶 30s）+ 主进程查一次结果（查询与结果两次供应商请求，vendorHttp 每次上限 120s）+ 余量。
 * 超过它还没回音，就不是「上游慢」而是「我们这边卡住了」：落「可找回」（钱已花、免费重新拉取），不再干等下一轮。
 */
const POLL_TICK_MAX_MS = 5 * MINUTE_MS

/**
 * 可能带着一次媒体传输的一步：主进程一次取回最长多久（shared 取回预算里字节上限那一档，860s），
 * 加上落盘后的字节校验 / 预览派生 / 时长探测（ffmpeg 12s + 60s + 20s，取整 2 分钟）。
 * 渲染层绝不能比主进程先放弃：先放弃 = 主进程还在正常下载，节点却被判成「可找回」，用户一点重新拉取又从头下一遍。
 */
export const MEDIA_TRANSFER_STEP_MAX_MS = PROVIDER_MEDIA_RETRIEVAL_MAX_MS + 2 * MINUTE_MS

/**
 * 到点怎么收场 = 「钱此刻在哪」：
 * - recoverable：服务商已受理（手上有 taskId），钱已花、片子多半在上游 → 落「可找回」，免费重新拉取；
 * - fail-uncharged：请求还没离开本机 → 诚实失败，重来不多花钱；
 * - fail-maybe-charged：付费请求已经发出、回执没回来 → 诚实失败，并提醒先到服务商核对（可能已扣费）再决定要不要重来。
 */
export type DeadlineExpiry = 'recoverable' | 'fail-uncharged' | 'fail-maybe-charged'

export type PhaseDeadline = Readonly<{ maxMs: number; onExpiry: DeadlineExpiry }>

export const GENERATION_PHASE_DEADLINE: Readonly<Record<GenerationProgressPhase, PhaseDeadline>> = {
  queued: { maxMs: LOCAL_STEP_MAX_MS, onExpiry: 'fail-uncharged' },
  retrying: { maxMs: LOCAL_STEP_MAX_MS, onExpiry: 'fail-uncharged' },
  // 解析模型，外加视频接力抽帧（抽帧可能要先把源视频取回来）。
  resolving: { maxMs: MEDIA_TRANSFER_STEP_MAX_MS, onExpiry: 'fail-uncharged' },
  // 提交：上传参考素材 + 付费请求。同步模型在这一步里就把结果取回落地——那时主进程广播，节点切到 finalizing。
  requesting: { maxMs: MEDIA_TRANSFER_STEP_MAX_MS, onExpiry: 'fail-maybe-charged' },
  waiting: { maxMs: POLL_TICK_MAX_MS, onExpiry: 'recoverable' },
  generating: { maxMs: POLL_TICK_MAX_MS, onExpiry: 'recoverable' },
  'still-generating': { maxMs: POLL_TICK_MAX_MS, onExpiry: 'recoverable' },
  // ComfyUI 这两格由 ws 进度桥直接写到节点上；同一次运行的轮询照样每一轮报 generating，时限由那一格兜。
  'comfyui-node': { maxMs: POLL_TICK_MAX_MS, onExpiry: 'recoverable' },
  'comfyui-queued': { maxMs: POLL_TICK_MAX_MS, onExpiry: 'recoverable' },
  // 正在存到你电脑上：主进程在取回并落盘。
  finalizing: { maxMs: MEDIA_TRANSFER_STEP_MAX_MS, onExpiry: 'recoverable' },
}

function minutesOf(ms: number): number {
  return Math.max(1, Math.round(ms / MINUTE_MS))
}

/** 「这一步等了多久没回音」的人话。不说「超时」：说清是查结果还是存到本机、等了几分钟。 */
export function describePhaseSilence(phase: GenerationProgressPhase, waitedMs: number): string {
  return i18n.t(phase === 'finalizing'
    ? 'generationCommon.phaseDeadline.savingSilent'
    : 'generationCommon.phaseDeadline.resultSilent', { minutes: minutesOf(waitedMs) })
}

/** 到点收场的两种「失败」：诚实失败，不进重试。 */
export class GenerationPhaseStalledError extends Error {
  readonly phase: GenerationProgressPhase
  readonly expiry: Exclude<DeadlineExpiry, 'recoverable'>
  constructor(phase: GenerationProgressPhase, expiry: Exclude<DeadlineExpiry, 'recoverable'>, stalledMs: number) {
    super(i18n.t(expiry === 'fail-maybe-charged'
      ? 'generationCommon.phaseDeadline.stalledMaybeCharged'
      : 'generationCommon.phaseDeadline.stalledUncharged', { minutes: minutesOf(stalledMs) }))
    this.name = 'GenerationPhaseStalledError'
    this.phase = phase
    this.expiry = expiry
  }
}

export function isGenerationPhaseStalledError(error: unknown): error is GenerationPhaseStalledError {
  return error instanceof GenerationPhaseStalledError
}

/** 一次生成运行的阶段时钟：记着现在在哪一格、从什么时候开始没有进展。 */
export type PhaseClock = {
  /** 报一次进度：进入（或停留在）这一格，计时从此刻重新起算。 */
  report(phase: GenerationProgressPhase): void
  /** 同一格里有进展（流式文本来了一段）：计时重新起算。 */
  heartbeat(): void
  current(): Readonly<{ phase: GenerationProgressPhase; since: number }> | null
  subscribe(listener: () => void): () => void
}

export function createPhaseClock(): PhaseClock {
  let state: { phase: GenerationProgressPhase; since: number } | null = null
  const listeners = new Set<() => void>()
  const changed = () => {
    for (const listener of [...listeners]) listener()
  }
  return {
    report(phase) {
      state = { phase, since: Date.now() }
      changed()
    },
    heartbeat() {
      if (!state) return
      state = { phase: state.phase, since: Date.now() }
      changed()
    },
    current: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export type PhaseWaitGuard = {
  clock: PhaseClock
  /** 订阅「停止」：用户一点，回调带回要抛的错误（由持有取消登记的一方给），正在等的 await 立刻结束。 */
  cancelled?: (stop: (error: Error) => void) => () => void
  /**
   * 到点要落「可找回」时造那个错误——它要一张回执（taskId）。还没有回执（同步模型提交途中就开始落地）时返回 null：
   * 没有回执的「可找回」是一颗按不动的按钮，那一格改走 fail-maybe-charged（钱可能已经花了，诚实地让用户去核对）。
   */
  recoverable: (phase: GenerationProgressPhase, stalledMs: number) => Error | null
}

type DeadlineSource = {
  next: () => { at: number; expire: () => Error } | null
  subscribe?: (listener: () => void) => () => void
  cancelled?: PhaseWaitGuard['cancelled']
}

/** 唯一的等待原语：work 落定、时限到、或被叫停，三者先到者为准；落定后清掉自己的计时器与订阅。 */
function settleWithin<T>(work: Promise<T>, source: DeadlineSource): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    // 订阅在 finish 之后才建立（「停止」可能在订阅那一刻就同步回调）：统一收进这里，落定时逐个退订。
    const cleanups: Array<() => void> = []
    const releaseAll = () => {
      for (const cleanup of cleanups.splice(0)) cleanup()
    }
    const finish = (complete: () => void) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      releaseAll()
      complete()
    }
    const arm = () => {
      if (settled) return
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      const next = source.next()
      if (!next) return
      const remaining = next.at - Date.now()
      if (remaining <= 0) {
        const error = next.expire()
        finish(() => reject(error))
        return
      }
      timer = setTimeout(arm, remaining)
    }
    work.then((value) => finish(() => resolve(value)), (error: unknown) => finish(() => reject(error)))
    const unsubscribeDeadline = source.subscribe?.(arm)
    if (unsubscribeDeadline) cleanups.push(unsubscribeDeadline)
    const unsubscribeCancel = source.cancelled?.((error) => finish(() => reject(error)))
    if (unsubscribeCancel) cleanups.push(unsubscribeCancel)
    if (settled) {
      releaseAll()
      return
    }
    arm()
  })
}

function phaseExpiryError(guard: PhaseWaitGuard, phase: GenerationProgressPhase, since: number): Error {
  const stalledMs = Date.now() - since
  const { onExpiry } = GENERATION_PHASE_DEADLINE[phase]
  if (onExpiry === 'recoverable') {
    return guard.recoverable(phase, stalledMs) ?? new GenerationPhaseStalledError(phase, 'fail-maybe-charged', stalledMs)
  }
  return new GenerationPhaseStalledError(phase, onExpiry, stalledMs)
}

/**
 * 在「当前这一格的时限」之内等 work：时限按表从最后一次报进度起算；等的过程中换了格（例如主进程广播开始落地），
 * 时限随之换成新那一格的。用户点停止也立刻结束。
 */
export function awaitWithinPhase<T>(work: Promise<T>, guard: PhaseWaitGuard): Promise<T> {
  return settleWithin(work, {
    next: () => {
      const current = guard.clock.current()
      if (!current) return null
      return {
        at: current.since + GENERATION_PHASE_DEADLINE[current.phase].maxMs,
        expire: () => phaseExpiryError(guard, current.phase, current.since),
      }
    },
    subscribe: guard.clock.subscribe,
    cancelled: guard.cancelled,
  })
}

/** 只等「被叫停」，不设时限——给本来就有上限的本机等待（轮询间隔）用，让停止不必等到下一轮。 */
export function awaitUnlessCancelled<T>(work: Promise<T>, cancelled: PhaseWaitGuard['cancelled']): Promise<T> {
  return settleWithin(work, { next: () => null, cancelled })
}

/**
 * 不属于某次生成运行、但同样在等主进程取回媒体的一步（重新拉取结果、结果补落地）：最多等一次媒体传输那么久。
 * 重新拉取的那次查结果里可能就包着整段下载，而主进程不为它广播「开始落地」，所以直接按传输那一档给。
 */
export function awaitMediaTransfer<T>(work: Promise<T>, onExpired: (waitedMs: number) => Error): Promise<T> {
  const startedAt = Date.now()
  return settleWithin(work, {
    next: () => ({ at: startedAt + MEDIA_TRANSFER_STEP_MAX_MS, expire: () => onExpired(Date.now() - startedAt) }),
  })
}
