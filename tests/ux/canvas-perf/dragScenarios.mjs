import { findCanvasBlankPoint, findNodeHitPoint } from '../_canvasHit.mjs'
import { AUTO_PAN_SAFE_MARGIN_PX } from './gestureGeometry.mjs'

// New drag scenarios for eval v2 (U1). These are action runners layered on the
// existing benchmark harness: they reuse its mouse-driven drag mechanic but add
// the coverage the 2026-09-01 investigation showed was missing —
//   • variable-speed gesture (accelerate → fling → pause) instead of a too-clean
//     constant-velocity line (leg-b noted the straight line reads "too clean")
//   • multi-node-drag (N=8 selected) to expose the per-N amplification of the
//     off-canvas re-render + store-write cost (suspect #1/#7 scale with N)
//   • drag-at-low-zoom to measure the drag path under lightweight LOD, whose
//     trigger is nodeCount>80 AND zoom<0.55 (canvasNodeLevelOfDetail.ts:29-31)
//   • drag-over-dense-edges to drag a node through a high-edge-density band so
//     the per-move edge-path recompute is in the hot path
//
// Every runner returns actionDetails including { moves } and { firstFeedbackMs }
// so the advisory metrics module can amortize per move and compute action
// latency. `moves` is the count of pointer-move steps actually dispatched.

/**
 * Number of selected nodes for multi-node-drag. Fixed at 8 so the sample is
 * comparable across runs and the slope-vs-N story is legible next to the N=1
 * node-drag-image baseline.
 */
export const MULTI_DRAG_NODE_COUNT = 8

/** LOD trigger constants mirrored from canvasNodeLevelOfDetail.ts (kept in sync
 * by the guard test dragScenarios.test.mjs, which imports the source values). */
export const LIGHTWEIGHT_ZOOM_CEILING = 0.55

function sleep(page, ms) {
  return page.waitForTimeout(ms)
}

/**
 * Variable-speed drag: three phases over `totalSteps` — slow accelerate, fast
 * fling, then a held pause at the end (no movement, cursor down). Interval per
 * step is short during the fling and longer during accel/pause, so the harness
 * exercises burst-rate mousemoves (where合帧 would matter most) rather than an
 * even cadence. Returns the number of move events dispatched.
 *
 * @param {import('playwright').Page} page
 * @param {{x:number,y:number}} start
 * @param {{x:number,y:number}} end
 */
export async function variableSpeedDragPath(page, start, end) {
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  let moves = 0
  const dx = end.x - start.x
  const dy = end.y - start.y
  // Phase weights: how far along the path each phase reaches, and cadence (ms).
  const phases = [
    { toRatio: 0.25, steps: 12, interval: 24 }, // slow accelerate
    { toRatio: 1.0, steps: 10, interval: 6 }, // fast fling (burst)
  ]
  let fromRatio = 0
  for (const phase of phases) {
    for (let i = 1; i <= phase.steps; i += 1) {
      const local = i / phase.steps
      const ratio = fromRatio + (phase.toRatio - fromRatio) * local
      await page.mouse.move(start.x + dx * ratio, start.y + dy * ratio, { steps: 1 })
      moves += 1
      if (phase.interval > 0) await sleep(page, phase.interval)
    }
    fromRatio = phase.toRatio
  }
  // Held pause at the end: cursor stays down, no movement, ~180ms — reproduces
  // the "stop dead at the drop point" beat where a late commit shows as a hitch.
  await sleep(page, 180)
  await page.mouse.up()
  return moves
}

/**
 * Find the first mounted node of a kind with a usable bounding box.
 * @param {import('playwright').Page} page
 */
async function firstNodeBox(page, kind) {
  const candidates = page.locator(`.generation-canvas-v2-node[data-kind="${kind}"]`)
  const count = await candidates.count()
  for (let index = 0; index < count; index += 1) {
    const box = await candidates.nth(index).boundingBox().catch(() => null)
    if (box && box.width > 20 && box.height > 20) return { locator: candidates.nth(index), box }
  }
  return null
}

