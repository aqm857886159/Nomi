// R13/R16 installed-app journey for truthful MCP client activation.
//
// Default: isolated HOME/settings/projects, safe to rerun.
// Real upgrade: `node tests/ux/mcp-client-activation.walk.mjs --real-connect`
// reconnects stale `nomi` entries through Nomi's UI, verifies current entries in place, and enables Cursor in Nomi.
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const appBundle = process.env.NOMI_APP_PATH || '/Applications/Nomi.app'
const executablePath = path.join(appBundle, 'Contents', 'MacOS', 'Nomi')
const realConnect = process.argv.includes('--real-connect')
const shotsDir = path.join(repoRoot, 'tests', 'ux', 'shots', 'mcp-client-activation')
fs.mkdirSync(shotsDir, { recursive: true })

if (!fs.existsSync(executablePath)) throw new Error(`Installed Nomi executable not found: ${executablePath}`)

const tempRoot = realConnect ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcp-activation-walk-'))
const testHome = tempRoot ? path.join(tempRoot, 'home') : os.homedir()
const settingsDir = tempRoot ? path.join(tempRoot, 'settings') : null
const projectsDir = tempRoot ? path.join(tempRoot, 'projects') : null
const capabilityDir = tempRoot ? path.join(tempRoot, 'capability') : null
for (const dir of [testHome, settingsDir, projectsDir, capabilityDir]) {
  if (dir) fs.mkdirSync(dir, { recursive: true })
}

const launchEnv = {
  ...process.env,
  NOMI_E2E: '1',
  NOMI_E2E_ALLOW_MULTI_INSTANCE: '1',
  ...(tempRoot
    ? {
        HOME: testHome,
        NOMI_ELECTRON_USER_DATA_DIR: settingsDir,
        NOMI_SETTINGS_DIR: settingsDir,
        NOMI_PROJECTS_DIR: projectsDir,
        NOMI_CAPABILITY_DIR: capabilityDir,
      }
    : {}),
}

function assert(condition, message) {
  if (!condition) throw new Error(`MCP ACTIVATION WALK FAIL: ${message}`)
}

async function snap(win, name) {
  const target = path.join(shotsDir, `${realConnect ? 'real' : 'isolated'}-${name}.png`)
  await win.screenshot({ path: target })
  console.log(`shot ${target}`)
  return target
}

async function closeApp(app) {
  const closed = app.close().then(() => true).catch(() => false)
  if (await Promise.race([closed, new Promise((resolve) => setTimeout(() => resolve(false), 8_000))])) return
  const child = app.process()
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}

async function prepareWindow(win) {
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1_200)
  if (!realConnect) {
    await win.evaluate(() => {
      for (const key of [
        'nomi:splash:v1',
        'nomi:journey-tour:v1',
        'nomi:canvas-gesture-hint:v1',
        'nomi.onboarding.scene3dCoach.v1',
      ]) window.localStorage.setItem(key, 'seen')
      window.localStorage.setItem('nomi:locale:v1', 'zh-CN')
      window.localStorage.setItem('nomi-color-scheme', 'light')
    })
    await win.reload()
    await win.waitForTimeout(1_200)
  }
  for (let index = 0; index < 5; index += 1) {
    const skip = win.locator('button, [role="button"], a').filter({ hasText: /跳过|开始创作|进入|完成|Skip|Start|Enter|Done/ }).first()
    if (await skip.count()) await skip.click({ timeout: 700 }).catch(() => {})
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(180)
  }
}

async function openModelPanel(win) {
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-model-catalog')))
  const panel = win.locator('[data-nomi-right-panel="model"]')
  await panel.waitFor({ state: 'visible', timeout: 8_000 })
  await win.waitForTimeout(800)
  return panel
}

