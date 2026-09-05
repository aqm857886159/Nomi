// 生成画布性能基准：真实 Electron + 本地图片/视频夹具 + 高频微操作。
//
// 用法：
//   pnpm run build
//   node tests/ux/canvas-performance-benchmark.e2e.mjs baseline --scale L --runs 5
//
// 可选环境变量：NOMI_CANVAS_PERF_RUNS、NOMI_CANVAS_PERF_SCALES、NOMI_CANVAS_PERF_SCENARIOS。
// 结果写入 tests/ux/perf-results/canvas-<label>.json。零额度、零网络媒体依赖。
import { launchNomiApp } from './_launchApp.mjs'
import { findCanvasBlankPoint } from './_canvasHit.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  CANVAS_PERF_SCALES,
  createCanvasPerformanceFixture,
  defaultPerfTempRoot,
} from './fixtures/canvas-performance-fixture.mjs'
import { applyPerformanceVerdict } from '../../scripts/canvas-performance-verdict.mjs'
import {
  runMultiNodeDrag,
  runDragAtLowZoom,
  runDragOverDenseEdges,
  zoomOutTo,
} from './canvas-perf/dragScenarios.mjs'
import {
  installOffCanvasRenderProbe,
  startOffCanvasRenderWindow,
  stopOffCanvasRenderWindow,
  OFF_CANVAS_RENDER_TARGETS,
} from './canvas-perf/offCanvasRenderProbe.mjs'
import { buildScenarioAdvisory } from './canvas-perf/advisoryMetrics.mjs'
import {
  AUTO_PAN_SAFE_MARGIN_PX,
  MIN_NODE_BAND_COVERAGE,
  clampIntoAutoPanSafeArea,
  expectedFullySelected,
  nodeBandCoverage,
  sweptRect,
} from './canvas-perf/gestureGeometry.mjs'
import { startDevRendererServer } from './canvas-perf/devRendererServer.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outputDir = path.join(repoRoot, 'tests/ux/perf-results')
const args = process.argv.slice(2)
const label = args.find((arg) => !arg.startsWith('-')) || 'run'
const argValue = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const hasArg = (name) => args.includes(name)
const captureScreenshots = hasArg('--screenshots')
// eval v2 (U3): dev leg loads a real Vite dev server (dev React bundle +
// StrictMode double-render, readable component names) via NOMI_RENDERER_URL;
// throttle leg applies CDP CPU throttling to model a median machine. Both are
// measurement configurations — they never touch product code or budgets.
const useDevServer = hasArg('--dev-server')
const cpuThrottleRate = Math.max(1, Number(argValue('--throttle') || 1))
// PERFORMANCE_BUDGETS are calibrated against the *prod* dist on darwin (see the
// NON_DARWIN_TIMING_CALIBRATION note). The dev leg (StrictMode double-render +
// unminified + immer dev-freeze) and the throttle leg (4x slower CPU) are
// deliberately heavier configurations whose latency ceilings were never
// calibrated — so on those legs the budget checks are ADVISORY: still computed,
// recorded and printed, but they do not force pass=false (mirrors the
// ADVISORY_ONLY_SCENARIOS posture and the #264 "don't gate un-calibrated
// ceilings" lesson). Correctness hard-failures (errors, anchor/step drift,
// selection integrity) keep gating on every leg. Only the prod leg gates on
// budgets, byte-for-byte as before.
const budgetsAreCalibratedForLeg = !useDevServer && cpuThrottleRate === 1
if (hasArg('--help') || hasArg('-h')) {
  console.log('用法：node tests/ux/canvas-performance-benchmark.e2e.mjs <label> [--scale L] [--runs 5]')
  console.log(`scale：${Object.keys(CANVAS_PERF_SCALES).join(' / ')}`)
  console.log(
    'scenario：all / cold-open / blank-pan / node-drag-image / node-drag-video / multi-node-drag / drag-at-low-zoom / drag-over-dense-edges / marquee-select / click-select / wheel-zoom / pan-zoom-mix / resize / media-reveal / low-zoom-preview / media-error / video-hover / reload-heavy',
  )
  console.log('eval v2 腿：--dev-server（dev bundle+StrictMode 腿）/ --throttle 4（CPU 节流腿，模拟慢机器）')
  process.exit(0)
}

const requestedScales = (argValue('--scale') || process.env.NOMI_CANVAS_PERF_SCALES || 'M')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const requestedScenarios = (argValue('--scenario') || process.env.NOMI_CANVAS_PERF_SCENARIOS || 'all')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const sampleCount = Math.max(1, Number(argValue('--runs') || process.env.NOMI_CANVAS_PERF_RUNS || 5))
const warmupCount = Math.max(0, Number(argValue('--warmup') || process.env.NOMI_CANVAS_PERF_WARMUP || 1))
const launchTimeoutMs = Math.max(
  5_000,
  // Dev-server leg boots the unminified dev bundle (slower first paint), so it
  // gets a longer default launch window than the built-dist legs.
  Number(argValue('--launch-timeout') || process.env.NOMI_CANVAS_PERF_LAUNCH_TIMEOUT_MS || (useDevServer ? 90_000 : 45_000)),
)
const allScenarios = [
  'cold-open',
  'blank-pan',
  'node-drag-image',
  'node-drag-video',
  // eval v2 (U1): variable-speed + multi-select + LOD + dense-edge drag coverage.
  'multi-node-drag',
  'drag-at-low-zoom',
  'drag-over-dense-edges',
  'marquee-select',
  'click-select',
  'wheel-zoom',
  'pan-zoom-mix',
  'resize',
  'media-reveal',
  'low-zoom-preview',
  'media-error',
  'video-hover',
  'reload-heavy',
]
const scenarios = requestedScenarios.includes('all') ? allScenarios : requestedScenarios

// eval v2 (U2 打分策略): the newly added drag scenarios are advisory-only THIS
// round. Their budget/hard-failure detail is still computed and recorded for
// visibility, but they do NOT contribute to the run's pass/fail — same posture
// as the new advisory metrics (#264 lesson: harden un-calibrated ceilings only
// after cross-platform data exists). The pre-existing 14 scenarios keep their
// budgets and hard-failure clauses byte-for-byte and remain gating.
const ADVISORY_ONLY_SCENARIOS = new Set(['multi-node-drag', 'drag-at-low-zoom', 'drag-over-dense-edges'])
for (const scale of requestedScales) {
  if (!CANVAS_PERF_SCALES[scale]) throw new Error(`未知 scale「${scale}」`)
}
for (const scenario of scenarios) {
  if (!allScenarios.includes(scenario)) throw new Error(`未知 scenario「${scenario}」`)
}

const PROBE = `(() => {
  if (window.__canvasPerformanceProbe) return 'exists'
  const quantile = (values, q) => {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
    if (!sorted.length) return null
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))
    return Math.round(sorted[index] * 10) / 10
  }
  window.__canvasPerformanceProbe = {
    start() {
      const stage = document.querySelector('.generation-canvas-v2__stage')
      const edges = document.querySelector('.generation-canvas-v2__edges')
      const labels = edges?.parentElement
        ? Array.from(edges.parentElement.children).find((element) => String(element.className).includes('z-[4]'))
        : null
      const rec = {
        t0: performance.now(),
        frames: 0,
        gaps: [],
        lastFrame: performance.now(),
        longTasks: 0,
        longTaskMs: 0,
        longTaskDurations: [],
        maxLoadingImages: 0,
        maxLoadingVideos: 0,
        maxActiveVideos: 0,
        mutations: { stage: 0, edges: 0, labels: 0 },
        firstMutationMs: null,
      }
      const frame = () => {
        const now = performance.now()
        if (rec.frames > 0) rec.gaps.push(now - rec.lastFrame)
        rec.lastFrame = now
        rec.frames += 1
        const images = Array.from(document.querySelectorAll('img[src]'))
        const videos = Array.from(document.querySelectorAll('video[src]'))
        rec.maxLoadingImages = Math.max(rec.maxLoadingImages, images.filter((image) => !image.complete).length)
        rec.maxLoadingVideos = Math.max(rec.maxLoadingVideos, videos.filter((video) => video.readyState < 1 && video.networkState === 2).length)
        rec.maxActiveVideos = Math.max(rec.maxActiveVideos, videos.filter((video) => !video.paused && !video.ended).length)
        rec.raf = requestAnimationFrame(frame)
      }
      const watch = (target, key, options) => {
        if (!target) return
        const observer = new MutationObserver((records) => {
          const now = performance.now()
          if (rec.firstMutationMs === null) rec.firstMutationMs = now - rec.t0
          rec.mutations[key] += records.length
        })
        observer.observe(target, options)
        rec.observers.push(observer)
      }
      rec.observers = []
      watch(stage, 'stage', { attributes: true, childList: true, subtree: false })
      watch(edges, 'edges', { attributes: true, childList: true, subtree: true })
      watch(labels, 'labels', { attributes: true, childList: true, subtree: true })
      try {
        rec.po = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            rec.longTasks += 1
            rec.longTaskMs += entry.duration
            rec.longTaskDurations.push(entry.duration)
          }
        })
        rec.po.observe({ entryTypes: ['longtask'] })
      } catch { /* Chromium 不支持 longtask 时，其他指标仍有效。 */ }
      rec.raf = requestAnimationFrame(frame)
      this._record = rec
      return 'started'
    },
    stop() {
      const rec = this._record
      if (!rec) return null
      cancelAnimationFrame(rec.raf)
      rec.po?.disconnect()
      rec.observers.forEach((observer) => observer.disconnect())
      this._record = null
      const elapsedMs = performance.now() - rec.t0
      const gaps = rec.gaps.filter((gap) => gap >= 0)
      return {
        elapsedMs: Math.round(elapsedMs),
        frames: rec.frames,
        fps: Math.round((rec.frames / Math.max(1, elapsedMs)) * 10000) / 10,
        frameGapP50Ms: quantile(gaps, 0.5),
        frameGapP95Ms: quantile(gaps, 0.95),
        maxFrameGapMs: gaps.length ? Math.round(Math.max(...gaps) * 10) / 10 : null,
        longTasks: rec.longTasks,
        longTaskMs: Math.round(rec.longTaskMs),
        longTaskP95Ms: quantile(rec.longTaskDurations, 0.95),
        maxLoadingImages: rec.maxLoadingImages,
        maxLoadingVideos: rec.maxLoadingVideos,
        maxActiveVideos: rec.maxActiveVideos,
        firstMutationMs: rec.firstMutationMs === null ? null : Math.round(rec.firstMutationMs * 10) / 10,
        mutations: rec.mutations,
      }
    },
  }
  return 'installed'
})()`

