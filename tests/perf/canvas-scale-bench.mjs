#!/usr/bin/env node
/**
 * 画布「东西多了就卡」的规模基准（2026-09-12）。
 *
 * 为什么另起一个 harness 而不是往 canvas-performance-benchmark.e2e.mjs 里加：
 * 那份是**回归门岗**——固定场景、固定 5 次采样、固定预算，改动它会改动 main 的判定口径。
 * 这份是**规模曲线仪**：同一个手势在 60 / 150 / 300 个图片节点上各量一遍，回答的是
 * 「成本随 N 怎么长」，输出是一张表不是一个 pass/fail。两者共用同一套夹具与启动器
 * （tests/ux/fixtures/canvas-performance-fixture.mjs、tests/ux/_launchApp.mjs），
 * 不复制第二份夹具、第二个启动路径。
 *
 * 用法：
 *   node tests/perf/canvas-scale-bench.mjs --scales I60,I150,I300 --runs 3
 *   node tests/perf/canvas-scale-bench.mjs --scales I300 --scenarios drag-group-frame-60 --profile
 *
 * 产物：tests/perf/results/canvas-scale-<label>.json（原始数字）+ stdout 表格。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp, closeNomiApp } from '../ux/_launchApp.mjs'
import { createCanvasPerformanceFixture, CANVAS_PERF_SCALES } from '../ux/fixtures/canvas-performance-fixture.mjs'
import { findCanvasBlankPoint } from '../ux/_canvasHit.mjs'
import { AUTO_PAN_SAFE_MARGIN_PX } from '../ux/canvas-perf/gestureGeometry.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outputDir = path.join(repoRoot, 'tests/perf/results')

const args = process.argv.slice(2)
const argValue = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const hasArg = (name) => args.includes(name)

const SCENARIO_NAMES = [
  // 同机对照组：同一个手势、同一个窗口，只拖 1 张卡。这台机器上常有 20+ 个工作树在跑活
  // （实测 load average 一度到 32），绝对毫秒数会随别人的负载漂；**比值**不会。
  // 所有「随 N 怎么长」的结论都要能在 scenario/control 这个比值上站得住。
  'drag-nodes-1',
  'drag-nodes-20',
  'drag-nodes-60',
  'drag-nodes-all',
  'drag-group-frame-60',
  'marquee-select-all',
  'wheel-zoom',
  'pan',
  'zoom-slider-drag',
]

if (hasArg('--help') || hasArg('-h')) {
  console.log(`用法：node tests/perf/canvas-scale-bench.mjs [选项]
  --scales     逗号分隔，默认 I60,I150,I300（可选：${Object.keys(CANVAS_PERF_SCALES).join(' / ')}）
  --scenarios  逗号分隔，默认全部：${SCENARIO_NAMES.join(' / ')}
  --runs       每个场景采样次数（默认 3，取中位数）
  --profile    对每个场景另抓一次 CDP CPU profile（JS 自时间前 25 名）
  --label      产物文件名后缀（默认 run）`)
  process.exit(0)
}


const scales = argValue('--scales', 'I60,I150,I300').split(',').map((s) => s.trim()).filter(Boolean)
const scenarios = argValue('--scenarios', SCENARIO_NAMES.join(',')).split(',').map((s) => s.trim()).filter(Boolean)
const runs = Math.max(1, Number(argValue('--runs', '3')))
const withProfile = hasArg('--profile')
const label = argValue('--label', 'run')

const sleep = (page, ms) => page.waitForTimeout(ms)

/** 圆弧拖动的半径。抓手必须离舞台四边至少这么远，否则拖到边上会触发 React Flow 的自动平移。 */
const DRAG_RADIUS_PX = 90

/**
 * 抓手可用区：把手势的整条轨迹连同 React Flow 的自动平移安全边一起留出来。
 *
 * 这条是踩出来的：第一版只要求**起手点**在舞台内，于是靠左的卡起手、圆弧往左扫出边界，
 * 触发自动平移，250 步下来那张卡被拖到几万个画布单位之外——下一次「适应视图」于是贴到
 * 最小缩放 0.2、视口里只剩 9 张卡，看起来像「画布坏了」，其实是手势自己造的。
 * 右下角另外扣掉 minimap 与底部停靠那一块。
 */
function grabSafeArea(stage) {
  const edge = AUTO_PAN_SAFE_MARGIN_PX + DRAG_RADIUS_PX + 12
  return {
    minX: stage.x + edge,
    maxX: stage.x + stage.width - Math.max(edge, 250),
    minY: stage.y + edge,
    maxY: stage.y + stage.height - Math.max(edge, 210),
  }
}

/**
 * 采样窗口必须和「手势那一段」严格重合。
 *
 * 第一版把 CDP 指标读在 runScenario 前后，于是框选、建组、适应视图那几百毫秒
 * 也被算进了「拖动的 script 时间」——读数虚高且不可比。现在把两次读数绑在
 * **探针 start/stop 的同一行**：页内 rAF 计时器与主控侧的累计计数器量的是同一段。
 */
