// 任务四态与终态判据的中立单一真源（跨主进程、IPC 与渲染层共用）。
export const TASK_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const

export type TaskStatus = (typeof TASK_STATUSES)[number]

export type TaskTerminalStatus = Extract<TaskStatus, 'succeeded' | 'failed'>

export const TASK_STATUS_PHASE = {
  queued: 'in-flight',
  running: 'in-flight',
  succeeded: 'terminal',
  failed: 'terminal',
} as const satisfies Record<TaskStatus, 'in-flight' | 'terminal'>

/** 全仓唯一「任务是否已终态」判据（防原型属性如 toString 误判）。 */
export function isTerminalTaskStatus(status: string | undefined | null): status is 'succeeded' | 'failed' {
  return (
    typeof status === 'string' &&
    Object.prototype.hasOwnProperty.call(TASK_STATUS_PHASE, status) &&
    TASK_STATUS_PHASE[status as TaskStatus] === 'terminal'
  )
}
