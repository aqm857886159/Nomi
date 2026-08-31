import type {
  VideoAnalysisResult,
  VideoAnalysisTask,
} from '../../../../electron/videoAnalysis/contracts'

export type VideoAnalysisNodeState = 'analyzing' | 'complete' | 'attention'

export type StructureExtractionAnalysis = {
  analysisId: string
  shotId: number
  timeRange: string
  marketingRole: string
  description: string
  sourceNodeId?: string
  sourceTitle?: string
  evidenceRefs: {
    visualMs: number[]
    spokenTextRef: string | null
    ocrTextRef: string | null
  } | null
}

export type StructureExtractionItem = {
  seconds: number
  analysis: StructureExtractionAnalysis
}

const ACTIVE_STATUSES = new Set<VideoAnalysisTask['status']>([
  'queued',
  'submitting',
  'running',
  'cancel_requested',
  'engine_unreachable',
  'submission_unknown',
])

const ATTENTION_STATUSES = new Set<VideoAnalysisTask['status']>([
  'failed',
  'engine_incompatible',
  'engine_unreachable',
  'submission_unknown',
])

const CONTROLLED_MARKETING_ROLES = new Set([
  'HOOK',
  'PAIN_POINT',
  'SOLUTION',
  'DEMO',
  'PROOF',
  'TRUST',
  'CTA',
  'TRANSITION',
  'GENERIC',
])

export function controlledMarketingRole(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, '_')
  return CONTROLLED_MARKETING_ROLES.has(normalized) ? normalized : 'GENERIC'
}

export function isVideoAnalysisActiveTask(task: VideoAnalysisTask): boolean {
  return ACTIVE_STATUSES.has(task.status) && (task.status !== 'engine_unreachable' || Boolean(task.engineTaskId))
}

export function timeRangeStartSeconds(value: string): number {
  const first = String(value || '').split(/\s*[-\u2013\u2014]\s*/, 1)[0]?.trim() ?? ''
  const parts = first.split(':').map((part) => Number(part.trim()))
  if (!parts.length || parts.some((part) => !Number.isFinite(part) || part < 0)) return 0
  if (parts.length === 1) return parts[0] ?? 0
  if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0)
  return (parts.at(-3) ?? 0) * 3600 + (parts.at(-2) ?? 0) * 60 + (parts.at(-1) ?? 0)
}

export function buildStructureExtractionItems(
  result: VideoAnalysisResult,
  selectedSceneIndexes: ReadonlySet<number>,
  analysisId: string,
): StructureExtractionItem[] {
  return result.scenes
    .filter((scene) => selectedSceneIndexes.has(scene.sceneIndex))
    .flatMap((scene) => scene.shots.map((shot) => ({
      seconds: shot.evidence?.visualMs[0] !== undefined
        ? shot.evidence.visualMs[0] / 1_000
        : timeRangeStartSeconds(shot.timeRange),
      analysis: {
        analysisId,
        shotId: shot.shotId,
        timeRange: shot.timeRange,
        marketingRole: result.source === 'deterministic_evidence' ? 'EVIDENCE' : controlledMarketingRole(scene.marketingRole),
        description: shot.visualDescription,
        evidenceRefs: shot.evidence ? {
          visualMs: [...shot.evidence.visualMs],
          spokenTextRef: shot.evidence.spokenTextRef,
          ocrTextRef: shot.evidence.ocrTextRef,
        } : null,
      },
    })))
}

export function isEvidenceOnlyVideoAnalysisResult(result: VideoAnalysisResult): boolean {
  return result.source === 'deterministic_evidence'
}

export function hasReusableVideoAnalysisStructure(result: VideoAnalysisResult): boolean {
  if (result.source !== 'model' && result.source !== 'human_edited') return false
  return result.scenes.some((scene) => !['', 'GENERIC', 'UNKNOWN'].includes(scene.marketingRole.trim().toUpperCase()))
}

export function buildStructureDraft(result: VideoAnalysisResult, locale = 'en'): string {
  const structure = result.scenes
    .map((scene, index) => `${index + 1}. ${controlledMarketingRole(scene.marketingRole)} (${scene.timeRange || (locale.toLowerCase().startsWith('zh') ? '时长待定' : 'duration open')})`)
    .join('\n')
  if (locale.toLowerCase().startsWith('zh')) {
    return [
      '请只沿用以下节奏结构，为当前 Nomi 项目写一份完全原创的宣传视频方案：',
      structure,
      '只复用段落角色、顺序和时长范围。不要复用来源视频的文案、品牌、人物、镜头或视觉资产。',
      '先给出简洁的创意方向，再基于当前项目素材和经过验证的产品能力，输出剧本与可执行分镜。',
    ].join('\n\n')
  }
  return [
    'Please write a completely original promotional-video plan for the current Nomi project using only this pacing structure:',
    structure,
    'Reuse only section roles, order, and duration ranges. Do not reuse source wording, brands, people, shots, or visual assets.',
    'First return a concise creative direction, then a script and executable storyboard grounded in the current project assets and truthful product capabilities.',
  ].join('\n\n')
}

export function resolveVideoAnalysisNodeState(
  tasks: readonly VideoAnalysisTask[],
  nodeId: string,
): { state: VideoAnalysisNodeState; task: VideoAnalysisTask } | null {
  const task = tasks
    .filter((candidate) => candidate.sourceNodeId === nodeId && candidate.status !== 'cancelled' && candidate.status !== 'detached')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
  if (!task) return null
  if (isVideoAnalysisActiveTask(task)) return { state: 'analyzing', task }
  if (task.status === 'completed') return { state: 'complete', task }
  if (ATTENTION_STATUSES.has(task.status)) return { state: 'attention', task }
  return null
}
