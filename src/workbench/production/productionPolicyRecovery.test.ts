import { describe, expect, it } from 'vitest'

import { buildProductionPolicySettingsTarget, isProductionPolicyError } from './productionPolicyRecovery'

describe('production policy recovery', () => {
  it('recognizes incomplete contract policy errors without matching unrelated failures', () => {
    expect(isProductionPolicyError(new Error('ProductionPolicyIncompleteError: 制作合同暂不能批准：未设置硬预算上限；供应商「relay」未加入白名单'))).toBe(true)
    expect(isProductionPolicyError(new Error('provider unavailable'))).toBe(false)
    expect(isProductionPolicyError('Production contract policy is incomplete')).toBe(true)
  })

  it('opens the shared production policy settings with the exact Run requirements', () => {
    expect(buildProductionPolicySettingsTarget({
      ready: false,
      issueCount: 3,
      missingHardBudget: true,
      requiredProviderModels: [{ provider: 'code-newcli-com', model: 'gpt-image-2' }],
      missingProviders: ['code-newcli-com'],
      missingModels: ['gpt-image-2'],
    })).toEqual({
      tab: 'ai',
      section: 'production-policy',
      productionPolicy: {
        requiredProviderModels: [{ provider: 'code-newcli-com', model: 'gpt-image-2' }],
      },
    })
  })
})
