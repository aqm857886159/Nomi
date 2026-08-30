// 760x560 Settings shell + 880x640 third-level model dialog + stale-model recovery.
// Usage: pnpm build && node scripts/settings-fixed-shell-walkthrough.mjs
import { mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.settings-fixed-shell-walk')
mkdirSync(outDir, { recursive: true })

const { app, win } = await launchNomiApp({
  name: 'settings-fixed-shell',
  settingsDir: mkdtempSync(path.join(os.tmpdir(), 'settings-fixed-shell-set-')),
  projectsDir: mkdtempSync(path.join(os.tmpdir(), 'settings-fixed-shell-proj-')),
  env: { NOMI_RENDERER_URL: `file://${path.join(repoRoot, 'dist', 'index.html')}` },
  syntheticCredentialStorage: true,
  settleMs: 1600,
})

const pageErrors = []
win.on('pageerror', (error) => pageErrors.push(String(error)))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function screenshot(name) {
  const target = path.join(outDir, name)
  await win.screenshot({ path: target })
  console.log(`  screenshot: ${target}`)
}

async function rect(locator) {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect()
    return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom }
  })
}

async function modelDialogState(win, pageSelector) {
  return win.evaluate((selector) => {
    const visible = (element) => element instanceof HTMLElement && element.getClientRects().length > 0 && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden'
    const highestLayer = (start) => {
      let current = start
      let highest = 0
      while (current) {
        const value = Number.parseInt(getComputedStyle(current).zIndex || '0', 10)
        if (Number.isFinite(value)) highest = Math.max(highest, value)
        current = current.parentElement
      }
      return highest
    }
    const box = (element) => {
      if (!(element instanceof HTMLElement)) return null
      const bounds = element.getBoundingClientRect()
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, right: bounds.right, bottom: bounds.bottom }
    }
    const settings = document.querySelector('[data-settings-dialog]')
    const modelRoot = document.querySelector('[data-model-settings-dialog]')
    const modelPanel = modelRoot?.closest('[role="dialog"]')
    const page = document.querySelector(selector)
    const active = document.activeElement
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      visibleDialogs: [...document.querySelectorAll('[role="dialog"]')].filter(visible).length,
      settingsVisible: visible(settings),
      modelVisible: visible(modelRoot) && visible(modelPanel),
      pageInsideModelDialog: page instanceof HTMLElement && Boolean(modelRoot?.contains(page)),
      pageInsideSettings: page instanceof HTMLElement && Boolean(settings?.contains(page)),
      focusedInside: active instanceof Element && Boolean(modelRoot?.contains(active)),
      settingsLayer: settings ? highestLayer(settings) : 0,
      modelLayer: modelPanel ? highestLayer(modelPanel) : 0,
      settingsRect: box(settings),
      modelRect: box(modelPanel),
      horizontalOverflow: [modelPanel, page].some((element) => element instanceof HTMLElement && element.scrollWidth > element.clientWidth + 2),
      documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
    }
  }, pageSelector)
}

function assertDesktopModelDialog(state, label) {
  assert(state.visibleDialogs === 2, `${label}: expected Settings plus model dialog, got ${state.visibleDialogs}`)
  assert(state.settingsVisible && state.modelVisible, `${label}: Settings or model dialog is not visible`)
  assert(state.pageInsideModelDialog && !state.pageInsideSettings, `${label}: model page has the wrong owner`)
  assert(state.focusedInside, `${label}: keyboard focus is outside the model dialog`)
  assert(state.modelLayer > state.settingsLayer, `${label}: model dialog is not above Settings (${state.modelLayer} <= ${state.settingsLayer})`)
  assert(Math.abs(state.settingsRect.width - 760) <= 1, `${label}: Settings width changed to ${state.settingsRect.width}`)
  assert(Math.abs(state.settingsRect.height - 560) <= 1, `${label}: Settings height changed to ${state.settingsRect.height}`)
  assert(Math.abs(state.modelRect.width - 880) <= 1, `${label}: model dialog width is ${state.modelRect.width}, expected 880`)
  assert(Math.abs(state.modelRect.height - 640) <= 1, `${label}: model dialog height is ${state.modelRect.height}, expected 640`)
  assert(!state.horizontalOverflow && !state.documentOverflow, `${label}: horizontal overflow ${JSON.stringify(state)}`)
}