let activeCdp = null
let windowMetrics = { before: null, after: null }

async function startWindow(page) {
  windowMetrics = { before: activeCdp ? await readCdpMetrics(activeCdp) : null, after: null }
  await page.evaluate(() => window.__nomiScaleProbe.start())
}

async function stopWindow(page) {
  const raw = await page.evaluate(() => window.__nomiScaleProbe.stop())
  windowMetrics.after = activeCdp ? await readCdpMetrics(activeCdp) : null
  return raw
}

const quantile = (values, q) => {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b)
  if (!sorted.length) return null
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))
  return Math.round(sorted[index] * 10) / 10
}
const median = (values) => quantile(values, 0.5)

/**
 * 页内采样器。刻意比 canvas-performance-benchmark 的探针**轻**：那份每帧都
 * querySelectorAll('img[src]') 数一遍加载中的图，在 300 节点档上这条自检本身就要
 * 几毫秒，会把被测对象的帧时抬上去（仪器噪声进读数）。这份每帧只记时间戳；
 * 「哪些节点被重写」交给 MutationObserver 异步累计，不进 rAF 回调。
 */
const PROBE_SOURCE = `(() => {
  window.__nomiScaleProbe = {
    start() {
      const viewport = document.querySelector('.react-flow__viewport')
      const rec = {
        t0: performance.now(),
        lastFrame: performance.now(),
        frames: 0,
        gaps: [],
        longTasks: [],
        // 每帧被写 style 的「节点包装器」数量：React Flow 给每个节点包一层
        // .react-flow__node，位移就写在它的 transform 上。一次手势里这个数的
        // 峰值 = 「这一帧有多少个节点实例的 DOM 被动过」。
        nodeStyleWrites: 0,
        touchedNodes: new Set(),
        perFlushTouched: [],
        subtreeMutations: 0,
      }
      const frame = () => {
        const now = performance.now()
        if (rec.frames > 0) rec.gaps.push(now - rec.lastFrame)
        rec.lastFrame = now
        rec.frames += 1
        rec.raf = requestAnimationFrame(frame)
      }
      rec.raf = requestAnimationFrame(frame)
      if (viewport) {
        rec.mo = new MutationObserver((records) => {
          const touchedThisFlush = new Set()
          for (const record of records) {
            rec.subtreeMutations += 1
            const target = record.target instanceof Element ? record.target : record.target.parentElement
            if (!target) continue
            const node = target.closest('.react-flow__node')
            if (!node) continue
            const id = node.getAttribute('data-id') || ''
            rec.touchedNodes.add(id)
            touchedThisFlush.add(id)
            if (record.type === 'attributes' && record.attributeName === 'style' && target === node) {
              rec.nodeStyleWrites += 1
            }
          }
          if (touchedThisFlush.size) rec.perFlushTouched.push(touchedThisFlush.size)
        })
        rec.mo.observe(viewport, { attributes: true, childList: true, subtree: true, characterData: true })
      }
      try {
        rec.po = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) rec.longTasks.push(entry.duration)
        })
        rec.po.observe({ entryTypes: ['longtask'] })
      } catch { /* longtask 不可用时其余指标仍有效 */ }
      this._record = rec
      return 'started'
    },
    stop() {
      const rec = this._record
      if (!rec) return null
      cancelAnimationFrame(rec.raf)
      rec.mo?.disconnect()
      rec.po?.disconnect()
      this._record = null
      const elapsedMs = performance.now() - rec.t0
      return {
        elapsedMs,
        frames: rec.frames,
        gaps: rec.gaps,
        longTasks: rec.longTasks,
        nodeStyleWrites: rec.nodeStyleWrites,
        distinctTouchedNodes: rec.touchedNodes.size,
        maxTouchedPerFlush: rec.perFlushTouched.length ? Math.max(...rec.perFlushTouched) : 0,
        medianTouchedPerFlush: rec.perFlushTouched.length
          ? rec.perFlushTouched.slice().sort((a, b) => a - b)[Math.floor(rec.perFlushTouched.length / 2)]
          : 0,
        flushes: rec.perFlushTouched.length,
        subtreeMutations: rec.subtreeMutations,
        mountedNodes: document.querySelectorAll('.react-flow__node').length,
      }
    },
  }
  return 'installed'
})()`

function summarize(raw) {
  if (!raw) return null
  const gaps = raw.gaps.filter((gap) => gap >= 0)
  return {
    elapsedMs: Math.round(raw.elapsedMs),
    frames: raw.frames,
    fps: Math.round((raw.frames / Math.max(1, raw.elapsedMs)) * 10000) / 10,
    frameP50Ms: quantile(gaps, 0.5),
    frameP95Ms: quantile(gaps, 0.95),
    frameMaxMs: gaps.length ? Math.round(Math.max(...gaps) * 10) / 10 : null,
    longTasks: raw.longTasks.length,
    longTaskMs: Math.round(raw.longTasks.reduce((sum, value) => sum + value, 0)),
    longTaskMaxMs: raw.longTasks.length ? Math.round(Math.max(...raw.longTasks)) : 0,
    nodeStyleWrites: raw.nodeStyleWrites,
    distinctTouchedNodes: raw.distinctTouchedNodes,
    maxTouchedPerFlush: raw.maxTouchedPerFlush,
    medianTouchedPerFlush: raw.medianTouchedPerFlush,
    domFlushes: raw.flushes,
    subtreeMutations: raw.subtreeMutations,
    mountedNodes: raw.mountedNodes,
  }
}

