// 画布节点标题行上的镜头号（用户 10-10：页面里不再有「去列表」入口，切换只在顶栏那一个图标）：
//   - 镜头号：分镜镜头只显示分镜号（「镜 03」/「<分镜名> · 镜 03」，2026-10-08 用户「只留分镜里的号」），
//     不再显示画布全局号「镜头 N」；默认标题「镜头 N」也不再重复一遍。不是分镜镜头的节点照旧。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { ShotIdentity } from '../../../../electron/shared/canvas/shotNumbering'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import { ShotPreviewOverlays } from '../../generationCanvas/nodes/ConvertShotToVideoButton'
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
  if (!label) return <><ShotPreviewOverlays shotRole={shotRole} />{children}</>
  return (
    <>
      <span data-shot-number data-storyboard-shot-label={label.number} className="inline-flex shrink-0 items-center rounded-nomi-sm border border-nomi-line bg-nomi-paper/90 px-2 py-0.5 font-normal tabular-nums text-nomi-ink pointer-events-none">
        {formatStoryboardShotLabel(t, label)}
      </span>
      {isAutoStoryboardShotTitle(node.title, label.number) ? null : children}
    </>
  )
}
