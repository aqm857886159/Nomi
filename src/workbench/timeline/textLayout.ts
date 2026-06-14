import type { TimelineTextStyle } from './timelineTypes'

/**
 * 文字叠加层的「唯一」布局规范。预览 DOM、导出 PNG、WebM 回退 canvas 三处都消费它，
 * 几何全用「占画布宽/高的比例」表达 → 不同分辨率/不同渲染器下字号位置一致（杜绝漂移）。
 */
export type TextLayoutSpec = {
  /** 字号 = 画布宽 × 此比例 */
  fontSizeFrac: number
  /** 文本框最大宽 = 画布宽 × 此比例 */
  maxWidthFrac: number
  /** 垂直锚点：caption 贴底、title 居中 */
  anchor: 'bottom' | 'center'
  /** anchor=bottom 时，文本框底边到画布底的距离 = 画布高 × 此比例 */
  bottomFrac: number
  /** 是否带半透明底卡（字幕有、标题卡无）*/
  hasBackdrop: boolean
  fontWeight: number
  lineHeight: number
}

export function getTextLayoutSpec(style: TimelineTextStyle): TextLayoutSpec {
  if (style === 'title') {
    // 标题卡也带底卡（更淡）——保证任意画面背景下都可读；居中大字。
    return { fontSizeFrac: 0.062, maxWidthFrac: 0.86, anchor: 'center', bottomFrac: 0, hasBackdrop: true, fontWeight: 600, lineHeight: 1.2 }
  }
  return { fontSizeFrac: 0.04, maxWidthFrac: 0.82, anchor: 'bottom', bottomFrac: 0.08, hasBackdrop: true, fontWeight: 600, lineHeight: 1.3 }
}

/** 解析到具体像素（给定画布宽高）。canvas / 离屏 PNG / DOM 叠加层共用。 */
export type ResolvedTextBox = {
  fontSizePx: number
  maxWidthPx: number
  /** 文本框水平居中 → 中心 x */
  centerX: number
  anchor: 'bottom' | 'center'
  /** anchor=bottom：文本框底边 y；anchor=center：画布中心 y */
  anchorY: number
  bottomMarginPx: number
  hasBackdrop: boolean
  fontWeight: number
  lineHeight: number
}

export function resolveTextBox(style: TimelineTextStyle, width: number, height: number): ResolvedTextBox {
  const spec = getTextLayoutSpec(style)
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const bottomMarginPx = Math.round(safeHeight * spec.bottomFrac)
  return {
    fontSizePx: Math.max(11, Math.round(safeWidth * spec.fontSizeFrac)),
    maxWidthPx: Math.round(safeWidth * spec.maxWidthFrac),
    centerX: safeWidth / 2,
    anchor: spec.anchor,
    anchorY: spec.anchor === 'bottom' ? safeHeight - bottomMarginPx : safeHeight / 2,
    bottomMarginPx,
    hasBackdrop: spec.hasBackdrop,
    fontWeight: spec.fontWeight,
    lineHeight: spec.lineHeight,
  }
}

/** 字幕默认时长（秒）——加一条字幕/标题卡时的默认可见区间。 */
export const DEFAULT_TEXT_CLIP_SECONDS = 3

export function defaultTextForStyle(style: TimelineTextStyle): string {
  return style === 'title' ? '标题' : '字幕文字'
}
