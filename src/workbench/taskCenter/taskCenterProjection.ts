export type TaskCenterGroup = 'running' | 'queued' | 'done'
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
  engineStageText?: string
  elapsedMs?: number
  cancel: TaskCancelKind
  error?: string
  stalled?: boolean
  lastEngineUpdateAt?: number
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
    | null
}

export type VideoAnalysisTaskCenterProjection = TaskCenterProjectionBase & {
  kind: 'video_analysis'
  projectId: string
  analysisId: string
  target: {
    kind: 'video_analysis'
    projectId: string
    analysisId: string
    nodeId: string | null
  }
  action: { kind: 'cancel_video_analysis'; projectId: string; analysisId: string } | null
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

export type TaskCenterProjection =
  | GenerationTaskCenterProjection
  | VideoAnalysisTaskCenterProjection
  | ProductionRunTaskCenterProjection
