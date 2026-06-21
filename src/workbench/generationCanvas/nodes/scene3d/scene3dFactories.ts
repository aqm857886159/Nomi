import {
  createScene3DCameraId,
  createScene3DObjectId,
  createScene3DTrajectoryBindingId,
  createScene3DTrajectoryGroupId,
  createScene3DTrajectoryId,
  createScene3DTrajectoryPointId,
} from './scene3dSerializer'
import {
  type Scene3DCamera,
  type Scene3DGeometry,
  type Scene3DObject,
  type Scene3DTrajectory,
  type Scene3DTrajectoryBinding,
  type Scene3DTrajectoryBoundObject,
  type Scene3DTrajectoryGroup,
  type Scene3DTrajectoryPoint,
  type Scene3DVector3,
} from './scene3dTypes'
import type { CrowdAddOptions } from './scene3dSharedTypes'
import { CAMERA_DEFAULT_TARGET, MANNEQUIN_DEFAULT_SCALE } from './scene3dConstants'
import { clampRatio, trajectoryPointTimeRatio } from './trajectory/trajectoryUtils'
import { cameraLookAtRotation } from './scene3dMath'
import { clampCrowdOptions, roleColorForIndex } from './scene3dCrowd'

export function makeObject(kind: Scene3DGeometry | 'mannequin' | 'light', roleIndex = 0): Scene3DObject {
  const id = createScene3DObjectId()
  if (kind === 'mannequin') {
    return {
      id,
      name: '假人',
      type: 'mannequin',
      visible: true,
      position: [0, MANNEQUIN_DEFAULT_SCALE[1] * 0.5, 0],
      rotation: [0, 0, 0],
      scale: [...MANNEQUIN_DEFAULT_SCALE],
      color: roleColorForIndex(roleIndex),
    }
  }
  if (kind === 'light') {
    return {
      id,
      name: '点光源',
      type: 'light',
      visible: true,
      position: [2.5, 3.5, 2.5],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      lightType: 'point',
      lightColor: '#ffffff',
      lightIntensity: 2.4,
    }
  }
  const labels: Record<Scene3DGeometry, string> = {
    box: '立方体',
    sphere: '球体',
    cylinder: '圆柱体',
    plane: '平面',
  }
  return {
    id,
    name: labels[kind],
    type: 'mesh',
    visible: true,
    position: kind === 'plane' ? [0, 0, 0] : [0, 0.5, 0],
    rotation: kind === 'plane' ? [-Math.PI / 2, 0, 0] : [0, 0, 0],
    scale: kind === 'plane' ? [4, 4, 4] : [1, 1, 1],
    color: kind === 'plane' ? '#4b5563' : '#7c8ea0',
    geometry: kind,
  }
}

export function makeCrowdObject(options: CrowdAddOptions): Scene3DObject {
  const id = createScene3DObjectId()
  const crowd = clampCrowdOptions(options)
  return {
    id,
    name: `群众(${crowd.rows}x${crowd.columns})`,
    type: 'mannequinCrowd',
    visible: true,
    position: [0, MANNEQUIN_DEFAULT_SCALE[1] * 0.5, 0],
    rotation: [0, 0, 0],
    scale: [...MANNEQUIN_DEFAULT_SCALE],
    crowdRows: crowd.rows,
    crowdColumns: crowd.columns,
    crowdSpacing: crowd.spacing,
  }
}

export function makeCamera(index: number): Scene3DCamera {
  const position: Scene3DVector3 = [4, 2.4, 5]
  const target: Scene3DVector3 = [...CAMERA_DEFAULT_TARGET]
  return {
    id: createScene3DCameraId(),
    name: `相机${index + 1}`,
    visible: true,
    position,
    rotation: cameraLookAtRotation(position, target),
    target,
    fov: 45,
    aspectRatio: '16:9',
    lensDepth: 0,
    near: 0.1,
    far: 200,
  }
}

export function makeTrajectory(index: number): Scene3DTrajectory {
  return {
    id: createScene3DTrajectoryId(),
    name: `轨迹${index + 1}`,
    points: [],
    curveControls: [],
    tension: 0.5,
    closed: false,
    color: roleColorForIndex(index),
  }
}

export function makeTrajectoryPoint(position: Scene3DVector3, timeRatio?: number): Scene3DTrajectoryPoint {
  return {
    id: createScene3DTrajectoryPointId(),
    position,
    timeRatio: typeof timeRatio === 'number' && Number.isFinite(timeRatio) ? clampRatio(timeRatio) : undefined,
  }
}

export function trajectoryInsertTimeRatio(trajectory: Scene3DTrajectory, insertIndex: number): number | undefined {
  if (trajectory.points.length === 0) return undefined
  if (insertIndex <= 0) return 0
  if (!trajectory.closed && insertIndex >= trajectory.points.length) return 1
  const previousRatio = trajectoryPointTimeRatio(trajectory, insertIndex - 1)
  const nextRatio = insertIndex >= trajectory.points.length
    ? 1
    : trajectoryPointTimeRatio(trajectory, insertIndex)
  return Number(((previousRatio + nextRatio) / 2).toFixed(4))
}

export function makeTrajectoryBinding(trajectoryId: string, objectId?: string): Scene3DTrajectoryBinding {
  const objects: Scene3DTrajectoryBoundObject[] = objectId ? [{ objectId, offsetRatio: 0 }] : []
  return {
    id: createScene3DTrajectoryBindingId(),
    trajectoryId,
    objects,
    startTime: 0,
    endTime: 3,
    direction: 'forward',
  }
}

export function makeTrajectoryGroup(index: number): Scene3DTrajectoryGroup {
  return {
    id: createScene3DTrajectoryGroupId(),
    name: `组${index + 1}`,
    trajectoryIds: [],
  }
}
