/**
 * [INPUT]: 依赖 ./directorTypes（DirectorScene / TimelineEntity / 各片段类型 / isDirectorCamera）、./timeGrid 的 FRAME_EPSILON / entityClips
 * [OUTPUT]: 对外提供 TrackFamily / ClipTone / TrackEntityKind / TimelineTrack / TimelineSubTrack / TimelineClipView / TimelineMarkerView / ClipLabeler、
 *           timelineEntityKind、orderedTimelineEntities、entitiesOutsideTimeline、buildTimelineTracks、familyMarkerTimes、
 *           sceneSplitPoints、stepToNeighbor、findClipView
 * [POS]: director/model 的轨道视图求导（清单 §5.2）：「谁在时间轴上、什么顺序、每轨几条副轨、副轨上有哪些片段/关键帧」
 *        从工程一次算出；时间轴 UI、快捷键、节目机位消费同一份顺序（顺序 = 节目机位优先级），不各自遍历实体。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ActionClip, CloseupClip, DirectorCamera, DirectorObject, DirectorScene, LookAtClip, TimelineEntity, TrajectoryClip } from './directorTypes'
import { isDirectorCamera } from './directorTypes'
import { entityClips, FRAME_EPSILON } from './timeGrid'

export type TrackFamily = 'trajectory' | 'action' | 'bone' | 'lookat' | 'closeup'
export type ClipTone = 'trajectory' | 'action' | 'pose' | 'lookat' | 'closeup'
export type TrackEntityKind = 'character' | 'object' | 'camera'

export type TimelineClipView = { id: string; family: TrackFamily; tone: ClipTone; startTime: number; endTime: number; label: string }
export type TimelineMarkerView = { id: string; time: number; clipId?: string }
export type TimelineSubTrack = { family: TrackFamily; bypassable: boolean; enabled: boolean; clips: TimelineClipView[]; markers: TimelineMarkerView[] }
export type TimelineTrack = {
  entityId: string
  entity: TimelineEntity
  kind: TrackEntityKind
  name: string
  pinned: boolean
  folded: boolean
  subTracks: TimelineSubTrack[]
}

export type ClipLabeler = {
  trajectory: (clip: TrajectoryClip) => string
  action: (clip: ActionClip) => string
  lookat: (clip: LookAtClip) => string
  closeup: (clip: CloseupClip) => string
}

type TrackScene = Pick<DirectorScene, 'objects' | 'cameras' | 'timelineTrackOrder' | 'timelineTrackPins' | 'timelineTrackFolds'>

export function timelineEntityKind(entity: TimelineEntity): TrackEntityKind {
  if (isDirectorCamera(entity)) return 'camera'
  return entity.type === 'character' ? 'character' : 'object'
}

function allEntities(scene: Pick<DirectorScene, 'objects' | 'cameras'>): TimelineEntity[] {
  return [...scene.objects, ...scene.cameras]
}

// 顺序 = timelineTrackOrder（钉住的先）；已入轴但未登记顺序的实体按场景顺序补在后面
export function orderedTimelineEntities(scene: Pick<DirectorScene, 'objects' | 'cameras' | 'timelineTrackOrder' | 'timelineTrackPins'>): TimelineEntity[] {
  const entities = allEntities(scene).filter((entity) => entity.inTimeline)
  const byId = new Map(entities.map((entity) => [entity.id, entity] as const))
  const ordered: TimelineEntity[] = []
  const seen = new Set<string>()
  for (const id of scene.timelineTrackOrder) {
    const entity = byId.get(id)
    if (!entity || seen.has(id)) continue
    ordered.push(entity)
    seen.add(id)
  }
  for (const entity of entities) {
    if (seen.has(entity.id)) continue
    ordered.push(entity)
    seen.add(entity.id)
  }
  const pins = new Set(scene.timelineTrackPins)
  return [...ordered.filter((entity) => pins.has(entity.id)), ...ordered.filter((entity) => !pins.has(entity.id))]
}

// 「+ 添加轨道」候选：还没入轴的角色/物体/机位（辅助球不进时间轴）
export function entitiesOutsideTimeline(scene: Pick<DirectorScene, 'objects' | 'cameras'>): TimelineEntity[] {
  return allEntities(scene).filter((entity) => !entity.inTimeline && !(entity as DirectorObject).isAuxiliary)
}

function trajectorySubTrack(entity: TimelineEntity, labeler: ClipLabeler): TimelineSubTrack {
  return {
    family: 'trajectory',
    bypassable: false,
    enabled: true,
    clips: (entity.trajectoryClips ?? []).map((clip) => ({
      id: clip.id,
      family: 'trajectory',
      tone: 'trajectory',
      startTime: clip.startTime,
      endTime: clip.endTime,
      label: labeler.trajectory(clip),
    })),
    markers: (entity.motionTrajectory ?? []).map((waypoint) => ({ id: waypoint.id, time: waypoint.time, clipId: waypoint.clipId })),
  }
}

export function buildTimelineTracks(scene: TrackScene, labeler: ClipLabeler): TimelineTrack[] {
  const pins = new Set(scene.timelineTrackPins)
  const folds = new Set(scene.timelineTrackFolds)
  return orderedTimelineEntities(scene).map((entity) => {
    const kind = timelineEntityKind(entity)
    const subTracks: TimelineSubTrack[] = [trajectorySubTrack(entity, labeler)]
    if (kind === 'character') {
      const object = entity as DirectorObject
      const actionClips = object.actionClips ?? []
      subTracks.push({
        family: 'action',
        bypassable: true,
        enabled: object.actionTrackEnabled !== false,
        clips: actionClips.map((clip) => ({
          id: clip.id,
          family: 'action',
          tone: clip.clipType === 'custom_pose' ? 'pose' : 'action',
          startTime: clip.startTime,
          endTime: clip.endTime,
          label: labeler.action(clip),
        })),
        markers: [],
      })
      subTracks.push({
        family: 'bone',
        bypassable: false,
        enabled: true,
        clips: [],
        markers: actionClips.flatMap((clip) =>
          clip.clipType === 'custom_pose' ? (clip.keyframes ?? []).map((keyframe) => ({ id: keyframe.id, time: keyframe.time, clipId: clip.id })) : [],
        ),
      })
      subTracks.push({
        family: 'lookat',
        bypassable: true,
        enabled: object.lookAtTrackEnabled !== false,
        clips: (object.lookAtClips ?? []).map((clip) => ({
          id: clip.id,
          family: 'lookat',
          tone: 'lookat',
          startTime: clip.startTime,
          endTime: clip.endTime,
          label: labeler.lookat(clip),
        })),
        markers: [],
      })
    }
    if (kind === 'camera') {
      const camera = entity as DirectorCamera
      subTracks.push({
        family: 'closeup',
        bypassable: false,
        enabled: true,
        clips: (camera.closeupClips ?? []).map((clip) => ({
          id: clip.id,
          family: 'closeup',
          tone: 'closeup',
          startTime: clip.startTime,
          endTime: clip.endTime,
          label: labeler.closeup(clip),
        })),
        markers: [],
      })
    }
    return { entityId: entity.id, entity, kind, name: entity.name, pinned: pins.has(entity.id), folded: folds.has(entity.id), subTracks }
  })
}

function uniqueSorted(times: number[]): number[] {
  const sorted = [...times].sort((a, b) => a - b)
  const result: number[] = []
  for (const time of sorted) {
    if (result.length === 0 || time - result[result.length - 1] > FRAME_EPSILON) result.push(time)
  }
  return result
}

// 副轨「上一个 / 下一个关键帧」候选：路径 = 路标，骨骼 = 关键帧，其余 = 片段两端
export function familyMarkerTimes(entity: TimelineEntity, family: TrackFamily): number[] {
  if (family === 'trajectory') return uniqueSorted((entity.motionTrajectory ?? []).map((waypoint) => waypoint.time))
  if (family === 'bone') {
    return uniqueSorted(
      ((entity as DirectorObject).actionClips ?? []).flatMap((clip) => (clip.clipType === 'custom_pose' ? (clip.keyframes ?? []).map((keyframe) => keyframe.time) : [])),
    )
  }
  const clips =
    family === 'action'
      ? (entity as DirectorObject).actionClips
      : family === 'lookat'
        ? (entity as DirectorObject).lookAtClips
        : (entity as DirectorCamera).closeupClips
  return uniqueSorted((clips ?? []).flatMap((clip) => [clip.startTime, clip.endTime]))
}

// 全时间轴的片段端点（ArrowUp / ArrowDown 跳转）
export function sceneSplitPoints(scene: TrackScene): number[] {
  return uniqueSorted(orderedTimelineEntities(scene).flatMap((entity) => entityClips(entity).flatMap((clip) => [clip.startTime, clip.endTime])))
}

export function stepToNeighbor(times: number[], current: number, direction: 'prev' | 'next'): number | null {
  if (direction === 'next') return times.find((time) => time > current + FRAME_EPSILON) ?? null
  const before = times.filter((time) => time < current - FRAME_EPSILON)
  return before.length ? before[before.length - 1] : null
}

export function findClipView(tracks: TimelineTrack[], clipId: string): { track: TimelineTrack; sub: TimelineSubTrack; clip: TimelineClipView } | null {
  for (const track of tracks) {
    for (const sub of track.subTracks) {
      const clip = sub.clips.find((item) => item.id === clipId)
      if (clip) return { track, sub, clip }
    }
  }
  return null
}
