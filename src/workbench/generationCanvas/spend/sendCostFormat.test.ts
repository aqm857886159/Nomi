import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import i18next from 'i18next'
import type { VendorPricePreview } from '../../../../electron/shared/contracts/vendorPricePreview'
import { enGenerationCommon, zhGenerationCommon } from '../../../i18n/locales/generationCommon'
import {
  BUILTIN_USD_TO_CNY_DATE,
  BUILTIN_USD_TO_CNY_RATE,
  builtinExchangeRatePair,
  formatCreditValue,
  publicEstimateCny,
  publicEstimateUsd,
  sendCostDescription,
  sendCostPillText,
  sendCostRateNote,
  sendCostUnitOptions,
} from './sendCostFormat'

const amount: VendorPricePreview = { credits: 2, usd: 0.2, source: 'https://api.apimart.ai/api/pricing/model' }

/** 词典里的原文。逐字钉住在 scripts/check-i18n-no-cost-claims.mjs 的 COST_LABEL_EXACT（唯一一份登记），这里只从词典取。 */
const DICT = { 'zh-CN': zhGenerationCommon.composer.sendCost, en: enGenerationCommon.composer.sendCost } as const

describe('约价怎么印（唯一一处格式化：积分 / 人民币 / 美元均标约，参考汇率写出处与日期）', () => {
  it.each(['zh-CN', 'en'] as const)('%s：三种单位悬停句与估不出态均按词典输出，人民币带参考汇率出处与日期', async (locale) => {
    const t = i18next.createInstance()
    await t.init({ lng: locale, resources: { [locale]: { translation: { generationCommon: locale === 'en' ? enGenerationCommon : zhGenerationCommon } } } })
    const tf = t.t.bind(t) as Parameters<typeof sendCostDescription>[1]
    const pair = builtinExchangeRatePair(locale)

    expect(sendCostDescription({ ...amount, usd: 1.95, credits: 19.5 }, tf, locale, 'credits'))
      .toBe(DICT[locale].estimate.replace('{{value}}', '19.5').replace('{{usd}}', '$1.95'))
    expect(sendCostDescription({ ...amount, usd: 0.034776, credits: 0.34776, basis: 'output-estimate' }, tf, locale, 'credits'))
      .toBe(DICT[locale].outputEstimate.replace('{{value}}', '0.35').replace('{{usd}}', '$0.035'))

    const cnyDesc = sendCostDescription({ ...amount, usd: 1.95, credits: 19.5 }, tf, locale, 'cny')
    expect(cnyDesc).toContain(publicEstimateCny({ ...amount, usd: 1.95, credits: 19.5 }, locale))
    expect(cnyDesc).toContain(BUILTIN_USD_TO_CNY_DATE)
    expect(cnyDesc).toContain(pair)

    const usdDesc = sendCostDescription({ ...amount, usd: 1.95, credits: 19.5 }, tf, locale, 'usd')
    expect(usdDesc).toContain('$1.95')
    expect(usdDesc).toContain('19.5')

    const unknown = sendCostDescription(null, tf, locale)
    expect(unknown).toBe(DICT[locale].priceUnknown)
    expect(unknown).not.toMatch(/\d/)

    const rateNote = sendCostRateNote(tf, locale)
    expect(rateNote).toContain(BUILTIN_USD_TO_CNY_DATE)
    expect(rateNote).toContain(String(BUILTIN_USD_TO_CNY_RATE))
  })

  it.each(['zh-CN', 'en'] as const)('%s：三种单位胶囊文字都标「约」且菜单列出三项实时约数', async (locale) => {
    const t = i18next.createInstance()
    await t.init({ lng: locale, resources: { [locale]: { translation: { generationCommon: locale === 'en' ? enGenerationCommon : zhGenerationCommon } } } })
    const tf = t.t.bind(t) as Parameters<typeof sendCostDescription>[1]
    const q = { ...amount, usd: 1.95, credits: 19.5 }
    const options = sendCostUnitOptions(q, tf, locale)
    expect(options.map((o) => o.unit)).toEqual(['credits', 'cny', 'usd'])
    const approxMark = locale === 'zh-CN' ? '约 ' : '~'
    for (const option of options) {
      expect(option.formatted.startsWith(approxMark)).toBe(true)
    }
    expect(sendCostPillText(q, locale, 'credits', tf)).toBe(`${approxMark}19.5`)
    expect(sendCostPillText(q, locale, 'cny', tf)).toBe(`${approxMark}${publicEstimateCny(q, locale)}`)
    expect(sendCostPillText(q, locale, 'usd', tf)).toBe(`${approxMark}$1.95`)
  })

  it.each(['zh-CN', 'en'])('%s：美元与人民币约数的精度，小额不印成 0', (locale) => {
    expect(publicEstimateUsd({ ...amount, usd: 0.034776, basis: 'output-estimate' }, locale)).toBe('$0.035')
    expect(publicEstimateUsd({ ...amount, usd: 0.195 }, locale)).toBe('$0.195')
    expect(publicEstimateUsd({ ...amount, usd: 0.00000651 }, locale)).toBe('$0.0000065')
    expect(publicEstimateCny({ ...amount, usd: 0.2 }, locale)).toBe('¥1.34')
    expect(publicEstimateCny({ ...amount, usd: 0.0001 }, locale)).toBe('¥0.00067')
  })

  it('积分数：两位小数，一分以下按两位有效数字，不印成 0；无 t 时仍带 ≈ 约号', () => {
    expect(formatCreditValue(0.34776, 'en')).toBe('0.35')
    expect(formatCreditValue(0.000006, 'en')).toBe('0.000006')
    expect(formatCreditValue(1234.56, 'en')).toBe('1,234.56')
    expect(sendCostPillText({ ...amount, credits: 19.5 }, 'zh-CN')).toBe('≈19.5')
    expect(sendCostPillText({ ...amount, credits: 0.34776, basis: 'output-estimate' }, 'en')).toBe('≈0.35')
  })
})

