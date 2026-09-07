/**
 * 「适应视图」到底要框住什么——这块地方的**唯一算式**（纯函数，不碰 React / store / DOM）。
 *
 * 2026-09-07 拍板：**框（Frame）也是用户的内容，fit 必须把它算进去。**
 *
 * 修之前：fit 只按**节点**的外接盒算。而框的上沿比成员外接盒还高 52px
 * （`FRAME_CONTENT_PADDING` 24 + `FRAME_LABEL_HEIGHT` 28），框的名字/说明/计数就写在那条带上。
 * 于是「适应视图」之后，用户刚起完名的那个框，名字被舞台上沿切掉一条——
 * 一个**以「让我看全」为全部意义**的按钮，交出来的画面是缺的。
 *
 * 这条取舍的另一半（诚实标注）：一个画得很大的空框会把整屏挤小。
 * 那是用户自己画出来的边界，他知道自己画了多大；而标签带被切掉他既没要求也看不懂。
 * 所以：**框算进去，挤小是用户自己的选择，切掉不是。**
 */

/** 一块要被 fit 框住的矩形（画布坐标系）。 */
export type CanvasFitRect = { x: number; y: number; width: number; height: number }

function isUsableRect(rect: CanvasFitRect | null | undefined): rect is CanvasFitRect {
  return Boolean(
    rect &&
      Number.isFinite(rect.x) &&
      Number.isFinite(rect.y) &&
      Number.isFinite(rect.width) &&
      Number.isFinite(rect.height) &&
      rect.width > 0 &&
      rect.height > 0,
  )
}

/**
 * 节点外接盒 ∪ 每个框的渲染矩形 = 「适应视图」要框住的那块地方。
 *
 * 框的矩形**已经含标签带**（`getCanvasGroupBoxes` 交出来的就是渲染出来的那个盒子，
 * 头部胶囊绝对定位在它内部 `top-2`），所以这里不再另外补一次高度——补了就是第二份真相。
 *
 * 一块都没有（空画布 / 全是零尺寸）→ null，调用方据此什么都不做。
 */
export function unionCanvasFitBounds(rects: readonly (CanvasFitRect | null | undefined)[]): CanvasFitRect | null {
  const usable = rects.filter(isUsableRect)
  if (!usable.length) return null
  const left = Math.min(...usable.map((rect) => rect.x))
  const top = Math.min(...usable.map((rect) => rect.y))
  const right = Math.max(...usable.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...usable.map((rect) => rect.y + rect.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}
