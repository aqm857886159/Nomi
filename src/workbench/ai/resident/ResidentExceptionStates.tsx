import React from 'react'
import {
  IconAlertTriangle,
  IconChevronDown,
  IconCircleDashed,
  IconPencil,
  IconInfoCircle,
  IconPin,
  IconPhoto,
  IconRefresh,
  IconSearch,
  IconUpload,
} from '@tabler/icons-react'
import type { AssetRef } from '../../assets/assetTypes'
import { AssetThumb } from '../../assets/AssetTile'
import { cn } from '../../../utils/cn'
import { residentVisibleCandidates } from './residentExceptionProjections'
import type { ProjectAgentCommittedProposalRecord } from '../../../../electron/shared/projectAgentProposalReceipt'

type Label = string
const IconEdit = IconPencil

export type ResidentPlanShot = Readonly<{
  id: string
  title: string
  description: string
  selected?: boolean
  edited?: boolean
}>

export type ResidentDeviation = Readonly<{
  where: string
  field: string
  detail: string
}>

export type ResidentCandidate = Readonly<{
  id: string
  label: string
  imageUrl?: string
}>

export type ResidentQuestionOption = Readonly<{ id: string; label: string }>

export function ResidentPinnedResultCard({ record, undoLabel, onUndo, summaryLabel, openLabel, collapseLabel }: {
  record: ProjectAgentCommittedProposalRecord
  undoLabel: Label
  onUndo: () => void
  summaryLabel: (total: number, selected: number) => Label
  openLabel: Label
  collapseLabel: Label
}): JSX.Element {
  const [open, setOpen] = React.useState(false)
  const [selected, setSelected] = React.useState(() => new Set(record.watchNodes.map((node) => node.nodeId)))
  React.useEffect(() => setSelected(new Set(record.watchNodes.map((node) => node.nodeId))), [record])
  return <article className="overflow-hidden rounded-nomi-sm border border-nomi-line bg-nomi-paper" data-agent-pinned-card="true" data-state={open ? 'expanded' : 'collapsed'}>
    <button type="button" className="flex h-7 w-full items-center gap-1.5 px-2.5 text-left text-micro hover:bg-nomi-ink-05 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent/40" data-agent-pinned-head="true" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <IconPin size={13} className="shrink-0 text-nomi-accent" aria-hidden="true" /><span className="font-semibold text-nomi-ink">{record.summary}</span><span className="truncate text-nomi-ink-40" data-agent-pinned-summary="true">{summaryLabel(record.watchNodes.length, selected.size)}</span><span className="ml-auto text-nomi-ink-40" aria-label={open ? collapseLabel : openLabel}><IconChevronDown size={12} className={cn('transition-transform motion-reduce:transition-none', open && 'rotate-180')} aria-hidden="true" /></span>
    </button>
    {open ? <div className="border-t border-nomi-line-soft px-2.5 pb-2" data-agent-pinned-body="true">
      <div className="max-h-[194px] overflow-y-auto py-1">{record.watchNodes.map((node) => <label key={node.nodeId} className="flex min-h-7 items-center gap-1.5 border-b border-nomi-line-soft py-1 text-micro"><input type="checkbox" checked={selected.has(node.nodeId)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.currentTarget.checked) next.add(node.nodeId); else next.delete(node.nodeId); return next })} /><span className="min-w-0 flex-1 truncate text-nomi-ink">{node.title}</span></label>)}</div>
      <div className="flex items-center justify-between gap-2 pt-1 text-micro text-nomi-ink-60"><span>{summaryLabel(record.watchNodes.length, selected.size)}</span><button type="button" className="text-nomi-accent hover:underline" onClick={onUndo}>{undoLabel}</button></div>
    </div> : null}
  </article>
}

function iconButtonClass(danger = false): string {
  return cn(
    'grid size-8 shrink-0 place-items-center rounded-nomi-sm border bg-transparent transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent/40',
    danger
      ? 'border-workbench-danger text-workbench-danger hover:bg-workbench-danger-soft'
      : 'border-nomi-line text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink',
  )
}

