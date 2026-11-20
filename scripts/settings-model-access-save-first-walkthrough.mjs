import { makeTempDir } from './_test-temp.mjs'
// Save-first model access journey against a real Electron main process and a local HTTP mock.
// Usage: pnpm build && node scripts/settings-model-access-save-first-walkthrough.mjs
import { createServer } from 'node:http'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = process.env.NOMI_WALK_OUT ? path.resolve(process.env.NOMI_WALK_OUT) : path.join(repoRoot, '.settings-model-access-save-first-walk')
const settingsDir = makeTempDir('settings-model-access-save-first-set-')
const projectsDir = makeTempDir('settings-model-access-save-first-proj-')
const rendererUrl = process.env.NOMI_WALK_RENDERER_URL || `file://${path.join(repoRoot, 'dist', 'index.html')}`
mkdirSync(outDir, { recursive: true })

const vendorName = 'Save-first Relay'
const secretKey = 'sk-save-first-walkthrough'
const textModel = 'journey-text-v1'
const videoModel = 'journey-video-v1'
const model3d = 'hunyuan3d-v2'
const manualAudioModel = 'manual-speech-v1'
const remotelyListedModel = 'remote-image-v2'
const initialModels = [textModel, videoModel, model3d]

const requests = []
const delayedResponses = new Set()
let listPhase = 'initial'
let chatAttempt = 0
let journeyPhase = 'boot'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

async function requestBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function streamChatCompletion(response, model, delayMs) {
  const send = () => {
    if (response.destroyed) return
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    response.write(`data: ${JSON.stringify({
      id: 'chatcmpl-save-first-walk',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1_000),
      model,
      choices: [{ index: 0, delta: { role: 'assistant', content: 'ready' }, finish_reason: null }],
    })}\n\n`)
    response.write(`data: ${JSON.stringify({
      id: 'chatcmpl-save-first-walk',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1_000),
      model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`)
    response.end('data: [DONE]\n\n')
  }
  if (delayMs <= 0) {
    send()
    return
  }
  let timer
  const clearDelay = () => {
    if (!timer) return
    clearTimeout(timer)
    delayedResponses.delete(timer)
    timer = undefined
  }
  timer = setTimeout(() => {
    const completedTimer = timer
    timer = undefined
    if (completedTimer) delayedResponses.delete(completedTimer)
    send()
  }, delayMs)
  delayedResponses.add(timer)
  response.once('close', clearDelay)
}

const server = createServer((request, response) => {
  void (async () => {
    const bodyText = request.method === 'POST' ? await requestBody(request) : ''
    let body = {}
    try { body = bodyText ? JSON.parse(bodyText) : {} } catch { /* malformed input stays observable in the request record */ }
    const record = {
      sequence: requests.length + 1,
      method: request.method,
      url: request.url,
      model: typeof body.model === 'string' ? body.model : '',
      authorization: String(request.headers.authorization || ''),
      journeyPhase,
      chatAttempt: 0,
      requestAborted: false,
      responseFinished: false,
      responseClosedBeforeEnd: false,
    }
    requests.push(record)
    request.once('aborted', () => { record.requestAborted = true })
    response.once('finish', () => { record.responseFinished = true })
    response.once('close', () => {
      if (!record.responseFinished) record.responseClosedBeforeEnd = true
    })

    if (request.method === 'GET' && (request.url === '/v1/models' || request.url === '/v1/v1/models')) {
      const ids = listPhase === 'initial'
        ? initialModels
        : [...initialModels, manualAudioModel, remotelyListedModel]
      json(response, 200, { object: 'list', data: ids.map((id) => ({ id, object: 'model' })) })
      return
    }

    if (request.method === 'POST' && request.url === '/v1/chat/completions') {
      chatAttempt += 1
      record.chatAttempt = chatAttempt
      streamChatCompletion(response, record.model, chatAttempt === 1 ? 30_000 : 0)
      return
    }

    json(response, 404, { error: { message: `Deliberate unsupported route: ${request.method} ${request.url}` } })
  })().catch((error) => {
    if (!response.headersSent) json(response, 500, { error: { message: String(error) } })
    else response.destroy(error instanceof Error ? error : undefined)
  })
})

