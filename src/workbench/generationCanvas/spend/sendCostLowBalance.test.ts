import { describe, expect, it } from 'vitest'
import i18next from 'i18next'
import type { VendorAccountBalance } from '../../../../electron/shared/contracts/vendorAccountBalance'
import type { VendorPricePreview } from '../../../../electron/shared/contracts/vendorPricePreview'
import { enGenerationCommon, zhGenerationCommon } from '../../../i18n/locales/generationCommon'
import { resolveSendCostLowBalance } from './sendCostLowBalance'

const QUOTE: VendorPricePreview = { usd: 1, credits: 10, source: 'https://api.apimart.ai/api/pricing/model' }
const TOP_UP_URL = 'https://apimart.ai/register?aff=t55VtP'

function makeBalance(overrides: Partial<VendorAccountBalance> = {}): VendorAccountBalance {
  return {
    remainCredits: 2.4,
    remainUsd: 0.24,
    unlimited: false,
    topUpUrl: TOP_UP_URL,
    fetchedAt: 1_763_800_000_000,
    ...overrides,
  }
}

async function initT(locale: 'zh-CN' | 'en') {
  const inst = i18next.createInstance()
  await inst.init({
    lng: locale,
    resources: {
      [locale]: { translation: { generationCommon: locale === 'en' ? enGenerationCommon : zhGenerationCommon } },
    },
  })
  return inst.t.bind(inst)
}

describe('resolveSendCostLowBalance（板 ModelSurfaces cost.low-balance）', () => {
  it.each(['zh-CN', 'en'] as const)('%s：余额小于本次约价时返回精确缺额与去充值链接', async (locale) => {
    const t = await initT(locale)
    const out = resolveSendCostLowBalance(QUOTE, makeBalance({ remainCredits: 2.4 }), t, locale)
    expect(out).not.toBeNull()
    expect(out?.shortfallCredits).toBeCloseTo(7.6, 6)
    expect(out?.topUpUrl).toBe(TOP_UP_URL)
    if (locale === 'zh-CN') {
      expect(out?.shortfallText).toBe('还差 7.6 积分')
      expect(out?.topUpLabel).toBe('去充值')
      expect(out?.description).toContain('2.4')
      expect(out?.description).toContain('10')
      expect(out?.description).toContain('7.6')
    } else {
      expect(out?.shortfallText).toBe('Short 7.6 credits')
      expect(out?.topUpLabel).toBe('Top up')
    }
  })

  it('反例：余额足够、无限额度(-1)、余额未知/过期、无约价 → 一律返回 null（不拦截发送）', async () => {
    const t = await initT('zh-CN')
    expect(resolveSendCostLowBalance(QUOTE, makeBalance({ remainCredits: 10 }), t, 'zh-CN')).toBeNull()
    expect(resolveSendCostLowBalance(QUOTE, makeBalance({ remainCredits: 25 }), t, 'zh-CN')).toBeNull()
    expect(resolveSendCostLowBalance(QUOTE, makeBalance({ unlimited: true, remainCredits: null }), t, 'zh-CN')).toBeNull()
    expect(resolveSendCostLowBalance(QUOTE, makeBalance({ unlimited: true, remainCredits: 0 }), t, 'zh-CN')).toBeNull()
    expect(resolveSendCostLowBalance(QUOTE, null, t, 'zh-CN')).toBeNull()
    expect(resolveSendCostLowBalance(null, makeBalance({ remainCredits: 0 }), t, 'zh-CN')).toBeNull()
  })
})