function sleep(page, ms) {
  return page.waitForTimeout(ms)
}

function quantile(values, q) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (!sorted.length) return null
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))
  return sorted[index]
}

function metricMap(response) {
  return Object.fromEntries((response?.metrics || []).map((metric) => [metric.name, metric.value]))
}

async function getCdpMetrics(cdp) {
  const metrics = metricMap(await cdp.send('Performance.getMetrics').catch(() => null))
  const dom = await cdp.send('Memory.getDOMCounters').catch(() => null)
  return {
    LayoutCount: metrics.LayoutCount ?? null,
    RecalcStyleCount: metrics.RecalcStyleCount ?? null,
    ScriptDurationMs: metrics.ScriptDuration == null ? null : Math.round(metrics.ScriptDuration * 1000 * 10) / 10,
    LayoutDurationMs: metrics.LayoutDuration == null ? null : Math.round(metrics.LayoutDuration * 1000 * 10) / 10,
    TaskDurationMs: metrics.TaskDuration == null ? null : Math.round(metrics.TaskDuration * 1000 * 10) / 10,
    JSHeapUsedMB: metrics.JSHeapUsedSize == null ? null : Math.round((metrics.JSHeapUsedSize / 1024 / 1024) * 10) / 10,
    domNodes: dom?.nodes ?? null,
    domDocuments: dom?.documents ?? null,
    jsEventListeners: dom?.jsEventListeners ?? null,
  }
}

async function getAppMetrics(app) {
  try {
    const metrics = await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics())
    const renderer = metrics.find(
      (metric) => metric.type === 'Tab' || metric.type === 'Window' || metric.type === 'renderer',
    )
    const gpu = metrics.find((metric) => metric.type === 'GPU')
    const workingSetMB = (metric) =>
      metric?.memory?.workingSetSize == null ? null : Math.round((metric.memory.workingSetSize / 1024) * 10) / 10
    return {
      rendererWorkingSetMB: workingSetMB(renderer),
      gpuWorkingSetMB: workingSetMB(gpu),
      processCount: metrics.length,
      processes: metrics.map((metric) => ({ type: metric.type, pid: metric.pid, workingSetMB: workingSetMB(metric) })),
    }
  } catch {
    return null
  }
}

async function getRuntimeVersions(app) {
  try {
    return await app.evaluate(({ app: electronApp }) => ({
      app: electronApp.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      v8: process.versions.v8,
    }))
  } catch {
    return null
  }
}

async function pageSnapshot(page) {
  return page.evaluate(() => {
    const videos = Array.from(document.querySelectorAll('video'))
    const images = Array.from(document.querySelectorAll('img'))
    const nodeElements = Array.from(document.querySelectorAll('.generation-canvas-v2-node'))
    const media = [...images, ...videos]
    const stageRect = document.querySelector('.generation-canvas-v2__stage')?.getBoundingClientRect()
    const visibleMediaStates = stageRect
      ? Array.from(document.querySelectorAll('[data-node-media-state]'))
          .filter((element) => {
            const rect = element.getBoundingClientRect()
            return (
              rect.width > 2 &&
              rect.height > 2 &&
              rect.bottom > stageRect.top &&
              rect.top < stageRect.bottom &&
              rect.right > stageRect.left &&
              rect.left < stageRect.right
            )
          })
          .map((element) => element.getAttribute('data-node-media-state'))
      : []
    const memory = performance.memory
    return {
      domNodes: document.querySelectorAll('*').length,
      canvasNodes: nodeElements.length,
      lightweightCanvasNodes: nodeElements.filter((node) => node.getAttribute('data-render-mode') === 'lightweight')
        .length,
      lightweightPreviewNodes: nodeElements.filter(
        (node) => node.getAttribute('data-render-mode') === 'lightweight' && node.querySelector('img[src],video[src]'),
      ).length,
      imageElements: images.length,
      videoElements: videos.length,
      visibleMedia: media.filter((element) => {
        const rect = element.getBoundingClientRect()
        return (
          rect.width > 2 &&
          rect.height > 2 &&
          rect.bottom > 0 &&
          rect.top < innerHeight &&
          rect.right > 0 &&
          rect.left < innerWidth
        )
      }).length,
      loadedImages: images.filter((image) => image.complete && image.naturalWidth > 0).length,
      loadedVideos: videos.filter((video) => video.readyState >= 1).length,
      visibleMediaNodes: visibleMediaStates.length,
      visibleMediaPending: visibleMediaStates.filter((state) => ['idle', 'queued', 'loading'].includes(state)).length,
      visibleMediaFailures: visibleMediaStates.filter((state) => state === 'error' || state === 'timeout').length,
      activeVideos: videos.filter((video) => !video.paused && !video.ended).length,
      resourceCount: performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/assets/')).length,
      jsHeapUsedMB: memory ? Math.round((memory.usedJSHeapSize / 1024 / 1024) * 10) / 10 : null,
      transform: (() => {
        const layer = document.querySelector('.generation-canvas-v2__canvas')
        if (!layer) return null
        const matrix = new DOMMatrixReadOnly(getComputedStyle(layer).transform)
        return { x: matrix.m41, y: matrix.m42, zoom: matrix.a }
      })(),
    }
  })
}

async function waitForVisibleMediaSettlement(page, { expectMedia = true, timeout = 30_000 } = {}) {
  const deadline = Date.now() + timeout
  let stableReads = 0
  let previousTransform = ''
  let snapshot = null
  while (Date.now() < deadline) {
    snapshot = await pageSnapshot(page)
    const transform = JSON.stringify(snapshot.transform)
    const mediaPresent = !expectMedia || snapshot.visibleMediaNodes > 0
    if (mediaPresent && snapshot.visibleMediaPending === 0 && transform === previousTransform) stableReads += 1
    else stableReads = 0
    if (stableReads >= 3) return snapshot
    previousTransform = transform
    await sleep(page, 250)
  }
  throw new Error(
    `当前视口媒体未稳定：visible=${snapshot?.visibleMediaNodes ?? 0}, pending=${snapshot?.visibleMediaPending ?? 0}`,
  )
}

function diffMetrics(before, after) {
  const result = {}
  for (const [key, value] of Object.entries(after)) {
    const previous = before[key]
    result[key] = Number.isFinite(value) && Number.isFinite(previous) ? Math.round((value - previous) * 10) / 10 : value
  }
  return result
}

async function installProbe(page) {
  await page.evaluate(PROBE)
}

function pageWindows(app) {
  // Exclude DevTools windows. The dev leg sets NOMI_DESKTOP_DEV=1, which makes
  // electron/main.ts:361 auto-open detached DevTools; that window shows up in
  // app.windows() with a `devtools://` URL. Without this filter getTargetWindow
  // falls back to live[last] and picks DevTools, so openProject waits for
  // [data-project-card] inside DevTools and times out (root cause of the dev-leg
  // blocker). Harmless on the prod/throttle legs where DevTools never opens.
  return app
    .windows()
    .filter((candidate) => !candidate.isClosed())
    .filter((candidate) => {
      try {
        return !/^devtools:\/\//.test(candidate.url())
      } catch {
        return true
      }
    })
}

function getTargetWindow(app, fallback) {
  const live = pageWindows(app)
  return live.find((candidate) => /projectId=/.test(candidate.url())) || live[live.length - 1] || fallback
}

