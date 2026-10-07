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
})