function Shimmer({ className }: { className?: string }): JSX.Element {
  return <span aria-hidden="true" className={cn('block rounded-pill bg-nomi-ink-10 motion-safe:animate-pulse motion-reduce:animate-none', className)} />
}

/**
 * Shared long-content treatment: three lines, then an explicit link. No mask.
 *
 * Content **below** the fold threshold is shown in full and wraps normally. It used to be clamped to
 * `h-5` (one line) with `whitespace-nowrap`, which meant every reply between one line and 360 chars
 * was cut off mid-sentence with no fold link and no affordance of any kind — measured 2026-09-06, a
 * 46-character reply lost 138px of itself. The clamp came from copying the approved mockup's measured
 * height (`data-agent-reply` h:19 in agent-ui-spec.generated.json) as if it were a rule; it is a
 * derived value of that mockup's one-line sample string, not a constraint on every reply.
 */
export function ResidentFoldableText({
  text,
  expandLabel,
  collapseLabel,
  estimatedExtra,
  className,
  contentClassName,
  dataUserContent = false,
  foldLinkOutside = false,
  contentWrapClassName,
}: {
  text: string
  expandLabel: Label
  collapseLabel: Label
  estimatedExtra?: Label
  className?: string
  contentClassName?: string
  dataUserContent?: boolean
  foldLinkOutside?: boolean
  contentWrapClassName?: string
}): JSX.Element {
  const long = text.split(/\r?\n/).length > 3 || text.length > 360
  const [open, setOpen] = React.useState(false)
  const content = <div className={cn(!open && long && 'line-clamp-3', 'whitespace-pre-wrap break-words', contentClassName)} data-user-content={dataUserContent ? 'true' : undefined}>{text}</div>
  const link = long ? <button type="button" className="mt-0.5 inline-flex items-center gap-0.5 text-micro text-nomi-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent/40" data-fold-expand="true" onClick={() => setOpen((value) => !value)}>
      <IconChevronDown size={12} className={cn('transition-transform motion-reduce:transition-none', open && 'rotate-180')} aria-hidden="true" />{open ? collapseLabel : `${expandLabel}${estimatedExtra ? ` · ${estimatedExtra}` : ''}`}
    </button> : null
  if (foldLinkOutside) return <div className={cn('min-w-0', className)} data-fold-text={long ? 'true' : undefined}><div className={contentWrapClassName}>{content}</div>{link}</div>
  return <div className={cn('min-w-0', className)} data-fold-text={long ? 'true' : undefined}>{content}{link}</div>
}

