// 方向检查 docs/plan/2026-10-07-canvas-landing-direction-check.md §3 预测 ①（乙类：双份真相同步）。
// 制作流程整批落地 → Ctrl+Z（规则 B：有结果的镜留下，其余节点撤掉）→ Ctrl+Y。撤销那一下被
// watchDeletedProductionNodes 从 store 前后两拍的差里「推断」成删节点，上报 detach（这一镜不再派、不扣钱）；
// 重做把节点放回来，却没有任何人发反向的 reattach——重开项目之前这些镜在 Run 里一直是 detached。
//
// 钉现状 + 标红期望：detach 那一半今天就成立（绿）；reattach 那一半是期望（`it.fails`，今天红）。
// 修它的是「删 ②」（删掉推断删除，改成删除类手势显式发 detach、撤销 / 重做显式发反向），不在画布写边界这一刀里；
// 删 ② 合入时把 `it.fails` 改回 `it`。重开之后会不会恢复派发：unverified。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ warn: vi.fn(), feedback: vi.fn() }))
vi.mock('../../desktop/rendererLog', () => ({ logRendererWarn: mocks.warn }))
vi.mock('../generationCanvas/components/canvasFeedback', () => ({ reportCanvasFeedback: mocks.feedback }))

import type { DesktopProductionRunBridge, ProductionRunProjection } from '../../desktop/productionRunBridgeTypes'
import { materializeShots } from '../capability/multiShotCanvasLanding'
import { resetClientIdRegistry } from '../generationCanvas/agent/applyCanvasToolCall'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { watchDeletedProductionNodes } from './watchDeletedProductionNodes'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../project/projectSessionTestHarness'

type RunCommand = Parameters<DesktopProductionRunBridge['command']>[2]
const RUN_ID = 'run-predict-1'
const run = { revision: 3, generationPlan: { state: 'running' } } as unknown as ProductionRunProjection

let stop: (() => void) | undefined
let project: ProjectSessionTestHarness
let api: { read: ReturnType<typeof vi.fn>; command: ReturnType<typeof vi.fn> }

async function landBatch(): Promise<string[]> {
  const result = await materializeShots({
    materializationOperationId: `canvas-landing:${RUN_ID}`,
    runId: RUN_ID,
    shots: [1, 2, 3, 4].map((index) => ({
      shotId: `shot-${index}`, kind: 'image' as const, prompt: `镜头 ${index}`,
      ...(index === 1 ? { result: { id: 'production-job-shot-1', type: 'image' as const, url: 'nomi-local://shot-1.png', createdAt: 1 } } : {}),
    })),
  })
  return result.bindings.map((binding) => binding.nodeId)
}

const commandsOfType = (type: string) => (api.command.mock.calls as Array<[string, string, RunCommand]>).filter(([, , command]) => command.type === type)

beforeEach(async () => {
  vi.clearAllMocks()
  project = createProjectSessionTestHarness()
  await project.open('project-1')
  resetClientIdRegistry()
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] })
  api = { read: vi.fn(async () => run), command: vi.fn(async () => ({ run, events: [] })) }
  stop = watchDeletedProductionNodes('project-1', api as unknown as Pick<DesktopProductionRunBridge, 'read' | 'command'>)
})

afterEach(() => {
  stop?.()
  stop = undefined
  project.dispose()
})

describe('prediction ①: undo then redo of a production batch landing', () => {
  it('current: the undo is inferred as deleting the three shots without results and reported as detach', async () => {
    const nodeIds = await landBatch()
    useGenerationCanvasStore.getState().undo()
    expect(useGenerationCanvasStore.getState().nodes.map((node) => node.id)).toEqual([nodeIds[0]])

    await vi.waitFor(() => expect(commandsOfType('plan.detach-shot-nodes')).toHaveLength(1))
    expect(commandsOfType('plan.detach-shot-nodes')[0][2].payload).toEqual({ nodeIds: nodeIds.slice(1) })
  })

  it.fails('expected (fixed by 删 ②): redo brings the shots back and re-attaches them to the Run', async () => {
    const nodeIds = await landBatch()
    useGenerationCanvasStore.getState().undo()
    await vi.waitFor(() => expect(commandsOfType('plan.detach-shot-nodes')).toHaveLength(1))

    useGenerationCanvasStore.getState().redo()
    expect(useGenerationCanvasStore.getState().nodes.map((node) => node.id)).toEqual(expect.arrayContaining(nodeIds))

    await vi.waitFor(() => expect(commandsOfType('plan.bind-shot-nodes')).toHaveLength(1))
    expect(commandsOfType('plan.bind-shot-nodes')[0][2].payload).toMatchObject({
      bindings: nodeIds.slice(1).map((nodeId, index) => ({ shotId: `shot-${index + 2}`, nodeId })),
    })
  })
})
