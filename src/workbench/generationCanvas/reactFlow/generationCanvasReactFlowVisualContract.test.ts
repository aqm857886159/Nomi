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

describe('React Flow canvas visual parity contract', () => {
  it('restores magnetic plus handles only for the selected image-like node', () => {
    expect(resolveGenerationFlowConnectionAffordance(node('image'), true, '')).toBe('magnetic')
    expect(resolveGenerationFlowConnectionAffordance(node('asset'), true, '')).toBe('magnetic')
    expect(resolveGenerationFlowConnectionAffordance(node('character'), true, '')).toBe('magnetic')
    expect(resolveGenerationFlowConnectionAffordance(node('image'), false, '')).toBe('dot')
    expect(resolveGenerationFlowConnectionAffordance(node('text'), true, '')).toBe('dot')
    expect(resolveGenerationFlowConnectionAffordance(node('panorama'), true, '')).toBe('dot')
  })

  it('keeps the source node on the compact dot while a connection is active', () => {
    const image = node('image')
    expect(resolveGenerationFlowConnectionAffordance(image, true, image.id)).toBe('dot')
    expect(resolveGenerationFlowConnectionAffordance(image, true, 'another-node')).toBe('magnetic')
  })
})
