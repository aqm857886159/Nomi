import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconMinus, IconPlus } from '@tabler/icons-react'
import { NomiSelect, WorkbenchIconButton } from '../../../design'
import { cn } from '../../../utils/cn'
import { useWorkbenchStore } from '../../workbenchStore'
import type { TimelineTextClip } from '../../timeline/timelineTypes'
import { resolveOverlayTransform } from '../../timeline/textLayout'
import { TEXT_FONTS, DEFAULT_TEXT_FONT_ID } from '../../timeline/textFonts'
import { SCALE_MIN, SCALE_MAX } from '../../timeline/overlayTransform'

// 字幕的「文字」组（合同 §2.3）：字号 + 字体，按属性面板的行式排版（label 左、控件右）。
//
// P1：这两个控件此前住在预览控制条（TextClipStyleControls），合同 §2.2 把 transport 收成
// 纯播放控件，值类控件一律进属性面板——旧组件已随本次改动删除，不留并行版。
// 240px 的列放不下横条式布局：原样搬过来会让「文字样式」四个字竖着断行、字体下拉被裁掉半个。
//
// 「样式」（字幕 ↔ 标题卡）本轮不做：改它要新增一条内核写操作，与转场选择器一起归 T2。
// 停留时长仍在时间轴文字轨上拖 clip 边缘调整（TimelineTextTrack）。

export function TextClipFields({ clip }: { clip: TimelineTextClip }): JSX.Element {
  const { t } = useTranslation()
  const updateTransform = useWorkbenchStore((state) => state.updateTimelineTextClipTransform)
  const updateFont = useWorkbenchStore((state) => state.updateTimelineTextClipFont)
  const scale = resolveOverlayTransform(clip).scale
  const sizePct = Math.round(scale * 100)
  const [draft, setDraft] = React.useState(String(sizePct))

  React.useEffect(() => { setDraft(String(sizePct)) }, [sizePct, clip.id])

  const applyScale = React.useCallback(
    (next: number) => updateTransform(clip.id, { scale: Math.min(SCALE_MAX, Math.max(SCALE_MIN, next)) }, { commit: true }),
    [clip.id, updateTransform],
  )

  return (
    <>
      <label className="flex items-center justify-between gap-2 text-caption text-[var(--workbench-muted)]">
        <span>{t('timelinePreview.textStyle.size')}</span>
        <span className="flex items-center gap-1">
          <WorkbenchIconButton
            className="h-6 w-6"
            label={t('timelinePreview.textStyle.decrease')}
            icon={<IconMinus size={13} />}
            onClick={() => applyScale(scale - 0.1)}
          />
          <input
            className={cn(
              'h-6 w-[42px] text-center text-micro font-bold tabular-nums outline-none',
              'rounded-[var(--nomi-radius-sm)] border border-[var(--workbench-border)] bg-[var(--nomi-paper)]',
              'text-[var(--workbench-ink)] focus:border-[var(--nomi-accent)]',
            )}
            value={draft}
            inputMode="numeric"
            aria-label={t('timelinePreview.textStyle.percentage')}
            onChange={(event) => setDraft(event.target.value.replace(/[^0-9]/g, ''))}
            onBlur={() => { const pct = Number(draft); if (Number.isFinite(pct) && pct > 0) applyScale(pct / 100) }}
            onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }}
          />
          <span className="text-micro text-[var(--workbench-muted-soft)]">%</span>
          <WorkbenchIconButton
            className="h-6 w-6"
            label={t('timelinePreview.textStyle.increase')}
            icon={<IconPlus size={13} />}
            onClick={() => applyScale(scale + 0.1)}
          />
        </span>
      </label>
      <label className="flex items-center justify-between gap-2 text-caption text-[var(--workbench-muted)]">
        <span>{t('timelinePreview.textStyle.font')}</span>
        <NomiSelect
          ariaLabel={t('timelinePreview.textStyle.font')}
          size="xs"
          value={clip.fontFamily ?? DEFAULT_TEXT_FONT_ID}
          options={TEXT_FONTS.map((font) => ({
            value: font.id,
            label: t(`timelinePreview.textStyle.fonts.${font.id}` as 'timelinePreview.textStyle.fonts.default'),
          }))}
          onChange={(value) => updateFont(clip.id, value)}
        />
      </label>
    </>
  )
}

export default TextClipFields
