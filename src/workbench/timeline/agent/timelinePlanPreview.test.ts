import { describe, expect, it } from 'vitest'
import { timelinePlanOperations, timelinePlanPreviewBands } from './timelinePlanPreview'
import { timelinePlanLines } from './timelinePlanSummary'
import type { TimelineState } from '../timelineTypes'

const clip = (id: string, label: string, startFrame: number, endFrame: number): TimelineState['tracks'][number]['clips'][number] => ({
  id,
  type: 'video',
  sourceNodeId: `node-${id}`,
  label,
  startFrame,
  endFrame,
  frameCount: endFrame - startFrame,
  offsetStartFrame: 0,
  offsetEndFrame: 0,
})

const timeline = (): TimelineState => ({
  version: 1,
  fps: 30,
  scale: 1,
  playheadFrame: 0,
  tracks: [
    { id: 'imageTrack', type: 'image', label: '图片轨', clips: [] },
    { id: 'videoTrack', type: 'video', label: '视频轨', clips: [clip('clip-a', '开场', 0, 60), clip('clip-b', '推门', 60, 120)] },
    { id: 'audioTrack', type: 'audio', label: '音频轨', clips: [] },
  ],
  textClips: [{ id: 'caption-2', text: '旧字幕', style: 'caption', startFrame: 60, endFrame: 90 }],
  transitions: [],
})

describe('timeline plan preview', () => {
  it('rejects operation shapes the kernel cannot execute instead of drawing something', () => {
    expect(timelinePlanOperations(undefined)).toEqual([])
    expect(timelinePlanOperations([{ kind: 'teleport' }])).toEqual([])
    expect(timelinePlanOperations([{ kind: 'remove', clipId: 'clip-a' }])).toHaveLength(1)
  })

  it('marks only the frames a trim actually removes, not the whole clip', () => {
    const bands = timelinePlanPreviewBands(timeline(), timelinePlanOperations([{ kind: 'trim', clipId: 'clip-b', edge: 'right', deltaFrame: -15 }]))
    expect(bands).toEqual([{ kind: 'removed', clipId: 'clip-b', startFrame: 105, endFrame: 120 }])
  })

  it('places a new transition on the incoming clip head for its own duration', () => {
    const bands = timelinePlanPreviewBands(timeline(), timelinePlanOperations([
      { kind: 'transition', action: 'set', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'dissolve', durationFrames: 12 },
    ]))
    expect(bands).toEqual([{ kind: 'added', clipId: 'clip-b', startFrame: 60, endFrame: 72 }])
  })

  it('reports settings-only edits as a change over the clip rather than as geometry', () => {
    const bands = timelinePlanPreviewBands(timeline(), timelinePlanOperations([
      { kind: 'audio', clipId: 'clip-b', gainDb: -6, fadeOutFrames: 15 },
      { kind: 'text', action: 'edit', clipId: 'caption-2', text: 'X' },
    ]))
    expect(bands).toEqual([
      { kind: 'changed', clipId: 'clip-b', startFrame: 60, endFrame: 120 },
      { kind: 'changed', clipId: 'caption-2', startFrame: 60, endFrame: 90 },
    ])
  })

  it('previews nothing when the plan would be rejected by the kernel', () => {
    expect(timelinePlanPreviewBands(timeline(), timelinePlanOperations([
      { kind: 'transition', action: 'set', fromClipId: 'clip-a', toClipId: 'missing', type: 'dissolve', durationFrames: 6 },
    ]))).toEqual([])
  })
})

describe('timeline plan summary', () => {
  // The card must never show raw operation JSON, so the assertion here is that
  // every line resolves a key and carries the user-facing unit, not frames.
  const t = (key: string, values?: Record<string, unknown>): string => `${key}(${JSON.stringify(values ?? {})})`

  it('names the clip the user sees and states durations in seconds', () => {
    const lines = timelinePlanLines(timelinePlanOperations([
      { kind: 'trim', clipId: 'clip-b', edge: 'right', deltaFrame: -15 },
      { kind: 'transition', action: 'set', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'dissolve', durationFrames: 12 },
      { kind: 'text', action: 'edit', clipId: 'caption-2', text: 'X' },
      { kind: 'audio', clipId: 'clip-b', gainDb: -6, fadeOutFrames: 15 },
    ]), timeline(), t)
    expect(lines[0]?.text).toContain('trimShortenEnd')
    expect(lines[0]?.text).toContain('"clip":"推门"')
    expect(lines[0]?.text).toContain('"seconds":"0.50"')
    expect(lines[1]?.text).toContain('transitionSet')
    expect(lines[2]?.text).toContain('"text":"X"')
    expect(lines[3]?.text).toContain('audioGain')
    expect(lines[3]?.text).toContain('audioFadeOut')
    expect(lines.every((line) => line.technical.startsWith('{'))).toBe(true)
  })
})
