import * as THREE from 'three'
import type { Scene3DVector3 } from './scene3dTypes'
import type { MannequinPosePreset, MannequinPoseSection } from './scene3dSharedTypes'
import { MANNEQUIN_REST_ROTATION_KEY } from './scene3dConstants'
import { degreesToRadians, vectorAlmostEqual } from './scene3dMath'

export const MANNEQUIN_DEFAULT_POSE: Record<string, Scene3DVector3> = {
  mixamorigSpine: [degreesToRadians(2), 0, 0],
  mixamorigHead: [degreesToRadians(-10), 0, 0],
  mixamorigLeftArm: [degreesToRadians(74), degreesToRadians(2), degreesToRadians(-4)],
  mixamorigRightArm: [degreesToRadians(74), degreesToRadians(-2), degreesToRadians(4)],
  mixamorigLeftForeArm: [degreesToRadians(10), degreesToRadians(-8), 0],
  mixamorigRightForeArm: [degreesToRadians(10), degreesToRadians(8), 0],
  mixamorigLeftHand: [degreesToRadians(6), 0, degreesToRadians(-8)],
  mixamorigRightHand: [degreesToRadians(6), 0, degreesToRadians(8)],
}

export const MANNEQUIN_POSE_SECTIONS: MannequinPoseSection[] = [
  {
    title: '身体',
    controls: [
      { bone: 'mixamorigHips', axisIndex: 0, label: '前倾', standingValue: 0 },
      { bone: 'mixamorigHips', axisIndex: 1, label: '转身', standingValue: 0 },
      { bone: 'mixamorigHips', axisIndex: 2, label: '侧倾', standingValue: 0 },
    ],
  },
  {
    title: '躯干',
    controls: [
      { bone: 'mixamorigSpine', axisIndex: 0, label: '前倾', standingValue: 2, baseOffsetDeg: 2 },
      { bone: 'mixamorigSpine', axisIndex: 1, label: '扭转', standingValue: 0 },
      { bone: 'mixamorigSpine', axisIndex: 2, label: '侧倾', standingValue: 0 },
    ],
  },
  {
    title: '头部',
    controls: [
      { bone: 'mixamorigHead', axisIndex: 0, label: '点头', standingValue: -10, baseOffsetDeg: -10 },
      { bone: 'mixamorigHead', axisIndex: 1, label: '转头', standingValue: 0 },
      { bone: 'mixamorigHead', axisIndex: 2, label: '歪头', standingValue: 0 },
    ],
  },
  {
    title: '手臂—肩',
    groups: [
      {
        title: '左',
        controls: [
          { bone: 'mixamorigLeftArm', axisIndex: 0, label: '前举', standingValue: -5, baseOffsetDeg: 74 },
          { bone: 'mixamorigLeftArm', axisIndex: 1, label: '外展', standingValue: 7, baseOffsetDeg: 2 },
          { bone: 'mixamorigLeftArm', axisIndex: 2, label: '扭转', standingValue: 0, baseOffsetDeg: -4 },
        ],
      },
      {
        title: '右',
        controls: [
          { bone: 'mixamorigRightArm', axisIndex: 0, label: '前举', standingValue: -5, baseOffsetDeg: 74 },
          { bone: 'mixamorigRightArm', axisIndex: 1, label: '外展', standingValue: 7, baseOffsetDeg: -2, valueScale: -1 },
          { bone: 'mixamorigRightArm', axisIndex: 2, label: '扭转', standingValue: 0, baseOffsetDeg: 4 },
        ],
      },
    ],
  },
  {
    title: '肘部',
    groups: [
      {
        title: '左',
        controls: [
          { bone: 'mixamorigLeftForeArm', axisIndex: 0, label: '弯曲', standingValue: 10, baseOffsetDeg: 10 },
          { bone: 'mixamorigLeftForeArm', axisIndex: 1, label: '内收', standingValue: -8, baseOffsetDeg: -8 },
          { bone: 'mixamorigLeftForeArm', axisIndex: 2, label: '扭转', standingValue: 0 },
        ],
      },
      {
        title: '右',
        controls: [
          { bone: 'mixamorigRightForeArm', axisIndex: 0, label: '弯曲', standingValue: 10, baseOffsetDeg: 10 },
          { bone: 'mixamorigRightForeArm', axisIndex: 1, label: '内收', standingValue: -8, baseOffsetDeg: 8, valueScale: -1 },
          { bone: 'mixamorigRightForeArm', axisIndex: 2, label: '扭转', standingValue: 0 },
        ],
      },
    ],
  },
  {
    title: '手腕',
    groups: [
      {
        title: '左',
        controls: [
          { bone: 'mixamorigLeftHand', axisIndex: 0, label: '下压', standingValue: 6, baseOffsetDeg: 6 },
          { bone: 'mixamorigLeftHand', axisIndex: 1, label: '侧摆', standingValue: 0 },
          { bone: 'mixamorigLeftHand', axisIndex: 2, label: '放松', standingValue: -8, baseOffsetDeg: -8 },
        ],
      },
      {
        title: '右',
        controls: [
          { bone: 'mixamorigRightHand', axisIndex: 0, label: '下压', standingValue: 6, baseOffsetDeg: 6 },
          { bone: 'mixamorigRightHand', axisIndex: 1, label: '侧摆', standingValue: 0 },
          { bone: 'mixamorigRightHand', axisIndex: 2, label: '放松', standingValue: -8, baseOffsetDeg: 8, valueScale: -1 },
        ],
      },
    ],
  },
]
export const MANNEQUIN_POSE_MIN_DEG = -90
export const MANNEQUIN_POSE_MAX_DEG = 90

