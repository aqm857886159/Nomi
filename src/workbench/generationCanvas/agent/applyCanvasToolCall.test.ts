import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CANVAS_READ_CAPABILITY } from '../../../../electron/shared/agentCapabilities/canvasRead'

// availableModels 链路走 window.nomiDesktop IPC,node 测试环境不存在——mock 掉
// (本测试的 case 不带 modelKey,真实代码路径也不会调它)。
vi.mock('./availableModels', () => ({ listAvailableModelsForAgent: vi.fn(async () => []) }))

import {
  applyCanvasToolCall,
  parseCameraMoveSpec,
  parseStagingSpec,
  resetClientIdRegistry,
  resolveCanvasToolNodeId,
} from './applyCanvasToolCall'
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
  beforeEach(() => {
    resetCanvas()
    useWorkbenchStore.setState({ activeCategoryId: 'shots', canvasFitNonce: 0, canvasFitCategoryId: null })
  })

  it('批量创建节点后请求一次适应视图，单节点不打断当前视口', async () => {
    await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'solo', kind: 'image', title: '单节点', prompt: 'p' }],
    })
    expect(useWorkbenchStore.getState().canvasFitNonce).toBe(0)

    await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [
        { clientId: 'batch-1', kind: 'image', title: '批量 1', prompt: 'p1' },
        { clientId: 'batch-2', kind: 'video', title: '批量 2', prompt: 'p2' },
      ],
    })
    expect(useWorkbenchStore.getState().canvasFitNonce).toBe(1)
    expect(useWorkbenchStore.getState().canvasFitCategoryId).toBe('shots')
  })

  it('批量节点不在当前分类时切到包含新节点的主分类再 fit', async () => {
    useWorkbenchStore.getState().setActiveCategoryId('audio')
    await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [
        { clientId: 'cast-1', kind: 'character', title: '角色', prompt: 'p1' },
        { clientId: 'shot-1', kind: 'video', title: '镜头', prompt: 'p2' },
      ],
    })
    expect(useWorkbenchStore.getState().activeCategoryId).toBe('shots')
    expect(useWorkbenchStore.getState().canvasFitCategoryId).toBe('shots')
    expect(useWorkbenchStore.getState().canvasFitNonce).toBe(1)
  })

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

  it.each([CANVAS_READ_CAPABILITY.id, CANVAS_READ_CAPABILITY.aliases.pi, CANVAS_READ_CAPABILITY.aliases.mcp])(
    'rejects read route %s because reads belong to the main capability executor',
    async (toolName) => {
      await expect(applyCanvasToolCall(toolName, {})).rejects.toThrow(`unknown tool ${toolName}`)
    },
  )

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

    const deleted = (await applyCanvasToolCall('delete_canvas_nodes', { nodeIds: ['n9'] })) as {
      deletedNodeIds: string[]
    }
    expect(deleted.deletedNodeIds).toEqual([realId])
  })
})

