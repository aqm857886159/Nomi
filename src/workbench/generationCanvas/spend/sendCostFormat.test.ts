import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import i18next from 'i18next'
import type { VendorPricePreview } from '../../../../electron/shared/contracts/vendorPricePreview'
import { enGenerationCommon, zhGenerationCommon } from '../../../i18n/locales/generationCommon'
import { formatCreditValue, publicEstimateUsd, sendCostDescription, sendCostPillText } from './sendCostFormat'

const amount: VendorPricePreview = { credits: 2, usd: 0.2, source: 'https://api.apimart.ai/api/pricing/model' }

/** 词典里的原文。逐字钉住在 scripts/check-i18n-no-cost-claims.mjs 的 COST_LABEL_EXACT（唯一一份登记），这里只从词典取。 */
const DICT = { 'zh-CN': zhGenerationCommon.composer.sendCost, en: enGenerationCommon.composer.sendCost } as const

describe('约价怎么印（唯一一处格式化）', () => {
  it.each(['zh-CN', 'en'] as const)('%s：整句里带积分数和美元约数；估不出时只有那一句，没有数字', async (locale) => {
    const t = i18next.createInstance()
    await t.init({ lng: locale, resources: { [locale]: { translation: { generationCommon: locale === 'en' ? enGenerationCommon : zhGenerationCommon } } } })
    const tf = t.t.bind(t) as Parameters<typeof sendCostDescription>[1]
    expect(sendCostDescription({ ...amount, usd: 1.95, credits: 19.5 }, tf, locale))
      .toBe(DICT[locale].estimate.replace('{{value}}', '19.5').replace('{{usd}}', '$1.95'))
    expect(sendCostDescription({ ...amount, usd: 0.034776, credits: 0.34776, basis: 'output-estimate' }, tf, locale))
      .toBe(DICT[locale].outputEstimate.replace('{{value}}', '0.35').replace('{{usd}}', '$0.035'))
    const unknown = sendCostDescription(null, tf, locale)
    expect(unknown).toBe(DICT[locale].priceUnknown)
    expect(unknown).not.toMatch(/\d/)
  })

  it.each(['zh-CN', 'en'])('%s：美元约数的精度，小额不印成 0', (locale) => {
    expect(publicEstimateUsd({ ...amount, usd: 0.034776, basis: 'output-estimate' }, locale)).toBe('$0.035')
    expect(publicEstimateUsd({ ...amount, usd: 0.195 }, locale)).toBe('$0.195')
    expect(publicEstimateUsd({ ...amount, usd: 0.00000651 }, locale)).toBe('$0.0000065')
  })

  it('积分数：两位小数，一分以下按两位有效数字，不印成 0；只估了输出的加「≈」', () => {
    expect(formatCreditValue(0.34776, 'en')).toBe('0.35')
    expect(formatCreditValue(0.000006, 'en')).toBe('0.000006')
    expect(formatCreditValue(1234.56, 'en')).toBe('1,234.56')
    expect(sendCostPillText({ ...amount, credits: 19.5 }, 'zh-CN')).toBe('19.5')
    expect(sendCostPillText({ ...amount, credits: 0.34776, basis: 'output-estimate' }, 'en')).toBe('≈0.35')
  })
})

/**
 * 「价格只有一个读取处、格式化只有一处」（设计卡 ★9 末段：这一类还会从哪里回来）。
 * 以后给别的发送键加约价、第二步加单位、第三步接账户时，同一件事不许在第二个地方再写一遍。
 */
describe('约价链：一个读取处、一处格式化、链上不发生成也不授权', () => {
  const root = path.resolve(__dirname, '../../../..')
  const walk = (dir: string): string[] => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const rel = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(rel)
    // 只看产品代码：*.test.* 和 *TestUtils.ts（仓库约定的测试专用件，eslint 同样按此排除）都不算。
    return /\.(ts|tsx|mjs)$/.test(entry.name) && !/\.test\.|\.node-test\.|TestUtils\./.test(entry.name) ? [rel] : []
  })
  const production = [...walk('src'), ...walk('electron')]
  const users = (pattern: RegExp) => production.filter(file => pattern.test(fs.readFileSync(path.join(root, file), 'utf8'))).sort()

  it('渲染层只有一个钩子问价，主进程只有一条 IPC 读公开价', () => {
    expect(users(/\.vendorPricePreview\b|vendorPricePreview\s*\(/)).toEqual([
      'src/workbench/generationCanvas/spend/useNodePricePreview.ts',
    ])
    expect(users(/vendor-price-preview/)).toEqual([
      'electron/ai/onboarding/onboardingIpc.ts',
      'electron/preload.ts',
    ])
    expect(users(/\breadVendorPricePreview\b/)).toEqual([
      'electron/ai/onboarding/onboardingIpc.ts',
      'electron/ai/onboarding/vendorPricePreview.ts',
    ])
    expect(users(/\bpublicPricing\b/)).toEqual([
      'electron/ai/onboarding/vendorPricePreview.ts',
      'electron/catalog/apimartVendor.ts',
      'electron/catalog/builtinVendorSeeds.ts',
    ])
  })

  it('积分数和那一句只在 sendCostFormat 印；发送键只管画', () => {
    expect(users(/from '\.\/sendCostFormat'|from '\.\.\/spend\/sendCostFormat'/)).toEqual([
      'src/workbench/generationCanvas/spend/useSendCost.ts',
    ])
    expect(users(/generationCommon\.composer\.sendCost\./)).toEqual([
      'src/workbench/generationCanvas/spend/sendCostFormat.ts',
    ])
  })

  it('约价链上的文件不碰任务提交、花钱授权、账户读取', () => {
    const chain = [
      'electron/ai/onboarding/vendorPriceRequest.ts',
      'electron/ai/onboarding/vendorPricePreview.ts',
      'electron/shared/contracts/vendorPricePreview.ts',
      'src/workbench/generationCanvas/spend/useNodePricePreview.ts',
      'src/workbench/generationCanvas/spend/useSendCost.ts',
      'src/workbench/generationCanvas/spend/sendCostFormat.ts',
    ]
    for (const file of chain) {
      const source = fs.readFileSync(path.join(root, file), 'utf8')
      const imports = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map(m => m[1])
      expect(imports.filter(spec => /runCatalogTask|taskApi|spendConfirm|approval|runner\/(?!catalogTaskActions$|generationReferenceResolver$)|capabilityCore|runTask|submit/i.test(spec)), file).toEqual([])
      expect(source.match(/\b(runCatalogTask|confirmAndRunNode|submitTask|runTask|createApproval|grantSpend|sendProfileJson)\b/g), file).toBeNull()
      expect(source.match(/account|balance|(?<!p)recharge|top.?up|shortfall|充值|余额|账户/gi), file).toBeNull()
      // 约价链上不另写一份域名：主域连不上换备用域时，价目必须跟着生成走同一个出站函数。
      expect(source.match(/https?:\/\/[^\s'"`]*(apimart|apib|aiuxu|aishuch)/gi), file).toBeNull()
    }
    const reader = fs.readFileSync(path.join(root, 'electron/ai/onboarding/vendorPricePreview.ts'), 'utf8')
    expect(reader).toMatch(/fetchVendorWithBaseFallback\(/)
    expect(reader).not.toMatch(/\bappFetch\b/)
  })
})
