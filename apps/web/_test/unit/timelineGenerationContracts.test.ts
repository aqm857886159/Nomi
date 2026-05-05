import { describe, expect, it } from 'vitest'
import type { TimelineClip, TimelineState, TimelineTrackType } from '../../src/workbench/timeline/timelineTypes'
import {
  computeTimelineDuration,
  createDefaultTimeline,
  hasClipOverlap,
  normalizeTimeline,
  resolveActiveClipsAtFrame,
} from '../../src/workbench/timeline/timelineMath'
import {
  addClipAtFrame,
  clientXToFrame,
  frameToPixel,
  pixelToFrame,
  resizeClipEdge,
  setTimelinePlayheadFrame,
  setTimelineScale,
  splitClipAtFrame,
} from '../../src/workbench/timeline/timelineEdit'
import {
  resolveTimelinePlaybackLayer,
  resolveVideoClipMediaTimeSeconds,
} from '../../src/workbench/player/timelinePlayback'
import { buildClipFromGenerationNode } from '../../src/workbench/generationCanvasV2/model/buildClipFromGenerationNode'
import { sendGenerationNodeToTimeline } from '../../src/workbench/generationCanvasV2/agent/sendGenerationNodeToTimeline'
import type { GenerationCanvasNode } from '../../src/workbench/generationCanvasV2/model/generationCanvasTypes'

function clip(id: string, type: TimelineTrackType, startFrame: number, frameCount: number): TimelineClip {
  return {
    id,
    type,
    sourceNodeId: `${id}-node`,
    label: id,
    startFrame,
    endFrame: startFrame + frameCount,
    frameCount,
    offsetStartFrame: 0,
    offsetEndFrame: 0,
    url: `https://cdn.test/${id}.${type === 'image' ? 'png' : 'mp4'}`,
  }
}

function node(input: Partial<GenerationCanvasNode>): GenerationCanvasNode {
  return {
    id: 'node-1',
    kind: 'image',
    title: 'Node',
    position: { x: 0, y: 0 },
    prompt: 'Prompt',
    references: [],
    history: [],
    status: 'success',
    meta: {},
    ...input,
  }
}

