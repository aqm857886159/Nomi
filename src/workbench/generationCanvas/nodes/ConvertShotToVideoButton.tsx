import React from 'react'
import { useTranslation } from 'react-i18next'

/**
 * 分镜预览层的两件 overlay（从 BaseGenerationNode 抽出，R9/R12 防巨壳）：
 * ① 「镜头 N」常显角标——补「生成出画面 / 选中」两个缺口（占位卡消失后编号不再蒸发，
 *    用户反馈「分镜没有 1/2/3」）；未生成未选中时由 PendingGenerationPlaceholder 自显，互斥不重复。
 * ② 图片镜头的「转视频」入口已移除：图片提示词和视频提示词不是同一意图，
 *    在没有独立视频提示词编辑器前不再把错误提示词搬到新节点。
 */
export function ShotPreviewOverlays({
  selected,
  shotIndex,
  hasResult,
}: {
  selected: boolean
  shotIndex: number | null
  hasResult: boolean
}): JSX.Element | null {
  const { t } = useTranslation()
  if (shotIndex == null) return null
  return (
    <>
      {hasResult || selected ? (
        <span className="absolute top-1.5 left-1.5 z-[3] inline-flex items-center h-[18px] px-2 rounded-full bg-nomi-ink/85 text-nomi-paper text-micro font-bold tabular-nums pointer-events-none shadow-nomi-sm backdrop-blur-[2px]">
          {t('generationCommon.shotConversion.shot', { index: shotIndex })}
        </span>
      ) : null}
    </>
  )
}
