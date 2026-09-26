import { describe, expect, it } from 'vitest'

import {
  deriveProductionShotState,
  isProductionJobInFlight,
  productionJobPhase,
  productionShotIdForNode,
  productionShotOwnsGeneration,
} from './productionShotPhase'
import type { ProductionJob, ProductionJobStatus, ProductionRun, ProductionRunStatus } from '../productionRun/productionRunTypes'

// 制作里「一镜在哪一段」的唯一判定：主进程的画布落地投影与渲染层的排队 / 已停小标读的是同一个函数。

const NOW = '2026-08-25T00:00:00.000Z'

function job(shotId: string, status: ProductionJobStatus, extra: Partial<ProductionJob> = {}): ProductionJob {
  return {
    jobId: `job-${shotId}`, stageId: 'generate', status, attempt: 1, provider: 'apimart', model: 'video',
    idempotencyKey: `k-${shotId}`, metadata: { shotId }, createdAt: NOW, updatedAt: NOW, ...extra,
  }
}

function run(opts: {
  status?: ProductionRunStatus
  shots?: Array<{ shotId: string; role?: 'anchor' | 'shot'; nodeId?: string; included?: boolean }>
  jobs?: ProductionJob[]
}): ProductionRun {
  const candidate = { candidateId: 'cand-1', revision: 1, moduleId: 'm', providerId: 'apimart', modelId: 'video', mode: 't2v', prompt: '', parameters: {}, references: [] }
  return {
    schemaVersion: 1, runId: 'run-1', projectId: 'proj-1', revision: 1, status: opts.status ?? 'running', stageId: 'generate',
    playbook: { name: 'generation.single-shot', version: '1.0.0' }, origin: { host: 'semantic-mcp' },
    policy: { trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 1, minimizeUploads: true },
    budget: { currency: 'CNY', authorized: 100, reserved: 0, actual: 0, unsettled: 0, unknownInFlight: 0 },
    planVersion: 1, snapshotCursor: 0, stages: [], gates: [], jobs: opts.jobs ?? [], artifacts: [],
    generationPlan: {
      operationId: 'run-1', state: 'submitted', candidate, nodeId: opts.shots ? undefined : 'single-node',
      ...(opts.shots ? { shots: opts.shots.map((shot) => ({
        shotId: shot.shotId, ...(shot.role ? { role: shot.role } : {}), ...(shot.included !== undefined ? { included: shot.included } : {}),
        ...(shot.nodeId ? { nodeId: shot.nodeId } : {}), candidate: { ...candidate, candidateId: shot.shotId }, updatedAt: NOW,
      })) } : {}),
      updatedAt: NOW,
    },
    createdAt: NOW, updatedAt: NOW,
  }
}

const phaseOf = (r: ProductionRun, shotId: string) => {
  const state = deriveProductionShotState(r, shotId)
  if (!state) return null
  const { job: _job, ...rest } = state
  return rest
}