export function ResidentPlanCard({
  state,
  shots,
  parameters,
  failureReason,
  billing,
  editLabel,
  retryLabel,
  loadingLabel,
  summaryLabel,
  generateLabel,
  editedLabel,
  selectAllLabel,
  onEdit,
  onRetry,
  onGenerate,
  onSelectionChange,
  children,
}: {
  state: string
  shots: readonly ResidentPlanShot[]
  parameters: readonly Label[]
  failureReason: Label
  billing: Label
  editLabel: Label
  retryLabel: Label
  loadingLabel: Label
  summaryLabel: (total: number, selected: number) => Label
  generateLabel: (selected: number) => Label
  editedLabel: Label
  selectAllLabel: Label
  onEdit: () => void
  onRetry: () => void
  onGenerate: (selected: readonly string[]) => void
  onSelectionChange?: (selected: readonly string[]) => void
  children?: React.ReactNode
}): JSX.Element {
  const initial = React.useMemo(() => new Set(shots.filter((shot) => shot.selected !== false).map((shot) => shot.id)), [shots])
  const [selected, setSelected] = React.useState<Set<string>>(initial)
  React.useEffect(() => setSelected(initial), [initial])
  const updateSelected = (id: string, value: boolean): void => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (value) next.add(id)
      else next.delete(id)
      onSelectionChange?.([...next])
      return next
    })
  }
  if (state === 'loading') return <article className="overflow-hidden rounded-nomi-sm border border-nomi-accent bg-nomi-paper" data-agent-plan-card="true" data-state="loading">
    <div className="flex min-h-9 items-center gap-1.5 border-b border-nomi-line-soft px-2.5 py-1.5 text-micro font-semibold text-nomi-ink"><IconCircleDashed size={15} className="animate-spin text-nomi-accent motion-reduce:animate-none" aria-hidden="true" />{loadingLabel}</div>
    <div className="grid gap-2 px-2.5 py-2"><div className="flex gap-1.5"><Shimmer className="h-7 w-24" /><Shimmer className="h-7 w-20" /></div><div className="grid gap-1.5" data-plan-list="true">{[0, 1, 2, 3].map((index) => <div key={index} className="flex items-center gap-1.5"><Shimmer className="size-4" /><Shimmer className="h-4 w-5" /><Shimmer className="h-4 flex-1" /></div>)}</div></div>
    <div className="flex items-center gap-1.5 border-t border-nomi-line-soft px-2.5 py-1.5"><button type="button" disabled className="h-8 flex-1 rounded-nomi-sm border border-nomi-line text-micro text-nomi-ink-40">{selectAllLabel}</button><button type="button" disabled className="h-8 flex-1 rounded-nomi-sm bg-nomi-ink-10 text-micro text-nomi-ink-40">{loadingLabel}</button></div>
  </article>
  if (state === 'failed') return <article className="overflow-hidden rounded-nomi-sm border border-workbench-danger bg-nomi-paper" data-agent-plan-card="true" data-state="failed">
    <div className="flex items-center gap-1.5 border-b border-nomi-line-soft px-2.5 py-2 text-micro font-semibold text-workbench-danger"><IconAlertTriangle size={15} aria-hidden="true" />{failureReason}</div>
    <div className="px-2.5 py-2 text-micro text-nomi-ink-60" data-err-reason="true">{failureReason}</div>
    <div className="mx-2.5 rounded-nomi-sm bg-nomi-ink-05 px-2 py-1.5 text-micro text-nomi-ink-40" data-err-billing="true">{billing}</div>
    <div className="flex justify-end gap-1.5 px-2.5 py-2"><button type="button" className={iconButtonClass()} aria-label={editLabel} title={editLabel} data-agent-tip={editLabel} onClick={onEdit}><IconEdit size={15} aria-hidden="true" /></button><button type="button" className={iconButtonClass()} aria-label={retryLabel} title={retryLabel} data-agent-tip={retryLabel} onClick={onRetry}><IconRefresh size={15} aria-hidden="true" /></button></div>
  </article>
  return <article className="overflow-hidden rounded-nomi-sm border border-nomi-accent bg-nomi-paper" data-agent-plan-card="true" data-state="ready">
    <div className="flex flex-wrap items-center gap-1.5 border-b border-nomi-line-soft px-2.5 py-2 text-micro font-semibold text-nomi-ink"><IconCircleDashed size={15} className="text-nomi-accent" aria-hidden="true" />{parameters.slice(0, 2).filter((value, index, list) => list.indexOf(value) === index).map((value) => <span key={value} className="rounded-pill bg-nomi-accent-soft px-1.5 py-0.5 font-medium text-nomi-accent">{value}</span>)}</div>
    <div className="max-h-[220px] overflow-y-auto overscroll-contain" data-plan-list="true">{shots.map((shot, index) => <label key={shot.id} className="flex min-h-8 items-center gap-1.5 border-b border-nomi-line-soft px-2.5 py-1.5 text-micro"><input type="checkbox" checked={selected.has(shot.id)} onChange={(event) => updateSelected(shot.id, event.currentTarget.checked)} /><span className="w-4 shrink-0 text-nomi-ink-40 tabular-nums">{index + 1}</span><span className="min-w-0 flex-1 truncate font-medium text-nomi-ink">{shot.title}<span className="ml-1 font-normal text-nomi-ink-60">{shot.description}</span></span>{shot.edited ? <span className="shrink-0 text-nomi-accent">{editedLabel}</span> : null}</label>)}</div>{children ? <div className="border-t border-nomi-line-soft px-2.5 py-2" data-agent-proposal-editor-slot="true">{children}</div> : null}
    <div className="flex items-center justify-between border-t border-nomi-line-soft px-2.5 py-1.5 text-micro text-nomi-ink-60" data-plan-summary="true"><span>{summaryLabel(shots.length, selected.size)}</span><button type="button" className="h-8 rounded-nomi-sm bg-nomi-ink px-2.5 text-micro text-nomi-paper disabled:opacity-40" disabled={!selected.size} onClick={() => onGenerate([...selected])}>{generateLabel(selected.size)}</button></div>
  </article>
}

