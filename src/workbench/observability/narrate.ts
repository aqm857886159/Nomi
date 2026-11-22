// 人话翻译层(harness 总方案 §7.2:narrate 穷举注册表)。
// 纪律:进度/错误展示组件**只准经 narrate 取文案**,字面量文案 = review 必拒;
// Record 穷举 → 新增 phase 不补人话直接 typecheck 红(结构性防"底层在动、界面失语")。
// S2 先覆盖生成进度域;错误 hint(classifyGenerationError 七段)按总方案在 S4 迁入。
// 设计系统铁律呼应:No fake progress——没有真实百分比就不给 percent,用"已等 N 秒"说真话。
import i18n from '../../i18n'
import type { TranslationKey } from '../../i18n/translationKey'

export type GenerationProgressPhase =
  | 'queued' //      已入队,还没开始
  | 'resolving' //   正在确认模型与参数(catalog 解析)
  | 'requesting' //  正在把任务发给模型(vendor HTTP 出门)
  | 'waiting' //     模型已接单,排队中(拿到 taskId,首个非终态)
  | 'generating' //  模型生成中(轮询进行时)
  | 'still-generating' // 超过常规时长仍在生成(软超时后,后台继续等结果)
  | 'retrying' //    网络波动重试中
  | 'finalizing' //  正在保存结果(本地化/归一)
  | 'comfyui-node' // ComfyUI ws 逐节点进度(P 轨:真实百分比,不违背 No fake progress)
  | 'comfyui-queued' // ComfyUI 服务器队列排队中(ws status + /queue 位次)

export type ProgressNarrationContext = {
  elapsedMs?: number
  attempt?: number
  maxAttempts?: number
  /** comfyui-node：当前执行的节点 class + 第几/共几个。 */
  currentClass?: string
  startedNodes?: number
  totalNodes?: number
  /** comfyui-queued：前面还有几个任务。 */
  queueAhead?: number
}

/** C1: backend stages stay stable; this is the sole user-facing phase vocabulary. */
export type GenerationFeedbackPhase = 'queued' | 'submitting' | 'generating' | 'finalizing' | 'failed'

export const GENERATION_PHASE: Record<GenerationProgressPhase, GenerationFeedbackPhase> = {
  queued: 'queued',
  'comfyui-queued': 'queued',
  resolving: 'submitting',
  requesting: 'submitting',
  waiting: 'submitting',
  generating: 'generating',
  'still-generating': 'generating',
  retrying: 'generating',
  'comfyui-node': 'generating',
  finalizing: 'finalizing',
}

export function isGenerationProgressStage(value: string | undefined): value is GenerationProgressPhase {
  return value !== undefined && Object.prototype.hasOwnProperty.call(GENERATION_PHASE, value)
}

function queuedNarration(ctx: ProgressNarrationContext): string {
  return Number.isInteger(ctx.queueAhead) && ctx.queueAhead! >= 0
    ? i18n.t('generationCommon.observability.progress.comfyQueuedAhead', { count: ctx.queueAhead })
    : i18n.t('generationCommon.observability.progress.queued')
}

function generatingNarration(ctx: ProgressNarrationContext): string {
  return typeof ctx.elapsedMs === 'number' && Number.isFinite(ctx.elapsedMs) && ctx.elapsedMs >= 0
    ? i18n.t('generationCommon.observability.progress.generatingElapsed', { seconds: Math.floor(ctx.elapsedMs / 1000) })
    : i18n.t('generationCommon.observability.progress.generating')
}

const NARRATE_PROGRESS: Record<GenerationProgressPhase, (ctx: ProgressNarrationContext) => string> = {
  queued: queuedNarration,
  resolving: () => i18n.t('generationCommon.observability.progress.submitting'),
  requesting: () => i18n.t('generationCommon.observability.progress.submitting'),
  waiting: () => i18n.t('generationCommon.observability.progress.submitting'),
  generating: generatingNarration,
  'still-generating': (ctx) => typeof ctx.elapsedMs === 'number' && Number.isFinite(ctx.elapsedMs)
    ? i18n.t('generationCommon.observability.progress.stillGeneratingElapsed', { minutes: Math.max(0, Math.floor(ctx.elapsedMs / 60000)) })
    : i18n.t('generationCommon.observability.progress.stillGenerating'),
  retrying: generatingNarration,
  finalizing: () => i18n.t('generationCommon.observability.progress.finalizing'),
  'comfyui-node': generatingNarration,
  'comfyui-queued': queuedNarration,
}

