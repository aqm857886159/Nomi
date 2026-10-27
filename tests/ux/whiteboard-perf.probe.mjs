// Performance probe for the inline whiteboard, registered in tests/perf/scenarios/ (run it through
// `pnpm run perf:scenarios -- --id <scenario>`; scripts/perf-scenarios-lib.mjs DRIVERS reads the report).
// Real Electron, one fresh isolated project per repetition, real mouse and keyboard, no generation calls.
//
//   --scene idle-panel     editor open, size panel open, nothing moves: layout / style / rect-read rate and main-thread busy share
//   --scene open-type      click "whiteboard" on an image -> editor usable; then type 12 characters into a text object
//   --scene many-images    24 visible image nodes (6 distinct real frames) around the open editor: drag frame gap + long tasks
//   --scene moving-panel   size panel open while the canvas zooms by wheel: how far the panel strays from its anchor, frame by frame
//   --scene done-export    worst-case board (4096x4096, 12 placed photographs from 6 distinct frames, 24 brush paths): Done -> its picture on the node
//   --scene legacy-previews  20 boards saved as state only (no picture yet), all in view: the cards mount -> every card shows its drawn preview
//
// Measurement tools are the existing ones (Playwright + CDP Performance.getMetrics + PerformanceObserver + the shared
// response timer); nothing here is a profiler of our own.
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, expectAbsent, proveProbe } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { buildInlineWhiteboardProject } from './_whiteboardFixture.mjs'
import { uiText } from './full-walk/invariants.mjs'
import { collapseAgentPanel, canvasResetView } from './_shell.mjs'
import { armResponse, takeResponse } from '../perf/canvas-scale/responseTimer.mjs'

const argValue = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined }
const scene = argValue('--scene')
const SCENES = ['idle-panel', 'open-type', 'many-images', 'moving-panel', 'done-export', 'legacy-previews']
if (!SCENES.includes(scene)) throw new Error(`--scene must be one of ${SCENES.join(' / ')}`)
const runs = Number(argValue('--runs') ?? 1)
const label = argValue('--label') ?? `${scene}-adhoc`
if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error('--runs must be an integer from 1 to 20')
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('--label must use lowercase letters, numbers and hyphens')
const repoMedia = process.argv.includes('--repo-media')
const locale = 'en'
const outputRoot = path.resolve('tests/ux/shots/whiteboard-perf', label)
fs.mkdirSync(outputRoot, { recursive: true })

const percentile = (values, fraction) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] }

// Declared before the run loop below: the loop runs at module evaluation, before later top-level consts exist.
const LEGACY_BOARDS = 20

const samples = []
for (let iteration = 0; iteration < runs; iteration++) samples.push(await (scene === 'legacy-previews' ? runLegacyPreviewsOnce() : runOnce()))
fs.writeFileSync(path.join(outputRoot, 'report.json'), JSON.stringify({ scene, locale, samples }, null, 2))

