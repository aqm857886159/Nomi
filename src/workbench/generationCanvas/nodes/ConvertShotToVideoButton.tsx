import React from 'react'
import { useTranslation } from 'react-i18next'

/** 镜头号由框外 NodeLabelRow 定位，不随选择或生成状态换位。 */
export function ShotPreviewOverlays({
  shotIndex,
}: {
  shotIndex: number | null
}): JSX.Element | null {
  const { t } = useTranslation()
  if (shotIndex == null) return null
  return (
    <span data-shot-number className="inline-flex shrink-0 items-center rounded-nomi-sm border border-nomi-line bg-nomi-paper/90 px-2 py-0.5 text-nomi-ink font-normal tabular-nums pointer-events-none">
      {t('generationCommon.shotConversion.shot', { index: shotIndex })}
    </span>
  )
}
