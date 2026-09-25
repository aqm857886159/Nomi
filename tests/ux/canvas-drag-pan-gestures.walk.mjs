// 画布手势与静默渲染 R13/R16 走查（2026-08-08 四条需求的真实用户任务闭环）。
//
// 真实任务：「打开项目 → 摆两个节点并连线 → 拖画布找位置 → 框选一批 → 拖动一个节点调位置」，
// 全程验证四条新契约：
//   ① 空白左键拖=平移；点一下空白=取消选中；Shift+左键拖=框选（追加）；滚轮以光标为锚缩放
//   ② 平移期间节点不重渲染（拖前后节点 DOM 实例不变 + 变换层已提升为合成层 will-change）
//   ③ 连线标签默认不显示，选中节点后其关联边才浮出标签
//   ④ 拖动节点时浮动工具条 / 提示词面板隐身，松手回来
//
// 真 Electron + 真构建产物，不触发任何生成请求（零额度）。
// 核心冒烟清单的一员（tests/ux/core-smoke/scenarios.mjs）：empty（空项目）/ used（用过的项目：
// 24 张真实卡 + 编组 + 时间轴展开 + Agent 面板开着 + 1280×800 小窗）两种夹具都跑，项目从项目库点开。
// 用法：pnpm run build && pnpm run test:core-smoke -- --fixture used
//       pnpm run build && node tests/ux/canvas-drag-pan-gestures.walk.mjs      （单跑，默认 empty / zh-CN）
//       pnpm run build && node tests/ux/canvas-drag-pan-gestures.walk.mjs en   （单跑英文）
import { ACCEPTANCE_VIEWPORT } from './_launchApp.mjs'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, screenshotSettled, waitForVisualQuiescence } from './_assert.mjs'
import {
  CANVAS_PANE_SELECTOR, expectArrivalsReachable, findCanvasBlankPoint, findNodeHitPoint, waitForCanvasViewportSettled,
} from './_canvasHit.mjs'
import { launchCoreSmoke } from './core-smoke/fixture.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// 语言与 node-params 走查同一套约定：位置参数 argv[2]，夹具再让 NOMI_CORE_SMOKE_LOCALE（runner 的 --locale）覆盖。
// 下面凡是按界面文案找控件的地方都按 EN 取词，两种语言各跑一遍才算数。
const REQUESTED_LOCALE = process.argv[2] === 'en' ? 'en' : 'zh-CN'
const smoke = await launchCoreSmoke({
  name: 'canvas-drag-pan',
  locale: REQUESTED_LOCALE,
  emptyViewport: ACCEPTANCE_VIEWPORT,
  // 这条走查会往 catalog 写一个占位 key（让内置图像/视频模型出现，好算出真实的连线 mode）。
  // 声明它必须落在隔离的合成凭据存储里：夹具给不了就在起进程之前拒，占位 key 永远碰不到真钥匙串。
  syntheticCredentialStorage: true,
})
const LOCALE = smoke.locale
const EN = LOCALE === 'en'
const shotsDir = path.join(repoRoot, 'tests/ux/shots/canvas-drag-pan-gestures', `${smoke.fixture}-${LOCALE}`)
// 回填①的交付证据：只写不跟踪的目录（冒烟必跑，不许把已跟踪文件改脏——跑完 git status 必须干净）。
const evidenceDir = path.join(shotsDir, 'evidence')
rmSync(shotsDir, { recursive: true, force: true })
mkdirSync(evidenceDir, { recursive: true })

const { app } = smoke
const SEEDED_NODE_IDS = new Set(smoke.project.record.payload.generationCanvas.nodes.map((node) => node.id))
const SEEDED_EDGE_IDS = smoke.project.record.payload.generationCanvas.edges.map((edge) => edge.id)
// 这条走查自己建的两张卡与那条线。empty 夹具里画布上只有它们，选择器与「全画布」等价；
// used 夹具里还有 24 张别的卡——判据必须只看自己那两张，否则量到的是背景。建好之后改写成按 id 选。
const OWN = {
  node: '.generation-canvas-v2-node',
  image: '.generation-canvas-v2-node[data-kind="image"]',
  video: '.generation-canvas-v2-node[data-kind="video"]',
  edge: '.generation-canvas-v2__edge',
}
const _initialWin = smoke.win

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
  // used 夹具的小窗是被测前提，走查不许自己把它放大。
  if (smoke.lockedViewport) return
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

async function evidence(name) {
  const file = path.join(evidenceDir, name)
  await screenshotSettled(getWin(), { path: file })
  console.log(`  · 证据截图 ${name}`)
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
// 框选前把两张卡缩到只占画布这么大：余量因此是 stage 的两成起步，既大于自动平移带，
// 也给提示词面板在卡下方展开留出余量。用比例而不是像素——画布宽度本来就随面板变。
const MARQUEE_MAX_BOUNDS_RATIO = 0.6

// 两张卡在 stage 里占多大：框选余量够不够，唯一可信的判据是实测，不是猜。
async function readMarqueeHeadroom() {
  return getWin().evaluate((ownNode) => {
    const stage = document.querySelector('.generation-canvas-v2__stage')
    const nodes = Array.from(document.querySelectorAll(ownNode))
    if (!stage || !nodes.length) return null
    const stageRect = stage.getBoundingClientRect()
    const rects = nodes.map((node) => node.getBoundingClientRect())
    const width = Math.max(...rects.map((rect) => rect.right)) - Math.min(...rects.map((rect) => rect.left))
    const height = Math.max(...rects.map((rect) => rect.bottom)) - Math.min(...rects.map((rect) => rect.top))
    return {
      widthRatio: Math.round((width / stageRect.width) * 1000) / 1000,
      heightRatio: Math.round((height / stageRect.height) * 1000) / 1000,
    }
  }, OWN.node)
}

async function findMarqueeGesture() {
  return getWin().evaluate(({ paneSelector, inset, ownNode }) => {
    const stage = document.querySelector('.generation-canvas-v2__stage')
    const nodes = Array.from(document.querySelectorAll(ownNode))
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
    // 为什么这一笔要余量最大化：它断的是「两张卡都被选上」，扫满 stage 最不挑窗口宽度。
    // **框选语义本身是「相交即选」**（selectionMode=Partial，2026-06-14 canvas-smoothness-ABC §B2
    // 拍板；迁移时漏传、2026-09-11 回填）——半扫一张卡也该选上，那条判据由下面
    // 「只扫到一半」的那一笔单独断，不靠这一笔顺带证明。
    // 余量由 stage 与节点实测推出，唯一的常数是 React Flow 自己的自动平移带宽度（见上方注释）。
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
  }, { paneSelector: CANVAS_PANE_SELECTOR, inset: MARQUEE_STAGE_INSET_PX, ownNode: OWN.node })
}

/**
 * 「把我这两张卡收进视野」：先点真实的「适应视图」，再像人一样在两张卡附近的空白处滚轮放大，
 * 直到卡在屏上够大（≥260px 宽，或两张卡已占满画布四分之三）。empty 夹具里适应视图后本来就够大，一格都不会滚；
 * used 夹具里适应视图要装下 26 张卡，两张卡只有指甲盖大——人会凑近了再连线，走查也照做。
 */
async function frameOwnCards() {
  await getWin().locator('.generation-canvas-v2__zoom-bar button').first().click()
  await getWin().waitForTimeout(420)
  const measure = () => getWin().evaluate(({ ownNode, paneSelector }) => {
    const stage = document.querySelector('.generation-canvas-v2__stage')?.getBoundingClientRect()
    const rects = Array.from(document.querySelectorAll(ownNode)).map((node) => node.getBoundingClientRect())
    if (!stage) return null
    const inside = rects.filter((r) => r.left >= stage.left && r.right <= stage.right && r.top >= stage.top && r.bottom <= stage.bottom)
    if (!rects.length) return { visible: 0, share: 0, minCardWidth: 0, point: null }
    const box = {
      left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)),
      top: Math.min(...rects.map((r) => r.top)), bottom: Math.max(...rects.map((r) => r.bottom)),
    }
    const share = Math.max((box.right - box.left) / stage.width, (box.bottom - box.top) / stage.height)
    const center = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 }
    // 滚轮要落在空白上（落在卡上是卡自己的滚动）：从两卡中心往外找最近的一块真空白。
    for (let radius = 0; radius < 400; radius += 12) {
      for (let angle = 0; angle < 360; angle += 30) {
        const x = center.x + radius * Math.cos((angle * Math.PI) / 180)
        const y = center.y + radius * Math.sin((angle * Math.PI) / 180)
        if (x < stage.left + 8 || x > stage.right - 8 || y < stage.top + 8 || y > stage.bottom - 8) continue
        if (document.elementFromPoint(x, y)?.matches(paneSelector)) {
          return { visible: inside.length, share, minCardWidth: Math.min(...rects.map((r) => r.width)), point: { x, y } }
        }
      }
    }
    return { visible: inside.length, share, minCardWidth: Math.min(...rects.map((r) => r.width)), point: null }
  }, { ownNode: OWN.node, paneSelector: CANVAS_PANE_SELECTOR })
  let view = await measure()
  for (let step = 0; step < 12 && view?.point; step += 1) {
    // 卡在屏上至少这么宽，它自己的浮框（固定屏幕尺寸）才不会把卡和握把整个盖住——人也是凑到这个大小才去连线。
    if (view.minCardWidth >= 240 || view.share >= 0.7) break
    const point = view.point
    await getWin().mouse.move(point.x, point.y)
    await getWin().mouse.wheel(0, -120)
    await getWin().waitForTimeout(220)
    const next = await measure()
    if (!next || next.visible < 2) {
      // 放过头了（有一张卡出了视野）：退回一格就停。
      await getWin().mouse.move(point.x, point.y)
      await getWin().mouse.wheel(0, 120)
      await getWin().waitForTimeout(220)
      view = await measure()
      break
    }
    view = next
  }
  return view
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

