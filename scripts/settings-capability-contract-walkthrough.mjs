import { makeTempDir } from './_test-temp.mjs'
// Real Electron journey for an unknown video model capability contract.
//
// Proves the full user path:
// Settings -> connection -> model -> capability -> persistence -> scoped call scripts -> canvas projection.
// Local capability editing stays offline; the script is persisted only after one explicit successful test request.
//
// Usage: pnpm build && node scripts/settings-capability-contract-walkthrough.mjs
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.settings-capability-contract-walk')
const settingsDir = makeTempDir('settings-capability-contract-set-')
const projectsDir = makeTempDir('settings-capability-contract-proj-')
const vendorKey = 'future-motion-contract-lab'
const vendorName = 'Future Motion Contract Lab'
const modelKey = 'future-video-model-v2026-08-15'
const modelLabel = 'Future Video V2026.08 Unknown Model'
const fallbackMarker = 'fallback-contract-fixture'
const siblingMarker = 'multi-reference-sibling-fixture'
const originalFramesMarker = 'first-last-original-fixture'
const updatedFramesMarker = 'first-last-updated-through-ui'
const requests = []
const screenshots = []
mkdirSync(outDir, { recursive: true })

function assert(condition, message, detail = '') {
  if (!condition) throw new Error(`CAPABILITY WALK FAIL: ${message}${detail ? ` -- ${detail}` : ''}`)
  console.log(`  ok: ${message}`)
}

async function requestBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

const server = createServer((request, response) => {
  void (async () => {
    requests.push({
      method: request.method || '',
      url: request.url || '',
      body: await requestBody(request),
      at: new Date().toISOString(),
    })
    if (request.method === 'POST' && request.url === '/v1/videos/generations') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ video_url: 'https://cdn.invalid/future-video-test.mp4' }))
      return
    }
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'This recorder has no callable endpoint.' }))
  })().catch((error) => {
    response.writeHead(500, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: String(error) }))
  })
})

await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
const address = server.address()
if (!address || typeof address === 'string') throw new Error('request recorder did not expose a TCP port')
const baseUrl = `http://127.0.0.1:${address.port}/v1`

async function setWindowSize(app, win, width, height) {
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((window, bounds) => {
    window.setMinimumSize(320, 500)
    window.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height })
  }, { width, height })
  // BrowserWindow bounds include the macOS title bar. Pin the page viewport too so
  // the 390x844 mobile artifact really exercises 390x844 CSS pixels.
  await win.setViewportSize({ width, height }).catch(() => undefined)
  await win.waitForTimeout(300)
}

async function shot(win, name, { theme, stage }) {
  const file = path.join(outDir, name)
  const viewport = await win.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  await win.screenshot({ path: file, animations: 'disabled' })
  screenshots.push({ name, file, theme, stage, viewport })
  console.log(`  screenshot: ${name} (${viewport.width}x${viewport.height}, ${theme})`)
}

async function assertNoHorizontalOverflow(win, selector, label) {
  const state = await win.locator(selector).evaluate((element) => ({
    elementClientWidth: element.clientWidth,
    elementScrollWidth: element.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
  }))
  assert(
    state.elementScrollWidth <= state.elementClientWidth + 2
      && state.documentScrollWidth <= state.documentClientWidth + 2,
    `${label} has no horizontal overflow`,
    JSON.stringify(state),
  )
}

