import { describe, expect, it } from 'vitest'

import {
  deriveProductionShotState,
  isProductionJobInFlight,
  jobAwaitsHuman,
  productionJobPhase,
  productionShotIdForNode,
} from './productionShotPhase'
import { decideShotClaim } from './decideShotClaim'
import { applyProductionCommand } from '../productionRun/productionRunReducer'
import type { ProductionGenerationPlan, ProductionJob, ProductionJobStatus, ProductionRun, ProductionRunStatus, ProductionRunStopReason } from '../productionRun/productionRunTypes'

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
  /** 停下的那一刻记下的原因（reducer 写的 run.stop）；不给 = 上一版留下的、没记原因的 Run。 */
  stop?: ProductionRunStopReason
  planState?: ProductionGenerationPlan['state']
  /** 起草了、还没摆给用户（桌面 lane 的 draft_shots）。 */
  cardHidden?: boolean
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
      // 草稿摆到卡上 = 一次开着的出价（付费卡逐镜：`plan.presentations`）；`cardHidden` 的草稿还没摆给用户。
      ...((opts.planState ?? 'submitted') === 'draft' && !opts.cardHidden
        ? { presentations: [{ shotIds: opts.shots ? opts.shots.filter((shot) => shot.included !== false).map((shot) => shot.shotId) : ['cand-1'], openedAt: NOW, fromGate: 0 }] }
        : {}),
      ...(opts.shots ? { shots: opts.shots.map((shot) => ({
        shotId: shot.shotId, ...(shot.role ? { role: shot.role } : {}), ...(shot.included !== undefined ? { included: shot.included } : {}),
        ...(shot.nodeId ? { nodeId: shot.nodeId } : {}), candidate: { ...candidate, candidateId: shot.shotId }, updatedAt: NOW,
      })) } : {}),
      updatedAt: NOW,
    },
    ...(opts.stop ? { stop: { reason: opts.stop, at: NOW } } : {}),
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
  it('批过、还没派出去的镜 → 排队中（第 n/N），不是假「生成中」', () => {
    const r = run({ shots: [{ shotId: 's1' }, { shotId: 's2' }], jobs: [job('s1', 'authorized'), job('s2', 'authorized')] })
    expect(phaseOf(r, 's1')).toEqual({ phase: 'queued', queueIndex: 1, queueTotal: 2 })
    expect(phaseOf(r, 's2')).toEqual({ phase: 'queued', queueIndex: 2, queueTotal: 2 })
  })

  it('没点就不叫排队中：一次任务都没有的镜从没被批过 → 还没生成，也不占排队的分母', () => {
    const r = run({ shots: [{ shotId: 's1' }, { shotId: 's2' }], jobs: [job('s1', 'authorized')] })
    expect(phaseOf(r, 's1')).toEqual({ phase: 'queued', queueIndex: 1, queueTotal: 1 })
    expect(phaseOf(r, 's2')).toEqual({ phase: 'not_generated' })
  })

  it('受理 / 轮询中 → 生成中；ready/adopted → 完成', () => {
    expect(phaseOf(run({ shots: [{ shotId: 's1' }], jobs: [job('s1', 'polling')] }), 's1')).toEqual({ phase: 'generating' })
    expect(phaseOf(run({ shots: [{ shotId: 's1' }], jobs: [job('s1', 'adopted')] }), 's1')).toEqual({ phase: 'done' })
  })

  it('批被停 / 取消时到达这一镜 → 已停，原因照 Run 记下的说；供应商拒 → 失败（带原因）', () => {
    expect(phaseOf(run({ status: 'paused', stop: 'user_paused', shots: [{ shotId: 's1' }], jobs: [job('s1', 'cancelled_remote')] }), 's1'))
      .toEqual({ phase: 'stopped', stoppedReason: 'user_paused' })
    expect(phaseOf(run({ status: 'needs_attention', stop: 'consent_expired', shots: [{ shotId: 's1' }], jobs: [job('s1', 'needs_attention')] }), 's1'))
      .toEqual({ phase: 'stopped', stoppedReason: 'consent_expired' })
    expect(phaseOf(run({ shots: [{ shotId: 's1' }], jobs: [job('s1', 'needs_attention', { errorCode: 'provider_task_failed', errorMessage: '内容被拦截' })] }), 's1'))
      .toEqual({ phase: 'failed', failureMessage: '内容被拦截' })
    // 错因码不再决定「为什么停」：以前 budget_exhausted / restart_recovery_required 这类码会被说成「预算已用完」。
    expect(phaseOf(run({ shots: [{ shotId: 's1' }], jobs: [job('s1', 'needs_attention', { errorCode: 'budget_exhausted' })] }), 's1'))
      .toEqual({ phase: 'failed' })
  })

  it('Run 整体停了：批过、没派出去的镜 → 已停，原因只读停下那一刻记下的事实', () => {
    const idle = (status: ProductionRunStatus, stop?: ProductionRunStopReason) => phaseOf(run({ status, stop, shots: [{ shotId: 's1' }], jobs: [job('s1', 'authorized')] }), 's1')
    expect(idle('needs_attention', 'consent_expired')).toEqual({ phase: 'stopped', stoppedReason: 'consent_expired' })
    expect(idle('needs_attention', 'failed')).toEqual({ phase: 'stopped', stoppedReason: 'failed' })
    expect(idle('needs_attention', 'restart_recovery')).toEqual({ phase: 'stopped', stoppedReason: 'restart_recovery' })
    expect(idle('pausing', 'user_paused')).toEqual({ phase: 'stopped', stoppedReason: 'user_paused' })
    expect(idle('paused', 'user_paused')).toEqual({ phase: 'stopped', stoppedReason: 'user_paused' })
    expect(idle('cancelled', 'user_cancelled')).toEqual({ phase: 'stopped', stoppedReason: 'user_cancelled' })
    // 从没被批过的镜不是「被停下」的：它本来就不在这一批里，停不停都还没生成（不给它挂续拍钮）。
    expect(phaseOf(run({ status: 'needs_attention', stop: 'consent_expired', shots: [{ shotId: 's1' }] }), 's1')).toEqual({ phase: 'not_generated' })
  })

  it('上一版留下的、没记停下原因的 Run：说「停了」，绝不猜成预算', () => {
    // 这正是用户实见的那一格：needs_attention 以前一律被说成「预算已用完 · 提额续拍」，而那天根本没有价格。
    const authorized = [job('s1', 'authorized')]
    expect(phaseOf(run({ status: 'needs_attention', shots: [{ shotId: 's1' }], jobs: authorized }), 's1')).toEqual({ phase: 'stopped', stoppedReason: 'unknown' })
    expect(phaseOf(run({ status: 'paused', shots: [{ shotId: 's1' }], jobs: authorized }), 's1')).toEqual({ phase: 'stopped', stoppedReason: 'unknown' })
    expect(phaseOf(run({ status: 'running', shots: [{ shotId: 's1' }], jobs: authorized }), 's1')?.phase).toBe('queued')
  })

  it('批次停着时画布接手了这一镜（job 已脱离）→ null：节点上不再挂「已停 · 继续」', () => {
    const halted = run({ status: 'needs_attention', stop: 'consent_expired', shots: [{ shotId: 's1' }, { shotId: 's2' }, { shotId: 's3' }], jobs: [job('s1', 'ready'), job('s2', 'authorized'), job('s3', 'authorized')] })
    expect(phaseOf(halted, 's2')).toEqual({ phase: 'stopped', stoppedReason: 'consent_expired' })
    const claimed = applyProductionCommand(halted, {
      commandId: 'claim-s2', expectedRevision: halted.revision, type: 'shot.claim',
      payload: { shotId: 's2', by: 'canvas' }, issuedAt: NOW,
    }, NOW).run
    expect(claimed.jobs.find((candidate) => candidate.metadata?.shotId === 's2')).toMatchObject({ status: 'detached', errorCode: 'canvas_claimed' })
    // 画布接手的那一镜：制作不会再派它，按钮续的只会是别的镜头 → 不给它挂续拍入口。
    expect(deriveProductionShotState(claimed, 's2')).toBeNull()
    // 没被接手的那一镜照旧：已停，可以提额续拍。
    expect(phaseOf(claimed, 's3')).toEqual({ phase: 'stopped', stoppedReason: 'consent_expired' })
  })

  it('返工：同一镜多个 attempt 取最新那一次', () => {
    const old = job('s1', 'needs_attention', { jobId: 'job-s1-a1', attempt: 1, errorCode: 'provider_task_failed', createdAt: '2026-08-25T00:00:00.000Z' })
    const fresh = job('s1', 'polling', { jobId: 'job-s1-a2', attempt: 2, createdAt: '2026-08-24T00:00:00.000Z' })
    const state = deriveProductionShotState(run({ shots: [{ shotId: 's1' }], jobs: [old, fresh] }), 's1')
    expect(state?.phase).toBe('generating')
    expect(state?.job?.jobId).toBe('job-s1-a2')
  })

  it('锚卡排队不占镜号；只有参考卡的批次按参考卡计序（不出「1/0」）', () => {
    const r = run({ shots: [{ shotId: 'a1', role: 'anchor' }, { shotId: 's1' }], jobs: [job('a1', 'authorized'), job('s1', 'authorized')] })
    expect(phaseOf(r, 'a1')).toEqual({ phase: 'queued' })
    expect(phaseOf(r, 's1')).toEqual({ phase: 'queued', queueIndex: 1, queueTotal: 1 })
  })

  it('不在本次付费范围、又从没派发过的镜不在任何队列里 → 还没生成（不再挂一句永远不兑现的「排队中」）', () => {
    const r = run({ shots: [{ shotId: 's1' }, { shotId: 's2', included: false }], jobs: [job('s1', 'ready')] })
    expect(phaseOf(r, 's2')).toEqual({ phase: 'not_generated' })
  })

  it('被画布拿走的镜（删了节点 / 画布接手）不再占排队位次：分母与调度器的批次进度同一条规则', () => {
    const queued = run({ shots: [{ shotId: 's1' }, { shotId: 's2', nodeId: 'node-s2' }, { shotId: 's3' }], jobs: [job('s1', 'authorized'), job('s2', 'authorized', { nodeId: 'node-s2' }), job('s3', 'authorized')] })
    expect(phaseOf(queued, 's3')).toEqual({ phase: 'queued', queueIndex: 3, queueTotal: 3 })
    const deleted = applyProductionCommand(queued, {
      commandId: 'detach-s2', expectedRevision: queued.revision, type: 'plan.detach-shot-nodes', payload: { nodeIds: ['node-s2'] }, issuedAt: NOW,
    }, NOW).run
    expect(phaseOf(deleted, 's3')).toEqual({ phase: 'queued', queueIndex: 2, queueTotal: 2 })
    expect(phaseOf(deleted, 's1')).toEqual({ phase: 'queued', queueIndex: 1, queueTotal: 2 })
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
// 2026-09-30 起它们各有自己的段（以前一律 null，画布上什么都不画）：卡正摆着 → 等你确认；没人在问 → 还没生成。
describe('deriveProductionShotState · 用户还没点头', () => {
  const PRE_DISPATCH_RUN_STATUSES: ProductionRunStatus[] = [
    'draft', 'awaiting_direction', 'awaiting_script_review', 'awaiting_storyboard_review', 'awaiting_contract', 'ready',
  ]
  const shots = [{ shotId: 'a1', role: 'anchor' as const }, { shotId: 's1' }]

  it('draft_shots 建的草稿（Run draft、计划 draft、卡还没摆、0 个 job）→ 还没生成（报告里那一幕，单镜与多镜都一样）', () => {
    expect(phaseOf(run({ status: 'draft', planState: 'draft', cardHidden: true, shots: [{ shotId: 'shot-1' }] }), 'shot-1')).toEqual({ phase: 'not_generated' })
    expect(phaseOf(run({ status: 'draft', planState: 'draft', cardHidden: true }), 'cand-1')).toEqual({ phase: 'not_generated' })
  })

  it('草稿摆到卡上了（卡没藏）→ 等你确认；卡上没勾进这一批的镜 → 还没生成', () => {
    expect(phaseOf(run({ status: 'draft', planState: 'draft', shots: [{ shotId: 's1' }, { shotId: 's2', included: false }] }), 's1')).toEqual({ phase: 'awaiting_confirmation' })
    expect(phaseOf(run({ status: 'draft', planState: 'draft', shots: [{ shotId: 's1' }, { shotId: 's2', included: false }] }), 's2')).toEqual({ phase: 'not_generated' })
    expect(phaseOf(run({ status: 'draft', planState: 'draft' }), 'cand-1')).toEqual({ phase: 'awaiting_confirmation' })
  })

  for (const status of PRE_DISPATCH_RUN_STATUSES) {
    for (const planState of ['draft', 'sealed'] as const) {
      it(`Run ${status} + 计划 ${planState}、没有 job → 每一镜（含参考卡）都不说排队：草稿卡摆着 = 等你确认，否则 = 还没生成`, () => {
        const r = run({ status, planState, shots })
        const expected = planState === 'draft' ? 'awaiting_confirmation' : 'not_generated'
        expect(phaseOf(r, 's1')).toEqual({ phase: expected })
        expect(phaseOf(r, 'a1')).toEqual({ phase: expected })
      })
    }
    it(`Run ${status} + 最新的 job 停在人工门前（authorization_required / planned）→ 等你确认`, () => {
      for (const jobStatus of ['authorization_required', 'planned'] as const) {
        const r = run({ status, planState: 'sealed', shots, jobs: [job('s1', jobStatus)] })
        expect(phaseOf(r, 's1'), jobStatus).toEqual({ phase: 'awaiting_confirmation' })
      }
    })
  }

  // 注意不是「逐镜确认档」：那一档等人时 job 仍是 authorized、等的是另一道镜头门（productionRunDriverOps），这里管不到，
  // 见根因合同 residual_risks。这里是已提交批次里返工 / 续拍的新 job 退回授权前（productionGenerationAuthorizationState）。
  it('批次在跑，这一镜的新 job 退回人工门前（返工 / 续拍待授权）→ 等你确认，不说「排队中」', () => {
    expect(phaseOf(run({ status: 'running', shots, jobs: [job('s1', 'authorization_required')] }), 's1')).toEqual({ phase: 'awaiting_confirmation' })
  })

  it('逐镜（付费卡①）：已在跑的计划上，这一次出价里没决定的镜 → 等你确认；去掉的 → 已去掉，不生成；× 之后没决定的 → 还没生成', () => {
    const base = run({ shots: [{ shotId: 's1' }, { shotId: 's2' }, { shotId: 's3', included: false }], jobs: [job('s1', 'authorized')] })
    const presentation = { shotIds: ['s1', 's2', 's3'], openedAt: NOW, fromGate: 0, removed: [{ shotId: 's3', at: NOW }] }
    const open: ProductionRun = { ...base, generationPlan: { ...base.generationPlan!, presentations: [presentation] } }
    expect(phaseOf(open, 's1')).toEqual({ phase: 'queued', queueIndex: 1, queueTotal: 1 })
    expect(phaseOf(open, 's2')).toEqual({ phase: 'awaiting_confirmation' })
    expect(phaseOf(open, 's3')).toEqual({ phase: 'removed' })
    const closed: ProductionRun = { ...open, generationPlan: { ...open.generationPlan!, presentations: [{ ...presentation, closed: { at: NOW, by: 'user_closed' } }] } }
    expect(phaseOf(closed, 's2')).toEqual({ phase: 'not_generated' })
    expect(phaseOf(closed, 's3')).toEqual({ phase: 'removed' })
  })

  it('没点过头就被取消的草稿 → 还没生成，不显「已停」也不给续拍钮', () => {
    expect(phaseOf(run({ status: 'cancelled', planState: 'cancelled', shots }), 's1')).toEqual({ phase: 'not_generated' })
  })

  it('点过头之后：job 过了人工门还没提交（authorized）→ 排队中；计划已提交但这一镜一次任务都没有 → 还没生成', () => {
    expect(phaseOf(run({ shots: [{ shotId: 's1' }], jobs: [job('s1', 'authorized')] }), 's1')).toEqual({ phase: 'queued', queueIndex: 1, queueTotal: 1 })
    expect(phaseOf(run({ shots: [{ shotId: 's1' }] }), 's1')).toEqual({ phase: 'not_generated' })
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

  it('提交结果未知的一镜：画成失败并带机器码（说「结果没法确认」），不是「还没开拍 / 已停」', () => {
    for (const status of ['submission_unknown', 'reconciling'] as const) {
      const state = deriveProductionShotState(run({ status: 'needs_attention', stop: 'failed', shots: [{ shotId: 's1' }], jobs: [job('s1', status)] }), 's1')
      expect(state?.phase, status).toBe('failed')
      expect(state?.phase === 'failed' ? state.failureMessage : '').toContain('NOMI_ERR::submission-unknown::')
    }
  })

  it('没有 job = 没被批过：不管计划到了哪一步都不在任何队列里（草稿卡摆着 = 等你确认，其余 = 还没生成）', () => {
    expect(deriveProductionShotState(run({ planState: 'draft', shots: [{ shotId: 's1' }] }), 's1')?.phase).toBe('awaiting_confirmation')
    for (const planState of ['sealed', 'submitted', 'cancelled'] as const) {
      expect(deriveProductionShotState(run({ planState, shots: [{ shotId: 's1' }, { shotId: 's2', included: false }] }), 's1')?.phase, planState).toBe('not_generated')
      expect(deriveProductionShotState(run({ planState, shots: [{ shotId: 's1' }, { shotId: 's2', included: false }] }), 's2')?.phase, planState).toBe('not_generated')
    }
    expect(deriveProductionShotState(run({}), 'cand-1')?.phase).toBe('not_generated')
    expect(deriveProductionShotState(run({ planState: 'draft' }), 'cand-1')?.phase).toBe('awaiting_confirmation')
  })
})

describe('decideShotClaim — 画布能不能再发这一镜', () => {
  it('报价卡等确认：付费范围里的镜归制作流程，不在范围里的不归', () => {
    const r = run({ status: 'awaiting_contract', shots: [{ shotId: 's1', nodeId: 'n1' }, { shotId: 's2', nodeId: 'n2', included: false }] })
    r.generationPlan!.state = 'sealed'
    expect(decideShotClaim(r, 's1', 'canvas').holder).toBe('production')
    expect(decideShotClaim(r, 's2', 'canvas').holder).toBe('canvas')
  })

  it('已确认：排队的镜归制作流程，已停的不归', () => {
    const shots = [{ shotId: 's1', nodeId: 'n1' }]
    expect(decideShotClaim(run({ status: 'running', shots }), 's1', 'canvas').holder).toBe('production')
    expect(decideShotClaim(run({ status: 'paused', shots }), 's1', 'canvas').holder).toBe('canvas')
  })

  it('approval gate waiting follows the run stop state without mixing holder and reason', () => {
    const waiting = run({ status: 'running', shots: [{ shotId: 's1' }] })
    waiting.gates.push({ gateId: 'gate-1', scope: 'budget_envelope', status: 'waiting', planHash: 'p', authorizationDigest: 'p',
      authorizationEnvelope: { gateId: 'gate-1', jobs: [{ shotId: 's1' }] } as never, jobIds: [], title: '', summary: '', createdAt: NOW, expiresAt: NOW })
    expect(decideShotClaim(waiting, 's1', 'canvas')).toMatchObject({ holder: 'production', reason: 'awaiting_confirmation', granted: false })
    waiting.status = 'paused'
    expect(decideShotClaim(waiting, 's1', 'canvas')).toMatchObject({ holder: 'canvas', reason: 'run_stopped', granted: true })
  })
})

describe('decideShotClaim — durable matrix regressions', () => {
  it('does not persist a canvas claim for a mismatched shot on a single-shot plan', () => {
    const single = run({ shots: undefined, jobs: [] })
    const before = JSON.stringify(single)
    const result = applyProductionCommand(single, {
      commandId: 'claim-mismatched-single', expectedRevision: single.revision, type: 'shot.claim',
      payload: { shotId: 'not-the-single-shot', by: 'canvas' }, issuedAt: NOW,
    }, NOW)
    expect(result.run).toEqual(single)
    expect(JSON.stringify(result.run)).toBe(before)
  })

  it('running canvas claim is rejected for a queued job; stopped runs release it', () => {
    const pending = run({ shots: [{ shotId: 's1' }], jobs: [job('s1', 'authorized')] })
    expect(() => applyProductionCommand(pending, {
      commandId: 'claim-s1', expectedRevision: pending.revision, type: 'shot.claim',
      payload: { shotId: 's1', by: 'canvas' }, issuedAt: NOW,
    }, NOW)).toThrow(/production_shot_claimed: queued/)
    const stopped = run({ status: 'paused', shots: [{ shotId: 's1' }], jobs: [job('s1', 'authorized')] })
    const claimed = applyProductionCommand(stopped, {
      commandId: 'claim-s1-stopped', expectedRevision: stopped.revision, type: 'shot.claim',
      payload: { shotId: 's1', by: 'canvas' }, issuedAt: NOW,
    }, NOW).run
    expect(claimed.jobs[0].status).toBe('detached')
    expect(claimed.jobs[0].errorCode).toBe('canvas_claimed')
    expect(claimed.generationPlan?.shots?.[0].claim).toMatchObject({ by: 'canvas', attempt: 1 })
    const inFlight = run({ shots: [{ shotId: 's1' }], jobs: [job('s1', 'polling')] })
    expect(() => applyProductionCommand(inFlight, {
      commandId: 'claim-s1-paid', expectedRevision: inFlight.revision, type: 'shot.claim',
      payload: { shotId: 's1', by: 'canvas' }, issuedAt: NOW,
    }, NOW)).toThrow(/production_shot_claimed: in_flight/)
  })

  it('a canvas claim record never outranks a same-attempt job that may already be paid', () => {
    const r = run({ shots: [{ shotId: 's1' }], jobs: [job('s1', 'polling')] })
    r.generationPlan!.shots![0].claim = { by: 'canvas', attempt: 1, claimedAt: NOW }
    expect(decideShotClaim(r, 's1', 'canvas')).toMatchObject({ holder: 'production', reason: 'in_flight', granted: false })
    r.jobs[0] = job('s1', 'reconciling')
    expect(decideShotClaim(r, 's1', 'canvas')).toMatchObject({ holder: 'production', reason: 'needs_reconcile', granted: false })
    r.jobs[0] = job('s1', 'detached')
    expect(decideShotClaim(r, 's1', 'production')).toMatchObject({ holder: 'canvas', reason: 'canvas_claimed', granted: false })
  })

  it('unknown/reconciling remain production-owned', () => {
    for (const status of ['submission_unknown', 'reconciling'] as const) {
      const result = decideShotClaim(run({ status: 'needs_attention', shots: [{ shotId: 's1' }], jobs: [job('s1', status)] }), 's1', 'canvas')
      expect(result).toMatchObject({ holder: 'production', reason: 'needs_reconcile', granted: false })
    }
  })

  it('authorization while stopped is released', () => {
    const result = decideShotClaim(run({ status: 'needs_attention', shots: [{ shotId: 's1' }], jobs: [job('s1', 'authorization_required')] }), 's1', 'canvas')
    expect(result).toMatchObject({ holder: 'canvas', reason: 'run_stopped', granted: true })
  })

  it('rejected gate releases an unsubmitted shot', () => {
    const r = run({ status: 'running', planState: 'sealed', shots: [{ shotId: 's1' }], jobs: [job('s1', 'authorized')] })
    r.gates.push({ gateId: 'gate-1', scope: 'budget_envelope', status: 'rejected', planHash: 'p', authorizationDigest: 'p',
      authorizationEnvelope: { gateId: 'gate-1', jobs: [{ shotId: 's1' }] } as never, jobIds: [], title: '', summary: '', createdAt: NOW, expiresAt: NOW })
    expect(decideShotClaim(r, 's1', 'canvas')).toMatchObject({ holder: 'canvas', reason: 'gate_rejected', granted: true })
  })

  it('detached cancels a waiting job but does not reclaim an in-flight attempt', () => {
    const r = run({ shots: [{ shotId: 's1' }], jobs: [job('s1', 'authorized')] })
    r.generationPlan!.shots![0].canvasDetached = true
    expect(decideShotClaim(r, 's1', 'canvas').reason).toBe('canvas_detached')
    r.jobs[0].status = 'polling'
    expect(decideShotClaim(r, 's1', 'canvas').holder).toBe('production')
  })
})
