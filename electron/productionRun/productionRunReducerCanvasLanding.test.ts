import { describe, expect, it } from 'vitest'

import { applyProductionCommand } from './productionRunReducer'
import type { ProductionRun, ProductionJob, ProductionGenerationShot } from './productionRunTypes'

// P4 S5 — plan.bind-shot-nodes / plan.detach-shot-nodes 的 reducer 契约（确认即落 / 打开项目补齐 / 整批撤销）。

const NOW = '2026-08-25T00:00:00.000Z'

function shot(shotId: string, extra: Partial<ProductionGenerationShot> = {}): ProductionGenerationShot {
  return {
    shotId,
    candidate: { candidateId: shotId, revision: 1, moduleId: 'm', providerId: 'apimart', modelId: 'video', mode: 't2v', prompt: '', parameters: {}, references: [] },
    updatedAt: NOW,
    ...extra,
  }
}

function job(shotId: string, extra: Partial<ProductionJob> = {}): ProductionJob {
  return {
    jobId: `job-${shotId}`, stageId: 'generate', status: 'authorized', attempt: 1, provider: 'apimart', model: 'video',
    idempotencyKey: `k-${shotId}`, metadata: { shotId }, createdAt: NOW, updatedAt: NOW, ...extra,
  }
}

function runWith(shots: ProductionGenerationShot[], jobs: ProductionJob[] = []): ProductionRun {
  return {
    schemaVersion: 1, runId: 'run-1', projectId: 'proj-1', revision: 1, status: 'running', stageId: 'generate',
    playbook: { name: 'generation.single-shot', version: '1.0.0' }, origin: { host: 'semantic-mcp' },
    policy: { mode: 'balanced', trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 1, minimizeUploads: true },
    budget: { currency: 'CNY', authorized: 100, reserved: 0, actual: 0, unsettled: 0 }, planVersion: 1, snapshotCursor: 0,
    stages: [], gates: [], jobs, artifacts: [],
    generationPlan: {
      operationId: 'run-1', state: 'submitted',
      candidate: shots[0].candidate, shots, updatedAt: NOW,
    },
    createdAt: NOW, updatedAt: NOW,
  }
}

describe('plan.bind-shot-nodes', () => {
  it('把 shotId→nodeId 写进对应镜，并给已存在的同 shotId job 继承 nodeId', () => {
    const run = runWith([shot('s1'), shot('s2')], [job('s1')])
    const effect = applyProductionCommand(run, {
      commandId: 'bind-1', expectedRevision: 1, type: 'plan.bind-shot-nodes',
      payload: { bindings: [{ shotId: 's1', nodeId: 'node-1' }, { shotId: 's2', nodeId: 'node-2' }] }, issuedAt: NOW,
    }, NOW)
    expect(effect.run.generationPlan?.shots?.find((s) => s.shotId === 's1')?.nodeId).toBe('node-1')
    expect(effect.run.generationPlan?.shots?.find((s) => s.shotId === 's2')?.nodeId).toBe('node-2')
    // 已建 job（s1）继承 nodeId；s2 还没 job → 不造 job（只写 shot）。
    expect(effect.run.jobs.find((j) => j.jobId === 'job-s1')?.nodeId).toBe('node-1')
    expect(effect.run.jobs).toHaveLength(1)
  })

  it('重复绑同一 nodeId 幂等（无变化 → 事件仍发但 run 无实质改动）', () => {
    const run = runWith([shot('s1', { nodeId: 'node-1' })])
    const effect = applyProductionCommand(run, {
      commandId: 'bind-again', expectedRevision: 1, type: 'plan.bind-shot-nodes',
      payload: { bindings: [{ shotId: 's1', nodeId: 'node-1' }] }, issuedAt: NOW,
    }, NOW)
    expect(effect.run.generationPlan?.shots?.[0].nodeId).toBe('node-1')
  })

  it('绑定清掉 canvasDetached（删过又补建=新节点，重新出现）', () => {
    const run = runWith([shot('s1', { canvasDetached: true })])
    const effect = applyProductionCommand(run, {
      commandId: 'rebind', expectedRevision: 1, type: 'plan.bind-shot-nodes',
      payload: { bindings: [{ shotId: 's1', nodeId: 'node-new' }] }, issuedAt: NOW,
    }, NOW)
    const s1 = effect.run.generationPlan?.shots?.[0]
    expect(s1?.nodeId).toBe('node-new')
    expect(s1?.canvasDetached).toBeUndefined()
  })

  it('单镜计划用 candidateId 绑定顶层 nodeId，并让已有 job 继承', () => {
    const single = runWith([shot('cat')], [
      { ...job('cat'), metadata: undefined },
    ])
    single.generationPlan = { ...single.generationPlan!, shots: undefined }
    const effect = applyProductionCommand(single, {
      commandId: 'bind-single', expectedRevision: 1, type: 'plan.bind-shot-nodes',
      payload: { bindings: [{ shotId: 'cat', nodeId: 'node-cat' }] }, issuedAt: NOW,
    }, NOW)
    expect(effect.run.generationPlan?.nodeId).toBe('node-cat')
    expect(effect.run.jobs[0]?.nodeId).toBe('node-cat')
  })
})

