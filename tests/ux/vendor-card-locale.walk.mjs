// 真 Electron 走查：设置 → 模型 → 供应商连接详情，卡片文字跟着界面语言走。
// 第 8 轮验收抓到英文界面的 Replicate / Runway / RunningHub 卡片底部、CTA 显示中文；豆包语音英文少了「部分音色需单独购买」。
// 不连任何真实供应商：凭证是夹具串、存进隔离的合成钥匙串；主进程装走查网络闸，公网出口一律拒绝并记账，
// 需要预检 key 的几家把地址指到本机夹具（任何请求回 200 空清单）。窗口全程在屏幕外、不抢焦点。
// 跑法：NOMI_E2E_LOCALE=en node tests/ux/vendor-card-locale.walk.mjs（缺省中文）。
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, screenshotSettled } from './_assert.mjs'
import { REQUIRED_GUARD_LAYERS, startEgressWatch } from './full-walk/egress.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const locale = process.env.NOMI_E2E_LOCALE === 'en' ? 'en' : 'zh-CN'
const prefix = locale === 'en' ? 'en' : 'zh'
const shots = path.join(root, 'docs/evidence/2026-10-08-money-copy')
fs.mkdirSync(shots, { recursive: true })
const L = locale === 'en' ? { settings: 'Settings' } : { settings: '设置' }
const HAN = /[㐀-鿿]/u
// 每家卡片上必须出现的合同语义（中文为合同原文，英文为同义）。
const CONTRACT = locale === 'en'
  ? {
      replicate: /usage and billing depend on your Replicate account/i,
      runway: /Runway account credits, subject to your Runway account/i,
      runninghub: /usage and billing depend on your RunningHub account/i,
      'volcengine-speech': /some voices must be purchased separately; the console is authoritative/i,
    }
  : {
      replicate: /用量与计费以你的 Replicate 账户为准/,
      runway: /生成按你的 Runway 账户 credits 计算，以 Runway 账户为准/,
      runninghub: /用量与计费以你的 RunningHub 账户为准/,
      'volcengine-speech': /部分音色需单独购买，以控制台为准/,
    }
const FIXTURE_KEYS = {
  replicate: 'r8_fixture-locale-walk',
  runway: 'fixture-locale-walk',
  runninghub: 'fixture-runninghub-locale-walk-key',
  'volcengine-speech': 'fixture-app:fixture-token',
}
// Replicate 存 key 不预检（first-use），且只有地址仍是官方地址才会被发布成「已接入」——所以它留官方地址，
// 之后面板健康检查发出去的那一下由网络闸拦掉（卡片显示「连不上」，文字照常）。
const KEEP_OFFICIAL_ADDRESS = new Set(['replicate'])

const fixture = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ data: [] }))
})
await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve))
const fixturePort = fixture.address().port
const egress = await startEgressWatch({ logFile: path.join(root, '.tmp', 'vendor-card-locale', `egress-${prefix}.jsonl`) })

const launched = await launchNomiApp({
  name: 'vendor-card-locale', syntheticCredentialStorage: true,
  mainRequire: [...egress.mainRequire, path.join(root, 'tests', 'ux', '_offscreenWindows.cjs')],
  env: { NODE_ENV: 'production', ...egress.env }, args: ['--disable-gpu'],
  initialLocalStorage: { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi-color-scheme': 'light', ...(locale === 'en' ? { 'nomi:locale:v1': 'en' } : {}) },
})
const { win } = launched
const results = []
try {
  await win.evaluate(async ({ keys, baseUrlHint, keepOfficial }) => {
    const catalog = window.nomiDesktop.modelCatalog
    for (const [vendorKey, apiKey] of Object.entries(keys)) {
      const vendor = catalog.listVendors().find((item) => item.key === vendorKey)
      if (!keepOfficial.includes(vendorKey)) catalog.upsertVendor({ ...vendor, baseUrlHint })
      await catalog.upsertVendorApiKey(vendorKey, { apiKey, enabled: true })
    }
  }, { keys: FIXTURE_KEYS, baseUrlHint: `http://127.0.0.1:${fixturePort}`, keepOfficial: [...KEEP_OFFICIAL_ADDRESS] })

  await win.locator(`button[aria-label*="${L.settings}"]`).first().click()
  await win.locator('[data-settings-tab-id="models"]').click()
  for (const vendorKey of Object.keys(FIXTURE_KEYS)) {
    // 连接详情页的供应商卡。展开「更换密钥」，凭证说明、占位文字和推广文字一起入镜。
    await win.locator(`[data-model-home-connection="${vendorKey}"]`).first().click()
    await win.locator('[data-model-connection-edit="apiKey"]').first().click()
    const card = win.locator('[data-model-access-entry]').first()
    const cardText = await card.innerText()
    expect(cardText).toMatch(CONTRACT[vendorKey])
    // 页头标题（供应商名）也是界面文字：火山豆包语音的种子名是中文，英文轨要过展示名边界。
    const header = await win.locator('[data-model-settings-back]').first().locator('xpath=..').innerText()
    if (locale === 'en') expect([...cardText.split('\n'), ...header.split('\n')].filter((line) => HAN.test(line))).toEqual([])
    const file = path.join(shots, `${prefix}-${vendorKey}.png`)
    await screenshotSettled(win, { path: file })
    // 推广文字在卡片最底下（模型清单长的家要滚过去），单拍一张。
    await card.evaluate((element) => element.scrollIntoView({ block: 'end' }))
    const promoFile = path.join(shots, `${prefix}-${vendorKey}-promo.png`)
    await screenshotSettled(win, { path: promoFile })
    results.push({ vendorKey, file: path.relative(root, file).replaceAll('\\', '/'), promo: path.relative(root, promoFile).replaceAll('\\', '/') })
    await win.locator('[data-model-settings-back]').first().click()
  }
  // 网络闸五层都装上、没有装失败的层，「没出网」才作数；拦下的每一次都记在账上。
  const netLog = egress.read()
  const loaded = netLog.find((entry) => entry.kind === 'guard-loaded' && entry.processType === 'browser')
  expect(REQUIRED_GUARD_LAYERS.every((layer) => loaded?.layers?.includes(layer))).toBe(true)
  expect(netLog.filter((entry) => entry.kind === 'guard-error')).toEqual([])
  const blocked = netLog.filter((entry) => entry.kind === 'blocked' || entry.kind === 'redirected')
  // 产品自带的测试网闸（NOMI_TEST_NETWORK_GUARD，electron/testNetworkGuard.ts）在更早一层就拒掉公网请求，所以这里多半是 0。
  console.log(`PASS: ${locale} vendor cards follow the UI language (walk-guard blocked entries: ${blocked.length})`)
  for (const r of results) console.log(`  ${r.vendorKey} -> ${r.file} , ${r.promo}`)
} finally {
  await launched.close()
  await egress.close()
  await new Promise((resolve) => fixture.close(resolve))
}