export function narrateProgress(stage: GenerationProgressPhase, ctx: ProgressNarrationContext = {}): string {
  return NARRATE_PROGRESS[stage](ctx)
}

import {
  failureCopyOf,
  type FailureText,
  type GenerationErrorAction,
  type GenerationErrorKind,
} from '../../../electron/shared/generationFailure'

// 失败的类别 / 动作 / 判据全在 electron/shared/generationFailure（唯一的家）；这里只管把「类别」翻成界面语言的词条。
export type { GenerationErrorAction, GenerationErrorKind }


/**
 * `params` 给需要说出**具体事实**的类别插值（目前只有 model-kind-mismatch：要说清「哪个模型、
 * 登记成什么、这里要什么」）。泛泛一句「类型不对」等于没说——用户得知道改成哪个才算数。
 * 不需要插值的类别原样返回，词表仍是唯一文案来源（P1）。
 */
export function narrateGenerationError(
  kind: GenerationErrorKind,
  params?: Record<string, string>,
): { reason: string; hint: string } {
  const copy = failureCopyOf(kind, params)
  return { reason: narrateFailureText(copy.reason), hint: narrateFailureText(copy.hint) }
}

/** 词条键 + 插值 → 界面语言的一句话（模型类别插值在这里翻成人话）；`text` 原样。 */
export function narrateFailureText(text: FailureText): string {
  if ('text' in text) return text.text
  const params = text.params
    ? Object.fromEntries(Object.entries(text.params).map(([name, value]) => [name, typeof value === 'string' ? value : narrateModelKind(value.modelKind)]))
    : undefined
  return i18n.t(text.key as TranslationKey, params)
}

/** kind → 人话类别名（「图片」「视频」…）。单源复用 runtime 词表，错误卡与空目录提示说法一致。 */
export function narrateModelKind(kind: string): string {
  return i18n.t(`runtime.modelCatalog.kind.${kind}` as 'runtime.modelCatalog.kind.image', {
    defaultValue: kind,
  })
}

const ACTION_KEY: Record<GenerationErrorAction, string> = {
  'switch-model': 'switchModel',
  'switch-same-capability': 'switchSameCapability',
  'open-model-access': 'modelAccess',
  'fix-model-kind': 'fixModelKind',
  retry: 'retry',
  reconcile: 'reconcile',
  'view-task': 'viewTask',
  // 画布任务（不是制作 Run）的「去重新取回」：错误卡按任务来源把 view-task 换成它（NodeErrorReport），点了回到可找回面板。
  'open-recoverable': 'openRecoverable',
  'release-regenerate': 'releaseRegenerate',
}

/** 动作按钮文案（次动作用 `.alt` 变体，如「仍要重试」——避免和主按钮读起来一样重）。
 *  `params` 供需要点名的动作插值（fix-model-kind 要说「改成**图片**」，光说「改类型」用户还得再想一步）。 */
export function narrateErrorActionLabel(
  action: GenerationErrorAction,
  variant: 'primary' | 'secondary',
  params?: Record<string, string>,
): string {
  return i18n.t(
    `generationCommon.observability.action.${ACTION_KEY[action]}.${variant === 'secondary' ? 'alt' : 'main'}`,
    params,
  )
}

/** Queue history outcomes stay in the narration owner too; cancellation is not failure. */
export function narrateTaskOutcome(state: string, recoverable = false): string {
  if (recoverable) return i18n.t('taskCenter.row.recoverable')
  if (state === 'cancelled') return i18n.t('taskCenter.row.cancelled')
  if (state === 'error') return i18n.t('taskCenter.row.failed')
  if (state === 'success') return i18n.t('taskCenter.groups.done')
  return narrateProgress(state === 'queued' ? 'queued' : 'generating')
}
