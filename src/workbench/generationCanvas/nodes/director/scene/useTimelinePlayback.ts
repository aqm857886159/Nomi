/**
 * [INPUT]: 依赖 @react-three/fiber 的 useFrame、../DirectorEditorContext 的 useDirectorStoreApi、./SceneRegistryContext、
 *          ../model/trajectoryEval 的 evaluateEntityTransform / EvaluatedTransform、../model/cameraPoseEval（纯机位位姿求值）、
 *          ../model/vec3（DEG_TO_RAD / lookAtAngles）、../model/timeGrid 的 clampToTimeline、../model/directorTypes、../model/directorStore 的 EvaluatedPose、./cameraMath 的 cameraQuaternion、
 *          ../model/evaluatedSceneObject / sceneObjectGraph 的目标完整场景位姿（含祖先动画与静止基线）
 * [OUTPUT]: 对外提供 useTimelinePlayback：每帧先吃 pendingSeek，再推进播放头（isPlaying 时按 store.playbackRate 倍速），把求值位姿写到 three 对象 + store.evaluatedPoses
 * [POS]: director/scene 的求值循环（方案 §5.2）：对象 = 路径求值（sample / hold / rest）；机位 = 特写片段（用目标当前求值位姿，转圈类以片段起点朝向为参考系）
 *        > 路径片段 > 静止，再叠加 rig（跟随保持相对偏移 / 只转朝向）与看向目标；录制中的机位跳过（视口相机在驱动它）；拖 gizmo 期间不覆盖被拖对象。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useFrame } from '@react-three/fiber'
import { useDirectorStoreApi } from '../DirectorEditorContext'
import type { EvaluatedPose } from '../model/directorStore'
import type { Vec3 } from '../model/directorTypes'
import { clampToTimeline } from '../model/timeGrid'
import { evaluateEntityTransform, type EvaluatedTransform } from '../model/trajectoryEval'
import { evaluateCameraPose } from '../model/cameraPoseEval'
import { DEG_TO_RAD } from '../model/vec3'
import { cameraQuaternion } from './cameraMath'
import { useSceneRegistry } from './SceneRegistryContext'

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
      root.rotation.set(
        evaluated.rotation.x * DEG_TO_RAD,
        evaluated.rotation.y * DEG_TO_RAD,
        evaluated.rotation.z * DEG_TO_RAD,
      )
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
      const hasDriver = Boolean(
        camera.trajectoryClips?.length ||
        camera.closeupClips?.length ||
        camera.lookAtType === 'coordinates' ||
        camera.lookAtObjectId,
      )
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
        state.setEvaluatedPose(camera.id, {
          position: result.position,
          rotation: result.rotation,
          lookAtCoords: result.lookAtCoords,
          ...(result.fov !== undefined ? { fov: result.fov } : {}),
        })
      }
    }
  })
}