// Blank-point semantics live in `_canvasHit.mjs` (single owner): a point is
// blank only when React Flow's own pane is the topmost element there. The old
// local copy used a blocklist plus a hardcoded `left+16 / bottom-16` fallback —
// with the resident agent panel narrowing the stage, both could hand back a
// point sitting on a magnetic connect handle, which turns "pan the blank canvas"
// into "drag a connection" and silently measures the wrong gesture.
async function findBlank(page, preference = 'default', { inset = 0 } = {}) {
  const point = await findCanvasBlankPoint(page, { preference, inset })
  if (!point)
    throw new Error(`findBlank: no blank point on the stage (preference=${preference}, inset=${inset})`)
  return point
}

async function dragPath(page, start, end, steps = 60, interval = 16) {
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  for (let index = 1; index <= steps; index += 1) {
    const ratio = index / steps
    await page.mouse.move(start.x + (end.x - start.x) * ratio, start.y + (end.y - start.y) * ratio, { steps: 1 })
    if (interval > 0) await sleep(page, interval)
  }
  await page.mouse.up()
}

// action_latency (advisory): the benchmark probe records the first stage/edge
// mutation relative to probe start. Started immediately before pointerdown, that
// is the pointerdown→first-visual-feedback interval. Returns null when no
// mutation was observed. dragScenarios.mjs reads the same field for its runners.
async function readFirstFeedbackMs(page) {
  return page.evaluate(() => {
    const probe = window.__canvasPerformanceProbe
    const rec = probe && probe._record
    return rec && rec.firstMutationMs != null ? rec.firstMutationMs : null
  })
}

async function visibleNodeBox(page, kind) {
  const candidates = page.locator(`.generation-canvas-v2-node[data-kind="${kind}"]`)
  const count = await candidates.count()
  for (let index = 0; index < count; index += 1) {
    const box = await candidates
      .nth(index)
      .boundingBox()
      .catch(() => null)
    if (box && box.width > 20 && box.height > 20) return { locator: candidates.nth(index), box }
  }
  return null
}

// Node-identity guard. What it is here to catch: the node layer being REBUILT by
// React during an interaction (every card unmounted and re-mounted, which is what a
// broken memoisation boundary looks like from the DOM).
//
// What it must NOT flag: React Flow's own virtualization. `onlyRenderVisibleElements`
// unmounts a node when it leaves the visible window and mounts a *fresh* element when
// it comes back, so the element for that node id legitimately changes. That is product
// behaviour, and it fires far more often now that the resident agent panel takes ~340px
// off the stage: on the Linux runner (xvfb clamps the window to 1280 wide) the M-scale
// wheel-zoom excursion carries 3 of 9 cards out of the window and back, deterministically
// (CI runs 33945616926 and 33947462331 both report preserved 6 of 9; darwin at a wider
// stage reports 9 of 9).
//
// The two are separated without any timing threshold: React commits synchronously, so a
// rebuild's remove+add for one node id land in the SAME MutationObserver callback batch;
// a virtualization round trip is a removal in one batch and an addition in a later one
// (the node stays gone while it is off-window). So batch index is the discriminator.
async function captureNodeIdentity(page) {
  await page.evaluate(() => {
    const nodeId = (element) =>
      element instanceof HTMLElement && element.matches('.react-flow__node[data-id]')
        ? element.getAttribute('data-id')
        : null
    window.__canvasPerformanceNodeIdentity = new Map(
      Array.from(document.querySelectorAll('.react-flow__node[data-id]')).map((element) => [
        element.getAttribute('data-id'),
        element,
      ]),
    )
    window.__canvasPerformanceNodeChurn?.observer?.disconnect()
    const container = document.querySelector('.react-flow__nodes')
    const churn = new Map()
    const entryFor = (id) => {
      const existing = churn.get(id)
      if (existing) return existing
      const created = { removedBatch: null, readdedBatch: null, remountedInPlace: false }
      churn.set(id, created)
      return created
    }
    let batch = 0
    const observer = new MutationObserver((records) => {
      batch += 1
      for (const record of records) {
        for (const removed of record.removedNodes) {
          const id = nodeId(removed)
          if (id) entryFor(id).removedBatch = batch
        }
        for (const added of record.addedNodes) {
          const id = nodeId(added)
          if (!id) continue
          const entry = entryFor(id)
          if (entry.removedBatch === batch) entry.remountedInPlace = true
          else if (entry.removedBatch !== null) entry.readdedBatch = batch
        }
      }
    })
    if (container) observer.observe(container, { childList: true })
    window.__canvasPerformanceNodeChurn = { churn, observer }
  })
}

async function readNodeIdentity(page, targetNodeId = null) {
  return page.evaluate((targetId) => {
    const before = window.__canvasPerformanceNodeIdentity || new Map()
    const tracker = window.__canvasPerformanceNodeChurn
    tracker?.observer?.disconnect()
    const churn = tracker?.churn || new Map()
    const current = new Map(
      Array.from(document.querySelectorAll('.react-flow__node[data-id]')).map((element) => [
        element.getAttribute('data-id'),
        element,
      ]),
    )
    // Left the visible window and came back: a different element for the same id is
    // exactly what React Flow's virtualization is supposed to produce.
    const virtualizationChurn = [...churn.entries()]
      .filter(([, entry]) => entry.removedBatch !== null && !entry.remountedInPlace)
      .map(([id]) => id)
    const remountedInPlace = [...churn.entries()]
      .filter(([, entry]) => entry.remountedInPlace)
      .map(([id]) => id)
    const churned = new Set(virtualizationChurn)
    const commonIds = [...before.keys()].filter((id) => current.has(id))
    // Only nodes that stayed mounted for the whole action carry the identity contract.
    const trackedIds = commonIds.filter((id) => !churned.has(id))
    const preservedIds = trackedIds.filter((id) => before.get(id) === current.get(id))
    return {
      before: before.size,
      after: current.size,
      common: commonIds.length,
      tracked: trackedIds.length,
      preserved: preservedIds.length,
      virtualizationChurn,
      remountedInPlace,
      commonIdentityPreserved: preservedIds.length === trackedIds.length && remountedInPlace.length === 0,
      targetNodeId: targetId,
      targetIdentityPreserved: targetId ? before.get(targetId) === current.get(targetId) : null,
    }
  }, targetNodeId)
}

async function openProject(app, page, fixture) {
  const startedAt = Date.now()
  // The dev bundle transforms ~2MB of app modules on demand at first open, so
  // the library card and canvas take much longer to paint than the built dist.
  // Scale the open-path waits (not the interaction sampling) for the dev leg.
  const openScale = useDevServer ? 4 : 1
  if (!/projectId=/.test(page.url())) {
    const card = page.locator('[data-project-card]', { hasText: fixture.record.name }).first()
    await card.waitFor({ timeout: 12_000 * openScale })
    await card.click()
    await sleep(page, 1000)
    page = getTargetWindow(app, page)
    const continueButton = page
      .locator('[data-project-card]', { hasText: fixture.record.name })
      .getByText('继续创作')
      .first()
    if (await continueButton.count().catch(() => 0)) await continueButton.click().catch(() => {})
  }
  page = getTargetWindow(app, page)
  await page.locator('.generation-canvas-v2__stage').waitFor({ timeout: 20_000 * openScale })
  const firstCanvasMs = Date.now() - startedAt
  const settleStartedAt = Date.now()
  await page.waitForFunction(
    ({ nodeCount }) => {
      const mountedNodes = document.querySelectorAll('.generation-canvas-v2-node').length
      const nodesReady = nodeCount === 0 || mountedNodes > 0
      const virtualizationReady = nodeCount <= 50 || mountedNodes < nodeCount
      return nodesReady && virtualizationReady
    },
    { nodeCount: fixture.summary.nodes },
    { timeout: 20_000 * openScale },
  )
  await waitForVisibleMediaSettlement(page, {
    expectMedia: fixture.summary.imageNodes + fixture.summary.videoNodes > 0,
  })
  let stableReads = 0
  let previousKey = ''
  for (let attempt = 0; attempt < 20 && stableReads < 3; attempt += 1) {
    await sleep(page, 250)
    const snapshot = await pageSnapshot(page)
    const key = [
      snapshot.canvasNodes,
      snapshot.imageElements,
      snapshot.videoElements,
      snapshot.loadedImages,
      snapshot.loadedVideos,
    ].join(':')
    stableReads = key === previousKey ? stableReads + 1 : 0
    previousKey = key
  }
  const settled = await pageSnapshot(page)
  return { page, firstCanvasMs, mediaSettledMs: Date.now() - settleStartedAt, settled }
}

async function prepareScenario(page, scenario) {
  if (scenario !== 'marquee-select' && scenario !== 'low-zoom-preview') return
  const stage = await page.locator('.generation-canvas-v2__stage').boundingBox()
  if (!stage) throw new Error('画布 stage 不存在')
  await page.mouse.move(stage.x + stage.width * 0.5, stage.y + stage.height * 0.5)
  const targetZoom = scenario === 'low-zoom-preview' ? 0.45 : 0.72
  for (let index = 0; index < 20; index += 1) {
    const zoom = await page.evaluate(
      () =>
        new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.generation-canvas-v2__canvas')).transform).a,
    )
    if (zoom <= targetZoom) break
    await page.mouse.wheel(0, 100)
    await sleep(page, 60)
  }
  await sleep(page, 800)
}

