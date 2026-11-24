// 画布节点标题行上的镜头号（用户 10-10：页面里不再有「去列表」入口，切换只在顶栏那一个图标）：
//   - 镜头号：分镜镜头只显示分镜号（「镜 03」/「<分镜名> · 镜 03」，2026-10-08 用户「只留分镜里的号」），
//     不再显示画布全局号「镜头 N」；默认标题「镜头 N」也不再重复一遍。不是分镜镜头的节点照旧。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { ShotIdentity } from '../../../../electron/shared/canvas/shotNumbering'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import { ShotPreviewOverlays } from '../../generationCanvas/nodes/ConvertShotToVideoButton'
import { cn } from '../../../utils/cn'
import { formatStoryboardShotLabel, isAutoStoryboardShotTitle, useStoryboardShotLabel } from './storyboardLabels'

/**
 * 节点框外标题行里的镜头号 + 标题（`children` = 标题件）。
 * 分镜镜头：分镜号一枚（同 ShotPreviewOverlays 的样子），标题是落画布时的默认「镜头 N」就不再显示；
 * 其余节点：没有镜号，只剩 ShotPreviewOverlays 的角色标签（首帧图 / 视频）；画布全局 shotIndex 只作内部排序键。
 */
export function NodeShotLabel({ node, shotRole, children }: {
  node: GenerationCanvasNode
  shotRole?: ShotIdentity['shotRole']
  children?: React.ReactNode
}): JSX.Element {
  const { t } = useTranslation()
  const label = useStoryboardShotLabel(node)
  if (!label) {
    const titleShowsRole = children && shotRole === 'video' && node.title?.trim() === t('generationCommon.shotConversion.video')
    return <>{!titleShowsRole && <ShotPreviewOverlays shotRole={shotRole} />}{children}</>
  }
  return (
    <>
      <ShotNumberPill attributes={{ 'data-shot-number': 'true', 'data-storyboard-shot-label': String(label.number) }}>{formatStoryboardShotLabel(t, label)}</ShotNumberPill>
      {isAutoStoryboardShotTitle(node.title, label.number) ? null : children}
    </>
  )
}

/**
 * 镜号那一枚小胶囊（边线、圆角、字号同标题行）。聊天里的指向元素在节点已删除时只剩宿主给的镜号快照，
 * 也画这一枚（2026-10-23 D2），样子只有这一份。
 */
export function ShotNumberPill({ children, className, attributes }: {
  children: React.ReactNode
  className?: string
  attributes?: { [key: `data-${string}`]: string | undefined }
}): JSX.Element {
  return (
    <span {...attributes} className={cn('inline-flex shrink-0 items-center rounded-nomi-sm border border-nomi-line bg-nomi-paper/90 px-2 py-0.5 font-normal tabular-nums text-nomi-ink pointer-events-none', className)}>
      {children}
    </span>
  )
}
