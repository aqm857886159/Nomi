// 画布助手对话线:用户气泡(右) → AI 发言 → 提议/已应用/出入 卡 → AI 总结。
// 助手「发言」与创作助手共用 AssistantMessageView(单一渲染真相源,守 P1):同身份行 + 真 markdown +
// token 字号。本组件只负责「编排」(消息/卡片的先后顺序 + 卡片的标题/状态徽标),不再画小点时间轴导轨
// ——两个助手从此长得一致(用户反馈:小点时间轴 vs 气泡两套设计不一致)。提议卡用 flat 去框。
// 卡片按 anchorMessageId 时序内联:锚定到某条消息的卡紧跟该消息之后渲染(叙述→卡→总结,位置=时间)。
import React from 'react'
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

type StepTone = 'done' | 'active' | 'warn'

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
  pendingToolCalls: PendingToolCallLike[]
  approveCalls: (requests: { toolCallId: string; overrides?: Record<string, unknown> }[]) => void
  rejectPending: (toolCallId: string) => void
  /** 上一笔已应用提议(回执步骤)。 */
  committedProposal: CommittedProposalRecord | null
  /** 对账出入(警示步骤,与 committed 互斥显示)。 */
  deviationReport: ReconcileDeviation[] | null
  /** 时序内联:对账卡锚定到本轮「卡前气泡」(与 committed 同源)。 */
  deviationAnchorId: string | null
  onDeviationUndo: () => void
  onDeviationDismiss: () => void
  /** 让 AI 用支持的方式重连没接上的边(完整版重设计)。 */
  onDeviationAiFix: () => void
  /** 错误卡「重试」= 重发上一条用户消息(undefined 则不显重试按钮)。 */
  onRetry?: () => void
  threadBottomRef: React.RefObject<HTMLDivElement>
}

const EMPTY_SUGGESTIONS = ['列 3 个镜头铺到画布', '给选中的镜头写一版提示词', '把镜头按先后顺序连起来']

