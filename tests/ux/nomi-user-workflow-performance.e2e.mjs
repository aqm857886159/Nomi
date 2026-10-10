import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { launchNomiApp, closeNomiApp, ACCEPTANCE_VIEWPORT } from './_launchApp.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { createNomiUserWorkflowFixture, NOMI_WORKFLOW_SCALES } from './fixtures/nomi-user-workflow-fixture.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const evidenceRoot = process.env.NOMI_USER_PERF_OUT || path.join(repoRoot, 'docs', 'evidence', '2026-10-10-nomi-user-performance', 'raw')
const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=')
  return [key, rest.join('=') || 'true']
}))
const scales = String(args.get('scale') || 'small,typical,heavy').split(',').filter((scale) => NOMI_WORKFLOW_SCALES[scale])
const scenarios = String(args.get('scenario') || 'P1,P2,D1,D2,B1,B2,C1,C2,C3,A1,A2,A3,A4,R1,R2').split(',')
const runs = Math.max(1, Number(args.get('runs') || 5))
const warmup = Math.max(0, Number(args.get('warmup') || 1))
const launchTimeout = Math.max(1_000, Number(args.get('timeout') || 60_000))
const viewport = ACCEPTANCE_VIEWPORT

function percentile(values, p) {
  const numbers = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (!numbers.length) return null
  const index = (numbers.length - 1) * p
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return numbers[lower]
  return numbers[lower] + (numbers[upper] - numbers[lower]) * (index - lower)
}

function redact(value) {
  if (typeof value === 'string') return value.replaceAll(repoRoot, '<repo>').replaceAll(os.tmpdir(), '<temp>')
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redact(child)]))
  return value
}

async function installProbe(page) {
  await page.evaluate(() => {
    const state = { frames: [], longTasks: [], mutations: 0, startedAt: performance.now(), lastFrame: performance.now() }
    const frame = (timestamp) => {
      state.frames.push(timestamp - state.lastFrame)
      state.lastFrame = timestamp
      state.raf = requestAnimationFrame(frame)
    }
    state.raf = requestAnimationFrame(frame)
    state.observer = new PerformanceObserver((list) => state.longTasks.push(...list.getEntries().map((entry) => entry.duration)))
    try { state.observer.observe({ type: 'longtask', buffered: true }) } catch { /* Chromium without longtask */ }
    state.mutationObserver = new MutationObserver(() => { state.mutations += 1 })
    state.mutationObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true })
    window.__nomiWorkflowPerf = state
  })
}

async function readProbe(page, app, startedAt) {
  const renderer = await page.evaluate(() => {
    const state = window.__nomiWorkflowPerf
    if (!state) return { frameTimes: [], longTasks: [], mutations: 0 }
    state.observer?.disconnect()
    state.mutationObserver?.disconnect()
    cancelAnimationFrame(state.raf)
    return { frameTimes: state.frames.slice(), longTasks: state.longTasks.slice(), mutations: state.mutations }
  }).catch(() => ({ frameTimes: [], longTasks: [], mutations: 0 }))
  const frameTimes = renderer.frameTimes
  const frameP95 = percentile(frameTimes, 0.95)
  const frameP99 = percentile(frameTimes, 0.99)
  const droppedFrames = frameTimes.filter((gap) => gap > 50).length
  let main = null
  let rendererProcess = null
  let processMetrics = null
  try {
    processMetrics = await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics())
    const mainProcess = processMetrics.find((metric) => metric.type === 'Browser') || processMetrics[0]
    rendererProcess = processMetrics.find((metric) => ['Renderer', 'Tab', 'Window', 'renderer'].includes(metric.type))
    const cpuPercent = (metric) => metric?.cpu?.percentCPUUsage ?? metric?.cpu?.percent ?? null
    main = mainProcess ? { cpuPercent: cpuPercent(mainProcess), workingSetSize: mainProcess.memory?.workingSetSize ?? null } : null
  } catch { /* launch may have closed during a failed scenario */ }
  let cdp = null
  try {
    const session = await page.context().newCDPSession(page)
    await session.send('Performance.enable')
    const performanceMetrics = await session.send('Performance.getMetrics')
    const domCounters = await session.send('Memory.getDOMCounters').catch(() => null)
    const metricMap = Object.fromEntries((performanceMetrics.metrics || []).map((metric) => [metric.name, metric.value]))
    cdp = {
      taskDurationSeconds: metricMap.TaskDuration ?? null,
      scriptDurationSeconds: metricMap.ScriptDuration ?? null,
      jsHeapUsedBytes: metricMap.JSHeapUsedSize ?? null,
      jsHeapTotalBytes: metricMap.JSHeapTotalSize ?? null,
      documents: domCounters?.documents ?? null,
      nodes: domCounters?.nodes ?? null,
      jsEventListeners: domCounters?.jsEventListeners ?? null,
    }
    await session.detach().catch(() => undefined)
  } catch { /* display/renderer can disappear during a blocked launch */ }
  return {
    elapsedMs: Date.now() - startedAt,
    frameP95: frameP95 === null ? null : Math.round(frameP95 * 100) / 100,
    frameP99: frameP99 === null ? null : Math.round(frameP99 * 100) / 100,
    droppedFrameRatio: frameTimes.length ? droppedFrames / frameTimes.length : null,
    longTaskP95: percentile(renderer.longTasks, 0.95),
    longTaskCount: renderer.longTasks.length,
    mutations: renderer.mutations,
    rendererFrameSamples: frameTimes.length,
    main,
    renderer: rendererProcess ? { cpuPercent: rendererProcess.cpu?.percentCPUUsage ?? rendererProcess.cpu?.percent ?? null, workingSetSize: rendererProcess.memory?.workingSetSize ?? null } : null,
    cdp,
  }
}

