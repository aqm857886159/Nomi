// Real built Electron + real MCP stdio Production Run journey. No provider calls: the fixture is
// double-gated and disabled in packaged builds. This test owns all four GUI approvals and proves
// durable restart recovery, safe MCP projections, preview authorization, and a valid final MP4.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-production-mcp-e2e-'))
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
const capabilityDir = path.join(tempRoot, 'capability')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/production-mcp')
fs.mkdirSync(projectsDir, { recursive: true })
fs.mkdirSync(shotsDir, { recursive: true })

const sharedEnv = {
  ...process.env,
  NOMI_E2E: '1',
  NOMI_E2E_PRODUCTION_FIXTURE: '1',
  NOMI_E2E_ALLOW_MULTI_INSTANCE: '1',
  NOMI_ELECTRON_USER_DATA_DIR: userDataDir,
  NOMI_SETTINGS_DIR: userDataDir,
  NOMI_PROJECTS_DIR: projectsDir,
  NOMI_CAPABILITY_DIR: capabilityDir,
}

let passed = 0
function check(condition, label) {
  if (!condition) throw new Error(`PRODUCTION MCP E2E FAIL: ${label}`)
  passed += 1
  console.log(`  ✓ ${label}`)
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function launchGui() {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: repoRoot,
    env: sharedEnv,
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.setViewportSize({ width: 1440, height: 900 })
  await window.waitForTimeout(1_500)
  return { app, window }
}

function spawnMcp() {
  const child = spawn(require('electron'), [repoRoot, '--disable-gpu'], {
    cwd: repoRoot,
    env: { ...sharedEnv, NOMI_MCP_STDIO: '1' },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const pending = new Map()
  let sequence = 0
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const text = line.trim()
    if (!text.startsWith('{')) return
    let message
    try { message = JSON.parse(text) } catch { return }
    const entry = pending.get(message.id)
    if (!entry) return
    clearTimeout(entry.timer)
    pending.delete(message.id)
    entry.resolve(message)
  })
  const rpc = (method, params = {}, timeoutMs = 20_000) => new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`MCP RPC timeout: ${method}`))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })
  return { child, rpc }
}

async function initializeMcp(rpc) {
  let response = null
  for (let attempt = 0; attempt < 20 && !response; attempt += 1) {
    try {
      response = await rpc('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } },
        clientInfo: { name: 'OpenAI Codex', version: 'e2e' },
      }, 4_000)
    } catch {
      await delay(500)
    }
  }
  check(Boolean(response?.result), 'real MCP stdio initialize handshake succeeds')
}

async function callTool(rpc, name, args) {
  const response = await rpc('tools/call', { name, arguments: args }, 40_000)
  if (response.error) throw new Error(response.error.message || `MCP ${name} failed`)
  if (response.result?.isError) throw new Error(response.result.content?.[0]?.text || `MCP ${name} failed`)
  return response.result
}

async function getRunData(rpc, projectId, runId) {
  const result = await callTool(rpc, 'nomi_get_run', { projectId, runId })
  return result.structuredContent?.nomiRunData
}

async function waitForRunStatus(rpc, projectId, runId, expected, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let run = null
  while (Date.now() < deadline) {
    run = await getRunData(rpc, projectId, runId)
    if (run?.status === expected) return run
    await delay(250)
  }
  throw new Error(`Run ${runId} did not reach ${expected}; last=${run?.status || 'missing'}`)
}

async function openRunFromTaskCenter(window) {
  await window.locator('[data-task-center-trigger="true"]').click()
  const row = window.locator('[data-nomi-right-panel="tasks"]', { hasText: 'brand.promo' }).locator('[role="button"]', { hasText: 'brand.promo' }).first()
  await row.waitFor({ timeout: 10_000 })
  await row.click()
  await window.locator('[data-production-status-title]').waitFor({ timeout: 10_000 })
}

async function approveCurrentProductionGate(window) {
  await window.locator('[data-production-primary-action]').click()
  const overlay = window.locator('.fixed.inset-0').filter({ has: window.locator('button') }).last()
  await overlay.waitFor({ timeout: 5_000 })
  await overlay.locator('button').last().click()
}

function projectRootFor(projectId) {
  for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const root = path.join(projectsDir, entry.name)
    const descriptor = path.join(root, '.nomi', 'project.json')
    try {
      if (JSON.parse(fs.readFileSync(descriptor, 'utf8')).id === projectId) return root
    } catch {
      // Ignore unrelated directories.
    }
  }
  return null
}

