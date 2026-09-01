// 画布助手对话线:用户气泡(右) → AI 发言 → 提议/已应用/出入 卡 → AI 总结。
// 助手「发言」与创作助手共用 AssistantMessageView(单一渲染真相源,守 P1):同身份行 + 真 markdown +
// token 字号。本组件只负责「编排」(消息/卡片的先后顺序 + 卡片的标题/状态徽标),不再画小点时间轴导轨
// ——两个助手从此长得一致(用户反馈:小点时间轴 vs 气泡两套设计不一致)。提议卡用 flat 去框。
// 卡片按 anchorMessageId 时序内联:锚定到某条消息的卡紧跟该消息之后渲染(叙述→卡→总结,位置=时间)。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../utils/cn'
import { IconCornerDownLeft } from '@tabler/icons-react'
import { WorkbenchButton } from '../../../design'
import { StaleConversationDivider } from '../../ai/staleConversationDivider'
import { AssistantMessageView, UserMessageBubble } from '../../ai/AssistantMessageView'
import { AssistantErrorCard } from '../../ai/AssistantErrorCard'
import AgentPlanCard, { summarizeAgentPlan } from './AgentPlanCard'
import CommittedProposalCard from './CommittedProposalCard'
import ReconcileDeviationCard from './ReconcileDeviationCard'
import { summarizeToolCall, describeToolCallDetail } from './toolCallSummary'
import type { CommittedProposalRecord } from '../agent/proposalUndo'
import type { ReconcileDeviation } from '../agent/reconcile'
import type { PendingToolCallLike } from './agentPlanSummary'
import type { WorkbenchAiMessage } from '../../ai/workbenchAiTypes'
import { assistantTimelineIsEmpty } from './assistantTimelineState'
import { orderAssistantTimelineEntries } from './assistantTimelineChronology'
import type { CanvasAssistantTimelineAnchor } from '../agent/canvasAssistantTimelineAnchor'
import {
  TimelineEditPlanCard,
  type TimelineAppliedRecord,
  type TimelinePlanPreviewRecord,
  type TimelineToolCallLike,
} from './TimelineEditPlanCard'

type StepTone = 'done' | 'active' | 'warn'

function asPlanId(args: unknown): string {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return ''
  const planId = (args as Record<string, unknown>).planId
  return typeof planId === 'string' ? planId : ''
}

/** 动作块的标题 + 状态徽标（等你确认 / ✓已应用 / ⚠有出入）——去掉时间轴后,徽标即「执行进度」可见性来源。 */
function StepHeader({ title, badge, badgeTone }: { title: string; badge?: string; badgeTone?: StepTone }): JSX.Element {
  return (
    <div className={cn('flex items-center gap-2 min-w-0')}>
      <span className={cn('text-nomi-ink text-body-sm font-semibold truncate')}>{title}</span>
      {badge ? (
        <span
          className={cn(
            'text-micro shrink-0',
            badgeTone === 'done' && 'text-workbench-success-ink',
            badgeTone === 'active' && 'text-nomi-accent',
            badgeTone === 'warn' && 'text-[var(--nomi-snap-tag)]',
          )}
        >
          {badge}
        </span>
      ) : null}
    </div>
  )
}

