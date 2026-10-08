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

/**
 * 付费确认卡 / 上传通道提示 / 付费验证说明归付费卡那条线：它们的文案「这一步会花钱 / 这家没有免费端点」是披露，不是断言，
 * 等那条线改完再从这张表里拿掉（拿掉之后词典里再出现就红）。表里每一条都必须真的还命中——不命中说明已经改好了，该删这一行。
 */
export const OWNED_BY_SPEND_CARD_LANE = Object.freeze([
  // 已提交任务的结果查询只轮询既有 provider task id，不发起新生成请求，也不会再次扣费。
  'taskCenter.row.recoverHint',
  'onboardingProviders.keyOnly.probeCostPaid', 'onboardingProviders.keyOnly.probeCostPaidUnpriced', 'onboardingProviders.keyOnly.probeCostUnknown',
  'generationCommon.production.checkpoint.subtitleWithReuse', 'generationCommon.production.checkpoint.note', 'generationCommon.production.checkpoint.noteWithBudget',
  'runtime.capability.credentialProbeMessage',
])
/** 词本身不是钱：导演模式画幅选项叫「Free / 自由」。 */
export const NOT_MONEY = Object.freeze(['director.aspect.free'])
/** 不能把“可用/已提交/取回”改写成零元承诺；这些变体不属于第三方额度事实白名单。 */
export const ADDITIONAL_SPEND_CLAIMS = Object.freeze({
  'zh-CN': /免费(?:解锁|上传|重取|取回)/,
  en: /\bfree (?:asset uploads?|retry|retrieve)\b/i,
})
/** 零额预算/已花费也是花钱承诺：没有真实回执时不能把未知写成 0。 */
export const ZERO_SPEND_CLAIMS = Object.freeze({
  'zh-CN': /(?:预算|已花费|已用|花费)\s*(?:为|[:：])?\s*[¥￥]?\s*0(?:\.00)?(?:\s*元)?/,
  en: /\b(?:budget|spent|spend|cost)\b[^\n]{0,16}\$\s*0(?:\.00)?\b/i,
})
/** 代码确定的本地离线能力：不联网、不发 provider 请求，因此保留“不花钱”事实。 */
export const FACTUAL_KEY_CLAIMS = Object.freeze({
  'zh-CN': new Set(['在这台电脑上离线转写，不联网、不花钱；语言自动识别']),
  en: new Set(['Transcribe on this computer, offline and free; the language is detected automatically']),
})
/** 设计实验室的样例串（fixture*）只在 devlab 里渲染，用户界面不出现。 */
export const isFixture = (key) => /(^|\.)fixture[A-Z]/.test(key)

export const FIX_HINT = '界面不谈钱（10-02）：只说事实和下一步，比如「本机处理」而不是「本机处理 · 不花钱」；必要的付费披露登记到 scripts/check-i18n-no-cost-claims.mjs 的 OWNED_BY_SPEND_CARD_LANE'

const flatOf = (node, prefix = '') => Object.entries(node).flatMap(([key, value]) => (typeof value === 'string' ? [[`${prefix}${key}`, value]] : value && typeof value === 'object' ? flatOf(value, `${prefix}${key}.`) : []))

/** 返回 { hits: [{locale,key,text}]，stale: [key] }。dictionaries = { 'zh-CN': {...}, en: {...} }。 */
export function scanDictionaries(dictionaries, { owned = OWNED_BY_SPEND_CARD_LANE, notMoney = NOT_MONEY } = {}) {
  const hits = []
  const everHit = new Set()
  for (const locale of Object.keys(NO_COST_CLAIMS)) {
    for (const [key, value] of flatOf(dictionaries[locale] ?? {})) {
      const patterns = [NO_COST_CLAIMS[locale], ADDITIONAL_SPEND_CLAIMS[locale], ZERO_SPEND_CLAIMS[locale]]
      if (!patterns.some((pattern) => pattern.test(value))) continue
      everHit.add(key)
      if (isFixture(key) || notMoney.includes(key) || owned.includes(key)) continue
      hits.push({ locale, key, text: value.slice(0, 60) })
    }
  }
  return { hits, stale: owned.filter((key) => !everHit.has(key)) }
}

/** 扫描作为中文显示文本的字典 key；模型目录会直接把它们交给 UI，不能只扫英文 value。 */
export function scanDictionaryKeys(keyDictionaries, { owned = OWNED_BY_SPEND_CARD_LANE, notMoney = NOT_MONEY } = {}) {
  const hits = []
  const everHit = new Set()
  for (const locale of Object.keys(NO_COST_CLAIMS)) {
    for (const [key, value] of flatOf(keyDictionaries[locale] ?? {})) {
      const patterns = [NO_COST_CLAIMS[locale], ADDITIONAL_SPEND_CLAIMS[locale], ZERO_SPEND_CLAIMS[locale]]
      if (!patterns.some((pattern) => pattern.test(value))) continue
      everHit.add(key)
      if (isFixture(key) || notMoney.includes(key) || owned.includes(key) || FACTUAL_KEY_CLAIMS[locale]?.has(value)) continue
      hits.push({ locale, key, text: value.slice(0, 60), source: 'key' })
    }
  }
  return { hits, stale: [] }
}

async function main() {
  const { loadDictionaries } = await import('../tests/ux/full-walk/invariants.mjs')
  const dictionaries = loadDictionaries()
  const modelDisplaySource = fs.readFileSync(path.resolve('src/i18n/locales/modelDisplayText.ts'), 'utf8')
  const modelKeys = [...modelDisplaySource.matchAll(/^\s*(['"])(.*?)\1\s*:/gm)].map(([, , value]) => value)
  const { hits: valueHits, stale: valueStale } = scanDictionaries(dictionaries)
  const { hits: keyHits } = scanDictionaryKeys({ 'zh-CN': { modelDisplayText: modelKeys } })
  const hits = [...valueHits, ...keyHits]
  const stale = valueStale
  if (!hits.length && !stale.length) { console.log('check:i18n-no-cost-claims OK'); return }
  for (const h of hits) console.error(`  ${h.locale} ${h.key}: ${h.text}`)
  for (const key of stale) console.error(`  白名单已烂：${key} 在词典里已不命中，从 OWNED_BY_SPEND_CARD_LANE 删掉这一行`)
  if (hits.length) console.error(FIX_HINT)
  process.exit(1)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
