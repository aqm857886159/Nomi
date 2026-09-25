import { describe, expect, it } from 'vitest'

import {
  deriveProductionShotState,
  isProductionJobInFlight,
  isShotInDispatchedScope,
  jobAwaitsHuman,
  productionJobPhase,
  productionShotIdForNode,
  productionShotOwnsGeneration,
} from './productionShotPhase'
import type { ProductionGenerationPlan, ProductionJob, ProductionJobStatus, ProductionRun, ProductionRunStatus } from '../productionRun/productionRunTypes'

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
  planState?: ProductionGenerationPlan['state']
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
      operationId: 'run-1', state: opts.planState ?? 'submitted', candidate, nodeId: opts.shots ? undefined : 'single-node',
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

// 2026-09-24 真模型走查：Agent 按「先别生成」只调 draft_shots，节点却挂「排队中 · 第 1/1」、任务按钮亮 1
//（那一刻 0 job、0 请求）。用户还没点头的每一种状态都不许说「排队中」，也不许说「已停」再给一颗续拍钮。
describe('deriveProductionShotState · 用户还没点头', () => {
  const PRE_DISPATCH_RUN_STATUSES: ProductionRunStatus[] = [
    'draft', 'awaiting_direction', 'awaiting_script_review', 'awaiting_storyboard_review', 'awaiting_contract', 'ready',
  ]
  const shots = [{ shotId: 'a1', role: 'anchor' as const }, { shotId: 's1' }]

  it('draft_shots 建的草稿（Run draft、计划 draft、0 个 job）→ null（报告里那一幕，单镜与多镜都一样）', () => {
    expect(deriveProductionShotState(run({ status: 'draft', planState: 'draft', shots: [{ shotId: 'shot-1' }] }), 'shot-1')).toBeNull()
    expect(deriveProductionShotState(run({ status: 'draft', planState: 'draft' }), 'cand-1')).toBeNull()
  })

  for (const status of PRE_DISPATCH_RUN_STATUSES) {
    for (const planState of ['draft', 'sealed'] as const) {
      it(`Run ${status} + 计划 ${planState}、没有 job → 每一镜（含参考卡）都是 null`, () => {
        const r = run({ status, planState, shots })
        expect(deriveProductionShotState(r, 's1')).toBeNull()
        expect(deriveProductionShotState(r, 'a1')).toBeNull()
      })
    }
    it(`Run ${status} + 最新的 job 停在人工门前（authorization_required / planned）→ null`, () => {
      for (const jobStatus of ['authorization_required', 'planned'] as const) {
        const r = run({ status, planState: 'sealed', shots, jobs: [job('s1', jobStatus)] })
        expect(deriveProductionShotState(r, 's1'), jobStatus).toBeNull()
      }
    })
  }

  // 注意不是「逐镜确认档」：那一档等人时 job 仍是 authorized、等的是另一道镜头门（productionRunDriverOps），这里管不到，
  // 见根因合同 residual_risks。这里是已提交批次里返工 / 续拍的新 job 退回授权前（productionGenerationAuthorizationState）。
  it('批次在跑，这一镜的新 job 退回人工门前（返工 / 续拍待授权）→ null，不说「排队中」', () => {
    expect(deriveProductionShotState(run({ status: 'running', shots, jobs: [job('s1', 'authorization_required')] }), 's1')).toBeNull()
  })

  it('没点过头就被取消的草稿 → null，不显「已停」也不给续拍钮', () => {
    expect(deriveProductionShotState(run({ status: 'cancelled', planState: 'cancelled', shots }), 's1')).toBeNull()
  })

  it('点过头之后照旧：计划已提交、还没 job → 排队中；job 过了人工门还没提交（authorized）→ 排队中', () => {
    expect(phaseOf(run({ shots: [{ shotId: 's1' }] }), 's1')).toEqual({ phase: 'queued', queueIndex: 1, queueTotal: 1 })
    expect(phaseOf(run({ shots: [{ shotId: 's1' }], jobs: [job('s1', 'authorized')] }), 's1')).toEqual({ phase: 'queued', queueIndex: 1, queueTotal: 1 })
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

describe('派出去了没有', () => {
  it('只有 planned / authorization_required 还停在人工门前', () => {
    const all = Object.keys({
      planned: 1, authorization_required: 1, authorized: 1, submit_intent_persisted: 1, submitting: 1, provider_accepted: 1,
      polling: 1, retry_wait: 1, downloading: 1, validating_technical: 1, validating_content: 1, ready: 1, adopted: 1,
      submission_unknown: 1, reconciling: 1, needs_attention: 1, cancel_requested: 1, cancelled_remote: 1, detached: 1, too_late: 1,
    } satisfies Record<ProductionJobStatus, 1>) as ProductionJobStatus[]
    expect(all.filter(jobAwaitsHuman)).toEqual(['planned', 'authorization_required'])
  })

  it('计划没提交：任何镜都不在已派出的范围里；提交后勾进的在、勾掉的不在；单镜提交了就在', () => {
    for (const planState of ['draft', 'sealed', 'cancelled'] as const) {
      expect(isShotInDispatchedScope(run({ planState, shots: [{ shotId: 's1' }] }), 's1'), planState).toBe(false)
    }
    const submitted = run({ shots: [{ shotId: 's1' }, { shotId: 's2', included: false }] })
    expect(isShotInDispatchedScope(submitted, 's1')).toBe(true)
    expect(isShotInDispatchedScope(submitted, 's2')).toBe(false)
    expect(isShotInDispatchedScope(run({}), 'cand-1')).toBe(true)
    expect(isShotInDispatchedScope(run({ planState: 'draft' }), 'cand-1')).toBe(false)
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
