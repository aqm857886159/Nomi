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
  return page.evaluate(
    ({ selector, within }) => {
      const node = document.querySelector(selector)
      const bounds = within ? document.querySelector(within)?.getBoundingClientRect() : null
      if (!node || (within && !bounds)) return null
      const rect = node.getBoundingClientRect()
      const ratios = [0.12, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.88]
      for (const ratioY of ratios) {
        for (const ratioX of ratios) {
          const x = rect.left + rect.width * ratioX
          const y = rect.top + rect.height * ratioY
          if (bounds && (x < bounds.left + 1 || x > bounds.right - 1 || y < bounds.top + 1 || y > bounds.bottom - 1)) continue
          const hit = document.elementFromPoint(x, y)
          if (!hit || !node.contains(hit)) continue
          // 卡上的控件（生成、复制、句柄…）点下去是别的意思，不能拿来当「选中这张卡」。
          if (hit.closest('button, a, input, textarea, [role="button"]')) continue
          return { x, y }
        }
      }
      return null
    },
    { selector: nodeSelector, within: withinSelector },
  )
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
