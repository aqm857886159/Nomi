import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scanDictionaries, scanDictionaryKeys } from './check-i18n-no-cost-claims.mjs'

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
  const { hits } = scanDictionaries(dict({ a: '这一步会消耗模型额度', b: '预计消耗 3 额度' }, { c: 'Your paid task is not lost', d: 'This request spends model credits' }), { notMoney: [] })
  assert.deepEqual(hits.map((h) => `${h.locale}:${h.key}`), ['zh-CN:a', 'zh-CN:b', 'en:c', 'en:d'])
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
    'zh-CN:budget', 'zh-CN:spent', 'en:budget', 'en:spent',
  ])
})

test('Chinese display keys are scanned, not only mapped English values', () => {
  const { hits } = scanDictionaryKeys({ 'zh-CN': { modelDisplayText: ['Qwen3 30B（免费）'] } }, { owned: [], notMoney: [] })
  assert.deepEqual(hits.map((h) => `${h.locale}:${h.key}:${h.source}`), ['zh-CN:modelDisplayText.0:key'])
})

test('retrieval and offline transcription use action facts without a money claim', () => {
  const { hits, stale } = scanDictionaries(dict(
    { taskCenter: { row: { recoverHint: '只查结果，不重新生成' } }, offline: '在这台电脑上离线转写，不发到网上；语言自动识别' },
    { taskCenter: { row: { recoverHint: 'Only fetches the result — no new generation' } }, offline: 'Transcribe on this computer without sending it online; the language is detected automatically' },
  ))
  assert.deepEqual(hits, [])
  assert.equal(stale.includes('taskCenter.row.recoverHint'), false)
})

test('upstream error wording may be explicitly exempted with a reasoned key', () => {
  const { hits } = scanDictionaries(dict({ upstream: '供应商返回余额不足' }, { upstream: 'Provider returned insufficient balance' }), { notMoney: ['upstream'] })
  assert.deepEqual(hits, [])
})