/**
 * Read the first stage/edge mutation timestamp captured by the benchmark probe,
 * relative to when the probe was started. When the probe is started immediately
 * before the drag, this is the pointerdown→first-visual-feedback latency.
 * Returns null if the probe reported no mutation.
 * @param {import('playwright').Page} page
 */
async function readFirstFeedbackMs(page) {
  return page.evaluate(() => {
    const probe = window.__canvasPerformanceProbe
    const rec = probe && probe._record
    return rec && rec.firstMutationMs != null ? rec.firstMutationMs : null
  })
}

/**
 * Is a node box safely clickable for selection: fully inside the stage and clear
 * of the minimap (bottom-right) so the shift-click lands on the card, not an
 * overlay. Probed ground truth: nodes hugging the right stage edge (x≈1454 in a
 * 1600px stage) or under the minimap don't register the click.
 */
function isSafelyClickable(box, stage) {
  const margin = 8
  const insideStage =
    box.x >= stage.x + margin &&
    box.y >= stage.y + margin &&
    box.x + box.width * 0.5 <= stage.x + stage.width - margin &&
    box.y + 20 <= stage.y + stage.height - margin
  // Keep clear of the bottom-right minimap zone (~220x160 inset).
  const clickX = box.x + box.width * 0.45
  const clickY = box.y + 14
  const nearMinimap = clickX > stage.x + stage.width - 240 && clickY > stage.y + stage.height - 180
  return insideStage && !nearMinimap
}

/**
 * multi-node-drag: shift-click N safely-clickable nodes to select them, then
 * drag the primary. React Flow emits a position change per selected node each
 * tick → N store writes/tick (leg-b §9 "multi-select path"). Each requested
 * card is hit-tested immediately before the click, so newly visible controls
 * cannot turn selection into a different action. Returns actionDetails with
 * the realized selection count and move count.
 * @param {import('playwright').Page} page
 */
export async function runMultiNodeDrag(page) {
  const stage = await page.locator('.generation-canvas-v2__stage').boundingBox()
  if (!stage) throw new Error('画布 stage 不存在')
  const nodes = page.locator('.generation-canvas-v2-node')
  const total = await nodes.count()
  const picks = []
  for (let index = 0; index < total && picks.length < MULTI_DRAG_NODE_COUNT; index += 1) {
    const box = await nodes.nth(index).boundingBox().catch(() => null)
    if (box && box.width > 20 && box.height > 20 && isSafelyClickable(box, stage)) {
      picks.push({ locator: nodes.nth(index), box })
    }
  }
  if (picks.length < 2) throw new Error(`multi-node-drag 需要至少 2 个可安全点击的节点，仅有 ${picks.length}`)
  await page.keyboard.down('Shift')
  try {
    for (const pick of picks) {
      const nodeId = await pick.locator.getAttribute('data-node-id')
      const hit = await findNodeHitPoint(page, { nodeSelector: `.generation-canvas-v2-node[data-node-id=${JSON.stringify(nodeId)}]` })
      if (!hit) throw new Error(`multi-node-drag: no selectable point for ${nodeId}`)
      await page.mouse.click(hit.x, hit.y)
      await sleep(page, 40)
    }
  } finally {
    await page.keyboard.up('Shift')
  }
  await sleep(page, 120)
  const selected = await page.locator('.generation-canvas-v2-node[data-selected="true"]').count()
  // Drag the primary (first pick) with a variable-speed gesture; the rest follow.
  const primary = picks[0]
  const primaryId = await primary.locator.getAttribute('data-node-id')
  const start = await findNodeHitPoint(page, { nodeSelector: `.generation-canvas-v2-node[data-node-id=${JSON.stringify(primaryId)}]` })
  if (!start) throw new Error(`multi-node-drag: no draggable point for ${primaryId}`)
  const moves = await variableSpeedDragPath(page, start, { x: start.x + 150, y: start.y + 80 })
  return {
    selected,
    requested: picks.length,
    moves,
    firstFeedbackMs: await readFirstFeedbackMs(page),
    nodeId: await primary.locator.getAttribute('data-node-id'),
  }
}

