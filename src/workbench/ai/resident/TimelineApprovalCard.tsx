import React from 'react'
import { ResidentApprovalCard, type ResidentApprovalState } from './ResidentUiPrimitives'
import type { ResidentApprovalDetail } from './residentProposalDisplay'
import { timelinePlanOperationsForTool } from './timelineAgentSurface'
import { timelinePlanLines } from '../../timeline/agent/timelinePlanSummary'
import type { TimelineState } from '../../timeline/timelineTypes'

export type TimelineApprovalChoice = 'apply' | 'session' | 'always' | 'reject'

/** Tool aliases whose approval belongs in the timeline intervention slot. */
export function isTimelinePlanApproval(toolName: string): boolean {
  return toolName === 'nomi_timeline_edit' || toolName === 'apply_edit_plan'
}

/**
 * The intervention slot for a timeline edit plan. It is the canonical resident
 * approval card — not a second one — so the resolved states, the disclosure
 * behaviour and the button shapes stay identical everywhere the Agent asks for
 * permission; only the escalating auto-apply choices and the body are added
 * here. Each operation is rendered as a sentence a person can check, with the
 * exact frames and ids kept in the detail row (design contract §2.6/§2.8).
 */
export function TimelineApprovalCard({
  title,
  toolName,
  args,
  timeline,
  state,
  onChoice,
  t,
}: {
  title: string
  toolName: string
  args: Record<string, unknown>
  timeline: TimelineState
  state: ResidentApprovalState
  onChoice: (choice: TimelineApprovalChoice) => void
  t: (key: string, values?: Record<string, unknown>) => string
}): JSX.Element {
  const operations = React.useMemo(() => timelinePlanOperationsForTool(toolName, args), [args, toolName])
  const lines = React.useMemo(() => timelinePlanLines(operations, timeline, t), [operations, t, timeline])
  const plan = args.plan && typeof args.plan === 'object' ? args.plan as { summary?: unknown } : args
  const summary = typeof plan.summary === 'string' && plan.summary ? plan.summary : t('agentResident.waitingApproval')
  const details: ResidentApprovalDetail[] = lines.map((line) => ({ label: line.text, value: line.technical }))
  return <div data-agent-timeline-approval="true" data-effect-class="reversible_local" data-agent-plan-operations={operations.length}>
    <ResidentApprovalCard
      title={title}
      iconName="timeline"
      summary={summary}
      details={details}
      detailsLabel={t('agentResident.toolInspectDetails')}
      detailsOpen
      state={state}
      approveLabel={t('agentResident.timelineApplyThis')}
      denyLabel={t('agentResident.timelineReject')}
      pendingLabel={t('agentResident.waitingApproval')}
      approvedLabel={t('agentResident.approved')}
      deniedLabel={t('agentResident.denied')}
      resolvedApprovedHint={t('agentResident.approvedReceiptHint')}
      resolvedDeniedHint={t('agentResident.deniedReceiptHint')}
      notWrittenLabel={t('agentResident.notWritten')}
      secondaryActions={state === 'pending' ? [
        { id: 'approve-session', label: t('agentResident.timelineApplySession'), onSelect: () => onChoice('session') },
        { id: 'approve-always', label: t('agentResident.timelineApplyAlways'), onSelect: () => onChoice('always') },
      ] : undefined}
      onApprove={() => onChoice('apply')}
      onDeny={() => onChoice('reject')}
    />
  </div>
}
