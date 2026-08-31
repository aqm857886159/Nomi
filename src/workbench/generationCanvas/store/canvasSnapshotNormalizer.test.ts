import { describe, expect, it } from 'vitest'
import { normalizeStoreSnapshot } from './canvasSnapshotNormalizer'

// 重启收敛：磁盘里 status 仍 running/queued 的节点（上次退出时正在生成，已无活轮询循环）→
// 有 taskId 收敛成 recoverable（可重新拉取，重启后也能），无 taskId 收敛成 idle。progress 一律清空。
describe('normalizeStoreSnapshot — 重启收敛卡住的 mid-flight 节点', () => {
  function nodeWith(extra: Record<string, unknown>) {
    return { id: 'n1', kind: 'video', title: '镜头1', position: { x: 0, y: 0 }, ...extra }
  }

  it('running + runs[0].taskId → recoverable，progress 清空，run 记录同步 recoverable', () => {
    const snap = normalizeStoreSnapshot({
      nodes: [nodeWith({
        status: 'running',
        progress: { phase: 'generating', message: '正在生成', updatedAt: 1, taskId: 'up-1' },
        runs: [{ id: 'r1', status: 'running', taskId: 'up-1', startedAt: 1, updatedAt: 2 }],
      })],
    })
    expect(snap.nodes).toHaveLength(1)
    expect(snap.nodes[0].status).toBe('recoverable')
    expect(snap.nodes[0].progress).toBeUndefined()
    expect(snap.nodes[0].runs?.[0].status).toBe('recoverable')
    expect(snap.nodes[0].runs?.[0].taskId).toBe('up-1')
  })

  it('queued 但无 taskId（从没真发出去）→ idle，run 记录收敛 cancelled', () => {
    const snap = normalizeStoreSnapshot({
      nodes: [nodeWith({
        status: 'queued',
        progress: { phase: 'queued', message: '准备生成', updatedAt: 1 },
        runs: [{ id: 'r1', status: 'queued', startedAt: 1, updatedAt: 2 }],
      })],
    })
    expect(snap.nodes[0].status).toBe('idle')
    expect(snap.nodes[0].progress).toBeUndefined()
    expect(snap.nodes[0].runs?.[0].status).toBe('cancelled')
  })

  it('终态节点（success / error）不被动到', () => {
    const snap = normalizeStoreSnapshot({
      nodes: [
        nodeWith({ id: 'ok', status: 'success', result: { id: 'res', type: 'video', url: 'x', createdAt: 1 } }),
        nodeWith({ id: 'bad', status: 'error', error: '失败了' }),
      ],
    })
    expect(snap.nodes.find((n) => n.id === 'ok')?.status).toBe('success')
    expect(snap.nodes.find((n) => n.id === 'bad')?.status).toBe('error')
  })
})

describe('normalizeStoreSnapshot — 连线身份修复', () => {
  it('旧快照中同两点多语义边的重复 id 会被确定性拆开', () => {
    const snapshot = normalizeStoreSnapshot({
      nodes: [
        { id: 'src', kind: 'image', title: 'src', position: { x: 0, y: 0 } },
        { id: 'dst', kind: 'video', title: 'dst', position: { x: 400, y: 0 } },
      ],
      edges: [
        { id: 'edge-src-dst', source: 'src', target: 'dst', mode: 'first_frame', order: 0 },
        { id: 'edge-src-dst', source: 'src', target: 'dst', mode: 'last_frame', order: 1 },
      ],
      groups: [],
    })
    expect(snapshot.edges).toHaveLength(2)
    expect(new Set(snapshot.edges.map((edge) => edge.id)).size).toBe(2)
    expect(snapshot.edges.map((edge) => edge.mode)).toEqual(['first_frame', 'last_frame'])
  })
})

describe('normalizeStoreSnapshot — plugin preservation', () => {
  it('keeps a plugin node envelope, its edges, and workflow templates across normalization', () => {
    const snapshot = normalizeStoreSnapshot({
      nodes: [{ id: 'checkpoint', kind: 'text', title: '检查', position: { x: 10, y: 20 }, typeId: 'nomi.workflow/checkpoint', pluginState: {
        pluginId: 'nomi.workflow', pluginVersion: '1.0.0', typeId: 'nomi.workflow/checkpoint', schemaVersion: 1, state: { checked: false },
      } }, { id: 'target', kind: 'image', title: '镜头', position: { x: 300, y: 20 } }],
      edges: [{ id: 'edge', source: 'checkpoint', target: 'target' }],
      groups: [],
      workflowTemplates: [{ id: 't1', name: '流程', createdAt: 1, updatedAt: 1, nodes: [], edges: [] }],
    })
    expect(snapshot.nodes[0].pluginState?.state).toEqual({ checked: false })
    expect(snapshot.edges).toHaveLength(1)
    expect(snapshot.workflowTemplates).toHaveLength(1)
  })
})