/**
 * drag-at-low-zoom: assumes the caller has already zoomed the canvas below the
 * lightweight ceiling AND the fixture has >80 nodes (only then does LOD engage;
 * S=48 will NOT — see note in the harness wiring, which pairs this scenario with
 * a scale that crosses the threshold). We drag a lightweight (non-selected)
 * node and record whether lightweight rendering was actually in effect so the
 * result is self-describing rather than silently measuring full-content drag.
 * @param {import('playwright').Page} page
 */
export async function runDragAtLowZoom(page) {
  const zoom = await page.evaluate(
    () => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.generation-canvas-v2__canvas')).transform).a,
  )
  const lightweightMounted = await page.locator('.generation-canvas-v2-node[data-render-mode="lightweight"]').count()
  const node = (await firstNodeBox(page, 'image')) || (await firstNodeBox(page, 'video'))
  if (!node) throw new Error('drag-at-low-zoom 没有可见节点可拖')
  const start = { x: node.box.x + node.box.width * 0.5, y: node.box.y + 10 }
  const moves = await variableSpeedDragPath(page, start, { x: start.x + 120, y: start.y + 70 })
  return {
    zoom: Math.round(zoom * 1000) / 1000,
    lightweightMounted,
    lightweightActive: lightweightMounted > 0 && zoom < LIGHTWEIGHT_ZOOM_CEILING,
    moves,
    firstFeedbackMs: await readFirstFeedbackMs(page),
    nodeId: await node.locator.getAttribute('data-node-id'),
  }
}

/**
 * Rank node ids by edge degree from a fixture edge list. RF edge DOM only
 * carries data-testid="rf__edge-<edgeId>" (endpoints are not on the DOM), so we
 * derive degree from the fixture the harness already passes into runAction
 * rather than trying to read it back from the page.
 * @param {ReadonlyArray<{source:string,target:string}>} edges
 * @returns {Array<[string, number]>} [nodeId, degree] sorted desc
 */
export function rankNodesByDegree(edges) {
  const degree = new Map()
  for (const edge of edges || []) {
    if (edge?.source) degree.set(edge.source, (degree.get(edge.source) || 0) + 1)
    if (edge?.target) degree.set(edge.target, (degree.get(edge.target) || 0) + 1)
  }
  return [...degree.entries()].sort((a, b) => b[1] - a[1])
}

/**
 * drag-over-dense-edges: drag the highest edge-degree node that is currently
 * mounted, so every tick recomputes the path of the maximum number of connected
 * edges (adapter resolveHandleIds by geometry). Degree comes from the fixture
 * edge list; density actually exercised is recorded on the sample.
 * @param {import('playwright').Page} page
 * @param {ReadonlyArray<{source:string,target:string}>} fixtureEdges
 */
export async function runDragOverDenseEdges(page, fixtureEdges) {
  const ranked = rankNodesByDegree(fixtureEdges)
  if (!ranked.length) throw new Error('drag-over-dense-edges 夹具没有边')
  const renderedEdges = await page.locator('.react-flow__edge').count()
  // Walk from highest degree down to the first node that is mounted with a box.
  for (const [nodeId, degree] of ranked) {
    const box = await page
      .locator(`.react-flow__node[data-id="${nodeId}"]`)
      .boundingBox()
      .catch(() => null)
    if (box && box.width > 20 && box.height > 20) {
      const start = { x: box.x + box.width * 0.45, y: box.y + 14 }
      const moves = await variableSpeedDragPath(page, start, { x: start.x + 150, y: start.y + 85 })
      return { nodeId, connectedEdges: degree, renderedEdges, moves, firstFeedbackMs: await readFirstFeedbackMs(page) }
    }
  }
  throw new Error('drag-over-dense-edges 高连边节点都未挂载，无法拖动')
}

