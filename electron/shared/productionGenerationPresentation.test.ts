import { describe, expect, it } from 'vitest'

import {
  generationPresentationOutcome,
  normalizeLegacyPresentation,
  presentationResolved,
  shotApprovedInCurrentPresentation,
  standingShotIds,
  undecidedShotIds,
} from './productionGenerationPresentation'
import type { GenerationPresentation, ProductionGate, ProductionJob, ProductionRun } from '../productionRun/productionRunTypes'

// 付费卡这一次出价的逐镜结局（2026-09-30「点了的生成，去掉的不生成」）：卡上摆哪几镜、回执说什么、
// 画布小标写什么，都读这一个值。这里钉的是它从 Run 里那三样事实（出价账 / 每道门批没批 / job 到没到过供应商）
// 怎么派生，不是长什么样。

const NOW = '2026-09-30T00:00:00.000Z'

function gate(id: string, status: ProductionGate['status'], shotIds: string[], createdAt = NOW): ProductionGate {
  return {
    gateId: id, scope: 'budget_envelope', status, planHash: `d-${id}`, authorizationDigest: `d-${id}`,
    authorizationEnvelope: { gateId: id, jobs: shotIds.map((shotId) => ({ shotId })) } as never,
    title: '', summary: '', jobIds: [], createdAt, expiresAt: NOW,
  } as ProductionGate
}

function job(shotId: string, gateId: string, extra: Partial<ProductionJob> = {}): ProductionJob {
  return {
    jobId: `job-${shotId}-${gateId}`, stageId: 'generate', status: 'polling', attempt: 1, provider: 'apimart', model: 'img',
    idempotencyKey: `k-${shotId}-${gateId}`, metadata: { shotId }, authorizationDigest: `d-${gateId}`, createdAt: NOW, updatedAt: NOW, ...extra,
  }
}

function run(opts: {
  shots?: Array<{ shotId: string; included?: boolean; claimedByCanvas?: boolean }>
  presentations?: GenerationPresentation[]
  gates?: ProductionGate[]
  jobs?: ProductionJob[]
  state?: 'draft' | 'sealed' | 'submitted' | 'cancelled'
}): ProductionRun {
  const candidate = { candidateId: 'cand-1', revision: 1, moduleId: 'm', providerId: 'apimart', modelId: 'img', mode: 't2i', prompt: '', parameters: {}, references: [] }
  const shots = opts.shots ?? [{ shotId: 's1' }, { shotId: 's2' }]
  return {
    schemaVersion: 1, runId: 'run-1', projectId: 'proj-1', revision: 1, status: 'running', stageId: 'generate',
    playbook: { name: 'generation.multi-shot', version: '1.0.0' }, origin: { host: 'semantic-mcp' },
    policy: { trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 1, minimizeUploads: true },
    budget: { currency: 'CNY', authorized: 100, reserved: 0, actual: 0, unsettled: 0, unknownInFlight: 0 },
    planVersion: 1, snapshotCursor: 0, stages: [], gates: opts.gates ?? [], jobs: opts.jobs ?? [], artifacts: [],
    generationPlan: {
      operationId: 'run-1', state: opts.state ?? 'submitted', candidate,
      shots: shots.map((shot) => ({
        shotId: shot.shotId, candidate: { ...candidate, candidateId: shot.shotId }, updatedAt: NOW,
        ...(shot.included !== undefined ? { included: shot.included } : {}),
        ...(shot.claimedByCanvas ? { claim: { by: 'canvas' as const, attempt: 1, claimedAt: NOW } } : {}),
      })),
      ...(opts.presentations ? { presentations: opts.presentations } : {}),
      updatedAt: NOW,
    },
    createdAt: NOW, updatedAt: NOW,
  }
}

const open = (shotIds: string[], fromGate = 0, extra: Partial<GenerationPresentation> = {}): GenerationPresentation => ({ shotIds, openedAt: NOW, fromGate, ...extra })

describe('generation presentation identity', () => {
  it('每次出价都有持久 identity、epoch 和策略快照', () => {
    const r = run({ presentations: [{
      presentationId: 'run-1:presentation:7', presentationEpoch: 7,
      shotIds: ['s1'], openedAt: NOW, fromGate: 0,
      policySnapshot: { mode: 'step', spend: 'confirm' },
    }] })
    expect(r.generationPlan?.presentations?.[0]).toMatchObject({
      presentationId: 'run-1:presentation:7',
      presentationEpoch: 7,
      policySnapshot: { mode: 'step', spend: 'confirm' },
    })
  })
})

