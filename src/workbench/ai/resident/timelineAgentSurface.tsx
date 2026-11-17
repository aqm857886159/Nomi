import React, { type JSX } from 'react'
import { createPortal } from 'react-dom'
import { modelToolShowsReviewCard, resolveModelToolCapabilityId } from '../../../../electron/shared/agentCapabilities/modelFacingToolRegistry'
import { TIMELINE_WRITE_CAPABILITY } from '../../../../electron/shared/agentCapabilities/timelineWrite'
import type { TimelineState } from '../../timeline/timelineTypes'
import { useWorkbenchStore } from '../../workbenchStore'
import { residentSelectionInput, resolveResidentSelectionMembers, type ResidentSelectionMember } from './residentContextSnapshot'
import type { ResidentSurface } from './residentShellDisplay'
import { TimelinePlanPreviewLayer } from '../../timeline/agent/TimelinePlanPreviewLayer'
import { timelinePlanOperations, timelinePlanPreviewBands } from '../../timeline/agent/timelinePlanPreview'
import { timelinePlanLines, type TimelinePlanLine } from '../../timeline/agent/timelinePlanSummary'

/**
 * True when a pending tool call carries a timeline edit plan worth previewing.
 *
 * Both facts come from the verb declaration — the user reviews it before it applies, and it lands
 * on `timeline.write` — so a rename moves this answer with it. `undo` is on the same contract but
 * carries no plan, and it is not a review-card verb.
 */
export function isTimelinePlanTool(toolName: string): boolean {
  return modelToolShowsReviewCard(toolName) && resolveModelToolCapabilityId(toolName) === TIMELINE_WRITE_CAPABILITY.id
}

/** The plan a pending call carries. `edit_timeline` takes its operations flat (`verbProjections.ts`). */
export function timelinePlanOperationsForTool(toolName: string, args: unknown): ReturnType<typeof timelinePlanOperations> {
  if (!isTimelinePlanTool(toolName) || !args || typeof args !== 'object') return []
  return timelinePlanOperations((args as { operations?: unknown }).operations)
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
  const pending = pendingTools.find(({ call }) => isTimelinePlanTool(call.toolName))
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
    // 必须限定在**剪辑面**那棵树里找宿主。WorkbenchShell 把去过的工作区都留在 DOM 里
    // （WorkspaceSlot 只是 `hidden`，为的是切回去时状态还在），所以生成画布那条时间轴
    // 同时也挂着 `.workbench-timeline__tracks`——而且它排在剪辑面前面。
    // 裸 `document.querySelector` 于是稳稳地拿到那条**隐藏的**（0×0）轨道区，
    // 计划预览的色带被 Portal 进一个看不见的宿主里：功能"跑通了"，用户什么都看不到。
    setHost(wanted ? document.querySelector<HTMLElement>('.workbench-preview .workbench-timeline__tracks') : null)
  }, [wanted])
  return host && wanted
    ? createPortal(<TimelinePlanPreviewLayer bands={bands} scale={timeline.scale} label={label} />, host)
    : null
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
