import React from 'react'
import { IconAlertTriangle, IconCheck, IconChevronRight, IconCircleDashed, IconFileText, IconLayoutBoard, IconLoader2, IconMessage, IconPhoto, IconRobot, IconTimelineEvent, IconTool, IconVideo, IconX } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import type { ProjectAgentStatus } from '../../../../electron/shared/projectAgentContracts'
import { partitionResidentProposalFields, residentProposalFieldKind, type ResidentApprovalDetail, type ResidentProposalData } from './residentProposalDisplay'
import { formatResidentToolElapsed, residentToolElapsedMs } from './residentToolTiming'

/**
 * Adapted from Beautiful UI's MIT-licensed Tool Chips, Approval Card, Task Rows,
 * Thinking State and Streaming Text patterns. Nomi keeps its own tokens and
 * Host-owned data; this file only supplies the compact, progressive-disclosure
 * presentation contract.
 */

export type ResidentToolChipData = Readonly<{
  id: string
  label: string
  name: string
  /** First-layer answer: what changed. `summary` remains a compatibility alias. */
  effect?: string
  /** First-layer target: the object/scope affected by the operation. */
  target?: string
  summary: string
  detail?: string
  /** Technical payload shown only after a second disclosure. */
  technicalDetails?: string
  result: string
  status: ProjectAgentStatus
  /** Host lifecycle timestamps, used only to derive a compact duration label. */
  createdAt?: string
  updatedAt?: string
  elapsedMs?: number
}>

function ToolStatusIcon({ status }: { status: ProjectAgentStatus }): JSX.Element {
  if (status === 'running' || status === 'drafting') return <IconLoader2 size={14} className="animate-spin text-nomi-accent motion-reduce:animate-none" aria-hidden="true" />
  if (status === 'failed') return <IconAlertTriangle size={14} className="text-workbench-danger" aria-hidden="true" />
  if (status === 'done') return <IconCheck size={14} className="text-workbench-success-ink" aria-hidden="true" />
  return <IconCircleDashed size={14} className="text-nomi-ink-40" aria-hidden="true" />
}

/** Action icons answer "what kind of work is this?"; status icons answer "what state is it in?". */
function ToolActionIcon({ name }: { name: string }): JSX.Element {
  const normalized = name.toLowerCase()
  if (normalized.includes('load_skill')) return <IconRobot size={13} aria-hidden="true" />
  if (normalized.includes('image') || normalized.includes('asset')) return <IconPhoto size={13} aria-hidden="true" />
  if (normalized.includes('video')) return <IconVideo size={13} aria-hidden="true" />
  if (normalized.includes('document') || normalized.includes('append')) return <IconFileText size={13} aria-hidden="true" />
  if (normalized.includes('timeline')) return <IconTimelineEvent size={13} aria-hidden="true" />
  if (normalized.includes('canvas') || normalized.includes('create_canvas') || normalized.includes('delete_canvas')) return <IconLayoutBoard size={13} aria-hidden="true" />
  if (normalized.includes('generation') || normalized.includes('operation_create') || normalized.includes('start_generation') || normalized.includes('preview_execution')) return <IconPhoto size={13} aria-hidden="true" />
  return <IconTool size={13} aria-hidden="true" />
}

/**
 * Keep a run as one compact, collapsible group.  The first layer answers
 * "what happened?"; a second click answers "what did it use/return?".  This
 * prevents long prompts and tool payloads from stealing the transcript's
 * attention while keeping every Host-owned detail reachable.
 */
