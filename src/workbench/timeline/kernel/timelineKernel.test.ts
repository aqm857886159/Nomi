import { describe, expect, it } from 'vitest'
import type { TimelineClip, TimelineState } from '../timelineTypes'
import {
  applyTimelineOperation,
  applyTimelineOperations,
  diffTimelines,
  normalizeKernelTimeline,
  timelineRevision,
  validateTimeline,
} from './timelineKernel'

function clip(id: string, startFrame: number, endFrame: number, type: 'video' | 'audio' | 'image' = 'video', frameCount = endFrame - startFrame): TimelineClip {
  return {
    id,
    type,
    sourceNodeId: `source-${id}`,
    label: id,
    startFrame,
    endFrame,
    frameCount,
    offsetStartFrame: 0,
    offsetEndFrame: type === 'image' ? 0 : Math.max(0, frameCount - (endFrame - startFrame)),
  }
}

function timeline(clips: TimelineClip[] = [], audio: TimelineClip[] = []): TimelineState {
  return {
    version: 1,
    fps: 30,
    scale: 1,
    playheadFrame: 0,
    tracks: [
      { id: 'video', type: 'video', label: 'Video', clips },
      { id: 'audio', type: 'audio', label: 'Audio', clips: audio },
    ],
    textClips: [{ id: 'caption', text: 'hello', style: 'caption', startFrame: 0, endFrame: 20 }],
  }
}

describe('timeline kernel validation and normalization', () => {
  it('rejects duplicate ids, type mismatches, overlap, and empty source windows', () => {
    const state = timeline([clip('a', 0, 30), { ...clip('a', 20, 40), type: 'audio' }])
    const result = validateTimeline(state)
    expect(result.ok).toBe(false)
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'clip_id_duplicate',
      'clip_track_type_mismatch',
      'clips_overlap',
    ]))
  })

  it('sorts clips, text, and transitions deterministically without changing content', () => {
    const state = timeline([clip('b', 40, 60), clip('a', 0, 20)])
    const normalized = normalizeKernelTimeline(state)
    expect(normalized.tracks[0].clips.map((entry) => entry.id)).toEqual(['a', 'b'])
    expect(normalized.textClips.map((entry) => entry.id)).toEqual(['caption'])
    expect(timelineRevision(state)).toBe(timelineRevision(normalized))
  })

  it('rejects malformed clip audio and unsupported image audio settings', () => {
    const invalid = timeline([
      { ...clip('gain', 0, 30), audio: { gainDb: 1 } },
      { ...clip('fades', 40, 70), audio: { fadeInFrames: 20, fadeOutFrames: 20 } },
      { ...clip('image', 80, 110, 'image'), audio: { muted: true } },
    ], [
      { ...clip('audio', 0, 30, 'audio'), audio: { fadeInFrames: -1, muted: 'yes' as unknown as boolean } },
    ])

    expect(validateTimeline(invalid).diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'clip_audio_gain_invalid',
      'clip_audio_fade_overlap',
      'clip_audio_unsupported',
      'clip_audio_fade_invalid',
      'clip_audio_mute_invalid',
    ]))
  })
})

