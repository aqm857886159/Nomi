import React from 'react'
import { IconAlertTriangle, IconCheck, IconChevronRight, IconCircleDashed, IconFileText, IconLayoutBoard, IconListCheck, IconLoader2, IconPhoto, IconPlayerStopFilled, IconRobot, IconRotateClockwise, IconTimelineEvent, IconTool, IconVideo, IconX } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import type { ProjectAgentQueueItem, ProjectAgentStatus } from '../../../../electron/shared/projectAgentContracts'

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
  summary: string
  detail?: string
  result: string
  status: ProjectAgentStatus
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
  if (normalized.includes('image') || normalized.includes('asset')) return <IconPhoto size={13} aria-hidden="true" />
  if (normalized.includes('video')) return <IconVideo size={13} aria-hidden="true" />
  if (normalized.includes('document') || normalized.includes('append')) return <IconFileText size={13} aria-hidden="true" />
  if (normalized.includes('timeline')) return <IconTimelineEvent size={13} aria-hidden="true" />
  if (normalized.includes('canvas') || normalized.includes('create_canvas') || normalized.includes('delete_canvas')) return <IconLayoutBoard size={13} aria-hidden="true" />
  return <IconTool size={13} aria-hidden="true" />
}

/**
 * Keep a run as one compact, collapsible group.  The first layer answers
 * "what happened?"; a second click answers "what did it use/return?".  This
 * prevents long prompts and tool payloads from stealing the transcript's
 * attention while keeping every Host-owned detail reachable.
 */
export function ResidentToolChips({ items, emptyLabel, statusLabel, sectionLabel, headerLabel, explanationLabel, resultLabel }: { items: readonly ResidentToolChipData[]; emptyLabel: string; statusLabel: (status: ProjectAgentStatus) => string; sectionLabel: string; headerLabel: string; explanationLabel: string; resultLabel: string }): JSX.Element | null {
  const [groupOpen, setGroupOpen] = React.useState(true)
  const [openId, setOpenId] = React.useState<string | null>(null)
  if (!items.length) return null
  return <section className="space-y-1.5" data-agent-tool-chips="true" aria-label={sectionLabel}>
    <button type="button" aria-expanded={groupOpen} aria-controls="agent-tool-run" onClick={() => { setGroupOpen((value) => { if (value) setOpenId(null); return !value }) }} className="-mx-1 flex min-h-7 w-fit items-center gap-1.5 rounded-nomi-sm px-1 text-micro text-nomi-ink-60 transition-[background,color] duration-[var(--nomi-transition-fast)] hover:bg-nomi-ink-05 hover:text-nomi-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent/40 motion-reduce:transition-none" data-agent-tool-header="true">
      <IconChevronRight size={12} className={cn('transition-transform duration-[var(--nomi-transition-fast)] motion-reduce:transition-none', groupOpen && 'rotate-90')} aria-hidden="true" /><IconTool size={13} className="shrink-0 text-nomi-ink-40" aria-hidden="true" />
      <span className="tabular-nums">{headerLabel}</span>
    </button>
    <div id="agent-tool-run" className="grid transition-[grid-template-rows,opacity] duration-[var(--nomi-transition-fast)] motion-reduce:transition-none" style={{ gridTemplateRows: groupOpen ? '1fr' : '0fr', opacity: groupOpen ? 1 : 0 }}>
      <div className="min-h-0 overflow-hidden">
        <div className="grid gap-0.5">
          {items.map((item) => {
            const openItem = item.id === openId
            const detailId = `agent-tool-detail-${item.id}`
            return <div key={item.id} className="min-w-0">
              <button type="button" aria-expanded={openItem} aria-controls={openItem ? detailId : undefined} onClick={() => setOpenId(openItem ? null : item.id)} className="group/row -mx-1 flex min-h-7 w-[calc(100%+8px)] min-w-0 items-center gap-1.5 rounded-nomi-sm px-1 text-left transition-[background,color] duration-[var(--nomi-transition-fast)] hover:bg-nomi-ink-05 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent/40 motion-reduce:transition-none">
                <span className="relative grid size-4 shrink-0 place-items-center text-nomi-ink-40"><span className={cn('transition-opacity duration-[var(--nomi-transition-fast)] motion-reduce:transition-none', openItem ? 'opacity-0' : 'group-hover/row:opacity-0 group-focus-visible/row:opacity-0')}><ToolActionIcon name={item.name} /></span><IconChevronRight size={12} className={cn('absolute opacity-0 transition-[opacity,transform] duration-[var(--nomi-transition-fast)] group-hover/row:opacity-100 group-focus-visible/row:opacity-100 motion-reduce:transition-none', openItem && 'rotate-90 opacity-100')} aria-hidden="true" /></span>
                <span className="shrink-0 text-micro font-medium text-nomi-ink">{item.label}</span>
                <span className="min-w-0 flex-1 truncate rounded-nomi-sm bg-nomi-ink-05 px-1.5 py-0.5 text-micro text-nomi-ink-60 transition-colors duration-[var(--nomi-transition-fast)] group-hover/row:bg-nomi-ink-10 group-focus-visible/row:bg-nomi-ink-10 motion-reduce:transition-none">{item.summary || statusLabel(item.status)}</span><span title={statusLabel(item.status)} className="grid size-4 shrink-0 place-items-center"><ToolStatusIcon status={item.status} /></span>
              </button>
              {openItem ? <div id={detailId} className="ml-5 overflow-hidden rounded-nomi-sm border-l border-nomi-line-soft pl-2 text-micro" data-agent-tool-detail="true"><div className="flex items-center justify-between gap-2 border-b border-nomi-line-soft py-1 pr-1"><span className="truncate font-medium text-nomi-ink">{item.label}</span><span className="shrink-0 text-nomi-ink-60">{statusLabel(item.status)}</span></div><dl className="grid gap-1.5 py-1.5 pr-1"><div><dt className="text-nomi-ink-40">{explanationLabel}</dt><dd className="mt-0.5 break-words text-nomi-ink-80">{item.detail || item.summary || emptyLabel}</dd></div><div><dt className="text-nomi-ink-40">{resultLabel}</dt><dd className={cn('mt-0.5 break-words', item.status === 'failed' ? 'text-workbench-danger' : 'text-nomi-ink-80')}>{item.result || emptyLabel}</dd></div></dl></div> : null}
            </div>
          })}
        </div>
      </div>
    </div>
  </section>
}

