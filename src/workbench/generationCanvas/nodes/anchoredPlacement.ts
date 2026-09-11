/**
 * 锚定浮层的几何唯一 owner（2026-09-10 反馈 #10 的根因修复）。
 *
 * 守的不变量：**浮层的位置只由「视口 + 它自己的锚点」决定。**
 * 这个签名里没有障碍物这一项，所以画布上别的节点、别的浮条、别的结果堆叠怎么动，
 * 同一个锚点算出来的矩形都逐字节相同——「不漂移」在结构上成立，不靠调用方自觉。
 *
 * 它替掉的是自研的「最大空矩形避让搜索」：那套会去找一块空地，而空地会随别人移动，
 * 于是用户的眼睛得追着浮层跑。React Flow 官方给节点挂浮层的件 `NodeToolbar` 同样
 * 不做任何避让（只有 position/align/offset），这里是同一个答案加上 Floating UI
 * flip/shift 那两条标准行为：放不下就翻到另一侧、永远推回视口内。
 * 取舍与出处见 docs/research/2026-09-10-node-composer-placement/prior-art.md。
 */

/** 屏幕像素矩形：浮层要在画布缩放时保持可读，所以一切都在屏幕空间算。 */
export type AnchoredRect = { left: number; top: number; right: number; bottom: number }
export type AnchoredPlacement = { left: number; top: number; width: number; height: number; side: 'below' | 'above' }

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), Math.max(min, max))

export function resolveAnchoredPlacement(input: {
  /** 可用视口，调用方自己先内缩过边距。 */
  stage: AnchoredRect
  /** 锚点（节点卡片）的屏幕矩形。 */
  anchor: AnchoredRect
  /** 内容的自然宽高；两者都会被视口收窄。 */
  width: number
  height: number
  /** 锚点与浮层之间的间距。 */
  gap: number
  /** 翻到上方时要给锚点自己的浮动工具条让出来的高度。 */
  aboveClearance: number
}): AnchoredPlacement {
  const { stage, anchor, width, height, gap, aboveClearance } = input
  const stageWidth = Math.max(0, stage.right - stage.left)
  const stageHeight = Math.max(0, stage.bottom - stage.top)

  // 宽度：自然宽被视口收窄，再把居中位置推回视口内。左右两侧从不使用——
  // 侧挂会让浮层离开锚点正下方，正是用户报的「不在节点正下方」。
  const resolvedWidth = Math.min(width, stageWidth)
  const left = clamp((anchor.left + anchor.right - resolvedWidth) / 2, stage.left, stage.right - resolvedWidth)

  // 上下各自剩多少：下方从锚点底边起算，上方还要再让掉浮动工具条。
  const belowSpace = clamp(stage.bottom - (anchor.bottom + gap), 0, stageHeight)
  const aboveSpace = clamp((anchor.top - gap - aboveClearance) - stage.top, 0, stageHeight)
  // 先要下方（阅读顺序），下方装不下才翻上去；两边都装不下就取大的那侧并压高度。
  const side: AnchoredPlacement['side'] = belowSpace >= Math.min(height, stageHeight) || belowSpace >= aboveSpace ? 'below' : 'above'
  const resolvedHeight = Math.min(height, side === 'below' ? belowSpace : aboveSpace)
  const desiredTop = side === 'below'
    ? anchor.bottom + gap
    : anchor.top - gap - aboveClearance - resolvedHeight
  const top = clamp(desiredTop, stage.top, stage.bottom - resolvedHeight)

  return { left, top, width: resolvedWidth, height: resolvedHeight, side }
}
