import { beforeEach, describe, expect, it } from 'vitest'

import { TIMELINE_DIFF_ENTRY_LIMIT } from '../../../../electron/shared/agentCapabilities/timelineRead'
import { timelineWriteResultSchema } from '../../../../electron/shared/agentCapabilities/timelineWrite'
import type { TimelineState } from '../timelineTypes'
import { createDefaultTimeline } from '../timelineMath'
import { timelineRevision } from '../kernel/timelineKernel'
import { useWorkbenchStore } from '../../workbenchStore'
import { setDesktopActiveProjectId } from '../../../desktop/activeProject'
import {
  executeTimelineReadTarget,
  executeTimelineWriteTarget,
} from './timelineCapabilityTarget'
import { timelineAgentUndoMetadata } from '../timelineUndoHistory'
import type { TimelineWriteResult } from '../../../../electron/shared/agentCapabilities/timelineWrite'

// The write result is a discriminated union keyed on `operation`; undoToken is
// declared optional on the apply_edit_plan member (the schema shares one member
// for success and failure), but production always emits it for a landed apply.
// Narrow to that member and prove the token is present so tests can feed it back
// into undo requests after asserting a successful apply.
type ApplyEditPlanWrite = Extract<TimelineWriteResult, { operation: 'apply_edit_plan' }>
function applyEditWrite(result: TimelineWriteResult): ApplyEditPlanWrite & { undoToken: string } {
  if (result.operation !== 'apply_edit_plan') {
    throw new Error(`Expected an apply_edit_plan write, received: ${JSON.stringify(result)}`)
  }
  if (typeof result.undoToken !== 'string') {
    throw new Error(`Expected a landed apply to carry an undoToken, received: ${JSON.stringify(result)}`)
  }
  return result as ApplyEditPlanWrite & { undoToken: string }
}

function fixture(): TimelineState {
  const base = createDefaultTimeline()
  return {
    ...base,
    tracks: base.tracks.map((track) =>
      track.type === 'video'
        ? {
            ...track,
            clips: [
              {
                id: 'clip-a', type: 'video', sourceNodeId: 'node-a', label: 'A', startFrame: 0,
                endFrame: 24, frameCount: 24, offsetStartFrame: 0, offsetEndFrame: 0,
                url: 'nomi://project/project-a/assets/private.mp4',
              },
              {
                id: 'clip-b', type: 'video', sourceNodeId: 'node-b', label: 'B', startFrame: 30,
                endFrame: 54, frameCount: 24, offsetStartFrame: 0, offsetEndFrame: 0,
                url: '/Users/private/project-b.mp4',
              },
            ],
          }
        : track,
    ),
  }
}

const approval = {
  receiptProposalId: 'receipt-plan-a',
  approvalId: 'approval-plan-a',
  actionHash: 'a'.repeat(64),
  signal: new AbortController().signal,
  assertCurrent: () => undefined,
}

const executionGuard = {
  signal: new AbortController().signal,
  assertCurrent: () => undefined,
}