export type ResidentApprovalState = 'pending' | 'approved' | 'denied'
export type ResidentApprovalDetail = Readonly<{ label: string; value: string }>

export function ResidentApprovalCard({ title, iconName, summary, details, detailsLabel, detailsOpen = false, state, approveLabel, denyLabel, pendingLabel, approvedLabel, deniedLabel, resolvedApprovedHint, resolvedDeniedHint, notWrittenLabel, onApprove, onDeny, children }: { title: string; iconName?: string; summary: string; details?: readonly ResidentApprovalDetail[]; detailsLabel?: string; detailsOpen?: boolean; state: ResidentApprovalState; approveLabel: string; denyLabel: string; pendingLabel: string; approvedLabel: string; deniedLabel: string; resolvedApprovedHint: string; resolvedDeniedHint: string; notWrittenLabel: string; onApprove: () => void; onDeny: () => void; children?: React.ReactNode }): JSX.Element {
  const resolved = state !== 'pending'
  const footerRef = React.useRef<HTMLDivElement>(null)
  const stateLabel = state === 'approved' ? approvedLabel : state === 'denied' ? deniedLabel : pendingLabel
  return <article className={cn('overflow-hidden rounded-nomi-sm border bg-nomi-paper transition-[border-color] duration-[var(--nomi-transition-fast)] motion-reduce:transition-none', state === 'approved' ? 'border-workbench-success' : state === 'denied' ? 'border-nomi-line-soft' : 'border-nomi-accent')} data-agent-approval="true" data-agent-approval-state={state}>
    <div className="px-2.5 py-2"><div className="flex items-start gap-2"><span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-nomi-sm bg-nomi-accent-soft text-nomi-accent"><ToolActionIcon name={iconName ?? title} /></span><div className="min-w-0"><div className="text-micro font-semibold text-nomi-ink">{title}</div><p className="m-0 mt-0.5 break-words text-micro leading-relaxed text-nomi-ink-60">{summary}</p></div></div>{details?.length ? <details open={detailsOpen} onToggle={(event) => { if (event.currentTarget.open) requestAnimationFrame(() => footerRef.current?.scrollIntoView({ block: 'nearest' })) }} className="group mt-1.5 rounded-nomi-sm bg-nomi-ink-05 px-2" data-agent-approval-details="true"><summary className="flex min-h-7 cursor-pointer list-none items-center gap-1.5 text-micro text-nomi-ink-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent/40"><IconChevronRight size={12} className="transition-transform duration-[var(--nomi-transition-fast)] group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" /><span>{detailsLabel}</span></summary><dl className="grid max-h-16 gap-1.5 overflow-y-auto overscroll-contain border-t border-nomi-line-soft py-1.5 text-micro"><div className="grid gap-0.5">{details.map((detail) => <div key={`${detail.label}-${detail.value}`}><dt className="text-nomi-ink-40">{detail.label}</dt><dd className="m-0 break-words text-nomi-ink-80">{detail.value}</dd></div>)}</div></dl></details> : null}{children ? <div className="mt-2 rounded-nomi-sm border border-nomi-line-soft bg-nomi-ink-05 px-2 py-1.5 text-micro">{children}</div> : null}</div>
    <div ref={footerRef} className="flex items-center justify-between gap-2 border-t border-nomi-line-soft px-2.5 py-1.5">{!resolved ? <div className="grid w-full grid-cols-2 gap-1.5"><button type="button" className="inline-flex min-h-7 items-center justify-center gap-1 rounded-nomi-sm border border-nomi-line px-2 text-micro text-nomi-ink-80 transition-[background,color] duration-[var(--nomi-transition-fast)] hover:bg-nomi-ink-05 hover:text-nomi-ink" onClick={onDeny} data-agent-action="deny"><IconX size={13} aria-hidden="true" />{denyLabel}</button><button type="button" className="inline-flex min-h-7 items-center justify-center gap-1 rounded-nomi-sm bg-nomi-ink px-2 text-micro text-nomi-paper transition-opacity duration-[var(--nomi-transition-fast)] hover:opacity-85" onClick={onApprove} data-agent-action="approve"><IconCheck size={13} aria-hidden="true" />{approveLabel}</button></div> : <><span className={cn('inline-flex min-h-7 items-center gap-1 rounded-nomi-sm px-2 text-micro font-medium', state === 'approved' ? 'bg-workbench-success-soft text-workbench-success-ink' : 'bg-nomi-ink-05 text-nomi-ink-60')}>{state === 'approved' ? <IconCheck size={13} aria-hidden="true" /> : <IconCircleDashed size={13} aria-hidden="true" />}{stateLabel}</span><span className="text-micro text-nomi-ink-40">{state === 'approved' ? resolvedApprovedHint : resolvedDeniedHint || notWrittenLabel}</span></>}</div>
  </article>
}

