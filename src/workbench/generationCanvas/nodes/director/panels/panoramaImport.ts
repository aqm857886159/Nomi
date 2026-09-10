/**
 * [INPUT]: 无依赖
 * [OUTPUT]: 对外提供 PANORAMA_IMPORT_MAX_BYTES、PANORAMA_STANDARD_RATIO、PANORAMA_RATIO_TOLERANCE、ImageDimensions、isStandardPanoramaDimensions
 * [POS]: director/panels 的 720 全景导入校验常量（原 V1 panoramaImport，切换门入籍）：2:1 经纬度标准比例 ±3%，
 *        非标准图不拒收——equirect 映射对任意比例只是拉伸采样，只降级成「可能拉伸」的软警告。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export const PANORAMA_IMPORT_MAX_BYTES = 80 * 1024 * 1024
export const PANORAMA_STANDARD_RATIO = 2
export const PANORAMA_RATIO_TOLERANCE = 0.03

export type ImageDimensions = {
  width: number
  height: number
}

export function isStandardPanoramaDimensions(dimensions: ImageDimensions): boolean {
  if (dimensions.height <= 0) return false
  return Math.abs(dimensions.width / dimensions.height - PANORAMA_STANDARD_RATIO) <= PANORAMA_RATIO_TOLERANCE
}