// The largest board the size panel allows, filled with placed photographs and brush paths, never finished before (no picture yet).
function worstCaseBoard(sources, size) {
  const side = 4096
  const assets = Array.from({ length: 12 }, (_, index) => {
    const width = 1280, height = Math.round(1280 * size.height / size.width)
    return { id: `asset-${index}`, layerId: `asset-layer-${index}`, name: `Frame ${index}`, url: sources[index % sources.length].result.url, source: 'upload',
      x: (index % 3) * 1400, y: Math.floor(index / 3) * 1000, width, height }
  })
  const strokes = Array.from({ length: 24 }, (_, index) => {
    const x = 120 + (index % 6) * 640, y = 160 + Math.floor(index / 6) * 980
    return { id: `stroke-${index}`, layerId: `stroke-layer-${index}`, color: '#ef4444', size: 12, tool: 'brush', path: `M ${x} ${y} L ${x + 520} ${y + 260} L ${x + 520} ${y + 284} L ${x} ${y + 24} Z` }
  })
  const whiteboardState = {
    texts: [], sceneTransforms: { offsets: {}, assetTransforms: {}, flips: {} }, canvasDimensions: { width: side, height: side }, strokes, canvasAssets: assets,
    layers: [
      { id: 'background', name: 'Background', visible: true, locked: true, opacity: 1, kind: 'background', thumbnail: 'blank' },
      { id: 'drawing-layer-1', name: 'Layer 1', visible: true, locked: false, opacity: 1, kind: 'drawing', thumbnail: 'checker' },
      ...assets.map((asset) => ({ id: asset.layerId, name: asset.name, visible: true, locked: false, opacity: 1, kind: 'asset', thumbnail: 'image' })),
      ...strokes.map((stroke, index) => ({ id: stroke.layerId, name: `Path ${index + 1}`, visible: true, locked: false, opacity: 1, kind: 'drawing', thumbnail: 'checker' })),
    ],
    activeLayerId: 'drawing-layer-1', activeRatio: '1:1',
  }
  return { id: 'big-board', kind: 'whiteboard', categoryId: 'shots', title: 'Big board', prompt: '', position: { x: 880, y: 440 }, size: { width: 300, height: 300 }, status: 'idle', meta: { whiteboardState } }
}

// A board saved before Done made a picture (0.23.0, or before 2026-10-22): state only, no result. 1280x720 with two placed
// photographs, twelve brush paths and a line of text; every board differs, so no two cards share a cached preview.
function legacyBoard(index, sources) {
  const assets = [0, 1].map((slot) => ({
    id: `asset-${index}-${slot}`, layerId: `asset-layer-${slot}`, name: `Frame ${slot + 1}`, url: sources[(index * 2 + slot) % sources.length].result.url, source: 'upload',
    x: 60 + slot * 600 + (index % 5) * 6, y: 110 + (index % 4) * 8, width: 540, height: 304,
  }))
  const strokes = Array.from({ length: 12 }, (_, stroke) => {
    const x = 50 + stroke * 98 + index * 2, y = 470 + (stroke % 3) * 64
    return { id: `stroke-${index}-${stroke}`, layerId: 'drawing-layer-1', color: ['#ef4444', '#2563eb', '#16a34a'][stroke % 3], size: 10, tool: 'brush',
      path: `M ${x} ${y} L ${x + 72} ${y + 44} L ${x + 72} ${y + 58} L ${x} ${y + 14} Z` }
  })
  const texts = [{ id: `text-${index}`, layerId: 'text-layer', text: `Shot ${index + 1}`, x: 60, y: 30, width: 220, height: 52, fontSize: 40, color: '#111827' }]
  const whiteboardState = {
    texts, sceneTransforms: { offsets: {}, assetTransforms: {}, flips: {} }, canvasDimensions: { width: 1280, height: 720 }, strokes, canvasAssets: assets,
    layers: [
      { id: 'background', name: 'Background', visible: true, locked: true, opacity: 1, kind: 'background', thumbnail: 'blank' },
      ...assets.map((asset) => ({ id: asset.layerId, name: asset.name, visible: true, locked: false, opacity: 1, kind: 'asset', thumbnail: 'image' })),
      { id: 'drawing-layer-1', name: 'Layer 1', visible: true, locked: false, opacity: 1, kind: 'drawing', thumbnail: 'checker' },
      { id: 'text-layer', name: 'Text', visible: true, locked: false, opacity: 1, kind: 'text', thumbnail: 'blank' },
    ],
    activeLayerId: 'drawing-layer-1', activeRatio: '16:9',
  }
  const column = index % 5, row = Math.floor(index / 5)
  return { id: `legacy-${index}`, kind: 'whiteboard', categoryId: 'shots', title: `Legacy board ${index + 1}`, prompt: '',
    position: { x: 40 + column * 260, y: 560 + row * 150 }, size: { width: 240, height: 135 }, status: 'idle', meta: { whiteboardState } }
}

/** The project's saved canvas view (both copies of the record), set before the app reads it. */
function setCanvasView(project, view) {
  for (const file of [path.join(project.projectsDir, project.projectId, 'project.json'), project.recordPath]) {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'))
    Object.assign(record.payload.generationCanvas, view)
    record.generationCanvas = record.payload.generationCanvas
    fs.writeFileSync(file, JSON.stringify(record))
  }
}