// ——— 手势 ———————————————————————————————————————————————

async function stageBox(page) {
  const box = await page.locator('.generation-canvas-v2__stage').boundingBox()
  if (!box) throw new Error('找不到画布舞台')
  return box
}

/**
 * 用真实的「适应视图」按钮把全部节点收进视口（用户看一大批图时就是这么干的）。
 *
 * 必须**验结果**不能只点一下：负载高时按钮可能在 React 还没接上 onClick 时就被点到，
 * 点击静默丢失，视口停在 zoom≈1 —— 于是后面「视口里只挂了 9 个节点」，
 * 看着像画布 bug，其实是前置条件没成立。这类假前提比测出错数字更坏。
 */
async function fitView(page, { expectZoomBelow = 0.9 } = {}) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.getByLabel('适应视图').first().click({ timeout: 15_000 })
    await sleep(page, 800)
    const viewport = await readViewport(page)
    if (viewport.zoom !== null && viewport.zoom < expectZoomBelow) return viewport
  }
  return readViewport(page)
}

/**
 * 真实框选：在**空白 pane** 上按住 Shift 按下、拖一个矩形、松手。
 * Shift 是必须的——React Flow 的 selectionOnDrag 只在 Shift 下起框（不按 Shift 是平移画布），
 * 第一次写这个 harness 时漏了它，结果「选中 0 个」看着像 bug 其实是手势不对。
 */
async function marqueeRect(page, { toY = null, record = false } = {}) {
  const stage = await stageBox(page)
  const start = await findCanvasBlankPoint(page, { preference: 'top-left', inset: 24 })
  if (!start) throw new Error('找不到画布空白起手点')
  const end = {
    x: stage.x + stage.width - 250,
    y: Math.min(toY ?? (stage.y + stage.height - 190), stage.y + stage.height - 190),
  }
  await page.mouse.move(start.x, start.y)
  await page.keyboard.down('Shift')
  await page.mouse.down()
  if (record) await startWindow(page)
  const steps = 24
  for (let index = 1; index <= steps; index += 1) {
    await page.mouse.move(
      start.x + ((end.x - start.x) * index) / steps,
      start.y + ((end.y - start.y) * index) / steps,
      { steps: 1 },
    )
    await sleep(page, 12)
  }
  const raw = record ? await stopWindow(page) : null
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await sleep(page, 300)
  return raw
}

async function marqueeSelectAll(page, options = {}) {
  return marqueeRect(page, options)
}

async function selectedCount(page) {
  return page.evaluate(() => document.querySelectorAll('.react-flow__node.selected').length)
}

/**
 * 选中大约 count 个节点：按住 Shift 逐个点太慢（N=300 要点 300 下，而且屏外的点不到），
 * 所以框一个「刚好盖住前 count 个」的矩形——按 y 再按 x 排序取第 count 个的下沿当矩形底边。
 * 返回实际选中数（Partial 选择模式下会略多于 count，表里如实记录）。
 */
async function marqueeSelectCount(page, count) {
  const stage = await stageBox(page)
  const boxes = await page.evaluate(() => Array.from(document.querySelectorAll('.react-flow__node'))
    .map((element) => {
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
    })
    .sort((a, b) => (a.y - b.y) || (a.x - b.x)))
  if (boxes.length < count) return { ok: false, reason: `视口内只挂了 ${boxes.length} 个节点，凑不出 ${count}` }
  const target = boxes[count - 1]
  await marqueeRect(page, { toY: target.y + target.h * 0.55 })
  return { ok: true, selected: await selectedCount(page) }
}

/**
 * 找拖动抓手。多选之后 React Flow 会在选中集上面盖一层 `.react-flow__nodesselection-rect`
 * ——**用户真正抓到的就是它**（鼠标落在卡片上，命中的却是这层）。所以这里不强求命中节点本体，
 * 而是如实报「命中的是谁」：`nodesselection-rect` = 走 RF 自己的 XYDrag 把位移扇给全部选中节点；
 * `node` = 直接抓单卡。两者都会经 onNodesChange 落到 canvasDragDraft 的内核路径。
 */
