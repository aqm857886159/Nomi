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
  res.end(`<!doctype html><html><head><title>捕捞测试页</title></head><body style="margin:40px;font-family:sans-serif">
    <h1>参考图测试页</h1>
    <img id="hero" src="/hero-ref.png" alt="hero reference" style="width:240px;height:240px;image-rendering:pixelated" />
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
  const noTopbarAssetBox = (await win.locator('button[aria-label="打开素材盒"]').count()) === 0
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
    await win.locator('button[aria-label="打开素材盒"]').first().click({ timeout: 3000 }).catch(() => {})
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
  let browserViewId = null
  if (viewId !== null) {
    // 开捕捞模式：走与「素材盒开关」完全相同的生产 IPC（browser:view:set-resource-capture，
    // sender 校验同为主窗）。viewId 是浏览器视图记录号（≠webContents id），探测 1..6：
    // 命中的那个会在页面里装上 __nomiReadBrowserResourceCapture 桥。
    for (let candidate = 1; candidate <= 6 && browserViewId === null; candidate++) {
      await win.evaluate((id) => {
        window.nomiDesktop?.browser?.setResourceCapture?.({ viewId: id, enabled: true })
      }, candidate)
      await win.waitForTimeout(500)
      const installed = await app.evaluate(async ({ webContents }, id) => {
        const wc = webContents.getAllWebContents().find((c) => c.id === id)
        if (!wc) return false
        return wc.executeJavaScript('typeof window.__nomiReadBrowserResourceCapture === "function"', true)
      }, viewId)
      if (installed) browserViewId = candidate
    }
    console.log('  resource capture enabled via viewId:', browserViewId)
    await snapPage(win, 'capture-mode-on')

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

    if (hoverInfo.ok && browserViewId !== null) {
      // 触发捕捞：Ctrl+C 键盘监听发的就是这条 IPC（browser:view:capture-resource），
      // 同一 sender、同一主进程链路（读悬停候选 → 下载 → 弹层导入 → 落库）。
      // 走查探针：先订阅捕捞结果事件，看主进程回了什么。
      await win.evaluate((id) => {
        window.__walkCaptureEvents = []
        window.nomiDesktop?.browser?.onResourceCapture?.((event) => {
          window.__walkCaptureEvents.push(event)
        })
        window.nomiDesktop?.browser?.captureResource?.({ viewId: id })
      }, browserViewId)
      await win.waitForTimeout(2500)
      const captureEvents = await win.evaluate(() => window.__walkCaptureEvents || [])
      console.log('  capture events:', JSON.stringify(captureEvents).slice(0, 400))
      // overlay 窗口若被捕捞事件带起：拍照留证 + 断言伴生素材盒里出现捕捞素材（方案一
      // 顶栏徽章已删，「捕捞可见性」由伴生弹层承担）。
      const overlayPage = app.windows().find((p) => p.url().includes('browser-asset-overlay')) || null
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

  console.log('\n===== 捕捞面收敛走查判定 =====')
  console.log(`  ① 浏览器唯一门(无旧入口/顶栏无素材盒): ${entryPresent ? 'PASS' : 'FAIL'}`)
  console.log(`  ② 应用内浏览器打开:           ${browserOpen ? 'PASS' : 'FAIL'}`)
  console.log(`     手点工具条素材盒弹层出现:   ${companionOpensByClick ? 'PASS' : 'FAIL'}`)
  console.log(`  ③ 地址栏导航本地页:           ${navigated ? 'PASS' : 'FAIL'}`)
  console.log(`  ④ 悬停+Ctrl+C 捕捞落 imported: ${captured ? `PASS (${capturedFile})` : 'FAIL'}`)
  console.log(`     sidecar originalUrl 恒 null(不进信任窗): ${captured && !sidecarLeak ? 'PASS' : 'FAIL'}`)
  console.log(`  ⑤ 权限 deny-by-default:       ${permission.startsWith('denied') ? `PASS (${permission})` : `FAIL (${permission})`}`)
  console.log(`  ⑥ 主窗素材库回流可见:         ${mainSeesAsset ? 'PASS' : 'FAIL'}`)
  console.log(`     伴生素材盒出现捕捞素材:     ${companionShowsAsset ? 'PASS' : 'FAIL'}`)
  console.log(`  console errors: ${consoleErrors.length}`)
  if (consoleErrors.length) console.log('   ' + consoleErrors.slice(0, 8).join('\n   '))
  allPassed =
    entryPresent &&
    browserOpen &&
    companionOpensByClick &&
    navigated &&
    captured &&
    !sidecarLeak &&
    permission.startsWith('denied') &&
    mainSeesAsset &&
    companionShowsAsset &&
    consoleErrors.length === 0
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
