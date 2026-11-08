#!/usr/bin/env node
// 「界面不谈钱」门岗（2026-10-02 定，2026-10-05 前移到本地）。
// 整本中英词典里，除登记在案的例外，不许出现「免费 / 不花钱 / 不计费 / 没扣费」这类断言：
// 现在都走中转站，扣没扣钱 Nomi 不知道，界面只说事实和下一步。
// 以前这条扫描在 vitest 里，只在 Unit CI 跑，违例要上了 PR 才被拦；现在进 check:i18n，本地 gates / pre-push 都会跑到。
// 匹配器不在这里写第二份：NO_COST_CLAIMS 来自 tests/ux/full-walk/outcomeText.mjs（走查监视器同一份）。
// 例外键（NOT_MONEY / NON_MONEY_KEYS / CHARGE_RISK_DISCLOSURE_EXACT）也住在 outcomeText.mjs：本门岗按键豁免，走查监视器按同一批键从词典取值豁免——同一份事实只有一份。
//
// ⚠ 能力边界（2026-10-18 写明）：下面对「自由文本」的正则扫描是**启发式、尽力而为**，不承诺「哪里都没有金额」——
// 正则证明不了「没有」，总能再找到绕法（V-mcp 三轮验收各找到一类）。已知**不覆盖**：罗马数字（Ⅻ）等本规则没列的数字类别、
// 软连字符 U+00AD 等不可见字符、词中插入的其它符号、运行时插值（`Cost {{amount}}` 里 amount 在运行时才是 12）。
// 「确认卡上费用一行绝不印出 0 / 任何数字」这件事靠**结构**保证，不靠这里的扫描：
//   ① `runtime.capability.generationGateCost` 这一个键只认精确值（见 COST_LABEL_EXACT，在原文上逐字比较，不经规整）；
//   ② 金额只从 `reservationMaximumForDisplay`（electron/capabilityCore/approvalReceipt.ts）出，测试里钉住并有源码扫描守卫。
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CHARGE_RISK_DISCLOSURE_KEYS, NO_COST_CLAIMS, NON_MONEY_KEYS, NOT_MONEY } from '../tests/ux/full-walk/outcomeText.mjs'

export { NON_MONEY_KEYS, NOT_MONEY }

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
/** 「费用 / Cost」后面跟数字或货币符号 = 把一个金额印成事实（含 0）。未知价那一行只许精确的「费用 / Cost」，带数字一律红。 */
export const COST_NUMBER_CLAIMS = Object.freeze({
  'zh-CN': /费用.{0,8}?(?:[\d$¥￥€£零〇一二三四五六七八九十百千万两]|元|块|美元|USD|CNY|RMB)/i,
  en: /\bcost(?![a-z]).{0,8}?(?:[\d$¥￥€£]|\b(?:USD|CNY|RMB|yuan|dollars?)\b)/i,
})

/**
 * 扫描前先把文本规整成一种写法，再套**所有**规则——门岗原先在原文上直接匹配，所以只要换一种写法
 * （全角数字「１２」、换行 / 制表 / 不换行空格、零宽字符）就能绕过去（V-mcp 两轮验收各绕过一种）。
 * NFKC：全角转半角、兼容字符归一；去零宽（U+200B–U+200D、U+2060、U+FEFF）；任何空白与换行压成一个空格。
 * 白名单「整值精确等于」也在规整后比较。
 */