async function selectedNodeGrabPoint(page) {
  const stage = await stageBox(page)
  return page.evaluate(({ area }) => {
    const inSafeArea = (x, y) => x >= area.minX && x <= area.maxX && y >= area.minY && y <= area.maxY
    const overlay = document.querySelector('.react-flow__nodesselection-rect')
    if (overlay) {
      const rect = overlay.getBoundingClientRect()
      // 选中一大批时这层罩子会比安全区还大，按固定比例取点会全落在安全区外（第一版就这么
      // 丢了 I150/I300 的 drag-nodes-20）。改成把罩子和安全区求交，在交集里扫。
      const x0 = Math.max(rect.left, area.minX)
      const x1 = Math.min(rect.right, area.maxX)
      const y0 = Math.max(rect.top, area.minY)
      const y1 = Math.min(rect.bottom, area.maxY)
      if (x1 > x0 && y1 > y0) {
        for (const ry of [0.5, 0.3, 0.7, 0.15, 0.85]) {
          for (const rx of [0.5, 0.3, 0.7, 0.15, 0.85]) {
            const x = Math.round(x0 + (x1 - x0) * rx)
            const y = Math.round(y0 + (y1 - y0) * ry)
            const hit = document.elementFromPoint(x, y)
            if (hit === overlay || overlay.contains(hit)) return { x, y, via: 'nodesselection-rect' }
          }
        }
      }
    }
    for (const node of Array.from(document.querySelectorAll('.react-flow__node.selected'))) {
      const rect = node.getBoundingClientRect()
      for (const [rx, ry] of [[0.5, 0.5], [0.5, 0.25], [0.25, 0.5], [0.75, 0.5], [0.5, 0.75]]) {
        const x = Math.round(rect.left + rect.width * rx)
        const y = Math.round(rect.top + rect.height * ry)
        if (!inSafeArea(x, y)) continue
        const hit = document.elementFromPoint(x, y)
        if (hit && node.contains(hit)) return { x, y, via: 'node' }
      }
    }
    // 兜底：命中的是别的东西也要说清楚是什么，不许静默跳过（假跳过会让整格空着）。
    const first = document.querySelector('.react-flow__node.selected')
    if (!first) return null
    const rect = first.getBoundingClientRect()
    const x = Math.round(rect.left + rect.width * 0.5)
    const y = Math.round(rect.top + rect.height * 0.5)
    const hit = document.elementFromPoint(x, y)
    return { x, y, via: `blocked-by:${hit ? hit.className || hit.tagName : 'nothing'}`, blocked: true }
  }, { area: grabSafeArea(stage) })
}

/** 对照组用：随便找一张能点到的卡（不要求已选中）。 */
async function anyNodeGrabPoint(page) {
  const stage = await stageBox(page)
  return page.evaluate(({ area }) => {
    for (const node of Array.from(document.querySelectorAll('.react-flow__node'))) {
      const rect = node.getBoundingClientRect()
      const x = Math.round(rect.left + rect.width * 0.5)
      const y = Math.round(rect.top + rect.height * 0.5)
      if (x < area.minX || x > area.maxX || y < area.minY || y > area.maxY) continue
      const hit = document.elementFromPoint(x, y)
      if (hit && node.contains(hit)) return { x, y }
    }
    return null
  }, { area: grabSafeArea(stage) })
}

/** 2 秒匀速圆弧拖动：真手不会走直线，圆弧还能保证不撞舞台边（撞边会触发自动平移，另一族现象）。 */
async function arcDrag(page, origin, { radius = DRAG_RADIUS_PX, durationMs = 2000, stepMs = 8 }) {
  await page.mouse.move(origin.x, origin.y)
  await page.mouse.down()
  await sleep(page, 60)
  await startWindow(page)
  const steps = Math.round(durationMs / stepMs)
  for (let index = 1; index <= steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2
    await page.mouse.move(
      origin.x + Math.sin(angle) * radius,
      origin.y + (1 - Math.cos(angle)) * radius * 0.5,
      { steps: 1 },
    )
    await sleep(page, stepMs)
  }
  const raw = await stopWindow(page)
  await page.mouse.up()
  await sleep(page, 400)
  return raw
}

async function groupSelected(page) {
  // 快捷键是 **Cmd/Ctrl+G**（useCanvasShortcuts.ts:147 在 `if (!mod) return` 之后才判 g）。
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+g' : 'Control+g')
  await sleep(page, 600)
  return page.evaluate(() => document.querySelectorAll('.generation-canvas-v2__group-box[data-group-id]').length)
}

/**
 * 找组框本体上能按下去的一点。组框画在卡片**下面**，只有三种地方露出来：
 * 顶部标签条那一条、四周 24px 的内边距环、以及卡片之间的空隙（栅格间距 70×120，
 * 比卡片本身还好找）。所以这里不按比例粗扫，而是按屏幕像素密扫一遍整个框，
 * 第一个 elementFromPoint 命中框本体的点就用它。扫不到要说清楚命中的是谁。
 */
