// 走查：连线「+」拉环 + Alt/⌥ 拖动复制 + 粘贴到鼠标处（2026-09-21）。
//
// 用户拍板（两条）：
//   A. 「+」拉环：所有能连线的卡同一种拉环；**唯一选中即常驻可见**（不再要求鼠标悬停在卡上），跟手保留；
//      多选退化为小圆点；未选中卡旁的连线照旧点得到（#656 常驻带子吞连线那版不许回来）。
//   B. 「Alt 是万能的」：Alt/⌥ 拖节点 / 拖框 / 拖结果堆叠里的单个版本 → 副本落在松手处、原件不动、⌘Z 一次撤掉；
//      ⌘C 后把鼠标移到哪、⌘V 就粘在哪（鼠标不在画布上才回到画布中央）。
//
// 驱动：真实 Electron + 真实鼠标 / 键盘（Playwright mouse / keyboard，Alt 由 keyboard.down 按住，
// 与真人按住 Option 拖动同一种输入）。项目以磁盘上的 project.json 打开（与用户打开自己的项目同一路径），
// 媒体用登记表里的真实 4K HEVC 视频派生：两张 4K PNG 帧 + 一段 4 秒原码流切片（不转码，仍是 10-bit HEVC）。
//
// 用法：
//   export NOMI_REAL_MEDIA_DIR="/Users/aoqimin/Desktop/视频/"
//   pnpm run build && node tests/ux/canvas-handles-alt-drag.walk.mjs [zh-CN|en] [label]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { expect, screenshotSettled, waitForVisualQuiescence } from './_assert.mjs'
import { findCanvasBlankPoint, findFrameDragHandlePoint, findNodeHitPoint, CANVAS_FRAME_SELECTOR, CANVAS_STAGE_SELECTOR } from './_canvasHit.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { requireRealMediaAssets } from './fixtures/realMedia.mjs'
import { createCanvasPerformanceFixture } from './fixtures/canvas-performance-fixture.mjs'

const LOCALE = process.argv[2] === 'en' ? 'en' : 'zh-CN'
const LABEL = process.argv[3] || 'run'
const shotsDir = path.join(repoRoot, 'tests/ux/shots/canvas-handles-alt-drag', `${LABEL}-${LOCALE}`)
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

// ── 真实素材（缺即红，不退回合成素材）。
const { assets } = requireRealMediaAssets(['video-4k-hevc-10bit', 'image-4k-png'])
const sourceVideo = assets.get('video-4k-hevc-10bit').file
const derivedSpec = assets.get('image-4k-png').spec
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-handles-alt-'))
const PROJECT_ID = 'project-handles-alt-drag'
const fixture = createCanvasPerformanceFixture({ projectsDir: path.join(temp, 'projects'), scale: 'empty', projectId: PROJECT_ID, projectName: 'Alt 拖动复制验收' })
const mediaDir = path.join(fixture.projectRoot, 'assets', 'imported')
fs.mkdirSync(mediaDir, { recursive: true })
for (const [name, at] of [['frame-a.png', '00:00:05'], ['frame-b.png', '00:00:40']]) {
  const file = path.join(mediaDir, name)
  execFileSync(ffmpeg.path, ['-y', '-ss', at, '-i', sourceVideo, '-frames:v', '1', file], { stdio: 'pipe' })
  if (fs.statSync(file).size < derivedSpec.minBytes) throw new Error(`抽帧 ${name} 过小，多半黑帧`)
}
execFileSync(ffmpeg.path, ['-y', '-ss', '00:00:10', '-i', sourceVideo, '-t', '4', '-c', 'copy', '-an', path.join(mediaDir, 'clip.mov')], { stdio: 'pipe' })
const url = (name) => `nomi-local://asset/${PROJECT_ID}/assets/imported/${name}`
const imageResult = (id, name) => ({ id, type: 'image', url: url(name), thumbnailUrl: url(name), createdAt: 1 })
const IMAGE_META = { imageWidth: 3840, imageHeight: 2160, imageAspectRatio: 16 / 9 }

