/**
 * [INPUT]: 无依赖
 * [INPUT]: ../../../../../../electron/shared/contracts/mediaImportPolicy（MEDIA_IMPORT_SURFACES）
 * [OUTPUT]: 对外提供 PANORAMA_IMPORT_MAX_BYTES、PANORAMA_STANDARD_RATIO、PANORAMA_RATIO_TOLERANCE、ImageDimensions、isStandardPanoramaDimensions
 * [POS]: director/panels 的 720 全景导入校验常量（原 V1 panoramaImport，切换门入籍）：2:1 经纬度标准比例 ±3%，
 *        非标准图不拒收——equirect 映射对任意比例只是拉伸采样，只降级成「可能拉伸」的软警告。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { MEDIA_IMPORT_SURFACES } from '../../../../../../electron/shared/contracts/mediaImportPolicy'

// 上限不再写在这里：由 mediaImportPolicy 的 'panorama' 面声明（含领域理由：整张图要一次性
// 上传成 WebGL 纹理，受 GPU 单纹理内存约束）。本文件只转出，避免调用点改 import 路径。
export const PANORAMA_IMPORT_MAX_BYTES = MEDIA_IMPORT_SURFACES.panorama.hardCapBytes ?? Number.POSITIVE_INFINITY
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
