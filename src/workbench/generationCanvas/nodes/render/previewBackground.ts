import { CHECKERBOARD_BG_CLASS, STRIPED_BG_CLASS } from './CardCommon'

/**
 * 节点预览区的底纹：没出图时是斜纹占位（有结果后节点尺寸已贴合图片比例，不再露底纹，免得图外面套一层框）；
 * 抠图出来的透明图垫棋盘格；别的图不垫。
 */
export function previewBackgroundClass(hasResult: boolean, transparentCutout: boolean): string | false {
  if (!hasResult) return STRIPED_BG_CLASS
  return transparentCutout && CHECKERBOARD_BG_CLASS
}
