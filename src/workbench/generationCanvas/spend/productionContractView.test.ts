import { describe, expect, it } from 'vitest'

import type { ProductionGate, ProductionRun } from '../../../../electron/productionRun/productionRunTypes'
import { buildProductionContractView } from './productionContractView'

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
      mode: 'balanced', trustedHosts: ['codex'], allowedProviders: ['tapcanvas'], allowedModels: ['seedance-1.0'],
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
    expect(buildProductionContractView(run(), gate(), {
      providerLabels: { tapcanvas: 'TapCanvas' },
    })).toMatchObject({
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
      providerModels: [{ provider: 'tapcanvas', providerLabel: 'TapCanvas', model: 'seedance-1.0' }],
      policy: {
        ready: true,
        issueCount: 0,
        missingHardBudget: false,
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
})