/**
 * 建一张卡，回报**这一次**新增的那张卡落地的经过（id + 落在屏里 / 点边缘提示过去）。
 * 判据全在 `_canvasHit.mjs` 的 `expectArrivalsReachable`（单一 owner）：画布不自己动、新卡要么落在舞台里、
 * 要么边缘提示指得到它并且点过去就完整框住。夹具里原有的卡（used 夹具有 24 张）和前面自己建的卡都算「已知」，
 * 它们在视口一动时才进 DOM（只渲染可见节点），不能被当成「这一次新建的」。
 */
async function addNode(kind) {
  const knownIds = [...SEEDED_NODE_IDS, ...CREATED_NODE_IDS]
  // 基线必须在点之前、且视口停稳时读（用户自己前一步点出来的动画得先落地）。
  const viewportBefore = await waitForCanvasViewportSettled(getWin())
  await getWin().locator(`.generation-canvas-v2-toolbar [data-node-kind="${kind}"]`).first().click()
  const arrival = await expectArrivalsReachable(getWin(), {
    knownIds, expectedCount: 1, viewportBefore, label: `工具条新建${kind === 'image' ? '图片' : '视频'}卡`,
  })
  CREATED_NODE_IDS.push(...arrival.ids)
  return { id: arrival.ids[0] ?? null, path: arrival.path, hint: arrival.hint }
}
const CREATED_NODE_IDS = []

/** 某张卡此刻相对 stage 的位置。stage 尺寸一并交出来：判几何红时先看是不是舞台根本不是这么大。 */
async function measurePlacement(nodeId) {
  return getWin().evaluate((id) => {
    const stage = document.querySelector('.generation-canvas-v2__stage')?.getBoundingClientRect()
    const node = id ? document.querySelector(`.react-flow__node[data-id="${id}"]`) : null
    if (!stage || !node) return { id, inside: false, seen: false, missing: true }
    const r = node.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    return {
      id,
      inside: r.left >= stage.left - 1 && r.right <= stage.right + 1 && r.top >= stage.top - 1 && r.bottom <= stage.bottom + 1,
      // 产品的「看见了」判据：中心在可见区里（canvasArrivalModel.ts isNodeSeen）。
      seen: cx >= stage.left && cx <= stage.right && cy >= stage.top && cy <= stage.bottom,
      overflowRight: Math.round(r.right - stage.right),
      overflowLeft: Math.round(stage.left - r.left),
      stage: { w: Math.round(stage.width), h: Math.round(stage.height) },
      node: { w: Math.round(r.width), h: Math.round(r.height) },
    }
  }, nodeId)
}

const pageErrors = []
getWin().on('pageerror', (error) => pageErrors.push(String(error)))
const consoleWarnings = []
getWin().on('console', (msg) => {
  if (msg.type() === 'warning' || msg.type() === 'error') consoleWarnings.push(msg.text().slice(0, 200))
})