describe('timeline math, playback, and generation send-to-timeline contracts', () => {
  it('normalizes persisted timelines into known tracks and drops invalid or mismatched clips', () => {
    const timeline = normalizeTimeline({
      scale: 0,
      playheadFrame: '42',
      tracks: [
        {
          id: 'imageTrack',
          type: 'image',
          label: 'Images',
          clips: [
            { id: 'image-a', sourceNodeId: 'n1', type: 'image', startFrame: 30, endFrame: 60, frameCount: 30 },
            { id: '', sourceNodeId: 'bad', type: 'image', startFrame: 0, endFrame: 1, frameCount: 1 },
            { id: 'wrong-type', sourceNodeId: 'n2', type: 'video', startFrame: 0, endFrame: 5, frameCount: 5 },
          ],
        },
      ],
    })

    expect(timeline.scale).toBe(0.1)
    expect(timeline.playheadFrame).toBe(42)
    expect(timeline.tracks.find((track) => track.type === 'image')?.clips.map((item) => item.id)).toEqual(['image-a'])
    expect(timeline.tracks.find((track) => track.type === 'video')?.clips).toEqual([])
  })

  it('computes duration and active clips with inclusive start and exclusive end frames', () => {
    const timeline: TimelineState = {
      ...createDefaultTimeline(),
      playheadFrame: 10,
      tracks: [
        { id: 'imageTrack', type: 'image', label: 'Image', clips: [clip('image-a', 'image', 0, 10), clip('image-b', 'image', 10, 5)] },
        { id: 'videoTrack', type: 'video', label: 'Video', clips: [clip('video-a', 'video', 8, 20)] },
      ],
    }

    expect(computeTimelineDuration(timeline)).toBe(28)
    expect(resolveActiveClipsAtFrame(timeline, 9).map((item) => item.id)).toEqual(['image-a', 'video-a'])
    expect(resolveActiveClipsAtFrame(timeline, 10).map((item) => item.id)).toEqual(['image-b', 'video-a'])
    expect(resolveTimelinePlaybackLayer(timeline)).toEqual({
      image: expect.objectContaining({ id: 'image-b' }),
      video: expect.objectContaining({ id: 'video-a' }),
    })
  })

  it('maps frames and pixels through the clamped timeline scale contract', () => {
    expect(frameToPixel(12, 2)).toBe(24)
    expect(pixelToFrame(24.9, 2)).toBe(12)
    expect(clientXToFrame(140, 100, 2)).toBe(20)
    expect(setTimelineScale(createDefaultTimeline(), 99).scale).toBe(4)
    expect(setTimelinePlayheadFrame(createDefaultTimeline(), -5).playheadFrame).toBe(0)
  })

  it('prevents overlap on insert, resize, and track placement', () => {
    const existing = clip('existing', 'image', 0, 30)
    const timeline: TimelineState = {
      ...createDefaultTimeline(),
      tracks: [
        { id: 'imageTrack', type: 'image', label: 'Image', clips: [existing] },
        { id: 'videoTrack', type: 'video', label: 'Video', clips: [] },
      ],
    }

    expect(hasClipOverlap(timeline.tracks[0], clip('overlap', 'image', 20, 10))).toBe(true)
    expect(addClipAtFrame(timeline, clip('overlap', 'image', 20, 10), 'image', 20)).toBe(timeline)

    const inserted = addClipAtFrame(timeline, clip('after', 'image', 30, 10), 'image', 30)
    expect(inserted.tracks[0].clips.map((item) => item.id)).toEqual(['existing', 'after'])

    const resized = resizeClipEdge(inserted, 'existing', 'right', 99)
    expect(resized.tracks[0].clips.find((item) => item.id === 'existing')?.endFrame).toBe(30)
  })

  it('splits video clips by preserving media duration and moving playback offsets', () => {
    const source = {
      ...clip('video-a', 'video', 10, 90),
      offsetStartFrame: 15,
      offsetEndFrame: 0,
    }
    const timeline: TimelineState = {
      ...createDefaultTimeline(),
      tracks: [
        { id: 'imageTrack', type: 'image', label: 'Image', clips: [] },
        { id: 'videoTrack', type: 'video', label: 'Video', clips: [source] },
      ],
    }

    const split = splitClipAtFrame(timeline, 'video-a', 40)
    const clips = split.tracks[1].clips

    expect(clips).toHaveLength(2)
    expect(clips[0]).toEqual(expect.objectContaining({ id: 'video-a', startFrame: 10, endFrame: 40, offsetEndFrame: 60 }))
    expect(clips[1]).toEqual(expect.objectContaining({ id: 'video-a-split', startFrame: 40, offsetStartFrame: 45, frameCount: 90 }))
    expect(resolveVideoClipMediaTimeSeconds({ clip: clips[1], playheadFrame: 55, fps: 30 })).toBe(2)
  })

  it('builds timeline clips only from available generation assets', () => {
    const imageClip = buildClipFromGenerationNode(node({
      id: 'image-node',
      kind: 'image',
      result: { id: 'image-result', type: 'image', url: 'https://cdn.test/image.png', createdAt: 1 },
    }), { fps: 24, startFrame: 12 })
    const videoClip = buildClipFromGenerationNode(node({
      id: 'video-node',
      kind: 'video',
      result: { id: 'video-result', type: 'video', url: 'https://cdn.test/video.mp4', durationSeconds: 2.5, createdAt: 1 },
    }), { fps: 24, startFrame: 48 })

    expect(imageClip).toEqual(expect.objectContaining({
      id: 'clip-image-node-image-result-image-12',
      type: 'image',
      frameCount: 72,
      thumbnailUrl: 'https://cdn.test/image.png',
    }))
    expect(videoClip).toEqual(expect.objectContaining({
      id: 'clip-video-node-video-result-video-48',
      type: 'video',
      frameCount: 60,
      endFrame: 108,
    }))
    expect(buildClipFromGenerationNode(node({ id: 'running-node', status: 'running' }))).toBeNull()
    expect(buildClipFromGenerationNode(node({ id: 'missing-result', history: [] }), { resultId: 'absent' })).toBeNull()
  })

  it('sends a generation node to the timeline and reports explicit failure states', () => {
    let timeline = createDefaultTimeline()
    const generationNodes = [
      node({
        id: 'image-node',
        kind: 'image',
        result: { id: 'result-1', type: 'image', url: 'https://cdn.test/image.png', createdAt: 1 },
      }),
    ]

    const ports = {
      readGenerationNodes: () => generationNodes,
      readTimeline: () => timeline,
      addTimelineClipAtFrame: (nextClip: TimelineClip, trackType: TimelineTrackType, startFrame: number) => {
        timeline = addClipAtFrame(timeline, nextClip, trackType, startFrame)
      },
      readTimelineAfterInsert: () => timeline,
    }

    const inserted = sendGenerationNodeToTimeline(ports, ' image-node ', { startFrame: 15 })
    expect(inserted).toEqual(expect.objectContaining({
      ok: true,
      nodeId: 'image-node',
      trackType: 'image',
      startFrame: 15,
      clip: expect.objectContaining({ startFrame: 15, endFrame: 105 }),
    }))
    expect(timeline.tracks[0].clips).toHaveLength(1)

    expect(sendGenerationNodeToTimeline(ports, 'missing')).toEqual({ ok: false, error: 'node_not_found', nodeId: 'missing' })
    expect(sendGenerationNodeToTimeline(ports, 'image-node', { trackType: 'video' })).toEqual(expect.objectContaining({
      ok: false,
      error: 'track_type_mismatch',
    }))
  })
})