async function assertModelDialogSurface(win, pageSelector, label, narrow = false, expectFocus = true) {
  const state = await win.evaluate((selector) => {
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
    const toRect = (element) => {
      if (!(element instanceof HTMLElement)) return null
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom }
    }
    const settings = document.querySelector('[data-settings-dialog]')
    const modelRoot = document.querySelector('[data-model-settings-dialog]')
    const modelPanel = modelRoot?.closest('[role="dialog"]')
    const page = document.querySelector(selector)
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      visibleDialogs: [...document.querySelectorAll('[role="dialog"]')].filter(visible).length,
      settingsVisible: visible(settings),
      modelVisible: visible(modelRoot) && visible(modelPanel),
      pageInsideModel: page instanceof HTMLElement && Boolean(modelRoot?.contains(page)),
      pageInsideSettings: page instanceof HTMLElement && Boolean(settings?.contains(page)),
      focusInsideModel: document.activeElement instanceof Element && Boolean(modelRoot?.contains(document.activeElement)),
      settingsLayer: settings ? highestLayer(settings) : 0,
      modelLayer: modelPanel ? highestLayer(modelPanel) : 0,
      settingsRect: toRect(settings),
      modelRect: toRect(modelPanel),
      horizontalOverflow: [modelPanel, modelRoot, page].some((element) => element instanceof HTMLElement && element.scrollWidth > element.clientWidth + 2),
      documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
    }
  }, pageSelector)

  assert(state.visibleDialogs === 2, `${label} keeps Settings and one model dialog visible`, JSON.stringify(state))
  assert(state.settingsVisible && state.modelVisible, `${label} keeps both dialog surfaces mounted`, JSON.stringify(state))
  assert(state.pageInsideModel && !state.pageInsideSettings, `${label} is owned by the third-level dialog`, JSON.stringify(state))
  if (expectFocus) assert(state.focusInsideModel, `${label} keeps keyboard focus in the third-level dialog`, JSON.stringify(state))
  assert(state.modelLayer > state.settingsLayer, `${label} is layered above Settings`, JSON.stringify(state))
  assert(!state.horizontalOverflow && !state.documentOverflow, `${label} has no horizontal overflow`, JSON.stringify(state))
  if (narrow) {
    assert(state.modelRect.x >= 0 && state.modelRect.y >= 0, `${label} starts inside the narrow viewport`, JSON.stringify(state.modelRect))
    assert(state.modelRect.right <= state.viewport.width + 1 && state.modelRect.bottom <= state.viewport.height + 1, `${label} stays inside the narrow viewport`, JSON.stringify(state.modelRect))
    assert(state.modelRect.width >= state.viewport.width - 32, `${label} is near full width`, JSON.stringify(state))
    assert(state.modelRect.height >= state.viewport.height - 32, `${label} is near full height`, JSON.stringify(state))
    return
  }
  assert(Math.abs(state.settingsRect.width - 760) <= 1 && Math.abs(state.settingsRect.height - 560) <= 1, `${label} leaves Settings at 760x560`, JSON.stringify(state.settingsRect))
  assert(Math.abs(state.modelRect.width - 880) <= 1 && Math.abs(state.modelRect.height - 640) <= 1, `${label} uses the 880x640 model dialog`, JSON.stringify(state.modelRect))
}

async function assertConnectionReturned(win, settings, connectionPage, label) {
  const state = await win.evaluate(() => {
    const visible = (element) => element instanceof HTMLElement && element.getClientRects().length > 0 && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden'
    const settingsFrame = document.querySelector('[data-settings-dialog]')
    const connection = document.querySelector('[data-model-settings-page="connection"]')
    return {
      visibleDialogs: [...document.querySelectorAll('[role="dialog"]')].filter(visible).length,
      settingsVisible: visible(settingsFrame),
      modelDialogVisible: visible(document.querySelector('[data-model-settings-dialog]')),
      connectionInsideSettings: connection instanceof HTMLElement && Boolean(settingsFrame?.contains(connection)),
    }
  })
  assert(await settings.isVisible() && await connectionPage.isVisible(), `${label} reveals the owning connection`)
  assert(
    state.visibleDialogs === 1 && state.settingsVisible && !state.modelDialogVisible && state.connectionInsideSettings,
    `${label} closes only the third-level dialog`,
    JSON.stringify(state),
  )
}

async function assertBottomActionReachable(action, label) {
  const state = await action.evaluate((element) => {
    const page = element.closest('[data-model-settings-page]')
    const modelRoot = element.closest('[data-model-settings-dialog]')
    if (!(page instanceof HTMLElement) || !(modelRoot instanceof HTMLElement)) return null
    const clippingRect = modelRoot.getBoundingClientRect()
    const before = element.getBoundingClientRect()
    const clippedBefore = before.top < clippingRect.top || before.bottom > clippingRect.bottom
    let scroller = element.parentElement
    while (scroller && scroller !== modelRoot.parentElement) {
      const style = getComputedStyle(scroller)
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && scroller.scrollHeight > scroller.clientHeight + 1) break
      scroller = scroller.parentElement
    }
    const scrollable = scroller instanceof HTMLElement && scroller !== modelRoot.parentElement
    if (scrollable) scroller.scrollTop = scroller.scrollHeight
    const after = element.getBoundingClientRect()
    return {
      clippedBefore,
      scrollable,
      scrollTop: scrollable ? scroller.scrollTop : 0,
      scrollHeight: scrollable ? scroller.scrollHeight : 0,
      clientHeight: scrollable ? scroller.clientHeight : 0,
      actionVisible: after.width > 0 && after.height > 0 && after.top >= clippingRect.top - 1 && after.bottom <= clippingRect.bottom + 1,
      pageHeight: page.getBoundingClientRect().height,
      modelHeight: clippingRect.height,
    }
  })
  assert(state, `${label} is inside the model dialog`)
  assert(!state.clippedBefore || (state.scrollable && state.scrollTop > 0), `${label} has a usable vertical scroll container`, JSON.stringify(state))
  assert(state.actionVisible, `${label} can be scrolled into view`, JSON.stringify(state))
}

