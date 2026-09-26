import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'

// 画布命中几何的**单一 owner**：「哪儿是空白」「连线上哪个点真的点得到」。
//
// 为什么要有这个文件（2026-09-05）：此前六份走查各抄了一份 `findBlankPoint`，
// 判据都是「命中元素不在这串黑名单里」——`.generation-canvas-v2-node, ... , button, ...`。
// 黑名单是**枚举**，每加一层新浮层就少写一条，而少写的那条不会报错，只会在某个
// 窗口尺寸下静默把「浮层上的一点」当成空白，于是「点空白取消选中」落到浮层上被吞。
// 常驻 Agent 面板默认展开把 stage 从 ~1540 收到 ~1200 之后，六份黑名单同时暴露：
// 扫到的第一个候选点正好落在 React Flow 的磁性连接句柄命中区
// （`.generation-canvas-react-flow__handle-hit`，它挂在 `.react-flow__node` 下、
// 但**不在** `.generation-canvas-v2-node` 里，所以每一份黑名单都放它过）。
//
// 所以这里换成**白名单**：空白 = React Flow 自己的 pane 就是那一点的最顶层元素。
// pane 是生产代码里真正接收空白手势的那一层（平移/框选/取消选中都由它派发），
// 任何浮层——节点、句柄、编组框、工具条、缩略图——盖在它上面就自动不算空白，
// 不需要有人记得去补名单。找不到就返回 null，调用方 fail-closed 报错，不猜。
//
// 现状（诚实标注）：`findCanvasBlankPoint` 已收编全部 6 处空白扫描；
// `findEdgeHitPoint` 目前只有 `canvas-card-stack.walk.mjs` 一个调用方，
// `group-reference-direction.walk.mjs` 与 `clip-node-editing.walk.mjs` 里
// 两份同形状的内联实现（它们本身是对的）另行折叠，别再抄第四份。
export const CANVAS_STAGE_SELECTOR = '.generation-canvas-v2__stage'
export const CANVAS_PANE_SELECTOR = '.react-flow__pane'
export const CANVAS_EDGE_HIT_SELECTOR = '.generation-canvas-v2__edge-hit'
/** 画布上那个框（Frame）的框体本身——`GroupFrame` 渲染出来的那个绝对定位 div。 */
export const CANVAS_FRAME_SELECTOR = '.generation-canvas-v2__group-box[data-group-id]'

// 扫描顺序按用途分档：三档只影响「先试哪儿」，判据是同一个。
const SCAN_RATIOS = {
  default: {
    rows: [0.2, 0.28, 0.36, 0.45, 0.5, 0.6, 0.64, 0.72, 0.76, 0.85, 0.88, 0.12],
    columns: [0.62, 0.7, 0.78, 0.86, 0.93, 0.55, 0.54, 0.45, 0.42, 0.35, 0.3, 0.2, 0.12, 0.06],
  },
  bottom: {
    rows: [0.88, 0.78, 0.68, 0.58, 0.48, 0.38, 0.28, 0.18, 0.1],
    columns: [0.62, 0.7, 0.78, 0.86, 0.93, 0.54, 0.42, 0.3, 0.2, 0.12, 0.06],
  },
  'top-left': {
    rows: [0.03, 0.08, 0.14, 0.2, 0.28, 0.4, 0.56, 0.72, 0.88],
    columns: [0.03, 0.08, 0.14, 0.2, 0.28, 0.4, 0.56, 0.72, 0.88],
  },
}

/**
 * 找一块**真·空白**：stage 内第一个「最顶层元素就是 React Flow pane」的点。
 *
 * `inset` 把扫描范围从 stage 四边各往内缩这么多像素。它存在的唯一理由是
 * React Flow 的自动平移带（`calcAutoPan` 默认 40px）：手势起点落在带内，
 * 视口就会按帧率自动平移，手势扫过的区域随之变成不可复现的量
 * （见 tests/ux/canvas-perf/gestureGeometry.mjs 的完整根因注释）。
 * 默认 0 = 保持原行为，只有需要「起点必须可复现」的调用方才传。
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ preference?: 'default' | 'bottom' | 'top-left', inset?: number }} [options]
 * @returns {Promise<{ x: number, y: number } | null>} 屏幕坐标；找不到返回 null（调用方须 fail-closed）
 */