describe('deriveProductionShotState', () => {
  it('没 job 的本批镜 → 排队中（第 n/N），不是假「生成中」', () => {
    const r = run({ shots: [{ shotId: 's1' }, { shotId: 's2' }] })
    expect(phaseOf(r, 's1')).toEqual({ phase: 'queued', queueIndex: 1, queueTotal: 2 })
    expect(phaseOf(r, 's2')).toEqual({ phase: 'queued', queueIndex: 2, queueTotal: 2 })
  })

  it('受理 / 轮询中 → 生成中；ready/adopted → 完成', () => {
    expect(phaseOf(run({ shots: [{ shotId: 's1' }], jobs: [job('s1', 'polling')] }), 's1')).toEqual({ phase: 'generating' })
    expect(phaseOf(run({ shots: [{ shotId: 's1' }], jobs: [job('s1', 'adopted')] }), 's1')).toEqual({ phase: 'done' })
  })

  it('预算 / 急停错因 → 已停（可续拍）；供应商拒 → 失败（带原因）', () => {
    expect(phaseOf(run({ shots: [{ shotId: 's1' }], jobs: [job('s1', 'needs_attention', { errorCode: 'budget_exhausted' })] }), 's1'))
      .toEqual({ phase: 'stopped', stoppedReason: 'budget' })
    expect(phaseOf(run({ shots: [{ shotId: 's1' }], jobs: [job('s1', 'cancelled_remote')] }), 's1'))
      .toEqual({ phase: 'stopped', stoppedReason: 'stopped' })
    expect(phaseOf(run({ shots: [{ shotId: 's1' }], jobs: [job('s1', 'needs_attention', { errorCode: 'provider_task_failed', errorMessage: '内容被拦截' })] }), 's1'))
      .toEqual({ phase: 'failed', failureMessage: '内容被拦截' })
  })

  it('Run 整体停了：没派发的镜 → 已停（预算 halt / 手动急停分开说）', () => {
    expect(phaseOf(run({ status: 'needs_attention', shots: [{ shotId: 's1' }] }), 's1')).toEqual({ phase: 'stopped', stoppedReason: 'budget' })
    expect(phaseOf(run({ status: 'paused', shots: [{ shotId: 's1' }] }), 's1')).toEqual({ phase: 'stopped', stoppedReason: 'stopped' })
  })

  it('返工：同一镜多个 attempt 取最新那一次', () => {
    const old = job('s1', 'needs_attention', { jobId: 'job-s1-a1', errorCode: 'provider_task_failed', createdAt: '2026-08-25T00:00:00.000Z' })
    const fresh = job('s1', 'polling', { jobId: 'job-s1-a2', createdAt: '2026-08-25T00:10:00.000Z' })
    const state = deriveProductionShotState(run({ shots: [{ shotId: 's1' }], jobs: [old, fresh] }), 's1')
    expect(state?.phase).toBe('generating')
    expect(state?.job?.jobId).toBe('job-s1-a2')
  })

  it('锚卡排队不占镜号；只有参考卡的批次按参考卡计序（不出「1/0」）', () => {
    const r = run({ shots: [{ shotId: 'a1', role: 'anchor' }, { shotId: 's1' }] })
    expect(phaseOf(r, 'a1')).toEqual({ phase: 'queued' })
    expect(phaseOf(r, 's1')).toEqual({ phase: 'queued', queueIndex: 1, queueTotal: 1 })
  })

  it('不在本次付费范围、又从没派发过的镜不在任何队列里 → null（不再挂一句永远不兑现的「排队中」）', () => {
    const r = run({ shots: [{ shotId: 's1' }, { shotId: 's2', included: false }], jobs: [job('s1', 'ready')] })
    expect(deriveProductionShotState(r, 's2')).toBeNull()
  })

  it('单镜计划（没有 shots[]）：唯一那一镜的身份是候选 id，生成段的每个 job 都属于它', () => {
    const r = run({ jobs: [job('whatever', 'polling', { metadata: {} })] })
    expect(phaseOf(r, 'cand-1')).toEqual({ phase: 'generating' })
    expect(deriveProductionShotState(r, 'other')).toBeNull()
    expect(productionShotIdForNode(r, 'single-node')).toBe('cand-1')
  })

  it('找不到这一镜 / 没有 Run → null', () => {
    expect(deriveProductionShotState(null, 's1')).toBeNull()
    expect(deriveProductionShotState(run({ shots: [{ shotId: 's1' }] }), 'nope')).toBeNull()
  })
})

describe('productionJobPhase is exhaustive over ProductionJobStatus', () => {
  it('每一个 job 状态都有归属（新增状态不给归属 = 编译不过；这里钉住现有映射）', () => {
    const expected: Record<ProductionJobStatus, ReturnType<typeof productionJobPhase>> = {
      planned: null, authorization_required: null, authorized: null, submit_intent_persisted: null,
      submitting: 'generating', provider_accepted: 'generating', polling: 'generating', retry_wait: 'generating',
      downloading: 'generating', validating_technical: 'generating', validating_content: 'generating',
      ready: 'done', adopted: 'done',
      submission_unknown: null, reconciling: null, cancel_requested: null, detached: null,
      needs_attention: 'failed', cancelled_remote: 'failed', too_late: 'failed',
    }
    for (const [status, phase] of Object.entries(expected)) expect(productionJobPhase(status as ProductionJobStatus), status).toBe(phase)
  })

  it('「还在等供应商」= 有供应商任务号且在生成段', () => {
    expect(isProductionJobInFlight({ status: 'polling', providerTaskId: 't' })).toBe(true)
    expect(isProductionJobInFlight({ status: 'polling' })).toBe(false)
    expect(isProductionJobInFlight({ status: 'ready', providerTaskId: 't' })).toBe(false)
  })
})

describe('productionShotOwnsGeneration — 画布能不能再发这一镜', () => {
  it('报价卡等确认：付费范围里的镜归制作流程，不在范围里的不归', () => {
    const r = run({ status: 'awaiting_contract', shots: [{ shotId: 's1', nodeId: 'n1' }, { shotId: 's2', nodeId: 'n2', included: false }] })
    r.generationPlan!.state = 'sealed'
    expect(productionShotOwnsGeneration(r, 's1')).toBe(true)
    expect(productionShotOwnsGeneration(r, 's2')).toBe(false)
  })

  it('已确认：排队的镜归制作流程，已停的不归', () => {
    const shots = [{ shotId: 's1', nodeId: 'n1' }]
    expect(productionShotOwnsGeneration(run({ status: 'running', shots }), 's1')).toBe(true)
    expect(productionShotOwnsGeneration(run({ status: 'paused', shots }), 's1')).toBe(false)
  })
})
