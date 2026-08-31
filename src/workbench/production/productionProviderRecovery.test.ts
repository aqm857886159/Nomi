import { describe, expect, it } from 'vitest'

import type { ProductionRun } from '../../../electron/productionRun/productionRunTypes'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { buildProductionProviderLabels, buildProductionProviderReplacementPlan } from './productionProviderRecovery'

function run(blockerStatus: 'not_dispatched' | 'submission_unknown' = 'not_dispatched'): ProductionRun {
  const createdAt = '2026-08-09T00:00:00.000Z'
  const jobs = Array.from({ length: 3 }, (_, index) => ({
    jobId: `job-${index + 1}`,
    stageId: 'generate',
    status: index === 0 ? blockerStatus : 'authorized' as const,
    attempt: 0,
    provider: 'code-newcli-com',
    model: 'gpt-image-2',
    idempotencyKey: `old-${index + 1}`,
    nodeId: `node-${index + 1}`,
    createdAt,
    updatedAt: createdAt,
  }))
  return {
    schemaVersion: 1, runId: 'run-1', projectId: 'project-1', revision: 18, status: 'needs_attention', stageId: 'generate',
    playbook: { name: 'brand.promo', version: '1' }, origin: { host: 'codex' },
    policy: { mode: 'balanced', trustedHosts: ['codex'], allowedProviders: ['code-newcli-com', 'apimart'], allowedModels: ['gpt-image-2'], maxSpend: 10, maxAttemptsPerJob: 1, minimizeUploads: true },
    budget: { currency: 'CNY', authorized: 10, reserved: 0, actual: 0, unsettled: 0 }, planVersion: 1, snapshotCursor: 1,
    stages: [], gates: [], jobs, artifacts: [], createdAt, updatedAt: createdAt,
  }
}

const nodes: GenerationCanvasNode[] = Array.from({ length: 3 }, (_, index) => ({
  id: `node-${index + 1}`,
  kind: 'image',
  title: `Shot ${index + 1}`,
  position: { x: 0, y: 0 },
  meta: { modelVendor: 'code-newcli-com', modelKey: 'gpt-image-2' },
  ...(index === 0 ? { error: 'API key missing: code-newcli-com' } : {}),
}))

const models = [
  { vendorKey: 'code-newcli-com', modelKey: 'gpt-image-2', labelZh: 'GPT Image 2', kind: 'image' as const, enabled: true, meta: { canonicalModelId: 'gpt-image-2' }, createdAt: '', updatedAt: '' },
  { vendorKey: 'kie', modelKey: 'gpt-image-2-image-to-image', labelZh: 'GPT Image 2 Image to Image', kind: 'image' as const, enabled: true, meta: { canonicalModelId: 'gpt-image-2' }, createdAt: '', updatedAt: '' },
  { vendorKey: 'apimart', modelKey: 'gpt-image-2', labelZh: 'GPT Image 2', kind: 'image' as const, enabled: true, meta: { canonicalModelId: 'gpt-image-2' }, createdAt: '', updatedAt: '' },
]

describe('production provider recovery', () => {
  it('uses catalog names for provider-facing contract labels', () => {
    expect(buildProductionProviderLabels([
      { key: 'apimart', name: 'APIMart' },
      { key: ' custom-relay ', name: ' My Relay ' },
    ])).toEqual({ apimart: 'APIMart', 'custom-relay': 'My Relay' })
  })

  it('replaces every unsubmitted job sharing the broken provider/model', () => {
    const plan = buildProductionProviderReplacementPlan({
      run: run(), nodes, models,
      vendors: [
        { key: 'code-newcli-com', name: 'Broken', enabled: true, authType: 'bearer', hasApiKey: false, createdAt: '', updatedAt: '' },
        { key: 'kie', name: 'KIE.AI', enabled: true, authType: 'bearer', hasApiKey: true, createdAt: '', updatedAt: '' },
        { key: 'apimart', name: 'APIMart', enabled: true, authType: 'bearer', hasApiKey: true, createdAt: '', updatedAt: '' },
      ],
    })
    expect(plan).toMatchObject({ failedProvider: 'code-newcli-com', replacementProvider: 'apimart', replacementProviderLabel: 'APIMart · GPT Image 2', affectedCount: 3 })
    expect(plan?.replacements).toHaveLength(3)
    expect(plan?.candidates.map((candidate) => candidate.label)).toEqual([
      'APIMart · GPT Image 2',
      'KIE.AI · GPT Image 2 Image to Image',
    ])
  })

  it('does not offer failover without local evidence for a receipt-unknown task', () => {
    expect(buildProductionProviderReplacementPlan({
      run: run('submission_unknown'), nodes, models,
      vendors: [{ key: 'apimart', name: 'APIMart', enabled: true, authType: 'bearer', hasApiKey: true, createdAt: '', updatedAt: '' }],
    })).toBeNull()
  })
})