/**
 * 「价格只有一个读取处、格式化只有一处」（设计卡 ★9 末段：这一类还会从哪里回来）。
 * 以后给别的发送键加约价、第二步加单位、第三步接账户时，同一件事不许在第二个地方再写一遍。
 */
describe('约价链：一个读取处、一处格式化、链上不发生成也不授权、与账户余额解耦', () => {
  const root = path.resolve(__dirname, '../../../..')
  const walk = (dir: string): string[] => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const rel = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(rel)
    // 只看产品代码（含 .ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs）：*.d.ts、*.test.* 和 *TestUtils.* 都不算。
    return /\.(?:c|m)?[jt]sx?$/.test(entry.name) && !/\.d\.[cm]?ts$|\.test\.|\.node-test\.|TestUtils\./.test(entry.name) ? [rel] : []
  })
  const production = [...walk('src'), ...walk('electron')]
  const users = (pattern: RegExp) => production.filter(file => pattern.test(fs.readFileSync(path.join(root, file), 'utf8'))).sort()

  it('渲染层只有一个钩子问价，主进程只有一条 IPC 读公开价；余额走独立钩子与 IPC', () => {
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
    expect(users(/\.vendorAccountBalance\b|vendorAccountBalance\s*\(/)).toEqual([
      'src/workbench/generationCanvas/spend/useVendorBalance.ts',
    ])
    expect(users(/vendor-account-balance/)).toEqual([
      'electron/ai/onboarding/onboardingIpc.ts',
      'electron/preload.ts',
    ])
    expect(users(/\bpublicPricing\b/)).toEqual([
      'electron/ai/onboarding/vendorPricePreview.ts',
      'electron/catalog/apimartVendor.ts',
      'electron/catalog/builtinVendorSeeds.ts',
    ])
  })

  it('美元兑人民币参考汇率全仓产品代码只有一份（sendCostFormat.ts），别处不许再写汇率名、汇率数或私调人民币格式化', () => {
    const owner = 'src/workbench/generationCanvas/spend/sendCostFormat.ts'
    // 汇率类命名（覆盖 USD/DOLLAR × CNY/RMB/YUAN 及各类 rate 命名）：再长第二份汇率或换算函数就红。
    expect(users(/\b(?:BUILTIN_USD_TO_CNY_\w+|(?:usd|dollar)_?(?:to|per|in)?_?(?:cny|rmb|yuan)\w*|(?:cny|rmb|yuan)_?(?:to|per|in)?_?(?:usd|dollar)\w*|(?:cny|rmb|yuan)_?rate\w*|exchange_?rate\w*|fx_?rate\w*)\b/i)).toEqual([owner])
    // 汇率字面量与人民币展示格式化出口：别处换个普通名字硬乘或私自 formatMoney(..., 'CNY', ...) 也红。
    const literal = new RegExp(`(?<![\\d.])${String(BUILTIN_USD_TO_CNY_RATE).replace('.', '\\.')}(?!\\d)`)
    expect(users(literal)).toEqual([owner])
    expect(users(/formatMoney\s*\([^)]*['"]CNY['"]/)).toEqual([owner])
    // 出处与日期都在：日期是 YYYY-MM-DD，菜单说明写出处名（不是「内置汇率」这种无出处的说法）。
    expect(BUILTIN_USD_TO_CNY_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(zhGenerationCommon.composer.sendCost.rateNote).toContain('人民银行中间价')
    expect(enGenerationCommon.composer.sendCost.rateNote).toContain('PBOC midpoint')
    expect(fs.readFileSync(path.join(root, owner), 'utf8')).toContain('https://www.chinamoney.com.cn/chinese/bkccpr/')
  })

  it('约价与缺额数字只在 sendCostFormat 格式化；发送键只管画', () => {
    expect(users(/from '\.\/sendCostFormat'|from '\.\.\/spend\/sendCostFormat'/)).toEqual([
      'src/workbench/generationCanvas/spend/sendCostLowBalance.ts',
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