export function ResidentSpendCard({
  knownRows,
  amount,
  failureReason,
  refreshLabel,
  continueLabel,
  onRefresh,
  onContinue,
  amountLabel,
  unknownAmountLabel,
}: {
  knownRows: readonly Readonly<{ label: Label; value: Label }>[]
  amount: number | null
  failureReason: Label
  refreshLabel: Label
  continueLabel: Label
  onRefresh: () => void
  onContinue: () => void
  amountLabel: (amount: number) => Label
  unknownAmountLabel: Label
}): JSX.Element {
  return <article className="rounded-nomi-sm border border-workbench-danger bg-nomi-paper" data-agent-spend-card="true" data-state={amount === null ? 'price-failed' : 'ready'}>
    <div className="flex items-center gap-1.5 px-2.5 py-2 text-micro font-semibold text-nomi-ink"><IconAlertTriangle size={15} className="text-workbench-danger" aria-hidden="true" />{failureReason}</div>
    <div className="grid gap-1 border-t border-nomi-line-soft px-2.5 py-2 text-micro">{knownRows.map((row) => <div key={row.label} className="flex justify-between gap-2" data-price-known="true"><span className="text-nomi-ink-60">{row.label}</span><span>{row.value}</span></div>)}<div className="flex justify-between gap-2 border-t border-nomi-line-soft pt-1.5 font-semibold text-workbench-danger" data-price-unknown="true"><span>{failureReason}</span><span>{amount === null ? unknownAmountLabel : amountLabel(amount)}</span></div></div>
    <div className="grid grid-cols-2 gap-1.5 px-2.5 pb-2"><button type="button" className="h-8 rounded-nomi-sm border border-nomi-line px-2 text-micro" onClick={onRefresh}>{refreshLabel}</button><button type="button" className="h-8 rounded-nomi-sm border border-workbench-danger px-2 text-micro text-workbench-danger" onClick={onContinue}>{continueLabel}</button></div>
  </article>
}

export function ResidentDeviationCard({ deviations, moreLabel, collapseLabel, actions, onAction }: { deviations: readonly ResidentDeviation[]; moreLabel: Label; collapseLabel: Label; actions: readonly Label[]; onAction?: (action: string) => void }): JSX.Element {
  const [open, setOpen] = React.useState(false)
  const visible = open ? deviations : deviations.slice(0, 5)
  const hidden = Math.max(0, deviations.length - 5)
  return <article className="overflow-hidden rounded-nomi-sm border border-nomi-warning bg-nomi-paper" data-agent-deviation-card="true"><div className="flex items-center gap-1.5 px-2.5 py-2 text-micro font-semibold text-nomi-ink"><IconAlertTriangle size={15} className="text-nomi-warning" aria-hidden="true" />{moreLabel}</div><div className={cn('max-h-[220px] overflow-y-auto overscroll-contain px-2.5', open && 'max-h-none')} data-deviation-list="true">{visible.map((deviation) => <div key={`${deviation.where}-${deviation.field}`} className="mb-1 rounded-nomi-sm bg-nomi-ink-05 px-2 py-1.5 text-micro"><div className="font-medium text-nomi-ink">{deviation.where} · {deviation.field}</div><div className="text-nomi-ink-60">{deviation.detail}</div></div>)}</div>{hidden ? <button type="button" className="flex w-full items-center gap-1 px-2.5 py-1 text-left text-micro text-nomi-accent" data-deviation-more="true" onClick={() => setOpen((value) => !value)}><IconChevronDown size={12} className={cn(open && 'rotate-180')} aria-hidden="true" />{open ? collapseLabel : moreLabel}</button> : null}<div className="flex items-center gap-1.5 border-t border-nomi-line-soft px-2.5 py-2">{actions.slice(0, 3).map((action) => <button type="button" key={action} className="h-8 flex-1 rounded-nomi-sm border border-nomi-line px-1 text-micro" onClick={() => onAction?.(action)}>{action}</button>)}</div></article>
}

