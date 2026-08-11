// R13 走查 —— 供应商连接健康（2026-08-11，替掉「已保存 · 未测试」那条死路）。
// 用法: pnpm run build && node tests/ux/vendor-connection-health.walk.mjs
// 产出: tests/ux/shots/vendor-health/*.png —— 人眼判断四态胶囊 + 失败态的原因/重新检查。
//
// 三种上游全由本地 mock 造，零额度、不碰外网、结果确定：
//   /ok   → 200 + 模型列表  → 胶囊「已连通」（绿点）
//   /bad  → 401 + 上游原话  → 胶囊「连不上」（红底）+ 展开后原因 + 「重新检查」
//   /none → 404            → 胶囊「已保存」（灰点）+ 展开后「这家没有可预检的接口…」
//
// 回归底线（旧实现的两个 bug）：
//   ② 关掉面板重开，已连通的家不许退回「检查中/未测试」
//   ④ 整个界面不许再出现「未测试」「暂不支持自动测试」
import { launchNomiApp } from './_launchApp.mjs'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/vendor-health')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })
const userData = path.join(repoRoot, '.tmp', 'nomi-vendor-health-userdata')
fs.rmSync(userData, { recursive: true, force: true })
fs.mkdirSync(userData, { recursive: true })
const projectsDir = path.join(userData, 'projects')
fs.mkdirSync(projectsDir, { recursive: true })

let failures = 0
function check(cond, label) {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`)
  if (!cond) failures += 1
}

// ── 本地 mock 上游 ────────────────────────────────────────────────────────────
const hits = []
const server = http.createServer((req, res) => {
  hits.push(req.url)
  const send = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  if (req.url?.startsWith('/ok/')) return send(200, { data: [{ id: 'mock-image-1' }, { id: 'mock-video-1' }] })
  if (req.url?.startsWith('/bad/')) return send(401, { error: { message: 'API key 无效或已过期' } })
  return send(404, { error: { message: 'not found' } })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`
console.log(`mock 上游: ${base}`)

let n = 0
async function snap(win, name) {
  n += 1
  await win.screenshot({ path: path.join(shotsDir, `${String(n).padStart(2, '0')}-${name}.png`) })
  console.log(`  · shot ${String(n).padStart(2, '0')}-${name}`)
}

// 模型设置浮层只在 studio 内——app 开在项目库首页时要先点进一个项目
// （wire-protocol-walkthrough 同款；漏了这步会一直找不到「模型接入」）。
async function enterStudioOnce(win) {
  if ((await win.locator('[aria-label="打开模型接入"]').count()) > 0) return
  if ((await win.locator('button', { hasText: '模型接入' }).count()) > 0) return
  // 项目库首页 →「新建空白项目」进工作台（同 smoke.e2e.mjs）。模型设置浮层只在 studio 内。
  const card = win.getByText('新建空白项目', { exact: false }).first()
  if (await card.count()) {
    await card.click({ timeout: 6000 }).catch(() => {})
    await win.waitForTimeout(4000)
  }
}

async function openPanel(win) {
  await enterStudioOnce(win)
  const trigger = win.locator('[aria-label="打开模型接入"], button:has-text("模型接入")').first()
  if (await trigger.count()) await trigger.click({ timeout: 4000 }).catch(() => {})
  await win.waitForTimeout(900)
  return (await win.locator('text=模型设置').count()) > 0
}

async function closePanel(win) {
  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(600)
}

/** 某家卡片头部那颗状态胶囊的文字。 */
async function pillOf(win, vendorName) {
  const card = win.locator('button', { hasText: vendorName }).first()
  if (!(await card.count())) return ''
  return (await card.innerText().catch(() => '')).replace(/\s+/g, ' ')
}

// 必需 env（NOMI_E2E + NOMI_E2E_ALLOW_MULTI_INSTANCE）由 _launchApp.mjs 统一注入。
const { app, win } = await launchNomiApp({
  name: 'vendor-connection-health',
  userDataDir: userData,
  settingsDir: userData,
  projectsDir,
})

await win.evaluate(() => {
  for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
    window.localStorage.setItem(k, 'seen')
  }
  // 主流程钉成亮色：默认是「天黑自动暗」，傍晚跑走查会全程暗色，亮色那套 token 就没人看过。
  window.localStorage.setItem('nomi-color-scheme', 'light')
})
await win.reload()
await win.waitForTimeout(1200)
for (let i = 0; i < 6; i++) {
  const skip = win.locator('button, [role="button"], a', { hasText: /跳过|开始创作|进入|完成/ }).first()
  if (await skip.count()) await skip.click({ timeout: 1200 }).catch(() => {})
  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(300)
}

console.log('\n— 把三家内置供应商指向 mock 上游（造出三种状态）—')
const wired = await win.evaluate((baseUrl) => {
  const mc = window.nomiDesktop?.modelCatalog
  if (!mc) return null
  const plan = [
    ['apimart', `${baseUrl}/ok`],
    ['kie', `${baseUrl}/bad`],
    ['modelscope', `${baseUrl}/none`],
  ]
  for (const [key, url] of plan) {
    mc.upsertVendor({ key, baseUrlHint: url })
    mc.upsertVendorApiKey(key, { apiKey: 'sk-walkthrough', enabled: true })
  }
  return mc.listVendors().filter((v) => plan.some(([k]) => k === v.key)).map((v) => ({ key: v.key, baseUrl: v.baseUrlHint, hasApiKey: v.hasApiKey }))
}, base)
console.log('  ', JSON.stringify(wired))
check(Array.isArray(wired) && wired.length === 3 && wired.every((v) => v.hasApiKey), '三家都已配好地址 + key')