export async function findCanvasBlankPoint(page, { preference = 'default', inset = 0 } = {}) {
  const ratios = SCAN_RATIOS[preference]
  if (!ratios) throw new Error(`findCanvasBlankPoint: 未知 preference「${preference}」`)
  if (!Number.isFinite(inset) || inset < 0) {
    throw new Error(`findCanvasBlankPoint: inset 必须是非负有限数，收到 ${JSON.stringify(inset)}`)
  }
  return page.evaluate(
    ({ rows, columns, stageSelector, paneSelector, inset: insetPx }) => {
      const stage = document.querySelector(stageSelector)
      if (!stage) return null
      const full = stage.getBoundingClientRect()
      // 缩到装不下就直接返回 null，让调用方 fail-closed——缩过头再扫等于扫了个空矩形，
      // 却会安静地退化成「这一屏没有空白」，把配置错误伪装成环境问题。
      if (full.width - insetPx * 2 <= 0 || full.height - insetPx * 2 <= 0) return null
      const rect = {
        left: full.left + insetPx,
        top: full.top + insetPx,
        right: full.right - insetPx,
        bottom: full.bottom - insetPx,
        width: full.width - insetPx * 2,
        height: full.height - insetPx * 2,
      }
      // 空白判据：那一点的最顶层元素**就是** pane 本身。
      // 用 `matches` 而不是 `closest`——`closest` 会把「pane 的后代浮层」也算进来，
      // 那就又变回黑名单了。
      const isBlank = (x, y) => {
        const hit = document.elementFromPoint(x, y)
        return Boolean(hit && stage.contains(hit) && hit.matches(paneSelector))
      }
      for (const ry of rows) {
        for (const rx of columns) {
          const x = Math.round(rect.left + rect.width * rx)
          const y = Math.round(rect.top + rect.height * ry)
          if (isBlank(x, y)) return { x, y }
        }
      }
      // 比例网格全被浮层占了就退化成密扫：窄画布下比例点更容易连片撞上节点，
      // 密扫仍找不到才是真的「这一屏没有空白」。
      for (let y = Math.ceil(rect.top + 8); y < rect.bottom - 8; y += 24) {
        for (let x = Math.ceil(rect.left + 8); x < rect.right - 8; x += 24) {
          if (isBlank(x, y)) return { x, y }
        }
      }
      return null
    },
    {
      rows: ratios.rows,
      columns: ratios.columns,
      stageSelector: CANVAS_STAGE_SELECTOR,
      paneSelector: CANVAS_PANE_SELECTOR,
      inset,
    },
  )
}

/**
 * 找一块**真·空白的矩形**——画框工具要的不是一个点，是一整片没被任何东西盖住的地方。
 *
 * 判据与 `findCanvasBlankPoint` 是同一条（最顶层元素就是 pane），只是要对候选矩形的
 * 四角 + 中心五点同时成立。为什么不复用「找一个点再往外撑」：撑出去的那一半没人验过，
 * 于是框会从某个节点身上画过去——手势本身照常完成、断言照常绿，只是框里凭空多了个成员。
 *
 * `inset` 同 `findCanvasBlankPoint`：躲开 React Flow 的自动平移带（默认 40px），
 * 否则起点落在带里、视口按帧率自己跑，画出来的框每次大小都不一样。
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ width: number, height: number, inset?: number }} options 期望的矩形尺寸（屏幕像素）
 * @returns {Promise<{ x: number, y: number, width: number, height: number } | null>} 找不到返回 null（调用方须 fail-closed）
 */
export async function findCanvasBlankRect(page, { width, height, inset = 48 }) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`findCanvasBlankRect: width/height 必须是正有限数，收到 ${width}×${height}`)
  }
  return page.evaluate(
    ({ stageSelector, paneSelector, want, insetPx }) => {
      const stage = document.querySelector(stageSelector)
      if (!stage) return null
      const full = stage.getBoundingClientRect()
      const rect = {
        left: full.left + insetPx,
        top: full.top + insetPx,
        right: full.right - insetPx,
        bottom: full.bottom - insetPx,
      }
      if (rect.right - rect.left < want.width || rect.bottom - rect.top < want.height) return null
      const isBlank = (x, y) => {
        const hit = document.elementFromPoint(x, y)
        return Boolean(hit && stage.contains(hit) && hit.matches(paneSelector))
      }
      const fits = (x, y) =>
        isBlank(x, y) &&
        isBlank(x + want.width, y) &&
        isBlank(x, y + want.height) &&
        isBlank(x + want.width, y + want.height) &&
        isBlank(x + want.width / 2, y + want.height / 2)
      // 从下往上、从右往左扫：新建的节点默认落在画布左上偏中，下方与右侧最可能整片空着。
      for (let y = rect.bottom - want.height; y >= rect.top; y -= 16) {
        for (let x = rect.right - want.width; x >= rect.left; x -= 16) {
          if (fits(x, y)) return { x, y, width: want.width, height: want.height }
        }
      }
      return null
    },
    {
      stageSelector: CANVAS_STAGE_SELECTOR,
      paneSelector: CANVAS_PANE_SELECTOR,
      want: { width, height },
      insetPx: inset,
    },
  )
}

/**
 * 找连线上**真的点得到**的那个点：沿路径取样，返回第一个「最顶层元素就是这条命中路径」的屏幕点。
 *
 * 为什么不能直接 `locator.click()`：Playwright 点的是元素外接盒的中心，而贝塞尔曲线的
 * 外接盒中心**不在曲线上**——那儿多半是空白，也可能压着别的浮层（2026-09-05 卡片堆叠走查
 * 就是被选中节点的提示词面板挡住外接盒中心，报 "subtree intercepts pointer events"）。
 * 用户点的是线本身，所以走查也该点线本身。
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ edgeSelector?: string, withinSelector?: string | null, margins?: { left?: number, top?: number, right?: number, bottom?: number } }} [options]
 * @returns {Promise<{ x: number, y: number } | null>}
 */
export async function findEdgeHitPoint(
  page,
  { edgeSelector = CANVAS_EDGE_HIT_SELECTOR, withinSelector = null, margins = {} } = {},
) {
  return page.evaluate(
    ({ selector, within, margin }) => {
      const bounds = within ? document.querySelector(within)?.getBoundingClientRect() : null
      if (within && !bounds) return null
      for (const path of Array.from(document.querySelectorAll(selector))) {
        const matrix = path.getScreenCTM?.()
        const total = path.getTotalLength?.()
        if (!matrix || !total) continue
        for (let step = 1; step <= 99; step += 1) {
          const local = path.getPointAtLength((total * step) / 100)
          const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix)
          if (
            screen.x < margin.left ||
            screen.y < margin.top ||
            screen.x > window.innerWidth - margin.right ||
            screen.y > window.innerHeight - margin.bottom
          )
            continue
          if (bounds && (screen.x < bounds.left || screen.x > bounds.right || screen.y < bounds.top || screen.y > bounds.bottom))
            continue
          if (document.elementFromPoint(screen.x, screen.y) === path) return { x: screen.x, y: screen.y }
        }
      }
      return null
    },
    {
      selector: edgeSelector,
      within: withinSelector,
      margin: { left: 0, top: 0, right: 0, bottom: 0, ...margins },
    },
  )
}