export function normalizeForScan(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
/** 正向花钱断言也禁止：界面不替用户断言已付费、会消耗额度或这一步的价格。 */
export const POSITIVE_SPEND_CLAIMS = Object.freeze({
  'zh-CN': /已付费|付费(?:的任务|生成|确认|验证|模型|调用)|会花钱|花钱|消耗[^。\n]{0,8}额度|预计消耗|没有免费的|花不花钱|只花那一张的钱|会消耗(?:生成|模型)?额度|花费|费用|价格|计费|扣费|充值|金币|积分|预算/,
  en: /paid (?:task|generation|model|verification|confirmation|work)|payment|pricing|price|spend\w* (?:model )?credits?|uses? (?:model )?credits?|\bcredits?\b|\bquota\b|\bbudget\b|costing about|costs? anything|no free verification|maximum cost|\bfee\b|\bcharge\b|billing|top up|est\.? .*credits|about \$\d/i,
})
/**
 * 未知价那一行的标签：确认卡的明细是「费用 / 未知」「Cost / Unknown」。只放行这个 key 的这两个**精确**值——
 * 值换成别的（带数字、带断言）照样红，不放宽别的词条。
 */
export const COST_LABEL_EXACT = Object.freeze({
  'runtime.capability.generationGateCost': Object.freeze({ 'zh-CN': '费用', en: 'Cost' }),
  // Approved APIMart account and public-rate display. Each key admits only this wording.
  'onboardingProviders.account.credits': Object.freeze({ 'zh-CN': '{{value}} 积分', en: '{{value}} credits' }),
  'onboardingProviders.account.billing': Object.freeze({ 'zh-CN': '去充值', en: 'Top up' }),
  'onboardingProviders.account.estimate': Object.freeze({ 'zh-CN': '预计 {{value}} 积分 · APIMart 公开默认价', en: 'Estimated {{value}} credits · public APIMart rate' }),
  'onboardingProviders.account.outputEstimate': Object.freeze({ 'zh-CN': '仅输出约 {{value}} 积分 · 实际按 token 结算', en: 'Output estimate: {{value}} credits · Billed by actual tokens' }),
  'onboardingProviders.account.priceUnknown': Object.freeze({ 'zh-CN': '本次价格未知', en: 'Price unavailable' }),
  'onboardingProviders.account.shortfall': Object.freeze({ 'zh-CN': '低于公开估价 {{value}} 积分', en: '{{value}} credits below the public estimate' }),
})

/**
 * 结果不明时的扣费风险提示（用户 2026-11-03 拍板保留）：只说「可能」，不断言扣没扣。
 * 和 COST_LABEL_EXACT 一样只认精确原句：去掉「可能」、改成「不会」、带数字都红；别的键写同样的话照样红。
 * 键名单的正本在 outcomeText.mjs 的 CHARGE_RISK_DISCLOSURE_KEYS（走查监视器同一份），这里对上它。
 */
const RESULT_UNKNOWN_REASON = Object.freeze({ 'zh-CN': '上一次没等到结果，可能已经扣费', en: 'The last request got no result and may have been charged.' })
export const CHARGE_RISK_DISCLOSURE_EXACT = Object.freeze({
  'generationCommon.observability.error.submissionUnknown.reason': RESULT_UNKNOWN_REASON,
  'generationCommon.observability.error.nodeInFlight.reason': RESULT_UNKNOWN_REASON,
  'generationCommon.observability.error.shotClaimed.needsReconcile.reason': RESULT_UNKNOWN_REASON,
  'generationCommon.spend.resend.unknown': Object.freeze({
    'zh-CN': '上一次没等到结果，可能已经扣费。\n再发一次可能会再扣一次钱。',
    en: 'The last request got no result and may have been charged.\nSending it again may charge you again.',
  }),
  'generationCommon.spend.resend.waiting': Object.freeze({
    'zh-CN': '上一次还没结束。\n再发一次可能会再扣一次钱。',
    en: 'The last request has not finished.\nSending it again may charge you again.',
  }),
})
if (JSON.stringify(Object.keys(CHARGE_RISK_DISCLOSURE_EXACT).sort()) !== JSON.stringify([...CHARGE_RISK_DISCLOSURE_KEYS].sort())) {
  throw new Error('CHARGE_RISK_DISCLOSURE_EXACT 和 outcomeText.mjs 的 CHARGE_RISK_DISCLOSURE_KEYS 对不上：两边的键要一样')
}

/** 设计实验室的样例串（fixture*）只在 devlab 里渲染，用户界面不出现。 */
export const isFixture = (key) => /(^|\.)fixture[A-Z]/.test(key)

const hasNotMoneyReason = (notMoney, key) => !Array.isArray(notMoney) && typeof notMoney?.[key] === 'string' && notMoney[key].trim().length > 0

/** 防止把动作事实或普通 UI 文案塞进上游错误白名单。 */
export function validateNotMoneyEntries(notMoney = NOT_MONEY, values = {}) {
  const errors = []
  for (const [key, reason] of Object.entries(notMoney ?? {})) {
    if (typeof reason !== 'string' || !reason.trim()) errors.push(`${key}: missing reason`)
    if (!/(error|err|quota|balance|rate|limited|status|account|knownVendors)/i.test(key)) errors.push(`${key}: not an error/account-status key`)
    if (/(不花钱|免费|no charge|not charged|cost nothing|free)/i.test(String(reason))) errors.push(`${key}: reason contains a money exemption`)
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      const value = String(values[key])
      if (!/(服务商|供应商|TikHub|agy|账户|额度|Provider|account|quota|balance|returned|response)/i.test(value)) errors.push(`${key}: value lacks provider/account context`)
      if (!/(请|到|换|重试|稍后|检查|充值|控制台|查看|try|retry|check|account|console|top up|switch|later)/i.test(value)) errors.push(`${key}: value lacks an actionable next step`)
    }
  }
  return errors
}

