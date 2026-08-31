#!/usr/bin/env node
// Phase 6 real-user acceptance: the resident shell must close a real task through
// the Host, not merely render controls. The provider is loopback-only and zero quota.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { APIMART_IMAGE_MODEL, flattenRequestText, FIXTURE_API_KEY, FIXTURE_IMAGE_ALT_MODEL, FIXTURE_TEXT_MODEL, FIXTURE_VENDOR, FIXTURE_VIDEO_ALT_MODEL, FIXTURE_VIDEO_MODEL } from './agent-runtime-fixture.mjs'
import { createRuntimeWalk, DOCUMENT, readProject, recorded } from './agent-runtime-walk-support.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const APIMART_SOURCE_VENDOR = 'apimart-fixture'
const APIMART_SEMANTIC_MODEL = APIMART_IMAGE_MODEL
const catalogPath = () => path.join(walk.report.tempRoot, 'settings', 'model-catalog.json')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const walk = await createRuntimeWalk('resident-real-tasks', { syntheticCredentialStorage: true, apimartLoopback: true })

// NomiSelect is the single selector contract shared by canvas and resident
// cards.  Keep the walk on the visible button/option surface; never reach for
// a hidden native <select> that the production UI no longer owns.
async function chooseNomiOption(win, scope, ariaLabel, text) {
  // NomiSelect exposes a labelled trigger; NomiSegmented exposes the same
  // label on its radiogroup. Keep the walk on the public design-system
  // contract instead of assuming every parameter is a dropdown.
  const selectTrigger = scope.locator(`button[aria-label="${ariaLabel}"]`).first()
  const segmented = scope.locator(`[role="radiogroup"][aria-label="${ariaLabel}"]`).first()
  const trigger = await selectTrigger.count() ? selectTrigger : segmented
  try {
    await trigger.waitFor({ state: 'visible', timeout: 15_000 })
  } catch (error) {
    console.error(`selector ${ariaLabel} unavailable; scope text:`, (await scope.innerText().catch(() => '')).slice(0, 600))
    throw error
  }
  if (await segmented.count()) {
    const option = segmented.getByRole('radio').filter({ hasText: text }).first()
    await option.waitFor({ state: 'visible', timeout: 15_000 })
    await option.click()
    return
  }
  await trigger.click()
  const dropdown = win.locator('[data-nomi-select-dropdown]:visible').last()
  await dropdown.waitFor({ state: 'visible', timeout: 15_000 })
  const option = dropdown.getByRole('option').filter({ hasText: text }).first()
  await option.waitFor({ state: 'visible', timeout: 15_000 })
  await option.click()
}

async function openParameterPanel(win, scope) {
  const trigger = scope.locator('button[aria-label="生成参数"], button[aria-label="Generation parameters"]').first()
  await trigger.waitFor({ state: 'visible', timeout: 15_000 })
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click()
  await scope.locator('[data-agent-parameter-panel="true"]').waitFor({ state: 'visible', timeout: 15_000 })
}

function systemRequestText(body) {
  return (body.messages || [])
    .filter((message) => message?.role === 'system')
    .map((message) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content || ''))
    .join('\n')
}

// The fixture starts with no credential ciphertext.  Keep the APIMart model
// selectable for the certification flow, but move it to an isolated source
// identity and remove its mapping until certification publishes an adapter.
// Otherwise startup's built-in APIMart seeds would make this look like an
// already-published connection and skip the first-time Settings path.
const initialCatalog = JSON.parse(fs.readFileSync(catalogPath(), 'utf8'))
const semanticModel = initialCatalog.models.find((model) => model.vendorKey === 'apimart' && model.modelKey === APIMART_SEMANTIC_MODEL)
const semanticMappings = initialCatalog.mappings
  .filter((mapping) => mapping.vendorKey === 'apimart' && mapping.modelKey === APIMART_SEMANTIC_MODEL)
  .map((mapping) => ({ ...mapping, vendorKey: APIMART_SOURCE_VENDOR, enabled: true }))
const fixtureModels = initialCatalog.models
  .filter((model) => model.vendorKey === FIXTURE_VENDOR)
  .map((model) => ({ ...model }))
const fixtureMappings = initialCatalog.mappings
  .filter((mapping) => mapping.vendorKey === FIXTURE_VENDOR)
  .map((mapping) => ({ ...mapping }))
if (!semanticModel || semanticMappings.length === 0) throw new Error('resident fixture is missing the APIMart semantic image contract')
if (!fixtureModels.some((model) => model.modelKey === FIXTURE_TEXT_MODEL) || fixtureMappings.length === 0) {
  throw new Error('resident fixture is missing the loopback text/media contract')
}
initialCatalog.vendors = initialCatalog.vendors
  .map((vendor) => vendor.key === 'apimart'
    ? { ...vendor, key: APIMART_SOURCE_VENDOR, name: 'APIMart Fixture (uncertified)', enabled: false }
    : vendor)
initialCatalog.models = initialCatalog.models
  .map((model) => model.vendorKey === 'apimart' && model.modelKey === APIMART_SEMANTIC_MODEL
    ? { ...model, vendorKey: APIMART_SOURCE_VENDOR, enabled: false }
    : model.vendorKey === FIXTURE_VENDOR
      ? { ...model, enabled: false }
    : model)
// No mapping is active for either first-time fixture connection.  This keeps
// certification ownership honest: the text model is promoted first, then the
// original loopback media mappings are restored from these snapshots after the
// app restarts.  Built-in APIMart seeds remain under their own vendor key.
initialCatalog.mappings = initialCatalog.mappings.filter((mapping) => mapping.vendorKey !== 'apimart' && mapping.vendorKey !== FIXTURE_VENDOR)
delete initialCatalog.apiKeysByVendor.apimart
delete initialCatalog.apiKeysByVendor[FIXTURE_VENDOR]
initialCatalog.vendors = initialCatalog.vendors.map((vendor) => vendor.key === FIXTURE_VENDOR ? { ...vendor, enabled: false } : vendor)
fs.writeFileSync(catalogPath(), `${JSON.stringify(initialCatalog, null, 2)}\n`, 'utf8')

function catalogSnapshot() {
  return JSON.parse(fs.readFileSync(catalogPath(), 'utf8'))
}

function assertEncryptedCredential(vendorKey, expectedEnabled) {
  const catalog = catalogSnapshot()
  const credential = catalog.apiKeysByVendor?.[vendorKey]
  check(`${vendorKey} credential is safeStorage-encrypted and has the expected enabled state`,
    credential?.enc === 'safeStorage' && credential?.enabled === expectedEnabled && credential.apiKey !== FIXTURE_API_KEY)
  return credential
}

async function waitForCertification(win, runId, timeoutMs = 120_000) {
  const terminal = new Set(['completed', 'partial', 'failed', 'needs_ai', 'cancelled', 'timed_out', 'stale'])
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    const result = await win.evaluate((id) => window.nomiDesktop.onboarding.certificationGet({ runId: id }), runId)
    last = result?.run || null
    if (last && terminal.has(last.stage)) return last
    await delay(250)
  }
  throw new Error(`resident APIMart certification timed out: ${JSON.stringify({
    runId, stage: last?.stage, error: last?.error,
    models: last?.models?.map((model) => [model.modelKey, model.modes?.map((mode) => [mode.taskKind, mode.state])]),
  })}`)
}