let gui = null
let mcp = null
let exitCode = 0
try {
  gui = await launchGui()
  const window = gui.window
  await window.getByText('新建空白项目', { exact: false }).first().click()
  await window.waitForFunction(() => window.location.hash.includes('projectId='), undefined, { timeout: 10_000 })
  const projectId = await window.evaluate(() => new URLSearchParams(window.location.hash.split('?')[1] || '').get('projectId'))
  check(Boolean(projectId), 'isolated local project opens in built Nomi')

  mcp = spawnMcp()
  await initializeMcp(mcp.rpc)
  const tools = (await mcp.rpc('tools/list')).result?.tools || []
  for (const name of ['nomi_start_playbook', 'nomi_get_run', 'nomi_subscribe_run', 'nomi_get_artifact']) {
    check(tools.some((tool) => tool.name === name), `${name} is registered over real stdio`)
  }

  const resources = (await mcp.rpc('resources/list')).result?.resources || []
  const directorResource = resources.find((resource) => resource.uri === 'nomi-skill://director-cinematography')
  check(Boolean(directorResource), 'director cinematography skill is discoverable through MCP resources')
  const director = (await mcp.rpc('resources/read', { uri: directorResource.uri })).result?.contents?.[0]?.text || ''
  check(director.includes('镜头语言') && director.length > 1_000, 'director skill body can be loaded progressively over MCP')

  const started = await callTool(mcp.rpc, 'nomi_start_playbook', {
    projectId,
    playbook: 'brand.promo',
    brief: {
      goal: 'Create a truthful local-first Nomi product promo fixture.',
      audience: 'AI creators',
      channel: 'product demo',
      durationSeconds: 60,
      sellingPoints: ['Local project data', 'Bring any API', 'Codex and Claude Code over MCP', 'Open source'],
    },
  })
  const runId = started.structuredContent?.nomiRunData?.runId
  check(Boolean(runId), 'MCP creates a durable Production Run without approving spend')
  check(started.structuredContent.nomiRunData.budget.authorized === 0, 'draft has zero authorized spend')

  await openRunFromTaskCenter(window)
  check((await window.locator('[data-production-status-title]').textContent())?.length > 0, 'Task Center reopens the exact Run and expands the assistant')
  await window.screenshot({ path: path.join(shotsDir, '01-direction-gate.png') })

  await approveCurrentProductionGate(window)
  let run = await waitForRunStatus(mcp.rpc, projectId, runId, 'awaiting_storyboard_review')
  check(run.artifacts.some((artifact) => artifact.kind === 'script') && run.artifacts.some((artifact) => artifact.kind === 'storyboard'), 'direction approval produces durable script and storyboard artifacts')
  const events = await callTool(mcp.rpc, 'nomi_subscribe_run', { projectId, runId, afterCursor: 0, waitMs: 0 })
  check(events.structuredContent?.nomiRunData?.events?.some((event) => event.type === 'skill.loaded'), 'MCP event stream exposes durable skill evidence')

  const attached = await window.evaluate(async ({ projectId: pid, runId: rid }) => {
    const bridge = window.nomiDesktop?.productionRuns
    const current = await bridge.read(pid, rid)
    const storyboard = current.artifacts.find((artifact) => artifact.kind === 'storyboard')
    return bridge.command(pid, rid, {
      commandId: crypto.randomUUID(),
      expectedRevision: current.revision,
      type: 'plan.attach',
      payload: {
        artifactId: storyboard.artifactId,
        bindings: [{ nodeId: 'shot-1', provider: 'nomi-e2e-fixture', model: 'nomi-e2e-fixture-video', stageId: 'generate' }],
      },
      issuedAt: new Date().toISOString(),
    })
  }, { projectId, runId })
  check(attached.run.jobs.length === 1 && attached.run.status === 'awaiting_contract', 'storyboard binding crosses the real renderer IPC with one planned job')
  await window.screenshot({ path: path.join(shotsDir, '02-contract-before-restart.png') })

  await gui.app.close()
  gui = await launchGui()
  await gui.window.locator('[data-project-card="true"]').first().click()
  await gui.window.waitForFunction(() => window.location.hash.includes('projectId='), undefined, { timeout: 10_000 })
  await openRunFromTaskCenter(gui.window)
  run = await waitForRunStatus(mcp.rpc, projectId, runId, 'awaiting_contract')
  check(run.jobs.length === 1 && run.budget.authorized === 0, 'restart recovers the waiting contract without submitting or spending')

  await approveCurrentProductionGate(gui.window)
  run = await waitForRunStatus(mcp.rpc, projectId, runId, 'awaiting_rough_cut_review', 30_000)
  check(run.jobs[0]?.status === 'adopted', 'approved fixture generation reaches adopted exactly once')
  check(run.artifacts.some((artifact) => artifact.kind === 'video') && run.artifacts.some((artifact) => artifact.kind === 'timeline'), 'generation and assembly produce local video and timeline artifacts')
  await gui.window.screenshot({ path: path.join(shotsDir, '03-rough-cut-player.png') })
  check(await gui.window.locator('[data-production-preview] video').count() === 1, 'rough-cut Run shows one playable video in Nomi')

  await gui.window.locator('[data-production-primary-action]').click()
  const roughCutConfirm = gui.window.locator('[data-confirm-dialog-confirm="true"]:visible')
  await roughCutConfirm.waitFor({ timeout: 5_000 })
  await roughCutConfirm.click()
  await waitForRunStatus(mcp.rpc, projectId, runId, 'awaiting_export')
  await openRunFromTaskCenter(gui.window)
  await approveCurrentProductionGate(gui.window)
  run = await waitForRunStatus(mcp.rpc, projectId, runId, 'completed', 30_000)
  check(run.budget.actual === 0 && run.budget.unsettled === 0, 'fixture completes with truthful zero actual and unsettled spend')
  const exportArtifact = run.artifacts.find((artifact) => artifact.kind === 'export')
  check(Boolean(exportArtifact?.artifactId), 'completed Run exposes a scoped export artifact identity')

  const artifactResult = await callTool(mcp.rpc, 'nomi_get_artifact', { projectId, runId, artifactId: exportArtifact.artifactId })
  const serializedArtifact = JSON.stringify(artifactResult)
  const artifactData = artifactResult.structuredContent?.nomiRunData
  check(artifactData.nomiUri === `nomi://project/${projectId}/run/${runId}/artifact/${exportArtifact.artifactId}`, 'MCP returns a scoped nomiUri for the final export')
  check(!serializedArtifact.includes(tempRoot) && !/providerTaskId|rawPrompt|idempotencyKey/.test(serializedArtifact), 'MCP artifact result leaks no local path, prompt, or provider internals')
  const previewResponse = await fetch(artifactData.preview.url, { headers: { Range: 'bytes=0-127' } })
  check([200, 206].includes(previewResponse.status) && (await previewResponse.arrayBuffer()).byteLength > 0, 'expiring loopback preview token authorizes the final MP4 bytes')

  const projectRoot = projectRootFor(projectId)
  const exportPath = path.join(projectRoot, 'exports', `nomi-${runId}.mp4`)
  const ffprobePath = require('@ffprobe-installer/ffprobe').path
  const probe = JSON.parse(execFileSync(ffprobePath, [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name', '-of', 'json', exportPath,
  ], { encoding: 'utf8' }))
  check(Number(probe.format?.duration) > 0, 'final MP4 has a positive playable duration')
  check(probe.streams?.some((stream) => stream.codec_type === 'video' && stream.codec_name === 'h264'), 'final MP4 contains H.264 video')
  check(probe.streams?.some((stream) => stream.codec_type === 'audio' && stream.codec_name === 'aac'), 'final MP4 contains AAC audio')

  await gui.window.setViewportSize({ width: 900, height: 700 })
  await gui.window.screenshot({ path: path.join(shotsDir, '04-completed-900x700.png') })
  console.log(`\nPRODUCTION MCP JOURNEY PASS: ${passed} assertions`)
  console.log(`  Run: ${runId}`)
  console.log(`  MP4: ${exportPath}`)
  console.log(`  Screenshots: ${shotsDir}`)
} catch (error) {
  console.error(error?.stack || error)
  exitCode = 1
} finally {
  try { mcp?.child?.stdin?.end() } catch {}
  try { mcp?.child?.kill('SIGTERM') } catch {}
  if (gui?.app) await Promise.race([gui.app.close().catch(() => undefined), delay(3_000)])
  process.exitCode = exitCode
}
