import React from 'react'
import type { TimelineState } from '../../timeline/timelineTypes'
import type { ProjectAgentApprovalPolicy } from '../../../../electron/shared/projectAgentContracts'
import { ResidentApprovalCard, type ResidentApprovalState } from './ResidentUiPrimitives'
import { ResidentCandidatesCard, ResidentPlanCard, ResidentSpendCard, ResidentQuestionCard } from './ResidentExceptionStates'
import { TimelineApprovalCard, isTimelinePlanApproval, type TimelineApprovalChoice } from './TimelineApprovalCard'
import { GenerationProposalEditor } from './GenerationProposalEditor'
import { isGenerationProposalTool } from './generationProposalEditing'
import { proposalForTool, readableToolDetailRows, readableToolName, readableToolPreview } from './residentToolDisplay'
import { residentArgsForSelection, residentCandidates, residentPlanShots, residentProposalParameters, residentQuestionOptions } from './residentExceptionProjections'

/**
 * The approval surface for one in-flight tool call. It lives beside the other
 * resident cards rather than inside the shell because the collapsed timeline
 * dock (design contract §2.6) renders the very same cards in a second place:
 * one renderer, two hosts. A copy inlined per host would be a parallel version
 * of the approval UI and would drift the moment either host changed.
 */
export type ResidentPendingTool = Readonly<{
  call: { toolName: string; toolCallId: string; turnId: string; args: unknown }
  state: ResidentApprovalState
}>

export type ResidentPendingToolContext = Readonly<{
  t: (key: string, values?: Record<string, unknown>) => string
  timeline: TimelineState
  approvalPolicy: ProjectAgentApprovalPolicy
  draft: string
  editableArgsFor: (pending: ResidentPendingTool) => Record<string, unknown> | undefined
  keyFor: (pending: ResidentPendingTool) => string
  onDraftChange: (text: string) => void
  onSubmitDraft: () => void
  onProposalChange: (key: string, args: Record<string, unknown>) => void
  onResolve: (pending: ResidentPendingTool, approved: boolean, args?: Record<string, unknown>) => void
  onTimelineChoice: (choice: TimelineApprovalChoice) => void
}>

