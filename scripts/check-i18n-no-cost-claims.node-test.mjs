import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeForScan, scanDictionaries, scanDictionaryKeys, scanSourceStrings, validateNotMoneyEntries } from './check-i18n-no-cost-claims.mjs'

const dict = (zh, en = {}) => ({ 'zh-CN': zh, en })

test('词典里出现谈钱断言会红，并带出 key', () => {
  const { hits } = scanDictionaries(dict({ a: { b: '本机处理 · 不花钱' } }), { owned: [], notMoney: [] })
  assert.deepEqual(hits.map((h) => `${h.locale}:${h.key}`), ['zh-CN:a.b'])
})
test('英文断言同样会红；非金钱 free 只按明确 key 排除', () => {
  const { hits } = scanDictionaries(dict({ x: '免费图床可能连不上', fixtureFoo: '不花钱' }, { y: 'Nothing was charged', 'taskCenter.exportJob.diskFull': 'Free up space' }), { notMoney: [] })
  assert.deepEqual(hits.map((h) => h.key), ['x', 'y'])
})
test('所有界面花钱断言都命中，不再有 Nomi 自有白名单', () => {
  const { hits } = scanDictionaries(dict({ a: '这一步会消耗模型额度', b: '预计消耗 3 额度', e: '这一步会花钱' }, { c: 'Your paid task is not lost', d: 'This request spends model credits', e: 'Payment is required' }), { notMoney: [] })
  assert.deepEqual(hits.map((h) => `${h.locale}:${h.key}`), ['zh-CN:a', 'zh-CN:b', 'zh-CN:e', 'en:c', 'en:d', 'en:e'])
})

test('provider free quota wording is also rejected', () => {
  const { hits } = scanDictionaries(dict(
    { upload: '\u4e0a\u4f20\u901a\u9053\u514d\u8d39\u89e3\u9501', retrieve: '\u514d\u8d39\u91cd\u53d6\u7ed3\u679c', quota: '\u6bcf\u5929\u514d\u8d39\u989d\u5ea6' },
    { upload: 'Free asset uploads', retry: 'Retry for free', quota: 'Daily free quota' },
  ), { owned: [], notMoney: [] })
  assert.deepEqual(hits.map((h) => `${h.locale}:${h.key}`), [
    'zh-CN:upload', 'zh-CN:retrieve', 'zh-CN:quota', 'en:upload', 'en:retry', 'en:quota',
  ])
})

test('zero budget and zero spent wording is caught as an unsupported money claim', () => {
  const { hits } = scanDictionaries(dict(
    { budget: '预算：¥0', spent: '已花费 ¥0.00', known: '已知报价 ¥0.05' },
    { budget: 'Budget: $0', spent: 'Spent $0.00', known: 'Known price $0.05' },
  ), { owned: [], notMoney: [] })
  assert.deepEqual(hits.map((h) => `${h.locale}:${h.key}`), [
    'zh-CN:budget', 'zh-CN:spent', 'en:budget', 'en:spent', 'en:known',
  ])
})

test('Chinese display keys are scanned, not only mapped English values', () => {
  const { hits } = scanDictionaryKeys({ 'zh-CN': { modelDisplayText: ['Qwen3 30B（免费）'] } }, { owned: [], notMoney: [] })
  assert.deepEqual(hits.map((h) => `${h.locale}:${h.key}:${h.source}`), ['zh-CN:modelDisplayText.0:key'])
})

test('retrieval and offline transcription use action facts without a money claim', () => {
  const { hits, stale } = scanDictionaries(dict(
    { taskCenter: { row: { recoverHint: '只查结果，不重新生成' } }, offline: '在这台电脑上离线转写，不发到网上；语言自动识别' },
    { taskCenter: { row: { recoverHint: 'Only fetches the result — no new generation' } }, offline: 'Transcribe on this computer without sending it online; the language is detected automatically', processing: 'Estimated processing: {{credits}}' },
  ))
  assert.deepEqual(hits, [])
  assert.equal(stale.includes('taskCenter.row.recoverHint'), false)
})