async function bootstrapResidentCredentials(win) {
  const fixtureKey = await win.evaluate(({ vendorKey, apiKey }) => window.nomiDesktop.modelCatalog.upsertVendorApiKey(vendorKey, { apiKey, enabled: true }), {
    vendorKey: FIXTURE_VENDOR, apiKey: FIXTURE_API_KEY,
  })
  check('custom loopback Settings write remains disabled until certification', fixtureKey?.enabled === false)
  assertEncryptedCredential(FIXTURE_VENDOR, false)

  const apimartKey = await win.evaluate(({ vendorKey, apiKey }) => window.nomiDesktop.modelCatalog.upsertVendorApiKey(vendorKey, { apiKey, enabled: true }), {
    vendorKey: APIMART_SOURCE_VENDOR, apiKey: FIXTURE_API_KEY,
  })
  check('APIMart fixture Settings write starts disabled before certification', apimartKey?.enabled === false)
  assertEncryptedCredential(APIMART_SOURCE_VENDOR, false)

  // The resident conversation itself is backed by the loopback text model.
  // Certify that model through the same canonical path as a user connection;
  // otherwise the intentionally disabled Settings key must correctly block
  // the first turn instead of silently acting like a pre-seeded credential.
  const textStart = await win.evaluate(({ vendorKey, modelKey }) => window.nomiDesktop.onboarding.httpCertificationStartExisting({
    vendorKey,
    idempotencyKey: 'resident-loopback-text-certification-v1',
    models: [{ modelKey, kind: 'text' }],
  }), { vendorKey: FIXTURE_VENDOR, modelKey: FIXTURE_TEXT_MODEL })
  check('resident text certification starts from the saved loopback credential', textStart?.ok === true && Boolean(textStart.run?.id))
  if (!textStart?.ok || !textStart.run?.id) throw new Error('resident loopback text certification did not return a run')
  const textRetry = await win.evaluate(({ vendorKey, modelKey }) => window.nomiDesktop.onboarding.httpCertificationStartExisting({
    vendorKey,
    idempotencyKey: 'resident-loopback-text-certification-v1',
    models: [{ modelKey, kind: 'text' }],
  }), { vendorKey: FIXTURE_VENDOR, modelKey: FIXTURE_TEXT_MODEL })
  check('resident text certification retry reuses one durable run', textRetry?.ok === true && textRetry.run?.id === textStart.run.id)
  const textRun = await waitForCertification(win, textStart.run.id)
  check(`resident loopback text certification completes (${textRun.stage}; error=${textRun.error || 'none'})`, textRun.stage === 'completed')
  check('resident text certification records the chat mode', textRun.models?.some((item) => item.modelKey === FIXTURE_TEXT_MODEL
    && item.modes?.some((mode) => mode.taskKind === 'chat' && mode.state === 'verified')))
  assertEncryptedCredential(FIXTURE_VENDOR, true)

  const start = await win.evaluate(({ vendorKey, modelKey }) => window.nomiDesktop.onboarding.httpCertificationStartExisting({
    vendorKey,
    idempotencyKey: 'resident-apimart-certification-v1',
    models: [{ modelKey, kind: 'image' }],
  }), { vendorKey: APIMART_SOURCE_VENDOR, modelKey: APIMART_SEMANTIC_MODEL })
  check('resident certification starts from the saved APIMart credential', start?.ok === true && Boolean(start.run?.id))
  if (!start?.ok || !start.run?.id) throw new Error('resident APIMart certification did not return a run')
  const retry = await win.evaluate(({ vendorKey, modelKey }) => window.nomiDesktop.onboarding.httpCertificationStartExisting({
    vendorKey,
    idempotencyKey: 'resident-apimart-certification-v1',
    models: [{ modelKey, kind: 'image' }],
  }), { vendorKey: APIMART_SOURCE_VENDOR, modelKey: APIMART_SEMANTIC_MODEL })
  check('resident certification retry reuses one durable run', retry?.ok === true && retry.run?.id === start.run.id)
  const run = await waitForCertification(win, start.run.id)
  check(`resident APIMart certification completes (${run.stage}; error=${run.error || 'none'})`, run.stage === 'completed')
  check('resident certification records a verified image mode', run.models?.some((item) => item.modelKey === APIMART_SEMANTIC_MODEL
    && item.modes?.some((mode) => mode.taskKind === 'text_to_image' && mode.state === 'verified')))
  check('resident certification observes a real loopback image probe', walk.fixture.images.some((record) => record.body?.prompt?.startsWith('Nomi adapter verification.')))
  assertEncryptedCredential(APIMART_SOURCE_VENDOR, true)
  const promoted = catalogSnapshot()
  check('resident certification publishes the verified APIMart image model', promoted.models?.some((model) => model.vendorKey === APIMART_SOURCE_VENDOR
    && model.modelKey === APIMART_SEMANTIC_MODEL && model.enabled === true))
}