export function ResidentCandidatesCard({ candidates, versionCountLabel, adoptLabel, moreLabel, collapseLabel, onSelect }: { candidates: readonly ResidentCandidate[]; versionCountLabel: (count: number) => Label; adoptLabel: (label: string) => Label; moreLabel: Label; collapseLabel: Label; onSelect?: (candidate: ResidentCandidate) => void }): JSX.Element {
  const [open, setOpen] = React.useState(false)
  const [selected, setSelected] = React.useState(candidates[0]?.id)
  const visible = residentVisibleCandidates(candidates, open)
  const choose = (candidate: ResidentCandidate): void => { setSelected(candidate.id); onSelect?.(candidate) }
  return <article className="rounded-nomi-sm border border-nomi-accent bg-nomi-paper p-2.5" data-agent-candidates-card="true"><div className="mb-1.5 flex items-center gap-1.5 text-micro font-semibold"><IconPhoto size={14} className="text-nomi-accent" aria-hidden="true" />{versionCountLabel(candidates.length)}</div><div className="flex flex-wrap gap-1.5"><div className="grid min-w-0 flex-1 grid-cols-3 gap-1.5" data-candidates-row="true">{visible.map((candidate) => <button type="button" key={candidate.id} className={cn('relative min-w-0 rounded-nomi-sm border p-1 text-left text-micro', selected === candidate.id ? 'border-nomi-accent' : 'border-nomi-line')} onClick={() => choose(candidate)}><span className="grid aspect-[4/3] place-items-center overflow-hidden rounded-nomi-sm bg-nomi-ink-05">{candidate.imageUrl ? <img src={candidate.imageUrl} alt="" className="size-full object-cover" /> : <IconPhoto size={18} className="text-nomi-ink-30" aria-hidden="true" />}</span><span className="mt-1 block truncate">{candidate.label}</span></button>)}</div>{!open && candidates.length > 3 ? <button type="button" className="grid h-20 w-10 shrink-0 place-items-center rounded-nomi-sm border border-dashed border-nomi-line text-micro text-nomi-ink-60" data-cand-more="true" onClick={() => setOpen(true)}>{moreLabel}</button> : null}</div>{open && candidates.length > 3 ? <button type="button" className="mt-1 text-micro text-nomi-accent" onClick={() => setOpen(false)}>{collapseLabel}</button> : null}<button type="button" className="mt-2 h-8 w-full rounded-nomi-sm bg-nomi-ink text-micro text-nomi-paper" onClick={() => { const candidate = candidates.find((item) => item.id === selected); if (candidate) onSelect?.(candidate) }}>{adoptLabel(candidates.find((item) => item.id === selected)?.label || '')}</button></article>
}

export function ResidentQuestionCard({ question, options, pageLabel, moreLabel, collapseLabel, skipLabel, nextLabel, onAnswer, onSkip, onNext }: { question: string; options: readonly ResidentQuestionOption[]; pageLabel: Label; moreLabel: Label; collapseLabel: Label; skipLabel: Label; nextLabel: Label; onAnswer?: (option: ResidentQuestionOption) => void; onSkip?: () => void; onNext?: () => void }): JSX.Element {
  const [open, setOpen] = React.useState(false)
  const visible = open ? options : options.slice(0, 4)
  return <article className="rounded-nomi-sm border border-nomi-accent bg-nomi-paper p-2.5" data-agent-question-card="true"><div className="mb-1 flex items-center justify-between text-micro text-nomi-ink-60"><span className="flex items-center gap-1.5 font-semibold text-nomi-ink"><IconInfoCircle size={14} className="text-nomi-accent" aria-hidden="true" />{pageLabel}</span><button type="button" className="text-nomi-accent" onClick={onSkip}>{skipLabel}</button></div><ResidentFoldableText text={question} expandLabel={moreLabel} collapseLabel={collapseLabel} className="mb-1.5 text-micro text-nomi-ink-80" /><div className="grid gap-1">{visible.map((option, index) => <button type="button" key={option.id} className="min-h-8 rounded-nomi-sm border border-nomi-line px-2 text-left text-micro hover:border-nomi-accent" onClick={() => onAnswer?.(option)}><span className="mr-1 text-nomi-ink-40">{index + 1}</span>{option.label}</button>)}</div>{!open && options.length > 4 ? <button type="button" className="mt-1 flex w-full items-center gap-1 rounded-nomi-sm border border-nomi-accent px-2 py-1 text-left text-micro text-nomi-accent" onClick={() => setOpen(true)}><IconChevronDown size={12} aria-hidden="true" />{moreLabel}</button> : null}<button type="button" className="mt-1.5 h-8 w-full rounded-nomi-sm bg-nomi-ink text-micro text-nomi-paper" onClick={onNext}>{nextLabel}</button></article>
}

