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
})