/**
 * Zoom the canvas out toward a target zoom by wheeling at stage center, so a
 * low-zoom drag scenario can engage lightweight LOD. Mirrors the harness's own
 * prepareScenario wheel loop. Returns the achieved zoom.
 * @param {import('playwright').Page} page
 * @param {number} targetZoom
 */
export async function zoomOutTo(page, targetZoom) {
  const stage = await page.locator('.generation-canvas-v2__stage').boundingBox()
  if (!stage) throw new Error('画布 stage 不存在')
  await page.mouse.move(stage.x + stage.width * 0.5, stage.y + stage.height * 0.5)
  for (let index = 0; index < 30; index += 1) {
    const zoom = await page.evaluate(
      () => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.generation-canvas-v2__canvas')).transform).a,
    )
    if (zoom <= targetZoom) break
    await page.mouse.wheel(0, 120)
    await sleep(page, 40)
  }
  await sleep(page, 400)
  return page.evaluate(
    () => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.generation-canvas-v2__canvas')).transform).a,
  )
}

// ————————————————————————————————————————————————————————————————————————
// 2026-09-12 规模调查补的三条场景（docs/research/2026-09-12-canvas-perf-at-scale/）。
//
// 为什么非加不可：既有门岗的场景表里**没有任何一条**「全选后拖」或「拖组框」——
// `grep -rn "nodesselection\|groupFrame\|group-frame\|frame-drag"` 在 2026-09-12 零命中。
// 于是用户实际报的两个最卡的手势（全选 300 张后拖 = 12.4 fps；拖组框 = 60 fps 天花板）
// 卡了多久都不会让 CI 变红。缩放滑杆同理。R17：先把场景加进来让它当场红，再动代码。
//
// 手势必须与调研 harness（tests/perf/canvas-scale-bench.mjs）**逐项一致**——
// 同样的 2 秒匀速圆弧、同样的半径、同样的滑杆来回一周期——否则 §6 那张预算表里的
// 每一个数字都不再可追溯到它被量出来的那次手势。
// ————————————————————————————————————————————————————————————————————————

/** 圆弧拖动半径。抓手离舞台四边至少这么远，否则拖到边上会触发 React Flow 的自动平移。 */
export const SCALE_DRAG_ARC_RADIUS_PX = 90
/** 组框场景先框选多少张卡再建组（与调研 harness 的 drag-group-frame-60 同名同数）。 */
export const GROUP_FRAME_NODE_COUNT = 60

/** 抓手可用区：把整条圆弧连同自动平移安全边一起留出来，右下角另扣 minimap 与底部停靠。 */
function grabSafeArea(stage) {
  const edge = AUTO_PAN_SAFE_MARGIN_PX + SCALE_DRAG_ARC_RADIUS_PX + 12
  return {
    minX: stage.x + edge,
    maxX: stage.x + stage.width - Math.max(edge, 250),
    minY: stage.y + edge,
    maxY: stage.y + stage.height - Math.max(edge, 210),
  }
}

async function stageBox(page) {
  const box = await page.locator('.generation-canvas-v2__stage').boundingBox()
  if (!box) throw new Error('画布 stage 不存在')
  return box
}

/**
 * 用**真实的「适应视图」按钮**把全部节点收进视口——用户看一大批图时就是这么干的。
 *
 * 必须验结果不能只点一下：负载高时按钮可能在 React 接上 onClick 之前就被点到，
 * 点击静默丢失、视口停在 zoom≈1，于是「视口里只挂了 9 个节点」，看着像画布 bug，
 * 其实是前置条件没成立。这类假前提比测出一个坏数字更坏。
 */
export async function fitCanvasView(page, { expectZoomBelow = 0.9 } = {}) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.getByLabel('适应视图').first().click()
    await sleep(page, 800)
    const zoom = await readCanvasZoom(page)
    if (zoom !== null && zoom < expectZoomBelow) return zoom
  }
  return readCanvasZoom(page)
}

async function readCanvasZoom(page) {
  return page.evaluate(() => {
    const viewport = document.querySelector('.react-flow__viewport')
    if (!viewport) return null
    return Math.round(new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a * 1000) / 1000
  })
}

