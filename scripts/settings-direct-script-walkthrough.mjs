import { makeTempDir } from './_test-temp.mjs'
// Real Electron journey for the direct-script escape hatch.
// Proves that draft creation performs no provider/docs/model/AI/verification request,
// then performs exactly one user-triggered request during the explicit test run.
// Usage: pnpm build && node scripts/settings-direct-script-walkthrough.mjs
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.settings-direct-script-walk')
const settingsDir = makeTempDir('settings-direct-script-set-')
const projectsDir = makeTempDir('settings-direct-script-proj-')
mkdirSync(outDir, { recursive: true })

const vendorName = 'Direct Script Relay With A Deliberately Long Connection Name'
const modelKey = 'future-image-model-with-a-deliberately-long-identifier-v2026-08-15'
const secret = 'sk-direct-script-e2e-secret'
const requests = []
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

const server = createServer((request, response) => {
  void (async () => {
    const bodyText = await readBody(request)
    const record = {
      method: request.method,
      url: request.url,
      authMatches: request.headers['x-api-key'] === secret,
      bodyText,
    }
    requests.push(record)
    if (request.method !== 'POST' || request.url !== '/v1/generate') {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'not found' }))
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ url: `data:image/png;base64,${png}` }))
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
if (!address || typeof address === 'string') throw new Error('mock server did not expose a TCP port')
const baseUrl = `http://127.0.0.1:${address.port}/v1`

const shot = async (win, name) => {
  await win.screenshot({ path: path.join(outDir, name) })
  console.log(`  screenshot: ${name}`)
}

async function assertNoHorizontalOverflow(win, selector, label) {
  const state = await win.locator(selector).evaluate((element) => ({
    own: element.scrollWidth > element.clientWidth + 2,
    document: document.documentElement.scrollWidth > window.innerWidth + 2,
  }))
  if (state.own || state.document) throw new Error(`${label} overflowed horizontally: ${JSON.stringify(state)}`)
}

async function assertSecretAbsentFromRenderer(win, label) {
  const exposed = await win.evaluate((value) => {
    const candidates = [
      document.body?.innerText || '',
      document.body?.innerHTML || '',
      ...Array.from(document.querySelectorAll('input, textarea')).map((input) => input.value),
    ]
    return candidates.some((candidate) => candidate.includes(value))
  }, secret)
  if (exposed) throw new Error(`${label}: plaintext API key reached the renderer DOM`)
}

async function assertModelDialogScriptSurface(win, label, { narrow = false, expectFocus = true } = {}) {
  const state = await win.evaluate(() => {
    const visible = (element) => element instanceof HTMLElement && element.getClientRects().length > 0 && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden'
    const toRect = (element) => {
      if (!(element instanceof HTMLElement)) return null
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom }
    }
    const settings = document.querySelector('[data-settings-dialog]')
    const modelRoot = document.querySelector('[data-model-settings-dialog]')
    const modelPanel = modelRoot?.closest('[role="dialog"]')
    const script = document.querySelector('[data-model-settings-page="script"]')
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      visibleDialogs: [...document.querySelectorAll('[role="dialog"]')].filter(visible).length,
      settingsVisible: visible(settings),
      modelDialogVisible: visible(modelRoot) && visible(modelPanel),
      scriptInsideModelDialog: script instanceof HTMLElement && Boolean(modelRoot?.contains(script)),
      scriptInsideSettings: script instanceof HTMLElement && Boolean(settings?.contains(script)),
      focusInsideModelDialog: document.activeElement instanceof Element && Boolean(modelRoot?.contains(document.activeElement)),
      settingsRect: toRect(settings),
      modelRect: toRect(modelPanel),
      horizontalOverflow: [settings, modelPanel, modelRoot, script].some((element) => element instanceof HTMLElement && element.scrollWidth > element.clientWidth + 2),
      documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
    }
  })
  if (state.visibleDialogs !== 2 || !state.settingsVisible || !state.modelDialogVisible || !state.scriptInsideModelDialog || state.scriptInsideSettings) {
    throw new Error(`${label}: direct script must be owned by the third-level model dialog ${JSON.stringify(state)}`)
  }
  if (expectFocus && !state.focusInsideModelDialog) throw new Error(`${label}: keyboard focus is outside the model dialog`)
  if (state.horizontalOverflow || state.documentOverflow) throw new Error(`${label}: horizontal overflow ${JSON.stringify(state)}`)
  if (narrow) {
    if (state.modelRect.x < 0 || state.modelRect.y < 0 || state.modelRect.right > state.viewport.width + 1 || state.modelRect.bottom > state.viewport.height + 1) {
      throw new Error(`${label}: model dialog extends beyond the narrow viewport ${JSON.stringify(state)}`)
    }
    if (state.modelRect.width < state.viewport.width - 32 || state.modelRect.height < state.viewport.height - 32) {
      throw new Error(`${label}: model dialog is not near full-screen ${JSON.stringify(state)}`)
    }
    return
  }
  if (Math.abs(state.settingsRect.width - 760) > 1 || Math.abs(state.settingsRect.height - 560) > 1) {
    throw new Error(`${label}: Settings shell changed size ${JSON.stringify(state.settingsRect)}`)
  }
  if (Math.abs(state.modelRect.width - 880) > 1 || Math.abs(state.modelRect.height - 640) > 1) {
    throw new Error(`${label}: model dialog changed size ${JSON.stringify(state.modelRect)}`)
  }
}