// Key order is not content: opening a project saves it once (before this scene existed too), and untouched nodes come
// back with their keys in another order. The guard is that no value of a legacy board changed.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  return value
}

function legacyNodesOnDisk(project) {
  return JSON.stringify(canonical(JSON.parse(fs.readFileSync(project.recordPath, 'utf8')).payload.generationCanvas.nodes.filter((node) => node.id.startsWith('legacy-'))))
}

// Runs in the page before the project opens: the double click's time, the moment all legacy cards are mounted, the moment
// every one of them shows a decoded preview (plus two frames, so it is on screen), and the long tasks in between.
function installLegacyPreviewRecorder(count) {
  const state = { count, clickAt: null, cardsAt: null, doneAt: null, longTasks: [] }
  window.__legacyPreviews = state
  document.addEventListener('dblclick', (event) => { if (state.clickAt === null) state.clickAt = event.timeStamp }, { capture: true })
  window.__legacyPreviewLongTasks = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) state.longTasks.push({ start: entry.startTime, duration: entry.duration })
  })
  window.__legacyPreviewLongTasks.observe({ type: 'longtask' })
  const cards = () => new Set([...document.querySelectorAll('[data-node-id^="legacy-"]')].map((element) => element.getAttribute('data-node-id'))).size
  const shown = () => [...document.querySelectorAll('[data-node-id^="legacy-"] [data-testid="whiteboard-open-preview"] img')]
    .filter((image) => image.src.startsWith('blob:') && image.complete && image.naturalWidth > 0 && getComputedStyle(image).opacity !== '0').length
  const tick = () => {
    if (state.cardsAt === null && cards() >= count) state.cardsAt = performance.now()
    if (state.cardsAt !== null && shown() >= count) {
      requestAnimationFrame(() => requestAnimationFrame(() => { state.doneAt = performance.now() }))
      return
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

async function runLegacyPreviewsOnce() {
  const project = buildInlineWhiteboardProject({ repoMedia, frames: 6, extraNodes: ({ sources }) => Array.from({ length: LEGACY_BOARDS }, (_, index) => legacyBoard(index, sources)) })
  // The saved view asks for 50%; opening still fits the canvas to its nodes (76% in the 1280x933 window), so all twenty cards
  // are in view either way. 22 nodes stay far below the lightweight-render threshold.
  setCanvasView(project, { canvasZoom: 0.5, canvasPan: { x: 0, y: 0 } })
  const legacyBefore = legacyNodesOnDisk(project)
  const run = await launchNomiApp({ name: 'whiteboard-perf-legacy-previews', projectsDir: project.projectsDir, settleMs: 0, initialLocalStorage: {
    'nomi:locale:v1': locale, 'nomi-color-scheme': 'light', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen',
  } })
  const page = run.win
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const sample = { scene, source: project.source, nodes: project.nodes.length, legacyBoards: LEGACY_BOARDS, board: '1280x720, 2 photographs, 12 brush paths, 1 text' }
  try {
    const projectCard = page.locator('[data-project-card]', { hasText: project.record.name })
    await expect(projectCard).toBeVisible()
    await page.evaluate(installLegacyPreviewRecorder, LEGACY_BOARDS)
    await projectCard.dblclick()
    // Two operations: the project opens, then the cards draw their previews one at a time.
    await expect.poll(() => page.evaluate(() => window.__legacyPreviews.doneAt !== null), { timeout: stationTimeout({ operations: 2 }), message: 'every legacy board card shows its drawn preview' }).toBe(true)
    const measured = await page.evaluate(() => {
      const state = window.__legacyPreviews
      window.__legacyPreviewLongTasks.disconnect()
      const inWindow = state.longTasks.filter((task) => task.start + task.duration > state.cardsAt && task.start < state.doneAt)
      return {
        openToInteractiveMs: Math.round(state.doneAt - state.cardsAt),
        projectOpenToPreviewsMs: Math.round(state.doneAt - state.clickAt),
        openLongTasks: inWindow.length,
        longestTaskMs: Math.round(Math.max(0, ...inWindow.map((task) => task.duration))),
      }
    })
    Object.assign(sample, measured)
    // The empty board on the same canvas proves the launcher probe finds launchers; no legacy card may show one.
    const launcherProof = await proveProbe(page.locator('[data-node-id="board"] [data-testid="whiteboard-empty-action"]'), 'the empty board shows the brush launcher')
    await expectAbsent(page.locator('[data-node-id^="legacy-"] [data-testid="whiteboard-empty-action"]'), { provenBy: launcherProof, message: 'no legacy board card shows the launcher' })
    await page.waitForTimeout(1500)
    sample.legacyNodesUnchangedOnDisk = legacyNodesOnDisk(project) === legacyBefore
    await page.screenshot({ path: path.join(outputRoot, `legacy-previews-run-${samples.length + 1}.png`) })
    if (!sample.legacyNodesUnchangedOnDisk) throw new Error('opening the project changed a legacy board on disk')
  } catch (error) {
    sample.error = String(error)
    await page.screenshot({ path: path.join(outputRoot, 'FAIL.png') }).catch(() => {})
    console.error(sample.error)
  } finally {
    sample.rendererErrors = errors
    await run.close()
  }
  console.log(JSON.stringify(sample))
  return sample
}

async function runOnce() {
  const manyImages = scene === 'many-images'
  const doneExport = scene === 'done-export'
  const project = buildInlineWhiteboardProject({
    repoMedia,
    frames: manyImages || doneExport ? 6 : 1,
    extraNodes: ({ sources, size }) => doneExport ? [worstCaseBoard(sources, size)] : manyImages
      ? Array.from({ length: 24 }, (_, index) => ({
        id: `visible-${index}`, kind: 'image', categoryId: 'shots', title: `Frame ${index}`, prompt: '',
        position: { x: 100 + (index % 6) * 380, y: 560 + Math.floor(index / 6) * 230 }, size: { width: 340, height: 191.25 }, status: 'success',
        result: sources[index % sources.length].result, history: [sources[index % sources.length].result],
        meta: { imageWidth: size.width, imageHeight: size.height, previewHeight: 191.25, userResized: true },
      }))
      : [],
  })
  const t = (key) => uiText(locale, key)
  const run = await launchNomiApp({ name: `whiteboard-perf-${scene}`, projectsDir: project.projectsDir, settleMs: 0, initialLocalStorage: {
    'nomi:locale:v1': locale, 'nomi-color-scheme': 'light', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen',
  } })
  const page = run.win
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const sample = { scene, source: project.source, nodes: project.nodes.length }
  try {
    await page.locator('[data-project-card]', { hasText: project.record.name }).dblclick()
    await collapseAgentPanel(page)
    const editor = page.locator('[data-nomi-inline-whiteboard="true"]')
    const node = page.locator('[data-node-id="image"]')
    const action = (name) => page.locator(`[data-toolbar-action="whiteboard-${name}"]`)
    const whiteboardButton = () => page.getByRole('button', { name: t('generationCommon.imageToolbar.whiteboard'), exact: true })

    if (manyImages) {
      await canvasResetView(page)
      await page.getByRole('button', { name: /fit view/i }).click().catch(() => {})
      await page.waitForTimeout(800)
      sample.visibleImages = await page.evaluate(() => [...document.querySelectorAll('.react-flow__node img')].filter((element) => {
        const rect = element.getBoundingClientRect()
        return rect.width > 4 && rect.height > 4 && rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight
      }).length)
    }

    // ── open: click on the image toolbar's whiteboard button -> editor usable (initial image imported, tools enabled) ──
    await node.click()
    await expect(whiteboardButton()).toBeVisible()
    await armResponse(page, { trigger: 'pointerdown', predicate: 'whiteboardEditorReady', timeoutMs: 30_000 })
    await whiteboardButton().click()
    const opened = await takeResponse(page)
    await expect(editor).toBeVisible()
    sample.openToInteractiveMs = opened.ms
    sample.openLongTasks = opened.longTasks
    await page.waitForTimeout(800)

    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable')
    const metricsNow = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((metric) => [metric.name, metric.value]))
    const countRectReads = () => page.evaluate(() => {
      if (!window.__rectReads) {
        window.__rectReads = { count: 0 }
        const original = Element.prototype.getBoundingClientRect
        Element.prototype.getBoundingClientRect = function () { window.__rectReads.count += 1; return original.call(this) }
      }
      return window.__rectReads.count
    })
    const openRatioPanel = async () => {
      await action('ratio').click()
      await expect(page.locator('[data-whiteboard-panel="ratio"]')).toBeVisible()
      await page.waitForTimeout(1200)
    }
    const idleWindow = async (seconds) => {
      await countRectReads()
      const before = await metricsNow()
      const readsBefore = await countRectReads()
      await page.waitForTimeout(seconds * 1000)
      const after = await metricsNow()
      const readsAfter = await countRectReads()
      const elapsed = after.Timestamp - before.Timestamp
      return {
        idleLayoutsPerSec: Math.round(((after.LayoutCount - before.LayoutCount) + (after.RecalcStyleCount - before.RecalcStyleCount)) / elapsed * 100) / 100,
        idleBusyPct: Math.round((after.TaskDuration - before.TaskDuration) / elapsed * 10000) / 100,
        idleRectReadsPerSec: Math.round((readsAfter - readsBefore) / elapsed * 10) / 10,
      }
    }

    if (doneExport) {
      // Leave the image's editor, open the big board from its card (select, then click), let its 12 photographs decode, then Done.
      // A board saved as state only shows its drawn preview on the card since 2026-10-27 (whiteboardStatePreview), not the launcher.
      await action('done').click()
      await expect(editor).toBeHidden()
      await page.keyboard.press('Escape') // deselect the image so its composer no longer covers the board below it
      const opener = page.locator('[data-node-id="big-board"] [data-testid="whiteboard-open-preview"]')
      await opener.click()
      if (!await editor.isVisible()) await opener.click()
      await expect(editor).toBeVisible()
      await expect.poll(() => page.evaluate(() => {
        const board = document.querySelector('[data-nomi-inline-whiteboard="true"]')
        return Boolean(board?.querySelector('canvas')) && [...document.images].every((image) => image.complete)
      }), { message: 'the big board is mounted and every image on the page has decoded' }).toBe(true)
      await page.waitForTimeout(1500)
      await armResponse(page, { trigger: 'pointerdown', predicate: 'whiteboardResultVisible', early: 'whiteboardSaving', arg: 'big-board', timeoutMs: 60_000 })
      await action('done').click()
      const finished = await takeResponse(page)
      Object.assign(sample, { doneToVisibleMs: finished.ms, doneToFeedbackMs: finished.earlyMs, longTasks: finished.longTasks, board: '4096x4096, 12 photographs (6 distinct), 24 brush paths' })
      await expect.poll(() => (project.readNode('big-board').history ?? []).length).toBe(1)
      sample.savedVersions = project.readNode('big-board').history.length
    }

    if (scene === 'idle-panel') {
      const control = await idleWindow(4)
      await openRatioPanel()
      const withPanel = await idleWindow(5)
      Object.assign(sample, withPanel, { control })
    }

    if (scene === 'moving-panel') {
      await openRatioPanel()
      await page.evaluate(() => {
        const state = { active: true, maxDriftPx: 0, framesOff: 0, frames: 0 }
        window.__panelDrift = state
        const measure = () => {
          if (!state.active) return
          const panel = document.querySelector('[data-whiteboard-panel]')
          const bar = document.querySelector('[data-nomi-inline-whiteboard] [role=toolbar]')
          if (panel && bar) {
            const a = panel.getBoundingClientRect(), b = bar.getBoundingClientRect()
            const dx = Math.abs(a.x + a.width / 2 - (b.x + b.width / 2))
            const dy = Math.min(Math.abs(a.top - (b.bottom + 8)), Math.abs(b.top - (a.bottom + 8)))
            const drift = Math.hypot(dx, dy)
            state.frames += 1
            if (drift > 2) state.framesOff += 1
            if (drift > state.maxDriftPx) state.maxDriftPx = drift
          }
          requestAnimationFrame(measure)
        }
        requestAnimationFrame(measure)
      })
      await page.mouse.move(120, 200)
      for (const delta of [...Array(8).fill(-120), ...Array(8).fill(120)]) {
        await page.mouse.wheel(0, delta)
        await page.waitForTimeout(35)
      }
      await page.waitForTimeout(500)
      const drift = await page.evaluate(() => { window.__panelDrift.active = false; return window.__panelDrift })
      Object.assign(sample, { panelDriftPx: Math.round(drift.maxDriftPx * 10) / 10, panelFramesOff: drift.framesOff, panelFramesSampled: drift.frames })
    }

    if (scene === 'open-type') {
      await action('text').click()
      const stage = await editor.getByLabel(t('generationCommon.whiteboard.drawingLayerAria'), { exact: true }).boundingBox()
      await page.mouse.click(stage.x + stage.width * 0.3, stage.y + stage.height * 0.7)
      const textLabel = t('generationCommon.whiteboard.text')
      const textInput = editor.getByRole('toolbar').getByRole('textbox', { name: textLabel, exact: true })
      await expect(textInput).toBeVisible()
      await textInput.fill('')
      const typed = []
      let value = ''
      for (const character of 'Typing check') {
        value += character
        await armResponse(page, { trigger: 'keydown', predicate: 'whiteboardTextValue', arg: { label: textLabel, value }, timeoutMs: 10_000 })
        await page.keyboard.press(character === ' ' ? 'Space' : character)
        typed.push((await takeResponse(page)).ms)
      }
      sample.typeResponseP95Ms = percentile(typed, 0.95)
      sample.typeResponseMedianMs = percentile(typed, 0.5)
    }

    if (scene === 'many-images') {
      const frame = await editor.boundingBox()
      await page.evaluate(() => {
        window.__whiteboardPerf = { frames: [], longTasks: [], active: true }
        let previous = performance.now()
        const loop = (now) => { if (!window.__whiteboardPerf.active) return; window.__whiteboardPerf.frames.push(now - previous); previous = now; requestAnimationFrame(loop) }
        requestAnimationFrame(loop)
        window.__whiteboardLongTasks = new PerformanceObserver((list) => window.__whiteboardPerf.longTasks.push(...list.getEntries().map((entry) => entry.duration)))
        window.__whiteboardLongTasks.observe({ type: 'longtask' })
      })
      for (let count = 0; count < 6; count++) {
        await page.mouse.move(frame.x + frame.width * 0.45 + 35, frame.y + frame.height * 0.3 + 18)
        await page.mouse.down()
        await page.mouse.move(frame.x + frame.width * 0.45 + (count % 2 ? 35 : 60), frame.y + frame.height * 0.3 + 30, { steps: 60 })
        await page.mouse.up()
      }
      const measured = await page.evaluate(() => {
        const value = window.__whiteboardPerf
        value.active = false
        window.__whiteboardLongTasks.disconnect()
        const sorted = value.frames.slice(2).sort((a, b) => a - b)
        return { frames: sorted.length, frameP95Ms: sorted[Math.floor(sorted.length * 0.95)], longTasks: value.longTasks.length }
      })
      Object.assign(sample, { dragFrames: measured.frames, frameP95Ms: measured.frameP95Ms, longTasks: measured.longTasks })
      const idle = await idleWindow(4)
      Object.assign(sample, idle)
    }
  } catch (error) {
    sample.error = String(error)
    await page.screenshot({ path: path.join(outputRoot, 'FAIL.png') }).catch(() => {})
    console.error(sample.error)
  } finally {
    sample.rendererErrors = errors
    await run.close()
  }
  console.log(JSON.stringify(sample))
  return sample
}
