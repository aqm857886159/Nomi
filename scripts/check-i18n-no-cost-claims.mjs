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
  // 发送键上的公开约价与余额不足缺额（板 ModelSurfaces cost.send-pill / cost.hover / cost.low-balance）：每个键只认这一句。
  'generationCommon.composer.sendCost.estimate': Object.freeze({ 'zh-CN': '这次约 {{value}} 积分（{{usd}}）。按 APIMart 公开价估，出完按 APIMart 实际扣费记。', en: 'About {{value}} credits ({{usd}}) this time. Estimated at the APIMart public rate; recorded at the actual APIMart charge once done.' }),
  'generationCommon.composer.sendCost.estimateCny': Object.freeze({ 'zh-CN': '这次约 {{cny}}（{{value}} 积分）。按 APIMart 公开价与人民银行中间价（{{date}}，{{pair}}）估。出完按 APIMart 实际扣费记。', en: 'About {{cny}} ({{value}} credits). Converted at PBOC midpoint ({{date}}, {{pair}}) from the APIMart public rate. Recorded at the actual APIMart charge once done.' }),
  'generationCommon.composer.sendCost.estimateUsd': Object.freeze({ 'zh-CN': '这次约 {{usd}}（{{value}} 积分）。按 APIMart 公开价估，出完按 APIMart 实际扣费记。', en: 'About {{usd}} ({{value}} credits). Estimated at the APIMart public rate. Recorded at the actual APIMart charge once done.' }),
  'generationCommon.composer.sendCost.outputEstimate': Object.freeze({ 'zh-CN': '仅输出约 {{value}} 积分（{{usd}}）· 实际按 token 结算', en: 'Output estimate {{value}} credits ({{usd}}) · billed by actual tokens' }),
  'generationCommon.composer.sendCost.outputEstimateCny': Object.freeze({ 'zh-CN': '仅输出约 {{cny}}（{{value}} 积分）。按人民银行中间价（{{date}}，{{pair}}）估，实际按 token 结算。', en: 'Output estimate {{cny}} ({{value}} credits). Converted at PBOC midpoint ({{date}}, {{pair}}), billed by actual tokens.' }),
  'generationCommon.composer.sendCost.outputEstimateUsd': Object.freeze({ 'zh-CN': '仅输出约 {{usd}}（{{value}} 积分）。按 APIMart 公开价估，实际按 token 结算。', en: 'Output estimate {{usd}} ({{value}} credits). Estimated at the APIMart public rate, billed by actual tokens.' }),
  // 按上限预扣的约价（口径 upper-bound，今天只有图层分离；板 2026-11-26-layer-split · layers.send-price）：键上「≤」，悬停这一句。
  'generationCommon.composer.sendCost.upperBound': Object.freeze({ 'zh-CN': '最多约 {{value}} 积分（{{usd}}）。按 APIMart 公开价和层数上限估，实际按拆出的层数结算，出完按 APIMart 实际扣费记。', en: 'At most about {{value}} credits ({{usd}}). Estimated at the APIMart public rate for the layer limit; billed by the layers actually split out, recorded at the actual APIMart charge once done.' }),
  'generationCommon.composer.sendCost.upperBoundCny': Object.freeze({ 'zh-CN': '最多约 {{cny}}（{{value}} 积分）。按 APIMart 公开价、层数上限与人民银行中间价（{{date}}，{{pair}}）估，实际按拆出的层数结算，出完按 APIMart 实际扣费记。', en: 'At most about {{cny}} ({{value}} credits). Converted at PBOC midpoint ({{date}}, {{pair}}) from the APIMart public rate for the layer limit; billed by the layers actually split out, recorded at the actual APIMart charge once done.' }),
  'generationCommon.composer.sendCost.upperBoundUsd': Object.freeze({ 'zh-CN': '最多约 {{usd}}（{{value}} 积分）。按 APIMart 公开价和层数上限估，实际按拆出的层数结算，出完按 APIMart 实际扣费记。', en: 'At most about {{usd}} ({{value}} credits). Estimated at the APIMart public rate for the layer limit; billed by the layers actually split out, recorded at the actual APIMart charge once done.' }),
  'generationCommon.composer.sendCost.priceUnknown': Object.freeze({ 'zh-CN': '暂时估不出这次用量', en: 'No usage estimate yet' }),
  'generationCommon.composer.sendCost.unitCredits': Object.freeze({ 'zh-CN': '积分', en: 'Credits' }),
  'generationCommon.composer.sendCostLowBalance.shortfall': Object.freeze({ 'zh-CN': '还差 {{value}} 积分', en: 'Short {{value}} credits' }),
  'generationCommon.composer.sendCostLowBalance.topUp': Object.freeze({ 'zh-CN': '去充值', en: 'Top up' }),
  'generationCommon.composer.sendCostLowBalance.topUpAria': Object.freeze({ 'zh-CN': '去 APIMart 充值（还差 {{value}} 积分）', en: 'Top up on APIMart (short {{value}} credits)' }),
  'generationCommon.composer.sendCostLowBalance.description': Object.freeze({ 'zh-CN': '当前余额约 {{balance}} 积分，这次约需 {{need}} 积分，还差 {{shortfall}} 积分。充值后返回即可继续生成。', en: 'Current balance is about {{balance}} credits; this run needs about {{need}} credits ({{shortfall}} short). Return after topping up to continue.' }),
  'modelSetup.apimartVerification.credits': Object.freeze({ 'zh-CN': '{{value}} 积分', en: '{{value}} credits' }),
  // 图层分离 ≥50 层提醒句里的约价（板 2026-11-26-layer-split · layers.params-panel）：单位跟发送键，积分档时印这一句。
  'generationCommon.layerSplitComposer.creditsAmount': Object.freeze({ 'zh-CN': '{{value}} 积分', en: '{{value}} credits' }),
  'modelSetup.apimartVerification.connectedBalance': Object.freeze({ 'zh-CN': ' · 余额 {{value}} 积分', en: ' · Balance {{value}} credits' }),
  'modelSetup.apimartVerification.topup': Object.freeze({ 'zh-CN': '去充值', en: 'Top up' }),
  'modelSetup.apimartVerification.topupBody': Object.freeze({ 'zh-CN': 'Key 已存好，就差充值：出图和上传素材都要余额大于 0。充好后回到 Nomi 会自动再查一次。', en: 'Key saved. Images and asset uploads need a balance above zero. Top up, then return to Nomi for an automatic check.' }),
  'modelSetup.apimartVerification.opened': Object.freeze({ 'zh-CN': '已在浏览器打开 APIMart（{{time}}），注册、充值、建 Key 都在那边做。', en: 'Opened APIMart in your browser at {{time}}. Sign up, top up and create your key there.' }),
  // T-5 接入引导首屏主卡与连接 APIMart 大页（板 Onboarding 2026-11-07 Q1/Q16/Q17 与 2026-11-15 r8 用户拍板原文）：每个键只认精确原句。
  'onboardingProviders.apimartConnect.hero.cost': Object.freeze({ 'zh-CN': '$5 大约能出 470 张图（按公开价估算）', en: '$5 makes about 470 images (public-price estimate)' }),
  'onboardingProviders.apimartConnect.reasons.savingsLabel': Object.freeze({ 'zh-CN': '比官方便宜', en: 'below official prices' }),
  'onboardingProviders.apimartConnect.costLine': Object.freeze({ 'zh-CN': '$5 大约能出 470 张图（按公开价估算）', en: '$5 makes about 470 images (public-price estimate)' }),
  'onboardingProviders.apimartConnect.fineprint.savingsHeading': Object.freeze({ 'zh-CN': '比官方便宜', en: 'Below official prices' }),
  'onboardingProviders.apimartConnect.fineprint.savingsBody': Object.freeze({
    'zh-CN': '查了 7 个官方有公开价的常用模型，6 个比官方标准价便宜，多数便宜 20%。2026-11-07 和各家官方标准实时价比，同分辨率、同时长。也有更贵的：DeepSeek V4 Flash、Claude 的缓存命中；官方批量档更便宜，但要排队等结果。',
    en: '6 of 7 popular models with public official prices cost less, most by 20%. Compared with each vendor’s standard real-time price on 2026-11-07, same resolution and length. Some cost more: DeepSeek V4 Flash, Claude cache hits; official batch tiers are cheaper but queue your jobs.',
  }),
  'onboardingProviders.apimartConnect.fineprint.costBody': Object.freeze({
    'zh-CN': '按 GPT Image 2.5 的公开价估算；同样的钱约能出 25 段 5 秒视频（Seedance 2.0 Mini）。先充值、用多少扣多少，最低充值额以官网为准。',
    en: 'Estimated from GPT Image 2.5’s public price; the same money makes about 25 five-second videos (Seedance 2.0 Mini). Prepaid, pay as you go; APIMart sets the minimum top-up.',
  }),
  'onboardingProviders.apimartConnect.fineprint.refundBody': Object.freeze({
    'zh-CN': '按 APIMart 条款第 7 条：充值后 7 天内申请，5–10 个工作日到账，用掉的不退。',
    en: 'Per APIMart’s terms §7: ask within 7 days of topping up; refunds take 5–10 business days; used credit isn’t refunded.',
  }),
  'onboardingProviders.apimartConnect.fineprint.footer': Object.freeze({
    'zh-CN': '数量和价格是 2026-11-07 查的，会变，以 APIMart 官网为准。',
    en: 'Counts and prices checked 2026-11-07; they change — APIMart’s site is the reference.',
  }),
  'onboardingProviders.apimartConnect.steps.topup.label': Object.freeze({ 'zh-CN': '充值', en: 'Top up' }),
  'onboardingProviders.apimartConnect.steps.topup.hint': Object.freeze({ 'zh-CN': '按需先充值', en: 'Top up as needed' }),
  'onboardingProviders.apimartConnect.steps.topup.pathEnd': Object.freeze({ 'zh-CN': '充值', en: 'Top up' }),
  'onboardingProviders.apimartConnect.worries': Object.freeze({ 'zh-CN': '无月费 · 7 天内可退 · Key 只存本机', en: 'No monthly fee · 7-day refund · Key stays on this computer' }),
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
