import * as THREE from 'three'
import type { Scene3DObject, Scene3DVector3 } from './scene3dTypes'
import type { CrowdAddOptions } from './scene3dSharedTypes'
import {
  CROWD_MAX_AXIS,
  MANNEQUIN_LABEL_BASE_HEIGHT,
  ROLE_COLOR_SEQUENCE,
} from './scene3dConstants'
import { vectorFromArray, vectorToArray } from './scene3dMath'

export function roleColorForIndex(index: number): string {
  return ROLE_COLOR_SEQUENCE[index % ROLE_COLOR_SEQUENCE.length]
}

export function clampCrowdOptions(options: CrowdAddOptions): CrowdAddOptions {
  return {
    rows: Math.min(CROWD_MAX_AXIS, Math.max(1, Math.round(options.rows))),
    columns: Math.min(CROWD_MAX_AXIS, Math.max(1, Math.round(options.columns))),
    spacing: Math.min(10, Math.max(0.2, Number(options.spacing.toFixed(2)))),
  }
}

export function crowdRows(object: Scene3DObject): number {
  return Math.min(CROWD_MAX_AXIS, Math.max(1, Math.round(object.crowdRows || 1)))
}

export function crowdColumns(object: Scene3DObject): number {
  return Math.min(CROWD_MAX_AXIS, Math.max(1, Math.round(object.crowdColumns || 1)))
}

export function crowdSpacing(object: Scene3DObject): number {
  return Math.min(10, Math.max(0.2, object.crowdSpacing || 1.2))
}

export function crowdCount(object: Scene3DObject): number {
  return object.type === 'mannequinCrowd' ? crowdRows(object) * crowdColumns(object) : 1
}

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

export function mannequinRoleLabel(index: number): string {
  if (index < 26) return `角色${String.fromCharCode(65 + index)}`
  return `角色A${index - 25}`
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
  if (object.type === 'model' || object.type === 'group') return { width: 1 * scaleX, depth: 1 * scaleZ }
  if (object.geometry === 'sphere') return { width: 1.1 * scaleX, depth: 1.1 * scaleZ }
  if (object.geometry === 'cylinder') return { width: 0.92 * scaleX, depth: 0.92 * scaleZ }
  if (object.geometry === 'plane') return { width: scaleX, depth: scaleY }
  return { width: scaleX, depth: scaleZ }
}

export function objectVisualHalfHeight(object: Scene3DObject, scale: Scene3DVector3 = object.scale): number {
  const scaleY = Math.max(0.08, Math.abs(scale[1] || 1))
  if (object.type === 'light') return 0.12 * scaleY
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