/**
 * 找这张卡上**真的点得到**的那一点：在卡的外接盒里按比例取样，返回第一个
 * 「最顶层元素就在这张卡里、且不是卡上的按钮」的屏幕点。
 *
 * 为什么不能 `locator.click({ position: { x: 20, y: 10 } })`：角上的固定偏移是拿某个
 * 窗口宽度校准出来的。常驻 Agent 面板把 stage 压到 ~880 宽之后（CI 的 Linux runner 会把
 * 窗口夹到 1280，走查里的 resize(1600, 1000) 静默不生效），平移过的卡片左上角会滑到
 * 左侧竖排工具条底下或干脆出了 stage 裁切——Playwright 只会报
 * "html intercepts pointer events"，看着像「点不动」，其实是舞台没那么宽。
 * 用户点的是卡片本体，所以走查也该找卡片本体上还露着的那一点。
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ nodeSelector: string, withinSelector?: string | null }} options
 * @returns {Promise<{ x: number, y: number } | null>} 找不到返回 null（调用方须 fail-closed）
 */
export async function findNodeHitPoint(page, { nodeSelector, withinSelector = CANVAS_STAGE_SELECTOR }) {
  return findElementHitPoint(page, {
    selector: nodeSelector,
    withinSelector,
    allowInteractive: false,
  })
}

/**
 * 找任意画布内元素上真正可点击的点。内部时间轴的片段、标尺和拖动把手
 * 会被常驻 Agent 面板部分覆盖；固定盒子中心会把 overlay 命中误报成产品回归。
 * 判据仍是白名单：最顶层元素必须属于目标元素本身。
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ selector: string, withinSelector?: string | null, allowInteractive?: boolean }} options
 * @returns {Promise<{ x: number, y: number } | null>}
 */
export async function findElementHitPoint(page, { selector, withinSelector = null, allowInteractive = true }) {
  return page.evaluate(({ selector: targetSelector, within, allow }) => {
    const target = document.querySelector(targetSelector)
    const bounds = within ? document.querySelector(within)?.getBoundingClientRect() : null
    if (!target || (within && !bounds)) return null
    const rect = target.getBoundingClientRect()
    const ratios = [0.12, 0.2, 0.3, 0.42, 0.5, 0.58, 0.7, 0.8, 0.88]
    for (const ratioY of ratios) {
      for (const ratioX of ratios) {
        const x = rect.left + rect.width * ratioX
        const y = rect.top + rect.height * ratioY
        if (bounds && (x < bounds.left + 1 || x > bounds.right - 1 || y < bounds.top + 1 || y > bounds.bottom - 1)) continue
        const hit = document.elementFromPoint(x, y)
        if (!hit || !target.contains(hit)) continue
        if (!allow && hit.closest('button, a, input, textarea, [role="button"]')) continue
        return { x, y }
      }
    }
    return null
  }, { selector, within: withinSelector, allow: allowInteractive })
}

/**
 * 找「从这张卡起一条线」时**人按下去的那一点**：起线把手上露出来的那颗图标
 * （磁吸档 = 卡外常驻的「+」圈；小圆点档 = 骑在卡边上的圆点）的中心，且那一点的最顶层元素
 * 必须归这个把手（`hit.closest(handle) === handle`）。
 *
 * 为什么不按 React Flow 把手元素自己的盒子中心按：那个盒子是 1px 的**测量锚点**，
 * 中心恰好压在卡边上。卡面和把手谁在上、卡边那条线的亚像素归谁，是两件和「人能不能起线」
 * 无关的事——2026-09-22 两条走查就是按在这条缝上：左侧把手的缝归卡（确定性红），
 * 右侧把手的缝在 Linux 字体度量下偶尔归卡（只在 CI 红）。人按的是看得见的图标。
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ handleSelector: string }} options 选到**一个**起线把手（`.generation-canvas-react-flow__handle--source[...]`）
 * @returns {Promise<{ x: number, y: number, affordance: string | null } | null>} 找不到返回 null（调用方须 fail-closed）
 */
export async function findConnectionStartPoint(page, { handleSelector }) {
  return page.evaluate((selector) => {
    const handle = document.querySelector(selector)
    const icon = handle?.querySelector('.generation-canvas-react-flow__handle-icon')
    if (!handle || !icon) return null
    const rect = icon.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const hit = document.elementFromPoint(x, y)
    if (hit?.closest('.generation-canvas-react-flow__handle') !== handle) return null
    return { x, y, affordance: handle.getAttribute('data-affordance') }
  }, handleSelector)
}