async function assistantHeader(win, panel) {
  const name = /AI 助手|AI agents/
  let matches = panel.locator('button[aria-expanded]').filter({ hasText: name })
  if ((await matches.count()) === 0) {
    const group = panel.locator('button[aria-expanded]').filter({
      hasText: /接入编程助手|Connect coding assistant/,
    }).first()
    if (await group.count()) {
      await group.click()
      await win.waitForTimeout(250)
      matches = panel.locator('button[aria-expanded]').filter({ hasText: name })
    }
  }
  if ((await matches.count()) === 0) {
    const buttons = await panel.locator('button').allInnerTexts()
    throw new Error(`MCP ACTIVATION WALK FAIL: assistant card is missing; buttons=${buttons.join(' | ')}`)
  }
  return matches.last()
}

async function expandAssistant(win, panel) {
  const header = await assistantHeader(win, panel)
  await header.scrollIntoViewIfNeeded()
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
  await win.waitForTimeout(250)
}

async function selectClient(win, panel, client) {
  const choice = panel.getByText(client, { exact: true }).last()
  await choice.scrollIntoViewIfNeeded()
  await choice.click()
  await win.waitForTimeout(450)
}

async function installOrReconnect(win, panel, clientKey, label) {
  await expandAssistant(win, panel)
  await selectClient(win, panel, label)
  const action = panel.locator('button').filter({
    hasText: new RegExp(`重新接入 ${label}|Reconnect ${label}|一键接入 ${label}|Connect ${label}`),
  }).first()
  if (await action.count()) {
    await action.click()
    await win.waitForTimeout(1_100)
  } else {
    console.log(`${label}: configuration already current`)
  }
  const verified = await win.evaluate(async (key) => window.nomiDesktop?.capability?.verifyMcp?.(key), clientKey)
  assert(verified?.ok === true, `${label} did not pass a real handshake after reconnect (${verified?.reason || 'no result'})`)
  assert(verified.toolCount === 13, `${label} exposed ${verified.toolCount ?? 'unknown'} tools instead of 13`)
  console.log(`${label}: verified ${verified.toolCount} tools`)
}

async function openCursorPermissions(win, panel) {
  const action = panel.locator('button').filter({ hasText: /打开 Cursor 权限设置|Open Cursor permission settings/ }).first()
  assert((await action.count()) === 1, 'Cursor Nomi-permission action is missing')
  await action.click()
  const dialog = win.locator('[role="dialog"]').filter({ hasText: /自动化与权限|Automation & permissions/ }).last()
  await dialog.waitFor({ state: 'visible', timeout: 5_000 })
  const row = dialog.locator('[data-settings-section="cursor-host"]')
  await row.waitFor({ state: 'visible', timeout: 5_000 })
  const input = row.locator('input[type="checkbox"]')
  await input.waitFor({ state: 'attached', timeout: 5_000 })
  await dialog.locator('fieldset[aria-busy="false"]').waitFor({ state: 'attached', timeout: 5_000 })
  await win.waitForTimeout(80)
  assert(await input.evaluate((element) => document.activeElement === element), 'Cursor switch was not focused after policy loading')
  return { dialog, input }
}

async function allowCursor(win, dialog, input) {
  if (!(await input.isChecked())) {
    const visibleControl = input.locator('xpath=ancestor::label[1]')
    assert((await visibleControl.count()) === 1, 'Cursor switch has no visible label control')
    await visibleControl.click()
  }
  await win.waitForFunction(async () => {
    const value = await window.nomiDesktop?.settings?.automationPolicy?.get?.()
    return value?.trustedHosts?.includes('cursor') === true
  }, undefined, { timeout: 5_000 })
  const close = dialog.getByRole('button', { name: /关闭设置|Close settings|关闭|Close/ }).first()
  if (await close.count()) await close.click()
  else await win.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden', timeout: 5_000 })
  await win.waitForTimeout(500)
}

async function verifyCardUpdated(panel) {
  assert(
    (await panel.locator('button').filter({ hasText: /打开 Cursor 权限设置|Open Cursor permission settings/ }).count()) === 0,
    'Cursor permission CTA remained after persisted Nomi approval',
  )
  const text = await panel.innerText()
  assert(/已允许|Allowed/.test(text), 'Cursor card did not refresh to the allowed Nomi state')
}