async function selectedNodeCount(page) {
  return page.evaluate(() => document.querySelectorAll('.react-flow__node.selected').length)
}

/**
 * 真实框选：在**空白 pane** 上按住 Shift 按下、拖一个矩形、松手。
 * Shift 是必须的——React Flow 的 selectionOnDrag 只在 Shift 下起框（不按 Shift 是平移画布）。
 */
async function marqueeRect(page, { toY = null } = {}) {
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
  const steps = 24
  for (let index = 1; index <= steps; index += 1) {
    await page.mouse.move(
      start.x + ((end.x - start.x) * index) / steps,
      start.y + ((end.y - start.y) * index) / steps,
      { steps: 1 },
    )
    await sleep(page, 12)
  }
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await sleep(page, 300)
}

/** 全选（Cmd/Ctrl+A）。前置动作，不进采样窗口。 */
export async function selectAllCanvasNodes(page) {
  await page.locator('.generation-canvas-v2__stage').click({ position: { x: 6, y: 6 } }).catch(() => {})
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
  await sleep(page, 500)
  return selectedNodeCount(page)
}

/**
 * 框选约 count 个节点：按住 Shift 逐个点太慢（N=300 要点 300 下，屏外的还点不到），
 * 所以框一个「刚好盖住前 count 个」的矩形——按 y 再按 x 排序取第 count 个的下沿当底边。
 */
export async function marqueeSelectFirstNodes(page, count) {
  const boxes = await page.evaluate(() => Array.from(document.querySelectorAll('.react-flow__node'))
    .map((element) => {
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
    })
    .sort((a, b) => (a.y - b.y) || (a.x - b.x)))
  // 小规模（scale S/M）或窗口被夹小时挂不满 60 个。这时**降量但如实报**，不静默按 60 记账：
  // 返回 requested / realized 两个数，读结果的人一眼看得出这一格量的是几张卡。少于 8 张就没有
  // 「一批卡一起动」可言了，那时才 fail-closed —— 出一个不可比的数比报错更坏。
  const realized = Math.min(count, boxes.length)
  if (realized < 8) {
    throw new Error(`视口内只挂了 ${boxes.length} 个节点，凑不出一批（至少 8）—— 先确认 scale 与「适应视图」生效`)
  }
  const target = boxes[realized - 1]
  await marqueeRect(page, { toY: target.y + target.h * 0.55 })
  return { requested: count, realized, selected: await selectedNodeCount(page) }
}

/** 把已选中的一批卡建成组（Cmd/Ctrl+G），返回画布上组框的个数。 */
export async function groupSelectedNodes(page) {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+g' : 'Control+g')
  await sleep(page, 600)
  return page.evaluate(() => document.querySelectorAll('.generation-canvas-v2__group-box[data-group-id]').length)
}

/**
 * 多选之后 React Flow 会在选中集上盖一层 `.react-flow__nodesselection-rect`——
 * **用户真正抓到的就是它**（鼠标落在卡片上，命中的却是这层）。所以这里不强求命中节点本体，
 * 而是如实报命中的是谁：`nodesselection-rect` 走 RF 自己的 XYDrag 把位移扇给全部选中节点。
 */
