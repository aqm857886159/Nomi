// 「元素拆解」UI 全链路 R13 走查（Playwright 驱动隔离 Electron，不碰真实桌面 → 不抢前台）。
// 验之前 computer-use 没干净跑完的渲染层链路：
//  A 引导：未接 Replicate 点「拆解元素」→ 引导确认卡(去接入)→ 打开模型接入面板（人眼判断截图）
//  B 真拆解：注入 key → 点「拆解元素」→ 付费确认卡 → 真 Replicate 出层 → 白板 modal 开 + leafer 挂载
//    → 拖动一层 → 关闭合成回图。会花真实额度(约$0.05)。缺 token 只跑 A（零额度）。
// DEV 模式：起 vite(127.0.0.1:5273) → electron 连 dev（真 import /src 才能注入 store 造图片节点，
//   绕开「普通图片节点只能生成不能上传」）。
// 用法: REPLICATE_API_TOKEN=r8_... node tests/ux/decompose-ui.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { screenshotSettled } from './_assert.mjs'

const repoRoot = process.cwd()
const TOKEN = process.env.REPLICATE_API_TOKEN || ''
const FIXTURE = path.join(repoRoot, '.tmp', 'decompose-fixture.jpg')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/decompose-ui')
fs.mkdirSync(shotsDir, { recursive: true })
if (!fs.existsSync(FIXTURE)) { console.log('缺 .tmp/decompose-fixture.jpg'); process.exit(1) }
const dataUrl = `data:image/jpeg;base64,${fs.readFileSync(FIXTURE).toString('base64')}`

const userData = path.join(repoRoot, '.tmp', 'nomi-decompose-ui')
const projectsDir = path.join(repoRoot, '.tmp', 'nomi-decompose-ui-projects')
for (const d of [userData, projectsDir]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }) }

