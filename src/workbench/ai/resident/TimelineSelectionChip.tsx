import React from 'react'
import { IconTimelineEvent, IconX } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'

export function TimelineSelectionChip({
  clipId,
  trackId,
  startFrame,
  endFrame,
  revision,
  stale,
  staleLabel,
  label,
  removeLabel,
  onRemove,
}: {
  clipId: string
  trackId: string
  startFrame: number
  endFrame: number
  revision: string
  stale?: boolean
  staleLabel: string
  label: string
  removeLabel: string
  onRemove?: () => void
}): JSX.Element {
  const accessible = [label, clipId, trackId, `${startFrame}-${endFrame}`, revision].join(' ')
  return <span className={cn('inline-flex h-6 min-w-0 max-w-full items-center gap-1 rounded-pill bg-nomi-ink-05 px-2 text-micro text-nomi-ink-80', stale && 'bg-workbench-danger-soft text-workbench-danger')} data-agent-timeline-selection="true" data-clip-id={clipId} data-track-id={trackId} data-revision={revision} data-stale={stale ? 'true' : undefined} title={stale ? `${accessible} · ${staleLabel}` : accessible} aria-label={stale ? `${accessible} · ${staleLabel}` : accessible}>
    <IconTimelineEvent size={12} aria-hidden="true" />
    <span className="truncate">{label} {clipId}</span>
    <span className="shrink-0 text-nomi-ink-40">{trackId} {startFrame}-{endFrame} {revision.slice(0, 8)}</span>
    {stale ? <span className="shrink-0 font-medium">{staleLabel}</span> : null}
    {onRemove ? <button type="button" aria-label={removeLabel} title={removeLabel} onClick={onRemove} className="grid size-4 shrink-0 place-items-center rounded-pill hover:bg-nomi-ink-10"><IconX size={11} aria-hidden="true" /></button> : null}
  </span>
}
