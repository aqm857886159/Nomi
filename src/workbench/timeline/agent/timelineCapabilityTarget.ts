import {
  TIMELINE_DIFF_ENTRY_LIMIT,
  type TimelineEditPlanInput,
  type TimelineReadInput,
} from '../../../../electron/shared/agentCapabilities/timelineRead'
import type {
  TimelineWriteInput,
  TimelineWriteResult,
} from '../../../../electron/shared/agentCapabilities/timelineWrite'
import { SurfacePortWireError } from '../../../../electron/shared/surfacePortBinding'
import { getDesktopActiveProjectId } from '../../../desktop/activeProject'
import { clearAdoptionUndoSnapshot, workbenchAdoptionPorts } from '../../adoption/adoptionStorePorts'
import { useWorkbenchStore } from '../../workbenchStore'
import {
  applyTimelineOperations,
  normalizeKernelTimeline,
  timelineRevision,
  validateTimeline,
  type TimelineOperation,
} from '../kernel/timelineKernel'
import type { TimelineState, TimelineTextClip, TimelineTrack } from '../timelineTypes'
import { resolveClipAudio } from '../clipAudio'
import {
  createTimelineAgentUndoEntry,
  timelineAgentUndoMetadata,
  timelineUndoTimeline,
  type TimelineAgentUndoMetadata,
} from '../timelineUndoHistory'

type JsonRecord = Record<string, unknown>

export type TimelineCapabilityTarget = Readonly<{ kind: 'timeline'; clipIds: readonly string[] }>
export type TimelineCapabilityPreconditions = Readonly<{ timeline: Readonly<{ revision: string }> }>
export type TimelineWriteTargetExecution = Readonly<{
  input: TimelineWriteInput
  target: TimelineCapabilityTarget
  preconditions: TimelineCapabilityPreconditions
  receiptProposalId: string
  approvalId: string
  actionHash: string
  signal: AbortSignal
  assertCurrent(): void
}>

function assertExecutionCurrent(request: TimelineWriteTargetExecution): void {
  if (request.signal.aborted) throw new SurfacePortWireError('capability_cancelled')
  request.assertCurrent()
}

function compactClip(clip: TimelineTrack['clips'][number], trackId: string): JsonRecord {
  return {
    id: clip.id,
    type: clip.type,
    trackId,
    sourceNodeId: clip.sourceNodeId,
    label: clip.label,
    startFrame: clip.startFrame,
    endFrame: clip.endFrame,
    durationFrames: clip.endFrame - clip.startFrame,
    ...(clip.type === 'image'
      ? { sourceWindow: null }
      : { sourceWindow: { startFrame: clip.offsetStartFrame, endFrame: clip.frameCount - clip.offsetEndFrame } }),
    ...(clip.text ? { text: clip.text } : {}),
    ...(clip.audio ? { audio: resolveClipAudio(clip.audio, clip.endFrame - clip.startFrame) } : {}),
    sourceAvailable: Boolean(clip.url),
  }
}

function compactTextClip(clip: TimelineTextClip): JsonRecord {
  return {
    id: clip.id,
    sourceNodeId: clip.sourceNodeId,
    text: clip.text,
    style: clip.style,
    startFrame: clip.startFrame,
    endFrame: clip.endFrame,
  }
}

function projectTimeline(timeline: TimelineState): JsonRecord {
  const normalized = normalizeKernelTimeline(timeline)
  const validation = validateTimeline(normalized)
  const durationFrames = Math.max(
    0,
    ...normalized.tracks.flatMap((track) => track.clips.map((clip) => clip.endFrame)),
    ...normalized.textClips.map((clip) => clip.endFrame),
  )
  return {
    revision: timelineRevision(normalized),
    fps: normalized.fps,
    scale: normalized.scale,
    playheadFrame: normalized.playheadFrame,
    durationFrames,
    valid: validation.ok,
    ...(validation.ok ? {} : { diagnostics: validation.diagnostics }),
    tracks: normalized.tracks.map((track) => ({
      id: track.id,
      type: track.type,
      label: track.label,
      clips: track.clips.map((clip) => compactClip(clip, track.id)),
    })),
    textClips: normalized.textClips.map(compactTextClip),
    transitions: normalized.transitions ?? [],
  }
}

function intersects(startFrame: number, endFrame: number, rangeStart: number, rangeEnd: number): boolean {
  return startFrame < rangeEnd && rangeStart < endFrame
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as JsonRecord)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function planSignature(plan: TimelineEditPlanInput): string {
  return stableJson({ baseRevision: plan.baseRevision, summary: plan.summary, operations: plan.operations })
}

