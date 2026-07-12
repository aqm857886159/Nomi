// R13 走查（参考捕捞窗 M0）：素材库「网页捕捞」→ 捕捞窗 → 地址栏导航本地测试页 →
// 捕捞图片（e2e 钩子=与右键菜单同一产路）→ 素材落项目 imported 桶且 sidecar originalUrl 恒 null →
// 主窗素材库回流刷新。用法: node tests/ux/reference-capture.walk.mjs
// 人眼判据（截图在 tests/ux/shots/reference-capture/）：
//   ① 素材库 header 出现「网页捕捞」按钮
//   ② 点按钮 → 捕捞窗打开：工具条（后退/前进/刷新/地址栏/截图捕捞/系统浏览器）+ 下方网页区
//   ③ 地址栏导航到本地测试页 → 窗内真实渲染出测试图
//   ④ 捕捞图片 → 工具条出现「已捕捞进素材库」提示；文件落 assets/imported/ 且无 .meta（信任窗不进）
//   ⑤ 权限探针：页面里请求 geolocation 被拒（deny-by-default）
//   ⑥ 主窗素材库列表出现捕捞素材
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/reference-capture')
fs.mkdirSync(shotsDir, { recursive: true })

const base = '/tmp/nomi-refcapture'
const settingsDir = path.join(base, 'settings')
const projectsDir = path.join(base, 'projects')
fs.rmSync(base, { recursive: true, force: true })
fs.mkdirSync(settingsDir, { recursive: true })

const projectId = 'walk-refcap-0001'
const projDir = path.join(projectsDir, `ref-capture-walk-${projectId}`)
fs.mkdirSync(path.join(projDir, '.nomi'), { recursive: true })
const generationCanvas = { nodes: [], edges: [], selectedNodeIds: [], groups: [] }
const project = {
  id: projectId, name: '捕捞走查', version: 2,
  createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projDir,
  workbenchDocument: null, timeline: null, generationCanvas,
  payload: { workbenchDocument: null, timeline: null, generationCanvas, storyboardPlan: null, storyboardPlanCommitted: false },
}
fs.writeFileSync(path.join(projDir, 'project.json'), JSON.stringify(project, null, 2))
fs.writeFileSync(path.join(projDir, '.nomi', 'project.json'), JSON.stringify(project, null, 2))