async function groupFrameGrabPoint(page) {
  const stage = await stageBox(page)
  return page.evaluate(({ area }) => {
    const frame = document.querySelector('.generation-canvas-v2__group-box[data-group-id]')
    if (!frame) return null
    const rect = frame.getBoundingClientRect()
    const inSafeArea = (x, y) => (
      x >= area.minX && x <= area.maxX && y >= area.minY && y <= area.maxY
    )
    const blockers = new Map()
    const step = 8
    for (let y = rect.top + 3; y <= rect.bottom - 3; y += step) {
      for (let x = rect.left + 3; x <= rect.right - 3; x += step) {
        if (!inSafeArea(x, y)) continue
        const hit = document.elementFromPoint(Math.round(x), Math.round(y))
        if (hit === frame) return { x: Math.round(x), y: Math.round(y), via: 'group-box' }
        const key = hit ? `${hit.tagName}.${String(hit.className).slice(0, 40)}` : 'nothing'
        blockers.set(key, (blockers.get(key) || 0) + 1)
      }
    }
    const top = [...blockers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([key, n]) => `${key}×${n}`)
    return { blocked: true, via: `组框全被挡：${top.join(' | ') || '框不在安全区内'}` }
  }, { area: grabSafeArea(stage) })
}

async function wheelZoom(page) {
  const stage = await stageBox(page)
  const center = { x: stage.x + stage.width * 0.4, y: stage.y + stage.height * 0.4 }
  await page.mouse.move(center.x, center.y)
  await startWindow(page)
  for (let index = 0; index < 40; index += 1) {
    await page.mouse.wheel(0, index < 20 ? -60 : 60)
    await sleep(page, 45)
  }
  return stopWindow(page)
}

async function panCanvas(page) {
  const stage = await stageBox(page)
  const area = grabSafeArea(stage)
  const origin = { x: (area.minX + area.maxX) / 2, y: (area.minY + area.maxY) / 2 }
  await page.mouse.move(origin.x, origin.y)
  await page.keyboard.down('Space')
  await page.mouse.down()
  await startWindow(page)
  const steps = 120
  for (let index = 1; index <= steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2
    await page.mouse.move(origin.x + Math.sin(angle) * 80, origin.y + (1 - Math.cos(angle)) * 40, { steps: 1 })
    await sleep(page, 14)
  }
  const raw = await stopWindow(page)
  await page.mouse.up()
  await page.keyboard.up('Space')
  await sleep(page, 250)
  return raw
}

async function zoomSliderDrag(page) {
  const slider = page.locator('.generation-canvas-v2__stage input[type="range"]').first()
  if (!(await slider.count())) return null
  const box = await slider.boundingBox()
  if (!box) return null
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + box.width * 0.5, y)
  await page.mouse.down()
  await startWindow(page)
  const steps = 90
  for (let index = 1; index <= steps; index += 1) {
    const ratio = 0.5 + Math.sin((index / steps) * Math.PI * 2) * 0.42
    await page.mouse.move(box.x + box.width * ratio, y, { steps: 1 })
    await sleep(page, 18)
  }
  const raw = await stopWindow(page)
  await page.mouse.up()
  await sleep(page, 400)
  return raw
}

// ——— 场景编排 ———————————————————————————————————————————

async function readViewport(page) {
  return page.evaluate(() => {
    const viewport = document.querySelector('.react-flow__viewport')
    const matrix = viewport ? new DOMMatrixReadOnly(getComputedStyle(viewport).transform) : null
    return {
      zoom: matrix ? Math.round(matrix.a * 1000) / 1000 : null,
      mountedNodes: document.querySelectorAll('.react-flow__node').length,
      // 轻量 LOD 的触发条件是 nodeCount>80 && zoom<0.55（canvasNodeLevelOfDetail.ts:29）——
      // 它会换掉卡片内部渲染，所以每一行都得记下来，否则两档之间比的不是同一个东西。
      lightweightNodes: document.querySelectorAll('[data-lightweight="true"], .generation-canvas-v2-node--lightweight').length,
    }
  })
}

/**
 * 手势前后各读一次 CDP Performance 指标，差值就是这段手势里的
 * 「JS 跑了多久 / 样式重算多久 / 布局多久」。这条比 CPU profile 便宜得多（两次同步调用），
 * 所以每次采样都开着——帧时间只告诉你「卡了」，这三个数才告诉你「卡在哪一层」。
 * 注意它是**累计计数器**，只有差值有意义；Paint/Composite 不在里面，
 * 所以「帧时间 − Script − Style − Layout」才是剩给绘制与合成的那块。
 */
async function readCdpMetrics(cdp) {
  const response = await cdp.send('Performance.getMetrics').catch(() => null)
  const map = new Map((response?.metrics || []).map((metric) => [metric.name, metric.value]))
  return {
    scriptMs: (map.get('ScriptDuration') || 0) * 1000,
    layoutMs: (map.get('LayoutDuration') || 0) * 1000,
    styleMs: (map.get('RecalcStyleDuration') || 0) * 1000,
    taskMs: (map.get('TaskDuration') || 0) * 1000,
    layoutCount: map.get('LayoutCount') || 0,
    styleCount: map.get('RecalcStyleCount') || 0,
    nodes: map.get('Nodes') || 0,
    jsHeapMb: Math.round(((map.get('JSHeapUsedSize') || 0) / 1024 / 1024) * 10) / 10,
  }
}

