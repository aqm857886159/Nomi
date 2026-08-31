// 生成画布性能基准：真实 Electron + 本地图片/视频夹具 + 高频微操作。
//
// 用法：
//   pnpm run build
//   node tests/ux/canvas-performance-benchmark.e2e.mjs baseline --scale L --runs 5
//
// 可选环境变量：NOMI_CANVAS_PERF_RUNS、NOMI_CANVAS_PERF_SCALES、NOMI_CANVAS_PERF_SCENARIOS。
// 结果写入 tests/ux/perf-results/canvas-<label>.json。零额度、零网络媒体依赖。
import { launchNomiApp } from './_launchApp.mjs'
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
if (hasArg('--help') || hasArg('-h')) {
  console.log('用法：node tests/ux/canvas-performance-benchmark.e2e.mjs <label> [--scale L] [--runs 5]')
  console.log(`scale：${Object.keys(CANVAS_PERF_SCALES).join(' / ')}`)
  console.log(
    'scenario：all / cold-open / blank-pan / node-drag-image / node-drag-video / marquee-select / click-select / wheel-zoom / pan-zoom-mix / resize / media-reveal / low-zoom-preview / media-error / video-hover / reload-heavy',
  )
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
  Number(argValue('--launch-timeout') || process.env.NOMI_CANVAS_PERF_LAUNCH_TIMEOUT_MS || 45_000),
)
const allScenarios = [
  'cold-open',
  'blank-pan',
  'node-drag-image',
  'node-drag-video',
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
  return app.windows().filter((candidate) => !candidate.isClosed())
}

function getTargetWindow(app, fallback) {
  const live = pageWindows(app)
  return live.find((candidate) => /projectId=/.test(candidate.url())) || live[live.length - 1] || fallback
}