export type AssistantTimelineProps = {
  messages: WorkbenchAiMessage[]
  staleBoundaryId: string | null
  /** 空会话建议点击 → 发消息。 */
  onSuggestion: (text: string) => void
  /** 待确认工具调用(本组件内部折叠 create+connect 成计划步骤)。 */
  pendingToolCalls: readonly PendingToolCallLike[]
  approveCalls: (requests: { toolCallId: string; overrides?: Record<string, unknown> }[]) => void
  rejectPending: (toolCallId: string) => void
  /** 上一笔已应用提议(回执步骤)。 */
  committedProposal: CommittedProposalRecord | null
  /** 对账出入(警示步骤,与 committed 互斥显示)。 */
  deviationReport: ReconcileDeviation[] | null
  /** 时序内联:对账卡锚定到本轮「卡前气泡」(与 committed 同源)。 */
  deviationAnchor: CanvasAssistantTimelineAnchor | null
  onDeviationUndo: () => void
  onDeviationDismiss: () => void
  /** 让 AI 用支持的方式重连没接上的边(完整版重设计)。 */
  onDeviationAiFix: () => void
  /** 镜级画面校验(verify)的内容偏差(Stage 1,与结构对账分开:不同生命周期、无撤销)。空/null 不显。 */
  contentDeviations?: ReconcileDeviation[] | null
  /** 半自动闭环预算耗尽 → 内容偏差卡落「已尽力」、不再给「让 AI 修」。 */
  contentExhausted?: boolean
  onContentAiFix?: () => void
  onContentDismiss?: () => void
  /** 错误卡「重试」= 重发上一条用户消息(undefined 则不显重试按钮)。 */
  onRetry?: () => void
  timelinePlanPreviews?: TimelinePlanPreviewRecord[]
  timelineApplied?: TimelineAppliedRecord | null
  onTimelineUndo?: () => void
  threadBottomRef: React.RefObject<HTMLDivElement>
}

