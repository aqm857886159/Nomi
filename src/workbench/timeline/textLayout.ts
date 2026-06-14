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

/**
 * 文字折行的「单一规范」。预览 DOM 用 CSS（white-space:pre-wrap + word-break:break-word）自动折，
 * 导出 canvas（textOverlayCanvas）拿不到 DOM 折行，过去用「逐字贪心」手搓 → 拉丁单词被拦腰截断，
 * 与预览断行不一致（P2）。此函数把 word-break:break-word 的语义集中实现：
 *   1) 显式 `\n` 为硬换行（段落）；空段落保留为空行。
 *   2) 段内按空格断词，优先整词换行（不截断单词）——尽量同行装箱（贪心）。
 *   3) 单个词放不进限宽时逐字断（覆盖 CJK 无空格、长 URL/长串）——绝不丢字。
 * measure 由调用方注入（canvas 传 ctx.measureText(t).width；测试传等宽度量），故纯函数可测、与渲染同度量。
 */
export function wrapTextToWidth(
  text: string,
  maxWidth: number,
  measure: (segment: string) => number,
): string[] {
  const limit = Math.max(1, maxWidth)
  const out: string[] = []

  // 一个词若超过限宽，逐字切成多段（最后一段返回，供继续与后续词拼行）。
  const breakLongWord = (word: string): { lines: string[]; tail: string } => {
    const lines: string[] = []
    let segment = ''
    for (const ch of word) {
      const candidate = segment + ch
      if (segment && measure(candidate) > limit) {
        lines.push(segment)
        segment = ch
      } else {
        segment = candidate
      }
    }
    return { lines, tail: segment }
  }

  for (const paragraph of text.split('\n')) {
    if (!paragraph) {
      out.push('')
      continue
    }
    let line = ''
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word
      if (!line) {
        // 行首：词能放下就放；放不下逐字断，末段留作行首继续。
        if (measure(word) <= limit) {
          line = word
        } else {
          const { lines, tail } = breakLongWord(word)
          out.push(...lines)
          line = tail
        }
        continue
      }
      if (measure(candidate) <= limit) {
        line = candidate
        continue
      }
      // 加这个词超宽 → 当前行落定，词另起。
      out.push(line)
      if (measure(word) <= limit) {
        line = word
      } else {
        const { lines, tail } = breakLongWord(word)
        out.push(...lines)
        line = tail
      }
    }
    out.push(line)
  }
  return out
}

/** 字幕默认时长（秒）——加一条字幕/标题卡时的默认可见区间。 */
export const DEFAULT_TEXT_CLIP_SECONDS = 3

export function defaultTextForStyle(style: TimelineTextStyle): string {
  return style === 'title' ? '标题' : '字幕文字'
}
