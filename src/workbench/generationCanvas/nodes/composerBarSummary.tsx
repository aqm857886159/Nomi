import type React from 'react'
import { IconStack2 } from '@tabler/icons-react'
import { ICON_TIERS } from '../../../design'
import type { ArchetypeMode } from '../../../../electron/shared/modelArchetypes'
import { isLayerSplitMode, requestedLayerCount, LAYER_COUNT_COST_REMINDER_AT, LAYER_COUNT_KEY } from '../../../../electron/shared/modelArchetypes/modeForInputs'
import { composerHeadlineParts, layerSplitHeadlineParts, type HeadlinePart } from './composerHeadlineSummary'
import { layerSplitReminderAmount } from './layerSplitComposerState'
import type { DynamicModelControl } from './controls/parameterControlModel'

type Translate = (key: string, values?: Record<string, unknown>) => string

/** 底栏摘要那一格交给 InlineParameterBar 的几项（原样展开进它的 props）。 */
export type ComposerBarSummary = {
  summaryOverride?: string
  summaryParts?: readonly HeadlinePart[]
  summaryIcon?: React.ReactNode
  summaryStatic?: boolean
  controlNotices?: Readonly<Record<string, React.ReactNode>>
}

/**
 * 底栏摘要那一格报什么（导入工作流 / 图层分离 / 档案模型三种口径收在这一处）。从 NodeParameterControls 搬出（按职责拆巨壳），行为不变。
 *
 * - 导入的 ComfyUI 工作流：参数名是作者随手起的（采样步数/帧率/Float (duration)…），把当前值串成 pill（`15 · 24`）没人认得出
 *   那是自己勾的东西，改成报名字+条数。判据（调用方算 `workflowParamCount`）取 meta.comfyWorkflowImport 是否存在——它只由导入流程写入，档案模型不会有。
 * - v1.1 底栏：档案模型的 pill 只报「最影响结果和价格的两个值」（视频=比例+时长、图=比例+清晰度），其余参数一个不少、仍在同一块弹层里。
 *   走 summaryOverride 这条**已有的**缝（导入工作流那支在用同一个入口），不新造第二条摘要通路。工作流的口径优先——它连「值串出来没人认得」
 *   这个更基本的问题都还没解决，轮不到再挑两个。摘要按整值给出（带退让顺序）：底栏挤时只退这一格、一个值不截半截（K4）。
 * - 图层分离（板 2026-11-26-layer-split · layers.composer-cell / pro-fixed）：这一格报「图层分离 · 层数 · 清晰度」、带叠层图标；
 *   层数写死的模型（没有层数参数）报「最多 N 层」、摆成不可点的静态格。比例不发（分离时比例返回 400），所以格里没有比例。
 */
export function composerBarSummary({ t, workflowParamCount, isImageLike, isVideoLike, controls, meta, mode, sendCost }: {
  t: Translate
  /** 导入工作流时面板里的参数条数；不是导入工作流（或一个参数都没有）= undefined。 */
  workflowParamCount: number | undefined
  isImageLike: boolean
  isVideoLike: boolean
  controls: readonly DynamicModelControl[]
  meta: Record<string, unknown>
  mode: ArchetypeMode | null
  sendCost: Parameters<typeof layerSplitReminderAmount>[0]
}): ComposerBarSummary {
  const workflowSummary = workflowParamCount !== undefined ? t('generationCommon.parameters.workflowParams', { count: workflowParamCount }) : undefined
  const layerSplit = mode && isLayerSplitMode(mode) && mode.layerSplit ? layerSplitHeadlineParts({
    modeName: t('generationCommon.quickActions.actions.layerSplit'),
    controls,
    meta,
    maxLayers: mode.layerSplit.maxLayers,
    formatLayers: (count) => t('generationCommon.layerSplitComposer.cellLayers', { count: Number(count) }),
    formatUpTo: (count) => t('generationCommon.layerSplitComposer.cellUpTo', { count }),
    autoLabel: t('generationCommon.parameters.auto'),
  }) : null
  // 层数多就贵（≥ 50 层，裁定 4）：只提醒、不拦；数随当前层数，发送键上有约价就带上（裸数，句子自己说「约」）。
  const layerCount = layerSplit && mode ? requestedLayerCount(mode, meta) : null
  const reminder = layerSplitReminderAmount(sendCost)
  const sendAmount = reminder
    ? reminder.unit === 'credits' ? t('generationCommon.layerSplitComposer.creditsAmount', { value: reminder.value }) : reminder.value
    : ''
  const layerNotices = layerSplit && !layerSplit.fixed && layerCount !== null && layerCount >= LAYER_COUNT_COST_REMINDER_AT
    ? { [LAYER_COUNT_KEY]: sendAmount
      ? t('generationCommon.layerSplitComposer.costReminderEstimate', { count: layerCount, amount: sendAmount })
      : t('generationCommon.layerSplitComposer.costReminder', { count: layerCount }) }
    : undefined
  const headlineParts = workflowSummary ? [] : layerSplit ? layerSplit.parts : composerHeadlineParts({
    isImageLike,
    isVideoLike,
    controls,
    meta,
    formatSeconds: (value) => t('generationCommon.composerBarV1.seconds', { value }),
    autoLabel: t('generationCommon.parameters.auto'),
  })
  const summaryOverride = workflowSummary ?? (headlineParts.length ? headlineParts.map((part) => part.text).join(' · ') : undefined)
  return {
    ...(summaryOverride !== undefined ? { summaryOverride } : {}),
    ...(headlineParts.length ? { summaryParts: headlineParts } : {}),
    ...(layerSplit ? {
      summaryIcon: <IconStack2 size={ICON_TIERS.corner.size} stroke={ICON_TIERS.corner.stroke} data-layer-split-icon="true" />,
      summaryStatic: layerSplit.fixed,
      ...(layerNotices ? { controlNotices: layerNotices } : {}),
    } : {}),
  }
}