/**
 * 找框体上**真的抓得住**的那一点——「把整个框搬走」这个手势的起点。
 *
 * 判据和本文件其它两个一样是**白名单**：那一点的最顶层元素**就是框体那个 div 本身**
 * （`hit === frameEl`），不是它的后代、也不是盖在它上面的东西。为什么必须这么严：
 *  · 框的头部胶囊（标题 / 说明 / 折叠 / ⋯）是框体的**后代**，但它们各自吃掉 pointerdown
 *    ——抓在标题上拖，框一动不动，而 `frameEl.contains(hit)` 会放它过；
 *  · 节点卡渲染在框这层 overlay **之上**，且常常比框还宽（框里塞满时框面会被盖光），
 *    抓在卡上拖动的是那张卡，不是框——量到的会是「框没动」，看着像功能坏了。
 * 两种都在观测上和「框拖不动」一模一样，所以宁可返回 null 让调用方 fail-closed。
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ frameSelector?: string }} [options]
 * @returns {Promise<{ x: number, y: number } | null>} 屏幕坐标；找不到返回 null（调用方须 fail-closed）
 */
export async function findFrameDragHandlePoint(page, { frameSelector = CANVAS_FRAME_SELECTOR } = {}) {
  return page.evaluate(
    ({ selector, stageSelector }) => {
      const frame = document.querySelector(selector)
      const stage = document.querySelector(stageSelector)
      if (!frame || !stage) return null
      const rect = frame.getBoundingClientRect()
      const stageRect = stage.getBoundingClientRect()
      // 先沿四条边往里一点扫（框里塞满卡时，只有边缘那一圈还露着），再扫内部。
      const ratios = [0.04, 0.08, 0.5, 0.92, 0.96, 0.2, 0.35, 0.65, 0.8]
      for (const ratioY of ratios) {
        for (const ratioX of ratios) {
          const x = Math.round(rect.left + rect.width * ratioX)
          const y = Math.round(rect.top + rect.height * ratioY)
          if (x < stageRect.left + 1 || x > stageRect.right - 1) continue
          if (y < stageRect.top + 1 || y > stageRect.bottom - 1) continue
          if (document.elementFromPoint(x, y) === frame) return { x, y }
        }
      }
      return null
    },
    { selector: frameSelector, stageSelector: CANVAS_STAGE_SELECTOR },
  )
}

/**
 * 算出「把这几张卡整个圈进去」要拖的那个矩形——画框工具的真实用法之一：
 * 东西已经摆在画布上了，用户在它们**外面**起手、拖一圈把它们围起来。
 *
 * 只保证**起手点**落在真空白（pointerdown 必须打在 pane 上，落在卡上那一下压根不算画框），
 * 矩形内部当然不空白——里面正是要被圈住的那些卡。终点同样要求落在空白：
 * 松手那一下若压在别的浮层上，手势仍然完成（监听在 window 上），但截图里会多一层遮挡。
 *
 * 四周各留 `margin` 像素，让框的边和卡的边分得开——这既是用户的画法，
 * 也让后面「框有没有被拉长」量得出来（框边贴着卡边时，差几像素肉眼与断言都分不清）。
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ nodeSelectors: readonly string[], margin?: number }} options
 * @returns {Promise<{ x: number, y: number, width: number, height: number } | null>} 找不到返回 null（调用方须 fail-closed）
 */
export async function findFrameDrawRectAround(page, { nodeSelectors, margin = 56 }) {
  if (!Array.isArray(nodeSelectors) || !nodeSelectors.length) {
    throw new Error('findFrameDrawRectAround: nodeSelectors 必填且非空（要圈住谁得说清楚）')
  }
  return page.evaluate(
    ({ selectors, marginPx, stageSelector, paneSelector }) => {
      const stage = document.querySelector(stageSelector)
      if (!stage) return null
      const stageRect = stage.getBoundingClientRect()
      const rects = selectors
        .map((selector) => document.querySelector(selector)?.getBoundingClientRect())
        .filter((rect) => rect && rect.width > 0 && rect.height > 0)
      if (rects.length !== selectors.length) return null
      const left = Math.min(...rects.map((rect) => rect.left)) - marginPx
      const top = Math.min(...rects.map((rect) => rect.top)) - marginPx
      const right = Math.max(...rects.map((rect) => rect.right)) + marginPx
      const bottom = Math.max(...rects.map((rect) => rect.bottom)) + marginPx
      // 越出舞台就是「这一屏圈不下」，返回 null 让调用方 fail-closed——
      // 硬夹进舞台会画出一个圈不全的框，然后「少了一个成员」看着像入组判定坏了。
      if (left < stageRect.left + 2 || top < stageRect.top + 2) return null
      if (right > stageRect.right - 2 || bottom > stageRect.bottom - 2) return null
      const isBlank = (x, y) => {
        const hit = document.elementFromPoint(x, y)
        return Boolean(hit && stage.contains(hit) && hit.matches(paneSelector))
      }
      if (!isBlank(left, top) || !isBlank(right, bottom)) return null
      return { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) }
    },
    { selectors: [...nodeSelectors], marginPx: margin, stageSelector: CANVAS_STAGE_SELECTOR, paneSelector: CANVAS_PANE_SELECTOR },
  )
}


