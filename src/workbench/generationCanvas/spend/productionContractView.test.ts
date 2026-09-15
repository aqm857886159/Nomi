import { describe, expect, it } from 'vitest'

import type { ProductionGate, ProductionRun } from '../../../../electron/productionRun/productionRunTypes'
import { buildMultiShotContractView, buildProductionContractView, type MultiShotGatePayload } from './productionContractView'

function run(overrides: Partial<ProductionRun> = {}): ProductionRun {
  return {
    schemaVersion: 1,
    runId: 'run-1',
    projectId: 'project-1',
    revision: 3,
    status: 'awaiting_contract',
    stageId: 'contract',
    playbook: { name: 'brand.promo', version: '1.2.0' },
    origin: { host: 'codex' },
    policy: {
      trustedHosts: ['codex'], allowedProviders: ['tapcanvas'], allowedModels: ['seedance-1.0'],
      maxSpend: 60, maxAttemptsPerJob: 2, minimizeUploads: true,
    },
    budget: { currency: 'CNY', authorized: 60, reserved: 0, actual: 0, unsettled: 0 },
    planVersion: 4,
    snapshotCursor: 3,
    stages: [],
    gates: [],
    jobs: [
      {
        jobId: 'job-1', stageId: 'production', status: 'authorization_required', attempt: 1,
        provider: 'tapcanvas', model: 'seedance-1.0', idempotencyKey: 'job-1:1',
        createdAt: '2026-08-08T08:00:00.000Z', updatedAt: '2026-08-08T08:00:00.000Z',
      },
    ],
    artifacts: [],
    createdAt: '2026-08-08T08:00:00.000Z',
    updatedAt: '2026-08-08T08:00:00.000Z',
    ...overrides,
  }
}

function gate(overrides: Partial<ProductionGate> = {}): ProductionGate {
  return {
    gateId: 'gate-1', scope: 'budget_envelope', status: 'waiting', planHash: 'sha256:plan-4', jobIds: ['job-1'],
    title: '确认制作摘要', summary: '约一分钟 Nomi 宣传片',
    createdAt: '2026-08-08T08:00:00.000Z', expiresAt: '2026-08-08T09:00:00.000Z',
    contract: {
      specs: { durationSeconds: 60, aspectRatio: '16:9', language: 'zh-CN', shotCount: 8 },
      claims: [
        { text: '本地优先', evidenceIds: ['evidence-local'] },
        { text: '任意 API 接入', evidenceIds: [] },
      ],
      evidence: [{ evidenceId: 'evidence-local', label: '本地项目目录实录' }],
      skills: [
        { name: 'brand.promo', version: '1.2.0' },
        { name: 'director.storyboard', version: '2.0.0' },
      ],
      estimatedCost: { currency: 'CNY', minimum: 42, maximum: 56 },
    },
    ...overrides,
  }
}

describe('production contract view', () => {
  it('projects the approved plan, evidence, skills, models, retries, and known cost boundary', () => {
    expect(buildProductionContractView(run(), gate())).toMatchObject({
      planVersion: 4,
      planHash: 'sha256:plan-4',
      specs: { durationSeconds: 60, aspectRatio: '16:9', language: 'zh-CN', shotCount: 8 },
      claims: [
        { text: '本地优先', evidenceCount: 1, verified: true },
        { text: '任意 API 接入', evidenceCount: 0, verified: false },
      ],
      skills: [
        { name: 'brand.promo', version: '1.2.0' },
        { name: 'director.storyboard', version: '2.0.0' },
      ],
      providerModels: [{ provider: 'tapcanvas', model: 'seedance-1.0' }],
      policy: {
        ready: true,
        issueCount: 0,
        requiredProviderModels: [{ provider: 'tapcanvas', model: 'seedance-1.0' }],
        missingProviders: [],
        missingModels: [],
      },
      maxAttemptsPerJob: 2,
      cost: { known: true, currency: 'CNY', minimum: 42, maximum: 56, hardLimit: 60 },
      requiresSeparateIrreversibleApproval: true,
    })
  })

  it('keeps unknown cost explicit instead of fabricating an estimate', () => {
    const unknown = gate({ contract: { ...gate().contract!, estimatedCost: undefined } })
    expect(buildProductionContractView(run({ budget: { currency: 'USD', authorized: 0, reserved: 0, actual: 0, unsettled: 0 } }), unknown).cost).toEqual({
      known: false,
      currency: 'USD',
      minimum: null,
      maximum: null,
      hardLimit: 60,
    })
  })

  it('does not attach a multi-shot list on the legacy driver contract view', () => {
    expect(buildProductionContractView(run(), gate()).shotList).toBeUndefined()
  })
})

