import React from 'react'
import { createPortal } from 'react-dom'
import { timelineRevision } from '../../timeline/kernel/timelineKernel'
import type { TimelineState } from '../../timeline/timelineTypes'
import { TimelinePlanPreviewLayer } from '../../timeline/agent/TimelinePlanPreviewLayer'
import { timelinePlanOperations, timelinePlanPreviewBands } from '../../timeline/agent/timelinePlanPreview'
import { timelinePlanLines, type TimelinePlanLine } from '../../timeline/agent/timelinePlanSummary'

/** Tool aliases whose arguments carry an edit plan worth previewing on the timeline. */
const TIMELINE_PLAN_TOOLS: readonly string[] = ['propose_edit_plan', 'apply_edit_plan', 'nomi_timeline_edit']

/** True when a pending tool call is a timeline edit plan, in either projection. */
export function isTimelinePlanTool(toolName: string): boolean {
  return TIMELINE_PLAN_TOOLS.includes(toolName)
}

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
 * chip 指的那一段「还是不是我当初点的那一段」。
 *
 * 只认**存在与位置**：片段没了，或者它被移动 / 修剪到别处了。这正好是提示语要求的那件事
 * ——「已变更，请重新选择」。以前比的是**整条时间轴**的 revision：在别处加个转场、调一下
 * 配乐音量，甚至用户自己在属性面板把这一段的音量拧了 1dB，都会把 chip 标红逼人重选一个
 * 明明还在原地的东西。那是噪音，不是保护：Agent 动手前会自己 read_timeline 拿最新 revision，
 * chip 这条红线只服务于「你指的东西跑了」。
 */
export function timelineClipRevision(timeline: TimelineState, clipId: string): string {
  const clip = [
    ...timeline.tracks.flatMap((track) => track.clips),
    ...timeline.textClips,
  ].find((candidate) => candidate.id === clipId)
  return clip ? `${clip.startFrame}-${clip.endFrame}` : 'gone'
}

/**
 * Remembers the revision each selection was made at, so a chip can say "changed,
 * select again" instead of silently referring to a clip that no longer has the
 * shape the user pointed at. The map is only written in an effect, after the
 * render that observed the new revision, which is what makes the comparison
 * meaningful: the render that first sees a newer revision still reads the older
 * recorded one and therefore reports the selection as stale.
 */
export function useTimelineSelectionRevisions(
  selectionIds: readonly string[],
  revisionOf: (id: string) => string,
): ReadonlyMap<string, string> {
  const revisions = React.useRef(new Map<string, string>())
  const signature = selectionIds.map((id) => `${id}:${revisionOf(id)}`).join('|')
  React.useEffect(() => {
    for (const id of selectionIds) if (!revisions.current.has(id)) revisions.current.set(id, revisionOf(id))
    for (const id of [...revisions.current.keys()]) if (!selectionIds.includes(id)) revisions.current.delete(id)
    // revisionOf 每次渲染都是新函数；依赖钉在 signature 上，值没变就不重跑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])
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


/**
 * Everything the composer needs to show what the user pointed at: the chips
 * themselves plus the revision each one was made at. Kept together because a
 * chip without its recorded revision cannot say "changed, select again", which
 * is the only reason the chip carries a revision at all.
 */
export function useTimelineSelectionChips(
  surface: string,
  timeline: TimelineState,
  selectedClipIds: readonly string[],
  selectedTextClipId: string,
): Readonly<{ selections: TimelineSelectionProjection[]; revisionFor: (id: string) => string; staleFor: (id: string) => boolean }> {
  const ids = React.useMemo(() => [...selectedClipIds, ...(selectedTextClipId ? [selectedTextClipId] : [])], [selectedClipIds, selectedTextClipId])
  const revisionOf = React.useCallback((id: string) => timelineClipRevision(timeline, id), [timeline])
  const recorded = useTimelineSelectionRevisions(ids, revisionOf)
  const selections = React.useMemo(
    () => surface === 'preview' ? collectTimelineSelections(timeline, selectedClipIds, selectedTextClipId) : [],
    [selectedClipIds, selectedTextClipId, surface, timeline],
  )
  return {
    selections,
    revisionFor: (id) => recorded.get(id) ?? revisionOf(id),
    staleFor: (id) => (recorded.get(id) ?? revisionOf(id)) !== revisionOf(id),
  }
}

/**
 * A timeline plan is the one proposal whose raw arguments are unreadable: the
 * operation list carries frames and clip ids, not what the edit does. One
 * checkable sentence per operation, with the exact JSON kept for the detail row
 * (design contract §2.6/§2.8).
 */
export function useTimelinePlanRows(
  toolName: string | undefined,
  args: unknown,
  timeline: TimelineState,
  t: (key: string, values?: Record<string, unknown>) => string,
): TimelinePlanLine[] {
  return React.useMemo(
    () => toolName && isTimelinePlanTool(toolName) ? timelinePlanLines(timelinePlanOperationsForTool(toolName, args), timeline, t) : [],
    [args, t, timeline, toolName],
  )
}
