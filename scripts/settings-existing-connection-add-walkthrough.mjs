// R16 real journey: append models to a saved connection without asking for its key again.
// Also proves that an unavailable /models endpoint does not block manual model IDs.
// Usage: pnpm build && node scripts/settings-existing-connection-add-walkthrough.mjs
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.settings-existing-connection-add-walk')
const rendererUrl = process.env.NOMI_WALK_RENDERER_URL || `file://${path.join(repoRoot, 'dist', 'index.html')}`
const settingsDir = mkdtempSync(path.join(os.tmpdir(), 'settings-existing-connection-add-set-'))
const projectsDir = mkdtempSync(path.join(os.tmpdir(), 'settings-existing-connection-add-proj-'))
mkdirSync(outDir, { recursive: true })

const vendorKey = 'saved-relay'
const vendorName = 'Saved Relay'
const existingModel = 'existing-text-v1'
const listedModel = 'new-text-v2'
const manualModel = 'manual-text-v3'
const secretKey = 'sk-existing-connection-e2e-secret'
const terminalStages = new Set(['completed', 'partial', 'failed', 'needs_ai', 'cancelled', 'timed_out', 'stale'])

let modelListMode = 'success'
let listedVerificationAttempts = 0
const delayedResponses = new Set()
const requests = []

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

