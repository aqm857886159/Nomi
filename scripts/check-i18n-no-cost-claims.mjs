#!/usr/bin/env node
// 「界面不谈钱」门岗（2026-10-02 定，2026-10-05 前移到本地）。
// 整本中英词典里，除登记在案的例外，不许出现「免费 / 不花钱 / 不计费 / 没扣费」这类断言：
// 现在都走中转站，扣没扣钱 Nomi 不知道，界面只说事实和下一步。
// 以前这条扫描在 vitest 里，只在 Unit CI 跑，违例要上了 PR 才被拦；现在进 check:i18n，本地 gates / pre-push 都会跑到。
// 匹配器不在这里写第二份：NO_COST_CLAIMS 来自 tests/ux/full-walk/outcomeText.mjs（走查监视器同一份）。
// 白名单只有这里一份。
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { NO_COST_CLAIMS } from '../tests/ux/full-walk/outcomeText.mjs'

/** 只有转述上游原文才可登记；每条必须说明它是服务商错误/账号状态，不是 Nomi 的花费判断。 */
export const NOT_MONEY = Object.freeze({
  'generationCommon.error.balance': '转述服务商返回，不是 Nomi 对某一步花费的断言',
  'generationCommon.error.quota': '转述服务商返回，不是 Nomi 对某一步花费的断言',
  'generationCommon.error.balance.reason': '转述服务商返回，不是 Nomi 对某一步花费的断言',
  'generationCommon.error.balance.hint': '转述服务商返回，不是 Nomi 对某一步花费的断言',
  'generationCommon.error.quota.reason': '转述服务商返回，不是 Nomi 对某一步花费的断言',
  'generationCommon.error.quota.hint': '转述服务商返回，不是 Nomi 对某一步花费的断言',
  'generationCommon.observability.error.balance': '转述服务商返回，不是 Nomi 对某一步花费的断言',
  'generationCommon.observability.error.quota': '转述服务商返回，不是 Nomi 对某一步花费的断言',
  'generationCommon.observability.error.balance.reason': '转述服务商返回，不是 Nomi 对某一步花费的断言',
  'generationCommon.observability.error.balance.hint': '转述服务商返回，不是 Nomi 对某一步花费的断言',
  'generationCommon.observability.error.quota.reason': '转述服务商返回，不是 Nomi 对某一步花费的断言',
  'generationCommon.observability.error.quota.hint': '转述服务商返回，不是 Nomi 对某一步花费的断言',
  'onboardingProviders.adapterVerification.why.balance': '转述服务商返回，不是 Nomi 对某一步花费的断言',
  'onboardingProviders.adapterVerification.why.quota': '转述服务商返回，不是 Nomi 对某一步花费的断言',
  'assetLibrary.pasteLink.errQuota': '转述 TikHub 返回，不是 Nomi 对某一步花费的断言',
  'assetLibrary.pasteLink.errRateLimited': '转述 TikHub 返回，不是 Nomi 对某一步花费的断言',
  'antigravity.errors.quota': '转述 agy 账号状态，不是 Nomi 对某一步花费的断言',
  'antigravity.check.limited': '转述 agy 账号状态，不是 Nomi 对某一步花费的断言',
  'antigravity.notice.limited': '转述 agy 账号状态，不是 Nomi 对某一步花费的断言',
  'antigravity.accountUsage': '转述 agy 账号状态，不是 Nomi 对某一步花费的断言',
})
/** 非金钱同形词：这些 key 的 free 只描述空间、方向、视图或惯用语，不表达费用。 */
export const NON_MONEY_KEYS = Object.freeze([
  'director.aspect.free',
  'taskCenter.exportJob.diskFull',
  'assetLibrary.rejectedNoDiskSpace',
  'assetLibrary.pasteLink.message',
  'settings.ai.tikhub.description',
  'settings.general.diagnostics.contentNotice',
  'director.timeline.screenshotNameFree',
  'director.timeline.toast.noSpace',
  'director.timelineInspector.freeOrientation',
  'director.camera.captureNeedsFree',
  'generationCommon.production.canvasLanding.actionFailure.ledgerWriteFailed',
])
/** 不能把“可用/已提交/取回”改写成零元承诺；这些变体也必须命中。 */
export const ADDITIONAL_SPEND_CLAIMS = Object.freeze({
  'zh-CN': /免费(?:解锁|上传|重取|取回)/,
  en: /\bfree (?:asset uploads?|retry|retrieve)\b/i,
})
/** 零额预算/已花费也是花钱承诺：没有真实回执时不能把未知写成 0。 */
export const ZERO_SPEND_CLAIMS = Object.freeze({
  'zh-CN': /(?:预算|已花费|已用|花费)\s*(?:为|[:：])?\s*[¥￥]?\s*0(?:\.00)?(?:\s*元)?/,
  en: /\b(?:budget|spent|spend|cost)\b[^\n]{0,16}\$\s*0(?:\.00)?\b/i,
})
/** 正向花钱断言也禁止：界面不替用户断言已付费、会消耗额度或这一步的价格。 */
export const POSITIVE_SPEND_CLAIMS = Object.freeze({
  'zh-CN': /已付费|付费(?:的任务|生成|确认|验证|模型|调用)|会花钱|花钱|消耗[^。\n]{0,8}额度|预计消耗|没有免费的|花不花钱|只花那一张的钱|会消耗(?:生成|模型)?额度|花费|费用|价格|计费|扣费|充值|金币|积分|预算/,
  en: /paid (?:task|generation|model|verification|confirmation|work)|payment|pricing|price|spend\w* (?:model )?credits?|uses? (?:model )?credits?|\bcredits?\b|\bquota\b|\bbudget\b|costing about|costs? anything|no free verification|maximum cost|\bfee\b|\bcharge\b|billing|top up|est\.? .*credits|about \$\d/i,
})
/** 设计实验室的样例串（fixture*）只在 devlab 里渲染，用户界面不出现。 */
export const isFixture = (key) => /(^|\.)fixture[A-Z]/.test(key)

