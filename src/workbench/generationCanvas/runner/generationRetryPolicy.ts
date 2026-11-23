// 生成提交的重试策略（哪些失败值得自动重试、重试几次、退避多久）。只管判定与等待，
// 不碰节点状态——结局投递由 generationRunController / runProjectDelivery 负责。
import { parseVendorErrorFromMessage } from '../../../../electron/shared/generationFailure'
import { matchNomiErrorCode } from '../../../../electron/shared/nomiErrorCodes'
import { isGenerationPhaseStalledError } from './generationPhaseDeadline'
import { isRecoverableTimeoutError } from './recoverableTimeout'

type RetryableGenerationError = Error & {
  status?: number
  code?: unknown
}

const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BASE_DELAY_MS = 350

export function isRetryableGenerationError(error: unknown): boolean {
  // 自动重试 = 重新提交 = 再付一次钱。这两类按**类型**先排除，不交给下面的文案判断：
  // - 可找回：钱已花、任务在上游，该做的是免费重新拉取。它的文案现在就是最后一次取回错误的原话
  //   （可能恰好含 timeout / Failed to fetch），按文案判会把一次已付费的任务再提交一遍；
  // - 阶段到期：我们自己决定不再等了（提交那一格到期时，钱可能已经花了）。
  if (isRecoverableTimeoutError(error) || isGenerationPhaseStalledError(error)) return false
  if (!(error instanceof Error)) return false
  // Main owns retry after a classified task outcome. Its diagnostic may describe
  // a transient failure in a different operation, such as a reference upload.
  if (matchNomiErrorCode(error.message) || parseVendorErrorFromMessage(error.message)) return false
  if (error instanceof TypeError) return true
  const candidate = error as RetryableGenerationError
  if (typeof candidate.status === 'number') {
    return (
      candidate.status === 408 ||
      candidate.status === 409 ||
      candidate.status === 425 ||
      candidate.status === 429 ||
      candidate.status >= 500
    )
  }
  const message = candidate.message.trim().toLowerCase()
  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('socket') ||
    message.includes('timeout') ||
    message.includes('temporarily unavailable') ||
    message.includes('rate limit')
  )
}

export function normalizeRetryAttempts(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_ATTEMPTS
  return Math.max(1, Math.min(5, Math.floor(value)))
}

export function normalizeBaseDelayMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_BASE_DELAY_MS
  return Math.max(0, Math.min(3_000, Math.floor(value)))
}

export async function waitForRetry(attempt: number, baseDelayMs: number): Promise<void> {
  if (baseDelayMs <= 0) return
  await new Promise((resolve) => globalThis.setTimeout(resolve, baseDelayMs * 2 ** Math.max(0, attempt - 1)))
}
