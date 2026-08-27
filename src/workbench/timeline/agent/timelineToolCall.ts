import type { TimelineState, TimelineTextClip, TimelineTrack } from '../timelineTypes'
import {
  applyTimelineOperations,
  normalizeKernelTimeline,
  timelineRevision,
  validateTimeline,
  type TimelineOperation,
} from '../kernel/timelineKernel'
import { clearAdoptionUndoSnapshot, workbenchAdoptionPorts } from '../../adoption/adoptionStorePorts'
import { useWorkbenchStore } from '../../workbenchStore'
import { getDesktopActiveProjectId } from '../../../desktop/activeProject'

export type TimelineToolCallName =
  | 'read_timeline'
  | 'inspect_timeline_range'
  | 'propose_edit_plan'
  | 'apply_edit_plan'
  | 'undo_timeline_edit'

type JsonRecord = Record<string, unknown>

type AppliedPlanRecord = {
  projectId: string
  signature: string
  response: JsonRecord
  undoToken: string
  beforeRevision: string
  afterRevision: string
}

const appliedPlans = new Map<string, AppliedPlanRecord>()
let latestAgentUndo: AppliedPlanRecord | null = null
const MAX_APPLIED_PLANS = 128

function currentProjectId(): string {
  return getDesktopActiveProjectId().trim()
}

function planRegistryKey(projectId: string, planId: string): string {
  return `${projectId}\u0000${planId}`
}

/** Clear Agent-only retry and undo state when project ownership changes. */
export function resetTimelineAgentState(): void {
  appliedPlans.clear()
  latestAgentUndo = null
}

function asRecord(args: unknown): JsonRecord {
  return args && typeof args === 'object' && !Array.isArray(args) ? args as JsonRecord : {}
}

