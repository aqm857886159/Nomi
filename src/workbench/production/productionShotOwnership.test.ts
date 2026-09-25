import { afterEach, describe, expect, it } from 'vitest'
import type { ProductionJob, ProductionJobStatus, ProductionRun, ProductionRunStatus } from '../../../electron/productionRun/productionRunTypes'
import { createGenerationNode } from '../generationCanvas/model/graphOps'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { eligibleGenerationNodeIds } from '../generationCanvas/components/canvasProductionScope'
import { canRunGenerationNode } from '../generationCanvas/runner/generationRunController'
import { useProductionCanvasLandingStore } from './productionCanvasLandingStore'
import { isNodeProductionShotInFlight } from './productionShotOwnership'

// 2026-09-25：Agent 起草并确认的镜头在制作流程里排队时，节点自身状态仍是 idle，
// 底栏「生成全部」照样把它算进去、单节点生成按钮也还能点——再发一次就是重复生成、重复扣费。

const NOW = '2026-09-25T00:00:00.000Z'
const NODE_ID = 'shot-node'

function job(status: ProductionJobStatus, extra: Partial<ProductionJob> = {}): ProductionJob {
  return {
    jobId: 'job-1', stageId: 'generate', status, attempt: 1, provider: 'apimart', model: 'image',
    idempotencyKey: 'k-1', metadata: {}, createdAt: NOW, updatedAt: NOW, ...extra,
  }
}

function singleShotRun(status: ProductionRunStatus, jobs: ProductionJob[] = []): ProductionRun {
  const candidate = { candidateId: 'cand-1', revision: 1, moduleId: 'm', providerId: 'apimart', modelId: 'image', mode: 't2i', prompt: '', parameters: {}, references: [] }
  return {
    schemaVersion: 1, runId: 'run-1', projectId: 'proj-1', revision: 1, status, stageId: 'generate',
    playbook: { name: 'generation.single-shot', version: '1.0.0' }, origin: { host: 'semantic-mcp' },
    policy: { trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 1, minimizeUploads: true },
    budget: { currency: 'CNY', authorized: 100, reserved: 0, actual: 0, unsettled: 0, unknownInFlight: 0 },
    planVersion: 1, snapshotCursor: 0, stages: [], gates: [], jobs, artifacts: [],
    generationPlan: { operationId: 'run-1', state: 'submitted', candidate, nodeId: NODE_ID, updatedAt: NOW },
    createdAt: NOW, updatedAt: NOW,
  } as ProductionRun
}

function shotNode(runId: string | null = 'run-1'): GenerationCanvasNode {
  return { ...createGenerationNode({ id: NODE_ID, kind: 'image' }), status: 'idle', categoryId: 'shots', meta: runId ? { productionRunId: runId } : {} }
}

afterEach(() => {
  useProductionCanvasLandingStore.setState({ projectId: null, runs: {} })
})

describe('isNodeProductionShotInFlight — 只有排队 / 生成中算「归制作流程生成」', () => {
  it.each([
    ['排队中（已派发、还没开跑）', singleShotRun('running'), true],
    ['生成中', singleShotRun('running', [job('polling', { providerTaskId: 't-1' })]), true],
    ['已停（整批暂停）', singleShotRun('paused'), false],
    ['已完成', singleShotRun('running', [job('ready')]), false],
  ])('%s', (_label, run, expected) => {
    expect(isNodeProductionShotInFlight(shotNode(), { 'run-1': run })).toBe(expected)
  })

  it('不属任何制作 Run、或 Run 不在缓存里 → 不算', () => {
    expect(isNodeProductionShotInFlight(shotNode(null), { 'run-1': singleShotRun('running') })).toBe(false)
    expect(isNodeProductionShotInFlight(shotNode('run-missing'), { 'run-1': singleShotRun('running') })).toBe(false)
  })
})

describe('画布的两个生成入口都认这一个判据', () => {
  it('「生成全部」不算排队中的制作镜头，已停的照常算', () => {
    const nodes = [shotNode()]
    expect(eligibleGenerationNodeIds(nodes, {}, { 'run-1': singleShotRun('running') })).toEqual([])
    expect(eligibleGenerationNodeIds(nodes, {}, { 'run-1': singleShotRun('paused') })).toEqual([NODE_ID])
  })

  it('单节点生成：制作流程在跑这一镜时不可生成', () => {
    const node = { ...shotNode(), meta: { productionRunId: 'run-1' } }
    useProductionCanvasLandingStore.setState({ projectId: 'proj-1', runs: { 'run-1': singleShotRun('running') } })
    expect(canRunGenerationNode(node, { nodes: [node], edges: [] })).toBe(false)
    useProductionCanvasLandingStore.setState({ projectId: 'proj-1', runs: { 'run-1': singleShotRun('paused') } })
    expect(canRunGenerationNode(node, { nodes: [node], edges: [] })).toBe(true)
  })
})
