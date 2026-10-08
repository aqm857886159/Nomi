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
  /** 回执还剩多久（只在 saved 时有）：状态条据此在最后一小段淡出；开了「减少动态效果」就不淡出，到点直接消失。 */
  active: boolean
  previewLabel: string
}

/**
 * 「已保存到项目」这句话能待多久。
 *
 * 它是一次**落地回执**，不是节点的常驻状态：图已经在画面里了，那才是「保存成功」最强的证据。
 * 2026-09-11 用户实测反馈——每一个做完的图片节点下面都永久挂着这一条，
 * 一屏十几个节点就是十几条重复的废话，把真正要读的东西（失败、还在跑的那几个）淹掉。
 *
 * 用「完成时刻 + 窗口」而不是一个 `seen` 标记：窗口是**从数据派生**的，
 * 重开项目、切面、换外壳都不会让一条早就该消失的回执重新冒出来，也不用为它存一份状态。
 */
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
  const failed = !queued && node.status === 'error'
  if (!active && !failed) return null
  const stage = queued ? 'queued' : isGenerationProgressStage(node.progress?.phase)
    ? node.progress.phase : node.status === 'queued' ? 'queued' : 'generating'
  const startedAt = node.runs?.[0]?.startedAt ?? node.progress?.updatedAt
  const elapsedMs = startedAt === undefined ? undefined : Math.max(0, now - startedAt)
  const phase = failed ? 'failed' : GENERATION_PHASE[stage]
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
    phase, active, saved: false, percent, previewLabel,
    late: active && stage === 'still-generating',
    message: failed ? classifyGenerationError(node.error || '').reason
      : narrateProgress(stage, { ...context, elapsedMs, ...(queueAhead === undefined || queueAhead === 0 ? {} : { queueAhead }) }),
  }
}
