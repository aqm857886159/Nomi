// 画布节点上与列表相关的两件小东西：
//   - 镜头号：分镜镜头只显示分镜号（「镜 03」/「<分镜名> · 镜 03」，2026-10-08 用户「只留分镜里的号」），
//     不再显示画布全局号「镜头 N」；默认标题「镜头 N」也不再重复一遍。不是分镜镜头的节点照旧。
//   - 选中时标题行右端的「在列表里看」：切到列表并打开这一张。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconLayoutList } from '@tabler/icons-react'
import type { ShotIdentity } from '../../../../electron/shared/canvas/shotNumbering'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import { ShotPreviewOverlays } from '../../generationCanvas/nodes/ConvertShotToVideoButton'
import { generationListRole } from './generationListModel'
import { useGenerationViewStore } from './generationViewStore'
import { formatStoryboardShotLabel, isAutoStoryboardShotTitle, useStoryboardShotLabel } from './storyboardLabels'

/**
 * 节点框外标题行里的镜头号 + 标题（`children` = 标题件）。
 * 分镜镜头：分镜号一枚（同 ShotPreviewOverlays 的样子），标题是落画布时的默认「镜头 N」就不再显示；
 * 其余节点：原样交给 ShotPreviewOverlays（全局号 / 首帧图 / 视频）。
 */
export function NodeShotLabel({ node, shotIndex, shotRole, children }: {
  node: GenerationCanvasNode
  shotIndex?: number | null
  shotRole?: ShotIdentity['shotRole']
  children?: React.ReactNode
}): JSX.Element {
  const { t } = useTranslation()
  const label = useStoryboardShotLabel(node)
  if (!label) return <><ShotPreviewOverlays shotIndex={shotIndex} shotRole={shotRole} />{children}</>
  return (
    <>
      <span data-shot-number data-storyboard-shot-label={label.number} className="inline-flex shrink-0 items-center rounded-nomi-sm border border-nomi-line bg-nomi-paper/90 px-2 py-0.5 font-normal tabular-nums text-nomi-ink pointer-events-none">
        {formatStoryboardShotLabel(t, label)}
      </span>
      {isAutoStoryboardShotTitle(node.title, label.number) ? null : children}
    </>
  )
}

export function ViewInListButton({ node }: { node: GenerationCanvasNode }): JSX.Element | null {
  const { t } = useTranslation()
  if (generationListRole(node) === 'asset') return null
  return (
    <>
    <span className="min-w-0 flex-1" aria-hidden />
    <button
      type="button"
      data-view-in-list={node.id}
      className="nodrag inline-flex shrink-0 items-center gap-1 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-1.5 py-0.5 text-caption text-nomi-accent hover:bg-nomi-accent-soft"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        useGenerationViewStore.getState().openListAt(node.id)
      }}
    >
      <IconLayoutList size={13} stroke={1.7} aria-hidden />
      {t('generationList.viewInList')}
    </button>
    </>
  )
}