// ── 画布：每一种节点各一张（GENERATION_NODE_KINDS 全表，走查按 kind 逐个选中验「+」圈），
// 一张带两个版本的图片卡（结果堆叠），一个装着两张图的框，一条从 A 连到 B 的边（B 未选中时边要点得到）。
const SHOT_TABLE = {"schemaVersion":1,"view":{"selectedRowIds":[],"density":"auto"},"revision":0,"updatedAt":"2026-09-21T10:10:42.999Z","source":{"kind":"deconstruction","sourceNodeId":"kind-video","title":"Reference","status":"idle"},"columnSetId":"facts","columns":[{"columnId":"shotSize","kind":"builtin","labelKey":"shotSize","order":0,"visible":true},{"columnId":"motion","kind":"builtin","labelKey":"motion","order":1,"visible":true},{"columnId":"visual","kind":"builtin","labelKey":"visual","order":2,"visible":true},{"columnId":"dialogue","kind":"builtin","labelKey":"dialogue","order":3,"visible":true},{"columnId":"onScreenText","kind":"builtin","labelKey":"onScreenText","order":4,"visible":true},{"columnId":"mood","kind":"builtin","labelKey":"mood","order":5,"visible":true}],"rows":[]}
const KINDS = ['shot_table', 'text', 'character', 'scene', 'image', 'keyframe', 'video', 'audio', 'clip', 'shot', 'output', 'panorama', 'director', 'whiteboard', 'model3d', 'asset', 'agent-artifact']
const nodes = KINDS.map((kind, index) => {
  const node = {
    id: `kind-${kind}`,
    kind,
    title: `${kind}`,
    prompt: '',
    categoryId: 'shots',
    position: { x: 80 + (index % 4) * 1100, y: 80 + Math.floor(index / 4) * 620 },
    references: [], history: [], runs: [],
    status: 'idle',
  }
  if (kind === 'image' || kind === 'asset' || kind === 'keyframe') {
    const result = imageResult(`${kind}-r1`, 'frame-a.png')
    Object.assign(node, { result, history: [result], status: 'success', meta: { ...IMAGE_META } })
  }
  // 分镜表的卡面由表格文档驱动（meta.shotTable 必填）；这是 createDeconstructionShotTable 产出的空表原样。
  if (kind === 'shot_table') node.meta = { shotTable: SHOT_TABLE }
  if (kind === 'video') {
    const result = { id: 'video-r1', type: 'video', url: url('clip.mov'), createdAt: 1 }
    Object.assign(node, { result, history: [result], status: 'success' })
  }
  return node
})
// 结果堆叠：两个版本（第 2 个是另一时刻的帧）。
const stackV1 = imageResult('stack-v1', 'frame-a.png')
const stackV2 = imageResult('stack-v2', 'frame-b.png')
nodes.push({
  id: 'stack', kind: 'image', title: '两个版本', prompt: '', categoryId: 'shots',
  position: { x: 80, y: 3300 }, references: [], runs: [], status: 'success',
  result: stackV1, history: [stackV1, stackV2], meta: { ...IMAGE_META },
})
// 框：两张图。
for (const [index, id] of ['frame-m1', 'frame-m2'].entries()) {
  nodes.push({
    id, kind: 'image', title: `框内 ${index + 1}`, prompt: '', categoryId: 'shots', groupId: 'frame-rain',
    position: { x: 1260 + index * 420, y: 3340 }, references: [], runs: [], status: 'success',
    result: imageResult(`${id}-r`, 'frame-b.png'), history: [imageResult(`${id}-r`, 'frame-b.png')], meta: { ...IMAGE_META },
  })
}
const groups = [{
  id: 'frame-rain', name: '雨夜', categoryId: 'shots', nodeIds: ['frame-m1', 'frame-m2'],
  frameBounds: { x: 1220, y: 3240, w: 860, h: 400 }, createdAt: 1, updatedAt: 1,
}]
const edges = [{ id: 'edge-text-scene', source: 'kind-text', target: 'kind-scene', mode: 'reference' }]
fixture.record.payload.generationCanvas = { nodes, edges, groups, selectedNodeIds: [] }
fs.writeFileSync(path.join(fixture.projectRoot, '.nomi/project.json'), JSON.stringify(fixture.record))

const failures = []
const results = {}
function check(ok, label, detail) {
  const line = `${label} — ${JSON.stringify(detail)}`
  if (ok) console.log(`  ✓ ${line}`)
  else { console.error(`  ✖ ${line}`); failures.push(line) }
  return ok
}

const { app, win: first, tempRoot, mainLogTail } = await launchNomiApp({
  name: `canvas-handles-alt-drag-${LOCALE}`,
  projectsDir: fixture.projectsDir,
  syntheticCredentialStorage: true,
  settleMs: 0,
  initialLocalStorage: {
    'nomi:locale:v1': LOCALE,
    'nomi:splash:v1': 'seen',
    'nomi:journey-tour:v1': 'seen',
    'nomi:canvas-gesture-hint:v1': 'seen',
  },
})
let win = first
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const sel = (id) => `.react-flow__node[data-id="${id}"]`
const shot = (name) => screenshotSettled(win, { path: path.join(shotsDir, `${name}.png`) })

async function readViewport() {
  return win.evaluate(() => {
    const layer = document.querySelector('.react-flow__viewport')
    const flow = document.querySelector('.react-flow').getBoundingClientRect()
    const m = new DOMMatrixReadOnly(getComputedStyle(layer).transform)
    return { x: m.m41, y: m.m42, zoom: m.a, left: flow.left, top: flow.top }
  })
}
const toCanvas = (vp, p) => ({ x: (p.x - vp.left - vp.x) / vp.zoom, y: (p.y - vp.top - vp.y) / vp.zoom })
const toScreen = (vp, p) => ({ x: p.x * vp.zoom + vp.x + vp.left, y: p.y * vp.zoom + vp.y + vp.top })

