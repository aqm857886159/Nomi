// 画布手势与静默渲染 R13/R16 走查（2026-08-08 四条需求的真实用户任务闭环）。
//
// 真实任务：「打开项目 → 摆两个节点并连线 → 拖画布找位置 → 框选一批 → 拖动一个节点调位置」，
// 全程验证四条新契约：
//   ① 空白左键拖=平移；点一下空白=取消选中；Shift+左键拖=框选（追加）；滚轮以光标为锚缩放
//   ② 平移期间节点不重渲染（拖前后节点 DOM 实例不变 + 变换层已提升为合成层 will-change）
//   ③ 连线标签默认不显示，选中节点后其关联边才浮出标签
//   ④ 拖动节点时浮动工具条 / 提示词面板隐身，松手回来
//
// 真 Electron + 真构建产物，隔离 userData / projects，不触发任何生成请求（零额度）。
// 用法：pnpm run build && node tests/ux/canvas-drag-pan-gestures.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { screenshotSettled } from './_assert.mjs'
import { CANVAS_PANE_SELECTOR, findCanvasBlankPoint } from './_canvasHit.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/canvas-drag-pan-gestures')
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nomi-canvas-drag-pan-'))
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
mkdirSync(projectsDir, { recursive: true })
mkdirSync(shotsDir, { recursive: true })

const { app, win: _initialWin } = await launchNomiApp({
  name: 'canvas-drag-pan-gestures',
  userDataDir,
  settingsDir: userDataDir,
  projectsDir,
  args: ['--no-proxy-server'],
  settleMs: 0,
  syntheticCredentialStorage: true,
})

let passed = 0
function assert(condition, label, detail = '') {
  if (!condition) throw new Error(`WALK FAIL: ${label}${detail ? ` — ${detail}` : ''}`)
  passed += 1
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
}

let win = _initialWin
const getWin = () => {
  const live = app.windows().filter((candidate) => !candidate.isClosed())
  win = live.find((candidate) => /projectId=/.test(candidate.url())) || live[live.length - 1] || win
  return win
}

async function resize(width, height) {
  const browserWindow = await app.browserWindow(getWin())
  await browserWindow.evaluate((target, size) => {
    target.setBounds({ x: 0, y: 0, width: size.width, height: size.height })
    target.center()
  }, { width, height })
  await getWin().waitForTimeout(350)
}

async function snap(name) {
  const file = path.join(shotsDir, name)
  await screenshotSettled(getWin(), { path: file })
  console.log(`  · 截图 ${name}`)
  return file
}

async function dismissFirstRun() {
  for (let index = 0; index < 6; index += 1) {
    const action = getWin().locator('button, [role="button"], a', { hasText: /跳过|完成|知道了|开始创作|稍后/ }).first()
    if (await action.isVisible().catch(() => false)) await action.click({ timeout: 900 }).catch(() => {})
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(180)
  }
}

// 画布变换真相：直接读变换层的 transform（平移不再每帧进 React state，读 DOM 才是唯一可信来源）。
async function readTransform() {
  return getWin().evaluate(() => {
    const layer = document.querySelector('.generation-canvas-v2__canvas')
    const matrix = new DOMMatrixReadOnly(getComputedStyle(layer).transform)
    return { x: matrix.m41, y: matrix.m42, zoom: matrix.a, willChange: getComputedStyle(layer).willChange }
  })
}

// 空白点判据住在 `_canvasHit.mjs`（单一 owner）：最顶层元素就是 React Flow pane。
// 找不到就直接报错——「这一屏没有空白」是走查前提被打破，不该悄悄往下走。
async function findBlankPoint(preferBottom = false) {
  const point = await findCanvasBlankPoint(getWin(), { preference: preferBottom ? 'bottom' : 'default' })
  if (!point) throw new Error('WALK FAIL: 画布上找不到任何空白点（stage 被浮层占满）')
  return point
}

async function readStageOrigin() {
  return getWin().evaluate(() => {
    const rect = document.querySelector('.generation-canvas-v2__stage').getBoundingClientRect()
    return { left: rect.left, top: rect.top }
  })
}

// 屏幕点 → 画布坐标（缩放锚点是否稳定，就看同一个屏幕点前后映射到的画布坐标变没变）。
function canvasPointAt(transform, screen, origin) {
  return {
    x: (screen.x - origin.left - transform.x) / transform.zoom,
    y: (screen.y - origin.top - transform.y) / transform.zoom,
  }
}

// 适应视图后，从包围节点的四个方向寻找完整落在 stage 内的框选手势。
// React Flow 在拖动中把指针带进 pane 边缘 40px 就开始**持续自动平移**
// （`calcAutoPan(pos, bounds, speed = 15, distance = 40)`，@xyflow/system 0.0.81）。
// 框选手势的两端必须离边比这更远，否则松手前画面一直在动：截图等不到安定，
// 走查报的是「这一屏未视觉安定」，看起来像浮层抖动，其实是我们自己按住了自动平移带。
const REACT_FLOW_AUTO_PAN_BAND_PX = 40
const MARQUEE_STAGE_INSET_PX = REACT_FLOW_AUTO_PAN_BAND_PX + 8

