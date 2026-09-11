import { describe, expect, it } from 'vitest'
import type { TimelineClip, TimelineState, TimelineTransition } from './timelineTypes'
import { createDefaultTimeline } from './timelineMath'
import { duplicateClipById, nudgeClipById, removeClipById, removeClipsByIds, removeClipsBySourceNodeIds } from './timelineEdit'

function clip(id: string, startFrame: number, endFrame: number): TimelineClip {
  return {
    id,
    type: 'video',
    sourceNodeId: id,
    label: id,
    startFrame,
    endFrame,
    frameCount: endFrame - startFrame,
    offsetStartFrame: 0,
    offsetEndFrame: 0,
  }
}

function timeline(clips: TimelineClip[]): TimelineState {
  const base = createDefaultTimeline()
  return { ...base, tracks: base.tracks.map((track) => track.type === 'video' ? { ...track, clips } : track) }
}

describe('remove clip drops transitions referencing the removed clip', () => {
  const transition = (fromClipId: string, toClipId: string): TimelineTransition => ({ fromClipId, toClipId, type: 'dissolve' })

  it('removeClipById clears transitions whose fromClipId/toClipId matches', () => {
    const base = timeline([clip('a', 0, 90), clip('b', 90, 180), clip('c', 180, 270)])
    base.transitions = [transition('a', 'b'), transition('b', 'c')]
    const after = removeClipById(base, 'b')
    expect(after.transitions).toEqual([])
  })

  it('removeClipById keeps untouched transitions and keeps the original reference when nothing matches', () => {
    const base = timeline([clip('a', 0, 90), clip('b', 90, 180), clip('c', 180, 270)])
    base.transitions = [transition('a', 'b')]
    const after = removeClipById(base, 'c')
    expect(after.transitions).toBe(base.transitions)
  })

  it('removeClipsByIds clears transitions for all removed ids', () => {
    const base = timeline([clip('a', 0, 90), clip('b', 90, 180), clip('c', 180, 270)])
    base.transitions = [transition('a', 'b'), transition('b', 'c')]
    const after = removeClipsByIds(base, ['a', 'b'])
    expect(after.transitions).toEqual([])
  })

  it('removeClipsBySourceNodeIds clears transitions of the clips it removed (canvas-node reconciliation path)', () => {
    const base = timeline([clip('a', 0, 90), clip('b', 90, 180), clip('c', 180, 270)])
    base.transitions = [transition('a', 'b'), transition('b', 'c')]
    const after = removeClipsBySourceNodeIds(base, ['a'])
    expect(after.transitions).toEqual([transition('b', 'c')])
  })
})

describe('timeline clip placement strategy', () => {
  it('nudges an adjacent clip using the same nearest legal placement as dragging', () => {
    const before = timeline([clip('a', 0, 90), clip('b', 90, 180), clip('c', 170, 260)])
    const after = nudgeClipById(before, 'b', -1)
    const moved = after.tracks.find((track) => track.type === 'video')!.clips.find((entry) => entry.id === 'b')!
    expect(moved.startFrame).toBe(260)
    expect(moved.endFrame).toBe(350)
  })

  it('duplicates into the nearest legal slot when the preferred append position is occupied', () => {
    const before = timeline([clip('a', 0, 90), clip('b', 90, 180), clip('c', 170, 260)])
    const after = duplicateClipById(before, 'b')
    const clips = after.tracks.find((track) => track.type === 'video')!.clips
    const copy = clips.find((entry) => entry.id === 'b-copy')!
    expect(copy.startFrame).toBe(260)
    expect(copy.endFrame).toBe(350)
  })
})
