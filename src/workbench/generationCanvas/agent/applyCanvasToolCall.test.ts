import { beforeEach, describe, expect, it, vi } from 'vitest'

// availableModels 链路走 window.nomiDesktop IPC,node 测试环境不存在——mock 掉
// (本测试的 case 不带 modelKey,真实代码路径也不会调它)。
vi.mock('./availableModels', () => ({ listAvailableModelsForAgent: vi.fn(async () => []) }))

import { applyCanvasToolCall, parseCameraMoveSpec, resetClientIdRegistry, resolveCanvasToolNodeId } from './applyCanvasToolCall'
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

// S4 运镜参考解析器：容错提取，非法/缺省由 builder 兜默认（与 parseStagingSpec 同例）。
describe('parseCameraMoveSpec — 容错解析运镜参数', () => {
  it('完整参数原样落 spec', () => {
    expect(
      parseCameraMoveSpec({ move: 'orbit_left', speed: 'slow', shot: 'wide', subjectPose: 'walk' }),
    ).toEqual({ move: 'orbit_left', speed: 'slow', shot: 'wide', subjectPose: 'walk', customMove: undefined })
  })

  it('缺 move/customMove → 全 undefined（执行器据此判 词表内/外/缺一）', () => {
    expect(parseCameraMoveSpec({})).toEqual({
      move: undefined,
      speed: undefined,
      shot: undefined,
      subjectPose: undefined,
      customMove: undefined,
    })
  })

  it('词表外逃生口：customMove 原样落，move 仍可空（不硬塞 enum）', () => {
    expect(parseCameraMoveSpec({ customMove: '希区柯克式眩晕变焦' })).toEqual({
      move: undefined,
      speed: undefined,
      shot: undefined,
      subjectPose: undefined,
      customMove: '希区柯克式眩晕变焦',
    })
  })

  it('空串/非串值按缺省处理，不抛', () => {
    expect(parseCameraMoveSpec({ move: '   ', speed: 42 as unknown as string })).toEqual({
      move: undefined,
      speed: undefined,
      shot: undefined,
      subjectPose: undefined,
      customMove: undefined,
    })
  })
})

// S4 执行分支：建 scene3d 节点 + 打 cameraMoveAutoCapture 标志（targetNodeId/fps/frameCount/move），不渲染。
describe('applyCanvasToolCall create_camera_move 执行', () => {
  beforeEach(() => {
    resetCanvas()
    resetClientIdRegistry()
  })

  it('建 scene3d 节点，标志含解析出的真实 targetNodeId + frameCount=duration*12', async () => {
    const created = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'v1', kind: 'video', title: '镜头 1', prompt: 'p' }],
    })) as { clientIdToNodeId: Record<string, string> }
    const targetId = created.clientIdToNodeId.v1

    const res = (await applyCanvasToolCall('create_camera_move', {
      shotClientId: 'v1',
      move: 'push_in',
      speed: 'fast', // 3s × 24fps = 72 帧（Seedance 要求 ≥23.8fps）
    })) as { cameraMoveNodeId: string; targetNodeId: string | null }

    expect(res.targetNodeId).toBe(targetId)
    const scene3d = useGenerationCanvasStore.getState().nodes.find((n) => n.id === res.cameraMoveNodeId)
    expect(scene3d?.kind).toBe('scene3d')
    const flag = scene3d?.meta?.cameraMoveAutoCapture as Record<string, unknown> | undefined
    expect(flag).toMatchObject({ targetNodeId: targetId, fps: 24, frameCount: 72, move: 'push_in' })
    expect(scene3d?.meta?.scene3dState).toBeTruthy()
  })

  // 词表外逃生口：只给 customMove → 不建 scene3d 节点、不渲，运镜指令追加进目标视频节点 prompt（诚实降级）。
  it('customMove（词表外）→ 不建 scene3d，运镜指令追加进视频节点 prompt + 打幂等标志', async () => {
    const created = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'v9', kind: 'video', title: '镜头 1', prompt: '女孩站在窗边的特写' }],
    })) as { clientIdToNodeId: Record<string, string> }
    const targetId = created.clientIdToNodeId.v9

    const res = (await applyCanvasToolCall('create_camera_move', {
      shotClientId: 'v9',
      customMove: '希区柯克式眩晕变焦（dolly zoom）',
    })) as { cameraMoveNodeId: string | null; targetNodeId: string | null; degraded?: boolean }

    expect(res.cameraMoveNodeId).toBeNull() // 不渲、不建 scene3d 节点
    expect(res.degraded).toBe(true)
    const state = useGenerationCanvasStore.getState()
    expect(state.nodes.filter((n) => n.kind === 'scene3d')).toHaveLength(0)
    const target = state.nodes.find((n) => n.id === targetId)
    expect(target?.prompt).toContain('希区柯克式眩晕变焦')
    expect(target?.prompt).toContain('女孩站在窗边的特写') // 不覆盖原 prompt，追加
    expect((target?.meta as Record<string, unknown>)?.cameraMovePromptApplied).toBe('希区柯克式眩晕变焦（dolly zoom）')

    // 幂等：同指令再来一次不重复追加
    await applyCanvasToolCall('create_camera_move', { shotClientId: 'v9', customMove: '希区柯克式眩晕变焦（dolly zoom）' })
    const after = useGenerationCanvasStore.getState().nodes.find((n) => n.id === targetId)
    expect((after?.prompt.match(/希区柯克式眩晕变焦/g) || []).length).toBe(1)
  })

  it('move 与 customMove 都缺 → 抛错（不静默兜 push_in 硬塞运镜）', async () => {
    const created = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'v8', kind: 'video', title: '镜头', prompt: 'p' }],
    })) as { clientIdToNodeId: Record<string, string> }
    void created
    await expect(applyCanvasToolCall('create_camera_move', { shotClientId: 'v8' })).rejects.toThrow()
  })
})

// 词表外逃生口（站位）：只给 customBlocking → 不建 scene3d、不渲，构图指令追加进目标关键帧节点 prompt。
describe('applyCanvasToolCall create_staging_reference customBlocking 降级', () => {
  beforeEach(() => {
    resetCanvas()
    resetClientIdRegistry()
  })

  it('customBlocking（词表外）→ 不建 scene3d，构图指令追加进关键帧节点 prompt', async () => {
    const created = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'k1', kind: 'image', title: '镜头关键帧', prompt: '雨夜天台' }],
    })) as { clientIdToNodeId: Record<string, string> }
    const targetId = created.clientIdToNodeId.k1

    const res = (await applyCanvasToolCall('create_staging_reference', {
      shotClientId: 'k1',
      customBlocking: '三层人墙的复杂队形，主角越肩构图',
    })) as { stagingNodeId: string | null; targetNodeId: string | null; degraded?: boolean }

    expect(res.stagingNodeId).toBeNull()
    expect(res.degraded).toBe(true)
    const state = useGenerationCanvasStore.getState()
    expect(state.nodes.filter((n) => n.kind === 'scene3d')).toHaveLength(0)
    const target = state.nodes.find((n) => n.id === targetId)
    expect(target?.prompt).toContain('三层人墙的复杂队形')
    expect(target?.prompt).toContain('雨夜天台')
    expect((target?.meta as Record<string, unknown>)?.stagingPromptApplied).toBeTruthy()
  })
})
