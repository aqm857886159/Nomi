import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconMinus, IconPlus } from '@tabler/icons-react'
import { NomiSelect, WorkbenchIconButton } from '../../design'
import { cn } from '../../utils/cn'
import { useWorkbenchStore } from '../workbenchStore'
import type { TimelineState } from '../timeline/timelineTypes'
import { resolveOverlayTransform } from '../timeline/textLayout'
import { TEXT_FONTS, DEFAULT_TEXT_FONT_ID } from '../timeline/textFonts'
import { SCALE_MIN, SCALE_MAX } from '../timeline/overlayTransform'
import { CONTROL_ICON_BUTTON_CLASS } from './previewControlTokens'

type Props = {
  timeline: TimelineState
  selectedTextClipId: string
}

// 预览控制条：选中字幕/标题 clip 时的样式控件（字号 + 字体）。
// 停留时长改在时间轴文字轨上拖 clip 左右边缘调整（TimelineTextTrack），不在此控制条。
// 从 TimelinePreview 抽出，保持壳瘦身（R9）；无选中 clip 时渲染 null。
export function TextClipStyleControls({ timeline, selectedTextClipId }: Props): JSX.Element | null {
  const { t } = useTranslation()
  const updateTimelineTextClipTransform = useWorkbenchStore((state) => state.updateTimelineTextClipTransform)
  const updateTimelineTextClipFont = useWorkbenchStore((state) => state.updateTimelineTextClipFont)

  const [sizePctDraft, setSizePctDraft] = React.useState('')

  const selectedTextClip = (timeline.textClips ?? []).find((clip) => clip.id === selectedTextClipId) || null
  const selectedTextScale = selectedTextClip ? resolveOverlayTransform(selectedTextClip).scale : 1
  const selectedTextFontId = selectedTextClip?.fontFamily ?? DEFAULT_TEXT_FONT_ID
  const selectedSizePct = Math.round(selectedTextScale * 100)

  // 字号输入框：未聚焦跟随真实 scale，聚焦编辑用本地 draft。
  React.useEffect(() => {
    setSizePctDraft(String(selectedSizePct))
  }, [selectedSizePct, selectedTextClipId])

  const applyTextScale = React.useCallback(
    (scale: number) => {
      if (!selectedTextClipId) return
      updateTimelineTextClipTransform(
        selectedTextClipId,
        { scale: Math.min(SCALE_MAX, Math.max(SCALE_MIN, scale)) },
        { commit: true },
      )
    },
    [selectedTextClipId, updateTimelineTextClipTransform],
  )

  const commitSizePct = React.useCallback(() => {
    const pct = Number(sizePctDraft)
    if (Number.isFinite(pct) && pct > 0) applyTextScale(pct / 100)
  }, [applyTextScale, sizePctDraft])

  if (!selectedTextClip) return null

  return (
    <>
      <div
        className={cn('workbench-preview-player__control-separator', 'w-px h-5 bg-[var(--workbench-border-soft)]')}
        aria-hidden="true"
      />
      <div
        className={cn('workbench-preview-player__text-style', 'flex-none inline-flex items-center gap-1.5')}
        aria-label={t('timelinePreview.textStyle.aria')}
      >
        <span className="text-micro text-[var(--workbench-muted)] font-bold">
          {t('timelinePreview.textStyle.size')}
        </span>
        <div className="inline-flex items-center gap-1">
          <WorkbenchIconButton
            className={cn(CONTROL_ICON_BUTTON_CLASS)}
            label={t('timelinePreview.textStyle.decrease')}
            icon={<IconMinus size={14} />}
            onClick={() => applyTextScale(selectedTextScale - 0.1)}
          />
          <input
            className={cn(
              'w-[40px] h-6 text-center text-micro font-bold tabular-nums',
              'rounded-[var(--nomi-radius-sm)] border border-[var(--workbench-border)] bg-[var(--nomi-paper)] text-[var(--workbench-ink)] outline-none focus:border-[var(--nomi-accent)]',
            )}
            value={sizePctDraft}
            inputMode="numeric"
            aria-label={t('timelinePreview.textStyle.percentage')}
            onChange={(event) => setSizePctDraft(event.target.value.replace(/[^0-9]/g, ''))}
            onBlur={commitSizePct}
            onKeyDown={(event) => {
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
            }}
          />
          <span className="text-micro text-[var(--workbench-muted-soft)]">%</span>
          <WorkbenchIconButton
            className={cn(CONTROL_ICON_BUTTON_CLASS)}
            label={t('timelinePreview.textStyle.increase')}
            icon={<IconPlus size={14} />}
            onClick={() => applyTextScale(selectedTextScale + 0.1)}
          />
        </div>
        <NomiSelect
          ariaLabel={t('timelinePreview.textStyle.font')}
          leadingLabel={t('timelinePreview.textStyle.font')}
          size="xs"
          value={selectedTextFontId}
          options={TEXT_FONTS.map((font) => ({
            value: font.id,
            label: t(`timelinePreview.textStyle.fonts.${font.id}` as 'timelinePreview.textStyle.fonts.default'),
          }))}
          onChange={(value) => {
            if (selectedTextClipId) updateTimelineTextClipFont(selectedTextClipId, value)
          }}
        />
      </div>
    </>
  )
}