async function setIsolatedPresentation(win, locale, theme, trustedHosts) {
  await win.evaluate(async ({ locale: nextLocale, theme: nextTheme, trustedHosts: nextHosts }) => {
    const policy = await window.nomiDesktop?.settings?.automationPolicy?.get?.()
    if (policy) await window.nomiDesktop?.settings?.automationPolicy?.set?.({ ...policy, trustedHosts: nextHosts })
    window.localStorage.setItem('nomi:locale:v1', nextLocale)
    window.localStorage.setItem('nomi-color-scheme', nextTheme)
  }, { locale, theme, trustedHosts })
  await win.reload()
  await win.waitForTimeout(1_000)
}

async function assertNoCompactOverflow(panel) {
  const overflowing = await panel.evaluate((root) => [...root.querySelectorAll('button, span')]
    .filter((element) => {
      const rect = element.getBoundingClientRect()
      if (!(element.textContent || '').trim()) return false
      const secondarySummary = element.classList.contains('truncate') && element.classList.contains('text-caption')
      return !secondarySummary && rect.width > 4 && rect.height > 4 && element.scrollWidth > element.clientWidth + 1
    })
    .map((element) => (element.textContent || '').trim().slice(0, 80)))
  assert(overflowing.length === 0, `compact layout has clipped text: ${overflowing.join(' | ')}`)
}

const app = await electron.launch({
  executablePath,
  args: tempRoot ? [`--user-data-dir=${settingsDir}`] : [],
  env: launchEnv,
})

let passed = false
try {
  const win = await app.firstWindow()
  console.log('window ready')
  if (!realConnect) await win.setViewportSize({ width: 1180, height: 780 })
  await prepareWindow(win)
  console.log('window prepared')
  let panel = await openModelPanel(win)
  console.log('model panel opened')
  await expandAssistant(win, panel)
  console.log('assistant card expanded')

  for (const [key, label] of [['claude', 'Claude Code'], ['codex', 'Codex'], ['cursor', 'Cursor']]) {
    await installOrReconnect(win, panel, key, label)
  }
  await selectClient(win, panel, 'Cursor')
  const cursorAlreadyTrusted = await win.evaluate(async () => {
    const value = await window.nomiDesktop?.settings?.automationPolicy?.get?.()
    return value?.trustedHosts?.includes('cursor') === true
  })
  if (cursorAlreadyTrusted) {
    await verifyCardUpdated(panel)
    await snap(win, 'zh-light-cursor-allowed')
  } else {
    await snap(win, 'zh-light-cursor-needs-permission')
    const { dialog, input } = await openCursorPermissions(win, panel)
    await snap(win, 'zh-light-cursor-settings-focused')
    await allowCursor(win, dialog, input)
    await verifyCardUpdated(panel)
    await snap(win, 'zh-light-cursor-allowed')
  }

  if (!realConnect) {
    await setIsolatedPresentation(win, 'en', 'dark', ['nomi', 'claude', 'codex'])
    await win.setViewportSize({ width: 520, height: 760 })
    panel = await openModelPanel(win)
    await expandAssistant(win, panel)
    await selectClient(win, panel, 'Cursor')
    await assertNoCompactOverflow(panel)
    await snap(win, 'en-dark-narrow-cursor-needs-permission')
    const englishSettings = await openCursorPermissions(win, panel)
    await assertNoCompactOverflow(englishSettings.dialog)
    await snap(win, 'en-dark-narrow-settings-focused')
    await allowCursor(win, englishSettings.dialog, englishSettings.input)
    await verifyCardUpdated(panel)
  }

  passed = true
  console.log(`MCP CLIENT ACTIVATION WALK PASS (${realConnect ? 'real connect' : 'isolated'})`)
} finally {
  await closeApp(app)
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}

if (!passed) process.exitCode = 1