console.log('\n— J1 打开模型面板，等自动检查落地 —')
if (!(await openPanel(win))) { console.log('  ✗ 面板没打开'); server.close(); await app.close(); process.exit(1) }
await win.waitForTimeout(2500)
await snap(win, 'panel-three-states')

const apimartRow = await pillOf(win, 'APIMart')
const kieRow = await pillOf(win, 'KIE')
const modelscopeRow = await pillOf(win, '魔搭')
console.log(`   APIMart:    ${apimartRow}`)
console.log(`   KIE:        ${kieRow}`)
console.log(`   ModelScope: ${modelscopeRow}`)
check(apimartRow.includes('已连通'), 'mock 200 的家 → 胶囊「已连通」')
check(kieRow.includes('连不上'), 'mock 401 的家 → 胶囊「连不上」')
check(modelscopeRow.includes('已保存') && !modelscopeRow.includes('未测试'), 'mock 404 的家 → 胶囊「已保存」')

const bodyText = (await win.locator('body').innerText()).replace(/\s+/g, ' ')
check(!bodyText.includes('未测试'), '整个面板不再出现「未测试」')
check(!bodyText.includes('暂不支持自动测试'), '整个面板不再出现「暂不支持自动测试」')

console.log('\n— J2 展开「连不上」那家：要有具体原因 + 重新检查 —')
const kieCard = win.locator('button', { hasText: 'KIE' }).first()
await kieCard.scrollIntoViewIfNeeded().catch(() => {})
await kieCard.click({ timeout: 2500 }).catch(() => {})
await win.waitForTimeout(700)
await snap(win, 'unreachable-expanded')
const afterExpand = (await win.locator('body').innerText()).replace(/\s+/g, ' ')
check(afterExpand.includes('API key 无效或已过期'), '红块里是上游那句人话，不是「连接测试失败」四个字')
const recheckBtn = win.locator('button', { hasText: '重新检查' }).first()
check((await recheckBtn.count()) > 0, '失败态给了「重新检查」按钮（旧实现整张卡没有任何测试入口）')

console.log('\n— J3 点「重新检查」应真的再打一次上游 —')
const hitsBefore = hits.length
if (await recheckBtn.count()) {
  await recheckBtn.click({ timeout: 2500 }).catch(() => {})
  await win.waitForTimeout(2000)
}
check(hits.length > hitsBefore, '「重新检查」真的重探了（不是死按钮）')
await snap(win, 'after-recheck')

console.log('\n— J4 展开「已保存」那家：要诚实说明为什么没法预检 —')
await kieCard.click({ timeout: 2500 }).catch(() => {})
await win.waitForTimeout(400)
const msCard = win.locator('button', { hasText: '魔搭' }).first()
await msCard.scrollIntoViewIfNeeded().catch(() => {})
await msCard.click({ timeout: 2500 }).catch(() => {})
await win.waitForTimeout(700)
await snap(win, 'unsupported-expanded')
const msText = (await win.locator('body').innerText()).replace(/\s+/g, ' ')
check(msText.includes('第一次生成时才知道通不通'), '不支持预检的家给了诚实说明，不甩「暂不支持」')

console.log('\n— J5 关掉面板重开：已连通的家不许退回「检查中/未测试」（旧 bug ②）—')
await closePanel(win)
await win.waitForTimeout(600)
if (!(await openPanel(win))) { console.log('  ✗ 面板没重开'); }
await win.waitForTimeout(400)
const apimartAfterReopen = await pillOf(win, 'APIMart')
console.log(`   重开后 APIMart: ${apimartAfterReopen}`)
check(apimartAfterReopen.includes('已连通'), '重开面板后仍是「已连通」，没退回')
await snap(win, 'reopen-no-regression')

console.log('\n— 暗色 —')
await win.evaluate(() => window.localStorage.setItem('nomi-color-scheme', 'dark'))
await win.reload()
await win.waitForTimeout(1400)
for (let i = 0; i < 4; i++) { await win.keyboard.press('Escape').catch(() => {}); await win.waitForTimeout(300) }
if (await openPanel(win)) {
  await win.waitForTimeout(2500)
  await snap(win, 'dark-three-states')
  const darkKie = win.locator('button', { hasText: 'KIE' }).first()
  if (await darkKie.count()) {
    await darkKie.scrollIntoViewIfNeeded().catch(() => {})
    await darkKie.click({ timeout: 2500 }).catch(() => {})
    await win.waitForTimeout(700)
    await snap(win, 'dark-unreachable-expanded')
  }
}

console.log(`\n${failures === 0 ? '✅' : '❌'} ${n} shots → ${path.relative(repoRoot, shotsDir)}；失败断言 ${failures}`)
server.close()
await app.close()
process.exit(failures === 0 ? 0 : 1)
