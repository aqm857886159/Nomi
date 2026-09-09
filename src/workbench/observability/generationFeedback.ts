import i18n from '../../i18n'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { classifyGenerationError } from './classifyError'
import { GENERATION_PHASE, isGenerationProgressStage, narrateProgress, type GenerationFeedbackPhase } from './narrate'

export type GenerationFeedback = {
  phase: GenerationFeedbackPhase
  message: string
  percent?: number
  late: boolean
  saved: boolean
  active: boolean
  previewLabel: string
}

/** Cache the exact narration result, so all three surfaces consume one call per node/tick/locale. */
const cache = new WeakMap<object, { key: string; feedback: GenerationFeedback | null }>()

export function generationFeedback(node: GenerationCanvasNode, now: number, queued = false, queueAhead?: number): GenerationFeedback | null {
  const key = `${Math.floor(now / 1000)}:${queued}:${queueAhead}:${i18n.resolvedLanguage}`
  const identity = node
  const cached = cache.get(identity)
  if (cached?.key === key) return cached.feedback
  const feedback = deriveFeedback(node, now, queued, queueAhead)
  cache.set(identity, { key, feedback })
  return feedback
}

function deriveFeedback(node: GenerationCanvasNode, now: number, queued: boolean, queueAhead?: number): GenerationFeedback | null {
  const active = queued || node.status === 'queued' || node.status === 'running'
  const saved = !queued && node.status === 'success'
  const failed = !queued && node.status === 'error'
  if (!active && !saved && !failed) return null
  const stage = queued ? 'queued' : isGenerationProgressStage(node.progress?.phase)
    ? node.progress.phase : node.status === 'queued' ? 'queued' : 'generating'
  const startedAt = node.runs?.[0]?.startedAt ?? node.progress?.updatedAt
  const elapsedMs = startedAt === undefined ? undefined : Math.max(0, now - startedAt)
  const phase = failed ? 'failed' : saved ? 'finalizing' : GENERATION_PHASE[stage]
  const percent = active && phase === 'generating' && typeof node.progress?.percent === 'number'
    && Number.isFinite(node.progress.percent) && node.progress.percent >= 0 && node.progress.percent <= 100
    ? node.progress.percent : undefined
  const context = node.progress?.narrationContext
  const step = context?.startedNodes
  const total = context?.totalNodes
  const previewLabel = Number.isInteger(step) && Number.isInteger(total) && step! > 0 && total! >= step!
    ? i18n.t('generationCommon.observability.progress.previewStep', { current: step, total })
    : i18n.t('generationCommon.observability.progress.preview')
  return {
    phase, active, saved, percent, previewLabel,
    late: active && stage === 'still-generating',
    message: failed ? classifyGenerationError(node.error || '').reason
      : saved ? i18n.t('generationCommon.observability.progress.saved')
      : narrateProgress(stage, { ...context, elapsedMs, ...(queueAhead === undefined || queueAhead === 0 ? {} : { queueAhead }) }),
  }
}
