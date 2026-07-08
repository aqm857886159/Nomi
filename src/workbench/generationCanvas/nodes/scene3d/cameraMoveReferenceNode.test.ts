import { beforeEach, describe, expect, it, vi } from 'vitest'

// availableModels 链路走 window.nomiDesktop IPC，node 测试环境不存在——mock 掉
// （本测试不带 modelKey，真实代码路径也不会调它，与 applyCanvasToolCall.test.ts 同例）。
vi.mock('../../agent/availableModels', () => ({ listAvailableModelsForAgent: vi.fn(async () => []) }))

import { applyCanvasToolCall, resetClientIdRegistry } from '../../agent/applyCanvasToolCall'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { buildCameraMoveScene, type CameraMoveSpec } from './cameraMoveBuilder'
import {
  createCameraMoveReferenceNode,
  cameraMoveFrameCount,
  CAMERA_MOVE_CAPTURE_FPS,
} from './cameraMoveReferenceNode'
import { CAMERA_SPEED_DURATION } from './cameraMoveVocab'

function resetCanvas() {
  const state = useGenerationCanvasStore.getState()
  for (const node of [...state.nodes]) state.deleteNode(node.id)
}

// B1 单一真相源不变量（P1/P4）：手动运镜控件走的 createCameraMoveReferenceNode，和 AI 工具
// create_camera_move 精确分支，对等价输入必须产出**同一个** scene3d + cameraMoveAutoCapture 契约。
// 若某天有人在其中一条路上偷改 fps/frameCount/meta 形状（像 handleRecordTake 漏 move 那样漂移），
// 这条测试立刻红。
describe('createCameraMoveReferenceNode — 与 AI create_camera_move 同源', () => {
  beforeEach(() => {
    resetCanvas()
    resetClientIdRegistry()
  })

  it('等价输入下：手动路建的 scene3d 节点 meta 与 AI 工具逐字段一致', async () => {
    const spec: CameraMoveSpec = { move: 'push_in', speed: 'fast', shot: 'close' }

    // —— AI 路：先建目标视频节点，再 create_camera_move 指向它。
    const created = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'v1', kind: 'video', title: '镜头 1', prompt: 'p' }],
    })) as { clientIdToNodeId: Record<string, string> }
    const aiTargetId = created.clientIdToNodeId.v1
    const aiRes = (await applyCanvasToolCall('create_camera_move', {
      shotClientId: 'v1',
      move: spec.move,
      speed: spec.speed,
      shot: spec.shot,
    })) as { cameraMoveNodeId: string }
    const aiNode = useGenerationCanvasStore.getState().nodes.find((n) => n.id === aiRes.cameraMoveNodeId)!
    const aiFlag = aiNode.meta?.cameraMoveAutoCapture as Record<string, unknown>

    // —— 手动路：清场后自建一个视频节点当目标，直接调共享核心。
    resetCanvas()
    const manualTarget = useGenerationCanvasStore.getState().addNode({ kind: 'video', title: '镜头 M', prompt: 'p' })
    const manualRes = createCameraMoveReferenceNode({ spec, targetNodeId: manualTarget.id })
    const manualNode = useGenerationCanvasStore.getState().nodes.find((n) => n.id === manualRes.cameraMoveNodeId)!
    const manualFlag = manualNode.meta?.cameraMoveAutoCapture as Record<string, unknown>

    // 两路都建 scene3d 节点。
    expect(aiNode.kind).toBe('scene3d')
    expect(manualNode.kind).toBe('scene3d')

    // fps / frameCount / move 不变量逐字段一致（targetNodeId 各指各的目标，单独比是否都带上）。
    expect(manualFlag.fps).toBe(aiFlag.fps)
    expect(manualFlag.frameCount).toBe(aiFlag.frameCount)
    expect(manualFlag.move).toBe(aiFlag.move)
    expect(manualFlag.fps).toBe(CAMERA_MOVE_CAPTURE_FPS)
    expect(manualFlag.frameCount).toBe(CAMERA_SPEED_DURATION.fast * CAMERA_MOVE_CAPTURE_FPS)
    expect(manualFlag.move).toBe('push_in')
    expect(manualFlag.targetNodeId).toBe(manualTarget.id)
    expect(aiFlag.targetNodeId).toBe(aiTargetId)

    // scene3dState 与纯 builder 逐字段等价（同源 buildCameraMoveScene，排除随机 id + 内部交叉引用）。
    const pure = buildCameraMoveScene(spec)
    const stripIds = (s: unknown) =>
      JSON.parse(JSON.stringify(s).replace(/"(id|objectId|trajectoryId)":"[^"]*"/g, '"$1":"_"'))
    expect(stripIds(manualNode.meta?.scene3dState)).toEqual(stripIds(pure))
    expect(stripIds(aiNode.meta?.scene3dState)).toEqual(stripIds(pure))
  })

  it('无 targetNodeId：标志不含 targetNodeId 键（不设 undefined，与 Host 契约一致）', () => {
    const spec: CameraMoveSpec = { move: 'orbit_left', speed: 'slow' }
    const res = createCameraMoveReferenceNode({ spec })
    const node = useGenerationCanvasStore.getState().nodes.find((n) => n.id === res.cameraMoveNodeId)!
    const flag = node.meta?.cameraMoveAutoCapture as Record<string, unknown>
    expect('targetNodeId' in flag).toBe(false)
    expect(flag.frameCount).toBe(CAMERA_SPEED_DURATION.slow * CAMERA_MOVE_CAPTURE_FPS)
  })

  it('cameraMoveFrameCount：缺速度按 medium 派生（与 builder 时长表同源）', () => {
    expect(cameraMoveFrameCount({ move: 'push_in' })).toBe(CAMERA_SPEED_DURATION.medium * CAMERA_MOVE_CAPTURE_FPS)
    expect(cameraMoveFrameCount({ move: 'push_in', speed: 'fast' })).toBe(CAMERA_SPEED_DURATION.fast * CAMERA_MOVE_CAPTURE_FPS)
  })
})