function assertNarrowModelDialog(state, label) {
  assert(state.visibleDialogs === 2, `${label}: expected Settings plus model dialog, got ${state.visibleDialogs}`)
  assert(state.settingsVisible && state.modelVisible, `${label}: Settings or model dialog is not visible`)
  assert(state.pageInsideModelDialog && !state.pageInsideSettings, `${label}: model page has the wrong owner`)
  assert(state.focusedInside, `${label}: keyboard focus is outside the model dialog`)
  assert(state.modelLayer > state.settingsLayer, `${label}: model dialog is not above Settings (${state.modelLayer} <= ${state.settingsLayer})`)
  assert(state.modelRect.x >= 0 && state.modelRect.y >= 0, `${label}: model dialog starts outside the viewport`)
  assert(state.modelRect.right <= state.viewport.width + 1 && state.modelRect.bottom <= state.viewport.height + 1, `${label}: model dialog extends beyond the viewport`)
  assert(state.modelRect.width >= state.viewport.width - 32, `${label}: model dialog is not near full width (${state.modelRect.width}/${state.viewport.width})`)
  assert(state.modelRect.height >= state.viewport.height - 32, `${label}: model dialog is not near full height (${state.modelRect.height}/${state.viewport.height})`)
  assert(!state.horizontalOverflow && !state.documentOverflow, `${label}: horizontal overflow ${JSON.stringify(state)}`)
}

async function assertNonModelPageVisible(settings, modelWorkspace, label) {
  const contentLabel = settings.locator('[data-settings-content]').getByText(label, { exact: true }).first()
  await contentLabel.waitFor({ state: 'visible' })
  assert(await contentLabel.isVisible(), `${label}: active settings page is not visible`)

  const workspaceState = await modelWorkspace.evaluate((element) => ({
    hidden: element.hasAttribute('hidden'),
    display: getComputedStyle(element).display,
    visibleRects: element.getClientRects().length,
  }))
  assert(workspaceState.hidden, `${label}: mounted model workspace lost its hidden attribute`)
  assert(workspaceState.display === 'none', `${label}: mounted model workspace display is ${workspaceState.display}`)
  assert(workspaceState.visibleRects === 0, `${label}: mounted model workspace still occupies visible layout space`)
}

