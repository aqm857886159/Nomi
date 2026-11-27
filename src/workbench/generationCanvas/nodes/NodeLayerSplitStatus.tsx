import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconStack2 } from '@tabler/icons-react'
import { ICON_TIERS } from '../../../design'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { readLayerSplitMark } from './whiteboard/whiteboardState'

/**
 * 拆完的节点标签行里紧跟标题的「N 层」（板 2026-11-26-layer-split · layers.node-status；裁定 C-E8 叠层图标，位置 C-D12）。
 * 只是状态、不是开关：不是按钮、点它什么都不展开（编辑图层走浮条「画板」）。
 * 位置：节点上方的标签行（NodeLabelRow 的子元素），和同一节点生成前的「已备好 · 未生成」是同一处状态的前后两态——
 * 那一枚要求还没有结果，这一枚要求结果上带图层标记，两枚结构上不会同时出现。不放节点框下方：选中时生成框钉在节点正下方（用户 09-25），会盖住那一行。
 * 缩放 < 40% 随标签行一起隐藏（远景不放控件），这里不自己读缩放；长标题时照标签行的截断规则让（标题截断、本枚不缩）。
 * 数读结果自带的标记（landTaskResults 写的那一份）。
 */
export function NodeLayerSplitStatus({ node }: { node: Pick<GenerationCanvasNode, 'result'> }): JSX.Element | null {
  const { t } = useTranslation()
  const mark = readLayerSplitMark(node.result)
  if (!mark) return null
  return (
    <span
      data-node-layer-split-status={mark.layers}
      data-board="layers.node-status"
      aria-label={t('generationCommon.layerSplitComposer.nodeStatusAria', { count: mark.layers })}
      className="pointer-events-none inline-flex h-6 shrink-0 items-center gap-1 rounded-pill bg-nomi-ink-05 px-2 text-caption text-nomi-ink-60"
    >
      <IconStack2 size={ICON_TIERS.corner.size} stroke={ICON_TIERS.corner.stroke} aria-hidden />
      <span>{t('generationCommon.layerSplitComposer.nodeStatus', { count: mark.layers })}</span>
    </span>
  )
}