await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Local mock did not expose a TCP port')
const baseUrl = `http://127.0.0.1:${address.port}/v1`

async function pollUntil(read, accept, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let latest
  while (Date.now() < deadline) {
    latest = await read()
    if (accept(latest)) return latest
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  throw new Error(`${label} timed out; latest=${JSON.stringify(latest)}`)
}

async function screenshot(win, name) {
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

function readCatalogFromDisk() {
  return JSON.parse(readFileSync(path.join(settingsDir, 'model-catalog.json'), 'utf8'))
}

async function assertNoHorizontalOverflow(win, label) {
  const state = await win.evaluate(() => {
    const selectors = [
      '[data-settings-dialog]',
      '[data-settings-content]',
      '[data-settings-model-workspace]:not([hidden])',
      '[data-model-settings-dialog]',
      '[data-custom-call-editor-main]',
    ]
    const entries = selectors.map((selector) => {
      const element = document.querySelector(selector)
      return {
        selector,
        present: element instanceof HTMLElement,
        overflow: element instanceof HTMLElement && element.scrollWidth > element.clientWidth + 2,
        clientWidth: element instanceof HTMLElement ? element.clientWidth : 0,
        scrollWidth: element instanceof HTMLElement ? element.scrollWidth : 0,
      }
    })
    return {
      entries,
      documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
      innerWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }
  })
  const offenders = state.entries.filter((entry) => entry.present && entry.overflow)
  assert(!state.documentOverflow && offenders.length === 0, `${label}: horizontal overflow ${JSON.stringify(state)}`)
}

async function assertSettingsOwnedPage(win, pageSelector, label) {
  const state = await win.evaluate((selector) => {
    const visible = (element) => element instanceof HTMLElement && element.getClientRects().length > 0 && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden'
    const settings = document.querySelector('[data-settings-dialog]')
    const page = document.querySelector(selector)
    return {
      visibleDialogs: [...document.querySelectorAll('[role="dialog"]')].filter(visible).length,
      settingsVisible: visible(settings),
      modelDialogVisible: visible(document.querySelector('[data-model-settings-dialog]')),
      pageInsideSettings: page instanceof HTMLElement && Boolean(settings?.contains(page)),
    }
  }, pageSelector)
  assert(
    state.visibleDialogs === 1 && state.settingsVisible && !state.modelDialogVisible && state.pageInsideSettings,
    `${label}: expected a Settings-owned page ${JSON.stringify(state)}`,
  )
}

async function assertModelDialogSurface(win, pageSelector, label, narrow = false) {
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
      dialogLabels: [...document.querySelectorAll('[role="dialog"]')].filter(visible).map((dialog) => ({
        ariaLabel: dialog.getAttribute('aria-label'),
        labelledBy: dialog.getAttribute('aria-labelledby'),
        text: (dialog.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        className: dialog.className,
      })),
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

  assert(state.visibleDialogs === 2, `${label}: expected Settings plus model dialog, got ${state.visibleDialogs} ${JSON.stringify(state.dialogLabels)}`)
  assert(state.settingsVisible && state.modelVisible, `${label}: Settings or model dialog is not visible`)
  assert(state.pageInsideModel && !state.pageInsideSettings, `${label}: page has the wrong dialog owner`)
  assert(state.focusInsideModel, `${label}: keyboard focus is outside the model dialog`)
  assert(state.modelLayer > state.settingsLayer, `${label}: model dialog is not above Settings (${state.modelLayer} <= ${state.settingsLayer})`)
  assert(!state.horizontalOverflow && !state.documentOverflow, `${label}: horizontal overflow ${JSON.stringify(state)}`)
  if (narrow) {
    assert(state.modelRect.x >= 0 && state.modelRect.y >= 0, `${label}: model dialog starts outside the viewport`)
    assert(state.modelRect.right <= state.viewport.width + 1 && state.modelRect.bottom <= state.viewport.height + 1, `${label}: model dialog extends beyond the viewport`)
    assert(state.modelRect.width >= state.viewport.width - 32, `${label}: model dialog is not near full width (${state.modelRect.width}/${state.viewport.width})`)
    assert(state.modelRect.height >= state.viewport.height - 32, `${label}: model dialog is not near full height (${state.modelRect.height}/${state.viewport.height})`)
    return
  }
  assert(Math.abs(state.settingsRect.width - 760) <= 1, `${label}: Settings width changed to ${state.settingsRect.width}`)
  assert(Math.abs(state.settingsRect.height - 560) <= 1, `${label}: Settings height changed to ${state.settingsRect.height}`)
  assert(Math.abs(state.modelRect.width - 880) <= 1, `${label}: model dialog width is ${state.modelRect.width}, expected 880`)
  assert(Math.abs(state.modelRect.height - 640) <= 1, `${label}: model dialog height is ${state.modelRect.height}, expected 640`)
}

async function openSettingsModels(win) {
  const current = win.locator('[data-settings-dialog]')
  if (!(await current.isVisible().catch(() => false))) {
    await win.getByRole('button', { name: '设置', exact: true }).first().click()
  }
  const settings = win.locator('[data-settings-dialog]')
  await settings.waitFor({ state: 'visible' })
  await settings.getByRole('button', { name: '模型', exact: true }).click()
  await win.locator('[data-settings-section="models"]').waitFor({ state: 'visible' })
  return settings
}

async function openConnectionFromHome(win, vendorKey) {
  await win.locator('[data-settings-section="models"]').waitFor({ state: 'visible' })
  const connectionButton = win.locator(`[data-model-home-connection="${vendorKey}"]`)
  await connectionButton.waitFor({ state: 'visible' })
  await connectionButton.click()
  await win.locator(`[data-model-settings-page="connection"][data-model-settings-vendor="${vendorKey}"]`).waitFor({ state: 'visible' })
}

async function addExistingModelManually(win, modelId) {
  const addPage = win.locator('[data-model-settings-page="add"]')
  await addPage.waitFor({ state: 'visible' })
  const manualInput = addPage.getByPlaceholder('没列出来的，输入模型 id 回车添加', { exact: true })
  await manualInput.fill(modelId)
  await addPage.getByRole('button', { name: '添加', exact: true }).click()
  await addPage.getByRole('button', { name: modelId, exact: true }).waitFor({ state: 'visible' })
  await addPage.getByRole('button', { name: '添加 1 个模型', exact: true }).click()
  await addPage.waitFor({ state: 'detached' })
}

const { app, win } = await launchNomiApp({
  name: 'settings-model-access-save-first',
  settingsDir,
  projectsDir,
  args: ['--no-proxy-server'],
  env: { NOMI_RENDERER_URL: rendererUrl },
  settleMs: 1_800,
})

const rendererErrors = []
try {
  win.on('pageerror', (error) => rendererErrors.push(`pageerror: ${String(error)}`))
  win.on('console', (message) => {
    const value = message.text()
    if (message.type() === 'error') rendererErrors.push(`console: ${value}`)
    if (value.includes(secretKey)) rendererErrors.push('console exposed the plaintext API key')
  })

  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((window) => window.setBounds({ x: 0, y: 0, width: 1440, height: 1000 })).catch(() => {})
  const skip = win.getByRole('button', { name: /跳过|Skip/ }).first()
  if (await skip.isVisible().catch(() => false)) await skip.click()

  const settings = await openSettingsModels(win)
  const initialSettingsRect = await rect(settings)
  assert(Math.abs(initialSettingsRect.width - 760) <= 1, `desktop Settings width is ${initialSettingsRect.width}, expected 760`)
  assert(Math.abs(initialSettingsRect.height - 560) <= 1, `desktop Settings height is ${initialSettingsRect.height}, expected 560`)

  const modelHome = win.locator('[data-model-settings-page="home"]')
  await modelHome.waitFor({ state: 'visible' })
  const firstHomeState = await modelHome.evaluate((root) => {
    const position = (selector) => {
      const element = root.querySelector(selector)
      return element instanceof HTMLElement ? element.getBoundingClientRect().top : -1
    }
    return {
      apimart: position('[data-model-home-available="apimart"]'),
      kie: position('[data-model-home-available="kie"]'),
      custom: position('[data-model-home-action="custom-api"]'),
      searchCount: root.querySelectorAll('input[type="search"]').length,
      topAddCount: root.querySelectorAll('[data-model-home-action="add-connection"]').length,
      text: root.textContent || '',
    }
  })
  assert(firstHomeState.apimart >= 0 && firstHomeState.kie > firstHomeState.apimart, `APIMart/Kie order is wrong: ${JSON.stringify(firstHomeState)}`)
  assert(firstHomeState.custom > firstHomeState.kie, `Custom API is not after adapted platforms: ${JSON.stringify(firstHomeState)}`)
  assert(firstHomeState.searchCount === 0 && firstHomeState.topAddCount === 0, `First-use home exposed empty-state controls: ${JSON.stringify(firstHomeState)}`)
  assert(!firstHomeState.text.includes('Claude Code') && !firstHomeState.text.includes('MCP'), 'Models home still contains MCP assistant management')
  await screenshot(win, '00-desktop-approved-first-use-home.png')

  await modelHome.locator('[data-model-home-available="apimart"]').click()
  const keyOnlyPage = win.locator('[data-model-settings-page="platformConnect"]')
  await keyOnlyPage.waitFor({ state: 'visible' })
  assert(await keyOnlyPage.locator('input[type="password"]').count() === 1, 'APIMart page is not key-only')
  assert(await keyOnlyPage.locator('input:not([type]), input[type="url"]').count() === 0, 'APIMart key-only page exposed another connection field')
  await keyOnlyPage.getByRole('button', { name: '保存', exact: true }).click()
  await keyOnlyPage.getByText('请先填写 API Key', { exact: true }).waitFor({ state: 'visible' })
  await keyOnlyPage.locator('input[type="password"]').fill('sk-apimart-ui-contract')
  await keyOnlyPage.getByRole('button', { name: '保存', exact: true }).click()
  await keyOnlyPage.locator('[data-key-only-success]').waitFor({ state: 'visible' })
  await screenshot(win, '00b-desktop-apimart-key-only-success.png')
  await keyOnlyPage.locator('[data-model-settings-back]').click()
  await modelHome.waitFor({ state: 'visible' })
  assert(requests.length === 0, `Key-only local save unexpectedly contacted the custom upstream: ${JSON.stringify(requests)}`)

  await modelHome.locator('[data-model-home-action="custom-api"]').click()
  const addPage = win.locator('[data-model-settings-page="add"]')
  await addPage.waitFor({ state: 'visible' })
  await addPage.getByRole('heading', { name: '接入 API / 中转站', exact: true }).waitFor({ state: 'visible' })
  assert(await addPage.getByRole('button', { name: 'new-api 中转', exact: true }).count() === 0, 'Custom API page repeated the provider preset chooser')
  await addPage.getByPlaceholder('如：TOAPI 中转', { exact: true }).fill(vendorName)
  await win.keyboard.press('Tab')
  await addPage.getByPlaceholder('https://api.openai.com/v1', { exact: true }).fill(baseUrl)
  await win.keyboard.press('Tab')
  await addPage.getByPlaceholder('sk-...', { exact: true }).fill(secretKey)
  await win.keyboard.press('Tab')
  await win.waitForTimeout(500)
  assert(requests.length === 0, `URL/Key blur unexpectedly contacted the upstream: ${JSON.stringify(requests)}`)
  await screenshot(win, '01-desktop-filled-zero-requests.png')

  journeyPhase = 'save-connection-only'
  await addPage.getByRole('button', { name: '保存连接', exact: true }).click()
  await addPage.locator('[data-model-connection-saved]').waitFor({ state: 'visible' })
  await addPage.getByRole('button', { name: '或直接手动输入模型 ID', exact: true }).waitFor({ state: 'visible' })
  await addPage.getByRole('button', { name: '获取模型列表', exact: true }).waitFor({ state: 'visible' })
  assert(requests.length === 1 && requests[0].method === 'GET' && requests[0].url.endsWith('/models'), 'Save must make only the credential rejection GET')

  const catalogAfterConnectionSave = readCatalogFromDisk()
  const vendor = catalogAfterConnectionSave.vendors.find((item) => item.name === vendorName && item.baseUrlHint === baseUrl)
  assert(vendor, 'Saved connection was not found in the catalog')
  assert(!catalogAfterConnectionSave.models.some((model) => model.vendorKey === vendor.key), 'Connection-only save created a fake model')
  await screenshot(win, '01b-desktop-connection-saved-two-exits.png')

  await addPage.locator('[data-model-settings-back]').click()
  await modelHome.waitFor({ state: 'visible' })
  await modelHome.locator(`[data-model-home-connection="${vendor.key}"]`).waitFor({ state: 'visible' })
  await settings.locator('[data-settings-close]').click()
  await settings.waitFor({ state: 'detached' })

  await openSettingsModels(win)
  await modelHome.locator(`[data-model-home-connection="${vendor.key}"]`).waitFor({ state: 'visible' })
  await openConnectionFromHome(win, vendor.key)
  // Opening a saved connection and its picker must remain local until explicit fetch.
  await win.waitForTimeout(800)
  const requestsBeforeExistingConnection = requests.length
  await win.getByRole('button', { name: '添加其他模型', exact: true }).click()
  await addPage.waitFor({ state: 'visible' })
  assert(await addPage.getByPlaceholder('sk-...', { exact: true }).count() === 0, 'Recovered saved connection asked for its API key again')
  assert(requests.length === requestsBeforeExistingConnection, `Opening the saved connection picker contacted the upstream: ${JSON.stringify(requests)}`)

  journeyPhase = 'explicit-initial-model-list'
  await addPage.getByRole('button', { name: '获取可用模型', exact: true }).click()
  await pollUntil(
    () => Promise.resolve(requests),
    (items) => items.length === requestsBeforeExistingConnection + 1 && items.at(-1)?.method === 'GET' && items.at(-1)?.url?.endsWith('/models'),
    'one explicit model-list request',
  )
  await addPage.getByRole('button', { name: textModel, exact: true }).waitFor({ state: 'visible' })
  assert(requests.length === requestsBeforeExistingConnection + 1, `Get model list made more than one request: ${JSON.stringify(requests)}`)

  for (const modelId of initialModels) {
    await addPage.getByRole('button', { name: modelId, exact: true }).click()
  }
  await screenshot(win, '02-desktop-three-kinds-selected.png')
  journeyPhase = 'save-selected-models'
  const requestsBeforeSave = requests.length
  await addPage.getByRole('button', { name: '添加 3 个模型', exact: true }).click()
  const connectionPage = win.locator(`[data-model-settings-page="connection"][data-model-settings-vendor="${vendor.key}"]`)
  await connectionPage.waitFor({ state: 'visible' })
  assert(requests.length === requestsBeforeSave, 'Adding models started a hidden provider request')
  const saved = readCatalogFromDisk().models.filter((model) => model.vendorKey === vendor.key && initialModels.includes(model.modelKey))
  assert(saved.length === 3 && saved.find((model) => model.modelKey === textModel)?.enabled, 'Text model was not saved enabled')
  await connectionPage.getByRole('button', { name: textModel, exact: true }).click()
  const detailPanel = win.locator('[data-model-settings-page="model"]')
  const modelDialog = win.locator('[data-model-settings-dialog]')
  await modelDialog.waitFor({ state: 'visible' })
  await detailPanel.locator('[data-model-status="ready"]').waitFor({ state: 'visible' })
  await screenshot(win, '03-desktop-ready-without-verification.png')
  await modelDialog.getByRole('button', { name: '关闭', exact: true }).click()
  await modelDialog.waitFor({ state: 'detached' })
  const requestsBeforeExistingPicker = requests.length
  await win.getByRole('button', { name: '添加其他模型', exact: true }).click()
  const existingAddPage = win.locator('[data-model-settings-page="add"]')
  await existingAddPage.waitFor({ state: 'visible' })
  await win.waitForTimeout(500)
  assert(requests.length === requestsBeforeExistingPicker, 'Opening the saved connection picker contacted the upstream')
  assert(await existingAddPage.getByPlaceholder('sk-...', { exact: true }).count() === 0, 'Saved connection asked for its API key again')
  await addExistingModelManually(win, manualAudioModel)
  assert(requests.length === requestsBeforeExistingPicker, 'Manually saving to an existing connection contacted the upstream')
  const catalogAfterAppend = readCatalogFromDisk()
  const appended = catalogAfterAppend.models.find((model) => model.vendorKey === vendor.key && model.modelKey === manualAudioModel)
  assert(appended?.kind === 'audio' && appended.enabled === false, 'Manually appended audio model was not saved disabled')
  assert(appended?.availability?.usable !== true, 'Audio without a request format became usable')

  const appendedDetail = win.locator(`[data-model-settings-page="model"][data-model-settings-model="${manualAudioModel}"]`)
  await modelDialog.waitFor({ state: 'visible' })
  await appendedDetail.waitFor({ state: 'visible' })
  await assertModelDialogSurface(
    win,
    `[data-model-settings-page="model"][data-model-settings-model="${manualAudioModel}"]`,
    'manually appended model detail',
  )
  await modelDialog.getByRole('button', { name: '关闭', exact: true }).click()
  await modelDialog.waitFor({ state: 'detached' })
  await win.locator(`[data-model-settings-page="connection"][data-model-settings-vendor="${vendor.key}"]`).waitFor({ state: 'visible' })

  await win.getByRole('button', { name: '添加其他模型', exact: true }).click()
  await existingAddPage.waitFor({ state: 'visible' })
  await win.waitForTimeout(350)
  assert(requests.length === requestsBeforeExistingPicker, 'Reopening the existing picker contacted the upstream')
  listPhase = 'existing'
  await existingAddPage.getByRole('button', { name: '获取可用模型', exact: true }).click()
  await pollUntil(
    () => Promise.resolve(requests),
    (items) => items.length === requestsBeforeExistingPicker + 1 && items.at(-1)?.method === 'GET' && items.at(-1)?.url?.endsWith('/models'),
    'explicit existing-connection refresh',
  )
  await existingAddPage.getByRole('button', { name: remotelyListedModel, exact: true }).waitFor({ state: 'visible' })
  await screenshot(win, '10-desktop-existing-connection-explicit-refresh.png')
  await existingAddPage.getByRole('button', { name: '返回', exact: true }).first().click()

  await connectionPage.waitFor({ state: 'visible' })
  await win.getByRole('button', { name: model3d, exact: true }).click()
  await modelDialog.waitFor({ state: 'visible' })
  await win.locator('[data-model-adapter-state="needsCapability"]').waitFor({ state: 'visible' })
  await assertModelDialogSurface(win, '[data-model-settings-page="model"]', '3D model detail')
  await detailPanel.getByRole('button', { name: '设置输入方式', exact: true }).waitFor({ state: 'visible' })
  await screenshot(win, '11-desktop-unsupported-model-needs-format.png')

  await browserWindow.evaluate((window) => {
    window.setMinimumSize(320, 500)
    window.setBounds({ x: 0, y: 0, width: 390, height: 844 })
  }).catch(() => {})
  await win.waitForTimeout(250)
  await assertModelDialogSurface(win, '[data-model-settings-page="model"]', '390x844 model detail', true)
  await assertNoHorizontalOverflow(win, '390x844 model detail')
  await screenshot(win, '13-narrow-390x844-model-detail-third-level.png')
  await win.keyboard.press('Escape')
  await modelDialog.waitFor({ state: 'detached' })
  await connectionPage.waitFor({ state: 'visible' })
  await assertSettingsOwnedPage(win, `[data-model-settings-page="connection"][data-model-settings-vendor="${vendor.key}"]`, 'narrow connection after Escape')

  assert(rendererErrors.length === 0, `Renderer console/page errors:\n${rendererErrors.join('\n')}`)
  console.log(`  upstream requests: ${requests.length} (${requests.filter((request) => request.method === 'GET').length} model lists, ${chatAttempt} text tests)`)
  console.log('  save-first, zero verification requests, existing-connection append, manual format setup, and responsive layout: ok')
} catch (error) {
  console.error('  walkthrough failed:', error)
  if (rendererErrors.length > 0) console.error(`  renderer errors:\n${rendererErrors.join('\n')}`)
  try { await screenshot(win, 'ERROR.png') } catch { /* noop */ }
  process.exitCode = 1
} finally {
  for (const timer of delayedResponses) clearTimeout(timer)
  delayedResponses.clear()
  await app.close().catch(() => {})
  server.closeAllConnections?.()
  await new Promise((resolve) => server.close(resolve))
}
