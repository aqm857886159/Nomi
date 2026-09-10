/**
 * [INPUT]: 依赖 ./directorStore 的 CommitProject / StoreGet / StoreSet / DrawMode、./directorTypes、./timeGrid（entityClips / quantizeToFrame / secondsToFrame / FRAME_EPSILON）、
 *          ./clips（findFreeStart / clipsOverlap / upsertWaypointAt / ClipLike）、./timelineClipboard（ClipboardPayload / copyClipPayload / canPasteTo / relocatePayload）、
 *          ./directorIds、./editLayer 的 findTrajectoryClipAt、./storeClipActions 的 ClipFamily、./waypointAim 的 waypointAimAngles
 * [OUTPUT]: 对外提供 DirectorTimelineActions / WaypointSeed、createTimelineActions：画路径模式与剪贴板（瞬态）、入轴/移出、整段平移、
 *           粘贴 / 紧贴复制、播放头插帧、批量写路标、按帧烘焙看向与批量朝向
 * [POS]: director/model 的时间轴级动作（以「轨道 / 剪贴板 / 播放头」为单位，跨片段家族），与 storeClipActions（单片段 CRUD）分文件；
 *        每个动作一次 saveState、一次 commitProject，拖拽类操作由 UI 预览、松手才调用这里。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { clipsOverlap, findFreeStart, upsertWaypointAt, waypointsOfClip, type ClipLike } from './clips'
import { createClipId, createKeyframeId, createWaypointId } from './directorIds'
import type { CommitProject, DrawMode, StoreGet, StoreSet } from './directorStore'
import type { ActionClip, DirectorCamera, DirectorObject, DirectorScene, TimelineEntity } from './directorTypes'
import { isDirectorCamera } from './directorTypes'
import { findTrajectoryClipAt } from './editLayer'
import type { ClipFamily } from './storeClipActions'
import { canPasteTo, copyClipPayload, relocatePayload, type ClipboardPayload } from './timelineClipboard'
import { FRAME_EPSILON, laneClips, quantizeToFrame, secondsToFrame } from './timeGrid'
import { waypointAimAngles } from './waypointAim'

export type WaypointSeed = { time: number; x: number; y: number; z: number; yaw: number; pitch: number; roll: number }

export type DirectorTimelineActions = {
  setDrawMode: (mode: DrawMode) => void
  setClipboard: (payload: ClipboardPayload | null) => void
  addEntityToTimeline: (entityId: string) => void // 加进时间轴并自动补一段 4s 空路径片段
  removeEntityFromTimeline: (entityId: string) => void
  moveClip: (entityId: string, clipId: string, family: ClipFamily, startTime: number) => boolean
  pasteClip: (entityId: string, payload: ClipboardPayload, at: number) => string | null
  duplicateClipAfter: (entityId: string, clipId: string, family: ClipFamily) => string | null
  insertKeyframeAt: (entityId: string, time: number) => string | null
  insertWaypointsBatch: (entityId: string, clipId: string, seeds: WaypointSeed[]) => number
  aimWaypointsAt: (entityId: string, waypointIds: string[], targetId: string | null, rememberTarget?: boolean) => number
  // 连续滑条已经在 onChangeStart 开启快照时传 false；离散动作默认独立撤销。
  updateWaypointAngles: (entityId: string, waypointIds: string[], angles: Partial<{ yaw: number; pitch: number; roll: number }>, recordHistory?: boolean) => number
}

type FramedClip = ClipLike & { startFrame: number; endFrame: number }

function findEntity(scene: DirectorScene, id: string): TimelineEntity | undefined {
  return scene.objects.find((object) => object.id === id) ?? scene.cameras.find((camera) => camera.id === id)
}

function familyList(entity: TimelineEntity, family: ClipFamily): FramedClip[] | undefined {
  if (family === 'trajectory') return entity.trajectoryClips
  if (family === 'closeup') return isDirectorCamera(entity) ? entity.closeupClips : undefined
  if (isDirectorCamera(entity)) return undefined
  return family === 'action' ? entity.actionClips : entity.lookAtClips
}

// 单泳道规则：机位的路径 / 特写共用一条泳道，角色各家族只跟自己争
function otherClips(entity: TimelineEntity, family: ClipFamily, excludeId: string): ClipLike[] {
  return laneClips(entity, family)
    .filter((clip) => clip.id !== excludeId)
    .map((clip, index) => ({ id: `o${index}`, startTime: clip.startTime, endTime: clip.endTime }))
}

function insertPayload(target: TimelineEntity, payload: ClipboardPayload): void {
  target.inTimeline = true
  if (payload.family === 'trajectory') {
    target.trajectoryClips = [...(target.trajectoryClips ?? []), payload.clip].sort((a, b) => a.startTime - b.startTime)
    target.motionTrajectory = [...(target.motionTrajectory ?? []), ...payload.waypoints].sort((a, b) => a.time - b.time)
    return
  }
  if (payload.family === 'closeup') {
    const camera = target as DirectorCamera
    camera.closeupClips = [...(camera.closeupClips ?? []), { ...payload.clip, entityId: camera.id }].sort((a, b) => a.startTime - b.startTime)
    return
  }
  const object = target as DirectorObject
  if (payload.family === 'action') {
    object.actionClips = [...(object.actionClips ?? []), payload.clip].sort((a, b) => a.startTime - b.startTime)
    object.actionTrackEnabled = true
    return
  }
  object.lookAtClips = [...(object.lookAtClips ?? []), payload.clip].sort((a, b) => a.startTime - b.startTime)
  object.lookAtTrackEnabled = true
}

const PASTE_IDS = {
  clipId: (family: ClipboardPayload['family']) => createClipId(family === 'trajectory' ? 'traj' : family),
  waypointId: createWaypointId,
  keyframeId: createKeyframeId,
}

export function createTimelineActions(set: StoreSet, get: StoreGet, commitProject: CommitProject): DirectorTimelineActions {
  const save = () => get().saveState()
  const maxEnd = () => get().timeline.totalDuration
  const mutateEntity = (entityId: string, mutate: (entity: TimelineEntity, scene: DirectorScene) => void) =>
    commitProject((_, scene) => {
      const entity = findEntity(scene, entityId)
      if (entity) mutate(entity, scene)
    })
  const selectClip = (entity: TimelineEntity, family: ClipFamily, clipId: string) =>
    get().select(
      isDirectorCamera(entity)
        ? { cameraId: entity.id, objectId: null, lightId: null, multiObjectIds: [], clipId, clipType: family, activeWaypointId: null, selectedWaypointIds: [] }
        : { objectId: entity.id, cameraId: null, lightId: null, multiObjectIds: [entity.id], clipId, clipType: family, activeWaypointId: null, selectedWaypointIds: [] },
    )

  return {
    setDrawMode: (mode) => set({ drawMode: mode }),
    setClipboard: (payload) => set({ clipboard: payload }),

    aimWaypointsAt: (entityId, waypointIds, targetId, rememberTarget = false) => {
      const scene = get().activeScene()
      const source = findEntity(scene, entityId)
      const target = targetId ? scene.objects.find(object => object.id === targetId && object.type !== 'group' && object.id !== entityId) : undefined
      if (!source || (targetId && !target) || (!targetId && !rememberTarget)) return 0
      const selected = new Set(waypointIds)
      const updates = (source.motionTrajectory ?? []).filter(point => selected.has(point.id)).map(point => ({ id: point.id, angles: target ? waypointAimAngles(scene, source, point, target) : undefined }))
      if (!updates.length) return 0
      return get().withHistory(() => {
        mutateEntity(entityId, entity => {
          for (const update of updates) {
            const point = entity.motionTrajectory?.find(item => item.id === update.id)
            if (!point) continue
            if (update.angles) Object.assign(point, update.angles)
            if (rememberTarget) point.lookAtObjectId = targetId ?? undefined
          }
        })
        return updates.length
      })
    },

    updateWaypointAngles: (entityId, waypointIds, angles, recordHistory = true) => {
      if (!Object.keys(angles).length || Object.values(angles).some(value => !Number.isFinite(value))) return 0
      const selected = new Set(waypointIds)
      const source = findEntity(get().activeScene(), entityId)
      const count = source?.motionTrajectory?.filter(point => selected.has(point.id)).length ?? 0
      if (!count) return 0
      const apply = () => {
        mutateEntity(entityId, entity => {
          for (const point of entity.motionTrajectory ?? []) if (selected.has(point.id)) Object.assign(point, angles)
        })
        return count
      }
      return recordHistory ? get().withHistory(apply) : apply()
    },

    // 加进时间轴 = 立刻给一段 4s 空路径片段（轨道一出现就有「路径片段 0~120」可拖、可画）
    addEntityToTimeline: (entityId) => get().withHistory(() => {
      if (!findEntity(get().activeScene(), entityId)) return
      save()
      mutateEntity(entityId, (entity, scene) => {
        entity.inTimeline = true
        if (!scene.timelineTrackOrder.includes(entityId)) scene.timelineTrackOrder.push(entityId)
      })
      const entity = get().activeScene().objects.find((item) => item.id === entityId) ?? get().activeScene().cameras.find((item) => item.id === entityId)
      if (entity && (entity.trajectoryClips ?? []).length === 0) get().addTrajectoryClip(entityId, 0)
    }),

    // 移出 = 清掉该实体全部片段与路标（实体本身留在场景里）
    removeEntityFromTimeline: (entityId) => {
      save()
      mutateEntity(entityId, (entity, scene) => {
        entity.inTimeline = false
        entity.trajectoryClips = []
        entity.motionTrajectory = []
        if (isDirectorCamera(entity)) {
          entity.closeupClips = []
        } else {
          entity.actionClips = []
          entity.lookAtClips = []
        }
        scene.timelineTrackOrder = scene.timelineTrackOrder.filter((id) => id !== entityId)
        scene.timelineTrackPins = scene.timelineTrackPins.filter((id) => id !== entityId)
        scene.timelineTrackFolds = scene.timelineTrackFolds.filter((id) => id !== entityId)
      })
      set((state) =>
        state.selection.objectId === entityId || state.selection.cameraId === entityId
          ? { selection: { ...state.selection, clipId: null, clipType: null, activeWaypointId: null, selectedWaypointIds: [] } }
          : state,
      )
    },

    // 整段平移（保持时长）：路标 / 骨骼帧跟着走；与其他片段重叠则拒绝
    moveClip: (entityId, clipId, family, startTime) => {
      const entity = findEntity(get().activeScene(), entityId)
      const clip = entity && familyList(entity, family)?.find((item) => item.id === clipId)
      if (!entity || !clip) return false
      const duration = clip.endTime - clip.startTime
      const start = quantizeToFrame(Math.max(0, Math.min(maxEnd() - duration, startTime)))
      const end = quantizeToFrame(start + duration)
      if (Math.abs(start - clip.startTime) < FRAME_EPSILON) return true
      if (clipsOverlap(otherClips(entity, family, clipId), start, end)) return false
      save()
      const delta = start - clip.startTime
      mutateEntity(entityId, (target) => {
        const item = familyList(target, family)?.find((candidate) => candidate.id === clipId)
        if (!item) return
        const ownedKeys = family === 'trajectory' ? waypointsOfClip(target.motionTrajectory ?? [], item, target.trajectoryClips) : []
        item.startTime = start
        item.endTime = end
        item.startFrame = secondsToFrame(start)
        item.endFrame = secondsToFrame(end)
        if (family === 'trajectory') {
          for (const waypoint of ownedKeys) {
            waypoint.clipId = clipId
            waypoint.time = quantizeToFrame(waypoint.time + delta)
            waypoint.frameIndex = secondsToFrame(waypoint.time)
          }
          target.motionTrajectory?.sort((a, b) => a.time - b.time)
        }
        if (family === 'action') {
          for (const keyframe of (item as ActionClip).keyframes ?? []) {
            keyframe.time = quantizeToFrame(keyframe.time + delta)
            keyframe.frame = secondsToFrame(keyframe.time)
          }
        }
      })
      return true
    },

    pasteClip: (entityId, payload, at) => {
      const entity = findEntity(get().activeScene(), entityId)
      if (!entity || !canPasteTo(payload, entity)) return null
      const duration = payload.clip.endTime - payload.clip.startTime
      const start = findFreeStart(otherClips(entity, payload.family, ''), Math.max(0, at), duration, maxEnd())
      if (start === null) return null
      save()
      const relocated = relocatePayload(payload, start, PASTE_IDS)
      if (relocated.family === 'closeup') relocated.clip.entityId = entityId
      mutateEntity(entityId, (target) => insertPayload(target, relocated))
      selectClip(entity, relocated.family, relocated.clip.id)
      return relocated.clip.id
    },

    // Cmd+D：紧贴在原片段后面复制一份；贴不下就找后面的第一个空位
    duplicateClipAfter: (entityId, clipId, family) => {
      const entity = findEntity(get().activeScene(), entityId)
      const payload = entity && copyClipPayload(entity, family, clipId)
      if (!entity || !payload) return null
      const duration = payload.clip.endTime - payload.clip.startTime
      const start = findFreeStart(otherClips(entity, payload.family, ''), payload.clip.endTime, duration, maxEnd())
      if (start === null) return null
      save()
      const relocated = relocatePayload(payload, start, PASTE_IDS)
      mutateEntity(entityId, (target) => insertPayload(target, relocated))
      selectClip(entity, relocated.family, relocated.clip.id)
      return relocated.clip.id
    },

    // I 键 / 头部「插入关键帧」：保证有片段，再把当前求值位姿（或静止位姿）写成路标
    insertKeyframeAt: (entityId, time) => get().withHistory(() => {
      const state = get()
      if (!findEntity(state.activeScene(), entityId)) return null
      save()
      if (!state.prepareClipForKeyframeInsert(entityId, time)) return null
      let waypointId: string | null = null
      let clipId: string | null = null
      mutateEntity(entityId, (target) => {
        const clip = findTrajectoryClipAt(target.trajectoryClips, time)
        if (!clip) return
        const evaluated = state.evaluatedPoses[entityId]
        const rest = isDirectorCamera(target) ? { x: target.pitch, y: target.yaw, z: target.roll } : target.rotation
        target.motionTrajectory = target.motionTrajectory ?? []
        const { point } = upsertWaypointAt(
          target.motionTrajectory,
          time,
          {
            x: evaluated?.position.x ?? target.position.x,
            y: evaluated?.position.y ?? target.position.y,
            z: evaluated?.position.z ?? target.position.z,
            yaw: evaluated?.rotation.y ?? rest.y,
            pitch: evaluated?.rotation.x ?? rest.x,
            roll: evaluated?.rotation.z ?? rest.z,
          },
          createWaypointId,
          clip.id,
        )
        target.inTimeline = true
        waypointId = point.id
        clipId = clip.id
      })
      if (waypointId) {
        const entity = findEntity(get().activeScene(), entityId)!
        selectClip(entity, 'trajectory', clipId!)
        get().select({ activeWaypointId: waypointId, selectedWaypointIds: [waypointId] })
      }
      return waypointId
    }),

    // 画笔 / 逐点一次落多个路标：一次快照、一次提交
    insertWaypointsBatch: (entityId, clipId, seeds) => {
      const entity = findEntity(get().activeScene(), entityId)
      const clip = entity?.trajectoryClips?.find((item) => item.id === clipId)
      if (seeds.length === 0 || !clip || seeds.some((seed) => !Number.isFinite(seed.time) || seed.time < clip.startTime - FRAME_EPSILON || seed.time > clip.endTime + FRAME_EPSILON)) return 0
      save()
      let count = 0
      mutateEntity(entityId, (target) => {
        const clip = target.trajectoryClips?.find((item) => item.id === clipId)
        if (!clip) return
        target.motionTrajectory = target.motionTrajectory ?? []
        for (const seed of seeds) {
          upsertWaypointAt(target.motionTrajectory, seed.time, seed, createWaypointId, clipId)
          count += 1
        }
        target.inTimeline = true
      })
      return count
    },
  }
}