try {
  await getWin().waitForLoadState('domcontentloaded')
  await resize(1600, 1000)
  await dismissFirstRun()

  // 占位 key：让内置图像/视频模型出现，连线能算出真实 mode（全程不点生成、零额度）。
  const savedCredential = await getWin().evaluate(async () => {
    const catalog = window.nomiDesktop.modelCatalog
    const vendor = catalog.listVendors().find(item => item.key === 'kie')
    catalog.upsertVendor({ ...vendor, baseUrlHint: 'http://127.0.0.1:1' })
    const saved = await catalog.upsertVendorApiKey('kie', { apiKey: 'nomi-e2e-placeholder', enabled: true })
    return { saved, vendor: catalog.listVendors().find(item => item.key === 'kie') }
  })
  // 这三行断的是**前提**（占位 key 真的存进去了），不是验证流程本身。
  // #726（vendor-key-publish-class）改了 kie 这类内置 curated 家的 key 判据：没有便宜且可信的
  // 预检（最小真实请求 = 一次付费生成，不能替用户花钱），于是缺省判据是 `first-use`——
  // **存 key 即发布、不再挂「待验证」**（理由逐字写在 builtinVendorSeeds.ts 的 keyValidation 上）。
  // 此前这里断言 `verificationPending === true`，断的其实是「/v1/models 探测打不通那台假 host」
  // 这个副产物；判据一改它就必红。改成断言新语义本身，两边都说得出口。
  expect(savedCredential.saved.hasApiKey, '占位 key 要真的落进 catalog').toBe(true)
  expect(savedCredential.saved.verificationPending ?? false,
    'first-use 判据不挂「待验证」：没有可验的便宜端点，挂上就是一句做不到的承诺（#726）').toBe(false)
  expect(savedCredential.vendor.credentialVerificationPending ?? false,
    'vendor 行上的那面旗子同理不该亮').toBe(false)
  await getWin().reload()
  await getWin().waitForLoadState('domcontentloaded')
  await getWin().waitForTimeout(1500)
  await dismissFirstRun()

  // 从项目库点开夹具项目（empty = 空项目；used = 用过的项目），进生成画布。
  win = await smoke.openProject()
  await dismissFirstRun()
  await resize(1600, 1000)
  await getWin().locator('.generation-canvas-v2-toolbar').waitFor({ timeout: 8000 })

  // ── 任务准备：摆一个图片节点 + 一个视频节点 ─────────────────────────────
  // 2026-09-25 用户拍板「程序不再主动平移 / 缩放画布」：以前每建一张卡画布会自己露出平移过去，这里等的是
  // 那段动画；现在新卡落在当前可见区（舞台宽 38%、高 28% 那一点），可见区挤了螺旋避让会把第二张推向右/下，
  // 中心出了舞台就由边缘提示指路、**点它**画布才过去。所以逐张建、逐张验三件事（判据在 _canvasHit.mjs）：
  //   ① 建卡前后视口逐格相同（画布没自己动）；
  //   ② 新卡落在舞台里（中心在 stage 内 = 产品「看见了」的判据，不被常驻 Agent 面板遮住——stage 不含那块面板）；
  //   ③ 否则边缘提示出现、方向对、点一下那张卡完整进 stage。
  // 「完整」只在走提示那条路上断：落在屏里的那张可能右缘被舞台切掉一截（CI 的 Linux runner 把窗口夹到 1280 宽，
  // 下面 resize(1600, 1000) 静默不生效），产品按中心判它「看见了」、不出提示，这是拍板后的设计不是回归。
  // 仍逐张量而不是建完两张再要求同时在 stage 内：点第二张的提示会把第一张挪向边缘。见 docs/lessons/
  // walkthrough-geometry-must-reverify-under-the-real-cursor.md 同一族。
  const createdPlacement = []
  for (const kind of ['image', 'video']) {
    const created = await addNode(kind)
    createdPlacement.push({ kind, path: created.path, hint: created.hint?.side ?? null, ...(await measurePlacement(created.id)) })
  }
  assert(
    createdPlacement.length === 2 && createdPlacement.every((entry) => entry.seen && (entry.path === 'in-view' || entry.inside)),
    '每张新建的卡都在 stage 里看得见（不被常驻 Agent 面板遮住）：落在屏里，或点边缘提示过去完整框住；画布从不自己挪',
    JSON.stringify(createdPlacement),
  )
  const ownId = (kind) => createdPlacement.find((entry) => entry.kind === kind)?.id
  OWN.image = `.generation-canvas-v2-node[data-node-id="${ownId('image')}"]`
  OWN.video = `.generation-canvas-v2-node[data-node-id="${ownId('video')}"]`
  OWN.node = `${OWN.image}, ${OWN.video}`
  // 2026-09-25 起新卡放不进可见区时落在屏外、点边缘提示过去；过去之后第一张可能出了屏，被 React Flow
  // 按可见性卸载（DOM 里数不到）。数之前像人一样点真实的「适应视图」把两张都收进来——这是用户自己的动作，
  // 允许移动画布；画布「自己不动」那条已在上面 expectArrivalsReachable 里断过。
  if ((await getWin().locator(OWN.node).count()) < 2) await frameOwnCards()
  const nodeIds = await getWin().evaluate((ownNode) =>
    Array.from(document.querySelectorAll(ownNode)).map((node) => ({
      id: node.getAttribute('data-node-id'),
      kind: node.getAttribute('data-kind'),
    })), OWN.node,
  )
  if (nodeIds.length < 2) {
    // 节点建了却没渲染出来：把 React Flow 容器尺寸、视口、节点数与控制台告警一起交出去（NaN 视口那一族见
    // docs/lessons/walkthrough-geometry-must-reverify-under-the-real-cursor.md）。
    const diag = await getWin().evaluate(() => {
      const rf = document.querySelector('.react-flow')?.getBoundingClientRect()
      const layer = document.querySelector('.generation-canvas-v2__canvas')
      const m = layer ? new DOMMatrixReadOnly(getComputedStyle(layer).transform) : null
      return {
        rf: rf ? { w: Math.round(rf.width), h: Math.round(rf.height) } : null,
        viewport: m ? { x: Math.round(m.m41), y: Math.round(m.m42), zoom: m.a } : null,
        rfNodes: document.querySelectorAll('.react-flow__nodes > *').length,
        stageReady: document.querySelector('.generation-canvas-v2__stage')?.getAttribute('data-ready'),
      }
    })
    console.log('  · DIAG', JSON.stringify({ ...diag, consoleWarnings: consoleWarnings.slice(0, 4), pageErrors }))
  }
  assert(nodeIds.length >= 2, '画布上有两个节点', JSON.stringify(nodeIds))

  // ── ① 空白左键拖 = 平移画布 ────────────────────────────────────────────
  const blank = await findBlankPoint()
  assert(Boolean(blank), '找得到一块画布空白', JSON.stringify(blank))
  // 建卡本身不再挪画布，但若第二张走了边缘提示，那一下点击是一段 220ms 的动画；composer 挂载、卡面出图
  // 也还在收尾。没停就读基线，量到的是动画而不是这次拖动（机器忙时实测 Δ 反号）。
  // 等画面视觉安定（_assert.mjs 的共享判据）再开始。
  await waitForVisualQuiescence(getWin())
  const before = await readTransform()
  assert(before.willChange.includes('transform'), '变换层已提升为合成层（will-change: transform）', before.willChange)

  // 这一笔平移偶发「画布反向跳 (+322,+177)」（2026-09-22 两个会话各见过一次，之后 30+ 次复跑未再现）。
  // 失败时要有证据：被动记下视口 transform 的每次改写、指针事件落点、选中变化（只观察、不改时序），
  // 断言红了就把这份轨迹连同截图一起交出去。
  await getWin().evaluate(() => {
    const trace = []
    window.__walkPanTrace = trace
    const t0 = performance.now()
    const at = () => Math.round(performance.now() - t0)
    const viewportLayer = document.querySelector('.react-flow__viewport')
    if (viewportLayer) new MutationObserver(() => trace.push(['viewport', at(), viewportLayer.style.transform])).observe(viewportLayer, { attributes: true, attributeFilter: ['style'] })
    for (const type of ['pointerdown', 'pointerup', 'click']) {
      window.addEventListener(type, (event) => trace.push([type, at(), String(event.target?.className ?? '').slice(0, 60)]), true)
    }
    const nodeLayer = document.querySelector('.react-flow__nodes')
    if (nodeLayer) {
      new MutationObserver((records) => {
        for (const record of records) trace.push(['node-class', at(), record.target.getAttribute('data-id'), record.target.classList.contains('selected')])
      }).observe(nodeLayer, { attributes: true, attributeFilter: ['class'], subtree: true })
    }
  })
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
  const panMoved = Math.round(afterPan.x - before.x) <= -100 && Math.round(afterPan.y - before.y) <= -60
  if (!panMoved) console.log('  · 平移轨迹（失败证据）', JSON.stringify({ before, afterPan, trace: await getWin().evaluate(() => window.__walkPanTrace.slice(-120)) }))

  assert(duringPan.cursor === 'grabbing', '拖动中光标是 grabbing', duringPan.cursor)
  assert(duringPan.panningAttr === null, '左键平移不写 data-panning（光标交给 CSS :active）')
  assert(duringPan.draggingAttr === 'true', '平移期间画布进入拖动态')
  assert(duringPan.visibleOverlays === 0, '平移期间浮层也收起来了', JSON.stringify(duringPan))
  assert(duringPan.marquee === 0, '空白左键拖不再拉出框选矩形')
  assert(
    panMoved,
    '画布确实跟着鼠标移动了',
    `Δ=(${Math.round(afterPan.x - before.x)}, ${Math.round(afterPan.y - before.y)})`,
  )
  assert(afterPan.zoom === before.zoom, '平移不改变缩放')

  // ── ② 平移不重建节点：拖完还是同一批 DOM 实例（React 没重挂），且没有新的页面错误 ──
  // 上一笔平移可能把卡推到舞台边；再拖 90px 会让它整张出屏、被 React Flow 按可见性卸载——那是虚拟化，不是重建。
  // 先像人一样把两张卡收回视野中央（点「适应视图」再凑近），这一笔验的才是「平移本身不重挂节点」。
  await frameOwnCards()
  const nodeIdentity = await getWin().evaluate((ownNode) => {
    const nodes = Array.from(document.querySelectorAll(ownNode))
    window.__walkNodeRefs = nodes
    return nodes.length
  }, OWN.node)
  const blankAgain = await findBlankPoint()
  await getWin().mouse.move(blankAgain.x, blankAgain.y)
  await getWin().mouse.down()
  await getWin().mouse.move(blankAgain.x + 90, blankAgain.y + 40, { steps: 10 })
  await getWin().mouse.up()
  await getWin().waitForTimeout(200)
  const sameInstances = await getWin().evaluate((ownNode) => {
    const nodes = Array.from(document.querySelectorAll(ownNode))
    const refs = window.__walkNodeRefs || []
    return { same: nodes.length === refs.length && nodes.every((node, index) => node === refs[index]), before: refs.length, after: nodes.length }
  }, OWN.node)
  assert(nodeIdentity >= 2 && sameInstances.same, '平移前后节点是同一批 DOM 实例（没有整层重建）', JSON.stringify(sameInstances))

  // ── ① 点一下空白 = 取消选中；Shift + 左键拖 = 框选并追加 ─────────────────
  // 点卡片本体的那一点由 `_canvasHit.mjs` 定（单一 owner）：外接盒角上的固定偏移在窄舞台下
  // 会滑到左侧工具条底下，Playwright 只报 "html intercepts pointer events"。
  const firstNodeHit = await findNodeHitPoint(getWin(), { nodeSelector: OWN.image })
  assert(Boolean(firstNodeHit), '第一张卡上找得到真正点得到的一点', JSON.stringify(firstNodeHit))
  await getWin().mouse.click(firstNodeHit.x, firstNodeHit.y)
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
  // 适应视图只保证节点**在**视口里，不保证**离边够远**：窄画布下它留的余量可能比 React Flow
  // 的自动平移带还小，于是「框得住两张卡」和「端点别落进自动平移带」直接打架
  // （CI 1280 宽实测左边只剩 40px，框到 48px 内缩就切掉了第一张卡的左沿）。
  // 用户遇到这种情况会往外滚一格再框；走查照做——滚到实测占比够小为止。
  let headroom = await readMarqueeHeadroom()
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (headroom && headroom.widthRatio <= MARQUEE_MAX_BOUNDS_RATIO && headroom.heightRatio <= MARQUEE_MAX_BOUNDS_RATIO) break
    const zoomOutAt = await findBlankPoint()
    await getWin().mouse.move(zoomOutAt.x, zoomOutAt.y)
    await getWin().mouse.wheel(0, 240)
    await getWin().waitForTimeout(220)
    headroom = await readMarqueeHeadroom()
  }
  assert(
    Boolean(headroom)
      && headroom.widthRatio <= MARQUEE_MAX_BOUNDS_RATIO
      && headroom.heightRatio <= MARQUEE_MAX_BOUNDS_RATIO,
    '框选前两张卡已缩到画布的六成以内（四角才够离开自动平移带）',
    JSON.stringify(headroom),
  )
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

  // ── ① 框选「扫到即选」：框只盖住一张卡的一半，那张卡照样被选上 ─────────────
  // 用户的习惯动作是扫一下就选上。React Flow 默认 selectionMode=Full＝必须整张卡落进框里，
  // 窄画布下等于选不中（审计 ③ 表第 5 行）。这一笔是那条语义的唯一判据。
  const clearBeforePartial = await findBlankPoint()
  await getWin().mouse.click(clearBeforePartial.x, clearBeforePartial.y)
  await getWin().waitForTimeout(250)
  assert((await selectedNodeIds()).length === 0, '半扫之前先把选区清空（否则选上了也说明不了问题）')

  // 2026-09-25 起新卡优先落进可见区的空位——used 夹具里那常是贴着底边的一条缝，四周没有起手的空白。
  // 像用户一样中键把两张卡拖到舞台中间再扫（用户自己的平移，允许动画布）。
  const ownCentre = await getWin().evaluate((ownNode) => {
    const stage = document.querySelector('.generation-canvas-v2__stage')?.getBoundingClientRect()
    const rects = Array.from(document.querySelectorAll(ownNode)).map((node) => node.getBoundingClientRect())
    if (!stage || !rects.length) return null
    return {
      dx: (stage.left + stage.right) / 2 - (Math.min(...rects.map((r) => r.left)) + Math.max(...rects.map((r) => r.right))) / 2,
      dy: (stage.top + stage.bottom) / 2 - (Math.min(...rects.map((r) => r.top)) + Math.max(...rects.map((r) => r.bottom))) / 2,
    }
  }, OWN.node)
  if (ownCentre && (Math.abs(ownCentre.dx) > 40 || Math.abs(ownCentre.dy) > 40)) {
    const panFrom = await findBlankPoint()
    await getWin().mouse.move(panFrom.x, panFrom.y)
    await getWin().mouse.down({ button: 'middle' })
    await getWin().mouse.move(panFrom.x + ownCentre.dx, panFrom.y + ownCentre.dy, { steps: 12 })
    await getWin().mouse.up({ button: 'middle' })
    await waitForCanvasViewportSettled(getWin())
  }

  const partialGesture = await getWin().evaluate(({ paneSelector, inset, ownNode }) => {
    const stage = document.querySelector('.generation-canvas-v2__stage')
    const nodes = Array.from(document.querySelectorAll(ownNode))
    if (!stage || !nodes.length) return null
    const stageRect = stage.getBoundingClientRect()
    const insideStage = (point) =>
      point.x >= stageRect.left + inset && point.x <= stageRect.right - inset &&
      point.y >= stageRect.top + inset && point.y <= stageRect.bottom - inset
    const overlaps = (box, rect) =>
      box.right > rect.left && box.left < rect.right && box.bottom > rect.top && box.top < rect.bottom
    const contains = (box, rect) =>
      box.left <= rect.left && box.right >= rect.right && box.top <= rect.top && box.bottom >= rect.bottom
    // 四个角都试：2026-09-25 起新卡优先落进可见区的空位，常常紧挨着已有的卡 / 编组框，
    // 只试左上角会因为起手点压在邻居身上而找不到——那是探测太窄，不是框选坏了。
    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]]
    for (const node of nodes) {
      const rect = node.getBoundingClientRect()
      for (const [dx, dy] of corners) for (const gap of [56, 40, 28, 18, 12]) {
        // 从卡某个角外侧的空白起手，只扫到它的横向中线就松手：框与卡相交，但**不包含**它。
        const start = { x: dx < 0 ? rect.left - gap : rect.right + gap, y: dy < 0 ? rect.top - gap : rect.bottom + gap }
        const end = { x: rect.left + rect.width / 2, y: dy < 0 ? rect.bottom + gap : rect.top - gap }
        if (!insideStage(start) || !insideStage(end)) continue
        const hit = document.elementFromPoint(start.x, start.y)
        if (!hit || !stage.contains(hit) || !hit.matches(paneSelector)) continue
        const box = {
          left: Math.min(start.x, end.x), right: Math.max(start.x, end.x),
          top: Math.min(start.y, end.y), bottom: Math.max(start.y, end.y),
        }
        if (contains(box, rect)) continue
        // 别把另一张卡也扫进来：那样选中数就解释不清是谁被选上的。
        if (nodes.some((other) => other !== node && overlaps(box, other.getBoundingClientRect()))) continue
        return {
          id: node.getAttribute('data-node-id'),
          start: { x: Math.round(start.x), y: Math.round(start.y) },
          end: { x: Math.round(end.x), y: Math.round(end.y) },
          // 框与卡的横向交叠占卡宽的比例（左右两侧起手都按真实交叠算）。
          coveredRatio: Math.round(((Math.min(box.right, rect.right) - Math.max(box.left, rect.left)) / rect.width) * 100) / 100,
        }
      }
    }
    return null
  }, { paneSelector: CANVAS_PANE_SELECTOR, inset: MARQUEE_STAGE_INSET_PX, ownNode: OWN.node })
  assert(Boolean(partialGesture), '找得到「只扫到一张卡一半」的框选手势', JSON.stringify(partialGesture))
  assert(
    partialGesture.coveredRatio > 0.2 && partialGesture.coveredRatio < 0.9,
    '这一框确实只盖住这张卡的一部分（否则 Full/Partial 两种语义都会绿）',
    `盖住 ${Math.round(partialGesture.coveredRatio * 100)}%`,
  )
  await getWin().keyboard.down('Shift')
  await getWin().mouse.move(partialGesture.start.x, partialGesture.start.y)
  await getWin().mouse.down()
  await getWin().mouse.move(partialGesture.end.x, partialGesture.end.y, { steps: 16 })
  await getWin().waitForTimeout(200)
  const partialSelectedDuringDrag = await selectedNodeIds()
  await snap('02a-partial-marquee.png')
  await evidence('backfill-a-partial-marquee.png')
  await getWin().mouse.up()
  await getWin().keyboard.up('Shift')
  await getWin().waitForTimeout(320)
  const partialSelected = await selectedNodeIds()
  assert(
    partialSelected.includes(partialGesture.id),
    '框只扫过卡的一半，这张卡照样被选上（相交即选，不是必须整张落进框）',
    JSON.stringify({ gesture: partialGesture, selected: partialSelected }),
  )
  assert(
    partialSelectedDuringDrag.includes(partialGesture.id),
    '拖动中就已经选上了（证据截图里框与选中态同框）',
    JSON.stringify(partialSelectedDuringDrag),
  )

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
  const imageNode = getWin().locator(OWN.image).first()
  const videoNode = getWin().locator(OWN.video).first()

  // 用过的项目里，画布底部挂着两样「底部停靠物」：时间轴有片段时的「画面小窗」、卡多时自动出现的小地图。
  // 这一步原本是给旧浮框让路（它躲停靠区、放不下时被 clamp 到盖住卡本身和连线握把）；2026-09-25 起浮框
  // 钉在节点正下方（composerCanvasPlacement.ts），不再躲停靠区、也不再重新定位，那条理由已不成立。
  // 保留这一步只因为两样停靠物本身占着画布底部一片、人连线前也会顺手收起；empty 夹具里两样都不在，这一步什么都不做。
  for (const name of EN ? ['Collapse mini preview', 'Hide minimap'] : ['收起画面小窗', '隐藏地图']) {
    const dockToggle = getWin().getByRole('button', { name, exact: true })
    if (!(await dockToggle.isVisible())) continue
    await dockToggle.click()
    await expect(dockToggle).toBeHidden()
  }

  // 中途缩放可能把节点中心推到视口外；连线前先把两张卡完整收回可视区域。
  await frameOwnCards()

  // 先摆位置（真实动作）：把视频卡拖到图片卡**右边同一行**，再像人一样把画布平移到两张卡贴近左上角——
  // 连线时图片卡的浮框在下沿展开，不会压住视频卡与右侧握把。
  // （浮框恒钉在节点正下方、不 clamp 进视口，放不下就伸出舞台被裁，不会再翻上来盖住卡本身。）
  const deselectPoint = await findBlankPoint()
  await getWin().mouse.click(deselectPoint.x, deselectPoint.y)
  await getWin().waitForTimeout(200)
  const imageBeforeLayout = await imageNode.boundingBox()
  const videoStart = await videoNode.boundingBox()
  const stageForLayout = await getWin().locator('.generation-canvas-v2__stage').boundingBox()
  const videoTarget = {
    x: Math.min(imageBeforeLayout.x + imageBeforeLayout.width + 80 + videoStart.width / 2, stageForLayout.x + stageForLayout.width - videoStart.width / 2 - 24),
    y: imageBeforeLayout.y + 12,
  }
  await getWin().mouse.move(videoStart.x + videoStart.width / 2, videoStart.y + 12)
  await getWin().mouse.down()
  await getWin().mouse.move(videoTarget.x, videoTarget.y, { steps: 14 })
  await getWin().mouse.up()
  await getWin().waitForTimeout(400)
  const collapseAfterDrag = await findBlankPoint()
  await getWin().mouse.click(collapseAfterDrag.x, collapseAfterDrag.y)
  await getWin().waitForTimeout(250)
  const imageBeforePan = await imageNode.boundingBox()
  const panFrom = await findBlankPoint()
  const panBy = {
    x: Math.round(stageForLayout.x + 150 - imageBeforePan.x),
    y: Math.round(stageForLayout.y + 72 - imageBeforePan.y),
  }
  await getWin().mouse.move(panFrom.x, panFrom.y)
  await getWin().mouse.down()
  await getWin().mouse.move(panFrom.x + panBy.x, panFrom.y + panBy.y, { steps: 12 })
  await getWin().mouse.up()
  await getWin().waitForTimeout(320)

  // 拖完视频卡它是选中态，浮框在它下沿展开（560 宽，可能横跨到图片卡下方那片）。
  // 真人会先点一下空白收起它，再去点图片卡上真正点得到的那一点（命中判据归 _canvasHit.mjs）。
  const collapseComposerAt = await findBlankPoint()
  await getWin().mouse.click(collapseComposerAt.x, collapseComposerAt.y)
  await getWin().waitForTimeout(300)
  const imageSelectHit = await findNodeHitPoint(getWin(), { nodeSelector: OWN.image })
  assert(Boolean(imageSelectHit), '图片卡上找得到真正点得到的一点', JSON.stringify(imageSelectHit))
  await getWin().mouse.click(imageSelectHit.x, imageSelectHit.y)
  await getWin().waitForTimeout(450)
  const selectedImageAffordances = await getWin().evaluate((ownImage) => {
    const image = document.querySelector(ownImage)
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
  }, OWN.image)
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
        magnetic: Boolean(hit?.closest('.generation-canvas-react-flow__handle, .generation-canvas-v2-node__magnetic-handle')),
        label: hit?.getAttribute('aria-label') || hit?.className?.toString().slice(0, 60) || hit?.tagName,
      }
    },
    handlePoint,
  )
  if (!handleHit.magnetic) {
    const layout = await getWin().evaluate((ownImage) => {
      const r = (el) => { const b = el?.getBoundingClientRect(); return b ? [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)] : null }
      return { stage: r(document.querySelector('.generation-canvas-v2__stage')), image: r(document.querySelector(ownImage)), composer: r(document.querySelector('.generation-canvas-v2-node__composer-card')) }
    }, OWN.image)
    console.log('  · DIAG handle', JSON.stringify({ handlePoint, imageBox, layout }))
  }
  assert(handleHit.magnetic, '图片节点右侧握把可点', JSON.stringify(handleHit))
  // 松手点取视频卡上**真正露出来、点得到**的一点：选中图片卡时它的浮框钉在正下方、定宽 560（被挡就挡，09-25），
  // 在 1280×800 的 Linux 字体下会盖住视频卡的几何中心——落在浮框上松手，人也连不上。人会把线拖到看得见的那块卡面上。
  const videoDropPoint = await findNodeHitPoint(getWin(), { nodeSelector: OWN.video })
  assert(Boolean(videoDropPoint), '视频卡上找得到一处露出来的松手点', JSON.stringify({ videoBox }))
  await getWin().mouse.move(handlePoint.x, handlePoint.y)
  await getWin().mouse.down()
  await getWin().mouse.move(videoDropPoint.x, videoDropPoint.y, { steps: 16 })
  await getWin().mouse.up()
  await getWin().waitForTimeout(700)
  // 刚连出来的那条线：夹具里原有的线不算（used 夹具有 27 条）。
  const ownEdgeIds = () => getWin().evaluate((seeded) => Array.from(document.querySelectorAll('.generation-canvas-v2__edge'))
    .map((edge) => edge.getAttribute('data-edge-id')).filter((id) => id && !seeded.includes(id)), SEEDED_EDGE_IDS)
  const createdEdges = await ownEdgeIds()
  const edgeCount = createdEdges.length
  assert(edgeCount >= 1, '图片节点连到了视频节点', `${edgeCount} 条边`)
  OWN.edge = `.generation-canvas-v2__edge[data-edge-id="${createdEdges[0]}"]`
  const connectedEdgeVisual = await getWin().evaluate((own) => {
    const image = document.querySelector(own.image)
    const video = document.querySelector(own.video)
    const path = document.querySelector(`${own.edge} .generation-canvas-v2__edge-path`)
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
  }, OWN)
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

  const videoHit = await findNodeHitPoint(getWin(), { nodeSelector: OWN.video })
  assert(Boolean(videoHit), '视频卡上找得到真正点得到的一点', JSON.stringify(videoHit))
  await getWin().mouse.click(videoHit.x, videoHit.y)
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

  // 同一条真实任务继续：改边模式 / 断开 / 锁定，各按一次 Cmd+Z，不能撤掉前一笔。
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  const edgeLabel = getWin().locator('.generation-canvas-v2__edge-tag-pill').first()
  const historyEdge = getWin().locator(OWN.edge).first()
  const originalMode = await historyEdge.getAttribute('data-mode')
  const originalModeLabel = await edgeLabel.innerText()
  await edgeLabel.click()
  const alternativeMode = getWin().getByRole('menuitemradio', { checked: false }).first()
  await expect(alternativeMode).toBeVisible()
  await alternativeMode.click()
  // 通用 reference 边按现行设计不显示标签；检查真实边语义，不能要求它强行露出。
  await expect(historyEdge).not.toHaveAttribute('data-mode', originalMode)
  await expect(historyEdge).toBeVisible()
  await snap('04a-edge-mode-changed.png')
  await getWin().keyboard.press(`${mod}+z`)
  await expect(historyEdge).toHaveAttribute('data-mode', originalMode)
  await expect(edgeLabel).toHaveText(originalModeLabel)
  await expect.poll(async () => (await ownEdgeIds()).length).toBe(edgeCount)
  await expect(getWin().locator(OWN.node)).toHaveCount(nodeIds.length)
  await snap('04b-edge-mode-undone.png')

  await edgeLabel.click()
  await getWin().locator('.generation-canvas-react-flow__edge-menu-delete').click()
  await expect.poll(async () => (await ownEdgeIds()).length).toBe(edgeCount - 1)
  await snap('04c-edge-disconnected.png')
  await getWin().keyboard.press(`${mod}+z`)
  await expect.poll(async () => (await ownEdgeIds()).length).toBe(edgeCount)
  await expect(getWin().locator(OWN.node)).toHaveCount(nodeIds.length)
  await snap('04d-edge-disconnect-undone.png')

  const lockBadge = videoNode.locator('[data-node-lock]')
  await expect(lockBadge).toHaveAttribute('data-node-lock', 'unlocked')
  await lockBadge.click()
  await expect(lockBadge).toHaveAttribute('data-node-lock', 'locked')
  await getWin().keyboard.press(`${mod}+z`)
  await expect(lockBadge).toHaveAttribute('data-node-lock', 'unlocked')
  await expect.poll(async () => (await ownEdgeIds()).length).toBe(edgeCount)
  await snap('04e-node-lock-undone.png')
  console.log('  ✓ 改边模式、断线、锁定各按一次 Cmd+Z 还原，前一笔节点/连线保留')

  // ── ④ 拖动节点：浮条 / 提示词面板隐身，松手回来 ─────────────────────────
  const composerBefore = await getWin().evaluate(() => {
    const composer = document.querySelector('.generation-canvas-v2-node__composer')
    return composer ? getComputedStyle(composer).visibility : null
  })
  assert(composerBefore === 'visible', '选中节点时提示词面板可见')

  // 起手点同样按「最顶层就是这张卡」取（外接盒顶边 +12 在窄舞台下会压在卡片标题片/浮层上，
  // 于是 mousedown 根本没落到卡上，走查报的却是「拖动中画布没发布 data-dragging」）。
  const dragGrab = await findNodeHitPoint(getWin(), { nodeSelector: OWN.video })
  assert(Boolean(dragGrab), '视频卡上找得到可以起手拖动的一点', JSON.stringify(dragGrab))
  await getWin().mouse.move(dragGrab.x, dragGrab.y)
  await getWin().mouse.down()
  await getWin().mouse.move(dragGrab.x + 70, dragGrab.y + 48, { steps: 12 })
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
    // 平移方向朝画布中心：让选中卡留在视野里、不被推到停靠物（左侧工具条、底部导航）边缘。
    // 当初这么选是为了躲旧浮框的 clamp 重定位；2026-09-25 起浮框钉在节点下方（composerCanvasPlacement.ts，
    // 只看节点尺寸 + 缩放），平移时不再重新定位，这条理由已不成立——方向保持不变，量的仍是平移本身。
    const panDirection = await getWin().evaluate(() => {
      const stage = document.querySelector('.generation-canvas-v2__stage')?.getBoundingClientRect()
      const selected = document.querySelector('.react-flow__node.selected')?.getBoundingClientRect()
      if (!stage || !selected) return { x: -1, y: -1 }
      const sx = (stage.left + stage.right) / 2 - (selected.left + selected.right) / 2
      const sy = (stage.top + stage.bottom) / 2 - (selected.top + selected.bottom) / 2
      return { x: sx >= 0 ? 1 : -1, y: sy >= 0 ? 1 : -1 }
    })
    // 只渲染可见节点：平移把卡带进 / 带出视野时，React 挂载 / 卸载那几张卡会各触发一次布局——那是虚拟化本身的代价，
    // 不是「平移路径上读了尺寸」。所以按帧数一数这段里节点层真的增删过几次，每一帧挂卸放行一次布局。
    // empty 夹具只有两张卡、一直都在视野里，这个数是 0，判据与原来逐字相同。
    await getWin().evaluate(() => {
      const layer = document.querySelector('.react-flow__nodes')
      const state = { frame: 0, frames: new Set(), running: true }
      const tick = () => { state.frame += 1; if (state.running) requestAnimationFrame(tick) }
      requestAnimationFrame(tick)
      state.observer = new MutationObserver(() => state.frames.add(state.frame))
      if (layer) state.observer.observe(layer, { childList: true })
      window.__walkNodeMountFrames = state
    })
    const beforeMetrics = await metrics()
    await getWin().mouse.move(panPoint.x, panPoint.y)
    await getWin().mouse.down()
    for (let step = 0; step < 60; step += 1) {
      await getWin().mouse.move(panPoint.x + panDirection.x * step * 2, panPoint.y + panDirection.y * step, { steps: 1 })
      await getWin().waitForTimeout(16)
    }
    await getWin().mouse.up()
    await getWin().waitForTimeout(200)
    const afterMetrics = await metrics()
    const layouts = Math.round(afterMetrics.LayoutCount - beforeMetrics.LayoutCount)
    const mountFrames = await getWin().evaluate(() => {
      const state = window.__walkNodeMountFrames
      state.running = false
      state.observer.disconnect()
      return state.frames.size
    })
    console.log(`  · 一秒平移（60 次移动）期间布局重算 ${layouts} 次；其中节点进出视野的帧 ${mountFrames} 帧`)
    assert(layouts <= 6 + mountFrames, '平移是纯合成：整段拖动几乎不重算布局（节点进出视野那几帧除外）', `${layouts} 次 / 60 帧，挂卸帧 ${mountFrames}`)
  }

  // ── ⑨ 双击空白不缩放（旧画布没有这个手势；内核默认 zoomOnDoubleClick=true）────────
  const doubleClickPoint = await findBlankPoint()
  const beforeDoubleClick = await readTransform()
  await getWin().mouse.dblclick(doubleClickPoint.x, doubleClickPoint.y)
  await getWin().waitForTimeout(520)
  const afterDoubleClick = await readTransform()
  assert(
    afterDoubleClick.zoom === beforeDoubleClick.zoom,
    '双击空白不缩放（误触不再突然放大一档）',
    `${beforeDoubleClick.zoom.toFixed(3)} → ${afterDoubleClick.zoom.toFixed(3)}`,
  )

  // ── ⑩ 中键拖平移：光标要变成「抓紧」────────────────────────────────────
  // CSS 的 `:active` 只跟主键走，认不出中键 / 右键 / 空格——那三种入口的光标靠宿主写
  // data-panning。迁移后没人写它，于是中键拖的时候手已经在拖、画面还在说「可以拖」。
  const middlePanPoint = await findBlankPoint()
  const beforeMiddlePan = await readTransform()
  await getWin().mouse.move(middlePanPoint.x, middlePanPoint.y)
  await getWin().mouse.down({ button: 'middle' })
  await getWin().mouse.move(middlePanPoint.x - 90, middlePanPoint.y - 60, { steps: 12 })
  const duringMiddlePan = await getWin().evaluate(() => {
    const stage = document.querySelector('.generation-canvas-v2__stage')
    return { panningAttr: stage.getAttribute('data-panning'), cursor: getComputedStyle(stage).cursor }
  })
  await snap('07-middle-drag-panning.png')
  await getWin().mouse.up({ button: 'middle' })
  await getWin().waitForTimeout(280)
  const afterMiddlePan = await readTransform()
  const middlePanAttrLeft = await getWin().evaluate(
    () => document.querySelector('.generation-canvas-v2__stage').hasAttribute('data-panning'),
  )
  assert(duringMiddlePan.panningAttr === 'true', '中键拖平移期间写了 data-panning', JSON.stringify(duringMiddlePan))
  assert(duringMiddlePan.cursor === 'grabbing', '中键拖平移光标是 grabbing', duringMiddlePan.cursor)
  assert(!middlePanAttrLeft, '松手后 data-panning 清干净（不留残留态）')
  assert(
    Math.round(afterMiddlePan.x - beforeMiddlePan.x) <= -40,
    '中键拖真的平移了画布',
    `Δx=${Math.round(afterMiddlePan.x - beforeMiddlePan.x)}`,
  )

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

  // ── ③ 「画布手势」设置真的作用于生成画布，帮助浮层与实物一致 ─────────────
  // 设置页那个二选一（#832，2026-07-31 用户拍板）迁移后整条失效：滚轮恒缩放，选了没用，
  // 而帮助浮层还照着这个开关生成文案——说明书与实物不符（审计 ③ 表第 3 行）。
  // 这一段走真人路径：点设置 → 通用 → 点芯片 → 关掉 → 回画布滚轮。
  const modifierGlyph = process.platform === 'darwin' ? '⌘' : 'Ctrl'
  // 帮助浮层里的两条词（i18n generationCommon 的 shortcuts.wheelOrTwoFinger / modWheel）。
  const WHEEL_OR_TWO_FINGER = EN ? 'Wheel / two-finger' : '滚轮 / 双指滑'
  const WHEEL_WORD = EN ? 'wheel' : '滚轮'

  // 用过的项目里的卡是 apimart 模型生成的，隔离资料里没有它的 key，App 会挂一条常驻的「模型当前不可用」提醒
  // （警告类 toast 要手动关）。它浮在所有弹层之上，正好压住设置弹窗右上角的关闭钮——人会先点掉提醒再关弹窗，走查照做。
  // 每张挂过浮框的 apimart 卡各一条（图片、视频各一条就叠两层），关掉一条下一条会补上同一位置，所以逐条关到露出为止。
  async function clickPastToasts(locator) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const box = await locator.boundingBox()
      if (!box) break
      const toastClose = await getWin().evaluate(({ x, y }) => {
        const toast = document.elementFromPoint(x, y)?.closest('.mantine-Notification-root')
        const close = toast?.querySelector('.mantine-Notification-closeButton')
        const rect = close?.getBoundingClientRect()
        return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null
      }, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
      if (!toastClose) break
      await getWin().mouse.click(toastClose.x, toastClose.y)
      await getWin().waitForTimeout(300)
    }
    await locator.click()
  }

  async function chooseCanvasGesture(scheme) {
    const settingsName = EN ? 'Settings' : '设置'
    await getWin().getByRole('button', { name: settingsName, exact: true }).first().click()
    const dialog = getWin().getByRole('dialog', { name: settingsName, exact: true })
    await expect(dialog).toBeVisible()
    await dialog.locator('[data-settings-tab-id="general"]').click()
    const chip = dialog.locator(`[data-canvas-gesture-scheme="${scheme}"]`)
    await chip.click()
    await expect(chip).toHaveAttribute('aria-checked', 'true')
    await clickPastToasts(dialog.locator('[data-settings-close]'))
    await expect(dialog).toHaveCount(0)
    await getWin().waitForTimeout(360)
  }

  async function readControlsHelp(name) {
    // 用过的项目里有一批还没生成的卡，画布底部居中挂着批量生成栏；1280 宽、Agent 面板开着时画布只剩 ~800 宽，
    // 这条栏压在左下角缩放条上，「画布操作」那颗钮被它盖住点不到（已记为待修的布局问题，见方案「实测发现」）。
    // 人会先点栏上的 × 把它收起再去点帮助，走查照做；empty 夹具里没有这条栏，这一步什么都不做。
    const batchDockDismiss = getWin().getByRole('button', { name: EN ? 'Hide batch generation bar' : '隐藏批量生成栏', exact: true })
    if (await batchDockDismiss.isVisible()) {
      await batchDockDismiss.click()
      await expect(batchDockDismiss).toBeHidden()
    }
    await getWin().getByRole('button', { name: EN ? 'Canvas controls' : '画布操作', exact: true }).first().click()
    const panel = getWin().getByRole('dialog', { name: EN ? 'Canvas controls help' : '画布操作帮助', exact: true })
    await expect(panel).toBeVisible()
    await evidence(name)
    const text = (await panel.innerText()).replace(/\s+/g, ' ')
    await getWin().keyboard.press('Escape')
    await getWin().waitForTimeout(260)
    return text
  }

  await chooseCanvasGesture('modifier-zoom')
  const panSchemeHelp = await readControlsHelp('backfill-a-help-modifier-zoom.png')
  assert(
    panSchemeHelp.includes(WHEEL_OR_TWO_FINGER) && panSchemeHelp.includes(`${modifierGlyph} + ${WHEEL_WORD}`),
    '平移档的帮助浮层写着「滚轮/双指滑=平移、修饰键+滚轮=缩放」',
    panSchemeHelp.slice(0, 160),
  )

  const wheelPanPoint = await findBlankPoint()
  const beforeWheelPan = await readTransform()
  await getWin().mouse.move(wheelPanPoint.x, wheelPanPoint.y)
  await getWin().mouse.wheel(0, 240)
  await getWin().waitForTimeout(360)
  const afterWheelVerticalPan = await readTransform()
  assert(
    afterWheelVerticalPan.zoom === beforeWheelPan.zoom,
    '平移档：滚轮不再缩放画布（这正是设置失效时的症状）',
    `${beforeWheelPan.zoom.toFixed(3)} → ${afterWheelVerticalPan.zoom.toFixed(3)}`,
  )
  assert(
    Math.round(afterWheelVerticalPan.y - beforeWheelPan.y) <= -100,
    '平移档：滚轮纵向平移画布',
    `Δy=${Math.round(afterWheelVerticalPan.y - beforeWheelPan.y)}`,
  )
  await getWin().mouse.wheel(180, 0)
  await getWin().waitForTimeout(360)
  const afterWheelHorizontalPan = await readTransform()
  assert(
    Math.round(afterWheelHorizontalPan.x - afterWheelVerticalPan.x) <= -80,
    '平移档：横向滚动（触控板左右滑）横向平移画布',
    `Δx=${Math.round(afterWheelHorizontalPan.x - afterWheelVerticalPan.x)}`,
  )
  await getWin().keyboard.down(mod)
  await getWin().mouse.wheel(0, -240)
  await getWin().keyboard.up(mod)
  await getWin().waitForTimeout(360)
  const afterModifierZoom = await readTransform()
  assert(
    afterModifierZoom.zoom > afterWheelHorizontalPan.zoom,
    '平移档：修饰键+滚轮仍然缩放（真值表第二行，也是这一档唯一的缩放入口）',
    `${afterWheelHorizontalPan.zoom.toFixed(3)} → ${afterModifierZoom.zoom.toFixed(3)}`,
  )
  await snap('08-wheel-pan-scheme.png')

  // 2026-09-22 用户真机回归：平移档下 React Flow 把「平移结束」推迟 150ms，这期间点一下卡，
  // `data-dragging` 就永远摘不掉，浮框 / 浮条 / 版本托盘全部隐身（docs/fixes/2026-09-22-canvas-dragging-flag-outlives-gesture.root-cause.json）。
  // 本文件别处每次平移后都等 ≥260ms 才下一步，正好错过那 150ms——所以这里刻意「松手即点」。
  {
    await getWin().getByLabel(EN ? 'Fit view' : '适应视图', { exact: true }).first().click()
    await getWin().waitForTimeout(500)
    const panStart = await findBlankPoint()
    const target = await getWin().evaluate(() => {
      for (const node of document.querySelectorAll('.react-flow__node article[data-node-id]')) {
        const r = node.getBoundingClientRect()
        const x = r.left + r.width / 2
        const y = r.top + Math.min(24, r.height / 2)
        if (node.contains(document.elementFromPoint(x, y))) return { id: node.getAttribute('data-node-id'), x, y }
      }
      return null
    })
    assert(Boolean(target), '平移档：视口里有一张点得到的卡（松手即点的目标）', JSON.stringify(target))
    await getWin().mouse.move(panStart.x, panStart.y)
    await getWin().mouse.down()
    await getWin().mouse.move(panStart.x + 2, panStart.y + 1)
    await getWin().mouse.move(panStart.x + 40, panStart.y + 12, { steps: 6 })
    await getWin().mouse.up()
    const moved = await getWin().evaluate(({ id }) => {
      const node = document.querySelector(`article[data-node-id="${id}"]`)
      const r = node.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + Math.min(24, r.height / 2) }
    }, target)
    await getWin().mouse.move(moved.x, moved.y)
    await getWin().mouse.down()
    await getWin().waitForTimeout(60)
    await getWin().mouse.up()
    let dragging = 'unread'
    for (let i = 0; i < 20; i += 1) {
      dragging = await getWin().evaluate(() => document.querySelector('.generation-canvas-v2__stage')?.getAttribute('data-dragging') ?? null)
      if (dragging === null) break
      await getWin().waitForTimeout(100)
    }
    assert(dragging === null, '平移档：平移松手后 150ms 内点卡，画布不卡在拖动态（浮框/浮条/托盘不会隐身）', `data-dragging=${dragging}`)
  }

  await chooseCanvasGesture('wheel-zoom')
  const zoomSchemeHelp = await readControlsHelp('backfill-a-help-wheel-zoom.png')
  assert(
    !zoomSchemeHelp.includes(WHEEL_OR_TWO_FINGER),
    '缩放档的帮助浮层不再列「滚轮=平移」那一行（文案跟着实物走）',
    zoomSchemeHelp.slice(0, 160),
  )
  const wheelZoomPoint = await findBlankPoint()
  const beforeWheelZoom = await readTransform()
  await getWin().mouse.move(wheelZoomPoint.x, wheelZoomPoint.y)
  await getWin().mouse.wheel(0, -240)
  await getWin().waitForTimeout(360)
  const afterWheelZoom = await readTransform()
  assert(
    afterWheelZoom.zoom > beforeWheelZoom.zoom,
    '缩放档：滚轮照旧缩放画布（默认档没被这次回填改坏）',
    `${beforeWheelZoom.zoom.toFixed(3)} → ${afterWheelZoom.zoom.toFixed(3)}`,
  )
  await snap('09-wheel-zoom-scheme.png')

  assert(pageErrors.length === 0, '全程无页面错误', pageErrors.join(' | '))
  console.log(`\n✅ 画布手势走查通过：${passed} 项断言，截图在 ${shotsDir}`)
} catch (error) {
  await snap('99-failure.png').catch(() => {})
  console.error(`\n❌ ${error.message}`)
  process.exitCode = 1
} finally {
  await smoke.close()
}
