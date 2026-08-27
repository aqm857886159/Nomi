// 多镜节点占位三态的单一挂载点。结果版本已统一进入 NodeResultStack，避免图片/普通视频/多镜视频三套历史 UI。
import React from 'react'

import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { ProductionShotPlaceholder } from './ProductionShotPlaceholder'

export function ProductionShotOverlays({ node }: { node: GenerationCanvasNode; selected: boolean }): JSX.Element {
  return <ProductionShotPlaceholder node={node} />
}
