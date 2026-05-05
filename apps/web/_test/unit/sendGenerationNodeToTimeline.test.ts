import { describe, expect, it } from 'vitest'
import { createDefaultTimeline } from '../../src/workbench/timeline/timelineMath'
import type { TimelineClip, TimelineState, TimelineTrackType } from '../../src/workbench/timeline/timelineTypes'
import type { GenerationCanvasNode } from '../../src/workbench/generationCanvasV2/model/generationCanvasTypes'
import { sendGenerationNodeToTimeline } from '../../src/workbench/generationCanvasV2/agent/sendGenerationNodeToTimeline'

function imageNode(): GenerationCanvasNode {
  return {
    id: 'image-node',
    kind: 'image',
    title: '图片节点',
    position: { x: 0, y: 0 },
    prompt: 'prompt',
    result: {
      id: 'image-result',
      type: 'image',
      url: 'https://cdn.test/image.png',
      createdAt: 1,
    },
  }
}

describe('sendGenerationNodeToTimeline', () => {
  it('inserts generated image assets into the image track', () => {
    let timeline = createDefaultTimeline()
    const inserted: TimelineClip[] = []

    const result = sendGenerationNodeToTimeline({
      readGenerationNodes: () => [imageNode()],
      readTimeline: () => timeline,
      addTimelineClipAtFrame: (clip: TimelineClip, trackType: TimelineTrackType) => {
        inserted.push(clip)
        timeline = {
          ...timeline,
          tracks: timeline.tracks.map((track) => (
            track.type === trackType ? { ...track, clips: [...track.clips, clip] } : track
          )),
        }
      },
      readTimelineAfterInsert: () => timeline,
    }, 'image-node', { startFrame: 12 })

    expect(result.ok).toBe(true)
    expect(inserted[0]?.type).toBe('image')
    expect(inserted[0]?.startFrame).toBe(12)
  })

  it('fails explicitly when generated asset is unavailable', () => {
    const timeline: TimelineState = createDefaultTimeline()
    const result = sendGenerationNodeToTimeline({
      readGenerationNodes: () => [{ ...imageNode(), result: undefined }],
      readTimeline: () => timeline,
      addTimelineClipAtFrame: () => undefined,
      readTimelineAfterInsert: () => timeline,
    }, 'image-node')

    expect(result).toEqual({ ok: false, error: 'clip_unavailable', nodeId: 'image-node' })
  })
})