async function findMarqueeGesture() {
  return getWin().evaluate(({ paneSelector, inset }) => {
    const stage = document.querySelector('.generation-canvas-v2__stage')
    const nodes = Array.from(document.querySelectorAll('.generation-canvas-v2-node'))
    if (!stage) throw new Error('画布 stage 未渲染，无法构造框选手势')
    if (!nodes.length) throw new Error('画布节点未渲染，无法构造框选手势')
    const stageRect = stage.getBoundingClientRect()
    const nodeRects = nodes.map((node) => node.getBoundingClientRect())
    const bounds = {
      left: Math.min(...nodeRects.map((rect) => rect.left)),
      top: Math.min(...nodeRects.map((rect) => rect.top)),
      right: Math.max(...nodeRects.map((rect) => rect.right)),
      bottom: Math.max(...nodeRects.map((rect) => rect.bottom)),
    }
    const insideStage = (point) =>
      point.x >= stageRect.left + inset && point.x <= stageRect.right - inset &&
      point.y >= stageRect.top + inset && point.y <= stageRect.bottom - inset

    // 余量从大往小试，最大那档扫满整块 stage（四边各内缩到自动平移带之外）。
    // 为什么要余量最大化：框选是**拖动中**判定的，而 React Flow 只选「完全落在框内」的节点；
    // 拖到一半选中第一个节点会弹出它的提示词面板，面板贴边时生产代码会平移视口让它露出来
    // （useComposerVisibilityPan），节点因此在框选进行中整体位移几十像素。贴着节点外框 24px
    // 起手的框在窄画布下会被这几十像素挤掉一个节点——量到的不是「框选坏了」，是「框太紧」。
    // 扫满 stage 的框对这段位移免疫；余量由 stage 与节点实测推出，唯一的常数是
    // React Flow 自己的自动平移带宽度（见上方注释）。
    const gapLadder = [
      Math.max(
        bounds.left - (stageRect.left + inset),
        bounds.top - (stageRect.top + inset),
        stageRect.right - inset - bounds.right,
        stageRect.bottom - inset - bounds.bottom,
      ),
      80,
      64,
      40,
      24,
    ]
    const clampToStage = (point) => ({
      x: Math.min(Math.max(point.x, stageRect.left + inset), stageRect.right - inset),
      y: Math.min(Math.max(point.y, stageRect.top + inset), stageRect.bottom - inset),
    })
    for (const gap of gapLadder) {
      const gestures = [
        { start: { x: bounds.right + gap, y: bounds.bottom + gap }, end: { x: bounds.left - gap, y: bounds.top - gap } },
        { start: { x: bounds.right + gap, y: bounds.top - gap }, end: { x: bounds.left - gap, y: bounds.bottom + gap } },
        { start: { x: bounds.left - gap, y: bounds.bottom + gap }, end: { x: bounds.right + gap, y: bounds.top - gap } },
        { start: { x: bounds.left - gap, y: bounds.top - gap }, end: { x: bounds.right + gap, y: bounds.bottom + gap } },
      ].map(({ start, end }) => ({ start: clampToStage(start), end: clampToStage(end) }))
      for (const gesture of gestures) {
        if (!insideStage(gesture.start) || !insideStage(gesture.end)) continue
        // 起手点必须落在 pane 上（同 _canvasHit.mjs 的空白判据），否则手势会被浮层吞掉。
        const hit = document.elementFromPoint(gesture.start.x, gesture.start.y)
        if (!hit || !stage.contains(hit) || !hit.matches(paneSelector)) continue
        return {
          start: { x: Math.round(gesture.start.x), y: Math.round(gesture.start.y) },
          end: { x: Math.round(gesture.end.x), y: Math.round(gesture.end.y) },
        }
      }
    }
    return null
  }, { paneSelector: CANVAS_PANE_SELECTOR, inset: MARQUEE_STAGE_INSET_PX })
}

// 数一段操作里「连线层 / 标签层 / 画布外壳」到底被写了多少次 DOM。
// 这是「点一下空白不该刷新连线」的可执行判据——比人眼盯重绘高亮更稳。
async function countMutationsDuring(action) {
  await getWin().evaluate(() => {
    window.__walkMutations = { edges: 0, labels: 0, stage: 0 }
    window.__walkObservers = []
    const stage = document.querySelector('.generation-canvas-v2__stage')
    const edges = document.querySelector('.generation-canvas-v2__edges')
    const labels = edges
      ? Array.from(edges.parentElement.children).find(
          (el) => el.tagName === 'DIV' && String(el.className).includes('z-[4]'),
        )
      : null
    const watch = (target, key, options) => {
      if (!target) return
      const observer = new MutationObserver((records) => {
        window.__walkMutations[key] += records.length
      })
      observer.observe(target, options)
      window.__walkObservers.push(observer)
    }
    watch(edges, 'edges', { childList: true, subtree: true, attributes: true })
    watch(labels, 'labels', { childList: true, subtree: true, attributes: true })
    watch(stage, 'stage', { attributes: true })
  })
  await action()
  await getWin().waitForTimeout(350)
  return getWin().evaluate(() => {
    for (const observer of window.__walkObservers) observer.disconnect()
    return window.__walkMutations
  })
}