test('结果不明的「可能扣费」只放行登记键的精确原句：改字、换键都红', () => {
  const chargeRiskExact = { 'card.reason': { 'zh-CN': '上一次没等到结果，可能已经扣费', en: 'Sending it again may charge you again.' } }
  const exact = scanDictionaries(dict({ card: { reason: '上一次没等到结果，可能已经扣费' } }, { card: { reason: 'Sending it again may charge you again.' } }), { notMoney: {}, chargeRiskExact })
  assert.deepEqual(exact.hits, [])
  const changed = scanDictionaries(dict({ card: { reason: '上一次没等到结果，不会扣费' } }, { card: { reason: 'Sending it again will charge you again.' } }), { notMoney: {}, chargeRiskExact })
  assert.deepEqual(changed.hits.map((h) => `${h.locale}:${h.key}`), ['zh-CN:card.reason', 'en:card.reason'])
  const otherKey = scanDictionaries(dict({ other: '再发一次可能会再扣一次钱。' }, { other: 'Sending it again may charge you again.' }), { notMoney: {}, chargeRiskExact })
  assert.deepEqual(otherKey.hits.map((h) => `${h.locale}:${h.key}`), ['zh-CN:other', 'en:other'])
})

test('upstream error wording may be explicitly exempted with a reasoned key', () => {
  const { hits } = scanDictionaries(dict({ upstream: '供应商返回余额不足' }, { upstream: 'Provider returned insufficient balance' }), { notMoney: { upstream: '转述服务商返回，不是 Nomi 对某一步花费的断言' } })
  assert.deepEqual(hits, [])
})

test('NOT_MONEY 每条都有理由且只能登记错误或账号状态 key', () => {
  assert.deepEqual(validateNotMoneyEntries({ 'provider.error.balance': '转述服务商返回，不是 Nomi 对某一步花费的断言' }), [])
  assert.deepEqual(validateNotMoneyEntries({ 'taskCenter.row.recoverHint': '转述服务商返回' }), ['taskCenter.row.recoverHint: not an error/account-status key'])
  assert.deepEqual(validateNotMoneyEntries({ 'provider.error.balance': '' }), ['provider.error.balance: missing reason'])
  assert.deepEqual(validateNotMoneyEntries({ 'provider.error.balance': '不花钱' }), ['provider.error.balance: reason contains a money exemption'])
  assert.deepEqual(validateNotMoneyEntries({ 'provider.error.balance': '服务商返回：余额不足' }, { 'provider.error.balance': '本机已处理' }), ['provider.error.balance: value lacks provider/account context', 'provider.error.balance: value lacks an actionable next step'])
})

test('源码门岗跳过注释但检查发给模型和供应商目录的固定字符串', () => {
  const { hits } = scanSourceStrings({
    'electron/harness/context/agentContext.ts': '// 会花钱\nconst prompt = "下一步会花钱"',
    'src/config/knownVendors.ts': 'const hint = "在 fal.ai Dashboard 创建 API Key。不同模型的价格、限额和可用区域以当前账户为准。"',
  }, { notMoney: { 'knownVendors.fal.credentialHint': '服务商账户前置条件，说明价格和限额由账户决定，并引导去控制台查看' } })
  assert.deepEqual(hits.map((h) => h.key), ['electron/harness/context/agentContext.ts:2'])
})

test('未知价那一行只放行精确的「费用 / Cost」，换成别的值或别的 key 照样红', () => {
  const key = 'runtime.capability.generationGateCost'
  const ok = scanDictionaries(dict({ runtime: { capability: { generationGateCost: '费用' } } }, { runtime: { capability: { generationGateCost: 'Cost' } } }), { notMoney: [] })
  assert.deepEqual(ok.hits, [], key)
  const bad = scanDictionaries(dict({ runtime: { capability: { generationGateCost: '费用 ¥0' } } }, { runtime: { capability: { generationGateCost: 'Maximum cost' } } }), { notMoney: [] })
  assert.deepEqual(bad.hits.map((h) => h.locale), ['zh-CN', 'en'])
  const other = scanDictionaries(dict({ runtime: { capability: { somethingElse: '费用' } } }), { notMoney: [] })
  assert.deepEqual(other.hits.map((h) => h.key), ['runtime.capability.somethingElse'])
})

test('未知价那一行：精确的「费用 / Cost」绿，带数字或货币符号的值一律红（整值精确判，不按包含）', () => {
  const at = (zh, en) => scanDictionaries(
    dict({ runtime: { capability: { generationGateCost: zh } } }, { runtime: { capability: { generationGateCost: en } } }), { notMoney: [] },
  ).hits.map((h) => `${h.locale}:${h.text}`)
  assert.deepEqual(at('费用', 'Cost'), [])
  for (const zh of ['费用 0', '费用：12', '费用 ¥1.25']) assert.deepEqual(at(zh, 'Cost'), [`zh-CN:${zh}`], zh)
  for (const en of ['Cost 0', 'Cost 12', 'Cost 1.25', 'Cost: $3']) assert.deepEqual(at('费用', en), [`en:${en}`], en)
  // 任何别的 key 里出现带数字的写法同样红（不只是白名单那个 key）
  const elsewhere = scanDictionaries(dict({ a: '费用 12' }, { a: 'Cost 12' }), { notMoney: [] }).hits.map((h) => h.locale)
  assert.deepEqual(elsewhere, ['zh-CN', 'en'])
})

