// 生成页时间轴收起态（10-08 外壳拍板稿 Main 板 .dock）：贴画布工作面底边的一条 36px 窄条——
// 「时间轴」· N 段 · 总时长 · 每段一张小缩略图 · 右端 ^ 展开。点窄条任何地方都展开（就是现有的时间轴面板，工具一个不少）。
// 数字全是真实摘要：段数含字幕 / 标题卡，时长按时间轴自己的帧率换算，绝不编造。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../utils/cn'
import { useWorkbenchStore } from '../workbenchStore'
import { computeTimelineDuration } from '../timeline/timelineMath'

const MAX_THUMBS = 12

export function TimelineStrip({ onExpand, label, expandLabel, icon, expandIcon }: {
  onExpand: () => void
  label: string
  expandLabel: string
  icon: React.ReactNode
  expandIcon: React.ReactNode
}): JSX.Element {
  const { t } = useTranslation()
  const timeline = useWorkbenchStore((state) => state.timeline)
  const summary = React.useMemo(() => {
    const clips = (timeline.tracks ?? []).flatMap((track) => track.clips ?? [])
    const clipCount = clips.length + (timeline.textClips?.length ?? 0)
    const totalSeconds = Math.round(computeTimelineDuration(timeline) / Math.max(1, timeline.fps))
    const durationLabel = `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
    const thumbs = clips
      .filter((clip) => clip.type !== 'audio')
      .sort((a, b) => a.startFrame - b.startFrame)
      .slice(0, MAX_THUMBS)
      .map((clip) => ({ id: clip.id, url: clip.thumbnailUrl || (clip.type === 'image' ? clip.url : undefined) }))
    return { clipCount, durationLabel, thumbs, more: Math.max(0, clips.length - MAX_THUMBS) }
  }, [timeline])
  return (
    <button
      type="button"
      className={cn(
        'workbench-generation__timeline-strip',
        'flex h-9 w-full shrink-0 items-center gap-2 border-0 border-t border-nomi-line-soft bg-nomi-paper pl-3.5 pr-2.5 text-left',
        'transition-colors hover:bg-nomi-ink-05 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-nomi-accent',
      )}
      onClick={onExpand}
      aria-label={expandLabel}
      data-timeline-strip
    >
      <span className="shrink-0 text-nomi-ink-60" aria-hidden="true">{icon}</span>
      <span className="shrink-0 text-caption font-medium text-nomi-ink-80">{label}</span>
      <span className="shrink-0 text-caption tabular-nums text-nomi-ink-40">
        {t('generationCommon.workspace.clipSummary', { count: summary.clipCount, duration: summary.durationLabel })}
      </span>
      {/* 缩略图这一格吃掉剩余宽度（flex-1），展开钮自然落在行尾（不靠贴边类）。 */}
      <span className="ml-1.5 flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden" aria-hidden="true">
        {summary.thumbs.map((thumb) => (
          thumb.url
            ? <img key={thumb.id} src={thumb.url} alt="" className="h-[18px] w-[30px] shrink-0 rounded-sm object-cover" />
            : <span key={thumb.id} className="h-[18px] w-[30px] shrink-0 rounded-sm bg-nomi-ink-10" />
        ))}
        {summary.more ? <span className="pl-1 text-micro text-nomi-ink-40">+{summary.more}</span> : null}
      </span>
      <span className="grid size-7 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-60" aria-hidden="true">{expandIcon}</span>
    </button>
  )
}