async function findBlank(page, preference = 'default') {
  return page.evaluate((mode) => {
    const stage = document.querySelector('.generation-canvas-v2__stage')
    if (!stage) return null
    const rect = stage.getBoundingClientRect()
    const preferred =
      mode === 'top-left'
        ? [0.03, 0.08, 0.14, 0.2, 0.28, 0.4, 0.56, 0.72, 0.88]
        : [0.92, 0.84, 0.76, 0.68, 0.56, 0.44, 0.32, 0.2, 0.08, 0.03]
    const xRatios = [...preferred]
    const yRatios = [...preferred]
    for (const ry of yRatios) {
      for (const rx of xRatios) {
        const x = Math.round(rect.left + rect.width * rx)
        const y = Math.round(rect.top + rect.height * ry)
        const hit = document.elementFromPoint(x, y)
        if (!hit || !stage.contains(hit)) continue
        if (
          hit.tagName === 'IMG' ||
          hit.tagName === 'VIDEO' ||
          hit.closest(
            '.generation-canvas-v2-node,button,input,textarea,[role="menu"],[role="toolbar"],.generation-canvas-v2__edge-hit,.generation-canvas-v2__edge-path,.generation-canvas-v2__minimap',
          )
        )
          continue
        return { x, y }
      }
    }
    for (let y = Math.ceil(rect.top + 8); y < rect.bottom - 8; y += 24) {
      for (let x = Math.ceil(rect.left + 8); x < rect.right - 8; x += 24) {
        const hit = document.elementFromPoint(x, y)
        if (!hit || !stage.contains(hit)) continue
        if (
          hit.tagName === 'IMG' ||
          hit.tagName === 'VIDEO' ||
          hit.closest(
            '.generation-canvas-v2-node,button,input,textarea,[role="menu"],[role="toolbar"],.generation-canvas-v2__edge-hit,.generation-canvas-v2__edge-path,.generation-canvas-v2__minimap',
          )
        )
          continue
        return { x, y }
      }
    }
    const nodeRects = Array.from(document.querySelectorAll('.generation-canvas-v2-node')).map((node) =>
      node.getBoundingClientRect(),
    )
    for (let y = Math.ceil(rect.top + 8); y < rect.bottom - 8; y += 10) {
      for (let x = Math.ceil(rect.left + 8); x < rect.right - 8; x += 10) {
        if (
          nodeRects.some(
            (nodeRect) => x >= nodeRect.left && x <= nodeRect.right && y >= nodeRect.top && y <= nodeRect.bottom,
          )
        )
          continue
        const hit = document.elementFromPoint(x, y)
        if (
          hit &&
          (hit.tagName === 'IMG' ||
            hit.tagName === 'VIDEO' ||
            hit.closest('button,input,textarea,select,[role="menu"],[role="toolbar"],[role="button"]'))
        )
          continue
        return { x, y }
      }
    }
    // The canvas event surface can sit under a full-stage SVG with pointer
    // events disabled, so elementFromPoint may not expose the stage itself.
    // The left/bottom inset is outside the fixture grid and remains a stable
    // blank coordinate for the synthetic workloads.
    return { x: Math.round(rect.left + 16), y: Math.round(rect.bottom - 16) }
  }, preference)
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

async function captureNodeIdentity(page) {
  await page.evaluate(() => {
    window.__canvasPerformanceNodeIdentity = new Map(
      Array.from(document.querySelectorAll('.react-flow__node[data-id]')).map((element) => [
        element.getAttribute('data-id'),
        element,
      ]),
    )
  })
}

async function readNodeIdentity(page, targetNodeId = null) {
  return page.evaluate((targetId) => {
    const before = window.__canvasPerformanceNodeIdentity || new Map()
    const current = new Map(
      Array.from(document.querySelectorAll('.react-flow__node[data-id]')).map((element) => [
        element.getAttribute('data-id'),
        element,
      ]),
    )
    const commonIds = [...before.keys()].filter((id) => current.has(id))
    const preservedIds = commonIds.filter((id) => before.get(id) === current.get(id))
    return {
      before: before.size,
      after: current.size,
      common: commonIds.length,
      preserved: preservedIds.length,
      commonIdentityPreserved: preservedIds.length === commonIds.length,
      targetNodeId: targetId,
      targetIdentityPreserved: targetId ? before.get(targetId) === current.get(targetId) : null,
    }
  }, targetNodeId)
}

async function openProject(app, page, fixture) {
  const startedAt = Date.now()
  if (!/projectId=/.test(page.url())) {
    const card = page.locator('[data-project-card]', { hasText: fixture.record.name }).first()
    await card.waitFor({ timeout: 12_000 })
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
  await page.locator('.generation-canvas-v2__stage').waitFor({ timeout: 20_000 })
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
    { timeout: 20_000 },
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
    return null
  }
  if (scenario === 'node-drag-image' || scenario === 'node-drag-video') {
    const kind = scenario.endsWith('image') ? 'image' : 'video'
    const node = await visibleNodeBox(page, kind)
    if (!node) throw new Error(`没有可见的 ${kind} 节点`)
    const start = { x: node.box.x + node.box.width * 0.5, y: node.box.y + 14 }
    await dragPath(page, start, { x: start.x + 180, y: start.y + 90 })
    return { nodeId: await node.locator.getAttribute('data-node-id') }
  }
  if (scenario === 'marquee-select') {
    const boxes = []
    const nodes = page.locator('.generation-canvas-v2-node')
    for (let index = 0; index < Math.min(50, await nodes.count()); index += 1) {
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
    const start = await findBlank(page, 'top-left')
    if (!start) throw new Error('找不到可用于框选的画布空白点')
    await page.keyboard.down('Shift')
    await dragPath(
      page,
      start,
      { x: Math.min(stage.x + stage.width - 10, right + 30), y: Math.min(stage.y + stage.height - 10, bottom + 30) },
      60,
      12,
    )
    await page.keyboard.up('Shift')
    return {
      selected: await page.locator('.generation-canvas-v2-node[data-selected="true"]').count(),
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
    const failure = page.locator('[data-node-media-failure="error"]').first()
    await failure.waitFor({ timeout: 10_000 })
    await failure.getByRole('button', { name: '重试' }).click()
    await failure.waitFor({ timeout: 10_000 })
    return {
      explicitFailures: await page.locator('[data-node-media-failure="error"]').count(),
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
  if (scenario === 'media-error') {
    const imageNode = fixture.record.payload.generationCanvas.nodes.find((node) => node.kind === 'image')
    if (imageNode?.result) {
      const missingUrl = `nomi-local://asset/${encodeURIComponent(fixture.record.id)}/assets/generated/canvas-performance/missing.png`
      imageNode.result.url = missingUrl
      imageNode.result.thumbnailUrl = missingUrl
      fs.writeFileSync(path.join(fixture.projectRoot, '.nomi', 'project.json'), JSON.stringify(fixture.record, null, 1))
    }
  }
  let app = null
  let page = null
  const pageErrors = []
  const consoleErrors = []
  const attachDiagnostics = (candidate) => {
    candidate.on('pageerror', (error) => pageErrors.push(String(error)))
    candidate.on('console', (message) => {
      const expectedMissingFixture = scenario === 'media-error' && message.text().includes('404 (Not Found)')
      if (message.type() === 'error' && !expectedMissingFixture) consoleErrors.push(message.text())
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
      },
    }))
    attachDiagnostics(page)
    app.on('window', attachDiagnostics)
    page = getTargetWindow(app, page)
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
    const actionDetails = await runAction(page, scenario, fixture)
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

const PERFORMANCE_BUDGETS = [
  { metric: 'frameGapP95Ms', max: timingBudget(33) },
  { metric: 'maxFrameGapMs', max: timingBudget(100) },
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
  if (
    sample.scenario === 'marquee-select' &&
    Number.isFinite(sample.actionDetails?.selected) &&
    sample.actionDetails.selected < 12
  )
    failures.push(`marquee selected only ${sample.actionDetails.selected} nodes`)
  if (sample.nodeIdentity?.commonIdentityPreserved === false) failures.push('mounted node DOM identity changed')
  if (sample.nodeIdentity?.targetIdentityPreserved === false)
    failures.push(`target node DOM identity changed: ${sample.nodeIdentity.targetNodeId}`)
  if (sample.probe?.maxLoadingImages > 4) failures.push(`image activation peak ${sample.probe.maxLoadingImages} > 4`)
  if (sample.probe?.maxLoadingVideos > 1) failures.push(`video activation peak ${sample.probe.maxLoadingVideos} > 1`)
  if (sample.probe?.maxActiveVideos > 1)
    failures.push(`simultaneously playing videos ${sample.probe.maxActiveVideos} > 1`)
  if (sample.scenario === 'media-error' && sample.actionDetails?.explicitFailures < 1)
    failures.push('media failure did not remain explicit after retry')
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

function summarizeScenario(samples) {
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
  const budgetChecks = PERFORMANCE_BUDGETS.filter(({ metric }) => metrics[metric]).map(({ metric, max }) => ({
    metric,
    actualP95: metrics[metric].p95,
    max,
    pass: metrics[metric].p95 <= max,
  }))
  return {
    samples: samples.length,
    errors: samples.filter((sample) => sample.error || sample.pageErrors?.length || sample.consoleErrors?.length)
      .length,
    metrics,
    verdict: {
      pass: hardFailures.length === 0 && budgetChecks.every((check) => check.pass),
      hardFailures,
      budgetChecks,
    },
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
  results: [],
  warmupFailures: [],
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
          if (failures.length) results.warmupFailures.push({ scale, scenario, runIndex: index, failures })
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
  results.summary = Object.fromEntries(
    [...grouped.entries()].map(([key, samples]) => [key, summarizeScenario(samples)]),
  )
  results.runtimeVersions = results.results.find((sample) => sample.runtimeVersions)?.runtimeVersions || null
  results.pass =
    results.warmupFailures.length === 0 && Object.values(results.summary).every((summary) => summary.verdict.pass)
  const outputPath = writeResults(results, label)
  console.log(`\n✅ 画布性能 benchmark 完成：${outputPath}`)
  if (results.warmupFailures.length) console.log(`⚠ warmup 失败 ${results.warmupFailures.length} 次，结果标记为不可靠`)
  if (!applyPerformanceVerdict(results)) console.error('❌ 画布性能 benchmark 未通过预算或可靠性门槛')
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
