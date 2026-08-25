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

// 找一块「真·空白」：扫画布 stage 内的候选点，取第一个命中 stage/变换层本身的点。
async function findBlankPoint(preferBottom = false) {
  return getWin().evaluate((bottom) => {
    const stage = document.querySelector('.generation-canvas-v2__stage')
    const rect = stage.getBoundingClientRect()
    const rows = bottom
      ? [0.88, 0.78, 0.68, 0.58, 0.48, 0.38, 0.28, 0.18, 0.1]
      : [0.2, 0.28, 0.36, 0.5, 0.64, 0.76, 0.88, 0.12]
    for (const ry of rows) {
      for (const rx of [0.62, 0.7, 0.78, 0.86, 0.93, 0.54, 0.42, 0.3, 0.2, 0.12, 0.06]) {
        const x = rect.left + rect.width * rx
        const y = rect.top + rect.height * ry
        const hit = document.elementFromPoint(x, y)
        if (!hit || !stage.contains(hit)) continue
        if (hit.closest('.generation-canvas-v2-node, .generation-canvas-v2-toolbar, .generation-canvas-v2__zoom-bar, .generation-canvas-v2__selection-bounds, .generation-canvas-v2__selection-toolbar, button, input, textarea, [role="menu"], [role="toolbar"], .generation-canvas-v2__edge-hit, .generation-canvas-v2__minimap, .generation-canvas-v2__navigation-stack')) continue
        return { x: Math.round(x), y: Math.round(y) }
      }
    }
    return null
  }, preferBottom)
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

// 从一串候选点里挑第一个「真·空白」（框选起手点必须落在空白，否则会被节点/底部坞抢走）。
async function firstBlankOf(candidates) {
  return getWin().evaluate((points) => {
    const stage = document.querySelector('.generation-canvas-v2__stage')
    const rect = stage.getBoundingClientRect()
    for (const point of points) {
      if (point.x < rect.left + 8 || point.x > rect.right - 8) continue
      if (point.y < rect.top + 8 || point.y > rect.bottom - 8) continue
      const hit = document.elementFromPoint(point.x, point.y)
      if (!hit || !stage.contains(hit)) continue
      if (hit.closest('.generation-canvas-v2-node, .generation-canvas-v2-toolbar, .generation-canvas-v2__zoom-bar, .generation-canvas-v2__selection-bounds, .generation-canvas-v2__selection-toolbar, button, input, textarea, [role="menu"], [role="toolbar"], .generation-canvas-v2__edge-hit, .generation-canvas-v2__minimap, .generation-canvas-v2__navigation-stack')) continue
      return { x: Math.round(point.x), y: Math.round(point.y) }
    }
    return null
  }, candidates)
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
      marquee: document.querySelectorAll('.generation-canvas-v2__marquee').length,
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

  // Shift 框选：从空白起手，拉过两个节点。
  const nodesBox = await getWin().evaluate(() => {
    const rects = Array.from(document.querySelectorAll('.generation-canvas-v2-node')).map((node) =>
      node.getBoundingClientRect(),
    )
    const left = Math.min(...rects.map((r) => r.left))
    const top = Math.min(...rects.map((r) => r.top))
    const right = Math.max(...rects.map((r) => r.right))
    const bottom = Math.max(...rects.map((r) => r.bottom))
    return { left, top, right, bottom }
  })
  const marqueeStart = await firstBlankOf([
    { x: nodesBox.right + 70, y: nodesBox.bottom + 40 },
    { x: nodesBox.right + 70, y: nodesBox.top - 40 },
    { x: nodesBox.right + 130, y: nodesBox.bottom - 20 },
    { x: nodesBox.right + 40, y: nodesBox.top - 60 },
  ])
  assert(Boolean(marqueeStart), '框选起手点落在空白处', JSON.stringify(marqueeStart))
  await getWin().keyboard.down('Shift')
  await getWin().mouse.move(marqueeStart.x, marqueeStart.y)
  await getWin().mouse.down()
  await getWin().mouse.move(nodesBox.left - 40, marqueeStart.y > nodesBox.top ? nodesBox.top - 30 : nodesBox.bottom + 30, { steps: 16 })
  const marqueeVisible = await getWin().evaluate(
    () => document.querySelectorAll('.generation-canvas-v2__marquee').length,
  )
  await snap('02-shift-marquee.png')
  await getWin().mouse.up()
  await getWin().keyboard.up('Shift')
  await getWin().waitForTimeout(300)
  const marqueeSelected = await selectedNodeIds()

  assert(marqueeVisible === 1, 'Shift+左键拖会画出框选矩形')
  assert(marqueeSelected.length >= 2, '框选把框内节点都选上了', `${marqueeSelected.length} 个`)

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
  const imageBox = await imageNode.boundingBox()
  const videoBox = await videoNode.boundingBox()
  const handlePoint = { x: Math.round(imageBox.x + imageBox.width + 10), y: Math.round(imageBox.y + imageBox.height / 2) }
  const handleHit = await getWin().evaluate(
    (point) => {
      const hit = document.elementFromPoint(point.x, point.y)
      return {
        magnetic: Boolean(hit?.closest('.generation-canvas-v2-node__magnetic-handle, .generation-canvas-v2-node__handle--output')),
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
  const selectedEdgeState = await getWin().evaluate(() => ({
    labels: document.querySelectorAll('.generation-canvas-v2__edge-tag-pill').length,
    incident: document.querySelectorAll('.generation-canvas-v2__edge[data-incident="true"]').length,
  }))
  await snap('04-edge-labels-on-selection.png')
  assert(selectedEdgeState.incident >= 1, '选中节点后其关联边点亮（data-incident）')
  assert(selectedEdgeState.labels >= 1, '选中节点后其关联边的类型标签浮出', JSON.stringify(selectedEdgeState))

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
  await getWin().mouse.move(otherBox.x + otherBox.width / 2, otherBox.y + 12)
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
  }))
  await snap('06-drag-other-node.png')
  await getWin().mouse.up()
  await getWin().waitForTimeout(300)
  assert(crossDrag.dragging === 'true', '拖另一个节点时画布同样进入拖动态')
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
