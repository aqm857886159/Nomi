import type React from 'react'
import type { ClipFraming } from '../timeline/clipFraming'

// 预览取景 → DOM 表现的纯函数（从 TimelinePreview 抽出，守 800 行门岗）。
// 与 WebM canvas computeFramedRect / filtergraph 表达式同一套取景语义。

type StageSize = { width: number; height: number } | null

/** 取景（frac 偏移 + 缩放）→ 媒体元素 transform。stage 尺寸把归一化偏移还原成 px。 */
export function framingToMediaStyle(framing: ClipFraming, stageSize: StageSize): React.CSSProperties {
  const offsetX = stageSize ? framing.offsetX * stageSize.width : 0
  const offsetY = stageSize ? framing.offsetY * stageSize.height : 0
  return { transform: `translate(${offsetX}px, ${offsetY}px) scale(${framing.scale})` }
}

/** 「适应」=contain（object-contain，留边）/「填充」=cover（object-cover，铺满裁边）。 */
export function mediaFitClass(framing: ClipFraming): string {
  return framing.fit === 'cover' ? 'object-cover' : 'object-contain'
}

/** 拖动像素位移 → 归一化偏移（除以 stage 尺寸）。stage 未测量时返回原偏移。 */
export function framingOffsetFromDrag(
  origin: { originOffsetX: number; originOffsetY: number },
  deltaPx: { x: number; y: number },
  stageSize: StageSize,
): { offsetX: number; offsetY: number } {
  if (!stageSize) return { offsetX: origin.originOffsetX, offsetY: origin.originOffsetY }
  return {
    offsetX: origin.originOffsetX + deltaPx.x / stageSize.width,
    offsetY: origin.originOffsetY + deltaPx.y / stageSize.height,
  }
}