async function selectionGrabPoint(page) {
  const stage = await stageBox(page)
  return page.evaluate(({ area }) => {
    const inSafeArea = (x, y) => x >= area.minX && x <= area.maxX && y >= area.minY && y <= area.maxY
    const overlay = document.querySelector('.react-flow__nodesselection-rect')
    if (overlay) {
      const rect = overlay.getBoundingClientRect()
      // 选中一大批时这层罩子比安全区还大，按固定比例取点会全落在安全区外；求交后在交集里扫。
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
    return null
  }, { area: grabSafeArea(stage) })
}

/**
 * 组框本体上能按下去的一点。组框画在卡片**下面**，只有三处露出来：顶部标签条、
 * 四周内边距环、卡片之间的空隙。所以按屏幕像素密扫整个框，第一个命中框本体的点就用它；
 * 扫不到要说清楚被谁挡了（静默跳过会让整格空着，看起来像「这条测过了」）。
 */
async function groupFrameGrabPoint(page) {
  const stage = await stageBox(page)
  return page.evaluate(({ area }) => {
    const frame = document.querySelector('.generation-canvas-v2__group-box[data-group-id]')
    if (!frame) return null
    const rect = frame.getBoundingClientRect()
    const blockers = new Map()
    const step = 8
    for (let y = rect.top + 3; y <= rect.bottom - 3; y += step) {
      for (let x = rect.left + 3; x <= rect.right - 3; x += step) {
        if (x < area.minX || x > area.maxX || y < area.minY || y > area.maxY) continue
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

/** 2 秒匀速圆弧拖动：真手不走直线，圆弧还保证不撞舞台边（撞边触发自动平移，是另一族现象）。 */
async function arcDrag(page, origin, { radius = SCALE_DRAG_ARC_RADIUS_PX, durationMs = 2000, stepMs = 8 } = {}) {
  await page.mouse.move(origin.x, origin.y)
  await page.mouse.down()
  await sleep(page, 60)
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
  await page.mouse.up()
  await sleep(page, 200)
  return steps
}

/**
 * drag-nodes-all：全选之后抓住 React Flow 盖上来的选区罩子拖一个整圆。
 * 这是调研量到的**全局最坏格**（I300：12.4 fps / p95 251 ms / 251 次长任务）。
 * 选中动作在 prepareScenario 里做完，这里只跑被采样的那段手势。
 */
export async function runDragSelectionAll(page) {
  const selected = await selectedNodeCount(page)
  if (selected < 2) throw new Error(`drag-nodes-all: 只选中了 ${selected} 个节点，前置全选没生效`)
  const grab = await selectionGrabPoint(page)
  if (!grab) throw new Error('drag-nodes-all: 选中集上找不到可按下的抓手')
  const moves = await arcDrag(page, grab)
  return { selected, moves, via: grab.via, firstFeedbackMs: await readFirstFeedbackMs(page) }
}

/**
 * drag-group-frame-60：抓**组框本体**（不是卡、不是选区罩子）拖同样的整圆。
 * 这条走的是我们手搓的 window pointermove + rAF，每帧替换整个 Zustand nodes 数组。
 */
export async function runDragGroupFrame(page, grouped = null) {
  const grab = await groupFrameGrabPoint(page)
  if (!grab) throw new Error('drag-group-frame-60: 画布上没有组框')
  if (grab.blocked) throw new Error(`drag-group-frame-60: ${grab.via}`)
  const moves = await arcDrag(page, grab)
  return { ...(grouped || {}), moves, via: grab.via, firstFeedbackMs: await readFirstFeedbackMs(page) }
}

/**
 * zoom-slider-drag：右下角缩放滑杆来回拖一个正弦周期。滑杆本身就是连续输入，
 * 每个 change 起一段过渡就会互相打断——这条量的就是「拖滑杆一顿一顿」。
 */
export async function runZoomSliderDrag(page) {
  const slider = page.locator('.generation-canvas-v2__stage input[type="range"]').first()
  if (!(await slider.count())) throw new Error('zoom-slider-drag: 找不到缩放滑杆')
  const box = await slider.boundingBox()
  if (!box) throw new Error('zoom-slider-drag: 缩放滑杆不可见')
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + box.width * 0.5, y)
  await page.mouse.down()
  const steps = 90
  for (let index = 1; index <= steps; index += 1) {
    const ratio = 0.5 + Math.sin((index / steps) * Math.PI * 2) * 0.42
    await page.mouse.move(box.x + box.width * ratio, y, { steps: 1 })
    await sleep(page, 18)
  }
  await page.mouse.up()
  await sleep(page, 200)
  return { moves: steps, zoom: await readCanvasZoom(page), firstFeedbackMs: await readFirstFeedbackMs(page) }
}