const SOURCE_NOT_MONEY = Object.freeze({
  'knownVendors.agnes.credentialHint': /Agnes.*(?:账户|account).*(?:限额|limits?)/i,
  'knownVendors.modelscope.tagline': /绑定阿里云账号使用推理额度|Link an Alibaba Cloud account for inference quota/i,
  'knownVendors.modelscope.promoText': /魔搭社区由阿里达摩院运营.*推理额度|ModelScope is operated.*inference quota/i,
  'knownVendors.fal.credentialHint': /fal\.ai Dashboard.*(?:模型额度、可用区域和价格.*当前账户|model quota, regions and pricing.*current account)/i,
  'knownVendors.runway.credentialHint': /Runway.*credits/i,
  'knownVendors.runninghub.promoText': /RunningHub.*(?:用量与计费|usage and billing).*账户|RunningHub.*usage and billing.*account/i,
  'knownVendors.replicate.promoText': /Replicate.*(?:用量与计费|usage and billing).*账户|Replicate.*usage and billing.*account/i,
})

const SOURCE_MONEY_PATTERN = /免费|不花钱|不计费|没扣费|花钱|付费|消耗[^。\n]{0,8}额度|预计消耗|花不花钱|paid task|spends? (?:model )?credits|costing about|costs? anything|no free verification|billing|pricing|price|quota|credits?/i

function stripSourceComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/.*(?=\n|$)/g, '$1')
}

export function scanSourceStrings(sources, { notMoney = NOT_MONEY } = {}) {
  const hits = []
  for (const [file, source] of Object.entries(sources ?? {})) {
    const code = stripSourceComments(source)
    const re = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g
    let match
    while ((match = re.exec(code))) {
      const value = match[2]
      if (!SOURCE_MONEY_PATTERN.test(normalizeForScan(value))) continue
      if (/不对用户断言.*花不花钱|do not assert.*whether.*cost/i.test(value)) continue
      const registration = Object.entries(SOURCE_NOT_MONEY).find(([, pattern]) => pattern.test(value))
      const key = registration?.[0] ?? `${file}:${code.slice(0, code.lastIndexOf('\n', match.index) + 1).split('\n').length}`
      if (registration && hasNotMoneyReason(notMoney, registration[0])) continue
      hits.push({ file, key, value })
    }
  }
  return { hits, stale: [] }
}

export const FIX_HINT = '界面不谈钱（#957）：只说动作事实；上游报错原文才能按理由登记到 NOT_MONEY'

const flatOf = (node, prefix = '') => Object.entries(node).flatMap(([key, value]) => (typeof value === 'string' ? [[`${prefix}${key}`, value]] : value && typeof value === 'object' ? flatOf(value, `${prefix}${key}.`) : []))

/** 返回 { hits: [{locale,key,text}]，stale: [key] }。dictionaries = { 'zh-CN': {...}, en: {...} }。 */
export function scanDictionaries(dictionaries, { notMoney = NOT_MONEY, chargeRiskExact = CHARGE_RISK_DISCLOSURE_EXACT } = {}) {
  const hits = []
  for (const locale of Object.keys(NO_COST_CLAIMS)) {
    for (const [key, value] of flatOf(dictionaries[locale] ?? {})) {
      // 结构解：这个键只认精确值，**在原文上**逐字比较（不规整、不看正则）——带插值占位、罗马数字、软连字符、任何别的值都红。
      const exact = Object.prototype.hasOwnProperty.call(COST_LABEL_EXACT, key) ? COST_LABEL_EXACT[key]
        : Object.prototype.hasOwnProperty.call(chargeRiskExact, key) ? chargeRiskExact[key] : null
      if (exact) {
        if (value !== exact[locale]) hits.push({ locale, key, text: value.slice(0, 60) })
        continue
      }
      const visibleValue = normalizeForScan(value.replace(/\{\{[^}]+\}\}/g, ''))
      const patterns = [NO_COST_CLAIMS[locale], ADDITIONAL_SPEND_CLAIMS[locale], ZERO_SPEND_CLAIMS[locale], COST_NUMBER_CLAIMS[locale], POSITIVE_SPEND_CLAIMS[locale]]
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
      const visibleValue = normalizeForScan(value.replace(/\{\{[^}]+\}\}/g, ''))
      const patterns = [NO_COST_CLAIMS[locale], ADDITIONAL_SPEND_CLAIMS[locale], ZERO_SPEND_CLAIMS[locale], COST_NUMBER_CLAIMS[locale], POSITIVE_SPEND_CLAIMS[locale]]
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
  const { hits: sourceHits } = scanSourceStrings({
    'electron/harness/context/agentContext.ts': fs.readFileSync(path.resolve('electron/harness/context/agentContext.ts'), 'utf8'),
    'src/config/knownVendors.ts': fs.readFileSync(path.resolve('src/config/knownVendors.ts'), 'utf8'),
  })
  const hits = [...valueHits, ...keyHits, ...sourceHits]
  if (!hits.length) { console.log('check:i18n-no-cost-claims OK'); return }
  for (const h of hits) console.error(`  ${h.locale} ${h.key}: ${h.text}`)
  if (hits.length) console.error(FIX_HINT)
  process.exit(1)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