async function requestBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function chatCompletion(response, model, delayMs) {
  const send = () => {
    if (response.destroyed) return
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    response.write(`data: ${JSON.stringify({
      id: 'chatcmpl-nomi-e2e',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: { role: 'assistant', content: 'ready' }, finish_reason: null }],
    })}\n\n`)
    response.write(`data: ${JSON.stringify({
      id: 'chatcmpl-nomi-e2e',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
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
    try { body = bodyText ? JSON.parse(bodyText) : {} } catch { /* leave malformed bodies observable below */ }
    const authorization = String(request.headers.authorization || '')
    const requestRecord = {
      sequence: requests.length + 1,
      method: request.method,
      url: request.url,
      authPresent: Boolean(authorization),
      authMatchesSavedCredential: authorization === `Bearer ${secretKey}`,
      model: typeof body.model === 'string' ? body.model : '',
      verificationAttempt: 0,
      requestAborted: false,
      responseFinished: false,
      responseClosedBeforeEnd: false,
    }
    requests.push(requestRecord)
    request.once('aborted', () => { requestRecord.requestAborted = true })
    response.once('finish', () => { requestRecord.responseFinished = true })
    response.once('close', () => {
      if (!requestRecord.responseFinished) requestRecord.responseClosedBeforeEnd = true
    })

    if (request.method === 'GET' && (request.url === '/v1/models' || request.url === '/v1/v1/models')) {
      if (modelListMode === 'failure') {
        // Deliberately echo the credential. The main-process boundary must redact this
        // before the failure object or its text reaches the renderer.
        json(response, 503, {
          error: { message: `temporary upstream failure for Bearer ${secretKey}` },
        })
        return
      }
      json(response, 200, {
        object: 'list',
        data: [
          { id: existingModel, object: 'model' },
          { id: listedModel, object: 'model' },
        ],
      })
      return
    }

    if (request.method === 'POST' && request.url === '/v1/chat/completions') {
      const model = typeof body.model === 'string' ? body.model : ''
      if (model === listedModel) {
        listedVerificationAttempts += 1
        requestRecord.verificationAttempt = listedVerificationAttempts
      }
      chatCompletion(response, model, model === listedModel && listedVerificationAttempts === 1 ? 20_000 : 0)
      return
    }

    json(response, 404, { error: { message: 'mock route not found' } })
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

const shot = async (win, name) => {
  await win.screenshot({ path: path.join(outDir, name) })
  console.log(`  screenshot: ${name}`)
}

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

function assertNoPlainCredential(value, label) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value)
  if (serialized.includes(secretKey) || serialized.includes(encodeURIComponent(secretKey))) {
    throw new Error(`${label} exposed the saved plaintext credential`)
  }
}

async function assertRendererHasNoCredential(win, label) {
  const exposed = await win.evaluate((credential) => {
    const body = document.body
    const candidates = [
      body?.innerText || '',
      body?.innerHTML || '',
      ...Array.from(document.querySelectorAll('input, textarea')).map((input) => input.value),
    ]
    return candidates.some((value) => value.includes(credential) || value.includes(encodeURIComponent(credential)))
  }, secretKey)
  if (exposed) throw new Error(`${label}: renderer DOM exposed the saved plaintext credential`)
}

async function assertSettingsSurface(win, label) {
  const state = await win.evaluate(() => {
    const visible = (element) => element instanceof HTMLElement && element.getClientRects().length > 0 && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden'
    const settings = document.querySelector('[data-settings-dialog]')
    const content = document.querySelector('[data-settings-content]')
    const workspace = document.querySelector('[data-settings-model-workspace]:not([hidden])')
    const activePage = document.querySelector('[data-model-settings-page]')
    const overflow = (element) => element instanceof HTMLElement && element.scrollWidth > element.clientWidth + 2
    return {
      dialogs: [...document.querySelectorAll('[role="dialog"]')].filter(visible).length,
      settingsVisible: settings instanceof HTMLElement && !settings.hidden,
      pageInsideSettings: !(activePage instanceof HTMLElement) || Boolean(settings?.contains(activePage)),
      horizontalOverflow: [settings, content, workspace, activePage].some(overflow),
      documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
    }
  })
  if (
    state.dialogs !== 1 ||
    !state.settingsVisible ||
    !state.pageInsideSettings ||
    state.horizontalOverflow ||
    state.documentOverflow
  ) {
    throw new Error(`${label}: invalid Settings surface: ${JSON.stringify(state)}`)
  }
}

async function assertModelDialogSurface(win, label) {
  const state = await win.evaluate(() => {
    const visible = (element) => element instanceof HTMLElement && element.getClientRects().length > 0 && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden'
    const settings = document.querySelector('[data-settings-dialog]')
    const dialog = document.querySelector('[data-model-settings-dialog]')
    const activePage = dialog?.querySelector('[data-model-settings-page]')
    const overflow = (element) => element instanceof HTMLElement && element.scrollWidth > element.clientWidth + 2
    return {
      dialogs: [...document.querySelectorAll('[role="dialog"]')].filter(visible).length,
      settingsVisible: settings instanceof HTMLElement && settings.getClientRects().length > 0,
      modelDialogVisible: dialog instanceof HTMLElement && dialog.getClientRects().length > 0,
      pageInsideModelDialog: activePage instanceof HTMLElement && Boolean(dialog?.contains(activePage)),
      horizontalOverflow: [dialog, activePage].some(overflow),
      documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
    }
  })
  if (
    state.dialogs !== 2 ||
    !state.settingsVisible ||
    !state.modelDialogVisible ||
    !state.pageInsideModelDialog ||
    state.horizontalOverflow ||
    state.documentOverflow
  ) {
    throw new Error(`${label}: invalid model dialog surface: ${JSON.stringify(state)}`)
  }
}

async function certificationRuns(win) {
  const result = await win.evaluate(async () => {
    const list = window.nomiDesktop?.onboarding?.certificationList
    return list ? list({ limit: 10 }) : { ok: false, error: 'certificationList bridge missing' }
  })
  assertNoPlainCredential(result, 'certificationList return object')
  return result
}

async function openConnectionFromHome(win) {
  await win.locator('[data-settings-section="models"]').waitFor({ state: 'visible' })
  const connectionButton = win.getByRole('button')
    .filter({ hasText: vendorName })
    .filter({ hasText: '个模型已启用' })
    .first()
  await connectionButton.waitFor({ state: 'visible' })
  await connectionButton.click()
  await win.locator(`[data-model-settings-page="connection"][data-model-settings-vendor="${vendorKey}"]`).waitFor({ state: 'visible' })
}

const { app, win } = await launchNomiApp({
  name: 'settings-existing-connection-add',
  settingsDir,
  projectsDir,
  args: ['--no-proxy-server'],
  env: { NOMI_RENDERER_URL: rendererUrl },
  settleMs: 1800,
})

const consoleErrors = []
const returnedObjects = []
try {
  win.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error)}`))
  win.on('console', (message) => {
    const text = message.text()
    if (message.type() === 'error') consoleErrors.push(`console: ${text}`)
    if (text.includes(secretKey)) consoleErrors.push('console exposed the saved plaintext credential')
  })

  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((window) => window.setBounds({ x: 0, y: 0, width: 1440, height: 1000 })).catch(() => {})

  // Seed through the same OS-backed Electron identity that will later decrypt it.
  const encrypted = await app.evaluate(({ safeStorage }, plaintext) => {
    if (!safeStorage.isEncryptionAvailable()) return { available: false, cipher: '' }
    return { available: true, cipher: safeStorage.encryptString(plaintext).toString('base64') }
  }, secretKey)
  if (!encrypted.available || !encrypted.cipher) throw new Error('safeStorage encryption is unavailable; cannot prove encrypted saved-credential reuse')
  assertNoPlainCredential(encrypted.cipher, 'safeStorage ciphertext')

  const now = new Date().toISOString()
  writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
    version: 8,
    vendors: [{
      key: vendorKey,
      name: vendorName,
      enabled: true,
      baseUrlHint: baseUrl,
      authType: 'bearer',
      providerKind: 'openai-compatible',
      createdAt: now,
      updatedAt: now,
    }],
    models: [{
      modelKey: existingModel,
      vendorKey,
      labelZh: existingModel,
      kind: 'text',
      enabled: true,
      onboarding: { addedVia: 'manual', addedAt: now, fields: [] },
      createdAt: now,
      updatedAt: now,
    }],
    mappings: [],
    apiKeysByVendor: {
      [vendorKey]: {
        vendorKey,
        apiKey: encrypted.cipher,
        enc: 'safeStorage',
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
    },
  }, null, 2))

  await win.getByRole('button', { name: '设置', exact: true }).first().click()
  const settings = win.getByRole('dialog', { name: '设置' })
  await settings.getByRole('button', { name: '模型', exact: true }).click()
  await win.locator('[data-settings-section="models"]').waitFor({ state: 'visible' })
  await openConnectionFromHome(win)
  await assertSettingsSurface(win, 'saved connection page')
  await assertRendererHasNoCredential(win, 'saved connection page')
  await shot(win, '01-saved-connection.png')

  const requestsBeforePicker = requests.length
  await win.getByRole('button', { name: '添加其他模型', exact: true }).click()
  const addPage = win.locator('[data-model-settings-page="add"]')
  await addPage.waitFor({ state: 'visible' })
  await win.getByText('选择要添加的模型', { exact: true }).waitFor({ state: 'visible' })
  if (await addPage.getByPlaceholder('sk-...', { exact: true }).count()) throw new Error('Existing connection asked the renderer to re-enter its API key')
  if (await addPage.getByText('你的 API Key', { exact: true }).count()) throw new Error('Existing connection rendered an API-key collection field')

  await win.waitForTimeout(300)
  if (requests.length !== requestsBeforePicker) throw new Error(`Opening the existing-connection picker made a hidden request: ${JSON.stringify(requests.slice(requestsBeforePicker))}`)
  await addPage.getByRole('button', { name: '重新获取列表', exact: true }).click()

  await pollUntil(
    () => Promise.resolve(requests.slice(requestsBeforePicker)),
    (items) => items.some((item) => item.method === 'GET' && item.url?.includes('/models') && item.authMatchesSavedCredential),
    'authenticated GET /models from the saved connection',
  )

  const successListResult = await win.evaluate(async (key) => window.nomiDesktop.onboarding.httpConnectionListModels({ vendorKey: key }), vendorKey)
  returnedObjects.push(successListResult)
  assertNoPlainCredential(successListResult, 'successful httpConnectionListModels return object')

  const existingButton = win.getByRole('button', { name: existingModel, exact: true })
  const newButton = win.getByRole('button', { name: listedModel, exact: true })
  await existingButton.waitFor({ state: 'visible' })
  if (!(await existingButton.isDisabled())) throw new Error('An already-added model can still be selected again')
  if (await newButton.isDisabled()) throw new Error('A newly listed model is not selectable')
  await newButton.click()
  await assertSettingsSurface(win, 'existing connection picker')
  await assertRendererHasNoCredential(win, 'existing connection picker')
  await shot(win, '02-existing-disabled-new-selected.png')

  const requestsBeforeSave = requests.length
  await win.getByRole('button', { name: '验证 1 个模型', exact: true }).click()
  const connectionPage = win.locator(`[data-model-settings-page="connection"][data-model-settings-vendor="${vendorKey}"]`)
  await connectionPage.waitFor({ state: 'visible' })
  if (requests.length !== requestsBeforeSave) throw new Error('Saving an appended model started a hidden provider request')
  const runsAfterSave = await certificationRuns(win)
  if (runsAfterSave.runs?.some((run) => run.selectedModelKeys?.includes(listedModel))) {
    throw new Error('Saving an appended model started an adapter run')
  }

  await connectionPage.getByRole('button', { name: listedModel, exact: true }).click()
  const modelDialog = win.locator('[data-model-settings-dialog]')
  const modelPage = win.locator(`[data-model-settings-page="model"][data-model-settings-model="${listedModel}"]`)
  await modelDialog.waitFor({ state: 'visible' })
  await modelPage.waitFor({ state: 'visible' })
  await win.locator('[data-model-adapter-state="readyUntested"]').waitFor({ state: 'visible' })
  await modelPage.getByText('更多操作', { exact: true }).click()
  await modelPage.getByRole('button', { name: '让 Nomi 自动配置', exact: true }).click()
  const consent = win.getByRole('dialog', { name: '开始后台自动适配？', exact: true })
  await consent.waitFor({ state: 'visible' })
  if (requests.length !== requestsBeforeSave) throw new Error('Opening adaptation consent contacted the provider')
  await consent.locator('[data-confirm-dialog-confirm="true"]').click()
  await consent.waitFor({ state: 'hidden' })
  await win.locator('[data-confirm-dialog] [role="dialog"]').waitFor({ state: 'hidden' })
  await win.waitForTimeout(250)
  await win.getByText('正在接入并验证', { exact: true }).waitFor({ timeout: 12_000 })
  const activeList = await pollUntil(
    () => certificationRuns(win),
    (result) => result.ok && result.runs?.some((run) => run.selectedModelKeys?.includes(listedModel) && !terminalStages.has(run.stage)),
    'first adapter run to enter a non-terminal state',
  )
  const firstRun = activeList.runs.find((run) => run.selectedModelKeys?.includes(listedModel))
  if (!firstRun) throw new Error('Could not identify the first append-model run')
  returnedObjects.push(firstRun)
  await pollUntil(
    () => Promise.resolve(requests),
    (items) => items.some((item) => item.method === 'POST' && item.url === '/v1/chat/completions' && item.model === listedModel && item.authMatchesSavedCredential),
    'slow authenticated model verification request',
  )
  await assertModelDialogSurface(win, 'running verification page')
  await assertRendererHasNoCredential(win, 'running verification page')
  await shot(win, '03-running-verification.png')

  await win.getByRole('button', { name: '转到后台', exact: true }).click()
  await modelPage.waitFor({ state: 'visible' })
  await modelDialog.getByRole('button', { name: '关闭', exact: true }).click()
  await modelDialog.waitFor({ state: 'detached' })
  await connectionPage.waitFor({ state: 'visible' })
  await connectionPage.locator('[data-model-settings-back]').click()
  await win.locator('[data-settings-section="models"]').waitFor({ state: 'visible' })
  const taskButton = win.getByRole('button', { name: `查看 ${vendorName} 的接入任务`, exact: true })
  await taskButton.waitFor({ state: 'visible' })
  await shot(win, '04-background-task-on-model-home.png')

  await taskButton.click()
  const restoredTask = win.locator(`[data-model-settings-page="verification"][data-adapter-run-id="${firstRun.id}"]`)
  await restoredTask.waitFor({ state: 'visible' })
  const restoredSnapshot = await certificationRuns(win)
  const restoredRun = restoredSnapshot.runs?.find((run) => run.id === firstRun.id)
  if (!restoredRun || terminalStages.has(restoredRun.stage)) throw new Error('Background task did not reopen while the real request was still running')
  await assertSettingsSurface(win, 'restored background task')
  await assertRendererHasNoCredential(win, 'restored background task')
  await shot(win, '05-restored-background-task.png')

  // Escape and the visible back button both navigate the model page stack without
  // closing Settings. Reopen the same persisted task after each route transition.
  await win.keyboard.press('Escape')
  await win.locator('[data-settings-section="models"]').waitFor({ state: 'visible' })
  if (!(await settings.isVisible())) throw new Error('Escape closed Settings instead of returning from the task page')
  await taskButton.click()
  await restoredTask.waitFor({ state: 'visible' })
  await restoredTask.locator('[data-model-settings-back]').click()
  await win.locator('[data-settings-section="models"]').waitFor({ state: 'visible' })
  await taskButton.click()
  await restoredTask.waitFor({ state: 'visible' })

  const firstVerificationRequest = requests.find((request) =>
    request.method === 'POST' &&
    request.url === '/v1/chat/completions' &&
    request.model === listedModel &&
    request.verificationAttempt === 1,
  )
  if (!firstVerificationRequest || firstVerificationRequest.responseFinished) {
    throw new Error('The first verification request was not observably pending before cancellation')
  }

  await restoredTask.getByRole('button', { name: '停止验证', exact: true }).click()
  const cancelledSnapshot = await pollUntil(
    () => certificationRuns(win),
    (result) => result.ok && result.runs?.some((run) => run.id === firstRun.id && run.stage === 'cancelled'),
    'cancelled adapter run to persist its terminal state',
  )
  const cancelledRun = cancelledSnapshot.runs.find((run) => run.id === firstRun.id)
  returnedObjects.push(cancelledRun)
  await pollUntil(
    () => Promise.resolve(firstVerificationRequest),
    (request) => request.requestAborted || request.responseClosedBeforeEnd,
    'cancelled verification to abort or close the underlying mock request',
  )
  if (firstVerificationRequest.responseFinished) {
    throw new Error('The cancelled slow verification still completed its HTTP response')
  }
  await pollUntil(
    () => Promise.resolve(delayedResponses.size),
    (size) => size === 0,
    'cancelled verification to clear its delayed mock response',
  )
  await assertRendererHasNoCredential(win, 'cancelled verification')
  await shot(win, '06-cancelled-verification.png')

  const retryButton = restoredTask.getByRole('button', { name: '全部重新验证', exact: true })
  await retryButton.waitFor({ state: 'visible' })
  await retryButton.click()
  const retrySnapshot = await pollUntil(
    () => certificationRuns(win),
    (result) => result.ok && result.runs?.some((run) =>
      run.id !== firstRun.id && run.selectedModelKeys?.includes(listedModel),
    ),
    'persisted run-id retry to create a distinct adapter run',
  )
  const retryRun = retrySnapshot.runs.find((run) =>
    run.id !== firstRun.id && run.selectedModelKeys?.includes(listedModel),
  )
  if (!retryRun || retryRun.id === firstRun.id) throw new Error('Retry reused the cancelled run id')
  returnedObjects.push(retryRun)
  const retryTask = win.locator(`[data-model-settings-page="verification"][data-adapter-run-id="${retryRun.id}"]`)
  await retryTask.waitFor({ state: 'visible' })

  const secondVerificationRequest = await pollUntil(
    () => Promise.resolve(requests.find((request) =>
      request.method === 'POST' &&
      request.url === '/v1/chat/completions' &&
      request.model === listedModel &&
      request.verificationAttempt === 2,
    )),
    (request) => Boolean(request),
    'retried verification to reach the mock API',
  )
  if (!secondVerificationRequest.authMatchesSavedCredential) {
    throw new Error('Persisted retry did not reuse the saved main-process credential')
  }
  const completedRetrySnapshot = await pollUntil(
    () => certificationRuns(win),
    (result) => result.ok && result.runs?.some((run) => run.id === retryRun.id && run.stage === 'completed'),
    'retried verification to complete successfully',
  )
  if (completedRetrySnapshot.runs.find((run) => run.id === firstRun.id)?.stage !== 'cancelled') {
    throw new Error('The old cancelled task changed state while its retry completed')
  }
  await new Promise((resolve) => setTimeout(resolve, 1_100))
  const stableRuns = await certificationRuns(win)
  if (stableRuns.runs?.find((run) => run.id === firstRun.id)?.stage !== 'cancelled') {
    throw new Error('A late provider response resurrected the cancelled task')
  }
  if (stableRuns.runs?.find((run) => run.id === retryRun.id)?.stage !== 'completed') {
    throw new Error('The successful retried task did not retain its terminal state')
  }
  if (!secondVerificationRequest.responseFinished || secondVerificationRequest.responseClosedBeforeEnd) {
    throw new Error('The retried verification did not finish its mock HTTP response normally')
  }
  await assertSettingsSurface(win, 'successful persisted retry')
  await assertRendererHasNoCredential(win, 'successful persisted retry')
  await shot(win, '07-retry-completed-new-run.png')

  await win.keyboard.press('Escape')
  await win.locator('[data-settings-section="models"]').waitFor({ state: 'visible' })

  // Degraded path: listing is optional. Even a failure that contains the secret
  // must be redacted and leave manual model entry enabled.
  modelListMode = 'failure'
  await openConnectionFromHome(win)
  await win.getByRole('button', { name: '添加其他模型', exact: true }).click()
  await addPage.waitFor({ state: 'visible' })
  await addPage.getByRole('button', { name: '重新获取列表', exact: true }).click()
  await win.getByText(/没自动拉到模型：/).waitFor({ state: 'visible', timeout: 12_000 })
  await assertRendererHasNoCredential(win, 'failed model-list fallback')
  await assertSettingsSurface(win, 'failed model-list fallback')

  const failedListResult = await win.evaluate(async (key) => window.nomiDesktop.onboarding.httpConnectionListModels({ vendorKey: key }), vendorKey)
  returnedObjects.push(failedListResult)
  assertNoPlainCredential(failedListResult, 'failed httpConnectionListModels return object')
  if (failedListResult.ok || failedListResult.code !== 'MODEL_LIST_UNAVAILABLE') {
    throw new Error(`Expected a non-blocking MODEL_LIST_UNAVAILABLE response, got ${JSON.stringify(failedListResult)}`)
  }

  const manualInput = win.getByPlaceholder('没列出来的，输入模型 id 回车添加', { exact: true })
  if (await manualInput.isDisabled()) throw new Error('Manual model ID input was blocked after /models failed')
  await manualInput.fill(manualModel)
  await win.getByRole('button', { name: '添加', exact: true }).click()
  await win.getByRole('button', { name: manualModel, exact: true }).waitFor({ state: 'visible' })
  await shot(win, '08-model-list-failed-manual-id-ready.png')

  const requestsBeforeManualSave = requests.length
  await win.getByRole('button', { name: '验证 1 个模型', exact: true }).click()
  await addPage.waitFor({ state: 'detached' })
  await connectionPage.waitFor({ state: 'visible' })
  await connectionPage.getByRole('button', { name: manualModel, exact: true }).waitFor({ state: 'visible' })
  if (requests.length !== requestsBeforeManualSave) throw new Error('Saving the manual fallback model made a hidden provider request')
  const runsAfterManualSave = await certificationRuns(win)
  if (runsAfterManualSave.runs?.some((run) => run.selectedModelKeys?.includes(manualModel))) {
    throw new Error('Saving the manual fallback model started an adapter run')
  }
  await assertRendererHasNoCredential(win, 'manual model saved')
  await assertSettingsSurface(win, 'manual model saved')
  await shot(win, '09-manual-model-saved.png')

  const finalRuns = await certificationRuns(win)
  returnedObjects.push(finalRuns)
  if (finalRuns.runs?.find((run) => run.id === firstRun.id)?.stage !== 'cancelled') {
    throw new Error('The original run no longer has its cancelled terminal state at journey end')
  }
  if (finalRuns.runs?.find((run) => run.id === retryRun.id)?.stage !== 'completed') {
    throw new Error('The persisted retry no longer has its successful terminal state at journey end')
  }
  for (const [index, value] of returnedObjects.entries()) assertNoPlainCredential(value, `renderer return object ${index + 1}`)

  const finalCatalog = JSON.parse(readFileSync(path.join(settingsDir, 'model-catalog.json'), 'utf8'))
  const keyRecord = finalCatalog.apiKeysByVendor?.[vendorKey]
  if (keyRecord?.enc !== 'safeStorage' || !keyRecord.apiKey || keyRecord.apiKey === secretKey) {
    throw new Error('Saved connection credential is no longer stored as safeStorage ciphertext')
  }
  for (const modelKey of [existingModel, listedModel, manualModel]) {
    if (!finalCatalog.models.some((model) => model.vendorKey === vendorKey && model.modelKey === modelKey)) {
      throw new Error(`Catalog is missing ${modelKey} after the user journey`)
    }
  }
  for (const fileName of readdirSync(settingsDir).filter((name) => name.endsWith('.json'))) {
    assertNoPlainCredential(readFileSync(path.join(settingsDir, fileName), 'utf8'), `settings file ${fileName}`)
  }

  const protectedRequests = requests.filter((request) =>
    request.url?.includes('/models') || request.url === '/v1/chat/completions',
  )
  if (protectedRequests.length === 0 || protectedRequests.some((request) => !request.authMatchesSavedCredential)) {
    throw new Error(`Not every protected mock request used the saved main-process credential: ${JSON.stringify(protectedRequests)}`)
  }
  if (consoleErrors.length > 0) throw new Error(`Renderer console/page errors:\n${consoleErrors.join('\n')}`)

  console.log(`  authenticated main-process requests: ${protectedRequests.length}`)
  console.log('  encrypted credential reuse, cancellation, persisted retry, background recovery, duplicate prevention, and manual-ID fallback: ok')
} catch (error) {
  console.error('  walkthrough failed:', error)
  if (consoleErrors.length > 0) console.error(`  renderer errors:\n${consoleErrors.join('\n')}`)
  try { await shot(win, 'ERROR.png') } catch { /* noop */ }
  process.exitCode = 1
} finally {
  for (const timer of delayedResponses) clearTimeout(timer)
  delayedResponses.clear()
  await app.close()
  server.closeAllConnections?.()
  await new Promise((resolve) => server.close(resolve))
}
