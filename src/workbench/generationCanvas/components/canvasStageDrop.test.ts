import { describe, expect, it } from 'vitest'
import { getGenerationNodeDefaultSize, getGenerationNodeFootprintSize } from '../model/generationNodeKinds'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import {
  importBrowserAssetsToGenerationCanvas,
  layoutBrowserAssetDropPositions,
  resolveAssetLibraryDropPosition,
} from './canvasStageDrop'

describe('layoutBrowserAssetDropPositions', () => {
  it('lays multiple browser assets into a non-overlapping grid', () => {
    const positions = layoutBrowserAssetDropPositions({ x: 120, y: 180 }, 5)
    const footprint = getGenerationNodeFootprintSize('asset')

    expect(positions).toHaveLength(5)
    expect(positions[0]).toEqual({ x: 120, y: 180 })
    expect(positions[1].x - positions[0].x).toBeGreaterThanOrEqual(footprint.width)
    expect(positions[3].y - positions[0].y).toBeGreaterThanOrEqual(footprint.height)

    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        const separatedX =
          positions[i].x + footprint.width <= positions[j].x ||
          positions[j].x + footprint.width <= positions[i].x
        const separatedY =
          positions[i].y + footprint.height <= positions[j].y ||
          positions[j].y + footprint.height <= positions[i].y
        expect(separatedX || separatedY).toBe(true)
      }
    }
  })

  it('keeps the grabbed point under the mouse cursor', () => {
    const size = getGenerationNodeDefaultSize('asset')
    const cursor = { x: 640, y: 480 }
    const anchor = { xRatio: 0.25, yRatio: 0.75 }
    const position = resolveAssetLibraryDropPosition(cursor, anchor)

    expect(position.x + size.width * anchor.xRatio).toBe(cursor.x)
    expect(position.y + size.height * anchor.yRatio).toBe(cursor.y)
  })
})

describe('importBrowserAssetsToGenerationCanvas', () => {
  it('creates media and prompt nodes from browser asset box payloads', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })

    const result = importBrowserAssetsToGenerationCanvas(
      [
        { id: 'img-1', type: 'image', title: 'image.png', previewUrl: 'nomi-local://project/assets/image.png' },
        { id: 'vid-1', type: 'video', title: 'video.mp4', previewUrl: 'nomi-local://project/assets/video.mp4' },
        { id: 'txt-1', type: 'prompt', title: 'prompt.md', prompt: '雨夜街道\n霓虹反光' },
      ],
      { basePosition: { x: 100, y: 140 }, categoryId: 'shots' },
    )

    expect(result.createdCount).toBe(3)
    const state = useGenerationCanvasStore.getState()
    expect(state.nodes).toHaveLength(3)
    expect(state.nodes.map((node) => node.kind)).toEqual(['asset', 'asset', 'text'])
    expect(state.nodes.map((node) => node.categoryId)).toEqual(['shots', 'shots', 'shots'])
    expect(state.nodes[0]?.result).toMatchObject({ type: 'image', url: 'nomi-local://project/assets/image.png' })
    expect(state.nodes[1]?.result).toMatchObject({ type: 'video', url: 'nomi-local://project/assets/video.mp4' })
    expect(state.nodes[2]?.prompt).toBe('雨夜街道\n霓虹反光')
    expect(state.nodes[2]?.contentJson?.content).toHaveLength(2)
    expect(state.selectedNodeIds).toEqual(result.nodeIds)
  })
})
