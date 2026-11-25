// 对外 MCP 的摆位参考 / 运镜参考在渲染端这一跳：主进程路由过来的请求（electron/capabilityCore/mcpDirectorReferenceOps.sdk.test.ts
// 用官方 SDK 钉住了前半程）进 executeCanonicalCanvasPlanPatch → 正常的准入 → 提议事务 → 收据，在画布上真建出导演节点
// （3D-BOX 是唯一的导演台，打开即进新导演台），导演工程能被编辑器载入。只替身「项目落盘」那一步。
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { canvasWriteResultSchema } from '../../../electron/shared/agentCapabilities/canvasWrite'
import { SurfacePortWireError } from '../../../electron/shared/surfacePortBinding'
import { executeCanonicalCanvasPlanPatch } from './canonicalCanvasPlanPatch'
import type { ProjectExecutionContext } from '../project/projectCanvasReadSurface'
import { generationCanvasTools } from '../generationCanvas/agent/generationCanvasTools'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { DIRECTOR_PROJECT_META_KEY } from '../generationCanvas/nodes/director/model/directorNodeMeta'
import { createDirectorStore } from '../generationCanvas/nodes/director/model/directorStore'
import { abandonPendingCanvasWrite } from '../generationCanvas/events/canvasWriteBoundary'
import { clearHistory } from '../generationCanvas/events/canvasPatchHistory'
import { resetClientIdRegistry } from '../generationCanvas/agent/applyCanvasToolCall'
import { useWorkbenchStore } from '../workbenchStore'

// 收据存储在主进程（IPC）；这里换成记账的替身，同 canvasWriteTarget.integration.test.ts。
const receipts = vi.hoisted(() => ({ commits: [] as unknown[] }))
vi.mock('../generationCanvas/agent/proposalUndo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../generationCanvas/agent/proposalUndo')>()
  return {
    ...actual,
    createProposalReceiptCoordinator() {
      return {
        async prepare() { return true },
        async commit(input: unknown) { receipts.commits.push(input); return true },
        async abort() {},
        async disposition() { return 'committed' as const },
      }
    },
  }
})

vi.mock('../project/workbenchProjectSession', () => ({
  persistActiveWorkbenchProjectNow: vi.fn(async () => ({ id: 'project-a', revision: 2, version: 1 })),
  waitForActiveWorkbenchProjectSaveTarget: vi.fn(() => true),
}))

const loaded: ProjectExecutionContext = {
  binding: { projectId: 'project-a', immutableProjectUuid: '11111111-1111-4111-8111-111111111111', projectGeneration: 1 },
  signal: new AbortController().signal,
  assertCurrent() {},
}

function hostRequest(input: Record<string, unknown>, suffix: string) {
  return {
    projectId: 'project-a',
    input,
    receiptProposalId: `mcp-canvas:${String(input.operation)}:${suffix}`,
    approvalId: `mcp-canvas-approval:${String(input.operation)}:${suffix}`,
    loaded,
  }
}

const directors = () => useGenerationCanvasStore.getState().nodes.filter((node) => node.kind === 'director')

function loadsInEditor(nodeId: string): number {
  const node = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
  const scene = createDirectorStore({ rawProject: node?.meta?.[DIRECTOR_PROJECT_META_KEY], defaultSceneName: 'scene' }).getState().activeScene()
  return scene.objects.length + scene.cameras.length
}

beforeEach(() => {
  abandonPendingCanvasWrite()
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
  clearHistory()
  resetClientIdRegistry()
  receipts.commits = []
})

describe('MCP director reference operations in the renderer', () => {
  it('create_camera_move lands a director node bound to the target video shot', async () => {
    const [shot] = generationCanvasTools.create_nodes([{ kind: 'video', title: '镜头 1', prompt: 'p', position: { x: 0, y: 0 } }])
    const result = await executeCanonicalCanvasPlanPatch(hostRequest({ operation: 'create_camera_move', shotClientId: shot.id, move: 'push_in' }, 'camera'))
    expect(result).toMatchObject({ applied: true, operation: 'create_camera_move' })
    expect(receipts.commits).toHaveLength(1)
    const [director] = directors()
    expect(director).toBeTruthy()
    expect(director.meta?.cameraMoveAutoCapture).toMatchObject({ targetNodeId: shot.id, move: 'push_in' })
    expect(loadsInEditor(director.id)).toBeGreaterThan(0)
  })

  it('create_staging_reference lands a director node with the staged characters', async () => {
    const [frame] = generationCanvasTools.create_nodes([{ kind: 'image', title: '关键帧', prompt: 'p', position: { x: 0, y: 0 } }])
    const result = await executeCanonicalCanvasPlanPatch(hostRequest({ operation: 'create_staging_reference', shotClientId: frame.id, characters: [{ name: 'A' }, { name: 'B' }], layout: 'facing' }, 'staging'))
    expect(result).toMatchObject({ applied: true, operation: 'create_staging_reference' })
    const [director] = directors()
    expect(director).toBeTruthy()
    expect(loadsInEditor(director.id)).toBeGreaterThan(0)
  })

  it('still refuses canvas writes the main process does not route here', async () => {
    await expect(executeCanonicalCanvasPlanPatch(hostRequest({ operation: 'create_canvas_nodes', nodes: [{ clientId: 'n', kind: 'text', title: 't', prompt: '' }] }, 'headless'))).rejects.toMatchObject({ code: 'capability_input_invalid' } satisfies Partial<SurfacePortWireError>)
    expect(directors()).toHaveLength(0)
  })
})