export function ResidentArtifactCard({ state, title, sizeLabel, versionLabel, waitLabel, failureReason, billing, retryLabel, editLabel, openLabel, onRetry, onEdit, onOpen }: { state: string; title: Label; sizeLabel: Label; versionLabel: Label; waitLabel: Label; failureReason: Label; billing: Label; retryLabel: Label; editLabel: Label; openLabel: Label; onRetry: () => void; onEdit: () => void; onOpen: () => void }): JSX.Element {
  const loading = state === 'loading'
  return <article className="rounded-nomi-sm border border-nomi-line bg-nomi-paper p-2.5" data-agent-artifact-card="true" data-state={state}><div className="flex items-center gap-1.5 text-micro font-semibold"><span className="min-w-0 flex-1 truncate">{title}</span><span className="shrink-0 text-nomi-ink-40">{sizeLabel} · {versionLabel}</span></div><div className={cn('mt-2 grid aspect-[4/3] place-items-center overflow-hidden rounded-nomi-sm', loading ? 'bg-nomi-ink-05' : 'border border-workbench-danger')} data-artifact-thumb="true" data-artifact-err={!loading ? 'true' : undefined}>{loading ? <Shimmer className="h-8 w-3/4" /> : <><IconAlertTriangle size={20} className="text-workbench-danger" aria-hidden="true" /><span className="text-micro text-workbench-danger">{failureReason}</span></>}</div><div className="mt-1.5 flex items-center gap-1.5 text-micro" data-artifact-acts="true"><button type="button" disabled={loading} className={iconButtonClass()} aria-label={retryLabel} title={retryLabel} onClick={onRetry}><IconRefresh size={14} aria-hidden="true" /></button><button type="button" disabled={loading} className={iconButtonClass()} aria-label={editLabel} title={editLabel} onClick={onEdit}><IconEdit size={14} aria-hidden="true" /></button><button type="button" disabled={loading} className="ml-auto h-8 rounded-nomi-sm border border-nomi-line px-2 text-micro disabled:cursor-not-allowed disabled:opacity-30" onClick={onOpen}>{openLabel}</button></div><div className={cn('mt-1 flex items-center gap-1 text-micro', loading ? 'text-nomi-ink-40' : 'text-workbench-success-ink')} data-err-billing={!loading ? 'true' : undefined}>{loading ? <><IconCircleDashed size={12} aria-hidden="true" />{waitLabel}</> : <><IconInfoCircle size={12} aria-hidden="true" />{billing}</>}</div></article>
}

export function ResidentFailureCard({ reason, billing, actions, onAction }: { reason: Label; billing: Label; actions: readonly Label[]; onAction?: (action: string) => void }): JSX.Element {
  return <article className="rounded-nomi-sm border border-workbench-danger bg-nomi-paper p-2.5" data-agent-failure-card="true"><div className="flex items-center gap-1.5 text-micro font-semibold text-workbench-danger" data-err-reason="true"><IconAlertTriangle size={15} aria-hidden="true" />{reason}</div><div className="mt-1.5 text-micro text-workbench-success-ink" data-err-billing="true">{billing}</div><div className="mt-2 grid grid-cols-3 gap-1.5">{actions.slice(0, 3).map((action) => <button type="button" key={action} className="h-8 min-w-0 rounded-nomi-sm border border-nomi-line px-1 text-micro" onClick={() => onAction?.(action)}>{action}</button>)}</div></article>
}

