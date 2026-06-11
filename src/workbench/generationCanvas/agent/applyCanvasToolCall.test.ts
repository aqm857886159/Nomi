import { beforeEach, describe, expect, it, vi } from 'vitest'

// availableModels 链路走 window.nomiDesktop IPC,node 测试环境不存在——mock 掉
// (本测试的 case 不带 modelKey,真实代码路径也不会调它)。
vi.mock('./availableModels', () => ({ listAvailableModelsForAgent: vi.fn(async () => []) }))

import { applyCanvasToolCall } from './applyCanvasToolCall'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

function resetCanvas() {
  const state = useGenerationCanvasStore.getState()
  for (const node of [...state.nodes]) state.deleteNode(node.id)
}

// 回归锁(评测 sb-001 抓出):agent 用 clientId(n1/n2)连边,渲染层曾不翻译直接
// 入 store → 落盘 "n1→n2" 吊边(指向不存在节点,连线静默丢失)。
describe('applyCanvasToolCall clientId 翻译', () => {
  beforeEach(resetCanvas)

  it('connect_canvas_edges 用 clientId 连边 → store 里是真实节点 id', async () => {
    const created = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [
        { clientId: 'n1', kind: 'image', title: '镜头 1', prompt: 'p1' },
        { clientId: 'n2', kind: 'image', title: '镜头 2', prompt: 'p2' },
      ],
    })) as { createdNodeIds: string[]; clientIdToNodeId: Record<string, string> }
    expect(created.clientIdToNodeId.n1).toBeTruthy()

    const connected = (await applyCanvasToolCall('connect_canvas_edges', {
      edges: [{ sourceClientId: 'n1', targetClientId: 'n2' }],
    })) as { connectedCount: number; skippedEdges?: unknown[] }
    expect(connected.connectedCount).toBe(1)
    expect(connected.skippedEdges).toBeUndefined()

    const edges = useGenerationCanvasStore.getState().edges
    expect(edges).toHaveLength(1)
    expect(edges[0].source).toBe(created.clientIdToNodeId.n1)
    expect(edges[0].target).toBe(created.clientIdToNodeId.n2)
    // 吊边绝不入 store
    expect(edges.some((e) => e.source === 'n1' || e.target === 'n2')).toBe(false)
  })

  it('端点不存在的边被跳过并如实回报,不入 store', async () => {
    const result = (await applyCanvasToolCall('connect_canvas_edges', {
      edges: [{ sourceClientId: 'ghost-a', targetClientId: 'ghost-b' }],
    })) as { connectedCount: number; skippedEdges?: unknown[] }
    expect(result.connectedCount).toBe(0)
    expect(result.skippedEdges).toHaveLength(1)
    expect(useGenerationCanvasStore.getState().edges).toHaveLength(0)
  })

  it('set_node_prompt / delete_canvas_nodes 同样接受 clientId', async () => {
    const created = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'n9', kind: 'image', title: 'X', prompt: 'old' }],
    })) as { clientIdToNodeId: Record<string, string> }
    const realId = created.clientIdToNodeId.n9

    await applyCanvasToolCall('set_node_prompt', { nodeId: 'n9', prompt: 'new prompt' })
    expect(useGenerationCanvasStore.getState().nodes.find((n) => n.id === realId)?.prompt).toBe('new prompt')

    const deleted = (await applyCanvasToolCall('delete_canvas_nodes', { nodeIds: ['n9'] })) as { deletedNodeIds: string[] }
    expect(deleted.deletedNodeIds).toEqual([realId])
  })
})
