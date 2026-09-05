import { describe, expect, it } from 'vitest'
import { createDefaultTimeline } from './timelineMath'
import { addTextClip, moveTextClip } from './timelineTextEdit'

describe('text clip placement strategy', () => {
  it('places a new caption in the nearest non-overlapping text slot', () => {
    const base = createDefaultTimeline()
    const first = addTextClip(base, 'caption', 0)
    const second = addTextClip(first.timeline, 'caption', 1)
    const clips = second.timeline.textClips
    expect(clips).toHaveLength(2)
    expect(clips[1].startFrame).toBe(clips[0].endFrame)
    expect(clips[1].startFrame).toBeGreaterThanOrEqual(clips[0].endFrame)
  })

  it('moves a text clip through the same non-overlap placement rule', () => {
    const base = createDefaultTimeline()
    const first = addTextClip(base, 'caption', 0)
    const second = addTextClip(first.timeline, 'caption', 90)
    const moved = moveTextClip(second.timeline, second.id, 1)
    const clip = moved.textClips.find((entry) => entry.id === second.id)!
    expect(clip.startFrame).toBeGreaterThanOrEqual(first.timeline.textClips[0].endFrame)
  })
})
