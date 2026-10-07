// 多镜节点占位三态的单一挂载点。结果版本统一由节点自己的版本卡片（versionCards/NodeVersionCardsHost）铺开，避免图片/普通视频/多镜视频三套历史 UI。
import React, { type JSX } from 'react'

import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { ProductionShotPlaceholder } from './ProductionShotPlaceholder'

export function ProductionShotOverlays({ node, reportFeedback }: { reportFeedback: (message: string) => void; node: GenerationCanvasNode; selected: boolean }): JSX.Element {
  return <ProductionShotPlaceholder reportFeedback={reportFeedback} node={node} />
}
