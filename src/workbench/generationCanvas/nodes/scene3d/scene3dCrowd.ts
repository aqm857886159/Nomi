// 对象几何/摆位纯函数的**单一真相源**（占位 footprint / 视觉半高 / 变换锚点 / 避让摆位 / 群众排布）。
// 直驱盖章、导出采样、安全框、对焦、渲染层全部从这里取——别在组件文件里再抄一份
// （2026-08-04 曾在 scene3dObjects.tsx 抄出分叉：prop 分支只补了一份，导出采样把道具错抬半高）。
import * as THREE from 'three'
import type { Scene3DObject, Scene3DVector3 } from './scene3dTypes'
import {
  MANNEQUIN_LABEL_BASE_HEIGHT,
  crowdColumns,
  crowdCount,
  crowdRows,
} from './scene3dConstants'
import {
  crowdSpacing,
  vectorFromArray,
  vectorToArray,
} from './scene3dMath'
import { propGroundFootprint } from './scene3dPropSpecs'

export function mannequinFootRingRadius(object: Scene3DObject): number {
  const scaleX = Math.max(0.08, Math.abs(object.scale[0] || 1))
  const scaleZ = Math.max(0.08, Math.abs(object.scale[2] || 1))
  return Math.max(0.28, Math.max(0.78 * scaleX, 0.54 * scaleZ) * 0.36)
}

export function crowdCenterSpacing(object: Scene3DObject): number {
  return crowdSpacing(object) + mannequinFootRingRadius(object) * 2
}

export function crowdLocalOffset(object: Scene3DObject, index: number): THREE.Vector3 {
  const rows = crowdRows(object)
  const columns = crowdColumns(object)
  const spacing = crowdCenterSpacing(object)
  const row = Math.floor(index / columns)
  const column = index % columns
  const scaleX = Math.max(0.001, Math.abs(object.scale[0] || 1))
  const scaleZ = Math.max(0.001, Math.abs(object.scale[2] || 1))
  return new THREE.Vector3(
    ((column - (columns - 1) / 2) * spacing) / scaleX,
    0,
    ((row - (rows - 1) / 2) * spacing) / scaleZ,
  )
}

export function crowdLocalOffsets(object: Scene3DObject): THREE.Vector3[] {
  return Array.from({ length: crowdCount(object) }, (_, index) => crowdLocalOffset(object, index))
}

export function mannequinLabelHeight(object: Scene3DObject): number {
  return Math.max(0.8, Math.abs(object.scale[1] || 1) * MANNEQUIN_LABEL_BASE_HEIGHT)
}

export function objectGroundFootprint(object: Scene3DObject): { width: number; depth: number } {
  const scaleX = Math.max(0.08, Math.abs(object.scale[0] || 1))
  const scaleY = Math.max(0.08, Math.abs(object.scale[1] || 1))
  const scaleZ = Math.max(0.08, Math.abs(object.scale[2] || 1))

  if (object.type === 'light') return { width: 0.42 * scaleX, depth: 0.42 * scaleZ }
  if (object.type === 'mannequinCrowd') {
    const ringDiameter = mannequinFootRingRadius(object) * 2
    const centerSpacing = crowdCenterSpacing(object)
    return {
      width: (crowdColumns(object) - 1) * centerSpacing + ringDiameter,
      depth: (crowdRows(object) - 1) * centerSpacing + ringDiameter,
    }
  }
  if (object.type === 'mannequin') return { width: 0.78 * scaleX, depth: 0.54 * scaleZ }
  if (object.type === 'prop' && object.propKind) {
    const footprint = propGroundFootprint(object.propKind)
    return { width: footprint.width * scaleX, depth: footprint.depth * scaleZ }
  }
  if (object.type === 'model' || object.type === 'group') return { width: 1 * scaleX, depth: 1 * scaleZ }
  if (object.geometry === 'sphere') return { width: 1.1 * scaleX, depth: 1.1 * scaleZ }
  if (object.geometry === 'cylinder') return { width: 0.92 * scaleX, depth: 0.92 * scaleZ }
  if (object.geometry === 'plane') return { width: scaleX, depth: scaleY }
  return { width: scaleX, depth: scaleZ }
}

export function objectVisualHalfHeight(object: Scene3DObject, scale: Scene3DVector3 = object.scale): number {
  const scaleY = Math.max(0.08, Math.abs(scale[1] || 1))
  if (object.type === 'light') return 0.12 * scaleY
  if (object.type === 'prop') return 0 // origin 在地面中心：绑轨迹/落地时底面直接贴着走
  if (object.type === 'mannequin' || object.type === 'mannequinCrowd') return 0.5 * scaleY
  if (object.geometry === 'sphere') return 0.55 * scaleY
  if (object.geometry === 'cylinder') return 0.55 * scaleY
  if (object.geometry === 'plane') return 0
  return 0.5 * scaleY
}

export function objectTransformAnchorPosition(object: Scene3DObject): Scene3DVector3 {
  return [
    object.position[0],
    object.position[1] - objectVisualHalfHeight(object),
    object.position[2],
  ]
}

export function nextAvailableObjectPosition(object: Scene3DObject, objects: Scene3DObject[]): Scene3DVector3 {
  const targetFootprint = objectGroundFootprint(object)
  const targetRadius = Math.max(targetFootprint.width, targetFootprint.depth) / 2
  const gap = 0.45
  const occupied = objects.map((existing) => {
    const footprint = objectGroundFootprint(existing)
    return {
      x: existing.position[0],
      z: existing.position[2],
      radius: Math.max(footprint.width, footprint.depth) / 2,
    }
  })
  const fits = (x: number, z: number) => occupied.every((existing) => {
    const dx = x - existing.x
    const dz = z - existing.z
    return Math.sqrt(dx * dx + dz * dz) >= targetRadius + existing.radius + gap
  })
  const makePosition = (x: number, z: number): Scene3DVector3 => [
    Number(x.toFixed(4)),
    object.position[1],
    Number(z.toFixed(4)),
  ]

  if (fits(object.position[0], object.position[2])) return object.position

  const step = Math.max(1.5, targetRadius * 2 + gap)
  for (let ring = 1; ring <= 10; ring += 1) {
    const offsets: Array<[number, number]> = [
      [ring, 0],
      [-ring, 0],
      [0, ring],
      [0, -ring],
      [ring, ring],
      [ring, -ring],
      [-ring, ring],
      [-ring, -ring],
    ]
    for (let axis = 1; axis < ring; axis += 1) {
      offsets.push(
        [ring, axis],
        [ring, -axis],
        [-ring, axis],
        [-ring, -axis],
        [axis, ring],
        [-axis, ring],
        [axis, -ring],
        [-axis, -ring],
      )
    }
    for (const [x, z] of offsets) {
      const nextX = x * step
      const nextZ = z * step
      if (fits(nextX, nextZ)) return makePosition(nextX, nextZ)
    }
  }

  return makePosition((occupied.length + 1) * step, 0)
}
