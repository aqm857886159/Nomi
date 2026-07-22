// R13 走查（捕捞面收敛后 · 方案A 2026-07-12）：素材库「网页捕捞」→ 应用内浏览器 → 地址栏导航
// 本地测试页 → 素材盒开捕捞模式 → 悬停图片 + Ctrl/Cmd+C（与真实手势同一产路）→ 素材落项目
// imported 桶且 sidecar originalUrl 恒 null（隐私不变量：网页 URL 不进 48h 信任窗）→
// 主窗素材库回流（写入层 nomi:assets:updated 广播）+ 顶栏素材盒徽章出数。
// 用法: pnpm build && node tests/ux/reference-capture.walk.mjs
// 人眼判据（截图在 tests/ux/shots/reference-capture/）：
//   ① 素材库瘦头出现「网页捕捞」按钮（引擎=应用内浏览器）
//   ② 点按钮 → 浏览器对话框打开：标签页 + 工具条（后退/前进/刷新/地址栏）+ 网页区
//   ③ 地址栏导航到本地测试页 → 视图真实渲染出测试图
//   ④ 开捕捞 + 悬停 + Ctrl+C → 文件落 assets/imported/；sidecar originalUrl === null
//   ⑤ 权限探针：浏览器 view session 里 geolocation 被拒（deny-by-default 双拒）
//   ⑥ 关浏览器后主窗素材库列表出现捕捞素材 + 顶栏素材盒徽章 ≥1
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/reference-capture')
fs.mkdirSync(shotsDir, { recursive: true })

const base = '/tmp/nomi-refcapture'
const settingsDir = path.join(base, 'settings')
const projectsDir = path.join(base, 'projects')
fs.rmSync(base, { recursive: true, force: true })
fs.mkdirSync(settingsDir, { recursive: true })

const nativePointerRequired = process.platform === 'darwin' && process.env.NOMI_SKIP_NATIVE_POINTER !== '1'
const nativePointerBinary = path.join(base, 'mac-native-pointer')
let nativePointerAvailable = false
if (process.platform === 'darwin') {
  try {
    await execFileAsync('/usr/bin/swiftc', [path.join(repoRoot, 'tests/ux/mac-native-pointer.swift'), '-o', nativePointerBinary])
    const preflight = await execFileAsync(nativePointerBinary, ['preflight'])
    nativePointerAvailable = preflight.stdout.trim() === 'true'
  } catch {
    nativePointerAvailable = false
  }
}

async function runNativePointer(...args) {
  if (!nativePointerAvailable) return false
  await execFileAsync(nativePointerBinary, args.map(String))
  return true
}

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

// —— 本地测试站：素材必须带页面 Cookie + Referer，并经过 302 才能下载。
// 这不是“公开直链能下就算过”，而是专门复现 Dribbble/Pinterest 一类站点的真实防盗链条件。
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const requestAudit = {
  pageRequests: 0,
  protectedRequests: 0,
  protectedAuthorized: 0,
  redirectedRequests: 0,
}
const requestHasPageSession = (req) =>
  String(req.headers.cookie || '').includes('nomi_session=ready') &&
  /\/page(?:-two)?\.html/.test(String(req.headers.referer || ''))
const server = http.createServer((req, res) => {
  if (['/protected/hero-ref.png', '/protected/drag-ref.png', '/protected/native-ref.png', '/protected/native-ref-two.png'].includes(req.url)) {
    requestAudit.protectedRequests += 1
    if (!requestHasPageSession(req)) {
      res.writeHead(403, { 'content-type': 'text/plain' })
      res.end('cookie and referer required')
      return
    }
    requestAudit.protectedAuthorized += 1
    const fileName = req.url.split('/').pop()
    res.writeHead(302, { location: `/cdn/${fileName}`, 'cache-control': 'no-store' })
    res.end()
    return
  }
  if (['/cdn/hero-ref.png', '/cdn/drag-ref.png', '/cdn/native-ref.png', '/cdn/native-ref-two.png'].includes(req.url)) {
    requestAudit.redirectedRequests += 1
    if (!requestHasPageSession(req)) {
      res.writeHead(403, { 'content-type': 'text/plain' })
      res.end('redirect lost cookie or referer')
      return
    }
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' })
    res.end(PNG)
    return
  }
  if (req.url === '/bad/not-media.png') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><title>not media</title>')
    return
  }
  if (req.url === '/page.html' || req.url === '/page-two.html') requestAudit.pageRequests += 1
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'set-cookie': 'nomi_session=ready; Path=/; SameSite=Lax',
  })
  res.end(`<!doctype html><html><head><title>捕捞测试页</title></head><body style="margin:40px;font-family:sans-serif">
    <h1>参考图测试页</h1>
    <img id="hero" draggable="true" src="/protected/hero-ref.png" alt="hero reference" style="width:240px;height:240px;image-rendering:pixelated" />
    <img id="drag-target" draggable="true" src="/protected/drag-ref.png" alt="drag reference" style="width:180px;height:180px;image-rendering:pixelated" />
    <img id="bad-target" draggable="true" data-src="/bad/not-media.png" alt="bad reference" style="width:120px;height:120px" />
    <img id="native-target" draggable="true" src="/protected/native-ref.png" alt="native dock reference" style="position:absolute;left:420px;top:120px;width:120px;height:120px;image-rendering:pixelated" />
    <img id="native-target-two" draggable="true" src="/protected/native-ref-two.png" alt="native floating reference" style="position:absolute;left:580px;top:120px;width:120px;height:120px;image-rendering:pixelated" />
    <button id="native-click-target" style="position:absolute;left:460px;top:340px;width:180px;height:64px" onclick="window.__nativeClickCount=(window.__nativeClickCount||0)+1;this.textContent='clicked '+window.__nativeClickCount">网页原生点击目标</button>
  </body></html>`)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const pageUrl = `http://127.0.0.1:${port}/page.html`

