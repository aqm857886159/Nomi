/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../design 的 WorkbenchIconButton、../../../../../vendor/tablerIcons、../../../../../utils/cn、
 *          ../DirectorEditorContext、../model/timelineTracks（TimelineTrack / TimelineSubTrack / familyMarkerTimes / stepToNeighbor / entitiesOutsideTimeline）、
 *          ../model/directorTypes 的 isDirectorCamera、../panels/Popover、./clipTone、./timelineRows（ROW_HEIGHT / TimelineRow）、./timelineCommands 的 seekTo
 * [OUTPUT]: 对外提供 TrackList：左栏——列头「轨道列表 (N) ｜ + 添加轨道 ▾」+ 主行（拖序把手 / 类型图标 / 名字 ｜ 追加片段菜单 / 追加路径 / 播放头切割 / 钉住 / 删除实体）
 *           + 副行（色标 / 名字 / 旁路 / 上一下一关键帧 / 清空）
 * [POS]: director/timeline 的轨道列：行序与泳道共用 buildTimelineRows；主行五键直接打命令，「追加片段」菜单与右键菜单的内容由 DirectorTimeline 决定，
 *        这里只上报「在哪一行按了菜单 / 右键」。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { WorkbenchIconButton } from '../../../../../design'
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconCube,
  IconEye,
  IconEyeOff,
  IconGripVertical,
  IconPin,
  IconPinFilled,
  IconPlus,
  IconRepeat,
  IconScissors,
  IconTrash,
  IconUser,
  IconVideo,
} from '../../../../../vendor/tablerIcons'
import { cn } from '../../../../../utils/cn'
import { useDirectorStore, useDirectorStoreApi } from '../DirectorEditorContext'
import { isDirectorCamera } from '../model/directorTypes'
import { entitiesOutsideTimeline, familyMarkerTimes, stepToNeighbor, type TimelineSubTrack, type TimelineTrack } from '../model/timelineTracks'
import { Popover, PopoverItem } from '../panels/Popover'
import { seekTo } from './timelineCommands'
import { ROW_HEIGHT, type TimelineRow } from './timelineRows'

export type TrackListProps = {
  rows: TimelineRow[]
  tracks: TimelineTrack[]
  /** 主行「+」：追加动作 / 骨骼 / 视线 / 特写片段的菜单 */
  onOpenAddClipMenu: (event: React.MouseEvent<HTMLElement>, track: TimelineTrack) => void
  /** 主行「追加路径片段」/「播放头切割」/「删除实体」直接打命令 */
  /** 行内「创建特写片段」（角色行 = 新机位 + 特写；机位行 = 追加特写） */
  onCreateCloseup: (track: TimelineTrack) => void
  onSplitAtPlayhead: (track: TimelineTrack) => void
  onDeleteEntity: (track: TimelineTrack) => void
  onContextMenu: (event: React.MouseEvent<HTMLElement>, row: TimelineRow) => void
  // 双击机位主行 = 进入该机位视角（清单 §6 C1「轨道/机位选择」）
  onEnterPov: (cameraId: string) => void
}

function KindIcon({ kind }: { kind: TimelineTrack['kind'] }): JSX.Element {
  const className = 'shrink-0 text-nomi-ink-40'
  if (kind === 'camera') return <IconVideo size={14} stroke={1.9} className={className} />
  if (kind === 'character') return <IconUser size={14} stroke={1.9} className={className} />
  return <IconCube size={14} stroke={1.9} className={className} />
}