export function ResidentTaskRows({ entries, getLabel, getStatusLabel, editLabel, cancelLabel, stopLabel, queueLabel, queueCountLabel, onEdit, onCancel, onStop }: { entries: readonly ProjectAgentQueueItem[]; getLabel: (entry: ProjectAgentQueueItem) => string; getStatusLabel: (status: ProjectAgentStatus) => string; editLabel: string; cancelLabel: string; stopLabel: string; queueLabel: string; queueCountLabel: string; onEdit: (entry: ProjectAgentQueueItem) => void; onCancel: (entry: ProjectAgentQueueItem) => void; onStop?: (entry: ProjectAgentQueueItem) => void }): JSX.Element | null {
  const [open, setOpen] = React.useState(entries.length <= 1)
  React.useEffect(() => {
    // 一堆任务时只露出数量，避免队列把正在进行的对话顶出屏幕；单个任务仍直达操作。
    setOpen(entries.length <= 1)
  }, [entries.length])
  if (!entries.length) return null
  const visibleEntries = entries.slice(-3)
  return <section className="space-y-1 border-t border-nomi-line-soft px-3 py-1.5" data-agent-queue="true">
    <div className="flex items-center justify-between gap-2 text-micro text-nomi-ink-60">
      <button type="button" className="inline-flex min-h-7 items-center gap-1.5 rounded-nomi-sm px-1 font-medium hover:bg-nomi-ink-05" aria-expanded={open} aria-controls="agent-queue-items" onClick={() => setOpen((value) => !value)}>
        <IconChevronRight size={12} className={cn('transition-transform duration-[var(--nomi-transition-fast)] motion-reduce:transition-none', open && 'rotate-90')} aria-hidden="true" />
        <IconListCheck size={13} className="text-nomi-ink-40" aria-hidden="true" />{queueLabel}<span className="text-nomi-ink-40">{queueCountLabel}</span>
      </button>
      {onStop ? <button type="button" className="ml-auto inline-flex min-h-7 items-center gap-1 rounded-nomi-sm px-2 text-workbench-danger transition-[background,color] duration-[var(--nomi-transition-fast)] hover:bg-workbench-danger-soft" data-agent-action="stop" onClick={() => onStop(entries[0])}><IconPlayerStopFilled size={12} aria-hidden="true" />{stopLabel}</button> : null}
    </div>
    {open ? <ul id="agent-queue-items" className="m-0 grid list-none gap-1 p-0">{visibleEntries.map((entry) => <li key={entry.queueItemId} className="flex min-h-7 items-center gap-1.5 rounded-nomi-sm bg-nomi-ink-05 px-2 py-1 text-micro" data-agent-queue-item="true"><span className="size-1.5 shrink-0 rounded-pill bg-nomi-accent" aria-hidden="true" /><span className="min-w-0 flex-1 truncate text-nomi-ink-80">{getLabel(entry)}</span><span className="shrink-0 text-nomi-ink-40">{getStatusLabel(entry.status)}</span>{entry.status === 'queued' ? <button type="button" className="grid size-6 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-60 hover:bg-nomi-ink-10 hover:text-nomi-ink" aria-label={editLabel} title={editLabel} onClick={() => onEdit(entry)}><IconRotateClockwise size={13} aria-hidden="true" /></button> : null}<button type="button" className="grid size-6 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-60 hover:bg-workbench-danger-soft hover:text-workbench-danger" aria-label={cancelLabel} title={cancelLabel} onClick={() => onCancel(entry)}><IconX size={13} aria-hidden="true" /></button></li>)}</ul> : null}
  </section>
}