// ── 视口与「新到的卡」（2026-09-25 用户拍板「程序不再主动平移 / 缩放画布」）─────────────────────
//
// 拍板之前，新建 / 复制 / 落地 / 切图之后画布会自己挪过去（露出平移、连建缩小、落地适应、复制聚焦），
// 走查于是可以默认「新卡一定在屏里」。现在只剩三件事是真的：
//   ① 画布不自己动——新卡落地前后视口逐格相同（用户报的「付费卡点击之后画布就闪动一下」就是这一条破了）；
//   ② 没有明确位置的新卡落在当前可见区（舞台宽 38%、高 28% 那一点，owner
//      src/workbench/generationCanvas/store/canvasVisibleArea.ts `visibleInsertionPoint`），但可见区挤时
//      螺旋避让仍可能把它推出屏；
//   ③ 中心不在可见区里的新卡（产品判据 canvasArrivalModel.ts `isNodeSeen`：节点**中心**在可见区 = 看见了），
//      舞台边上出一颗胶囊 `[data-canvas-arrival-hint="right|left|up|down"]`（`data-arrival-count` = 几张），
//      **点它**画布才动画过去框住那一批，框住了胶囊自己消失。
// 下面这几把尺把这三件事做成走查能直接调的断言，别再各自手写一份「等露出动画落地」。

export const CANVAS_VIEWPORT_SELECTOR = '.react-flow__viewport'
export const CANVAS_ARRIVAL_HINT_SELECTOR = '[data-canvas-arrival-hint]'
/** 画布上的一张卡（生成节点本体）。`data-node-id` 与 React Flow 的 `data-id` 同值。 */
export const CANVAS_CARD_SELECTOR = '.generation-canvas-v2-node[data-node-id]'
/** 「视口没动」的容差：亚像素取整与缩放的浮点噪声。超过它就是真动了。 */
export const CANVAS_VIEWPORT_TOLERANCE = Object.freeze({ px: 0.5, zoom: 0.001 })

/** React Flow 变换层此刻的视口（读计算样式，量的是用户眼前那一帧，不读 store）。画布没挂载时 null。 */
export async function readCanvasViewport(page) {
  return page.evaluate((selector) => {
    const layer = document.querySelector(selector)
    if (!layer) return null
    const matrix = new DOMMatrixReadOnly(getComputedStyle(layer).transform)
    return { x: matrix.m41, y: matrix.m42, zoom: matrix.a }
  }, CANVAS_VIEWPORT_SELECTOR)
}

/** 两份视口在容差内相同。任一为空一律算「不同」——读不到视口不能被当成「没动」。 */
export function sameCanvasViewport(a, b, tolerance = CANVAS_VIEWPORT_TOLERANCE) {
  if (!a || !b) return false
  return Math.abs(b.x - a.x) <= tolerance.px
    && Math.abs(b.y - a.y) <= tolerance.px
    && Math.abs(b.zoom - a.zoom) <= tolerance.zoom
}

const formatViewport = (viewport) => viewport
  ? `(${viewport.x.toFixed(1)}, ${viewport.y.toFixed(1)}) ×${viewport.zoom.toFixed(4)}`
  : '（读不到视口）'

/**
 * 等画布视口**停下来**，返回停下时的视口（当「之前」的基线用）。
 *
 * 2026-09-25 之前这里等的是「落节点之后画布自己发的那次延迟适应视图」；那扇门已经删了（程序不再主动挪画布）。
 * 仍然要等的只剩两种**合法**移动：打开一个分类那一刻的一次性摆全貌（`useAutoFitOnLoad`：打开时里面本来就有
 * 节点、且没有记住的视角或记住的视角里一个节点都看不见，画布量完节点后判一次），以及用户自己点出来的动画
 * （适应视图 / 复位 / 定位 / 边缘提示，200–220ms）。走查若在这个窗口里读基线或点下一步，量到的是动画不是动作
 * （2026-09-18 金路径真机：重置视图 → 滑块 70→95 → 又被当时的延迟适应拉回 59）。
 * 判据是稳定性，不是睡够多久：变换层（平移 + 缩放都算）连续 `holdMs` 内一格没动才算停。
 */
export async function waitForCanvasViewportSettled(page, { holdMs = 800, stepMs = 100, timeout = DEFAULT_TIMEOUT_MS } = {}) {
  const needed = Math.ceil(holdMs / stepMs)
  let last = null
  let stableFor = 0
  await expect.poll(async () => {
    const now = await readCanvasViewport(page)
    stableFor = now && sameCanvasViewport(last, now) ? stableFor + 1 : 0
    last = now
    return stableFor >= needed
  }, { message: `画布视口 ${holdMs}ms 内一直在动（或画布根本没挂载），没有停下来`, timeout, intervals: [stepMs] }).toBe(true)
  return last
}

/**
 * 断言画布**没有自己动**：从 `before` 起连续 `holdMs` 的取样里，视口一直等于 `before`（容差内）。
 * 取样途中偏离一次就记下、立刻报红，不等到超时——「闪一下又回来」同样在这里现形，
 * 因为取样是连续的而不是只比首尾（首尾相同的闪动由调用方另挂 `recordCanvasViewportWrites` 抓）。
 */
export async function expectCanvasViewportHeld(page, before, message, { holdMs = 1000, stepMs = 100, timeout = DEFAULT_TIMEOUT_MS } = {}) {
  if (!before) throw new Error(`expectCanvasViewportHeld：${message} —— 没有基线视口（先用 waitForCanvasViewportSettled 取）`)
  const needed = Math.ceil(holdMs / stepMs)
  let heldFor = 0
  let drift = null
  await expect.poll(async () => {
    if (drift) return 'moved'
    const now = await readCanvasViewport(page)
    if (!sameCanvasViewport(before, now)) {
      drift = now ?? { x: NaN, y: NaN, zoom: NaN }
      return 'moved'
    }
    heldFor += 1
    return heldFor >= needed ? 'held' : 'holding'
  }, { message: `${message}：${holdMs}ms 的取样窗口没能走完`, timeout, intervals: [stepMs] }).not.toBe('holding')
  expect(drift, `${message} —— 基线 ${formatViewport(before)}，画布却自己变成了 ${formatViewport(drift)}`).toBeNull()
  return before
}