function combineProbeSummaries(probes) {
  if (!probes.length) return null
  const value = (field) => probes.map((probe) => probe?.[field]).filter(Number.isFinite)
  const sum = (field) => value(field).reduce((total, current) => total + current, 0)
  const max = (field) => (value(field).length ? Math.max(...value(field)) : null)
  return {
    elapsedMs: sum('elapsedMs'),
    frames: sum('frames'),
    fps: quantile(value('fps'), 0.5),
    frameGapP50Ms: quantile(value('frameGapP50Ms'), 0.5),
    frameGapP95Ms: max('frameGapP95Ms'),
    maxFrameGapMs: max('maxFrameGapMs'),
    longTasks: sum('longTasks'),
    longTaskMs: sum('longTaskMs'),
    longTaskP95Ms: max('longTaskP95Ms'),
    maxLoadingImages: max('maxLoadingImages'),
    maxLoadingVideos: max('maxLoadingVideos'),
    maxActiveVideos: max('maxActiveVideos'),
    firstMutationMs: quantile(value('firstMutationMs'), 0.5),
    mutations: Object.fromEntries(
      ['stage', 'edges', 'labels'].map((key) => [
        key,
        probes.reduce((total, probe) => total + (probe?.mutations?.[key] || 0), 0),
      ]),
    ),
  }
}