async function waitForProject(page, record) {
  const card = page.locator(`[data-project-card][data-project-id="${record.id}"]`).first()
  await card.waitFor({ state: 'visible', timeout: stationTimeout() })
  await card.dblclick()
  await page.locator('.generation-canvas-v2__stage').waitFor({ state: 'visible', timeout: stationTimeout() })
}

async function runAction(page, scenario, scale) {
  if (scenario === 'P1') {
    if (await page.locator('.generation-canvas-v2__stage').count()) {
      await page.reload()
      await page.locator('[data-project-card]').first().waitFor({ state: 'visible', timeout: stationTimeout() })
    }
    return waitForProject(page, scale.record)
  }
  if (scenario === 'P2') {
    await page.locator('.generation-canvas-v2__stage').waitFor({ state: 'visible', timeout: stationTimeout() })
    await page.keyboard.press('Control+R')
    return page.locator('.generation-canvas-v2__stage').waitFor({ state: 'visible', timeout: stationTimeout() })
  }
  if (scenario.startsWith('C')) {
    const stage = page.locator('.generation-canvas-v2__stage').first()
    await stage.waitFor({ state: 'visible', timeout: stationTimeout() })
    const box = await stage.boundingBox()
    if (!box) throw new Error('canvas stage has no visible bounds')
    await stage.hover()
    if (scenario === 'C1') await page.mouse.wheel(0, -420)
    if (scenario === 'C2') { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 180, box.y + 80); await page.mouse.up() }
    if (scenario === 'C3') await page.locator('.generation-canvas-v2-node').first().click()
    return
  }
  // The current stable selectors for documents, storyboard batch actions and the
  // Agent dock are still under active design. Keeping these rows as blocked gives
  // a truthful coverage report rather than timing a benchmark-only shortcut.
  throw new Error(`stable production selector pending for ${scenario} (fixture-only coverage)`)
}

async function main() {
  fs.mkdirSync(evidenceRoot, { recursive: true })
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    commit: process.env.GIT_COMMIT || 'unknown',
    runner: 'tests/ux/nomi-user-workflow-performance.e2e.mjs',
    measurement: { warmup, runs, launchTimeoutMs: launchTimeout, viewport, cache: 'isolated profile; synthetic local media; no paid model calls' },
    host: {
      platform: process.platform, arch: process.arch, logicalCpus: os.cpus().length, memoryBytes: os.totalmem(),
      display: process.env.DISPLAY || null, waylandDisplay: process.env.WAYLAND_DISPLAY || null,
      xServerProbe: fs.existsSync('/tmp/.X11-unix') || Boolean(process.env.DISPLAY),
    },
    scales: [],
  }
  for (const scale of scales) {
    const tempRoot = makeTempDir(`nomi-user-perf-${scale}-`)
    const settingsDir = path.join(tempRoot, 'settings')
    const projectsDir = path.join(tempRoot, 'projects')
    fs.mkdirSync(settingsDir, { recursive: true })
    fs.mkdirSync(projectsDir, { recursive: true })
    const fixture = createNomiUserWorkflowFixture({ projectsDir, scale })
    const scaleResult = { ...fixture.summary, scenarios: [] }
    let instance = null
    let launchError = null
    try {
      instance = await launchNomiApp({ name: `nomi-user-perf-${scale}`, tempRoot, settingsDir, projectsDir, viewportSize: viewport, settleMs: 1200, timeout: launchTimeout })
    } catch (error) {
      launchError = String(error?.message || error)
    }
    for (const scenario of scenarios) {
      const scenarioResult = { id: scenario, scale, fixture: { agent: 'local-timer/loopback contract only; no paid provider' }, samples: [] }
      if (launchError) {
        scenarioResult.status = 'blocked'
        scenarioResult.reason = `launch_error: ${launchError}`
        scaleResult.scenarios.push(scenarioResult)
        continue
      }
      try {
        // P1 measures library → project open. Other rows use the same real
        // project-open gesture as setup, then measure only their user action.
        if (scenario !== 'P1') await waitForProject(instance.win, fixture)
        for (let index = 0; index < warmup + runs; index += 1) {
          await installProbe(instance.win)
          const startedAt = Date.now()
          await runAction(instance.win, scenario, { ...fixture, record: fixture.record })
          await instance.win.waitForTimeout(250)
          const metrics = await readProbe(instance.win, instance.app, startedAt)
          if (index >= warmup) scenarioResult.samples.push(metrics)
        }
        scenarioResult.status = 'measured'
      } catch (error) {
        scenarioResult.status = 'blocked'
        scenarioResult.reason = String(error?.message || error)
      }
      scaleResult.scenarios.push(scenarioResult)
    }
    if (instance) await closeNomiApp(instance.app)
    report.scales.push(scaleResult)
  }
  const output = path.join(evidenceRoot, `nomi-user-workflow-${new Date().toISOString().slice(0, 10)}.json`)
  fs.writeFileSync(output, JSON.stringify(redact(report), null, 2))
  console.log(JSON.stringify({ output, scales: report.scales.map((scale) => ({ scale: scale.scale, statuses: scale.scenarios.reduce((counts, row) => ({ ...counts, [row.status]: (counts[row.status] || 0) + 1 }), {}) })) }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error); process.exitCode = 1 })
}

export { percentile, redact }