function installCertifiedResidentApimart() {
  const catalog = catalogSnapshot()
  const sourceVendor = catalog.vendors.find((vendor) => vendor.key === APIMART_SOURCE_VENDOR)
  const sourceModel = catalog.models.find((model) => model.vendorKey === APIMART_SOURCE_VENDOR && model.modelKey === APIMART_SEMANTIC_MODEL)
  const sourceCredential = catalog.apiKeysByVendor?.[APIMART_SOURCE_VENDOR]
  if (!sourceVendor || !sourceModel || !sourceCredential || sourceCredential.enc !== 'safeStorage' || sourceCredential.enabled !== true) {
    throw new Error('resident certification promotion did not leave a usable encrypted APIMart source')
  }
  const now = new Date().toISOString()
  // Keep the promoted vendor inside the immutable direct-key scope.  The
  // isolated walk routes this canonical host to its loopback server through
  // the launcher's fixture override; changing baseUrl/auth metadata here would
  // correctly make production bootstrap fail closed.
  const apimartVendor = {
    ...sourceVendor,
    key: 'apimart', name: 'APIMart Loopback (certified fixture)', enabled: true,
    baseUrlHint: 'https://api.apimart.ai', authType: 'bearer', authHeader: 'Authorization',
    authQueryParam: null, providerKind: 'openai-compatible', updatedAt: now,
  }
  // Promotion back to the shipped APIMart direct-key contract must not carry
  // the certification-owned adapter metadata.  That metadata is an explicit
  // transport boundary: generationProviderBootstrap correctly refuses to
  // force the code-owned Bearer transport for a certified/custom connection.
  // The walk is intentionally testing the Settings direct-key path, so use
  // the same model identity with the adapter marker omitted (not `undefined`,
  // which would still count as an own property).
  const { adapter: _certifiedAdapter, ...directModelMeta } = sourceModel.meta && typeof sourceModel.meta === 'object'
    ? sourceModel.meta
    : {}
  const apimartModel = { ...sourceModel, vendorKey: 'apimart', meta: directModelMeta, enabled: true, updatedAt: now }
  catalog.vendors = catalog.vendors.filter((vendor) => vendor.key !== APIMART_SOURCE_VENDOR && vendor.key !== 'apimart')
  catalog.vendors.push(apimartVendor)
  catalog.models = catalog.models.filter((model) => !(model.vendorKey === APIMART_SOURCE_VENDOR && model.modelKey === APIMART_SEMANTIC_MODEL)
    && !(model.vendorKey === 'apimart' && model.modelKey === APIMART_SEMANTIC_MODEL))
  catalog.models.push(apimartModel)
  catalog.mappings = catalog.mappings.filter((mapping) => !(mapping.vendorKey === APIMART_SOURCE_VENDOR && mapping.modelKey === APIMART_SEMANTIC_MODEL)
    && !(mapping.vendorKey === 'apimart' && mapping.modelKey === APIMART_SEMANTIC_MODEL))
  catalog.mappings.push(...semanticMappings.map((mapping) => ({ ...mapping, vendorKey: 'apimart', enabled: true, updatedAt: now })))
  delete catalog.apiKeysByVendor[APIMART_SOURCE_VENDOR]
  catalog.apiKeysByVendor.apimart = { ...sourceCredential, vendorKey: 'apimart', enabled: true, updatedAt: now }

  // Restore the loopback text/media rows that were held out during its
  // first-time text certification.  The certified text row comes from the
  // promotion above; media rows retain their fixture mappings and are still
  // exercised through the normal catalog/runtime path.
  const promotedFixtureText = catalog.models.find((model) => model.vendorKey === FIXTURE_VENDOR && model.modelKey === FIXTURE_TEXT_MODEL)
  const restoredFixtureModels = fixtureModels
    .filter((model) => model.modelKey !== FIXTURE_TEXT_MODEL)
    .map((model) => ({ ...model, vendorKey: FIXTURE_VENDOR, enabled: true }))
  catalog.models = catalog.models.filter((model) => model.vendorKey !== FIXTURE_VENDOR)
  catalog.models.push(...(promotedFixtureText ? [{ ...promotedFixtureText, enabled: true }] : []), ...restoredFixtureModels)
  catalog.mappings = catalog.mappings.filter((mapping) => mapping.vendorKey !== FIXTURE_VENDOR)
  catalog.mappings.push(...fixtureMappings.map((mapping) => ({ ...mapping, vendorKey: FIXTURE_VENDOR, enabled: true, updatedAt: now })))
  const fixtureVendor = catalog.vendors.find((vendor) => vendor.key === FIXTURE_VENDOR)
  if (fixtureVendor) catalog.vendors = catalog.vendors.map((vendor) => vendor.key === FIXTURE_VENDOR ? { ...vendor, enabled: true, updatedAt: now } : vendor)
  fs.writeFileSync(catalogPath(), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
}
// Seed the same persisted preference a user would set in Settings > AI. The
// walk still goes through the real IPC reader and renderer auto-selection path;
// no node is pre-seeded, so the assertion can prove a new card inherits it.
fs.writeFileSync(path.join(walk.report.tempRoot, 'settings', 'generation-model-defaults.json'), `${JSON.stringify({
  schemaVersion: 1,
  byTaskKind: {
    text_to_image: { vendorKey: FIXTURE_VENDOR, modelKey: 'agent-runtime-image' },
    image_edit: { vendorKey: FIXTURE_VENDOR, modelKey: 'agent-runtime-image' },
    text_to_video: { vendorKey: FIXTURE_VENDOR, modelKey: FIXTURE_VIDEO_MODEL },
    image_to_video: { vendorKey: FIXTURE_VENDOR, modelKey: FIXTURE_VIDEO_MODEL },
  },
}, null, 2)}\n`, 'utf8')
const trace = []
const traceDir = path.join(walk.outputDir, 'trace')
fs.mkdirSync(traceDir, { recursive: true })
const failures = []
const assertions = []
let lastScreenshot = null
let lastHostSnapshot = null
let lastDomainSnapshot = null
let failure
const rendererErrors = []

function savedDocument(payload, projectId) {
  const documents = Array.isArray(payload?.workbenchDocuments) ? payload.workbenchDocuments : []
  const activeId = payload?.activeDocumentId
  return documents.find((candidate) => candidate.id === activeId) ?? documents.find((candidate) => candidate.id === `${projectId}:document`) ?? documents[0]
}

function readHostSnapshot(tempRoot, immutableProjectUuid, projectGeneration = 1) {
  const root = path.join(tempRoot, 'settings', 'project-agent-host')
  const prefix = `project-agent.${immutableProjectUuid}.g${projectGeneration}`
  const directories = fs.existsSync(root) ? fs.readdirSync(root).filter((entry) => entry === prefix) : []
  const file = directories[0] ? path.join(root, directories[0], 'snapshot-v1.json') : ''
  if (!file || !fs.existsSync(file)) return null
  const envelope = JSON.parse(fs.readFileSync(file, 'utf8'))
  return envelope?.state ?? null
}

async function step(role, action, target, operation) {
  const at = new Date().toISOString()
  let result = 'ok'
  try {
    const value = await operation()
    if (value !== undefined) result = value
    if (typeof result === 'string' && result.endsWith('.png')) lastScreenshot = result
    trace.push({ at, role, action, target, result })
    return value
  } catch (error) {
    result = error instanceof Error ? error.message : String(error)
    trace.push({ at, role, action, target, result })
    throw error
  }
}

function check(label, condition, details = '') {
  if (!condition) failures.push(`${label}${details ? ` (${details})` : ''}`)
  assertions.push({
    label,
    expected: true,
    actual: Boolean(condition),
    details,
    screenshot: lastScreenshot,
    hostSnapshot: lastHostSnapshot,
    domainSnapshot: lastDomainSnapshot,
  })
  console.log(`${condition ? '✓' : '✗'} ${label}${details ? ` · ${details}` : ''}`)
}

function attachScreenshot(labels, screenshot) {
  const wanted = new Set(Array.isArray(labels) ? labels : [labels])
  for (const assertion of assertions) if (wanted.has(assertion.label)) assertion.screenshot = screenshot
}

async function selectCanvasNode(win, nodeId, label) {
  const node = win.locator(`.generation-canvas-v2-node[data-node-id="${nodeId}"]`).first()
  await node.waitFor({ state: 'visible', timeout: 30_000 })
  const box = await node.boundingBox()
  if (!box) throw new Error(`${label} node has no visible bounds`)
  // Click the card body, away from connection handles and the floating composer.
  await node.click({ position: { x: Math.min(90, Math.max(24, box.width / 2)), y: Math.min(72, Math.max(24, box.height / 3)) } })
  return node
}

async function approveGenerationSpend(win, label) {
  const spend = win.locator('div.fixed.inset-0').filter({ hasText: '开始生成' }).last()
  await spend.waitFor({ state: 'visible', timeout: 30_000 })
  check(`${label} shows one explicit spend confirmation`, await spend.getByRole('button', { name: '生成', exact: true }).count() === 1)
  await clickOrFail(spend.getByRole('button', { name: '生成', exact: true }), `${label}确认生成`)
}

try {
  let { win } = await walk.start({ first: true })
  win.on('console', (message) => { if (message.type() === 'error') rendererErrors.push(message.text()) })
  win.on('pageerror', (error) => rendererErrors.push(error?.stack || error?.message || String(error)))
  await step('budget-sensitive-user', 'connect-loopback-model', 'model settings', async () => {
    await bootstrapResidentCredentials(win)
    const catalog = await win.evaluate(() => window.nomiDesktop.modelCatalog.health())
    if (!catalog || typeof catalog !== 'object') throw new Error('loopback model catalog is unavailable')
  })
  // Certification runs in the first renderer session.  The production APIMart
  // provider only accepts the built-in `apimart` identity, so after promotion
  // we perform the same isolated fixture-only identity handoff used by the
  // canonical journey, then restore the certified model's APIMart mapping.
  await step('budget-sensitive-user', 'promote-apimart-fixture', 'model settings', async () => {
    await walk.stopApp()
    installCertifiedResidentApimart()
    ;({ win } = await walk.start({ first: false }))
    // APIMart ships its own text brains.  This walk intentionally keeps chat
    // on the zero-quota loopback model while exercising APIMart only for the
    // semantic image task; persist the same explicit assistant preference a
    // user would choose from the resident model menu instead of relying on
    // catalog order (which would attempt a real APIMart chat request).
    await win.evaluate(({ vendorKey, modelKey }) => {
      localStorage.setItem('nomi.assistantModel', JSON.stringify({ vendorKey, modelKey }))
    }, { vendorKey: FIXTURE_VENDOR, modelKey: FIXTURE_TEXT_MODEL })
    // Certification evidence was asserted above.  Start the user journey's
    // media ledger at zero so idle/submission assertions describe only user
    // work, not the no-quota verification probes.
    walk.fixture.images.length = 0
    walk.fixture.videos.length = 0
  })
  const project = await step('novice-creator', 'create-project', 'project library', () => walk.newProject())
  const { projectId, projectRoot } = project
  const document = win.locator(DOCUMENT)
  const original = '真实用户任务：清晨的咖啡馆里，创作者整理镜头并开始拍摄。'
  await step('novice-creator', 'write-document', 'Creation document', async () => {
    await document.fill(original)
    await expect.poll(async () => JSON.stringify(savedDocument((await readProject(win, projectId)).payload, projectId))).toContain(original)
  })

  const resident = win.locator('[data-agent-resident][data-agent-surface="creation"]')
  await resident.waitFor({ state: 'visible', timeout: 30_000 })
  check('resident shell is the only visible Agent surface', await win.locator('[data-agent-resident]:visible').count() === 1)
  await step('novice-creator', 'inspect-run-mode', 'resident composer', async () => {
    await clickOrFail(resident.locator('[data-agent-mode-trigger="true"]'), '打开模式菜单')
    const menu = win.locator('[data-agent-menu="模式"]')
    await menu.waitFor({ state: 'visible', timeout: 10_000 })
    check('mode menu exposes the four deliberate levels', await menu.locator('[data-agent-menu-item]').count() === 4)
    const modeMenuScreenshot = await step('novice-creator', 'capture', 'mode menu', () => walk.snap('resident-mode-menu'))
    attachScreenshot('mode menu exposes the four deliberate levels', modeMenuScreenshot)
    await clickOrFail(menu.locator('[data-agent-menu-item="ask"]'), '选择 Ask 模式')
  })
  check('selected run mode is reflected on the resident shell', await resident.getAttribute('data-agent-run-mode') === 'ask')

  const plainRequest = walk.fixture.expectText({
    label: 'resident natural-language question',
    match: (body) => flattenRequestText(body).includes('请先读一下当前文稿') && !body.messages?.some((message) => message.tool_calls),
    reply: { type: 'text', text: '我已读完当前文稿，可以按你的目标继续。' },
  })
  await step('novice-creator', 'send-message', 'resident composer', async () => {
    await resident.locator('[data-agent-composer] textarea').fill('请先读一下当前文稿，告诉我下一步怎么做。')
    await clickOrFail(resident.locator('[data-agent-send]'), '发送 resident 自然语言任务')
  })
  const plainWire = await recorded(plainRequest.received, 'resident natural-language request')
  check('resident sends the user text to the real loopback model', flattenRequestText(plainWire.body).includes('请先读一下当前文稿'))
  check('resident sends a bounded revisioned ContextSnapshot with the natural-language turn', (() => {
    const text = flattenRequestText(plainWire.body)
    return text.includes('ContextSnapshot') && text.includes('document:resident-doc') && text.includes('targetId') && text.includes('revision') && text.includes('documentAnchor')
  })())
  await expect(resident).toContainText('我已读完当前文稿')
  const plainScreenshot = await step('novice-creator', 'capture', 'plain response', () => walk.snap('resident-plain-response'))
  attachScreenshot(['resident shell is the only visible Agent surface', 'selected run mode is reflected on the resident shell', 'resident sends the user text to the real loopback model', 'resident-natural-language-response'], plainScreenshot)

  // The picker must be more than a visual chip: a selected Prompt is sent as
  // the system layer for the very next turn. Keep this turn text-only so the
  // fixture proves the wiring without spending a provider request.
  await step('novice-creator', 'select-prompt', 'resident composer', async () => {
    await resident.locator('[data-agent-prompt-trigger]').click()
    await clickOrFail(win.locator('[data-agent-menu="提示词"] [data-agent-menu-item="story"]'), '选择镜头强化提示词')
  })
  check('selected Prompt is visible as a compact composer chip', await resident.locator('[data-agent-reference="prompt:story"]').count() === 1)
  const promptRequest = walk.fixture.expectText({
    label: 'resident selected prompt context request',
    match: (body) => flattenRequestText(body).includes('请用当前提示词给我一句镜头建议')
      && systemRequestText(body).includes('保留人物、机位和动作'),
    reply: { type: 'text', text: '镜头建议已按当前提示词生成。' },
  })
  await step('novice-creator', 'send-with-prompt', 'resident composer', async () => {
    await resident.locator('[data-agent-composer] textarea').fill('请用当前提示词给我一句镜头建议，不要修改文稿。')
    await clickOrFail(resident.locator('[data-agent-send]'), '发送带提示词的任务')
  })
  const promptWire = await recorded(promptRequest.received, 'resident selected prompt request')
  check('selected Prompt reaches the model system context', systemRequestText(promptWire.body).includes('保留人物、机位和动作'))
  await expect(resident).toContainText('镜头建议已按当前提示词生成')

  // Skill and Prompt are mutually exclusive UI modes. Exercise the Skill as a
  // separate real turn and assert that its repository body is injected through
  // the canonical nested chatContext (the regression fixed in
  // workbenchAgentRunner). No tool call or provider-side generation occurs.
  await step('novice-creator', 'select-skill', 'resident composer', async () => {
    await resident.locator('[data-agent-skill-trigger]').click()
    const menu = win.locator('[data-agent-menu="技能"]')
    await menu.waitFor({ state: 'visible', timeout: 10_000 })
    const search = menu.locator('input').first()
    await search.fill('brand.promo')
    await clickOrFail(menu.locator('[data-agent-menu-item="brand.promo"]'), '选择品牌宣传片 Skill')
  })
  check('selected Skill is visible as a compact composer chip', await resident.locator('[data-agent-reference="skill:brand.promo"]').count() === 1)
  const skillRequest = walk.fixture.expectText({
    label: 'resident selected skill context request',
    match: (body) => flattenRequestText(body).includes('请用品牌宣传片 Skill 给我一句开场建议')
      && systemRequestText(body).includes('skillKey: brand.promo')
      && systemRequestText(body).includes('五阶段'),
    reply: { type: 'text', text: '品牌宣传片 Skill 已加载，开场建议已给出。' },
  })
  await step('novice-creator', 'send-with-skill', 'resident composer', async () => {
    await resident.locator('[data-agent-composer] textarea').fill('请用品牌宣传片 Skill 给我一句开场建议，不要修改文稿。')
    await clickOrFail(resident.locator('[data-agent-send]'), '发送带 Skill 的任务')
  })
  const skillWire = await recorded(skillRequest.received, 'resident selected skill request')
  check('selected Skill identity and body reach the model system context', systemRequestText(skillWire.body).includes('skillKey: brand.promo') && systemRequestText(skillWire.body).includes('五阶段'))
  await expect(resident).toContainText('品牌宣传片 Skill 已加载')

  // Return to the default balanced mode before the write path; this proves the
  // setting is per-round UI state, not a hidden permanent permission change.
  await clickOrFail(resident.locator('[data-agent-mode-trigger="true"]'), '重新打开模式菜单')
  await clickOrFail(win.locator('[data-agent-menu="模式"] [data-agent-menu-item="balanced"]'), '恢复平衡模式')
  check('balanced mode can be selected for the next task', await resident.getAttribute('data-agent-run-mode') === 'balanced')

  const toolId = 'resident-doc-append-1'
  const append = '真实闭环回执：她按下录制键。'
  const appendRequest = walk.fixture.expectText({
    label: 'resident document write proposal',
    match: (body) => flattenRequestText(body).includes('请在文末加一句收尾') && !body.messages?.some((message) => message.role === 'tool'),
    reply: { type: 'tool', id: toolId, name: 'append_to_end', args: { content: append } },
  })
  const appendFollowup = walk.fixture.expectText({
    label: 'resident approved document result',
    match: (body) => body.messages?.some((message) => message.role === 'tool' && message.tool_call_id === toolId),
    reply: { type: 'text', text: '文稿已按批准内容追加，并保留了原文。' },
  })
  await step('novice-creator', 'send-write-request', 'resident composer', async () => {
    await resident.locator('[data-agent-composer] textarea').fill('请在文末加一句收尾，先给我确认后再写入。')
    await clickOrFail(resident.locator('[data-agent-send]'), '发送文档写入任务')
  })
  const appendWire = await recorded(appendRequest.received, 'resident document proposal request')
  check('resident advertises the creation-editor request to the model', appendWire.body.tools?.some((tool) => tool.function?.name === 'append_to_end'))
  const approval = resident.locator('[data-agent-item-kind="approval"]').filter({ hasText: '修改文稿' }).last()
  await approval.waitFor({ state: 'visible', timeout: 30_000 })
  // Prove the queue probe while this proposed turn is genuinely active. After
  // approval settles, the Host removes the empty queue section by design; using
  // that post-settlement DOM as the proof would make the negative assertion
  // indistinguishable from a dead selector.
  const documentQueueProof = await proveProbe(resident.locator('[data-agent-queue]'), 'Host queue section is mounted while document work awaits approval')
  await expect(document).toHaveText(original)
  check('document is unchanged before explicit approval', !(await document.innerText()).includes(append))
  const documentApprovalText = await approval.innerText()
  check('document approval keeps the action and impact in the first layer', documentApprovalText.includes('修改文稿') && documentApprovalText.includes('1 条内容') && !documentApprovalText.includes(append))
  const documentPendingScreenshot = await step('novice-creator', 'capture', 'document approval pending', () => walk.snap('resident-document-approval-pending'))
  attachScreenshot(['balanced mode can be selected for the next task', 'document is unchanged before explicit approval', 'document approval keeps the action and impact in the first layer'], documentPendingScreenshot)
  const documentDetails = approval.locator('[data-agent-approval-details]')
  await documentDetails.locator('summary').click()
  check('document approval reveals the exact write only on demand', (await approval.innerText()).includes(append))
  await documentDetails.locator('summary').click()
  const documentApprovalActionProof = await proveProbe(approval.locator('[data-agent-action="approve"]'), 'document approval action is mounted before commit')
  await step('novice-creator', 'approve-tool', 'resident approval card', () => clickOrFail(approval.locator('[data-agent-action="approve"]'), '批准文档追加'))
  await recorded(appendFollowup.received, 'resident approved document follow-up')
  await expect(resident).toContainText('文稿已按批准内容追加')
  await expect(document).toContainText(append)
  await expect.poll(async () => JSON.stringify(savedDocument((await readProject(win, projectId)).payload, projectId))).toContain(append)
  check('approved document write persists in the domain owner', (await document.innerText()).includes(append))
  const creationVisibleText = await resident.innerText()
  check('tool card uses a human-readable action instead of an internal capability id', creationVisibleText.includes('修改文稿') && !creationVisibleText.includes('append_to_end') && !creationVisibleText.includes('result-'))
  await expectAbsent(resident.locator('[data-agent-queue-item]'), { provenBy: documentQueueProof, message: 'completed document work leaves no active queue rows' })
  check('completed document work leaves no active queue rows', true)
  await expectAbsent(resident.locator('[data-agent-action="approve-plan"], [data-agent-action="edit-plan"]'), { provenBy: documentApprovalActionProof, message: 'completed proposal is a receipt without misleading approval controls' })
  check('completed proposal is a receipt without misleading approval controls', true)
  check('resident exposes token usage after the real turn', await resident.locator('[data-agent-usage]').count() === 1 && (await resident.locator('[data-agent-usage]').innerText()).includes('tokens'))
  const costText = await resident.locator('[data-agent-cost]').innerText()
  check('resident exposes an explicit cost state instead of hiding spend', await resident.locator('[data-agent-cost]').count() === 1 && ['费用待确认', '价格已载入', '单次约', 'Cost to confirm', 'Price loaded', 'About ¥'].some((label) => costText.includes(label)))
  const documentApprovedScreenshot = await step('novice-creator', 'capture', 'approved document result', () => walk.snap('resident-document-approved'))
  attachScreenshot(['approved document write persists in the domain owner', 'tool card uses a human-readable action instead of an internal capability id', 'completed document work leaves no active queue rows', 'completed proposal is a receipt without misleading approval controls', 'resident exposes token usage after the real turn', 'resident exposes an explicit cost state instead of hiding spend'], documentApprovedScreenshot)
  const toolChip = resident.locator('[data-agent-tool-chips] button').filter({ hasText: '修改文稿' }).last()
  check('completed tool is represented as a compact inspectable chip', await toolChip.count() === 1)
  if (await toolChip.count()) {
    await toolChip.click()
    check('tool chip expands a human-readable result detail', await resident.locator('[data-agent-tool-detail]').count() === 1 && (await resident.locator('[data-agent-tool-detail]').innerText()).includes('结果'))
    const toolDetailProof = await proveProbe(resident.locator('[data-agent-tool-detail]'), 'tool detail is mounted before collapsing the chip')
    await toolChip.click()
    const toolHeader = resident.locator('[data-agent-tool-header]')
    await toolHeader.click()
    await expectAbsent(resident.locator('[data-agent-tool-detail]'), { provenBy: toolDetailProof, message: 'tool run collapses as one attention-sized group' })
    check('tool run collapses as one attention-sized group', await toolHeader.getAttribute('aria-expanded') === 'false')
    await toolHeader.click()
  }

  const savedAfterDocument = await readProject(win, projectId)
  const hostState = readHostSnapshot(walk.report.tempRoot, savedAfterDocument.immutableProjectUuid, savedAfterDocument.projectGeneration)
  lastHostSnapshot = hostState
  lastDomainSnapshot = savedAfterDocument.payload
  check('Host keeps the user, assistant, proposal and tool items as one persisted history', Boolean(hostState && hostState.items.some((item) => item.kind === 'tool' && item.resultRef)))

  await step('professional-storyboarder', 'switch-surface', 'Generation canvas', async () => {
    await win.locator('nav.nomi-stepper [data-mode="generation"]').click()
    await win.locator('[data-agent-resident][data-agent-surface="generation"]').waitFor({ state: 'visible', timeout: 30_000 })
  })
  // A novice does not speak in tool/schema language. This exact request is a
  // regression guard for the original refusal: it must become an image card,
  // then follow the same approval and existing composer path as every other
  // generated image.
  const generationResident = win.locator('[data-agent-resident][data-agent-surface="generation"]')
  const catToolId = 'resident-cat-avatar-create-1'
  const catPreviewToolId = 'resident-cat-avatar-preview-1'
  const catGateToolId = 'resident-cat-avatar-gate-1'
  let catOperationId = ''
  const operationIdFromToolResult = (body) => {
    for (const message of body.messages || []) {
      if (message?.role !== 'tool' || typeof message.content !== 'string') continue
      try {
        const value = JSON.parse(message.content)
        if (typeof value?.operation?.operationId === 'string') return value.operation.operationId
        if (typeof value?.operationId === 'string') return value.operationId
      } catch { /* non-JSON tool text is not an operation receipt */ }
    }
    return ''
  }
  const catRequest = walk.fixture.expectText({
    label: 'resident natural image generation intent',
    match: (body) => flattenRequestText(body).includes('帮我生成一个小猫头像') && !body.messages?.some((message) => message.role === 'tool'),
    reply: { type: 'tool', id: catToolId, name: 'nomi_operation_create', args: {
      prompt: '一只可爱的橘色小猫头像，柔和光线，居中构图。', taskKind: 'text_to_image', providerId: 'apimart', modelId: APIMART_SEMANTIC_MODEL, mode: 'text_to_image',
    } },
  })
  const catPreview = walk.fixture.expectText({
    label: 'resident natural image preview intent',
    match: (body) => body.messages?.some((message) => message.role === 'tool' && message.tool_call_id === catToolId),
    reply: (body) => {
      catOperationId = operationIdFromToolResult(body)
      if (!catOperationId) throw new Error('semantic create result did not expose an operation id')
      return { type: 'tool', id: catPreviewToolId, name: 'nomi_preview_execution', args: { operationId: catOperationId } }
    },
  })
  const catGate = walk.fixture.expectText({
    label: 'resident natural image generation gate intent',
    match: (body) => body.messages?.some((message) => message.role === 'tool' && message.tool_call_id === catPreviewToolId),
    reply: (body) => {
      catOperationId = operationIdFromToolResult(body) || catOperationId
      if (!catOperationId) throw new Error('semantic preview result did not retain an operation id')
      return { type: 'tool', id: catGateToolId, name: 'nomi_request_generation_gate', args: { operationId: catOperationId } }
    },
  })
  const catFollowup = walk.fixture.expectText({
    label: 'resident natural image generation receipt',
    match: (body) => body.messages?.some((message) => message.role === 'tool' && message.tool_call_id === catGateToolId),
    reply: { type: 'text', text: '小猫头像已开始生成，结果会回到当前项目。' },
  })
  // SpendConfirmDialog is mounted once at the app root so the same gate can
  // serve Creation, Generation and Preview. Scope to the page rather than the
  // resident shell; otherwise a real gate would be invisible to this walk.
  const catGateCard = win.locator('div.fixed.inset-0').filter({ hasText: /允许 Nomi 生成这一镜/ }).last()
  await step('novice-creator', 'request-natural-image', 'resident composer', async () => {
    await generationResident.locator('[data-agent-composer] textarea').fill('帮我生成一个小猫头像')
    await clickOrFail(generationResident.locator('[data-agent-send]'), '发送小猫头像任务')
  })
  await recorded(catRequest.received, 'resident natural image generation request')
  check('natural image request is not rejected as answer-only chat', !(await generationResident.innerText()).includes('无法生成') && !(await generationResident.innerText()).includes('不能生成'))
  await recorded(catPreview.received, 'resident semantic image preview request')
  await recorded(catGate.received, 'resident semantic image gate request')
  await catGateCard.waitFor({ state: 'visible', timeout: 30_000 })
  await step('novice-creator', 'approve-natural-image', 'resident generation gate', () => clickOrFail(catGateCard.getByRole('button', { name: '确认生成', exact: true }), '确认生成小猫头像'))
  await recorded(catFollowup.received, 'resident natural image generation receipt')
  await expect(generationResident).toContainText('小猫头像已开始生成')
  await expect.poll(async () => (await readProject(win, projectId)).payload.generationCanvas.nodes.some((node) => node.kind === 'image' && (node.title === '小猫头像' || node.result?.url))).toBe(true)
  check('semantic image observes the accepted provider task before materializing', walk.fixture.taskQueries.some((record) => record.path.startsWith('/v1/tasks/')))
  const catScreenshot = await step('novice-creator', 'capture', 'natural image result', () => walk.snap('resident-natural-image-result'))
  attachScreenshot('natural image request is not rejected as answer-only chat', catScreenshot)
  // Keep the cat task's receipt/assertion above, then isolate the subsequent
  // reference-node generation counters so each user submission is counted once.
  walk.fixture.images.length = 0

  const canvasToolId = 'resident-canvas-create-1'
  const canvasRequest = walk.fixture.expectText({
    label: 'resident canvas node proposal with reference edge',
    match: (body) => flattenRequestText(body).includes('请创建两个镜头卡') && !body.messages?.some((message) => message.role === 'tool'),
    reply: { type: 'tool', id: canvasToolId, name: 'create_canvas_nodes', args: {
      summary: '两个镜头卡和一条 reference 关系。',
      nodes: [
        { clientId: 'resident-source', kind: 'image', title: '清晨咖啡馆广角', prompt: '清晨咖啡馆，红色杯子，广角。', modelKey: 'agent-runtime-image', modeId: 't2i', params: { size: '1024x1024' } },
        { clientId: 'resident-target', kind: 'video', title: '杯沿推近', prompt: '同一只红色杯子，缓慢推近。', modelKey: FIXTURE_VIDEO_MODEL, modeId: 't2v', params: { aspect_ratio: '16:9', resolution: '720p', duration: 5 } },
      ],
      edges: [{ sourceClientId: 'resident-source', targetClientId: 'resident-target', mode: 'reference' }],
    } },
  })
  const canvasFollowup = walk.fixture.expectText({
    label: 'resident canvas receipt returns to the model',
    match: (body) => body.messages?.some((message) => message.role === 'tool' && message.tool_call_id === canvasToolId),
    reply: { type: 'text', text: '两个镜头卡已落到画布，reference 关系也已保留。' },
  })
  await step('professional-storyboarder', 'send-canvas-request', 'resident composer', async () => {
    await generationResident.locator('[data-agent-composer] textarea').fill('请创建两个镜头卡，并把第一个作为第二个的 reference；只建卡和连线，不要生成。')
    await clickOrFail(generationResident.locator('[data-agent-send]'), '发送画布建卡任务')
  })
  await recorded(canvasRequest.received, 'resident canvas request')
  const canvasApproval = generationResident.locator('[data-agent-item-kind="approval"]').filter({ hasText: '创建或修改镜头卡' }).last()
  await canvasApproval.waitFor({ state: 'visible', timeout: 30_000 })
  const canvasQueueProof = await proveProbe(
    generationResident.locator('[data-agent-queue]'),
    'Host queue section is mounted while canvas work awaits approval',
  )
  const beforeCanvas = (await readProject(win, projectId)).payload.generationCanvas
  expect(beforeCanvas.edges).toHaveLength(0)
  check('canvas keeps the previously approved natural image card while the next proposal is pending', beforeCanvas.nodes.length === 1)
  const canvasPendingText = await canvasApproval.innerText()
  check('canvas generation proposal uses the compact PR194 card contract', await canvasApproval.getAttribute('data-agent-approval-variant') === 'generation' && await canvasApproval.locator('[data-agent-batch-stack][data-agent-batch-count="2"]').count() === 1 && !canvasPendingText.includes('agent-runtime-image'))
  const canvasPendingScreenshot = await step('budget-sensitive-user', 'capture', 'canvas approval summary', () => walk.snap('resident-canvas-approval-summary'))
  attachScreenshot('canvas approval keeps the user-facing decision in the first layer', canvasPendingScreenshot)
  const proposalEditor = canvasApproval.locator('[data-agent-proposal-editor]')
  check('canvas approval mounts the generation parameter editor', await proposalEditor.count() === 1)
  check('generation proposal keeps one active prompt and canonical control bar in the first decision surface', await proposalEditor.locator('[data-agent-proposal-prompt]').count() === 1 && await proposalEditor.locator('[data-agent-proposal-parameters]').count() === 1 && await canvasApproval.locator('[data-agent-approval-details]').count() === 0)
  await canvasApproval.scrollIntoViewIfNeeded()
  const imageProposalEditor = proposalEditor.locator('[data-agent-proposal-node="resident-source"]')
  const videoProposalEditor = proposalEditor.locator('[data-agent-proposal-node="resident-target"]')
  await proposalEditor.scrollIntoViewIfNeeded()
  await imageProposalEditor.scrollIntoViewIfNeeded()
  await chooseNomiOption(win, imageProposalEditor, '模型', '备用')
  await openParameterPanel(win, imageProposalEditor)
  await chooseNomiOption(win, imageProposalEditor.locator('[data-agent-parameter-panel="true"]'), '生成方式', '文生图')
  await chooseNomiOption(win, imageProposalEditor.locator('[data-agent-parameter-panel="true"]'), '尺寸', '1536x1024')
  check('approval edits image model, mode and size through the shared NomiSelect contract', (await imageProposalEditor.locator('button[aria-label="模型"]').innerText()).includes('备用') && await imageProposalEditor.locator('[data-agent-generation-mode="true"] button').count() > 0 && (await imageProposalEditor.locator('[data-agent-parameter-control="size"] button').innerText()).includes('1536x1024'))
  const nextPeek = proposalEditor.locator('[data-agent-batch-stack-peek="1"]')
  await nextPeek.waitFor({ state: 'visible', timeout: 15_000 })
  await nextPeek.click()
  await videoProposalEditor.waitFor({ state: 'visible', timeout: 15_000 })
  await chooseNomiOption(win, videoProposalEditor, '模型', '备用')
  await openParameterPanel(win, videoProposalEditor)
  await chooseNomiOption(win, videoProposalEditor.locator('[data-agent-parameter-panel="true"]'), '生成方式', '图生视频')
  await chooseNomiOption(win, videoProposalEditor.locator('[data-agent-parameter-panel="true"]'), '比例', '9:16')
  await chooseNomiOption(win, videoProposalEditor.locator('[data-agent-parameter-panel="true"]'), '清晰度', '1080p')
  await videoProposalEditor.locator('textarea').fill('同一只红色杯子，八秒缓慢推近，保留咖啡馆环境。')
  const durationControl = videoProposalEditor.locator('[data-agent-parameter-control="duration"] [role="slider"]').first()
  if (await durationControl.count()) {
    await durationControl.focus()
    await durationControl.press('Home')
    for (let stepIndex = 0; stepIndex < 4; stepIndex += 1) await durationControl.press('ArrowRight')
  }
  const videoModelLabel = await videoProposalEditor.locator('button[aria-label="模型"]').innerText()
  const videoAspectLabel = await videoProposalEditor.locator('[data-agent-parameter-control="aspect_ratio"] button[aria-checked="true"]').innerText()
  const videoResolutionLabel = await videoProposalEditor.locator('[data-agent-parameter-control="resolution"] button[aria-checked="true"]').innerText()
  const videoPromptValue = await videoProposalEditor.locator('textarea').inputValue()
  check('approval edits video model, mode, prompt and visible generation parameters', videoModelLabel.includes('备用') && await videoProposalEditor.locator('[data-agent-generation-mode="true"] button').count() > 0 && videoAspectLabel.includes('9:16') && videoResolutionLabel.includes('1080p') && videoPromptValue === '同一只红色杯子，八秒缓慢推近，保留咖啡馆环境。' && await durationControl.count() === 1)
  const editedCanvasScreenshot = await step('budget-sensitive-user', 'capture', 'edited canvas approval', () => walk.snap('resident-canvas-approval-edited'))
  attachScreenshot(['approval edits image model, mode and size through the same node contract', 'approval edits video model, mode, prompt and every visible generation parameter'], editedCanvasScreenshot)
  await step('professional-storyboarder', 'approve-canvas-write', 'resident approval card', () => clickOrFail(canvasApproval.locator('[data-agent-action="approve"]'), '批准画布建卡'))
  const canvasResultWire = await recorded(canvasFollowup.received, 'resident canvas result')
  check('approved effective parameters return through the Host tool result', canvasResultWire.body.messages?.some((message) => message.role === 'tool' && message.tool_call_id === canvasToolId))
  await expect.poll(async () => {
    const canvas = (await readProject(win, projectId)).payload.generationCanvas
    return { nodes: canvas.nodes.length, edges: canvas.edges.length }
  }, { timeout: 30_000 }).toEqual({ nodes: 3, edges: 1 })
  const landedCanvas = (await readProject(win, projectId)).payload.generationCanvas
  lastHostSnapshot = readHostSnapshot(walk.report.tempRoot, savedAfterDocument.immutableProjectUuid, savedAfterDocument.projectGeneration)
  lastDomainSnapshot = (await readProject(win, projectId)).payload
  const landedEditedVideo = landedCanvas.nodes.find((node) => node.title === '杯沿推近')
  const landedEditedImage = landedCanvas.nodes.find((node) => node.title === '清晨咖啡馆广角')
  check('approved canvas write persists every edited generation field and the reference edge', landedCanvas.nodes.length === 3 && landedCanvas.edges[0]?.mode === 'reference' && landedEditedImage?.meta?.modelKey === FIXTURE_IMAGE_ALT_MODEL && landedEditedImage?.meta?.size === '1536x1024' && landedEditedVideo?.prompt === '同一只红色杯子，八秒缓慢推近，保留咖啡馆环境。' && landedEditedVideo?.meta?.modelKey === FIXTURE_VIDEO_ALT_MODEL && landedEditedVideo?.meta?.archetype?.modeId === 'i2v' && landedEditedVideo?.meta?.aspect_ratio === '9:16' && landedEditedVideo?.meta?.resolution === '1080p' && landedEditedVideo?.meta?.duration === 8)
  const generationVisibleText = await generationResident.innerText()
  check('canvas approval card exposes the shot-card action and hides raw ids', generationVisibleText.includes('创建或修改镜头卡') && !generationVisibleText.includes('create_canvas_nodes') && !generationVisibleText.includes('result-'))
  await expectAbsent(generationResident.locator('[data-agent-queue-item]'), { provenBy: canvasQueueProof, message: 'canvas completion leaves only active queue work visible' })
  check('canvas completion leaves only active queue work visible', true)
  const canvasApprovedScreenshot = await step('professional-storyboarder', 'capture', 'canvas result', () => walk.snap('resident-canvas-committed'))
  attachScreenshot(['approved canvas write persists both nodes and the reference edge', 'canvas approval card exposes the shot-card action and hides raw ids', 'canvas completion leaves only active queue work visible'], canvasApprovedScreenshot)

  // The Host only plans and commits nodes. Generation itself remains a user-facing
  // composer action so every paid-capable run crosses the same spend confirmation,
  // catalog mapping and domain result materializer as production.
  const sourceNode = landedCanvas.nodes.find((node) => node.title === '清晨咖啡馆广角')
  const targetNode = landedCanvas.nodes.find((node) => node.title === '杯沿推近')
  if (!sourceNode || !targetNode) throw new Error('Expected the approved canvas to contain image and video nodes')

  const imageNode = await step('budget-sensitive-user', 'select-image-node', 'image composer', () => selectCanvasNode(win, sourceNode.id, 'image'))
  const imageGenerate = imageNode.locator('button[aria-label="生成素材"]')
  await imageGenerate.waitFor({ state: 'visible', timeout: 30_000 })
  expect(walk.fixture.images).toHaveLength(0)
  check('image generation is idle before the user submits it', await imageNode.getAttribute('data-status') !== 'success')
  await step('budget-sensitive-user', 'submit-image-generation', 'image composer', () => clickOrFail(imageGenerate, '提交图片生成'))
  await approveGenerationSpend(win, '图片生成')
  await expect(imageNode).toHaveAttribute('data-status', 'success', { timeout: 30_000 })
  const imageGenerationProject = await readProject(win, projectId)
  const persistedImageNode = imageGenerationProject.payload.generationCanvas.nodes.find((node) => node.id === sourceNode.id)
  check('real image generation calls the loopback catalog endpoint with the approved model and size', walk.fixture.images.length === 1 && walk.fixture.images[0]?.path === '/v1/images/generations' && walk.fixture.images[0]?.body?.model === FIXTURE_IMAGE_ALT_MODEL && walk.fixture.images[0]?.body?.size === '1536x1024')
  check('image result is materialized back into the canvas domain owner', persistedImageNode?.status === 'success' && persistedImageNode.result?.type === 'image' && Boolean(persistedImageNode.result.url))
  const imageScreenshot = await step('budget-sensitive-user', 'capture', 'image generated', () => walk.snap('resident-image-generated'))
  attachScreenshot(['real image generation calls the loopback catalog endpoint with the approved model and size', 'image result is materialized back into the canvas domain owner'], imageScreenshot)

  const videoNode = await step('professional-storyboarder', 'select-video-node', 'video composer', () => selectCanvasNode(win, targetNode.id, 'video'))
  const videoGenerate = videoNode.locator('button[aria-label="生成素材"]')
  await videoGenerate.waitFor({ state: 'visible', timeout: 30_000 })
  expect(walk.fixture.videos).toHaveLength(0)
  check('video generation waits for the generated reference instead of submitting early', await videoNode.getAttribute('data-status') !== 'success')
  await step('professional-storyboarder', 'submit-video-generation', 'video composer', () => clickOrFail(videoGenerate, '提交视频生成'))
  await approveGenerationSpend(win, '视频生成')
  await expect(videoNode).toHaveAttribute('data-status', 'success', { timeout: 30_000 })
  const videoGenerationProject = await readProject(win, projectId)
  const persistedVideoNode = videoGenerationProject.payload.generationCanvas.nodes.find((node) => node.id === targetNode.id)
  const videoRequest = walk.fixture.videos[0]
  const videoBody = videoRequest?.body ?? {}
  check('real video generation calls the catalog video endpoint once', walk.fixture.videos.length === 1 && videoRequest?.path === '/v1/videos')
  check('video request carries every approved model, mode-derived parameter and generated image reference', videoBody.model === FIXTURE_VIDEO_ALT_MODEL && videoBody.prompt === '同一只红色杯子，八秒缓慢推近，保留咖啡馆环境。' && videoBody.aspect_ratio === '9:16' && videoBody.resolution === '1080p' && videoBody.duration === 8 && typeof videoBody.image === 'string' && videoBody.image.length > 0)
  check('video result is materialized as a playable domain asset', persistedVideoNode?.status === 'success' && persistedVideoNode.result?.type === 'video' && Boolean(persistedVideoNode.result.url))
  const videoScreenshot = await step('professional-storyboarder', 'capture', 'video generated', () => walk.snap('resident-video-generated'))
  attachScreenshot(['real video generation calls the catalog video endpoint once', 'video request carries every approved model, mode-derived parameter and generated image reference', 'video result is materialized as a playable domain asset'], videoScreenshot)

  // Text generation is also exercised through a real text node and the streaming
  // /v1/chat/completions path, rather than treating the Host's assistant reply as
  // a substitute for a generated canvas artifact.
  const textCreateToolId = 'resident-text-create-1'
  const textCreateRequest = walk.fixture.expectText({
    label: 'resident text node proposal',
    match: (body) => flattenRequestText(body).includes('请创建一个文本节点') && !body.messages?.some((message) => message.role === 'tool'),
    reply: { type: 'tool', id: textCreateToolId, name: 'create_canvas_nodes', args: {
      summary: '一个可生成的文本卡。',
      nodes: [{ clientId: 'resident-text', kind: 'text', title: '片头文案', prompt: '为这段视频写一句简洁片头文案。', modelKey: FIXTURE_TEXT_MODEL }],
    } },
  })
  const textCreateFollowup = walk.fixture.expectText({
    label: 'resident text node receipt',
    match: (body) => body.messages?.some((message) => message.role === 'tool' && message.tool_call_id === textCreateToolId),
    reply: { type: 'text', text: '文本卡已创建。' },
  })
  await step('novice-creator', 'request-text-node', 'resident composer', async () => {
    await generationResident.locator('[data-agent-composer] textarea').fill('请创建一个文本节点，准备生成片头文案。')
    await clickOrFail(generationResident.locator('[data-agent-send]'), '发送文本建卡任务')
  })
  await recorded(textCreateRequest.received, 'resident text node proposal')
  const textApproval = generationResident.locator('[data-agent-item-kind="approval"]').filter({ hasText: '创建或修改镜头卡' }).last()
  await textApproval.waitFor({ state: 'visible', timeout: 30_000 })
  await step('novice-creator', 'approve-text-node', 'resident approval card', () => clickOrFail(textApproval.locator('[data-agent-action="approve"]'), '批准文本建卡'))
  await recorded(textCreateFollowup.received, 'resident text node follow-up')
  await expect(generationResident).toContainText('文本卡已创建')
  await expect.poll(async () => {
    const canvas = (await readProject(win, projectId)).payload.generationCanvas
    return canvas.nodes.some((node) => node.kind === 'text' && node.title === '片头文案')
  }, { timeout: 30_000 }).toBe(true)
  const canvasWithText = await readProject(win, projectId)
  const textNode = canvasWithText.payload.generationCanvas.nodes.find((node) => node.kind === 'text' && node.title === '片头文案')
  if (!textNode) throw new Error('Approved text node was not persisted')
  const textNodeView = await step('novice-creator', 'select-text-node', 'text composer', () => selectCanvasNode(win, textNode.id, 'text'))
  const textGenerate = textNodeView.locator('button[aria-label="生成素材"]')
  await textGenerate.waitFor({ state: 'visible', timeout: 30_000 })
  const generatedText = '真实文本生成回执：镜头从安静准备开始。'
  const textGeneration = walk.fixture.expectText({
    label: 'resident text generation request',
    match: (body) => body.model === FIXTURE_TEXT_MODEL && flattenRequestText(body).includes('片头文案') && !body.messages?.some((message) => message.role === 'tool'),
    reply: { type: 'text', text: generatedText },
  })
  check('text node generation is idle before the user submits it', walk.fixture.requests.length > 0 && await textNodeView.getAttribute('data-status') !== 'success')
  await step('novice-creator', 'submit-text-generation', 'text composer', () => clickOrFail(textGenerate, '提交文本生成'))
  await approveGenerationSpend(win, '文本生成')
  await recorded(textGeneration.received, 'resident text generation request')
  await expect(textNodeView).toHaveAttribute('data-status', 'success', { timeout: 30_000 })
  const textGenerationProject = await readProject(win, projectId)
  const persistedTextNode = textGenerationProject.payload.generationCanvas.nodes.find((node) => node.id === textNode.id)
  const textContent = JSON.stringify(persistedTextNode?.contentJson ?? {})
  check('real text generation uses the selected text model stream', walk.fixture.requests.some((record) => record.body?.model === FIXTURE_TEXT_MODEL && flattenRequestText(record.body).includes('片头文案')))
  check('text result is written into the text node domain owner', persistedTextNode?.status === 'success' && persistedTextNode.result?.type === 'text' && persistedTextNode.result.text?.includes(generatedText) && textContent.includes(generatedText))
  const textScreenshot = await step('novice-creator', 'capture', 'text generated', () => walk.snap('resident-text-generated'))
  attachScreenshot(['real text generation uses the selected text model stream', 'text result is written into the text node domain owner'], textScreenshot)

  // Settings contract: create a fresh image card without a modelKey. The
  // renderer must load the persisted task default and write the resolved
  // vendor/model identity into the node before the user opens its controls.
  const defaultImageToolId = 'resident-default-image-create-1'
  const defaultImageRequest = walk.fixture.expectText({
    label: 'resident default image node proposal',
    match: (body) => flattenRequestText(body).includes('使用设置默认图片模型') && !body.messages?.some((message) => message.role === 'tool'),
    reply: { type: 'tool', id: defaultImageToolId, name: 'create_canvas_nodes', args: {
      summary: '一张使用默认图片模型的卡。',
      nodes: [{ clientId: 'resident-default-image', kind: 'image', title: '默认图片模型卡', prompt: '默认模型验收，不提交生成。' }],
    } },
  })
  const defaultImageFollowup = walk.fixture.expectText({
    label: 'resident default image node receipt',
    match: (body) => body.messages?.some((message) => message.role === 'tool' && message.tool_call_id === defaultImageToolId),
    reply: { type: 'text', text: '图片卡已创建，将使用设置中的默认模型。' },
  })
  await step('budget-sensitive-user', 'request-default-image-node', 'resident composer', async () => {
    await generationResident.locator('[data-agent-composer] textarea').fill('请创建一张使用设置默认图片模型的图片卡，不要生成。')
    await clickOrFail(generationResident.locator('[data-agent-send]'), '发送默认图片模型建卡任务')
  })
  await recorded(defaultImageRequest.received, 'resident default image node proposal')
  const defaultImageApproval = generationResident.locator('[data-agent-item-kind="approval"]').filter({ hasText: '创建或修改镜头卡' }).last()
  await defaultImageApproval.waitFor({ state: 'visible', timeout: 30_000 })
  await step('budget-sensitive-user', 'approve-default-image-node', 'resident approval card', () => clickOrFail(defaultImageApproval.locator('[data-agent-action="approve"]'), '批准默认图片模型建卡'))
  await recorded(defaultImageFollowup.received, 'resident default image node follow-up')
  await expect.poll(async () => {
    const canvas = (await readProject(win, projectId)).payload.generationCanvas
    const node = canvas.nodes.find((candidate) => candidate.kind === 'image' && candidate.title === '默认图片模型卡')
    return node?.meta?.modelKey ?? ''
  }, { timeout: 30_000 }).toBe('agent-runtime-image')
  const defaultImageProject = await readProject(win, projectId)
  const defaultImageNode = defaultImageProject.payload.generationCanvas.nodes.find((candidate) => candidate.kind === 'image' && candidate.title === '默认图片模型卡')
  if (!defaultImageNode) throw new Error('Default image node was not persisted')
  check('new image card inherits the configured default model identity', defaultImageNode.meta?.modelKey === 'agent-runtime-image' && defaultImageNode.meta?.modelVendor === FIXTURE_VENDOR)
  const defaultImageView = await step('budget-sensitive-user', 'select-default-image-node', 'existing image composer', () => selectCanvasNode(win, defaultImageNode.id, 'default image'))
  const defaultModelTrigger = defaultImageView.locator('[aria-label="模型"]')
  await defaultModelTrigger.waitFor({ state: 'visible', timeout: 30_000 })
  check('existing image composer exposes the configured model control', (await defaultModelTrigger.innerText()).includes('Fixture 图片') || (await defaultModelTrigger.innerText()).includes('agent-runtime-image'))
  const defaultParameterTrigger = defaultImageView.locator('[aria-label="生成参数"]')
  check('existing image composer exposes its parameter control', await defaultParameterTrigger.count() === 1)
  const defaultImageScreenshot = await step('budget-sensitive-user', 'capture', 'default image model controls', () => walk.snap('resident-default-image-controls'))
  attachScreenshot(['new image card inherits the configured default model identity', 'existing image composer exposes the configured model control', 'existing image composer exposes its parameter control'], defaultImageScreenshot)

  const composerGeometry = await win.evaluate(() => {
    const composer = document.querySelector('.generation-canvas-v2-node__composer-card')
    const anchor = document.querySelector('.generation-canvas-v2-node__composer')
    const node = anchor?.parentElement
    const stage = document.querySelector('.generation-canvas-v2__stage')
    const timeline = document.querySelector('.workbench-generation__timeline')
    if (!composer || !stage || !timeline || !anchor || !node) return { missing: { composer: !composer, stage: !stage, timeline: !timeline, anchor: !anchor, node: !node } }
    const rect = composer.getBoundingClientRect(); const timelineRect = timeline.getBoundingClientRect(); const nodeRect = node.getBoundingClientRect(); const anchorRect = anchor.getBoundingClientRect()
    return { composer: { top: rect.top, bottom: rect.bottom, height: rect.height }, anchor: { top: anchorRect.top, bottom: anchorRect.bottom, height: anchorRect.height }, node: { top: nodeRect.top, bottom: nodeRect.bottom, height: nodeRect.height }, timeline: { top: timelineRect.top }, flip: anchor.getAttribute('data-flipped') }
  })
  check('generation composer remains reachable above the timeline', Boolean(composerGeometry && 'composer' in composerGeometry && composerGeometry.composer.bottom <= composerGeometry.timeline.top + 1))

  const canvasBeforeDeny = (await readProject(win, projectId)).payload.generationCanvas
  const denyToolId = 'resident-canvas-delete-denied-1'
  const denyRequest = walk.fixture.expectText({
    label: 'resident denied canvas mutation',
    match: (body) => flattenRequestText(body).includes('请删除第一个镜头卡') && !body.messages?.some((message) => message.role === 'tool'),
    reply: { type: 'tool', id: denyToolId, name: 'delete_canvas_nodes', args: { nodeIds: ['resident-source'] } },
  })
  const denyFollowup = walk.fixture.expectText({
    label: 'resident denied canvas result',
    match: (body) => body.messages?.some((message) => message.role === 'tool' && message.tool_call_id === denyToolId),
    reply: { type: 'text', text: '已拒绝删除，两个镜头卡仍保留。' },
  })
  await step('failure-recovery-user', 'request-dangerous-change', 'resident composer', async () => {
    await generationResident.locator('[data-agent-composer] textarea').fill('请删除第一个镜头卡，但先让我确认。')
    await clickOrFail(generationResident.locator('[data-agent-send]'), '发送删除镜头卡任务')
  })
  await recorded(denyRequest.received, 'resident denied canvas request')
  const denyApproval = generationResident.locator('[data-agent-item-kind="approval"]').filter({ hasText: '删除镜头卡' }).last()
  await denyApproval.waitFor({ state: 'visible', timeout: 30_000 })
  const denyPendingScreenshot = await step('failure-recovery-user', 'capture', 'deny approval pending', () => walk.snap('resident-canvas-deny-pending'))
  check('dangerous action is named before the user decides', (await denyApproval.innerText()).includes('删除镜头卡'))
  attachScreenshot('dangerous action is named before the user decides', denyPendingScreenshot)
  await step('failure-recovery-user', 'deny-tool', 'resident approval card', () => clickOrFail(denyApproval.locator('[data-agent-action="deny"]'), '拒绝删除镜头卡'))
  await recorded(denyFollowup.received, 'resident denied canvas follow-up')
  await expect(generationResident).toContainText('已拒绝删除')
  const afterDenyCanvas = (await readProject(win, projectId)).payload.generationCanvas
  check('denied canvas mutation leaves domain state unchanged', JSON.stringify(afterDenyCanvas) === JSON.stringify(canvasBeforeDeny))
  const deniedCardText = await generationResident.locator('[data-agent-turn-id]').filter({ hasText: '已取消' }).last().innerText().catch(() => '')
  const deniedTurn = generationResident.locator('[data-agent-turn-id]').filter({ hasText: '已取消' }).last()
  const deniedTurnProof = await proveProbe(deniedTurn, 'denied turn receipt is mounted before retry-control check')
  await expectAbsent(deniedTurn.locator('[data-agent-action="retry"], [data-agent-action="edit-prompt"]'), { provenBy: deniedTurnProof, message: 'denied operation is a neutral receipt without retry actions' })
  check('denied operation is a neutral receipt without retry actions', deniedCardText.includes('已取消'))
  const denyScreenshot = await step('failure-recovery-user', 'capture', 'denied canvas result', () => walk.snap('resident-canvas-denied'))
  attachScreenshot(['denied canvas mutation leaves domain state unchanged', 'denied operation is a neutral receipt without retry actions'], denyScreenshot)

  // Evidence must be read after the denied turn settles; a pre-deny snapshot
  // would falsely claim that Host history covers the rejection path.
  const deniedProject = await readProject(win, projectId)
  lastHostSnapshot = readHostSnapshot(walk.report.tempRoot, deniedProject.immutableProjectUuid, deniedProject.projectGeneration)
  lastDomainSnapshot = deniedProject.payload
  const deniedHostItems = lastHostSnapshot?.items?.filter((item) => item.turnId && item.turnId === lastHostSnapshot.turns?.at(-1)?.turnId) ?? []
  check('Host persists the denied decision as declined, without a retryable runtime failure', deniedHostItems.some((item) => item.kind === 'failure' && item.status === 'declined' && item.code === 'capability_declined') && !deniedHostItems.some((item) => item.kind === 'failure' && item.status === 'failed' && item.retryable))
  attachScreenshot('Host persists the denied decision as declined, without a retryable runtime failure', denyScreenshot)

  const finalHostPath = path.join(walk.outputDir, 'evidence-host-final.json')
  const finalDomainPath = path.join(walk.outputDir, 'evidence-domain-final.json')
  fs.writeFileSync(finalHostPath, JSON.stringify(lastHostSnapshot, null, 2))
  fs.writeFileSync(finalDomainPath, JSON.stringify(lastDomainSnapshot, null, 2))
  check('all media requests stayed inside the zero-quota loopback fixture', walk.report.paidCalls === 0 && walk.fixture.images.length === 1 && walk.fixture.videos.length === 1)
  check('real-user journey stays free of renderer errors', rendererErrors.length === 0, rendererErrors.slice(0, 2).join(' | '))
  lastScreenshot = walk.report.screenshots.at(-1) ?? lastScreenshot
  for (const assertion of assertions) {
    assertion.screenshot ||= lastScreenshot
    assertion.hostSnapshot = finalHostPath
    assertion.domainSnapshot = finalDomainPath
  }
  walk.report.trace = trace
  walk.report.failures = failures
  walk.report.assertions = assertions
  walk.report.verified = [
    'resident-natural-language-response',
    'resident-selected-prompt',
    'resident-selected-skill',
    'resident-document-approval-persistence',
    'resident-host-history-persistence',
    'resident-canvas-reference-write',
    'resident-canvas-deny-persistence',
    'resident-image-generation',
    'resident-video-generation',
    'resident-text-generation',
    'resident-natural-image-intent',
    'zero-quota',
  ]
  if (failures.length) throw new Error(`Real-user acceptance assertions failed: ${failures.join('; ')}`)
  walk.fixture.assertClean()
} catch (error) {
  failure = error
  if (rendererErrors.length) console.error('Renderer diagnostics:', rendererErrors.slice(0, 5).join(' | '))
  process.exitCode = 1
} finally {
  fs.writeFileSync(path.join(traceDir, 'trace.json'), JSON.stringify(trace, null, 2))
  fs.writeFileSync(path.join(walk.outputDir, 'assertions.json'), JSON.stringify(assertions, null, 2))
  await walk.finish(failure)
}
