/**
 * [INPUT]: 依赖 ../model/directorStore 的 DirectorStore / DirectorStoreState、../model/directorTypes（TimelineEntity / isDirectorCamera）、
 *          ../model/storeClipActions 的 ClipFamily、../model/timelineClipboard（copyClipPayload / canPasteTo）、
 *          ../model/timelineTracks（sceneSplitPoints / stepToNeighbor）、../model/timeGrid（FRAME_SECONDS / clampToTimeline / quantizeToFrame）
 * [OUTPUT]: 对外提供 CommandResult 与时间轴命令：seekTo / togglePlay / stopPlayback / stepFrames / jumpSplitPoint / selectedTimelineEntity /
 *           selectClip / selectWaypoint / clearTimelineSelection / insertKeyframeAtPlayhead / copySelectedClip / pasteClipboardAtPlayhead /
 *           duplicateSelectedAfter / cutSelectedClip / splitSelectedAtPlayhead / deleteTimelineSelection / deleteClipByFamily / NEED_CLIP_SELECTION
 * [POS]: director/timeline 的命令层（零 React）：头部按钮、右键菜单、快捷键三处入口共用同一实现；拒绝原因以 i18n key 回传，由 UI 决定 toast。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { DirectorStore, DirectorStoreState } from '../model/directorStore'
import type { TimelineEntity } from '../model/directorTypes'
import { isDirectorCamera } from '../model/directorTypes'
import type { ClipFamily } from '../model/storeClipActions'
import { canPasteTo, copyClipPayload } from '../model/timelineClipboard'
import { sceneSplitPoints, stepToNeighbor } from '../model/timelineTracks'
import { clampToTimeline, FRAME_SECONDS, quantizeToFrame } from '../model/timeGrid'

export type CommandResult = { ok: boolean; reasonKey?: string }
export const NEED_CLIP_SELECTION = 'director.timeline.toast.needClipSelection'
const OK: CommandResult = { ok: true }
const fail = (reasonKey: string): CommandResult => ({ ok: false, reasonKey })

export function seekTo(store: DirectorStore, seconds: number, pause: boolean = true): void {
  const state = store.getState()
  const time = quantizeToFrame(clampToTimeline(seconds, state.timeline.totalDuration))
  state.setTimelineContext(pause ? { currentTime: time, isPlaying: false } : { currentTime: time })
}

// Space：播放 ⇄ 暂停；停在内容末尾时再按 = 从头播
export function togglePlay(store: DirectorStore): void {
  const state = store.getState()
  if (state.timeline.isPlaying) {
    state.setTimelineContext({ isPlaying: false })
    return
  }
  const contentEnd = state.contentEndSeconds()
  if (contentEnd <= 0) return
  const restart = state.timeline.currentTime >= contentEnd - FRAME_SECONDS / 2
  state.setTimelineContext(restart ? { isPlaying: true, currentTime: 0 } : { isPlaying: true })
}

export function stopPlayback(store: DirectorStore): void {
  store.getState().setTimelineContext({ isPlaying: false, currentTime: 0 })
}

export function stepFrames(store: DirectorStore, frames: number): void {
  seekTo(store, store.getState().timeline.currentTime + frames * FRAME_SECONDS)
}

export function jumpSplitPoint(store: DirectorStore, direction: 'prev' | 'next'): void {
  const state = store.getState()
  const target = stepToNeighbor(sceneSplitPoints(state.activeScene()), state.timeline.currentTime, direction)
  if (target !== null) seekTo(store, target)
}

export function selectedTimelineEntity(store: DirectorStore): TimelineEntity | null {
  const state = store.getState()
  return state.findObject(state.selection.objectId) ?? state.findCamera(state.selection.cameraId) ?? null
}

function entitySelectionPatch(state: DirectorStoreState, entityId: string) {
  const isCamera = Boolean(state.findCamera(entityId))
  return isCamera
    ? { cameraId: entityId, objectId: null, lightId: null, multiObjectIds: [] as string[] }
    : { objectId: entityId, cameraId: null, lightId: null, multiObjectIds: [entityId] }
}

export function selectClip(store: DirectorStore, entityId: string, family: ClipFamily, clipId: string): void {
  const state = store.getState()
  state.select({ ...entitySelectionPatch(state, entityId), clipId, clipType: family, activeWaypointId: null, selectedWaypointIds: [], boneKeyframeId: null, boneClipId: null })
}

// 选路标 = 进关键帧编辑层 + 播放头跳到它（Shift 累加多选）
export function selectWaypoint(store: DirectorStore, entityId: string, waypointId: string, additive: boolean): void {
  const state = store.getState()
  const entity = state.findObject(entityId) ?? state.findCamera(entityId)
  const waypoint = entity?.motionTrajectory?.find((item) => item.id === waypointId)
  if (!entity || !waypoint) return
  const selectedWaypointIds = additive ? Array.from(new Set([...state.selection.selectedWaypointIds, waypointId])) : [waypointId]
  state.select({
    ...entitySelectionPatch(state, entityId),
    activeWaypointId: waypointId,
    selectedWaypointIds,
    clipId: waypoint.clipId ?? null,
    clipType: waypoint.clipId ? 'trajectory' : null,
    boneKeyframeId: null,
    boneClipId: null,
  })
  seekTo(store, waypoint.time)
}

export function clearTimelineSelection(store: DirectorStore): void {
  store.getState().select({ clipId: null, clipType: null, activeWaypointId: null, selectedWaypointIds: [], boneKeyframeId: null, boneClipId: null })
}

export function insertKeyframeAtPlayhead(store: DirectorStore): CommandResult {
  const entity = selectedTimelineEntity(store)
  if (!entity) return fail('director.timeline.toast.selectEntityForKeyframe')
  const state = store.getState()
  return state.insertKeyframeAt(entity.id, state.timeline.currentTime) ? OK : fail('director.reason.clipNoSpace')
}

function selectedClip(store: DirectorStore): { entity: TimelineEntity; family: ClipFamily; clipId: string } | null {
  const state = store.getState()
  const entity = selectedTimelineEntity(store)
  const family = state.selection.clipType
  const clipId = state.selection.clipId
  return entity && family && clipId ? { entity, family, clipId } : null
}

export function copySelectedClip(store: DirectorStore): CommandResult {
  const selected = selectedClip(store)
  if (!selected) return fail(NEED_CLIP_SELECTION)
  const payload = copyClipPayload(selected.entity, selected.family, selected.clipId)
  if (!payload) return fail(NEED_CLIP_SELECTION)
  store.getState().setClipboard(payload)
  return OK
}

export function pasteClipboardAtPlayhead(store: DirectorStore): CommandResult {
  const state = store.getState()
  const payload = state.clipboard
  if (!payload) return fail('director.timeline.toast.clipboardEmpty')
  const entity = selectedTimelineEntity(store)
  if (!entity) return fail('director.timeline.toast.selectTrackForPaste')
  if (!canPasteTo(payload, entity)) return fail('director.timeline.toast.pasteRejected')
  return state.pasteClip(entity.id, payload, state.timeline.currentTime) ? OK : fail('director.timeline.toast.noSpace')
}

export function duplicateSelectedAfter(store: DirectorStore): CommandResult {
  const selected = selectedClip(store)
  if (!selected) return fail(NEED_CLIP_SELECTION)
  return store.getState().duplicateClipAfter(selected.entity.id, selected.clipId, selected.family) ? OK : fail('director.timeline.toast.noSpace')
}

export function cutSelectedClip(store: DirectorStore, side: 'left' | 'right'): CommandResult {
  const selected = selectedClip(store)
  if (!selected) return fail(NEED_CLIP_SELECTION)
  const state = store.getState()
  return state.trimClip(selected.entity.id, selected.clipId, selected.family, side, state.timeline.currentTime) ? OK : fail('director.timeline.toast.playheadOutsideClip')
}

export function splitSelectedAtPlayhead(store: DirectorStore): CommandResult {
  const selected = selectedClip(store)
  if (!selected) return fail(NEED_CLIP_SELECTION)
  const state = store.getState()
  return state.splitClip(selected.entity.id, selected.clipId, selected.family, state.timeline.currentTime) ? OK : fail('director.timeline.toast.playheadOutsideClip')
}

export function deleteClipByFamily(state: DirectorStoreState, entity: TimelineEntity, family: ClipFamily, clipId: string): void {
  if (family === 'trajectory') state.deleteTrajectoryClip(entity.id, clipId)
  else if (family === 'closeup') state.deleteCloseupClip(entity.id, clipId)
  else if (family === 'action') state.deleteActionClip(entity.id, clipId)
  else state.deleteLookAtClip(entity.id, clipId)
}

// Backspace：先删选中的路标 / 骨骼帧，再删选中的片段；什么都没选返回 false 让编辑器去删实体
export function deleteTimelineSelection(store: DirectorStore): CommandResult {
  const state = store.getState()
  const entity = selectedTimelineEntity(store)
  if (!entity) return fail(NEED_CLIP_SELECTION)
  if (state.selection.selectedWaypointIds.length > 0) {
    state.deleteWaypoints(entity.id, state.selection.selectedWaypointIds)
    return OK
  }
  if (state.selection.boneKeyframeId && !isDirectorCamera(entity)) {
    state.deleteBoneKeyframe(entity.id, state.selection.boneKeyframeId)
    return OK
  }
  const family = state.selection.clipType
  const clipId = state.selection.clipId
  if (!family || !clipId) return fail(NEED_CLIP_SELECTION)
  deleteClipByFamily(state, entity, family, clipId)
  return OK
}
