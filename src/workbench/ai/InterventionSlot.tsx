import React from 'react'
import { IconAlertTriangle, IconCheck, IconChevronRight, IconHelp, IconKey, IconPlayerPause, IconX } from '@tabler/icons-react'
import type { CapabilityEffectClass } from '../../../electron/shared/agentCapabilities/capabilityContract'
import { cn } from '../../utils/cn'

export type InterventionKind = 'approval' | 'question' | 'missing_credential' | 'missing_param'
export type ApprovalScope = 'once' | 'session' | 'always'

export type InterventionSlotProps = Readonly<{
  kind: InterventionKind
  title: string
  summary: string
  effectClass?: CapabilityEffectClass
  scopeLabel?: string
  costLabel?: string
  questionOptions?: readonly string[]
  missingItems?: readonly string[]
  pendingCount?: number
  rejectReason?: string
  onApproveOnce?: () => void
  onApproveSession?: () => void
  onApproveAlways?: () => void
  onAnswer?: (answer: string) => void
  onResolveMissing?: () => void
  onReject?: (reason?: string) => void
  onDismiss?: () => void
  children?: React.ReactNode
  details?: readonly { label: string; value: string }[]
  detailsLabel?: string
  variant?: 'generation'
  compactGeneration?: boolean
  /** Optional display projection retained for callers that already build a proposal. */
  proposal?: unknown
  labels: Readonly<{
    once: string
    session: string
    always: string
    reject: string
    rejectPlaceholder: string
    answer: string
    resolve: string
    close: string
    scope: string
    approve?: string
  }>
}>

/**
 * The single intervention surface above the composer. Host decisions remain
 * authoritative; this component only presents the available next action.
 */
