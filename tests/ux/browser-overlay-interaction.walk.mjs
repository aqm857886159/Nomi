// R13 走查：应用内浏览器「素材盒」浮层交互 + 几何不变量（窗口穿透类的守卫）。
//
// 为什么要它：素材盒是独立透明窗口，靠 OS 级穿透（setIgnoreMouseEvents + 光标轮询 +
// 吸附态窗口 shape）实现"卡片可点、卡片外点穿到网页"。Playwright 给渲染进程派合成事件，
// 绕过整层窗口机制——DOM 点击永远"能点"，测不到穿透。唯一能程序化验证的办法=几何对账：
// 把「上报给主进程的可点热区」(window.__nomiOverlayHitRect, 屏幕坐标) 与「可交互元素实际位置」
// 比对，任何落在热区外的可交互元素 = 真机点它必穿透到网页。
//
// 本轮抓的具体 bug（2026-07-13 用户报「提示词库/设置点不进去」）：BrowserPromptExtractionSettingsModal
// 用 fixed inset-0 居中铺满整窗，但热区默认只覆盖卡片矩形 → 设置框落在卡片外死区被点穿。
// 修=溢出整窗的模态在场时热区扩到整窗。本走查断言修复生效 + 顺带遍历浮层控件。
//
// 用法: pnpm build && node tests/ux/browser-overlay-interaction.walk.mjs
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/browser-overlay')
fs.mkdirSync(shotsDir, { recursive: true })

const base = '/tmp/nomi-overlay-walk'
fs.rmSync(base, { recursive: true, force: true })
fs.mkdirSync(path.join(base, 'projects'), { recursive: true })

const results = {}
const consoleErrors = []
let app = null
let n = 0

function centerInside(elemScreen, rectScreen) {
  if (!elemScreen || !rectScreen) return false
  const cx = elemScreen.left + elemScreen.width / 2
  const cy = elemScreen.top + elemScreen.height / 2
  return cx >= rectScreen.left && cx <= rectScreen.right && cy >= rectScreen.top && cy <= rectScreen.bottom
}