function frame(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`)
  }
  return value
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
    // Never send local media paths or project URLs to the model provider. The
    // stable sourceNodeId is enough for planning; the renderer resolves media.
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

function readTimeline(timeline: TimelineState): JsonRecord {
  const normalized = normalizeKernelTimeline(timeline)
  const validation = validateTimeline(normalized)
  const durationFrames = Math.max(0, ...normalized.tracks.flatMap((track) => track.clips.map((clip) => clip.endFrame)), ...normalized.textClips.map((clip) => clip.endFrame))
  return {
    revision: timelineRevision(normalized),
    fps: normalized.fps,
    scale: normalized.scale,
    playheadFrame: normalized.playheadFrame,
    durationFrames,
    valid: validation.ok,
    ...(validation.ok ? {} : { diagnostics: validation.diagnostics }),
    tracks: normalized.tracks.map((track) => ({ id: track.id, type: track.type, label: track.label, clips: track.clips.map((clip) => compactClip(clip, track.id)) })),
    textClips: normalized.textClips.map(compactTextClip),
    transitions: normalized.transitions ?? [],
  }
}

function intersects(startFrame: number, endFrame: number, rangeStart: number, rangeEnd: number): boolean {
  return startFrame < rangeEnd && rangeStart < endFrame
}

function inspectTimelineRange(timeline: TimelineState, args: unknown): JsonRecord {
  const input = asRecord(args)
  const startFrame = frame(input.startFrame, 'startFrame')
  const endFrame = frame(input.endFrame, 'endFrame')
  if (endFrame <= startFrame) throw new Error('endFrame must be greater than startFrame')
  const snapshot = readTimeline(timeline)
  return {
    revision: snapshot.revision,
    startFrame,
    endFrame,
    tracks: timeline.tracks.map((track) => ({
      id: track.id,
      type: track.type,
      clips: track.clips.filter((clip) => intersects(clip.startFrame, clip.endFrame, startFrame, endFrame)).map((clip) => compactClip(clip, track.id)),
    })),
    textClips: timeline.textClips.filter((clip) => intersects(clip.startFrame, clip.endFrame, startFrame, endFrame)).map(compactTextClip),
  }
}

function planInput(args: unknown): { planId: string; baseRevision: string; summary: string; operations: TimelineOperation[] } {
  const input = asRecord(args)
  const planId = typeof input.planId === 'string' ? input.planId.trim() : ''
  const baseRevision = typeof input.baseRevision === 'string' ? input.baseRevision.trim() : ''
  const summary = typeof input.summary === 'string' ? input.summary.trim() : ''
  if (!planId || !baseRevision || !summary || !Array.isArray(input.operations) || input.operations.length === 0) {
    throw new Error('EditPlan requires planId, baseRevision, summary and at least one operation')
  }
  const operations = input.operations
  if (operations.some((operation) => !operation || typeof operation !== 'object' || !['move', 'remove', 'split', 'trim', 'source-window', 'ripple'].includes(String((operation as JsonRecord).kind)))) {
    throw new Error('EditPlan contains an unsupported operation kind')
  }
  return { planId, baseRevision, summary, operations: operations as TimelineOperation[] }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as JsonRecord).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function planSignature(plan: { baseRevision: string; summary: string; operations: TimelineOperation[] }): string {
  return stableJson({ baseRevision: plan.baseRevision, summary: plan.summary, operations: plan.operations })
}

function applyPlan(args: unknown, validateOnly: boolean): JsonRecord {
  const plan = planInput(args)
  const base = workbenchAdoptionPorts.readTimeline()
  const projectId = currentProjectId()
  if (!validateOnly && !projectId) {
    return {
      planId: plan.planId,
      ok: false,
      applied: false,
      replayed: false,
      code: 'project_scope_required',
      message: 'An active project is required to apply a timeline plan',
      currentRevision: timelineRevision(base),
    }
  }
  const signature = planSignature(plan)
  if (!validateOnly) {
    const previous = appliedPlans.get(planRegistryKey(projectId, plan.planId))
    if (previous) {
      if (previous.signature !== signature) {
        return {
          planId: plan.planId,
          ok: false,
          applied: false,
          replayed: false,
          code: 'plan_id_conflict',
          message: 'planId was already used for a different edit plan',
          currentRevision: timelineRevision(base),
        }
      }
      return {
        ...previous.response,
        replayed: true,
        applied: false,
        currentRevision: timelineRevision(base),
        timeline: readTimeline(base),
      }
    }
  }
  const result = applyTimelineOperations(base, plan.operations, {
    expectedRevision: plan.baseRevision,
    validateOnly,
  })
  const response: JsonRecord = {
    planId: plan.planId,
    summary: plan.summary,
    ok: result.ok,
    validateOnly,
    baseRevision: plan.baseRevision,
    revision: result.revision,
    appliedOperationCount: result.appliedOperationCount,
    diagnostics: result.diagnostics,
    diff: result.diff,
  }
  if (!result.ok) return response
  if (validateOnly) {
    response.preview = readTimeline(result.previewTimeline)
    return response
  }
  try {
    workbenchAdoptionPorts.commitTimeline(result.timeline, base)
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
  const undoToken = `timeline-undo:${plan.planId}:${result.revision}`
  response.applied = true
  response.replayed = false
  response.undoToken = undoToken
  response.timeline = readTimeline(landed)
  const record: AppliedPlanRecord = {
    projectId,
    signature,
    response: { ...response },
    undoToken,
    beforeRevision: timelineRevision(base),
    afterRevision: result.revision,
  }
  appliedPlans.set(planRegistryKey(projectId, plan.planId), record)
  while (appliedPlans.size > MAX_APPLIED_PLANS) appliedPlans.delete(appliedPlans.keys().next().value as string)
  latestAgentUndo = record
  return response
}

function undoTimelineEdit(args: unknown): JsonRecord {
  const input = asRecord(args)
  const undoToken = typeof input.undoToken === 'string' ? input.undoToken.trim() : ''
  const expectedRevision = typeof input.expectedRevision === 'string' ? input.expectedRevision.trim() : ''
  const projectId = currentProjectId()
  const current = workbenchAdoptionPorts.readTimeline()
  const currentRevision = timelineRevision(current)
  const record = latestAgentUndo
  if (!projectId) {
    return { ok: false, undone: false, code: 'project_scope_required', currentRevision }
  }
  if (!undoToken || !expectedRevision) {
    return { ok: false, undone: false, code: 'undo_arguments_required', currentRevision }
  }
  if (!record || record.projectId !== projectId || record.undoToken !== undoToken) {
    return { ok: false, undone: false, code: 'undo_token_invalid', currentRevision }
  }
  if (expectedRevision !== currentRevision || currentRevision !== record.afterRevision) {
    return { ok: false, undone: false, code: 'undo_stale_revision', currentRevision, expectedRevision }
  }
  useWorkbenchStore.getState().undoTimeline()
  const after = workbenchAdoptionPorts.readTimeline()
  const afterRevision = timelineRevision(after)
  const undone = afterRevision === record.beforeRevision
  if (undone) latestAgentUndo = null
  return {
    ok: undone,
    undone,
    ...(undone ? {} : { code: 'undo_verification_failed' }),
    currentRevision: afterRevision,
    timeline: readTimeline(after),
  }
}

export async function applyTimelineToolCall(toolName: string, args: unknown): Promise<unknown> {
  const timeline = workbenchAdoptionPorts.readTimeline()
  switch (toolName as TimelineToolCallName) {
    case 'read_timeline': return readTimeline(timeline)
    case 'inspect_timeline_range': return inspectTimelineRange(timeline, args)
    case 'propose_edit_plan': return applyPlan(args, true)
    case 'apply_edit_plan': return applyPlan(args, false)
    case 'undo_timeline_edit': return undoTimelineEdit(args)
    default: return null
  }
}
