import type { TimelineTextClip } from './timelineTypes'
import { resolveTextBox } from './textLayout'

const FONT_STACK = 'Inter, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif'

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    if (!paragraph) { out.push(''); continue }
    let line = ''
    // CJK 无空格 → 逐字贪心折行；同时尊重已有空格断点。
    for (const ch of paragraph) {
      const candidate = line + ch
      if (line && ctx.measureText(candidate).width > maxWidth) {
        out.push(line)
        line = ch
      } else {
        line = candidate
      }
    }
    out.push(line)
  }
  return out
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

/**
 * 把一条字幕/标题卡画到 ctx。与预览 DOM 叠加层共用 textLayout 的几何 → 两端一致。
 * 颜色取自设计 token 的实际值（导出是离屏 canvas，拿不到 CSS 变量，按 token 对应值硬绑这一处）。
 */
export function drawTextBox(ctx: CanvasRenderingContext2D, clip: TimelineTextClip, width: number, height: number): void {
  const content = (clip.text || '').trim()
  if (!content) return
  const box = resolveTextBox(clip.style, width, height)
  const innerMaxWidth = box.maxWidthPx - (box.hasBackdrop ? box.fontSizePx * 1.4 : 0)

  ctx.save()
  ctx.font = `${box.fontWeight} ${box.fontSizePx}px ${FONT_STACK}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const lines = wrapLines(ctx, content, Math.max(1, innerMaxWidth))
  const lineHeightPx = box.fontSizePx * box.lineHeight
  const textBlockHeight = lines.length * lineHeightPx
  const widestLine = lines.reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0)

  const padX = box.hasBackdrop ? box.fontSizePx * 0.7 : 0
  const padY = box.hasBackdrop ? box.fontSizePx * 0.32 : 0
  const boxWidth = Math.min(box.maxWidthPx, widestLine + padX * 2)
  const boxHeight = textBlockHeight + padY * 2

  // 文本框的中心 y：caption 锚底（anchorY = 框底），title 锚画布中心。
  const centerY = box.anchor === 'bottom' ? box.anchorY - boxHeight / 2 : box.anchorY
  const boxLeft = box.centerX - boxWidth / 2
  const boxTop = centerY - boxHeight / 2

  if (box.hasBackdrop) {
    roundRectPath(ctx, boxLeft, boxTop, boxWidth, boxHeight, box.fontSizePx * 0.32)
    // --nomi-paper 86% 不透明 + --nomi-line-soft 描边（token 对应值）
    ctx.fillStyle = 'rgba(248, 247, 243, 0.86)'
    ctx.fill()
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(29, 29, 31, 0.10)'
    ctx.stroke()
  }

  ctx.fillStyle = 'rgb(29, 29, 31)' // --nomi-ink
  const firstLineY = centerY - textBlockHeight / 2 + lineHeightPx / 2
  lines.forEach((line, index) => {
    ctx.fillText(line, box.centerX, firstLineY + index * lineHeightPx)
  })
  ctx.restore()
}
