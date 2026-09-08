// R13 走查：素材盒浮层窗（独立 BrowserWindow）能不能真的读写素材。
//
// 为什么要它：素材盒被拆成独立透明窗口后，它调的 `nomi:assets:list` /
// `nomi:assets:import-file` 两条 handler 用的是 `assertTrustedSender`（只认主窗口），
// 于是浮层里「拖文件进去=保存失败」「已落盘素材一条都列不出来」。
// 列表那条更阴：useBrowserAssetLibraryModel 的 catch 把错误吞成空数组，
// 界面表现是**空态**而不是报错——五门全绿也看不出来。
//
// 阳性对照：同一份 payload，先在主窗口调一次（必须成功），再在浮层窗调一次。
// 修复前浮层那次必须抛 UntrustedIpcSenderError；修复后两次都成功且条数一致。
//
// 用法: pnpm build && node tests/ux/browser-overlay-asset-ipc.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/browser-overlay-asset-ipc')
fs.mkdirSync(shotsDir, { recursive: true })

const base = '/tmp/nomi-overlay-asset-ipc-walk'
fs.rmSync(base, { recursive: true, force: true })
fs.mkdirSync(path.join(base, 'projects'), { recursive: true })

// 1x1 PNG：素材内容不重要，能落盘就行。
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const results = {}
let app = null
let n = 0

/** 在给定页面里调一次 desktop bridge，把成功/失败都如实带回来（不吞异常）。 */
async function callBridge(page, script, arg) {
  return page.evaluate(async ({ src, value }) => {
    const fn = new Function('desktop', 'arg', `return (${src})(desktop, arg)`)
    try {
      return { ok: true, value: await fn(window.nomiDesktop, value) }
    } catch (error) {
      return { ok: false, error: String(error?.message || error) }
    }
  }, { src: script, value: arg })
}

const LIST_CALL = `async (desktop, arg) => { const page = await desktop.assets.list({ projectId: arg.projectId, cursor: null, limit: 50 }); return { count: page.items.length } }`
const IMPORT_CALL = `async (desktop, arg) => {
  const bytes = Uint8Array.from(atob(arg.base64), (c) => c.charCodeAt(0))
  const res = await desktop.assets.importFile({
    projectId: arg.projectId,
    fileName: arg.fileName,
    contentType: 'image/png',
    kind: 'image',
    bytes: bytes.buffer,
  })
  return { url: res?.url || res?.relativePath || 'imported' }
}`

