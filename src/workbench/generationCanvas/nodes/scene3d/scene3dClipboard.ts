import { createScene3DCameraId, createScene3DObjectId } from './scene3dSerializer'
import type { Scene3DCamera, Scene3DObject, Scene3DVector3 } from './scene3dTypes'
import { CLIPBOARD_PASTE_OFFSET } from './scene3dConstants'
import { cameraLookAtRotation } from './scene3dMath'
import { clonePoseValue } from './scene3dMannequinPose'

export function offsetScene3DVector(value: Scene3DVector3, count: number): Scene3DVector3 {
  return [
    Number((value[0] + CLIPBOARD_PASTE_OFFSET[0] * count).toFixed(4)),
    Number((value[1] + CLIPBOARD_PASTE_OFFSET[1] * count).toFixed(4)),
    Number((value[2] + CLIPBOARD_PASTE_OFFSET[2] * count).toFixed(4)),
  ]
}

export function cloneObjectForClipboard(object: Scene3DObject): Scene3DObject {
  return {
    ...object,
    position: [...object.position],
    rotation: [...object.rotation],
    scale: [...object.scale],
    pose: clonePoseValue(object.pose),
    children: object.children ? [...object.children] : undefined,
  }
}

export function cloneCameraForClipboard(camera: Scene3DCamera): Scene3DCamera {
  return {
    ...camera,
    position: [...camera.position],
    rotation: [...camera.rotation],
    target: [...camera.target],
  }
}

export function makePastedObject(object: Scene3DObject, pasteCount: number): Scene3DObject {
  return {
    ...cloneObjectForClipboard(object),
    id: createScene3DObjectId(),
    name: `${object.name} 副本`,
    position: offsetScene3DVector(object.position, pasteCount),
    parentId: undefined,
    children: undefined,
  }
}

export function makePastedCamera(camera: Scene3DCamera, pasteCount: number): Scene3DCamera {
  const position = offsetScene3DVector(camera.position, pasteCount)
  const target = offsetScene3DVector(camera.target, pasteCount)
  return {
    ...cloneCameraForClipboard(camera),
    id: createScene3DCameraId(),
    name: `${camera.name} 副本`,
    position,
    target,
    rotation: cameraLookAtRotation(position, target),
  }
}

export function updateVectorValue(value: Scene3DVector3, index: number, nextValue: number): Scene3DVector3 {
  const next: Scene3DVector3 = [...value]
  next[index] = Number.isFinite(nextValue) ? nextValue : value[index]
  return next
}

export function numberInputValue(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toFixed(3))) : '0'
}
