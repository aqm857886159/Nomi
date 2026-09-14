import { describe, expect, it } from 'vitest'

import { buildProductionPolicySettingsTarget, isProductionPolicyError } from './productionPolicyRecovery'

describe('production policy recovery', () => {
  it('recognizes incomplete contract policy errors without matching unrelated failures', () => {
    expect(isProductionPolicyError(new Error('ProductionPolicyIncompleteError: 制作合同暂不能批准：供应商「relay」未接入'))).toBe(true)
    expect(isProductionPolicyError(new Error('provider unavailable'))).toBe(false)
    expect(isProductionPolicyError('Production contract policy is incomplete')).toBe(true)
  })

  it('sends the user to the model onboarding tab: the only fix for a missing provider/model is connecting it', () => {
    // 2026-09-14：全局白名单已删，「缺」= 没接入；深链不再带 requiredProviderModels 去勾复选框。
    expect(buildProductionPolicySettingsTarget()).toEqual({ tab: 'models' })
  })
})
