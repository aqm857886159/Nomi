// 自动检查更新的纯逻辑：何时查、要不要查、哪次发现该通知、失败怎么归类。
// 不碰 electron：autoUpdater.ts 负责接线，这里只管可用假时钟测的规则。
import type { UpdateFailureReason } from '../telemetry/telemetryEvents'

/** 启动后首查延迟：让出启动期的网络与 CPU（项目、渲染、模型表），又够短，当次会话就能看到。 */
export const AUTO_CHECK_FIRST_DELAY_MS = 30_000
/** 之后的间隔：一天最多 4 次，只拉一个 latest.yml；开着的人发版当天大概率能看到。 */
export const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000


const NETWORK_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE'])

/** 只返回枚举，不带 message / URL：错误文本可能含路径或网址，不进上报。 */
export function classifyUpdateError(error: unknown): UpdateFailureReason {
  if (!error || typeof error !== 'object') return 'other'
  const err = error as { code?: unknown; name?: unknown; message?: unknown; statusCode?: unknown }
  const code = typeof err.code === 'string' ? err.code : ''
  const message = typeof err.message === 'string' ? err.message : ''
  if (err.name === 'YAMLException' || code === 'ERR_UPDATER_INVALID_UPDATE_INFO') return 'parse'
  if (typeof err.statusCode === 'number') return 'network'
  if (NETWORK_CODES.has(code) || code.startsWith('ERR_INTERNET') || code.startsWith('ERR_NETWORK') || code.startsWith('ERR_CONNECTION') || code.startsWith('ERR_NAME_NOT_RESOLVED') || /net::ERR_/.test(message)) return 'network'
  return 'other'
}

export type AutoCheckTimers = {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

export type AutoCheckDeps = {
  /** 开发版 / 非正式版 / 自动化启动为 false：整个调度根本不启动。 */
  enabled: () => boolean
  /** 手动检查、下载中或已下载完时为 true：本轮跳过（不重置它们的状态）。 */
  busy: () => boolean
  run: () => Promise<void>
  timers?: AutoCheckTimers
  firstDelayMs?: number
  intervalMs?: number
}

export function createAutoCheckScheduler(deps: AutoCheckDeps): { start: () => void; stop: () => void } {
  const timers: AutoCheckTimers = deps.timers ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }
  const interval = deps.intervalMs ?? AUTO_CHECK_INTERVAL_MS
  let handle: unknown = null
  let running = false

  const schedule = (ms: number): void => {
    handle = timers.setTimeout(() => { void tick() }, ms)
  }
  const tick = async (): Promise<void> => {
    if (!running) return
    // 先排下一轮：失败不加速重试，也不会因为一次异常断掉整条调度。
    schedule(interval)
    if (deps.busy()) return
    try { await deps.run() } catch { /* 静默检查的失败不打扰用户 */ }
  }

  return {
    start() {
      if (running || !deps.enabled()) return
      running = true
      schedule(deps.firstDelayMs ?? AUTO_CHECK_FIRST_DELAY_MS)
    },
    stop() {
      running = false
      if (handle !== null) timers.clearTimeout(handle)
      handle = null
    },
  }
}

/** 同一版本本次运行内只通知一次（用户点过「稍后」不再反复冒角标）；手动检查永远通知。 */
export function createVersionNotifyGate(): { shouldNotify: (version: string, silent: boolean) => boolean } {
  let lastNotified: string | null = null
  return {
    shouldNotify(version, silent) {
      if (silent && version === lastNotified) return false
      lastNotified = version
      return true
    },
  }
}
