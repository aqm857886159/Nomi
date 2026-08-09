import { describe, expect, it } from 'vitest'

import { isMissingHardBudgetError, PRODUCTION_BUDGET_SETTINGS_TARGET } from './productionBudgetGuard'

describe('production budget guard', () => {
  it('recognizes the localized missing-ceiling error without matching unrelated failures', () => {
    expect(isMissingHardBudgetError(new Error('制作合同暂不能批准：请在 Nomi 设置中填写硬预算上限'))).toBe(true)
    expect(isMissingHardBudgetError(new Error('制作合同暂不能批准：provider unavailable'))).toBe(false)
    expect(isMissingHardBudgetError('Hard spend limit is required before approval')).toBe(true)
  })

  it('points directly to the single budget setting', () => {
    expect(PRODUCTION_BUDGET_SETTINGS_TARGET).toEqual({ tab: 'ai', section: 'hard-budget' })
  })
})