// 图片+视频分镜落画布的镜号语义：首帧图带 storyboardKeyframe 标记不自动领号，
// 落地后按 first_frame 边共用所属视频的镜号（与手动「转视频」桥继承号同语义）——
// 否则 N 镜领出 1..2N 交错编号，角标与「镜头 N 首帧」标题错位（A2 类编号 bug）。
describe('applyCanvasToolCall 图片+视频分镜镜号', () => {
  beforeEach(resetCanvas)

  it('首帧图不占号：视频连续编号 1..N，首帧图与所属视频共号', async () => {
    const result = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [
        { clientId: 'shot-1-keyframe', kind: 'image', title: '镜头 1 首帧', prompt: 'k1', storyboardKeyframe: true },
        { clientId: 'shot-1', kind: 'video', title: '镜头 1', prompt: 'v1' },
        { clientId: 'shot-2-keyframe', kind: 'image', title: '镜头 2 首帧', prompt: 'k2', storyboardKeyframe: true },
        { clientId: 'shot-2', kind: 'video', title: '镜头 2', prompt: 'v2' },
      ],
      edges: [
        { sourceClientId: 'shot-1-keyframe', targetClientId: 'shot-1', mode: 'first_frame' },
        { sourceClientId: 'shot-2-keyframe', targetClientId: 'shot-2', mode: 'first_frame' },
      ],
      anchorCount: 0,
    })) as { clientIdToNodeId: Record<string, string> }

    const byRealId = new Map(useGenerationCanvasStore.getState().nodes.map((n) => [n.id, n]))
    const kf1 = byRealId.get(result.clientIdToNodeId['shot-1-keyframe'])
    const video1 = byRealId.get(result.clientIdToNodeId['shot-1'])
    const kf2 = byRealId.get(result.clientIdToNodeId['shot-2-keyframe'])
    const video2 = byRealId.get(result.clientIdToNodeId['shot-2'])

    // 视频是镜位本体：连续 1..2，不被首帧图挤号
    expect([video1?.shotIndex, video2?.shotIndex]).toEqual([1, 2])
    // 首帧图与所属视频共用镜号；身份标记落进 meta（isShotNumberedNode 据此长期跳过）
    expect(kf1?.shotIndex).toBe(1)
    expect(kf2?.shotIndex).toBe(2)
    expect((kf1?.meta as Record<string, unknown>)?.storyboardKeyframe).toBe(true)
  })
})

// S2:propose_storyboard_plan 不碰画布——把结构化方案落创作 store 并切回创作区(规划免费可改)。
describe('applyCanvasToolCall timeline storyboard scope', () => {
  beforeEach(() => {
    resetCanvas()
    resetClientIdRegistry()
  })

  it('rejects Agent node ids that cross two storyboard designs before mutating the timeline', async () => {
    const canvas = useGenerationCanvasStore.getState()
    const first = canvas.addNode({ kind: 'video', title: 'A1', categoryId: 'shots' })
    const second = canvas.addNode({ kind: 'video', title: 'B1', categoryId: 'shots' })
    canvas.updateNode(first.id, { meta: { storyboardDesignId: 'design-a' } })
    canvas.updateNode(second.id, { meta: { storyboardDesignId: 'design-b' } })
    const timelineBefore = useWorkbenchStore.getState().timeline

    await expect(applyCanvasToolCall('arrange_storyboard_to_timeline', {
      nodeIds: [first.id, second.id],
    })).rejects.toThrow('mixed_storyboard_scope')
    expect(useWorkbenchStore.getState().timeline).toBe(timelineBefore)
  })
})

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
    useWorkbenchStore.getState().hydrateWorkbenchDocuments(
      [{ id: 'doc-1', version: 1, title: '', contentJson: { type: 'doc', content: [] }, updatedAt: 1 }],
      'doc-1',
    )
    useWorkbenchStore.getState().hydrateStoryboardPlans({})
    useWorkbenchStore.getState().setWorkspaceMode('creation')
  })

  it('合法方案 → 落统一创作页 + 不动画布,回执含计数', async () => {
    const ack = await applyCanvasToolCall('propose_storyboard_plan', PLAN)
    const ws = useWorkbenchStore.getState()
    expect(ws.storyboardPlans['doc-1'].plan).toEqual(PLAN)
    expect(ws.workspaceMode).toBe('creation')
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(0) // 规划不碰画布
    expect(ack).toMatchObject({ status: 'applied', documentId: 'doc-1', storyboardDesignId: expect.any(String) })
    expect((ack as { message: string }).message).toContain('1 个锚')
    expect((ack as { message: string }).message).toContain('2 个镜头')
  })

  it('畸形方案 → throw,不落 store(调用方映射成 tool error 回喂 LLM)', async () => {
    await expect(
      applyCanvasToolCall('propose_storyboard_plan', { title: 't', anchors: [{ id: 'x', kind: 'bad' }], shots: [] }),
    ).rejects.toThrow()
    expect(useWorkbenchStore.getState().storyboardPlans['doc-1']).toBeUndefined()
  })

  it('规划期间用户切走后不抢回工作区，结果仍落原文稿', async () => {
    useWorkbenchStore.getState().setWorkspaceMode('generation')
    await applyCanvasToolCall('propose_storyboard_plan', PLAN, undefined, undefined, 'doc-1')
    const ws = useWorkbenchStore.getState()
    expect(ws.workspaceMode).toBe('generation')
    expect(ws.storyboardDesignsByDocumentId['doc-1'][0].plan).toEqual(PLAN)
  })

  it('全新拆镜不会覆盖当前已确认的分镜设计', async () => {
    await applyCanvasToolCall('propose_storyboard_plan', PLAN, undefined, undefined, 'doc-1')
    const firstId = useWorkbenchStore.getState().activeStoryboardId!
    useWorkbenchStore.getState().commitStoryboardPlan('doc-1', firstId)

    const nextPlan = { ...PLAN, title: '另一版' }
    const result = await applyCanvasToolCall('propose_storyboard_plan', nextPlan, undefined, undefined, 'doc-1')
    const ws = useWorkbenchStore.getState()

    expect(result).toMatchObject({ status: 'applied', storyboardDesignId: expect.any(String) })
    expect((result as { storyboardDesignId: string }).storyboardDesignId).not.toBe(firstId)
    expect(ws.storyboardDesignsByDocumentId['doc-1']).toHaveLength(2)
    expect(ws.storyboardDesignsByDocumentId['doc-1'].find((design) => design.id === firstId)?.committed).toBe(true)
  })

  it('生成期间原稿被删除时不留下孤儿分镜', async () => {
    useWorkbenchStore.getState().addWorkbenchDocument()
    const deletedDocumentId = useWorkbenchStore.getState().activeDocumentId
    useWorkbenchStore.getState().deleteWorkbenchDocument(deletedDocumentId)

    const result = await applyCanvasToolCall('propose_storyboard_plan', PLAN, undefined, undefined, deletedDocumentId)

    expect(result).toMatchObject({ status: 'obsolete', documentId: deletedDocumentId })
    expect(useWorkbenchStore.getState().storyboardDesignsByDocumentId[deletedDocumentId]).toBeUndefined()
  })
})