export function ResidentToolChips({ items, emptyLabel, statusLabel, sectionLabel, headerLabel, explanationLabel, targetLabel, resultLabel, technicalLabel }: { items: readonly ResidentToolChipData[]; emptyLabel: string; statusLabel: (status: ProjectAgentStatus) => string; sectionLabel: string; headerLabel: string; explanationLabel: string; targetLabel: string; resultLabel: string; technicalLabel: string }): JSX.Element | null {
  const hasRunningItem = items.some((item) => item.status === 'running' || item.status === 'drafting')
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!hasRunningItem) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [hasRunningItem])
  // A single active operation stays visible; a completed batch collapses to one
  // compact summary so tool payloads cannot push the conversation off-screen.
  const [groupOpen, setGroupOpen] = React.useState(() => items.length <= 1 || hasRunningItem)
  const [openId, setOpenId] = React.useState<string | null>(null)
  React.useEffect(() => {
    const nextOpen = items.length <= 1 || hasRunningItem
    setGroupOpen(nextOpen)
    if (!nextOpen) setOpenId(null)
  }, [hasRunningItem, items.length])
  if (!items.length) return null
  // data-agent-tool-line: spec §0 挂点
  return <section className="space-y-1.5" data-agent-tool-line="true" data-state={hasRunningItem ? 'running' : 'done'} aria-label={sectionLabel}>
    <button type="button" aria-expanded={groupOpen} aria-controls="agent-tool-run" onClick={() => { setGroupOpen((value) => { if (value) setOpenId(null); return !value }) }} className="-mx-1 flex min-h-7 w-fit items-center gap-1.5 rounded-nomi-sm px-1 text-micro text-nomi-ink-60 transition-[background,color] duration-[var(--nomi-transition-fast)] hover:bg-nomi-ink-05 hover:text-nomi-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent/40 motion-reduce:transition-none" data-agent-tool-header="true">
      <IconChevronRight size={12} className={cn('transition-transform duration-[var(--nomi-transition-fast)] motion-reduce:transition-none', groupOpen && 'rotate-90')} aria-hidden="true" /><IconTool size={13} className="shrink-0 text-nomi-ink-40" aria-hidden="true" />
      <span className="tabular-nums">{headerLabel}</span>
    </button>
    <div id="agent-tool-run" className="grid transition-[grid-template-rows,opacity] duration-[var(--nomi-transition-fast)] motion-reduce:transition-none" style={{ gridTemplateRows: groupOpen ? '1fr' : '0fr', opacity: groupOpen ? 1 : 0 }}>
      <div className="min-h-0 overflow-hidden">
        <div className="grid max-h-[220px] gap-0.5 overflow-y-auto overscroll-contain">
          {items.map((item) => {
            const openItem = item.id === openId
            const detailId = `agent-tool-detail-${item.id}`
            const effect = item.effect || item.summary || statusLabel(item.status)
            const target = item.target || ''
            const result = item.result || statusLabel(item.status)
            const technical = item.technicalDetails || item.detail || ''
            const elapsed = formatResidentToolElapsed(item.elapsedMs ?? residentToolElapsedMs(item.status, item.createdAt, item.updatedAt, now))
            const active = item.status === 'running' || item.status === 'drafting'
            return <div key={item.id} className="min-w-0" data-agent-tool-active={active ? 'true' : undefined}>
              <button type="button" aria-expanded={openItem} aria-controls={openItem ? detailId : undefined} aria-label={[item.label, effect, target, result].filter(Boolean).join(' · ')} onClick={() => setOpenId(openItem ? null : item.id)} className="group/row -mx-1 flex min-h-7 w-[calc(100%+8px)] min-w-0 items-center gap-1.5 rounded-nomi-sm px-1 text-left transition-[background,color] duration-[var(--nomi-transition-fast)] hover:bg-nomi-ink-05 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent/40 motion-reduce:transition-none">
                <span className="relative grid size-4 shrink-0 place-items-center text-nomi-ink-40"><span className={cn('transition-opacity duration-[var(--nomi-transition-fast)] motion-reduce:transition-none', openItem ? 'opacity-0' : 'group-hover/row:opacity-0 group-focus-visible/row:opacity-0')}><ToolActionIcon name={item.name} /></span><IconChevronRight size={12} className={cn('absolute opacity-0 transition-[opacity,transform] duration-[var(--nomi-transition-fast)] group-hover/row:opacity-100 group-focus-visible/row:opacity-100 motion-reduce:transition-none', openItem && 'rotate-90 opacity-100')} aria-hidden="true" /></span>
                <span className="shrink-0 text-micro font-medium text-nomi-ink">{item.label}</span>
                <span className="min-w-0 flex-1 rounded-nomi-sm bg-nomi-ink-05 px-1.5 py-0.5 text-nomi-ink-60 transition-colors duration-[var(--nomi-transition-fast)] group-hover/row:bg-nomi-ink-10 group-focus-visible/row:bg-nomi-ink-10 motion-reduce:transition-none">
                  <span className="block truncate text-micro" data-agent-tool-effect="true">{effect}</span>
                  <span className="block truncate text-micro text-nomi-ink-40" data-agent-tool-target="true">{[target, result].filter(Boolean).join(' · ')}</span>
                </span>{elapsed ? <span className="shrink-0 text-micro tabular-nums text-nomi-ink-40" data-agent-tool-elapsed="true" title={elapsed}>{elapsed}</span> : null}<span title={result} data-agent-tool-result="true" className="grid size-4 shrink-0 place-items-center"><ToolStatusIcon status={item.status} /></span>
              </button>
              {openItem ? <div id={detailId} className="ml-5 overflow-hidden rounded-nomi-sm border-l border-nomi-line-soft pl-2 text-micro" data-agent-tool-detail="true"><div className="flex items-center justify-between gap-2 border-b border-nomi-line-soft py-1 pr-1"><span className="truncate font-medium text-nomi-ink">{item.label}</span><span className="shrink-0 text-nomi-ink-60">{statusLabel(item.status)}</span></div><dl className="grid gap-1.5 py-1.5 pr-1"><div data-agent-tool-effect="true"><dt className="text-nomi-ink-40">{explanationLabel}</dt><dd className="mt-0.5 break-words text-nomi-ink-80">{effect || emptyLabel}</dd></div><div data-agent-tool-target="true"><dt className="text-nomi-ink-40">{targetLabel}</dt><dd className="mt-0.5 break-words text-nomi-ink-80">{target || emptyLabel}</dd></div><div data-agent-tool-result="true"><dt className="text-nomi-ink-40">{resultLabel}</dt><dd className={cn('mt-0.5 break-words', item.status === 'failed' ? 'text-workbench-danger' : 'text-nomi-ink-80')}>{result || emptyLabel}</dd></div></dl>{technical ? <details className="mb-1 rounded-nomi-sm bg-nomi-ink-05 px-2" data-agent-tool-technical="true"><summary className="flex min-h-7 cursor-pointer list-none items-center gap-1.5 text-micro text-nomi-ink-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent/40"><IconChevronRight size={12} aria-hidden="true" /><span>{technicalLabel}</span></summary><p className="m-0 border-t border-nomi-line-soft py-1.5 text-nomi-ink-60">{technical}</p></details> : null}</div> : null}
            </div>
          })}
        </div>
      </div>
    </div>
  </section>
}