export function ResidentThinkingState({ label, detail, open, onToggle }: { label: string; detail: string; open: boolean; onToggle: () => void }): JSX.Element {
  return <details open={open} className="rounded-nomi-sm border border-nomi-line-soft bg-nomi-ink-05" data-agent-thinking="true"><summary className="flex min-h-7 cursor-pointer list-none items-center gap-1.5 px-2.5 py-1.5 text-micro text-nomi-ink-60" onClick={(event) => { event.preventDefault(); onToggle() }}><IconChevronRight size={12} className={cn('transition-transform duration-[var(--nomi-transition-fast)] motion-reduce:transition-none', open && 'rotate-90')} aria-hidden="true" /><IconRobot size={13} className="text-nomi-accent" aria-hidden="true" /><span className="font-medium">{label}</span></summary>{open ? <p className="m-0 border-t border-nomi-line-soft px-2.5 py-2 text-micro leading-relaxed text-nomi-ink-60">{detail}</p> : null}</details>
}

export function ResidentStreamingText({ text, streaming, streamingLabel }: { text: string; streaming: boolean; streamingLabel: string }): JSX.Element {
  return <span className="whitespace-pre-wrap break-words" data-agent-streaming={streaming ? 'true' : 'false'}>{text}{streaming ? <span className="ml-0.5 inline-block h-[1em] w-px translate-y-[0.1em] rounded-pill bg-nomi-accent align-baseline motion-safe:animate-pulse" aria-label={streamingLabel} /> : null}</span>
}
