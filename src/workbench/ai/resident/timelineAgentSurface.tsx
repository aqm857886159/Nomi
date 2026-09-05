import React from 'react'
import { createPortal } from 'react-dom'
import { timelineRevision } from '../../timeline/kernel/timelineKernel'
import type { TimelineState } from '../../timeline/timelineTypes'
import { TimelinePlanPreviewLayer } from '../../timeline/agent/TimelinePlanPreviewLayer'
import { timelinePlanOperations, timelinePlanPreviewBands } from '../../timeline/agent/timelinePlanPreview'

/** Tool aliases whose arguments carry an edit plan worth previewing on the timeline. */
const TIMELINE_PLAN_TOOLS: readonly string[] = ['propose_edit_plan', 'apply_edit_plan', 'nomi_timeline_edit']

export type TimelineSelectionProjection = {
  clip: TimelineState['tracks'][number]['clips'][number] | TimelineState['textClips'][number]
  trackId: string
}

/**
 * The chip's revision must move when the *content* moves, not when the user
 * scrubs or zooms. Playhead and scale are view state, so they are pinned before
 * hashing; otherwise every playback frame would mark the selection stale.
 */
export function timelineSelectionRevision(timeline: TimelineState): string {
  return timelineRevision({ ...timeline, playheadFrame: 0, scale: 1 })
}

/**
 * Remembers the revision each selection was made at, so a chip can say "changed,
 * select again" instead of silently referring to a clip that no longer has the
 * shape the user pointed at. The map is only written in an effect, after the
 * render that observed the new revision, which is what makes the comparison
 * meaningful: the render that first sees a newer revision still reads the older
 * recorded one and therefore reports the selection as stale.
 */
export function useTimelineSelectionRevisions(selectionIds: readonly string[], revision: string): ReadonlyMap<string, string> {
  const revisions = React.useRef(new Map<string, string>())
  React.useEffect(() => {
    for (const id of selectionIds) if (!revisions.current.has(id)) revisions.current.set(id, revision)
    for (const id of [...revisions.current.keys()]) if (!selectionIds.includes(id)) revisions.current.delete(id)
  }, [revision, selectionIds])
  return revisions.current
}

export function collectTimelineSelections(
  timeline: TimelineState,
  selectedClipIds: readonly string[],
  selectedTextClipId: string,
): TimelineSelectionProjection[] {
  return [
    ...selectedClipIds.flatMap((clipId) => timeline.tracks.flatMap((track) => track.clips.filter((clip) => clip.id === clipId).map((clip) => ({ clip, trackId: track.id })))),
    ...(selectedTextClipId ? timeline.textClips.filter((clip) => clip.id === selectedTextClipId).map((clip) => ({ clip, trackId: 'textTrack' })) : []),
  ]
}

/** Both the Pi alias and the MCP tool nest the plan; `propose_edit_plan` is flat. */
export function timelinePlanOperationsForTool(toolName: string, args: unknown): ReturnType<typeof timelinePlanOperations> {
  if (!TIMELINE_PLAN_TOOLS.includes(toolName) || !args || typeof args !== 'object') return []
  const raw = args as { plan?: { operations?: unknown }; operations?: unknown }
  return timelinePlanOperations(raw.plan && typeof raw.plan === 'object' ? raw.plan.operations : raw.operations)
}

/**
 * Renders the pending plan as a read-only overlay inside the timeline's own
 * scroll container. The host is resolved while a plan is pending rather than
 * once on mount, because the preview surface and the timeline panel do not
 * mount in a fixed order.
 */
export function useTimelinePlanPreview(
  surface: string,
  pendingTools: readonly { call: { toolName: string; args: unknown } }[],
  timeline: TimelineState,
  label: string,
): JSX.Element | null {
  const pending = pendingTools.find(({ call }) => TIMELINE_PLAN_TOOLS.includes(call.toolName))
  const operations = React.useMemo(
    () => pending ? timelinePlanOperationsForTool(pending.call.toolName, pending.call.args) : [],
    [pending],
  )
  const bands = React.useMemo(
    () => operations.length ? timelinePlanPreviewBands(timeline, operations) : [],
    [operations, timeline],
  )
  const [host, setHost] = React.useState<HTMLElement | null>(null)
  const wanted = surface === 'preview' && bands.length > 0
  React.useEffect(() => {
    setHost(wanted ? document.querySelector<HTMLElement>('.workbench-timeline__tracks') : null)
  }, [wanted])
  return host && wanted
    ? createPortal(<TimelinePlanPreviewLayer bands={bands} scale={timeline.scale} label={label} />, host)
    : null
}
