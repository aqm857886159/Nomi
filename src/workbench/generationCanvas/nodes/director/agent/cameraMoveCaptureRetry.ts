/**
 * [INPUT]: 无依赖
 * [OUTPUT]: 对外提供 CameraMoveCaptureOutcome、CameraMoveRetryConfig / DEFAULT_CAMERA_MOVE_RETRY、canRetryCameraMoveCapture、CameraMoveRetryDecision / decideCameraMoveRetry
 * [POS]: director/agent 的离屏出片「失败重试」纯决策（原 V1 cameraMoveCaptureRetry，切换门入籍）：一次瞬态 WebGL 上下文丢失（GPU / 驱动 / 多实例抢配额）
 *        不判死——超时 / 空结果就延迟重挂捕获器再来，最多 N 次；只有都败才清标志放弃。React / 计时器副作用留在 Host。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

/** 一次捕获尝试的结局：ok = 拿到可用结果；null = 帧不足 / 相机缺失；timeout = 循环停死没回调 */
export type CameraMoveCaptureOutcome = 'ok' | 'null' | 'timeout'

export type CameraMoveRetryConfig = {
  /** 最多尝试几次（含首次）。默认 3 = 首次 + 2 次重试 */
  maxAttempts: number
  /** 每次失败后等多久再重挂（ms） */
  retryDelayMs: number
  /** 单次捕获的看门狗超时（ms） */
  attemptTimeoutMs: number
}

export const DEFAULT_CAMERA_MOVE_RETRY: CameraMoveRetryConfig = { maxAttempts: 3, retryDelayMs: 800, attemptTimeoutMs: 30_000 }

export function canRetryCameraMoveCapture(attempt: number, config: CameraMoveRetryConfig): boolean {
  return attempt < Math.max(1, config.maxAttempts)
}

export type CameraMoveRetryDecision = { kind: 'done' } | { kind: 'retry'; nextAttempt: number; delayMs: number } | { kind: 'giveUp' }

export function decideCameraMoveRetry(outcome: CameraMoveCaptureOutcome, attempt: number, config: CameraMoveRetryConfig = DEFAULT_CAMERA_MOVE_RETRY): CameraMoveRetryDecision {
  if (outcome === 'ok') return { kind: 'done' }
  if (canRetryCameraMoveCapture(attempt, config)) return { kind: 'retry', nextAttempt: attempt + 1, delayMs: Math.max(0, config.retryDelayMs) }
  return { kind: 'giveUp' }
}
