/**
 * [INPUT]: 依赖 ./directorStore 的类型（CommitProject / StoreGet / StoreSet / DirectorStoreState / EvaluatedPose）、./directorTypes、
 *          ./directorIds、./cameraLens 的 syncFocalLength、./lights 的 createLight、./editLayer 的 resolveEditLayer、
 *          ./clips 的 upsertWaypointAt / patchWaypoint、sceneObjectGraph 的子树/仿射变换、cameraCoordinateSpace 的相机 YXZ 转换
 * [OUTPUT]: 对外提供 DirectorEntityActions 与 createEntityActions（对象/机位/灯光 CRUD、分组/解组/群众、跨图层复制移动、
 *           显隐锁定、经编辑层的空间变换写回）
 * [POS]: director/model 的实体 action 集合，由 directorStore 组装进同一个 store；所有写路径先 saveState 再 commitProject，
 *        gizmo/检查器改位姿一律走 write*SpatialTransform（编辑层三态）；跨层在同一草稿搬完整子树，rest/路标一起换坐标。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { syncFocalLength } from './cameraLens'
import { patchWaypoint, upsertWaypointAt } from './clips'
import { createCameraId, createLightId, createObjectId, createWaypointId } from './directorIds'
import type { CommitProject, DirectorStoreState, StoreGet, StoreSet } from './directorStore'
import type { DirectorCamera, DirectorLight, DirectorLightType, DirectorObject, DirectorScene, Vec3 } from './directorTypes'
import { findTrajectoryClipAt, resolveEditLayer, type EditLayer } from './editLayer'
import { createLight } from './lights'
import { remapSceneIds } from './directorProject'
import { transformCameraPose } from './cameraCoordinateSpace'
import { invertFrame, localFrame, multiplyFrames, objectWorldFrame, sceneFrame, selectedRoots, subtreeIds, transformObject, transformPoint, type SceneFrame } from './sceneObjectGraph'
import { applyMat3, forwardFromAngles, lookAtAngles } from './vec3'

export type SpatialPatch = { position?: Vec3; rotation?: Vec3; scale?: Vec3 }

export type SpatialWriteResult = { layer: EditLayer; applied: boolean; keyframeId?: string; trajectoryUpdated: boolean }

export type DirectorEntityActions = {
  addObject: (object: Omit<DirectorObject, 'id'> & { id?: string }) => string
  deleteObject: (objectId: string) => void
  cloneObject: (objectId: string, nameSuffix: string) => string | null
  renameObject: (objectId: string, name: string) => void
  updateObject: (objectId: string, patch: Partial<DirectorObject>) => void
  updateObjectTransform: (objectId: string, position: Vec3, rotation: Vec3, scale: Vec3) => void
  writeObjectSpatialTransform: (objectId: string, patch: SpatialPatch) => SpatialWriteResult
  writeCameraSpatialTransform: (cameraId: string, patch: SpatialPatch) => SpatialWriteResult
  getObjectDescendantIds: (objectId: string) => string[]
  groupObjects: (objectIds: string[], name: string) => string | null
  ungroupObjects: (groupId: string) => string[]
  batchCreateCrowd: (objectId: string, rows: number, cols: number, spacing: number, groupName: string) => string | null
  toggleObjectVisible: (objectId: string) => void
  toggleObjectLock: (objectId: string) => void
  bulkToggleObjectVisible: (objectIds: string[]) => void
  bulkToggleObjectLock: (objectIds: string[]) => void
  addCamera: (camera: Omit<DirectorCamera, 'id' | 'focalLengthMm'> & { id?: string }) => string
  deleteCamera: (cameraId: string) => void
  updateCamera: (cameraId: string, patch: Partial<DirectorCamera>) => void
  setCameraFov: (cameraId: string, fov: number) => void
  addLight: (type: DirectorLightType, name: string, overrides?: Partial<DirectorLight>) => string
  updateLight: (lightId: string, patch: Partial<DirectorLight>) => void
  deleteLight: (lightId: string) => void
  duplicateLight: (lightId: string, nameSuffix: string) => string | null
  toggleLightVisible: (lightId: string) => void
  toggleLightEnabled: (lightId: string) => void
  toggleLightLock: (lightId: string) => void
  writeLightSpatialTransform: (lightId: string, position?: Vec3, orientation?: { yaw?: number; pitch?: number }) => void
  copyEntitiesToScene: (entityIds: string[], targetSceneId: string, move: boolean) => void
  moveLightToScene: (lightId: string, fromSceneId: string, toSceneId: string) => void
}

function descendantIds(scene: DirectorScene, rootId: string): string[] {
  const found = subtreeIds(scene.objects, [rootId])
  found.delete(rootId)
  return [...found]
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function transformLight(light: DirectorLight, frame: SceneFrame): void {
  const direction = applyMat3(frame.basis, forwardFromAngles(light.yaw, light.pitch))
  const angles = lookAtAngles({ x: 0, y: 0, z: 0 }, direction)
  light.position = transformPoint(frame, light.position)
  light.yaw = angles.yaw; light.pitch = angles.pitch
}

function writeSpatial(
  entity: DirectorObject | DirectorCamera,
  isCamera: boolean,
  patch: SpatialPatch,
  state: DirectorStoreState,
): SpatialWriteResult {
  const context = { currentTime: state.timeline.currentTime, activeWaypointId: state.selection.activeWaypointId }
  const layer = resolveEditLayer(entity, context, isCamera)
  if (layer === 'evaluated-readonly') return { layer, applied: false, trajectoryUpdated: false }
  if (patch.scale && !isCamera) (entity as DirectorObject).scale = { ...patch.scale }
  if (layer === 'keyframe') {
    entity.motionTrajectory = entity.motionTrajectory ?? []
    const values = {
      x: patch.position?.x,
      y: patch.position?.y,
      z: patch.position?.z,
      yaw: patch.rotation?.y,
      pitch: patch.rotation?.x,
      roll: patch.rotation?.z,
    }
    if (context.activeWaypointId) {
      const point = patchWaypoint(entity.motionTrajectory, context.activeWaypointId, values)
      return point ? { layer, applied: true, keyframeId: point.id, trajectoryUpdated: true } : { layer, applied: false, trajectoryUpdated: false }
    }
    const clip = findTrajectoryClipAt(entity.trajectoryClips, context.currentTime)
    const evaluated = state.evaluatedPoses[entity.id]
    const restRotation = isCamera
      ? { x: (entity as DirectorCamera).pitch, y: (entity as DirectorCamera).yaw, z: (entity as DirectorCamera).roll }
      : (entity as DirectorObject).rotation
    const { point } = upsertWaypointAt(
      entity.motionTrajectory,
      context.currentTime,
      {
        x: values.x ?? evaluated?.position.x ?? entity.position.x,
        y: values.y ?? evaluated?.position.y ?? entity.position.y,
        z: values.z ?? evaluated?.position.z ?? entity.position.z,
        yaw: values.yaw ?? evaluated?.rotation.y ?? restRotation.y,
        pitch: values.pitch ?? evaluated?.rotation.x ?? restRotation.x,
        roll: values.roll ?? evaluated?.rotation.z ?? restRotation.z,
      },
      createWaypointId,
      clip?.id,
    )
    entity.inTimeline = true
    return { layer, applied: true, keyframeId: point.id, trajectoryUpdated: true }
  }
  if (patch.position) entity.position = { ...patch.position }
  if (patch.rotation) {
    if (isCamera) {
      const camera = entity as DirectorCamera
      camera.pitch = patch.rotation.x
      camera.yaw = patch.rotation.y
      camera.roll = patch.rotation.z
    } else {
      ;(entity as DirectorObject).rotation = { ...patch.rotation }
    }
  }
  return { layer: 'rest', applied: true, trajectoryUpdated: false }
}

export function createEntityActions(set: StoreSet, get: StoreGet, commitProject: CommitProject): DirectorEntityActions {
  const save = () => get().saveState()

  return {
    addObject: (object) => {
      save()
      const id = object.id ?? createObjectId()
      commitProject((_, scene) => {
        scene.objects.push({ ...object, id })
      })
      get().select({ objectId: id, cameraId: null, lightId: null, multiObjectIds: [id] })
      return id
    },
    deleteObject: (objectId) => {
      const scene = get().activeScene()
      if (!scene.objects.some((object) => object.id === objectId)) return
      save()
      const doomed = new Set([objectId, ...descendantIds(scene, objectId)])
      commitProject((_, active) => {
        active.objects = active.objects.filter((object) => !doomed.has(object.id))
        for (const entity of [...active.objects, ...active.cameras]) {
          for (const point of entity.motionTrajectory ?? []) if (point.lookAtObjectId && doomed.has(point.lookAtObjectId)) delete point.lookAtObjectId
        }
        active.timelineTrackOrder = active.timelineTrackOrder.filter((id) => !doomed.has(id))
        active.timelineTrackPins = active.timelineTrackPins.filter((id) => !doomed.has(id))
        active.timelineTrackFolds = active.timelineTrackFolds.filter((id) => !doomed.has(id))
      })
      set((state) => {
        const evaluatedPoses = { ...state.evaluatedPoses }
        const activeTrajectoryClipIds = { ...state.activeTrajectoryClipIds }
        for (const id of doomed) {
          delete evaluatedPoses[id]
          delete activeTrajectoryClipIds[id]
        }
        return { evaluatedPoses, activeTrajectoryClipIds }
      })
    },
    cloneObject: (objectId, nameSuffix) => {
      const source = get().findObject(objectId)
      if (!source || source.type === 'group') return null
      save()
      const copy = deepClone(source)
      copy.id = createObjectId()
      copy.name = `${source.name}${nameSuffix}`
      copy.position = { x: source.position.x + 1, y: source.position.y, z: source.position.z + 1 }
      for (const point of copy.motionTrajectory ?? []) { point.x += 1; point.z += 1 }
      commitProject((_, scene) => {
        scene.objects.push(copy)
      })
      get().select({ objectId: copy.id, multiObjectIds: [copy.id] })
      return copy.id
    },
    renameObject: (objectId, name) => {
      if (!name.trim()) return
      save()
      commitProject((_, scene) => {
        const object = scene.objects.find((item) => item.id === objectId)
        if (object) object.name = name.trim()
      })
    },
    updateObject: (objectId, patch) => commitProject((_, scene) => {
      const object = scene.objects.find((item) => item.id === objectId)
      if (object) Object.assign(object, patch)
    }),
    updateObjectTransform: (objectId, position, rotation, scale) => commitProject((_, scene) => {
      const object = scene.objects.find((item) => item.id === objectId)
      if (!object) return
      object.position = { ...position }
      object.rotation = { ...rotation }
      object.scale = { ...scale }
    }),
    writeObjectSpatialTransform: (objectId, patch) => {
      let result: SpatialWriteResult = { layer: 'rest', applied: false, trajectoryUpdated: false }
      commitProject((_, scene) => {
        const object = scene.objects.find((item) => item.id === objectId)
        if (object) result = writeSpatial(object, false, patch, get())
      })
      return result
    },
    writeCameraSpatialTransform: (cameraId, patch) => {
      let result: SpatialWriteResult = { layer: 'rest', applied: false, trajectoryUpdated: false }
      commitProject((_, scene) => {
        const camera = scene.cameras.find((item) => item.id === cameraId)
        if (camera) result = writeSpatial(camera, true, patch, get())
      })
      return result
    },
    getObjectDescendantIds: (objectId) => descendantIds(get().activeScene(), objectId),
    groupObjects: (objectIds, name) => {
      if (objectIds.length <= 1) return null
      const scene = get().activeScene()
      const members = selectedRoots(scene.objects, objectIds)
      if (members.length <= 1) return null
      save()
      const groupId = createObjectId()
      const commonParent = members.every(object => object.parentId === members[0].parentId) ? members[0].parentId : undefined
      const parentInverse = invertFrame(objectWorldFrame(scene.objects, commonParent))
      const positions = members.map(object => multiplyFrames(parentInverse, objectWorldFrame(scene.objects, object.id)).position)
      const centroid = positions.reduce(
        (sum, position) => ({ x: sum.x + position.x / members.length, y: sum.y + position.y / members.length, z: sum.z + position.z / members.length }),
        { x: 0, y: 0, z: 0 },
      )
      const group: DirectorObject = { id: groupId, name, type: 'group', parentId: commonParent, position: centroid, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '', visible: true, locked: false }
      const groupInverse = invertFrame(multiplyFrames(objectWorldFrame(scene.objects, commonParent), localFrame(group)))
      const changes = new Map(members.map(object => [object.id, multiplyFrames(groupInverse, objectWorldFrame(scene.objects, object.parentId))]))
      commitProject((_, active) => {
        active.objects.push(group)
        for (const object of active.objects) {
          const change = changes.get(object.id)
          if (!change) continue
          transformObject(object, change)
          object.parentId = groupId
        }
      })
      get().select({ objectId: groupId, multiObjectIds: [groupId] })
      return groupId
    },
    ungroupObjects: (groupId) => {
      const scene = get().activeScene()
      const group = scene.objects.find((object) => object.id === groupId && object.type === 'group')
      if (!group) return []
      save()
      const released: string[] = []
      const frame = localFrame(group)
      commitProject((_, active) => {
        for (const object of active.objects) {
          if (object.parentId !== groupId) continue
          released.push(object.id)
          object.parentId = group.parentId
          transformObject(object, frame)
        }
        active.objects = active.objects.filter((object) => object.id !== groupId)
        active.timelineTrackOrder = active.timelineTrackOrder.filter(id => id !== groupId)
        active.timelineTrackPins = active.timelineTrackPins.filter(id => id !== groupId)
        active.timelineTrackFolds = active.timelineTrackFolds.filter(id => id !== groupId)
      })
      set((state) => {
        const evaluatedPoses = { ...state.evaluatedPoses }
        delete evaluatedPoses[groupId]
        for (const id of released) delete evaluatedPoses[id]
        return { evaluatedPoses }
      })
      get().select({ objectId: released[0] ?? null, multiObjectIds: released })
      return released
    },
    batchCreateCrowd: (objectId, rows, cols, spacing, groupName) => {
      const source = get().findObject(objectId)
      if (!source || source.type === 'group') return null
      save()
      const groupId = createObjectId()
      const startX = source.position.x - ((cols - 1) * spacing) / 2
      const startZ = source.position.z - ((rows - 1) * spacing) / 2
      commitProject((_, scene) => {
        scene.objects.push({
          id: groupId,
          name: groupName,
          type: 'group',
          parentId: source.parentId,
          position: { ...source.position },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          color: '',
          visible: true,
          locked: false,
        })
        for (let row = 0; row < rows; row += 1) {
          for (let col = 0; col < cols; col += 1) {
            const copy = deepClone(source)
            copy.id = createObjectId()
            copy.name = `${source.name}_${row + 1}x${col + 1}`
            const position = { x: startX + col * spacing - source.position.x, y: 0, z: startZ + row * spacing - source.position.z }
            for (const point of copy.motionTrajectory ?? []) {
              point.x += position.x - source.position.x
              point.y += position.y - source.position.y
              point.z += position.z - source.position.z
            }
            copy.position = position
            copy.parentId = groupId
            scene.objects.push(copy)
          }
        }
      })
      get().select({ objectId: groupId, multiObjectIds: [groupId] })
      return groupId
    },
    toggleObjectVisible: (objectId) => {
      save()
      commitProject((_, scene) => {
        const object = scene.objects.find((item) => item.id === objectId)
        if (!object) return
        const visible = !object.visible
        object.visible = visible
        if (object.type === 'group') {
          const children = new Set(descendantIds(scene, objectId))
          for (const child of scene.objects) if (children.has(child.id)) child.visible = visible
        }
      })
    },
    toggleObjectLock: (objectId) => {
      save()
      commitProject((_, scene) => {
        const object = scene.objects.find((item) => item.id === objectId)
        if (!object) return
        const locked = !object.locked
        object.locked = locked
        if (object.type === 'group') {
          const children = new Set(descendantIds(scene, objectId))
          for (const child of scene.objects) if (children.has(child.id)) child.locked = locked
        }
      })
    },
    bulkToggleObjectVisible: (objectIds) => {
      const scene = get().activeScene()
      const targets = scene.objects.filter((object) => objectIds.includes(object.id))
      if (targets.length === 0) return
      save()
      const visible = targets.some((object) => !object.visible)
      commitProject((_, active) => {
        const affected = new Set<string>()
        for (const object of targets) {
          affected.add(object.id)
          if (object.type === 'group') for (const id of descendantIds(active, object.id)) affected.add(id)
        }
        for (const object of active.objects) if (affected.has(object.id)) object.visible = visible
      })
    },
    bulkToggleObjectLock: (objectIds) => {
      const scene = get().activeScene()
      const targets = scene.objects.filter((object) => objectIds.includes(object.id))
      if (targets.length === 0) return
      save()
      const locked = !targets.some((object) => object.locked)
      commitProject((_, active) => {
        const affected = new Set<string>()
        for (const object of targets) {
          affected.add(object.id)
          if (object.type === 'group') for (const id of descendantIds(active, object.id)) affected.add(id)
        }
        for (const object of active.objects) if (affected.has(object.id)) object.locked = locked
      })
    },

    addCamera: (camera) => {
      save()
      const id = camera.id ?? createCameraId()
      commitProject((_, scene) => {
        scene.cameras.push(syncFocalLength({ ...camera, id, focalLengthMm: 0 }))
      })
      set((state) => ({ previewCameraId: state.previewCameraId || id }))
      return id
    },
    deleteCamera: (cameraId) => {
      save()
      commitProject((_, scene) => {
        scene.cameras = scene.cameras.filter((camera) => camera.id !== cameraId)
        scene.timelineTrackOrder = scene.timelineTrackOrder.filter((id) => id !== cameraId)
        scene.timelineTrackPins = scene.timelineTrackPins.filter((id) => id !== cameraId)
        scene.timelineTrackFolds = scene.timelineTrackFolds.filter((id) => id !== cameraId)
      })
      set((state) => {
        const evaluatedPoses = { ...state.evaluatedPoses }
        delete evaluatedPoses[cameraId]
        return { evaluatedPoses }
      })
    },
    updateCamera: (cameraId, patch) => commitProject((_, scene) => {
      const camera = scene.cameras.find((item) => item.id === cameraId)
      if (!camera) return
      Object.assign(camera, patch)
      if (patch.fov !== undefined) syncFocalLength(camera)
    }),
    setCameraFov: (cameraId, fov) => commitProject((_, scene) => {
      const camera = scene.cameras.find((item) => item.id === cameraId)
      if (!camera) return
      camera.fov = fov
      syncFocalLength(camera)
    }),

    addLight: (type, name, overrides) => {
      save()
      const light = createLight(type, createLightId(), name, overrides)
      commitProject((_, scene) => {
        scene.lights.push(light)
      })
      get().select({ lightId: light.id, objectId: null, cameraId: null, multiObjectIds: [], clipId: null, clipType: null, activeWaypointId: null, boneKey: null, ikTarget: null })
      return light.id
    },
    updateLight: (lightId, patch) => commitProject((_, scene) => {
      const light = scene.lights.find((item) => item.id === lightId)
      if (light) Object.assign(light, patch)
    }),
    deleteLight: (lightId) => {
      save()
      commitProject((_, scene) => {
        scene.lights = scene.lights.filter((light) => light.id !== lightId)
      })
    },
    duplicateLight: (lightId, nameSuffix) => {
      const source = get().findLight(lightId)
      if (!source) return null
      save()
      const copy = deepClone(source)
      copy.id = createLightId()
      copy.name = `${source.name}${nameSuffix}`
      copy.position = { x: source.position.x + 1, y: source.position.y, z: source.position.z + 1 }
      commitProject((_, scene) => {
        scene.lights.push(copy)
      })
      get().select({ lightId: copy.id, objectId: null, cameraId: null })
      return copy.id
    },
    toggleLightVisible: (lightId) => {
      save()
      commitProject((_, scene) => {
        const light = scene.lights.find((item) => item.id === lightId)
        if (light) light.visible = !light.visible
      })
    },
    toggleLightEnabled: (lightId) => {
      save()
      commitProject((_, scene) => {
        const light = scene.lights.find((item) => item.id === lightId)
        if (light) light.enabled = !light.enabled
      })
    },
    toggleLightLock: (lightId) => {
      save()
      commitProject((_, scene) => {
        const light = scene.lights.find((item) => item.id === lightId)
        if (light) light.locked = !light.locked
      })
    },
    writeLightSpatialTransform: (lightId, position, orientation) => commitProject((_, scene) => {
      const light = scene.lights.find((item) => item.id === lightId)
      if (!light) return
      if (position) light.position = { ...position }
      if (orientation?.yaw !== undefined) light.yaw = orientation.yaw
      if (orientation?.pitch !== undefined) light.pitch = orientation.pitch
    }),

    copyEntitiesToScene: (entityIds, targetSceneId, move) => {
      const project = get().project
      if (!project.scenes.some(scene => scene.id === targetSceneId) || targetSceneId === project.activeSceneId) return
      const selected = subtreeIds(get().activeScene().objects, entityIds)
      if (![...get().activeScene().objects, ...get().activeScene().cameras, ...get().activeScene().lights].some(entity => selected.has(entity.id))) return
      save()
      commitProject((draft, source) => {
        const target = draft.scenes.find(scene => scene.id === targetSceneId)!
        let bundle = deepClone(source)
        bundle.objects = bundle.objects.filter(item => selected.has(item.id))
        bundle.cameras = bundle.cameras.filter(item => selected.has(item.id))
        bundle.lights = bundle.lights.filter(item => selected.has(item.id))
        const layerChange = multiplyFrames(invertFrame(sceneFrame(target.sceneConfig)), sceneFrame(source.sceneConfig))
        for (const object of bundle.objects) {
          if (object.parentId && selected.has(object.parentId)) continue
          transformObject(object, multiplyFrames(layerChange, objectWorldFrame(source.objects, object.parentId)))
          delete object.parentId
        }
        for (const camera of bundle.cameras) {
          Object.assign(camera, transformCameraPose(camera, layerChange))
          if (camera.lookAtCoords) camera.lookAtCoords = transformPoint(layerChange, camera.lookAtCoords)
          for (const point of camera.motionTrajectory ?? []) {
            const pose = transformCameraPose({ position: { x: point.x, y: point.y, z: point.z }, yaw: point.yaw, pitch: point.pitch, roll: point.roll, fov: point.fov ?? camera.fov }, layerChange)
            point.x = pose.position.x; point.y = pose.position.y; point.z = pose.position.z
            point.yaw = pose.yaw; point.pitch = pose.pitch; point.roll = pose.roll
          }
        }
        for (const light of bundle.lights) transformLight(light, layerChange)
        const availableTargets = new Set([...target.objects, ...bundle.objects].map(object => object.id))
        for (const entity of [...bundle.objects, ...bundle.cameras]) {
          for (const point of entity.motionTrajectory ?? []) if (point.lookAtObjectId && !availableTargets.has(point.lookAtObjectId)) delete point.lookAtObjectId
        }
        for (const key of ['timelineTrackOrder', 'timelineTrackPins', 'timelineTrackFolds'] as const) bundle[key] = bundle[key].filter(id => selected.has(id))
        if (!move) bundle = remapSceneIds(bundle, 'copy')
        target.objects.push(...bundle.objects)
        target.cameras.push(...bundle.cameras)
        target.lights.push(...bundle.lights)
        for (const key of ['timelineTrackOrder', 'timelineTrackPins', 'timelineTrackFolds'] as const) target[key].push(...bundle[key])
        if (move) {
          source.objects = source.objects.filter(item => !selected.has(item.id))
          source.cameras = source.cameras.filter(item => !selected.has(item.id))
          source.lights = source.lights.filter(item => !selected.has(item.id))
          for (const key of ['timelineTrackOrder', 'timelineTrackPins', 'timelineTrackFolds'] as const) source[key] = source[key].filter(id => !selected.has(id))
        }
      })
    },
    moveLightToScene: (lightId, fromSceneId, toSceneId) => {
      if (fromSceneId === toSceneId) return
      save()
      commitProject((project) => {
        const from = project.scenes.find((scene) => scene.id === fromSceneId)
        const to = project.scenes.find((scene) => scene.id === toSceneId)
        if (!from || !to) return
        const index = from.lights.findIndex((light) => light.id === lightId)
        if (index === -1) return
        const [light] = from.lights.splice(index, 1)
        transformLight(light, multiplyFrames(invertFrame(sceneFrame(to.sceneConfig)), sceneFrame(from.sceneConfig)))
        to.lights.push(light)
      })
    },
  }
}
