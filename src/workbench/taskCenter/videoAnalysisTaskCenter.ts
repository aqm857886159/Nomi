import type { VideoAnalysisStage, VideoAnalysisTask } from '../../../electron/videoAnalysis/contracts'
import type { VideoAnalysisTaskCenterProjection } from './taskCenterProjection'

type Labels = {
  title: string
  stages: Record<VideoAnalysisStage, string>
  submissionUnknown: string
  engineOffline: string
}

const ACTIVE = new Set<VideoAnalysisTask['status']>([
  'queued',
  'submitting',
  'running',
  'cancel_requested',
  'engine_unreachable',
  'submission_unknown',
])

function time(value: string | null): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function groupFor(task: VideoAnalysisTask): VideoAnalysisTaskCenterProjection['group'] {
  if (task.status === 'queued' || task.status === 'submitting') return 'queued'
  if (ACTIVE.has(task.status) && (task.status !== 'engine_unreachable' || Boolean(task.engineTaskId))) return 'running'
  return 'done'
}

function outcomeFor(task: VideoAnalysisTask): VideoAnalysisTaskCenterProjection['outcome'] {
  if (task.status === 'completed') return 'success'
  if (task.status === 'cancelled') return 'cancelled'
  if (!ACTIVE.has(task.status) || (task.status === 'engine_unreachable' && !task.engineTaskId)) return 'error'
  return undefined
}

export function buildVideoAnalysisTaskRows(
  tasks: readonly VideoAnalysisTask[],
  now: number,
  labels: Labels,
): VideoAnalysisTaskCenterProjection[] {
  return tasks.map((task) => {
    const sourceName = task.source.relativePath.split('/').pop() || task.source.relativePath
    const group = groupFor(task)
    const startedAt = time(task.startedAt) ?? time(task.createdAt) ?? now
    const endedAt = time(task.completedAt) ?? (group === 'done' ? time(task.updatedAt) : null) ?? now
    const lastEngineUpdateAt = time(task.lastEngineUpdateAt)
    const stallBaseline = lastEngineUpdateAt ?? startedAt
    const stalled = group === 'running' && now - stallBaseline >= 15_000
    const cancel = ['running', 'engine_unreachable'].includes(task.status) && Boolean(task.engineTaskId) ? 'interrupt' : 'none'
    return {
      id: `video-analysis:${task.analysisId}`,
      kind: 'video_analysis',
      projectId: task.projectId,
      analysisId: task.analysisId,
      title: `${labels.title} · ${sourceName}`,
      group,
      outcome: outcomeFor(task),
      recoverable: task.status === 'submission_unknown',
      phaseText: task.status === 'submission_unknown'
        ? labels.submissionUnknown
        : task.status === 'engine_unreachable'
          ? labels.engineOffline
          : labels.stages[task.stage],
      ...(task.stageText ? { engineStageText: task.stageText } : {}),
      elapsedMs: Math.max(0, endedAt - startedAt),
      cancel,
      ...(task.errorMessage ? { error: task.errorMessage } : {}),
      stalled,
      ...(lastEngineUpdateAt !== null ? { lastEngineUpdateAt } : {}),
      target: {
        kind: 'video_analysis',
        projectId: task.projectId,
        analysisId: task.analysisId,
        nodeId: task.sourceNodeId,
      },
      action: cancel === 'interrupt'
        ? { kind: 'cancel_video_analysis', projectId: task.projectId, analysisId: task.analysisId }
        : null,
    }
  })
}
