import { makeTempDir } from './_test-temp.mjs'
// Settings model routes must replace the right-hand surface instead of opening nested dialogs.
// Usage: pnpm build && node scripts/settings-nested-overlay-walkthrough.mjs
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.settings-nested-overlay-walk')
mkdirSync(outDir, { recursive: true })

const shot = async (win, name) => {
  await win.screenshot({ path: path.join(outDir, name) })
  console.log(`  screenshot: ${name}`)
}

const { app, win } = await launchNomiApp({
  name: 'settings-right-pane-stack',
  settingsDir: makeTempDir('settings-right-pane-set-'),
  projectsDir: makeTempDir('settings-right-pane-proj-'),
  env: { NOMI_RENDERER_URL: `file://${path.join(repoRoot, 'dist', 'index.html')}` },
  settleMs: 1800,
})

async function openGatewayPage() {
  const settings = win.getByRole('dialog', { name: '设置' })
  if ((await settings.count()) === 0) await win.getByRole('button', { name: '设置', exact: true }).first().click()
  await settings.getByRole('button', { name: '模型', exact: true }).click()
  await win.waitForSelector('[data-settings-section="models"]')
  const generationGroup = win.getByRole('button', { name: /接入生成模型/ }).first()
  if ((await generationGroup.getAttribute('aria-expanded')) !== 'true') await generationGroup.click()
  await win.getByRole('button', { name: '添加模型 / 中转站', exact: true }).click()
  await win.waitForSelector('[data-model-settings-page="add"]')
  await win.waitForTimeout(250)
}

async function readPageState() {
  return win.evaluate(() => {
    const settings = document.querySelector('[role="dialog"][aria-label="设置"]')
    const page = document.querySelector('[data-model-settings-page="add"]')
    const back = page?.querySelector('[data-model-settings-back]')
    const scrollSurface = page?.closest('[data-settings-content]')
    if (!(settings instanceof HTMLElement) || !(page instanceof HTMLElement)) return null
    const rect = page.getBoundingClientRect()
    const backRect = back instanceof HTMLElement ? back.getBoundingClientRect() : null
    const nestedDialogs = [...document.querySelectorAll('[role="dialog"]')].filter((item) => item !== settings).length
    return {
      nestedDialogs,
      pageInsideSettings: settings.contains(page),
      activeOnBack: document.activeElement?.hasAttribute('data-model-settings-back') ?? false,
      pageIntersectsViewport: rect.left >= 0 && rect.top < innerHeight && rect.right <= innerWidth && rect.bottom > 0,
      backInViewport: Boolean(
        backRect &&
        backRect.left >= 0 &&
        backRect.top >= 0 &&
        backRect.right <= innerWidth &&
        backRect.bottom <= innerHeight
      ),
      usesSettingsScrollSurface: Boolean(
        scrollSurface instanceof HTMLElement &&
        scrollSurface.contains(page) &&
        ['auto', 'scroll'].includes(getComputedStyle(scrollSurface).overflowY)
      ),
      horizontalOverflow: page.scrollWidth > page.clientWidth + 1,
    }
  })
}

async function verifyPage(label) {
  const state = await readPageState()
  if (!state) throw new Error(`${label}: could not inspect Settings add-model page`)
  if (
    state.nestedDialogs !== 0 ||
    !state.pageInsideSettings ||
    !state.activeOnBack ||
    !state.pageIntersectsViewport ||
    !state.backInViewport ||
    !state.usesSettingsScrollSurface ||
    state.horizontalOverflow
  ) {
    throw new Error(`${label}: right-pane page is not operable: ${JSON.stringify(state)}`)
  }
}

try {
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((window) => window.setBounds({ x: 0, y: 0, width: 1440, height: 1000 })).catch(() => {})

  await openGatewayPage()
  await verifyPage('desktop')
  await shot(win, '01-desktop-right-pane-add.png')

  await win.keyboard.press('Escape')
  await win.waitForTimeout(250)
  if (await win.locator('[data-model-settings-page="add"]').count()) throw new Error('Escape did not return from the add-model page')
  if (!(await win.getByRole('dialog', { name: '设置' }).count())) throw new Error('Escape closed Settings instead of returning one page')

  await browserWindow.evaluate((window) => {
    window.setMinimumSize(320, 500)
    window.setBounds({ x: 0, y: 0, width: 390, height: 844 })
  }).catch(() => {})
  await openGatewayPage()
  await verifyPage('narrow')
  await shot(win, '02-narrow-right-pane-add.png')
  console.log('  right-pane replacement, focus, viewport, overflow, and Escape history: ok')
} catch (error) {
  console.error('  walkthrough failed:', error)
  try { await shot(win, 'ERROR.png') } catch { /* noop */ }
  process.exitCode = 1
} finally {
  await app.close()
}
