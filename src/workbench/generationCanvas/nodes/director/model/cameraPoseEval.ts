/**
 * [INPUT]: Director camera/scene data and optional object transform samples.
 * [OUTPUT]: Pure camera pose evaluation shared by the product playback loop and offline measurement.
 * [POS]: director/model camera evaluation owner; includes close-up clips, trajectory, follow and look-at behavior.
 */
import { findCloseupClipAt, solveCloseupPose } from './closeupRig'
import type { DirectorCamera, DirectorScene, Vec3 } from './directorTypes'
import { evaluateSceneObjectPose } from './evaluatedSceneObject'
import { objectWorldFrame } from './sceneObjectGraph'
import { evaluateEntityTransform, type EvaluatedTransform } from './trajectoryEval'
import { lookAtAngles } from './vec3'

const LOOK_AT_EYE_HEIGHT = 1.5

export type CameraPoseResult = { position: Vec3; rotation: Vec3; driven: boolean; lookAtCoords?: Vec3; fov?: number }

function anglesToward(from: Vec3, to: Vec3): Vec3 {
  const angles = lookAtAngles(from, to)
  return { x: angles.pitch, y: angles.yaw, z: angles.roll }
}

/** Close-up > trajectory > rest, then apply follow and look-at rigs. */
export function evaluateCameraPose(
  camera: DirectorCamera,
  scene: DirectorScene,
  time: number,
  objectPoses?: ReadonlyMap<string, EvaluatedTransform>,
): CameraPoseResult {
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
      const rotation =
        solved.rotation ??
        (solved.lookAt
          ? anglesToward(solved.position, solved.lookAt)
          : { x: camera.pitch, y: camera.yaw, z: camera.roll })
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
    const targetRest = objectWorldFrame(scene.objects, target.id).position
    position = {
      x: position.x + (targetNow.position.x - targetRest.x),
      y: position.y + (targetNow.position.y - targetRest.y),
      z: position.z + (targetNow.position.z - targetRest.z),
    }
    driven = true
  }
  if (
    target &&
    targetNow &&
    (camera.lookAtType === 'object' || camera.rigType === 'follow' || camera.rigType === 'track_aim')
  ) {
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
