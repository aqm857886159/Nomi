import React, { type JSX } from 'react'
import type { ShotIdentity } from '../../../../electron/shared/canvas/shotNumbering'
import { useTranslation } from 'react-i18next'

/** 首帧图 / 视频的角色标签（由框外 NodeLabelRow 定位）。**不再有镜号**：分镜镜头的号只来自 storyboardShotLabel，没挂在分镜上的节点没有镜号。 */
export function ShotPreviewOverlays({
  shotRole,
}: {
  shotRole?: ShotIdentity['shotRole']
}): JSX.Element | null {
  const { t } = useTranslation()
  const role = shotRole === 'first_frame' ? t('generationCommon.shotConversion.firstFrame')
    : shotRole === 'video' ? t('generationCommon.shotConversion.video') : ''
  if (!role) return null
  return (
    <span data-shot-number className="inline-flex shrink-0 items-center rounded-nomi-sm border border-nomi-line bg-nomi-paper/90 px-2 py-0.5 text-nomi-ink font-normal tabular-nums pointer-events-none">
      {role}
    </span>
  )
}
