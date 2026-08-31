// Semantic ProductionRun journey over the real Electron + MCP transport.
//
// This is intentionally a small, focused no-cost acceptance test.  It does not
// call a paid provider: an isolated APIMart catalog points at a loopback server
// that returns one real, decodable MP4 per shot.  The path under test remains
// production code (catalog -> semantic operation -> receipt gate -> provider
// adapter -> materializer -> ProductionRun QA/assembly/export); the loopback is
// only the provider boundary.  A legacy production.* writer is never invoked.
//
// The user-visible contract proved here is the one users actually care about:
// a natural multi-shot plan can be reviewed once, each generated result is
// durable, QA and timeline assembly run, the rough-cut and export approvals are
// separate, and the final MP4 is playable.  No assertion treats narration text
// as state; MCP projections are read from structuredContent only.

import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { launchNomiApp } from './_launchApp.mjs'
import {
  makeIsolatedDirs,
  parseToolResult,
  repoRoot,
  spawnMcpStdioClient,
  writeIsolatedCatalog,
} from './_mcpJourney.mjs'

const require = createRequire(import.meta.url)
const shotsDir = path.join(repoRoot, 'tests/ux/shots/production-mcp')
const dirs = makeIsolatedDirs('nomi-production-semantic-e2e-')

fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

