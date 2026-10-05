import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scanDictionaries } from './check-i18n-no-cost-claims.mjs'

const dict = (zh, en = {}) => ({ 'zh-CN': zh, en })

test('词典里出现谈钱断言会红，并带出 key', () => {
  const { hits } = scanDictionaries(dict({ a: { b: '本机处理 · 不花钱' } }), { owned: [], notMoney: [] })
  assert.deepEqual(hits.map((h) => `${h.locale}:${h.key}`), ['zh-CN:a.b'])
})
test('英文断言同样会红；第三方的 free 与 fixture 不误报', () => {
  const { hits } = scanDictionaries(dict({ x: '免费图床可能连不上', fixtureFoo: '不花钱' }, { y: 'Nothing was charged', z: 'Free up space' }), { owned: [], notMoney: [] })
  assert.deepEqual(hits.map((h) => h.key), ['y'])
})
test('登记在案的不报；登记了却不再命中的报 stale', () => {
  const r = scanDictionaries(dict({ a: '不花钱', b: '正常文案' }), { owned: ['a', 'b'], notMoney: [] })
  assert.deepEqual(r.hits, [])
  assert.deepEqual(r.stale, ['b'])
})
