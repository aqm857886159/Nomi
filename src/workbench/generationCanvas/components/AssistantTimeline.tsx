// 助手时间线(方案三):把一轮对话呈现为状态点导轨上的步骤序列——
// 用户气泡(右) → AI 叙述(理解请求)→ 提议步骤(等你确认/已确认✓)→ 回执/出入。
// 「看 AI 干活」本身就是界面。三案共用同一批人话提议卡(AgentPlanCard/Committed/Deviation),
// 本组件只负责导轨容器与步骤编排;卡用 flat 去框,导轨提供视觉结构。
import React from 'react'
import { cn } from '../../../utils/cn'
import { IconCornerDownLeft } from '@tabler/icons-react'
import { NomiLoadingMark, WorkbenchButton } from '../../../design'
import { AiReplyActionButton } from '../../ai/AiReplyActionButton'
import { AttachmentRail } from '../../ai/composer/AttachmentRail'
import { StaleConversationDivider } from '../../ai/staleConversationDivider'
import { narrateTurnStats } from '../../observability/narrate'
import AgentPlanCard, { summarizeAgentPlan } from './AgentPlanCard'
import CommittedProposalCard from './CommittedProposalCard'
import ReconcileDeviationCard from './ReconcileDeviationCard'
import { summarizeToolCall, describeToolCallDetail } from './toolCallSummary'
import type { CommittedProposalRecord } from '../agent/proposalUndo'
import type { ReconcileDeviation } from '../agent/reconcile'
import type { PendingToolCallLike } from './agentPlanSummary'
import type { WorkbenchAiMessage } from '../../ai/workbenchAiTypes'

type StepStatus = 'done' | 'active' | 'pending' | 'warn'

/** 导轨步骤:左侧状态点+连接线,右侧主体。connectDown=与下一步连成同一段导轨。 */
function TimelineStep({ status, connectDown, children }: {
  status: StepStatus
  connectDown: boolean
  children: React.ReactNode
}): JSX.Element {
  return (
    <li className={cn('flex gap-2 list-none')} data-timeline-step={status}>
      <div className={cn('flex flex-col items-center w-3.5 shrink-0')}>
        <span
          className={cn(
            'w-2 h-2 rounded-full mt-[5px] shrink-0',
            status === 'done' && 'bg-workbench-success',
            status === 'active' && 'bg-nomi-accent ring-[3px] ring-nomi-accent-soft',
            status === 'pending' && 'bg-nomi-ink-30',
            status === 'warn' && 'bg-[var(--nomi-snap-tag)]',
          )}
        />
        {connectDown ? <span className={cn('w-px flex-1 bg-nomi-line mt-1')} /> : null}
      </div>
      <div className={cn('flex-1 min-w-0 pb-3')}>{children}</div>
    </li>
  )
}