describe('canonical Timeline capability target', () => {
  beforeEach(() => {
    setDesktopActiveProjectId('project-a')
    useWorkbenchStore.setState({
      timeline: fixture(),
      timelineUndoStack: [],
      timelineRedoStack: [],
      persistRevision: 0,
    })
  })

  it('projects reads without paths or state mutation', () => {
    const before = useWorkbenchStore.getState()
    const result = executeTimelineReadTarget({ operation: 'read_timeline' })
    const range = executeTimelineReadTarget({ operation: 'inspect_timeline_range', startFrame: 0, endFrame: 36 })
    expect(JSON.stringify(result)).not.toContain('/Users/private')
    expect(JSON.stringify(result)).not.toContain('nomi://')
    expect(JSON.stringify(range)).not.toContain('/Users/private')
    expect(JSON.stringify(range)).not.toContain('nomi://')
    expect(result).toMatchObject({ operation: 'read_timeline', revision: timelineRevision(before.timeline) })
    const after = useWorkbenchStore.getState()
    expect(after.timeline).toBe(before.timeline)
    expect(after.timelineUndoStack).toBe(before.timelineUndoStack)
    expect(after.timelineRedoStack).toBe(before.timelineRedoStack)
    expect(after.persistRevision).toBe(before.persistRevision)
  })

  it('previews without mutation, applies once, and derives replay from the domain Undo entry', () => {
    const baseRevision = timelineRevision(useWorkbenchStore.getState().timeline)
    const plan = {
      operation: 'apply_edit_plan' as const,
      planId: 'plan-a',
      baseRevision,
      summary: 'Move clip B',
      operations: [{ kind: 'move' as const, clipId: 'clip-b', startFrame: 72 }],
    }
    const beforePreview = useWorkbenchStore.getState()
    const preview = executeTimelineReadTarget({ ...plan, operation: 'propose_edit_plan' })
    expect(preview).toMatchObject({ operation: 'propose_edit_plan', ok: true })
    expect(useWorkbenchStore.getState().timeline).toBe(beforePreview.timeline)
    expect(useWorkbenchStore.getState().timelineUndoStack).toBe(beforePreview.timelineUndoStack)
    expect(useWorkbenchStore.getState().timelineRedoStack).toBe(beforePreview.timelineRedoStack)
    expect(useWorkbenchStore.getState().persistRevision).toBe(beforePreview.persistRevision)

    const first = applyEditWrite(executeTimelineWriteTarget({ input: plan, target: { kind: 'timeline', clipIds: ['clip-b'] }, preconditions: { timeline: { revision: baseRevision } }, ...approval }))
    expect(first).toMatchObject({ operation: 'apply_edit_plan', ok: true, applied: true, replayed: false })
    expect(useWorkbenchStore.getState().timelineUndoStack).toHaveLength(1)
    expect(timelineAgentUndoMetadata(useWorkbenchStore.getState().timelineUndoStack.at(-1))).toMatchObject({
      projectId: 'project-a',
      planId: 'plan-a',
      beforeRevision: baseRevision,
      afterRevision: first.revision,
      undoToken: first.undoToken,
    })

    const replay = executeTimelineWriteTarget({ input: plan, target: { kind: 'timeline', clipIds: ['clip-b'] }, preconditions: { timeline: { revision: baseRevision } }, ...approval })
    expect(replay).toMatchObject({ operation: 'apply_edit_plan', ok: true, applied: false, replayed: true })
    expect(replay).not.toHaveProperty('preview')
    expect(timelineWriteResultSchema.safeParse(replay).success).toBe(true)
    expect(useWorkbenchStore.getState().timelineUndoStack).toHaveLength(1)
  })

  it('never projects media locations through remove previews or write receipts', () => {
    const baseRevision = timelineRevision(useWorkbenchStore.getState().timeline)
    const plan = {
      operation: 'apply_edit_plan' as const,
      planId: 'plan-remove',
      baseRevision,
      summary: 'Remove clip A',
      operations: [{ kind: 'remove' as const, clipId: 'clip-a' }],
    }
    const preview = executeTimelineReadTarget({ ...plan, operation: 'propose_edit_plan' })
    expect(preview).toMatchObject({ ok: true, diff: { changed: true } })
    expect(JSON.stringify(preview)).not.toContain('/Users/private')
    expect(JSON.stringify(preview)).not.toContain('nomi://')
    expect(JSON.stringify(preview)).not.toContain('before')
    expect(JSON.stringify(preview)).not.toContain('after')

    const applied = applyEditWrite(executeTimelineWriteTarget({
      input: plan,
      target: { kind: 'timeline', clipIds: ['clip-a'] },
      preconditions: { timeline: { revision: baseRevision } },
      ...approval,
    }))
    expect(applied).toMatchObject({ ok: true, applied: true, diff: { changed: true } })
    expect(JSON.stringify(applied)).not.toContain('/Users/private')
    expect(JSON.stringify(applied)).not.toContain('nomi://')
    expect(applied).not.toHaveProperty('timeline')
  })

  it('rejects stale apply preconditions without mutating Timeline or Undo state', () => {
    const before = useWorkbenchStore.getState()
    const baseRevision = timelineRevision(before.timeline)
    const result = executeTimelineWriteTarget({
      input: {
        operation: 'apply_edit_plan',
        planId: 'plan-stale',
        baseRevision,
        summary: 'Move clip B',
        operations: [{ kind: 'move', clipId: 'clip-b', startFrame: 72 }],
      },
      target: { kind: 'timeline', clipIds: ['clip-b'] },
      preconditions: { timeline: { revision: 'stale-revision' } },
      ...approval,
    })
    expect(result).toMatchObject({ ok: false, code: 'capability_target_stale', revision: baseRevision })
    expect(useWorkbenchStore.getState().timeline).toBe(before.timeline)
    expect(useWorkbenchStore.getState().timelineUndoStack).toBe(before.timelineUndoStack)
    expect(useWorkbenchStore.getState().timelineRedoStack).toBe(before.timelineRedoStack)
    expect(useWorkbenchStore.getState().persistRevision).toBe(before.persistRevision)
  })

  it('bounds a large committed diff before main receipt validation', () => {
    const clipCount = Math.floor(TIMELINE_DIFF_ENTRY_LIMIT / 2) + 8
    const base = fixture()
    const largeTimeline: TimelineState = {
      ...base,
      tracks: base.tracks.map((track) => track.type === 'video'
        ? {
            ...track,
            clips: Array.from({ length: clipCount }, (_, index) => ({
              id: `clip-${index}`,
              type: 'video' as const,
              sourceNodeId: `node-${index}`,
              label: `Clip ${index}`,
              startFrame: index * 2,
              endFrame: index * 2 + 1,
              frameCount: 1,
              offsetStartFrame: 0,
              offsetEndFrame: 0,
              url: `/private/clip-${index}.mp4`,
            })),
          }
        : track),
    }
    useWorkbenchStore.setState({ timeline: largeTimeline, timelineUndoStack: [], timelineRedoStack: [] })
    const baseRevision = timelineRevision(largeTimeline)
    const applied = applyEditWrite(executeTimelineWriteTarget({
      input: {
        operation: 'apply_edit_plan',
        planId: 'plan-large-ripple',
        baseRevision,
        summary: 'Shift the large video track',
        operations: [{ kind: 'ripple', fromFrame: 0, deltaFrame: 1 }],
      },
      target: { kind: 'timeline', clipIds: [] },
      preconditions: { timeline: { revision: baseRevision } },
      ...approval,
    }))
    expect(applied).toMatchObject({
      operation: 'apply_edit_plan',
      ok: true,
      applied: true,
      diff: {
        changed: true,
        totalEntryCount: clipCount * 2,
        truncated: true,
      },
    })
    if (applied.operation !== 'apply_edit_plan' || !applied.diff) throw new Error('missing apply diff')
    expect(applied.diff.entries).toHaveLength(TIMELINE_DIFF_ENTRY_LIMIT)
    expect(timelineWriteResultSchema.safeParse(applied).success).toBe(true)
    expect(JSON.stringify(applied)).not.toContain('/private/')
    expect(useWorkbenchStore.getState().timelineUndoStack).toHaveLength(1)
    expect(applied.undoToken).toBe('timeline-undo:v1:receipt-plan-a')
  })

  it('rejects a conflicting plan id and never pops a non-Agent edit', () => {
    const baseRevision = timelineRevision(useWorkbenchStore.getState().timeline)
    const plan = {
      operation: 'apply_edit_plan' as const,
      planId: 'plan-a',
      baseRevision,
      summary: 'Move clip B',
      operations: [{ kind: 'move' as const, clipId: 'clip-b', startFrame: 72 }],
    }
    const applied = applyEditWrite(executeTimelineWriteTarget({ input: plan, target: { kind: 'timeline', clipIds: ['clip-b'] }, preconditions: { timeline: { revision: baseRevision } }, ...approval }))
    const conflict = executeTimelineWriteTarget({
      input: { ...plan, summary: 'Different content' },
      target: { kind: 'timeline', clipIds: ['clip-b'] },
      preconditions: { timeline: { revision: baseRevision } },
      ...approval,
    })
    expect(conflict).toMatchObject({ ok: false, code: 'plan_id_conflict' })

    useWorkbenchStore.getState().moveTimelineTextClip('missing', 12)
    useWorkbenchStore.setState((state) => ({ timelineUndoStack: [...state.timelineUndoStack, state.timeline] }))
    const stack = useWorkbenchStore.getState().timelineUndoStack
    const undo = executeTimelineWriteTarget({
      input: { operation: 'undo_timeline_edit', undoToken: applied.undoToken, expectedRevision: applied.revision },
      target: { kind: 'timeline', clipIds: [] },
      preconditions: { timeline: { revision: applied.revision } },
      receiptProposalId: 'receipt-undo-a',
      approvalId: 'approval-undo-a',
      actionHash: 'b'.repeat(64),
      ...executionGuard,
    })
    expect(undo).toMatchObject({ ok: false, undone: false, code: 'undo_token_invalid' })
    expect(useWorkbenchStore.getState().timelineUndoStack).toEqual(stack)
  })

  it('undoes only the exact Agent entry and rejects the consumed token', () => {
    const baseRevision = timelineRevision(useWorkbenchStore.getState().timeline)
    const plan = {
      operation: 'apply_edit_plan' as const,
      planId: 'plan-a',
      baseRevision,
      summary: 'Move clip B',
      operations: [{ kind: 'move' as const, clipId: 'clip-b', startFrame: 72 }],
    }
    const applied = applyEditWrite(executeTimelineWriteTarget({ input: plan, target: { kind: 'timeline', clipIds: ['clip-b'] }, preconditions: { timeline: { revision: baseRevision } }, ...approval }))
    const request = {
      input: { operation: 'undo_timeline_edit' as const, undoToken: applied.undoToken, expectedRevision: applied.revision },
      target: { kind: 'timeline' as const, clipIds: [] },
      preconditions: { timeline: { revision: applied.revision } },
      receiptProposalId: 'receipt-undo-a', approvalId: 'approval-undo-a', actionHash: 'b'.repeat(64),
      ...executionGuard,
    }
    expect(executeTimelineWriteTarget(request)).toMatchObject({ operation: 'undo_timeline_edit', ok: true, undone: true, revision: baseRevision })
    const afterFirstUndo = useWorkbenchStore.getState()
    expect(executeTimelineWriteTarget(request)).toMatchObject({ ok: false, undone: false })
    expect(useWorkbenchStore.getState().timeline).toBe(afterFirstUndo.timeline)
    expect(useWorkbenchStore.getState().timelineUndoStack).toBe(afterFirstUndo.timelineUndoStack)
    expect(useWorkbenchStore.getState().timelineRedoStack).toBe(afterFirstUndo.timelineRedoStack)
  })

  it('rejects Agent undo after a project switch or beneath a legacy Undo entry', () => {
    const baseRevision = timelineRevision(useWorkbenchStore.getState().timeline)
    const plan = {
      operation: 'apply_edit_plan' as const,
      planId: 'plan-a',
      baseRevision,
      summary: 'Move clip B',
      operations: [{ kind: 'move' as const, clipId: 'clip-b', startFrame: 72 }],
    }
    const applied = applyEditWrite(executeTimelineWriteTarget({
      input: plan,
      target: { kind: 'timeline', clipIds: ['clip-b'] },
      preconditions: { timeline: { revision: baseRevision } },
      ...approval,
    }))
    const request = {
      input: {
        operation: 'undo_timeline_edit' as const,
        undoToken: applied.undoToken,
        expectedRevision: applied.revision,
      },
      target: { kind: 'timeline' as const, clipIds: [] },
      preconditions: { timeline: { revision: applied.revision } },
      receiptProposalId: 'receipt-undo-a',
      approvalId: 'approval-undo-a',
      actionHash: 'b'.repeat(64),
      ...executionGuard,
    }

    const appliedStack = useWorkbenchStore.getState().timelineUndoStack
    const appliedTimeline = useWorkbenchStore.getState().timeline
    const appliedRedo = useWorkbenchStore.getState().timelineRedoStack
    setDesktopActiveProjectId('project-b')
    expect(executeTimelineWriteTarget(request)).toMatchObject({ ok: false, undone: false, code: 'undo_token_invalid' })
    expect(useWorkbenchStore.getState().timeline).toBe(appliedTimeline)
    expect(useWorkbenchStore.getState().timelineUndoStack).toBe(appliedStack)
    expect(useWorkbenchStore.getState().timelineRedoStack).toBe(appliedRedo)

    setDesktopActiveProjectId('project-a')
    const legacyEntry = fixture()
    useWorkbenchStore.setState({ timelineUndoStack: [...appliedStack, legacyEntry] })
    const legacyStack = useWorkbenchStore.getState().timelineUndoStack
    expect(executeTimelineWriteTarget(request)).toMatchObject({ ok: false, undone: false, code: 'undo_token_invalid' })
    expect(useWorkbenchStore.getState().timeline).toBe(appliedTimeline)
    expect(useWorkbenchStore.getState().timelineUndoStack).toBe(legacyStack)
    expect(useWorkbenchStore.getState().timelineRedoStack).toBe(appliedRedo)
  })

  it('rejects stale Agent undo after a user edit without changing either Undo stack', () => {
    const baseRevision = timelineRevision(useWorkbenchStore.getState().timeline)
    const plan = {
      operation: 'apply_edit_plan' as const,
      planId: 'plan-a',
      baseRevision,
      summary: 'Move clip B',
      operations: [{ kind: 'move' as const, clipId: 'clip-b', startFrame: 72 }],
    }
    const applied = applyEditWrite(executeTimelineWriteTarget({
      input: plan,
      target: { kind: 'timeline', clipIds: ['clip-b'] },
      preconditions: { timeline: { revision: baseRevision } },
      ...approval,
    }))
    useWorkbenchStore.getState().moveTimelineClip('clip-b', 84)
    const afterUserEdit = useWorkbenchStore.getState()
    expect(timelineRevision(afterUserEdit.timeline)).not.toBe(applied.revision)

    const result = executeTimelineWriteTarget({
      input: {
        operation: 'undo_timeline_edit',
        undoToken: applied.undoToken,
        expectedRevision: applied.revision,
      },
      target: { kind: 'timeline', clipIds: [] },
      preconditions: { timeline: { revision: applied.revision } },
      receiptProposalId: 'receipt-undo-a',
      approvalId: 'approval-undo-a',
      actionHash: 'b'.repeat(64),
      ...executionGuard,
    })
    expect(result).toMatchObject({ ok: false, undone: false, code: 'undo_stale_revision' })
    expect(useWorkbenchStore.getState().timeline).toBe(afterUserEdit.timeline)
    expect(useWorkbenchStore.getState().timelineUndoStack).toBe(afterUserEdit.timelineUndoStack)
    expect(useWorkbenchStore.getState().timelineRedoStack).toBe(afterUserEdit.timelineRedoStack)
  })
})
