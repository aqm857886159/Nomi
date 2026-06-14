import type { TimelineTextClip, TimelineTextStyle } from './timelineTypes'
import { clampScale, type OverlayTransform, type Vec2 } from './overlayTransform'
import { resolveFontStack } from './textFonts'

/**
 * 文字叠加层的「唯一」布局规范。预览 DOM、导出 PNG、WebM 回退 canvas 三处都消费它，
 * 几何全用「占画布宽/高的比例」表达 → 不同分辨率/不同渲染器下字号位置一致（杜绝漂移）。
 * 中心锚点：position 即元素中心；style 只给「默认中心 + 基准字号」，拖动/缩放后用 clip 的 transform。
 */
export type TextLayoutSpec = {
  /** 基准字号 = 画布宽 × 此比例（再乘 scale）*/
  fontSizeFrac: number
  /** 文本框最大宽 = 画布宽 × 此比例（再乘 scale）*/
  maxWidthFrac: number
  /** 预设中心（归一化）——caption 下三分之一、title 居中。仅作初始落点，存进 position 后即与手拖无差别。*/
  defaultCenter: Vec2
  /** 是否带半透明底卡 */
  hasBackdrop: boolean
  fontWeight: number
  lineHeight: number
}

export function getTextLayoutSpec(style: TimelineTextStyle): TextLayoutSpec {
  if (style === 'title') {
    return { fontSizeFrac: 0.062, maxWidthFrac: 0.86, defaultCenter: { x: 0.5, y: 0.5 }, hasBackdrop: true, fontWeight: 600, lineHeight: 1.2 }
  }
  return { fontSizeFrac: 0.04, maxWidthFrac: 0.82, defaultCenter: { x: 0.5, y: 0.86 }, hasBackdrop: true, fontWeight: 600, lineHeight: 1.3 }
}

/** 解析 clip 的有效变换：position/scale 缺省 → 用 style 预设。rotation 预留默认 0。 */
export function resolveOverlayTransform(clip: TimelineTextClip): OverlayTransform {
  const spec = getTextLayoutSpec(clip.style)
  return {
    position: clip.position ?? spec.defaultCenter,
    scale: clampScale(clip.scale ?? 1),
    rotation: clip.rotation ?? 0,
  }
}

/** 解析到具体像素（给定画布宽高）。canvas / 离屏 PNG / DOM 叠加层共用。中心锚点。 */
export type ResolvedTextBox = {
  fontSizePx: number
  maxWidthPx: number
  /** 文本框中心（像素）*/
  centerX: number
  centerY: number
  rotation: number
  hasBackdrop: boolean
  fontWeight: number
  lineHeight: number
  /** 解析后的 CSS font stack（预览 DOM 与导出 canvas 共用）*/
  fontFamily: string
}

export function resolveTextBox(clip: TimelineTextClip, width: number, height: number): ResolvedTextBox {
  const spec = getTextLayoutSpec(clip.style)
  const t = resolveOverlayTransform(clip)
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  return {
    fontSizePx: Math.max(11, Math.round(safeWidth * spec.fontSizeFrac * t.scale)),
    maxWidthPx: Math.round(Math.min(safeWidth * 0.96, safeWidth * spec.maxWidthFrac * t.scale)),
    centerX: t.position.x * safeWidth,
    centerY: t.position.y * safeHeight,
    rotation: t.rotation,
    hasBackdrop: spec.hasBackdrop,
    fontWeight: spec.fontWeight,
    lineHeight: spec.lineHeight,
    fontFamily: resolveFontStack(clip.fontFamily),
  }
}

/** 字幕默认时长（秒）——加一条字幕/标题卡时的默认可见区间。 */
export const DEFAULT_TEXT_CLIP_SECONDS = 3

export function defaultTextForStyle(style: TimelineTextStyle): string {
  return style === 'title' ? '标题' : '字幕文字'
}
