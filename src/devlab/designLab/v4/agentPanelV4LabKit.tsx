// 设计实验室 · Agent 面板 v4 · 取景台与共用夹具
//
// **两种取景框，对应定稿画布的两种板**：
//   - `Piece`：只渲**那一个积木**，宽度钉死 390（= 面板宽）。Vocabulary 板与 Composer 板画的
//     就是单个积木的状态阵列，所以实验室这两组也只渲那一件。
//     早先那版把 44 个状态全渲成整块面板，于是接触表三列近乎一样——
//     `v4-composer-idle` 那一格里 composer 只占底部 86px，其余 534px 是和它无关的对话流，
//     用户根本看不出「空闲 / 运行中 / 带引用」差在哪。取景框错了，证据就是假的。
//   - `AgentPanelV4Panel`（组件自带）：Flow 三板 + Rendering + Dark 画的是整块面板，那才渲整块。
//
// 夹具文案一律走 i18n（R15）：实验室渲的是**现役组件**，组件里留硬编码中文会直接把
// `check:i18n` 的欠账基线顶高——实验室不是法外之地。
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type {
  ContextUsage,
  InterventionData,
  QueueRowData,
  TaskCardData,
  ToolReceipt,
  V4Chip,
} from '../../../workbench/ai/v4/agentPanelV4Types'
import type { V4FlowItem } from '../../../workbench/ai/v4/AgentPanelV4Panel'

/** 面板宽度 = 定稿的 390（可拖 320–520，< 320 收成 rail）。 */
export const V4_PANEL_WIDTH = 390
/** 接触表格子高度：装得下最高的一格（计划槽 + 四行勾选）。 */
export const V4_CELL_HEIGHT = 700

/**
 * 单个积木的取景框。给一个浅灰底衬托「无框」的助手文本——
 * 没有底衬时纯文本积木在白底上看不出边界，截图里像什么都没渲。
 */
export function Piece({
  children,
  width = V4_PANEL_WIDTH,
}: {
  children: React.ReactNode
  width?: number
}): JSX.Element {
  return (
    <div
      style={{ width }}
      className="flex flex-col gap-2.5 rounded-nomi border border-nomi-line-soft bg-nomi-paper p-2.5"
      data-v4-piece="true"
    >
      {children}
    </div>
  )
}

export function useV4Fixtures() {
  const { t } = useTranslation()
  return React.useMemo(() => buildFixtures(t), [t])
}