let passed = 0
const check = (condition, label) => {
  if (!condition) throw new Error(`PRODUCTION MCP E2E FAIL: ${label}`)
  passed += 1
  console.log(`  ✓ ${label}`)
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function signMcpClientProof(token, client) {
  return crypto.createHmac('sha256', token).update(`nomi-mcp-client:v1:${client}`).digest('base64url')
}

/** Generate one small but valid H.264/AAC file for every loopback task. */
function fixtureVideoDataUrl() {
  const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
  const output = path.join(dirs.tempRoot, 'provider-fixture.mp4')
  execFileSync(ffmpegPath, [
    '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '1',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', '-movflags', '+faststart', output,
  ], { stdio: 'ignore' })
  return `data:video/mp4;base64,${fs.readFileSync(output).toString('base64')}`
}

/**
 * APIMart-shaped loopback.  POST is the only submission endpoint and GET is
 * the only observation endpoint.  Recording the full JSON body lets the test
 * verify the semantic model/mode/parameters actually crossed the adapter.
 */
async function startLoopbackApimart(videoUrl) {
  const hits = []
  const tasks = new Map()
  const submittedTaskIds = []
  const queriedTaskIds = []
  let sequence = 0
  const server = http.createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      let parsed = null
      try { parsed = body ? JSON.parse(body) : null } catch { parsed = null }
      hits.push({ method: request.method, url: request.url, body: parsed })

      // The first half of this journey runs the canonical provider
      // certification against the generic OpenAI-compatible video contract
      // (`/v1/video/generations`).  The production half then uses the curated
      // APIMart contract (`/v1/videos/generations`).  Supporting both routes
      // here keeps the fixture honest: certification really observes a media
      // result, while the semantic run still proves APIMart's shipped wire.
      if (request.method === 'POST' && (request.url === '/v1/video/generations' || request.url === '/v1/videos/generations')) {
        sequence += 1
        const taskId = `fixture-video-task-${sequence}`
        tasks.set(taskId, true)
        submittedTaskIds.push(taskId)
        const payload = request.url === '/v1/video/generations'
          ? JSON.stringify({ task_id: taskId, status: 'processing' })
          : JSON.stringify({ code: 200, data: [{ task_id: taskId }] })
        response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
        response.end(payload)
        return
      }

      const apimartTaskMatch = typeof request.url === 'string' && request.url.match(/^\/v1\/tasks\/([^/]+)$/)
      const genericTaskMatch = typeof request.url === 'string' && request.url.match(/^\/v1\/video\/generations\/([^/]+)$/)
      if (request.method === 'GET' && (apimartTaskMatch || genericTaskMatch)) {
        const taskMatch = apimartTaskMatch || genericTaskMatch
        const taskId = decodeURIComponent(taskMatch[1])
        if (!tasks.has(taskId)) {
          response.writeHead(404, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ code: 404, message: 'unknown fixture task' }))
          return
        }
        queriedTaskIds.push(taskId)
        const payload = apimartTaskMatch
          ? JSON.stringify({
              code: 200,
              data: {
                status: 'succeeded',
                result: { videos: [{ id: `${taskId}-output`, url: videoUrl, file_name: 'fixture.mp4' }] },
              },
            })
          : JSON.stringify({ task_id: taskId, status: 'succeeded', data: [{ url: videoUrl }] })
        response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
        response.end(payload)
        return
      }

      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ code: 404, message: 'unsupported fixture route' }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  return {
    origin: `http://127.0.0.1:${port}`,
    hits,
    submittedTaskIds,
    queriedTaskIds,
    reset: () => {
      hits.length = 0
      submittedTaskIds.length = 0
      queriedTaskIds.length = 0
      tasks.clear()
      sequence = 0
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

/**
 * The fixture deliberately starts as an *unpublished* APIMart connection.
 * This lets the real renderer setting write an encrypted-but-disabled key and
 * the canonical certification IPC promote that exact credential.  We avoid
 * pre-seeding `enc: plain` or an enabled media row: doing either would make a
 * test pass through a path production correctly rejects.
 */
function fixtureVendorKey(origin) {
  const parsed = new URL(origin)
  const host = parsed.hostname.toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return `local-${parsed.port || '80'}`
  return host.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
}

function configureIsolatedCatalog(origin) {
  writeIsolatedCatalog(dirs.settingsDir, origin)
  const catalogPath = path.join(dirs.settingsDir, 'model-catalog.json')
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  const now = new Date().toISOString()
  const sourceVendorKey = fixtureVendorKey(origin)
  const seededVendor = catalog.vendors.find((item) => item.key === 'apimart')
  if (!seededVendor) throw new Error('isolated catalog lost APIMart vendor')

  // Remove the shared helper's APIMart rows.  A published predecessor would
  // cause staged identity isolation and the certification would no longer
  // exercise the first-time Settings → certify path we intend to prove.
  catalog.vendors = catalog.vendors.filter((item) => item.key !== 'apimart')
  catalog.models = catalog.models.filter((item) => item.vendorKey !== 'apimart')
  catalog.mappings = catalog.mappings.filter((item) => item.vendorKey !== 'apimart')
  delete catalog.apiKeysByVendor.apimart

  catalog.vendors.push({
    ...seededVendor,
    key: sourceVendorKey,
    name: 'APIMart Fixture (certification)',
    enabled: false,
    baseUrlHint: origin,
    authType: 'bearer',
    authHeader: 'Authorization',
    providerKind: 'openai-compatible',
    createdAt: seededVendor.createdAt || now,
    updatedAt: now,
  })

  // Keep the fixture's catalog identity outside the curated APIMart namespace.
  // The app intentionally re-seeds built-in rows on startup; reusing a curated
  // key would leave two rows and the resolver would (correctly) pick the first
  // unpriced built-in row.  The alias still mirrors Seedance's approved Fast
  // transport model, so the real archetype can select that wire id.
  const modelKey = 'nomi-fixture-seedance-2.0'
  catalog.models.push({
    modelKey,
    vendorKey: sourceVendorKey,
    labelZh: 'Seedance Fixture',
    kind: 'video',
    modelAlias: 'doubao-seedance-2.0-fast',
    enabled: false,
    meta: { adapter: { state: 'unverified', modes: [] } },
    pricing: { cost: 0, enabled: true, specCosts: [] },
    createdAt: now,
    updatedAt: now,
  })
  fs.writeFileSync(catalogPath, JSON.stringify(catalog), 'utf8')
  return { modelKey, sourceVendorKey }
}

/**
 * After certification succeeds, retain its adapter evidence but install the
 * curated APIMart transport row used by the semantic generation path.  This is
 * an isolated fixture-only catalog migration; production never rewrites a
 * vendor key or promotes a mapping from the renderer.
 */
function installCertifiedApimartCatalog(sourceVendorKey, modelKey) {
  const catalogPath = path.join(dirs.settingsDir, 'model-catalog.json')
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  const now = new Date().toISOString()
  const vendor = catalog.vendors.find((item) => item.key === sourceVendorKey)
  const model = catalog.models.find((item) => item.vendorKey === sourceVendorKey && item.modelKey === modelKey)
  const credential = catalog.apiKeysByVendor[sourceVendorKey]
  if (!vendor || !model) throw new Error('certification fixture lost its staged APIMart vendor/model')
  if (!credential || credential.enc !== 'safeStorage' || credential.enabled !== true) {
    throw new Error('certification did not promote an enabled safeStorage credential')
  }

  // Certification metadata belongs to the staged source vendor.  The
  // semantic half deliberately installs the *built-in* APIMart direct-key
  // row, so carrying an `adapter` marker across would make the production
  // bootstrap (correctly) fail closed as a certification-owned takeover.
  // Keep the built-in vendor scope intact; the test-only loopback origin is
  // supplied through the guarded provider connection override below.
  const seededApimartVendor = catalog.vendors.find((item) => item.key === 'apimart')
  const vendorWithoutMeta = { ...(seededApimartVendor || vendor) }
  delete vendorWithoutMeta.meta
  const apimartVendor = {
    ...vendorWithoutMeta,
    key: 'apimart',
    name: 'APIMart',
    enabled: true,
    baseUrlHint: 'https://api.apimart.ai',
    updatedAt: now,
  }
  const targetModelKey = 'doubao-seedance-2.0'
  const seededApimartModel = catalog.models.find((item) => item.vendorKey === 'apimart' && item.modelKey === targetModelKey)
  const modelWithoutMeta = { ...(seededApimartModel || model) }
  delete modelWithoutMeta.meta
  const apimartModel = {
    ...modelWithoutMeta,
    vendorKey: 'apimart',
    modelKey: targetModelKey,
    labelZh: 'Seedance 2.0',
    kind: 'video',
    enabled: true,
    meta: { archetypeId: 'seedance-2-apimart' },
    pricing: { cost: 0, enabled: true, specCosts: [] },
    updatedAt: now,
  }
  const apimartCredential = { ...credential, vendorKey: 'apimart' }
  // Remove the staged identity and any fixture mapping occupying the same
  // (vendor, task, model) slot.  Startup reconciliation then restores the
  // exact shipped Seedance mapping; a hand-written fixture mapping would make
  // the built-in curated-execution guard reject the direct-key provider.
  const remainingModels = catalog.models.filter((item) => item.vendorKey !== sourceVendorKey
    && !(item.vendorKey === 'apimart' && item.modelKey === targetModelKey))
  const remainingMappings = catalog.mappings.filter((item) => item.vendorKey !== sourceVendorKey
    && !(item.vendorKey === 'apimart' && item.modelKey === targetModelKey
      && item.taskKind === 'text_to_video'))
  catalog.vendors = catalog.vendors.filter((item) => item.key !== sourceVendorKey && item.key !== 'apimart')
  catalog.vendors.push(apimartVendor)
  // Seedance's archetype deliberately canonicalizes every variant back to
  // the curated base identity (`doubao-seedance-2.0`) before sealing a
  // contract.  Startup seeds that built-in row after the isolated catalog is
  // loaded, so give that canonical row the fixture's known zero-cost pricing;
  // otherwise the honest resolver would select the first unpriced row even
  // though the staged fixture row is priced.  This is fixture catalog data,
  // not a production pricing fallback.
  catalog.models = [...remainingModels, apimartModel]
  catalog.mappings = remainingMappings
  delete catalog.apiKeysByVendor[sourceVendorKey]
  catalog.apiKeysByVendor.apimart = apimartCredential
  fs.writeFileSync(catalogPath, JSON.stringify(catalog), 'utf8')
  return targetModelKey
}

function videoCandidate(id, prompt, modelKey) {
  return {
    candidateId: `cand-${id}`,
    revision: 1,
    moduleId: 'generation.single-shot',
    providerId: 'apimart',
    modelId: modelKey,
    variantId: 'fast',
    mode: 'text_to_video',
    prompt,
    parameters: { size: '16:9', resolution: '480p', duration: 4, generate_audio: false },
    references: [],
  }
}

function runFrom(result) {
  return result?.structuredContent?.nomiRunData || null
}

// Semantic generation tools predate the production-result envelope and return
// their canonical payload in the text block.  Keep the journey strict about
// the shape it consumes while accepting either transport representation.
function semanticPayload(result) {
  const parsed = parseToolResult(result)
  return parsed.outcome && Object.keys(parsed.outcome).length > 0 ? parsed.outcome : (parsed.json || {})
}

function artifactByKind(run, kind) {
  return (run?.artifacts || []).find((artifact) => artifact.kind === kind && ['ready', 'adopted'].includes(artifact.status))
}

async function waitForRun(mcp, projectId, runId, predicate, label, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    const result = await mcp.callToolOrThrow('nomi_get_run', { projectId, runId }, { timeoutMs: 20_000 })
    last = runFrom(result)
    if (predicate(last)) return last
    await delay(250)
  }
  throw new Error(`${label} timed out: ${JSON.stringify({
    status: last?.status,
    stageId: last?.stageId,
    stages: last?.stages?.map((stage) => [stage.stageId, stage.status]),
    jobs: last?.jobs?.map((job) => [job.jobId, job.status]),
    gates: last?.gates?.map((gate) => [gate.gateId, gate.status]),
  })}`)
}

async function waitForVisible(locator, timeoutMs = 15_000) {
  await locator.waitFor({ state: 'visible', timeout: timeoutMs })
  return locator
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
  throw new Error(`APIMart fixture certification timed out: ${JSON.stringify({
    runId,
    stage: last?.stage,
    models: last?.models?.map((model) => [model.modelKey, model.modes?.map((mode) => [mode.taskKind, mode.state])]),
    error: last?.error,
  })}`)
}

/**
 * A newly created Workbench project is promoted from the draft manifest
 * (revision 0) by an asynchronous first save.  Receipt challenges bind the
 * owner revision, so starting the semantic journey before that promotion
 * creates a legitimate receipt-invalid race.  Wait for one durable revision
 * and require it to remain unchanged briefly; this is synchronization with
 * the real owner, not a test-only revision override.
 */
async function waitForPersistedProjectRevision(projectsDir, projectId, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let lastRevision = null
  let stableSince = 0
  while (Date.now() < deadline) {
    let revision = null
    for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const manifestPath = path.join(projectsDir, entry.name, '.nomi', 'project.json')
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
        if (manifest?.id === projectId && Number.isInteger(manifest.revision)) {
          revision = manifest.revision
          break
        }
      } catch {
        // The first-save write is atomic; a transient missing/partial file is
        // expected while polling and is retried until the owner settles.
      }
    }
    if (Number.isInteger(revision) && revision >= 1) {
      if (revision !== lastRevision) {
        lastRevision = revision
        stableSince = Date.now()
      } else if (Date.now() - stableSince >= 300) {
        return revision
      }
    }
    await delay(100)
  }
  throw new Error(`project ${projectId} was not durably promoted before the semantic gate (revision=${lastRevision ?? 'unknown'})`)
}