describe('timeline kernel operations', () => {
  it('moves within a track and across a compatible track', () => {
    const state = timeline([clip('a', 0, 30), clip('b', 40, 70)])
    const moved = applyTimelineOperation(state, { kind: 'move', clipId: 'a', startFrame: 80 })
    expect(moved.ok).toBe(true)
    expect(moved.timeline.tracks[0].clips.map((entry) => [entry.id, entry.startFrame])).toEqual([['b', 40], ['a', 80]])
    const audioState = timeline([clip('a', 0, 30)], [clip('music', 0, 100, 'audio', 100)])
    const cross = applyTimelineOperation(audioState, { kind: 'move', clipId: 'music', startFrame: 120 })
    expect(cross.ok).toBe(true)
    expect(cross.timeline.tracks[1].clips[0].startFrame).toBe(120)
  })

  it('rejects an overlapping move and leaves the source unchanged', () => {
    const state = timeline([clip('a', 0, 30), clip('b', 40, 70)])
    const result = applyTimelineOperation(state, { kind: 'move', clipId: 'a', startFrame: 50 })
    expect(result.ok).toBe(false)
    expect(result.timeline).toBe(state)
    expect(result.diagnostics[0].code).toBe('move_overlap')
  })

  it('splits media while preserving the source window', () => {
    const state = timeline([clip('a', 0, 100, 'video', 140)])
    const result = applyTimelineOperation(state, { kind: 'split', clipId: 'a', atFrame: 35 })
    expect(result.ok).toBe(true)
    const clips = result.timeline.tracks[0].clips
    expect(clips.map((entry) => [entry.id, entry.startFrame, entry.endFrame, entry.offsetStartFrame, entry.offsetEndFrame])).toEqual([
      ['a', 0, 35, 0, 105],
      ['a-split', 35, 100, 35, 40],
    ])
  })

  it('trims edges and supports explicit source-window updates', () => {
    const state = timeline([clip('a', 0, 100, 'video', 140)])
    const trimmed = applyTimelineOperation(state, { kind: 'trim', clipId: 'a', edge: 'left', deltaFrame: 20 })
    expect(trimmed.ok).toBe(true)
    expect(trimmed.timeline.tracks[0].clips[0]).toMatchObject({ startFrame: 20, endFrame: 100, offsetStartFrame: 20 })
    const windowed = applyTimelineOperation(state, { kind: 'source-window', clipId: 'a', sourceStartFrame: 40, sourceEndFrame: 80 })
    expect(windowed.ok).toBe(true)
    expect(windowed.timeline.tracks[0].clips[0]).toMatchObject({ startFrame: 0, endFrame: 40, offsetStartFrame: 40, offsetEndFrame: 60 })
  })

  it('removes clips and optionally ripples later clips on the same track', () => {
    const state = timeline([clip('a', 0, 30), clip('b', 40, 70), clip('c', 80, 100)])
    const result = applyTimelineOperation(state, { kind: 'remove', clipId: 'b', ripple: true })
    expect(result.ok).toBe(true)
    expect(result.timeline.tracks[0].clips.map((entry) => [entry.id, entry.startFrame, entry.endFrame])).toEqual([
      ['a', 0, 30],
      ['c', 50, 70],
    ])
  })

  it('rejects ripple removal that spans multiple tracks', () => {
    const state = timeline([clip('video-a', 0, 30)], [clip('audio-a', 0, 30, 'audio', 30)])
    const result = applyTimelineOperation(state, { kind: 'remove', clipIds: ['video-a', 'audio-a'], ripple: true })
    expect(result.ok).toBe(false)
    expect(result.timeline).toBe(state)
    expect(result.diagnostics[0].code).toBe('ripple_requires_single_track')
  })

  it('ripples a suffix across tracks and optionally text', () => {
    const state = timeline([clip('a', 0, 30), clip('b', 50, 70)], [clip('music', 60, 90, 'audio', 90)])
    const result = applyTimelineOperation(state, { kind: 'ripple', fromFrame: 40, deltaFrame: -10, includeText: true })
    expect(result.ok).toBe(true)
    expect(result.timeline.tracks[0].clips[1].startFrame).toBe(40)
    expect(result.timeline.tracks[1].clips[0].startFrame).toBe(50)
    expect(result.timeline.textClips[0].startFrame).toBe(0)
  })

  it('applies transition, text, and audio operations through the same transaction kernel', () => {
    const state = timeline([clip('a', 0, 30), clip('b', 30, 60)])
    const result = applyTimelineOperations(state, [
      { kind: 'transition', action: 'set', fromClipId: 'a', toClipId: 'b', type: 'dissolve', durationFrames: 6 },
      { kind: 'text', action: 'edit', clipId: 'caption', text: 'X' },
      { kind: 'audio', clipId: 'a', gainDb: -6, fadeOutFrames: 5 },
    ])
    expect(result.ok).toBe(true)
    expect(result.timeline.transitions).toEqual([{ fromClipId: 'a', toClipId: 'b', type: 'dissolve', durationFrames: 6 }])
    expect(result.timeline.textClips[0]?.text).toBe('X')
    expect(result.timeline.tracks[0]?.clips[0]?.audio).toMatchObject({ gainDb: -6, fadeOutFrames: 5 })
  })

  it('rejects invalid transition support and overlapping audio fades before commit', () => {
    const state = timeline([clip('a', 0, 30), clip('b', 30, 60)])
    const unsupported = applyTimelineOperation(state, { kind: 'transition', action: 'set', fromClipId: 'a', toClipId: 'b', type: 'match_cut', durationFrames: 6 })
    expect(unsupported.ok).toBe(false)
    expect(unsupported.diagnostics[0]?.code).toBe('transition_unsupported_type')
    const overlap = applyTimelineOperation(state, { kind: 'audio', clipId: 'a', fadeInFrames: 20, fadeOutFrames: 20 })
    expect(overlap.ok).toBe(false)
    expect(overlap.diagnostics[0]?.code).toBe('clip_audio_fade_overlap')
  })

  it('adds and retimes text clips with strict non-empty ranges', () => {
    const state = timeline([clip('a', 0, 30)])
    const added = applyTimelineOperation(state, { kind: 'text', action: 'add', id: 'caption-2', text: 'new', style: 'title', startFrame: 30, endFrame: 45 })
    expect(added.ok).toBe(true)
    const retimed = applyTimelineOperation(added.timeline, { kind: 'text', action: 'time', clipId: 'caption-2', startFrame: 32, endFrame: 44 })
    expect(retimed.ok).toBe(true)
    expect(retimed.timeline.textClips.find((clip) => clip.id === 'caption-2')).toMatchObject({ startFrame: 32, endFrame: 44 })
  })
})