async function selectedNodeIds() {
  return getWin().evaluate(() =>
    Array.from(document.querySelectorAll('.generation-canvas-v2-node[data-selected="true"]')).map(
      (node) => node.getAttribute('data-node-id'),
    ),
  )
}

async function addNode(kind) {
  await getWin().locator(`.generation-canvas-v2-toolbar [data-node-kind="${kind}"]`).first().click()
  await getWin().waitForTimeout(700)
}

const pageErrors = []
getWin().on('pageerror', (error) => pageErrors.push(String(error)))

try {
  await getWin().waitForLoadState('domcontentloaded')
  await getWin().waitForTimeout(1700)
  await getWin().evaluate(() => {
    localStorage.setItem('__nomiE2E', '1')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1']) localStorage.setItem(key, 'seen')
  })
  await getWin().reload()
  await getWin().waitForLoadState('domcontentloaded')
  await getWin().waitForTimeout(1600)
  await resize(1600, 1000)
  await dismissFirstRun()

  // 占位 key：让内置图像/视频模型出现，连线能算出真实 mode（全程不点生成、零额度）。
  await getWin().evaluate(() =>
    window.nomiDesktop?.modelCatalog?.upsertVendorApiKey('kie', { apiKey: 'nomi-e2e-placeholder', enabled: true }),
  )
  await getWin().reload()
  await getWin().waitForLoadState('domcontentloaded')
  await getWin().waitForTimeout(1500)
  await dismissFirstRun()

  const blankProject = getWin().locator('button, [role="button"]', { hasText: '新建空白项目' }).first()
  await blankProject.waitFor({ timeout: 8000 })
  await blankProject.click()
  await getWin().waitForTimeout(2200)
  await dismissFirstRun()
  await resize(1600, 1000)

  const generation = getWin().getByRole('button', { name: '生成', exact: true }).first()
  await generation.waitFor({ timeout: 8000 })
  await generation.click()
  await getWin().locator('.generation-canvas-v2-toolbar').waitFor({ timeout: 8000 })

  // ── 任务准备：摆一个图片节点 + 一个视频节点 ─────────────────────────────
  await addNode('image')
  await addNode('video')
  const nodeIds = await getWin().evaluate(() =>
    Array.from(document.querySelectorAll('.generation-canvas-v2-node')).map((node) => ({
      id: node.getAttribute('data-node-id'),
      kind: node.getAttribute('data-kind'),
    })),
  )
  assert(nodeIds.length >= 2, '画布上有两个节点', JSON.stringify(nodeIds))

  // ── ① 空白左键拖 = 平移画布 ────────────────────────────────────────────
  const blank = await findBlankPoint()
  assert(Boolean(blank), '找得到一块画布空白', JSON.stringify(blank))
  const before = await readTransform()
  assert(before.willChange.includes('transform'), '变换层已提升为合成层（will-change: transform）', before.willChange)

  await getWin().mouse.move(blank.x, blank.y)
  await getWin().mouse.down()
  await getWin().mouse.move(blank.x - 140, blank.y - 90, { steps: 14 })
  const duringPan = await getWin().evaluate(() => {
    const stage = document.querySelector('.generation-canvas-v2__stage')
    return {
      cursor: getComputedStyle(stage).cursor,
      // 左键平移的光标全靠 CSS :active，不该再写 data-panning（写属性=整个 stage 子树重算样式）
      panningAttr: stage.getAttribute('data-panning'),
      // 但「正在拖动」这件事要广播出去：平移期间浮层也该收起（2026-08-09 用户拍板）
      draggingAttr: stage.getAttribute('data-dragging'),
      visibleOverlays: Array.from(
        document.querySelectorAll('.generation-canvas-v2-node__composer, [data-node-floating-toolbar="true"]'),
      ).filter((el) => getComputedStyle(el).visibility !== 'hidden').length,
      marquee: document.querySelectorAll('.react-flow__selection').length,
    }
  })
  await snap('01-panning.png')
  await getWin().mouse.up()
  await getWin().waitForTimeout(220)
  const afterPan = await readTransform()

  assert(duringPan.cursor === 'grabbing', '拖动中光标是 grabbing', duringPan.cursor)
  assert(duringPan.panningAttr === null, '左键平移不写 data-panning（光标交给 CSS :active）')
  assert(duringPan.draggingAttr === 'true', '平移期间画布进入拖动态')
  assert(duringPan.visibleOverlays === 0, '平移期间浮层也收起来了', JSON.stringify(duringPan))
  assert(duringPan.marquee === 0, '空白左键拖不再拉出框选矩形')
  assert(
    Math.round(afterPan.x - before.x) <= -100 && Math.round(afterPan.y - before.y) <= -60,
    '画布确实跟着鼠标移动了',
    `Δ=(${Math.round(afterPan.x - before.x)}, ${Math.round(afterPan.y - before.y)})`,
  )
  assert(afterPan.zoom === before.zoom, '平移不改变缩放')

  // ── ② 平移不重建节点：拖完还是同一批 DOM 实例（React 没重挂），且没有新的页面错误 ──
  const nodeIdentity = await getWin().evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('.generation-canvas-v2-node'))
    window.__walkNodeRefs = nodes
    return nodes.length
  })
  const blankAgain = await findBlankPoint()
  await getWin().mouse.move(blankAgain.x, blankAgain.y)
  await getWin().mouse.down()
  await getWin().mouse.move(blankAgain.x + 90, blankAgain.y + 40, { steps: 10 })
  await getWin().mouse.up()
  await getWin().waitForTimeout(200)
  const sameInstances = await getWin().evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('.generation-canvas-v2-node'))
    const refs = window.__walkNodeRefs || []
    return nodes.length === refs.length && nodes.every((node, index) => node === refs[index])
  })
  assert(nodeIdentity >= 2 && sameInstances, '平移前后节点是同一批 DOM 实例（没有整层重建）')

  // ── ① 点一下空白 = 取消选中；Shift + 左键拖 = 框选并追加 ─────────────────
  const firstNode = getWin().locator('.generation-canvas-v2-node').first()
  await firstNode.click({ position: { x: 20, y: 10 } })
  await getWin().waitForTimeout(300)
  assert((await selectedNodeIds()).length === 1, '点节点会选中它')

  const blankForClick = await findBlankPoint()
  await getWin().mouse.click(blankForClick.x, blankForClick.y)
  await getWin().waitForTimeout(250)
  assert((await selectedNodeIds()).length === 0, '点一下空白就取消选中（没拖动=不算平移）')

  // 选区已空时再点一次：这一下什么都没变，就不该有任何 DOM 写入
  // （2026-08-08 用户报「点空白连线也会渲染，松开还刷一次」的回归判据）。
  const idleClick = await countMutationsDuring(async () => {
    await getWin().mouse.click(blankForClick.x, blankForClick.y)
  })
  assert(
    idleClick.edges === 0 && idleClick.labels === 0 && idleClick.stage === 0,
    '空选区下点空白：连线层 / 标签层 / 画布外壳零 DOM 变更',
    JSON.stringify(idleClick),
  )

  // Shift 框选：先用真实「适应视图」收回所有节点，再从空白角落包围它们。
  await getWin().locator('.generation-canvas-v2__zoom-bar button').first().click()
  await getWin().waitForTimeout(420)
  const marqueeGesture = await findMarqueeGesture()
  assert(Boolean(marqueeGesture), '框选起手点与终点完整落在画布空白处', JSON.stringify(marqueeGesture))
  await getWin().keyboard.down('Shift')
  await getWin().mouse.move(marqueeGesture.start.x, marqueeGesture.start.y)
  await getWin().mouse.down()
  await getWin().mouse.move(marqueeGesture.end.x, marqueeGesture.end.y, { steps: 16 })
  const marqueeVisual = await getWin().evaluate(() => {
    const marquee = document.querySelector('.react-flow__selection')
    const host = document.querySelector('.generation-canvas-react-flow')
    if (!marquee || !host) return null
    const accentProbe = document.createElement('span')
    accentProbe.style.border = '1px solid var(--nomi-accent)'
    host.appendChild(accentProbe)
    const accentBorderColor = getComputedStyle(accentProbe).borderTopColor
    accentProbe.remove()
    const style = getComputedStyle(marquee)
    return {
      borderColor: style.borderTopColor,
      backgroundColor: style.backgroundColor,
      accentBorderColor,
    }
  })
  await snap('02-shift-marquee.png')
  await getWin().mouse.up()
  await getWin().keyboard.up('Shift')
  await getWin().waitForTimeout(300)
  const marqueeSelected = await selectedNodeIds()

  assert(Boolean(marqueeVisual), 'Shift+左键拖会画出框选矩形')
  assert(
    marqueeVisual.borderColor !== marqueeVisual.accentBorderColor,
    '实时框选使用 Nomi 中性色，不被 React Flow 蓝色或 accent 覆盖',
    JSON.stringify(marqueeVisual),
  )
  assert(marqueeSelected.length >= 2, '框选把框内节点都选上了', `${marqueeSelected.length} 个`)

  // 适应视图可能在宽屏把两个节点放大到接近上限；重置视图后，后面两轮滚轮都有缩放余量。
  await getWin().locator('.generation-canvas-v2__zoom-bar button').nth(1).click()
  await getWin().waitForTimeout(420)

  // ── ① 滚轮以光标为锚缩放 ───────────────────────────────────────────────
  const anchor = await findBlankPoint()
  const stageOrigin = await readStageOrigin()
  const zoomBefore = await readTransform()
  await getWin().mouse.move(anchor.x, anchor.y)
  await getWin().mouse.wheel(0, -240)
  await getWin().waitForTimeout(260)
  const zoomAfter = await readTransform()
  const pointBefore = canvasPointAt(zoomBefore, anchor, stageOrigin)
  const pointAfter = canvasPointAt(zoomAfter, anchor, stageOrigin)

  assert(zoomAfter.zoom > zoomBefore.zoom, '向上滚轮放大画布', `${zoomBefore.zoom.toFixed(2)} → ${zoomAfter.zoom.toFixed(2)}`)
  assert(
    Math.abs(pointAfter.x - pointBefore.x) < 1.5 && Math.abs(pointAfter.y - pointBefore.y) < 1.5,
    '缩放锚在光标：光标下的那个画布坐标没有跑掉',
    `Δ=(${(pointAfter.x - pointBefore.x).toFixed(2)}, ${(pointAfter.y - pointBefore.y).toFixed(2)})`,
  )

  // ── ① 按住左键平移「中途」滚轮缩放：不许抖（2026-08-08 用户报的回归） ──
  // 抖动的机制是「缩放修正 offset → 下一帧平移按老基准把它算回去」，所以判据是：
  // 缩放后再走一小步，位移必须**接着缩放后的位置**继续，不能跳回缩放前的基线。
  const holdPoint = await findBlankPoint()
  await getWin().mouse.move(holdPoint.x, holdPoint.y)
  await getWin().mouse.down()
  await getWin().mouse.move(holdPoint.x - 40, holdPoint.y - 20, { steps: 6 })
  await getWin().waitForTimeout(80)
  const cursorDuringPan = { x: holdPoint.x - 40, y: holdPoint.y - 20 }
  const beforeMidZoom = await readTransform()
  await getWin().mouse.wheel(0, -240)
  await getWin().waitForTimeout(140)
  const afterMidZoom = await readTransform()
  await getWin().mouse.move(cursorDuringPan.x + 10, cursorDuringPan.y, { steps: 1 })
  await getWin().waitForTimeout(120)
  const afterNextStep = await readTransform()
  await getWin().mouse.up()
  await getWin().waitForTimeout(150)

  const midAnchorBefore = canvasPointAt(beforeMidZoom, cursorDuringPan, stageOrigin)
  const midAnchorAfter = canvasPointAt(afterMidZoom, cursorDuringPan, stageOrigin)
  const stepDelta = afterNextStep.x - afterMidZoom.x

  assert(afterMidZoom.zoom > beforeMidZoom.zoom, '按住左键时滚轮照样缩放')
  assert(
    Math.abs(midAnchorAfter.x - midAnchorBefore.x) < 1.5 && Math.abs(midAnchorAfter.y - midAnchorBefore.y) < 1.5,
    '平移中缩放也锚在光标',
    `Δ=(${(midAnchorAfter.x - midAnchorBefore.x).toFixed(2)}, ${(midAnchorAfter.y - midAnchorBefore.y).toFixed(2)})`,
  )
  assert(
    Math.abs(stepDelta - 10) <= 1.5 && afterNextStep.zoom === afterMidZoom.zoom,
    '缩放后继续拖：位移接着缩放后的位置走，不回跳（抖动的判据）',
    `位移 ${stepDelta.toFixed(2)}px（应 ≈10）`,
  )

  // ── ③ 连线标签：默认不显示，选中节点才浮出 ──────────────────────────────
  const imageNode = getWin().locator('.generation-canvas-v2-node[data-kind="image"]').first()
  const videoNode = getWin().locator('.generation-canvas-v2-node[data-kind="video"]').first()

  // 中途缩放可能把节点中心推到视口外；连线前先把两张卡完整收回可视区域。
  await getWin().locator('.generation-canvas-v2__zoom-bar button').first().click()
  await getWin().waitForTimeout(420)

  // 先摆位置：把视频节点拖到图片节点的右下方空地（真实动作，也给连线握把腾出空间）。
  const deselectPoint = await findBlankPoint()
  await getWin().mouse.click(deselectPoint.x, deselectPoint.y)
  await getWin().waitForTimeout(200)
  const videoStart = await videoNode.boundingBox()
  const visibleStage = await getWin().locator('.generation-canvas-v2__stage').boundingBox()
  const videoTarget = {
    x: Math.min(videoStart.x + videoStart.width / 2 + 60, visibleStage.x + visibleStage.width - videoStart.width / 2 - 24),
    y: Math.min(videoStart.y + 200, visibleStage.y + visibleStage.height - videoStart.height - 24),
  }
  await getWin().mouse.move(videoStart.x + videoStart.width / 2, videoStart.y + 12)
  await getWin().mouse.down()
  await getWin().mouse.move(videoTarget.x, videoTarget.y, { steps: 14 })
  await getWin().mouse.up()
  await getWin().waitForTimeout(400)

  await imageNode.click({ position: { x: 20, y: 10 } })
  await getWin().waitForTimeout(450)
  const selectedImageAffordances = await getWin().evaluate(() => {
    const image = document.querySelector('.generation-canvas-v2-node[data-kind="image"]')
    const flowNode = image?.closest('.react-flow__node')
    const handles = Array.from(
      flowNode?.querySelectorAll('.generation-canvas-react-flow__handle[data-affordance="magnetic"]') || [],
    )
    const resizeControls = Array.from(flowNode?.querySelectorAll('.react-flow__resize-control') || [])
    return {
      handles: handles.map((handle) => {
        const icon = handle.querySelector('.generation-canvas-react-flow__handle-icon')
        const rect = icon?.getBoundingClientRect()
        const style = icon ? getComputedStyle(icon) : null
        return {
          side: handle.getAttribute('data-side'),
          hasPlus: Boolean(icon?.querySelector('svg')),
          cssWidth: style?.width || null,
          cssHeight: style?.height || null,
          screenWidth: rect?.width || 0,
          screenHeight: rect?.height || 0,
          opacity: style?.opacity || null,
        }
      }),
      resizeControls: resizeControls.map((control) => {
        const style = getComputedStyle(control)
        return {
          backgroundColor: style.backgroundColor,
          borderTopWidth: style.borderTopWidth,
          borderTopColor: style.borderTopColor,
          boxShadow: style.boxShadow,
        }
      }),
    }
  })
  assert(
      selectedImageAffordances.handles.length === 2 &&
      selectedImageAffordances.handles.map((handle) => handle.side).sort().join(',') === 'left,right' &&
      selectedImageAffordances.handles.every(
        (handle) => handle.hasPlus && handle.cssWidth === '29px' && handle.cssHeight === '29px' && Number(handle.opacity) >= 0.8,
      ),
    '选中图片节点恢复左右两个 29px 磁吸 +',
    JSON.stringify(selectedImageAffordances.handles),
  )
  assert(
    selectedImageAffordances.resizeControls.length > 0 &&
      selectedImageAffordances.resizeControls.every(
        (control) =>
          control.backgroundColor === 'rgba(0, 0, 0, 0)' &&
          (control.borderTopWidth === '0px' || control.borderTopColor === 'rgba(0, 0, 0, 0)') &&
          control.boxShadow === 'none',
      ),
    '缩放命中区保留但不显示 React Flow 小球',
    JSON.stringify(selectedImageAffordances.resizeControls),
  )
  const imageBox = await imageNode.boundingBox()
  const videoBox = await videoNode.boundingBox()
  const handlePoint = { x: Math.round(imageBox.x + imageBox.width + 10), y: Math.round(imageBox.y + imageBox.height / 2) }
  const handleHit = await getWin().evaluate(
    (point) => {
      const hit = document.elementFromPoint(point.x, point.y)
      return {
        magnetic: Boolean(hit?.closest('.generation-canvas-react-flow__handle, .generation-canvas-v2-node__magnetic-handle, .generation-canvas-v2-node__handle--output')),
        label: hit?.getAttribute('aria-label') || hit?.className?.toString().slice(0, 60) || hit?.tagName,
      }
    },
    handlePoint,
  )
  assert(handleHit.magnetic, '图片节点右侧握把可点', JSON.stringify(handleHit))
  await getWin().mouse.move(handlePoint.x, handlePoint.y)
  await getWin().mouse.down()
  const videoVisibleTarget = {
    x: (Math.max(videoBox.x, visibleStage.x) + Math.min(videoBox.x + videoBox.width, visibleStage.x + visibleStage.width)) / 2,
    y: (Math.max(videoBox.y, visibleStage.y) + Math.min(videoBox.y + videoBox.height, visibleStage.y + visibleStage.height)) / 2,
  }
  await getWin().mouse.move(videoVisibleTarget.x, videoVisibleTarget.y, { steps: 16 })
  await getWin().mouse.up()
  await getWin().waitForTimeout(700)
  const edgeCount = await getWin().evaluate(() => document.querySelectorAll('.generation-canvas-v2__edge').length)
  assert(edgeCount >= 1, '图片节点连到了视频节点', `${edgeCount} 条边`)
  const connectedEdgeVisual = await getWin().evaluate(() => {
    const image = document.querySelector('.generation-canvas-v2-node[data-kind="image"]')
    const video = document.querySelector('.generation-canvas-v2-node[data-kind="video"]')
    const path = document.querySelector('.generation-canvas-v2__edge-path')
    if (!image || !video || !(path instanceof SVGPathElement)) return null
    const imageRect = image.getBoundingClientRect()
    const videoRect = video.getBoundingClientRect()
    const matrix = path.getScreenCTM()
    if (!matrix) return null
    const toScreen = (point) => new DOMPoint(point.x, point.y).matrixTransform(matrix)
    const start = toScreen(path.getPointAtLength(0))
    const end = toScreen(path.getPointAtLength(path.getTotalLength()))
    const boundaryError = (point, rect) => Math.min(
      Math.abs(point.x - rect.left),
      Math.abs(point.x - rect.right),
    )
    const accentProbe = document.createElement('span')
    accentProbe.style.color = 'var(--nomi-accent)'
    document.body.appendChild(accentProbe)
    const accent = getComputedStyle(accentProbe).color
    accentProbe.remove()
    return {
      sourceBoundaryError: boundaryError(start, imageRect),
      targetBoundaryError: boundaryError(end, videoRect),
      sourceWithinHeight: start.y >= imageRect.top - 1 && start.y <= imageRect.bottom + 1,
      targetWithinHeight: end.y >= videoRect.top - 1 && end.y <= videoRect.bottom + 1,
      stroke: getComputedStyle(path).stroke,
      accent,
    }
  })
  assert(
    connectedEdgeVisual &&
      connectedEdgeVisual.sourceBoundaryError <= 2 && connectedEdgeVisual.targetBoundaryError <= 2 &&
      connectedEdgeVisual.sourceWithinHeight && connectedEdgeVisual.targetWithinHeight,
    '连线起终点真实贴在两个节点的渲染边界',
    JSON.stringify(connectedEdgeVisual),
  )
  assert(
    connectedEdgeVisual?.stroke === connectedEdgeVisual?.accent,
    '连线恢复主题 accent 色',
    JSON.stringify(connectedEdgeVisual),
  )

  const blankForDeselect = await findBlankPoint()
  await getWin().mouse.click(blankForDeselect.x, blankForDeselect.y)
  await getWin().waitForTimeout(300)
  const labelsWhenIdle = await getWin().evaluate(
    () => document.querySelectorAll('.generation-canvas-v2__edge-tag-pill').length,
  )
  await snap('03-edge-labels-hidden.png')
  assert(labelsWhenIdle === 0, '没选中任何节点时，画布上一个连线标签都没有')

  await videoNode.click({ position: { x: 20, y: 10 } })
  await getWin().waitForTimeout(400)
  const selectedEdgeState = await getWin().evaluate(() => {
    const label = document.querySelector('.generation-canvas-v2__edge-tag-pill')
    const accentProbe = document.createElement('span')
    accentProbe.style.color = 'var(--nomi-accent)'
    document.body.appendChild(accentProbe)
    const accent = getComputedStyle(accentProbe).color
    accentProbe.remove()
    const labelStyle = label ? getComputedStyle(label) : null
    return {
      labels: document.querySelectorAll('.generation-canvas-v2__edge-tag-pill').length,
      incident: document.querySelectorAll('.generation-canvas-v2__edge[data-incident="true"]').length,
      fontSize: labelStyle?.fontSize || null,
      color: labelStyle?.color || null,
      accent,
      hasChevron: Boolean(label?.querySelector('svg')),
    }
  })
  await snap('04-edge-labels-on-selection.png')
  assert(selectedEdgeState.incident >= 1, '选中节点后其关联边点亮（data-incident）')
  assert(selectedEdgeState.labels >= 1, '选中节点后其关联边的类型标签浮出', JSON.stringify(selectedEdgeState))
  assert(
    selectedEdgeState.fontSize === '12px' && selectedEdgeState.color === selectedEdgeState.accent && selectedEdgeState.hasChevron,
    '连线标签恢复 12px accent 文字与下拉图标',
    JSON.stringify(selectedEdgeState),
  )

  // ── ④ 拖动节点：浮条 / 提示词面板隐身，松手回来 ─────────────────────────
  const composerBefore = await getWin().evaluate(() => {
    const composer = document.querySelector('.generation-canvas-v2-node__composer')
    return composer ? getComputedStyle(composer).visibility : null
  })
  assert(composerBefore === 'visible', '选中节点时提示词面板可见')

  const dragBox = await videoNode.boundingBox()
  await getWin().mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + 12)
  await getWin().mouse.down()
  await getWin().mouse.move(dragBox.x + dragBox.width / 2 + 70, dragBox.y + 60, { steps: 12 })
  const duringDrag = await getWin().evaluate(() => {
    const stage = document.querySelector('.generation-canvas-v2__stage')
    const composer = document.querySelector('.generation-canvas-v2-node__composer')
    const toolbar = document.querySelector('[data-node-floating-toolbar="true"]')
    // 画布上**任何**节点的浮层都不该露头（不只是被拖的那张卡）
    const visibleOverlays = Array.from(
      document.querySelectorAll('.generation-canvas-v2-node__composer, [data-node-floating-toolbar="true"]'),
    ).filter((el) => getComputedStyle(el).visibility !== 'hidden').length
    return {
      dragging: stage.getAttribute('data-dragging') === 'true',
      composer: composer ? getComputedStyle(composer).visibility : null,
      toolbar: toolbar ? getComputedStyle(toolbar).visibility : 'none',
      visibleOverlays,
    }
  })
  await snap('05-node-drag-clean.png')
  await getWin().mouse.up()
  await getWin().waitForTimeout(350)
  const afterDrag = await getWin().evaluate(() => {
    const composer = document.querySelector('.generation-canvas-v2-node__composer')
    return {
      dragging: document.querySelector('.generation-canvas-v2__stage').hasAttribute('data-dragging'),
      composer: composer ? getComputedStyle(composer).visibility : null,
    }
  })

  assert(duringDrag.dragging, '拖动中画布发布 data-dragging（画布级，不是某张卡的私事）')
  assert(duringDrag.composer === 'hidden', '拖动中提示词面板隐身', JSON.stringify(duringDrag))
  assert(duringDrag.toolbar !== 'visible', '拖动中浮动工具条不显示', JSON.stringify(duringDrag))
  assert(duringDrag.visibleOverlays === 0, '拖动中全画布没有任何浮层露头', JSON.stringify(duringDrag))
  assert(!afterDrag.dragging && afterDrag.composer === 'visible', '松手后提示词面板原样回来', JSON.stringify(afterDrag))

  // 用户 2026-08-09 的场景：选中 A（面板展开）后去拖 B —— A 的面板不能杵在原地。
  // 按下 B 会把选中切给 B，所以判据是「拖动期间画布上一个可见浮层都没有」。
  const otherBox = await imageNode.boundingBox()
  const otherDragPoint = { x: otherBox.x + otherBox.width / 2, y: otherBox.y + 12 }
  const otherDragProbe = await getWin().evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y)
    const node = hit?.closest('.react-flow__node')
    return {
      hit: hit?.className?.toString().slice(0, 160) || hit?.tagName || null,
      nodeId: hit?.closest('[data-node-id]')?.getAttribute('data-node-id') || null,
      flowNodeId: node?.getAttribute('data-id') || null,
      transform: node ? getComputedStyle(node).transform : null,
    }
  }, otherDragPoint)
  await getWin().mouse.move(otherDragPoint.x, otherDragPoint.y)
  await getWin().mouse.down()
  await getWin().mouse.move(otherBox.x + otherBox.width / 2 - 80, otherBox.y + 70, { steps: 12 })
  const crossDrag = await getWin().evaluate(() => ({
    dragging: document.querySelector('.generation-canvas-v2__stage').getAttribute('data-dragging'),
    overlays: Array.from(
      document.querySelectorAll('.generation-canvas-v2-node__composer, [data-node-floating-toolbar="true"]'),
    ).length,
    visible: Array.from(
      document.querySelectorAll('.generation-canvas-v2-node__composer, [data-node-floating-toolbar="true"]'),
    ).filter((el) => getComputedStyle(el).visibility !== 'hidden').length,
    selected: Array.from(document.querySelectorAll('.react-flow__node.selected')).map((node) => ({
      id: node.getAttribute('data-id'),
      transform: getComputedStyle(node).transform,
    })),
  }))
  const draggedImage = crossDrag.selected.find((node) => node.id === otherDragProbe.flowNodeId)
  const transformNumbers = (value) => {
    const match = String(value || '').match(/^matrix\([^,]+, [^,]+, [^,]+, [^,]+, ([^,]+), ([^)]+)\)$/)
    return match ? { x: Number(match[1]), y: Number(match[2]) } : null
  }
  const beforeImageTransform = transformNumbers(otherDragProbe.transform)
  const afterImageTransform = transformNumbers(draggedImage?.transform)
  const imageMoveDistance = beforeImageTransform && afterImageTransform
    ? Math.hypot(afterImageTransform.x - beforeImageTransform.x, afterImageTransform.y - beforeImageTransform.y)
    : 0
  await snap('06-drag-other-node.png')
  await getWin().mouse.up()
  await getWin().waitForTimeout(300)
  assert(
    crossDrag.dragging === 'true',
    '拖另一个节点时画布同样进入拖动态',
    JSON.stringify({ probe: otherDragProbe, crossDrag, imageMoveDistance }),
  )
  assert(crossDrag.selected.some((node) => node.id === otherDragProbe.flowNodeId), '直接拖动未选中节点后，该节点成为当前选中节点')
  assert(imageMoveDistance >= 10, '直接拖动未选中节点时节点确实发生位移', `位移 ${imageMoveDistance.toFixed(1)}px`)
  assert(
    crossDrag.overlays > 0 && crossDrag.visible === 0,
    '拖另一个节点时，画布上挂着的浮层一个都不显示',
    JSON.stringify(crossDrag),
  )

  // ── ② 量化「平移是纯合成」：选中节点（composer 挂着）时连续平移一秒，看布局重算次数。
  // transform 是合成器属性，正确实现下平移一帧布局都不该重算；若谁在平移路径上读了尺寸
  // 或改了几何，这里立刻变成几十次。CDP 的 LayoutCount 只数真正跑过的布局，是可信的哨兵。
  const cdp = await app.context().newCDPSession(getWin()).catch(() => null)
  if (cdp) {
    await cdp.send('Performance.enable')
    const metrics = async () =>
      Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
    const panPoint = await findBlankPoint()
    const beforeMetrics = await metrics()
    await getWin().mouse.move(panPoint.x, panPoint.y)
    await getWin().mouse.down()
    for (let step = 0; step < 60; step += 1) {
      await getWin().mouse.move(panPoint.x - step * 2, panPoint.y - step, { steps: 1 })
      await getWin().waitForTimeout(16)
    }
    await getWin().mouse.up()
    await getWin().waitForTimeout(200)
    const afterMetrics = await metrics()
    const layouts = Math.round(afterMetrics.LayoutCount - beforeMetrics.LayoutCount)
    console.log(`  · 一秒平移（60 次移动）期间布局重算 ${layouts} 次`)
    assert(layouts <= 6, '平移是纯合成：整段拖动几乎不重算布局', `${layouts} 次 / 60 帧`)
  }

  // ── 平移的其它入口没被改坏：空格 + 左键仍平移 ─────────────────────────
  const onNode = await videoNode.boundingBox()
  const spacePanBefore = await readTransform()
  await getWin().keyboard.down('Space')
  await getWin().mouse.move(onNode.x + onNode.width / 2, onNode.y + onNode.height / 2)
  await getWin().mouse.down()
  await getWin().mouse.move(onNode.x + onNode.width / 2 - 60, onNode.y + onNode.height / 2 - 40, { steps: 10 })
  await getWin().mouse.up()
  await getWin().keyboard.up('Space')
  await getWin().waitForTimeout(250)
  const spacePanAfter = await readTransform()
  assert(
    Math.round(spacePanAfter.x - spacePanBefore.x) <= -40,
    '空格+左键压在节点上仍然平移画布（不是拖节点）',
    `Δx=${Math.round(spacePanAfter.x - spacePanBefore.x)}`,
  )

  assert(pageErrors.length === 0, '全程无页面错误', pageErrors.join(' | '))
  console.log(`\n✅ 画布手势走查通过：${passed} 项断言，截图在 ${shotsDir}`)
} catch (error) {
  await snap('99-failure.png').catch(() => {})
  console.error(`\n❌ ${error.message}`)
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
}