/**
 * 从现在起记下变换层的**每一次**改写（MutationObserver 看 style），返回一个 `read()`：交出期间出现过的
 * 全部视口。用来抓「首尾相同、中间闪了一下」——`expectCanvasViewportHeld` 的取样间隔是 100ms，
 * 一段 200ms 的动画来回可能恰好从两次取样之间溜过去。只观察、不改时序。
 */
export async function recordCanvasViewportWrites(page) {
  const record = await page.evaluateHandle((selector) => {
    const layer = document.querySelector(selector)
    if (!layer) return null
    const writes = []
    const observer = new MutationObserver(() => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(layer).transform)
      writes.push({ x: matrix.m41, y: matrix.m42, zoom: matrix.a, at: Math.round(performance.now()) })
    })
    observer.observe(layer, { attributes: true, attributeFilter: ['style'] })
    return { writes, observer, layer }
  }, CANVAS_VIEWPORT_SELECTOR)
  if (!(await record.evaluate((entry) => entry !== null))) {
    await record.dispose()
    throw new Error('recordCanvasViewportWrites：画布变换层没挂载，记不了视口改写')
  }
  return {
    /** 期间出现过的视口；`stop` 为真时顺手断开观察。变换层被整层重挂过也照实报（detached=true）。 */
    read: async ({ stop = false } = {}) => {
      const result = await record.evaluate((entry, { stopNow, selector }) => {
        if (stopNow) entry.observer.disconnect()
        return { writes: entry.writes.slice(), detached: document.querySelector(selector) !== entry.layer }
      }, { stopNow: stop, selector: CANVAS_VIEWPORT_SELECTOR })
      if (stop) await record.dispose()
      return result
    },
  }
}

/**
 * 此刻「新到的卡」的账：`knownIds` 以外、已渲染的卡各自在不在舞台里，外加边缘提示报的方向与张数。
 * 注意 React Flow 开着 `onlyRenderVisibleElements`：整张在屏外的卡连 DOM 都没有，只能从提示的张数里数到它。
 */
export async function readArrivalLedger(page, knownIds = []) {
  return page.evaluate(({ cardSelector, stageSelector, hintSelector, known }) => {
    const stageEl = document.querySelector(stageSelector)
    const stage = stageEl?.getBoundingClientRect()
    const knownSet = new Set(known)
    const cards = Array.from(document.querySelectorAll(cardSelector))
      .filter((element) => !knownSet.has(element.getAttribute('data-node-id')))
      .map((element) => {
        const rect = element.getBoundingClientRect()
        const cx = rect.left + rect.width / 2
        const cy = rect.top + rect.height / 2
        return {
          id: element.getAttribute('data-node-id'),
          rect: { left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom) },
          // 与产品同一判据：中心在可见区里 = 看见了（canvasArrivalModel.ts `isNodeSeen`）。
          seen: Boolean(stage) && cx >= stage.left && cx <= stage.right && cy >= stage.top && cy <= stage.bottom,
          fullyInside: Boolean(stage) && rect.width > 0 && rect.height > 0
            && rect.left >= stage.left - 1 && rect.right <= stage.right + 1 && rect.top >= stage.top - 1 && rect.bottom <= stage.bottom + 1,
        }
      })
    const hintEl = stageEl?.querySelector(hintSelector) ?? document.querySelector(hintSelector)
    const hint = hintEl
      ? { side: hintEl.getAttribute('data-canvas-arrival-hint'), count: Number(hintEl.getAttribute('data-arrival-count')), text: (hintEl.textContent || '').trim() }
      : null
    return {
      stage: stage ? { left: Math.round(stage.left), top: Math.round(stage.top), right: Math.round(stage.right), bottom: Math.round(stage.bottom) } : null,
      cards,
      hint,
    }
  }, { cardSelector: CANVAS_CARD_SELECTOR, stageSelector: CANVAS_STAGE_SELECTOR, hintSelector: CANVAS_ARRIVAL_HINT_SELECTOR, known: [...knownIds] })
}

/**
 * 一次创建（工具条建卡 / 复制变体 / 切图 / 导入……）之后的完整新契约：
 *   ① 账平：看得见的新卡 + 边缘提示报的张数 = 这次该到的张数（`expectedCount`，从 `knownIds` 之外数）；
 *   ② 画布没有自己动（给了 `viewportBefore` 才验；它必须是**点下创建之前**读的）；
 *   ③ 有提示且 `followHint`：点它，方向 / 张数对得上、点完那一批完整进舞台、提示自己消失（见 `followArrivalHint`）。
 * 返回 `{ path: 'in-view' | 'hint' | 'hint-pending', ids, hint, ledger }`：`ids` 是此刻看得见的新卡
 * （走了提示则含被框进来的那批）。`in-view` 只保证中心在舞台里（产品的「看见了」），完整不完整由调用方按需再断。
 */