// S4 运镜参考解析器：容错提取，非法/缺省由 builder 兜默认（与 parseStagingSpec 同例）。
describe('parseCameraMoveSpec — 容错解析运镜参数', () => {
  it('完整参数原样落 spec', () => {
    expect(parseCameraMoveSpec({ move: 'orbit_left', speed: 'slow', shot: 'wide', subjectPose: 'walk' })).toEqual({
      move: 'orbit_left',
      speed: 'slow',
      shot: 'wide',
      subjectPose: 'walk',
      customMove: undefined,
    })
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

  it('customMove 会清掉模型从上一轮残留的 move enum', () => {
    expect(parseCameraMoveSpec({ move: 'push_in', customMove: '快速甩镜到窗外街景' })).toMatchObject({
      move: undefined,
      customMove: '快速甩镜到窗外街景',
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

  it('灰模布景字段：sceneTemplate + props 与站位同解析（共享 parseSceneBackdrop）', () => {
    const spec = parseCameraMoveSpec({
      move: 'push_in',
      sceneTemplate: 'street',
      props: [{ kind: 'car', position: [2, 1], rotationY: 30 }, { kind: 'tree' }],
    })
    expect(spec.sceneTemplate).toBe('street')
    expect(spec.props).toEqual([
      { kind: 'car', position: [2, 1], rotationY: 30, scale: undefined },
      { kind: 'tree', position: undefined, rotationY: undefined, scale: undefined },
    ])
  })

  it('无布景字段 → sceneTemplate/props 均 undefined（老行为）', () => {
    const spec = parseCameraMoveSpec({ move: 'orbit_left' })
    expect(spec.sceneTemplate).toBeUndefined()
    expect(spec.props).toBeUndefined()
  })
})

// T2 站位解析器：新增布景字段（sceneTemplate/props）容错提取。
describe('parseStagingSpec — 灰模布景字段', () => {
  it('sceneTemplate + props（含位置/朝向/缩放）原样落 spec', () => {
    const spec = parseStagingSpec({
      characters: [{ pose: 'standing' }],
      sceneTemplate: 'street',
      props: [{ kind: 'car', position: [3, -1], rotationY: 90, scale: 1.2 }, { kind: 'tree' }],
    })
    expect(spec.sceneTemplate).toBe('street')
    expect(spec.props).toEqual([
      { kind: 'car', position: [3, -1], rotationY: 90, scale: 1.2 },
      { kind: 'tree', position: undefined, rotationY: undefined, scale: undefined },
    ])
  })

  it('无布景字段 → sceneTemplate/props 均 undefined（老行为不变）', () => {
    const spec = parseStagingSpec({ characters: [{ pose: 'standing' }] })
    expect(spec.sceneTemplate).toBeUndefined()
    expect(spec.props).toBeUndefined()
  })

  it('props 缺 kind / 位置非法 → 丢该件 / 位置置空，不抛', () => {
    const spec = parseStagingSpec({
      characters: [{}],
      props: [{ rotationY: 10 }, { kind: 'wall', position: [1] }],
    })
    expect(spec.props).toEqual([{ kind: 'wall', position: undefined, rotationY: undefined, scale: undefined }])
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
      customMove: '快速甩镜到窗外街景（whip pan）',
    })) as { cameraMoveNodeId: string | null; targetNodeId: string | null; degraded?: boolean }

    expect(res.cameraMoveNodeId).toBeNull() // 不渲、不建 scene3d 节点
    expect(res.degraded).toBe(true)
    const state = useGenerationCanvasStore.getState()
    expect(state.nodes.filter((n) => n.kind === 'scene3d')).toHaveLength(0)
    const target = state.nodes.find((n) => n.id === targetId)
    expect(target?.prompt).toContain('快速甩镜')
    expect(target?.prompt).toContain('女孩站在窗边的特写') // 不覆盖原 prompt，追加
    expect((target?.meta as Record<string, unknown>)?.cameraMovePromptApplied).toBe('快速甩镜到窗外街景（whip pan）')

    // 幂等：同指令再来一次不重复追加
    await applyCanvasToolCall('create_camera_move', {
      shotClientId: 'v9',
      customMove: '快速甩镜到窗外街景（whip pan）',
    })
    const after = useGenerationCanvasStore.getState().nodes.find((n) => n.id === targetId)
    expect(((after?.prompt ?? '').match(/快速甩镜/g) || []).length).toBe(1)
  })

  it('move 与 customMove 都缺 → 抛错（不静默兜 push_in 硬塞运镜）', async () => {
    const created = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'v8', kind: 'video', title: '镜头', prompt: 'p' }],
    })) as { clientIdToNodeId: Record<string, string> }
    void created
    await expect(applyCanvasToolCall('create_camera_move', { shotClientId: 'v8' })).rejects.toThrow()
  })

  it('move 与 customMove 同时存在 → customMove 优先，不执行残留 enum', async () => {
    const created = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'v10', kind: 'video', title: '镜头', prompt: 'p' }],
    })) as { clientIdToNodeId: Record<string, string> }
    const result = (await applyCanvasToolCall('create_camera_move', {
      shotClientId: 'v10',
      move: 'push_in',
      customMove: '快速甩镜',
    })) as { cameraMoveNodeId: string | null; degraded?: boolean }

    expect(result).toMatchObject({ cameraMoveNodeId: null, degraded: true })
    const state = useGenerationCanvasStore.getState()
    expect(state.nodes.filter((node) => node.kind === 'scene3d')).toHaveLength(0)
    expect(state.nodes.find((node) => node.id === created.clientIdToNodeId.v10)?.prompt).toContain('快速甩镜')
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

