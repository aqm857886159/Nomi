import { describe, expect, it } from 'vitest'
import { useGenerationCanvasStore } from './generationCanvasStore'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

function node(id: string, kind: GenerationCanvasNode['kind'] = 'image'): GenerationCanvasNode {
  return { id, kind, title: id, position: { x: 0, y: 0 }, categoryId: 'shots', meta: {} }
}

describe('connectNodes domain boundary', () => {
  it('adds a persisted edge for a plain image-to-image connection', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [node('source'), node('target')], edges: [], groups: [] })

    useGenerationCanvasStore.getState().connectNodes('source', 'target', 'reference')

    expect(useGenerationCanvasStore.getState().edges).toMatchObject([
      { source: 'source', target: 'target', mode: 'reference' },
    ])
  })

  it('adds a persisted edge for the S5 image-to-video connection', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [node('source'), node('target', 'video')], edges: [], groups: [] })

    useGenerationCanvasStore.getState().connectNodes('source', 'target', 'reference')

    expect(useGenerationCanvasStore.getState().edges).toMatchObject([
      { source: 'source', target: 'target', mode: 'reference' },
    ])
  })
})

// 2026-10-09 对抗评审 B2：连线总闸（connects.input）必须立在 store 的唯一写边边界上——
// 目标没有参数槽时也要先校验，否则换一个调用者就能写出界面已经藏起来的非法边。
describe('connectNodes: connects.input gate at the store write boundary', () => {
  const store = () => useGenerationCanvasStore.getState()

  it.each(['asset', 'text'] as const)('refuses a new edge into a %s target (no parameter slots)', (kind) => {
    store().restoreSnapshot({ nodes: [node('source'), node('target', kind)], edges: [], groups: [] })
    store().connectNodes('source', 'target', 'reference')
    expect(store().edges).toEqual([])
  })

  it('ordinary connectNodes has no provenance switch: passing one does not get an edge into an asset card', () => {
    store().restoreSnapshot({ nodes: [node('source', 'panorama'), node('shot', 'asset')], edges: [], groups: [] })
    ;(store().connectNodes as (...args: unknown[]) => void)('source', 'shot', 'reference', undefined, undefined, { provenance: true })
    expect(store().edges).toEqual([])
  })

  describe('connectDerivedOutput: the only door for system provenance edges (identity comes from data, not from a caller flag)', () => {
    const withDerived = (kind: string, from: string, targetKind: GenerationCanvasNode['kind'] = 'asset'): GenerationCanvasNode =>
      ({ ...node('shot', targetKind), meta: { derivedFrom: { nodeId: from, kind } } })

    it('connects when the target recorded that exactly this source derived it', () => {
      store().restoreSnapshot({ nodes: [node('source', 'panorama'), withDerived('panorama-screenshot', 'source')], edges: [], groups: [] })
      expect(store().connectDerivedOutput('source', 'shot')).toBe(true)
      expect(store().edges).toMatchObject([{ source: 'source', target: 'shot' }])
    })

    it.each([
      ['an ordinary card pretending (no derivedFrom)', () => [node('source', 'panorama'), node('shot', 'asset')]],
      ['derivedFrom names another node', () => [node('source', 'panorama'), withDerived('panorama-screenshot', 'other')]],
      ['source kind does not fit the declared derivation', () => [node('source', 'image'), withDerived('panorama-screenshot', 'source')]],
      ['target kind does not fit the declared derivation', () => [node('source', 'panorama'), withDerived('panorama-screenshot', 'source', 'text')]],
    ])('refuses %s', (_label, nodes) => {
      store().restoreSnapshot({ nodes: nodes(), edges: [], groups: [] })
      expect(store().connectDerivedOutput('source', 'shot')).toBe(false)
      expect(store().edges).toEqual([])
    })

    it('refuses a second origin: a derived node already fed by a different source', () => {
      store().restoreSnapshot({
        nodes: [node('source', 'panorama'), node('intruder'), withDerived('panorama-screenshot', 'source')],
        edges: [{ id: 'old', source: 'intruder', target: 'shot', mode: 'reference' }],
        groups: [],
      })
      expect(store().connectDerivedOutput('source', 'shot')).toBe(false)
    })
  })

  it('old projects: an existing edge into an asset card loads, shows and disconnects', () => {
    store().restoreSnapshot({
      nodes: [node('source'), node('target', 'asset')],
      edges: [{ id: 'old-edge', source: 'source', target: 'target', mode: 'reference' }],
      groups: [],
    })
    expect(store().edges.map((edge) => edge.id)).toEqual(['old-edge'])
    store().disconnectEdge('old-edge')
    expect(store().edges).toEqual([])
  })
})