async function runAction(page, scenario, fixture) {
  const stage = await page.locator('.generation-canvas-v2__stage').boundingBox()
  if (!stage) throw new Error('画布 stage 不存在')
  if (scenario === 'blank-pan') {
    const start = await findBlank(page)
    if (!start) throw new Error('找不到可用于平移的画布空白点')
    await dragPath(page, start, { x: start.x - 260, y: start.y - 140 })
    // 60 steps at 16ms in dragPath; record for the drag/pan ratio denominator.
    return { moves: 60, firstFeedbackMs: await readFirstFeedbackMs(page) }
  }
  if (scenario === 'node-drag-image' || scenario === 'node-drag-video') {
    const kind = scenario.endsWith('image') ? 'image' : 'video'
    const node = await visibleNodeBox(page, kind)
    if (!node) throw new Error(`没有可见的 ${kind} 节点`)
    const start = { x: node.box.x + node.box.width * 0.5, y: node.box.y + 14 }
    await dragPath(page, start, { x: start.x + 180, y: start.y + 90 })
    return { nodeId: await node.locator.getAttribute('data-node-id'), moves: 60, firstFeedbackMs: await readFirstFeedbackMs(page) }
  }
  if (scenario === 'multi-node-drag') return runMultiNodeDrag(page)
  if (scenario === 'drag-over-dense-edges') {
    return runDragOverDenseEdges(page, fixture.record.payload.generationCanvas.edges)
  }
  if (scenario === 'drag-at-low-zoom') {
    // Only >80-node fixtures cross the lightweight threshold; the harness wires
    // this scenario to a scale that does. Zoom out first so LOD can engage.
    await zoomOutTo(page, 0.45)
    return runDragAtLowZoom(page)
  }
  if (scenario === 'marquee-select') {
    const boxes = []
    const nodes = page.locator('.generation-canvas-v2-node')
    const mountedNodeCount = await nodes.count()
    for (let index = 0; index < Math.min(50, mountedNodeCount); index += 1) {
      const box = await nodes
        .nth(index)
        .boundingBox()
        .catch(() => null)
      if (box) boxes.push(box)
    }
    if (!boxes.length) throw new Error('没有可见节点可框选')
    const left = Math.min(...boxes.map((box) => box.x))
    const top = Math.min(...boxes.map((box) => box.y))
    const right = Math.max(...boxes.map((box) => box.x + box.width))
    const bottom = Math.max(...boxes.map((box) => box.y + box.height))
    // 起点和终点都必须留在自动平移安全区内。否则 React Flow 会按 requestAnimationFrame
    // 自动平移视口，这一笔扫过的区域就变成「这台机器画了多少帧」的函数——同一份代码
    // 在 darwin 上实测 9/12 跳变、在 Linux CI 上 8/12 跳变，全是这么来的。
    const start = await findBlank(page, 'top-left', { inset: AUTO_PAN_SAFE_MARGIN_PX })
    const end = clampIntoAutoPanSafeArea({ x: right + 30, y: bottom + 30 }, stage)
    const swept = sweptRect(start, end)
    // 期望值从**扫过的这块区域**derive，不再写死节点个数：节点个数随窗口尺寸变，
    // 而窗口尺寸在 CI 和本机并不一样（这正是原来那个 12 在 Linux 上翻红的原因）。
    const expectedSelection = expectedFullySelected(boxes, swept)
    await page.keyboard.down('Shift')
    await dragPath(page, start, end, 60, 12)
    await page.keyboard.up('Shift')
    return {
      selected: await page.locator('.generation-canvas-v2-node[data-selected="true"]').count(),
      mountedNodeCount,
      expectedSelection,
      nodeBandCoverage: Math.round(nodeBandCoverage(swept, boxes, stage) * 1000) / 1000,
      swept,
      bounds: { left, top, right, bottom },
    }
  }
  if (scenario === 'click-select') {
    const nodes = page.locator('.generation-canvas-v2-node')
    // Select every mounted node once. Repeatedly clicking the same media node
    // would intentionally trigger its double-click preview, changing the
    // workload from multi-select into a full-screen media dialog.
    const count = Math.min(20, await nodes.count())
    await page.keyboard.down('Shift')
    try {
      for (let index = 0; index < count; index += 1) {
        const box = await nodes
          .nth(index)
          .boundingBox()
          .catch(() => null)
        if (!box) continue
        await page.mouse.click(box.x + box.width * 0.45, box.y + 14)
        await sleep(page, 20)
      }
    } finally {
      await page.keyboard.up('Shift')
    }
    const selectionBeforeClear = {
      domainSelected: await page.locator('.generation-canvas-v2-node[data-selected="true"]').count(),
      flowSelected: await page.locator('.react-flow__node.selected').count(),
      lightweight: await page.locator('.generation-canvas-v2-node[data-render-mode="lightweight"]').count(),
      mounted: await nodes.count(),
    }
    const blank = await findBlank(page)
    if (!blank) throw new Error('找不到可用于清空选择的画布空白点')
    const blankHit = await page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y)
      const stage = document.querySelector('.generation-canvas-v2__stage')
      const mediaRects = Array.from(document.querySelectorAll('img,video')).map((media) => {
        const rect = media.getBoundingClientRect()
        return {
          tag: media.tagName,
          className: String(media.className || ''),
          nodeId: media.closest('.generation-canvas-v2-node')?.getAttribute('data-node-id') ?? null,
          nodeRect: (() => {
            const node = media.closest('.generation-canvas-v2-node')
            return node ? (node.getBoundingClientRect().toJSON?.() ?? null) : null
          })(),
          x: rect.x,
          y: rect.y,
          right: rect.right,
          bottom: rect.bottom,
          pointerEvents: getComputedStyle(media).pointerEvents,
        }
      })
      const ancestors = element
        ? Array.from({ length: 6 }, (_, index) => {
            let current = element
            for (let step = 0; step < index; step += 1) current = current?.parentElement
            return current
              ? { tag: current.tagName, className: String(current.className || ''), id: current.id || '' }
              : null
          }).filter(Boolean)
        : []
      const nodeRects = Array.from(document.querySelectorAll('.generation-canvas-v2-node'))
        .slice(0, 6)
        .map((node) => {
          const rect = node.getBoundingClientRect()
          return { id: node.getAttribute('data-node-id'), x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom }
        })
      return element
        ? {
            tag: element.tagName,
            className: String(element.className || ''),
            id: element.id || '',
            ancestors,
            stageRect: stage?.getBoundingClientRect().toJSON?.() ?? null,
            mediaRects,
            nodeRects,
          }
        : { ancestors, stageRect: stage?.getBoundingClientRect().toJSON?.() ?? null, mediaRects, nodeRects }
    }, blank)
    await page.mouse.click(blank.x, blank.y)
    // The stage is covered by a pointer-transparent SVG; force the same
    // coordinate through the stage target when native hit-testing lands on a
    // transient overlay (minimap/navigation).
    if (await page.locator('.generation-canvas-v2-node[data-selected="true"]').count()) {
      const stageBox = await page.locator('.generation-canvas-v2__stage').boundingBox()
      if (stageBox)
        await page
          .locator('.generation-canvas-v2__stage')
          .click({ position: { x: 16, y: stageBox.height - 16 }, force: true })
    }
    await sleep(page, 250)
    return {
      selectedAfterClear: await page.locator('.generation-canvas-v2-node[data-selected="true"]').count(),
      selectionBeforeClear,
      blank,
      blankHit,
    }
  }
  if (scenario === 'wheel-zoom') {
    const anchor = { x: stage.x + stage.width * 0.58, y: stage.y + stage.height * 0.46 }
    const before = await page.evaluate(() => {
      const layer = document.querySelector('.generation-canvas-v2__canvas')
      const matrix = new DOMMatrixReadOnly(getComputedStyle(layer).transform)
      return { x: matrix.m41, y: matrix.m42, zoom: matrix.a }
    })
    await page.mouse.move(anchor.x, anchor.y)
    for (let index = 0; index < 60; index += 1) {
      await page.mouse.wheel(0, index % 2 ? 100 : -100)
      await sleep(page, 16)
    }
    const after = await page.evaluate(() => {
      const layer = document.querySelector('.generation-canvas-v2__canvas')
      const matrix = new DOMMatrixReadOnly(getComputedStyle(layer).transform)
      return { x: matrix.m41, y: matrix.m42, zoom: matrix.a }
    })
    const canvasPoint = (transform) => ({
      x: (anchor.x - stage.x - transform.x) / transform.zoom,
      y: (anchor.y - stage.y - transform.y) / transform.zoom,
    })
    const beforePoint = canvasPoint(before)
    const afterPoint = canvasPoint(after)
    return {
      before,
      after,
      anchorErrorPx: Math.round(Math.hypot(afterPoint.x - beforePoint.x, afterPoint.y - beforePoint.y) * 100) / 100,
    }
  }
  if (scenario === 'pan-zoom-mix') {
    const start = await findBlank(page)
    if (!start) throw new Error('找不到可用于混合平移缩放的画布空白点')
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    for (let index = 1; index <= 30; index += 1) {
      await page.mouse.move(start.x - index * 3, start.y - index * 2)
      await sleep(page, 16)
    }
    const beforeZoom = await page.evaluate(
      () =>
        new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.generation-canvas-v2__canvas')).transform).a,
    )
    await page.mouse.wheel(0, -220)
    await sleep(page, 120)
    const afterZoom = await page.evaluate(
      () =>
        new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.generation-canvas-v2__canvas')).transform).a,
    )
    const beforeX = await page.evaluate(
      () =>
        new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.generation-canvas-v2__canvas')).transform).m41,
    )
    await page.mouse.move(start.x - 30 * 3 + 10, start.y - 30 * 2)
    await sleep(page, 100)
    const afterStep = await page.evaluate(
      () =>
        new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.generation-canvas-v2__canvas')).transform).m41,
    )
    await page.mouse.up()
    const stepDelta = afterStep - beforeX
    return { beforeZoom, afterZoom, stepDelta, stepErrorPx: Math.abs(stepDelta - 10) }
  }
  if (scenario === 'resize') {
    const node = (await visibleNodeBox(page, 'image')) || (await visibleNodeBox(page, 'video'))
    if (!node) throw new Error('没有可见节点可缩放')
    await node.locator.click({ position: { x: node.box.width * 0.45, y: 14 } })
    await sleep(page, 120)
    const nodeId = await node.locator.getAttribute('data-node-id')
    if (!nodeId) throw new Error('selected node is missing data-node-id')
    // React Flow owns resize controls on the outer flow node, while the
    // legacy business card remains nested inside it.
    const handle = page.locator(
      `.react-flow__node[data-id="${nodeId}"] .react-flow__resize-control.handle.bottom.right`,
    )
    const box = await handle.boundingBox()
    if (!box) throw new Error('选中节点后找不到右下角缩放把手')
    await dragPath(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: box.x + 100, y: box.y + 60 })
    return { nodeId: await node.locator.getAttribute('data-node-id') }
  }
  if (scenario === 'media-reveal') {
    const snapshots = []
    for (let index = 0; index < 5; index += 1) {
      const start = await findBlank(page)
      if (!start) throw new Error('找不到可用于媒体切入的画布空白点')
      await dragPath(page, start, { x: start.x - 80, y: start.y - 190 }, 30, 12)
      await sleep(page, 220)
      snapshots.push(await pageSnapshot(page))
    }
    return {
      snapshots,
      settled: await waitForVisibleMediaSettlement(page, {
        expectMedia: fixture.summary.imageNodes + fixture.summary.videoNodes > 0,
      }),
    }
  }
  if (scenario === 'low-zoom-preview') {
    const settled = await waitForVisibleMediaSettlement(page, {
      expectMedia: fixture.summary.imageNodes + fixture.summary.videoNodes > 0,
    })
    return { settled, zoom: settled.transform?.zoom ?? null }
  }
  if (scenario === 'media-error') {
    // Keep the project valid through hydration. Inject the missing asset only
    // after the real canvas is mounted so this scenario measures the renderer's
    // visible failure/retry path rather than a project-open failure.
    const missingUrl = `nomi-local://asset/${encodeURIComponent(fixture.record.id)}/assets/generated/canvas-performance/missing.png`
    const mediaSelector = '.generation-canvas-v2-node[data-kind="image"] img[src]'
    const failureSelector = '[data-node-media-failure="error"]'
    const waitForMountedMedia = async (nodeId) => {
      const media = page.locator(`.generation-canvas-v2-node[data-node-id="${nodeId}"] img[src]`).first()
      await media.waitFor({ timeout: 10_000 })
      return media
    }
    const dispatchMediaError = async (targetNodeId = null) => {
      const nodeId = await page.evaluate(({ url, selector, targetNodeId: requestedNodeId }) => {
        const candidate = Array.from(document.querySelectorAll(selector)).find((element) => {
          const node = element.closest('.generation-canvas-v2-node')
          const rect = element.getBoundingClientRect()
          return (
            (!requestedNodeId || node?.getAttribute('data-node-id') === requestedNodeId) &&
            rect.width > 2 &&
            rect.height > 2 &&
            rect.bottom > 0 &&
            rect.top < innerHeight
          )
        })
        if (!candidate) return null
        candidate.setAttribute('src', url)
        // Setting src directly does not guarantee a network error event in the
        // Electron test protocol. Dispatch the same renderer event explicitly
        // so the real React onError path is exercised deterministically.
        candidate.dispatchEvent(new Event('error'))
        return candidate.closest('.generation-canvas-v2-node')?.getAttribute('data-node-id')
      }, { url: missingUrl, selector: mediaSelector, targetNodeId })
      if (!nodeId) throw new Error('没有可见图片节点可注入媒体错误')
      return nodeId
    }
    const failure = page.locator(failureSelector).first()
    const nodeId = await dispatchMediaError()
    await failure.waitFor({ timeout: 10_000 })
    const initialFailure = (await page.locator(failureSelector).count()) === 1
    await failure.getByRole('button', { name: '重试' }).click()
    await waitForMountedMedia(nodeId)
    await dispatchMediaError(nodeId)
    await failure.waitFor({ timeout: 10_000 })
    const retryFailure = (await page.locator(failureSelector).count()) === 1
    await failure.getByRole('button', { name: '重试' }).click()
    const recoveredMedia = await waitForMountedMedia(nodeId)
    await recoveredMedia.evaluate((element) => element.dispatchEvent(new Event('load')))
    await failure.waitFor({ state: 'detached', timeout: 10_000 })
    return {
      explicitFailures: Number(initialFailure) + Number(retryFailure),
      initialFailure,
      retryFailure,
      recoverySuccess: (await page.locator(failureSelector).count()) === 0,
      retryCompleted: true,
    }
  }
  if (scenario === 'video-hover') {
    const nodes = page.locator('.generation-canvas-v2-node[data-kind="video"]')
    const count = Math.min(12, await nodes.count())
    for (let index = 0; index < count; index += 1) {
      const box = await nodes
        .nth(index)
        .boundingBox()
        .catch(() => null)
      if (!box) continue
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await sleep(page, 180)
    }
    await page.mouse.move(stage.x + stage.width - 12, stage.y + stage.height - 12)
    return { hoveredNodes: count }
  }
  if (scenario === 'reload-heavy') {
    const snapshots = [await pageSnapshot(page)]
    const reloadDurationsMs = []
    const reloadProbes = []
    for (let index = 0; index < 3; index += 1) {
      const startedAt = Date.now()
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.locator('.generation-canvas-v2__stage').waitFor({ timeout: 20_000 })
      await page.waitForFunction(
        ({ nodeCount }) => {
          const mountedNodes = document.querySelectorAll('.generation-canvas-v2-node').length
          return nodeCount === 0 || mountedNodes > 0
        },
        { nodeCount: fixture.summary.nodes },
        { timeout: 20_000 },
      )
      await waitForVisibleMediaSettlement(page, {
        expectMedia: fixture.summary.imageNodes + fixture.summary.videoNodes > 0,
      })
      reloadDurationsMs.push(Date.now() - startedAt)
      await installProbe(page)
      await page.evaluate(() => window.__canvasPerformanceProbe.start())
      await sleep(page, 700)
      reloadProbes.push(await page.evaluate(() => window.__canvasPerformanceProbe.stop()))
      snapshots.push(await pageSnapshot(page))
    }
    const heapValues = snapshots.map((snapshot) => snapshot.jsHeapUsedMB).filter(Number.isFinite)
    return {
      snapshots,
      reloadDurationsMs,
      reloadProbes,
      reloadHeapDeltaMB: heapValues.length > 1 ? Math.round((heapValues.at(-1) - heapValues[0]) * 10) / 10 : null,
    }
  }
  throw new Error(`未实现的场景：${scenario}`)
}

