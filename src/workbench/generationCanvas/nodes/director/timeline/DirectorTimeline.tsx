/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../ui/toast、../DirectorEditorContext、../model/hotkeys 的 DirectorHotkeyScope、
 *          ../model/timelineTracks（buildTimelineTracks / ClipLabeler / TimelineTrack / TrackFamily）、../model/timelineClipboard 的 canPasteTo、
 *          ../model/timeGrid 的 quantizeToFrame、../model/directorTypes、../model/storeClipActions 的 ClipFamily、
 *          ./TimelineHeader、./TimelineRuler、./TimelinePlayhead、./TrackList、./TrackLanes、./TimelineContextMenu、./timelineRows、./timelineCommands、
 *          ./useTimelineViewport、./useTimelineHotkeys
 * [OUTPUT]: 对外提供 DirectorTimeline：时间轴装配根（头部 + 轨道列 + 标尺 / 泳道 / 播放头 + 右键菜单），折叠时只留头部
 * [POS]: director/timeline 的入口（清单 §5）：轨道列与泳道共用一份行序并同步纵向滚动；菜单项按「片段 → 副轨 → 轨道」三层上下文拼装，
 *        全部打到命令层；被拒绝的操作统一 toast 原因。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '../../../../../ui/toast'
import { useDirectorStore, useDirectorStoreApi } from '../DirectorEditorContext'
import { isDirectorCamera, type DirectorScene, type LookAtClip } from '../model/directorTypes'
import type { DirectorHotkeyScope } from '../model/hotkeys'
import type { ClipFamily } from '../model/storeClipActions'
import { canPasteTo } from '../model/timelineClipboard'
import { buildTimelineTracks, findClipView, type ClipLabeler, type TimelineTrack, type TrackFamily } from '../model/timelineTracks'
import { quantizeToFrame } from '../model/timeGrid'
import { ActionSelectModal } from '../panels/dialogs/ActionSelectModal'
import { TimelineContextMenu, type TimelineMenuItem } from './TimelineContextMenu'
import { TimelineHeader } from './TimelineHeader'
import { TimelinePlayhead } from './TimelinePlayhead'
import { TimelineRuler } from './TimelineRuler'
import { TrackLanes } from './TrackLanes'
import { TrackList, TrackListHeader } from './TrackList'
import {
  copySelectedClip,
  cutSelectedClip,
  deleteClipByFamily,
  duplicateSelectedAfter,
  seekTo,
  selectClip,
  splitSelectedAtPlayhead,
  type CommandResult,
} from './timelineCommands'
import { buildTimelineRows, type TimelineRow } from './timelineRows'
import { useTimelineHotkeys } from './useTimelineHotkeys'
import { useTimelineViewport } from './useTimelineViewport'

const TRACK_COLUMN_PX = 290
const NO_SPACE = 'director.reason.clipNoSpace'

type Translate = ReturnType<typeof useTranslation>['t']

function lookAtTargetName(scene: DirectorScene, clip: LookAtClip, t: Translate): string {
  if (clip.targetType === 'none') return t('director.timeline.clip.lookatNone')
  if (clip.targetType === 'custom') return t('director.timeline.clip.lookatCustom')
  return scene.cameras.find((camera) => camera.id === clip.targetId)?.name ?? scene.objects.find((object) => object.id === clip.targetId)?.name ?? '—'
}

/** 折叠时只留头部（h-9）。壳按它把第二栏钉成固定像素。 */
export const TIMELINE_COLLAPSED_PX = 36
/** 空态留「头部 + 一条（轨道列头 h-[26px]）」：省地方，但保住「+ 添加轨道」这条主路径。 */
export const TIMELINE_EMPTY_PX = 62

