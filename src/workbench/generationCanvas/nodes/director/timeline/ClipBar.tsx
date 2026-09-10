/**
 * [INPUT]: 依赖 react、../../../../../utils/cn、../model/timelineTracks 的 TimelineClipView、./clipTone（clipToneClass / ClipDragZone）
 * [OUTPUT]: 对外提供 ClipBar：片段条呈现（20px 高、顶部 3px、圆角、家族色带透明度、10px 等宽居中标签、选中时白边 + 两端 4px 拖柄）+ 左右把手命中区判定
 * [POS]: director/timeline 的片段条视觉单一实现，交互（拖移 / 拖边）由 TrackLanes 通过 onPointerDown(zone) 接管。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { cn } from '../../../../../utils/cn'
import type { TimelineClipView } from '../model/timelineTracks'
import { clipToneClass, type ClipDragZone } from './clipTone'

// 命中区 10px（不超过条宽一半），可见 4px
const HANDLE_PX = 10

export function ClipBar({
  clip,
  left,
  width,
  selected,
  active = false,
  muted,
  onPointerDown,
  onContextMenu,
}: {
  clip: TimelineClipView
  left: number
  width: number
  selected: boolean
  /** 该实体当前激活的路径片段（青边） */
  active?: boolean
  muted: boolean
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>, zone: ClipDragZone) => void
  onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void
}): JSX.Element {
  const zoneFromEvent = (event: React.PointerEvent<HTMLDivElement>): ClipDragZone => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const handle = Math.min(HANDLE_PX, rect.width / 2)
    if (selected && !muted) {
      if (x <= handle) return 'left'
      if (x >= rect.width - handle) return 'right'
    }
    return 'body'
  }
  return (
    <div
      role="button"
      tabIndex={-1}
      data-clip-id={clip.id}
      title={clip.label}
      className={cn(
        'group absolute top-[3px] flex h-5 cursor-grab select-none items-center justify-center rounded-nomi-sm border transition-colors active:cursor-grabbing',
        clipToneClass(clip.tone, selected, active),
        muted ? 'opacity-40' : '',
      )}
      style={{ left, width: Math.max(1, width) }}
      onPointerDown={(event) => onPointerDown(event, zoneFromEvent(event))}
      onContextMenu={onContextMenu}
    >
      <span className="pointer-events-none w-full select-none truncate px-2.5 text-center font-nomi-mono text-micro font-medium">{clip.label}</span>
      {selected && !muted ? (
        <>
          <span className="group/handle absolute inset-y-0 left-0 z-20 w-2.5 max-w-[50%] cursor-col-resize" aria-hidden>
            <span className="absolute inset-y-0 left-0 w-1 rounded-l-[2px] bg-nomi-clip-selected/75 transition-all group-hover/handle:w-[5px] group-hover/handle:bg-nomi-clip-selected/90" />
          </span>
          <span className="group/handle absolute inset-y-0 right-0 z-20 w-2.5 max-w-[50%] cursor-col-resize" aria-hidden>
            <span className="absolute inset-y-0 right-0 w-1 rounded-r-[2px] bg-nomi-clip-selected/75 transition-all group-hover/handle:w-[5px] group-hover/handle:bg-nomi-clip-selected/90" />
          </span>
        </>
      ) : null}
    </div>
  )
}
