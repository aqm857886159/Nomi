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