describe('timeline kernel transactions and diffs', () => {
  it('applies a batch atomically and returns deterministic diff entries', () => {
    const state = timeline([clip('a', 0, 30), clip('b', 40, 70)])
    const result = applyTimelineOperations(state, [
      { kind: 'move', clipId: 'a', startFrame: 80 },
      { kind: 'remove', clipId: 'b' },
    ])
    expect(result.ok).toBe(true)
    expect(result.appliedOperationCount).toBe(2)
    expect(result.diff.changed).toBe(true)
    expect(result.diff.entries.map((entry) => entry.path)).toEqual([...result.diff.entries.map((entry) => entry.path)].sort())
  })

  it('rolls back all prior operations when a later operation fails', () => {
    const state = timeline([clip('a', 0, 30), clip('b', 40, 70)])
    const result = applyTimelineOperations(state, [
      { kind: 'move', clipId: 'a', startFrame: 80 },
      { kind: 'move', clipId: 'missing', startFrame: 10 },
    ])
    expect(result.ok).toBe(false)
    expect(result.timeline).toBe(state)
    expect(result.appliedOperationCount).toBe(1)
    expect(result.previewTimeline.tracks[0].clips.some((entry) => entry.startFrame === 80)).toBe(true)
  })

  it('supports stale revision guards and validate-only previews', () => {
    const state = timeline([clip('a', 0, 30)])
    const stale = applyTimelineOperations(state, [{ kind: 'remove', clipId: 'a' }], { expectedRevision: 'stale' })
    expect(stale.ok).toBe(false)
    expect(stale.diagnostics[0].code).toBe('stale_revision')
    const preview = applyTimelineOperations(state, [{ kind: 'remove', clipId: 'a' }], { validateOnly: true })
    expect(preview.ok).toBe(true)
    expect(preview.timeline).toBe(state)
    expect(preview.previewTimeline.tracks[0].clips).toHaveLength(0)
  })

  it('reports only changed paths in a deterministic diff', () => {
    const before = timeline([clip('a', 0, 30)])
    const after = timeline([clip('a', 10, 40)])
    const diff = diffTimelines(before, after)
    expect(diff.entries.map((entry) => entry.path)).toEqual([
      '$.tracks[0].clips[0].endFrame',
      '$.tracks[0].clips[0].startFrame',
    ])
  })
})