async function runScenario({ scale, scenario, runIndex, rootDir }) {
  const scenarioRoot = path.join(rootDir, scale, scenario, String(runIndex))
  fs.rmSync(scenarioRoot, { recursive: true, force: true })
  const projectsDir = path.join(scenarioRoot, 'projects')
  const userDataDir = path.join(scenarioRoot, 'user-data')
  fs.mkdirSync(userDataDir, { recursive: true })
  const fixture = createCanvasPerformanceFixture({
    projectsDir,
    scale,
    projectId: `project-canvas-perf-${scale.toLowerCase()}-${scenario}-${runIndex}`,
    projectName: `ZZ Canvas 性能 ${scale} ${scenario} ${runIndex}`,
  })
  let app = null
  let page = null
  const pageErrors = []
  const consoleErrors = []
  const attachDiagnostics = (candidate) => {
    candidate.on('pageerror', (error) => pageErrors.push(String(error)))
    candidate.on('console', (message) => {
      if (message.type() !== 'error') return
      const text = message.text()
      const expectedMissingFixture = scenario === 'media-error' && text.includes('404 (Not Found)')
      // Dev leg only: NOMI_DESKTOP_DEV=1 makes electron/main.ts:361 open DevTools,
      // whose frontend probes CDP domains (Autofill.enable / Autofill.setAddresses)
      // this Chromium build does not implement, emitting `-32601 method wasn't
      // found` console errors. Pure DevTools-frontend noise, unrelated to Nomi's
      // renderer — filtering it keeps the (byte-for-byte unchanged) console-error
      // hard-failure gate honest instead of failing the dev leg on a tooling quirk.
      const devtoolsAutofillNoise = useDevServer && /Request Autofill\.\w+ failed/.test(text)
      if (!expectedMissingFixture && !devtoolsAutofillNoise) consoleErrors.push(text)
    })
  }
  const startedAt = Date.now()
  try {
    ;({ app, win: page } = await launchNomiApp({
      name: 'canvas-perf-benchmark',
      userDataDir,
      settingsDir: userDataDir,
      projectsDir,
      args: ['--no-proxy-server'],
      timeout: launchTimeoutMs,
      settleMs: 900,
      env: {
        // Capability core is orthogonal to canvas rendering and can add a
        // local RPC process during startup; keep it out of interaction samples.
        NOMI_DISABLE_CAPABILITY_CORE: process.env.NOMI_DISABLE_CAPABILITY_CORE || '1',
        // eval v2 dev leg: load the running Vite dev server (dev bundle +
        // StrictMode) instead of the built dist renderer. electron/main.ts:227
        // reads NOMI_RENDERER_URL; NOMI_DESKTOP_DEV=1 flips isDev so the dev CSP
        // (electron/main.ts:657-663) allows the React Fast Refresh inline
        // preamble — without it the production CSP blocks the preamble and React
        // never mounts (observed: "@vitejs/plugin-react can't detect preamble").
        // Unset otherwise → normal dist behaviour.
        ...(useDevServer && devRendererUrl
          ? { NOMI_RENDERER_URL: devRendererUrl, NOMI_DESKTOP_DEV: '1' }
          : {}),
      },
    }))
    attachDiagnostics(page)
    app.on('window', attachDiagnostics)
    page = getTargetWindow(app, page)
    // Off-canvas render probe (advisory + U4 positive control) only reads
    // meaningfully on the dev bundle where component names survive. Register it
    // as an init script and reload once so the hook is present before React's
    // first commit on a fresh document. Prod bundle: skip (names are mangled).
    if (useDevServer) {
      await installOffCanvasRenderProbe(page)
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
      // Dev bundle transforms modules on demand → first paint is slower than the
      // built dist. Give it room before openProject looks for the project card.
      await sleep(page, 2500)
      page = getTargetWindow(app, page)
    }
    const browserWindow = await app.browserWindow(page)
    await browserWindow.evaluate((target) => {
      target.setBounds({ x: 0, y: 0, width: 1600, height: 1000 })
      target.center()
    })
    await sleep(page, 350)
    const opened = await openProject(app, page, fixture)
    page = opened.page
    const cold =
      scenario === 'cold-open'
        ? { firstCanvasMs: opened.firstCanvasMs, mediaSettledMs: opened.mediaSettledMs, settled: opened.settled }
        : null
    const cdp = await app.context().newCDPSession(page)
    await cdp.send('Performance.enable').catch(() => {})
    await cdp.send('Memory.enable').catch(() => {})
    // eval v2 throttle leg: model a median machine. Same CDP call and shape used
    // by scripts/scene3d-drag-jitter-walkthrough.mjs on this Electron build.
    if (cpuThrottleRate > 1) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottleRate }).catch(() => {})
    }
    await installProbe(page)
    if (scenario !== 'cold-open') await sleep(page, 500)
    await prepareScenario(page, scenario)
    if (scenario === 'marquee-select') await sleep(page, 500)
    const beforePage = await pageSnapshot(page)
    if (captureScreenshots) {
      fs.mkdirSync(path.join(outputDir, `canvas-${label}-shots`), { recursive: true })
      await page.screenshot({
        path: path.join(outputDir, `canvas-${label}-shots`, `${scale}-${scenario}-${runIndex}-before.png`),
      })
    }
    if (scenario === 'cold-open') {
      return {
        scale,
        scenario,
        runIndex,
        fixture: fixture.summary,
        cold,
        beforePage,
        appMetrics: await getAppMetrics(app),
        runtimeVersions: await getRuntimeVersions(app),
        pageErrors,
        consoleErrors,
        elapsedMs: Date.now() - startedAt,
      }
    }
    const cdpBefore = await getCdpMetrics(cdp)
    const probeSurvivesAction = scenario !== 'reload-heavy'
    if (probeSurvivesAction) {
      await captureNodeIdentity(page)
      await page.evaluate(() => window.__canvasPerformanceProbe.start())
    }
    // Record off-canvas re-renders for this action window (advisory / positive
    // control). No-op unless the dev-leg probe installed.
    const offCanvasStarted = useDevServer && probeSurvivesAction ? await startOffCanvasRenderWindow(page) : false
    const actionDetails = await runAction(page, scenario, fixture)
    const offCanvasRender = offCanvasStarted ? await stopOffCanvasRenderWindow(page) : null
    await sleep(page, 250)
    const probe = probeSurvivesAction
      ? await page.evaluate(() => window.__canvasPerformanceProbe.stop())
      : combineProbeSummaries(actionDetails?.reloadProbes || [])
    const cdpAfter = await getCdpMetrics(cdp)
    const afterPage = await pageSnapshot(page)
    if (captureScreenshots) {
      await page.screenshot({
        path: path.join(outputDir, `canvas-${label}-shots`, `${scale}-${scenario}-${runIndex}-after.png`),
      })
    }
    const nodeIdentity = probeSurvivesAction ? await readNodeIdentity(page, actionDetails?.nodeId) : null
    return {
      scale,
      scenario,
      runIndex,
      fixture: fixture.summary,
      probe,
      cdpBefore,
      cdpAfter,
      cdpDelta: diffMetrics(cdpBefore, cdpAfter),
      beforePage,
      page: afterPage,
      actionDetails,
      offCanvasRender,
      nodeIdentity,
      appMetrics: await getAppMetrics(app),
      runtimeVersions: await getRuntimeVersions(app),
      pageErrors,
      consoleErrors,
      elapsedMs: Date.now() - startedAt,
    }
  } catch (error) {
    return {
      scale,
      scenario,
      runIndex,
      fixture: fixture.summary,
      error: String(error?.stack || error),
      pageErrors,
      consoleErrors,
      elapsedMs: Date.now() - startedAt,
    }
  } finally {
    await app?.close().catch(() => {})
  }
}

function parseNumericSamples(samples, read) {
  return samples.map(read).filter((value) => Number.isFinite(value))
}

// Platform calibration factor for timing budgets.
// Constraint: the timing ceilings below are calibrated against darwin
// (the committed reference run canvas-pr216-acceptance.json is darwin/arm64,
// e.g. resize frameGapP95 ≈ 16.4ms). CI executes on Linux under xvfb software
// rendering, which is measured 1.3–2x slower than the darwin calibration source
// for the same code (same-machine A/B: main resize 30.8 vs the 33 ceiling,
// #243 28.1, #239 19.2 — all ≤ main, no real regression, yet CI reported 38–44).
// We scale timing ceilings by a conservative upper bound of the observed slowdown
// so a darwin-calibrated hard floor stops manufacturing false reds on the slower
// substrate. This is a measurement correction, not a loosening of the standard:
// only latency budgets scale; semantic activation counts and the heap-leak budget
// stay fixed across platforms (inflating those would mask real regressions).
const NON_DARWIN_TIMING_CALIBRATION = 1.6