export const MANNEQUIN_POSE_PRESETS: MannequinPosePreset[] = [
  {
    id: 'standing',
    label: '站立',
  },
  {
    id: 't-pose',
    label: 'T型',
    pose: makePoseOffset({
      mixamorigSpine: [-2, 0, 0],
      mixamorigHead: [10, 0, 0],
      mixamorigLeftArm: [-74, -2, 4],
      mixamorigRightArm: [-74, 2, -4],
      mixamorigLeftForeArm: [-10, 8, 0],
      mixamorigRightForeArm: [-10, -8, 0],
      mixamorigLeftHand: [-6, 0, 8],
      mixamorigRightHand: [-6, 0, -8],
    }),
  },
  {
    id: 'walk',
    label: '行走',
    pose: makePoseOffset({
      mixamorigHips: [0, -6, 0],
      mixamorigSpine: [2, 4, 0],
      mixamorigLeftArm: [22, -4, 2],
      mixamorigRightArm: [-18, 4, -2],
      mixamorigLeftForeArm: [12, -3, 0],
      mixamorigRightForeArm: [16, 3, 0],
      mixamorigLeftUpLeg: [-28, 0, 0],
      mixamorigLeftLeg: [20, 0, 0],
      mixamorigRightUpLeg: [22, 0, 0],
      mixamorigRightLeg: [8, 0, 0],
    }),
  },
  {
    id: 'run',
    label: '跑步',
    pose: makePoseOffset({
      mixamorigHips: [8, -8, 0],
      mixamorigSpine: [10, 5, 0],
      mixamorigHead: [6, 0, 0],
      mixamorigLeftArm: [44, -10, 4],
      mixamorigRightArm: [-32, 10, -4],
      mixamorigLeftForeArm: [42, -4, 0],
      mixamorigRightForeArm: [48, 4, 0],
      mixamorigLeftUpLeg: [-44, 0, 0],
      mixamorigLeftLeg: [42, 0, 0],
      mixamorigRightUpLeg: [34, 0, 0],
      mixamorigRightLeg: [26, 0, 0],
      mixamorigLeftFoot: [-10, 0, 0],
      mixamorigRightFoot: [10, 0, 0],
    }),
  },
  {
    id: 'sit',
    label: '坐姿',
    pose: makePoseOffset({
      mixamorigHips: [-6, 0, 0],
      mixamorigSpine: [6, 0, 0],
      mixamorigLeftArm: [4, -16, 8],
      mixamorigRightArm: [4, 16, -8],
      mixamorigLeftForeArm: [12, -8, 0],
      mixamorigRightForeArm: [12, 8, 0],
      mixamorigLeftHand: [-2, 0, -6],
      mixamorigRightHand: [-2, 0, 6],
      mixamorigLeftUpLeg: [-68, 4, 0],
      mixamorigRightUpLeg: [-68, -4, 0],
      mixamorigLeftLeg: [-72, 0, 0],
      mixamorigRightLeg: [-72, 0, 0],
      mixamorigLeftFoot: [10, 0, 0],
      mixamorigRightFoot: [10, 0, 0],
    }),
  },
  {
    id: 'squat',
    label: '蹲下',
    pose: makePoseOffset({
      mixamorigHips: [-24, 0, 0],
      mixamorigSpine: [14, 0, 0],
      mixamorigHead: [8, 0, 0],
      mixamorigLeftArm: [18, -8, 2],
      mixamorigRightArm: [18, 8, -2],
      mixamorigLeftForeArm: [30, -6, 0],
      mixamorigRightForeArm: [30, 6, 0],
      mixamorigLeftUpLeg: [68, 0, 0],
      mixamorigRightUpLeg: [68, 0, 0],
      mixamorigLeftLeg: [-96, 0, 0],
      mixamorigRightLeg: [-96, 0, 0],
      mixamorigLeftFoot: [34, 0, 0],
      mixamorigRightFoot: [34, 0, 0],
    }),
  },
  {
    id: 'single-knee',
    label: '单膝跪',
    pose: makePoseOffset({
      mixamorigHips: [-16, 0, 0],
      mixamorigSpine: [10, 0, 0],
      mixamorigLeftArm: [16, -6, 2],
      mixamorigRightArm: [10, 6, -2],
      mixamorigLeftForeArm: [28, -4, 0],
      mixamorigRightForeArm: [22, 4, 0],
      mixamorigLeftUpLeg: [70, 0, 0],
      mixamorigLeftLeg: [-72, 0, 0],
      mixamorigRightUpLeg: [18, 0, 0],
      mixamorigRightLeg: [-108, 0, 0],
      mixamorigLeftFoot: [18, 0, 0],
      mixamorigRightFoot: [50, 0, 0],
    }),
  },
  {
    id: 'double-knee',
    label: '双膝跪',
    pose: makePoseOffset({
      mixamorigHips: [-22, 0, 0],
      mixamorigSpine: [12, 0, 0],
      mixamorigLeftArm: [12, -4, 2],
      mixamorigRightArm: [12, 4, -2],
      mixamorigLeftForeArm: [26, -4, 0],
      mixamorigRightForeArm: [26, 4, 0],
      mixamorigLeftUpLeg: [46, 0, 0],
      mixamorigRightUpLeg: [46, 0, 0],
      mixamorigLeftLeg: [-118, 0, 0],
      mixamorigRightLeg: [-118, 0, 0],
      mixamorigLeftFoot: [56, 0, 0],
      mixamorigRightFoot: [56, 0, 0],
    }),
  },
]