async function dismissFirstRun(win) {
  await win.evaluate(() => {
    for (const key of [
      'nomi:splash:v1',
      'nomi:journey-tour:v1',
      'nomi:canvas-gesture-hint:v1',
      'nomi-onboarding-checklist:v1',
    ]) window.localStorage.setItem(key, 'seen')
  })
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const skip = win.locator('button,[role="button"],a', { hasText: /Skip|\u8df3\u8fc7|\u5f00\u59cb\u521b\u4f5c|\u5148\u901b\u901b/ }).first()
    if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => undefined)
    await win.keyboard.press('Escape').catch(() => undefined)
    await win.waitForTimeout(150)
  }
}

async function ensureTheme(settings, desired) {
  await settings.getByRole('button', { name: /\u901a\u7528|General/, exact: true }).click()
  const switchToDesired = desired === 'dark'
    ? settings.getByRole('button', { name: /\u5207\u6362\u5230\u6df1\u8272\u6a21\u5f0f|Switch to dark mode/ }).first()
    : settings.getByRole('button', { name: /\u5207\u6362\u5230\u6d45\u8272\u6a21\u5f0f|Switch to light mode/ }).first()
  if (await switchToDesired.isVisible().catch(() => false)) await switchToDesired.click()
  await settings.getByRole('button', { name: /\u6a21\u578b|Models/, exact: true }).click()
}

async function fillCapabilityField(win, fieldPath, value) {
  const field = win.locator(`[data-capability-field="${fieldPath}"]`)
  await field.waitFor({ state: 'visible' })
  await field.fill(value)
}

async function selectCapabilityField(win, fieldPath, optionName) {
  const field = win.locator(`[data-capability-field="${fieldPath}"]`)
  await field.waitFor({ state: 'visible' })
  await field.getByRole('button').click()
  await win.getByRole('option', { name: optionName, exact: true }).click()
}

async function selectScriptScope(win, scriptPage, optionName) {
  const trigger = scriptPage.getByRole('button', { name: /\u8fd9\u6bb5\u811a\u672c\u7528\u4e8e|Use this script for/, exact: true })
  await trigger.click()
  await win.getByRole('option', { name: new RegExp(optionName) }).click()
}

function contractFromModel(model) {
  return model?.meta?.customCapabilityContract ?? null
}

const { app, win } = await launchNomiApp({
  name: 'settings-capability-contract',
  settingsDir,
  projectsDir,
  args: ['--no-proxy-server'],
  env: {
    NOMI_RENDERER_URL: process.env.NOMI_WALK_RENDERER_URL || `file://${path.join(repoRoot, 'dist', 'index.html')}`,
  },
  settleMs: 1800,
})

const consoleErrors = []
let finalContract = null
let finalCustomCall = null
let canvasProjection = null

