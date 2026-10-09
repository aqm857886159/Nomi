// 架构③ 合同 3（协调会话 10-08）：制作流程的结局回填与普通画布**同一语义**——节点被删时到达的结局按 nodeId
// 暂存，撤销 / 放回把节点带回来时落上去；不再静默跳过（以前 attachShotResult / applyShotGeneration 见节点不在就 return）。
//
// 测试形状照抄普通画布那一条（src/workbench/generationCanvas/store/deletedNodeArrivingOutcome.test.ts）：
// 每一扇删节点的门 × 每一种之后到达的结局 → 撤销删除 → 节点身上有这笔结局。
// 区别只在投递口：普通画布走 deliverRunOutcome，制作流程走落地链 materialize-shots（Run 每变一次的跟随投影）。
// 跟随投影对已删节点只认 existingOnly，所以报文里要带上 Run 记着的那个 nodeId，渲染层才知道结局该暂存给谁。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { attachShotResult, materializeShots, type MaterializeShotInput } from './multiShotCanvasLanding'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { resetClientIdRegistry } from '../generationCanvas/agent/applyCanvasToolCall'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../project/projectSessionTestHarness'
import type { GenerationCanvasNode, GenerationNodeResult } from '../generationCanvas/model/generationCanvasTypes'

const PROJECT = 'project-a'
const RUN = 'run-held'
const OP = `canvas-landing:${RUN}`
const RUN_RECORD = 'production-run:job-shot-1'
const RESULT: GenerationNodeResult = { id: RUN_RECORD, type: 'image', url: `nomi-local://asset/${PROJECT}/out/shot-1.png`, createdAt: 5 }

let project: ProjectSessionTestHarness
const node = (id: string): GenerationCanvasNode | undefined => useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === id)

/** 确认即落：两镜落成占位节点，shot-1 已交给供应商（节点上挂着本制作的「生成中」）。 */
async function landBatch(): Promise<string> {
  const landed = await materializeShots({
    projectId: PROJECT, runId: RUN, materializationOperationId: OP,
    shots: [
      { shotId: 'shot-1', kind: 'image', prompt: 'one', generation: { state: 'running', runRecordId: RUN_RECORD, startedAt: 1 } },
      { shotId: 'shot-2', kind: 'image', prompt: 'two', generation: { state: 'ended' } },
    ],
  })
  const nodeId = landed.bindings.find((binding) => binding.shotId === 'shot-1')?.nodeId
  if (!nodeId) throw new Error('fixture: shot-1 did not land')
  return nodeId
}

/** Run 跟随投影：删节点后 Run 已记 detached → 这一镜只许动已有节点（existingOnly），并带上 Run 绑着的 nodeId。 */
function follow(nodeId: string, shot: Partial<MaterializeShotInput>) {
  return materializeShots({
    projectId: PROJECT, runId: RUN, materializationOperationId: OP, existingOnly: true,
    shots: [{ shotId: 'shot-1', kind: 'image', prompt: 'one', existingOnly: true, nodeId, ...shot } as MaterializeShotInput],
  })
}

type Deletion = Readonly<{ name: string; remove: (nodeId: string) => void }>
const DELETIONS: readonly Deletion[] = [
  { name: 'delete node', remove: (nodeId) => useGenerationCanvasStore.getState().deleteNode(nodeId) },
  { name: 'delete selected nodes', remove: (nodeId) => { useGenerationCanvasStore.getState().selectNodes([nodeId]); useGenerationCanvasStore.getState().deleteSelectedNodes() } },
  { name: 'cut', remove: (nodeId) => { useGenerationCanvasStore.getState().selectNodes([nodeId]); useGenerationCanvasStore.getState().cutSelectedNodes() } },
  {
    name: 'external write deletes it',
    remove: (nodeId) => {
      const { nodes, edges, groups } = useGenerationCanvasStore.getState().readDocumentSnapshot()
      useGenerationCanvasStore.getState().applyExternalGraph({ base: { nodes, edges, groups }, next: { nodes: nodes.filter((candidate) => candidate.id !== nodeId), edges, groups } })
    },
  },
]

