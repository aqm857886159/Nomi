import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getVisibleCanvasNodesForRender } from './useCanvasViewport'

function node(id: string, x: number, y: number): GenerationCanvasNode {
  return {
    id,
    kind: 'image',
    title: id,
    prompt: '',
    position: { x, y },
  } as GenerationCanvasNode
}

describe('getVisibleCanvasNodesForRender', () => {
  it('does not mount every node in a large canvas before the stage is measured', () => {
    const nodes = Array.from({ length: 80 }, (_, index) => node(`n${index}`, index * 360, 0))

    expect(
      getVisibleCanvasNodesForRender({
        nodes,
        zoom: 1,
        offset: { x: 0, y: 0 },
        stageSize: { width: 0, height: 0 },
      }),
    ).toEqual([])
  })

  it('keeps small canvases eager so startup stays simple for normal projects', () => {
    const nodes = Array.from({ length: 10 }, (_, index) => node(`n${index}`, index * 360, 0))

    expect(
      getVisibleCanvasNodesForRender({
        nodes,
        zoom: 1,
        offset: { x: 0, y: 0 },
        stageSize: { width: 0, height: 0 },
      }),
    ).toHaveLength(nodes.length)
  })

  it('keeps a visually intersecting media node mounted when its persisted height is stale', () => {
    const loadedImage = {
      ...node('loaded-image', 0, -800),
      size: { width: 360, height: 280 },
      meta: { previewHeight: 432 },
      result: { id: 'result-1', type: 'image', url: 'nomi-local://asset/image.jpg', createdAt: 1 },
    } as GenerationCanvasNode
    const offscreenNodes = Array.from({ length: 50 }, (_, index) => node(`far-${index}`, 10_000 + index * 400, 0))

    expect(
      getVisibleCanvasNodesForRender({
        nodes: [loadedImage, ...offscreenNodes],
        zoom: 1,
        offset: { x: 0, y: 0 },
        stageSize: { width: 100, height: 100 },
      }).map((candidate) => candidate.id),
    ).toContain('loaded-image')
  })
})
