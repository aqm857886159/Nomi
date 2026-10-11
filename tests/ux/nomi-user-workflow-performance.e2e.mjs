import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { launchNomiApp, closeNomiApp, ACCEPTANCE_VIEWPORT } from './_launchApp.mjs'
import { backToLibrary } from './_shell.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { uiText } from './full-walk/invariants.mjs'
import { createNomiUserWorkflowFixture } from './fixtures/nomi-user-workflow-fixture.mjs'
import { installProjectOpenProbe } from './nomi-user-workflow-probe.mjs'
import { WORKFLOW_ACTIONS, parseOptions, writeReport, normalizeActionSample, summarizeCell, reportExitCode, percentile, applyCellVerdict } from './nomi-user-workflow-contract.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const defaultEvidenceRoot = path.join(repoRoot, 'docs/evidence/2026-10-10-nomi-user-performance/raw')

export function redact(value) {
  if (typeof value === 'string') return value.replaceAll(repoRoot, '<repo>').replaceAll(os.tmpdir(), '<temp>')
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redact(child)]))
  return value
}

export function projectCardSelector(record) {
  if (typeof record?.id !== 'string' || !/^[\w-]+$/.test(record.id)) throw new Error('project card requires persisted record.id')
  return `[data-project-card][data-project-id="${record.id}"]`
}

function fixtureDataSignature(record) {
  const payload = record.payload, canvas = payload.generationCanvas
  return JSON.stringify({
    id: record.id,
    documents: payload.workbenchDocuments.map(({ id, title, contentJson }) => ({ id, title, contentJson })),
    designs: Object.values(payload.storyboardDesignsByDocumentId).flat().map(({ id, documentId, title, plan }) => ({ id, documentId, title, shots: plan.shots.map(({ shotId, shotKind, prompt, durationSec }) => ({ shotId, shotKind, prompt, durationSec })) })),
    groups: canvas.groups.map(({ id, nodeIds }) => ({ id, nodeIds })),
    nodes: canvas.nodes.map(({ id, kind, result, history }) => ({ id, kind, resultUrl: result?.url, history: history.map(({ id, url }) => ({ id, url })) })),
    edges: canvas.edges.map(({ id, source, target }) => ({ id, source, target })),
  })
}

export function assertFixtureUnchanged(fixture) {
  const persisted = JSON.parse(fs.readFileSync(path.join(fixture.projectRoot, '.nomi', 'project.json'), 'utf8'))
  if (fixtureDataSignature(persisted) !== fixtureDataSignature(fixture.record)) throw new Error('functional assertion: persisted content changed during project.open')
}

async function openForSetup(page, record) {
  const card = page.locator(projectCardSelector(record))
  await card.waitFor({ state: 'visible', timeout: stationTimeout() }); await card.click()
  await page.locator('.generation-canvas-v2__stage[data-ready="true"]').waitFor({ state: 'visible', timeout: stationTimeout() })
}

async function prepare(instance, fixture, cache) {
  const page = instance.win
  await page.locator(projectCardSelector(fixture.record)).waitFor({ state: 'visible', timeout: stationTimeout() })
  if (cache === 'hot') {
    await openForSetup(page, fixture.record); await backToLibrary(page)
    await page.locator(projectCardSelector(fixture.record)).waitFor({ state: 'visible', timeout: stationTimeout() })
  }
  if (await page.locator('.generation-canvas-v2__stage').isVisible()) throw new Error('invalid setup: not in project library')
}

export async function measureProjectOpen(instance, fixture, diagnostics = {}) {
  const { win: page, app } = instance
  const nodeId = fixture.record.payload.generationCanvas.nodes[0].id
  const triggerSelector = diagnostics.triggerSelector || projectCardSelector(fixture.record)
  const loadingLabels = ['router.loading', 'studio.generationCanvasLoading'].flatMap((key) => ['zh-CN', 'en'].map((locale) => uiText(locale, key)))
  const expected = await page.evaluate(installProjectOpenProbe, { probeId: randomUUID(), cardSelector: triggerSelector, projectName: fixture.record.name, nodeId, loadingLabels })
  if (diagnostics.beforeInput) await diagnostics.beforeInput(instance)
  await page.locator(triggerSelector).click()
  const target = await waitForProbeReady(page, expected, stationTimeout(), ['readyAt'], true)
  // Real production control/state transition, with its own trusted input and
  // visible response; eligibility alone never certifies interactivity.
  await page.mouse.click(target.x, target.y)
  await waitForProbeReady(page, expected, stationTimeout(), ['contentAt', 'acknowledgedAt'])
  const state = await page.evaluate(() => window.__nomiWorkflowPerf?.stop() ?? null)
  const sample = normalizeActionSample(state, expected)
  if (diagnostics.afterSnapshot) sample.diagnostics = await diagnostics.afterSnapshot(instance, state)
  const projectTitle = await page.locator('[data-shell-project-menu]').textContent()
  if (!projectTitle?.includes(fixture.record.name)) throw new Error('functional assertion: wrong project title')
  await page.locator(`[data-node-id="${nodeId}"]`).waitFor({ state: 'visible', timeout: stationTimeout() })
  sample.functionalPassed = true
  sample.assertions = { projectId: fixture.record.id, projectTitle, firstNodeId: nodeId, firstImageDecoded: true, canvasReady: true, targetControlResponse: true, targetControl: 'project-menu' }
  await page.keyboard.press('Escape')
  // Collection AFTER immutable latency marks: end snapshots, never CPU or
  // resource-recovery distributions. Acceptance remains incomplete.
  sample.processSnapshot = await app.evaluate(({ app: electronApp }) => ({ metrics: electronApp.getAppMetrics(), versions: process.versions })).catch((error) => ({ unavailable: String(error.message) }))
  sample.screenshot = path.join(path.dirname(fixture.projectsDir), 'project-open-after-measurement.png')
  await page.screenshot({ path: sample.screenshot })
  await page.evaluate(() => { delete window.__nomiWorkflowPerf })
  return sample
}