function diffCdpMetrics(before, after) {
  if (!before || !after) return null
  const round = (value) => Math.round(value * 10) / 10
  return {
    scriptMs: round(after.scriptMs - before.scriptMs),
    styleMs: round(after.styleMs - before.styleMs),
    layoutMs: round(after.layoutMs - before.layoutMs),
    taskMs: round(after.taskMs - before.taskMs),
    layoutCount: after.layoutCount - before.layoutCount,
    styleCount: after.styleCount - before.styleCount,
    jsHeapMb: after.jsHeapMb,
  }
}

async function runScenario(page, scenario, fixture) {
  const nodeTotal = fixture.summary.nodes
  if (scenario === 'drag-nodes-1') {
    await page.keyboard.press('Escape')
    await sleep(page, 200)
    const grab = await anyNodeGrabPoint(page)
    if (!grab) return { skipped: '找不到可抓取的节点' }
    await page.mouse.click(grab.x, grab.y)
    await sleep(page, 300)
    const viewport = await readViewport(page)
    const raw = await arcDrag(page, grab, {})
    return { selected: await selectedCount(page), raw, viewport, path: 'react-flow-kernel (single node · 对照组)' }
  }
  if (scenario.startsWith('drag-nodes-')) {
    const suffix = scenario.slice('drag-nodes-'.length)
    const want = suffix === 'all' ? nodeTotal : Number(suffix)
    await page.keyboard.press('Escape')
    // 全选走 Cmd+A（产品里真有这条路，useCanvasShortcuts.ts:154），框选够不到屏外的卡。
    let selection
    if (suffix === 'all') {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
      await sleep(page, 500)
      selection = { ok: true, selected: await selectedCount(page) }
    } else {
      selection = await marqueeSelectCount(page, want)
    }
    if (!selection.ok) return { skipped: selection.reason }
    const selected = await selectedCount(page)
    if (selected < 2) return { skipped: `框选只选中 ${selected} 个` }
    const grab = await selectedNodeGrabPoint(page)
    if (!grab) return { skipped: '一个选中的节点都没有' }
    if (grab.blocked) return { skipped: `抓手被挡：${grab.via}` }
    const viewport = await readViewport(page)
    const raw = await arcDrag(page, grab, {})
    return { selected, raw, viewport, path: `react-flow-kernel (${grab.via})` }
  }
  if (scenario === 'drag-group-frame-60') {
    await page.keyboard.press('Escape')
    const selection = await marqueeSelectCount(page, Math.min(60, nodeTotal))
    if (!selection.ok) return { skipped: selection.reason }
    const selected = await selectedCount(page)
    if (selected < 2) return { skipped: `框选只选中 ${selected} 个` }
    const frames = await groupSelected(page)
    if (!frames) return { skipped: '按 Cmd+G 没有建出组框' }
    // 建完组先点空白清掉选中：否则 React Flow 的选区罩子（.react-flow__nodesselection-rect）
    // 整个盖在组框上面，抓到的是罩子不是框，量的就成了另一条路。用户先建组、再点别处、
    // 然后去搬这个框，也正是这个顺序。
    const blank = await findCanvasBlankPoint(page, { preference: 'top-left', inset: 24 })
    if (blank) await page.mouse.click(blank.x, blank.y)
    await sleep(page, 400)
    const grab = await groupFrameGrabPoint(page)
    if (!grab) return { skipped: '画布上找不到组框元素' }
    if (grab.blocked) return { skipped: grab.via }
    const viewport = await readViewport(page)
    const raw = await arcDrag(page, grab, {})
    return { selected, raw, viewport, path: 'useCanvasSelectionDrag (zustand 每帧写)' }
  }
  if (scenario === 'marquee-select-all') {
    await page.keyboard.press('Escape')
    const viewport = await readViewport(page)
    const raw = await marqueeSelectAll(page, { record: true })
    return { selected: await selectedCount(page), raw, viewport, path: 'react-flow-selection' }
  }
  if (scenario === 'wheel-zoom') {
    await page.keyboard.press('Escape')
    return { raw: await wheelZoom(page), viewport: await readViewport(page), path: 'react-flow-viewport' }
  }
  if (scenario === 'pan') {
    await page.keyboard.press('Escape')
    return { raw: await panCanvas(page), viewport: await readViewport(page), path: 'react-flow-viewport' }
  }
  if (scenario === 'zoom-slider-drag') {
    await page.keyboard.press('Escape')
    return { raw: await zoomSliderDrag(page), viewport: await readViewport(page), path: 'zoomTo(duration:120)' }
  }
  throw new Error(`未知场景 ${scenario}`)
}

async function openFixtureProject(app, page, fixture) {
  const card = page.locator('[data-project-card]', { hasText: fixture.record.name }).first()
  await card.waitFor({ timeout: 30_000 })
  await card.click()
  await sleep(page, 1200)
  const continueButton = page.locator('[data-project-card]', { hasText: fixture.record.name }).getByText('继续创作').first()
  if (await continueButton.count().catch(() => 0)) await continueButton.click().catch(() => {})
  await page.locator('.generation-canvas-v2__stage').waitFor({ timeout: 60_000 })
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length > 0, undefined, { timeout: 60_000 })
  // 等图片解码落定：连续 3 次读数不变才算稳（不是等固定秒数——300 档比 60 档慢得多）。
  let stable = 0
  let previous = ''
  for (let attempt = 0; attempt < 40 && stable < 3; attempt += 1) {
    await sleep(page, 300)
    const key = await page.evaluate(() => {
      const images = Array.from(document.querySelectorAll('img[src]'))
      return `${document.querySelectorAll('.react-flow__node').length}:${images.length}:${images.filter((image) => image.complete).length}`
    })
    stable = key === previous ? stable + 1 : 0
    previous = key
  }
}

