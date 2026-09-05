// 画布 benchmark 手势几何的**单一 owner**：一次指针手势到底扫过了哪块区域、
// 那块区域里「本来就该被选中」的节点有几个。
//
// 为什么要有这个文件（2026-09-05，根因见 docs/fixes/2026-09-05-canvas-perf-marquee-autopan.root-cause.json）：
// React Flow 的 `calcAutoPan(pos, bounds, speed = 15, distance = 40)`
// （node_modules/@xyflow/system .../dist/esm/index.js）在**指针进入 pane 边缘 40px 带内**时开始
// 自动平移视口，并且这个平移挂在 `requestAnimationFrame` 循环上——**每一帧移一点**。
// 也就是说：视口平移了多少，取决于这台机器在指针停留边缘期间画了多少帧。
//
// marquee-select 场景原本把框选终点钉在 `stage 边缘 - 10px`（深在 40px 带内），
// 于是同一段代码、同一份 fixture、同一个窗口尺寸，实测出来的选中数在 9 和 12 之间跳：
// 快的那次自动平移 ~96px、把更多节点卷进框里 → 12；慢的那次只平移 ~50px → 9。
// 而判据写死的是「必须 ≥ 12」——一个在 darwin 上调出来的常数。
// 换到 Linux xvfb 软渲染（帧率更低、平移更少）它就成了掷硬币：CI 上实测既出过 12 也出过 8。
//
// 结论：**假红的根不是预算太紧，是手势本身不可复现**。所以这里做两件事：
//   ① 把手势限制在「不会触发自动平移」的安全区内 —— 扫过的区域从此是确定的；
//   ② 判据不再写死节点个数，而是**从扫过的那块区域 derive**「应该选中几个」。
// 两件事缺一不可：只做 ② 的话，扫过的区域还在随帧率变，derive 出来的期望值一样在跳。

/**
 * React Flow 开始自动平移的边缘带宽度（px，pane 相对坐标）。
 * 真相源是 @xyflow/system 的 `calcAutoPan(pos, bounds, speed = 15, distance = 40)` 默认参数；
 * 生产代码没有覆盖 `autoPanSpeed`，也没有关掉 `autoPanOnSelection`（默认 true），
 * 所以这就是本仓画布实际生效的值。
 */
export const REACT_FLOW_AUTO_PAN_EDGE_PX = 40

/**
 * benchmark 手势允许触碰的最内侧边界，比自动平移带再留 8px 余量。
 * 余量存在的理由：指针坐标要取整、stage 的 bounding box 是小数，
 * 贴着 40px 整数边界写等于把「触发/不触发」压在一个像素的舍入上。
 */
export const AUTO_PAN_SAFE_MARGIN_PX = REACT_FLOW_AUTO_PAN_EDGE_PX + 8

/**
 * DOM 矩形与 React Flow 内部按 flow 坐标算出来的节点盒子之间，允许的亚像素分歧。
 * 我们用 DOM `boundingBox()` 复算「谁在框里」，React Flow 用的是 nodeLookup 里的
 * position/dimensions；两者在边界上可能差零点几个像素。所以期望值给的是**一个区间**，
 * 不是一个数——正好压在框线上的节点算「可能选中」，不参与硬判定。
 */
export const SELECTION_BOUNDARY_TOLERANCE_PX = 1

/**
 * 这一笔至少要盖住「够得着的节点带」的这个比例，才算没有退化。
 *
 * 这条替代的是原来那个写死的「≥12 个节点」：它想表达的是「这一笔确实划过了节点密集带」，
 * 但它把这件事绑在了**节点个数**上——个数既随窗口尺寸变，又（在修好自动平移之前）随帧率变。
 *
 * 为什么不是「扫过面积 ÷ 安全区面积」（第一版就是这么写的，实测被自己否掉）：
 * 那个比值随 stage 大小剧烈漂移——同一份 fixture，darwin 的 1200×790 上算出 0.941，
 * 换成 CI 那种更宽的 stage 就掉到 0.583。**那等于又造了一个平台相关的阈值**，
 * 正是这次要修掉的那一类。
 *
 * 改成「盖住了够得着的节点带的百分之多少」之后判据是**无量纲**的：
 * 只要这一笔把「安全区内能碰到的那片节点」整个圈进去，两种 stage 上都是 1.0。
 * 真退化（框缩成一小块）时它才掉下来。
 */
export const MIN_NODE_BAND_COVERAGE = 0.9

/**
 * benchmark 手势的安全区：stage 往内缩 `margin`，缩出来的这块矩形里指针怎么走都不会触发自动平移。
 *
 * @param {{ x: number, y: number, width: number, height: number }} stage stage 的屏幕坐标外接盒
 * @param {number} [margin]
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function autoPanSafeArea(stage, margin = AUTO_PAN_SAFE_MARGIN_PX) {
  assertRect(stage, 'autoPanSafeArea(stage)')
  const width = stage.width - margin * 2
  const height = stage.height - margin * 2
  if (width <= 0 || height <= 0) {
    // fail-closed：stage 小到装不下安全区时，任何手势都必然落在自动平移带里。
    // 这时候继续跑只会量出一个不可复现的数——报错比出一个漂亮的假数据好。
    throw new Error(
      `autoPanSafeArea: stage ${stage.width}×${stage.height} 装不下 ${margin}px 的自动平移安全边距。\n`
        + '  这一屏上任何指针手势都会触发 React Flow 自动平移，扫过的区域随帧率变化，测不出可复现的结果。\n'
        + '  先把窗口/stage 放大，别调小 margin —— margin 是从 @xyflow/system 的 calcAutoPan 默认值来的。',
    )
  }
  return { x: stage.x + margin, y: stage.y + margin, width, height }
}

/**
 * 把一个屏幕坐标点夹进安全区。
 *
 * @param {{ x: number, y: number }} point
 * @param {{ x: number, y: number, width: number, height: number }} stage
 * @param {number} [margin]
 * @returns {{ x: number, y: number }}
 */
