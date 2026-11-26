import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconStack2 } from '@tabler/icons-react'
import { ICON_TIERS } from '../../../design'
import { useWorkbenchStore } from '../../workbenchStore'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { readLayerSplitMark } from './whiteboard/whiteboardState'

/**
 * 拆完的节点下方一行「N 层」（板 2026-11-26-layer-split · layers.node-status；裁定 C-E8 叠层图标）。
 * 只是状态、不是开关：不是按钮、点它什么都不展开（编辑图层走浮条「画板」）。位置照节点框外标签行的规矩，
 * 贴在节点框正下方、不压画面；缩放 < 40% 和标签行一起隐藏（远景不放控件）。数读结果自带的标记（landTaskResults 写的那一份）。
 */
export function NodeLayerSplitStatus({ node }: { node: Pick<GenerationCanvasNode, 'result'> }): JSX.Element | null {
  const { t } = useTranslation()
  const zoom = useWorkbenchStore((state) => state.categoryViewports[state.activeCategoryId]?.zoom ?? 1)
  const mark = readLayerSplitMark(node.result)
  if (!mark) return null
  return (
    <div
      data-node-layer-split-status={mark.layers}
      aria-label={t('generationCommon.layerSplitComposer.nodeStatusAria', { count: mark.layers })}
      className="pointer-events-none absolute left-0 top-[calc(100%+6px)] z-[4] inline-flex h-6 items-center gap-1 rounded-pill bg-nomi-ink-05 px-2 text-caption text-nomi-ink-60"
      style={{ visibility: zoom < 0.4 ? 'hidden' : undefined }}
    >
      <IconStack2 size={ICON_TIERS.corner.size} stroke={ICON_TIERS.corner.stroke} aria-hidden />
      <span>{t('generationCommon.layerSplitComposer.nodeStatus', { count: mark.layers })}</span>
    </div>
  )
}
