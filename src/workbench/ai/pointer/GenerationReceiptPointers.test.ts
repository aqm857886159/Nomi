import { describe, expect, it } from 'vitest'
import type { GenerationHandOver, GenerationPresentation, ProductionRun } from '../../../../electron/shared/contracts/productionRunTypes'
import type { ToolReceipt, V4FlowItem } from '../v4/agentPanelV4Types'
import { flowItemGenerations, receiptLine, receiptShotNodeIds } from './generationReceiptFacts'

const NOW = '2026-10-24T00:00:00.000Z'

function run(presentation: GenerationPresentation, operationId = 'op-1', claimed: readonly string[] = []): ProductionRun {
  const candidate = { candidateId: 'cand-1', revision: 1, moduleId: 'm', providerId: 'apimart', modelId: 'seedance-2', mode: 't2v', prompt: '', parameters: {}, references: [] }
  return {
    schemaVersion: 1, runId: `run-${operationId}`, projectId: 'proj-1', revision: 1, status: 'running', stageId: 'generate',
    playbook: { name: 'generation.multi-shot', version: '1.0.0' }, origin: { host: 'nomi' },
    policy: { trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 1, minimizeUploads: true },
    budget: { currency: 'CNY', authorized: 100, reserved: 0, actual: 0, unsettled: 0, unknownInFlight: 0 },
    planVersion: 1, snapshotCursor: 0, stages: [], gates: [], jobs: [], artifacts: [],
    generationPlan: {
      operationId, state: 'draft', candidate,
      shots: ['s1', 's2', 's3'].map((shotId) => ({
        shotId, nodeId: `node-${shotId}`, candidate: { ...candidate, candidateId: shotId }, updatedAt: NOW,
        ...(claimed.includes(shotId) ? { claim: { by: 'canvas' as const, attempt: 1, claimedAt: NOW } } : {}),
      })),
      presentations: [presentation],
      updatedAt: NOW,
    },
    createdAt: NOW, updatedAt: NOW,
  } as ProductionRun
}

const handOver = (shotId: string, outcome?: NonNullable<GenerationHandOver['settled']>['outcome']): GenerationHandOver => ({
  shotId, by: 'gesture', at: NOW, canvasRunId: `canvas-${shotId}`,
  ...(outcome ? { settled: { at: NOW, outcome, ...(outcome === 'not_sent' ? { failure: { kind: 'not_sent' as const, code: 'provider_unreachable' } } : {}) } } : {}),
})
const closed = { at: NOW, by: 'handed_to_canvas' as const }

describe('receiptShotNodeIds：收据下挂哪几镜', () => {
  it('卡关了：交出去的那几镜（按计划顺序），去掉的与没发出去的不挂', () => {
    const runs = { a: run({ shotIds: ['s1', 's2', 's3'], openedAt: NOW, fromGate: 0, removed: [{ shotId: 's2', at: NOW }], handOvers: [handOver('s3', 'accepted'), handOver('s1', 'not_sent')], closed }) }
    expect(receiptShotNodeIds(runs, 'op-1')).toEqual(['node-s3'])
  })

  it('结果未知的也挂（可能在生成，点了去核对）', () => {
    const runs = { a: run({ shotIds: ['s1', 's2'], openedAt: NOW, fromGate: 0, handOvers: [handOver('s1', 'accepted'), handOver('s2', 'unknown')], closed }) }
    expect(receiptShotNodeIds(runs, 'op-1')).toEqual(['node-s1', 'node-s2'])
  })

  it('和 Agent 读到的回执同一个口径：还在交的（卡关时已经绑上画布）、节点上自己拿走的也挂，按计划顺序', () => {
    const runs = { a: run({ shotIds: ['s1', 's2', 's3'], openedAt: NOW, fromGate: 0, handOvers: [handOver('s3', 'accepted'), handOver('s2')], closed: { at: NOW, by: 'user_wrote' } }, 'op-1', ['s1']) }
    expect(receiptShotNodeIds(runs, 'op-1')).toEqual(['node-s1', 'node-s2', 'node-s3'])
  })

  it('卡还开着：一个都不挂（那几镜在卡上，同一件事不摆两处）', () => {
    const runs = { a: run({ shotIds: ['s1', 's2'], openedAt: NOW, fromGate: 0, handOvers: [handOver('s1', 'accepted')] }) }
    expect(receiptShotNodeIds(runs, 'op-1')).toEqual([])
  })

  it('一镜都没交出去就关了（取消）：不挂', () => {
    const runs = { a: run({ shotIds: ['s1'], openedAt: NOW, fromGate: 0, closed: { at: NOW, by: 'user_closed' } }) }
    expect(receiptShotNodeIds(runs, 'op-1')).toEqual([])
  })

  it('找不到那一次出价的 Run（别的项目 / 还没推到）：不挂', () => {
    const runs = { a: run({ shotIds: ['s1'], openedAt: NOW, fromGate: 0, handOvers: [handOver('s1', 'accepted')], closed }, 'op-other') }
    expect(receiptShotNodeIds(runs, 'op-1')).toEqual([])
    expect(receiptShotNodeIds({}, 'op-1')).toEqual([])
  })
})

describe('receiptLine：收据那一句（板 card.done）', () => {
  it('有视频说「段」；那几段节点都出了结果才说「已生成」，否则是「已发出」', () => {
    expect(receiptLine([{ kind: 'video', status: 'running' }, { kind: 'video', status: 'success' }])).toEqual({ unit: 'video', phase: 'sent' })
    expect(receiptLine([{ kind: 'video', status: 'success' }, { kind: 'video', status: 'success' }])).toEqual({ unit: 'video', phase: 'generated' })
    expect(receiptLine([{ kind: 'image', status: 'success' }])).toEqual({ unit: 'image', phase: 'generated' })
  })

  it('节点被删了、在画布上失败了都不算生成了（发过了就是「已发出」）', () => {
    expect(receiptLine([{ kind: 'video', status: 'success' }, undefined])).toEqual({ unit: 'video', phase: 'sent' })
    expect(receiptLine([{ kind: 'video', status: 'error' }])).toEqual({ unit: 'video', phase: 'sent' })
    expect(receiptLine([])).toEqual({ unit: 'image', phase: 'sent' })
  })
})

describe('flowItemGenerations：收起的过程行里的收据也露在外面', () => {
  const receipt = (operationId?: string): ToolReceipt => ({ label: '生成', action: 'video', status: 'output-available', ...(operationId ? { generation: { operationId } } : {}) })
  it('单条 / 工具组 / 过程行都认，没有出价的收据不认', () => {
    expect(flowItemGenerations({ kind: 'tool', receipt: receipt('op-1') } as V4FlowItem)).toEqual(['op-1'])
    expect(flowItemGenerations({ kind: 'tool', receipt: receipt() } as V4FlowItem)).toEqual([])
    expect(flowItemGenerations({ kind: 'tool-group', receipts: [receipt('op-1'), receipt(), receipt('op-2')] } as unknown as V4FlowItem)).toEqual(['op-1', 'op-2'])
    expect(flowItemGenerations({ kind: 'process', details: [{ item: { kind: 'tool', receipt: receipt('op-3') }, index: 0 }] } as unknown as V4FlowItem)).toEqual(['op-3'])
    expect(flowItemGenerations({ kind: 'user', text: 'x' } as V4FlowItem)).toEqual([])
  })
})
