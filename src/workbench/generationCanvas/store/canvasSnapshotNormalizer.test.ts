import { describe, expect, it } from 'vitest'
import { productionRunRecordId } from '../../../../electron/shared/productionShotPhase'
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

// 2026-09-26 真付费 T5：两镜都在供应商那边跑，重开窗口后第 2 镜仍「生成中」、第 1 镜变成一张空白节点。
// 制作投影写的「生成中」记录没有任务号（任务住在主进程的 Run 里），重开收敛把它当幽灵转圈收成了空闲；
// 能不能回来全看事件尾巴里有没有它。这类记录只归制作投影管（主进程 Run 才知道它在不在跑），收敛不许碰。
describe('normalizeStoreSnapshot — 制作投影写的「生成中」只归制作投影管', () => {
  function productionNode(extra: Record<string, unknown>) {
    return { id: 'shot-1-node', kind: 'video', title: '镜头 1', position: { x: 0, y: 0 }, meta: { productionRunId: 'op-1' }, ...extra }
  }

  it.each(['running', 'queued'] as const)('%s + 制作投影的记录（没有任务号）→ 原样留着，不收成空闲', (status) => {
    const record = { id: productionRunRecordId('generation-op-1-shot-1-abc'), status, startedAt: 1, updatedAt: 2 }
    const snap = normalizeStoreSnapshot({ nodes: [productionNode({ status, runs: [record] })] })
    expect(snap.nodes[0].status).toBe(status)
    expect(snap.nodes[0].runs?.[0]).toMatchObject({ id: record.id, status })
  })

  it('同一个制作节点上用户自己跑的那一次（本地记录、没任务号）照旧收敛成空闲', () => {
    const snap = normalizeStoreSnapshot({
      nodes: [productionNode({
        status: 'running',
        runs: [{ id: 'local-run-1', status: 'running', startedAt: 3, updatedAt: 4 }, { id: productionRunRecordId('job-0'), status: 'success', startedAt: 1, updatedAt: 2 }],
      })],
    })
    expect(snap.nodes[0].status).toBe('idle')
    expect(snap.nodes[0].runs?.[0]).toMatchObject({ id: 'local-run-1', status: 'cancelled' })
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

describe('normalizeStoreSnapshot — 旧版制作结果的签名预览链改写成素材库地址', () => {
  it('result / history 里的 production-preview 链（5 分钟过期）→ nomi-local://asset；别的地址一个字不动', () => {
    const stale = 'nomi-local://production-preview/project-1/op-1/asset-1/assets/generated/materialized/video-1.mp4?preview=expired-token'
    const snapshot = normalizeStoreSnapshot({
      nodes: [{
        id: 'n1', kind: 'video', title: '镜头 58', position: { x: 0, y: 0 }, status: 'success',
        result: { id: 'production-job-1', type: 'video', url: stale, thumbnailUrl: stale, createdAt: 1 },
        history: [
          { id: 'production-job-1', type: 'video', url: stale, createdAt: 1 },
          { id: 'manual', type: 'video', url: 'nomi-local://asset/project-1/assets/manual.mp4', createdAt: 2 },
        ],
      }],
      edges: [],
    })
    const node = snapshot.nodes[0]
    expect(node.result?.url).toBe('nomi-local://asset/project-1/assets/generated/materialized/video-1.mp4')
    expect(node.result?.thumbnailUrl).toBe('nomi-local://asset/project-1/assets/generated/materialized/video-1.mp4')
    expect(node.history?.map((entry) => entry.url)).toEqual([
      'nomi-local://asset/project-1/assets/generated/materialized/video-1.mp4',
      'nomi-local://asset/project-1/assets/manual.mp4',
    ])
  })
})