try {
  app = await electron.launch({
    executablePath: require('electron'),
    args: ['.', `--user-data-dir=${path.join(base, 'udata')}`],
    cwd: repoRoot,
    env: { ...process.env, NOMI_E2E: '1', NOMI_E2E_SMOKE: '1', NOMI_PROJECTS_DIR: path.join(base, 'projects') },
  })
  const win = await app.firstWindow()
  win.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('main: ' + m.text()) })
  win.on('pageerror', (e) => consoleErrors.push('main pageerror: ' + e.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1800)
  await win.keyboard.press('Escape').catch(() => {})
  const skip = win.getByText('跳过').first()
  if (await skip.count()) { await skip.click().catch(() => {}); await win.waitForTimeout(700) }
  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2500)
  await win.keyboard.press('Escape').catch(() => {})
  const g = win.getByRole('button', { name: '生成', exact: false }).first()
  if (await g.count()) await g.click()
  await win.waitForTimeout(1200)

  // 打开浏览器 → 打开素材盒浮层
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-browser')))
  await win.waitForTimeout(1800)
  results.browserOpen = (await win.locator('input[aria-label="地址栏"]').count()) > 0
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-browser-asset-popover-open', { detail: { opened: true } })))
  let overlay = null
  for (let i = 0; i < 12 && !overlay; i++) {
    await win.waitForTimeout(400)
    overlay = app.windows().find((p) => p.url().includes('browser-asset-overlay')) || null
  }
  results.overlayOpen = Boolean(overlay)
  if (!overlay) throw new Error('overlay window never appeared')
  overlay.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('overlay: ' + m.text()) })
  overlay.on('pageerror', (e) => consoleErrors.push('overlay pageerror: ' + e.message))
  await overlay.waitForTimeout(1200)

  const overlayScreen = async () =>
    app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('browser-asset-overlay'))
      return w ? w.getContentBounds() : null
    })
  const cardRectScreen = async () => {
    const org = await overlayScreen()
    const local = await overlay.evaluate(() => {
      const el = document.querySelector('.nomi-browser-asset-popover [role="dialog"][aria-label="资产包"], .nomi-browser-asset-popover')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
    })
    if (!org || !local) return null
    return { left: org.x + local.left, top: org.y + local.top, right: org.x + local.right, bottom: org.y + local.bottom, width: local.width, height: local.height }
  }
  const hitRect = async () => overlay.evaluate(() => window.__nomiOverlayHitRect || null)
  const elemScreen = async (selector) => {
    const org = await overlayScreen()
    const local = await overlay.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
    }, selector)
    if (!org || !local) return null
    return { left: org.x + local.left, top: org.y + local.top, right: org.x + local.right, bottom: org.y + local.bottom, width: local.width, height: local.height }
  }
  const snap = async (name) => { n += 1; await overlay.screenshot({ path: path.join(shotsDir, `${String(n).padStart(2, '0')}-${name}.png`) }).catch(() => {}) }

  await snap('overlay-default')

  // ① 默认态：热区 ≈ 卡片矩形（不是整窗），且工具条关键控件都在热区内
  const win0 = await overlayScreen()
  const hit0 = await hitRect()
  const card0 = await cardRectScreen()
  const hitIsFull0 = hit0 && win0 && hit0.width >= win0.width - 4 && hit0.height >= win0.height - 4
  results.defaultHitIsCard = Boolean(hit0 && !hitIsFull0)
  const settingsBtn = await elemScreen('button[aria-label="提示词提取设置"]')
  results.settingsBtnInHitDefault = centerInside(settingsBtn, hit0)
  console.log(`  ① 默认热区=卡片(非整窗): ${results.defaultHitIsCard}  win=${JSON.stringify(win0)} hit=${JSON.stringify(hit0)}`)

  // ② 遍历工具条控件都在热区内（默认态可点）
  for (const [key, sel] of [
    ['source项目素材', 'button[role="tab"]'],
    ['搜索框', 'input[aria-label="搜索素材"]'],
    ['提取设置', 'button[aria-label="提示词提取设置"]'],
  ]) {
    const e = await elemScreen(sel)
    results[`ctl_${key}`] = centerInside(e, hit0)
  }

  // ③ 打开提示词提取设置 → 溢出整窗模态。热区必须扩到整窗，否则设置框被点穿。
  await overlay.locator('button[aria-label="提示词提取设置"]').first().click({ timeout: 3000 }).catch(() => {})
  await overlay.waitForTimeout(900)
  results.settingsModalOpen = (await overlay.locator('[data-nomi-prompt-extraction-settings-dialog]').count()) > 0
  await snap('settings-open')
  const win1 = await overlayScreen()
  const hit1 = await hitRect()
  results.hitExpandedToFull = Boolean(hit1 && win1 && hit1.width >= win1.width - 4 && hit1.height >= win1.height - 4)
  // 设置框里的可交互控件落在热区内=可点。取左栏控件（模式切换在 220px 左列）——它必落在
  // 卡片外的死区（修复前被点穿），是"修复有意义"的最强证据。
  const modalBtn = await elemScreen('[data-nomi-prompt-extraction-settings-dialog] button')
  results.modalBtnInHit = centerInside(modalBtn, hit1)
  // 面板本体（920px 居中）左缘必远在卡片左缘之外 → 面板左 2/3 是修复前的点穿死区。
  const panel = await elemScreen('[data-nomi-prompt-extraction-settings-dialog] > div')
  results.modalOutsideCard = Boolean(panel && card0 && panel.left < card0.left - 40)
  console.log(`  ③ 设置开:热区扩整窗=${results.hitExpandedToFull} 模态钮在热区=${results.modalBtnInHit} 面板伸出卡外(证明修复有意义)=${results.modalOutsideCard}`)
  console.log(`     win=${JSON.stringify(win1)} hit=${JSON.stringify(hit1)} panel=${JSON.stringify(panel)} card=${JSON.stringify(card0)}`)

  // ④ 关闭设置 → 热区缩回卡片
  await overlay.locator('button[aria-label="关闭提示词提取设置"]').first().click({ timeout: 3000 }).catch(() => {})
  await overlay.waitForTimeout(700)
  const win2 = await overlayScreen()
  const hit2 = await hitRect()
  const hitFull2 = hit2 && win2 && hit2.width >= win2.width - 4 && hit2.height >= win2.height - 4
  results.hitRevertedToCard = Boolean(hit2 && !hitFull2)
  await snap('settings-closed')

  // ⑤ 源标签切换（项目素材 ↔ 提示词库）不崩、控件仍在热区
  const tabs = overlay.locator('button[role="tab"]')
  const tabCount = await tabs.count()
  if (tabCount >= 2) {
    await tabs.nth(1).click({ timeout: 2000 }).catch(() => {})
    await overlay.waitForTimeout(600)
    results.tabSwitchOk = (await overlay.locator('button[role="tab"]').count()) >= 2
    await snap('tab-prompt')
    await tabs.nth(0).click({ timeout: 2000 }).catch(() => {})
    await overlay.waitForTimeout(400)
  }

  console.log('\n===== 素材盒浮层交互走查判定 =====')
  const checks = [
    ['浏览器打开', results.browserOpen],
    ['素材盒浮层打开', results.overlayOpen],
    ['默认热区=卡片(非整窗)', results.defaultHitIsCard],
    ['工具条控件在热区(tab)', results.ctl_source项目素材],
    ['工具条控件在热区(搜索)', results.ctl_搜索框],
    ['工具条控件在热区(设置)', results.ctl_提取设置],
    ['设置模态打开', results.settingsModalOpen],
    ['★热区扩到整窗(修复)', results.hitExpandedToFull],
    ['★设置钮落在热区内=可点', results.modalBtnInHit],
    ['★设置框伸出卡外(证明修复有意义)', results.modalOutsideCard],
    ['关闭后热区缩回卡片', results.hitRevertedToCard],
    ['源标签切换不崩', results.tabSwitchOk],
  ]
  for (const [label, ok] of checks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  console.log(`  console errors: ${consoleErrors.length}`)
  if (consoleErrors.length) console.log('   ' + consoleErrors.slice(0, 8).join('\n   '))
  const allPass = checks.every(([, ok]) => ok) && consoleErrors.length === 0
  console.log(`  总判定: ${allPass ? 'PASS' : 'FAIL'}`)
  console.log(`\n截图在 ${shotsDir}`)
  if (!allPass) process.exitCode = 1
} catch (error) {
  console.error(`\n素材盒浮层走查异常: ${error?.stack || error}`)
  process.exitCode = 1
} finally {
  if (app) {
    const proc = app.process()
    await Promise.race([app.close().catch(() => {}), new Promise((r) => setTimeout(r, 8000))])
    try { proc?.kill('SIGKILL') } catch { /* 已退出 */ }
  }
}
