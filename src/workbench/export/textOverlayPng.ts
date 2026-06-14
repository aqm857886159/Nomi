import type { TimelineState } from '../timeline/timelineTypes'
import { drawTextBox } from '../timeline/textOverlayCanvas'

export type RenderedTextOverlay = {
  id: string
  startFrame: number
  endFrame: number
  /** 全画幅透明 PNG（已含文字几何）的 base64（不含 data: 前缀）。 */
  pngBase64: string
}

/**
 * 把每条字幕/标题卡渲染成「导出分辨率的全画幅透明 PNG」。
 * 主进程 filtergraph 用 overlay 在 [start,end] 区间叠到视频上 → 字幕像素与预览同源（canvas drawTextBox）。
 */
export function renderTextOverlays(timeline: TimelineState, width: number, height: number): RenderedTextOverlay[] {
  if (typeof document === 'undefined') return []
  const overlays: RenderedTextOverlay[] = []
  for (const clip of timeline.textClips ?? []) {
    if (!(clip.text || '').trim()) continue
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(2, Math.round(width))
    canvas.height = Math.max(2, Math.round(height))
    const ctx = canvas.getContext('2d')
    if (!ctx) continue
    drawTextBox(ctx, clip, canvas.width, canvas.height)
    const base64 = (canvas.toDataURL('image/png').split(',')[1] || '').trim()
    if (!base64) continue
    overlays.push({ id: clip.id, startFrame: clip.startFrame, endFrame: clip.endFrame, pngBase64: base64 })
  }
  return overlays
}
