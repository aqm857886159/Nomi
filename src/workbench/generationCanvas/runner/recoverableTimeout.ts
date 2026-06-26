import type { TaskKind } from '../../api/taskApi'

/** 续查所需的最小上下文（全可由节点 derive，taskId 已落盘）。 */
export type RecoverableTimeoutDetail = {
  taskId: string
  vendor: string
  taskKind: TaskKind
  modelKey: string
}

/**
 * 异步任务轮询超时但**上游可能仍在跑/已出片**的可找回错误。
 * 刻意独立于普通错误：runGenerationNode 据此把节点落 `recoverable` 而非 `error`（不进红色错误桶），
 * 用户可「重新拉取结果」找回。携带 detail 供续查（虽然 recover 动作目前从节点重建，这里也带上备用）。
 */
export class RecoverableTimeoutError extends Error {
  readonly recoverable = true as const
  readonly detail: RecoverableTimeoutDetail
  constructor(detail: RecoverableTimeoutDetail) {
    super(`生成超时(可找回): ${detail.taskId}`)
    this.name = 'RecoverableTimeoutError'
    this.detail = detail
  }
}

export function isRecoverableTimeoutError(error: unknown): error is RecoverableTimeoutError {
  return error instanceof RecoverableTimeoutError
}