export function DirectorTimeline({
  collapsed,
  onToggleCollapsed,
  scopeRef,
}: {
  collapsed: boolean
  onToggleCollapsed: () => void
  scopeRef: React.MutableRefObject<DirectorHotkeyScope>
}): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const scene = useDirectorStore((state) => state.activeScene())
  const totalDuration = useDirectorStore((state) => state.timeline.totalDuration)

  const labeler = React.useMemo<ClipLabeler>(
    () => ({
      trajectory: (clip) => t('director.timeline.clip.trajectory', { start: clip.startFrame, end: clip.endFrame }),
      action: (clip) => (clip.clipType === 'custom_pose' ? t('director.timeline.clip.pose') : clip.name),
      lookat: (clip) => t('director.timeline.clip.lookat', { target: lookAtTargetName(scene, clip, t) }),
      // 片段条只写「特写片段 起~止帧」，参数住检查器
      closeup: (clip) => t('director.timeline.clip.closeup', { start: clip.startFrame, end: clip.endFrame }),
    }),
    [scene, t],
  )
  const tracks = React.useMemo(() => buildTimelineTracks(scene, labeler), [labeler, scene])
  const rows = React.useMemo(() => buildTimelineRows(tracks), [tracks])
  const isEmpty = tracks.length === 0
  const viewport = useTimelineViewport()
  const trackListRef = React.useRef<HTMLDivElement>(null)
  const [menu, setMenu] = React.useState<{ x: number; y: number; items: TimelineMenuItem[] } | null>(null)
  const [actionModal, setActionModal] = React.useState<{ objectId: string; at: number } | null>(null)

  const reject = React.useCallback((reasonKey: string) => toast(t(reasonKey as typeof NO_SPACE), 'warning'), [t])
  // 接在该轨道最后一段（含特写）之后，无片段从播放头起；4s，放不下就报
  const appendTrajectory = React.useCallback(
    (track: TimelineTrack) => {
      const clips = [...(track.entity.trajectoryClips ?? []), ...(isDirectorCamera(track.entity) ? track.entity.closeupClips ?? [] : [])]
      const tail = clips.length ? clips.reduce((max, clip) => Math.max(max, clip.endTime), 0) : store.getState().timeline.currentTime
      if (!store.getState().addTrajectoryClip(track.entityId, tail)) reject(NO_SPACE)
    },
    [reject, store],
  )
  const run = React.useCallback(
    (result: CommandResult) => {
      if (!result.ok && result.reasonKey) reject(result.reasonKey)
    },
    [reject],
  )
  useTimelineHotkeys({ scopeRef, onReject: reject })

  const closeMenu = React.useCallback(() => setMenu(null), [])
  const openMenu = (event: React.MouseEvent<HTMLElement>, items: TimelineMenuItem[]) => {
    event.preventDefault()
    if (items.length === 0) return
    setMenu({ x: event.clientX, y: event.clientY, items })
  }

  // 菜单三层：片段级（有 clipId 时）→ 副轨级（按家族）→ 轨道级
  const buildMenu = (track: TimelineTrack, family: TrackFamily, clipId: string | undefined, time: number): TimelineMenuItem[] => {
    const state = store.getState()
    const entity = track.entity
    const isCamera = isDirectorCamera(entity)
    const at = quantizeToFrame(time)
    const label = (key: string) => t(`director.timeline.menu.${key}`)
    const items: TimelineMenuItem[] = []
    if (clipId && family !== 'bone') {
      const clipFamily = family as ClipFamily
      const focus = () => selectClip(store, entity.id, clipFamily, clipId)
      items.push(
        { id: 'copy', label: label('copy'), onSelect: () => { focus(); run(copySelectedClip(store)) } },
        { id: 'duplicate', label: label('duplicate'), onSelect: () => { focus(); run(duplicateSelectedAfter(store)) } },
        { id: 'split', label: label('splitAtPlayhead'), onSelect: () => { focus(); run(splitSelectedAtPlayhead(store)) } },
        { id: 'cutLeft', label: label('cutLeft'), onSelect: () => { focus(); run(cutSelectedClip(store, 'left')) } },
        { id: 'cutRight', label: label('cutRight'), onSelect: () => { focus(); run(cutSelectedClip(store, 'right')) } },
        { id: 'deleteClip', label: label('deleteClip'), danger: true, onSelect: () => deleteClipByFamily(store.getState(), entity, clipFamily, clipId) },
        { id: 'sep-clip', separator: true },
      )
    }
    if (family === 'trajectory') {
      // 所有追加入口共用包含机位特写的泳道末尾。
      const firstStart = (entity.trajectoryClips ?? []).reduce((min, clip) => Math.min(min, clip.startTime), Number.POSITIVE_INFINITY)
      items.push(
        { id: 'append', label: label('appendTrajectory'), onSelect: () => appendTrajectory(track) },
        {
          id: 'prepend',
          label: label('prependTrajectory'),
          onSelect: () => {
            const start = Number.isFinite(firstStart) ? Math.max(0, firstStart - 4) : 0
            if (!store.getState().addTrajectoryClip(entity.id, start)) reject(NO_SPACE)
          },
        },
        { id: 'here', label: label('trajectoryHere'), onSelect: () => { if (!store.getState().addTrajectoryClip(entity.id, at)) reject(NO_SPACE) } },
      )
    }
    if (family === 'action') {
      items.push(
        { id: 'addAction', label: label('addAction'), onSelect: () => setActionModal({ objectId: entity.id, at }) },
        {
          id: 'addPose',
          label: label('addPose'),
          onSelect: () => {
            if (!store.getState().addActionClip(entity.id, { name: t('director.timeline.clip.pose'), clipType: 'custom_pose' }, 'at_time', at)) reject(NO_SPACE)
          },
        },
      )
    }
    if (family === 'bone') {
      items.push({
        id: 'insertBone',
        label: label('insertBoneKeyframe'),
        onSelect: () => {
          seekTo(store, at)
          if (!store.getState().insertBoneKeyframe(entity.id, at)) reject('director.timeline.toast.needPoseClip')
        },
      })
    }
    if (family === 'lookat') {
      items.push({ id: 'addLookAt', label: label('addLookAt'), onSelect: () => { if (!store.getState().addLookAtClip(entity.id, 'at_time', at)) reject(NO_SPACE) } })
    }
    // 创建特写片段（清单 §6）：角色轨 = 正面特写预设新建机位 + 4s 特写；机位轨 = 给该机位追加特写；都把播放头跳到片段开头并进预览
    if (track.kind === 'character' && (family === 'trajectory' || family === 'action')) {
      items.push({
        id: 'createCloseup',
        label: label('createCloseup'),
        onSelect: () => {
          const created = store.getState().createCloseupForCharacter(entity.id, t('director.creation.cameraName', { index: state.activeScene().cameras.length + 1 }))
          if (!created) reject(NO_SPACE)
        },
      })
    }
    if (family === 'closeup') {
      items.push({
        id: 'createCloseup',
        label: label('createCloseup'),
        onSelect: () => {
          if (!store.getState().appendCloseupForCamera(entity.id)) reject('director.camera.closeupNeedsTarget')
        },
      })
    }
    const payload = state.clipboard
    if (payload && canPasteTo(payload, entity)) {
      items.push({ id: 'paste', label: label('pasteHere'), onSelect: () => { if (!store.getState().pasteClip(entity.id, payload, at)) reject('director.timeline.toast.noSpace') } })
    }
    items.push(
      { id: 'sep-track', separator: true },
      { id: 'pin', label: track.pinned ? label('unpin') : label('pin'), onSelect: () => store.getState().toggleTimelineTrackPin(entity.id) },
      { id: 'fold', label: track.folded ? label('unfold') : label('fold'), onSelect: () => store.getState().toggleTimelineTrackFold(entity.id) },
      { id: 'remove', label: label('removeTrack'), onSelect: () => store.getState().removeEntityFromTimeline(entity.id) },
      { id: 'deleteEntity', label: label('deleteEntity'), danger: true, onSelect: () => (isCamera ? store.getState().deleteCamera(entity.id) : store.getState().deleteObject(entity.id)) },
    )
    return items
  }

  const rowMenu = (event: React.MouseEvent<HTMLElement>, row: TimelineRow, clipId: string | undefined, time: number) => {
    const family = clipId ? findClipView(tracks, clipId)?.sub.family : undefined
    openMenu(event, buildMenu(row.track, family ?? (row.kind === 'sub' ? row.sub.family : 'trajectory'), clipId, time))
  }

  // 主行「+」：只列「往这条轨道追加什么片段」（行内加号：内置动作 / 骨骼姿态 / 视线注视；机位轨 = 特写）
  const addClipMenu = (event: React.MouseEvent<HTMLElement>, track: TimelineTrack) => {
    const at = quantizeToFrame(store.getState().timeline.currentTime)
    const entity = track.entity
    const label = (key: string) => t(`director.timeline.menu.${key}`)
    const items: TimelineMenuItem[] = []
    if (track.kind === 'character') {
      items.push(
        { id: 'addAction', label: label('addActionClip'), onSelect: () => setActionModal({ objectId: entity.id, at }) },
        {
          id: 'addPose',
          label: label('addPoseClip'),
          onSelect: () => {
            if (!store.getState().addActionClip(entity.id, { name: t('director.timeline.clip.pose'), clipType: 'custom_pose' }, 'at_time', at)) reject(NO_SPACE)
          },
        },
        { id: 'addLookAt', label: label('addLookAtClip'), onSelect: () => { if (!store.getState().addLookAtClip(entity.id, 'at_time', at)) reject(NO_SPACE) } },
        {
          id: 'createCloseup',
          label: label('createCloseup'),
          onSelect: () => {
            const created = store.getState().createCloseupForCharacter(entity.id, t('director.creation.cameraName', { index: store.getState().activeScene().cameras.length + 1 }))
            if (!created) reject(NO_SPACE)
          },
        },
      )
    } else if (track.kind === 'camera') {
      items.push({ id: 'createCloseup', label: label('createCloseup'), onSelect: () => { if (!store.getState().appendCloseupForCamera(entity.id)) reject('director.camera.closeupNeedsTarget') } })
    }
    items.push({ id: 'append', label: label('appendTrajectory'), onSelect: () => appendTrajectory(track) })
    openMenu(event, items)
  }

  return (
    <div
      className="relative flex h-full w-full flex-col bg-nomi-paper"
      data-testid="director-timeline"
      onPointerEnter={() => {
        scopeRef.current = 'timeline'
      }}
    >
      <TimelineHeader viewport={viewport} collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} onReject={reject} />
      {/* 空态只留一条：轨道区没内容时不值得占掉五分之一屏（2026-09-09 第 3 期）。
          但「+ 添加轨道」必须跟着留下来 —— 它是把实体放上时间轴的主路径，收掉就成了死胡同。 */}
      {!collapsed && isEmpty ? (
        <div className="flex min-h-0 flex-1 items-stretch" data-testid="director-timeline-empty">
          <div className="flex flex-1 items-center gap-2 px-3 text-caption text-nomi-ink-40">
            <span className="text-nomi-ink-60">{t('director.timeline.emptyTitle')}</span>
            <span className="min-w-0 truncate text-micro">{t('director.timeline.emptyHint')}</span>
          </div>
          <div className="w-[220px] shrink-0 border-l border-nomi-line-soft">
            <TrackListHeader trackCount={0} />
          </div>
        </div>
      ) : null}
      {collapsed || isEmpty ? null : (
        <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: `${TRACK_COLUMN_PX}px minmax(0, 1fr)` }}>
          <div ref={trackListRef} className="flex min-h-0 flex-col overflow-hidden border-r border-nomi-line-soft">
            <TrackListHeader trackCount={tracks.length} />
            <div className="min-h-0 flex-1 overflow-hidden">
              <TrackList
                rows={rows}
                tracks={tracks}
                onOpenAddClipMenu={addClipMenu}
                onCreateCloseup={(track) => {
                  const state = store.getState()
                  if (track.kind === 'character') {
                    if (!state.createCloseupForCharacter(track.entityId, t('director.creation.cameraName', { index: state.activeScene().cameras.length + 1 }))) reject(NO_SPACE)
                  } else if (!state.appendCloseupForCamera(track.entityId)) reject('director.camera.closeupNeedsTarget')
                }}
                onSplitAtPlayhead={(track) => {
                  const state = store.getState()
                  const selected = state.selection.clipId ? findClipView(tracks, state.selection.clipId) : null
                  if (!selected || selected.track.entityId !== track.entityId || selected.sub.family === 'bone') {
                    reject('director.timeline.toast.noClipAtPlayhead')
                    return
                  }
                  if (!state.splitClip(track.entityId, selected.clip.id, selected.sub.family, state.timeline.currentTime)) reject('director.timeline.toast.playheadOutsideClip')
                }}
                onDeleteEntity={(track) => (isDirectorCamera(track.entity) ? store.getState().deleteCamera(track.entityId) : store.getState().deleteObject(track.entityId))}
                onContextMenu={(event, row) => rowMenu(event, row, undefined, store.getState().timeline.currentTime)}
                onEnterPov={(cameraId) => {
                  const check = store.getState().enterCameraPOV(cameraId)
                  if (!check.allowed && check.reasonKey) reject(check.reasonKey)
                }}
              />
            </div>
          </div>
          <div
            ref={viewport.containerRef}
            className="relative min-h-0 overflow-auto"
            onScroll={(event) => {
              if (trackListRef.current) trackListRef.current.scrollTop = event.currentTarget.scrollTop
            }}
          >
            <div className="relative" style={{ width: viewport.laneWidth }}>
              <TimelineRuler viewport={viewport} onScrub={(seconds) => seekTo(store, seconds)} />
              <TrackLanes rows={rows} viewport={viewport} totalDuration={totalDuration} onContextMenu={rowMenu} onReject={reject} onAppendTrajectory={(row) => appendTrajectory(row.track)} />
              <TimelinePlayhead viewport={viewport} />
            </div>
          </div>
        </div>
      )}
      {menu ? <TimelineContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} /> : null}
      <ActionSelectModal
        open={actionModal !== null}
        onClose={() => setActionModal(null)}
        onPick={(entry) => {
          if (!actionModal) return
          // 内置动作片段固定 4s（不足就到时间轴末尾），名字「动作·X」
          const created = store.getState().addActionClip(
            actionModal.objectId,
            { name: t('director.action.clipName', { name: t(`director.action.library.${entry.id}`) }), clipType: 'action', actionPose: entry.id, duration: 4 },
            'at_time',
            actionModal.at,
          )
          if (!created) reject(NO_SPACE)
        }}
      />
    </div>
  )
}