export function renderResidentPendingTool(pending: ResidentPendingTool, context: ResidentPendingToolContext): JSX.Element {
  const { t, timeline } = context
  const key = context.keyFor(pending)
  const editableArgs = context.editableArgsFor(pending)
  const proposal = proposalForTool(t, pending.call.toolName, editableArgs)
  const compactGeneration = Boolean(editableArgs && isGenerationProposalTool(pending.call.toolName, editableArgs))
  const approvalState = pending.state === 'approved' ? 'approved' : pending.state === 'denied' ? 'denied' : 'pending'
  const rawRecord = editableArgs ?? {}
  if (isTimelinePlanApproval(pending.call.toolName)) {
    return <TimelineApprovalCard key={key} title={readableToolName(t, pending.call.toolName)} toolName={pending.call.toolName} args={rawRecord} timeline={timeline} state={approvalState} t={t}
      onChoice={(choice) => { context.onTimelineChoice(choice); context.onResolve(pending, choice !== 'reject', editableArgs) }}
    />
  }
  const candidates = residentCandidates(rawRecord)
  const question = typeof rawRecord.question === 'string' ? rawRecord.question : ''
  const questionOptions = residentQuestionOptions(rawRecord)
  if (question && questionOptions.length) {
    return <div key={pending.call.toolCallId} data-agent-item-kind="approval"><ResidentQuestionCard question={question} options={questionOptions} pageLabel={t('agentResident.questionPage')} moreLabel={t('agentResident.questionMore', { count: Math.max(0, questionOptions.length - 4) })} collapseLabel={t('agentResident.questionCollapse')} skipLabel={t('agentResident.questionSkip')} nextLabel={t('agentResident.questionNext')} onAnswer={(option) => context.onDraftChange(option.label)} onSkip={() => context.onDraftChange('')} onNext={() => { if (context.draft.trim()) context.onSubmitDraft() }} /></div>
  }
  if (rawRecord.planStatus === 'failed' && proposal) {
    return <div key={pending.call.toolCallId} data-agent-item-kind="approval"><ResidentPlanCard state="failed" shots={[]} parameters={[]} failureReason={t('agentResident.planFailed')} billing={t('agentResident.notCharged')} editLabel={t('agentResident.editPrompt')} retryLabel={t('agentResident.retry')} loadingLabel={t('agentResident.planLoading')} summaryLabel={(total, selected) => t('agentResident.planSummary', { total, selected })} generateLabel={(selected) => t('agentResident.planGenerate', { count: selected })} editedLabel={t('agentResident.planEdited')} selectAllLabel={t('agentResident.planSelectAll')} onEdit={() => context.onDraftChange(t('agentResident.editPlanPrompt'))} onRetry={() => context.onResolve(pending, true, editableArgs)} onGenerate={() => undefined} /></div>
  }
  if (rawRecord.priceStatus === 'failed' && proposal) {
    const knownRows = proposal.fields.filter((field) => field.kind !== 'estimate').slice(0, 3)
    const amount = typeof rawRecord.amount === 'number' && Number.isFinite(rawRecord.amount) ? rawRecord.amount : null
    return <div key={pending.call.toolCallId} data-agent-item-kind="approval"><ResidentSpendCard knownRows={knownRows} amount={amount} failureReason={t('agentResident.priceUnavailable')} refreshLabel={t('agentResident.spendRefresh')} continueLabel={t('agentResident.spendContinue')} amountLabel={(value) => t('agentResident.proposalEstimateAmount', { amount: value.toFixed(2) })} unknownAmountLabel={t('agentResident.priceUnavailable')} onRefresh={() => window.dispatchEvent(new Event('nomi-agent-price-refresh'))} onContinue={() => context.onResolve(pending, true, editableArgs)} /></div>
  }
  if (candidates.length > 0) {
    return <div key={pending.call.toolCallId} data-agent-item-kind="approval"><ResidentCandidatesCard candidates={candidates} versionCountLabel={(count) => t('agentResident.candidateVersions', { count })} adoptLabel={(label) => t('agentResident.candidateAdopt', { label })} moreLabel={t('agentResident.candidateMore', { count: Math.max(0, candidates.length - 3) })} collapseLabel={t('agentResident.candidateCollapse')} onSelect={(candidate) => context.onProposalChange(key, { ...rawRecord, candidate })} /></div>
  }
  if (compactGeneration) {
    const shots = residentPlanShots(editableArgs)
    return <div key={pending.call.toolCallId} data-agent-item-kind="approval"><ResidentPlanCard state="ready" shots={shots} parameters={residentProposalParameters(editableArgs)} failureReason={t('agentResident.planFailed')} billing={t('agentResident.notCharged')} editLabel={t('agentResident.editPrompt')} retryLabel={t('agentResident.retry')} loadingLabel={t('agentResident.planLoading')} summaryLabel={(total, selected) => t('agentResident.planSummary', { total, selected })} generateLabel={(selected) => t('agentResident.planGenerate', { count: selected })} editedLabel={t('agentResident.planEdited')} selectAllLabel={t('agentResident.planSelectAll')} onEdit={() => context.onDraftChange(t('agentResident.editPlanPrompt'))} onRetry={() => context.onResolve(pending, true, editableArgs)} onGenerate={(selected) => context.onResolve(pending, true, residentArgsForSelection(rawRecord, selected))}><GenerationProposalEditor args={editableArgs} t={t} onChange={(next) => context.onProposalChange(key, next)} /></ResidentPlanCard></div>
  }
  return <div key={pending.call.toolCallId} data-agent-item-kind="approval"><ResidentApprovalCard title={readableToolName(t, pending.call.toolName)} iconName={pending.call.toolName} summary={readableToolPreview(t, pending.call.toolName, editableArgs)} details={readableToolDetailRows(t, pending.call.toolName, editableArgs)} detailsLabel={t('agentResident.toolInspectDetails')} proposal={proposal} state={approvalState} approveLabel={t('agentResident.approve')} denyLabel={t('agentResident.deny')} pendingLabel={t('agentResident.waitingApproval')} approvedLabel={t('agentResident.approved')} deniedLabel={t('agentResident.denied')} resolvedApprovedHint={t('agentResident.approvedReceiptHint')} resolvedDeniedHint={t('agentResident.deniedReceiptHint')} notWrittenLabel={t('agentResident.notWritten')} compactGeneration={compactGeneration} onApprove={() => context.onResolve(pending, true, editableArgs)} onDeny={() => context.onResolve(pending, false)} /></div>
}
