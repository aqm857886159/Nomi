import type { TFunction } from 'i18next'
import type { VendorPricePreview } from '../../../../electron/shared/contracts/vendorPricePreview'
import { formatMoney } from '../../ai/v4/formatMoney'
import type { SendCostUnit } from './sendCostUnitStore'

/**
 * 美元兑人民币参考汇率——全仓产品代码里**唯一**的一份（`sendCostFormat.test.ts` 扫 src/ 与 electron/ 守，别处出现即红）。
 *
 * 为什么写死而不是从供应商拿：APIMart 公开价目 `GET /api/pricing/models/all` 每个价的 `unit` 全是 `usd_*`
 * （2026-11-23 实测 502 条：usd_per_million_tokens / usd_per_1000_queries / usd_per_second / usd_per_image /
 * usd_per_call / usd_per_million_token_hours / usd_per_minute），顶层只有 discount_ratio / membership / models，
 * 没有币种或汇率字段；它别的只读接口也只回美元与积分（1 美元 = 10 积分）。
 * 供应商不给人民币价也不给汇率，所以人民币只能是按参考汇率折的约数，界面一律标「约」并写出处与日期。
 *
 * 出处：中国人民银行授权中国外汇交易中心公布的银行间外汇市场人民币汇率中间价（USD/CNY）
 * https://www.chinamoney.com.cn/chinese/bkccpr/ ，取 2026-11-23 当日 6.7120。
 * 更新：改这里的两个值（数与日期同改），词典里的出处名不用动。
 */
export const BUILTIN_USD_TO_CNY_RATE = 6.712
export const BUILTIN_USD_TO_CNY_DATE = '2026-11-23'

export type SendCostUnitOption = {
  unit: SendCostUnit
  label: string
  formatted: string
}

/**
 * 发送键上的约价印成什么字——**唯一**的一处（键上的积分数 / 人民币 / 美元、单位切换项、悬停那一句都从这里出）。
 * 货币符号统一经 `formatMoney` 出，不手拼任何符号（`sendCostFormat.test.ts` 与 `ui-money` 守）。
 *
 * 数从哪来：主进程按 APIMart 公开价目算好的 `VendorPricePreview`（`usd` + `credits`，1 美元 = 10 积分）。
 * 小额不印成 0：一分以下按两位有效数字印。
 */
export function formatCreditValue(value: number, locale: string): string {
  return value.toLocaleString(locale, value !== 0 && Math.abs(value) < 0.01
    ? { maximumSignificantDigits: 2 } : { maximumFractionDigits: 2 })
}

export function publicEstimateUsd(quote: VendorPricePreview, locale: string): string {
  const precision = quote.usd > 0 && quote.usd < 0.001
    ? { maximumSignificantDigits: 2 } : { maximumFractionDigits: 3 }
  return formatMoney(locale, 'USD', quote.usd, precision)
}

export function publicEstimateCny(quote: VendorPricePreview, locale: string): string {
  const amount = quote.usd * BUILTIN_USD_TO_CNY_RATE
  const precision = amount > 0 && amount < 0.01
    ? { maximumSignificantDigits: 2 } : { maximumFractionDigits: 2 }
  return formatMoney(locale, 'CNY', amount, precision)
}

/** 参考汇率换算对（例如 `$1 ≈ ¥6.712`，按出处原样印到第 4 位小数），经唯一货币格式化函数出。 */
export function builtinExchangeRatePair(locale: string): string {
  const oneUsd = formatMoney(locale, 'USD', 1, { maximumFractionDigits: 0 })
  const cny = formatMoney(locale, 'CNY', BUILTIN_USD_TO_CNY_RATE, { maximumFractionDigits: 4 })
  return `${oneUsd} ≈ ${cny}`
}

/** 约价单位切换菜单里的参考汇率说明（出处 + 日期 + 换算对）。 */
export function sendCostRateNote(t: TFunction, locale: string): string {
  return t('generationCommon.composer.sendCost.rateNote', {
    date: BUILTIN_USD_TO_CNY_DATE,
    pair: builtinExchangeRatePair(locale),
  })
}

function rawAmountForUnit(quote: VendorPricePreview, locale: string, unit: SendCostUnit): string {
  if (unit === 'cny') return publicEstimateCny(quote, locale)
  if (unit === 'usd') return publicEstimateUsd(quote, locale)
  return formatCreditValue(quote.credits, locale)
}

/**
 * 键上印的约数（积分 / 人民币 / 美元均标「约」，避免误读为实扣金额）。
 * 传 `t` 时走词典（中文 `约 0.35` / `约 ¥0.25` / `约 $0.035`，英文 `~0.35` / `~¥0.25` / `~$0.035`）；
 * 未传 `t` 时退回通用符号 `≈`。
 */
export function sendCostPillText(
  quote: VendorPricePreview,
  locale: string,
  unit: SendCostUnit = 'credits',
  t?: TFunction,
): string {
  const value = rawAmountForUnit(quote, locale, unit)
  return t ? t('generationCommon.composer.sendCost.approx', { value }) : `≈${value}`
}

/** 单位切换菜单的三项（积分 / 人民币 / 美元，各自带当前实时约数）。 */
export function sendCostUnitOptions(quote: VendorPricePreview, t: TFunction, locale: string): SendCostUnitOption[] {
  return [
    { unit: 'credits', label: t('generationCommon.composer.sendCost.unitCredits'), formatted: sendCostPillText(quote, locale, 'credits', t) },
    { unit: 'cny', label: t('generationCommon.composer.sendCost.unitCny'), formatted: sendCostPillText(quote, locale, 'cny', t) },
    { unit: 'usd', label: t('generationCommon.composer.sendCost.unitUsd'), formatted: sendCostPillText(quote, locale, 'usd', t) },
  ]
}

export function sendCostUnitMenuAria(t: TFunction): string {
  return t('generationCommon.composer.sendCost.unitMenuAria')
}

export function sendCostUnitSwitchAria(quote: VendorPricePreview, t: TFunction, locale: string, unit: SendCostUnit): string {
  return t('generationCommon.composer.sendCost.unitSwitchAria', {
    amount: sendCostPillText(quote, locale, unit, t),
  })
}

/** 悬停 / 读屏那一句。`quote` 为 null = 这家走公开价、但这次估不出。 */
export function sendCostDescription(
  quote: VendorPricePreview | null,
  t: TFunction,
  locale: string,
  unit: SendCostUnit = 'credits',
): string {
  if (!quote) return t('generationCommon.composer.sendCost.priceUnknown')
  const value = formatCreditValue(quote.credits, locale)
  const usd = publicEstimateUsd(quote, locale)
  const outputOnly = quote.basis === 'output-estimate'
  if (unit === 'cny') {
    return t(outputOnly
      ? 'generationCommon.composer.sendCost.outputEstimateCny'
      : 'generationCommon.composer.sendCost.estimateCny', {
      cny: publicEstimateCny(quote, locale),
      value,
      date: BUILTIN_USD_TO_CNY_DATE,
      pair: builtinExchangeRatePair(locale),
    })
  }
  if (unit === 'usd') {
    return t(outputOnly
      ? 'generationCommon.composer.sendCost.outputEstimateUsd'
      : 'generationCommon.composer.sendCost.estimateUsd', {
      usd,
      value,
    })
  }
  return t(outputOnly
    ? 'generationCommon.composer.sendCost.outputEstimate'
    : 'generationCommon.composer.sendCost.estimate', {
    value,
    usd,
  })
}