function StepHeader({ title, badge, badgeTone }: { title: string; badge?: string; badgeTone?: StepStatus }): JSX.Element {
  return (
    <div className={cn('flex items-center gap-2 min-w-0')}>
      <span className={cn('text-nomi-ink text-[13px] font-semibold truncate')}>{title}</span>
      {badge ? (
        <span
          className={cn(
            'text-[11px] shrink-0',
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
  onDeviationUndo: () => void
  onDeviationDismiss: () => void
  /** 让 AI 用支持的方式重连没接上的边(完整版重设计)。 */
  onDeviationAiFix: () => void
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

  // 活动组(回执/出入在上=较早轮,待确认在下=最新)。每项是一个导轨步骤。
  const liveSteps: { key: string; status: StepStatus; render: () => React.ReactNode }[] = []
  if (props.deviationReport) {
    liveSteps.push({
      key: 'deviation',
      status: 'warn',
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
    liveSteps.push({
      key: `committed-${props.committedProposal.proposalId}`,
      status: 'done',
      render: () => <CommittedProposalCard flat record={props.committedProposal!} />,
    })
  }
  if (plan) {
    liveSteps.push({
      key: 'plan',
      status: 'active',
      render: () => (
        <div className={cn('flex flex-col gap-2')}>
          <StepHeader title={`创建 ${plan.nodes.length} 个镜头节点`} badge="等你确认" badgeTone="active" />
          <AgentPlanCard
            flat
            plan={plan}
            approveCalls={props.approveCalls}
            rejectCall={props.rejectPending}
          />
        </div>
      ),
    })
  }
  for (const call of remaining) {
    const detail = describeToolCallDetail(call.toolName, call.args)
    liveSteps.push({
      key: call.toolCallId,
      status: 'active',
      render: () => (
        <div className={cn('flex flex-col gap-2')} data-tool-call-id={call.toolCallId}>
          <StepHeader title={summarizeToolCall(call.toolName, call.args)} badge="等你确认" badgeTone="active" />
          {detail ? <div className={cn('text-nomi-ink-60 text-[12px] leading-[1.6]')}>{detail}</div> : null}
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
          <div className={cn('text-nomi-ink font-[Fraunces,Inter,serif] text-title font-medium')}>我帮你搭画布</div>
          <div className={cn('text-nomi-ink-60 text-bodySm leading-relaxed')}>
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
    <li key={message.id} className={cn('flex flex-col list-none mb-3')}>
      <div className={cn('self-end max-w-[88%] py-[8px] px-[12px] rounded-nomi rounded-br-[4px] bg-nomi-ink-05 text-nomi-ink text-body-sm leading-[1.55] whitespace-pre-wrap')} data-role="user">
        {message.attachments?.length ? <AttachmentRail attachments={message.attachments} readOnly className={cn('mb-1.5')} /> : null}
        {message.content}
      </div>
      {message.id === staleBoundaryId ? <StaleConversationDivider /> : null}
    </li>
  )

  const renderAssistantStep = (message: WorkbenchAiMessage, connectDown: boolean): JSX.Element => {
    const streaming = message.content === '处理中...'
    return (
      <React.Fragment key={message.id}>
        <TimelineStep status={streaming ? 'active' : 'done'} connectDown={connectDown}>
          <div className={cn('text-nomi-ink-80 text-body-sm leading-[1.7] whitespace-pre-wrap')} data-role={message.role}>
            {message.attachments?.length ? <AttachmentRail attachments={message.attachments} readOnly className={cn('mb-1.5')} /> : null}
            {streaming ? <NomiLoadingMark size={15} label="处理中" /> : message.content}
            {!streaming ? <AiReplyActionButton className="generation-canvas-v2-assistant__reply-action" content={message.content} /> : null}
            {message.turnStats?.totalTokens ? (
              <span className={cn('block mt-1 text-micro text-nomi-ink-40')}>{narrateTurnStats(message.turnStats.totalTokens, message.turnStats)}</span>
            ) : null}
          </div>
        </TimelineStep>
        {message.id === staleBoundaryId ? <StaleConversationDivider /> : null}
      </React.Fragment>
    )
  }

  // 吐字顺序修复:把「当前轮的 AI 气泡」排到 liveSteps(待确认/已应用卡)之后,
  // 让时间线 = 用户问 → AI 动手(卡) → AI 吐字总结,位置与时间一致。
  // 旧实现把这条气泡钉在卡片上方,但 agent 的总结文字在动作之后才到 →
  // 「下面已到下一阶段、上面过一会才吐字」的位置/时间倒挂。「处理中」转圈也随之
  // 落到底部,眼睛跟随活动处。纯聊天(无 liveSteps)时位置与原先一致,零回归。
  const lastIsAssistant = messages.length > 0 && messages[messages.length - 1].role !== 'user'
  const headMessages = lastIsAssistant ? messages.slice(0, -1) : messages
  const trailingAssistant = lastIsAssistant ? messages[messages.length - 1] : null

  type RailItem = { rail: boolean; render: (connectDown: boolean) => React.ReactNode }
  const items: RailItem[] = []
  for (const message of headMessages) {
    items.push(message.role === 'user'
      ? { rail: false, render: () => renderUserBubble(message) }
      : { rail: true, render: (connectDown) => renderAssistantStep(message, connectDown) })
  }
  for (const step of liveSteps) {
    items.push({
      rail: true,
      render: (connectDown) => (
        <TimelineStep key={step.key} status={step.status} connectDown={connectDown}>
          {step.render()}
        </TimelineStep>
      ),
    })
  }
  if (trailingAssistant) {
    items.push({ rail: true, render: (connectDown) => renderAssistantStep(trailingAssistant, connectDown) })
  }

  return (
    <ol className={cn('flex flex-1 flex-col min-h-0 overflow-auto p-4 list-none m-0')} data-assistant-timeline="true">
      {/* 连线 = 紧邻的下一项也是导轨步骤(非 user 气泡);user 气泡断开导轨。 */}
      {items.map((item, index) => item.render(index < items.length - 1 && items[index + 1].rail))}
      <li className={cn('list-none')} ref={props.threadBottomRef as unknown as React.RefObject<HTMLLIElement>} aria-hidden="true" />
    </ol>
  )
}