async function nodeIds() {
  return win.evaluate(() => Array.from(document.querySelectorAll('.react-flow__node')).map((n) => n.getAttribute('data-id')))
}
async function rectOf(selector) {
  return win.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
  }, selector)
}
/** 画布坐标下的外接盒（扣掉视口，才能判「原件不动」「副本落在松手处」而不受视口平移影响——画布不再自己让位平移，但用户的拖拽 / 缩放仍会动它）。 */
async function canvasRectOf(selector) {
  const r = await rectOf(selector)
  if (!r) return null
  const vp = await readViewport()
  const tl = toCanvas(vp, { x: r.left, y: r.top })
  return { x: tl.x, y: tl.y, w: r.width / vp.zoom, h: r.height / vp.zoom, cx: tl.x + r.width / vp.zoom / 2, cy: tl.y + r.height / vp.zoom / 2 }
}
/** 节点在画布上的位置真相：React Flow 节点外壳的 translate（= store 里的 position），不受卡面装饰影响。 */
async function nodePosition(id) {
  return win.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el) return null
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform)
    return { x: m.m41, y: m.m42 }
  }, sel(id))
}
async function handleState(id) {
  return win.evaluate((nodeId) => {
    const node = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`)
    return ['left', 'right'].map((side) => {
      const handle = node?.querySelector(`.react-flow__handle[data-handleid="source-${side}"]`)
      const hit = handle?.querySelector('.generation-canvas-react-flow__handle-hit')
      const icon = handle?.querySelector('.generation-canvas-react-flow__handle-icon')
      const style = icon ? getComputedStyle(icon) : null
      const hr = hit?.getBoundingClientRect()
      const ir = icon?.getBoundingClientRect()
      // 「看得见」不等于「在最上面」：computed style 全对时，卡面里的别的东西仍可能正好盖在圈上
      // （2026-09-24 用户反馈：版本托盘展开时，侧边时间轴拖柄压住右侧「+」圈，圈看不见也拖不出线）。
      // 只算画布里的遮挡（卡面 / 卡上控件）：宽卡的一侧落在舞台外、被侧栏压住，是视口问题不是把手问题。
      const top = ir && ir.width > 0 ? document.elementFromPoint(ir.left + ir.width / 2, ir.top + ir.height / 2) : null
      const coveredOnCanvas = Boolean(top && !handle?.contains(top) && top.closest('.react-flow__node'))
      return {
        onTop: !coveredOnCanvas,
        side,
        affordance: handle?.getAttribute('data-affordance') ?? null,
        iconOpacity: style ? Number(style.opacity) : null,
        iconVisible: Boolean(style && style.display !== 'none' && style.visibility !== 'hidden' && ir && ir.width > 0),
        plus: Boolean(icon?.querySelector('svg')),
        hit: hr ? { w: Math.round(hr.width), h: Math.round(hr.height) } : null,
        icon: ir ? { w: Math.round(ir.width), h: Math.round(ir.height) } : null,
      }
    })
  }, id)
}
async function clickBlank() {
  const point = await findCanvasBlankPoint(win, { preference: 'bottom' })
  expect(point, '画布上找不到真空白').not.toBeNull()
  await win.mouse.click(point.x, point.y)
  await waitForVisualQuiescence(win)
  return point
}
/** 画布坐标 → 这张卡/框的中心（夹具里写死的位置；卡可能还没渲染，因为画布只渲染视口里的卡）。 */
function canvasCenterOf(target) {
  if (typeof target === 'object') return target
  if (target.startsWith('frame:')) {
    const frame = groups.find((group) => group.id === target.slice(6)).frameBounds
    return { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 }
  }
  const node = nodes.find((candidate) => candidate.id === target)
  const width = node.kind === 'shot_table' ? 960 : 340
  return { x: node.position.x + width / 2, y: node.position.y + 150 }
}
/** 把画布上某一点平移到舞台中央：像人一样在空白处左键拖（平移手势），一次拖不够就多拖几次。 */
async function bringIntoView(target) {
  const goal = canvasCenterOf(target)
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const stage = await rectOf(CANVAS_STAGE_SELECTOR)
    const vp = await readViewport()
    const screen = toScreen(vp, goal)
    const dx = stage.cx - 120 - screen.x
    const dy = stage.cy - screen.y
    if (Math.abs(dx) < 60 && Math.abs(dy) < 60) break
    if (process.env.WALK_DEBUG) console.log('PAN', target, JSON.stringify({ goal, screen, dx, dy, vp }))
    // 往哪边拖就从反方向那一侧起手，一次拖得最远。
    const start = await findCanvasBlankPoint(win, { inset: 60, preference: dx > 0 ? 'top-left' : 'default' })
    expect(start, '平移起手点找不到空白').not.toBeNull()
    const end = {
      x: Math.max(stage.left + 60, Math.min(stage.left + stage.width - 60, start.x + dx)),
      y: Math.max(stage.top + 60, Math.min(stage.top + stage.height - 60, start.y + dy)),
    }
    await win.mouse.move(start.x, start.y)
    await win.mouse.down()
    await win.mouse.move(end.x, end.y, { steps: 12 })
    await win.mouse.up()
    await waitForVisualQuiescence(win)
  }
}
async function selectNode(id) {
  await bringIntoView(id)
  let point = null
  await expect.poll(async () => {
    point = await findNodeHitPoint(win, { nodeSelector: sel(id) })
    return point !== null
  }, { message: `${id} 卡上找不到一处点得到的地方` }).toBe(true)
  await win.mouse.click(point.x, point.y)
  await expect(win.locator(sel(id)), `${id} 点了没选中`).toHaveClass(/selected/)
  await waitForVisualQuiescence(win)
  return point
}
/**
 * 像人一样拖：按下后先挪 2px（真人按下后的第一下移动就是这么小），再一路拖到目标。
 * 不这样做的话，画布内核要等指针越过拖动阈值才开始跟手，Playwright 的第一步动辄 20px，
 * 那一步会被整段吃掉——量到的偏差是「合成输入的步长」，不是产品的落点误差。
 */
async function humanDrag(from, to, { alt = false } = {}) {
  if (alt) await win.keyboard.down('Alt')
  await win.mouse.move(from.x, from.y)
  await win.mouse.down()
  await win.mouse.move(from.x + 2, from.y + 1)
  await win.mouse.move(to.x, to.y, { steps: 20 })
  await win.mouse.up()
  if (alt) await win.keyboard.up('Alt')
  await waitForVisualQuiescence(win)
}
async function undoOnce() {
  await win.keyboard.press(`${MOD}+z`)
  await waitForVisualQuiescence(win)
}
async function stageBlankTarget(avoid = []) {
  // 舞台里一个离所有卡都远的空白点，用作「松手点」。
  const stage = await rectOf(CANVAS_STAGE_SELECTOR)
  return win.evaluate(({ stage, avoid }) => {
    for (const ry of [0.78, 0.7, 0.62, 0.3, 0.22]) {
      for (const rx of [0.7, 0.62, 0.55, 0.45, 0.35, 0.8]) {
        const x = stage.left + stage.width * rx
        const y = stage.top + stage.height * ry
        const hit = document.elementFromPoint(x, y)
        if (!hit?.classList.contains('react-flow__pane')) continue
        // 周围 150px 内也必须都是空白：副本以中心落下，不能压到别的卡上导致量错。
        const around = [[-150, 0], [150, 0], [0, -110], [0, 110]].every(([ox, oy]) => document.elementFromPoint(x + ox, y + oy)?.classList.contains('react-flow__pane'))
        if (!around) continue
        if (avoid.some((p) => Math.hypot(p.x - x, p.y - y) < 200)) continue
        return { x: Math.round(x), y: Math.round(y) }
      }
    }
    return null
  }, { stage, avoid })
}

const consoleErrors = []
const watchConsole = (page) => page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 400))
})
watchConsole(first)
app.on('window', watchConsole)

try {
  await app.context().addInitScript(() => {
    localStorage.setItem('__nomiE2E', '1')
  })
  await win.locator('[data-project-card]', { hasText: fixture.record.name }).click({ timeout: stationTimeout({ operations: 2 }) })
  await expect.poll(() => app.windows().some((page) => /projectId=/.test(page.url())), { timeout: stationTimeout() }).toBe(true)
  win = app.windows().find((page) => /projectId=/.test(page.url()))
  const bw = await app.browserWindow(win)
  await bw.evaluate((window) => {
    window.setBounds({ x: 0, y: 0, width: 1800, height: 1100 })
    window.setIgnoreMouseEvents(true)
  })
  await win.locator(CANVAS_STAGE_SELECTOR).waitFor({ timeout: stationTimeout() })
  // 画布只渲染视口里的卡（onlyRenderVisibleElements），所以这里只等「有卡出来」，逐张验时再把它平移进视口。
  await expect(win.locator('.react-flow__node').first(), '项目打开后画布上一张卡都没有').toBeVisible({ timeout: stationTimeout() })
  await waitForVisualQuiescence(win)
  await shot('00-canvas-ready')

  // ═══ A1 每一种能连线的卡：唯一选中 → 「+」圈常驻可见；鼠标移开仍可见 ═══
  const kindRows = []
  for (const kind of KINDS) {
    const id = `kind-${kind}`
    await selectNode(id)
    // 鼠标移开：移到舞台外（左侧竖排工具条之外的窗口边缘），不悬停在任何卡上。
    await win.mouse.move(4, 4)
    await waitForVisualQuiescence(win)
    const state = await handleState(id)
    const ok = state.every((s) => s.affordance === 'magnetic' && s.iconVisible && s.onTop && s.plus && s.iconOpacity >= 0.8)
    kindRows.push({ kind, ok, state })
    check(ok, `A1·${kind}：唯一选中、鼠标移开后左右「+」圈仍可见且在最上层`, state.map((s) => ({ side: s.side, affordance: s.affordance, opacity: s.iconOpacity, onTop: s.onTop })))
    if (['image', 'video', 'text', 'audio', 'panorama', 'director', 'clip', 'shot_table'].includes(kind)) await shot(`01-plus-${kind}`)
  }
  results.kinds = kindRows

  // ═══ A2 未选中卡 = 小圆点，几何对照旧设计（28px 命中 + 14px 圆点，× 当前缩放） ═══
  await bringIntoView('kind-text')
  await clickBlank()
  const vpDots = await readViewport()
  const dotState = await handleState('kind-text')
  results.dotGeometry = { zoom: vpDots.zoom, state: dotState }
  check(dotState.every((s) => s.affordance === 'dot'), 'A2·未选中卡是小圆点', dotState.map((s) => s.affordance))
  check(dotState.every((s) => s.hit && Math.abs(s.hit.w / vpDots.zoom - 28) <= 1 && Math.abs(s.icon.w / vpDots.zoom - 14) <= 1),
    'A2·圆点几何：命中 28px、可见点 14px（画布坐标，逐字同迁移前 w-7 按钮 + 14px 点）', dotState.map((s) => ({ hit: s.hit.w / vpDots.zoom, icon: s.icon.w / vpDots.zoom })))

  // ═══ A3 多选 → 全体退回小圆点 ═══
  // 两张上下相邻的卡（同一列）：先把两者的中点平移到舞台中央，两张都点得到。
  await bringIntoView({ x: 250, y: 1150 })
  const firstPoint = await findNodeHitPoint(win, { nodeSelector: sel('kind-image') })
  expect(firstPoint, 'kind-image 点不到').not.toBeNull()
  await win.mouse.click(firstPoint.x, firstPoint.y)
  const second = await findNodeHitPoint(win, { nodeSelector: sel('kind-clip') })
  if (second) {
    await win.keyboard.down('Shift')
    await win.mouse.click(second.x, second.y)
    await win.keyboard.up('Shift')
  }
  await waitForVisualQuiescence(win)
  const multi = [...await handleState('kind-image'), ...await handleState('kind-clip')]
  check(Boolean(second) && multi.every((s) => s.affordance === 'dot'), 'A3·多选两张 → 两张都退回小圆点', multi.map((s) => s.affordance))
  await shot('02-multi-select-dots')

  // ═══ A4 选中一张卡时，穿过**未选中卡**外侧（带子若常驻就会盖住的位置）的连线仍点得到 ═══
  await selectNode('kind-image')
  await bringIntoView('kind-scene')
  const edgeProbe = await win.evaluate(() => {
    const target = document.querySelector('.react-flow__node[data-id="kind-scene"]').getBoundingClientRect()
    const path = document.querySelector('.react-flow__edge[data-id="edge-text-scene"] .generation-canvas-v2__edge-hit')
      || document.querySelector('.react-flow__edge[data-id="edge-text-scene"] path')
    if (!path) return { error: 'edge path missing' }
    const matrix = path.getScreenCTM()
    const total = path.getTotalLength()
    for (let step = 99; step >= 1; step -= 1) {
      const local = path.getPointAtLength((total * step) / 100)
      const p = new DOMPoint(local.x, local.y).matrixTransform(matrix)
      // 目标卡左侧外 20~100px：旧版常驻带子（112px）正好盖在这里。
      if (p.x < target.left - 20 && p.x > target.left - 100) {
        const hit = document.elementFromPoint(p.x, p.y)
        return { x: p.x, y: p.y, gapToCard: Math.round(target.left - p.x), hitIsEdge: Boolean(hit?.closest('.react-flow__edge')), hitIsHandle: Boolean(hit?.closest('.generation-canvas-react-flow__handle')) }
      }
    }
    return { error: 'no edge point beside the card' }
  })
  results.edgeBesideUnselected = edgeProbe
  check(!edgeProbe.error && edgeProbe.hitIsEdge && !edgeProbe.hitIsHandle, 'A4·另一张卡选中时，未选中卡旁的连线最顶层仍是连线（不被把手吞掉）', edgeProbe)
  if (!edgeProbe.error) {
    await win.mouse.click(edgeProbe.x, edgeProbe.y)
    await waitForVisualQuiescence(win)
    const edgeSelected = await win.evaluate(() => Boolean(document.querySelector('.react-flow__edge[data-id="edge-text-scene"].selected, .react-flow__edge[data-id="edge-text-scene"] [data-selected="true"], .generation-canvas-react-flow__edge-label')))
    check(edgeSelected, 'A4·点下去选中的是那条连线（出现边菜单胶囊）', { edgeSelected })
    await shot('03-edge-beside-unselected-card-clickable')
  }

  // ═══ B1 Alt/⌥ 拖节点 → 副本落在松手处、原件不动、⌘Z 一次撤掉 ═══
  {
    const grab = await selectNode('kind-image')
    const originalBefore = await nodePosition('kind-image')
    const before = await nodeIds()
    const target = await stageBlankTarget([grab])
    expect(target, '舞台里找不到放副本的空白处').not.toBeNull()
    const vp = await readViewport()
    const grabCanvas = toCanvas(vp, grab)
    const targetCanvas = toCanvas(vp, target)
    // 对照：同样的手势不按 Alt（普通搬动）落在哪。副本必须和「搬过去」落在同一处，偏差才归零到产品本身。
    await humanDrag(grab, target)
    const moved = await nodePosition('kind-image')
    results.plainDragControl = { dx: Math.round(moved.x - originalBefore.x - (targetCanvas.x - grabCanvas.x)), dy: Math.round(moved.y - originalBefore.y - (targetCanvas.y - grabCanvas.y)) }
    await undoOnce()
    check((await nodePosition('kind-image')).x === originalBefore.x, 'B1·对照：普通搬动后 ⌘Z 回到原位', results.plainDragControl)
    await humanDrag(grab, target, { alt: true })
    const added = (await nodeIds()).filter((id) => !before.includes(id))
    const copy = added[0] ? await nodePosition(added[0]) : null
    const originalAfter = await nodePosition('kind-image')
    // 抓点在卡上的相对位置保持不变 → 副本左上 = 原件左上 + (松手 - 抓点)。
    const expected = { x: originalBefore.x + (targetCanvas.x - grabCanvas.x), y: originalBefore.y + (targetCanvas.y - grabCanvas.y) }
    const deviation = copy ? { dx: Math.round(copy.x - expected.x), dy: Math.round(copy.y - expected.y) } : null
    results.altDragNode = { added, deviation, originalMoved: { dx: Math.round(originalAfter.x - originalBefore.x), dy: Math.round(originalAfter.y - originalBefore.y) } }
    check(added.length === 1, 'B1·Alt 拖节点多出一张副本', added)
    check(deviation && Math.abs(deviation.dx) <= 2 && Math.abs(deviation.dy) <= 2, 'B1·副本落在松手处（抓点偏差 ≤2 画布 px）', deviation)
    check(results.altDragNode.originalMoved.dx === 0 && results.altDragNode.originalMoved.dy === 0, 'B1·原件原地不动', results.altDragNode.originalMoved)
    await shot('04-alt-drag-node')
    await undoOnce()
    check((await nodeIds()).length === before.length, 'B1·⌘Z 一次撤掉整个副本', { now: (await nodeIds()).length, before: before.length })
  }

  // ═══ B2 Alt/⌥ 拖框 → 框连成员一起复制、落在松手处、原框不动、⌘Z 一次撤掉 ═══
  {
    await clickBlank()
    await bringIntoView('frame:frame-rain')
    const frameSel = `${CANVAS_FRAME_SELECTOR}[data-group-id="frame-rain"]`
    const grab = await findFrameDragHandlePoint(win, { frameSelector: frameSel })
    expect(grab, '框体上找不到抓得住的一点').not.toBeNull()
    const frameBefore = await canvasRectOf(frameSel)
    const framesBefore = await win.locator(CANVAS_FRAME_SELECTOR).count()
    const nodesBefore = await nodeIds()
    const stage = await rectOf(CANVAS_STAGE_SELECTOR)
    // 往上方空处拖：框高 400 画布 px，拖动量取舞台高的 1/3。
    const target = { x: Math.round(grab.x), y: Math.round(Math.max(stage.top + 30, grab.y - stage.height / 3)) }
    const vp = await readViewport()
    const delta = { x: (target.x - grab.x) / vp.zoom, y: (target.y - grab.y) / vp.zoom }
    await humanDrag(grab, target, { alt: true })
    const framesAfter = await win.locator(CANVAS_FRAME_SELECTOR).count()
    const newFrameId = await win.evaluate((selector) => Array.from(document.querySelectorAll(selector)).map((el) => el.getAttribute('data-group-id')).find((id) => id !== 'frame-rain') ?? null, CANVAS_FRAME_SELECTOR)
    const copyRect = newFrameId ? await canvasRectOf(`${CANVAS_FRAME_SELECTOR}[data-group-id="${newFrameId}"]`) : null
    const frameAfter = await canvasRectOf(frameSel)
    const addedNodes = (await nodeIds()).filter((id) => !nodesBefore.includes(id))
    const deviation = copyRect ? { dx: Math.round(copyRect.x - (frameBefore.x + delta.x)), dy: Math.round(copyRect.y - (frameBefore.y + delta.y)) } : null
    results.altDragFrame = { framesBefore, framesAfter, addedNodes, deviation, originalMoved: { dx: Math.round(frameAfter.x - frameBefore.x), dy: Math.round(frameAfter.y - frameBefore.y) } }
    check(framesAfter === framesBefore + 1 && addedNodes.length === 2, 'B2·Alt 拖框：多出一个框 + 两张成员副本', { framesBefore, framesAfter, addedNodes })
    check(deviation && Math.abs(deviation.dx) <= 2 && Math.abs(deviation.dy) <= 2, 'B2·副本框落在松手处（偏差 ≤2 画布 px）', deviation)
    check(results.altDragFrame.originalMoved.dx === 0 && results.altDragFrame.originalMoved.dy === 0, 'B2·原框原地不动', results.altDragFrame.originalMoved)
    await shot('05-alt-drag-frame')
    await undoOnce()
    const undone = { frames: await win.locator(CANVAS_FRAME_SELECTOR).count(), nodes: (await nodeIds()).length }
    check(undone.frames === framesBefore && undone.nodes === nodesBefore.length, 'B2·⌘Z 一次撤掉框 + 成员', undone)
  }

  // ═══ B3 结果堆叠里的第 2 个版本：普通拖不动；Alt 拖 → 松手处出一张独立素材卡，原堆叠不变 ═══
  {
    await selectNode('stack')
    const toggle = win.locator(`${sel('stack')} [data-card-stack-side] button[aria-expanded]`).first()
    await toggle.click()
    const tray = win.locator(`[data-node-result-stack="stack"]`)
    await expect(tray, '版本托盘没打开').toBeVisible()
    await waitForVisualQuiescence(win)
    await shot('06-result-stack-open')
    await win.mouse.move(4, 4)
    await waitForVisualQuiescence(win)
    const trayHandles = await handleState('stack')
    check(trayHandles.every((s) => s.affordance === 'magnetic' && s.iconVisible && s.onTop), 'B3·版本托盘展开时左右「+」圈仍在最上层（不被别的卡面控件盖住）', trayHandles.map((s) => ({ side: s.side, onTop: s.onTop })))
    const row = tray.locator('[data-result-stack-item]').nth(1)
    const rowBox = await row.boundingBox()
    const grab = { x: rowBox.x + 30, y: rowBox.y + rowBox.height / 2 }
    const before = await nodeIds()
    const target = await stageBlankTarget([grab])
    expect(target, '舞台里找不到放结果副本的空白处').not.toBeNull()
    // 普通拖：什么也不发生。
    await humanDrag(grab, target)
    check((await nodeIds()).length === before.length, 'B3·不按 Alt 拖版本：画布上不多出东西', { before: before.length, now: (await nodeIds()).length })
    if (!(await tray.isVisible())) await toggle.click()
    const rowBox2 = await tray.locator('[data-result-stack-item]').nth(1).boundingBox()
    const grab2 = { x: rowBox2.x + 30, y: rowBox2.y + rowBox2.height / 2 }
    await humanDrag(grab2, target, { alt: true })
    const added = (await nodeIds()).filter((id) => !before.includes(id))
    const copy = added[0] ? await rectOf(sel(added[0])) : null
    const copyUrl = added[0] ? await win.evaluate((s) => document.querySelector(s)?.querySelector('img')?.getAttribute('src') ?? null, sel(added[0])) : null
    const deviation = copy ? { dx: Math.round(copy.cx - target.x), dy: Math.round(copy.cy - target.y) } : null
    const stackCount = await win.locator(`${sel('stack')} [data-card-stack-side] button[aria-expanded]`).first().getAttribute('aria-label')
    results.altDragResult = { added, deviation, copyUrl, stackLabel: stackCount }
    check(added.length === 1, 'B3·Alt 拖第 2 个版本 → 多出一张独立卡', added)
    check(deviation && Math.abs(deviation.dx) <= 3 && Math.abs(deviation.dy) <= 3, 'B3·新卡中心落在松手点（屏幕 px 偏差 ≤3）', deviation)
    check(Boolean(copyUrl && copyUrl.includes('frame-b.png')), 'B3·新卡是第 2 个版本那张图', { copyUrl })
    check(/2/.test(stackCount ?? ''), 'B3·原卡的版本堆叠仍是 2 个', { stackCount })
    await shot('07-alt-drag-result-version')
    await undoOnce()
    check((await nodeIds()).length === before.length, 'B3·⌘Z 一次撤掉那张卡', { before: before.length, now: (await nodeIds()).length })
  }

  // ═══ B4 ⌘C → 鼠标移到画布另一处 → ⌘V：粘贴物中心落在鼠标处；鼠标离开画布 → 落在画布中央 ═══
  {
    await selectNode('kind-asset')
    await win.keyboard.press(`${MOD}+c`)
    const before = await nodeIds()
    const target = await stageBlankTarget()
    expect(target, '舞台里找不到粘贴的空白处').not.toBeNull()
    await win.mouse.move(target.x, target.y, { steps: 8 })
    await win.keyboard.press(`${MOD}+v`)
    let added = []
    await expect.poll(async () => {
      added = (await nodeIds()).filter((id) => !before.includes(id))
      return added.length
    }, { message: '⌘V 后没出现粘贴物', timeout: stationTimeout() }).toBe(1)
    await waitForVisualQuiescence(win)
    const pasted = await rectOf(sel(added[0]))
    const deviation = { dx: Math.round(pasted.cx - target.x), dy: Math.round(pasted.cy - target.y) }
    results.pasteAtPointer = { target, deviation }
    check(Math.abs(deviation.dx) <= 3 && Math.abs(deviation.dy) <= 3, 'B4·⌘V 粘贴物中心落在鼠标处（屏幕 px 偏差 ≤3）', deviation)
    await shot('08-paste-at-pointer')

    // 鼠标离开舞台（移到窗口左上角外沿）→ 落在舞台中央。
    const before2 = await nodeIds()
    await win.mouse.move(2, 2, { steps: 4 })
    await win.keyboard.press(`${MOD}+v`)
    let added2 = []
    await expect.poll(async () => {
      added2 = (await nodeIds()).filter((id) => !before2.includes(id))
      return added2.length
    }, { message: '鼠标在画布外 ⌘V 后没出现粘贴物', timeout: stationTimeout() }).toBe(1)
    await waitForVisualQuiescence(win)
    const stage = await rectOf(CANVAS_STAGE_SELECTOR)
    const pasted2 = await rectOf(sel(added2[0]))
    const deviation2 = { dx: Math.round(pasted2.cx - stage.cx), dy: Math.round(pasted2.cy - stage.cy) }
    results.pasteOutsideStage = { deviation: deviation2 }
    check(Math.abs(deviation2.dx) <= 3 && Math.abs(deviation2.dy) <= 3, 'B4·鼠标不在画布上 → 粘贴物中心在舞台中央（偏差 ≤3）', deviation2)
  }

  // ═══ B5 提示：画布操作帮助里有「⌥ Option + 拖动 / Alt + 拖动」一行 ═══
  {
    await clickBlank()
    const help = win.getByRole('button', { name: LOCALE === 'en' ? 'Canvas controls' : '画布操作', exact: true }).first()
    // 真人只能点露在外面的那部分：先量按钮中心最顶层是不是它自己。
    const helpHittable = await help.evaluate((button) => {
      const r = button.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return { ok: Boolean(hit && button.contains(hit)), coveredBy: hit && !button.contains(hit) ? String(hit.className).slice(0, 80) || hit.tagName : null }
    })
    results.helpButtonHittable = helpHittable
    if (!helpHittable.ok) {
      console.log(`FINDING 画布操作帮助按钮被盖住（Agent 面板展开、舞台变窄时）：${JSON.stringify(helpHittable)}；收起 Agent 面板再点`)
      await shot('09a-help-button-covered')
      await win.locator('[data-v4-control="collapse"]').first().click()
      await waitForVisualQuiescence(win)
    }
    await help.click()
    const panel = win.getByLabel(LOCALE === 'en' ? 'Canvas controls help' : '画布操作帮助')
    await expect(panel, '画布操作帮助没打开').toBeVisible()
    const text = await panel.innerText()
    const keyName = process.platform === 'darwin' ? '⌥ Option' : 'Alt'
    const row = LOCALE === 'en' ? `${keyName} + drag` : `${keyName} + 拖动`
    check(text.includes(row), 'B5·帮助面板写着 Alt/⌥ 拖动复制（按平台显示键名）', { row })
    await shot('09-controls-help-alt-drag')
    await win.keyboard.press('Escape')
  }
} catch (error) {
  failures.push(`走查中途异常：${String(error?.message || error).slice(0, 600)}`)
  console.error('WALK ERROR:', String(error?.stack || error).slice(0, 3000))
  await win.screenshot({ path: path.join(shotsDir, 'zz-error.png') }).catch(() => {})
} finally {
  fs.writeFileSync(path.join(shotsDir, 'results.json'), JSON.stringify({ locale: LOCALE, label: LABEL, results, failures, consoleErrors }, null, 2))
  if (failures.length) {
    console.error('CONSOLE ERRORS', JSON.stringify(consoleErrors.slice(-8), null, 1))
    console.error('MAIN LOG TAIL\n' + mainLogTail().slice(-40).join('\n'))
  }
  await app.close().catch(() => {})
  fs.rmSync(temp, { recursive: true, force: true })
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`\n✖ 拉环 / Alt 拖动复制走查未通过（${failures.length} 条）：`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`\n✓ 拉环 / Alt 拖动复制走查通过（${LOCALE}）`)
