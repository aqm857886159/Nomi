// 方向检查 docs/plan/2026-10-07-canvas-landing-direction-check.md §3 预测 ①（乙类：双份真相同步）。
// 制作流程整批落地 → Ctrl+Z（规则 B：有结果的镜留下，其余节点撤掉）→ Ctrl+Y。撤销那一下被
// 画布写边界显式发出删除信号，上报 detach（这一镜不再派、不扣钱）；
// 重做把节点放回来，却没有任何人发反向的 reattach——重开项目之前这些镜在 Run 里一直是 detached。
//
// 钉现状：detach 与 reattach 都由显式画布信号驱动并保持绿色。
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
import { subscribeProductionCanvasSignals } from './productionCanvasSignals'
import { reportDetachedShotNodes } from './reportDetachedShotNodes'
import { reportReattachedShotNodes } from './reportReattachedShotNodes'
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
  stop = subscribeProductionCanvasSignals((signal) => {
    const byRun = new Map<string, typeof signal.nodes[number][]>()
    for (const node of signal.nodes) {
      const runId = typeof node.meta?.productionRunId === 'string' ? node.meta.productionRunId : ''
      if (!runId) continue
      byRun.set(runId, [...(byRun.get(runId) ?? []), node])
    }
    for (const [runId, nodes] of byRun) {
      void (signal.kind === 'detach'
        ? reportDetachedShotNodes('project-1', runId, nodes.map((node) => node.id), api as unknown as Pick<DesktopProductionRunBridge, 'read' | 'command'>)
        : reportReattachedShotNodes('project-1', runId, nodes, api as unknown as Pick<DesktopProductionRunBridge, 'read' | 'command'>))
    }
  })
})

afterEach(() => {
  stop?.()
  stop = undefined
  project.dispose()
})

describe('production batch creation history', () => {
  it('undoing the creation does not infer deletion from the resulting node set', async () => {
    const nodeIds = await landBatch()
    useGenerationCanvasStore.getState().undo()
    expect(useGenerationCanvasStore.getState().nodes.map((node) => node.id)).toEqual([nodeIds[0]])

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(commandsOfType('plan.detach-shot-nodes')).toHaveLength(0)
  })

  it('redoing the creation does not infer reattachment either', async () => {
    const nodeIds = await landBatch()
    useGenerationCanvasStore.getState().undo()

    useGenerationCanvasStore.getState().redo()
    expect(useGenerationCanvasStore.getState().nodes.map((node) => node.id)).toEqual(expect.arrayContaining(nodeIds))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(commandsOfType('plan.bind-shot-nodes')).toHaveLength(0)
  })
})
