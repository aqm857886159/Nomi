import { describe, expect, it } from 'vitest'

import { deriveShotPlaceholderState, projectShotExecution } from './shotPlaceholderState'
import type { ProductionGenerationPlan, ProductionRun, ProductionJob, ProductionJobStatus, ProductionRunStatus } from '../../../electron/productionRun/productionRunTypes'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'

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
  planState?: ProductionGenerationPlan['state']
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
    budget: { currency: 'CNY', authorized: 100, reserved: 0, actual: 0, unsettled: 0, unknownInFlight: 0 },
    planVersion: 1,
    snapshotCursor: 0,
    stages: [],
    gates: [],
    jobs: opts.jobs ?? [],
    artifacts: [],
    generationPlan: {
      operationId: 'run-1',
      state: opts.planState ?? 'submitted',
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
  it('已派出、还没 job 的镜显「排队中」，不伪造生成中', () => {
    const r = run({ shots: [{ shotId: 's1', nodeId: 'n1' }, { shotId: 's2', nodeId: 'n2' }] })
    expect(deriveShotPlaceholderState(r, 'n1')).toEqual({ phase: 'queued' })
    expect(deriveShotPlaceholderState(r, 'n2')).toEqual({ phase: 'queued' })
  })

  it('job 过了人工门、还没提交（authorized）→ 排队中', () => {
    const r = run({ shots: [{ shotId: 's1', nodeId: 'n1' }], jobs: [job('s1', 'n1', 'authorized')] })
    expect(deriveShotPlaceholderState(r, 'n1')).toEqual({ phase: 'queued' })
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

  it('已派出批次里的 anchor 节点同样显「排队中」', () => {
    const r = run({ shots: [{ shotId: 'a1', role: 'anchor', nodeId: 'na' }, { shotId: 's1', nodeId: 'n1' }] })
    expect(deriveShotPlaceholderState(r, 'na')).toEqual({ phase: 'queued' })
  })

  it('null run → null；有 run 但节点没绑镜 → null（不再兜底说「排队中」）', () => {
    expect(deriveShotPlaceholderState(null, 'n1')).toBeNull()
    const r = run({ shots: [{ shotId: 's1', nodeId: 'n1' }] })
    expect(deriveShotPlaceholderState(r, 'nope')).toBeNull()
  })
})

// 2026-09-24 真模型走查：Agent 按「先别生成」建的草稿显示「排队中 · 第 1/1」。
// 用户还没点头的每一种状态都不许说「排队中」（也不许说「已停」然后给一颗续拍钮）。
describe('deriveShotPlaceholderState · 用户还没点头', () => {
  const PRE_DISPATCH_RUN_STATUSES: ProductionRunStatus[] = [
    'draft', 'awaiting_direction', 'awaiting_script_review', 'awaiting_storyboard_review', 'awaiting_contract', 'ready',
  ]
  const shots = [{ shotId: 'a1', role: 'anchor' as const, nodeId: 'na' }, { shotId: 's1', nodeId: 'n1' }]

  it('draft_shots 建的草稿（Run draft、计划 draft、0 个 job）→ null（报告里那一幕）', () => {
    const r = run({ status: 'draft', planState: 'draft', shots: [{ shotId: 'shot-1', nodeId: 'n1' }] })
    expect(deriveShotPlaceholderState(r, 'n1')).toBeNull()
  })

  for (const status of PRE_DISPATCH_RUN_STATUSES) {
    for (const planState of ['draft', 'sealed'] as const) {
      it(`Run ${status} + 计划 ${planState}、没有 job → 每个节点（含 anchor）都是 null`, () => {
        const r = run({ status, planState, shots })
        expect(deriveShotPlaceholderState(r, 'n1')).toBeNull()
        expect(deriveShotPlaceholderState(r, 'na')).toBeNull()
      })
    }
    it(`Run ${status} + job 停在人工门前（authorization_required / planned）→ null`, () => {
      for (const jobStatus of ['authorization_required', 'planned'] as const) {
        const r = run({ status, planState: 'sealed', shots, jobs: [job('s1', 'n1', jobStatus)] })
        expect(deriveShotPlaceholderState(r, 'n1'), jobStatus).toBeNull()
      }
    })
  }

  it('逐镜确认档：批次在跑，这一镜的 job 还在等它自己那道门 → null，不说「排队中」', () => {
    const r = run({ status: 'running', shots, jobs: [job('s1', 'n1', 'authorization_required')] })
    expect(deriveShotPlaceholderState(r, 'n1')).toBeNull()
  })

  it('没点过头就被取消的草稿 → null，不显「已停」也不给续拍钮', () => {
    const r = run({ status: 'cancelled', planState: 'cancelled', shots })
    expect(deriveShotPlaceholderState(r, 'n1')).toBeNull()
  })

  it('已派出的批次里被勾掉的镜 → null（它不在这一批里）', () => {
    const r = run({ shots: [{ shotId: 's1', nodeId: 'n1' }, { shotId: 's2', nodeId: 'n2', included: false }] })
    expect(deriveShotPlaceholderState(r, 'n1')).toEqual({ phase: 'queued' })
    expect(deriveShotPlaceholderState(r, 'n2')).toBeNull()
  })
})

describe('projectShotExecution', () => {
  const base = { id: 'n1', kind: 'image', status: 'idle', meta: { productionRunId: 'run-1' } } as unknown as GenerationCanvasNode

  it('生成中 / 排队中 / 失败 投影成普通节点的执行态，交给同一套画法', () => {
    expect(projectShotExecution(base, { phase: 'generating' }, 'fallback').status).toBe('running')
    expect(projectShotExecution(base, { phase: 'queued' }, 'fallback').status).toBe('queued')
    expect(projectShotExecution(base, { phase: 'failed', failureMessage: '内容被拦截' }, 'fallback')).toMatchObject({ status: 'error', error: '内容被拦截' })
    expect(projectShotExecution(base, { phase: 'failed' }, 'fallback')).toMatchObject({ status: 'error', error: 'fallback' })
  })

  it('还没点头（null）/ 已停 / 完成：节点原样不动', () => {
    expect(projectShotExecution(base, null, 'fallback')).toBe(base)
    expect(projectShotExecution(base, { phase: 'stopped', stoppedReason: 'budget' }, 'fallback')).toBe(base)
    expect(projectShotExecution(base, { phase: 'done' }, 'fallback')).toBe(base)
  })

  it('本地执行器正在跑（用户在节点上自己点了生成）或已经有结果：本地说了算', () => {
    const running = { ...base, status: 'running' } as GenerationCanvasNode
    expect(projectShotExecution(running, { phase: 'failed' }, 'fallback')).toBe(running)
    const withResult = { ...base, result: { url: 'nomi-local://x.png' } } as unknown as GenerationCanvasNode
    expect(projectShotExecution(withResult, { phase: 'generating' }, 'fallback')).toBe(withResult)
  })
})
