/**
 * 锚定浮层的几何（纯函数）：浮层的位置只由「视口 + 它自己的锚点」决定。
 *
 * 签名里没有障碍物这一项，所以周围别的东西怎么动，同一个锚点算出来的矩形都逐字节相同——
 * 「不漂移」在结构上成立，不靠调用方自觉。行为是 Floating UI flip/shift 那两条：
 * 放不下就翻到另一侧、永远推回视口内。取舍与出处见 docs/research/2026-09-10-node-composer-placement/prior-art.md。
 *
 * 现役调用方只有 Agent 面板的上下文用量气泡（`ai/v4/AgentPanelV4Context.tsx`）。
 * 画布生成浮框**不用它**：2026-09-25 用户拍板浮框「钉在节点正下方、被挡就挡」，不 clamp、不翻转，
 * 位置由 `NodeGenerationComposer` 按节点尺寸与缩放直接算（同 React Flow `NodeToolbar`）。
 * 当时只为浮框存在的「底部停靠区让位 / 最小内容高度」两个入参随之删除。
 */

/** 屏幕像素矩形。 */
export type AnchoredRect = { left: number; top: number; right: number; bottom: number }
export type AnchoredPlacement = { left: number; top: number; width: number; height: number; side: 'below' | 'above' }

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), Math.max(min, max))

export function resolveAnchoredPlacement(input: {
  /** 可用视口，调用方自己先内缩过边距。 */
  stage: AnchoredRect
  /** 锚点的屏幕矩形。 */
  anchor: AnchoredRect
  /** 内容的自然宽高；两者都会被视口收窄。 */
  width: number
  height: number
  /** 锚点与浮层之间的间距。 */
  gap: number
  /** 翻到上方时额外让出的高度（锚点上沿之外若还挂着东西）。 */
  aboveClearance: number
}): AnchoredPlacement {
  const { stage, anchor, width, height, gap, aboveClearance } = input
  const stageWidth = Math.max(0, stage.right - stage.left)
  const stageHeight = Math.max(0, stage.bottom - stage.top)

  // 宽度：自然宽被视口收窄，再把居中位置推回视口内。左右两侧从不使用——侧挂会让浮层离开锚点正下方。
  const resolvedWidth = Math.min(width, stageWidth)
  const left = clamp((anchor.left + anchor.right - resolvedWidth) / 2, stage.left, stage.right - resolvedWidth)

  // 上下各自剩多少：下方从锚点底边起算，上方还要再让掉 aboveClearance。
  const belowSpace = clamp(stage.bottom - (anchor.bottom + gap), 0, stageHeight)
  const aboveSpace = clamp((anchor.top - gap - aboveClearance) - stage.top, 0, stageHeight)
  // 先要下方（阅读顺序），下方装不下才翻上去；两边都装不下就取大的那侧并压高度。
  const side: AnchoredPlacement['side'] = belowSpace >= Math.min(height, stageHeight) || belowSpace >= aboveSpace ? 'below' : 'above'
  const sideSpace = side === 'below' ? belowSpace : aboveSpace
  // 锚点可能恰好填满整个可用视口。这时两侧空间都是 0，仍要保留内容的自然高度并在视口内 shift；
  // 返回 0 高度会让浮层不可测量、也不可交互。
  const resolvedHeight = sideSpace > 0 ? Math.min(height, sideSpace) : Math.min(height, stageHeight)
  const desiredTop = side === 'below'
    ? anchor.bottom + gap
    : anchor.top - gap - aboveClearance - resolvedHeight
  const top = clamp(desiredTop, stage.top, stage.bottom - resolvedHeight)

  return { left, top, width: resolvedWidth, height: resolvedHeight, side }
}