const { app, win } = await launchNomiApp({
  name: 'settings-direct-script',
  settingsDir,
  projectsDir,
  args: ['--no-proxy-server'],
  env: {
    NOMI_RENDERER_URL: process.env.NOMI_WALK_RENDERER_URL || `file://${path.join(repoRoot, 'dist', 'index.html')}`,
  },
  settleMs: 1800,
})

const consoleErrors = []
try {
  win.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error)}`))
  win.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`console: ${message.text()}`)
  })
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((window) => window.setBounds({ x: 0, y: 0, width: 1440, height: 1000 })).catch(() => {})

  const skip = win.getByRole('button', { name: /Skip|\u8df3\u8fc7/ }).first()
  if (await skip.isVisible().catch(() => false)) await skip.click()

  await win.getByRole('button', { name: '\u8bbe\u7f6e', exact: true }).first().click()
  const settings = win.getByRole('dialog', { name: '\u8bbe\u7f6e' })
  await settings.getByRole('button', { name: '\u6a21\u578b', exact: true }).click()
  await win.locator('[data-settings-section="models"]').waitFor({ state: 'visible' })

  const generationGroup = win.getByRole('button', { name: /\u63a5\u5165\u751f\u6210\u6a21\u578b/ }).first()
  if ((await generationGroup.getAttribute('aria-expanded')) !== 'true') await generationGroup.click()
  await win.getByRole('button', { name: '\u6dfb\u52a0\u6a21\u578b / \u4e2d\u8f6c\u7ad9', exact: true }).click()
  await win.locator('[data-model-settings-page="add"]').waitFor({ state: 'visible' })
  await win.locator('[data-direct-script-entry] button').click()

  const form = win.locator('[data-direct-script-draft-form]')
  await form.waitFor({ state: 'visible' })
  await form.getByPlaceholder('\u4f8b\u5982\uff1a\u6211\u7684\u56fe\u50cf\u5e73\u53f0').fill(vendorName)
  await form.getByPlaceholder('https://api.example.com/v1').fill(baseUrl)
  await form.getByPlaceholder('\u7c98\u8d34 API Key').fill(secret)
  await form.getByPlaceholder('\u4f8b\u5982\uff1anew-image-model').fill(modelKey)

  if (requests.length !== 0) throw new Error(`draft form caused ${requests.length} unexpected network requests`)
  await shot(win, '01-direct-script-form-light.png')
  await form.getByRole('button', { name: '\u7ee7\u7eed\u586b\u5199\u8c03\u7528\u811a\u672c', exact: true }).click()

  const scriptPage = win.locator('[data-model-settings-page="script"]')
  const modelDialog = win.locator('[data-model-settings-dialog]')
  await modelDialog.waitFor({ state: 'visible' })
  await scriptPage.waitFor({ state: 'visible' })
  await scriptPage.getByText('\u811a\u672c\u8fd4\u56de\u503c', { exact: true }).waitFor({ state: 'visible' })
  await scriptPage.getByText('\u811a\u672c API', { exact: true }).waitFor({ state: 'visible' })
  if (requests.length !== 0) throw new Error(`draft creation caused ${requests.length} unexpected network requests`)
  await assertSecretAbsentFromRenderer(win, 'direct script editor')
  await assertModelDialogScriptSurface(win, 'direct script editor')

  const scriptInput = scriptPage.locator('textarea').last()
  await scriptInput.fill(`const data = await request({\n  method: 'POST',\n  url: baseUrl + '/generate',\n  headers: { 'x-api-key': apiKey },\n  body: { model, prompt, taskKind, modeId },\n})\nreturn data.url`)
  await assertNoHorizontalOverflow(win, '[data-model-settings-page="script"]', 'desktop script page')
  await shot(win, '02-direct-script-editor-light.png')

  // The third-level model dialog owns the draft and its unsaved guard.
  await modelDialog.getByRole('button', { name: '\u5173\u95ed', exact: true }).click()
  const discardPromptRoot = win.locator('[data-confirm-dialog="confirm"]')
  await discardPromptRoot.locator('[role="dialog"]').waitFor({ state: 'visible' })
  const promptLayers = await win.evaluate(() => {
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
    return {
      model: highestLayer(document.querySelector('[data-model-settings-dialog]')),
      confirmation: highestLayer(document.querySelector('[data-confirm-dialog="confirm"] [role="dialog"]')),
    }
  })
  if (promptLayers.confirmation <= promptLayers.model) throw new Error(`direct-script discard prompt is behind the model dialog: ${JSON.stringify(promptLayers)}`)
  await discardPromptRoot.locator('[data-confirm-dialog-cancel="true"]').click()
  await win.waitForTimeout(250)
  await scriptPage.waitFor({ state: 'visible' })
  if (!(await scriptInput.inputValue()).includes("'x-api-key': apiKey")) throw new Error('unsaved script was lost after cancelling model-dialog close')
  await assertModelDialogScriptSurface(win, 'direct script after cancelled model-dialog close', { expectFocus: false })
  await shot(win, '03-direct-script-editor-after-cancelled-close.png')

  await browserWindow.evaluate((window) => {
    window.setMinimumSize(320, 500)
    window.setBounds({ x: 0, y: 0, width: 390, height: 844 })
  }).catch(() => {})
  await win.waitForTimeout(250)
  await assertNoHorizontalOverflow(win, '[data-model-settings-page="script"]', 'narrow script page')
  await assertModelDialogScriptSurface(win, 'narrow direct script editor', { narrow: true, expectFocus: false })
  const narrowLayout = await scriptPage.evaluate((page) => {
    const sidebar = page.querySelector('[data-custom-call-contract-sidebar]')
    const editor = page.querySelector('[data-custom-call-editor-main]')
    if (!(sidebar instanceof HTMLElement) || !(editor instanceof HTMLElement)) return null
    const sidebarRect = sidebar.getBoundingClientRect()
    const editorRect = editor.getBoundingClientRect()
    const collapsedHelp = sidebar.querySelector('details')
    return {
      contractBeforeEditor: sidebarRect.top <= editorRect.top,
      compactContractCollapsed: collapsedHelp instanceof HTMLDetailsElement && !collapsedHelp.open,
    }
  })
  if (!narrowLayout?.contractBeforeEditor || !narrowLayout.compactContractCollapsed) {
    throw new Error(`narrow contract did not collapse above the editor: ${JSON.stringify(narrowLayout)}`)
  }
  await shot(win, '04-direct-script-editor-narrow.png')

  await browserWindow.evaluate((window) => window.setBounds({ x: 0, y: 0, width: 1440, height: 1000 })).catch(() => {})
  await win.waitForTimeout(250)
  if (requests.length !== 0) throw new Error(`layout interactions caused ${requests.length} unexpected network requests`)

  await scriptPage.getByRole('button', { name: '\u53d1\u9001\u6d4b\u8bd5\u8bf7\u6c42', exact: true }).click()
  await win.getByText(/\u8bd5\u8dd1\u6210\u529f/).waitFor({ state: 'visible', timeout: 15_000 })
  if (requests.length !== 1) throw new Error(`explicit test run made ${requests.length} requests instead of one`)
  if (!requests[0].authMatches) throw new Error('explicit test run did not use the saved API key')
  if (!requests[0].bodyText.includes(modelKey)) throw new Error('explicit test run did not send the configured model ID')
  await assertSecretAbsentFromRenderer(win, 'test transcript')
  await shot(win, '05-direct-script-test-success.png')

  await scriptPage.getByRole('button', { name: '\u4fdd\u5b58\u811a\u672c\uff0c\u7ee7\u7eed\u8bbe\u7f6e\u8f93\u5165', exact: true }).click()
  const capabilityPage = win.locator('[data-model-settings-page="capability"]')
  await capabilityPage.waitFor({ state: 'visible' })
  const scriptOnlyModel = await win.evaluate(({ expectedModel }) => {
    const models = window.nomiDesktop?.modelCatalog?.listModels?.() || []
    return models.find((model) => model.modelKey === expectedModel) || null
  }, { expectedModel: modelKey })
  if (scriptOnlyModel?.enabled || !scriptOnlyModel?.customCall?.script) {
    throw new Error(`unknown media model was enabled before input setup: ${JSON.stringify(scriptOnlyModel)}`)
  }
  if (scriptOnlyModel?.meta?.customCallDraft) throw new Error('saved direct-script model still has draft metadata')
  if (scriptOnlyModel?.meta?.customCapabilityContract) throw new Error('unknown media draft unexpectedly gained an input contract')
  await assertSecretAbsentFromRenderer(win, 'capability setup after script save')
  await shot(win, '06-direct-script-capability-required.png')

  await capabilityPage.locator('[data-capability-mode-row="0"]').click()
  await capabilityPage.locator('[data-capability-field="modes.0.id"]').fill('text-to-image')
  await capabilityPage.locator('[data-capability-field="modes.0.displayName"]').fill('\u6587\u751f\u56fe')
  await capabilityPage.getByRole('button', { name: '\u4fdd\u5b58\u80fd\u529b', exact: true }).click()
  const modelPage = win.locator(`[data-model-settings-page="model"][data-model-settings-model="${modelKey}"]`)
  await modelPage.waitFor({ state: 'visible' })
  const persisted = await win.evaluate(({ expectedModel }) => {
    const models = window.nomiDesktop?.modelCatalog?.listModels?.() || []
    return models.find((model) => model.modelKey === expectedModel) || null
  }, { expectedModel: modelKey })
  const capabilityContract = persisted?.meta?.customCapabilityContract
  if (!persisted?.enabled || !persisted?.customCall?.script || !capabilityContract?.modes?.length) {
    throw new Error(`script and input setup did not enable the model: ${JSON.stringify(persisted)}`)
  }
  if (capabilityContract.defaultModeId !== 'text-to-image') {
    throw new Error(`saved capability did not retain the configured default mode: ${JSON.stringify(capabilityContract)}`)
  }
  if (capabilityContract.modes[0]?.transportTaskKind !== 'text_to_image') {
    throw new Error(`saved capability has the wrong transport task: ${JSON.stringify(capabilityContract)}`)
  }
  await assertSecretAbsentFromRenderer(win, 'enabled model after capability save')
  await win.waitForTimeout(1_200)
  if (requests.length !== 1) {
    throw new Error(`saving script and capability triggered hidden provider probes: ${JSON.stringify(requests)}`)
  }
  await shot(win, '07-direct-script-capability-configured-enabled.png')

  if (consoleErrors.length > 0) throw new Error(`renderer errors: ${consoleErrors.slice(0, 6).join(' | ')}`)
  console.log(`  request trace: ${JSON.stringify(requests.map(({ method, url, bodyText }) => ({ method, url, bodyText })))}`)
  console.log(`  requests before explicit test: 0; total requests: ${requests.length}`)
} catch (error) {
  console.error('  walkthrough failed:', error)
  try { await shot(win, 'ERROR.png') } catch { /* noop */ }
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
  server.close()
}

console.log(`done -> ${outDir}`)
