/**
 * [INPUT]: 依赖 @react-three/fiber 的 useFrame、../DirectorEditorContext 的 useDirectorStoreApi、./SceneRegistryContext、
 *          ../model/trajectoryEval 的 evaluateEntityTransform / EvaluatedTransform、../model/closeupRig（findCloseupClipAt / solveCloseupPose）、
 *          ../model/vec3（DEG_TO_RAD / lookAtAngles）、../model/timeGrid 的 clampToTimeline、../model/directorTypes、../model/directorStore 的 EvaluatedPose、./cameraMath 的 cameraQuaternion、
 *          ../model/evaluatedSceneObject / sceneObjectGraph 的目标完整场景位姿（含祖先动画与静止基线）
 * [OUTPUT]: 对外提供 useTimelinePlayback：每帧先吃 pendingSeek，再推进播放头（isPlaying 时按 store.playbackRate 倍速），把求值位姿写到 three 对象 + store.evaluatedPoses
 * [POS]: director/scene 的求值循环（方案 §5.2）：对象 = 路径求值（sample / hold / rest）；机位 = 特写片段（用目标当前求值位姿，转圈类以片段起点朝向为参考系）
 *        > 路径片段 > 静止，再叠加 rig（跟随保持相对偏移 / 只转朝向）与看向目标；录制中的机位跳过（视口相机在驱动它）；拖 gizmo 期间不覆盖被拖对象。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useFrame } from '@react-three/fiber'
import { useDirectorStoreApi } from '../DirectorEditorContext'
import { findCloseupClipAt, solveCloseupPose } from '../model/closeupRig'
import type { EvaluatedPose } from '../model/directorStore'
import type { DirectorCamera, DirectorScene, Vec3 } from '../model/directorTypes'
import { clampToTimeline } from '../model/timeGrid'
import { evaluateEntityTransform, type EvaluatedTransform } from '../model/trajectoryEval'
import { DEG_TO_RAD, lookAtAngles } from '../model/vec3'
import { cameraQuaternion } from './cameraMath'
import { useSceneRegistry } from './SceneRegistryContext'
import { evaluateSceneObjectPose } from '../model/evaluatedSceneObject'
import { objectWorldFrame } from '../model/sceneObjectGraph'

// 看向对象时瞄准的高度（眼睛附近），与特写锚点 face≈1.5m 同量级
const LOOK_AT_EYE_HEIGHT = 1.5

type CameraPoseResult = { position: Vec3; rotation: Vec3; driven: boolean; lookAtCoords?: Vec3; fov?: number }

function anglesToward(from: Vec3, to: Vec3): Vec3 {
  const angles = lookAtAngles(from, to)
  return { x: angles.pitch, y: angles.yaw, z: angles.roll }
}

// 机位位姿：特写 > 路径 > 静止，再叠 rig / 看向
function evaluateCameraPose(camera: DirectorCamera, scene: DirectorScene, time: number, objectPoses: Map<string, EvaluatedTransform>): CameraPoseResult {
  const evaluatedOf = (objectId: string) => evaluateSceneObjectPose(scene.objects, objectId, time, objectPoses)
  const closeup = findCloseupClipAt(camera.closeupClips, time)
  if (closeup) {
    const target = scene.objects.find((item) => item.id === closeup.targetObjectId)
    const targetNow = target ? evaluatedOf(target.id) : null
    if (target && targetNow) {
      const targetAtStart = evaluateSceneObjectPose(scene.objects, target.id, closeup.startTime)!
      const solved = solveCloseupPose({
        clip: closeup,
        currentTime: time,
        targetPosition: targetNow.position,
        targetRotationY: targetNow.yaw,
        referenceRotationY: targetAtStart.yaw,
        cameraRotation: { x: camera.pitch, y: camera.yaw, z: camera.roll },
      })
      const rotation = solved.rotation ?? (solved.lookAt ? anglesToward(solved.position, solved.lookAt) : { x: camera.pitch, y: camera.yaw, z: camera.roll })
      return { position: solved.position, rotation, driven: true, lookAtCoords: solved.lookAt ?? undefined }
    }
  }
  const evaluated = evaluateEntityTransform(camera, time)
  let position = evaluated.position
  let rotation = evaluated.rotation
  let driven = evaluated.source !== 'rest'
  const target = camera.lookAtObjectId ? scene.objects.find((item) => item.id === camera.lookAtObjectId) : undefined
  const targetNow = target ? evaluatedOf(target.id) : null
  if (target && targetNow && camera.rigType === 'follow') {
    // 跟随：保持机位相对目标静止位姿的偏移
    const targetRest = objectWorldFrame(scene.objects, target.id).position
    position = {
      x: position.x + (targetNow.position.x - targetRest.x),
      y: position.y + (targetNow.position.y - targetRest.y),
      z: position.z + (targetNow.position.z - targetRest.z),
    }
    driven = true
  }
  if (target && targetNow && (camera.lookAtType === 'object' || camera.rigType === 'follow' || camera.rigType === 'track_aim')) {
    const aim = { x: targetNow.position.x, y: targetNow.position.y + LOOK_AT_EYE_HEIGHT, z: targetNow.position.z }
    rotation = anglesToward(position, aim)
    return { position, rotation, driven: true, lookAtCoords: aim, fov: evaluated.fov }
  }
  if (camera.lookAtType === 'coordinates' && camera.lookAtCoords) {
    rotation = anglesToward(position, camera.lookAtCoords)
    return { position, rotation, driven: true, lookAtCoords: camera.lookAtCoords, fov: evaluated.fov }
  }
  return { position, rotation, driven, fov: evaluated.fov }
}

function poseChanged(previous: EvaluatedPose | undefined, position: Vec3, rotation: Vec3): boolean {
  if (!previous) return true
  return (
    previous.position.x !== position.x ||
    previous.position.y !== position.y ||
    previous.position.z !== position.z ||
    previous.rotation.x !== rotation.x ||
    previous.rotation.y !== rotation.y ||
    previous.rotation.z !== rotation.z
  )
}

export function useTimelinePlayback(): void {
  const store = useDirectorStoreApi()
  const registry = useSceneRegistry()

  useFrame((_, delta) => {
    const state = store.getState()
    const scene = state.activeScene()
    let time = state.timeline.currentTime
    const seek = state.consumeSeek()
    if (seek !== null) {
      time = clampToTimeline(seek, state.timeline.totalDuration)
      state.setTimelineContext({ currentTime: time, isPlaying: false })
    } else if (state.timeline.isPlaying) {
      const contentEnd = state.contentEndSeconds()
      const next = time + delta * state.playbackRate
      if (contentEnd <= 0 || next >= contentEnd) {
        state.setTimelineContext({ currentTime: contentEnd > 0 ? contentEnd : 0, isPlaying: false })
        time = contentEnd > 0 ? contentEnd : 0
      } else {
        time = clampToTimeline(next, state.timeline.totalDuration)
        state.setTimelineContext({ currentTime: time })
      }
    }
    const dragging = state.isTimelineDragging
    const selectedObjectId = state.selection.objectId
    const selectedCameraId = state.selection.cameraId
    const objectPoses = new Map<string, EvaluatedTransform>()
    for (const object of scene.objects) {
      if (!object.trajectoryClips?.length) continue
      const evaluated = evaluateEntityTransform(object, time)
      objectPoses.set(object.id, evaluated)
      if (dragging && selectedObjectId === object.id) continue
      const root = registry.get(object.id)
      if (!root) continue
      root.position.set(evaluated.position.x, evaluated.position.y, evaluated.position.z)
      root.rotation.set(evaluated.rotation.x * DEG_TO_RAD, evaluated.rotation.y * DEG_TO_RAD, evaluated.rotation.z * DEG_TO_RAD)
      const previous = state.evaluatedPoses[object.id]
      if (evaluated.source === 'rest') {
        if (previous) state.setEvaluatedPose(object.id, null)
      } else if (poseChanged(previous, evaluated.position, evaluated.rotation)) {
        state.setEvaluatedPose(object.id, { position: evaluated.position, rotation: evaluated.rotation })
      }
    }
    for (const camera of scene.cameras) {
      if (state.recording?.cameraId === camera.id) continue
      if (dragging && selectedCameraId === camera.id) continue
      const hasDriver = Boolean(camera.trajectoryClips?.length || camera.closeupClips?.length || camera.lookAtType === 'coordinates' || camera.lookAtObjectId)
      const previous = state.evaluatedPoses[camera.id]
      if (!hasDriver) {
        if (previous) state.setEvaluatedPose(camera.id, null)
        continue
      }
      const result = evaluateCameraPose(camera, scene, time, objectPoses)
      const root = registry.get(camera.id)
      if (root) {
        root.position.set(result.position.x, result.position.y, result.position.z)
        root.quaternion.copy(cameraQuaternion(result.rotation.x, result.rotation.y, result.rotation.z))
      }
      if (!result.driven) {
        if (previous) state.setEvaluatedPose(camera.id, null)
      } else if (poseChanged(previous, result.position, result.rotation) || previous?.fov !== result.fov) {
        state.setEvaluatedPose(camera.id, { position: result.position, rotation: result.rotation, lookAtCoords: result.lookAtCoords, ...(result.fov !== undefined ? { fov: result.fov } : {}) })
      }
    }
  })
}
