import { describe, expect, it } from 'vitest'
import { buildClipFromGenerationNode } from './buildClipFromGenerationNode'
import { canDragGenerationNodeToTimeline, TIMELINE_DRAG_HANDLE_LABEL } from './timelineDragAffordance'
import type { GenerationCanvasNode } from './generationCanvasTypes'

function makeNode(overrides: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode {
  return {
    id: 'node-1',
    kind: 'image',
    title: 'Generated asset',
    prompt: 'A frame',
    position: { x: 0, y: 0 },
    size: { width: 320, height: 180 },
    status: 'success',
    result: {
      id: 'result-1',
      type: 'image',
      url: 'file:///asset.png',
      createdAt: 1,
    },
    history: [],
    ...overrides,
  }
}

describe('timeline drag affordance', () => {
  it('marks generated image and video assets with a result url as draggable to the timeline', () => {
    expect(canDragGenerationNodeToTimeline(makeNode({ kind: 'image' }))).toBe(true)
    expect(canDragGenerationNodeToTimeline(makeNode({ kind: 'video', result: { id: 'video-1', type: 'video', url: 'file:///asset.mp4', durationSeconds: 4, createdAt: 1 } }))).toBe(true)
    expect(canDragGenerationNodeToTimeline(makeNode({ kind: 'panorama' }))).toBe(false)
  })

  it('does not advertise dragging for failed, readonly, or empty nodes', () => {
    expect(canDragGenerationNodeToTimeline(makeNode({ status: 'error' }))).toBe(false)
    expect(canDragGenerationNodeToTimeline(makeNode({ result: undefined }))).toBe(false)
    expect(canDragGenerationNodeToTimeline(makeNode(), { readOnly: true })).toBe(false)
  })

  it('uses user-facing copy that tells users where to drag the asset', () => {
    expect(TIMELINE_DRAG_HANDLE_LABEL).toBe('拖拽到时间轴')
  })

  it('can turn generated image and video assets into timeline clips', () => {
    const imageClip = buildClipFromGenerationNode(makeNode(), { fps: 30, startFrame: 12 })
    expect(imageClip).toMatchObject({ type: 'image', startFrame: 12, endFrame: 102, url: 'file:///asset.png' })

    const videoClip = buildClipFromGenerationNode(makeNode({
      kind: 'video',
      result: { id: 'video-1', type: 'video', url: 'file:///asset.mp4', durationSeconds: 4, createdAt: 1 },
    }), { fps: 24, startFrame: 48 })
    expect(videoClip).toMatchObject({ type: 'video', startFrame: 48, endFrame: 144, url: 'file:///asset.mp4' })
  })
})