// patch_shots：改**已有**分镜表的逐项修改。测试按用户真会说的话组织，不按字段组织——
// 工具的成败标准是「用户那句话能不能被做到」，不是「字段能不能被写进去」。
describe('applyCanvasToolCall patch_shots', () => {
  const PLAN: StoryboardPlan = {
    title: '雨夜追凶',
    anchors: [{ id: 'a1', kind: 'character', name: '林夏', description: '红色校服', carrier: 'visual' }],
    shots: [
      { index: 1, durationSec: 5, anchorIds: ['a1'], prompt: '推镜' },
      { index: 2, durationSec: 8, anchorIds: ['a1'], prompt: '跟拍' },
      { index: 3, durationSec: 5, anchorIds: [], prompt: '远景' },
    ],
  }

  beforeEach(() => {
    resetCanvas()
    useWorkbenchStore.getState().hydrateWorkbenchDocuments(
      [{ id: 'doc-1', version: 1, title: '', contentJson: { type: 'doc', content: [] }, updatedAt: 1 }],
      'doc-1',
    )
    useWorkbenchStore.getState().hydrateStoryboardPlans({ 'doc-1': { plan: PLAN, committed: false } })
    useWorkbenchStore.getState().setWorkspaceMode('storyboard')
  })

  const shots = () => useWorkbenchStore.getState().storyboardPlans['doc-1'].plan.shots

  it('「所有镜头加雨天」——一次调用改全部，且是追加不是替换', async () => {
    const ack = await applyCanvasToolCall('patch_shots', {
      select: { kind: 'all' }, patch: { promptAppend: '雨天' },
    }) as { changedShotIndexes: number[]; changedFields: string[] }
    expect(shots().map((shot) => shot.prompt)).toEqual(['推镜，雨天', '跟拍，雨天', '远景，雨天'])
    // 结果要能让模型直接决定下一步，而不是回一个 ok 让它重读整份方案。
    expect(ack.changedShotIndexes).toEqual([1, 2, 3])
    expect(ack.changedFields).toEqual(['prompt'])
  })

  it('「第 3 镜改成近景」——只动点名那一镜，其余逐字不变', async () => {
    await applyCanvasToolCall('patch_shots', {
      select: { kind: 'indexes', indexes: [3] }, patch: { prompt: '近景' },
    })
    expect(shots()[2].prompt).toBe('近景')
    expect(shots()[0]).toEqual(PLAN.shots[0])
    expect(shots()[1]).toEqual(PLAN.shots[1])
  })

  it('没点名的字段结构上就改不到（软约束变硬约束的直接回归）', async () => {
    await applyCanvasToolCall('patch_shots', {
      select: { kind: 'all' }, patch: { durationSec: 6 },
    })
    // 只点名了 durationSec：提示词、锚引用、镜号全部逐字不变。
    expect(shots().map((shot) => shot.prompt)).toEqual(['推镜', '跟拍', '远景'])
    expect(shots().map((shot) => shot.anchorIds)).toEqual([['a1'], ['a1'], []])
    expect(shots().map((shot) => shot.durationSec)).toEqual([6, 6, 6])
  })

  it('换模型时 vendor 成对落地，并清掉上一个模型的模式', async () => {
    await applyCanvasToolCall('patch_shots', {
      select: { kind: 'indexes', indexes: [1] },
      patch: { modelKey: 'nano-banana', modelVendor: 'apimart' },
    })
    expect(shots()[0].modelKey).toBe('nano-banana')
    expect(shots()[0].modelVendor).toBe('apimart')
    expect(shots()[0].modeId).toBeUndefined()
  })

  it('镜号越界时错误信息告诉模型怎么改（错误信息即提示词）', async () => {
    await expect(applyCanvasToolCall('patch_shots', {
      select: { kind: 'indexes', indexes: [9] }, patch: { prompt: 'x' },
    })).rejects.toThrow(/镜号 9 超出范围.*共 3 镜.*1-3/)
  })

  it('还没有方案时，告诉模型先去 propose，而不是报 invalid input', async () => {
    useWorkbenchStore.getState().hydrateStoryboardPlans({})
    await expect(applyCanvasToolCall('patch_shots', {
      select: { kind: 'all' }, patch: { prompt: 'x' },
    })).rejects.toThrow(/propose_storyboard_plan/)
  })
})
