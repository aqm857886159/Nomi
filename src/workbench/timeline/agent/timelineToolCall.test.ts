import { afterEach, describe, expect, it } from 'vitest'
import { createDefaultTimeline } from '../timelineMath'
import { timelineRevision } from '../kernel/timelineKernel'
import { useWorkbenchStore } from '../../workbenchStore'
import { applyTimelineToolCall } from './timelineToolCall'
import type { TimelineState } from '../timelineTypes'

function fixture(): TimelineState {
  const timeline = createDefaultTimeline()
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => track.type === 'video'
      ? {
          ...track,
          clips: [
            { id: 'clip-a', type: 'video', sourceNodeId: 'node-a', label: 'A', startFrame: 0, endFrame: 30, frameCount: 60, offsetStartFrame: 0, offsetEndFrame: 30, url: 'file:///a.mp4' },
            { id: 'clip-b', type: 'video', sourceNodeId: 'node-b', label: 'B', startFrame: 30, endFrame: 60, frameCount: 30, offsetStartFrame: 0, offsetEndFrame: 0 },
          ],
        }
      : track),
    textClips: [{ id: 'text-a', text: 'caption', style: 'caption', startFrame: 10, endFrame: 20 }],
  }
}

afterEach(() => {
  useWorkbenchStore.setState({ timeline: createDefaultTimeline(), timelineUndoStack: [], timelineRedoStack: [] })
})

describe('timeline Agent tool adapter', () => {
  it('reads a compact canonical timeline with source windows and revision', async () => {
    const timeline = fixture()
    useWorkbenchStore.setState({ timeline })
    const result = await applyTimelineToolCall('read_timeline', {}) as Record<string, unknown>
    expect(result.revision).toBe(timelineRevision(timeline))
    expect(result.durationFrames).toBe(60)
    expect((result.tracks as Array<Record<string, unknown>>).find((track) => track.type === 'video')).toMatchObject({
      clips: expect.arrayContaining([expect.objectContaining({ id: 'clip-a', sourceWindow: { startFrame: 0, endFrame: 30 } })]),
    })
  })

  it('inspects only clips intersecting the requested range', async () => {
    useWorkbenchStore.setState({ timeline: fixture() })
    const result = await applyTimelineToolCall('inspect_timeline_range', { startFrame: 32, endFrame: 40 }) as Record<string, unknown>
    const clips = (result.tracks as Array<Record<string, unknown>>).flatMap((track) => track.clips as Array<Record<string, unknown>>)
    expect(clips.map((clip) => clip.id)).toEqual(['clip-b'])
    expect((result.textClips as unknown[])).toHaveLength(0)
  })

  it('previews without mutation, applies atomically, and creates one undo entry', async () => {
    const timeline = fixture()
    useWorkbenchStore.setState({ timeline, timelineUndoStack: [], timelineRedoStack: [] })
    const baseRevision = timelineRevision(timeline)
    const plan = { planId: 'plan-1', baseRevision, summary: 'Move clip B', operations: [{ kind: 'move', clipId: 'clip-b', startFrame: 70 }] }
    const preview = await applyTimelineToolCall('propose_edit_plan', plan) as Record<string, unknown>
    expect(preview.ok).toBe(true)
    expect((preview.preview as Record<string, unknown>).tracks).toBeDefined()
    expect(timelineRevision(useWorkbenchStore.getState().timeline)).toBe(baseRevision)

    const applied = await applyTimelineToolCall('apply_edit_plan', plan) as Record<string, unknown>
    expect(applied.applied).toBe(true)
    expect(useWorkbenchStore.getState().timeline.tracks.flatMap((track) => track.clips).find((clip) => clip.id === 'clip-b')?.startFrame).toBe(70)
    expect(useWorkbenchStore.getState().timelineUndoStack).toHaveLength(1)
  })

  it('rejects stale plans and reports a no-op undo', async () => {
    const timeline = fixture()
    useWorkbenchStore.setState({ timeline })
    const stale = await applyTimelineToolCall('apply_edit_plan', {
      planId: 'stale', baseRevision: '00000000', summary: 'stale', operations: [{ kind: 'remove', clipId: 'clip-a' }],
    }) as Record<string, unknown>
    expect(stale.ok).toBe(false)
    expect((stale.diagnostics as Array<Record<string, unknown>>)[0]?.code).toBe('stale_revision')
    const undone = await applyTimelineToolCall('undo_timeline_edit', {}) as Record<string, unknown>
    expect(undone.undone).toBe(false)
  })
})
