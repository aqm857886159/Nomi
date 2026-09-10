/**
 * [INPUT]: 依赖 react
 * [OUTPUT]: 对外提供 CanvasImage、CanvasImagesContext、useCanvasImages()、EMPTY_CANVAS_IMAGES
 * [POS]: director/panels 的「画布图片选择器」数据源：画布上所有带结果图的 Image 节点（DirectorEditor 由节点注入），AI 搭场景挑参考图用；
 *        与 LinkedAssetsContext（连线引用）区分——这里是全画布不看连线。开发入口为空。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'

import type { CanvasImage } from '../bridge/canvasImages'
export type { CanvasImage } from '../bridge/canvasImages'

export const EMPTY_CANVAS_IMAGES: readonly CanvasImage[] = []

export const CanvasImagesContext = React.createContext<readonly CanvasImage[]>(EMPTY_CANVAS_IMAGES)

export function useCanvasImages(): readonly CanvasImage[] {
  return React.useContext(CanvasImagesContext)
}
