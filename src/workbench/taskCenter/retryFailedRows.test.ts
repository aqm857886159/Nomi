// 「全部重试」按行的种类走（D-1126-sd-hd-retry-route）：普通失败照节点设置重新生成，出高清失败只带样片号再出高清。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import type { TaskCenterRow } from './taskCenterEntries'
import { confirmAndRunNode } from '../generationCanvas/runner/generationRunController'

const calls = vi.hoisted(() => ({
  plan: [] as Array<{ nodeIds: string[]; options: Record<string, unknown> }>,
  node: [] as Array<{ nodeId: string; options: Record<string, unknown> }>,
  spend: [] as Array<{ count: number; metas: unknown[] }>,
  approve: true,
}))

vi.mock('../generationCanvas/components/batchPlanPreview', () => ({
  confirmAndRunPlan: vi.fn(async (plan: { waves: string[][] }, options: Record<string, unknown>) => {
    calls.plan.push({ nodeIds: plan.waves.flat(), options })
    return 'started'
  }),
}))
vi.mock('../generationCanvas/runner/generationRunController', () => ({
  confirmAndRunNode: vi.fn(async (nodeId: string, options: Record<string, unknown>) => {
    calls.node.push({ nodeId, options })
    return 'started'
  }),
}))
vi.mock('../generationCanvas/spend/spendConfirm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../generationCanvas/spend/spendConfirm')>()),
  withGenerationEtaStats: async (context: unknown) => context,
  confirmGenerationSpend: vi.fn(async (nodes: Array<{ meta?: unknown } | undefined>) => {
    calls.spend.push({ count: nodes.length, metas: nodes.map((node) => node?.meta) })
    return calls.approve
  }),
}))
vi.mock('../project/projectCanvasReadSurface', () => ({
  withProjectAction: <T,>(fn: (issued: { binding: { projectId: string } }) => T) => fn({ binding: { projectId: 'p1' } }),
  isProjectExecutionContextCurrent: () => true,
}))

const { useGenerationCanvasStore } = await import('../generationCanvas/store/generationCanvasStore')
const { retryFailedGenerationRows, splitFailedRetries } = await import('./retryFailedRows')

const T0 = 1_800_000_000_000
const sample = {
  id: 's1', type: 'video', url: 'nomi-local://asset/p/s1.mp4', taskId: 'draft-1', model: 'doubao-seedance-2.5-sample', createdAt: T0,
  provenance: { provider: 'apimart', timestamp: T0, params: { extras: { archetype: { id: 'seedance-2.5-apimart-sample', modeId: 'text_to_video' }, modelKey: 'doubao-seedance-2.5-sample', modelVendor: 'apimart' } } },
}

function canvasNode(id: string, patch: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode {
  return { id, kind: 'video', title: id, prompt: '一镜', position: { x: 0, y: 0 }, status: 'error', error: 'HTTP 500 upstream', meta: { modelKey: 'doubao-seedance-2.5', modelVendor: 'apimart' }, history: [], runs: [], ...patch } as GenerationCanvasNode
}

function row(id: string, nodeId: string, action: TaskCenterRow['action']): TaskCenterRow {
  return { id, kind: 'generation', batchId: 'b', nodeId, title: nodeId, group: 'done', outcome: 'error', recoverable: false, waveIndex: 0, phaseText: '', cancel: 'none', target: { kind: 'canvas_node', nodeId }, action } as TaskCenterRow
}

const hd = { draftTaskId: 'draft-1', resolution: '1080p' }

beforeEach(() => {
  calls.plan.length = 0
  calls.node.length = 0
  calls.spend.length = 0
  calls.approve = true
  useGenerationCanvasStore.setState({
    nodes: [
      canvasNode('plain-a'),
      canvasNode('plain-b'),
      // 出高清没成的节点：照成功画、手上有样片；它现在选着的是普通 2.5，重试也不按它发。
      canvasNode('sample-v', { status: 'success', error: undefined, result: sample as GenerationCanvasNode['result'] }),
    ],
    edges: [],
  })
})

describe('splitFailedRetries', () => {
  it('每个节点只重试一次，按最新那一行（行是新的在前）的种类；没有重试动作的行不进', () => {
    const split = splitFailedRetries([
      row('r1', 'sample-v', { kind: 'retry_sample_final', nodeId: 'sample-v', sampleFinal: hd }),
      row('r0', 'sample-v', { kind: 'retry_generation', nodeId: 'sample-v' }),
      row('r2', 'plain-a', { kind: 'retry_generation', nodeId: 'plain-a' }),
      row('r3', 'gone', null),
    ])
    expect(split).toEqual({ regenerate: ['plain-a'], sampleFinals: [{ nodeId: 'sample-v', sampleFinal: hd }] })
  })
})

describe('retryFailedGenerationRows', () => {
  it('混着普通失败和出高清失败：问一次（3 笔），普通的照计划跑、出高清的只带样片号，没有重新出样片的那一笔', async () => {
    const failures = await retryFailedGenerationRows([
      row('r1', 'sample-v', { kind: 'retry_sample_final', nodeId: 'sample-v', sampleFinal: hd }),
      row('r2', 'plain-a', { kind: 'retry_generation', nodeId: 'plain-a' }),
      row('r3', 'plain-b', { kind: 'retry_generation', nodeId: 'plain-b' }),
    ])
    expect(failures).toEqual([])
    expect(calls.spend).toHaveLength(1)
    expect(calls.spend[0].count).toBe(3)
    // 出高清那一笔按样片那一行算（不看节点现在选着谁）。
    expect(calls.spend[0].metas[2]).toMatchObject({ modelKey: 'doubao-seedance-2.5-sample', draft_task_id: 'draft-1', resolution: '1080p' })
    expect(calls.plan).toEqual([{ nodeIds: ['plain-a', 'plain-b'], options: { initiator: 'user', skipSpendConfirmation: true } }])
    expect(calls.node).toEqual([{ nodeId: 'sample-v', options: { initiator: 'user', sampleFinal: hd } }])
  })

  it('卡上取消：什么都不发', async () => {
    calls.approve = false
    await retryFailedGenerationRows([
      row('r1', 'sample-v', { kind: 'retry_sample_final', nodeId: 'sample-v', sampleFinal: hd }),
      row('r2', 'plain-a', { kind: 'retry_generation', nodeId: 'plain-a' }),
    ])
    expect(calls.plan).toEqual([])
    expect(calls.node).toEqual([])
  })

  it('只有普通失败：一字不改走原来那条（失败范围计划 + 它自己的批量卡）', async () => {
    await retryFailedGenerationRows([
      row('r2', 'plain-a', { kind: 'retry_generation', nodeId: 'plain-a' }),
      row('r3', 'plain-b', { kind: 'retry_generation', nodeId: 'plain-b' }),
    ])
    expect(calls.spend).toEqual([])
    expect(calls.plan).toEqual([{ nodeIds: ['plain-a', 'plain-b'], options: { initiator: 'user' } }])
    expect(calls.node).toEqual([])
  })

  it('某一镜没发出去：交回那一镜的号（面板挂到它那一行上）', async () => {
    vi.mocked(confirmAndRunNode).mockRejectedValueOnce(new Error('node_generation_in_flight'))
    const failures = await retryFailedGenerationRows([
      row('r1', 'sample-v', { kind: 'retry_sample_final', nodeId: 'sample-v', sampleFinal: hd }),
      row('r2', 'plain-a', { kind: 'retry_generation', nodeId: 'plain-a' }),
    ])
    expect(failures.map((failure) => failure.nodeId)).toEqual(['sample-v'])
  })
})