export function clampIntoAutoPanSafeArea(point, stage, margin = AUTO_PAN_SAFE_MARGIN_PX) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error(`clampIntoAutoPanSafeArea(point): 需要有限的 {x,y}，收到 ${JSON.stringify(point)}`)
  }
  const safe = autoPanSafeArea(stage, margin)
  return {
    x: Math.min(Math.max(point.x, safe.x), safe.x + safe.width),
    y: Math.min(Math.max(point.y, safe.y), safe.y + safe.height),
  }
}

/**
 * 两点画出来的矩形（框选手势扫过的那块）。
 *
 * @param {{ x: number, y: number }} start
 * @param {{ x: number, y: number }} end
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function sweptRect(start, end) {
  const x = Math.min(start.x, end.x)
  const y = Math.min(start.y, end.y)
  return { x, y, width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }
}

/**
 * 框选期望值：扫过的矩形里「一定被选中」和「可能被选中」各有几个。
 *
 * React Flow 默认 `selectionMode = SelectionMode.Full`（生产代码没有覆盖它），
 * 也就是**整个节点都在框里**才算选中；压在框线上的不算。所以：
 *   · definite = 把框缩 1px 之后仍然完整包住的节点数 —— 这些必须被选中；
 *   · possible = 把框放 1px 之后能完整包住的节点数 —— 选中数不能超过它。
 * 判据用 `definite ≤ 实际选中 ≤ possible`，把亚像素分歧留在区间里，
 * 同时任何真实的框选回归（少选、多选）都仍然会红。
 *
 * @param {Array<{ x: number, y: number, width: number, height: number }>} boxes 节点的屏幕外接盒
 * @param {{ x: number, y: number, width: number, height: number }} rect 扫过的矩形
 * @param {number} [tolerance]
 * @returns {{ definite: number, possible: number }}
 */
export function expectedFullySelected(boxes, rect, tolerance = SELECTION_BOUNDARY_TOLERANCE_PX) {
  assertRect(rect, 'expectedFullySelected(rect)')
  const list = Array.isArray(boxes) ? boxes : []
  return {
    definite: countFullyInside(list, insetRect(rect, tolerance)),
    possible: countFullyInside(list, insetRect(rect, -tolerance)),
  }
}

/**
 * 这一笔盖住了「够得着的节点带」的多大比例。
 *
 * 「够得着的节点带」= 所有节点的外接盒 ∩ 自动平移安全区。带外的节点（被视口切掉的那些）
 * 本来就不可能被这一笔选中，把它们算进分母只会得到一个随窗口尺寸漂移的数。
 *
 * @param {{ x: number, y: number, width: number, height: number }} rect 扫过的矩形
 * @param {Array<{ x: number, y: number, width: number, height: number }>} boxes 节点的屏幕外接盒
 * @param {{ x: number, y: number, width: number, height: number }} stage
 * @param {number} [margin]
 * @returns {number} 0–1；够得着的节点带为空时返回 0（调用方据此报红，而不是当成满分）
 */
export function nodeBandCoverage(rect, boxes, stage, margin = AUTO_PAN_SAFE_MARGIN_PX) {
  assertRect(rect, 'nodeBandCoverage(rect)')
  const band = intersect(boundingBoxOf(boxes), autoPanSafeArea(stage, margin))
  const bandArea = band.width * band.height
  if (bandArea <= 0) return 0
  const covered = intersect(band, rect)
  return Math.min(1, (covered.width * covered.height) / bandArea)
}

function boundingBoxOf(boxes) {
  const list = (Array.isArray(boxes) ? boxes : []).filter(
    (box) => box && Number.isFinite(box.x) && Number.isFinite(box.y),
  )
  if (!list.length) return { x: 0, y: 0, width: 0, height: 0 }
  const x = Math.min(...list.map((box) => box.x))
  const y = Math.min(...list.map((box) => box.y))
  const right = Math.max(...list.map((box) => box.x + box.width))
  const bottom = Math.max(...list.map((box) => box.y + box.height))
  return { x, y, width: right - x, height: bottom - y }
}

function intersect(a, b) {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
}

function countFullyInside(boxes, rect) {
  let count = 0
  for (const box of boxes) {
    if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y)) continue
    if (
      box.x >= rect.x
      && box.y >= rect.y
      && box.x + box.width <= rect.x + rect.width
      && box.y + box.height <= rect.y + rect.height
    ) {
      count += 1
    }
  }
  return count
}

function insetRect(rect, by) {
  return {
    x: rect.x + by,
    y: rect.y + by,
    width: Math.max(0, rect.width - by * 2),
    height: Math.max(0, rect.height - by * 2),
  }
}

function assertRect(rect, label) {
  if (
    !rect
    || !Number.isFinite(rect.x)
    || !Number.isFinite(rect.y)
    || !Number.isFinite(rect.width)
    || !Number.isFinite(rect.height)
  ) {
    throw new Error(`${label}: 需要有限的 {x,y,width,height}，收到 ${JSON.stringify(rect)}`)
  }
}