type Arrival = Readonly<{ name: string; arrive: (nodeId: string) => Promise<unknown> | unknown; assertLanded: (landed: GenerationCanvasNode | undefined) => void }>
const ARRIVALS: readonly Arrival[] = [
  {
    name: 'result via the Run follow projection',
    arrive: (nodeId) => follow(nodeId, { result: RESULT }),
    assertLanded: (landed) => {
      expect(landed?.result?.id).toBe(RUN_RECORD)
      expect(landed?.status).toBe('success')
      expect(landed?.runs?.[0]).toMatchObject({ id: RUN_RECORD, status: 'success' })
    },
  },
  {
    name: 'result via attachShotResult',
    arrive: (nodeId) => attachShotResult({ nodeId, result: RESULT }),
    assertLanded: (landed) => {
      expect(landed?.result?.id).toBe(RUN_RECORD)
      expect(landed?.status).toBe('success')
    },
  },
  {
    name: 'failure via the Run follow projection',
    arrive: (nodeId) => follow(nodeId, { generation: { state: 'failed', runRecordId: RUN_RECORD, startedAt: 1, message: 'upstream refused' } }),
    assertLanded: (landed) => {
      expect(landed?.status).toBe('error')
      expect(landed?.runs?.[0]).toMatchObject({ id: RUN_RECORD, status: 'error' })
    },
  },
]

beforeEach(async () => {
  resetClientIdRegistry()
  project = createProjectSessionTestHarness()
  await project.open(PROJECT)
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] }, PROJECT)
})
afterEach(() => { vi.restoreAllMocks(); project.dispose() })

describe('a production outcome that arrives while its node is deleted lands when undo brings the node back', () => {
  const matrix = DELETIONS.flatMap((deletion) => ARRIVALS.map((arrival) => [deletion.name, arrival.name, deletion, arrival] as const))

  it.each(matrix)('%s · %s', async (_d, _a, deletion, arrival) => {
    const nodeId = await landBatch()
    deletion.remove(nodeId)
    expect(node(nodeId)).toBeUndefined()

    await arrival.arrive(nodeId)
    // 节点不在：不复活（删除事实优先）。
    expect(node(nodeId)).toBeUndefined()

    useGenerationCanvasStore.getState().undo()

    const restored = node(nodeId)
    expect(restored).toBeDefined()
    expect(restored?.status).not.toBe('running')
    arrival.assertLanded(restored)
  })

  it.each(ARRIVALS.map((arrival) => [arrival.name, arrival] as const))('%s: redo removes it again; undo once more brings it back landed', async (_name, arrival) => {
    const nodeId = await landBatch()
    DELETIONS[0].remove(nodeId)
    await arrival.arrive(nodeId)
    useGenerationCanvasStore.getState().undo()
    useGenerationCanvasStore.getState().redo()
    expect(node(nodeId)).toBeUndefined()
    useGenerationCanvasStore.getState().undo()
    arrival.assertLanded(node(nodeId))
  })

  it.each(ARRIVALS.map((arrival) => [arrival.name, arrival] as const))('%s: undo before the arrival lands normally (control)', async (_name, arrival) => {
    const nodeId = await landBatch()
    DELETIONS[0].remove(nodeId)
    useGenerationCanvasStore.getState().undo()
    await arrival.arrive(nodeId)
    arrival.assertLanded(node(nodeId))
  })
})

// #1139 N2：暂存只在本次会话有效——撤销栈本来就只在内存里，重启后本来也撤销不了删除。与普通画布同一个语义：
// 重新装载项目（restoreSnapshot）时，普通画布与制作流程暂存的结局一起清空。结果本身不丢：它在 Run 账本与素材文件里
// （主进程那一半见 electron/productionRun/landFirstResultDurable.test.ts）。
it('held outcomes are session-only, for ordinary canvas runs and production shots alike: reloading the project clears both', async () => {
  const nodeId = await landBatch()
  useGenerationCanvasStore.getState().deleteNode(nodeId)
  attachShotResult({ nodeId, result: RESULT })
  useGenerationCanvasStore.getState().holdRunOutcome('ordinary-node', { kind: 'result', result: { ...RESULT, id: 'ordinary-result' } })
  expect(Object.keys(useGenerationCanvasStore.getState().heldNodeOutcomes).sort()).toEqual([nodeId, 'ordinary-node'].sort())

  const snapshot = useGenerationCanvasStore.getState().readDocumentSnapshot()
  useGenerationCanvasStore.getState().restoreSnapshot(snapshot, PROJECT)

  expect(useGenerationCanvasStore.getState().heldNodeOutcomes).toEqual({})
})