export async function expectArrivalsReachable(page, {
  knownIds = [], expectedCount = 1, viewportBefore = null, label, followHint = true, holdMs = 1000, timeout = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!label) throw new Error('expectArrivalsReachable：label 必填，红的时候要说得出是哪一次创建')
  let ledger = null
  const accounted = (entry) => entry.cards.filter((card) => card.seen).length + (entry.hint?.count ?? 0)
  await expect.poll(async () => {
    ledger = await readArrivalLedger(page, knownIds)
    return accounted(ledger)
  }, {
    message: `${label}：该到 ${expectedCount} 张新卡，但「落在舞台里的」加「边缘提示数到的」对不上——新卡要么没建出来，要么落到屏外却没有提示`,
    timeout,
  }).toBe(expectedCount)
  if (viewportBefore) {
    await expectCanvasViewportHeld(page, viewportBefore, `${label}：新卡落地后画布不许自己平移 / 缩放（2026-09-25 拍板）`, { holdMs })
    // 保持窗口里账也不许变：变了说明还有东西在后面落地，前面那次「账平」是抢早了。
    ledger = await readArrivalLedger(page, knownIds)
    expect(accounted(ledger), `${label}：保持窗口之后账不平了 —— ${JSON.stringify(ledger)}`).toBe(expectedCount)
  }
  const seenIds = ledger.cards.filter((card) => card.seen).map((card) => card.id)
  if (!ledger.hint) return { path: 'in-view', ids: seenIds, hint: null, ledger }
  if (!followHint) return { path: 'hint-pending', ids: seenIds, hint: ledger.hint, ledger }
  const followed = await followArrivalHint(page, { knownIds: [...knownIds, ...seenIds], label })
  return { path: 'hint', ids: [...seenIds, ...followed.ids], hint: ledger.hint, ledger: followed.ledger }
}

/**
 * 点边缘提示过去——用户唯一一种「让画布替我去找新卡」的方式。断言：
 *   ① 提示报的方向与那一批卡（按**点之前**的视口）外接盒中心偏出舞台最多的那条轴一致
 *      （与 canvasArrivalModel.ts `resolveArrivalHint` 同一判据；点之前它们多半不在 DOM，所以点完再按视口换算回去）；
 *   ② 点完那一批完整落在舞台里，张数等于提示上的数；③ 提示自己消失。
 * 只验「同一分类里」的方向提示；跨分类提示（「新节点在「分镜」里」）会先切分类，没有方向可验，调用方另写。
 * `knownIds`：点之前就在（包括这次已经看得见的新卡）的卡，被框进来的只算它们之外的。
 */
export async function followArrivalHint(page, { knownIds = [], label }) {
  const hint = page.locator(CANVAS_ARRIVAL_HINT_SELECTOR)
  const hintProof = await proveProbe(hint, `${label}：新卡落在屏外，舞台边上该出边缘提示`)
  const side = await hint.first().getAttribute('data-canvas-arrival-hint')
  const count = Number(await hint.first().getAttribute('data-arrival-count'))
  expect(['right', 'left', 'up', 'down'], `${label}：边缘提示的方向「${side}」不是四个方向之一`).toContain(side)
  expect(count, `${label}：边缘提示上的张数「${count}」不是正整数`).toBeGreaterThan(0)
  const geometryBefore = await readFlowGeometry(page)
  await clickOrFail(hint, `${label}：边缘提示「${side} · ${count}」`)
  await expectAbsent(hint, { provenBy: hintProof, message: `${label}：点过去之后新卡进了视野，边缘提示应自己消失` })
  const viewportAfter = await waitForCanvasViewportSettled(page)
  expect(sameCanvasViewport(geometryBefore.viewport, viewportAfter), `${label}：点了边缘提示，画布却一格没动`).toBe(false)
  const ledger = await readArrivalLedger(page, knownIds)
  expect(ledger.cards.length, `${label}：提示说有 ${count} 张，点过去框进来的却是 ${ledger.cards.length} 张 —— ${JSON.stringify(ledger)}`).toBe(count)
  const clipped = ledger.cards.filter((card) => !card.fullyInside)
  expect(clipped, `${label}：点了边缘提示，这一批仍有卡没完整进舞台 —— ${JSON.stringify(ledger)}`).toEqual([])
  // 方向：把点完之后的屏幕位置按两份视口换算回「点之前」的屏幕，再按产品的判据算它该指哪边。
  const geometryAfter = await readFlowGeometry(page)
  const toBefore = (screenX, screenY) => {
    const { origin } = geometryAfter
    const a = geometryAfter.viewport
    const b = geometryBefore.viewport
    const canvasX = (screenX - origin.left - a.x) / a.zoom
    const canvasY = (screenY - origin.top - a.y) / a.zoom
    return { x: origin.left + canvasX * b.zoom + b.x, y: origin.top + canvasY * b.zoom + b.y }
  }
  const topLeft = toBefore(Math.min(...ledger.cards.map((card) => card.rect.left)), Math.min(...ledger.cards.map((card) => card.rect.top)))
  const bottomRight = toBefore(Math.max(...ledger.cards.map((card) => card.rect.right)), Math.max(...ledger.cards.map((card) => card.rect.bottom)))
  const center = { x: (topLeft.x + bottomRight.x) / 2, y: (topLeft.y + bottomRight.y) / 2 }
  const stage = geometryBefore.stage
  const width = stage.right - stage.left
  const height = stage.bottom - stage.top
  const overX = center.x < stage.left ? (stage.left - center.x) / width : center.x > stage.right ? (center.x - stage.right) / width : 0
  const overY = center.y < stage.top ? (stage.top - center.y) / height : center.y > stage.bottom ? (center.y - stage.bottom) / height : 0
  const horizontal = center.x < stage.left ? 'left' : 'right'
  const vertical = center.y < stage.top ? 'up' : 'down'
  // 产品按模型尺寸算外接盒、这里按渲染尺寸算，两轴偏出量差不到 5% 时哪边都算对（贴边的那一格不判方向）。
  const acceptable = Math.abs(overX - overY) < 0.05
    ? [overX > 0 ? horizontal : null, overY > 0 ? vertical : null, overX >= overY ? horizontal : vertical].filter(Boolean)
    : [overX >= overY ? horizontal : vertical]
  expect(acceptable, `${label}：边缘提示指「${side}」，但那一批卡点之前在舞台的 ${acceptable.join(' / ')} —— ${JSON.stringify({ center, stage, overX, overY })}`).toContain(side)
  return { side, count, ids: ledger.cards.map((card) => card.id), ledger }
}