describe('undecidedShotIds — 卡上摆的、标题数的就是它', () => {
  it('点了「生成这张」（门批了）的那一镜不再算没决定；另一镜还在卡上', () => {
    const r = run({ presentations: [open(['s1', 's2'])], gates: [gate('g1', 'approved', ['s1'])] })
    expect(undecidedShotIds(r)).toEqual(['s2'])
  })

  it('门还在等（这一下正在点）不算决定：点失败了它还得在卡上等人', () => {
    const r = run({ presentations: [open(['s1', 's2'])], gates: [gate('g1', 'waiting', ['s1'])] })
    expect(undecidedShotIds(r)).toEqual(['s1', 's2'])
  })

  it('上一次出价里批的门不算这一次的点击——按门的先后算，同一毫秒也分得开', () => {
    // 两道门和这一次出价落在同一个时间戳：只有 fromGate 之后的那道算「这一次点的」。
    const r = run({
      presentations: [open(['s1'], 0, { closed: { at: NOW, by: 'resolved' } }), open(['s1', 's2'], 1)],
      gates: [gate('g-old', 'approved', ['s1']), gate('g-new', 'approved', ['s2'])],
    })
    expect(undecidedShotIds(r)).toEqual(['s1'])
    expect(shotApprovedInCurrentPresentation(r, 's1')).toBe(false)
    expect(shotApprovedInCurrentPresentation(r, 's2')).toBe(true)
  })

  it('去掉的、画布接手的都不在卡上', () => {
    const r = run({
      shots: [{ shotId: 's1' }, { shotId: 's2', included: false }, { shotId: 's3', claimedByCanvas: true }],
      presentations: [open(['s1', 's2', 's3'], 0, { removed: [{ shotId: 's2', at: NOW }] })],
    })
    expect(undecidedShotIds(r)).toEqual(['s1'])
  })

  it('卡关了（×）就没有卡上的镜了；没有出价记录也一样', () => {
    expect(undecidedShotIds(run({ presentations: [open(['s1', 's2'], 0, { closed: { at: NOW, by: 'user_closed' } })] }))).toEqual([])
    expect(undecidedShotIds(run({}))).toEqual([])
  })

  it('每一镜都定了（生成或去掉）才算这一次出价该自己关', () => {
    const half = run({ presentations: [open(['s1', 's2'])], gates: [gate('g1', 'approved', ['s1'])] })
    expect(presentationResolved(half)).toBe(false)
    const all = run({ presentations: [open(['s1', 's2'], 0, { removed: [{ shotId: 's2', at: NOW }] })], gates: [gate('g1', 'approved', ['s1'])] })
    expect(presentationResolved(all)).toBe(true)
  })
})

