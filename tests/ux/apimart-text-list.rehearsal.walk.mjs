#!/usr/bin/env node
// 文字模型列表对账（tests/ux/apimart-text-list-real.paid.mjs）的零花费演练：同一份步骤（_apimartTextChecks.mjs 的 reconcileTextList），
// 真 Electron、真主进程出站口（dist-electron/appFetch.js）、safeStorage 里那把夹具假 key；对端是本机起的一台假 APIMart 列表服务。
//
// 证什么：
//   ① 真跑读到的对端就是目录里 APIMart 那家的地址（https://api.apimart.ai）；
//   ② 请求带的是解密出来的那把 key（假服务只比对、不打印），路由是 /v1/models?expand=category&category=chat；
//   ③ 两张表对得出来：漏掉的声明进「声明了、列表没有」，同家族更新一代的进「最新一代、没声明」；Vision 标签进读图事实；
//   ④ 报告、表、行快照里都没有那把 key；列表拿不到时整场判红，不出一张空表冒充「都对上了」。
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { require as tsxRequire } from 'tsx/cjs/api'
import { expect } from './_assert.mjs'
import { createRuntimeWalk } from './agent-runtime-walk-support.mjs'
import { FIXTURE_APIMART_API_KEY } from './agent-runtime-fixture.mjs'
import { BALANCE_ROUTE, CHAT_LIST_ROUTE, apimartOriginOf, readUsedBalance, reconcileTextList } from './_apimartTextChecks.mjs'

const { APIMART_TEXT_MODELS } = tsxRequire('../../electron/catalog/apimartTexts.ts', import.meta.url)

const OMITTED = ['deepseek-v3.1-terminus', 'MiniMax-H3-Context-IR']
const EXTRA = [
  { id: 'gpt-6.2-luna', category: 'chat', capability_tags: ['Text'] },
  { id: 'gpt-5-mini', category: 'chat', capability_tags: ['Text'] },
  { id: 'text-embedding-9', category: 'chat', capability_tags: ['Embedding'] },
]
const LIST = [
  ...APIMART_TEXT_MODELS.filter((model) => !OMITTED.includes(model.modelKey)).map((model) => ({
    id: model.modelKey, object: 'model', owned_by: 'apimart', category: 'chat',
    capability_tags: model.modelKey === 'claude-opus-5-5' ? ['Text', 'Vision'] : ['Text'],
  })),
  ...EXTRA,
]

const seen = []
const server = http.createServer((request, response) => {
  seen.push({ url: request.url, keyMatches: request.headers.authorization === `Bearer ${FIXTURE_APIMART_API_KEY}` })
  const send = (status, json) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(json)) }
  if (request.headers.authorization !== `Bearer ${FIXTURE_APIMART_API_KEY}`) return send(401, { error: { message: 'bad key' } })
  if (request.method === 'GET' && request.url === CHAT_LIST_ROUTE) return send(200, { object: 'list', data: LIST })
  if (request.method === 'GET' && request.url === BALANCE_ROUTE) return send(200, { success: true, remain_balance: 10, used_balance: 1.5 })
  return send(404, { error: { message: 'no route' } })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const fakeOrigin = `http://127.0.0.1:${server.address().port}`

const walk = await createRuntimeWalk('apimart-text-list-rehearsal', { generationProvider: 'apimart' })
let failure
try {
  const { app } = await walk.start({ first: true })
  // ① 真跑那一路读出来的对端
  expect(apimartOriginOf(walk.settingsDir)).toBe('https://api.apimart.ai')
  expect(await readUsedBalance(app, { settingsDir: walk.settingsDir, origin: fakeOrigin })).toEqual({ usedBalance: 1.5, remainBalance: 10 })
  const result = await reconcileTextList({ app, settingsDir: walk.settingsDir, origin: fakeOrigin, declared: APIMART_TEXT_MODELS, outputDir: walk.outputDir })
  walk.report.textList = { ...result, markdown: undefined, rows: undefined }
  // ② 路由与鉴权
  expect(seen.map((entry) => entry.url)).toEqual([BALANCE_ROUTE, CHAT_LIST_ROUTE])
  expect(seen.every((entry) => entry.keyMatches)).toBe(true)
  // ③ 两张表 + 读图事实
  expect(result.declaredButMissing.map((row) => row.modelKey)).toEqual(OMITTED)
  expect(result.newestUndeclared.map((row) => row.id)).toEqual(['gpt-6.2-luna'])
  expect(result.visionNotClaimed).toEqual(['claude-opus-5-5'])
  expect(result.imageClaimWithoutVision).toEqual(['gemini-3.5-flash'])
  const markdown = fs.readFileSync(path.join(walk.outputDir, 'text-list.md'), 'utf8')
  expect(markdown).toContain('| gpt | 6.2 | gpt-6.2-luna | Text |')
  // ④ 列表拿不到 → 判红（对端回 401：假服务认不出 key 时就这样）
  const wrongKey = await app.evaluate(async ({ app: mainApp }, url) => {
    const { appFetch } = process.mainModule.require(`${mainApp.getAppPath()}/dist-electron/appFetch.js`)
    return (await appFetch(url)).status
  }, `${fakeOrigin}${CHAT_LIST_ROUTE}`)
  expect(wrongKey).toBe(401)
  let refused = null
  try { await reconcileTextList({ app, settingsDir: walk.settingsDir, origin: `${fakeOrigin}/missing`, declared: APIMART_TEXT_MODELS, outputDir: walk.outputDir }) }
  catch (error) { refused = String(error.message) }
  expect(refused).toContain('模型列表没拿到：HTTP 404')
  for (const file of ['text-list.md', 'text-list.rows.json']) {
    expect(fs.readFileSync(path.join(walk.outputDir, file), 'utf8').includes(FIXTURE_APIMART_API_KEY), `${file} 里没有 key`).toBe(false)
  }
  expect(JSON.stringify(walk.report).includes(FIXTURE_APIMART_API_KEY)).toBe(false)
  walk.report.verified = ['origin-from-catalog', 'route-and-key', 'two-tables', 'vision-facts', 'no-list-no-table', 'no-key-in-evidence']
} catch (error) { failure = error; process.exitCode = 1 }
finally {
  await walk.finish(failure)
  await new Promise((resolve) => server.close(resolve))
}