export function InterventionSlot({ kind, title, summary, effectClass, scopeLabel, costLabel, questionOptions = [], missingItems = [], pendingCount = 1, rejectReason = '', onApproveOnce, onApproveSession, onApproveAlways, onAnswer, onResolveMissing, onReject, onDismiss, labels, children, details = [], detailsLabel = '', variant, compactGeneration }: InterventionSlotProps): JSX.Element {
  const [reason, setReason] = React.useState(rejectReason)
  const [answer, setAnswer] = React.useState('')
  const isApproval = kind === 'approval'
  const showAlways = isApproval && Boolean(onApproveAlways) && effectClass !== 'spend' && effectClass !== 'irreversible'
  const icon = kind === 'question' ? <IconHelp size={15} /> : kind === 'missing_credential' ? <IconKey size={15} /> : kind === 'missing_param' ? <IconAlertTriangle size={15} /> : <IconPlayerPause size={15} />
  const reject = () => onReject?.(reason.trim() || undefined)
  const approveLabel = labels.approve ?? labels.session
  return <aside className="mx-3 mb-1.5 overflow-hidden rounded-nomi-sm border border-nomi-accent bg-nomi-paper shadow-nomi-sm" data-agent-intervention-slot="true" data-agent-intervention-kind={kind} data-agent-effect-class={effectClass} data-agent-intervention-pending-count={pendingCount} data-agent-item-kind={kind} data-agent-approval="true" data-agent-approval-state="pending" data-agent-approval-variant={variant}>
    <div className="flex items-start gap-2 px-2.5 py-2">
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-pill bg-nomi-accent-soft text-nomi-accent" aria-hidden="true">{icon}</span>
      <div className="min-w-0 flex-1"><div className="text-micro font-semibold text-nomi-ink">{title}</div><p className="m-0 mt-0.5 text-micro leading-relaxed text-nomi-ink-60">{summary}</p>
        {scopeLabel || costLabel ? <div className="mt-1 flex flex-wrap gap-1 text-micro text-nomi-ink-60" data-agent-intervention-boundary="true">{scopeLabel ? <span className="rounded-pill bg-nomi-ink-05 px-1.5 py-0.5">{labels.scope}: {scopeLabel}</span> : null}{costLabel ? <span className="rounded-pill bg-nomi-accent-soft px-1.5 py-0.5 tabular-nums text-nomi-accent">{costLabel}</span> : null}</div> : null}
      </div>
      {onDismiss ? <button type="button" className="grid size-6 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-05" aria-label={labels.close} title={labels.close} onClick={onDismiss}><IconX size={13} /></button> : null}
    </div>
    {children ? <div className="px-2.5 pb-2" data-agent-intervention-content="true" data-agent-proposal-editor-slot={variant === 'generation' || compactGeneration ? 'true' : undefined}>{children}</div> : null}
    {details.length ? <details className="group mx-2.5 mb-2 rounded-nomi-sm bg-nomi-ink-05 px-2" data-agent-approval-details="true"><summary className="flex min-h-7 cursor-pointer list-none items-center gap-1.5 text-micro text-nomi-ink-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent/40"><IconChevronRight size={12} className="transition-transform duration-[var(--nomi-transition-fast)] group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" /><span>{detailsLabel || labels.scope}</span></summary><dl className="grid gap-1.5 border-t border-nomi-line-soft py-1.5 text-micro" data-agent-tool-details="true">{details.map((detail) => <div key={`${detail.label}-${detail.value}`}><dt className="text-nomi-ink-40">{detail.label}</dt><dd className="m-0 break-words text-nomi-ink-80">{detail.value}</dd></div>)}</dl></details> : null}
    {kind === 'question' && questionOptions.length ? <div className="grid gap-1 px-2.5 pb-2" data-agent-intervention-options="true">{questionOptions.map((option) => <button key={option} type="button" className={cn('min-h-7 rounded-nomi-sm border px-2 text-left text-micro', answer === option ? 'border-nomi-accent bg-nomi-accent-soft text-nomi-accent' : 'border-nomi-line text-nomi-ink-80 hover:bg-nomi-ink-05')} onClick={() => { setAnswer(option); onAnswer?.(option) }}>{option}</button>)}</div> : null}
    {missingItems.length ? <div className="flex flex-wrap gap-1 px-2.5 pb-2 text-micro text-nomi-ink-60" data-agent-intervention-missing="true">{missingItems.map((item) => <span key={item} className="rounded-pill bg-nomi-ink-05 px-1.5 py-0.5">{item}</span>)}</div> : null}
    {isApproval ? <div className="grid gap-1 border-t border-nomi-line-soft px-2.5 py-1.5" data-agent-approval-scopes="true">
      <div className={cn('grid gap-1', showAlways ? 'grid-cols-3' : 'grid-cols-2')}>
        <button type="button" aria-label={approveLabel} className="min-h-7 rounded-nomi-sm border border-nomi-line px-1 text-micro text-nomi-ink-80 hover:bg-nomi-ink-05" onClick={onApproveOnce} data-agent-action="approve" data-agent-approval-scope="once"><IconCheck size={12} className="mr-0.5 inline" />{labels.once}</button>
        {onApproveSession ? <button type="button" aria-label={approveLabel} className="min-h-7 rounded-nomi-sm bg-nomi-ink px-1 text-micro text-nomi-paper hover:opacity-85" onClick={onApproveSession} data-agent-action="approve" data-agent-approval-scope="session"><IconCheck size={12} className="mr-0.5 inline" />{labels.session}</button> : null}
        {showAlways ? <button type="button" aria-label={approveLabel} className="min-h-7 rounded-nomi-sm border border-nomi-line px-1 text-micro text-nomi-ink-80 hover:bg-nomi-ink-05" onClick={onApproveAlways} data-agent-action="approve" data-agent-approval-scope="always"><IconCheck size={12} className="mr-0.5 inline" />{labels.always}</button> : null}
      </div>
      <div className="flex items-center gap-1"><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder={labels.rejectPlaceholder} aria-label={labels.rejectPlaceholder} className="min-w-0 flex-1 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2 py-1 text-micro outline-none focus:border-nomi-accent" data-agent-reject-reason="true" /><button type="button" className="min-h-7 rounded-nomi-sm px-2 text-micro text-workbench-danger hover:bg-workbench-danger-soft" onClick={reject} data-agent-action="deny" data-agent-approval-reject="true"><IconX size={12} className="mr-0.5 inline" />{labels.reject}</button></div>
    </div> : kind === 'question' ? <div className="flex justify-end border-t border-nomi-line-soft px-2.5 py-1.5"><button type="button" disabled={!answer} className="min-h-7 rounded-nomi-sm bg-nomi-ink px-2 text-micro text-nomi-paper disabled:opacity-40" onClick={() => onAnswer?.(answer)}>{labels.answer}</button></div> : <div className="flex justify-end border-t border-nomi-line-soft px-2.5 py-1.5"><button type="button" className="min-h-7 rounded-nomi-sm bg-nomi-ink px-2 text-micro text-nomi-paper" onClick={onResolveMissing}>{labels.resolve}</button></div>}
  </aside>
}