export function normalizeMannequinBoneName(boneName: string): string {
  return boneName.replace(/^mixamorig:/, 'mixamorig')
}

export function mannequinBoneNameVariants(boneName: string): string[] {
  const normalizedName = normalizeMannequinBoneName(boneName)
  const colonName = normalizedName.replace(/^mixamorig/, 'mixamorig:')
  return Array.from(new Set([boneName, normalizedName, colonName]))
}

export function mannequinPoseOffsetForBone(pose: Record<string, Scene3DVector3> | undefined, boneName: string): Scene3DVector3 | undefined {
  if (!pose) return undefined
  for (const candidate of mannequinBoneNameVariants(boneName)) {
    const rotation = pose[candidate]
    if (rotation) return rotation
  }
  return undefined
}

export function makePoseOffset(values: Record<string, Scene3DVector3>): Record<string, Scene3DVector3> {
  return Object.fromEntries(
    Object.entries(values).map(([boneName, rotation]) => [
      boneName,
      rotation.map((value) => degreesToRadians(value)) as Scene3DVector3,
    ]),
  )
}

export function clonePoseValue(pose?: Record<string, Scene3DVector3>): Record<string, Scene3DVector3> | undefined {
  if (!pose) return undefined
  return Object.fromEntries(
    Object.entries(pose).map(([boneName, rotation]) => [boneName, [...rotation] as Scene3DVector3]),
  )
}

export function poseMatchesPreset(pose: Record<string, Scene3DVector3> | undefined, preset: MannequinPosePreset): boolean {
  if (!preset.pose) return !pose || Object.keys(pose).length === 0
  if (!pose) return false
  const presetEntries = Object.entries(preset.pose)
  if (presetEntries.length !== Object.keys(pose).length) return false
  return presetEntries.every(([boneName, rotation]) => {
    const currentRotation = pose[boneName]
    return currentRotation ? vectorAlmostEqual(currentRotation, rotation) : false
  })
}

export function rememberMannequinRestPose(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Bone)) return
    object.userData[MANNEQUIN_REST_ROTATION_KEY] = [
      object.rotation.x,
      object.rotation.y,
      object.rotation.z,
    ] satisfies Scene3DVector3
  })
}

export function applyMannequinSkeletonPose(root: THREE.Object3D, pose?: Record<string, Scene3DVector3>): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Bone)) return
    const restRotation = object.userData[MANNEQUIN_REST_ROTATION_KEY] as Scene3DVector3 | undefined
    if (!restRotation) return
    object.rotation.set(restRotation[0], restRotation[1], restRotation[2])
  })
  root.traverse((object) => {
    if (!(object instanceof THREE.Bone)) return
    const defaultOffset = MANNEQUIN_DEFAULT_POSE[normalizeMannequinBoneName(object.name)]
    const savedOffset = mannequinPoseOffsetForBone(pose, object.name)
    if (!defaultOffset && !savedOffset) return
    object.rotation.x += (defaultOffset?.[0] || 0) + (savedOffset?.[0] || 0)
    object.rotation.y += (defaultOffset?.[1] || 0) + (savedOffset?.[1] || 0)
    object.rotation.z += (defaultOffset?.[2] || 0) + (savedOffset?.[2] || 0)
  })
  root.updateMatrixWorld(true)
}

export function normalizeMannequinModel(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const normalized = new THREE.Group()
  const height = Math.max(0.001, size.y)

  root.position.sub(center)
  normalized.scale.setScalar(1 / height)
  normalized.add(root)
  normalized.updateMatrixWorld(true)
  return normalized
}