const hasNotMoneyReason = (notMoney, key) => !Array.isArray(notMoney) && typeof notMoney?.[key] === 'string' && notMoney[key].trim().length > 0

/** 防止把动作事实或普通 UI 文案塞进上游错误白名单。 */
export function validateNotMoneyEntries(notMoney = NOT_MONEY) {
  const errors = []
  for (const [key, reason] of Object.entries(notMoney ?? {})) {
    if (typeof reason !== 'string' || !reason.trim()) errors.push(`${key}: missing reason`)
    if (!/(error|err|quota|balance|rate|limited|status|account)/i.test(key)) errors.push(`${key}: not an error/account-status key`)
    if (/(不花钱|免费|no charge|not charged|cost nothing|free)/i.test(String(reason))) errors.push(`${key}: reason contains a money exemption`)
  }
  return errors
}

export const FIX_HINT = '界面不谈钱（#957）：只说动作事实；上游报错原文才能按理由登记到 NOT_MONEY'

const flatOf = (node, prefix = '') => Object.entries(node).flatMap(([key, value]) => (typeof value === 'string' ? [[`${prefix}${key}`, value]] : value && typeof value === 'object' ? flatOf(value, `${prefix}${key}.`) : []))

/** 返回 { hits: [{locale,key,text}]，stale: [key] }。dictionaries = { 'zh-CN': {...}, en: {...} }。 */
export function scanDictionaries(dictionaries, { notMoney = NOT_MONEY } = {}) {
  const hits = []
  for (const locale of Object.keys(NO_COST_CLAIMS)) {
    for (const [key, value] of flatOf(dictionaries[locale] ?? {})) {
      const visibleValue = value.replace(/\{\{[^}]+\}\}/g, '')
      const patterns = [NO_COST_CLAIMS[locale], ADDITIONAL_SPEND_CLAIMS[locale], ZERO_SPEND_CLAIMS[locale], POSITIVE_SPEND_CLAIMS[locale]]
      if (!patterns.some((pattern) => pattern.test(visibleValue))) continue
      if (isFixture(key) || hasNotMoneyReason(notMoney, key) || NON_MONEY_KEYS.includes(key)) continue
      hits.push({ locale, key, text: value.slice(0, 60) })
    }
  }
  return { hits, stale: [] }
}

/** 扫描作为中文显示文本的字典 key；模型目录会直接把它们交给 UI，不能只扫英文 value。 */
export function scanDictionaryKeys(keyDictionaries, { notMoney = NOT_MONEY } = {}) {
  const hits = []
  for (const locale of Object.keys(NO_COST_CLAIMS)) {
    for (const [key, value] of flatOf(keyDictionaries[locale] ?? {})) {
      const visibleValue = value.replace(/\{\{[^}]+\}\}/g, '')
      const patterns = [NO_COST_CLAIMS[locale], ADDITIONAL_SPEND_CLAIMS[locale], ZERO_SPEND_CLAIMS[locale], POSITIVE_SPEND_CLAIMS[locale]]
      if (!patterns.some((pattern) => pattern.test(visibleValue))) continue
      if (isFixture(key) || hasNotMoneyReason(notMoney, key) || NON_MONEY_KEYS.includes(key)) continue
      hits.push({ locale, key, text: value.slice(0, 60), source: 'key' })
    }
  }
  return { hits, stale: [] }
}

async function main() {
  const { loadDictionaries } = await import('../tests/ux/full-walk/invariants.mjs')
  const dictionaries = loadDictionaries()
  const whitelistErrors = validateNotMoneyEntries()
  if (whitelistErrors.length) {
    for (const error of whitelistErrors) console.error(`  ${error}`)
    process.exit(1)
  }
  const modelDisplaySource = fs.readFileSync(path.resolve('src/i18n/locales/modelDisplayText.ts'), 'utf8')
  const modelKeys = [...modelDisplaySource.matchAll(/^\s*(['"])(.*?)\1\s*:/gm)].map(([, , value]) => value)
  const { hits: valueHits } = scanDictionaries(dictionaries)
  const { hits: keyHits } = scanDictionaryKeys({ 'zh-CN': { modelDisplayText: modelKeys } })
  const hits = [...valueHits, ...keyHits]
  if (!hits.length) { console.log('check:i18n-no-cost-claims OK'); return }
  for (const h of hits) console.error(`  ${h.locale} ${h.key}: ${h.text}`)
  if (hits.length) console.error(FIX_HINT)
  process.exit(1)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
