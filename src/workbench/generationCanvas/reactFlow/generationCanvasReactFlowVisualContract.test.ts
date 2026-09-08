import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { resolveGenerationFlowConnectionAffordance } from './generationCanvasReactFlowVisualContract'

function node(kind: GenerationCanvasNode['kind']): GenerationCanvasNode {
  return {
    id: `${kind}-node`,
    kind,
    title: kind,
    position: { x: 0, y: 0 },
    size: { width: 240, height: 160 },
  }
}

describe('React Flow magnetic connection contract', () => {
  it.each(['image', 'asset', 'character', 'text', 'video'] as const)('reveals %s without selecting it first', (kind) => {
    expect(resolveGenerationFlowConnectionAffordance(node(kind))).toBe('magnetic')
  })

  it('keeps the source magnetic during a connection', () => {
    const image = node('image')
    expect(resolveGenerationFlowConnectionAffordance(image)).toBe('magnetic')
  })

  it('excludes panorama and collapsed group proxies', () => {
    expect(resolveGenerationFlowConnectionAffordance(node('panorama'))).toBe('hidden')
    expect(resolveGenerationFlowConnectionAffordance({ ...node('image'), meta: { collapsedGroupProxy: true } })).toBe('hidden')
  })
})