function timingBudget(baseMax) {
  return os.platform() === 'darwin' ? baseMax : Math.round(baseMax * NON_DARWIN_TIMING_CALIBRATION)
}

// maxFrameGapMs is recorded and reported but does NOT gate PASS/FAIL.
//
// Why advisory-only: single-frame worst-case is acutely sensitive to machine
// contention and video-decode scheduling. On a clean darwin prod build,
// node-drag-video maxGap ranged 41.9–140 ms across runs while the P95 was
// healthy; dev/throttle legs hit 101–4252 ms. S5 and S4 acceptance each
// showed 1/5 samples with a tail outlier while the median was fine. A hard
// ceiling on a metric this volatile manufactures false-red CI without
// catching real regressions — the P95 budget (frameGapP95Ms ≤ 33 ms) is the
// calibrated, stable indicator; that one stays gating. (#264 lesson: harden
// only after cross-platform data confirms stability.)
const PERFORMANCE_BUDGETS = [
  { metric: 'frameGapP95Ms', max: timingBudget(33) },
  { metric: 'maxFrameGapMs', max: timingBudget(100), advisory: true },
  { metric: 'longTaskP95Ms', max: timingBudget(80) },
  { metric: 'maxLoadingImages', max: 4 },
  { metric: 'maxLoadingVideos', max: 1 },
  { metric: 'maxActiveVideos', max: 1 },
  { metric: 'reloadHeapDeltaMB', max: 10 },
]

function sampleHardFailures(sample) {
  const failures = []
  if (sample.error) failures.push(`scenario error: ${sample.error.split('\n')[0]}`)
  for (const error of sample.pageErrors || []) failures.push(`page error: ${error}`)
  for (const error of sample.consoleErrors || []) failures.push(`console error: ${error}`)
  if (sample.actionDetails?.anchorErrorPx > 1.5)
    failures.push(`zoom anchor drift ${sample.actionDetails.anchorErrorPx}px > 1.5px`)
  if (sample.actionDetails?.stepErrorPx > 1.5)
    failures.push(`pan/zoom continuation error ${sample.actionDetails.stepErrorPx}px > 1.5px`)
  if (sample.actionDetails?.selectedAfterClear !== undefined && sample.actionDetails.selectedAfterClear !== 0)
    failures.push(`blank click left ${sample.actionDetails.selectedAfterClear} selected nodes`)
  if (sample.scenario === 'marquee-select' && !sample.error && Number.isFinite(sample.actionDetails?.selected)) {
    const { selected, expectedSelection, nodeBandCoverage: bandCoverage } = sample.actionDetails
    // ① 框选正确性：框里的节点必须全被选中，框外的一个都不能进来。
    //    区间的上下界差的只是压在框线上那几个节点（DOM 与 React Flow 的亚像素分歧），
    //    真实的少选/多选回归依然会红。
    if (Number.isFinite(expectedSelection?.definite) && Number.isFinite(expectedSelection?.possible)) {
      if (selected < expectedSelection.definite || selected > expectedSelection.possible)
        failures.push(
          `marquee selected ${selected} nodes, expected ${expectedSelection.definite}–${expectedSelection.possible} `
            + 'fully inside the swept rect',
        )
    } else {
      failures.push('marquee sample did not record a derived selection expectation')
    }
    // ② 场景非退化：这一笔得真的把「够得着的那片节点」整个圈进去。用覆盖率代替原先写死的
    //    「至少 12 个节点」——覆盖率是无量纲的，不随 stage 尺寸漂移，也不含任何时间量，
    //    所以它既不会因为机器快慢翻红，也不会因为换了个窗口大小翻红。
    if (Number.isFinite(bandCoverage) && bandCoverage < MIN_NODE_BAND_COVERAGE)
      failures.push(
        `marquee covered only ${Math.round(bandCoverage * 100)}% of the reachable node band `
          + `(needs ≥ ${Math.round(MIN_NODE_BAND_COVERAGE * 100)}%)`,
      )
  }
  // eval v2 scenario integrity guards (correctness, not perf budgets): if a new
  // scenario silently degenerated (grabbed too few nodes / no dense band), the
  // sample would look "clean" for the wrong reason. Fail it explicitly so the
  // baseline is not built on a mis-measured window.
  if (
    sample.scenario === 'multi-node-drag' &&
    !sample.error &&
    Number.isFinite(sample.actionDetails?.selected) &&
    sample.actionDetails.selected < 2
  )
    failures.push(`multi-node-drag selected only ${sample.actionDetails.selected} nodes (needs ≥2)`)
  if (
    sample.scenario === 'drag-over-dense-edges' &&
    !sample.error &&
    Number.isFinite(sample.actionDetails?.connectedEdges) &&
    sample.actionDetails.connectedEdges < 1
  )
    failures.push('drag-over-dense-edges dragged a node with 0 connected edges')
  if (sample.nodeIdentity?.commonIdentityPreserved === false) {
    const remounted = sample.nodeIdentity.remountedInPlace || []
    failures.push(
      remounted.length
        ? `node layer rebuilt in place: ${remounted.join(', ')}`
        : `continuously mounted node DOM identity changed (${sample.nodeIdentity.preserved}/${sample.nodeIdentity.tracked} preserved)`,
    )
  }
  if (sample.nodeIdentity?.targetIdentityPreserved === false)
    failures.push(`target node DOM identity changed: ${sample.nodeIdentity.targetNodeId}`)
  if (sample.probe?.maxLoadingImages > 4) failures.push(`image activation peak ${sample.probe.maxLoadingImages} > 4`)
  if (sample.probe?.maxLoadingVideos > 1) failures.push(`video activation peak ${sample.probe.maxLoadingVideos} > 1`)
  if (sample.probe?.maxActiveVideos > 1)
    failures.push(`simultaneously playing videos ${sample.probe.maxActiveVideos} > 1`)
  if (sample.scenario === 'media-error') {
    if (sample.actionDetails?.initialFailure !== true) failures.push('media failure did not surface initially')
    if (sample.actionDetails?.retryFailure !== true) failures.push('media failure did not surface after retry')
    if (sample.actionDetails?.recoverySuccess !== true) failures.push('media failure did not recover successfully')
  }
  if (sample.scenario === 'low-zoom-preview' && !sample.error && sample.fixture?.nodes > 80) {
    const zoom = sample.actionDetails?.zoom
    const lightweightNodeCount = sample.actionDetails?.settled?.lightweightCanvasNodes
    const lightweightPreviewCount = sample.actionDetails?.settled?.lightweightPreviewNodes
    if (!Number.isFinite(zoom) || zoom >= 0.55) {
      failures.push(`low-zoom scenario settled above lightweight threshold: ${zoom ?? 'unknown'}`)
    } else if (!Number.isFinite(lightweightNodeCount) || lightweightNodeCount < 1) {
      failures.push('low-zoom scenario did not mount any lightweight nodes')
    } else if (!Number.isFinite(lightweightPreviewCount) || lightweightPreviewCount < 1) {
      failures.push('low-zoom lightweight nodes rendered without any media preview')
    }
  }
  const settledSnapshots = [sample.cold?.settled, sample.actionDetails?.settled]
    .filter(Boolean)
    .concat(sample.scenario === 'reload-heavy' ? sample.actionDetails?.snapshots || [] : [])
  for (const snapshot of settledSnapshots) {
    if (snapshot.visibleMediaPending > 0) {
      failures.push(`${snapshot.visibleMediaPending} visible media nodes never reached a visible terminal state`)
      break
    }
  }
  return failures
}