export function ResidentWriteFailureRow({ reason, billing, retryLabel, onRetry }: { reason: Label; billing: Label; retryLabel: Label; onRetry: () => void }): JSX.Element {
  return <article className="grid gap-1 rounded-nomi-sm border border-workbench-danger bg-nomi-paper px-2.5 py-1.5" data-agent-write-failure="true" data-agent-proposal-receipt="true" data-state="failed"><div className="flex items-center gap-1.5"><IconAlertTriangle size={15} className="shrink-0 text-workbench-danger" aria-hidden="true" /><span className="min-w-0 flex-1 text-micro font-medium text-workbench-danger" data-err-reason="true">{reason}</span><button type="button" className={iconButtonClass(true)} aria-label={retryLabel} title={retryLabel} data-agent-tip={retryLabel} onClick={onRetry}><IconRefresh size={14} aria-hidden="true" /></button></div><div className="rounded-nomi-sm bg-nomi-ink-05 px-2 py-1 text-micro text-nomi-ink-60" data-err-billing="true">{billing}</div></article>
}

export function ResidentAtPicker({ assets, groups, emptyTitle, emptyDescription, uploadLabel, searchLabel, onPickAsset, onUpload, onPickGroup }: { assets: readonly AssetRef[]; groups: readonly Readonly<{ label: Label; items: readonly Readonly<{ id: string; label: string; kind?: string }>[] }>[]; emptyTitle: Label; emptyDescription: Label; uploadLabel: Label; searchLabel: Label; onPickAsset: (asset: AssetRef) => void; onUpload: () => void; onPickGroup?: (item: Readonly<{ id: string; label: string; kind?: string }>) => void }): JSX.Element {
  const [query, setQuery] = React.useState('')
  const showSearch = assets.length > 50
  const visibleAssets = assets.filter((asset) => !query.trim() || asset.name.toLowerCase().includes(query.trim().toLowerCase()))
  return <div className="grid max-h-[280px] gap-1.5 overflow-y-auto rounded-nomi border border-nomi-line bg-nomi-paper p-2 shadow-nomi-md" data-agent-at-picker="true" data-empty={!assets.length ? 'true' : 'false'}>
    {showSearch ? <label className="flex h-8 items-center gap-1.5 rounded-nomi-sm border border-nomi-line px-2 text-micro text-nomi-ink-40"><IconSearch size={14} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder={searchLabel} aria-label={searchLabel} data-at-search="true" className="min-w-0 flex-1 bg-transparent outline-none" /></label> : null}
    {!assets.length ? <div className="grid justify-items-center gap-1.5 px-3 py-5 text-center"><IconPhoto size={28} className="text-nomi-ink-20" aria-hidden="true" /><strong className="text-caption">{emptyTitle}</strong><span className="text-micro text-nomi-ink-60">{emptyDescription}</span><button type="button" className="mt-1 inline-flex h-8 items-center gap-1.5 rounded-nomi-sm border border-nomi-line px-2.5 text-micro hover:border-nomi-accent" data-at-empty-cta="true" onClick={onUpload}><IconUpload size={14} aria-hidden="true" />{uploadLabel}</button></div> : <><div className="grid grid-cols-1 gap-1">{visibleAssets.slice(0, 50).map((asset) => <button type="button" key={asset.id} className="flex min-h-10 items-center gap-2 rounded-nomi-sm px-1 text-left hover:bg-nomi-ink-05" onClick={() => onPickAsset(asset)}><span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-nomi-sm bg-nomi-ink-05"><AssetThumb asset={asset} playSize={14} /></span><span className="min-w-0"><span className="block truncate text-micro">{asset.name}</span><span className="block text-micro text-nomi-ink-40">{asset.kind}</span></span></button>)}</div>{groups.map((group) => <div key={group.label} className="border-t border-nomi-line-soft pt-1"><div className="px-1 text-micro font-medium text-nomi-ink-40">{group.label}</div>{group.items.map((item) => <button type="button" key={item.id} className="flex min-h-8 w-full items-center gap-2 rounded-nomi-sm px-1 text-left text-micro hover:bg-nomi-ink-05" onClick={() => onPickGroup?.(item)} disabled={!onPickGroup}><IconCircleDashed size={14} className="text-nomi-ink-40" aria-hidden="true" />{item.label}</button>)}</div>)}</>}
  </div>
}
