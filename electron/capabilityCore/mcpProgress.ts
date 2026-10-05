// A1 进度桥（plan 2026-08-11-mcp-conversation-native-p0）：tools/call 执行期向客户端发
// notifications/progress——Claude Code 会把 message 实时渲染在工具调用行内，且每帧都重置
// 它的空闲超时（stdio 无声 30min 会被掐，长渲染因此不再「假失败」）。
//
// 诚实进度铁律（设计系统 §1「No fake progress」同源）：没有真实总量就不发 total、不造百分比；
// progress 只是单调递增的帧序号（规范要求递增）；心跳消息只报真实已用时长。
// 纯逻辑、可注入时钟 —— 与 mcpProtocol 同边界，裸 node 单测。

export type ProgressLocale = 'zh-CN' | 'en'

export type ProgressReporter = {
  /** 发一条真实阶段消息（如「镜头 3/16 · 供应商已受理」）。无 token 时是 no-op。 */
  emit(message: string): void
  /** 结束（清心跳定时器）。幂等。 */
  stop(): void
}

const NOOP: ProgressReporter = { emit: () => {}, stop: () => {} }

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0')
  const ss = String(totalSec % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

export function createProgressReporter(options: {
  /** 发一条 notifications/progress（不带 jsonrpc 外壳，由 SDK 装帧并关联到所属请求）。 */
  send: (notification: { method: 'notifications/progress'; params: { progressToken: string | number; progress: number; message: string } }) => void
  /** 客户端在 tools/call params._meta.progressToken 给的令牌；没给 = 客户端不要进度 → 全 no-op。 */
  progressToken: string | number | null | undefined
  /** 起始帧消息（如参数回显「已提交 · kling · 9:16」）。可省。 */
  startMessage?: string
  /** 心跳间隔 ms，默认 10s（Claude Code idle 阈值远大于此，取「感觉活着」的下限）。 */
  heartbeatMs?: number
  locale?: ProgressLocale
  /** 可注入时钟（测试用）。 */
  now?: () => number
}): ProgressReporter {
  const { send, progressToken, startMessage } = options
  if (progressToken === null || progressToken === undefined || progressToken === '') return NOOP
  const token: string | number = progressToken
  const heartbeatMs = options.heartbeatMs ?? 10_000
  const now = options.now ?? Date.now
  const locale = options.locale ?? 'zh-CN'
  const startedAt = now()
  let seq = 0
  let stopped = false
  let timer: ReturnType<typeof setInterval> | null = null

  function frame(message: string): void {
    if (stopped) return
    seq += 1
    send({
      method: 'notifications/progress',
      params: { progressToken: token, progress: seq, message },
    })
  }

  function heartbeat(): void {
    const elapsed = formatElapsed(now() - startedAt)
    frame(locale === 'en' ? `still working · elapsed ${elapsed}` : `仍在进行 · 已用 ${elapsed}`)
  }

  function armTimer(): void {
    if (timer) clearInterval(timer)
    timer = setInterval(heartbeat, heartbeatMs)
    // Electron 主进程不该被心跳钉着不退出（stdio 模式进程生命周期由连接管理）。
    ;(timer as unknown as { unref?: () => void }).unref?.()
  }

  if (startMessage) frame(startMessage)
  armTimer()

  return {
    emit(message: string): void {
      frame(message)
      armTimer() // 真事件刚说过话，心跳重新计时，避免紧跟一条冗余「仍在进行」。
    },
    stop(): void {
      stopped = true
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}