try {
  win.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error)}`))
  win.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`console: ${message.text()}`)
  })
  await setWindowSize(app, win, 1440, 1000)
  await dismissFirstRun(win)

  const seeded = await win.evaluate(({ vendorKey, vendorName, modelKey, modelLabel, baseUrl, markers }) => {
    const catalog = window.nomiDesktop?.modelCatalog
    if (!catalog) return null
    catalog.upsertVendor({
      key: vendorKey,
      name: vendorName,
      baseUrlHint: baseUrl,
      protocol: 'openai',
      authType: 'none',
      enabled: true,
      meta: { customCallOnly: true },
    })
    catalog.upsertModel({
      vendorKey,
      modelKey,
      labelZh: modelLabel,
      kind: 'video',
      enabled: true,
      onboarding: {
        addedVia: 'manual',
        addedAt: new Date().toISOString(),
        fields: [],
      },
      customCall: {
        script: `return { video_url: 'https://cdn.invalid/${markers.fallback}.mp4' } // ${markers.fallback}`,
        modes: {
          'multi-reference': {
            script: `return { video_url: 'https://cdn.invalid/${markers.sibling}.mp4' } // ${markers.sibling}`,
          },
          'first-last': {
            script: `return { video_url: 'https://cdn.invalid/${markers.frames}.mp4' } // ${markers.frames}`,
          },
        },
      },
    })
    catalog.upsertMapping({
      vendorKey,
      modelKey,
      taskKind: 'image_to_video',
      name: 'Unknown model image-to-video route',
      enabled: true,
      create: {
        method: 'POST',
        path: '/videos/generations',
        body: { model: '{{request.model}}', prompt: '{{request.prompt}}' },
      },
    })
    window.dispatchEvent(new CustomEvent('nomi-model-catalog-changed'))
    return catalog.listModels({ vendorKey }).find((model) => model.modelKey === modelKey) || null
  }, {
    vendorKey,
    vendorName,
    modelKey,
    modelLabel,
    baseUrl,
    markers: { fallback: fallbackMarker, sibling: siblingMarker, frames: originalFramesMarker },
  })
  assert(seeded?.kind === 'video' && !contractFromModel(seeded), 'fixture starts as an unknown video model')

  await win.getByRole('button', { name: /\u8bbe\u7f6e|Settings/, exact: true }).first().click()
  const settings = win.getByRole('dialog', { name: /\u8bbe\u7f6e|Settings/ })
  await settings.waitFor({ state: 'visible' })
  await ensureTheme(settings, 'light')
  await win.locator('[data-settings-section="models"]').waitFor({ state: 'visible' })

  await win.getByText(vendorName, { exact: true }).first().click()
  const connectionPage = win.locator(`[data-model-settings-page="connection"][data-model-settings-vendor="${vendorKey}"]`)
  await connectionPage.waitFor({ state: 'visible' })
  const modelChip = connectionPage.locator('button', { hasText: modelLabel }).first()
  await modelChip.click()
  const modelDialog = win.locator('[data-model-settings-dialog]')
  await modelDialog.waitFor({ state: 'visible' })
  const modelPage = win.locator(`[data-model-settings-page="model"][data-model-settings-model="${modelKey}"]`)
  await modelPage.waitFor({ state: 'visible' })
  await assertModelDialogSurface(win, `[data-model-settings-page="model"][data-model-settings-model="${modelKey}"]`, 'unknown model detail')
  assert(await modelPage.getByText(/\u8fd8\u9700\u8981\u8bbe\u7f6e\u8f93\u5165\u4e0e\u751f\u6210\u65b9\u5f0f|Input and generation setup required/i).isVisible(), 'model detail identifies the missing input contract')
  assert(await modelPage.getByText(/Nomi \u4e0d\u4f1a\u6839\u636e\u6a21\u578b\u7c7b\u578b\u731c\u6d4b|will not guess them from the model type/i).isVisible(), 'model detail explains that Nomi will not guess model inputs')
  await modelPage.getByRole('button', { name: /\u8bbe\u7f6e\u8f93\u5165\u65b9\u5f0f|Set input behavior/, exact: true }).click()
  const capabilityPage = win.locator('[data-model-settings-page="capability"]')
  await capabilityPage.waitFor({ state: 'visible' })
  await assertModelDialogSurface(win, '[data-model-settings-page="capability"]', 'capability editor')

  await fillCapabilityField(win, 'modes.0.id', 'multi-reference')
  await fillCapabilityField(win, 'modes.0.displayName', '\u591a\u53c2\u8003\u56fe')
  await fillCapabilityField(win, 'modes.0.description', '\u4e00\u5230\u4e09\u5f20\u56fe\u7247\u5171\u540c\u63a7\u5236\u89c6\u9891\u5185\u5bb9')
  await selectCapabilityField(win, 'modes.0.intent', '\u89d2\u8272 / \u591a\u53c2\u8003')
  await selectCapabilityField(win, 'modes.0.taskKind', '\u53c2\u8003\u56fe\u89c6\u9891')
  const mode0 = capabilityPage.locator('[data-capability-mode="0"]')
  await mode0.getByRole('button', { name: /\u6dfb\u52a0\u7d20\u6750|Add input/, exact: true }).click()
  await fillCapabilityField(win, 'modes.0.slots.0.label', '\u53c2\u8003\u56fe')
  await fillCapabilityField(win, 'modes.0.slots.0.inputKey', 'image_urls')
  await fillCapabilityField(win, 'modes.0.slots.0.min', '1')
  await fillCapabilityField(win, 'modes.0.slots.0.max', '3')

  await capabilityPage.getByRole('button', { name: /\u6dfb\u52a0\u6a21\u5f0f|Add mode/, exact: true }).click()
  await fillCapabilityField(win, 'modes.1.id', 'first-last')
  await fillCapabilityField(win, 'modes.1.displayName', '\u9996\u5c3e\u5e27')
  await fillCapabilityField(win, 'modes.1.description', '\u9996\u5e27\u5fc5\u586b\uff0c\u5c3e\u5e27\u53ef\u9009')
  await selectCapabilityField(win, 'modes.1.intent', '\u9996\u5c3e\u5e27')
  await selectCapabilityField(win, 'modes.1.taskKind', '\u53c2\u8003\u56fe\u89c6\u9891')
  const mode1 = capabilityPage.locator('[data-capability-mode="1"]')
  await mode1.getByRole('button', { name: /\u6dfb\u52a0\u7d20\u6750|Add input/, exact: true }).click()
  await selectCapabilityField(win, 'modes.1.slots.0.kind', '\u9996\u5e27')
  await fillCapabilityField(win, 'modes.1.slots.0.label', '\u9996\u5e27')
  await fillCapabilityField(win, 'modes.1.slots.0.inputKey', 'first_frame_url')
  await fillCapabilityField(win, 'modes.1.slots.0.min', '1')
  await fillCapabilityField(win, 'modes.1.slots.0.max', '1')
  await mode1.getByRole('button', { name: /\u6dfb\u52a0\u7d20\u6750|Add input/, exact: true }).click()
  await selectCapabilityField(win, 'modes.1.slots.1.kind', '\u5c3e\u5e27')
  await fillCapabilityField(win, 'modes.1.slots.1.label', '\u5c3e\u5e27')
  await fillCapabilityField(win, 'modes.1.slots.1.inputKey', 'last_frame_url')
  await fillCapabilityField(win, 'modes.1.slots.1.min', '0')
  await fillCapabilityField(win, 'modes.1.slots.1.max', '1')

  assert(await capabilityPage.getAttribute('data-settings-unsaved') === 'true', 'capability editor exposes its unsaved state')
  await assertBottomActionReachable(capabilityPage.getByRole('button', { name: /\u6dfb\u52a0\u6a21\u5f0f|Add mode/, exact: true }), 'desktop capability bottom action')
  await assertNoHorizontalOverflow(win, '[data-model-settings-page="capability"]', '1440 capability editor')
  await shot(win, '01-capability-two-modes-1440-light.png', { theme: 'light', stage: 'capability-editor' })
  await capabilityPage.getByRole('button', { name: /\u4fdd\u5b58\u80fd\u529b|Save capability/, exact: true }).click()
  await win.locator('[data-model-settings-page="model"]').waitFor({ state: 'visible' })

  finalContract = await win.evaluate(({ vendorKey, modelKey }) => {
    const model = window.nomiDesktop?.modelCatalog?.listModels?.({ vendorKey })
      ?.find((row) => row.modelKey === modelKey)
    return model?.meta?.customCapabilityContract ?? null
  }, { vendorKey, modelKey })
  assert(finalContract?.defaultModeId === 'multi-reference', 'capability contract persisted with the expected default mode')
  assert(finalContract?.modes?.length === 2, 'capability contract persisted both modes')
  assert(finalContract.modes.every((mode) => mode.transportTaskKind === 'image_to_video'), 'both modes use image_to_video transport')
  const persistedMulti = finalContract.modes.find((mode) => mode.id === 'multi-reference')
  const persistedFrames = finalContract.modes.find((mode) => mode.id === 'first-last')
  assert(
    persistedMulti?.slots?.[0]?.kind === 'image_ref'
      && persistedMulti.slots[0].inputKey === 'image_urls'
      && persistedMulti.slots[0].min === 1
      && persistedMulti.slots[0].max === 3,
    'multi-reference slot persisted its kind, input key, and 1..3 bounds',
  )
  assert(
    persistedFrames?.slots?.[0]?.kind === 'first_frame'
      && persistedFrames.slots[0].min === 1
      && persistedFrames.slots[1]?.kind === 'last_frame'
      && persistedFrames.slots[1].min === 0,
    'first/last mode persisted a required first frame and optional last frame',
  )

  await setWindowSize(app, win, 1100, 900)
  await assertModelDialogSurface(win, `[data-model-settings-page="model"][data-model-settings-model="${modelKey}"]`, 'persisted model detail', false, false)
  await shot(win, '02-model-detail-persisted-1100-light.png', { theme: 'light', stage: 'model-detail' })
  await modelPage.getByRole('button', { name: `\u8bbe\u7f6e ${modelLabel} \u7684\u8f93\u5165\u4e0e\u751f\u6210\u65b9\u5f0f`, exact: true }).click()
  await capabilityPage.waitFor({ state: 'visible' })
  assert(await win.locator('[data-capability-field="modes.0.id"]').inputValue() === 'multi-reference', 'reopened editor restores the first mode ID')
  assert(await win.locator('[data-capability-field="modes.1.slots.1.inputKey"]').inputValue() === 'last_frame_url', 'reopened editor restores the optional last-frame key')
  assert(!await capabilityPage.getAttribute('data-settings-unsaved'), 'reopened persisted contract starts clean')

  await capabilityPage.locator('[data-model-settings-back]').click()
  await modelPage.waitFor({ state: 'visible' })
  await modelPage.locator('[data-model-settings-back]').click()
  await modelDialog.waitFor({ state: 'detached' })
  await connectionPage.waitFor({ state: 'visible' })
  await assertConnectionReturned(win, settings, connectionPage, 'model-detail Back')
  await ensureTheme(settings, 'dark')
  if (!await connectionPage.isVisible().catch(() => false)) {
    await win.getByText(vendorName, { exact: true }).first().click()
    await connectionPage.waitFor({ state: 'visible' })
  }
  await modelChip.click()
  await modelPage.waitFor({ state: 'visible' })
  await modelPage.getByRole('button', { name: `\u8bbe\u7f6e ${modelLabel} \u7684\u8f93\u5165\u4e0e\u751f\u6210\u65b9\u5f0f`, exact: true }).click()
  await capabilityPage.waitFor({ state: 'visible' })
  await setWindowSize(app, win, 390, 844)
  await assertModelDialogSurface(win, '[data-model-settings-page="capability"]', '390px capability editor', true, false)
  await assertBottomActionReachable(capabilityPage.getByRole('button', { name: /\u6dfb\u52a0\u6a21\u5f0f|Add mode/, exact: true }), '390px capability bottom action')
  await assertNoHorizontalOverflow(win, '[data-model-settings-page="capability"]', '390px capability editor')
  const mobileActions = await capabilityPage.evaluate((page) => {
    const back = page.querySelector('[data-model-settings-back]')
    const save = page.querySelector('button[aria-label]')
    return {
      backVisible: back instanceof HTMLElement && back.getBoundingClientRect().width > 0,
      headerVisible: save instanceof HTMLElement && save.getBoundingClientRect().width > 0,
    }
  })
  assert(mobileActions.backVisible && mobileActions.headerVisible, 'mobile capability header actions remain reachable')
  await shot(win, '03-capability-reopened-390x844-dark.png', { theme: 'dark', stage: 'capability-editor-mobile' })

  await capabilityPage.locator('[data-model-settings-back]').click()
  await win.locator('[data-model-settings-page="model"]').waitFor({ state: 'visible' })
  await setWindowSize(app, win, 1440, 1000)
  await assertModelDialogSurface(win, `[data-model-settings-page="model"][data-model-settings-model="${modelKey}"]`, 'model detail after capability Back', false, false)
  await modelPage.getByRole('button', { name: `\u8bbe\u7f6e ${modelLabel} \u7684\u8bf7\u6c42\u65b9\u5f0f`, exact: true }).click()
  const scriptPage = win.locator('[data-model-settings-page="script"]')
  await scriptPage.waitFor({ state: 'visible' })
  await assertModelDialogSurface(win, '[data-model-settings-page="script"]', 'scoped custom-call editor')
  const scopeTrigger = scriptPage.getByRole('button', { name: /\u8fd9\u6bb5\u811a\u672c\u7528\u4e8e|Use this script for/, exact: true })
  await scopeTrigger.click()
  const scopeOptions = win.getByRole('option')
  assert(await scopeOptions.count() === 3, 'custom call editor exposes fallback plus both capability modes')
  const scopeTexts = (await scopeOptions.allTextContents()).map((text) => text.replace(/\s+/g, ' ').trim())
  assert(scopeTexts.some((text) => text.includes('\u6240\u6709\u6a21\u5f0f\uff08\u9ed8\u8ba4\uff09')), 'custom call editor exposes the all-modes fallback scope')
  assert(scopeTexts.some((text) => text.includes('\u591a\u53c2\u8003\u56fe')), 'custom call editor exposes the multi-reference scope')
  assert(scopeTexts.some((text) => text.includes('\u9996\u5c3e\u5e27')), 'custom call editor exposes the first/last scope')
  assert(scopeTexts.filter((text) => text.includes('\u5df2\u914d\u7f6e')).length === 3, 'all three fixture scopes are visibly marked configured')
  await scopeOptions.filter({ hasText: '\u9996\u5c3e\u5e27' }).first().click()
  const scriptInput = scriptPage.locator('[data-custom-call-editor-main] textarea').last()
  assert((await scriptInput.inputValue()).includes(originalFramesMarker), 'first/last scope loads its existing script')
  await scriptInput.fill(`const result = await request({\n  method: 'POST',\n  url: baseUrl + '/videos/generations',\n  body: { model, prompt, modeId, references },\n})\nreturn result.video_url // ${updatedFramesMarker}`)
  await assertNoHorizontalOverflow(win, '[data-model-settings-page="script"]', '1440 scoped script editor')
  await shot(win, '04-scoped-call-editor-1440-dark.png', { theme: 'dark', stage: 'custom-call-scopes' })
  assert(requests.length === 0, 'editing a scoped script does not make a hidden request')
  await scriptPage.getByRole('button', { name: /\u53d1\u9001\u6d4b\u8bd5\u8bf7\u6c42|Send test request/, exact: true }).click()
  await scriptPage.getByText(/\u8bd5\u8dd1\u6210\u529f|Test run succeeded/).waitFor({ state: 'visible', timeout: 15_000 })
  assert(requests.length === 1, 'scoped script test makes exactly one explicit request', JSON.stringify(requests))
  assert(requests[0].method === 'POST' && requests[0].url === '/v1/videos/generations', 'scoped script test reaches the configured endpoint', JSON.stringify(requests[0]))
  assert(requests[0].body.includes('first-last'), 'scoped script test receives the selected modeId', requests[0].body)
  await scriptPage.getByRole('button', { name: /\u4fdd\u5b58\u5e76\u542f\u7528|Save & enable/, exact: true }).click()
  await win.locator('[data-model-settings-page="model"]').waitFor({ state: 'visible' })

  finalCustomCall = await win.evaluate(({ vendorKey, modelKey }) => {
    const model = window.nomiDesktop?.modelCatalog?.listModels?.({ vendorKey })
      ?.find((row) => row.modelKey === modelKey)
    return model?.customCall ?? null
  }, { vendorKey, modelKey })
  assert(finalCustomCall?.script?.includes(fallbackMarker), 'saving a mode script preserves the fallback script')
  assert(finalCustomCall?.modes?.['multi-reference']?.script?.includes(siblingMarker), 'saving a mode script preserves its sibling mode script')
  assert(finalCustomCall?.modes?.['first-last']?.script?.includes(updatedFramesMarker), 'saving a mode script updates only the selected mode')

  await modelPage.getByRole('button', { name: `\u8bbe\u7f6e ${modelLabel} \u7684\u8bf7\u6c42\u65b9\u5f0f`, exact: true }).click()
  await scriptPage.waitFor({ state: 'visible' })
  const reopenedScript = scriptPage.locator('[data-custom-call-editor-main] textarea').last()
  await selectScriptScope(win, scriptPage, '\u6240\u6709\u6a21\u5f0f\uff08\u9ed8\u8ba4\uff09')
  assert((await reopenedScript.inputValue()).includes(fallbackMarker), 'reopened editor restores the fallback script')
  await selectScriptScope(win, scriptPage, '\u591a\u53c2\u8003\u56fe')
  assert((await reopenedScript.inputValue()).includes(siblingMarker), 'reopened editor restores the sibling mode script')
  await selectScriptScope(win, scriptPage, '\u9996\u5c3e\u5e27')
  assert((await reopenedScript.inputValue()).includes(updatedFramesMarker), 'reopened editor restores the edited mode script')
  await assertModelDialogSurface(win, '[data-model-settings-page="script"]', 'reopened scoped custom-call editor')
  await shot(win, '05-scoped-call-reopened-1440-dark.png', { theme: 'dark', stage: 'custom-call-persistence' })

  await scriptPage.locator('[data-model-settings-back]').click()
  await modelPage.waitFor({ state: 'visible' })
  await modelPage.locator('[data-model-settings-back]').click()
  await modelDialog.waitFor({ state: 'detached' })
  await connectionPage.waitFor({ state: 'visible' })
  await assertConnectionReturned(win, settings, connectionPage, 'model dialog close before canvas projection')
  await settings.locator('[data-settings-close]').click()
  await settings.waitFor({ state: 'hidden' })

  const newProject = win.getByText(/\u65b0\u5efa\u7a7a\u767d\u9879\u76ee|New blank project/, { exact: false }).first()
  await newProject.waitFor({ state: 'visible', timeout: 8_000 })
  await newProject.click()
  await win.waitForTimeout(2_000)
  const generationTab = win.getByRole('button', { name: /\u751f\u6210|Generate/, exact: true }).first()
  if (await generationTab.isVisible().catch(() => false)) await generationTab.click()
  await win.locator('.generation-canvas-v2-toolbar').waitFor({ state: 'visible', timeout: 8_000 })
  await win.locator('button[aria-label="\u6dfb\u52a0\u89c6\u9891\u8282\u70b9"]').first().click()
  const composer = win.locator('.generation-canvas-v2-node__composer-card').last()
  await composer.waitFor({ state: 'visible', timeout: 8_000 })
  const modelButton = composer.getByRole('button', { name: /\u6a21\u578b|Model/, exact: true })
  await modelButton.click()
  await win.getByRole('option', { name: new RegExp(modelLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click()
  await win.waitForTimeout(900)

  const modeGroup = composer.getByRole('group', { name: /\u751f\u6210\u65b9\u5f0f|Generation mode/ })
  await modeGroup.waitFor({ state: 'visible' })
  assert(await modeGroup.getByRole('button', { name: '\u591a\u53c2\u8003\u56fe', exact: true }).isVisible(), 'canvas projects the multi-reference mode')
  assert(await modeGroup.getByRole('button', { name: '\u9996\u5c3e\u5e27', exact: true }).isVisible(), 'canvas projects the first/last mode')
  assert(await composer.getByRole('button', { name: /\u52a0\u53c2\u8003|Add reference/ }).isVisible(), 'multi-reference mode projects an array reference picker')
  await modeGroup.getByRole('button', { name: '\u9996\u5c3e\u5e27', exact: true }).click()
  assert(await composer.getByRole('button', { name: /\u6dfb\u52a0\u9996\u5e27|Add First/ }).isVisible(), 'first/last mode projects its required first-frame picker')
  assert(await composer.getByRole('button', { name: /\u6dfb\u52a0\u5c3e\u5e27|Add Last/ }).isVisible(), 'first/last mode projects its optional last-frame picker')
  canvasProjection = {
    model: await modelButton.textContent(),
    modes: await modeGroup.getByRole('button').allTextContents(),
    firstFrameVisible: true,
    lastFrameVisible: true,
  }
  await shot(win, '06-canvas-projected-inputs-1440-dark.png', { theme: 'dark', stage: 'canvas-projection' })

  assert(
    requests.length === 1 && requests[0].method === 'POST' && requests[0].url === '/v1/videos/generations',
    'configuration and projection add no hidden requests beyond the one explicit script test',
    JSON.stringify(requests),
  )
  assert(consoleErrors.length === 0, 'walkthrough produced no renderer errors', consoleErrors.slice(0, 8).join(' | '))

  const catalogFile = path.join(settingsDir, 'model-catalog.json')
  const catalogOnDisk = JSON.parse(readFileSync(catalogFile, 'utf8'))
  const modelOnDisk = catalogOnDisk.models.find((model) => model.vendorKey === vendorKey && model.modelKey === modelKey)
  assert(modelOnDisk?.meta?.customCapabilityContract?.modes?.length === 2, 'model-catalog.json contains the two-mode capability contract')
  assert(modelOnDisk?.customCall?.modes?.['first-last']?.script?.includes(updatedFramesMarker), 'model-catalog.json contains the scoped script update')

  const report = {
    fixture: { vendorKey, modelKey, kind: 'video', baseUrl },
    settingsDir,
    projectsDir,
    catalogFile,
    requestTrajectory: requests,
    screenshots,
    capabilityContract: finalContract,
    customCall: finalCustomCall,
    canvasProjection,
    consoleErrors,
  }
  const reportFile = path.join(outDir, 'walkthrough-report.json')
  writeFileSync(reportFile, JSON.stringify(report, null, 2))
  console.log(`  request trajectory: ${JSON.stringify(requests)}`)
  console.log(`  report: ${reportFile}`)
  console.log(`done -> ${outDir}`)
} catch (error) {
  console.error('  walkthrough failed:', error)
  try { await shot(win, 'ERROR.png', { theme: 'unknown', stage: 'failure' }) } catch { /* noop */ }
  process.exitCode = 1
} finally {
  await app.close().catch(() => undefined)
  server.close()
}