export async function waitForProbeReady(page, expected, timeout, milestones = ['readyAt'], targetPoint = false) {
  // evaluate is not wrapped by the launcher's feel checkpoint. No scans,
  // screenshots or fixed waits run inside this action's window.
  try {
    return await page.evaluate(({ expected, timeout, milestones, targetPoint }) => new Promise((resolve, reject) => {
      let raf
      const timer = setTimeout(() => { cancelAnimationFrame(raf); reject(new Error('ready milestone timeout')) }, timeout)
      const check = () => {
        const probe = window.__nomiWorkflowPerf
        if (!probe || probe.documentId !== expected.documentId || probe.probeId !== expected.probeId) { clearTimeout(timer); reject(new Error('invalid measurement: probe/document replaced while waiting')); return }
        if (milestones.every((key) => Number.isFinite(probe[key]))) {
          clearTimeout(timer)
          const box = targetPoint ? document.querySelector('[data-shell-project-menu]')?.getBoundingClientRect() : null
          if (targetPoint && (!box || box.width <= 0 || box.height <= 0)) { reject(new Error('invalid measurement: target control disappeared')); return }
          resolve(box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null); return
        }
        raf = requestAnimationFrame(check)
      }
      check()
    }), { expected, timeout, milestones, targetPoint })
  } catch (error) {
    if (/Execution context was destroyed|Cannot find context|frame was detached/.test(error.message)) throw new Error(`invalid measurement: navigation replaced probe: ${error.message}`)
    throw error
  }
}

function guardReceipt(logPath) {
  if (!fs.existsSync(logPath)) throw new Error('offline guard receipt missing')
  const entries = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  const loaded = entries.find((entry) => entry.kind === 'guard-loaded' && ['fetch', 'http', 'https', 'socket', 'chromium'].every((layer) => entry.layers?.includes(layer)))
  if (!loaded || entries.some((entry) => entry.kind === 'guard-error')) throw new Error('offline guard incomplete')
  return { layers: loaded.layers, blockedAttempts: entries.filter((entry) => entry.kind === 'blocked').length }
}

export async function runNomiWorkflowCell(cell, options, dependencies = {}) {
  const action = WORKFLOW_ACTIONS[cell.id]
  Object.assign(cell, { planned: true, implemented: Boolean(action?.implemented), executed: false, passed: false, attempts: [], samples: [] })
  if (!action?.implemented) return Object.assign(cell, { status: 'planned', reason: action?.description || 'unknown action' })
  const launch = dependencies.launch || launchNomiApp, close = dependencies.close || closeNomiApp
  const prepareSample = dependencies.prepare || prepare, measure = dependencies.measure || measureProjectOpen
  for (let index = 0; index < options.warmup + options.runs; index += 1) {
    // Fresh fixture/profile per sample. Hot primes its own profile, never a
    // previous cell. OS page cache is explicitly uncontrolled.
    const tempRoot = makeTempDir(`nomi-user-perf-${cell.scale}-${cell.cache}-`)
    const settingsDir = path.join(tempRoot, 'settings'), projectsDir = path.join(tempRoot, 'projects')
    fs.mkdirSync(settingsDir, { recursive: true }); fs.mkdirSync(projectsDir, { recursive: true })
    const fixture = createNomiUserWorkflowFixture({ projectsDir, scale: cell.scale })
    const logPath = path.join(tempRoot, 'offline-network.jsonl')
    let instance, phase = 'launch'
    const attempt = { index, warmup: index < options.warmup, fixture: fixture.summary }
    try {
      instance = await launch({ name: `nomi-user-perf-${cell.scale}-${cell.cache}-${index}`, tempRoot, settingsDir, projectsDir, viewportSize: ACCEPTANCE_VIEWPORT, settleMs: 0, timeout: options.launchTimeout,
        mainRequire: [path.join(repoRoot, 'scripts/walkthrough-network-guard.cjs')],
        env: { NOMI_WALK_NET_LOG: logPath, NOMI_WALK_ALLOW_ORIGINS: '', NOMI_WALK_URL_REDIRECTS: '[]' },
      })
      phase = 'setup'; await prepareSample(instance, fixture, cell.cache)
      phase = 'action'
      const sample = await measure(instance, fixture)
      if (!dependencies.measure) sample.offlineGuard = guardReceipt(logPath)
      attempt.status = 'executed'; attempt.sample = sample
      cell.executed = true
      if (!attempt.warmup) cell.samples.push(sample)
    } catch (error) {
      attempt.status = phase === 'launch' ? 'blocked_environment' : String(error.message).startsWith('invalid') ? 'invalid' : 'failed'
      attempt.phase = phase; attempt.reason = String(error.message || error)
      if (error.probeState !== undefined) attempt.invalidProbe = error.probeState
      cell.status = attempt.status; cell.reason = attempt.reason
    } finally {
      if (instance) {
        try {
          await close(instance.app)
          assertFixtureUnchanged(fixture)
          if (attempt.sample) attempt.sample.assertions = { ...attempt.sample.assertions, persistedContentUnchanged: true }
        } catch (error) {
          cell.status = 'failed'; cell.reason = `teardown/correctness error: ${error.message}`; attempt.teardownError = cell.reason
          if (attempt.sample) attempt.sample.functionalPassed = false
        }
      }
      cell.attempts.push(attempt)
    }
    if (cell.status) return cell
  }
  return applyCellVerdict(cell, options)
}

