import React from 'react'
import { cn } from '../../../utils/cn'
import { frameToPixel } from '../timelineEdit'
import type { TimelinePlanPreviewBand } from './timelinePlanPreview'

/**
 * Read-only visual projection of a proposed plan. It never mutates the
 * timeline. Positioning follows the same convention as the playhead and the
 * snap guide in `TimelinePanel.tsx`: anchored past the track-label column, then
 * translated by the frame offset — the tracks scroll container starts at the
 * label column, so a bare `left: frameToPixel(...)` would sit one label width
 * to the left of the frame it claims to mark.
 */
export function TimelinePlanPreviewLayer({
  bands,
  scale,
  label,
}: {
  bands: readonly TimelinePlanPreviewBand[]
  scale: number
  label: string
}): JSX.Element | null {
  if (bands.length === 0) return null
  return <div className="pointer-events-none absolute inset-0 z-[7]" data-timeline-plan-preview="true" aria-label={label} role="note">
    {bands.map((band, index) => <div
      key={`${band.kind}:${band.clipId}:${band.startFrame}-${band.endFrame}:${index}`}
      className={cn(
        'absolute bottom-0 top-0 border border-dashed',
        'left-[var(--workbench-timeline-label-width)]',
        band.kind === 'removed' && 'border-nomi-danger bg-nomi-danger-soft',
        band.kind === 'added' && 'border-nomi-accent bg-nomi-accent-soft',
        band.kind === 'changed' && 'border-nomi-accent',
      )}
      style={{
        transform: `translateX(${frameToPixel(band.startFrame, scale)}px)`,
        width: `${Math.max(2, frameToPixel(band.endFrame, scale) - frameToPixel(band.startFrame, scale))}px`,
      }}
      data-plan-preview-band={band.kind}
      data-plan-preview-clip-id={band.clipId}
      data-plan-preview-start-frame={band.startFrame}
      data-plan-preview-end-frame={band.endFrame}
      aria-hidden="true"
    />)}
  </div>
}
