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
