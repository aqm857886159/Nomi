import { describe, expect, it } from 'vitest'
import { mergeExternalCanvasWrite } from './externalCanvasWrite'
import { NODE_LANDED_FIELDS, NODE_RUN_STATE_FIELDS } from './landedNodeFields'

const node = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'image', title: id, position: { x: 0, y: 0 }, ...extra })

describe('mergeExternalCanvasWrite', () => {
  // 每一个系统字段都要守住：外部写入哪怕在 base → next 里改了它，也以当前为准。
  it.each([...NODE_RUN_STATE_FIELDS, ...NODE_LANDED_FIELDS].map((field) => [field] as const))('an external write never changes %s of an existing node', (field) => {
    const base = { nodes: [node('a', { [field]: 'read-time' })], edges: [] }
    const next = { nodes: [node('a', { [field]: 'external', prompt: 'external prompt' })], edges: [] }
    const current = { nodes: [node('a', { [field]: 'landed-later' })], edges: [] }
    const merged = mergeExternalCanvasWrite({ base, next, current })
    expect(merged.nodes).toEqual([node('a', { [field]: 'landed-later', prompt: 'external prompt' })])
  })

  it('only writes what the external side changed and keeps what appeared after the read', () => {
    const base = { nodes: [node('a', { prompt: 'p' }), node('b'), node('gone')], edges: [{ id: 'e1', source: 'a', target: 'b' }] }
    const next = {
      nodes: [node('a', { prompt: 'external' }), node('b'), node('added')],
      edges: [{ id: 'e1', source: 'a', target: 'b' }, { id: 'e2', source: 'added', target: 'a' }],
    }
    const current = {
      nodes: [node('a', { prompt: 'p', position: { x: 9, y: 9 } }), node('gone'), node('fresh')],
      edges: [{ id: 'e1', source: 'a', target: 'b' }, { id: 'e3', source: 'fresh', target: 'a' }],
    }
    const merged = mergeExternalCanvasWrite({ base, next, current })
    // b 被用户删了：外部没碰它，不复活；gone 被外部删了；fresh 是读图之后出现的，保留；added 是外部新增。
    expect(merged.nodes.map((item) => (item as { id: string }).id)).toEqual(['a', 'fresh', 'added'])
    expect(merged.nodes[0]).toEqual(node('a', { prompt: 'external', position: { x: 9, y: 9 } }))
    expect(merged.edges.map((item) => (item as { id: string }).id)).toEqual(['e3', 'e2'])
  })

  // 2026-10-10：外部新增的边过连线总闸（盘上写与渲染层 store 共用这一个函数）。
  it('rejects an externally added edge the target does not take, keeps legitimate ones and pre-existing edges', () => {
    const kinds = (id: string, kind: string) => node(id, { kind })
    const nodes = [kinds('v', 'video'), kinds('t', 'text'), kinds('i', 'image'), kinds('w', 'video')]
    const legacy = { id: 'legacy', source: 'v', target: 't' }
    const base = { nodes, edges: [legacy] }
    const next = { nodes, edges: [legacy, { id: 'bad', source: 'v', target: 't' }, { id: 'ok', source: 'i', target: 'w' }] }
    const rejected: unknown[] = []
    const merged = mergeExternalCanvasWrite({ base, next, current: { nodes, edges: [legacy] }, onRejectedEdges: (items) => rejected.push(...items) })
    expect(merged.edges.map((item) => (item as { id: string }).id)).toEqual(['legacy', 'ok'])
    expect(rejected).toHaveLength(1)
  })

  // 2026-10-10 复审（PR #1147）：同 id 改端点 / 语义是外部新造的连接，不能借「已知 id」绕过连线总闸。
  describe('existing edge id with changed link', () => {
    const kinds = [node('v', { kind: 'video' }), node('t', { kind: 'text' }), node('i', { kind: 'image' }), node('w', { kind: 'video' })]
    const asEdge = (id: string, source: string, target: string, mode?: string) => ({ id, source, target, ...(mode ? { mode } : {}) })

    it('retargeting an existing legal edge into an illegal one is refused and the original edge stays', () => {
      const original = asEdge('e', 'i', 'w')
      const rejected: unknown[] = []
      const merged = mergeExternalCanvasWrite({
        base: { nodes: kinds, edges: [original] },
        next: { nodes: kinds, edges: [asEdge('e', 'v', 't')] },
        current: { nodes: kinds, edges: [original] },
        onRejectedEdges: (items) => rejected.push(...items),
      })
      expect(merged.edges).toEqual([original])
      expect(rejected).toHaveLength(1)
    })

    it('an untouched legacy illegal edge is kept as is', () => {
      const legacy = asEdge('old', 'v', 't')
      const merged = mergeExternalCanvasWrite({ base: { nodes: kinds, edges: [legacy] }, next: { nodes: kinds, edges: [legacy] }, current: { nodes: kinds, edges: [legacy] } })
      expect(merged.edges).toEqual([legacy])
    })

    it('a legacy illegal edge may still be moved by the external side only through the gate (changed mode is judged too)', () => {
      const legacy = asEdge('old', 'v', 't')
      const merged = mergeExternalCanvasWrite({ base: { nodes: kinds, edges: [legacy] }, next: { nodes: kinds, edges: [asEdge('old', 'v', 't', 'first_frame')] }, current: { nodes: kinds, edges: [legacy] } })
      expect(merged.edges).toEqual([legacy])
    })

    it('restoredEdgeIds puts a deleted legacy illegal edge back (restore semantics)', () => {
      const legacy = asEdge('old', 'v', 't')
      const base = { nodes: kinds, edges: [] }
      const args = { base, next: { nodes: kinds, edges: [legacy] }, current: { nodes: kinds, edges: [] } }
      expect(mergeExternalCanvasWrite(args).edges).toEqual([])
      expect(mergeExternalCanvasWrite({ ...args, restoredEdgeIds: ['old'] }).edges).toEqual([legacy])
    })
  })
})
