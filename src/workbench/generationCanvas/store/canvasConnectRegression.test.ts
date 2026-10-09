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

  it('refuses a new edge into an asset target (no parameter slots)', () => {
    store().restoreSnapshot({ nodes: [node('source'), node('target', 'asset')], edges: [], groups: [] })
    store().connectNodes('source', 'target', 'reference')
    expect(store().edges).toEqual([])
  })

  it('a text target takes an image (10-09: the text card has a left ring)', () => {
    store().restoreSnapshot({ nodes: [node('source'), node('target', 'text')], edges: [], groups: [] })
    store().connectNodes('source', 'target', 'reference')
    expect(store().edges).toHaveLength(1)
  })

  describe('addDerivedOutput: build the derived node and its provenance edge as ONE atomic action (no identity field, no door for existing nodes)', () => {
    const video = (id: string): GenerationCanvasNode => ({ ...node(id, 'video'), result: { id: 'r', type: 'video', url: 'u', createdAt: 1 } })
    const CASES: Array<[string, GenerationCanvasNode, GenerationCanvasNode['kind']]> = [
      ['panorama-screenshot', node('source', 'panorama'), 'asset'],
      ['director-output', node('source', 'director'), 'image'],
      ['whiteboard-snapshot', node('source', 'whiteboard'), 'image'],
      ['clip-export', node('source', 'clip'), 'video'],
      ['shot-table', video('source'), 'shot_table'],
    ]

    it.each(CASES)('%s: builds the new node and connects source → new node, nothing else', (kind, source, targetKind) => {
      store().restoreSnapshot({ nodes: [source], edges: [], groups: [] })
      const created = store().addDerivedOutput({ sourceNodeId: 'source', kind: kind as never, node: { kind: targetKind, title: 'out', categoryId: 'shots', position: { x: 400, y: 0 } } })
      expect(created?.kind).toBe(targetKind)
      expect(store().nodes).toHaveLength(2)
      expect(store().edges).toMatchObject([{ source: 'source', target: created?.id }])
      expect(JSON.stringify(created?.meta ?? {})).not.toMatch(/source|origin|derive/i) // 节点上没有任何身份字段
    })

    it.each([
      ['source kind does not fit', node('source', 'image'), 'panorama-screenshot', 'asset'],
      ['new node kind does not fit', node('source', 'panorama'), 'panorama-screenshot', 'text'],
      ['shot-table from a non-video source', node('source', 'text'), 'shot-table', 'shot_table'],
    ] as const)('refuses when %s: no node is created, no edge', (_label, source, kind, targetKind) => {
      store().restoreSnapshot({ nodes: [source], edges: [], groups: [] })
      expect(store().addDerivedOutput({ sourceNodeId: 'source', kind, node: { kind: targetKind, title: 'x', categoryId: 'shots', position: { x: 0, y: 0 } } })).toBeNull()
      expect(store().nodes).toHaveLength(1)
      expect(store().edges).toEqual([])
    })

    it('an ordinary card cannot fake provenance: connectNodes into an input-less card is refused, and a pasted copy of a derived card carries nothing', () => {
      store().restoreSnapshot({ nodes: [node('source', 'panorama')], edges: [], groups: [] })
      const created = store().addDerivedOutput({ sourceNodeId: 'source', kind: 'panorama-screenshot', node: { kind: 'asset', title: 'shot', categoryId: 'shots', position: { x: 400, y: 0 } } })!
      store().selectNodes([created.id])
      store().duplicateSelectedNodes()
      const copy = store().nodes.find((candidate) => candidate.id !== 'source' && candidate.id !== created.id)!
      expect(copy.meta).toEqual(created.meta)
      const edgesBefore = store().edges.length
      store().connectNodes('source', copy.id, 'reference') // 复制出来的卡没有任何出处身份，普通连线又过不了总闸
      expect(store().edges).toHaveLength(edgesBefore)
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
