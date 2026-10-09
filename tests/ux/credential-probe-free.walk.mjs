import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 真机走查：接入页填 key → 点「保存验证」→ 出站**只有免费端点**，一次生成请求都没有。
//
// 背景（T-MO-10，用户 2026-09-22 拍板「免费探测」）：此前这一下发的是真实
// `POST /api/v1/chat/completions`（`max_tokens:1`），扣用户积分，且经 `appFetch` 直接出门、
// 没有 `grantId`，报价卡在结构上永远不可能为它出现（09-11 群反馈）。
//
// 为什么这条走查必须在真机跑：单测里「出站」是一个被 mock 的函数，钉不住**真的从这台机器
// 发出去了什么**。这里把 apimart 的接入地址指到本机的回环夹具服务器上（经
// `NOMI_LAB_TRUSTED_PRIVATE_ORIGINS` 精确放行，打包版本连读都不读这个 env），
// 夹具逐条记下真实收到的 method + path，然后断言：
//   · 恰好一次请求，`GET /v1/balance`；
//   · **零次** chat/completions（或任何生成形状的路径）；
//   · 接入页文案的**料源**（主进程策略投影 `credentialProbePlan`）在点之前就已经是 `free`。
//     （按钮上那句话本身由单测和 i18n 门岗管；这里要钉的是真机上它读到的是哪个答案。）
//
// 用法（零额度，不需要任何真 key）：node tests/ux/credential-probe-free.walk.mjs
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect } from './_assert.mjs'
import { launchNomiApp } from './_launchApp.mjs'

/** 这次走查里唯一的「上游」。它记下真实收到的每一条请求，然后按 apimart 官方形状作答。 */
const seen = []
const fixture = http.createServer((req, res) => {
  seen.push({ method: String(req.method || '').toUpperCase(), url: String(req.url || '') })
  if (req.method === 'GET' && String(req.url || '').startsWith('/v1/balance')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ success: true, remain_balance: 10.5, remain_credits: 105, used_balance: 0, used_credits: 0, unlimited_quota: false }))
    return
  }
  // 任何别的路径都应当**没人来打**。回 500 而不是 200：走查若因别的原因走到这里，
  // 我们要看到它失败，而不是让一个不该发生的请求静悄悄成功。
  res.writeHead(500, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: { message: 'fixture: unexpected endpoint', type: 'walkthrough_error' } }))
})
await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve))
const fixtureOrigin = `http://127.0.0.1:${fixture.address().port}`

const tempRoot = makeTempDir('nomi-probe-free-')
const profile = {
  tempRoot,
  settingsDir: path.join(tempRoot, 'settings'),
  userDataDir: path.join(tempRoot, 'user-data'),
  projectsDir: path.join(tempRoot, 'projects'),
  capabilityDir: path.join(tempRoot, 'capability'),
}
for (const dir of [profile.settingsDir, profile.userDataDir, profile.projectsDir, profile.capabilityDir]) {
  fs.mkdirSync(dir, { recursive: true })
}

let app
try {
  const launched = await launchNomiApp({
    name: 'probe-free',
    tempRoot: profile.tempRoot,
    userDataDir: profile.userDataDir,
    settingsDir: profile.settingsDir,
    projectsDir: profile.projectsDir,
    capabilityDir: profile.capabilityDir,
    env: { NODE_ENV: 'production', NOMI_LAB_TRUSTED_PRIVATE_ORIGINS: fixtureOrigin },
    args: ['--no-proxy-server', '--disable-gpu'],
    // 这把 key 是合成的占位串，不是秘密；Linux CI 没有桌面钥匙串，显式选用隔离的
    // 合成凭据存储（见 _launchApp.mjs 的 withLinuxSyntheticCredentialStorage）。
    syntheticCredentialStorage: true,
    settleMs: 0,
  })
  app = launched.app
  const win = launched.win
  await win.waitForLoadState('domcontentloaded')
  await win.evaluate(() => {
    localStorage.setItem('nomi-color-scheme', 'light')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  await win.reload()
  await win.waitForLoadState('domcontentloaded')

  // 把 apimart 的接入地址指到回环夹具上。凭据探测读的就是 vendor.baseUrlHint，
  // 于是这条走查看见的「出站」就是真机这一刻真正发出去的那一条。
  await win.evaluate((origin) => {
    window.nomiDesktop.modelCatalog.upsertVendor({ key: 'apimart', name: 'APIMart', baseUrlHint: origin, authType: 'bearer', authHeader: 'Authorization', providerKind: 'openai-compatible' })
  }, fixtureOrigin)

  // 接入页在**点之前**就该说清这一下花不花钱。
  const plan = await win.evaluate(() => window.nomiDesktop.modelCatalog.credentialProbePlan('apimart'))
  console.log(`  探测策略投影：cost=${plan?.cost} amount=${plan?.amount}`)
  expect(plan?.cost, 'apimart 已经有免费端点了，接入页却读到它要花钱').toBe('free')

  const before = seen.length
  const result = await win.evaluate(() => window.nomiDesktop.modelCatalog.upsertVendorApiKey('apimart', { apiKey: 'sk-walkthrough-not-a-real-key-000', enabled: false }))
  const during = seen.slice(before)
  console.log(`  保存验证的真实出站：${during.map((r) => `${r.method} ${r.url}`).join(' | ') || '（零次）'}`)
  console.log(`  verificationPending=${result?.verificationPending}`)

  const generationShaped = during.filter((r) => /(chat\/completions|\/completions|\/generations|\/v1\/messages|\/responses)/i.test(r.url))
  expect(generationShaped.length, `保存验证发出了生成请求（花用户的钱）：${generationShaped.map((r) => `${r.method} ${r.url}`).join(', ')}`).toBe(0)
  expect(during.length, `保存验证的出站次数不是 1：${during.map((r) => `${r.method} ${r.url}`).join(', ')}`).toBe(1)
  expect(during[0].method, '免费探测不该是 POST').toBe('GET')
  expect(during[0].url.startsWith('/v1/balance'), `免费探测打的不是余额端点，而是 ${during[0].url}`).toBe(true)

  console.log(`\n✅ 凭据免费探测走查通过：保存验证只打了 ${during[0].method} ${during[0].url}，零次生成请求。`)
  await app.close().catch(() => {})
  fixture.close()
  process.exit(0)
} catch (error) {
  console.log(`\n✖ ${error?.stack || error?.message || error}`)
  console.log(`  夹具收到的全部请求：${seen.map((r) => `${r.method} ${r.url}`).join(' | ') || '（零次）'}`)
  await app?.close().catch(() => {})
  fixture.close()
  process.exit(1)
}
