import { describe, expect, it } from 'vitest'
import { collectUngeneratedReferenceAncestors } from './referenceAncestors'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'

function node(id: string, url?: string): GenerationCanvasNode {
  return {
    id, kind: 'image', title: id, position: { x: 0, y: 0 },
    ...(url ? { result: { id: id + '-r', type: 'image', url, createdAt: 0 } } : {}),
  } as GenerationCanvasNode
}
function edge(source: string, target: string): GenerationCanvasEdge {
  return { id: `${source}-${target}`, source, target } as GenerationCanvasEdge
}

describe('collectUngeneratedReferenceAncestors（单节点生成自动备齐参考）', () => {
  it('上游角色未出图 → 纳入选择集', () => {
    const nodes = [node('char'), node('shot')]
    const edges = [edge('char', 'shot')]
    expect(collectUngeneratedReferenceAncestors('shot', { nodes, edges })).toEqual(['char'])
  })

  it('上游角色已出图 → 视为已满足，不纳入（不重复生成）', () => {
    const nodes = [node('char', 'nomi-local://c.png'), node('shot')]
    const edges = [edge('char', 'shot')]
    expect(collectUngeneratedReferenceAncestors('shot', { nodes, edges })).toEqual([])
  })

  it('传递闭包：char→keyframe→shot，两层都没图 → 都纳入', () => {
    const nodes = [node('char'), node('keyframe'), node('shot')]
    const edges = [edge('char', 'keyframe'), edge('keyframe', 'shot')]
    const got = collectUngeneratedReferenceAncestors('shot', { nodes, edges }).sort()
    expect(got).toEqual(['char', 'keyframe'])
  })

  it('中间层已出图 → 截断（不再往它的上游递归）', () => {
    const nodes = [node('char'), node('keyframe', 'nomi-local://k.png'), node('shot')]
    const edges = [edge('char', 'keyframe'), edge('keyframe', 'shot')]
    expect(collectUngeneratedReferenceAncestors('shot', { nodes, edges })).toEqual([])
  })

  it('无参考边 → 空', () => {
    expect(collectUngeneratedReferenceAncestors('shot', { nodes: [node('shot')], edges: [] })).toEqual([])
  })

  it('环不死循环', () => {
    const nodes = [node('a'), node('b')]
    const edges = [edge('a', 'b'), edge('b', 'a')]
    expect(() => collectUngeneratedReferenceAncestors('a', { nodes, edges })).not.toThrow()
  })
})