describe('plan.detach-shot-nodes', () => {
  it('标 canvasDetached + 清 shot/job 的 nodeId（撤销事实优先，恢复不复活）', () => {
    const run = runWith([shot('s1', { nodeId: 'node-1' })], [job('s1', { nodeId: 'node-1' })])
    const effect = applyProductionCommand(run, {
      commandId: 'detach-1', expectedRevision: 1, type: 'plan.detach-shot-nodes',
      payload: { nodeIds: ['node-1'] }, issuedAt: NOW,
    }, NOW)
    const s1 = effect.run.generationPlan?.shots?.[0]
    expect(s1?.nodeId).toBeUndefined()
    expect(s1?.canvasDetached).toBe(true)
    expect(effect.run.jobs[0].nodeId).toBeUndefined()
  })

  it('detach 不动 job 的生成状态（产物照进素材库+Run，只是画布占位没了）', () => {
    const run = runWith([shot('s1', { nodeId: 'node-1' })], [job('s1', { nodeId: 'node-1', status: 'ready' })])
    const effect = applyProductionCommand(run, {
      commandId: 'detach-ready', expectedRevision: 1, type: 'plan.detach-shot-nodes',
      payload: { nodeIds: ['node-1'] }, issuedAt: NOW,
    }, NOW)
    expect(effect.run.jobs[0].status).toBe('ready')
    expect(effect.run.jobs[0].nodeId).toBeUndefined()
  })

  it('detach 与不相关 nodeId → 无变化', () => {
    const run = runWith([shot('s1', { nodeId: 'node-1' })])
    const effect = applyProductionCommand(run, {
      commandId: 'detach-none', expectedRevision: 1, type: 'plan.detach-shot-nodes',
      payload: { nodeIds: ['node-other'] }, issuedAt: NOW,
    }, NOW)
    expect(effect.run.generationPlan?.shots?.[0].nodeId).toBe('node-1')
    expect(effect.run.generationPlan?.shots?.[0].canvasDetached).toBeUndefined()
  })

  it('单镜节点删除记录 canvasDetached，恢复不会静默复活', () => {
    const single = runWith([shot('cat')], [{ ...job('cat'), metadata: undefined, nodeId: 'node-cat' }])
    single.generationPlan = { ...single.generationPlan!, shots: undefined, nodeId: 'node-cat' }
    const effect = applyProductionCommand(single, {
      commandId: 'detach-single', expectedRevision: 1, type: 'plan.detach-shot-nodes',
      payload: { nodeIds: ['node-cat'] }, issuedAt: NOW,
    }, NOW)
    expect(effect.run.generationPlan?.nodeId).toBeUndefined()
    expect(effect.run.generationPlan?.canvasDetached).toBe(true)
    expect(effect.run.jobs[0]?.nodeId).toBeUndefined()
  })
})
