import React from 'react'
import { TimelineSelectionChip } from './TimelineSelectionChip'
import type { TimelineSelectionProjection } from './timelineAgentSurface'

export function TimelineSelectionChips({
  selections,
  revisionFor,
  revision,
  label,
  staleLabel,
  removeLabel,
}: {
  selections: readonly TimelineSelectionProjection[]
  revisionFor: (id: string) => string
  revision: string
  label: string
  staleLabel: string
  removeLabel: string
}): JSX.Element {
  return <>{selections.map(({ clip, trackId }) => {
    const selectionRevision = revisionFor(clip.id)
    return <TimelineSelectionChip key={`timeline-selection:${clip.id}`} clipId={clip.id} trackId={trackId} startFrame={clip.startFrame} endFrame={clip.endFrame} revision={selectionRevision} stale={selectionRevision !== revision} staleLabel={staleLabel} label={label} removeLabel={removeLabel} />
  })}</>
}