function SubTrackRow({
  track,
  sub,
  isLast,
  selected,
  onContextMenu,
}: {
  track: TimelineTrack
  sub: TimelineSubTrack
  isLast: boolean
  selected: boolean
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void
}): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const currentTime = useDirectorStore((state) => state.timeline.currentTime)
  const times = familyMarkerTimes(track.entity, sub.family)
  const prev = stepToNeighbor(times, currentTime, 'prev')
  const next = stepToNeighbor(times, currentTime, 'next')
  const onKey = times.some((time) => Math.abs(time - currentTime) < 1 / 60)

  const clear = () => {
    const state = store.getState()
    const entityId = track.entityId
    if (sub.family === 'trajectory') for (const clip of sub.clips) state.deleteTrajectoryClip(entityId, clip.id)
    else if (sub.family === 'closeup') for (const clip of sub.clips) state.deleteCloseupClip(entityId, clip.id)
    else if (sub.family === 'action') state.clearActionClips(entityId)
    else if (sub.family === 'bone') state.clearBoneKeyframes(entityId)
    else state.clearLookAtClips(entityId)
  }
  const toggleBypass = () => {
    const state = store.getState()
    if (sub.family === 'action') state.toggleActionTrack(track.entityId)
    else if (sub.family === 'lookat') state.toggleLookAtTrack(track.entityId)
  }

  return (
    // 树形副行：竖线 x=20 贯穿（最后一项止于中线）、横枝 20→30；骨骼帧是二级（pl-12，从 x=30 拐到 40）
    <div
      className={cn(
        'group relative flex items-center gap-1.5 border-b border-nomi-line pr-2 text-micro text-nomi-ink-60',
        sub.family === 'bone' ? 'pl-12' : 'pl-9',
        selected ? 'bg-nomi-ink-05' : '',
        sub.enabled ? '' : 'opacity-50',
      )}
      style={{ height: ROW_HEIGHT }}
      data-testid="director-timeline-subtrack"
      onContextMenu={onContextMenu}
    >
      <span className="pointer-events-none absolute left-5 top-0 w-px bg-nomi-ink-20" style={{ height: isLast ? '50%' : '100%' }} aria-hidden />
      {sub.family === 'bone' ? (
        <span className="pointer-events-none absolute left-[30px] top-[-14px] h-7 w-2.5 border-b border-l border-nomi-ink-20" aria-hidden />
      ) : (
        <span className="pointer-events-none absolute left-5 top-1/2 h-px w-2.5 bg-nomi-ink-20" aria-hidden />
      )}
      <span className={cn('min-w-0 flex-1 truncate font-nomi-mono', sub.enabled ? '' : 'text-nomi-ink-40')}>{t(`director.timeline.family.${sub.family}`)}</span>
      <div className="flex items-center opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {sub.bypassable ? (
          <WorkbenchIconButton
            size="sm"
            icon={sub.enabled ? <IconEye size={13} stroke={1.9} /> : <IconEyeOff size={13} stroke={1.9} />}
            label={sub.enabled ? t('director.timeline.menu.bypassOn') : t('director.timeline.menu.bypassOff')}
            onClick={toggleBypass}
          />
        ) : null}
        <span title={prev === null ? t('director.timeline.menu.noPrevKey') : undefined}>
          <WorkbenchIconButton size="sm" icon={<IconChevronLeft size={13} stroke={1.9} />} label={t('director.timeline.menu.prevKey')} disabled={prev === null} onClick={() => prev !== null && seekTo(store, prev)} />
        </span>
        {sub.family === 'trajectory' || sub.family === 'bone' ? (
          // 空间轨迹 / 骨骼帧行：‹ ◇ ›，菱形在播放头落在关键帧上时点亮（空间轨迹 accent，骨骼帧 warning）
          <span className={cn('mx-0.5 size-2 rotate-45 border', onKey ? (sub.family === 'bone' ? 'border-nomi-key-bone bg-nomi-key-bone' : 'border-nomi-key-path bg-nomi-key-path') : 'border-nomi-ink-40 bg-nomi-bg')} aria-hidden />
        ) : null}
        <span title={next === null ? t('director.timeline.menu.noNextKey') : undefined}>
          <WorkbenchIconButton size="sm" icon={<IconChevronRight size={13} stroke={1.9} />} label={t('director.timeline.menu.nextKey')} disabled={next === null} onClick={() => next !== null && seekTo(store, next)} />
        </span>
        {sub.family !== 'trajectory' ? <WorkbenchIconButton size="sm" icon={<IconTrash size={13} stroke={1.9} />} label={t('director.timeline.menu.clearTrack')} onClick={clear} /> : null}
      </div>
    </div>
  )
}

export function TrackListHeader({ trackCount }: { trackCount: number }): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const outside = useDirectorStore((state) => entitiesOutsideTimeline(state.activeScene()))
  const [addOpen, setAddOpen] = React.useState(false)
  return (
    <div className="flex h-[26px] shrink-0 items-center gap-1 border-b border-nomi-line-soft px-2 text-caption text-nomi-ink-60" data-testid="director-timeline-tracks-header">
      <span className="min-w-0 flex-1 truncate">{t('director.timeline.trackListTitle', { count: trackCount })}</span>
      <Popover
        open={addOpen}
        onClose={() => setAddOpen(false)}
        side="bottom"
        align="end"
        trigger={
          <button type="button" className="flex items-center gap-0.5 rounded-nomi-sm px-1 text-caption text-nomi-ink hover:bg-workbench-hover" onClick={() => setAddOpen((open) => !open)}>
            <IconPlus size={13} stroke={2} />
            {t('director.timeline.addTrack')}
            <IconChevronDown size={12} stroke={2} className="text-nomi-ink-40" />
          </button>
        }
      >
        {outside.length === 0 ? (
          <div className="px-2 py-1 text-caption text-nomi-ink-40">{t('director.timeline.menu.addTrackEmpty')}</div>
        ) : (
          outside.map((entity) => (
            <PopoverItem
              key={entity.id}
              onClick={() => {
                store.getState().addEntityToTimeline(entity.id)
                setAddOpen(false)
              }}
            >
              <span className="flex items-center gap-1.5">
                <KindIcon kind={isDirectorCamera(entity) ? 'camera' : entity.type === 'character' ? 'character' : 'object'} />
                {entity.name}
              </span>
            </PopoverItem>
          ))
        )}
      </Popover>
    </div>
  )
}

