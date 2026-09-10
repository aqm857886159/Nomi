/**
 * [INPUT]: 依赖 ./directorStore 的类型（CommitProject / StoreGet / StoreSet）、./directorTypes、./directorIds、
 *          ./clips（fitClipAt / clipsOverlap / extendClipTo / splitClipAt / trimClipToPlayhead / upsertWaypointAt / patchWaypoint /
 *          waypointsOfClip / waypointTimeBounds / createTrajectoryClip）、./clipKeyframes（resizeClipKeyframes / cutClipKeyframes / samplePoseAt）、./closeupRig（createCloseupClip / findCloseupClipAt）、
 *          ./editLayer 的 findTrajectoryClipAt、./timeGrid（entityClips / quantizeToFrame / secondsToFrame / FRAME_EPSILON）
 * [OUTPUT]: 对外提供 DirectorClipActions 与 createClipActions（路径片段/路标、特写片段、动作片段与骨骼关键帧、视线片段、
 *           副轨开关、活动片段、POV 进入判定）
 * [POS]: director/model 的时间轴 action 集合，由 directorStore 组装；每个片段家族的增删改都在这里，UI 只发意图。
 *        动作片段规则：内置动作前插 = 播放头前 4s（< 0.5s 不插）；骨骼姿态片段出生即带首帧（抄当前微调）；插骨骼关键帧无片段时自动建 3s 片段。
 *        返回的拒绝原因是 i18n key（`director.reason.*`），toast 在面板层翻译。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {
  clipsOverlap,
  createTrajectoryClip,
  extendClipTo,
  firstClipStartingAfter,
  lastClipEndedBefore,
  patchWaypoint,
  splitClipAt,
  trimClipToPlayhead,
  upsertWaypointAt,
  waypointTimeBounds,
  waypointsOfClip,
  type ClipLike,
  type WaypointPatch,
  fitClipAt,
} from './clips'
import { cutClipKeyframes, resizeClipKeyframes, samplePoseAt } from './clipKeyframes'
import { createCloseupClip, findCloseupClipAt } from './closeupRig'
import { createClipId, createKeyframeId, createWaypointId } from './directorIds'
import type { CommitProject, SelectedClipType, StoreGet, StoreSet } from './directorStore'
import type { ActionClip, BoneKeyframe, CloseupClip, DirectorCamera, DirectorObject, LookAtClip, TimelineEntity, TrajectoryClip, Vec3, Waypoint } from './directorTypes'
import { findTrajectoryClipAt } from './editLayer'
import { entityClips, FRAME_EPSILON, laneClips, quantizeToFrame, secondsToFrame } from './timeGrid'

export type ClipFamily = Exclude<SelectedClipType, null>
export type InsertMode = 'append' | 'prepend' | 'at_time'
export type PovCheck = { allowed: boolean; reasonKey?: 'director.reason.closeupLocked' | 'director.reason.cameraMissing' }

export type DirectorClipActions = {
  setActiveTrajectoryClip: (entityId: string, clipId: string | null) => void
  getActiveTrajectoryClip: (entityId: string) => string | null
  addTrajectoryClip: (entityId: string, preferredStart: number, duration?: number) => TrajectoryClip | null
  deleteTrajectoryClip: (entityId: string, clipId: string) => void
  prepareClipForKeyframeInsert: (entityId: string, time: number) => boolean
  updateClipTime: (entityId: string, clipId: string, family: ClipFamily, startTime: number, endTime: number, recordHistory?: boolean) => boolean
  splitClip: (entityId: string, clipId: string, family: ClipFamily, time: number) => string | null
  trimClip: (entityId: string, clipId: string, family: ClipFamily, side: 'left' | 'right', time: number) => boolean
  insertWaypoint: (entityId: string, time: number, values: WaypointPatch, clipId?: string) => Waypoint | null
  updateWaypoint: (entityId: string, waypointId: string, patch: WaypointPatch) => void
  updateWaypointTime: (entityId: string, waypointId: string, time: number) => number | null
  deleteWaypoints: (entityId: string, waypointIds: string[]) => void
  addCloseupClip: (cameraId: string, targetObjectId: string, preferredStart: number, duration?: number) => CloseupClip | null
  updateCloseupClip: (cameraId: string, clipId: string, patch: Partial<CloseupClip>) => void
  deleteCloseupClip: (cameraId: string, clipId: string) => void
  isCameraInCloseupAt: (cameraId: string, time?: number) => boolean
  canEnterCameraPOV: (cameraId: string, time?: number) => PovCheck
  addActionClip: (objectId: string, spec: { name: string; clipType: ActionClip['clipType']; actionPose?: string; duration?: number }, mode?: InsertMode, at?: number) => ActionClip | null
  deleteActionClip: (objectId: string, clipId: string) => void
  clearActionClips: (objectId: string) => void
  insertBoneKeyframe: (objectId: string, time: number) => BoneKeyframe | null
  updateBoneKeyframeTime: (objectId: string, keyframeId: string, time: number) => boolean
  deleteBoneKeyframe: (objectId: string, keyframeId: string) => void
  clearBoneKeyframes: (objectId: string) => void
  addLookAtClip: (objectId: string, mode?: InsertMode, at?: number, duration?: number) => LookAtClip | null
  updateLookAtClip: (objectId: string, clipId: string, patch: Partial<LookAtClip>) => void
  deleteLookAtClip: (objectId: string, clipId: string) => void
  clearLookAtClips: (objectId: string) => void
  toggleActionTrack: (objectId: string) => void
  toggleLookAtTrack: (objectId: string) => void
}

function findEntity(scene: { objects: DirectorObject[]; cameras: DirectorCamera[] }, entityId: string): TimelineEntity | undefined {
  return scene.objects.find((object) => object.id === entityId) ?? scene.cameras.find((camera) => camera.id === entityId)
}

function familyClips(entity: TimelineEntity, family: ClipFamily): ClipLike[] | undefined {
  switch (family) {
    case 'trajectory':
      return entity.trajectoryClips
    case 'closeup':
      return 'closeupClips' in entity ? entity.closeupClips : undefined
    case 'action':
      return 'actionClips' in entity ? entity.actionClips : undefined
    case 'lookat':
      return 'lookAtClips' in entity ? entity.lookAtClips : undefined
    default:
      return undefined
  }
}

function syncInTimeline(entity: TimelineEntity): void {
  entity.inTimeline = entityClips(entity).length > 0
}

// 放置：首选位置塞得下就落；塞不下但空档够就缩短到空档；否则退到下一个空位（规则住 clips.fitClipAt）。
// 只跟同一副轨（同 family）的片段争位置：路径 / 动作 / 视线 / 特写各住各的副轨，跨副轨同时存在是常态（边走边做动作）
// —— 2026-09-02 走查栽过：按全家族算重叠，1s 处加动作片段被 0–1.4s 的路径片段顶到轨道末尾
// 找空位按 单泳道规则：机位的路径 / 特写共用一条泳道
function placeClip(entity: TimelineEntity, family: ClipFamily, preferredStart: number, duration: number, maxEnd: number): { start: number; duration: number } | null {
  if (!Number.isFinite(preferredStart) || !Number.isFinite(duration) || duration < 1 / 30) return null
  return fitClipAt(laneClips(entity, family), preferredStart, duration, maxEnd)
}

export function createClipActions(set: StoreSet, get: StoreGet, commitProject: CommitProject): DirectorClipActions {
  const save = () => get().saveState()
  const maxEnd = () => get().timeline.totalDuration
  const selectOwner = (entity: TimelineEntity) => 'fov' in entity
    ? { cameraId: entity.id, objectId: null, lightId: null, multiObjectIds: [] }
    : { objectId: entity.id, cameraId: null, lightId: null, multiObjectIds: [entity.id] }

  const mutateEntity = <T,>(entityId: string, fn: (entity: TimelineEntity) => T): T | null => {
    let result: T | null = null
    commitProject((_, scene) => {
      const entity = findEntity(scene, entityId)
      if (entity) result = fn(entity)
    })
    return result
  }

  const mutateObject = <T,>(objectId: string, fn: (object: DirectorObject) => T): T | null => {
    let result: T | null = null
    commitProject((_, scene) => {
      const object = scene.objects.find((item) => item.id === objectId)
      if (object) result = fn(object)
    })
    return result
  }

  return {
    setActiveTrajectoryClip: (entityId, clipId) =>
      set((state) => {
        const activeTrajectoryClipIds = { ...state.activeTrajectoryClipIds }
        if (clipId) activeTrajectoryClipIds[entityId] = clipId
        else delete activeTrajectoryClipIds[entityId]
        return { activeTrajectoryClipIds }
      }),
    getActiveTrajectoryClip: (entityId) => get().activeTrajectoryClipIds[entityId] ?? null,

    addTrajectoryClip: (entityId, preferredStart, duration = 4) => {
      const entity = findEntity(get().activeScene(), entityId)
      if (!entity) return null
      const placed = placeClip(entity, 'trajectory', preferredStart, duration, maxEnd())
      if (!placed) return null
      save()
      const clip = createTrajectoryClip(createClipId('traj'), placed.start, placed.start + placed.duration)
      mutateEntity(entityId, (target) => {
        target.trajectoryClips = [...(target.trajectoryClips ?? []), clip].sort((a, b) => a.startTime - b.startTime)
        target.inTimeline = true
      })
      get().setActiveTrajectoryClip(entityId, clip.id)
      get().select({ ...selectOwner(entity), clipId: clip.id, clipType: 'trajectory' })
      return clip
    },
    deleteTrajectoryClip: (entityId, clipId) => {
      save()
      mutateEntity(entityId, (entity) => {
        const clip = entity.trajectoryClips?.find((item) => item.id === clipId)
        if (!clip) return
        const siblings = entity.trajectoryClips ?? []
        const doomed = new Set(waypointsOfClip(entity.motionTrajectory ?? [], clip, siblings).map((waypoint) => waypoint.id))
        entity.trajectoryClips = siblings.filter((item) => item.id !== clipId)
        entity.motionTrajectory = (entity.motionTrajectory ?? []).filter((waypoint) => !doomed.has(waypoint.id))
        syncInTimeline(entity)
      })
      set((state) => {
        const activeTrajectoryClipIds = { ...state.activeTrajectoryClipIds }
        if (activeTrajectoryClipIds[entityId] === clipId) delete activeTrajectoryClipIds[entityId]
        const selection = state.selection.clipId === clipId ? { ...state.selection, clipId: null, clipType: null } : state.selection
        return { activeTrajectoryClipIds, selection }
      })
    },
    // 已有片段或优先扩前段、再扩后段；相机必须通过含特写的共享泳道校验。
    prepareClipForKeyframeInsert: (entityId, time) => {
      const entity = findEntity(get().activeScene(), entityId)
      if (!entity || !Number.isFinite(time) || time < 0 || time > maxEnd()) return false
      const quantized = quantizeToFrame(time)
      if ('closeupClips' in entity && findCloseupClipAt(entity.closeupClips, quantized)) return false
      if (findTrajectoryClipAt(entity.trajectoryClips, quantized)) return true
      const clips = entity.trajectoryClips ?? []
      const nearest = lastClipEndedBefore(clips, quantized) ?? firstClipStartingAfter(clips, quantized)
      const candidate = nearest ? { ...nearest } : undefined
      if (candidate && !extendClipTo(candidate, quantized, laneClips(entity, 'trajectory'))) return false
      const placed = candidate ? null : fitClipAt(laneClips(entity, 'trajectory'), quantized, 4, maxEnd())
      if (!candidate && (!placed || Math.abs(placed.start - quantized) > FRAME_EPSILON)) return false
      let ok = false
      mutateEntity(entityId, (target) => {
        const list = target.trajectoryClips ?? (target.trajectoryClips = [])
        const existing = candidate ? list.find((clip) => clip.id === candidate.id) : undefined
        if (existing && candidate) {
          Object.assign(existing, candidate)
          ok = true
          return
        }
        if (!placed) return
        const clip = createTrajectoryClip(createClipId('traj'), placed.start, placed.start + placed.duration)
        list.push(clip)
        list.sort((a, b) => a.startTime - b.startTime)
        target.inTimeline = true
        ok = true
      })
      return ok
    },
    updateClipTime: (entityId, clipId, family, startTime, endTime, recordHistory = true) => {
      const entity = findEntity(get().activeScene(), entityId)
      const clips = entity && familyClips(entity, family)
      if (!entity || !clips?.some((clip) => clip.id === clipId) || !Number.isFinite(startTime) || !Number.isFinite(endTime)) return false
      const start = quantizeToFrame(startTime)
      const end = quantizeToFrame(endTime)
      if (start < 0 || end > maxEnd() || end - start < 1 / 30 - FRAME_EPSILON) return false
      // 争位置按 单泳道规则：机位的路径 / 特写同一条泳道互斥；角色各副轨只跟同家族争
      const others = laneClips(entity, family).filter((clip) => clip.id !== clipId)
      if (clipsOverlap(others, start, end)) return false
      // 检查器连续滑条在 onChangeStart 保存一次；时间轴拖边松手提交仍独立保存。
      if (recordHistory) save()
      mutateEntity(entityId, (target) => {
        const clip = familyClips(target, family)?.find((item) => item.id === clipId) as (ClipLike & { startFrame: number; endFrame: number }) | undefined
        if (!clip) return
        resizeClipKeyframes(target, family, clip, start, end)
        clip.startTime = start
        clip.endTime = end
        clip.startFrame = secondsToFrame(start)
        clip.endFrame = secondsToFrame(end)
      })
      return true
    },
    splitClip: (entityId, clipId, family, time) => {
      if (!Number.isFinite(time)) return null
      let newId: string | null = null
      save()
      mutateEntity(entityId, (target) => {
        const list = familyClips(target, family) as (ClipLike & { startFrame: number; endFrame: number })[] | undefined
        const clip = list?.find((item) => item.id === clipId)
        if (!list || !clip) return
        const source = JSON.parse(JSON.stringify(clip)) as TrajectoryClip
        const kind = family === 'trajectory' ? 'traj' : family === 'lookat' ? 'lookat' : family
        const right = splitClipAt(clip, time, createClipId(kind))
        if (!right) return
        list.push(right)
        list.sort((a, b) => a.startTime - b.startTime)
        newId = right.id
        cutClipKeyframes(target, family, source, [clip, right], right.startTime)
      })
      return newId
    },
    trimClip: (entityId, clipId, family, side, time) => {
      if (!Number.isFinite(time)) return false
      let ok = false
      save()
      mutateEntity(entityId, (target) => {
        const clip = familyClips(target, family)?.find((item) => item.id === clipId) as (ClipLike & { startFrame: number; endFrame: number }) | undefined
        if (!clip) return
        const source = JSON.parse(JSON.stringify(clip)) as TrajectoryClip
        ok = trimClipToPlayhead(clip, time, side)
        if (ok) cutClipKeyframes(target, family, source, [clip], quantizeToFrame(time))
      })
      return ok
    },

    insertWaypoint: (entityId, time, values, clipId) => {
      const entity = findEntity(get().activeScene(), entityId)
      if (!entity) return null
      const clip = clipId ? entity.trajectoryClips?.find((item) => item.id === clipId) : findTrajectoryClipAt(entity.trajectoryClips, time)
      if (!clip || !Number.isFinite(time) || time < clip.startTime - FRAME_EPSILON || time > clip.endTime + FRAME_EPSILON) return null
      save()
      let pointId: string | null = null
      mutateEntity(entityId, (target) => {
        target.motionTrajectory = target.motionTrajectory ?? []
        pointId = upsertWaypointAt(target.motionTrajectory, time, values, createWaypointId, clip.id).point.id
        target.inTimeline = true
      })
      return findEntity(get().activeScene(), entityId)?.motionTrajectory?.find((point) => point.id === pointId) ?? null
    },
    updateWaypoint: (entityId, waypointId, patch) => {
      mutateEntity(entityId, (target) => patchWaypoint(target.motionTrajectory, waypointId, patch))
    },
    updateWaypointTime: (entityId, waypointId, time) => {
      if (!Number.isFinite(time)) return null
      let applied: number | null = null
      mutateEntity(entityId, (target) => {
        const waypoint = target.motionTrajectory?.find((item) => item.id === waypointId)
        const clip = waypoint?.clipId ? target.trajectoryClips?.find((item) => item.id === waypoint.clipId) : undefined
        if (!waypoint || !clip) return
        const bounds = waypointTimeBounds(target.motionTrajectory ?? [], clip, waypointId, waypoint.time)
        const next = quantizeToFrame(Math.max(bounds.minTime, Math.min(bounds.maxTime, time)))
        waypoint.time = next
        waypoint.frameIndex = secondsToFrame(next)
        waypoint.progress = (next - clip.startTime) / (clip.endTime - clip.startTime)
        target.motionTrajectory?.sort((a, b) => a.time - b.time)
        applied = next
      })
      return applied
    },
    deleteWaypoints: (entityId, waypointIds) => {
      if (waypointIds.length === 0) return
      save()
      const doomed = new Set(waypointIds)
      mutateEntity(entityId, (target) => {
        target.motionTrajectory = (target.motionTrajectory ?? []).filter((waypoint) => !doomed.has(waypoint.id))
      })
      set((state) => ({
        selection: {
          ...state.selection,
          activeWaypointId: state.selection.activeWaypointId && doomed.has(state.selection.activeWaypointId) ? null : state.selection.activeWaypointId,
          selectedWaypointIds: state.selection.selectedWaypointIds.filter((id) => !doomed.has(id)),
        },
      }))
    },

    addCloseupClip: (cameraId, targetObjectId, preferredStart, duration = 4) => {
      const camera = get().findCamera(cameraId)
      if (!camera) return null
      const placed = placeClip(camera, 'closeup', preferredStart, duration, maxEnd())
      if (!placed) return null
      save()
      const clip = createCloseupClip({ id: createClipId('closeup'), entityId: cameraId, targetObjectId, startTime: placed.start, duration: placed.duration })
      commitProject((_, scene) => {
        const target = scene.cameras.find((item) => item.id === cameraId)
        if (!target) return
        target.closeupClips = [...(target.closeupClips ?? []), clip].sort((a, b) => a.startTime - b.startTime)
        target.inTimeline = true
      })
      get().select({ ...selectOwner(camera), clipId: clip.id, clipType: 'closeup' })
      return clip
    },
    updateCloseupClip: (cameraId, clipId, patch) => commitProject((_, scene) => {
      const clip = scene.cameras.find((item) => item.id === cameraId)?.closeupClips?.find((item) => item.id === clipId)
      if (clip) Object.assign(clip, patch)
    }),
    deleteCloseupClip: (cameraId, clipId) => {
      save()
      commitProject((_, scene) => {
        const camera = scene.cameras.find((item) => item.id === cameraId)
        if (!camera?.closeupClips) return
        camera.closeupClips = camera.closeupClips.filter((clip) => clip.id !== clipId)
        syncInTimeline(camera)
      })
      set((state) => (state.selection.clipId === clipId ? { selection: { ...state.selection, clipId: null, clipType: null } } : state))
    },
    isCameraInCloseupAt: (cameraId, time) => {
      const camera = get().findCamera(cameraId)
      return Boolean(camera && findCloseupClipAt(camera.closeupClips, time ?? get().timeline.currentTime))
    },
    canEnterCameraPOV: (cameraId, time) => {
      if (cameraId === 'free') return { allowed: true }
      const camera = get().findCamera(cameraId)
      if (!camera) return { allowed: false, reasonKey: 'director.reason.cameraMissing' }
      if (findCloseupClipAt(camera.closeupClips, time ?? get().timeline.currentTime)) return { allowed: false, reasonKey: 'director.reason.closeupLocked' }
      return { allowed: true }
    },

    addActionClip: (objectId, spec, mode = 'append', at) => {
      const object = get().findObject(objectId)
      if (!object || object.type !== 'character') return null
      const duration = spec.duration ?? 4
      if (!Number.isFinite(duration) || duration < 1 / 30) return null
      const clips = object.actionClips ?? []
      let placed: { start: number; duration: number } | null
      if (mode === 'prepend') {
        // 前插 = 片段结束在播放头（播放头 < 0.5s 不插；不足 4s 就从 0 开始）；骨骼姿态片段则贴在首个片段前
        const playhead = quantizeToFrame(get().timeline.currentTime)
        if (spec.clipType === 'custom_pose') {
          const first = [...clips].sort((a, b) => a.startTime - b.startTime)[0]
          const end = first ? first.startTime : 0
          if (end <= 0.1) return null
          placed = { start: Math.max(0, end - duration), duration: Math.min(duration, end) }
        } else {
          if (playhead < 0.5) return null
          placed = playhead < duration ? { start: 0, duration: playhead } : { start: playhead - duration, duration }
          if (clipsOverlap(clips, placed.start, placed.start + placed.duration)) return null
        }
      } else if (mode === 'at_time' && at !== undefined) {
        placed = placeClip(object, 'action', Math.max(0, at), duration, maxEnd())
      } else {
        const tail = clips.length ? clips.reduce((max, clip) => Math.max(max, clip.endTime), 0) : get().timeline.currentTime
        placed = placeClip(object, 'action', tail, duration, maxEnd())
      }
      if (!placed) return null
      save()
      const startTime = quantizeToFrame(placed.start)
      const endTime = quantizeToFrame(startTime + placed.duration)
      // 骨骼姿态片段一出生就带一个关键帧 = 角色当前的静止微调（boneRotations / hipsOffset），并成为写入落点
      const initialKeyframe: BoneKeyframe | null = spec.clipType === 'custom_pose'
        ? {
            id: createKeyframeId(),
            time: startTime,
            frame: secondsToFrame(startTime),
            boneRotations: JSON.parse(JSON.stringify(object.boneRotations ?? {})) as Record<string, Vec3>,
            hipsOffset: object.hipsOffset ? { ...object.hipsOffset } : undefined,
          }
        : null
      const clip: ActionClip = {
        id: createClipId('action'),
        name: spec.name,
        clipType: spec.clipType,
        actionPose: spec.actionPose,
        startTime,
        endTime,
        ...(initialKeyframe ? { keyframes: [initialKeyframe] } : {}),
        startFrame: secondsToFrame(startTime),
        endFrame: secondsToFrame(endTime),
      }
      mutateObject(objectId, (target) => {
        target.actionClips = [...(target.actionClips ?? []), clip].sort((a, b) => a.startTime - b.startTime)
        target.inTimeline = true
        target.actionTrackEnabled = true
      })
      get().select({ ...selectOwner(object), clipId: clip.id, clipType: 'action', boneKeyframeId: initialKeyframe?.id ?? null, boneClipId: initialKeyframe ? clip.id : null })
      return clip
    },
    deleteActionClip: (objectId, clipId) => {
      save()
      mutateObject(objectId, (object) => {
        object.actionClips = (object.actionClips ?? []).filter((clip) => clip.id !== clipId)
        syncInTimeline(object)
      })
      set((state) => (state.selection.clipId === clipId ? { selection: { ...state.selection, clipId: null, clipType: null, boneKeyframeId: null, boneClipId: null } } : state))
    },
    clearActionClips: (objectId) => {
      save()
      mutateObject(objectId, (object) => {
        object.actionClips = []
        syncInTimeline(object)
      })
      set((state) => ({ selection: { ...state.selection, clipId: state.selection.clipType === 'action' ? null : state.selection.clipId, clipType: state.selection.clipType === 'action' ? null : state.selection.clipType, boneKeyframeId: null, boneClipId: null } }))
    },
    // 播放头插骨骼帧（含自动补片段）是一笔撤销事务；未改骨头继承当前插值姿态。
    insertBoneKeyframe: (objectId, time) => get().withHistory(() => {
      if (!Number.isFinite(time) || time < 0 || time > maxEnd()) return null
      const object = get().findObject(objectId)
      if (!object || object.type !== 'character') return null
      const quantized = quantizeToFrame(time)
      let clip = (object.actionClips ?? []).find((item) => item.clipType === 'custom_pose' && quantized >= item.startTime - FRAME_EPSILON && quantized <= item.endTime + FRAME_EPSILON)
      if (!clip) {
        // 播放头下没有骨骼姿态片段就当场建一段（3s，或到下一个片段开头），落在别的片段上则拒绝
        if ((object.actionClips ?? []).some((item) => quantized >= item.startTime - 0.05 && quantized <= item.endTime + 0.05)) return null
        let end = quantizeToFrame(quantized + 3)
        for (const item of object.actionClips ?? []) if (item.startTime > quantized && item.startTime < end) end = quantizeToFrame(item.startTime)
        if (end - quantized < 1 / 30) return null
        const created = get().addActionClip(objectId, { name: '', clipType: 'custom_pose', duration: end - quantized }, 'at_time', quantized)
        if (!created) return null
        clip = created
      }
      save()
      let keyframeId: string | null = null
      mutateObject(objectId, (target) => {
        const targetClip = target.actionClips?.find((item) => item.id === clip.id)
        if (!targetClip) return
        targetClip.keyframes = targetClip.keyframes ?? []
        const existing = targetClip.keyframes.find((item) => Math.abs(item.time - quantized) <= FRAME_EPSILON)
        const sampled = samplePoseAt(JSON.parse(JSON.stringify(targetClip)) as ActionClip, quantized)
        const boneRotations = { ...sampled.boneRotations, ...JSON.parse(JSON.stringify(target.boneRotations ?? {})) as Record<string, Vec3> }
        const hipsOffset = target.hipsOffset ? { ...target.hipsOffset } : sampled.hipsOffset
        if (existing) {
          existing.boneRotations = { ...existing.boneRotations, ...boneRotations }
          existing.hipsOffset = hipsOffset ?? existing.hipsOffset
          keyframeId = existing.id
        } else {
          const keyframe = { id: createKeyframeId(), time: quantized, frame: secondsToFrame(quantized), boneRotations, hipsOffset }
          keyframeId = keyframe.id
          targetClip.keyframes.push(keyframe)
          targetClip.keyframes.sort((a, b) => a.time - b.time)
        }
        target.inTimeline = true
        target.actionTrackEnabled = true
      })
      if (keyframeId) get().select({ ...selectOwner(object), boneKeyframeId: keyframeId, boneClipId: clip.id, clipId: clip.id, clipType: 'action' })
      return get().findObject(objectId)?.actionClips?.find((item) => item.id === clip.id)?.keyframes?.find((key) => key.id === keyframeId) ?? null
    }),
    updateBoneKeyframeTime: (objectId, keyframeId, time) => {
      if (!Number.isFinite(time)) return false
      let ok = false
      mutateObject(objectId, (object) => {
        for (const clip of object.actionClips ?? []) {
          const keyframe = clip.keyframes?.find((item) => item.id === keyframeId)
          if (!keyframe || !clip.keyframes) continue
          const next = quantizeToFrame(Math.max(clip.startTime, Math.min(clip.endTime, time)))
          if (clip.keyframes.some((item) => item.id !== keyframeId && Math.abs(item.time - next) < FRAME_EPSILON)) return
          keyframe.time = next
          keyframe.frame = secondsToFrame(next)
          clip.keyframes.sort((a, b) => a.time - b.time)
          ok = true
          return
        }
      })
      return ok
    },
    deleteBoneKeyframe: (objectId, keyframeId) => {
      save()
      mutateObject(objectId, (object) => {
        for (const clip of object.actionClips ?? []) {
          if (!clip.keyframes) continue
          const index = clip.keyframes.findIndex((item) => item.id === keyframeId)
          if (index !== -1) {
            clip.keyframes.splice(index, 1)
            break
          }
        }
      })
      set((state) => (state.selection.boneKeyframeId === keyframeId ? { selection: { ...state.selection, boneKeyframeId: null, boneClipId: null } } : state))
    },
    clearBoneKeyframes: (objectId) => {
      save()
      mutateObject(objectId, (object) => {
        for (const clip of object.actionClips ?? []) if (clip.clipType === 'custom_pose') clip.keyframes = []
      })
      set((state) => ({ selection: { ...state.selection, boneKeyframeId: null, boneClipId: null } }))
    },

    addLookAtClip: (objectId, mode = 'append', at, duration = 4) => {
      if (!Number.isFinite(duration) || duration < 1 / 30 || (at !== undefined && !Number.isFinite(at))) return null
      const object = get().findObject(objectId)
      if (!object || object.type !== 'character') return null
      const clips = object.lookAtClips ?? []
      let start: number
      if (mode === 'prepend') {
        const first = [...clips].sort((a, b) => a.startTime - b.startTime)[0]
        const end = first ? first.startTime : 0
        if (end <= 0.1) return null
        start = Math.max(0, end - duration)
        duration = Math.min(duration, end)
      } else if (mode === 'at_time' && at !== undefined) {
        start = Math.max(0, at)
      } else {
        const last = [...clips].sort((a, b) => a.startTime - b.startTime)[clips.length - 1]
        start = last ? last.endTime : get().timeline.currentTime
      }
      const startTime = quantizeToFrame(start)
      const endTime = quantizeToFrame(startTime + duration)
      if (endTime > maxEnd() || clipsOverlap(clips, startTime, endTime)) return null
      save()
      const clip: LookAtClip = {
        id: createClipId('lookat'),
        name: '',
        targetType: 'none',
        targetId: '',
        enablePitch: false,
        targetHeightOffset: 0,
        targetBodyPart: 'face',
        startTime,
        endTime,
        startFrame: secondsToFrame(startTime),
        endFrame: secondsToFrame(endTime),
        blendInDuration: 0.4,
        blendOutDuration: 0.4,
        weight: 1,
        clampingAngle: 80,
      }
      mutateObject(objectId, (target) => {
        target.lookAtClips = [...(target.lookAtClips ?? []), clip].sort((a, b) => a.startTime - b.startTime)
        target.inTimeline = true
        target.lookAtTrackEnabled = true
      })
      get().select({ ...selectOwner(object), clipId: clip.id, clipType: 'lookat' })
      return clip
    },
    updateLookAtClip: (objectId, clipId, patch) => {
      mutateObject(objectId, (object) => {
        const clip = object.lookAtClips?.find((item) => item.id === clipId)
        if (clip) Object.assign(clip, patch)
      })
    },
    deleteLookAtClip: (objectId, clipId) => {
      save()
      mutateObject(objectId, (object) => {
        object.lookAtClips = (object.lookAtClips ?? []).filter((clip) => clip.id !== clipId)
        syncInTimeline(object)
      })
      set((state) => (state.selection.clipId === clipId ? { selection: { ...state.selection, clipId: null, clipType: null } } : state))
    },
    clearLookAtClips: (objectId) => {
      save()
      mutateObject(objectId, (object) => {
        object.lookAtClips = []
        syncInTimeline(object)
      })
      set((state) => (state.selection.clipType === 'lookat' ? { selection: { ...state.selection, clipId: null, clipType: null } } : state))
    },
    toggleActionTrack: (objectId) => {
      save()
      mutateObject(objectId, (object) => {
        object.actionTrackEnabled = object.actionTrackEnabled === false
      })
    },
    toggleLookAtTrack: (objectId) => {
      save()
      mutateObject(objectId, (object) => {
        object.lookAtTrackEnabled = object.lookAtTrackEnabled === false
      })
    },
  }
}
