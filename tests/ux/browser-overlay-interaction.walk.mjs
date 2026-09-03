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
import { launchNomiApp } from './_launchApp.mjs'
import { expectAbsent, proveProbe } from './_assert.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/browser-overlay')
fs.mkdirSync(shotsDir, { recursive: true })

const base = '/tmp/nomi-overlay-walk'
fs.rmSync(base, { recursive: true, force: true })
fs.mkdirSync(path.join(base, 'projects'), { recursive: true })
const uploadPath = path.join(base, 'walk-upload.png')
fs.writeFileSync(uploadPath, Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
))

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
  let win
  ;({ app, win } = await launchNomiApp({
    name: 'browser-overlay-interaction',
    userDataDir: path.join(base, 'udata'),
    projectsDir: path.join(base, 'projects'),
    env: { NOMI_E2E_SMOKE: '1' },
    settleMs: 1800,
  }))
  win.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('main: ' + m.text()) })
  win.on('pageerror', (e) => consoleErrors.push('main pageerror: ' + e.message))
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
      const el = document.querySelector('.nomi-browser-asset-popover [role="dialog"][aria-label="素材盒"], .nomi-browser-asset-popover')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
    })
    if (!org || !local) return null
    return { left: org.x + local.left, top: org.y + local.top, right: org.x + local.right, bottom: org.y + local.bottom, width: local.width, height: local.height }
  }
  const cardInsideOverlayViewport = async () => overlay.evaluate(() => {
    const el = document.querySelector('[role="dialog"][aria-label="素材盒"]')
    if (!el) return { ok: false, rect: null, viewport: null }
    const rect = el.getBoundingClientRect()
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    return {
      ok: rect.left >= 0 && rect.top >= 0 && rect.right <= viewport.width && rect.bottom <= viewport.height,
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      viewport,
    }
  })
  const hitRect = async () => {
    const raw = await overlay.evaluate(() => window.__nomiOverlayHitRect || null)
    const owner = await app.evaluate(({ BrowserWindow }) => {
      const overlayWindow = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().includes('browser-asset-overlay'))
      return overlayWindow?.getParentWindow()?.getContentBounds() || null
    })
    if (!raw || !owner) return null
    return {
      left: owner.x + raw.left,
      top: owner.y + raw.top,
      right: owner.x + raw.right,
      bottom: owner.y + raw.bottom,
      width: raw.width,
      height: raw.height,
    }
  }
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
  const visibleInteractiveCentersInsideHit = async () => {
    const org = await overlayScreen()
    const hit = await hitRect()
    if (!org || !hit) return { ok: false, outside: ['missing-window-or-hit'] }
    const elements = await overlay.evaluate(() =>
      [...document.querySelectorAll('button,input,textarea,select,[role="tab"],[role="menuitem"],[role="option"]')]
        .filter((el) => {
          const style = getComputedStyle(el)
          const rect = el.getBoundingClientRect()
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
        })
        .map((el) => {
          const rect = el.getBoundingClientRect()
          return {
            label: el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 36) || el.tagName,
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          }
        }),
    )
    const outside = elements
      .filter((element) => !centerInside({
        left: org.x + element.left,
        top: org.y + element.top,
        width: element.width,
        height: element.height,
      }, hit))
      .map((element) => element.label)
    return { ok: outside.length === 0, outside }
  }
  const snap = async (name) => {
    n += 1
    await Promise.race([
      overlay.screenshot({ path: path.join(shotsDir, `${String(n).padStart(2, '0')}-${name}.png`) }).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ])
  }

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

  // ⑥ 资源捕捞开/关：必须由真实按钮切状态，不再直接调 IPC。
  const captureOn = overlay.locator('button[aria-label="开启资源捕捞"]').first()
  if (await captureOn.count()) {
    if (await captureOn.isDisabled()) {
      // 起始页尚无网页 WebContents，禁用是正确行为；真实网页上的开/关由 reference-capture 旅程覆盖。
      results.captureToggleOn = true
      results.captureToggleOff = true
    } else {
      await captureOn.click({ timeout: 2000 }).catch(() => {})
      await overlay.waitForTimeout(350)
      results.captureToggleOn = (await overlay.locator('button[aria-label="关闭资源捕捞"][aria-pressed="true"]').count()) > 0
      await overlay.locator('button[aria-label="关闭资源捕捞"]').first().click({ timeout: 2000 }).catch(() => {})
      await overlay.waitForTimeout(300)
      results.captureToggleOff = (await overlay.locator('button[aria-label="开启资源捕捞"][aria-pressed="false"]').count()) > 0
    }
  }

  // ⑦ 用户口中的“两列”按钮：浮动 → 右侧并排 → 恢复浮动。
  await overlay.locator('button[aria-label="并排显示素材盒"]').first().click({ timeout: 2500 }).catch(() => {})
  await overlay.waitForTimeout(800)
  results.dockRight = (await overlay.locator('[role="dialog"][data-dock-mode="right"]').count()) > 0
  const dockHit = await hitRect()
  const dockWin = await overlayScreen()
  results.dockHitIsCard = Boolean(dockHit && dockWin && dockHit.width < dockWin.width - 40)
  const dockGeometry = await visibleInteractiveCentersInsideHit()
  results.dockControlsInHit = dockGeometry.ok
  if (!dockGeometry.ok) console.log('  dock 热区外控件:', dockGeometry.outside)
  await snap('docked-right')
  await overlay.locator('button[aria-label="恢复浮动素材盒"]').first().click({ timeout: 2500 }).catch(() => {})
  await overlay.waitForTimeout(800)
  results.restoreFloating = (await overlay.locator('[role="dialog"][data-dock-mode="floating"]').count()) > 0
  await snap('restored-floating')

  // ⑧ 搜索、上传、新建文件夹、进入/返回文件夹。
  const search = overlay.locator('input[aria-label="搜索素材"]').first()
  await search.fill('绝不命中的走查词')
  await overlay.waitForTimeout(250)
  results.searchFilters = (await overlay.getByText('没有匹配的素材', { exact: false }).count()) > 0
  await search.fill('')
  await overlay.locator('input[aria-label="选择素材文件"]').setInputFiles(uploadPath)
  await overlay.waitForTimeout(1200)
  results.uploadWorks = (await overlay.getByText('walk-upload.png', { exact: false }).count()) > 0 ||
    (await overlay.locator('[data-browser-asset-tile]').count()) > 0
  await overlay.locator('button[aria-label="新建文件夹"]').first().click({ timeout: 2000 }).catch(() => {})
  const rename = overlay.locator('input[aria-label="重命名文件夹"]').first()
  if (await rename.count()) {
    await rename.fill('走查文件夹')
    await rename.press('Enter')
    await overlay.waitForTimeout(350)
  }
  results.createFolder = (await overlay.getByText('走查文件夹', { exact: true }).count()) > 0
  const folderTile = overlay.locator('[data-browser-asset-tile]', { hasText: '走查文件夹' }).first()
  if (await folderTile.count()) {
    await folderTile.dblclick({ timeout: 2000 }).catch(() => {})
    await overlay.waitForTimeout(350)
    results.enterFolder = (await overlay.locator('button[aria-label="返回上一级文件夹"]').count()) > 0
    await overlay.locator('button[aria-label="返回上一级文件夹"]').first().click({ timeout: 2000 }).catch(() => {})
    await overlay.waitForTimeout(300)
    results.exitFolder = (await overlay.getByText('走查文件夹', { exact: true }).count()) > 0
  }

  // ⑨ 布局、排序、筛选、素材右键、空白右键；每个 icon 真点一遍。
  const more = overlay.locator('button[aria-label="更多素材工具"]').first()
  if (await more.count()) await more.click({ timeout: 2000 }).catch(() => {})
  const layout = overlay.locator('button[aria-label="切换素材布局"]').first()
  if (await layout.count()) {
    const before = await layout.getAttribute('aria-pressed')
    await layout.click({ timeout: 2000 }).catch(() => {})
    results.layoutToggle = (await layout.getAttribute('aria-pressed')) !== before
  }
  const sort = overlay.locator('button[aria-label="最新优先"],button[aria-label="最早优先"]').first()
  if (await sort.count()) {
    const before = await sort.getAttribute('aria-label')
    await sort.click({ timeout: 2000 }).catch(() => {})
    results.sortToggle = (await sort.getAttribute('aria-label')) !== before
  }
  const filter = overlay.locator('button[aria-label="筛选分类"]').first()
  if (await filter.count()) {
    await filter.click({ timeout: 2000 }).catch(() => {})
    await overlay.waitForTimeout(250)
    results.filterOpens = (await overlay.locator('[role="dialog"][aria-label="素材分类筛选"]').count()) > 0
    // 筛掉「走查文件夹」前先证它此刻确实在场（未筛选态）——不然后面的「筛完它消失了」
    // 测不出「压根没渲染/选择器打错」这种恒真陷阱。
    const folderBeforeFilterProof = await proveProbe(overlay.getByText('走查文件夹', { exact: true }), '筛选前「走查文件夹」确实可见')
    const imageOption = overlay.getByRole('option', { name: /图片/ }).first()
    if (await imageOption.count()) await imageOption.click({ timeout: 2000 }).catch(() => {})
    await overlay.waitForTimeout(250)
    let filterHidesFolder = false
    try {
      await expectAbsent(overlay.getByText('走查文件夹', { exact: true }), { provenBy: folderBeforeFilterProof, message: '按图片筛选后「走查文件夹」应被过滤掉' })
      filterHidesFolder = true
    } catch { filterHidesFolder = false }
    results.filterSelects = filterHidesFolder &&
      (await overlay.getByText('walk-upload.png', { exact: false }).count()) > 0
    if (await more.count()) await more.click({ timeout: 2000 }).catch(() => {})
    await overlay.locator('button[aria-label="筛选分类"]').first().click({ timeout: 2000 }).catch(() => {})
    const showAll = overlay.getByText('显示全部', { exact: true }).first()
    if (await showAll.count()) await showAll.click({ timeout: 2000 }).catch(() => {})
  }
  const firstTile = overlay.locator('[data-browser-asset-tile]').first()
  if (await firstTile.count()) {
    await firstTile.click({ button: 'right', timeout: 2000 }).catch(() => {})
    results.assetContextMenu = (await overlay.locator('[role="menu"][aria-label="素材操作"]').count()) > 0
    await overlay.keyboard.press('Escape').catch(() => {})
  }
  const grid = overlay.locator('[aria-label="素材网格"],[aria-label="素材列表"]').first()
  if (await grid.count()) {
    await grid.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      element.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.right - 8,
        clientY: rect.bottom - 8,
      }))
    }).catch(() => {})
    results.blankContextMenu = (await overlay.locator('[role="menu"][aria-label="空白区域操作"]').count()) > 0
    await overlay.keyboard.press('Escape').catch(() => {})
  }
  await snap('controls-exercised')

  // ⑩ 明确收起并从浏览器工具条重开，不允许幽灵 overlay。
  await overlay.locator('button[aria-label="收起素材盒"]').first().click({ timeout: 2000 }).catch(() => {})
  await win.waitForTimeout(600)
  results.collapseWorks = (await win.locator('button[aria-label="打开素材盒"]').count()) > 0
  await win.locator('button[aria-label="打开素材盒"]').first().click({ timeout: 2000 }).catch(() => {})
  await overlay.waitForTimeout(700)
  results.reopenWorks = (await overlay.locator('[role="dialog"][aria-label="素材盒"]').count()) > 0
  const reopenedGeometry = await cardInsideOverlayViewport()
  results.reopenFullyVisible = reopenedGeometry.ok
  console.log(`  ⑩ 重开几何: ${JSON.stringify(reopenedGeometry)}`)
  const finalGeometry = await visibleInteractiveCentersInsideHit()
  results.finalControlsInHit = finalGeometry.ok
  await snap('reopened')

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
    ['资源捕捞按钮开', results.captureToggleOn],
    ['资源捕捞按钮关', results.captureToggleOff],
    ['并排到右侧', results.dockRight],
    ['并排热区仍只覆盖素材盒', results.dockHitIsCard],
    ['并排态全部可见控件在热区', results.dockControlsInHit],
    ['恢复浮动', results.restoreFloating],
    ['搜索过滤', results.searchFilters],
    ['上传素材', results.uploadWorks],
    ['新建文件夹', results.createFolder],
    ['进入文件夹', results.enterFolder],
    ['返回文件夹', results.exitFolder],
    ['网格/列表切换', results.layoutToggle],
    ['最新/最早排序', results.sortToggle],
    ['筛选弹出', results.filterOpens],
    ['筛选生效', results.filterSelects],
    ['素材右键菜单', results.assetContextMenu],
    ['空白右键菜单', results.blankContextMenu],
    ['明确收起', results.collapseWorks],
    ['工具条重开', results.reopenWorks],
    ['重开后素材盒完整可见', results.reopenFullyVisible],
    ['重开后全部可见控件在热区', results.finalControlsInHit],
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