const results = []
let n = 0
function check(name, ok, detail) { results.push({ name, ok }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`) }

function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => { res.destroy(); resolve(true) })
      req.on('error', () => { if (Date.now() > deadline) reject(new Error('vite 未就绪')); else setTimeout(tick, 400) })
      req.setTimeout(1500, () => { req.destroy() })
    }
    tick()
  })
}
console.log('  … 启动 vite dev server …')
const vite = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5273'], { cwd: repoRoot, env: { ...process.env }, stdio: 'ignore' })
await waitForUrl('http://127.0.0.1:5273', 60000).catch((e) => console.error('vite 启动失败', e))

const consoleErrors = []
const { app, win: _initialWin } = await launchNomiApp({
  name: 'decompose-ui',
  userDataDir: userData,
  projectsDir,
  settleMs: 0,
  env: { NOMI_DESKTOP_DEV: '1', VITE_DEV_SERVER_URL: 'http://127.0.0.1:5273' },
})
let win = _initialWin
const getWin = () => {
  const live = app.windows().filter((w) => { try { return !w.isClosed() && !w.url().startsWith('devtools://') } catch { return false } })
  win = live.find((w) => { try { return /projectId=/.test(w.url()) } catch { return false } }) || live[live.length - 1] || win
  return win
}
// DevTools/CDP 已知噪声（非应用错误）：Autofill.*（CDP 缺命令）、devtools:// 主题资源、
// 以及无 URL 上下文的「Failed to load resource」（真实资源失败由 failedUrls 单独抓，带 URL 才可判）。
const NOISE = /Autofill\.|Request Autofill|devtools:|Failed to load resource/
const URL_NOISE = /Autofill|devtools:/
function wire(w) {
  w.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) consoleErrors.push(m.text()) })
  w.on('pageerror', (e) => { if (!NOISE.test(e.message)) consoleErrors.push(`pageerror: ${e.message}`) })
}
wire(win); app.on('window', wire)
const failedUrls = []
const onFail = (r) => { const u = r.url(); if (!URL_NOISE.test(u)) failedUrls.push(`${r.failure()?.errorText || '?'} ${u.slice(0, 80)}`) }
app.on('window', (w) => w.on('requestfailed', onFail))
win.on('requestfailed', onFail)
async function snap(name) { n += 1; try { await screenshotSettled(getWin(), { path: path.join(shotsDir, `${String(n).padStart(2, '0')}-${name}.png`) }) } catch { /* */ } }
async function dismiss() {
  for (let i = 0; i < 6; i++) {
    const skip = getWin().locator('button, [role="button"], a', { hasText: /跳过|完成|知道了|开始创作|稍后|关闭/ }).first()
    if (await skip.count()) await skip.click({ timeout: 700 }).catch(() => {})
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(180)
  }
}

// 选中已注入图片节点 → AI 编辑 → 拆解元素
async function clickDecompose() {
  const aiEdit = getWin().locator('[aria-label="AI 编辑"]').first()
  await aiEdit.click({ timeout: 5000 })
  await getWin().waitForTimeout(400)
  await getWin().locator('[role="menuitem"]', { hasText: /拆解元素/ }).first().click({ timeout: 4000 })
  await getWin().waitForTimeout(600)
}

try {
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(2000)
  await win.evaluate(() => localStorage.setItem('nomi-color-scheme', 'light'))
  await win.reload(); await win.waitForTimeout(1800)
  await dismiss()

  await getWin().locator('button, [role="button"]', { hasText: '新建空白项目' }).first().click({ timeout: 4000 }).catch(() => {})
  await dismiss(); await getWin().waitForTimeout(1200)
  check('新建并进入项目', Boolean((/projectId=([^&]+)/.exec(getWin().url()) || [])[1]))
  await getWin().locator('button, [role="button"], [role="tab"]', { hasText: /^生成$/ }).first().click({ timeout: 4000 }).catch(() => {})
  await getWin().waitForTimeout(900); await dismiss(); await getWin().waitForTimeout(400)

  // 经 store import 注入一个带结果图的图片节点（绕开建节点/上传 UI）
  const injected = await getWin().evaluate(async (url) => {
    const m = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
    const store = m.useGenerationCanvasStore.getState()
    const created = store.addNode({ kind: 'image', title: '测试图', position: { x: 240, y: 180 } })
    store.updateNode(created.id, { result: { type: 'image', url }, meta: { imageWidth: 640, imageHeight: 800 } })
    store.selectNode(created.id)
    return created.id
  }, dataUrl).catch((e) => `ERR:${String(e).slice(0, 120)}`)
  await getWin().waitForTimeout(1200)
  check('注入带图的图片节点', typeof injected === 'string' && !injected.startsWith('ERR'), String(injected))
  await snap('node-injected')
  const hasToolbar = (await getWin().locator('[aria-label="AI 编辑"]').count()) > 0
  if (!hasToolbar) { // 节点可能未选中，点一下卡片图
    await getWin().locator('[data-node-id] img').first().click({ timeout: 2000 }).catch(() => {})
    await getWin().waitForTimeout(500)
  }
  check('出现 AI 编辑工具条', (await getWin().locator('[aria-label="AI 编辑"]').count()) > 0)

  // ── A 引导（未接 Replicate）──
  await clickDecompose()
  const guide = getWin().locator('text=需要先接入 Replicate').first()
  const guideSeen = await guide.isVisible({ timeout: 5000 }).catch(() => false)
  check('A 未接入 → 弹「需要先接入 Replicate」引导卡', guideSeen)
  await snap('guide-dialog')
  if (guideSeen) {
    await getWin().locator('[data-confirm-dialog-confirm="true"]').first().click({ timeout: 3000 }).catch(() => {})
    await getWin().waitForTimeout(1000)
    const onboard = (await getWin().locator('text=/接入生成模型|模型设置|可接入|已接入/').count()) > 0
    check('A 点「去接入」→ 打开模型接入面板', onboard)
    await snap('onboarding-opened')
    await dismiss(); await getWin().waitForTimeout(400)
  }

  // ── B 真拆解（注入 key）──
  if (!TOKEN) {
    console.log('  · 无 REPLICATE_API_TOKEN，跳过 B（真拆解）。')
  } else {
    await getWin().evaluate((key) => window.nomiDesktop.modelCatalog.upsertVendorApiKey('replicate', { apiKey: key, enabled: true }), TOKEN)
    await getWin().waitForTimeout(500)
    // 重新选中节点
    await getWin().locator('[data-node-id] img').first().click({ timeout: 3000 }).catch(() => {})
    await getWin().waitForTimeout(400)
    await clickDecompose()
    const spendConfirm = getWin().locator('button', { hasText: /^拆解$/ }).first()
    const spendSeen = await spendConfirm.isVisible({ timeout: 3000 }).catch(() => false)
    check('B 已接入 → 弹付费确认卡', spendSeen)
    await snap('spend-confirm')
    if (spendSeen) {
      await spendConfirm.click({ timeout: 3000 }).catch(() => {})
      console.log('  · 真 Replicate 拆解中（约 20-50s + 落盘）…')
      const modal = getWin().locator('[data-nomi-whiteboard-modal="true"]').first()
      const modalSeen = await modal.waitFor({ state: 'visible', timeout: 120000 }).then(() => true).catch(() => false)
      check('B 拆解完 → 白板 modal 打开', modalSeen)
      await getWin().waitForTimeout(1800)
      const leafer = (await getWin().locator('[aria-label="Leafer 画板"]').count()) > 0
      check('B 白板 leafer 挂载（拆出层已渲染，见截图）', modalSeen && leafer)
      await snap('whiteboard-layers')
      const lbox = await getWin().locator('[aria-label="Leafer 画板"]').first().boundingBox().catch(() => null)
      if (lbox) {
        const cx = lbox.x + lbox.width / 2, cy = lbox.y + lbox.height / 2
        await getWin().mouse.move(cx, cy); await getWin().mouse.down()
        for (const [dx, dy] of [[-60, -30], [-150, -70], [-240, -120]]) { await getWin().mouse.move(cx + dx, cy + dy); await getWin().waitForTimeout(70) }
        await getWin().mouse.up(); await getWin().waitForTimeout(800)
        await snap('layer-dragged')
        check('B 拖动一层无异常（分离见截图）', true)
      }
      await getWin().keyboard.press('Escape').catch(() => {})
      await getWin().locator('[aria-label="关闭画板"], button[title="关闭"]').first().click({ timeout: 2000 }).catch(() => {})
      await getWin().waitForTimeout(2500)
      await snap('flattened-back')
      check('B 关闭白板回画布（合成回图，见截图）', (await getWin().locator('[data-nomi-whiteboard-modal="true"]').count()) === 0)
    }
  }

  check('全程零 console error / 资源失败（已滤 DevTools 噪声）', consoleErrors.length === 0 && failedUrls.length === 0, [...consoleErrors, ...failedUrls].slice(0, 4).join(' | '))
} catch (e) {
  check('走查异常', false, String(e).slice(0, 200))
} finally {
  await snap('final')
  const passed = results.filter((r) => r.ok).length
  console.log(`\n元素拆解 UI R13: ${passed}/${results.length} 通过 · console错误 ${consoleErrors.length} 条 · 截图 ${shotsDir}`)
  if (consoleErrors.length) console.log('errors:\n' + consoleErrors.slice(0, 8).map((e) => '  - ' + e).join('\n'))
  if (failedUrls.length) console.log('失败请求:\n' + [...new Set(failedUrls)].slice(0, 8).map((e) => '  - ' + e).join('\n'))
  await app.close().catch(() => {})
  try { vite.kill('SIGKILL') } catch { /* */ }
  process.exit(results.every((r) => r.ok) ? 0 : 1)
}