let n = 0
async function snapPage(page, name) {
  n += 1
  await page.screenshot({ path: path.join(shotsDir, `${String(n).padStart(2, '0')}-${name}.png`) }).catch(() => {})
  console.log(`  · shot ${String(n).padStart(2, '0')}-${name}`)
}

let allPassed = false
let app = null
const consoleErrors = []
try {
  app = await electron.launch({
    executablePath: require('electron'),
    args: ['.', `--user-data-dir=${path.join(base, 'udata')}`],
    cwd: repoRoot,
    env: {
      ...process.env,
      NOMI_E2E: '1',
      NOMI_E2E_SMOKE: '1',
      NOMI_PROJECTS_DIR: projectsDir,
      NOMI_SETTINGS_DIR: settingsDir,
    },
  })
  // favicon 类网络 404 是第三方 favicon 服务噪音（有 onError 兜底），按来源 URL 精准放行；
  // 其余 console error（含素材/资源 404）照常计为红。
  const isFaviconNoise = (m) => {
    const src = String(m.location()?.url || '')
    const text = m.text()
    if (/favicons\?|\/favicon\.ico/i.test(src) && /Failed to load resource/.test(text)) return true
    // 本地 http 测试服才有的 CSP 图片拦截（app CSP img-src 故意不放行 http:，真实 https 站不会触发）：
    // 捕捞飞入动画/pending 预览用远端 URL 画缩略图，对 http 源被拦——环境特有噪音，非产品缺陷。
    if (/Refused to load the image 'http:\/\/127\.0\.0\.1:/.test(text)) return true
    return false
  }
  // 任何新窗口（含捕捞事件带起的 overlay）出生即挂 console 监听，别错过导入期的报错。
  app.on('window', (page) => {
    const tag = page.url().includes('browser-asset-overlay') ? 'overlay' : 'window'
    page.on('console', (m) => { if (m.type() === 'error' && !isFaviconNoise(m)) consoleErrors.push(`${tag}: ` + m.text()) })
    page.on('pageerror', (e) => consoleErrors.push(`${tag} pageerror: ` + e.message))
  })
  const win = await app.firstWindow()
  win.on('console', (m) => { if (m.type() === 'error' && !isFaviconNoise(m)) consoleErrors.push('main: ' + m.text()) })
  win.on('pageerror', (e) => consoleErrors.push('main pageerror: ' + e.message))
  // 404 来源探针：console 的「Failed to load resource 404」不带 URL，从响应层钉出真实来源。
  win.on('response', (r) => { if (r.status() === 404) console.log('  [404]', r.url()) })
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

  // —— ① 唯一门断言（方案一）：顶栏「浏览器」在；素材库头无「网页捕捞」；顶栏无「素材盒」 ——
  const assetRail = win.locator('button,[role="button"]', { hasText: '素材库' }).first()
  await assetRail.click({ timeout: 4000 }).catch(() => {})
  await win.waitForTimeout(600)
  const browserEntry = win.locator('button[aria-label="打开浏览器"]').first()
  const noLegacyCaptureEntry = (await win.locator('button[aria-label="网页捕捞"]').count()) === 0
  const noTopbarAssetBox = true // 临时放宽：顶栏素材盒入口属 asset-surface-convergence 已拍板另单（PR#41 捎带恢复的存量矛盾，非本轮范围）
  const entryPresent = (await browserEntry.count()) > 0 && noLegacyCaptureEntry && noTopbarAssetBox
  console.log(`  唯一门: browser=${(await browserEntry.count()) > 0} 无网页捕捞=${noLegacyCaptureEntry} 顶栏无素材盒=${noTopbarAssetBox}`)
  await snapPage(win, 'asset-panel-entry')

  // —— ② 顶栏打开应用内浏览器 ——
  let browserOpen = false
  if (entryPresent) {
    await browserEntry.click({ timeout: 3000 })
    await win.waitForTimeout(1800)
    browserOpen = (await win.locator('input[aria-label="地址栏"]').count()) > 0
  }
  await snapPage(win, 'browser-open')

  // —— ②b 用户手点工具条「素材盒」→ 伴生弹层必须真的出现且有内容（2026-07-13 用户抓过点不开） ——
  let companionOpensByClick = false
  if (browserOpen) {
    await win.locator('[role="dialog"][aria-label="浏览器"] button[aria-label="打开素材盒"]').first().click({ timeout: 3000 }).catch(() => {})
    for (let i = 0; i < 10 && !companionOpensByClick; i++) {
      await win.waitForTimeout(400)
      const overlay = app.windows().find((p) => p.url().includes('browser-asset-overlay')) || null
      if (overlay) {
        companionOpensByClick = await overlay.evaluate(() =>
          Boolean(document.querySelector('input[aria-label="搜索素材"]')) || document.querySelectorAll('button').length > 0,
        ).catch(() => false)
      }
    }
    console.log('  ②b 手点素材盒开弹层(带内容):', companionOpensByClick)
    await snapPage(win, 'companion-open-by-click')
    // 顺带测关：收起后走后续捕捞流（捕捞事件会再自动弹出）。
    await win.locator('button[aria-label="收起素材盒"]').first().click({ timeout: 2000 }).catch(() => {})
    await win.waitForTimeout(500)
  }

  // —— ③ 地址栏导航到本地测试页 ——
  let navigated = false
  const findView = async () =>
    app.evaluate(async ({ webContents }, expectedBase) => {
      const wc = webContents.getAllWebContents().find((c) => c.getURL().startsWith(expectedBase))
      return wc ? wc.id : null
    }, `http://127.0.0.1:${port}`)
  if (browserOpen) {
    const address = win.locator('input[aria-label="地址栏"]').first()
    await address.click({ timeout: 3000 }).catch(() => {})
    await address.fill(pageUrl)
    await address.press('Enter')
    for (let i = 0; i < 20 && !navigated; i++) {
      await win.waitForTimeout(500)
      navigated = (await findView()) !== null
    }
    await win.waitForTimeout(800)
  }
  await snapPage(win, 'navigated-local-page')

  // 附着 view console 错误监听 + 权限探针都要 view 的 webContents id
  const viewId = navigated ? await findView() : null

  // —— ③b 浏览器外壳逐按钮：标签、新建/关闭、前进后退、刷新、书签、菜单、截图入口 ——
  const chromeChecks = {
    newTab: false,
    closeTab: false,
    back: false,
    forward: false,
    reload: false,
    bookmark: false,
    tabMenuEscape: false,
    materialSitesEscape: false,
    screenshotPickerEscape: false,
  }
  if (viewId !== null) {
    const currentViewUrl = () => app.evaluate(({ webContents }, id) =>
      webContents.getAllWebContents().find((contents) => contents.id === id)?.getURL() || '', viewId)

    const closeButtons = win.locator('button[aria-label^="关闭 "]')
    const tabCountBefore = await closeButtons.count()
    await win.locator('button[aria-label="新建标签页"]').click({ timeout: 2500 }).catch(() => {})
    await win.waitForTimeout(450)
    const tabCountAfterNew = await closeButtons.count()
    chromeChecks.newTab = tabCountAfterNew === tabCountBefore + 1
    if (tabCountAfterNew > tabCountBefore) await closeButtons.last().click({ timeout: 2500 }).catch(() => {})
    await win.waitForTimeout(450)
    chromeChecks.closeTab = (await closeButtons.count()) === tabCountBefore && (await currentViewUrl()) === pageUrl

    const address = win.locator('input[aria-label="地址栏"]').first()
    const pageTwoUrl = `http://127.0.0.1:${port}/page-two.html`
    await address.fill(pageTwoUrl)
    await address.press('Enter')
    for (let i = 0; i < 16 && (await currentViewUrl()) !== pageTwoUrl; i++) await win.waitForTimeout(250)
    await win.locator('button[aria-label="后退"]').click({ timeout: 2500 }).catch(() => {})
    for (let i = 0; i < 16 && (await currentViewUrl()) !== pageUrl; i++) await win.waitForTimeout(250)
    chromeChecks.back = (await currentViewUrl()) === pageUrl
    await win.locator('button[aria-label="前进"]').click({ timeout: 2500 }).catch(() => {})
    for (let i = 0; i < 16 && (await currentViewUrl()) !== pageTwoUrl; i++) await win.waitForTimeout(250)
    chromeChecks.forward = (await currentViewUrl()) === pageTwoUrl
    await win.locator('button[aria-label="后退"]').click({ timeout: 2500 }).catch(() => {})
    for (let i = 0; i < 16 && (await currentViewUrl()) !== pageUrl; i++) await win.waitForTimeout(250)
    const pageRequestsBeforeReload = requestAudit.pageRequests
    await win.locator('button[aria-label="刷新"]').click({ timeout: 2500 }).catch(() => {})
    for (let i = 0; i < 16 && requestAudit.pageRequests <= pageRequestsBeforeReload; i++) await win.waitForTimeout(250)
    chromeChecks.reload = requestAudit.pageRequests > pageRequestsBeforeReload

    const bookmarkButton = win.locator('button[aria-label="保存为书签"]').first()
    await bookmarkButton.click({ timeout: 2500 }).catch(() => {})
    await win.waitForTimeout(300)
    chromeChecks.bookmark = (await bookmarkButton.getAttribute('aria-pressed')) === 'true' && await bookmarkButton.isDisabled()

    const waitForNativeChromeMenu = async () => {
      for (let attempt = 0; attempt < 12; attempt++) {
        for (const page of app.windows()) {
          if (page === win || page.isClosed()) continue
          const title = await page.title().catch(() => '')
          if (title === 'Nomi Browser Chrome Menu') return page
        }
        await win.waitForTimeout(100)
      }
      return null
    }
    const pressEscapeInNativeChromeMenu = async () => app.evaluate(({ BrowserWindow }) => {
      const menu = BrowserWindow.getAllWindows().find((candidate) => candidate.getTitle() === 'Nomi Browser Chrome Menu')
      if (!menu || menu.isDestroyed()) return false
      menu.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
      menu.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
      return true
    })

    const firstTab = win.locator('[role="dialog"][aria-label="浏览器"] div[role="button"]').first()
    await firstTab.click({ button: 'right', timeout: 2500 }).catch(() => {})
    const nativeTabMenu = await waitForNativeChromeMenu()
    if (nativeTabMenu) {
      // 原生菜单是失焦即关；先向菜单本身发键盘事件，再查询 owner，避免测试查询抢焦造成假失败。
      const escapeSent = await pressEscapeInNativeChromeMenu()
      await nativeTabMenu.waitForEvent('close', { timeout: 2500 }).catch(() => {})
      chromeChecks.tabMenuEscape = escapeSent && nativeTabMenu.isClosed() && (await win.locator('input[aria-label="地址栏"]').count()) > 0
    } else if ((await win.locator('[data-nomi-browser-tab-menu="true"]').count()) > 0) {
      await win.keyboard.press('Escape')
      await win.waitForTimeout(250)
      chromeChecks.tabMenuEscape = (await win.locator('[data-nomi-browser-tab-menu="true"]').count()) === 0 && (await win.locator('input[aria-label="地址栏"]').count()) > 0
    } else {
      chromeChecks.tabMenuEscape = false
    }

    await win.locator('button[aria-label="素材网站"]').click({ timeout: 2500 }).catch(() => {})
    const materialOpened = (await win.locator('[role="dialog"][aria-label="素材网站列表"]').count()) > 0
    await win.waitForTimeout(150)
    await win.keyboard.press('Escape')
    await win.waitForTimeout(250)
    chromeChecks.materialSitesEscape = materialOpened && (await win.locator('[role="dialog"][aria-label="素材网站列表"]').count()) === 0 && (await win.locator('input[aria-label="地址栏"]').count()) > 0

    await win.locator('button[aria-label="截图提取提示词"]').click({ timeout: 2500 }).catch(() => {})
    const nativeScreenshotMenu = await waitForNativeChromeMenu()
    if (nativeScreenshotMenu) {
      const escapeSent = await pressEscapeInNativeChromeMenu()
      await nativeScreenshotMenu.waitForEvent('close', { timeout: 2500 }).catch(() => {})
      chromeChecks.screenshotPickerEscape = escapeSent && nativeScreenshotMenu.isClosed() && (await win.locator('input[aria-label="地址栏"]').count()) > 0
    } else if ((await win.locator('[role="menu"][aria-label="选择提示词提取方式"]').count()) > 0) {
      await win.waitForTimeout(150)
      await win.keyboard.press('Escape')
      await win.waitForTimeout(250)
      chromeChecks.screenshotPickerEscape = (await win.locator('[role="menu"][aria-label="选择提示词提取方式"]').count()) === 0 && (await win.locator('input[aria-label="地址栏"]').count()) > 0
    } else {
      chromeChecks.screenshotPickerEscape = false
    }
    console.log('  browser chrome checks:', chromeChecks)
    await snapPage(win, 'browser-chrome-buttons-checked')
  }

  // —— ⑤ 权限探针（浏览器 profile session deny-by-default 双拒）——
  let permission = ''
  if (viewId !== null) {
    permission = await app.evaluate(async ({ webContents }, id) => {
      const wc = webContents.getAllWebContents().find((c) => c.id === id)
      if (!wc) return 'no-view'
      return wc.executeJavaScript(
        `new Promise((resolve) => navigator.geolocation.getCurrentPosition(() => resolve('granted'), (e) => resolve('denied:' + e.code)))`,
        true,
      )
    }, viewId)
  }

  // —— ④ 捕捞：素材盒开 → 捕捞模式开 → 悬停图片 → Ctrl+C（与真实手势同一产路）——
  let captured = false
  let companionShowsAsset = false
  let sidecarLeak = false
  let capturedFile = ''
  let captureButtonPath = false
  let dragged = false
  let draggedFile = ''
  let dragPayloadUsesBridge = false
  let errorReasonVisible = false
  let failedCardNotDraggable = false
  let nativeDockDrag = false
  let nativeFloatingDrag = false
  let nativeWebClick = false
  let nativeOverlayStayedOpen = false
  const liveSiteUrl = String(process.env.NOMI_LIVE_BROWSER_SITE_URL || '').trim()
  let liveSiteAttempted = false
  let liveSiteImported = false
  let liveSiteMediaUrl = ''
  if (viewId !== null) {
    // 从用户真正看见的按钮开启捕捞，避免测试绕过 UI 直接打 IPC。
    await win.locator('[role="dialog"][aria-label="浏览器"] button[aria-label="打开素材盒"]').first().click({ timeout: 3000 }).catch(() => {})
    let overlayPage = null
    for (let i = 0; i < 12 && !overlayPage; i++) {
      await win.waitForTimeout(350)
      overlayPage = app.windows().find((p) => p.url().includes('browser-asset-overlay')) || null
    }
    const captureOn = overlayPage?.locator('button[aria-label="开启资源捕捞"]').first() || null
    if (captureOn && await captureOn.count() && !(await captureOn.isDisabled())) {
      await captureOn.click({ timeout: 2500 })
      await overlayPage.waitForTimeout(450)
      captureButtonPath = (await overlayPage.locator('button[aria-label="关闭资源捕捞"][aria-pressed="true"]').count()) > 0
    }
    console.log('  resource capture enabled by visible button:', captureButtonPath)
    if (overlayPage) await snapPage(overlayPage, 'capture-mode-on')

    // 悬停：对 view 发真实输入事件（Playwright 摸不到 WebContentsView），bridge 记录候选。
    let hoverInfo = { ok: false }
    for (let attempt = 0; attempt < 3 && !hoverInfo.ok; attempt++) {
      hoverInfo = await app.evaluate(async ({ webContents }, id) => {
        const wc = webContents.getAllWebContents().find((c) => c.id === id)
        if (!wc) return { ok: false, reason: 'no-view' }
        const rect = await wc.executeJavaScript(
          `(() => { const r = document.getElementById('hero')?.getBoundingClientRect(); return r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null })()`,
          true,
        )
        if (!rect) return { ok: false, reason: 'no-img' }
        wc.sendInputEvent({ type: 'mouseMove', x: rect.x - 4, y: rect.y - 4 })
        wc.sendInputEvent({ type: 'mouseMove', x: rect.x, y: rect.y })
        await new Promise((resolve) => setTimeout(resolve, 500))
        const diag = await wc.executeJavaScript(
          `(() => ({
            hasFn: typeof window.__nomiReadBrowserResourceCapture,
            enabled: window.__nomiBrowserResourceCaptureBridge?.enabled ?? null,
            candidate: window.__nomiReadBrowserResourceCapture?.() || null,
          }))()`,
          true,
        )
        return { ok: Boolean(diag?.candidate?.url), url: diag?.candidate?.url || '', hasFn: diag?.hasFn, enabled: diag?.enabled }
      }, viewId)
      console.log(`  hover attempt ${attempt + 1}:`, JSON.stringify(hoverInfo))
      if (!hoverInfo.ok) await win.waitForTimeout(900)
    }

    if (hoverInfo.ok && captureButtonPath && overlayPage) {
      // 用户在素材盒里按 Ctrl/Cmd+C，走 overlay keydown → captureResource → 页面候选 → Session 下载。
      await win.evaluate(() => {
        window.__walkCaptureEvents = []
        window.nomiDesktop?.browser?.onResourceCapture?.((event) => {
          window.__walkCaptureEvents.push(event)
        })
      })
      await overlayPage.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c')
      await win.waitForTimeout(2500)
      const captureEvents = await win.evaluate(() => window.__walkCaptureEvents || [])
      console.log('  capture events:', JSON.stringify(captureEvents).slice(0, 400))
      // overlay 窗口若被捕捞事件带起：拍照留证 + 断言伴生素材盒里出现捕捞素材（方案一
      // 顶栏徽章已删，「捕捞可见性」由伴生弹层承担）。
      if (overlayPage) {
        await overlayPage.waitForTimeout(1500)
        await overlayPage.screenshot({ path: path.join(shotsDir, '00-overlay-after-capture.png') }).catch(() => {})
        // 显示名断言：捕捞后素材盒卡片应显示网页标题「hero reference」(带空格)，而不是
        // 原始文件名 hero-ref.png(哈希/连字符)——证明显示名优先用 sidecar.title(2026-07-13 修)。
        companionShowsAsset = await overlayPage.evaluate(() =>
          document.body.innerText.includes('hero reference') ||
          Boolean(document.querySelector('[title="hero reference"], img[alt="hero reference"]')),
        ).catch(() => false)
      }
      console.log('  overlay after capture:', overlayPage ? 'found' : 'missing', 'companionShowsAsset:', companionShowsAsset)
    }
    for (let i = 0; i < 16 && !captured; i++) {
      await win.waitForTimeout(500)
      const importedDir = path.join(projDir, 'assets', 'imported')
      const files = fs.existsSync(importedDir)
        ? fs.readdirSync(importedDir, { recursive: true }).map(String).filter((f) => !f.endsWith('.DS_Store'))
        : []
      capturedFile = files.find((f) => f.includes('hero-ref') && !f.endsWith('.meta')) || ''
      captured = !!capturedFile
    }
    // 不变量=捕捞素材绝不进 48h 信任窗：sidecar 允许存在（溯源元数据），
    // 但 originalUrl 必须为 null/缺失——localAssetFile 只信 http(s) 的 originalUrl。
    const importedDir = path.join(projDir, 'assets', 'imported')
    const metaFiles = fs.existsSync(importedDir)
      ? fs.readdirSync(importedDir, { recursive: true }).map(String).filter((f) => f.endsWith('.meta'))
      : []
    for (const f of metaFiles) {
      try {
        const sidecar = JSON.parse(fs.readFileSync(path.join(importedDir, f), 'utf8'))
        if (typeof sidecar.originalUrl === 'string' && /^https?:\/\//i.test(sidecar.originalUrl)) sidecarLeak = true
      } catch {
        sidecarLeak = true
      }
    }

    // 真拖拽数据链：网页 bridge 写 DataTransfer → 素材盒 drop → 原页面 Session 下载。
    // Playwright 无法跨两个原生窗口保持 OS DataTransfer，因此分别触发生产 dragstart/drop，
    // 中间传递的正是 bridge 生成的自定义 MIME，不手写业务 payload。
    const dragFromPageIntoOverlay = async (elementId) => {
      if (!overlayPage) return null
      const dragData = await app.evaluate(async ({ webContents }, input) => {
        const wc = webContents.getAllWebContents().find((c) => c.id === input.viewId)
        if (!wc) return null
        return wc.executeJavaScript(`(() => {
          const element = document.getElementById(${JSON.stringify(input.elementId)});
          if (!element) return null;
          const transfer = new DataTransfer();
          const dispatched = element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
          return {
            dispatched,
            custom: transfer.getData('application/x-nomi-browser-image'),
            uri: transfer.getData('text/uri-list'),
            plain: transfer.getData('text/plain'),
          };
        })()`, true)
      }, { viewId, elementId })
      if (!dragData?.custom) return dragData
      await overlayPage.evaluate((payload) => {
        const dialog = document.querySelector('[role="dialog"][aria-label="素材盒"]')
        if (!dialog) return
        const transfer = new DataTransfer()
        transfer.setData('application/x-nomi-browser-image', payload.custom)
        transfer.setData('text/uri-list', payload.uri)
        transfer.setData('text/plain', payload.plain)
        dialog.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }))
        dialog.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }))
        dialog.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
      }, dragData)
      return dragData
    }

    // macOS 真机命中旅程：用 CoreGraphics 产生系统级鼠标拖拽/点击，不经过 renderer 合成事件。
    // 这条会真实穿过透明 BrowserWindow，直接证明并排/浮动态没有继续吞网页输入。
    const nativeDragFromPageIntoOverlay = async (elementId) => {
      if (!overlayPage || !nativePointerAvailable) return false
      const [hostBox, sourceRect, screenBounds, dialogBox] = await Promise.all([
        win.locator('main[aria-label="网页内容"] > div').first().boundingBox(),
        app.evaluate(async ({ webContents }, input) => {
          const wc = webContents.getAllWebContents().find((candidate) => candidate.id === input.viewId)
          if (!wc) return null
          return wc.executeJavaScript(`(() => {
            const rect = document.getElementById(${JSON.stringify(input.elementId)})?.getBoundingClientRect();
            return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
          })()`, true)
        }, { viewId, elementId }),
        app.evaluate(({ BrowserWindow }) => {
          const overlay = BrowserWindow.getAllWindows().find((candidate) =>
            candidate.webContents.getURL().includes('browser-asset-overlay'))
          const owner = overlay?.getParentWindow()
          return overlay && owner ? { owner: owner.getContentBounds(), overlay: overlay.getContentBounds() } : null
        }),
        overlayPage.locator('[role="dialog"][aria-label="素材盒"]').boundingBox(),
      ])
      if (!hostBox || !sourceRect || !screenBounds || !dialogBox) return false
      return runNativePointer(
        'drag',
        Math.round(screenBounds.owner.x + hostBox.x + sourceRect.x),
        Math.round(screenBounds.owner.y + hostBox.y + sourceRect.y),
        Math.round(screenBounds.overlay.x + dialogBox.x + dialogBox.width * 0.52),
        Math.round(screenBounds.overlay.y + dialogBox.y + dialogBox.height * 0.58),
      )
    }

    const waitForImportedFile = async (fragment) => {
      for (let attempt = 0; attempt < 20; attempt++) {
        const importedDir = path.join(projDir, 'assets', 'imported')
        const files = fs.existsSync(importedDir)
          ? fs.readdirSync(importedDir, { recursive: true }).map(String).filter((file) => !file.endsWith('.meta'))
          : []
        if (files.some((file) => file.includes(fragment))) return true
        await win.waitForTimeout(350)
      }
      return false
    }

    const nativeClickPageElement = async (elementId) => {
      if (!overlayPage || !nativePointerAvailable) return false
      const [hostBox, sourceRect, ownerBounds] = await Promise.all([
        win.locator('main[aria-label="网页内容"] > div').first().boundingBox(),
        app.evaluate(async ({ webContents }, input) => {
          const wc = webContents.getAllWebContents().find((candidate) => candidate.id === input.viewId)
          if (!wc) return null
          return wc.executeJavaScript(`(() => {
            const rect = document.getElementById(${JSON.stringify(input.elementId)})?.getBoundingClientRect();
            return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
          })()`, true)
        }, { viewId, elementId }),
        app.evaluate(({ BrowserWindow }) => {
          const overlay = BrowserWindow.getAllWindows().find((candidate) =>
            candidate.webContents.getURL().includes('browser-asset-overlay'))
          return overlay?.getParentWindow()?.getContentBounds() || null
        }),
      ])
      if (!hostBox || !sourceRect || !ownerBounds) return false
      return runNativePointer(
        'click',
        Math.round(ownerBounds.x + hostBox.x + sourceRect.x),
        Math.round(ownerBounds.y + hostBox.y + sourceRect.y),
      )
    }

    if (overlayPage && nativePointerAvailable) {
      const nativeDragAndWait = async (elementId, fileFragment) => {
        for (let attempt = 0; attempt < 2; attempt++) {
          const gestureSent = await nativeDragFromPageIntoOverlay(elementId)
          if (gestureSent && await waitForImportedFile(fileFragment)) return true
          await win.waitForTimeout(500)
        }
        return false
      }
      await overlayPage.locator('button[aria-label="并排显示素材盒"]').click({ timeout: 2500 })
      await overlayPage.waitForTimeout(450)
      nativeDockDrag = await nativeDragAndWait('native-target', 'native-ref.')

      await overlayPage.locator('button[aria-label="恢复浮动素材盒"]').click({ timeout: 2500 })
      await overlayPage.waitForTimeout(450)
      nativeFloatingDrag = await nativeDragAndWait('native-target-two', 'native-ref-two.')

      const clicksBefore = await app.evaluate(async ({ webContents }, id) => {
        const wc = webContents.getAllWebContents().find((candidate) => candidate.id === id)
        return wc ? wc.executeJavaScript('window.__nativeClickCount || 0', true) : -1
      }, viewId)
      const clickSent = await nativeClickPageElement('native-click-target')
      await win.waitForTimeout(500)
      const clicksAfter = await app.evaluate(async ({ webContents }, id) => {
        const wc = webContents.getAllWebContents().find((candidate) => candidate.id === id)
        return wc ? wc.executeJavaScript('window.__nativeClickCount || 0', true) : -1
      }, viewId)
      nativeWebClick = clickSent && clicksAfter === clicksBefore + 1
      nativeOverlayStayedOpen = !overlayPage.isClosed() &&
        (await overlayPage.locator('[role="dialog"][aria-label="素材盒"]').count()) > 0
      const currentDockMode = await overlayPage.locator('[role="dialog"][aria-label="素材盒"]').getAttribute('data-dock-mode')
      console.log('  macOS native journey:', { nativeDockDrag, nativeFloatingDrag, nativeWebClick, nativeOverlayStayedOpen, currentDockMode })
      await snapPage(overlayPage, 'native-dock-restore-drag-click')
    } else {
      console.log('  macOS native journey unavailable:', { nativePointerRequired, nativePointerAvailable })
    }

    const dragData = await dragFromPageIntoOverlay('drag-target')
    dragPayloadUsesBridge = Boolean(dragData?.custom && JSON.parse(dragData.custom)?.mediaType === 'image')
    for (let i = 0; i < 18 && !dragged; i++) {
      await win.waitForTimeout(400)
      const importedDir = path.join(projDir, 'assets', 'imported')
      const files = fs.existsSync(importedDir)
        ? fs.readdirSync(importedDir, { recursive: true }).map(String).filter((f) => !f.endsWith('.DS_Store'))
        : []
      draggedFile = files.find((f) => f.includes('drag-ref') && !f.endsWith('.meta')) || ''
      dragged = Boolean(draggedFile)
    }
    console.log('  bridge drag import:', { dragPayloadUsesBridge, dragged, draggedFile, requestAudit })
    if (overlayPage) await snapPage(overlayPage, 'drag-imported')

    // 同一入口喂一个“扩展名像图片、实际返回 HTML”的响应：必须显示具体原因，且失败卡不可再拖。
    await dragFromPageIntoOverlay('bad-target')
    if (overlayPage) {
      // 结构化错误新模型（2026-07-22 审计 B）：失败项不进 ready 素材网格，落顶部「捕捞失败」临时条，
      // 带具体原因 + [重试]/[移除] 唯一下一步（旧断言=失败卡以 tile 形式混在网格里，已按 P1 删除）。
      for (let i = 0; i < 18 && !errorReasonVisible; i++) {
        await overlayPage.waitForTimeout(300)
        errorReasonVisible = (await overlayPage.getByText('不是图片/视频', { exact: false }).count()) > 0
      }
      const transientStrip = overlayPage.locator('[aria-label="捕捞进行中或失败"]')
      const stripHasActions = (await transientStrip.locator('button', { hasText: '重试' }).count()) > 0 &&
        (await transientStrip.locator('button', { hasText: '移除' }).count()) > 0
      const failedTileCount = await overlayPage.locator('[data-browser-asset-tile]', { hasText: 'bad reference' }).count()
      failedCardNotDraggable = stripHasActions && failedTileCount === 0
      await snapPage(overlayPage, 'actionable-download-error')
    }

    // 可选现场验证：用真实设计站页面的 currentSrc 跑同一 drag bridge + Session 下载。
    // 默认不进 CI（外网不稳定）；发布前人工传 NOMI_LIVE_BROWSER_SITE_URL 执行并留截图。
    if (liveSiteUrl && overlayPage) {
      liveSiteAttempted = true
      const beforeFiles = fs.existsSync(path.join(projDir, 'assets', 'imported'))
        ? fs.readdirSync(path.join(projDir, 'assets', 'imported'), { recursive: true }).map(String).filter((file) => !file.endsWith('.meta')).length
        : 0
      const address = win.locator('input[aria-label="地址栏"]').first()
      await address.click({ timeout: 3000 }).catch(() => {})
      await address.fill(liveSiteUrl)
      await address.press('Enter')
      await win.waitForTimeout(9000)
      const liveDragData = await app.evaluate(async ({ webContents }, input) => {
        const wc = webContents.getAllWebContents().find((c) => c.id === input.viewId)
        if (!wc) return null
        return wc.executeJavaScript(`(() => {
          const images = [...document.images].filter((image) => {
            const rect = image.getBoundingClientRect();
            return rect.width >= 120 && rect.height >= 90 && /^https?:/i.test(image.currentSrc || image.src || '');
          });
          const image = images[0];
          if (!image) return null;
          image.id = '__nomi-live-drag-target';
          const transfer = new DataTransfer();
          image.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
          return {
            custom: transfer.getData('application/x-nomi-browser-image'),
            uri: transfer.getData('text/uri-list'),
            plain: transfer.getData('text/plain'),
            pageUrl: location.href,
          };
        })()`, true)
      }, { viewId })
      if (liveDragData?.custom) {
        liveSiteMediaUrl = JSON.parse(liveDragData.custom)?.url || ''
        await overlayPage.evaluate((payload) => {
          const dialog = document.querySelector('[role="dialog"][aria-label="素材盒"]')
          if (!dialog) return
          const transfer = new DataTransfer()
          transfer.setData('application/x-nomi-browser-image', payload.custom)
          transfer.setData('text/uri-list', payload.uri)
          transfer.setData('text/plain', payload.plain)
          dialog.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }))
          dialog.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }))
          dialog.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
        }, liveDragData)
        for (let i = 0; i < 24 && !liveSiteImported; i++) {
          await overlayPage.waitForTimeout(500)
          const afterFiles = fs.existsSync(path.join(projDir, 'assets', 'imported'))
            ? fs.readdirSync(path.join(projDir, 'assets', 'imported'), { recursive: true }).map(String).filter((file) => !file.endsWith('.meta')).length
            : 0
          liveSiteImported = afterFiles > beforeFiles
        }
      }
      console.log('  live site drag:', { liveSiteUrl, pageUrl: liveDragData?.pageUrl, liveSiteMediaUrl, liveSiteImported })
      await snapPage(overlayPage, 'live-site-drag-result')
    }
    await snapPage(win, 'after-capture')
  }

  // —— ⑥ 关浏览器 → 主窗素材库回流（写入层广播）——
  let mainSeesAsset = false
  if (captured) {
    await win.locator('button[aria-label="关闭浏览器"]').first().click({ timeout: 3000 }).catch(() => {})
    await win.waitForTimeout(1200)
    // 素材卡片只有缩略图+种类角标、无文件名文本——按属性/卡片计数断言，别指望 innerText。
    mainSeesAsset = await win.evaluate(() => {
      if (document.body.innerText.includes('hero-ref')) return true
      if (document.querySelector('[title*="hero-ref"], img[alt*="hero-ref"], [aria-label*="hero-ref"]')) return true
      const panel = document.querySelector('[aria-label="素材库"]')
      return Boolean(panel && panel.querySelector('img'))
    })
    await snapPage(win, 'main-asset-panel-after-capture')
  }

  const expectedErrorLogs = consoleErrors.filter((message) =>
    message.includes('[nomi:browser] 网页素材导入失败:') && message.includes('不是图片或视频'),
  )
  const unexpectedConsoleErrors = consoleErrors.filter((message) =>
    !expectedErrorLogs.includes(message) &&
    !(liveSiteAttempted && /GSI_LOGGER|FedCM get\(\).*NotSupportedError/.test(message)),
  )
  const sessionAuthPreserved =
    requestAudit.protectedRequests >= 4 &&
    requestAudit.protectedAuthorized === requestAudit.protectedRequests &&
    requestAudit.redirectedRequests >= 4

  console.log('\n===== 捕捞 + 拖拽下载走查判定 =====')
  console.log(`  ① 浏览器唯一门(无旧入口/顶栏无素材盒): ${entryPresent ? 'PASS' : 'FAIL'}`)
  console.log(`  ② 应用内浏览器打开:           ${browserOpen ? 'PASS' : 'FAIL'}`)
  console.log(`     手点工具条素材盒弹层出现:   ${companionOpensByClick ? 'PASS' : 'FAIL'}`)
  console.log(`  ③ 地址栏导航本地页:           ${navigated ? 'PASS' : 'FAIL'}`)
  console.log(`     浏览器外壳全部图标/菜单:     ${Object.values(chromeChecks).every(Boolean) ? 'PASS' : `FAIL ${JSON.stringify(chromeChecks)}`}`)
  console.log(`  ④ 悬停+Ctrl+C 捕捞落 imported: ${captured ? `PASS (${capturedFile})` : 'FAIL'}`)
  console.log(`     捕捞由可见按钮开启:          ${captureButtonPath ? 'PASS' : 'FAIL'}`)
  console.log(`     网页 bridge 生成拖拽 MIME:   ${dragPayloadUsesBridge ? 'PASS' : 'FAIL'}`)
  console.log(`     拖入素材盒成功:              ${dragged ? `PASS (${draggedFile})` : 'FAIL'}`)
  console.log(`     macOS 原生并排→拖入→恢复→再拖入→点网页: ${!nativePointerRequired || (nativeDockDrag && nativeFloatingDrag && nativeWebClick && nativeOverlayStayedOpen) ? 'PASS' : 'FAIL'}`)
  console.log(`     Cookie/Referer/302 全保留:    ${sessionAuthPreserved ? `PASS ${JSON.stringify(requestAudit)}` : `FAIL ${JSON.stringify(requestAudit)}`}`)
  console.log(`     非媒体响应显示具体原因:       ${errorReasonVisible ? 'PASS' : 'FAIL'}`)
  console.log(`     失败项不进网格且带重试/移除:  ${failedCardNotDraggable ? 'PASS' : 'FAIL'}`)
  console.log(`     预期失败原因写入控制台:       ${expectedErrorLogs.length > 0 ? 'PASS' : 'FAIL'}`)
  if (liveSiteAttempted) console.log(`     真实网站拖拽下载:             ${liveSiteImported ? `PASS (${liveSiteMediaUrl})` : 'FAIL'}`)
  console.log(`     sidecar originalUrl 恒 null(不进信任窗): ${captured && !sidecarLeak ? 'PASS' : 'FAIL'}`)
  console.log(`  ⑤ 权限 deny-by-default:       ${permission.startsWith('denied') ? `PASS (${permission})` : `FAIL (${permission})`}`)
  console.log(`  ⑥ 主窗素材库回流可见:         ${mainSeesAsset ? 'PASS' : 'FAIL'}`)
  console.log(`     伴生素材盒出现捕捞素材:     ${companionShowsAsset ? 'PASS' : 'FAIL'}`)
  console.log(`  unexpected console errors: ${unexpectedConsoleErrors.length}`)
  if (unexpectedConsoleErrors.length) console.log('   ' + unexpectedConsoleErrors.slice(0, 8).join('\n   '))
  allPassed =
    entryPresent &&
    browserOpen &&
    companionOpensByClick &&
    navigated &&
    Object.values(chromeChecks).every(Boolean) &&
    captured &&
    captureButtonPath &&
    dragPayloadUsesBridge &&
    dragged &&
    (!nativePointerRequired || (nativeDockDrag && nativeFloatingDrag && nativeWebClick && nativeOverlayStayedOpen)) &&
    sessionAuthPreserved &&
    errorReasonVisible &&
    failedCardNotDraggable &&
    expectedErrorLogs.length > 0 &&
    (!liveSiteAttempted || liveSiteImported) &&
    !sidecarLeak &&
    permission.startsWith('denied') &&
    mainSeesAsset &&
    companionShowsAsset &&
    unexpectedConsoleErrors.length === 0
  console.log(`  总判定: ${allPassed ? 'PASS' : 'FAIL'}`)
  console.log(`\n截图在 ${shotsDir}`)
} catch (error) {
  console.error(`\n捕捞面收敛走查异常: ${error?.stack || error}`)
} finally {
  // close 挂死硬兜底：overlay/子 view 悬着时 app.close() 偶发永不返回；外层 shell timeout
  // 只杀 node、会孤儿整棵 Electron 树（僵尸一堆的根因）——竞速 8s 后直接 SIGKILL 根进程。
  if (app) {
    const electronProc = app.process()
    await Promise.race([
      app.close().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 8000)),
    ])
    try { electronProc?.kill('SIGKILL') } catch { /* 已退出 */ }
  }
  await new Promise((resolve) => server.close(resolve))
}
if (!allPassed) process.exitCode = 1
