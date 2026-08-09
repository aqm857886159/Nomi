import { describe, expect, it } from 'vitest'

import {
  assertProductionPolicyReady,
  evaluateProductionPolicyReadiness,
  ProductionPolicyIncompleteError,
} from './productionPolicyReadiness'

const jobs = [
  { provider: 'code-newcli-com', model: 'gpt-image-2' },
  { provider: 'code-newcli-com', model: 'gpt-image-2' },
]

describe('production policy readiness', () => {
  it('reports every missing contract prerequisite at once', () => {
    const readiness = evaluateProductionPolicyReadiness({
      maxSpend: null,
      allowedProviders: [],
      allowedModels: [],
    }, jobs)

    expect(readiness).toEqual({
      ready: false,
      issueCount: 3,
      missingHardBudget: true,
      requiredProviderModels: [{ provider: 'code-newcli-com', model: 'gpt-image-2' }],
      missingProviders: ['code-newcli-com'],
      missingModels: ['gpt-image-2'],
    })
    expect(() => assertProductionPolicyReady({
      maxSpend: null,
      allowedProviders: [],
      allowedModels: [],
    }, jobs)).toThrowError(new ProductionPolicyIncompleteError(readiness))
  })

  it('is ready only after the explicit ceiling and both allowlists are present', () => {
    expect(evaluateProductionPolicyReadiness({
      maxSpend: 25,
      allowedProviders: ['code-newcli-com'],
      allowedModels: ['gpt-image-2'],
    }, jobs)).toMatchObject({ ready: true, issueCount: 0 })
  })
})