let gui = null
let mcp = null
let provider = null
let exitCode = 0
try {
  const videoUrl = fixtureVideoDataUrl()
  provider = await startLoopbackApimart(videoUrl)
  const { modelKey, sourceVendorKey } = configureIsolatedCatalog(provider.origin)

  const launchOptions = {
    name: 'production-mcp-journey',
    userDataDir: dirs.userDataDir,
    settingsDir: dirs.settingsDir,
    projectsDir: dirs.projectsDir,
    capabilityDir: dirs.capabilityDir,
    env: {
      NOMI_E2E_PRODUCTION_FIXTURE: '1',
      NOMI_E2E_APIMART_BASE_URL: provider.origin,
      NOMI_CAPABILITY_DIR: dirs.capabilityDir,
      NOMI_MCP_GENERATION_SINGLE_SHOT_V1: '1',
      NOMI_MCP_GENERATION_SINGLE_SHOT_E1_V1: '1',
    },
    args: ['--disable-gpu', '--disable-software-rasterizer', '--no-proxy-server'],
    settleMs: 0,
    // The fixture credential is synthetic, but it must still cross the same
    // safeStorage write path as a real key.  This flag only selects Electron's
    // isolated test backend on Linux; it never changes production behavior.
    syntheticCredentialStorage: true,
  }

  // First exercise the real Settings → credential write → canonical
  // certification lifecycle.  The renderer write intentionally remains
  // disabled (the production sanitizer owns that boundary); only certification
  // promotion may flip the same safeStorage record to enabled=true.
  gui = await launchNomiApp(launchOptions)
  const credential = await gui.win.evaluate((vendorKey) => window.nomiDesktop?.modelCatalog?.upsertVendorApiKey(vendorKey, { apiKey: 'fixture-key', enabled: true }), sourceVendorKey)
  check(Boolean(credential) && credential.enabled === false, 'Settings key write remains disabled until certification')
  const stagedCatalog = JSON.parse(fs.readFileSync(path.join(dirs.settingsDir, 'model-catalog.json'), 'utf8'))
  const stagedCredential = stagedCatalog.apiKeysByVendor?.[sourceVendorKey]
  check(stagedCredential?.enc === 'safeStorage' && stagedCredential?.enabled === false && stagedCredential?.apiKey !== 'fixture-key', 'fixture credential is encrypted and never persisted as plaintext')

  const certificationStart = await gui.win.evaluate(({ vendorKey, modelKey: selectedModelKey }) => window.nomiDesktop.onboarding.httpCertificationStartExisting({
    vendorKey,
    idempotencyKey: 'production-mcp-apimart-certification-v1',
    models: [{ modelKey: selectedModelKey, kind: 'video' }],
  }), { vendorKey: sourceVendorKey, modelKey })
  check(certificationStart?.ok === true && Boolean(certificationStart.run?.id), 'canonical APIMart certification starts from the saved Settings credential')
  const certificationRetry = await gui.win.evaluate(({ vendorKey, modelKey: selectedModelKey }) => window.nomiDesktop.onboarding.httpCertificationStartExisting({
    vendorKey,
    idempotencyKey: 'production-mcp-apimart-certification-v1',
    models: [{ modelKey: selectedModelKey, kind: 'video' }],
  }), { vendorKey: sourceVendorKey, modelKey })
  check(certificationRetry?.ok === true && certificationRetry.run?.id === certificationStart.run?.id, 'canonical certification retry reuses one durable run')
  const certificationRun = await waitForCertification(gui.win, certificationStart.run.id)
  check(certificationRun.stage === 'completed', `canonical certification promotes the fixture video (${certificationRun.stage}; error=${certificationRun.error || 'none'}; models=${JSON.stringify(certificationRun.models || [])})`)
  check(certificationRun.models?.some((item) => item.modelKey === modelKey && item.modes?.some((mode) => mode.taskKind === 'text_to_video' && mode.state === 'verified')), 'certification records a verified video mode before semantic execution')
  check(provider.hits.some((hit) => hit.method === 'POST' && hit.url === '/v1/video/generations') && provider.hits.some((hit) => hit.method === 'GET' && hit.url.startsWith('/v1/video/generations/')), 'certification observes the generic media create→poll contract against the loopback')
  const promotedCatalog = JSON.parse(fs.readFileSync(path.join(dirs.settingsDir, 'model-catalog.json'), 'utf8'))
  const promotedCredential = promotedCatalog.apiKeysByVendor?.[sourceVendorKey]
  check(promotedCredential?.enc === 'safeStorage' && promotedCredential?.enabled === true, 'certification promotes the same encrypted credential to enabled=true')
  check(promotedCatalog.models?.some((item) => item.vendorKey === sourceVendorKey && item.modelKey === modelKey && item.enabled === true), 'certification publishes the verified fixture model')

  // Keep semantic assertions focused on the production APIMart wire, not the
  // prerequisite certification probes.  The reset only clears this in-memory
  // loopback ledger; it does not alter catalog state or provider behavior.
  provider.reset()
  await gui.app.close()
  gui = null
  const semanticModelKey = installCertifiedApimartCatalog(sourceVendorKey, modelKey)
  gui = await launchNomiApp(launchOptions)
  const win = gui.win
  await win.setViewportSize({ width: 1440, height: 900 })
  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForFunction(() => window.location.hash.includes('projectId='), undefined, { timeout: 15_000 })
  const projectId = await win.evaluate(() => new URLSearchParams(window.location.hash.split('?')[1] || '').get('projectId'))
  check(Boolean(projectId), 'isolated project opens in built Nomi')
  const persistedProjectRevision = await waitForPersistedProjectRevision(dirs.projectsDir, projectId)
  check(persistedProjectRevision >= 1, `project owner persists revision ${persistedProjectRevision} before semantic authorization`)

  const token = fs.readFileSync(path.join(dirs.capabilityDir, 'token'), 'utf8').trim()
  mcp = spawnMcpStdioClient({
    ...dirs,
    clientInfo: { name: 'Codex semantic production journey', version: 'e2e' },
    capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } },
    env: {
      NOMI_E2E_PRODUCTION_FIXTURE: '1',
      // The semantic MCP server is a second Electron process; pass the same
      // guarded loopback override to it so its provider never reaches the
      // real APIMart endpoint during this zero-cost journey.
      NOMI_E2E_APIMART_BASE_URL: provider.origin,
      NOMI_MCP_CLIENT: 'codex',
      NOMI_MCP_CLIENT_PROOF: signMcpClientProof(token, 'codex'),
    },
  })
  let initialized = null
  for (let attempt = 0; attempt < 20 && !initialized; attempt += 1) {
    try { initialized = await mcp.initialize(4_000) } catch { await delay(300) }
  }
  check(Boolean(initialized?.result), 'real MCP stdio initialize handshake succeeds')

  const toolsResult = await mcp.rpc('tools/list', {}, 20_000)
  const tools = toolsResult.result?.tools || []
  const catalogModule = await import(pathToFileURL(path.join(repoRoot, 'dist-electron/capabilityCore/mcpToolCatalog.js')).href)
  const catalogNames = catalogModule.MCP_TOOL_CATALOG.map((tool) => tool.name)
  const stdioNames = tools.map((tool) => tool.name)
  const missing = catalogNames.filter((name) => !stdioNames.includes(name))
  const extra = stdioNames.filter((name) => !catalogNames.includes(name))
  check(catalogNames.length > 0 && missing.length === 0 && extra.length === 0, `stdio exposes exact ${catalogNames.length}-tool catalog (missing=${missing.join(',') || 'none'}, extra=${extra.join(',') || 'none'})`)
  for (const name of ['nomi_get_generation_context', 'nomi_operation_create', 'nomi_preview_execution', 'nomi_request_generation_gate', 'nomi_get_run', 'nomi_subscribe_run', 'nomi_get_artifact']) {
    check(stdioNames.includes(name), `${name} is advertised for the semantic journey`)
  }

  const sessionResult = await mcp.callToolOrThrow('nomi_session_open', { bootstrap: { mode: 'current_project' } }, { timeoutMs: 20_000 })
  const session = parseToolResult(sessionResult)
  const leaseHandle = session.outcome?.leaseHandle || session.json?.leaseHandle
  const leaseProjectId = session.outcome?.projectId || session.json?.projectId || projectId
  check(Boolean(leaseHandle), 'current-project session returns a scoped lease')
  check(leaseProjectId === projectId, 'lease scope matches the opened project')

  const contextResult = await mcp.callToolOrThrow('nomi_get_generation_context', { leaseHandle }, { timeoutMs: 20_000 })
  const context = semanticPayload(contextResult)
  const contextModel = context.videoModels?.find((model) => model.providerId === 'apimart' && model.modelId === semanticModelKey)
  check(Boolean(contextModel), 'generation context exposes the configured APIMart video model')
  check(contextModel?.modes?.some((mode) => mode.transportTaskKind === 'text_to_video'), 'context exposes text-to-video mode and its parameters')

  const createdResult = await mcp.callToolOrThrow('nomi_operation_create', {
    leaseHandle,
    shots: [
      { shotId: 'shot-1', role: 'shot', candidate: videoCandidate('shot-1', '雨夜便利店门口，霓虹倒影，镜头缓慢推近', semanticModelKey) },
      { shotId: 'shot-2', role: 'shot', candidate: videoCandidate('shot-2', '暖光货架间，镜头沿整齐商品缓慢横移', semanticModelKey) },
    ],
  }, { timeoutMs: 20_000 })
  const created = semanticPayload(createdResult)
  const operationId = created.operation?.operationId
  check(Boolean(operationId), 'semantic multi-shot operation is created in the durable ProductionRun owner')
  check(created.operation?.shots?.length === 2, 'draft contains exactly two editable video shots')
  check(provider.hits.length === 0, 'planning and draft creation do not call the provider')

  const previewResult = await mcp.callToolOrThrow('nomi_preview_execution', { leaseHandle, operationId }, { timeoutMs: 20_000 })
  const preview = semanticPayload(previewResult)
  check(preview.pricing?.shots?.every((shot) => shot.price?.known === true), `preview carries known fixture pricing (${JSON.stringify(preview.pricing || {})})`)
  check(preview.nextAction === 'request_gate', `preview exposes the next action without submitting (${JSON.stringify({ nextAction: preview.nextAction, providerReady: preview.providerReady, missing: preview.providerCapabilitiesMissing || [] })})`)
  check(provider.hits.length === 0, 'execution preview remains zero-provider')

  // Operation/preview calls are allowed to trigger the Workbench autosave. Re-
  // sample the same durable owner immediately before sealing the paid gate so
  // a late first-save revision cannot invalidate an otherwise valid receipt.
  const gateProjectRevision = await waitForPersistedProjectRevision(dirs.projectsDir, leaseProjectId)
  check(gateProjectRevision >= 1, `project owner revision ${gateProjectRevision} remains settled before the paid gate`)

  // Request gate blocks until the real GUI confirmation card is clicked.  The
  // client intentionally does not advertise elicitation so the fallback card
  // is the only confirmation surface and the receipt still goes through the
  // main-process gesture attestation.
  const gatePromise = mcp.callToolOrThrow('nomi_request_generation_gate', { leaseHandle, operationId }, { timeoutMs: 180_000 })
  const gateCard = win.locator('.fixed.inset-0').filter({ hasText: '允许 Nomi 生成这一批镜头？' })
  await waitForVisible(gateCard, 30_000)
  const gateText = await gateCard.innerText()
  check(gateText.includes('Seedance') || gateText.includes('doubao-seedance'), 'confirmation card names the selected video model')
  check(gateText.includes('text_to_video') && gateText.includes('约 4 秒'), 'confirmation card exposes frozen mode and duration; wire parameters are checked after execution')
  check(await gateCard.locator('[data-production-shot-row]').count() === 2, 'confirmation card renders one row per semantic shot')
  check(provider.hits.length === 0, 'provider is untouched while confirmation is pending')
  await gateCard.screenshot({ path: path.join(shotsDir, '01-semantic-confirmation.png') })
  await gateCard.locator('[data-production-action="confirm"]').click()
  const gateResult = await gatePromise
  check(!gateResult?.isError, 'GUI receipt resolves request_generation_gate and starts the batch')

  let run = await waitForRun(mcp, leaseProjectId, operationId, (value) => value?.status === 'awaiting_rough_cut_review', 'semantic generation + QA + assembly')
  check(run.stages?.length === 4, 'semantic Run has exactly generate, QA, assemble, and export stages')
  check(run.stages?.filter((stage) => stage.status === 'completed').length === 3, 'generate, QA, and assemble stages are completed before rough-cut approval')
  check(run.jobs?.length === 2 && run.jobs.every((job) => job.status === 'adopted'), 'both provider jobs are materialized and adopted exactly once')
  check(run.artifacts?.filter((artifact) => artifact.kind === 'video').length === 2, 'two durable video artifacts are attached to the Run')
  check(Boolean(artifactByKind(run, 'timeline')), 'QA/assembly writes a durable timeline artifact')
  check(provider.hits.filter((hit) => hit.method === 'POST' && hit.url === '/v1/videos/generations').length === 2, 'exactly two semantic video submissions cross APIMart')
  check(provider.hits.filter((hit) => hit.method === 'GET' && hit.url.startsWith('/v1/tasks/')).length === 2, 'each submission is queried exactly once')
  check(new Set(provider.submittedTaskIds).size === 2 && new Set(provider.queriedTaskIds).size === 2
    && provider.queriedTaskIds.every((taskId) => provider.submittedTaskIds.includes(taskId)), 'provider task receipts are unique and each is observed once')
  check(run.jobs?.length === 2 && new Set(run.jobs.map((job) => job.jobId)).size === run.jobs.length, 'ProductionRun keeps one durable job identity per shot')
  check(run.budget?.authorized === 0 && run.budget?.reserved === 0 && run.budget?.actual === 0 && run.budget?.unsettled === 0, 'pre-export Run reports no hidden or unsettled fixture spend')
  const postBodies = provider.hits.filter((hit) => hit.method === 'POST').map((hit) => hit.body)
  const selectedVariant = contextModel?.variants?.find((variant) => variant.id === 'fast')
  check(selectedVariant?.modelKey === 'doubao-seedance-2.0-fast', 'generation context resolves the approved fast transport model')
  check(postBodies.every((body) => body?.model === selectedVariant.modelKey && body?.duration === 4 && body?.resolution === '480p' && body?.size === '16:9' && body?.generate_audio === false), 'adapter sends the approved model and canonical video parameters')
  check(new Set(postBodies.map((body) => body?.prompt)).size === 2, 'each semantic shot keeps its own prompt on the wire')

  const eventResult = await mcp.callToolOrThrow('nomi_subscribe_run', { projectId: leaseProjectId, runId: operationId, afterCursor: 0, waitMs: 0 }, { timeoutMs: 20_000 })
  const events = eventResult?.structuredContent?.nomiRunData?.events || []
  check(events.some((event) => event.type === 'qa.verdict' || event.stageId === 'qa'), 'MCP event stream includes QA evidence')
  check(events.some((event) => event.type === 'artifact.ready' && event.stageId === 'assemble' && event.message === 'artifact-timeline-v1'), 'MCP event stream includes durable artifact evidence')

  // Task Center is the sole resident production surface.  It must show the
  // rough-cut preview before the user can move to a separate export approval.
  const taskPanel = win.locator('[data-nomi-right-panel="tasks"]')
  if (!(await taskPanel.isVisible().catch(() => false))) await win.locator('[data-task-center-trigger="true"]').click()
  await waitForVisible(taskPanel, 10_000)
  const card = taskPanel.locator('[data-production-task-card]')
  await waitForVisible(card, 10_000)
  check((await card.locator('[data-production-status-title]').textContent())?.length > 0, 'Task Center hosts the semantic Run card')
  check((await card.textContent())?.includes('3 / 4 已完成'), 'resident card shows the pre-export four-stage progress contract')
  const previewCover = card.locator('[data-production-preview-open]')
  await waitForVisible(previewCover, 10_000)
  check(await card.locator('[data-production-preview] video').count() === 0, 'rough-cut starts with a compact preview cover')
  await previewCover.click()
  const roughVideo = card.locator('[data-production-preview] video')
  await waitForVisible(roughVideo, 10_000)
  check(await roughVideo.count() === 1, 'clicking the cover reveals one playable rough-cut video')
  await card.screenshot({ path: path.join(shotsDir, '02-rough-cut-ready.png') })

  await card.locator('[data-production-primary-action]').click()
  const roughDialog = win.locator('[data-confirm-dialog-surface="confirm"]:visible')
  await waitForVisible(roughDialog, 10_000)
  check((await roughDialog.innerText()).includes('预览'), 'rough-cut approval explains the review action in the confirm surface')
  await roughDialog.locator('[data-confirm-dialog-confirm="true"]').click()
  run = await waitForRun(mcp, leaseProjectId, operationId, (value) => value?.status === 'awaiting_export', 'rough-cut approval')
  check(run.gates?.some((gate) => gate.scope === 'export' && gate.status === 'waiting'), 'rough-cut approval opens the independent export gate')

  // Export approval is the only paid/irreversible-looking step.  The fixture
  // policy is zero budget, so this still performs the full receipt/gate path
  // without a real charge.
  // Opening the modal confirm surface closes the floating Task Center when its
  // outside-click guard sees the dialog. Re-open the same resident surface
  // before exercising the next gate; no second history or task owner is used.
  if (!(await taskPanel.isVisible().catch(() => false))) await win.locator('[data-task-center-trigger="true"]').click()
  await waitForVisible(taskPanel, 10_000)
  await waitForVisible(card, 10_000)
  await waitForVisible(card.locator('[data-production-primary-action]'), 10_000)
  await card.locator('[data-production-primary-action]').click()
  const exportDialog = win.locator('div.fixed.inset-0:visible').filter({ hasText: '审看粗剪并批准导出' }).last()
  await waitForVisible(exportDialog, 10_000)
  check((await exportDialog.innerText()).includes('批准导出'), 'export approval names the irreversible MP4 action')
  await exportDialog.getByRole('button', { name: '批准并继续', exact: true }).click()
  run = await waitForRun(mcp, leaseProjectId, operationId, (value) => value?.status === 'completed', 'final export')
  check(run.stages?.length === 4 && run.stages.every((stage) => stage.status === 'completed'), 'all four semantic stages complete')
  check(run.budget?.authorized === 0 && run.budget?.reserved === 0 && run.budget?.actual === 0 && run.budget?.unsettled === 0, 'fixture leaves truthful zero authorized, reserved, actual, and unsettled spend')

  // A completed Run must be terminal for paid work.  Replay the semantic gate
  // request with the same operation/lease and prove it is rejected without a
  // second provider submission (the assertion is deliberately against the
  // loopback hit ledger, not just an error string).
  const hitsBeforeReplay = provider.hits.length
  const replayGate = await mcp.callTool('nomi_request_generation_gate', { leaseHandle, operationId }, { timeoutMs: 20_000 })
  check(replayGate?.isError === true && provider.hits.length === hitsBeforeReplay, 'completed Run rejects a replayed paid gate without a duplicate provider job')

  const exportArtifact = artifactByKind(run, 'export')
  check(Boolean(exportArtifact?.artifactId && exportArtifact?.projectRelativePath), 'completed Run exposes a scoped export artifact')
  const artifactResult = await mcp.callToolOrThrow('nomi_get_artifact', { projectId: leaseProjectId, runId: operationId, artifactId: exportArtifact.artifactId }, { timeoutMs: 20_000 })
  const artifactProjection = artifactResult.structuredContent?.nomiRunData
  const serializedArtifact = JSON.stringify(artifactResult)
  check(artifactProjection?.nomiUri === `nomi://project/${leaseProjectId}/run/${operationId}/artifact/${exportArtifact.artifactId}`, 'MCP returns the scoped nomiUri for the final export')
  check(!serializedArtifact.includes(dirs.tempRoot) && !/providerTaskId|rawPrompt|idempotencyKey/.test(serializedArtifact), 'artifact projection leaks no local path or provider internals')
  const previewUrl = artifactProjection?.preview?.url
  const previewResponse = await fetch(previewUrl, { headers: { Range: 'bytes=0-127' } })
  check([200, 206].includes(previewResponse.status) && (await previewResponse.arrayBuffer()).byteLength > 0, 'authorized preview URL returns final MP4 bytes')

  const projectRoot = fs.readdirSync(dirs.projectsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dirs.projectsDir, entry.name))
    .find((root) => {
      try { return JSON.parse(fs.readFileSync(path.join(root, '.nomi', 'project.json'), 'utf8')).id === leaseProjectId } catch { return false }
    })
  check(Boolean(projectRoot), 'final artifact resolves to the isolated project root')
  const exportPath = path.join(projectRoot, exportArtifact.projectRelativePath)
  const ffprobePath = require('@ffprobe-installer/ffprobe').path
  const probe = JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name', '-of', 'json', exportPath], { encoding: 'utf8' }))
  check(Number(probe.format?.duration) > 0, 'final MP4 has a positive duration')
  check(probe.streams?.some((stream) => stream.codec_type === 'video' && stream.codec_name === 'h264'), 'final MP4 contains H.264 video')
  check(probe.streams?.some((stream) => stream.codec_type === 'audio' && stream.codec_name === 'aac'), 'final MP4 contains AAC audio')

  await win.setViewportSize({ width: 900, height: 700 })
  if (!(await taskPanel.isVisible().catch(() => false))) await win.locator('[data-task-center-trigger="true"]').click()
  await waitForVisible(taskPanel, 10_000)
  await waitForVisible(card, 10_000)
  check(await card.locator('[data-production-tone="success"]').count() === 1, 'completed card remains visible in the narrow window')
  check((await card.textContent())?.includes('4 / 4'), 'narrow-window card keeps the compact four-stage layout')
  await win.screenshot({ path: path.join(shotsDir, '03-completed-900x700.png') })

  console.log(`\nPRODUCTION MCP JOURNEY PASS: ${passed} assertions`)
  console.log(`  Run: ${operationId}`)
  console.log(`  MP4: ${exportPath}`)
  console.log(`  Screenshots: ${shotsDir}`)
} catch (error) {
  console.error(error?.stack || error)
  exitCode = 1
} finally {
  await mcp?.terminate().catch(() => undefined)
  await gui?.app?.close().catch(() => undefined)
  await provider?.close().catch(() => undefined)
  // The root is a unique OS temp directory created by this script; remove it
  // only after all processes have terminated so no user project is touched.
  fs.rmSync(dirs.tempRoot, { recursive: true, force: true })
  process.exitCode = exitCode
}
