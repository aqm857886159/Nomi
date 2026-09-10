/**
 * [INPUT]: 依赖 react、../../../../../utils/cn、../DirectorEditorContext 的 useDirectorStore / useDirectorStoreApi、
 *          ../model/timelineTracks（TimelineClipView / TimelineMarkerView / TrackFamily）、../model/timelineSnap（collectSnapCandidates / snapTime / snapToleranceSeconds）、
 *          ../model/timeGrid（FRAME_SECONDS / quantizeToFrame）、../model/storeClipActions 的 ClipFamily、
 *          ./ClipBar、./timelineRows（ROW_HEIGHT / TimelineRow）、./timelineCommands（selectClip / selectWaypoint / clearTimelineSelection）、./useTimelineViewport
 * [OUTPUT]: 对外提供 TrackLanes：泳道（28px 行、主行片段条 + 末尾「+」追加路径、空间轨迹 / 骨骼帧副行的 10px 菱形 + 片段区间连线、吸附线）+ 拖拽（片段整体平移、拖边改时、路标 / 骨骼帧改时）
 * [POS]: director/timeline 的泳道区（清单 §5.2 片段条与路标交互）：拖拽期间只做本地预览，松手才写 store（一次撤销快照）；
 *        右键把「哪一行 / 哪个片段 / 什么时刻」上报给 DirectorTimeline 出菜单。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../../../utils/cn'
import { IconPlus } from '../../../../../vendor/tablerIcons'
import { useDirectorStore, useDirectorStoreApi } from '../DirectorEditorContext'
import { clipBounds } from '../model/clips'
import type { ClipFamily } from '../model/storeClipActions'
import { collectSnapCandidates, snapTime, snapToleranceSeconds, type SnapCandidate } from '../model/timelineSnap'
import type { TimelineClipView, TimelineMarkerView, TrackFamily } from '../model/timelineTracks'
import { FRAME_SECONDS, laneClips, quantizeToFrame } from '../model/timeGrid'
import { ClipBar } from './ClipBar'
import type { ClipDragZone } from './clipTone'
import { clearTimelineSelection, seekTo, selectClip, selectWaypoint } from './timelineCommands'
import { ROW_HEIGHT, type TimelineRow } from './timelineRows'
import type { TimelineViewport } from './useTimelineViewport'

type ClipDrag = {
  kind: 'clip'
  entityId: string
  clipId: string
  family: ClipFamily
  zone: ClipDragZone
  startX: number
  origStart: number
  origEnd: number
  previewStart: number
  previewEnd: number
  snapped: SnapCandidate | null
  candidates: SnapCandidate[]
  moved: boolean
  minBound: number
  maxBound: number
}
type MarkerDrag = {
  kind: 'marker'
  entityId: string
  markerId: string
  family: 'trajectory' | 'bone'
  startX: number
  origTime: number
  previewTime: number
  snapped: SnapCandidate | null
  candidates: SnapCandidate[]
  moved: boolean
}
type RangeDrag = { kind: 'range'; entityId: string; startX: number; origTime: number; previewTime: number; top: number; markers: TimelineMarkerView[]; additive: boolean; moved: boolean; snapped: null }
type DragState = ClipDrag | MarkerDrag | RangeDrag

const DRAG_SLOP_PX = 3

export type TrackLanesProps = {
  rows: TimelineRow[]
  viewport: TimelineViewport
  totalDuration: number
  onContextMenu: (event: React.MouseEvent<HTMLElement>, row: TimelineRow, clipId: string | undefined, time: number) => void
  onReject: (reasonKey: string) => void
  /** 主行末尾「+」：在该轨道最后一段之后追加路径片段 */
  onAppendTrajectory: (row: TimelineRow) => void
}

// 追加「+」放在最后一段结束 +0.1s 处；时长已到 60s 且余量 < 0.5s 时不给
const APPEND_GAP_SECONDS = 0.1
const APPEND_MIN_REMAINING = 0.5

