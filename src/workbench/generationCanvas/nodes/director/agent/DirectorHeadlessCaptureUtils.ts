import type { DirectorScene } from '../model/directorTypes'
import type { CaptureCharacterPoseReadback } from '../scene/ViewportApiContext'
import { poseClipStatus } from '../scene/character/poseClipLibrary'

export function actionClipsLoading(scene: DirectorScene): boolean {
  return scene.objects.some((object) => object.type === 'character' && object.visible && object.actionTrackEnabled !== false && (object.actionClips ?? []).some((clip) => clip.clipType === 'action' && Boolean(clip.actionPose) && poseClipStatus(clip.actionPose!) === 'loading'))
}

export function isTPose(pose: CaptureCharacterPoseReadback): boolean {
  const shoulderY = (pose.leftShoulder.y + pose.rightShoulder.y) / 2
  const shoulderSpan = Math.max(0.1, Math.hypot(pose.leftShoulder.x - pose.rightShoulder.x, pose.leftShoulder.z - pose.rightShoulder.z))
  const leftReach = Math.hypot(pose.leftHand.x - pose.leftShoulder.x, pose.leftHand.z - pose.leftShoulder.z)
  const rightReach = Math.hypot(pose.rightHand.x - pose.rightShoulder.x, pose.rightHand.z - pose.rightShoulder.z)
  return Math.abs(pose.leftHand.y - shoulderY) <= 0.08 && Math.abs(pose.rightHand.y - shoulderY) <= 0.08 && leftReach >= shoulderSpan * 0.45 && rightReach >= shoulderSpan * 0.45
}

export function resolveHeadlessCameraId(scene: DirectorScene, time: number, cameraIdAt: ((time: number) => string | null) | undefined): string | null {
  return cameraIdAt ? cameraIdAt(time) : (scene.cameras[0]?.id ?? null)
}
