// 取景（fit / 缩放 / 平移）——预览、WebM canvas、ffmpeg filtergraph 三处渲染共用的单一公式。
//
// 这是 P0-5「所见即所得」的真相源：取景从 `TimelinePreview` 局部 state 提升为 `TimelineClip.framing`
// 的一等数据，导出据此复现预览构图。三处实现数学等价（已用真 ffmpeg 验证几何一致）：
//   - 预览（DOM/CSS）：object-fit contain/cover + transform translate/scale（px = frac × stageSize）。
//   - WebM canvas：computeFramedRect() 数值计算 + drawImage。
//   - filtergraph：ffmpeg 运行期表达式 scale=w='F*iw':h='F*ih' + overlay=x='(main_w-overlay_w)/2+ox*main_w'。

export type ClipFit = 'contain' | 'cover'

export type ClipFraming = {
  /** contain=适应（整画面内缩、留白边）/ cover=填充（铺满、裁边）。基准 fit。 */
  fit: ClipFit
  /** 在基准 fit 之上的额外缩放倍数（1 = 原样）。绕中心缩放。 */
  scale: number
  /** 平移：帧宽的归一化分数（非像素，正=右）。stage 尺寸≠导出分辨率，钉死像素会跨分辨率漂移。 */
  offsetX: number
  /** 平移：帧高的归一化分数（正=下）。 */
  offsetY: number
}

export const DEFAULT_CLIP_FRAMING: ClipFraming = { fit: 'contain', scale: 1, offsetX: 0, offsetY: 0 }

// 与预览 clampPreviewScale 同步：缩放上下限 [0.25, 4]。
const SCALE_MIN = 0.25
const SCALE_MAX = 4

export function clampFramingScale(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(SCALE_MIN, Math.min(SCALE_MAX, value))
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** 从 clip 读出完整 framing（缺省补默认、清洗非法值、缩放 clamp）。clip 只需带可选 framing。 */
export function resolveClipFraming(clip: { framing?: Partial<ClipFraming> } | undefined): ClipFraming {
  const framing = clip?.framing
  if (!framing) return { ...DEFAULT_CLIP_FRAMING }
  return {
    fit: framing.fit === 'cover' ? 'cover' : 'contain',
    scale: clampFramingScale(finiteOr(framing.scale, DEFAULT_CLIP_FRAMING.scale)),
    offsetX: finiteOr(framing.offsetX, DEFAULT_CLIP_FRAMING.offsetX),
    offsetY: finiteOr(framing.offsetY, DEFAULT_CLIP_FRAMING.offsetY),
  }
}

/** framing 是否等同默认（用于 manifest 仅在非默认时才写 transform，省体积、保旧测试）。 */
export function isDefaultFraming(framing: ClipFraming): boolean {
  return (
    framing.fit === DEFAULT_CLIP_FRAMING.fit &&
    framing.scale === DEFAULT_CLIP_FRAMING.scale &&
    framing.offsetX === DEFAULT_CLIP_FRAMING.offsetX &&
    framing.offsetY === DEFAULT_CLIP_FRAMING.offsetY
  )
}

export type FramedRect = { x: number; y: number; width: number; height: number }

/**
 * 把源 sourceW×sourceH 按 framing 摆进帧 frameW×frameH，返回目标矩形（可超出帧边，由调用方裁切）。
 * factor = (contain? min : max)(frameW/sw, frameH/sh) × scale；居中后加 offset（帧尺寸的分数）。
 */
export function computeFramedRect(
  framing: ClipFraming,
  frameW: number,
  frameH: number,
  sourceW: number,
  sourceH: number,
): FramedRect {
  if (sourceW <= 0 || sourceH <= 0 || frameW <= 0 || frameH <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  const fitFactor = framing.fit === 'cover'
    ? Math.max(frameW / sourceW, frameH / sourceH)
    : Math.min(frameW / sourceW, frameH / sourceH)
  const factor = fitFactor * framing.scale
  const width = sourceW * factor
  const height = sourceH * factor
  const x = (frameW - width) / 2 + framing.offsetX * frameW
  const y = (frameH - height) / 2 + framing.offsetY * frameH
  return { x, y, width, height }
}