async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv)
  const evidenceRoot = process.env.NOMI_USER_PERF_OUT || defaultEvidenceRoot
  const report = {
    schemaVersion: 3, generatedAt: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
    runner: 'tests/ux/nomi-user-workflow-performance.e2e.mjs', options,
    source: { workingTreeDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim()),
      fileHashes: Object.fromEntries(['tests/ux/nomi-user-workflow-performance.e2e.mjs', 'tests/ux/nomi-user-workflow-contract.mjs', 'tests/ux/nomi-user-workflow-probe.mjs', 'tests/ux/fixtures/nomi-user-workflow-fixture.mjs', 'src/workbench/common/LazyNomiMarkdown.tsx', 'src/workbench/ai/v4/AgentPanelV4Markdown.tsx', 'src/workbench/skillLibrary/SkillDetail.tsx', 'src/workbench/promptLibrary/PromptPreviewOverlay.tsx', 'src/workbench/generationCanvas/nodes/artifact/ArtifactBody.tsx'].map((file) => [file, createHash('sha256').update(fs.readFileSync(path.join(repoRoot, file))).digest('hex')])) },
    buildReceipt: JSON.parse(fs.readFileSync(path.join(repoRoot, 'dist/build-stamp.json'), 'utf8')),
    measurement: { viewport: ACCEPTANCE_VIEWPORT, timing: 'trusted card pointerdown → first matching project feedback / decoded first image / production canvas eligibility / trusted project-menu input → visible matching menu response; content and response independently ordered, one browser clock',
      cache: 'fresh profile and fixture per repetition; hot primes same profile; OS filesystem cache uncontrolled',
      agent: 'absent: no stream/tool fixture implemented', collection: 'process end snapshots only; not CPU/memory trend acceptance', rendererBuild: 'existing build; verify freshness before real baseline' },
    host: { platform: process.platform, arch: process.arch, logicalCpus: os.cpus().length, memoryBytes: os.totalmem(), display: process.env.DISPLAY || null, waylandDisplay: process.env.WAYLAND_DISPLAY || null }, cells: [],
  }
  for (const scale of options.scales) for (const id of options.scenarios) for (const cache of options.caches) {
    if (!WORKFLOW_ACTIONS[id].scales.includes(scale)) continue
    report.cells.push(await runNomiWorkflowCell({ id, scale, cache }, options))
  }
  report.coverage = Object.fromEntries(['planned', 'implemented', 'executed', 'passed'].map((key) => [key, report.cells.filter((cell) => cell[key]).length]))
  // The shared temp helper removes profiles on exit. Retain screenshots after
  // measurement and teardown, with exclusive names, before that cleanup.
  for (const cell of report.cells) for (const attempt of cell.attempts) {
    const sample = attempt.sample
    if (!sample?.screenshot) continue
    const screenshotsDir = path.join(evidenceRoot, 'screenshots')
    fs.mkdirSync(screenshotsDir, { recursive: true })
    const target = path.join(screenshotsDir, `${cell.id}-${cell.scale}-${cell.cache}-${attempt.index}-${randomUUID()}.png`)
    fs.copyFileSync(sample.screenshot, target, fs.constants.COPYFILE_EXCL)
    sample.screenshot = target
  }
  const output = writeReport(evidenceRoot, redact(report))
  console.log(JSON.stringify({ output, coverage: report.coverage, statuses: report.cells.map(({ id, scale, cache, status }) => ({ id, scale, cache, status })) }, null, 2))
  process.exitCode = reportExitCode(report)
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
export { parseOptions, writeReport, normalizeActionSample, summarizeCell, reportExitCode, percentile }
