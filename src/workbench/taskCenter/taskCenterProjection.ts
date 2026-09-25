/**
 * 任务面板的分组——**唯一**一份，顺序即面板从上到下的顺序。
 *
 * - running：Nomi 这边还在推进（在跑、在轮询、在收尾），用户不用做什么；
 * - attention：卡在用户这儿——等确认 / 等处理 / 等重新拉取。它没结束，所以不进「已完成」；
 * - queued：已排队、还没提交；
 * - done：真正结束了（成功、失败、已取消）。
 *
 * 每种任务各有一个映射把自己的状态机投到这里（生成：taskCenterEntries；制作：productionRunView；
 * 导出：exportJobTaskCenter），组件只按 `group` 摆放，不自己判状态。分组名也只有 `taskCenter.groups.*`
 * 一套文案：区段标题和制作卡上的状态签用的是同一个词，结构上说不出两种话。
 */
export const TASK_CENTER_GROUPS = ['running', 'attention', 'queued', 'done'] as const
export type TaskCenterGroup = typeof TASK_CENTER_GROUPS[number]
export type TaskCenterOutcome = 'success' | 'error' | 'cancelled'
export type TaskCancelKind = 'free' | 'interrupt' | 'none'

type TaskCenterProjectionBase = {
  id: string
  title: string
  group: TaskCenterGroup
  outcome?: TaskCenterOutcome
  recoverable: boolean
  percent?: number
  phaseText?: string
  elapsedMs?: number
  cancel: TaskCancelKind
  error?: string
}

export type GenerationTaskCenterProjection = TaskCenterProjectionBase & {
  kind: 'generation'
  batchId: string
  nodeId: string
  waveIndex: number
  target: { kind: 'canvas_node'; nodeId: string }
  action:
    | { kind: 'cancel_generation_queue'; batchId: string; nodeId: string }
    | { kind: 'interrupt_generation'; nodeId: string }
    | { kind: 'retry_generation'; nodeId: string }
    /** 等待超时（上游可能已出片）：查询、不是重新生成——不铸付费令牌、不弹确认。 */
    | { kind: 'recover_generation'; nodeId: string }
    | null
}

export type ProductionRunTaskCenterProjection = TaskCenterProjectionBase & {
  kind: 'production_run'
  projectId: string
  runId: string
  target: {
    kind: 'production_run'
    projectId: string
    runId: string
  }
  action: null
}

export type ExportJobTaskCenterProjection = TaskCenterProjectionBase & {
  kind: 'export_job'
  jobId: string
  target: {
    kind: 'export_job'
    jobId: string
  }
  action:
    | { kind: 'cancel_export_job'; jobId: string }
    | { kind: 'reveal_export_output'; projectId: string; relativePath: string }
    | { kind: 'return_to_export'; projectId: string }
}

export type TaskCenterProjection =
  | GenerationTaskCenterProjection
  | ProductionRunTaskCenterProjection
  | ExportJobTaskCenterProjection
