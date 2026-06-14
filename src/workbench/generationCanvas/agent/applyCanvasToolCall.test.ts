import { beforeEach, describe, expect, it, vi } from 'vitest'

// availableModels 链路走 window.nomiDesktop IPC,node 测试环境不存在——mock 掉
// (本测试的 case 不带 modelKey,真实代码路径也不会调它)。
vi.mock('./availableModels', () => ({ listAvailableModelsForAgent: vi.fn(async () => []) }))

import { applyCanvasToolCall, resetClientIdRegistry, resolveCanvasToolNodeId } from './applyCanvasToolCall'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useWorkbenchStore } from '../../workbenchStore'
import type { StoryboardPlan } from './storyboardPlan'

function resetCanvas() {
  const state = useGenerationCanvasStore.getState()
  for (const node of [...state.nodes]) state.deleteNode(node.id)
}

// 回归锁(评测 sb-001 抓出):agent 用 clientId(n1/n2)连边,渲染层曾不翻译直接
// 入 store → 落盘 "n1→n2" 吊边(指向不存在节点,连线静默丢失)。
describe('applyCanvasToolCall clientId 翻译', () => {
  beforeEach(resetCanvas)

  it('resetClientIdRegistry 清表后旧 clientId 不再解析到旧项目节点(P1 治跨项目串台)', async () => {
    const created = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'n1', kind: 'image', title: '镜头 1', prompt: 'p1' }],
    })) as { clientIdToNodeId: Record<string, string> }
    // 注册后:resolveCanvasToolNodeId('n1') 翻译成真实 id。
    expect(resolveCanvasToolNodeId('n1')).toBe(created.clientIdToNodeId.n1)
    expect(resolveCanvasToolNodeId('n1')).not.toBe('n1')
    // 切项目会调它:清表后 'n1' 不再解析到旧项目节点(返回自身=未注册),杜绝跨项目误连/误删。
    resetClientIdRegistry()
    expect(resolveCanvasToolNodeId('n1')).toBe('n1')
  })

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

  it('create_canvas_nodes 随计划携带 edges → 节点+边一次落地（用户拍板：不分两步）', async () => {
    const result = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [
        { clientId: 'a1', kind: 'character', title: '男主', prompt: 'p0' },
        { clientId: 'a2', kind: 'image', title: '镜头 1 关键帧', prompt: 'p2' },
        { clientId: 'a3', kind: 'video', title: '镜头 1 视频', prompt: 'p3' },
      ],
      edges: [
        { sourceClientId: 'a1', targetClientId: 'a2', mode: 'character_ref' },
        { sourceClientId: 'a2', targetClientId: 'a3', mode: 'first_frame' },
      ],
    })) as { createdNodeIds: string[]; clientIdToNodeId: Record<string, string>; connectedCount?: number }
    expect(result.createdNodeIds).toHaveLength(3)
    expect(result.connectedCount).toBe(2)

    const state = useGenerationCanvasStore.getState()
    expect(state.edges).toHaveLength(2)
    expect(state.edges[0].source).toBe(result.clientIdToNodeId.a1)
    // T1：边语义随计划原样落 store（生成期参考槽分流依赖它）
    expect(state.edges.map((e) => e.mode)).toEqual(['character_ref', 'first_frame'])
    // 吊边绝不入 store（clientId 已全部翻译成真实 id）
    expect(state.edges.some((e) => /^a\d$/.test(e.source) || /^a\d$/.test(e.target))).toBe(false)
  })

  it('无 groupCategoryId：按 kind 归类（角色→cast）——agent 直接建卡不受影响', async () => {
    const created = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'c1', kind: 'character', title: '男主', prompt: 'p' }],
    })) as { clientIdToNodeId: Record<string, string> }
    const node = useGenerationCanvasStore.getState().nodes.find((n) => n.id === created.clientIdToNodeId.c1)
    expect(node?.categoryId).toBe('cast')
  })

  it('带 groupCategoryId=shots：整批落分镜（角色/场景与镜头同处，用户拍板 A）', async () => {
    const created = (await applyCanvasToolCall('create_canvas_nodes', {
      groupCategoryId: 'shots',
      nodes: [
        { clientId: 'g1', kind: 'character', title: '男主', prompt: 'p' },
        { clientId: 'g2', kind: 'scene', title: '天台', prompt: 'p' },
        { clientId: 'g3', kind: 'video', title: '镜头 1', prompt: 'p' },
      ],
    })) as { clientIdToNodeId: Record<string, string> }
    const state = useGenerationCanvasStore.getState()
    const cat = (id: string) => state.nodes.find((n) => n.id === id)?.categoryId
    expect(cat(created.clientIdToNodeId.g1)).toBe('shots')
    expect(cat(created.clientIdToNodeId.g2)).toBe('shots')
    expect(cat(created.clientIdToNodeId.g3)).toBe('shots')
  })

  it('非法 mode 按通用参考处理（不抛、不静默改语义）', async () => {
    const created = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [
        { clientId: 'b1', kind: 'image', title: 'x', prompt: 'p' },
        { clientId: 'b2', kind: 'image', title: 'y', prompt: 'p' },
      ],
      edges: [{ sourceClientId: 'b1', targetClientId: 'b2', mode: 'made_up_mode' }],
    })) as { connectedCount?: number }
    expect(created.connectedCount).toBe(1)
    // store 对缺省 mode 落 'reference'（通用参考）——非法值不得伪装成任何具体语义
    expect(useGenerationCanvasStore.getState().edges[0].mode ?? 'reference').toBe('reference')
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

// S2:propose_storyboard_plan 不碰画布——把结构化方案落创作 store 并切回创作区(规划免费可改)。
describe('applyCanvasToolCall propose_storyboard_plan', () => {
  const PLAN: StoryboardPlan = {
    title: '雨夜追凶',
    anchors: [{ id: 'a1', kind: 'character', name: '林夏', description: '红色校服', carrier: 'visual' }],
    shots: [
      { index: 1, durationSec: 5, anchorIds: ['a1'], prompt: '推镜' },
      { index: 2, durationSec: 8, anchorIds: ['a1'], prompt: '跟拍' },
    ],
  }

  beforeEach(() => {
    resetCanvas()
    useWorkbenchStore.getState().setStoryboardPlan(null)
    useWorkbenchStore.getState().setWorkspaceMode('generation')
  })

  it('合法方案 → 落创作 store + 切回创作区 + 不动画布,回执含计数', async () => {
    const ack = (await applyCanvasToolCall('propose_storyboard_plan', PLAN)) as string
    const ws = useWorkbenchStore.getState()
    expect(ws.storyboardPlan).toEqual(PLAN)
    expect(ws.workspaceMode).toBe('creation')
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(0) // 规划不碰画布
    expect(ack).toContain('1 个锚')
    expect(ack).toContain('2 个镜头')
  })

  it('畸形方案 → throw,不落 store(调用方映射成 tool error 回喂 LLM)', async () => {
    await expect(
      applyCanvasToolCall('propose_storyboard_plan', { title: 't', anchors: [{ id: 'x', kind: 'bad' }], shots: [] }),
    ).rejects.toThrow()
    expect(useWorkbenchStore.getState().storyboardPlan).toBeNull()
  })
})