// —— 本地测试站：一张真 PNG（1x1 红点放大 240px 显示）+ 承载页 ——
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const server = http.createServer((req, res) => {
  if (req.url === '/hero-ref.png') {
    res.writeHead(200, { 'content-type': 'image/png' })
    res.end(PNG)
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end('<html><body style="background:#dfe8f0"><h1>捕捞测试页</h1><img id="ref" src="/hero-ref.png" width="240" height="240" alt="参考图"/></body></html>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const pageUrl = `http://127.0.0.1:${port}/page.html`
const imgUrl = `http://127.0.0.1:${port}/hero-ref.png`

let n = 0
const snapPage = async (page, name) => {
  n += 1
  const tag = `${String(n).padStart(2, '0')}-${name}`
  await page.screenshot({ path: path.join(shotsDir, `${tag}.png`) })
  console.log(`  · shot ${tag}`)
}
// 捕捞窗截图要用 BrowserWindow.capturePage（页面截图拍不到 WebContentsView）。
const snapCaptureWin = async (app, name) => {
  n += 1
  const tag = `${String(n).padStart(2, '0')}-${name}`
  const dataUrl = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('reference-capture'))
    if (!win) return ''
    const image = await win.capturePage()
    return image.toDataURL()
  })
  if (dataUrl) fs.writeFileSync(path.join(shotsDir, `${tag}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'))
  console.log(`  · shot ${tag}${dataUrl ? '' : ' (EMPTY)'}`)
}

const consoleErrors = []
let app = null
let allPassed = false

try {
app = await electron.launch({
  executablePath: require('electron'),
  args: ['.', `--user-data-dir=${settingsDir}`],
  cwd: repoRoot,
  env: { ...process.env, NOMI_SETTINGS_DIR: settingsDir, NOMI_PROJECTS_DIR: projectsDir, NOMI_E2E: '1' },
})
const win = await app.firstWindow()
win.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
win.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message))
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(1500)
await win.evaluate(() => {
  for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) window.localStorage.setItem(k, 'seen')
  window.localStorage.setItem('__nomiE2E', '1')
})
await win.reload()
await win.waitForTimeout(1500)
for (let i = 0; i < 6; i++) {
  const skip = win.locator('button,[role="button"],a', { hasText: /跳过|开始创作|进入|完成/ }).first()
  if (await skip.count()) await skip.click({ timeout: 1200 }).catch(() => {})
  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(350)
}

// —— 进项目画布 ——
const card = win.getByText('捕捞走查', { exact: false }).first()
if (await card.count()) {
  await card.click({ timeout: 4000 }).catch(() => {})
  await win.waitForTimeout(400)
  const cont = win.getByText('继续创作', { exact: false }).first()
  if (await cont.count()) await cont.click({ timeout: 3000 }).catch(() => {})
  await card.dblclick({ timeout: 3000 }).catch(() => {})
  await win.waitForTimeout(2500)
}
await snapPage(win, 'canvas')

// —— ① 打开素材库 → 「网页捕捞」按钮 ——
const assetBtn = win.locator('button,[role="button"]', { hasText: '素材库' }).first()
await assetBtn.click({ timeout: 4000 }).catch(() => {})
await win.waitForTimeout(600)
const captureEntry = win.locator('button[aria-label="网页捕捞"]').first()
const entryPresent = (await captureEntry.count()) > 0
await snapPage(win, 'asset-panel-entry')

// —— ② 点开捕捞窗 ——
let chrome = null
if (entryPresent) {
  const winPromise = app.waitForEvent('window', { timeout: 15000 }).catch(() => null)
  await captureEntry.click({ timeout: 3000 })
  chrome = await winPromise
  if (chrome) {
    chrome.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('capture chrome: ' + m.text()) })
    chrome.on('pageerror', (e) => consoleErrors.push('capture chrome pageerror: ' + e.message))
    await chrome.waitForLoadState('domcontentloaded').catch(() => {})
    await chrome.waitForTimeout(1800)
    await app.evaluate(({ BrowserWindow }) => {
      globalThis.__nomiReferenceCaptureWalkErrors = []
      const captureWindow = BrowserWindow.getAllWindows()
        .find((candidate) => candidate.webContents.getURL().includes('reference-capture'))
      const view = captureWindow?.contentView?.children?.[0]
      if (!view) {
        globalThis.__nomiReferenceCaptureWalkErrors.push('capture view: missing WebContentsView')
        return
      }
      view.webContents.on('console-message', (_event, levelOrDetails, legacyMessage) => {
        const details = levelOrDetails && typeof levelOrDetails === 'object' ? levelOrDetails : null
        const level = details?.level ?? levelOrDetails
        const message = details?.message ?? legacyMessage
        if (level === 3 || level === 'error') {
          globalThis.__nomiReferenceCaptureWalkErrors.push(`capture view: ${String(message ?? 'unknown error')}`)
        }
      })
      view.webContents.on('render-process-gone', (_event, details) => {
        globalThis.__nomiReferenceCaptureWalkErrors.push(
          `capture view renderer gone: ${details?.reason ?? 'unknown reason'}`,
        )
      })
    })
  }
}
const chromeOk = !!chrome && (await chrome.locator('input[aria-label="地址栏"]').count()) > 0
if (chrome) await snapCaptureWin(app, 'capture-window-open')

// —— ③ 地址栏导航到本地测试页 ——
let navigated = false
if (chromeOk) {
  const address = chrome.locator('input[aria-label="地址栏"]')
  await address.fill(pageUrl)
  await address.press('Enter')
  await chrome.waitForTimeout(2000)
  navigated = await app.evaluate(async ({ BrowserWindow }, expected) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('reference-capture'))
    const view = w?.contentView?.children?.[0]
    return view ? view.webContents.getURL().startsWith(expected.split('/page')[0]) : false
  }, pageUrl)
  await snapCaptureWin(app, 'navigated-local-page')
  // 盲区补证：BrowserWindow.capturePage 只拍主 webContents（拍不到子 WebContentsView），
  // 视图是否真渲染/真占位要靠 view 自己的 capturePage + bounds。
  const viewEvidence = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('reference-capture'))
    const view = w?.contentView?.children?.[0]
    if (!view) return { attached: 0, bounds: null, shot: '' }
    const image = await view.webContents.capturePage()
    return { attached: w.contentView.children.length, bounds: view.getBounds(), shot: image.toDataURL() }
  })
  console.log('  view bounds:', JSON.stringify(viewEvidence.bounds), 'attachedViews:', viewEvidence.attached)
  if (viewEvidence.shot) {
    n += 1
    fs.writeFileSync(path.join(shotsDir, `${String(n).padStart(2, '0')}-view-content.png`), Buffer.from(viewEvidence.shot.split(',')[1], 'base64'))
    console.log(`  · shot ${String(n).padStart(2, '0')}-view-content`)
  }
}

// —— ⑤ 权限探针（deny-by-default）——
let permission = ''
if (navigated) {
  permission = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('reference-capture'))
    const view = w?.contentView?.children?.[0]
    if (!view) return 'no-view'
    return view.webContents.executeJavaScript(
      `new Promise((resolve) => navigator.geolocation.getCurrentPosition(() => resolve('granted'), (e) => resolve('denied:' + e.code)))`,
      true,
    )
  })
}

// —— ④ 捕捞图片（与右键菜单同一产路）——
let captured = false
let sidecarLeak = false
let capturedFile = ''
if (navigated) {
  const result = await chrome.evaluate(async (url) => window.nomiDesktop.browserCapture.e2eCapture({ url, kind: 'image' }), imgUrl)
  console.log('  e2e capture result:', JSON.stringify(result))
  await chrome.waitForTimeout(1500)
  const importedDir = path.join(projDir, 'assets', 'imported')
  const files = fs.existsSync(importedDir)
    ? fs.readdirSync(importedDir, { recursive: true }).map(String).filter((f) => !f.endsWith('.DS_Store'))
    : []
  capturedFile = files.find((f) => f.includes('hero-ref') && !f.endsWith('.meta')) || ''
  captured = !!capturedFile
  // 不变量=捕捞素材绝不进 48h 信任窗：sidecar 允许存在（统一素材存储写溯源元数据），
  // 但 originalUrl 必须为 null/缺失——localAssetFile 只信 http(s) 的 originalUrl。
  for (const f of files.filter((x) => x.endsWith('.meta'))) {
    try {
      const sidecar = JSON.parse(fs.readFileSync(path.join(importedDir, f), 'utf8'))
      if (typeof sidecar.originalUrl === 'string' && /^https?:\/\//i.test(sidecar.originalUrl)) sidecarLeak = true
    } catch {
      sidecarLeak = true
    }
  }
  await snapCaptureWin(app, 'after-capture-toast')
}

// —— ⑥ 主窗素材库回流 ——
let mainSeesAsset = false
if (captured) {
  await win.waitForTimeout(800)
  mainSeesAsset = await win.evaluate(() => document.body.innerText.includes('hero-ref'))
  await snapPage(win, 'main-asset-panel-after-capture')
}

const captureViewErrors = await app.evaluate(() =>
  Array.isArray(globalThis.__nomiReferenceCaptureWalkErrors)
    ? globalThis.__nomiReferenceCaptureWalkErrors
    : [],
)
consoleErrors.push(...captureViewErrors)

console.log('\n===== 参考捕捞窗走查判定 =====')
console.log(`  ① 素材库有「网页捕捞」入口:   ${entryPresent ? 'PASS' : 'FAIL'}`)
console.log(`  ② 捕捞窗打开(工具条就位):     ${chromeOk ? 'PASS' : 'FAIL'}`)
console.log(`  ③ 地址栏导航本地页:           ${navigated ? 'PASS' : 'FAIL'}`)
console.log(`  ④ 图片捕捞落 imported 桶:     ${captured ? `PASS (${capturedFile})` : 'FAIL'}`)
console.log(`     sidecar originalUrl 恒 null(不进信任窗): ${captured && !sidecarLeak ? 'PASS' : 'FAIL'}`)
console.log(`  ⑤ 权限 deny-by-default:       ${permission.startsWith('denied') ? `PASS (${permission})` : `FAIL (${permission})`}`)
console.log(`  ⑥ 主窗素材库回流可见:         ${mainSeesAsset ? 'PASS' : 'FAIL'}`)
console.log(`  console errors: ${consoleErrors.length}`)
if (consoleErrors.length) console.log('   ' + consoleErrors.slice(0, 8).join('\n   '))
allPassed =
  entryPresent &&
  chromeOk &&
  navigated &&
  captured &&
  !sidecarLeak &&
  permission.startsWith('denied') &&
  mainSeesAsset &&
  consoleErrors.length === 0
console.log(`  总判定: ${allPassed ? 'PASS' : 'FAIL'}`)
console.log(`\n截图在 ${shotsDir}`)
} catch (error) {
  console.error(`\n参考捕捞窗走查异常: ${error?.stack || error}`)
} finally {
  if (app) await app.close().catch(() => undefined)
  await new Promise((resolve) => server.close(resolve))
}
if (!allPassed) process.exitCode = 1