export function TrackList({ rows, tracks, onOpenAddClipMenu, onCreateCloseup, onSplitAtPlayhead, onDeleteEntity, onContextMenu, onEnterPov }: TrackListProps): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const [drag, setDrag] = React.useState<{ from: string; over: string | null } | null>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const selectedEntityId = useDirectorStore((state) => state.selection.objectId ?? state.selection.cameraId)

  // 拖序：按住把手，按指针 y 落到哪个主行就插到它前面；松手一次写 reorderTimelineTracks
  const beginReorder = (event: React.PointerEvent<HTMLElement>, track: TimelineTrack) => {
    if (event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    let over: string | null = null
    setDrag({ from: track.entityId, over: null })
    const resolveOver = (clientY: number): string | null => {
      const list = listRef.current
      if (!list) return null
      const y = clientY - list.getBoundingClientRect().top + list.scrollTop
      let top = 0
      for (const row of rows) {
        if (row.kind !== 'main') continue
        const span = 1 + rows.filter((item) => item.kind === 'sub' && item.track.entityId === row.track.entityId).length
        if (y >= top && y < top + ROW_HEIGHT * span) return row.track.entityId
        top += ROW_HEIGHT * span
      }
      return null
    }
    const onMove = (move: PointerEvent) => {
      over = resolveOver(move.clientY)
      setDrag({ from: track.entityId, over })
    }
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
      setDrag(null)
      if (over && over !== track.entityId) {
        const order = tracks.map((item) => item.entityId).filter((id) => id !== track.entityId)
        const index = order.indexOf(over)
        order.splice(index < 0 ? order.length : index, 0, track.entityId)
        store.getState().reorderTimelineTracks(order)
      }
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  return (
    <div ref={listRef} className="flex flex-col" data-testid="director-timeline-tracks">
      {rows.map((row) => {
        if (row.kind === 'sub') {
          const next = rows[rows.indexOf(row) + 1]
          const isLast = !next || next.kind !== 'sub' || next.track.entityId !== row.track.entityId
          return <SubTrackRow key={row.key} track={row.track} sub={row.sub} isLast={isLast} selected={selectedEntityId === row.track.entityId} onContextMenu={(event) => onContextMenu(event, row)} />
        }
        const { track } = row
        const isOver = drag?.over === track.entityId && drag.from !== track.entityId
        return (
          <div
            key={row.key}
            className={cn(
              'group flex items-center gap-1 border-b border-nomi-line pl-1 pr-1 text-caption font-semibold text-nomi-ink',
              selectedEntityId === track.entityId ? 'bg-nomi-ink-05' : '',
              isOver ? 'shadow-[inset_0_2px_0_var(--nomi-accent)]' : '',
              drag?.from === track.entityId ? 'opacity-60' : '',
            )}
            style={{ height: ROW_HEIGHT }}
            data-testid="director-timeline-track"
            title={track.kind === 'camera' ? t('director.camera.enterPovHint') : undefined}
            onContextMenu={(event) => onContextMenu(event, row)}
            onDoubleClick={() => {
              if (track.kind === 'camera') onEnterPov(track.entityId)
            }}
          >
            <button
              type="button"
              className="flex size-5 shrink-0 cursor-grab items-center justify-center text-nomi-ink-30 hover:text-nomi-ink-60 active:cursor-grabbing"
              title={t('director.timeline.menu.reorderHandle')}
              aria-label={t('director.timeline.menu.reorderHandle')}
              onPointerDown={(event) => beginReorder(event, track)}
            >
              <IconGripVertical size={14} stroke={1.8} />
            </button>
            <KindIcon kind={track.kind} />
            <span className="min-w-0 flex-1 truncate" title={track.name}>
              {track.name}
            </span>
            <div className="flex items-center opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              {track.kind === 'character' ? (
                <WorkbenchIconButton size="sm" icon={<IconPlus size={13} stroke={1.9} />} label={t('director.timeline.menu.addClip')} onClick={(event) => onOpenAddClipMenu(event, track)} />
              ) : null}
              {track.kind !== 'object' ? (
                <WorkbenchIconButton size="sm" icon={<IconRepeat size={13} stroke={1.9} />} label={t('director.timeline.menu.createCloseup')} onClick={() => onCreateCloseup(track)} />
              ) : null}
              <WorkbenchIconButton size="sm" icon={<IconScissors size={13} stroke={1.9} />} label={t('director.timeline.menu.splitAtPlayhead')} onClick={() => onSplitAtPlayhead(track)} />
              <WorkbenchIconButton
                size="sm"
                icon={track.pinned ? <IconPinFilled size={13} stroke={1.9} /> : <IconPin size={13} stroke={1.9} />}
                label={track.pinned ? t('director.timeline.menu.unpin') : t('director.timeline.menu.pin')}
                onClick={() => store.getState().toggleTimelineTrackPin(track.entityId)}
              />
              <WorkbenchIconButton size="sm" icon={<IconTrash size={13} stroke={1.9} />} label={t('director.timeline.menu.deleteEntity')} onClick={() => onDeleteEntity(track)} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