function multiShotPayload(overrides: Partial<MultiShotGatePayload> = {}): MultiShotGatePayload {
  return {
    projectName: '雨夜便利店',
    planVersion: 3,
    planHash: 'sha256:plan-3',
    specs: { durationSeconds: 40, aspectRatio: '9:16', shotCount: 3 },
    currency: 'CNY',
    hardLimit: 30,
    waitSeconds: 180,
    frozenItems: ['shots', 'models', 'references', 'price'],
    expiresAt: '2026-08-25T09:00:00.000Z',
    anchorChips: [{ label: '主角 · 阿雨', price: { known: true, amount: 2 } }],
    shots: [
      {
        shotId: 'shot-1', index: 1, sceneOneLiner: '雨夜，阿雨推开便利店玻璃门',
        providerModelText: 'APIMart · 即梦（文生图）', durationSeconds: 5,
        price: { known: true, amount: 4 }, degradations: [],
      },
      {
        shotId: 'shot-2', index: 2, sceneOneLiner: '货架前，两人对视',
        providerModelText: 'APIMart · 某视频模型（图生视频）', durationSeconds: 6,
        price: { known: true, amount: 6 },
        degradations: [{ code: 'model_cannot_take_character_reference', params: { modelId: 'some-video' } }],
      },
      {
        shotId: 'shot-3', index: 3, sceneOneLiner: '收银台特写',
        providerModelText: 'APIMart · 未定价模型', durationSeconds: null,
        price: { known: false }, degradations: [],
      },
    ],
    ...overrides,
  }
}

describe('multi-shot contract view (P4 S3a)', () => {
  it('projects per-shot rows, honest subtotal, unknown-price count, and reminder count', () => {
    const view = buildMultiShotContractView(multiShotPayload())
    expect(view.shotList).toBeDefined()
    const list = view.shotList!
    expect(list.shots).toHaveLength(3)
    expect(list.shots.map((shot) => shot.index)).toEqual([1, 2, 3])
    // subtotal counts ONLY known prices (4 + 6), never fabricating 0 for the unpriced shot.
    expect(list.knownSubtotal).toBe(10)
    expect(list.unknownShotCount).toBe(1)
    // the one shot with a degradation is the only reminder.
    expect(list.reminderShotCount).toBe(1)
    expect(list.hardLimit).toBe(30)
    expect(list.currency).toBe('CNY')
    expect(list.frozenItems).toEqual(['shots', 'models', 'references', 'price'])
    expect(list.waitSeconds).toBe(180)
    expect(list.anchorChips).toEqual([{ label: '主角 · 阿雨', price: { known: true, amount: 2 } }])
  })

  it('passes structured degradation code through untouched (renderer translates via t())', () => {
    const view = buildMultiShotContractView(multiShotPayload())
    expect(view.shotList!.shots[1].degradations).toEqual([
      { code: 'model_cannot_take_character_reference', params: { modelId: 'some-video' } },
    ])
  })

  it('keeps an unknown per-shot price explicit rather than substituting 0', () => {
    const view = buildMultiShotContractView(multiShotPayload())
    expect(view.shotList!.shots[2].price).toEqual({ known: false })
    expect(view.shotList!.shots[2].durationSeconds).toBeNull()
  })

  it('marks aggregate cost as unknown when any shot is unpriced', () => {
    const view = buildMultiShotContractView(multiShotPayload())
    expect(view.cost.known).toBe(false)
    // but the known subtotal is still surfaced (10) rather than lost.
    expect(view.cost.minimum).toBe(10)
  })

  it('marks aggregate cost as known when every shot is priced', () => {
    const view = buildMultiShotContractView(multiShotPayload({
      shots: [
        { shotId: 's1', index: 1, sceneOneLiner: 'a', providerModelText: 'x · y', durationSeconds: 5, price: { known: true, amount: 4 }, degradations: [] },
        { shotId: 's2', index: 2, sceneOneLiner: 'b', providerModelText: 'x · y', durationSeconds: 5, price: { known: true, amount: 5 }, degradations: [] },
      ],
    }))
    expect(view.cost.known).toBe(true)
    expect(view.shotList!.knownSubtotal).toBe(9)
    expect(view.shotList!.unknownShotCount).toBe(0)
  })

  it('honestly reports a missing hard limit as null (never 0)', () => {
    const view = buildMultiShotContractView(multiShotPayload({ hardLimit: null }))
    expect(view.shotList!.hardLimit).toBeNull()
    expect(view.cost.hardLimit).toBeNull()
  })

  it('falls back shotCount to the number of shots when specs omit it', () => {
    const view = buildMultiShotContractView(multiShotPayload({ specs: { durationSeconds: 40, aspectRatio: '9:16' } }))
    expect(view.specs.shotCount).toBe(3)
  })
})
