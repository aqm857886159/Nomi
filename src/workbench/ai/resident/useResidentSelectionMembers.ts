import React from 'react'
import { useWorkbenchStore } from '../../workbenchStore'
import {
  residentSelectionInput,
  resolveResidentSelectionMembers,
  type ResidentSelectionMember,
} from './residentContextSnapshot'
import type { ResidentSurface } from './residentShellDisplay'

const NO_CANVAS = Object.freeze({ persistRevision: '', nodes: Object.freeze([]), selectedNodeIds: Object.freeze([]) })

/**
 * Live view of what the composer chips point at. It subscribes to the timeline
 * slice only (today only the preview surface shows selection chips); subscribing
 * to the canvas nodes here would re-render the whole panel on every node drag.
 * Members and names come from the same resolver the send path uses.
 */
export function useResidentTimelineMembers(surface: ResidentSurface): readonly ResidentSelectionMember[] {
  const timeline = useWorkbenchStore((state) => state.timeline)
  const selectedTimelineClipIds = useWorkbenchStore((state) => state.selectedTimelineClipIds)
  const selectedTextClipId = useWorkbenchStore((state) => state.selectedTextClipId)
  return React.useMemo(
    () => resolveResidentSelectionMembers(residentSelectionInput(surface, {
      workbench: { timeline, selectedTimelineClipIds, selectedTextClipId },
      canvas: NO_CANVAS,
      readTimelineRevision: () => '',
    })).timelineMembers,
    [surface, timeline, selectedTimelineClipIds, selectedTextClipId],
  )
}