export type ResidentApprovalState = 'pending' | 'approved' | 'denied'
/** One escalating approval choice ("this session", "always"), rendered next to deny/approve. */
export type ResidentApprovalAction = Readonly<{ id: string; label: string; onSelect: () => void }>

function ResidentApprovalSecondaryActions({ actions }: { actions?: readonly ResidentApprovalAction[] }): JSX.Element | null {
  if (!actions?.length) return null
  return <div className="flex flex-wrap gap-1.5">{actions.map((action) => <button key={action.id} type="button" className="inline-flex min-h-7 flex-1 items-center justify-center gap-1 rounded-nomi-sm border border-nomi-line px-2 text-micro text-nomi-ink-60 transition-[background,color] duration-[var(--nomi-transition-fast)] hover:bg-nomi-ink-05 hover:text-nomi-ink" onClick={action.onSelect} data-agent-action={action.id}>{action.label}</button>)}</div>
}

export function ResidentApprovalCard({ title, iconName, summary, details, detailsLabel, detailsOpen = false, proposal, state, approveLabel, denyLabel, pendingLabel, approvedLabel, deniedLabel, resolvedApprovedHint, resolvedDeniedHint, notWrittenLabel, onApprove, onDeny, children, secondaryActions, compactGeneration = false }: { title: string; iconName?: string; summary: string; details?: readonly ResidentApprovalDetail[]; detailsLabel?: string; detailsOpen?: boolean; proposal?: ResidentProposalData; state: ResidentApprovalState; approveLabel: string; denyLabel: string; pendingLabel: string; approvedLabel: string; deniedLabel: string; resolvedApprovedHint: string; resolvedDeniedHint: string; notWrittenLabel: string; onApprove: () => void; onDeny: () => void; children?: React.ReactNode; /** Extra approval choices shown above deny/approve, e.g. escalating auto-apply. */ secondaryActions?: readonly ResidentApprovalAction[]; /** Generation proposals already render the canonical prompt/parameter bar; never wrap them in the generic evidence projection. */ compactGeneration?: boolean }): JSX.Element {
  const resolved = state !== 'pending'
  const footerRef = React.useRef<HTMLDivElement>(null)
  const stateLabel = state === 'approved' ? approvedLabel : state === 'denied' ? deniedLabel : pendingLabel
  const proposalGroups = React.useMemo(() => partitionResidentProposalFields(proposal?.fields ?? []), [proposal?.fields])
  const hasDetails = Boolean(details?.length || proposal?.fields.length)
  const prompt = proposalGroups.prompt[0]
  const borderClass = state === 'approved' ? 'border-workbench-success' : state === 'denied' ? 'border-nomi-line-soft' : 'border-nomi-accent'
  const compactFooter = !resolved ? <div className="grid w-full grid-cols-2 gap-1.5"><button type="button" className="inline-flex min-h-7 items-center justify-center gap-1 rounded-nomi-sm border border-nomi-line px-2 text-micro text-nomi-ink-80 transition-[background,color] duration-[var(--nomi-transition-fast)] hover:bg-nomi-ink-05 hover:text-nomi-ink" onClick={onDeny} data-agent-action="deny"><IconX size={13} aria-hidden="true" />{denyLabel}</button><button type="button" className="inline-flex min-h-7 items-center justify-center gap-1 rounded-nomi-sm bg-nomi-ink px-2 text-micro text-nomi-paper transition-opacity duration-[var(--nomi-transition-fast)] hover:opacity-85" onClick={onApprove} data-agent-action="approve"><IconCheck size={13} aria-hidden="true" />{approveLabel}</button></div> : <><span className={cn('inline-flex min-h-7 items-center gap-1 rounded-nomi-sm px-2 text-micro font-medium', state === 'approved' ? 'bg-workbench-success-soft text-workbench-success-ink' : 'bg-nomi-ink-05 text-nomi-ink-60')}>{state === 'approved' ? <IconCheck size={13} aria-hidden="true" /> : <IconCircleDashed size={13} aria-hidden="true" />}{stateLabel}</span><span className="truncate text-micro text-nomi-ink-40">{state === 'approved' ? resolvedApprovedHint : resolvedDeniedHint || notWrittenLabel}</span></>
  if (compactGeneration) {
    return <article className={cn('overflow-hidden rounded-nomi-sm border bg-nomi-paper transition-[border-color] duration-[var(--nomi-transition-fast)] motion-reduce:transition-none', borderClass)} data-agent-approval="true" data-agent-approval-state={state} data-agent-approval-variant="generation">
      <div className="grid min-w-0 gap-1.5 px-2.5 py-2">
        <div className="flex min-w-0 items-center gap-1.5" data-agent-generation-card-header="true">
          <span className="grid size-5 shrink-0 place-items-center text-nomi-accent"><ToolActionIcon name={iconName ?? title} /></span>
          <span className="min-w-0 flex-1 truncate text-micro font-semibold text-nomi-ink">{title}</span>
          {proposalGroups.estimate ? <span className="shrink-0 rounded-pill bg-nomi-accent-soft px-1.5 py-0.5 text-micro font-medium tabular-nums text-nomi-accent" data-agent-proposal-estimate="true" title={`${proposalGroups.estimate.label}: ${proposalGroups.estimate.value}`}>{proposalGroups.estimate.value}</span> : null}
          <span className="shrink-0 text-micro text-nomi-ink-40">{stateLabel}</span>
        </div>
        {children ? <div className="min-w-0" data-agent-proposal-editor-slot="true">{children}</div> : <p className="m-0 truncate text-micro text-nomi-ink-60" data-agent-generation-summary="true">{summary}</p>}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-nomi-line-soft px-2.5 py-1.5" data-agent-approval-footer="true">{compactFooter}</div>
    </article>
  }
  return <article className={cn('overflow-hidden rounded-nomi-sm border bg-nomi-paper transition-[border-color] duration-[var(--nomi-transition-fast)] motion-reduce:transition-none', state === 'approved' ? 'border-workbench-success' : state === 'denied' ? 'border-nomi-line-soft' : 'border-nomi-accent')} data-agent-approval="true" data-agent-approval-state={state}>
    <div className="px-2.5 py-2">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-nomi-sm bg-nomi-accent-soft text-nomi-accent"><ToolActionIcon name={iconName ?? title} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-2">
            <div className="min-w-0 flex-1"><div className="truncate text-micro font-semibold text-nomi-ink">{title}</div><p className="m-0 mt-0.5 break-words text-micro leading-relaxed text-nomi-ink-60">{summary}</p></div>
            {proposalGroups.estimate ? <span className="shrink-0 rounded-pill bg-nomi-accent-soft px-1.5 py-0.5 text-micro font-medium tabular-nums text-nomi-accent" data-agent-proposal-estimate="true" title={`${proposalGroups.estimate.label}: ${proposalGroups.estimate.value}`}>{proposalGroups.estimate.value}</span> : null}
          </div>
        </div>
      </div>
      {prompt ? <div className="mt-1.5 flex min-w-0 items-start gap-1.5 rounded-nomi-sm border border-nomi-line-soft bg-nomi-ink-05 px-2 py-1.5" data-agent-proposal-prompt="true" title={`${prompt.label}: ${prompt.value}`}>
        <IconMessage size={13} className="mt-0.5 shrink-0 text-nomi-accent" aria-hidden="true" />
        <div className="min-w-0"><div className="text-micro font-medium text-nomi-ink-60">{prompt.label}</div><p className="m-0 max-h-10 overflow-hidden break-words text-micro leading-relaxed text-nomi-ink-80">{prompt.value}</p></div>
      </div> : null}
      {proposalGroups.compact.length ? <div className="mt-1.5 flex min-w-0 flex-wrap gap-1" data-agent-proposal="true" data-agent-proposal-compact="true" aria-label={detailsLabel}>{proposalGroups.compact.map((field) => <span key={`${field.label}-${field.value}`} className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-pill border border-nomi-line-soft bg-nomi-ink-05 px-1.5 py-0.5 text-micro" data-agent-proposal-field-kind={residentProposalFieldKind(field)} title={`${field.label}: ${field.value}`}><span className="shrink-0 text-nomi-ink-40">{field.label}</span><span className="min-w-0 truncate text-nomi-ink-80">{field.value}</span></span>)}</div> : null}
      {children ? <div className="mt-1.5 rounded-nomi-sm border border-nomi-line-soft bg-nomi-paper px-2 py-1.5 text-micro" data-agent-proposal-editor-slot="true">{children}</div> : null}
      {hasDetails ? <details open={detailsOpen} onToggle={(event) => { if (event.currentTarget.open) requestAnimationFrame(() => footerRef.current?.scrollIntoView({ block: 'nearest' })) }} className="group mt-1.5 rounded-nomi-sm bg-nomi-ink-05 px-2" data-agent-approval-details="true">
        <summary className="flex min-h-7 cursor-pointer list-none items-center gap-1.5 text-micro text-nomi-ink-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent/40"><IconChevronRight size={12} className="transition-transform duration-[var(--nomi-transition-fast)] group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" /><span>{detailsLabel}</span></summary>
        {proposal?.fields.length ? <dl className="grid max-h-40 gap-1.5 overflow-y-auto overscroll-contain border-t border-nomi-line-soft py-1.5 text-micro" data-agent-proposal-details="true">{proposalGroups.details.filter((field) => residentProposalFieldKind(field) !== 'prompt').map((field) => <div key={`${field.label}-${field.value}`} className="min-w-0"><dt className="text-nomi-ink-40">{field.label}</dt><dd className="m-0 break-words text-nomi-ink-80" data-agent-proposal-field={residentProposalFieldKind(field)}>{field.value}</dd></div>)}</dl> : null}
        {details?.length ? <dl className={cn('grid max-h-40 gap-1.5 overflow-y-auto overscroll-contain border-t border-nomi-line-soft py-1.5 text-micro', proposal?.fields.length && 'mt-1.5')} data-agent-tool-details="true"><div className="grid gap-0.5">{details.map((detail) => <div key={`${detail.label}-${detail.value}`}><dt className="text-nomi-ink-40">{detail.label}</dt><dd className="m-0 break-words text-nomi-ink-80">{detail.value}</dd></div>)}</div></dl> : null}
      </details> : null}
    </div>
    <div ref={footerRef} className="flex items-center justify-between gap-2 border-t border-nomi-line-soft px-2.5 py-1.5">{!resolved ? <div className="grid w-full gap-1.5"><ResidentApprovalSecondaryActions actions={secondaryActions} /><div className="grid w-full grid-cols-2 gap-1.5"><button type="button" className="inline-flex min-h-7 items-center justify-center gap-1 rounded-nomi-sm border border-nomi-line px-2 text-micro text-nomi-ink-80 transition-[background,color] duration-[var(--nomi-transition-fast)] hover:bg-nomi-ink-05 hover:text-nomi-ink" onClick={onDeny} data-agent-action="deny"><IconX size={13} aria-hidden="true" />{denyLabel}</button><button type="button" className="inline-flex min-h-7 items-center justify-center gap-1 rounded-nomi-sm bg-nomi-ink px-2 text-micro text-nomi-paper transition-opacity duration-[var(--nomi-transition-fast)] hover:opacity-85" onClick={onApprove} data-agent-action="approve"><IconCheck size={13} aria-hidden="true" />{approveLabel}</button></div></div> : <><span className={cn('inline-flex min-h-7 items-center gap-1 rounded-nomi-sm px-2 text-micro font-medium', state === 'approved' ? 'bg-workbench-success-soft text-workbench-success-ink' : 'bg-nomi-ink-05 text-nomi-ink-60')}>{state === 'approved' ? <IconCheck size={13} aria-hidden="true" /> : <IconCircleDashed size={13} aria-hidden="true" />}{stateLabel}</span><span className="text-micro text-nomi-ink-40">{state === 'approved' ? resolvedApprovedHint : resolvedDeniedHint || notWrittenLabel}</span></>}</div>
  </article>
}

export function ResidentThinkingState({ label, detail, open, onToggle }: { label: string; detail: string; open: boolean; onToggle: () => void }): JSX.Element {
  return <details open={open} className="rounded-nomi-sm border border-nomi-line-soft bg-nomi-ink-05" data-agent-thinking-line="true"><summary className="flex min-h-7 cursor-pointer list-none items-center gap-1.5 px-2.5 py-1.5 text-micro text-nomi-ink-60" onClick={(event) => { event.preventDefault(); onToggle() }}><IconChevronRight size={12} className={cn('transition-transform duration-[var(--nomi-transition-fast)] motion-reduce:transition-none', open && 'rotate-90')} aria-hidden="true" /><IconRobot size={13} className="text-nomi-accent" aria-hidden="true" /><span className="font-medium">{label}</span></summary>{open ? <p className="m-0 border-t border-nomi-line-soft px-2.5 py-2 text-micro leading-relaxed text-nomi-ink-60">{detail}</p> : null}</details>
}

export function ResidentStreamingText({ text, streaming, streamingLabel, className }: { text: string; streaming: boolean; streamingLabel: string; className?: string }): JSX.Element {
  return <span className={cn('whitespace-pre-wrap break-words', className)} data-agent-streaming={streaming ? 'true' : 'false'}>{text}{streaming ? <span className="ml-0.5 inline-block h-[1em] w-px translate-y-[0.1em] rounded-pill bg-nomi-accent align-baseline motion-safe:animate-pulse" aria-label={streamingLabel} /> : null}</span>
}