function summarizeScenario(samples, panControl = null) {
  const metricPaths = [
    ['coldFirstCanvasMs', (sample) => sample.cold?.firstCanvasMs],
    ['coldMediaSettledMs', (sample) => sample.cold?.mediaSettledMs],
    ['fps', (sample) => sample.probe?.fps],
    ['frameGapP95Ms', (sample) => sample.probe?.frameGapP95Ms],
    ['maxFrameGapMs', (sample) => sample.probe?.maxFrameGapMs],
    ['longTaskMs', (sample) => sample.probe?.longTaskMs],
    ['longTaskP95Ms', (sample) => sample.probe?.longTaskP95Ms],
    ['maxLoadingImages', (sample) => sample.probe?.maxLoadingImages],
    ['maxLoadingVideos', (sample) => sample.probe?.maxLoadingVideos],
    ['maxActiveVideos', (sample) => sample.probe?.maxActiveVideos],
    ['layoutCount', (sample) => sample.cdpDelta?.LayoutCount],
    ['recalcStyleCount', (sample) => sample.cdpDelta?.RecalcStyleCount],
    ['scriptDurationMs', (sample) => sample.cdpDelta?.ScriptDurationMs],
    ['layoutDurationMs', (sample) => sample.cdpDelta?.LayoutDurationMs],
    ['jsHeapUsedMB', (sample) => sample.page?.jsHeapUsedMB],
    ['visibleMedia', (sample) => sample.page?.visibleMedia],
    ['visibleMediaNodes', (sample) => sample.page?.visibleMediaNodes],
    ['visibleMediaPending', (sample) => sample.page?.visibleMediaPending],
    ['visibleMediaFailures', (sample) => sample.page?.visibleMediaFailures],
    ['loadedImages', (sample) => sample.page?.loadedImages],
    ['loadedVideos', (sample) => sample.page?.loadedVideos],
    ['activeVideos', (sample) => sample.page?.activeVideos],
    ['rendererWorkingSetMB', (sample) => sample.appMetrics?.rendererWorkingSetMB],
    ['reloadHeapDeltaMB', (sample) => sample.actionDetails?.reloadHeapDeltaMB],
    ['reloadDurationP95Ms', (sample) => quantile(sample.actionDetails?.reloadDurationsMs || [], 0.95)],
  ]
  const metrics = Object.fromEntries(
    metricPaths.map(([name, read]) => {
      const values = parseNumericSamples(samples, read).sort((a, b) => a - b)
      return [
        name,
        values.length ? { median: quantile(values, 0.5), p95: quantile(values, 0.95), samples: values } : null,
      ]
    }),
  )
  const hardFailures = samples.flatMap((sample) =>
    sampleHardFailures(sample).map((reason) => ({ runIndex: sample.runIndex, reason })),
  )
  const budgetChecks = PERFORMANCE_BUDGETS.filter(({ metric }) => metrics[metric]).map(({ metric, max, advisory }) => ({
    metric,
    actualP95: metrics[metric].p95,
    max,
    pass: metrics[metric].p95 <= max,
    // advisory budgets are recorded and printed but never flip the scenario verdict.
    // See comment above PERFORMANCE_BUDGETS for rationale.
    advisory: advisory === true,
  }))
  // eval v2 advisory block (U2): per-move amortization, drag/pan ratios, action
  // latency, off-canvas render counts. Attached alongside — NOT inside — the
  // verdict. The verdict below is byte-for-byte the original logic; advisory
  // numbers never flip pass/fail this round (#264 lesson).
  const advisory = buildScenarioAdvisory({
    samples,
    panControl,
    offCanvasComponents: OFF_CANVAS_RENDER_TARGETS,
  })
  const scenarioName = samples[0]?.scenario
  const advisoryOnly = ADVISORY_ONLY_SCENARIOS.has(scenarioName)
  return {
    samples: samples.length,
    errors: samples.filter((sample) => sample.error || sample.pageErrors?.length || sample.consoleErrors?.length)
      .length,
    metrics,
    advisory,
    verdict: {
      // Original prod-leg gate, preserved byte-for-byte:
      //   advisoryOnly ? true : hardFailures === 0 && budgets all pass.
      // Change only affects the non-prod legs (dev / throttle): there the latency
      // ceilings are not calibrated for the slower bundle/CPU, so budgetChecks
      // become advisory (recorded, printed, but not gating) while correctness
      // hard-failures keep gating. advisoryOnly scenarios still never gate,
      // exactly as before.
      pass: advisoryOnly
        ? true
        : budgetsAreCalibratedForLeg
          ? hardFailures.length === 0 && budgetChecks.every((check) => check.advisory || check.pass)
          : hardFailures.length === 0,
      advisoryOnly,
      budgetsAdvisory: !advisoryOnly && !budgetsAreCalibratedForLeg,
      hardFailures,
      budgetChecks,
    },
  }
}

// Aggregate a run's blank-pan samples into the { scriptDurationMs, layoutCount }
// control used for drag/pan ratios. Uses the median so a single noisy pan does
// not distort the denominator. Returns null when no pan sample exists in the run
// (ratios then degrade to null — advisory, so that is acceptable).
function blankPanControl(samples) {
  const script = samples.map((s) => s?.cdpDelta?.ScriptDurationMs).filter((v) => Number.isFinite(v))
  const layout = samples.map((s) => s?.cdpDelta?.LayoutCount).filter((v) => Number.isFinite(v))
  if (!script.length && !layout.length) return null
  return {
    scriptDurationMs: script.length ? quantile(script.sort((a, b) => a - b), 0.5) : null,
    layoutCount: layout.length ? quantile(layout.sort((a, b) => a - b), 0.5) : null,
  }
}

function writeResults(results, label) {
  fs.mkdirSync(outputDir, { recursive: true })
  const outputPath = path.join(outputDir, `canvas-${label}.json`)
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2))
  return outputPath
}

function commandOutput(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: repoRoot, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : null
}

const tempRoot = defaultPerfTempRoot(label)
fs.rmSync(tempRoot, { recursive: true, force: true })
const results = {
  label,
  commit: process.env.NOMI_CANVAS_PERF_COMMIT || commandOutput('git', ['rev-parse', 'HEAD']),
  dirty: Boolean(commandOutput('git', ['status', '--porcelain'])),
  platform: process.platform,
  arch: process.arch,
  machine: {
    cpu: os.cpus()[0]?.model || null,
    logicalCpus: os.cpus().length,
    totalMemoryGB: Math.round((os.totalmem() / 1024 / 1024 / 1024) * 10) / 10,
  },
  viewport: { width: 1600, height: 1000 },
  sampleCount,
  warmupCount,
  scales: requestedScales,
  scenarios,
  // eval v2 leg configuration, recorded so a baseline JSON self-documents which
  // measurement configuration produced it (prod / dev / throttle).
  leg: {
    devServer: useDevServer,
    cpuThrottleRate,
    kind: useDevServer ? 'dev-strictmode' : cpuThrottleRate > 1 ? `throttle-${cpuThrottleRate}x` : 'prod',
  },
  results: [],
  warmupFailures: [],
}

// eval v2 dev leg: bring up the Vite dev server once for the whole run; every
// isolated Electron instance then loads it via NOMI_RENDERER_URL.
let devRendererUrl = null
let devServer = null
if (useDevServer) {
  console.log('▶ 启动 Vite dev server（dev bundle + StrictMode 腿）…')
  devServer = await startDevRendererServer()
  devRendererUrl = devServer.url
  console.log(`  dev renderer: ${devRendererUrl}`)
}

try {
  for (const scale of requestedScales) {
    for (const scenario of scenarios) {
      console.log(`\n▶ ${scale} / ${scenario}`)
      for (let index = 0; index < warmupCount + sampleCount; index += 1) {
        const sample = await runScenario({ scale, scenario, runIndex: index, rootDir: tempRoot })
        const warmup = index < warmupCount
        console.log(
          `  ${warmup ? 'warmup' : `sample ${index - warmupCount + 1}`} ${sample.error ? `ERROR ${sample.error.split('\n')[0]}` : 'ok'}`,
        )
        if (warmup) {
          const failures = sampleHardFailures(sample)
          // Advisory-only scenarios record warmup issues for visibility but do
          // not gate the run (their budgets/hard-failures are not calibrated).
          if (failures.length)
            results.warmupFailures.push({
              scale,
              scenario,
              runIndex: index,
              failures,
              advisoryOnly: ADVISORY_ONLY_SCENARIOS.has(scenario),
            })
        } else {
          results.results.push(sample)
        }
        writeResults(results, label)
      }
    }
  }
  const grouped = new Map()
  for (const sample of results.results) {
    const key = `${sample.scale}/${sample.scenario}`
    const list = grouped.get(key) || []
    list.push(sample)
    grouped.set(key, list)
  }
  // Pan control is per-scale: drag/pan ratios must divide by the same-machine,
  // same-scale blank-pan cost. Keyed by scale so a multi-scale run stays honest.
  const panControlByScale = new Map()
  for (const [key, samples] of grouped.entries()) {
    if (key.endsWith('/blank-pan')) panControlByScale.set(key.split('/')[0], blankPanControl(samples))
  }
  results.summary = Object.fromEntries(
    [...grouped.entries()].map(([key, samples]) => [
      key,
      summarizeScenario(samples, panControlByScale.get(key.split('/')[0]) || null),
    ]),
  )
  results.runtimeVersions = results.results.find((sample) => sample.runtimeVersions)?.runtimeVersions || null
  // Only gating (non-advisory) warmup failures block the run; advisory-only
  // scenario warmup issues are recorded but excluded here. Per-scenario verdicts
  // already return pass:true for advisory-only scenarios.
  const gatingWarmupFailures = results.warmupFailures.filter((failure) => !failure.advisoryOnly)
  results.pass =
    gatingWarmupFailures.length === 0 && Object.values(results.summary).every((summary) => summary.verdict.pass)
  const outputPath = writeResults(results, label)
  console.log(`\n✅ 画布性能 benchmark 完成：${outputPath}`)
  if (gatingWarmupFailures.length)
    console.log(`⚠ warmup 失败 ${gatingWarmupFailures.length} 次（gating 场景），结果标记为不可靠`)
  const advisoryWarmupFailures = results.warmupFailures.length - gatingWarmupFailures.length
  if (advisoryWarmupFailures)
    console.log(`ℹ advisory-only 场景 warmup 提示 ${advisoryWarmupFailures} 条（不影响判定，仅记录）`)
  if (!applyPerformanceVerdict(results)) console.error('❌ 画布性能 benchmark 未通过预算或可靠性门槛')
} finally {
  await devServer?.close().catch(() => {})
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