try {
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((window) => window.setBounds({ x: 0, y: 0, width: 1440, height: 1000 })).catch(() => {})

  const skip = win.getByRole('button', { name: /跳过|Skip/ }).first()
  if (await skip.isVisible().catch(() => false)) await skip.click()

  await win.evaluate(() => {
    const catalog = window.nomiDesktop?.modelCatalog
    catalog?.upsertVendor({
      key: 'fixed-shell-fixture',
      name: '固定外壳测试连接',
      baseUrlHint: 'http://127.0.0.1:9898/v1',
      protocol: 'openai',
      authType: 'bearer',
    })
    catalog?.upsertVendorApiKey('fixed-shell-fixture', { apiKey: 'sk-fixture', enabled: true })
    catalog?.upsertModel({
      vendorKey: 'fixed-shell-fixture',
      modelKey: 'future-video-model',
      labelZh: 'future-video-model',
      kind: 'video',
      enabled: true,
      meta: { adapter: 'damaged-legacy-value', customCapabilityContract: { version: null, modes: 'invalid' } },
    })
  })

  await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-settings')))
  const settings = win.locator('[data-settings-dialog]')
  await settings.waitFor({ state: 'visible' })

  const labels = ['文件与保存', '模型', 'AI 策略', '自动化与权限', '通用', '关于']
  for (const label of labels) {
    await settings.getByRole('button', { name: label, exact: true }).click()
    await win.waitForTimeout(80)
    const frame = await rect(settings)
    assert(Math.abs(frame.width - 760) <= 1, `${label}: Settings width changed to ${frame.width}`)
    assert(Math.abs(frame.height - 560) <= 1, `${label}: Settings height changed to ${frame.height}`)
  }

  const modelWorkspace = win.locator('[data-settings-model-workspace]')
  await modelWorkspace.waitFor({ state: 'attached' })

  await settings.getByRole('button', { name: '文件与保存', exact: true }).click()
  await assertNonModelPageVisible(settings, modelWorkspace, '文件与保存')
  await screenshot('00-desktop-file-settings.png')
  await settings.getByRole('button', { name: 'AI 策略', exact: true }).click()
  await assertNonModelPageVisible(settings, modelWorkspace, 'AI 策略')
  await screenshot('00b-desktop-ai-policy.png')
  await settings.getByRole('button', { name: '模型', exact: true }).click()
  await win.locator('[data-settings-model-workspace]').waitFor({ state: 'visible' })
  await win.getByText('固定外壳测试连接', { exact: true }).first().click()
  await win.locator('[data-model-settings-page="connection"]').waitFor({ state: 'visible' })
  const modelButton = win.getByRole('button', { name: 'future-video-model', exact: true })
  await modelButton.click()

  const detail = win.locator('[data-model-settings-page="model"]')
  const modelDialog = win.locator('[data-model-settings-dialog]')
  await modelDialog.waitFor({ state: 'visible' })
  await detail.waitFor({ state: 'visible' })
  await win.waitForTimeout(120)
  assertDesktopModelDialog(await modelDialogState(win, '[data-model-settings-page="model"]'), 'desktop model detail')
  await screenshot('01-desktop-model-detail-third-level.png')

  await browserWindow.evaluate((window) => {
    window.setMinimumSize(320, 500)
    window.setBounds({ x: 0, y: 0, width: 390, height: 844 })
  }).catch(() => {})
  await win.waitForTimeout(200)
  assertNarrowModelDialog(await modelDialogState(win, '[data-model-settings-page="model"]'), 'narrow model detail')
  await screenshot('02-narrow-model-detail-third-level.png')

  await win.keyboard.press('Escape')
  await modelDialog.waitFor({ state: 'detached' })
  await win.locator('[data-model-settings-page="connection"]').waitFor({ state: 'visible' })
  assert(await settings.isVisible(), 'Escape closed Settings instead of returning to the connection page')
  assert(await win.locator('[role="dialog"]:visible').count() === 1, 'Escape left an extra dialog open')
  assert(await modelButton.evaluate((element) => element === document.activeElement || element.contains(document.activeElement)), 'Escape did not restore focus to the model entry')
  await modelButton.click()
  await modelDialog.waitFor({ state: 'visible' })
  await detail.waitFor({ state: 'visible' })

  await browserWindow.evaluate((window) => window.setBounds({ x: 0, y: 0, width: 1440, height: 1000 })).catch(() => {})
  await win.waitForTimeout(200)
  await detail.getByText('更多操作', { exact: true }).click()
  await detail.getByRole('button', { name: '删除模型', exact: true }).click()
  await win.getByRole('button', { name: '删除', exact: true }).last().click()
  const recovery = win.locator('[data-model-settings-recovery]')
  await recovery.waitFor({ state: 'visible' })
  await win.waitForTimeout(250)
  assert(await settings.isVisible(), 'stale model recovery unmounted Settings')
  assert(await detail.isVisible(), 'stale model recovery left the model page')
  assertDesktopModelDialog(await modelDialogState(win, '[data-model-settings-page="model"]'), 'stale model recovery')
  await screenshot('03-stale-model-recovery.png')

  assert(pageErrors.length === 0, `renderer page errors: ${pageErrors.join(' | ')}`)
  console.log('  fixed Settings shell, third-level model dialog, Escape, focus, overflow, and stale recovery: ok')
} catch (error) {
  console.error('  walkthrough failed:', error)
  try { await screenshot('ERROR.png') } catch { /* noop */ }
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
}
