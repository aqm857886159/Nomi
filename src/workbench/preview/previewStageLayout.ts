// 预览舞台尺寸计算(纯函数,从 TimelinePreview 拆出——巨壳门岗:该组件已达 800 行硬上限)。
// 按容器尺寸 + 画幅比例 contain 适配出舞台像素宽高,带最大宽度上限。

export const PREVIEW_MAX_STAGE_WIDTH = 1040

export function fitPreviewStageSize(params: {
  containerWidth: number
  containerHeight: number
  ratioWidth: number
  ratioHeight: number
  maxWidth?: number
}): { width: number; height: number } {
  const containerWidth = Math.max(0, Number(params.containerWidth) || 0)
  const containerHeight = Math.max(0, Number(params.containerHeight) || 0)
  const ratioWidth = Math.max(1, Number(params.ratioWidth) || 1)
  const ratioHeight = Math.max(1, Number(params.ratioHeight) || 1)
  const maxWidth = Math.max(1, Number(params.maxWidth) || PREVIEW_MAX_STAGE_WIDTH)
  if (containerWidth <= 0 || containerHeight <= 0) {
    return { width: 0, height: 0 }
  }

  const ratio = ratioWidth / ratioHeight
  let width = Math.min(containerWidth, maxWidth, containerHeight * ratio)
  let height = width / ratio
  if (height > containerHeight) {
    height = containerHeight
    width = height * ratio
  }
  return {
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(height)),
  }
}
