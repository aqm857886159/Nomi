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

  it('still lets system provenance edges into an input-less derived node through (explicit opt-out)', () => {
    store().restoreSnapshot({ nodes: [node('source', 'panorama'), node('shot', 'asset')], edges: [], groups: [] })
    store().connectNodes('source', 'shot', 'reference', undefined, undefined, { provenance: true })
    expect(store().edges).toMatchObject([{ source: 'source', target: 'shot' }])
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
