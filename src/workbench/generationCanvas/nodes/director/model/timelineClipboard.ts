/**
 * [INPUT]: 依赖 ./directorTypes（片段/路标类型、TimelineEntity、isDirectorCamera）、./timeGrid 的 quantizeToFrame / secondsToFrame
 * [OUTPUT]: 对外提供 ClipboardPayload / ClipboardFamily / PasteIdFactory、copyClipPayload、canPasteTo、relocatePayload
 * [POS]: director/model 的片段剪贴板（清单 §5.2 复制/粘贴规则）：特写只能贴到机位轨、视线/动作只能贴到角色轨、路径两者皆可；
 *        粘贴 = 平移时间 + 全部换新 id（片段、路标、骨骼帧）；有没有空位由 store 用 findFreeStart 判。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ActionClip, CloseupClip, DirectorObject, LookAtClip, TimelineEntity, TrajectoryClip, Waypoint } from './directorTypes'
import { waypointsOfClip } from './clips'
import { isDirectorCamera } from './directorTypes'
import { quantizeToFrame, secondsToFrame } from './timeGrid'

export type ClipboardPayload =
  | { family: 'trajectory'; clip: TrajectoryClip; waypoints: Waypoint[] }
  | { family: 'action'; clip: ActionClip }
  | { family: 'lookat'; clip: LookAtClip }
  | { family: 'closeup'; clip: CloseupClip }

export type ClipboardFamily = ClipboardPayload['family']
export type PasteIdFactory = { clipId: (family: ClipboardFamily) => string; waypointId: () => string; keyframeId: () => string }

export function copyClipPayload(entity: TimelineEntity, family: ClipboardFamily, clipId: string): ClipboardPayload | null {
  if (family === 'trajectory') {
    const clip = entity.trajectoryClips?.find((item) => item.id === clipId)
    if (!clip) return null
    const waypoints = waypointsOfClip(entity.motionTrajectory ?? [], clip, entity.trajectoryClips)
    return { family, clip: { ...clip }, waypoints: waypoints.map((waypoint) => ({ ...waypoint })) }
  }
  if (family === 'closeup') {
    if (!isDirectorCamera(entity)) return null
    const clip = entity.closeupClips?.find((item) => item.id === clipId)
    return clip ? { family, clip: structuredClone(clip) } : null
  }
  if (isDirectorCamera(entity)) return null
  const object = entity as DirectorObject
  if (family === 'action') {
    const clip = object.actionClips?.find((item) => item.id === clipId)
    if (!clip) return null
    return { family, clip: structuredClone(clip) }
  }
  const clip = object.lookAtClips?.find((item) => item.id === clipId)
  return clip ? { family, clip: { ...clip } } : null
}

export function canPasteTo(payload: ClipboardPayload, entity: TimelineEntity): boolean {
  const camera = isDirectorCamera(entity)
  if (payload.family === 'closeup') return camera
  if (payload.family === 'action' || payload.family === 'lookat') return !camera && (entity as DirectorObject).type === 'character'
  return true
}

function shiftedFrames<T extends { startTime: number; endTime: number; startFrame: number; endFrame: number }>(clip: T, startTime: number): T {
  const duration = clip.endTime - clip.startTime
  const start = quantizeToFrame(startTime)
  const end = quantizeToFrame(start + duration)
  return { ...clip, startTime: start, endTime: end, startFrame: secondsToFrame(start), endFrame: secondsToFrame(end) }
}

// 平移到 startTime 并换新 id；路标/骨骼帧随片段一起平移（保持相对节奏）
export function relocatePayload(payload: ClipboardPayload, startTime: number, ids: PasteIdFactory): ClipboardPayload {
  const delta = quantizeToFrame(startTime) - payload.clip.startTime
  const clipId = ids.clipId(payload.family)
  if (payload.family === 'trajectory') {
    const clip = { ...shiftedFrames(payload.clip, startTime), id: clipId }
    const waypoints = payload.waypoints.map((waypoint) => {
      const time = quantizeToFrame(waypoint.time + delta)
      return { ...waypoint, id: ids.waypointId(), clipId, time, frameIndex: secondsToFrame(time) }
    })
    return { family: 'trajectory', clip, waypoints }
  }
  if (payload.family === 'action') {
    const clip = { ...shiftedFrames(payload.clip, startTime), id: clipId }
    clip.keyframes = payload.clip.keyframes?.map((keyframe) => {
      const time = quantizeToFrame(keyframe.time + delta)
      return { ...structuredClone(keyframe), id: ids.keyframeId(), time, frame: secondsToFrame(time) }
    })
    return { family: 'action', clip }
  }
  if (payload.family === 'lookat') return { family: 'lookat', clip: { ...shiftedFrames(payload.clip, startTime), id: clipId } }
  return { family: 'closeup', clip: { ...shiftedFrames(structuredClone(payload.clip), startTime), id: clipId } }
}