/** 夹具照定稿画布逐格抄：同一句话、同一个数字，才比得出实现有没有走样。 */
function buildFixtures(t: TFunction) {
  const chip = (kind: V4Chip['kind'], label: string): V4Chip => ({ kind, label })

  const context: ContextUsage = {
    used: 62400,
    max: 200000,
    input: t('agentPanelV4.contextInput'),
    output: t('agentPanelV4.contextOutput'),
    reasoning: t('agentPanelV4.contextReasoning'),
    cache: t('agentPanelV4.contextCache'),
    cost: t('agentPanelV4.contextCost'),
  }

  const readTimeline = (over: Partial<ToolReceipt> = {}): ToolReceipt => ({
    label: t('agentPanelV4.fixtureReadTimeline'),
    action: 'timeline',
    status: 'output-available',
    summary: t('agentPanelV4.fixtureReadTimelineSummary'),
    trailing: t('agentPanelV4.fixtureElapsedFast'),
    ...over,
  })

  const receipts = {
    running: readTimeline({ status: 'input-streaming', summary: undefined, trailing: undefined }),
    inputAvailable: readTimeline({ status: 'input-available', trailing: undefined }),
    approvalRequested: readTimeline({ status: 'approval-requested', summary: undefined, trailing: undefined }),
    approvalResponded: readTimeline({ status: 'approval-responded', summary: undefined, trailing: undefined }),
    done: readTimeline({
      input: t('agentPanelV4.fixtureReadTimelineInput'),
      output: t('agentPanelV4.fixtureReadTimelineOutput'),
    }),
    expanded: readTimeline({
      expanded: true,
      input: t('agentPanelV4.fixtureReadTimelineInput'),
      output: t('agentPanelV4.fixtureReadTimelineOutput'),
    }),
    denied: readTimeline({ status: 'output-denied', summary: undefined, trailing: undefined }),
    error: {
      label: t('agentPanelV4.fixtureReadTimeline'),
      action: 'timeline',
      status: 'output-error',
      trailing: t('agentPanelV4.fixtureProjectClosed'),
    } satisfies ToolReceipt,
    skill: {
      label: t('agentPanelV4.fixtureLoadSkill'),
      action: 'skill',
      status: 'output-available',
      summary: t('agentPanelV4.fixtureLoadSkillSummary'),
      trailing: '',
    } satisfies ToolReceipt,
    attachment: {
      label: t('agentPanelV4.fixtureReadAttachment'),
      action: 'attachment',
      status: 'output-available',
      summary: t('agentPanelV4.fixtureReadAttachmentSummary'),
      trailing: '',
    } satisfies ToolReceipt,
    layout: {
      label: t('agentPanelV4.fixtureCollapseInspector'),
      action: 'layout',
      status: 'output-available',
      trailing: '',
      undoable: true,
    } satisfies ToolReceipt,
    videoFailed: {
      label: t('agentPanelV4.fixtureGenVideo'),
      action: 'video',
      status: 'output-error',
      trailing: t('agentPanelV4.taskStatus.failed'),
    } satisfies ToolReceipt,
    stopped: {
      label: t('agentPanelV4.fixtureGenImages'),
      action: 'image',
      status: 'output-denied',
      summary: '2 / 4',
      trailing: t('agentPanelV4.fixtureStopped'),
    } satisfies ToolReceipt,
    readDoc: {
      label: t('agentPanelV4.fixtureReadDoc'),
      action: 'document',
      status: 'output-available',
      summary: t('agentPanelV4.fixtureReadDocSummary'),
      trailing: t('agentPanelV4.fixtureElapsedRead'),
      input: t('agentPanelV4.fixtureReadTimelineInput'),
      output: t('agentPanelV4.fixtureReadTimelineOutput'),
    } satisfies ToolReceipt,
    draftShots: {
      label: t('agentPanelV4.fixtureDraftShots'),
      action: 'plan',
      status: 'input-streaming',
    } satisfies ToolReceipt,
    skillShots: {
      label: t('agentPanelV4.fixtureLoadSkill'),
      action: 'skill',
      status: 'output-available',
      summary: `${t('agentPanelV4.skillShots')} /shots`,
      trailing: '',
    } satisfies ToolReceipt,
    draftEdits: {
      label: t('agentPanelV4.fixtureDraftEdits'),
      action: 'plan',
      status: 'output-available',
      trailing: '',
    } satisfies ToolReceipt,
  }

  const tasks: Record<string, TaskCardData> = {
    queued: {
      title: t('agentPanelV4.fixtureGenImageOne'),
      action: 'image',
      status: 'queued',
      trailing: t('agentPanelV4.fixtureQueuePos'),
    },
    running: {
      title: t('agentPanelV4.fixtureGenImageOne'),
      action: 'image',
      status: 'running',
      trailing: t('agentPanelV4.fixtureRunningSeconds'),
      excerpt: t('agentPanelV4.fixtureExcerpt'),
      params: ['GPT Image 2', '16:9', '2K'],
      cost: '≈ ¥0.12',
      progress: 45,
    },
    complete: {
      title: t('agentPanelV4.fixtureGenImagesThree'),
      action: 'image',
      status: 'complete',
      trailing: t('agentPanelV4.fixtureCostThree'),
      candidates: [{ tag: t('agentPanelV4.adopt'), adopted: true }, { tag: '2' }, { tag: '3' }],
      footnote: t('agentPanelV4.fixtureAdoptHint'),
      undoable: true,
    },
    failed: {
      title: t('agentPanelV4.fixtureGenVideo'),
      action: 'video',
      status: 'failed',
      error: t('agentPanelV4.fixtureVendorFailure'),
      errorAction: t('agentPanelV4.fixtureRetryOtherModel'),
    },
    stopped: {
      title: t('agentPanelV4.fixtureGenVideo'),
      action: 'video',
      status: 'stopped',
      trailing: t('agentPanelV4.fixtureFramesDone'),
    },
    fourRefs: {
      title: t('agentPanelV4.fixtureGenImages'),
      action: 'image',
      status: 'running',
      trailing: t('agentPanelV4.fixtureCostFour'),
      params: ['NanoBanana 2', '16:9', '2K'],
      // 角标逐字照画布 FlowGeneration 板：前两张已完成、第三张在跑、第四张排队。
      candidates: [
        { tag: '1 ✓' },
        { tag: '2 ✓', adopted: true },
        { tag: '3 …', pending: true },
        { tag: `4 ${t('agentPanelV4.taskStatus.queued')}`, pending: true },
      ],
      progress: 50,
      footnote: t('agentPanelV4.fixtureOnCanvasHint'),
      footnoteTrailing: t('agentPanelV4.fixtureCostSpent'),
    },
    trimApplied: {
      title: t('agentPanelV4.fixtureTrimAndShift'),
      action: 'edit',
      status: 'complete',
      trailing: t('agentPanelV4.fixtureNoCharge'),
      footnote: t('agentPanelV4.fixtureTwoEditsUndo'),
      undoable: true,
    },
  }

  const slots: Record<string, InterventionData> = {
    irreversible: {
      kind: 'approval-irreversible',
      title: t('agentPanelV4.slotDeleteNodes'),
      badge: t('agentPanelV4.slotIrreversible'),
      summary: t('agentPanelV4.slotDeleteSummary'),
      scope: t('agentPanelV4.slotScopeOnce'),
      confirmLabel: t('agentPanelV4.slotDelete'),
    },
    reversible: {
      kind: 'approval-reversible',
      title: t('agentPanelV4.slotTrim'),
      badge: t('agentPanelV4.slotReversible'),
      scope: t('agentPanelV4.slotTrimScope'),
    },
    rejectReason: {
      kind: 'reject-reason',
      title: t('agentPanelV4.slotTrim'),
      scope: t('agentPanelV4.slotRejectReason'),
      reasonPlaceholder: t('agentPanelV4.slotRejectSample'),
    },
    spend: {
      kind: 'spend',
      title: t('agentPanelV4.slotSpendTitle'),
      badge: t('agentPanelV4.slotSpendBadge'),
      params: ['Kling O1', '4 × 3s', 'std', '¥1.20'],
      confirmLabel: t('agentPanelV4.slotGenerate'),
      alternateLabel: t('agentPanelV4.slotSwitchModel'),
    },
    question: {
      kind: 'question',
      title: t('agentPanelV4.slotQuestionTitle'),
      options: [
        t('agentPanelV4.slotOptionLandscape'),
        t('agentPanelV4.slotOptionPortrait'),
        t('agentPanelV4.slotOptionSquare'),
      ],
      selectedOption: 0,
    },
    plan: {
      kind: 'plan',
      title: t('agentPanelV4.slotPlanTitle'),
      badge: t('agentPanelV4.fixtureCostFour'),
      plan: [
        { label: t('agentPanelV4.slotPlanShot1'), detail: '3.0s', checked: true },
        { label: t('agentPanelV4.slotPlanShot2'), detail: '4.0s', checked: true },
        { label: t('agentPanelV4.slotPlanShot3'), detail: '4.0s', checked: false },
        { label: t('agentPanelV4.slotPlanShot4'), detail: '4.0s', checked: true },
      ],
      confirmLabel: t('agentPanelV4.slotPlanConfirm'),
      alternateLabel: t('agentPanelV4.slotPlanAlternate'),
    },
    credential: {
      kind: 'credential',
      title: t('agentPanelV4.slotCredentialTitle'),
      scope: t('agentPanelV4.slotCredentialScope'),
      confirmLabel: t('agentPanelV4.slotCredentialConfirm'),
      alternateLabel: t('agentPanelV4.slotCredentialAlternate'),
    },
    deviation: {
      kind: 'deviation',
      title: t('agentPanelV4.slotDeviationTitle'),
      options: [t('agentPanelV4.slotDeviationDraw'), t('agentPanelV4.slotDeviationSkip')],
      selectedOption: 1,
    },
    spendOneClip: {
      kind: 'spend',
      title: t('agentPanelV4.slotSpendOneTitle'),
      badge: t('agentPanelV4.slotSpendBadge'),
      params: ['Kling O1', '3s', 'std', '16:9', '¥0.90'],
      scope: t('agentPanelV4.slotSpendOneScope'),
      confirmLabel: t('agentPanelV4.slotGenerate'),
      alternateLabel: t('agentPanelV4.slotSwitchModel'),
    },
    threeEdits: {
      kind: 'approval-reversible',
      title: t('agentPanelV4.slotThreeEdits'),
      badge: t('agentPanelV4.slotReversible'),
      plan: [
        { label: t('agentPanelV4.slotEditTransition'), checked: true },
        { label: t('agentPanelV4.slotEditCaption'), checked: true },
        { label: t('agentPanelV4.slotEditVolume'), checked: true },
      ],
    },
  }

  const queues: Record<string, readonly QueueRowData[]> = {
    mixed: [
      { title: t('agentPanelV4.queueOne'), status: 'running' },
      {
        title: t('agentPanelV4.queueTwo'),
        status: 'queued',
        actions: [t('agentPanelV4.queueJumpAhead')],
        destructiveAction: t('agentPanelV4.queueDelete'),
      },
      {
        title: t('agentPanelV4.queueThree'),
        status: 'queued',
        actions: [t('agentPanelV4.queueJumpAhead')],
        destructiveAction: t('agentPanelV4.queueDelete'),
      },
    ],
    interrupt: [
      { title: t('agentPanelV4.queueOne'), status: 'complete' },
      { title: t('agentPanelV4.queueTwo'), status: 'running', actions: [t('agentPanelV4.queueInterrupt')] },
    ],
    one: [{ title: t('agentPanelV4.queueMakeVideo'), status: 'queued', actions: ['1'], destructiveAction: t('agentPanelV4.queueDelete') }],
  }

  const chips = {
    attachment: chip('file', t('agentPanelV4.fixtureAttachmentName')),
    skill: chip('skill', t('agentPanelV4.fixtureSkillChip')),
    clip: chip('clip', t('agentPanelV4.fixtureClipChip')),
    shot: chip('clip', t('agentPanelV4.fixtureShotChip')),
  }

  /** Flow 三板的完整对话流，逐条对着画布抄。 */
  const flows: Record<string, readonly V4FlowItem[]> = {
    creation: [
      { kind: 'user', text: t('agentPanelV4.fixtureUserRead') },
      { kind: 'tool', receipt: receipts.readDoc },
      { kind: 'assistant', text: t('agentPanelV4.fixtureAssistantLongest'), status: 'complete' },
      { kind: 'user', text: t('agentPanelV4.fixtureUserShots') },
      { kind: 'tool', receipt: receipts.skillShots },
      { kind: 'tool', receipt: receipts.draftShots },
      { kind: 'assistant', text: t('agentPanelV4.fixtureAssistantPlan'), status: 'streaming' },
    ],
    generation: [
      { kind: 'user', text: t('agentPanelV4.fixtureUserRefs') },
      { kind: 'task', task: tasks.fourRefs },
      { kind: 'user', text: t('agentPanelV4.fixtureUserToVideo'), chips: [chips.shot] },
    ],
    preview: [
      { kind: 'user', text: t('agentPanelV4.fixtureUserTrim'), chips: [chips.clip] },
      { kind: 'tool', receipt: receipts.done },
      { kind: 'assistant', text: t('agentPanelV4.fixtureAssistantTrim'), status: 'complete' },
      { kind: 'task', task: tasks.trimApplied },
      { kind: 'user', text: t('agentPanelV4.fixtureUserThreeEdits') },
      { kind: 'tool', receipt: receipts.draftEdits },
    ],
    rendering: [{ kind: 'assistant', text: t('agentPanelV4.fixtureMarkdown'), status: 'complete' }],
    dark: [
      { kind: 'user', text: t('agentPanelV4.fixtureUserTrim') },
      { kind: 'tool', receipt: receipts.done },
      { kind: 'assistant', text: t('agentPanelV4.fixtureAssistantTrim'), status: 'complete' },
      { kind: 'task', task: tasks.complete },
      { kind: 'task', task: tasks.failed },
    ],
  }

  return { context, receipts, tasks, slots, queues, chips, flows, t }
}
