// R13: every surface opened from Settings must sit above Settings and own Escape first.
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
  name: 'settings-nested-overlay',
  settingsDir: mkdtempSync(path.join(os.tmpdir(), 'settings-nested-overlay-set-')),
  projectsDir: mkdtempSync(path.join(os.tmpdir(), 'settings-nested-overlay-proj-')),
  env: { NOMI_RENDERER_URL: `file://${path.join(repoRoot, 'dist', 'index.html')}` },
  settleMs: 1800,
})

async function openGatewayWizard() {
  const settings = win.getByRole('dialog', { name: '设置' })
  if ((await settings.count()) === 0) {
    await win.getByRole('button', { name: '设置', exact: true }).first().click()
  }
  await win.getByRole('button', { name: '模型', exact: true }).first().click()
  await win.waitForSelector('[data-settings-section="models"]')

  const generationGroup = win.getByRole('button', { name: /接入生成模型/ }).first()
  if ((await generationGroup.getAttribute('aria-expanded')) !== 'true') await generationGroup.click()
  await win.getByRole('button', { name: '添加模型 / 中转站', exact: true }).click()
  await win.waitForTimeout(350)
}

async function readLayerState() {
  return win.evaluate(() => {
    const settings = document.querySelector('[role="dialog"][aria-label="设置"]')
    const wizard = [...document.querySelectorAll('[role="dialog"]')].find((element) => element !== settings)
    if (!(settings instanceof HTMLElement) || !(wizard instanceof HTMLElement)) return null

    const layerZ = (element) => {
      let current = element
      let highest = 0
      while (current instanceof HTMLElement) {
        const value = Number.parseInt(getComputedStyle(current).zIndex || '0', 10)
        if (Number.isFinite(value)) highest = Math.max(highest, value)
        current = current.parentElement
      }
      return highest
    }
    const rect = wizard.getBoundingClientRect()
    const centerX = Math.round(rect.left + rect.width / 2)
    const centerY = Math.round(rect.top + rect.height / 2)
    const hit = document.elementFromPoint(centerX, centerY)
    return {
      settingsZ: layerZ(settings),
      wizardZ: layerZ(wizard),
      wizardOwnsCenter: Boolean(hit && wizard.contains(hit)),
      activeInsideWizard: Boolean(document.activeElement && wizard.contains(document.activeElement)),
      inViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
    }
  })
}

try {
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((window) => window.setBounds({ x: 0, y: 0, width: 1440, height: 1000 })).catch(() => {})

  await openGatewayWizard()
  await win.waitForTimeout(350)
  const desktop = await readLayerState()
  if (!desktop) throw new Error('could not inspect Settings and gateway wizard')
  if (!(desktop.wizardZ > desktop.settingsZ)) {
    throw new Error(`gateway wizard layer ${desktop.wizardZ} is not above Settings ${desktop.settingsZ}`)
  }
  if (!desktop.wizardOwnsCenter || !desktop.activeInsideWizard || !desktop.inViewport) {
    throw new Error(`desktop gateway wizard is not operable: ${JSON.stringify(desktop)}`)
  }
  await shot(win, '01-desktop-gateway-wizard.png')

  await win.keyboard.press('Escape')
  await win.waitForTimeout(250)
  if (await win.locator('.mantine-Modal-content[role="dialog"]').filter({ hasText: '添加一个 AI 模型' }).count()) {
    throw new Error('Escape did not close the gateway wizard')
  }
  if (!(await win.getByRole('dialog', { name: '设置' }).count()))
    throw new Error('Escape closed Settings together with its child dialog')

  await browserWindow.evaluate((window) => window.setBounds({ x: 0, y: 0, width: 720, height: 900 })).catch(() => {})
  await openGatewayWizard()
  await win.waitForTimeout(350)
  const narrow = await readLayerState()
  if (!narrow?.wizardOwnsCenter || !narrow.activeInsideWizard || !narrow.inViewport) {
    throw new Error(`narrow gateway wizard is not operable: ${JSON.stringify(narrow)}`)
  }
  await shot(win, '02-narrow-gateway-wizard.png')
  console.log('  nested overlay order, hit testing, focus, viewport, and Escape: ok')
} catch (error) {
  console.error('  walkthrough failed:', error)
  try {
    await shot(win, 'ERROR.png')
  } catch {
    /* noop */
  }
  process.exitCode = 1
} finally {
  await app.close()
}
