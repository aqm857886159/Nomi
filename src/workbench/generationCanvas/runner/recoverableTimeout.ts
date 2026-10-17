import type { TaskKind } from '../../api/taskApi'
import i18n from '../../../i18n'
import { tagNomiError } from '../../../../electron/shared/nomiErrorCodes'

/** 续查所需的最小上下文（全可由节点 derive，taskId 已落盘）。 */
export type RecoverableTimeoutDetail = {
  taskId: string
  vendor: string
  taskKind: TaskKind
  modelKey: string
}

/**
 * 落「可找回」的原因从哪来（2026-09-28）：
 * - lastError：查结果连续失败超过宽限——把最后那次取回错误**原样**交出去（出站被拦、HTTP 403、类型不符……
 *   各有各的下一步，那句话的价值全在它自己的码和人话上），不再一律说「超时」；
 * - message：阶段到期（主进程一直没有回音）——说清是哪一步、等了多久。
 * 都没有，才是真的「上游还没跑完、等到了上限」：带阶段码 retrieval-timeout（#1213 失败看得见：每次取回失败都说清卡在哪一步）。
 */
export type RecoverableTimeoutReason = { lastError?: unknown; message?: string }

function lastErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return null
}

/**
 * 异步任务轮询超时但**上游可能仍在跑/已出片**的可找回错误。
 * 刻意独立于普通错误：runGenerationNode 据此把节点落 `recoverable` 而非 `error`（不进红色错误桶），
 * 用户可「重新拉取结果」找回。携带 detail 供续查（虽然 recover 动作目前从节点重建，这里也带上备用）。
 * 它**永远不进自动重试**（generationRetryPolicy）：重试 = 重新提交 = 再扣一次钱，而这次的钱没丢。
 */
export class RecoverableTimeoutError extends Error {
  readonly recoverable = true as const
  readonly detail: RecoverableTimeoutDetail
  /** 宽限到期前最后一次取回失败的原错误（没有则为 undefined）。 */
  readonly lastError: unknown
  constructor(detail: RecoverableTimeoutDetail, reason: RecoverableTimeoutReason = {}) {
    super(reason.message ?? lastErrorMessage(reason.lastError) ?? tagNomiError('retrieval-timeout', i18n.t('generationCommon.recoverable.timedOut', { taskId: detail.taskId })))
    this.name = 'RecoverableTimeoutError'
    this.detail = detail
    this.lastError = reason.lastError
  }
}

export function isRecoverableTimeoutError(error: unknown): error is RecoverableTimeoutError {
  return error instanceof RecoverableTimeoutError
}
