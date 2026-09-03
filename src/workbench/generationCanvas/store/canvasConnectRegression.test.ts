import { describe, expect, it } from 'vitest'
import { useGenerationCanvasStore } from './generationCanvasStore'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

function node(id: string): GenerationCanvasNode {
  return { id, kind: 'image', title: id, position: { x: 0, y: 0 }, categoryId: 'shots', meta: {} }
}

describe('connectNodes domain boundary', () => {
  it('adds a persisted edge for a plain image-to-image connection', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [node('source'), node('target')], edges: [], groups: [] })

    useGenerationCanvasStore.getState().connectNodes('source', 'target', 'reference')

    expect(useGenerationCanvasStore.getState().edges).toMatchObject([
      { source: 'source', target: 'target', mode: 'reference' },
    ])
  })
})