function projectTimelineDiff(diff: Readonly<{
  changed: boolean
  entries: readonly Readonly<{ path: string; before: unknown; after: unknown }>[]
}>) {
  const entries = diff.entries
    .filter((entry) => !/(?:^|\.)(?:url|thumbnailUrl)(?:$|\.)/.test(entry.path))
    .map((entry) => ({
      path: entry.path,
      change: entry.before === undefined
        ? 'added' as const
        : entry.after === undefined
          ? 'removed' as const
          : 'changed' as const,
    }))
  return {
    changed: diff.changed,
    totalEntryCount: entries.length,
    truncated: entries.length > TIMELINE_DIFF_ENTRY_LIMIT,
    entries: entries.slice(0, TIMELINE_DIFF_ENTRY_LIMIT),
  }
}

function previewPlan(plan: TimelineEditPlanInput, base: TimelineState) {
  const result = applyTimelineOperations(base, plan.operations as TimelineOperation[], {
    expectedRevision: plan.baseRevision,
    validateOnly: true,
  })
  return {
    operation: 'propose_edit_plan' as const,
    planId: plan.planId,
    summary: plan.summary,
    ok: result.ok,
    validateOnly: true,
    baseRevision: plan.baseRevision,
    revision: result.revision,
    appliedOperationCount: result.appliedOperationCount,
    diagnostics: result.diagnostics,
    diff: projectTimelineDiff(result.diff),
    ...(result.ok ? { preview: projectTimeline(result.previewTimeline) } : {}),
  }
}

export function executeTimelineReadTarget(input: TimelineReadInput): JsonRecord {
  const timeline = workbenchAdoptionPorts.readTimeline()
  if (input.operation === 'read_timeline') {
    return { operation: input.operation, ...projectTimeline(timeline) }
  }
  if (input.operation === 'inspect_timeline_range') {
    return {
      operation: input.operation,
      revision: timelineRevision(timeline),
      startFrame: input.startFrame,
      endFrame: input.endFrame,
      tracks: timeline.tracks.map((track) => ({
        id: track.id,
        type: track.type,
        clips: track.clips
          .filter((clip) => intersects(clip.startFrame, clip.endFrame, input.startFrame, input.endFrame))
          .map((clip) => compactClip(clip, track.id)),
      })),
      textClips: timeline.textClips
        .filter((clip) => intersects(clip.startFrame, clip.endFrame, input.startFrame, input.endFrame))
        .map(compactTextClip),
    }
  }
  return previewPlan(input, timeline)
}

function failure(
  operation: 'apply_edit_plan',
  code: string,
  revision: string,
  extra?: JsonRecord,
): Extract<TimelineWriteResult, { operation: 'apply_edit_plan' }>
function failure(
  operation: 'undo_timeline_edit',
  code: string,
  revision: string,
  extra: JsonRecord & { undone: boolean },
): Extract<TimelineWriteResult, { operation: 'undo_timeline_edit' }>
function failure(
  operation: TimelineWriteInput['operation'],
  code: string,
  revision: string,
  extra: JsonRecord = {},
): TimelineWriteResult {
  return { operation, ok: false, revision, code, ...extra } as TimelineWriteResult
}

