// APIMart Seedance 2.5 文生视频：发送键旁的约价（docs/plan/2026-11-26-apimart-price-keys.md）。
// 假价目写法同 send-cost-estimate.rehearsal.walk.mjs：APIMart 地址经 NOMI_TEST_NETWORK_REDIRECTS 指到本机回环替身，
// 替身只答公开价目的 GET，对任何非 GET 回 405，不产出媒体、不花钱。
// 步骤：金丝雀（替身日志要有一行带方法 / 路径 / 请求体）→ 选 Seedance 2.5 看键上的价 → 切回 2.0 对照 → 点一次发送键旁价格的悬停。
// 用法：先 pnpm run build；NOMI_SEEDANCE25_EVIDENCE=<目录> node tests/ux/seedance25-price.walk.mjs
//   [--locale en --scheme dark]  缺省中文浅色。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { once } from 'node:events'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { launchNomiApp } from './_launchApp.mjs'
import { buildWorld } from './_world.mjs'
import { encryptFixtureKey } from './_mcpL2Fixture.mjs'
import { clickOrFail, expectAbsent, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { addCanvasNode, newProjectEntry, switchWorkspace } from './_shell.mjs'
import { uiText } from './full-walk/invariants.mjs'

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback)
const locale = arg('--locale', 'zh-CN')
const scheme = arg('--scheme', 'light')
const output = path.resolve(process.env.NOMI_SEEDANCE25_EVIDENCE || '.tmp/seedance25-price')
fs.mkdirSync(output, { recursive: true })

/** 假价目（美元 / 秒，照 APIMart 公开价目的字段形状）。 */
const VIDEO_RATES = {
  'seedance-2.5': { '480P': 0.1201, '720P': 0.27, '1080P': 0.66825 },
  'seedance-2.0': { '480P': 0.02, '720P': 0.039, '1080P': 0.0975 },
}
const log = []
const server = http.createServer((req, res) => {
  const target = new URL(req.url, 'http://127.0.0.1')
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    const model = target.searchParams.get('model')
    log.push({ method: req.method, path: target.pathname, query: target.search, body: Buffer.concat(chunks).toString('utf8'), model })
    res.setHeader('Content-Type', 'application/json')
    if (req.method !== 'GET') { res.statusCode = 405; res.end('{"success":false}'); return }
    if (target.pathname === '/api/pricing/model' && VIDEO_RATES[model]) {
      res.end(JSON.stringify({ success: true, data: { model_name: model, billing_type: 'per_second', membership: { category: 'video' },
        resolution_enabled: true, resolution_paid_prices: VIDEO_RATES[model] } }))
    } else if (target.pathname === '/v1/models') { res.statusCode = 401; res.end('{"error":{"type":"apimart_error"}}') }
    else if (target.pathname !== '/api/pricing/model') { res.statusCode = 404; res.end('{}') }
    else res.end('{"success":false}')
  })
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const origin = `http://127.0.0.1:${server.address().port}`

// 金丝雀：替身活着，且日志里有一行带方法、路径、请求体。过不了就停，不改用函数级探针顶替。
const canaryRes = await fetch(`${origin}/api/pricing/model?model=seedance-2.5`)
assert.equal(canaryRes.status, 200, 'canary: stand-in answers the public price list')
assert(log.some((row) => row.method === 'GET' && row.path === '/api/pricing/model' && 'body' in row), 'canary: stand-in log has method, path and body')
log.length = 0

const rootDir = makeTempDir('nomi-seedance25-price-')
const userDataDir = path.join(rootDir, 'user-data')
fs.mkdirSync(userDataDir, { recursive: true })
const now = new Date().toISOString()
const keyRecord = { vendorKey: 'apimart', apiKey: encryptFixtureKey(userDataDir), enc: 'safeStorage', enabled: true, createdAt: now, updatedAt: now }
const world = buildWorld({ rootDir, encryptedApiKeys: { apimart: keyRecord } })
const options = {
  name: `seedance25-price-${locale}`, world, syntheticCredentialStorage: true,
  env: { NOMI_TEST_NETWORK_REDIRECTS: JSON.stringify([{ from: 'https://api.apimart.ai', to: origin }]) },
  initialLocalStorage: { 'nomi-color-scheme': scheme, 'nomi:locale:v1': locale, 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen',
    'nomi-onboarding-checklist:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' },
}
const { app, win } = await launchNomiApp(options)
const result = { locale, scheme }
try {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1220, 840))
  await clickOrFail(newProjectEntry(win), 'new project')
  await switchWorkspace(win, 'generation')
  await addCanvasNode(win, 'video')
  const composer = win.locator('[data-composer-host="canvas"]:visible').last()
  const send = composer.locator('[data-bar-segment="generate"]')
  const pill = send.locator('[data-send-cost="credits"]')
  const picker = composer.getByRole('button', { name: uiText(locale, 'generationCommon.parameters.model'), exact: true })
  const menu = win.locator('[data-nomi-select-dropdown]:visible').first()
  const pick = async (pattern, label) => {
    await clickOrFail(picker, `open model picker for ${label}`)
    const more = menu.getByRole('button', { name: uiText(locale, 'onboardingProviders.modelControls.more'), exact: true })
    const row = menu.getByRole('option').filter({ has: win.locator('[data-nomi-select-option-label]', { hasText: pattern }) }).first()
    const menuOpen = await proveProbe(menu, 'model menu is open')
    if (!(await row.isVisible()) && await more.isVisible().catch(() => false)) await clickOrFail(more, 'expand more models')
    await clickOrFail(row, `pick ${label}`)
    await expectAbsent(menu, { provenBy: menuOpen, message: 'model menu closes after picking' })
  }
  const credits = (usd) => String(Math.round(usd * 10 * 100) / 100)

  await pick(/^Seedance 2\.5$/, 'Seedance 2.5')
  await expectVisible(pill, 'Seedance 2.5 shows a price beside the send button')
  result.seedance25 = (await pill.innerText()).trim()
  assert.equal(result.seedance25, credits(0.27 * 5), `2.5 at 720p x 5s = fake rate 0.27 x 5 x 10, got ${result.seedance25}`)
  await screenshotSettled(win, { path: path.join(output, `${locale}-${scheme}-seedance25.png`) })

  await pick(/^Seedance 2\.0$/, 'Seedance 2.0')
  await expectVisible(pill, 'Seedance 2.0 still shows a price')
  result.seedance20 = (await pill.innerText()).trim()
  await screenshotSettled(win, { path: path.join(output, `${locale}-${scheme}-seedance20.png`) })

  assert(log.some((row) => row.method === 'GET' && row.model === 'seedance-2.5'), 'stand-in log: the 2.5 price list was read (method + path + body in log)')
  assert.equal(log.filter((row) => row.method !== 'GET').length, 0, 'only reads the public price list: no non-GET reached the stand-in')
  result.standInLog = log
  void stationTimeout
} finally {
  await app.close()
  server.closeAllConnections()
  server.close()
  fs.writeFileSync(path.join(output, `${locale}-${scheme}-result.json`), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
}
