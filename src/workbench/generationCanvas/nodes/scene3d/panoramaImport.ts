export const PANORAMA_IMPORT_MAX_BYTES = 80 * 1024 * 1024
export const PANORAMA_STANDARD_RATIO = 2
export const PANORAMA_RATIO_TOLERANCE = 0.03

export type ImageDimensions = {
  width: number
  height: number
}

/**
 * 2:1 经纬度标准比例（±3%）。非标准图不拒收——equirect 映射对任意比例只是拉伸采样，
 * 渲染安全（scene3dEnvironment 有资源边界兜底），所以只降级为「可能拉伸」的警告。
 */
export function isStandardPanoramaDimensions(dimensions: ImageDimensions): boolean {
  if (dimensions.height <= 0) return false
  return Math.abs(dimensions.width / dimensions.height - PANORAMA_STANDARD_RATIO) <= PANORAMA_RATIO_TOLERANCE
}
