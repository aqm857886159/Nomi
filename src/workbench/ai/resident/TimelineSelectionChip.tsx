import React from 'react'
import { IconTimelineEvent, IconX } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'

/**
 * 输入框上「我指的是这一段」的 chip。
 *
 * 显示的是**用户自己给这段起的名字 + 时码**（「推门近景 · 0:04–0:08」，合同 §2.8：
 * 用户读秒和时码，帧和 id 是工程单位）。上一版把 clipId / trackId / 起止帧 / revision
 * 前八位一股脑印在 chip 上（「时间线区间 clip-b videoTrack 120-240 a7d63bff」），
 * 那是给排查用的取证串，不是给人读的——用户看不出它指的是哪一段，只看到一串乱码。
 *
 * 工程串没有删，只是搬到 title / aria-label 和 data-* 上：走查按 data-clip-id 定位，
 * 排查时 hover 就能看到帧与 revision。
 */
export function TimelineSelectionChip({
  clipId,
  trackId,
  trackLabel,
  name,
  timeRange,
  startFrame,
  endFrame,
  revision,
  stale,
  staleLabel,
  label,
  removeLabel,
  onRemove,
}: {
  clipId: string
  trackId: string
  /** 人话轨道名（「视频轨」）。工程 id 留在 data-track-id 上。 */
  trackLabel: string
  /** 片段名：媒体片段用它的 label，字幕用它的文字。 */
  name: string
  /** 已格式化的时码区间，如 `0:04–0:08`。 */
  timeRange: string
  startFrame: number
  endFrame: number
  revision: string
  stale?: boolean
  staleLabel: string
  label: string
  removeLabel: string
  onRemove?: () => void
}): JSX.Element {
  const technical = `${label} · ${trackLabel} · ${clipId} ${startFrame}-${endFrame} ${revision.slice(0, 8)}`
  const accessible = `${name} · ${timeRange} · ${technical}`
  return <span className={cn('inline-flex h-6 min-w-0 max-w-full items-center gap-1 rounded-pill bg-nomi-ink-05 px-2 text-micro text-nomi-ink-80', stale && 'bg-workbench-danger-soft text-workbench-danger')} data-agent-timeline-selection="true" data-clip-id={clipId} data-track-id={trackId} data-revision={revision} data-stale={stale ? 'true' : undefined} title={stale ? `${accessible} · ${staleLabel}` : accessible} aria-label={stale ? `${accessible} · ${staleLabel}` : accessible}>
    <IconTimelineEvent size={12} aria-hidden="true" />
    <span className="truncate">{name}</span>
    <span className="shrink-0 tabular-nums text-nomi-ink-40">· {timeRange}</span>
    {stale ? <span className="shrink-0 font-medium">{staleLabel}</span> : null}
    {onRemove ? <button type="button" aria-label={removeLabel} title={removeLabel} onClick={onRemove} className="grid size-4 shrink-0 place-items-center rounded-pill hover:bg-nomi-ink-10"><IconX size={11} aria-hidden="true" /></button> : null}
  </span>
}