function applyPlan(request: TimelineWriteTargetExecution & { input: Extract<TimelineWriteInput, { operation: 'apply_edit_plan' }> }): TimelineWriteResult {
  const { input } = request
  const base = workbenchAdoptionPorts.readTimeline()
  const currentRevision = timelineRevision(base)
  const projectId = getDesktopActiveProjectId().trim()
  if (!projectId) return failure(input.operation, 'project_scope_required', currentRevision)
  if (request.preconditions.timeline.revision !== input.baseRevision) {
    return failure(input.operation, 'capability_target_stale', currentRevision)
  }

  const signature = planSignature(input)
  const stack = useWorkbenchStore.getState().timelineUndoStack
  const existing = [...stack]
    .reverse()
    .map(timelineAgentUndoMetadata)
    .find((metadata) => metadata?.projectId === projectId && metadata.planId === input.planId)
  if (existing && existing.planSignature !== signature) {
    return failure(input.operation, 'plan_id_conflict', currentRevision, { planId: input.planId })
  }

  const topMetadata = timelineAgentUndoMetadata(stack.at(-1))
  if (
    existing &&
    topMetadata === existing &&
    existing.afterRevision === currentRevision &&
    existing.planSignature === signature
  ) {
    const replayPreview = previewPlan(input, timelineUndoTimeline(stack.at(-1)!))
    return {
      operation: input.operation,
      planId: input.planId,
      summary: input.summary,
      ok: true,
      applied: false,
      replayed: true,
      validateOnly: replayPreview.validateOnly,
      baseRevision: input.baseRevision,
      revision: currentRevision,
      appliedOperationCount: replayPreview.appliedOperationCount,
      diagnostics: replayPreview.diagnostics,
      diff: replayPreview.diff,
      undoToken: existing.undoToken,
    }
  }

  const result = applyTimelineOperations(base, input.operations as TimelineOperation[], {
    expectedRevision: input.baseRevision,
  })
  if (!result.ok) {
    return failure(input.operation, result.diagnostics[0]?.code ?? 'timeline_plan_invalid', result.revision, {
      planId: input.planId,
      diagnostics: result.diagnostics,
      diff: projectTimelineDiff(result.diff),
    })
  }

  const undoToken = `timeline-undo:v1:${request.receiptProposalId}`
  const metadata: TimelineAgentUndoMetadata = {
    projectId,
    planId: input.planId,
    planSignature: signature,
    beforeRevision: currentRevision,
    afterRevision: result.revision,
    undoToken,
    receiptProposalId: request.receiptProposalId,
    approvalId: request.approvalId,
    actionHash: request.actionHash,
  }
  try {
    assertExecutionCurrent(request)
    workbenchAdoptionPorts.commitTimeline(result.timeline, base, createTimelineAgentUndoEntry(base, metadata))
  } catch (error) {
    try { workbenchAdoptionPorts.restoreTimeline(base) } catch { /* preserve the original error */ }
    throw error
  }
  const landed = workbenchAdoptionPorts.readTimeline()
  if (timelineRevision(landed) !== result.revision) {
    const restored = workbenchAdoptionPorts.restoreTimeline(base)
    throw new Error(restored ? 'Timeline edit verification failed; changes were recovered' : 'Timeline edit verification failed; recovery is required')
  }
  clearAdoptionUndoSnapshot()
  return {
    operation: input.operation,
    planId: input.planId,
    summary: input.summary,
    ok: true,
    applied: true,
    replayed: false,
    baseRevision: input.baseRevision,
    revision: result.revision,
    appliedOperationCount: result.appliedOperationCount,
    diagnostics: result.diagnostics,
    diff: projectTimelineDiff(result.diff),
    undoToken,
  }
}

function undoPlan(request: TimelineWriteTargetExecution & { input: Extract<TimelineWriteInput, { operation: 'undo_timeline_edit' }> }): TimelineWriteResult {
  const { input } = request
  const state = useWorkbenchStore.getState()
  const currentRevision = timelineRevision(state.timeline)
  const projectId = getDesktopActiveProjectId().trim()
  if (!projectId) return failure(input.operation, 'project_scope_required', currentRevision, { undone: false })
  const metadata = timelineAgentUndoMetadata(state.timelineUndoStack.at(-1))
  if (!metadata || metadata.projectId !== projectId || metadata.undoToken !== input.undoToken) {
    return failure(input.operation, 'undo_token_invalid', currentRevision, { undone: false })
  }
  if (
    input.expectedRevision !== currentRevision ||
    request.preconditions.timeline.revision !== currentRevision ||
    metadata.afterRevision !== currentRevision
  ) {
    return failure(input.operation, 'undo_stale_revision', currentRevision, { undone: false })
  }
  assertExecutionCurrent(request)
  state.undoTimeline()
  const afterRevision = timelineRevision(useWorkbenchStore.getState().timeline)
  const undone = afterRevision === metadata.beforeRevision
  return {
    operation: input.operation,
    ok: undone,
    undone,
    revision: afterRevision,
    ...(undone ? {} : { code: 'undo_verification_failed' }),
  }
}

export function executeTimelineWriteTarget(request: TimelineWriteTargetExecution): TimelineWriteResult {
  assertExecutionCurrent(request)
  if (request.input.operation === 'apply_edit_plan') {
    return applyPlan(request as TimelineWriteTargetExecution & {
      input: Extract<TimelineWriteInput, { operation: 'apply_edit_plan' }>
    })
  }
  return undoPlan(request as TimelineWriteTargetExecution & {
    input: Extract<TimelineWriteInput, { operation: 'undo_timeline_edit' }>
  })
}
