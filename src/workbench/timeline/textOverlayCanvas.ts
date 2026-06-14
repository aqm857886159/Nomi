import type { TimelineTextClip } from './timelineTypes'
import { resolveTextBox, wrapTextToWidth } from './textLayout'

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
  const box = resolveTextBox(clip, width, height)
  const innerMaxWidth = box.maxWidthPx - (box.hasBackdrop ? box.fontSizePx * 1.4 : 0)

  ctx.save()
  ctx.font = `${box.fontWeight} ${box.fontSizePx}px ${box.fontFamily}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // 折行用 textLayout 单一规范（word-break:break-word 语义），度量注入 canvas 实测宽 → 与预览断行一致。
  const lines = wrapTextToWidth(content, Math.max(1, innerMaxWidth), (segment) => ctx.measureText(segment).width)
  const lineHeightPx = box.fontSizePx * box.lineHeight
  const textBlockHeight = lines.length * lineHeightPx
  const widestLine = lines.reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0)

  const padX = box.hasBackdrop ? box.fontSizePx * 0.7 : 0
  const padY = box.hasBackdrop ? box.fontSizePx * 0.32 : 0
  const boxWidth = Math.min(box.maxWidthPx, widestLine + padX * 2)
  const boxHeight = textBlockHeight + padY * 2

  // 中心锚点：绕 (centerX, centerY) 摆放（rotation 预留：以后在此 translate→rotate→绘制）。
  const boxLeft = box.centerX - boxWidth / 2
  const boxTop = box.centerY - boxHeight / 2

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
  const firstLineY = box.centerY - textBlockHeight / 2 + lineHeightPx / 2
  lines.forEach((line, index) => {
    ctx.fillText(line, box.centerX, firstLineY + index * lineHeightPx)
  })
  ctx.restore()
}