test('规整后再扫：全角 / 换行 / 制表 / 零宽 / 中文数字 / 货币词都绕不过去；精确值与正常文案仍绿', () => {
  const zw = '\u200B'
  const at = (zh, en) => scanDictionaries(
    dict({ runtime: { capability: { generationGateCost: zh } } }, { runtime: { capability: { generationGateCost: en } } }), { notMoney: [] },
  ).hits.map((h) => h.locale)
  for (const en of ['Cost １２', 'Cost\n12', 'Cost\t12', `Cost${zw}12`, 'Cost\u00a012', 'Cost 12 USD', 'COST １.２５']) assert.deepEqual(at('费用', en), ['en'], JSON.stringify(en))
  for (const zh of ['费用 十二元', '费用\n12', `费用${zw}１２`, '费用：三块', '费用 12 CNY', '费用\u3000一百']) assert.deepEqual(at(zh, 'Cost'), ['zh-CN'], JSON.stringify(zh))
  // 白名单键在原文上逐字比较：带零宽 / 多余空白的「费用」「Cost」也不是精确值，红（不再经规整放行）
  assert.deepEqual(at(` 费用${zw}\n`, ' Cost\t'), ['zh-CN', 'en'])
  // 别的 key 里不带金额的正常文案不受影响
  const normal = scanDictionaries(dict({ a: { b: '选择模型后开始生成' } }, { a: { b: 'Pick a model to start' } }), { notMoney: [] })
  assert.deepEqual(normal.hits, [])
  assert.equal(normalizeForScan('Ｃｏｓｔ\n１２'), 'Cost 12')
})

// 结构解（2026-10-18，V-mcp 第三轮后）：generationGateCost 这一键只认精确值，在原文上逐字比较；
// 其它键的正则扫描只是尽力而为，已知不覆盖的写法记成「已知局限」，不再继续加例外。
const BYPASSES = ['Cost \u216B', 'Co\u00ADst 12', 'Cost {{amount}}']
test('白名单键上：罗马数字 / 软连字符 / 运行时插值这三个绕法必红；精确值绿', () => {
  const at = (zh, en) => scanDictionaries(
    dict({ runtime: { capability: { generationGateCost: zh } } }, { runtime: { capability: { generationGateCost: en } } }), { notMoney: [] },
  ).hits.map((h) => `${h.locale}:${h.text}`)
  assert.deepEqual(at('费用', 'Cost'), [])
  for (const en of BYPASSES) assert.deepEqual(at('费用', en), [`en:${en}`], JSON.stringify(en))
  for (const zh of ['费用 {{amount}}', '费用 \u216B', '费\u00AD用', '费用：{{amount}}']) assert.deepEqual(at(zh, 'Cost'), [`zh-CN:${zh}`], JSON.stringify(zh))
  // 带别的值（哪怕看上去无害）也红：只认精确值
  assert.deepEqual(at('费用', 'Costs'), ['en:Costs'])
})

test('已知局限（其它键）：正则扫描是启发式，这三种写法扫不到——断言「不红」只为把局限钉在测试里，别当成保证', () => {
  // 罗马数字：NFKC 后是 XII，规则里没有这一类数字；软连字符 U+00AD：词中被插入后 `cost` 词边界匹配不上；
  // 运行时插值：{{amount}} 在扫描时被去掉，真正的金额运行时才出现。要堵这些只能靠结构（精确值键 + 金额单一出口），不能再加正则。
  const other = scanDictionaries(dict({ a: { b: 'Cost' } }, { a: { b: 'Cost \u216B', c: 'Co\u00ADst 12', d: 'Cost {{amount}}' } }), { notMoney: [] })
  assert.deepEqual(other.hits, [])
})

test('only evidenced APIMart quote wording is admitted on the approved display', () => {
  const known = { onboardingProviders: { account: { estimate: '预计 {{value}} 积分 · APIMart 公开默认价' } } }
  assert.equal(scanDictionaries(dict(known)).hits.length, 0)
  assert.equal(scanDictionaries(dict({ onboardingProviders: { account: { estimate: '本次免费' } } })).hits.length, 1)
  assert.equal(scanDictionaries(dict({ arbitrary: known.onboardingProviders.account })).hits.length, 1)
})
