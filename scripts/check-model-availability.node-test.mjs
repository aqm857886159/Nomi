// `check:model-availability` 的**规则自测**（R17：加规则必须先验它会红）。
//
// 每条规则一个阳性对照（刻意写第二份判据，断言被抓到）+ 一个合法近邻（断言不被误伤）。
// 少了后者，一个「什么都判红」的规则也能通过，而假红的下场是有人把门岗关掉。
import assert from 'node:assert/strict'
import test from 'node:test'

import { READERS, VENDOR_CONNECTION_PREDICATES, scanSource } from './check-model-availability.mjs'

test('阳性对照：三种真实写过的「第二份判据」都被抓到', () => {
  const cases = [
    // 2026-09-12 P0-10：助手下拉自己拼的那一份。
    ['a.ts', 'const ok = model.enabled && model.published && vendor.hasApiKey'],
    // 2026-06-08：拔了 key 仍发请求的那一份。
    ['b.ts', 'const usable = vendor.enabled && (vendor.authType === "none" || vendor.hasApiKey) && row.published'],
    // 主进程侧：发布资格 + 凭据自己 AND 一遍。
    ['c.ts', 'const x = modelHasPublishedExecution(m, e) && apiKeyDecryptStatus(rec) === "ok"'],
  ]
  for (const [file, text] of cases) {
    assert.equal(scanSource(file, text).length, 1, `${file} 应被抓到一次`)
  }
})

test('嵌套的同一处只记最外层一条，不把一个表达式数成三条', () => {
  const found = scanSource('d.ts', 'const x = a && (b.published && c.hasApiKey) && d')
  assert.equal(found.length, 1)
})

test('合法近邻不被误伤：对象字面量、import 清单、纯角色过滤、纯凭据判断', () => {
  const neighbours = [
    // 测试夹具里的对象字面量：`published: true` 和 `hasApiKey: true` 只是相邻的属性，不是判据。
    ['fixture.ts', 'const row = { published: true, publishedModes: [], hasApiKey: true, enabled: true }'],
    // import 清单里两个名字同时出现。
    ['imports.ts', 'import { apiKeyDecryptStatus, decryptApiKeyRecord } from "./secrets"\nimport { derivePublishedExecution } from "../shared/modelPublication"'],
    // 角色过滤器：压在可用性之上的那一层，本来就该自己判。
    ['role.ts', 'const fits = model.kind === "text" && modelSupportsToolCalls(model.meta)'],
    // 读 owner 的结论 + 角色，这正是修复后的正确写法。
    ['fixed.ts', 'const rows = models.filter((m) => m.availability.usable && m.kind === "text")'],
    // 只问凭据，不碰发布/启用。
    ['cred.ts', 'const has = Boolean(vendor.hasApiKey) || vendor.authType === "none"'],
  ]
  for (const [file, text] of neighbours) {
    assert.deepEqual(scanSource(file, text), [], `${file} 不该被抓`)
  }
})

test('普查表与登记表都带得出理由，且没有空条目', () => {
  assert.ok(READERS.length >= 15, '普查表不该缩水成几条——它就是这条不变量的边界')
  for (const reader of READERS) {
    assert.ok(reader.file && reader.question.length > 4 && reader.reads, JSON.stringify(reader))
  }
  for (const [file, reason] of Object.entries(VENDOR_CONNECTION_PREDICATES)) {
    assert.ok(reason.length > 10, `${file} 的登记理由太短，理由会过期，写清楚才能被复核`)
  }
})
