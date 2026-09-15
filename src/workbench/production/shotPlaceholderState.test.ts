import { describe, expect, it } from 'vitest'

import { deriveShotPlaceholderState, deriveBatchProgress } from './shotPlaceholderState'
import type { ProductionRun, ProductionJob, ProductionJobStatus, ProductionRunStatus } from '../../../electron/productionRun/productionRunTypes'

const NOW = '2026-08-25T00:00:00.000Z'

function job(shotId: string, nodeId: string, status: ProductionJobStatus, extra: Partial<ProductionJob> = {}): ProductionJob {
  return {
    jobId: `job-${shotId}`,
    stageId: 'generate',
    status,
    attempt: 1,
    provider: 'apimart',
    model: 'video',
    idempotencyKey: `k-${shotId}`,
    nodeId,
    metadata: { shotId },
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  }
}

function run(opts: {
  status?: ProductionRunStatus
  shots: Array<{ shotId: string; role?: 'anchor' | 'shot'; nodeId?: string; included?: boolean }>
  jobs?: ProductionJob[]
}): ProductionRun {
  return {
    schemaVersion: 1,
    runId: 'run-1',
    projectId: 'proj-1',
    revision: 1,
    status: opts.status ?? 'running',
    stageId: 'generate',
    playbook: { name: 'generation.single-shot', version: '1.0.0' },
    origin: { host: 'semantic-mcp' },
    policy: { trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 1, minimizeUploads: true },
    budget: { currency: 'CNY', authorized: 100, reserved: 0, actual: 0, unsettled: 0 },
    planVersion: 1,
    snapshotCursor: 0,
    stages: [],
    gates: [],
    jobs: opts.jobs ?? [],
    artifacts: [],
    generationPlan: {
      operationId: 'run-1',
      state: 'submitted',
      candidate: { candidateId: 'c', revision: 1, moduleId: 'm', providerId: 'apimart', modelId: 'video', mode: 't2v', prompt: '', parameters: {}, references: [] },
      shots: opts.shots.map((shot) => ({
        shotId: shot.shotId,
        ...(shot.role ? { role: shot.role } : {}),
        ...(shot.included !== undefined ? { included: shot.included } : {}),
        ...(shot.nodeId ? { nodeId: shot.nodeId } : {}),
        candidate: { candidateId: shot.shotId, revision: 1, moduleId: 'm', providerId: 'apimart', modelId: 'video', mode: 't2v', prompt: '', parameters: {}, references: [] },
        updatedAt: NOW,
      })),
      updatedAt: NOW,
    },
    createdAt: NOW,
    updatedAt: NOW,
  }
}

describe('deriveShotPlaceholderState', () => {
  it('无对应 job 的镜显「排队中（第 n/N）」，不伪造生成中', () => {
    const r = run({ shots: [{ shotId: 's1', nodeId: 'n1' }, { shotId: 's2', nodeId: 'n2' }] })
    expect(deriveShotPlaceholderState(r, 'n1')).toEqual({ phase: 'queued', queueIndex: 1, queueTotal: 2 })
    expect(deriveShotPlaceholderState(r, 'n2')).toEqual({ phase: 'queued', queueIndex: 2, queueTotal: 2 })
  })

  it('job 在飞（polling 等）→ 生成中', () => {
    const r = run({ shots: [{ shotId: 's1', nodeId: 'n1' }], jobs: [job('s1', 'n1', 'polling')] })
    expect(deriveShotPlaceholderState(r, 'n1')).toEqual({ phase: 'generating' })
  })

  it('job ready → done（占位退场）', () => {
    const r = run({ shots: [{ shotId: 's1', nodeId: 'n1' }], jobs: [job('s1', 'n1', 'ready')] })
    expect(deriveShotPlaceholderState(r, 'n1')).toEqual({ phase: 'done' })
  })

  it('run 预算 halt（needs_attention）→ 未派发镜显「已停·预算」warning 非 danger', () => {
    const r = run({ status: 'needs_attention', shots: [{ shotId: 's1', nodeId: 'n1' }] })
    expect(deriveShotPlaceholderState(r, 'n1')).toEqual({ phase: 'stopped', stoppedReason: 'budget' })
  })

  it('run 急停（paused）→ 显「已停·急停」', () => {
    const r = run({ status: 'paused', shots: [{ shotId: 's1', nodeId: 'n1' }] })
    expect(deriveShotPlaceholderState(r, 'n1')).toEqual({ phase: 'stopped', stoppedReason: 'stopped' })
  })

  it('job needs_attention 带供应商错因 → 失败态（danger，非已停）', () => {
    const r = run({ shots: [{ shotId: 's1', nodeId: 'n1' }], jobs: [job('s1', 'n1', 'needs_attention', { errorCode: 'provider_rejected', errorMessage: '内容被拦截' })] })
    expect(deriveShotPlaceholderState(r, 'n1')).toEqual({ phase: 'failed', failureMessage: '内容被拦截' })
  })

  it('job needs_attention 带预算错因（budget_exhausted）→ 已停·预算（即使 run 仍 running）', () => {
    const r = run({ status: 'running', shots: [{ shotId: 's1', nodeId: 'n1' }], jobs: [job('s1', 'n1', 'needs_attention', { errorCode: 'budget_exhausted' })] })
    expect(deriveShotPlaceholderState(r, 'n1')).toEqual({ phase: 'stopped', stoppedReason: 'budget' })
  })

  it('job too_late（批被停到达这镜）→ 已停·急停（非失败）', () => {
    const r = run({ status: 'running', shots: [{ shotId: 's1', nodeId: 'n1' }], jobs: [job('s1', 'n1', 'too_late')] })
    expect(deriveShotPlaceholderState(r, 'n1')).toEqual({ phase: 'stopped', stoppedReason: 'stopped' })
  })

  it('anchor 节点显纯「排队中」（不进视频序列的 n/N）', () => {
    const r = run({ shots: [{ shotId: 'a1', role: 'anchor', nodeId: 'na' }, { shotId: 's1', nodeId: 'n1' }] })
    expect(deriveShotPlaceholderState(r, 'na')).toEqual({ phase: 'queued' })
  })

  it('未知 nodeId / null run → null', () => {
    expect(deriveShotPlaceholderState(null, 'n1')).toBeNull()
    const r = run({ shots: [{ shotId: 's1', nodeId: 'n1' }] })
    expect(deriveShotPlaceholderState(r, 'nope')).toEqual({ phase: 'queued' }) // 有 run 但节点没绑镜 → 兜底排队
  })
})

describe('deriveBatchProgress', () => {
  it('只统计视频镜（不含 anchor）的完成数/总数', () => {
    const r = run({
      shots: [{ shotId: 'a1', role: 'anchor', nodeId: 'na' }, { shotId: 's1', nodeId: 'n1' }, { shotId: 's2', nodeId: 'n2' }],
      jobs: [job('s1', 'n1', 'ready'), job('s2', 'n2', 'polling')],
    })
    expect(deriveBatchProgress(r)).toEqual({ completed: 1, total: 2 })
  })

  it('无多镜 plan → null', () => {
    expect(deriveBatchProgress(null)).toBeNull()
  })
})