export default function AssistantTimeline(props: AssistantTimelineProps): JSX.Element {
  const { t } = useTranslation()
  const { messages, staleBoundaryId, pendingToolCalls } = props
  const emptySuggestions = [
    t('generationCommon.assistant.suggestionShots'),
    t('generationCommon.assistant.suggestionPrompt'),
    t('generationCommon.assistant.suggestionConnect'),
  ]
  // memo:流式吐字会每帧重渲染本组件,但计划只随 pendingToolCalls 变——不 memo 则每帧重算 +
  // 产出新 plan 引用,连带 React.memo(AgentPlanCard) 失效、8 节点计划卡每帧重画(卡顿放大)。
  const plan = React.useMemo(() => summarizeAgentPlan(pendingToolCalls), [pendingToolCalls])
  const planCallIds = new Set([plan?.createCallId, plan?.connectCallId].filter(Boolean) as string[])
  const timelinePending = pendingToolCalls.filter(
    (call): call is PendingToolCallLike & TimelineToolCallLike => call.toolName === 'apply_edit_plan' || call.toolName === 'undo_timeline_edit',
  )
  const timelinePendingIds = new Set(timelinePending.map((call) => call.toolCallId))
  const remaining = (plan ? pendingToolCalls.filter((call) => !planCallIds.has(call.toolCallId)) : pendingToolCalls)
    .filter((call) => !timelinePendingIds.has(call.toolCallId))

  // 活动卡(回执/出入/待确认)。每项一个竖排动作块(标题徽标 + flat 卡);anchor=它锚定到的消息 id。
  const liveBlocks: {
    key: string
    anchorMessageId?: string
    anchorTextOffset?: number
    render: () => React.ReactNode
  }[] = []
  if (props.deviationReport) {
    liveBlocks.push({
      key: 'deviation',
      ...props.deviationAnchor,
      render: () => (
        <div className={cn('flex flex-col gap-1')}>
          <StepHeader
            title={t('generationCommon.assistant.deviationTitle', { count: props.deviationReport!.length })}
            badge="⚠"
            badgeTone="warn"
          />
          <ReconcileDeviationCard
            flat
            deviations={props.deviationReport!}
            onUndoAll={props.onDeviationUndo}
            onDismiss={props.onDeviationDismiss}
            onAiFix={props.onDeviationAiFix}
          />
        </div>
      ),
    })
  } else if (props.committedProposal) {
    liveBlocks.push({
      key: `committed-${props.committedProposal.proposalId}`,
      anchorMessageId: props.committedProposal.anchorMessageId,
      anchorTextOffset: props.committedProposal.anchorTextOffset,
      render: () => <CommittedProposalCard flat record={props.committedProposal!} />,
    })
  }
  const appliedPlanId = props.timelineApplied?.planId
  for (const preview of (props.timelinePlanPreviews ?? []).filter((item) => {
    const itemPlanId = asPlanId(item.args)
    return !appliedPlanId || itemPlanId !== appliedPlanId
  })) {
    liveBlocks.push({
      key: `timeline-preview-${preview.toolCallId}`,
      anchorMessageId: preview.anchorMessageId,
      render: () => <TimelineEditPlanCard mode="preview" call={preview} result={preview.result} />,
    })
  }
  for (const call of timelinePending) {
    liveBlocks.push({
      key: `timeline-pending-${call.toolCallId}`,
      anchorMessageId: call.anchorMessageId,
      render: () => (
        <TimelineEditPlanCard
          mode="pending"
          call={call}
          onApprove={(toolCallId) => props.approveCalls([{ toolCallId }])}
          onReject={props.rejectPending}
        />
      ),
    })
  }
  if (props.timelineApplied) {
    liveBlocks.push({
      key: `timeline-applied-${props.timelineApplied.planId}`,
      anchorMessageId: props.timelineApplied.anchorMessageId,
      render: () => <TimelineEditPlanCard mode="applied" applied={props.timelineApplied!} onUndo={props.onTimelineUndo} />,
    })
  }
  // 镜级画面校验偏差(Stage 1):独立块(无锚,挂线程底部),与结构对账互不干扰。
  if (props.contentDeviations && props.contentDeviations.length > 0) {
    liveBlocks.push({
      key: 'content-deviation',
      render: () => (
        <div className={cn('flex flex-col gap-1')}>
          <StepHeader
            title={t('generationCommon.assistant.contentDeviationTitle', { count: props.contentDeviations!.length })}
            badge="⚠"
            badgeTone="warn"
          />
          <ReconcileDeviationCard
            flat
            deviations={props.contentDeviations!}
            exhausted={props.contentExhausted}
            {...(props.onContentAiFix ? { onAiFix: props.onContentAiFix } : {})}
            onDismiss={props.onContentDismiss ?? (() => {})}
          />
        </div>
      ),
    })
  }
  if (plan) {
    const anchorCall = pendingToolCalls.find((call) => call.toolCallId === plan.createCallId)
    liveBlocks.push({
      key: 'plan',
      anchorMessageId: anchorCall?.anchorMessageId,
      anchorTextOffset: anchorCall?.anchorTextOffset,
      render: () => (
        <div className={cn('flex flex-col gap-2')}>
          <StepHeader
            title={t('generationCommon.assistant.createShots', { count: plan.nodes.length })}
            badge={t('generationCommon.assistant.awaitingConfirmation')}
            badgeTone="active"
          />
          <AgentPlanCard flat plan={plan} approveCalls={props.approveCalls} rejectCall={props.rejectPending} />
        </div>
      ),
    })
  }
  for (const call of remaining) {
    const detail = describeToolCallDetail(call.toolName, call.args)
    liveBlocks.push({
      key: call.toolCallId,
      anchorMessageId: call.anchorMessageId,
      anchorTextOffset: call.anchorTextOffset,
      render: () => (
        <div className={cn('flex flex-col gap-2')} data-tool-call-id={call.toolCallId}>
          <StepHeader
            title={summarizeToolCall(call.toolName, call.args)}
            badge={t('generationCommon.assistant.awaitingConfirmation')}
            badgeTone="active"
          />
          {detail ? <div className={cn('text-nomi-ink-60 text-caption leading-[1.6]')}>{detail}</div> : null}
          <div className={cn('flex items-center gap-2')}>
            <WorkbenchButton variant="default" size="sm" onClick={() => props.rejectPending(call.toolCallId)}>
              {t('generationCommon.assistant.reject')}
            </WorkbenchButton>
            <WorkbenchButton
              variant="primary"
              size="sm"
              onClick={() => props.approveCalls([{ toolCallId: call.toolCallId }])}
            >
              {t('generationCommon.assistant.confirm')}
            </WorkbenchButton>
          </div>
        </div>
      ),
    })
  }

  if (assistantTimelineIsEmpty({
    messageCount: messages.length,
    pendingCallCount: pendingToolCalls.length,
    liveBlockCount: liveBlocks.length,
  })) {
    return (
      <div className={cn('flex flex-1 flex-col min-h-0 overflow-auto p-4')}>
        <div
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-2 max-w-[240px] mx-auto py-6 px-3 text-center',
          )}
        >
          <div className={cn('text-nomi-ink font-nomi-display text-title font-medium')}>
            {t('generationCommon.assistant.emptyTitle')}
          </div>
          <div className={cn('text-nomi-ink-60 text-body-sm leading-relaxed')}>
            {t('generationCommon.assistant.emptyDescription')}
          </div>
          <div className={cn('flex flex-col gap-1.5 w-full mt-2')}>
            {emptySuggestions.map((suggestion) => (
              <WorkbenchButton
                key={suggestion}
                className={cn(
                  'w-full min-h-9 py-2 px-3 border border-transparent rounded-nomi',
                  'flex items-center justify-between gap-2 text-left font-normal',
                  'bg-nomi-ink-05 text-nomi-ink-80 cursor-pointer hover:border-nomi-line hover:bg-nomi-paper hover:text-nomi-ink',
                )}
                onClick={() => props.onSuggestion(suggestion)}
              >
                <span className={cn('min-w-0')}>{suggestion}</span>
                <IconCornerDownLeft size={13} className={cn('shrink-0 text-nomi-ink-40')} />
              </WorkbenchButton>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const renderUserBubble = (message: WorkbenchAiMessage, showStaleBoundary: boolean): JSX.Element => (
    <>
      <UserMessageBubble content={message.content} attachments={message.attachments} />
      {showStaleBoundary ? <StaleConversationDivider /> : null}
    </>
  )

  const renderAssistantMessage = (message: WorkbenchAiMessage, showStaleBoundary: boolean): JSX.Element => {
    // 画布无独立 streaming 状态字段:'处理中...' 哨兵 = 等首 token(pending);有真内容 = 已到 token。
    const isStreaming =
      message.status === 'pending' ||
      message.status === 'streaming' ||
      message.content === '处理中...' ||
      message.content === t('generationCommon.assistant.processing')
    const isPlaceholder =
      message.content === '处理中...' || message.content === t('generationCommon.assistant.processing')
    // status 是错误真相源(旧 session 用「（错误）」前缀兜底)。错误分流到红色错误卡(人话+一键出路),
    // 不再当普通回复渲染。
    const isErrorMsg =
      message.status === 'error' || message.content.startsWith('（错误）') || message.content.startsWith('(Error)')
    return (
      <>
        {isErrorMsg ? (
          <AssistantErrorCard error={message.content} onRetry={props.onRetry} />
        ) : (
          <AssistantMessageView
            content={isStreaming && isPlaceholder ? '' : message.content}
            attachments={message.attachments}
            streaming={isStreaming}
            pendingLabel={isStreaming ? t('generationCommon.assistant.processingShort') : undefined}
            cancelled={message.status === 'cancelled'}
          />
        )}
        {showStaleBoundary ? <StaleConversationDivider /> : null}
      </>
    )
  }

  type LiveBlock = (typeof liveBlocks)[number]
  const blocksByKey = new Map(liveBlocks.map((block) => [block.key, block]))
  const chronology = orderAssistantTimelineEntries(messages, liveBlocks)
  const renderBlock = (block: LiveBlock): JSX.Element => <div key={block.key}>{block.render()}</div>

  return (
    <div className={cn('flex flex-1 flex-col min-h-0 overflow-auto p-4 gap-3')} data-assistant-thread="true">
      {chronology.map((entry) => {
        if (entry.kind === 'block') {
          const block = blocksByKey.get(entry.key)
          return block ? renderBlock(block) : null
        }
        const message = { ...entry.message, content: entry.content }
        const showStaleBoundary = entry.terminalSegment && entry.message.id === staleBoundaryId
        return (
          <React.Fragment key={entry.key}>
            {message.role === 'user'
              ? renderUserBubble(message, showStaleBoundary)
              : renderAssistantMessage(message, showStaleBoundary)}
          </React.Fragment>
        )
      })}
      <div ref={props.threadBottomRef} aria-hidden="true" />
    </div>
  )
}