// 2026-10-17：tidy_canvas / set_node_text / propose_storyboard_plan / arrange_storyboard_to_timeline 也由主进程路由到这里。
describe('MCP canvas operations that used to be unrouted, in the renderer', () => {
  it('tidy_canvas tidies the category through the normal proposal receipt', async () => {
    generationCanvasTools.create_nodes([
      { kind: 'image', title: 'a', prompt: 'p', position: { x: 900, y: 900 } },
      { kind: 'image', title: 'b', prompt: 'p', position: { x: -500, y: 20 } },
    ])
    const result = await executeCanonicalCanvasPlanPatch(hostRequest({ operation: 'tidy_canvas', categoryId: 'shots' }, 'tidy'))
    expect(result).toMatchObject({ applied: true, operation: 'tidy_canvas' })
    expect(canvasWriteResultSchema.safeParse(result).success, 'the renderer result must satisfy the MCP output schema').toBe(true)
    expect(receipts.commits).toHaveLength(1)
  })

  it('set_node_text writes the body of a text node and refuses a non-text node', async () => {
    const [text, image] = generationCanvasTools.create_nodes([
      { kind: 'text', title: '文本', prompt: '', position: { x: 0, y: 0 } },
      { kind: 'image', title: '图', prompt: 'p', position: { x: 300, y: 0 } },
    ])
    const written = await executeCanonicalCanvasPlanPatch(hostRequest({ operation: 'set_node_text', nodeId: text.id, text: '新的正文', mode: 'replace' }, 'text'))
    expect(written).toMatchObject({ applied: true, operation: 'set_node_text' })
    expect(canvasWriteResultSchema.safeParse(written).success, 'the renderer result must satisfy the MCP output schema').toBe(true)
    expect(JSON.stringify(useGenerationCanvasStore.getState().nodes.find((node) => node.id === text.id)?.contentJson)).toContain('新的正文')
    await expect(executeCanonicalCanvasPlanPatch(hostRequest({ operation: 'set_node_text', nodeId: image.id, text: 'x', mode: 'replace' }, 'text-bad'))).rejects.toBeTruthy()
  })

  it('propose_storyboard_plan writes the plan into the active storyboard through the normal proposal receipt', async () => {
    useWorkbenchStore.getState().hydrateWorkbenchDocuments([
      { id: 'mcp-doc', version: 1, title: 'Story', contentJson: { type: 'doc', content: [] }, updatedAt: 1 },
    ], 'mcp-doc')
    useWorkbenchStore.getState().hydrateStoryboardDesigns({ 'mcp-doc': [] })
    const result = await executeCanonicalCanvasPlanPatch(hostRequest({
      operation: 'propose_storyboard_plan',
      title: '外部 Agent 提的方案',
      anchors: [],
      shots: [{ index: 1, shotKind: 'image', durationSec: 0, anchorIds: [], prompt: '开场' }],
    }, 'plan'))
    expect(result).toMatchObject({ applied: true, operation: 'propose_storyboard_plan' })
    expect(canvasWriteResultSchema.safeParse(result).success, 'the renderer result must satisfy the MCP output schema').toBe(true)
    const designs = useWorkbenchStore.getState().storyboardDesignsByDocumentId['mcp-doc'] ?? []
    expect(designs.map((design) => design.plan.title)).toContain('外部 Agent 提的方案')
  })

  it('arrange_storyboard_to_timeline passes the gate and reaches its own implementation', async () => {
    // 点名的节点上没有可排片的镜头：失败必须来自操作自己（说清为什么），而不是路由层的 capability_input_invalid。
    const [frame] = generationCanvasTools.create_nodes([{ kind: 'image', title: '关键帧', prompt: 'p', position: { x: 0, y: 0 } }])
    await expect(executeCanonicalCanvasPlanPatch(hostRequest({ operation: 'arrange_storyboard_to_timeline', nodeIds: [frame.id] }, 'arrange'))).rejects.not.toMatchObject({ code: 'capability_input_invalid' })
  })
})