export function TrackLanes({ rows, viewport, totalDuration, onContextMenu, onReject, onAppendTrajectory }: TrackLanesProps): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const selectedClipId = useDirectorStore((state) => state.selection.clipId)
  const activeWaypointId = useDirectorStore((state) => state.selection.activeWaypointId)
  const selectedWaypointIds = useDirectorStore((state) => state.selection.selectedWaypointIds)
  const selectedEntityId = useDirectorStore((state) => state.selection.objectId ?? state.selection.cameraId)
  const activeTrajectoryClipIds = useDirectorStore((state) => state.activeTrajectoryClipIds)
  const selectedBoneKeyframeId = useDirectorStore((state) => state.selection.boneKeyframeId)
  const [drag, setDrag] = React.useState<DragState | null>(null)
  const dragRef = React.useRef<DragState | null>(null)
  const { timeToPx, pxPerSecond } = viewport

  const applySnap = React.useCallback(
    (time: number, candidates: SnapCandidate[]) => {
      const clamped = Math.max(0, Math.min(totalDuration, time))
      if (!store.getState().snapEnabled) return { time: clamped, snapped: null }
      return snapTime(clamped, candidates, snapToleranceSeconds(pxPerSecond))
    },
    [pxPerSecond, store, totalDuration],
  )

  // 拖拽期间挂 window 监听：指针可以离开泳道
  React.useEffect(() => {
    if (!drag) return undefined
    const onMove = (event: PointerEvent) => {
      const current = dragRef.current
      if (!current) return
      const deltaSeconds = (event.clientX - current.startX) / pxPerSecond
      const moved = current.moved || Math.abs(event.clientX - current.startX) > DRAG_SLOP_PX
      let next: DragState
      if (current.kind === 'clip') {
        const duration = current.origEnd - current.origStart
        if (current.zone === 'body') {
          const rawStart = current.origStart + deltaSeconds
          const startSnap = applySnap(rawStart, current.candidates)
          const endSnap = applySnap(rawStart + duration, current.candidates)
          const useEnd = endSnap.snapped && (!startSnap.snapped || Math.abs(endSnap.time - (rawStart + duration)) < Math.abs(startSnap.time - rawStart))
          const start = Math.max(current.minBound, Math.min(current.maxBound - duration, useEnd ? endSnap.time - duration : startSnap.time))
          next = { ...current, moved, previewStart: start, previewEnd: start + duration, snapped: useEnd ? endSnap.snapped : startSnap.snapped }
        } else if (current.zone === 'left') {
          const snap = applySnap(current.origStart + deltaSeconds, current.candidates)
          const start = Math.min(current.origEnd - FRAME_SECONDS, snap.time)
          next = { ...current, moved, previewStart: Math.max(current.minBound, start), snapped: snap.snapped }
        } else {
          const snap = applySnap(current.origEnd + deltaSeconds, current.candidates)
          const end = Math.max(current.origStart + FRAME_SECONDS, snap.time)
          next = { ...current, moved, previewEnd: Math.min(current.maxBound, end), snapped: snap.snapped }
        }
      } else if (current.kind === 'range') {
        next = { ...current, moved, previewTime: Math.max(0, Math.min(totalDuration, current.origTime + deltaSeconds)) }
      } else {
        const snap = applySnap(current.origTime + deltaSeconds, current.candidates)
        next = { ...current, moved, previewTime: snap.time, snapped: snap.snapped }
      }
      dragRef.current = next
      setDrag(next)
    }
    const onUp = () => {
      const current = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!current) return
      const state = store.getState()
      if (current.kind === 'range') {
        clearTimelineSelection(store)
        if (!current.moved) { seekTo(store, current.origTime); return }
        const from = Math.min(current.origTime, current.previewTime)
        const to = Math.max(current.origTime, current.previewTime)
        const ids = current.markers.filter((marker) => marker.time >= from && marker.time <= to).map((marker) => marker.id)
        const camera = Boolean(state.findCamera(current.entityId))
        const previous = current.additive && (state.selection.objectId ?? state.selection.cameraId) === current.entityId ? state.selection.selectedWaypointIds : []
        state.select({ objectId: camera ? null : current.entityId, cameraId: camera ? current.entityId : null, lightId: null, multiObjectIds: camera ? [] : [current.entityId], selectedWaypointIds: Array.from(new Set([...previous, ...ids])), activeWaypointId: ids[0] ?? null })
        return
      }
      if (!current.moved) return
      if (current.kind === 'clip') {
        const ok =
          current.zone === 'body'
            ? state.moveClip(current.entityId, current.clipId, current.family, current.previewStart)
            : state.updateClipTime(current.entityId, current.clipId, current.family, current.previewStart, current.previewEnd)
        if (!ok) onReject('director.timeline.toast.noSpace')
        return
      }
      state.saveState()
      const time = quantizeToFrame(current.previewTime)
      const ok = current.family === 'trajectory' ? state.updateWaypointTime(current.entityId, current.markerId, time) !== null : state.updateBoneKeyframeTime(current.entityId, current.markerId, time)
      if (!ok) onReject('director.timeline.toast.markerOutsideClip')
    }
    const onCancel = () => { dragRef.current = null; setDrag(null) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  }, [applySnap, drag, onReject, pxPerSecond, store, totalDuration])

  const beginClipDrag = (event: React.PointerEvent<HTMLDivElement>, entityId: string, family: TrackFamily, clip: TimelineClipView, zone: ClipDragZone) => {
    if (event.button !== 0 || family === 'bone') return
    event.stopPropagation()
    selectClip(store, entityId, family, clip.id)
    const state = store.getState()
    const entity = state.findObject(entityId) ?? state.findCamera(entityId)
    if (!entity) return
    const next: ClipDrag = {
      kind: 'clip',
      entityId,
      clipId: clip.id,
      family,
      zone,
      startX: event.clientX,
      origStart: clip.startTime,
      origEnd: clip.endTime,
      previewStart: clip.startTime,
      previewEnd: clip.endTime,
      snapped: null,
      candidates: collectSnapCandidates(state.activeScene(), state.timeline.currentTime, { clipId: clip.id }),
      moved: false,
      ...clipBounds(laneClips(entity, family), clip.id, totalDuration),
    }
    dragRef.current = next
    setDrag(next)
  }

  const beginMarkerDrag = (event: React.PointerEvent<HTMLButtonElement>, entityId: string, family: 'trajectory' | 'bone', marker: TimelineMarkerView) => {
    if (event.button !== 0) return
    event.stopPropagation()
    const state = store.getState()
    if (family === 'trajectory') selectWaypoint(store, entityId, marker.id, event.shiftKey)
    else {
      state.select({ boneKeyframeId: marker.id, boneClipId: marker.clipId ?? null, clipId: marker.clipId ?? null, clipType: 'action', objectId: entityId, cameraId: null, lightId: null, multiObjectIds: [entityId] })
      seekTo(store, marker.time)
    }
    const next: MarkerDrag = {
      kind: 'marker',
      entityId,
      markerId: marker.id,
      family,
      startX: event.clientX,
      origTime: marker.time,
      previewTime: marker.time,
      snapped: null,
      candidates: collectSnapCandidates(state.activeScene(), state.timeline.currentTime, { waypointIds: [marker.id] }),
      moved: false,
    }
    dragRef.current = next
    setDrag(next)
  }

  const laneContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const rowIndex = Math.floor((event.clientY - rect.top) / ROW_HEIGHT)
    const row = rows[rowIndex]
    if (!row) return
    const clipId = (event.target as HTMLElement).closest('[data-clip-id]')?.getAttribute('data-clip-id') ?? undefined
    onContextMenu(event, row, clipId, Math.max(0, viewport.pxToTime(event.clientX - rect.left)))
  }

  const clipGeometry = (clip: TimelineClipView) => {
    const dragging = drag?.kind === 'clip' && drag.clipId === clip.id
    const start = dragging ? drag.previewStart : clip.startTime
    const end = dragging ? drag.previewEnd : clip.endTime
    return { left: timeToPx(start), width: timeToPx(end) - timeToPx(start) }
  }
  const markerLeft = (marker: TimelineMarkerView) => {
    const dragging = drag?.kind === 'marker' && drag.markerId === marker.id
    if (drag?.kind === 'clip' && drag.clipId === marker.clipId) {
      const progress = (marker.time - drag.origStart) / (drag.origEnd - drag.origStart)
      return timeToPx(drag.previewStart + progress * (drag.previewEnd - drag.previewStart))
    }
    return timeToPx(dragging ? drag.previewTime : marker.time)
  }

  return (
    <div
      className="relative"
      style={{ width: viewport.laneWidth, height: rows.length * ROW_HEIGHT }}
      data-testid="director-timeline-lanes"
      onContextMenu={(event) => {
        event.preventDefault()
        laneContextMenu(event)
      }}
      onPointerDown={(event) => {
        if (event.button === 0 && event.target === event.currentTarget) clearTimelineSelection(store)
      }}
    >
      {rows.map((row, index) => {
        const top = index * ROW_HEIGHT
        // 主行泳道放路径片段 + 机位的特写片段；路标菱形住「空间轨迹」副行；其余家族各占一副行
        const { track } = row
        const lanes = row.kind === 'main' ? row.track.subTracks.filter((item) => item.family === 'trajectory' || item.family === 'closeup') : [row.sub]
        const clips = row.kind === 'main' ? lanes.flatMap((sub) => sub.clips.map((clip) => ({ clip, sub }))) : [...(row.sub.family === 'trajectory' ? [] : row.sub.clips.map((clip) => ({ clip, sub: row.sub })))]
        const markers = row.kind === 'main' ? [] : row.sub.markers
        const markerSub = row.kind === 'main' ? null : row.sub
        return (
          <div key={row.key} className={cn('absolute inset-x-0 border-b border-nomi-line', selectedEntityId === track.entityId ? 'bg-nomi-ink-05' : '')} style={{ top, height: ROW_HEIGHT }} onPointerDown={(event) => {
            if (event.button !== 0 || (event.target as HTMLElement).closest('button, [data-clip-id]')) return
            event.preventDefault()
            event.stopPropagation()
            const rect = event.currentTarget.getBoundingClientRect()
            const time = Math.max(0, Math.min(totalDuration, viewport.pxToTime(event.clientX - rect.left)))
            const next: RangeDrag = { kind: 'range', entityId: track.entityId, startX: event.clientX, origTime: time, previewTime: time, top, markers: markerSub?.family === 'trajectory' ? markers : [], additive: event.shiftKey, moved: false, snapped: null }
            dragRef.current = next
            setDrag(next)
          }}>
            {clips.map(({ clip, sub }) => {
              const geometry = clipGeometry(clip)
              return (
                <ClipBar
                  key={clip.id}
                  clip={clip}
                  left={geometry.left}
                  width={geometry.width}
                  selected={clip.id === selectedClipId}
                  // 未选中的激活路径片段只在该实体被选中时描青边
                  active={sub.family === 'trajectory' && selectedEntityId === track.entityId && activeTrajectoryClipIds[track.entityId] === clip.id}
                  muted={!sub.enabled}
                  onPointerDown={(event, zone) => beginClipDrag(event, track.entityId, sub.family, clip, zone)}
                  onContextMenu={(event) => {
                    event.stopPropagation()
                    event.preventDefault()
                    onContextMenu(event, row, clip.id, clip.startTime)
                  }}
                />
              )
            })}
            {/* 菱形按片段分组连一条 2px 线（选中轨 accent/60，否则 ink-30） */}
            {markerSub && markers.length > 1
              ? Object.values(
                  markers.reduce<Record<string, TimelineMarkerView[]>>((groups, marker) => {
                    const key = marker.clipId ?? '_'
                    ;(groups[key] ??= []).push(marker)
                    return groups
                  }, {}),
                ).map((group) => {
                  const lefts = group.map((marker) => markerLeft(marker))
                  const from = Math.min(...lefts)
                  const to = Math.max(...lefts)
                  if (to - from < 1) return null
                  const trackSelected = selectedEntityId === track.entityId
                  return (
                    <div
                      key={`line-${group[0].id}`}
                      className={cn('pointer-events-none absolute top-1/2 h-0.5 -translate-y-1/2', trackSelected ? (markerSub.family === 'bone' ? 'bg-nomi-key-bone/40' : 'bg-nomi-key-path/60') : 'bg-nomi-ink-30')}
                      style={{ left: from, width: to - from }}
                    />
                  )
                })
              : null}
            {markers.map((marker) => {
              const isBone = markerSub?.family === 'bone'
              const active = isBone ? marker.id === selectedBoneKeyframeId : marker.id === activeWaypointId
              const selected = !isBone && selectedWaypointIds.includes(marker.id)
              const trackSelected = selectedEntityId === track.entityId
              // 命中盒 24×24；菱形 10×10 旋转 45°；未选轨 scale-75 灰、选轨 accent（骨骼 warning）、点选白 scale-125（骨骼激活红 + 白边）
              const diamond = active
                ? isBone
                  ? 'scale-125 border-nomi-paper bg-nomi-key-active'
                  : 'scale-125 border-nomi-ink bg-nomi-ink'
                : selected
                  ? 'scale-125 border-nomi-ink bg-nomi-ink'
                  : trackSelected
                    ? isBone
                      ? 'border-nomi-bg bg-nomi-key-bone group-hover:scale-110'
                      : 'border-nomi-bg bg-nomi-key-path group-hover:scale-110'
                    : 'scale-75 border-nomi-ink-40 bg-nomi-ink-30 group-hover:scale-90 group-hover:border-nomi-ink-60'
              return (
                <button
                  key={marker.id}
                  type="button"
                  aria-label={marker.id}
                  className={cn('group absolute top-1/2 z-[1] flex size-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center', active || selected ? 'z-[2]' : '')}
                  style={{ left: markerLeft(marker) }}
                  onPointerDown={(event) => beginMarkerDrag(event, track.entityId, isBone ? 'bone' : 'trajectory', marker)}
                >
                  <span className={cn('block size-2.5 rotate-45 border transition-all', diamond)} />
                </button>
              )
            })}
            {row.kind === 'main'
              ? (() => {
                  const lastEnd = Math.max(0, ...clips.map(({ clip }) => clip.endTime))
                  if (lastEnd >= totalDuration - APPEND_MIN_REMAINING) return null
                  return (
                    <button
                      type="button"
                      className="absolute top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-nomi-sm border border-nomi-line bg-nomi-ink-05 text-nomi-ink-40 hover:border-nomi-ink-20 hover:bg-nomi-ink-10 hover:text-nomi-ink"
                      style={{ left: timeToPx(clips.length ? lastEnd + APPEND_GAP_SECONDS : 0) }}
                      title={t('director.timeline.menu.appendTrajectory')}
                      aria-label={t('director.timeline.menu.appendTrajectory')}
                      onClick={() => onAppendTrajectory(row)}
                    >
                      <IconPlus size={10} stroke={2.2} />
                    </button>
                  )
                })()
              : null}
          </div>
        )
      })}
      {drag?.kind === 'range' && drag.moved ? <div className="pointer-events-none absolute border border-nomi-accent bg-nomi-accent/10" style={{ top: drag.top, height: ROW_HEIGHT, left: timeToPx(Math.min(drag.origTime, drag.previewTime)), width: Math.abs(drag.previewTime - drag.origTime) * pxPerSecond }} /> : null}
      {drag?.snapped ? <div className="pointer-events-none absolute inset-y-0 z-10 w-px bg-nomi-warning" style={{ left: timeToPx(drag.snapped.time) }} /> : null}
    </div>
  )
}