export default function AssistantTimeline(props: AssistantTimelineProps): JSX.Element {
  const { messages, staleBoundaryId, pendingToolCalls } = props
  // memo:流式吐字会每帧重渲染本组件,但计划只随 pendingToolCalls 变——不 memo 则每帧重算 +
  // 产出新 plan 引用,连带 React.memo(AgentPlanCard) 失效、8 节点计划卡每帧重画(卡顿放大)。
  const plan = React.useMemo(() => summarizeAgentPlan(pendingToolCalls), [pendingToolCalls])
  const planCallIds = new Set([plan?.createCallId, plan?.connectCallId].filter(Boolean) as string[])
  const remaining = plan ? pendingToolCalls.filter((call) => !planCallIds.has(call.toolCallId)) : pendingToolCalls

  // 活动卡(回执/出入/待确认)。每项一个竖排动作块(标题徽标 + flat 卡);anchor=它锚定到的消息 id。
  const liveBlocks: { key: string; anchor?: string; render: () => React.ReactNode }[] = []
  if (props.deviationReport) {
    liveBlocks.push({
      key: 'deviation',
      anchor: props.deviationAnchorId ?? undefined,
      render: () => (
        <div className={cn('flex flex-col gap-1')}>
          <StepHeader title={`这次有 ${props.deviationReport!.length} 处没按计划生效`} badge="⚠" badgeTone="warn" />
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
      anchor: props.committedProposal.anchorMessageId,
      render: () => <CommittedProposalCard flat record={props.committedProposal!} />,
    })
  }
  if (plan) {
    liveBlocks.push({
      key: 'plan',
      anchor: pendingToolCalls.find((call) => call.toolCallId === plan.createCallId)?.anchorMessageId,
      render: () => (
        <div className={cn('flex flex-col gap-2')}>
          <StepHeader title={`创建 ${plan.nodes.length} 个镜头节点`} badge="等你确认" badgeTone="active" />
          <AgentPlanCard flat plan={plan} approveCalls={props.approveCalls} rejectCall={props.rejectPending} />
        </div>
      ),
    })
  }
  for (const call of remaining) {
    const detail = describeToolCallDetail(call.toolName, call.args)
    liveBlocks.push({
      key: call.toolCallId,
      anchor: call.anchorMessageId,
      render: () => (
        <div className={cn('flex flex-col gap-2')} data-tool-call-id={call.toolCallId}>
          <StepHeader title={summarizeToolCall(call.toolName, call.args)} badge="等你确认" badgeTone="active" />
          {detail ? <div className={cn('text-nomi-ink-60 text-caption leading-[1.6]')}>{detail}</div> : null}
          <div className={cn('flex items-center gap-2')}>
            <WorkbenchButton variant="default" size="sm" onClick={() => props.rejectPending(call.toolCallId)}>
              拒绝
            </WorkbenchButton>
            <WorkbenchButton variant="primary" size="sm" onClick={() => props.approveCalls([{ toolCallId: call.toolCallId }])}>
              确认
            </WorkbenchButton>
          </div>
        </div>
      ),
    })
  }

  if (messages.length === 0 && pendingToolCalls.length === 0) {
    return (
      <div className={cn('flex flex-1 flex-col min-h-0 overflow-auto p-4')}>
        <div className={cn('flex flex-1 flex-col items-center justify-center gap-2 max-w-[240px] mx-auto py-6 px-3 text-center')}>
          <div className={cn('text-nomi-ink font-nomi-display text-title font-medium')}>我帮你搭画布</div>
          <div className={cn('text-nomi-ink-60 text-body-sm leading-relaxed')}>
            铺镜头、改提示词、连节点都交给我；出图按节点上的「生成」键。
          </div>
          <div className={cn('flex flex-col gap-1.5 w-full mt-2')}>
            {EMPTY_SUGGESTIONS.map((suggestion) => (
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

  const renderUserBubble = (message: WorkbenchAiMessage): JSX.Element => (
    <React.Fragment key={message.id}>
      <UserMessageBubble content={message.content} attachments={message.attachments} />
      {message.id === staleBoundaryId ? <StaleConversationDivider /> : null}
    </React.Fragment>
  )

  const renderAssistantMessage = (message: WorkbenchAiMessage): JSX.Element => {
    // 画布无独立 streaming 状态字段:'处理中...' 哨兵 = 等首 token(pending);有真内容 = 已到 token。
    const isPending = message.content === '处理中...'
    // status 是错误真相源(旧 session 用「（错误）」前缀兜底)。错误分流到红色错误卡(人话+一键出路),
    // 不再当普通回复渲染。
    const isErrorMsg = message.status === 'error' || message.content.startsWith('（错误）')
    return (
      <React.Fragment key={message.id}>
        {isErrorMsg ? (
          <AssistantErrorCard error={message.content} onRetry={props.onRetry} />
        ) : (
          <AssistantMessageView
            content={isPending ? '' : message.content}
            attachments={message.attachments}
            streaming={isPending}
            pendingLabel={isPending ? '处理中' : undefined}
            cancelled={message.status === 'cancelled'}
          />
        )}
        {message.id === staleBoundaryId ? <StaleConversationDivider /> : null}
      </React.Fragment>
    )
  }

  // 时序内联:卡片按 anchor 排进消息序列——锚定到某条消息的卡紧跟该消息之后渲染,得到
  // 「叙述 → 卡 → 总结」位置与时间一致。锚点缺失/无匹配的卡兜底排队尾(=旧行为,保安全)。
  type LiveBlock = (typeof liveBlocks)[number]
  const messageIds = new Set(messages.map((message) => message.id))
  const blocksByAnchor = new Map<string, LiveBlock[]>()
  const tailBlocks: LiveBlock[] = []
  for (const block of liveBlocks) {
    if (block.anchor && messageIds.has(block.anchor)) {
      const list = blocksByAnchor.get(block.anchor) ?? []
      list.push(block)
      blocksByAnchor.set(block.anchor, list)
    } else {
      tailBlocks.push(block)
    }
  }

  const renderBlock = (block: LiveBlock): JSX.Element => <div key={block.key}>{block.render()}</div>

  return (
    <div className={cn('flex flex-1 flex-col min-h-0 overflow-auto p-4 gap-3')} data-assistant-thread="true">
      {messages.map((message) => (
        <React.Fragment key={`row-${message.id}`}>
          {message.role === 'user' ? renderUserBubble(message) : renderAssistantMessage(message)}
          {(blocksByAnchor.get(message.id) ?? []).map(renderBlock)}
        </React.Fragment>
      ))}
      {tailBlocks.map(renderBlock)}
      <div ref={props.threadBottomRef} aria-hidden="true" />
    </div>
  )
}