/** 画布坐标换算要的三样：视口、React Flow 容器原点（transform 以它为原点）、舞台框。 */
async function readFlowGeometry(page) {
  return page.evaluate(({ viewportSelector, stageSelector }) => {
    const layer = document.querySelector(viewportSelector)
    const flow = document.querySelector('.react-flow')?.getBoundingClientRect()
    const stage = document.querySelector(stageSelector)?.getBoundingClientRect()
    if (!layer || !flow || !stage) throw new Error('画布没挂载：读不到视口 / React Flow 容器 / 舞台')
    const matrix = new DOMMatrixReadOnly(getComputedStyle(layer).transform)
    return {
      viewport: { x: matrix.m41, y: matrix.m42, zoom: matrix.a },
      origin: { left: flow.left, top: flow.top },
      stage: { left: stage.left, top: stage.top, right: stage.right, bottom: stage.bottom },
    }
  }, { viewportSelector: CANVAS_VIEWPORT_SELECTOR, stageSelector: CANVAS_STAGE_SELECTOR })
}

/** Fail on a clipped card instead of moving the canvas or choosing a forgiving click offset. */
export async function expectNodeInsideCanvas(page, node, message = '新卡完整位于舞台内') {
  await expect(node, message).toBeVisible()
  const geometry = await node.evaluate((element, stageSelector) => {
    const stage = document.querySelector(stageSelector)?.getBoundingClientRect()
    const card = element.getBoundingClientRect()
    return { stage: stage?.toJSON(), card: card.toJSON() }
  }, CANVAS_STAGE_SELECTOR)
  console.log('CANVAS_NODE_VISIBILITY', JSON.stringify(geometry))
  const { stage, card } = geometry
  expect(Boolean(stage && card.width > 0 && card.height > 0
    && card.left >= stage.left && card.top >= stage.top
    && card.right <= stage.right && card.bottom <= stage.bottom), `${message}: ${JSON.stringify(geometry)}`).toBe(true)
  return geometry
}

/**
 * 像用户一样拖画布，直到 `locator` 那一块完整落进舞台、离开四周的常驻层。2026-09-25 起浮框钉在节点正下方、
 * 定宽 560、被挡就挡：卡贴着舞台边时浮框本来就会伸出去（左缘工具条 / 左侧栏 / 底部停靠栏会盖住那一截）。
 * 程序不替人挪画布，人会自己把它拖出来——走查照做，用中键拖画布（不用滚轮：滚轮是缩放还是平移随设置而变）。
 * 默认留白：左 72（让开左缘工具条）、下 72（让开缩放条 / 时间轴胶囊）、上右 16。一次最多拖 250px，拖完重量。
 */
export async function panCanvasUntilInside(page, locator, { margin = {}, maxSteps = 8 } = {}) {
  const m = { left: 72, right: 16, top: 16, bottom: 72, ...margin }
  const clamp = (value) => Math.max(-250, Math.min(250, Math.round(value)))
  let last = null
  for (let step = 0; step < maxSteps; step += 1) {
    const box = await locator.first().boundingBox()
    const stage = await page.locator(CANVAS_STAGE_SELECTOR).first().boundingBox()
    if (!box || !stage) return { ok: false, reason: box ? 'no-stage' : 'target-not-rendered', step, last }
    const left = stage.x + m.left
    const right = stage.x + stage.width - m.right
    const top = stage.y + m.top
    const bottom = stage.y + stage.height - m.bottom
    let dx = 0
    let dy = 0
    if (box.x < left) dx = left - box.x
    else if (box.x + box.width > right) dx = Math.max(right - (box.x + box.width), left - box.x)
    if (box.y < top) dy = top - box.y
    else if (box.y + box.height > bottom) dy = Math.max(bottom - (box.y + box.height), top - box.y)
    last = { box, stage, dx: Math.round(dx), dy: Math.round(dy) }
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return { ok: true, step, last }
    // 中键拖：舞台在捕获阶段接管（useGenerationCanvasReactFlowPointer），按在卡片 / 分组框上也是平移，不会误拖它们。
    // 优先从真空白处按；满屏都是卡和框（宽视口里的分组基线就是这样）时从舞台中心按。
    const start = await findCanvasBlankPoint(page, { inset: 80 })
      ?? { x: Math.round(stage.x + stage.width / 2), y: Math.round(stage.y + stage.height / 2) }
    await page.mouse.move(start.x, start.y)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(start.x + 2, start.y + 1)
    await page.mouse.move(start.x + clamp(dx), start.y + clamp(dy), { steps: 8 })
    await page.mouse.up({ button: 'middle' })
    await waitForCanvasViewportSettled(page)
  }
  return { ok: false, reason: 'did-not-converge', step: maxSteps, last }
}
