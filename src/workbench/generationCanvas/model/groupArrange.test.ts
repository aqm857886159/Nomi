import { describe, expect, it } from 'vitest'
import { arrangeGroupNodes } from './groupArrange'
import type { GenerationCanvasNode } from './generationCanvasTypes'

function node(id: string, x: number, y: number, shotIndex: number): GenerationCanvasNode {
  return { id, kind: 'image', title: id, position: { x, y }, size: { width: 100, height: 80 }, prompt: '', shotIndex } as GenerationCanvasNode
}

describe('arrangeGroupNodes', () => {
  const nodes = [node('b', 400, 200, 2), node('a', 120, 360, 1), node('c', 30, 30, 3)]

  it('keeps shot order and lays a group out as a compact grid', () => {
    const arranged = arrangeGroupNodes(nodes, 'grid')
    expect([...arranged.keys()]).toEqual(['a', 'b', 'c'])
    expect(arranged.get('a')?.x).toBe(arranged.get('c')?.x)
    expect(arranged.get('b')?.x).toBeGreaterThan(arranged.get('a')?.x ?? 0)
    expect(arranged.get('c')?.y).toBeGreaterThan(arranged.get('a')?.y ?? 0)
  })

  it('supports explicit horizontal and vertical arrangements', () => {
    const horizontal = [...arrangeGroupNodes(nodes, 'horizontal').values()]
    expect(horizontal[0].y).toBe(horizontal[1].y)
    expect(horizontal[1].x).toBeGreaterThan(horizontal[0].x)
    expect(horizontal[2].x).toBeGreaterThan(horizontal[1].x)
    const vertical = [...arrangeGroupNodes(nodes, 'vertical').values()]
    expect(vertical[0].x).toBe(vertical[1].x)
    expect(vertical[1].y).toBeGreaterThan(vertical[0].y)
    expect(vertical[2].y).toBeGreaterThan(vertical[1].y)
  })
})