describe('generationPresentationOutcome — 回执只渲染这一个值', () => {
  it('生成 1、去掉 2、× 关掉时 3 没决定：逐镜说对，没决定的原因就是卡怎么关的', () => {
    const r = run({
      shots: [{ shotId: 's1' }, { shotId: 's2', included: false }, { shotId: 's3' }],
      presentations: [open(['s1', 's2', 's3'], 0, { removed: [{ shotId: 's2', at: NOW }], closed: { at: NOW, by: 'user_closed' } })],
      gates: [gate('g1', 'approved', ['s1'])],
      jobs: [job('s1', 'g1')],
    })
    expect(generationPresentationOutcome(r)).toEqual({
      closedBy: 'user_closed',
      generating: ['s1'],
      failedBeforeSending: [],
      removed: ['s2'],
      takenByCanvas: [],
      undecided: [{ shotId: 's3', reason: 'user_closed' }],
    })
  })

  it('点了但派发在出站之前就失败（一个字节没写出去）：不算在生成', () => {
    const r = run({
      presentations: [open(['s1', 's2'], 0, { closed: { at: NOW, by: 'resolved' } })],
      gates: [gate('g1', 'approved', ['s1']), gate('g2', 'approved', ['s2'])],
      jobs: [job('s1', 'g1'), job('s2', 'g2', { status: 'needs_attention', errorCode: 'provider_not_reached' })],
    })
    const outcome = generationPresentationOutcome(r)!
    expect(outcome.generating).toEqual(['s1'])
    expect(outcome.failedBeforeSending).toEqual(['s2'])
  })

  it('上一次出价里那次「没发出去」的失败不算到这一次的点击头上', () => {
    const r = run({
      shots: [{ shotId: 's1' }],
      presentations: [open(['s1'], 0, { closed: { at: NOW, by: 'resolved' } }), open(['s1'], 1, { closed: { at: NOW, by: 'resolved' } })],
      gates: [gate('g-old', 'approved', ['s1']), gate('g-new', 'approved', ['s1'])],
      jobs: [job('s1', 'g-old', { status: 'needs_attention', errorCode: 'provider_not_reached' }), job('s1', 'g-new')],
    })
    const outcome = generationPresentationOutcome(r)!
    expect(outcome.generating).toEqual(['s1'])
    expect(outcome.failedBeforeSending).toEqual([])
  })

  it('发出去之后才失败的不算「没发出去」：钱可能已经花了', () => {
    const r = run({
      shots: [{ shotId: 's1' }],
      presentations: [open(['s1'], 0, { closed: { at: NOW, by: 'resolved' } })],
      gates: [gate('g1', 'approved', ['s1'])],
      jobs: [job('s1', 'g1', { status: 'needs_attention', errorCode: 'provider_timeout' })],
    })
    expect(generationPresentationOutcome(r)!.failedBeforeSending).toEqual([])
  })

  it('卡开着时没决定的镜原因是 open；画布接手的单列', () => {
    const r = run({
      shots: [{ shotId: 's1', claimedByCanvas: true }, { shotId: 's2' }],
      presentations: [open(['s1', 's2'])],
    })
    expect(generationPresentationOutcome(r)).toMatchObject({ closedBy: 'open', takenByCanvas: ['s1'], undecided: [{ shotId: 's2', reason: 'open' }] })
  })
})

describe('standingShotIds — 不点名再出价时还算数的镜', () => {
  it('用户去掉过的、旧版本静默移出这一批的，都不自动回来', () => {
    const r = run({
      shots: [{ shotId: 's1' }, { shotId: 's2', included: false }, { shotId: 's3', included: false }],
      presentations: [open(['s1', 's2'], 0, { removed: [{ shotId: 's2', at: NOW }], closed: { at: NOW, by: 'resolved' } })],
    })
    expect(standingShotIds(r)).toEqual(['s1'])
  })
})

describe('normalizeLegacyPresentation — 旧 Run 的 cardHidden 读盘时折成一条出价记录', () => {
  const legacy = (plan: Record<string, unknown>, gates: ProductionGate[] = []) => {
    const base = run({ gates, state: plan.state as never })
    return { ...base, generationPlan: { ...base.generationPlan!, ...plan } } as ProductionRun
  }

  it('草稿、没写 cardHidden（旧默认「卡可见」）→ 一条开着的出价，摆的是勾进这一批的镜', () => {
    const r = normalizeLegacyPresentation(legacy({ state: 'draft', shots: run({ shots: [{ shotId: 's1' }, { shotId: 's2', included: false }] }).generationPlan!.shots }))
    expect(r.generationPlan?.presentations).toMatchObject([{ shotIds: ['s1'], openedAt: NOW, fromGate: 0, presentationId: 'run-1:presentation:1', presentationEpoch: 1 }])
  })

  it('cardHidden: true → 没有开着的出价；字段本身不再留', () => {
    const r = normalizeLegacyPresentation(legacy({ state: 'draft', cardHidden: true }))
    expect(r.generationPlan?.presentations).toBeUndefined()
    expect('cardHidden' in (r.generationPlan ?? {})).toBe(false)
  })

  it('已封印、门还在等 → 卡开着，在等的那道门算这一次出价里的点击', () => {
    const r = normalizeLegacyPresentation(legacy({ state: 'sealed' }, [gate('g-old', 'approved', ['s1']), gate('g-wait', 'waiting', ['s2'])]))
    expect(r.generationPlan?.presentations).toMatchObject([{ shotIds: ['s1', 's2'], openedAt: NOW, fromGate: 1, presentationId: 'run-1:presentation:1', presentationEpoch: 1 }])
  })

  it('已经是新形状就原样返回同一个对象', () => {
    const r = run({ presentations: [open(['s1'], 0, { presentationId: 'run-1:presentation:1', presentationEpoch: 1, policySnapshot: { mode: 'safe-auto', spend: 'confirm' } })] })
    expect(normalizeLegacyPresentation(r)).toBe(r)
  })
})
