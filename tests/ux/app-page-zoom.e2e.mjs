// Electron 主窗口页面缩放回归：Cmd/Ctrl +/-/0 不能改变应用壳 zoom factor。
// 画布有自己的缩放模型；这里锁的是 Chromium 页面级缩放，避免整个 UI 越缩越小。
// 用法：pnpm run build && node tests/ux/app-page-zoom.e2e.mjs
import { launchNomiApp } from './_launchApp.mjs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, mkdirSync } from 'node:fs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tmp = mkdtempSync(path.join(os.tmpdir(), 'nomi-page-zoom-'))
const outDir = path.join(repoRoot, '.page-zoom-lab')
mkdirSync(outDir, { recursive: true })

const { app, win: _launchedWin } = await launchNomiApp({
  name: 'app-page-zoom',
  userDataDir: path.join(tmp, 'udata'),
  env: { NOMI_E2E_SMOKE: '1' },
  settleMs: 1200,
})

async function readMainZoomFactor() {
  return app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed() && window.getTitle() === 'Nomi')
    return main?.webContents.getZoomFactor() ?? null
  })
}

async function setMainZoomFactor(factor) {
  return app.evaluate(({ BrowserWindow }, nextFactor) => {
    const main = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed() && window.getTitle() === 'Nomi')
    main?.webContents.setZoomFactor(nextFactor)
  }, factor)
}

async function installInputProbe() {
  return app.evaluate(({ BrowserWindow }) => {
    globalThis.__nomiZoomInputs = []
    const main = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed() && window.getTitle() === 'Nomi')
    main?.webContents.on('before-input-event', (_event, input) => {
      globalThis.__nomiZoomInputs.push({
        type: input.type,
        key: input.key,
        code: input.code,
        control: input.control,
        meta: input.meta,
        alt: input.alt,
        shift: input.shift,
      })
    })
  })
}

async function readInputProbe() {
  return app.evaluate(() => globalThis.__nomiZoomInputs ?? [])
}

async function pressMainShortcut(keyCode, modifier) {
  return app.evaluate(({ BrowserWindow }, payload) => {
    const main = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed() && window.getTitle() === 'Nomi')
    main?.webContents.sendInputEvent({ type: 'keyDown', keyCode: payload.keyCode, modifiers: [payload.modifier] })
    main?.webContents.sendInputEvent({ type: 'keyUp', keyCode: payload.keyCode, modifiers: [payload.modifier] })
  }, { keyCode, modifier })
}

async function closeApp() {
  const child = app.process()
  await Promise.race([
    app.close().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 8000)),
  ])
  if (child.exitCode === null) child.kill('SIGKILL')
}

try {
  const win = _launchedWin
  await win.bringToFront()
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((window) => !window.isDestroyed() && window.getTitle() === 'Nomi')?.focus()
  })
  await win.locator('body').click({ position: { x: 24, y: 24 } }).catch(() => {})

  const modifier = process.platform === 'darwin' ? 'meta' : 'control'
  const initial = await readMainZoomFactor()
  await installInputProbe()

  // 模拟用户已经被页面缩放困在 80%：真实按重置快捷键必须由主窗口守卫恢复到 100%。
  await setMainZoomFactor(0.8)
  await pressMainShortcut('0', modifier)
  await win.waitForTimeout(500)
  const afterRecovery = await readMainZoomFactor()

  await pressMainShortcut('-', modifier)
  await win.waitForTimeout(500)
  const afterDecrease = await readMainZoomFactor()
  await pressMainShortcut('=', modifier)
  await win.waitForTimeout(500)
  const afterIncrease = await readMainZoomFactor()
  await pressMainShortcut('0', modifier)
  await win.waitForTimeout(300)
  const afterReset = await readMainZoomFactor()

  // 画布缩放是另一套业务状态，必须继续可用。进入生成画布后调 range，页面 factor 仍应保持 1。
  await win.keyboard.press('Escape').catch(() => {})
  const projectCard = win.locator('[data-project-card]').first()
  if ((await projectCard.count()) > 0) await projectCard.click()
  else await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2200)
  await win.keyboard.press('Escape').catch(() => {})
  const generationTab = win.getByRole('button', { name: '生成', exact: false }).first()
  if ((await generationTab.count()) > 0) await generationTab.click()
  const canvasZoom = win.getByRole('slider', { name: '缩放比例' }).first()
  await canvasZoom.waitFor({ state: 'visible', timeout: 8000 })
  const beforeCanvasZoom = Number(await canvasZoom.inputValue())
  const targetCanvasZoom = beforeCanvasZoom === 150 ? 125 : 150
  await canvasZoom.evaluate((element, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(element, String(value))
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }, targetCanvasZoom)
  await win.waitForTimeout(500)
  const afterCanvasZoom = Number(await canvasZoom.inputValue())
  const afterCanvasPageFactor = await readMainZoomFactor()
  await win.screenshot({ path: path.join(outDir, 'app-page-zoom-guard.png') })

  const inputs = await readInputProbe()
  console.log(JSON.stringify({
    initial,
    afterRecovery,
    afterDecrease,
    afterIncrease,
    afterReset,
    beforeCanvasZoom,
    targetCanvasZoom,
    afterCanvasZoom,
    afterCanvasPageFactor,
    inputs,
  }))
  const pageZoomLocked = [initial, afterRecovery, afterDecrease, afterIncrease, afterReset, afterCanvasPageFactor]
    .every((factor) => factor === 1)
  const ok = pageZoomLocked && afterCanvasZoom === targetCanvasZoom
  await closeApp()
  process.exit(ok ? 0 : 1)
} catch (error) {
  console.error(error)
  await closeApp()
  process.exit(1)
}
