/**
 * [INPUT]: 依赖 react、../DirectorEditorContext 的 useDirectorStore、./useTimelineViewport 的 TimelineViewport
 * [OUTPUT]: 对外提供 TimelinePlayhead：贯穿标尺与泳道的播放头（11×15 墨色头块（深色主题下即纯白）、2px 边、底角圆；1px 竖线从标尺 y=13 起贯穿）
 * [POS]: director/timeline 的播放头呈现：单独订阅 currentTime，播放时每帧只重渲染这一个元素，泳道与轨道列不动。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useDirectorStore } from '../DirectorEditorContext'
import type { TimelineViewport } from './useTimelineViewport'

export function TimelinePlayhead({ viewport }: { viewport: TimelineViewport }): JSX.Element {
  const currentTime = useDirectorStore((state) => state.timeline.currentTime)
  return (
    <div className="pointer-events-none absolute inset-y-0 z-20 w-px bg-nomi-ink" style={{ left: viewport.timeToPx(currentTime) }} data-testid="director-timeline-playhead">
      <div className="absolute -left-[5px] top-0 box-border h-[15px] w-[11px] rounded-b-nomi border-2 border-nomi-ink bg-nomi-ink" />
    </div>
  )
}