try {
  let win
  ;({ app, win } = await launchNomiApp({
    name: 'browser-overlay-asset-ipc',
    userDataDir: path.join(base, 'udata'),
    projectsDir: path.join(base, 'projects'),
    env: { NOMI_E2E_SMOKE: '1' },
    settleMs: 1800,
  }))

  await win.keyboard.press('Escape').catch(() => {})
  const skip = win.getByText('跳过').first()
  if (await skip.count()) {
    await skip.click().catch(() => {})
    await win.waitForTimeout(700)
  }
  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2500)
  await win.keyboard.press('Escape').catch(() => {})

  const projectId = await win.evaluate(
    () => (window.localStorage.getItem('nomi-workbench-last-active-project-v1') || '').trim(),
  )
  results.projectId = Boolean(projectId)
  if (!projectId) throw new Error('no active project id')

  // ── 阳性对照 A：主窗口调这两条，必须成功 ────────────────────────────────
  const mainImport = await callBridge(win, IMPORT_CALL, {
    projectId,
    fileName: 'seed-from-main.png',
    base64: PNG_BASE64,
  })
  results.mainImportOk = mainImport.ok
  const mainList = await callBridge(win, LIST_CALL, { projectId })
  results.mainListOk = mainList.ok && mainList.value.count > 0
  console.log(`主窗口 import: ${JSON.stringify(mainImport)}`)
  console.log(`主窗口 list  : ${JSON.stringify(mainList)}`)

  // ── 打开浏览器 → 打开素材盒浮层 ────────────────────────────────────────
  // 先进生成画布：应用内浏览器只在画布壳里有宿主（同 browser-overlay-interaction.walk.mjs）。
  const goGenerate = win.getByRole('button', { name: '生成', exact: false }).first()
  if (await goGenerate.count()) await goGenerate.click()
  await win.waitForTimeout(1200)
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-browser')))
  // 等真实信号（地址栏出现）而不是睡固定时长：浏览器起得慢一点就会读到空，睡出来的绿不算数。
  const addressBar = win.locator('input[aria-label="地址栏"]').first()
  results.browserOpen = await addressBar
    .waitFor({ state: 'visible', timeout: 20000 })
    .then(() => true)
    .catch(() => false)
  // 真入口：浏览器工具条上的「素材盒」按钮（NomiBrowserDialogView.tsx:322 唯一入口）。
  // 不用自定义事件——`nomi-browser-asset-popover-open` 在 src/ 里已无监听方（死线）。
  await win.getByRole('button', { name: '素材盒', exact: false }).first().click()
  let overlay = null
  for (let i = 0; i < 12 && !overlay; i++) {
    await win.waitForTimeout(400)
    overlay = app.windows().find((p) => p.url().includes('browser-asset-overlay')) || null
  }
  results.overlayOpen = Boolean(overlay)
  if (!overlay) throw new Error('overlay window never appeared')
  await overlay.waitForTimeout(1500)

  // ── 被测面 B：浮层窗调同样两条 ────────────────────────────────────────
  const overlayList = await callBridge(overlay, LIST_CALL, { projectId })
  const overlayImport = await callBridge(overlay, IMPORT_CALL, {
    projectId,
    fileName: 'from-overlay.png',
    base64: PNG_BASE64,
  })
  console.log(`浮层窗 list  : ${JSON.stringify(overlayList)}`)
  console.log(`浮层窗 import: ${JSON.stringify(overlayImport)}`)
  results.overlayListOk = overlayList.ok && overlayList.value.count > 0
  results.overlayImportOk = overlayImport.ok
  results.overlayListMatchesMain =
    overlayList.ok && mainList.ok && overlayList.value.count === mainList.value.count

  // 界面证据：浮层里到底列没列出素材。
  // 浮层自带素材盒界面，无需再触发事件。
  await overlay.waitForTimeout(1600)
  await overlay.screenshot({ path: path.join(shotsDir, `${String(++n).padStart(2, '0')}-overlay-asset-box.png`) })
  await win.screenshot({ path: path.join(shotsDir, `${String(++n).padStart(2, '0')}-main-window.png`) })

  const checks = [
    ['主窗口 import 成功（阳性对照）', results.mainImportOk],
    ['主窗口 list 拿到素材（阳性对照）', results.mainListOk],
    ['应用内浏览器打开', results.browserOpen],
    ['浮层窗打开', results.overlayOpen],
    ['浮层窗 list 拿到素材', results.overlayListOk],
    ['浮层窗 list 条数与主窗口一致', results.overlayListMatchesMain],
    ['浮层窗 import 成功', results.overlayImportOk],
  ]
  console.log('')
  for (const [label, ok] of checks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  const allPass = checks.every(([, ok]) => ok)
  console.log(`  总判定: ${allPass ? 'PASS' : 'FAIL'}`)
  console.log(`\n截图在 ${shotsDir}`)
  if (!allPass) process.exitCode = 1
} catch (error) {
  console.error(`\n素材盒浮层 IPC 走查异常: ${error?.stack || error}`)
  process.exitCode = 1
} finally {
  if (app) {
    const proc = app.process()
    await Promise.race([app.close().catch(() => {}), new Promise((r) => setTimeout(r, 8000))])
    try {
      proc?.kill('SIGKILL')
    } catch {
      /* 已退出 */
    }
  }
}