async function collectProfile(cdp, fn) {
  await cdp.send('Profiler.enable').catch(() => {})
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 }).catch(() => {})
  await cdp.send('Profiler.start').catch(() => {})
  const result = await fn()
  const profile = await cdp.send('Profiler.stop').catch(() => null)
  if (!profile?.profile) return { result, top: [] }
  const byKey = new Map()
  let totalHits = 0
  for (const node of profile.profile.nodes) {
    const hits = node.hitCount || 0
    if (!hits) continue
    totalHits += hits
    const frame = node.callFrame || {}
    const url = String(frame.url || '').split('/').pop() || '(anonymous)'
    const key = `${frame.functionName || '(anonymous)'} @ ${url}`
    byKey.set(key, (byKey.get(key) || 0) + hits)
  }
  const top = [...byKey.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([key, hits]) => ({ frame: key, hits, share: Math.round((hits / Math.max(1, totalHits)) * 1000) / 10 }))
  return { result, top, totalHits, sampleIntervalUs: 200 }
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true })
  const machine = {
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model || 'unknown',
    memoryGb: Math.round(os.totalmem() / 1024 ** 3),
    node: process.version,
    build: 'dist (pnpm build) + dev Electron binary',
    viewport: { width: 1600, height: 1000 },
  }
  const results = []
  for (const scale of scales) {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), `nomi-canvas-scale-${scale}-`))
    const projectsDir = path.join(fixtureRoot, 'projects')
    fs.mkdirSync(projectsDir, { recursive: true })
    const fixture = createCanvasPerformanceFixture({ projectsDir, scale })
    console.log(`\n=== 规模 ${scale}：${fixture.summary.nodes} 个节点 / ${fixture.summary.edges} 条边 ===`)
    for (const scenario of scenarios) {
      // 一个（规模 × 场景）起一次 app，里面跑 runs 次采样：每次手势都从「无选中 + 适应视图」
      // 重置，圆弧拖动走满一圈回到原点，所以样本之间的初始条件是同一个。
      // 组框场景会**改变项目状态**（建出一个组），所以它靠这一层的独立实例隔离，
      // 不会污染后面的场景。
      const samples = []
      let meta = null
      let profileTop = null
      let launchError = null
      let app = null
      try {
        const launched = await launchNomiApp({
          name: `canvas-scale-${scale}`,
          projectsDir,
          timeout: 120_000,
          viewportSize: machine.viewport,
          settleMs: 1200,
        })
        app = launched.app
        const page = launched.win
        page.on('pageerror', (error) => console.log(`    [pageerror] ${String(error?.message || error).slice(0, 160)}`))
        await openFixtureProject(app, page, fixture)
        for (let runIndex = 0; runIndex < runs; runIndex += 1) {
          await page.keyboard.press('Escape').catch(() => {})
          const fitted = await fitView(page)
          console.log(`    · 前置：zoom=${fitted.zoom} mounted=${fitted.mountedNodes} url=${String(page.url()).slice(-60)}`)
          if (!fitted.zoom || fitted.zoom > 0.9) console.log(`    ⚠️ 适应视图没生效——这一次采样的前置条件不成立`)
          await page.evaluate(PROBE_SOURCE)
          const wantProfile = withProfile && runIndex === 0
          const cdp = await app.context().newCDPSession(page)
          await cdp.send('Performance.enable').catch(() => {})
          activeCdp = cdp
          const outcome = wantProfile
            ? await collectProfile(cdp, () => runScenario(page, scenario, fixture))
            : { result: await runScenario(page, scenario, fixture), top: null }
          const cdpDelta = diffCdpMetrics(windowMetrics.before, windowMetrics.after)
          activeCdp = null
          await cdp.detach().catch(() => {})
          const scenarioResult = outcome.result
          if (scenarioResult.skipped) {
            console.log(`  [${scenario}] run${runIndex} 跳过：${scenarioResult.skipped}`)
            continue
          }
          const summary = summarize(scenarioResult.raw)
          if (!summary) { console.log(`  [${scenario}] run${runIndex} 没有采到帧`); continue }
          // profile 腿自己会抬高 script 时间（采样器开销），所以它的 CDP 差值不进中位数样本。
          Object.assign(summary, { loadAvg1: Math.round(os.loadavg()[0] * 10) / 10 })
          if (!wantProfile) Object.assign(summary, { cdpScriptMs: cdpDelta?.scriptMs ?? null, cdpStyleMs: cdpDelta?.styleMs ?? null, cdpLayoutMs: cdpDelta?.layoutMs ?? null, cdpTaskMs: cdpDelta?.taskMs ?? null, cdpLayoutCount: cdpDelta?.layoutCount ?? null, cdpStyleCount: cdpDelta?.styleCount ?? null, jsHeapMb: cdpDelta?.jsHeapMb ?? null })
          samples.push(summary)
          meta = { selected: scenarioResult.selected ?? null, path: scenarioResult.path, viewport: scenarioResult.viewport ?? null }
          if (outcome.top) profileTop = outcome.top
          console.log(
            `  [${scenario}] run${runIndex} sel=${scenarioResult.selected ?? '-'} zoom=${scenarioResult.viewport?.zoom ?? '-'} mounted=${scenarioResult.viewport?.mountedNodes ?? '-'} fps=${summary.fps} p50=${summary.frameP50Ms} p95=${summary.frameP95Ms} max=${summary.frameMaxMs} load=${summary.loadAvg1} script/style/layout=${cdpDelta?.scriptMs}/${cdpDelta?.styleMs}/${cdpDelta?.layoutMs}ms layouts=${cdpDelta?.layoutCount} 触碰/刷=${summary.medianTouchedPerFlush}/${summary.maxTouchedPerFlush} 长任务=${summary.longTasks}/${summary.longTaskMaxMs}ms`,
          )
          // 组框场景建了组：撤销掉，下一次采样回到同一起点。
          if (scenario === 'drag-group-frame-60') {
            await page.keyboard.press('Meta+z').catch(() => {})
            await page.keyboard.press('Meta+z').catch(() => {})
            await page.waitForTimeout(500)
          }
        }
      } catch (error) {
        launchError = String(error?.message || error)
        console.log(`  [${scenario}] 整组失败：${launchError}`)
      } finally {
        await closeNomiApp(app).catch(() => {})
      }
      if (samples.length) {
        const pick = (key) => median(samples.map((sample) => sample[key]))
        results.push({
          scale, scenario,
          nodes: fixture.summary.nodes,
          edges: fixture.summary.edges,
          ...meta,
          runs: samples.length,
          fps: pick('fps'),
          frameP50Ms: pick('frameP50Ms'),
          frameP95Ms: pick('frameP95Ms'),
          frameMaxMs: pick('frameMaxMs'),
          longTasks: pick('longTasks'),
          longTaskMs: pick('longTaskMs'),
          longTaskMaxMs: pick('longTaskMaxMs'),
          nodeStyleWrites: pick('nodeStyleWrites'),
          distinctTouchedNodes: pick('distinctTouchedNodes'),
          medianTouchedPerFlush: pick('medianTouchedPerFlush'),
          maxTouchedPerFlush: pick('maxTouchedPerFlush'),
          domFlushes: pick('domFlushes'),
          subtreeMutations: pick('subtreeMutations'),
          mountedNodes: pick('mountedNodes'),
          cdpScriptMs: pick('cdpScriptMs'),
          cdpStyleMs: pick('cdpStyleMs'),
          cdpLayoutMs: pick('cdpLayoutMs'),
          cdpTaskMs: pick('cdpTaskMs'),
          cdpLayoutCount: pick('cdpLayoutCount'),
          cdpStyleCount: pick('cdpStyleCount'),
          jsHeapMb: pick('jsHeapMb'),
          loadAvg1: pick('loadAvg1'),
          frameP50MsMin: Math.min(...samples.map((sample) => sample.frameP50Ms)),
          frameP95MsMin: Math.min(...samples.map((sample) => sample.frameP95Ms)),
          samples,
          profileTop,
        })
      } else {
        results.push({ scale, scenario, nodes: fixture.summary.nodes, edges: fixture.summary.edges, runs: 0, skipped: true, error: launchError })
      }
      fs.writeFileSync(path.join(outputDir, `canvas-scale-${label}.json`), JSON.stringify({ label, machine, generatedAt: new Date().toISOString(), scales, scenarios, runs, results }, null, 2))
    }
  }
  const outPath = path.join(outputDir, `canvas-scale-${label}.json`)
  console.log(`\n结果写入 ${outPath}`)
  console.log('\n| scale | nodes | scenario | selected | zoom | mounted | fps | p50 | p95 | max | script/style/layout ms | layouts | 长任务(次/最长ms) | 每帧触碰节点(中位/峰值) |')
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const row of results) {
    if (row.skipped) { console.log(`| ${row.scale} | ${row.nodes} | ${row.scenario} | - | - | - | 跳过 | | | | | | | |`); continue }
    console.log(`| ${row.scale} | ${row.nodes} | ${row.scenario} | ${row.selected ?? '-'} | ${row.viewport?.zoom ?? '-'} | ${row.viewport?.mountedNodes ?? '-'} | ${row.fps} | ${row.frameP50Ms} | ${row.frameP95Ms} | ${row.frameMaxMs} | ${row.cdpScriptMs}/${row.cdpStyleMs}/${row.cdpLayoutMs} | ${row.cdpLayoutCount} | ${row.longTasks}/${row.longTaskMaxMs} | ${row.medianTouchedPerFlush}/${row.maxTouchedPerFlush} |`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
