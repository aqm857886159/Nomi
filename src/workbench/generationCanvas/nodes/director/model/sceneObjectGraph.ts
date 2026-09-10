/**
 * [INPUT]: directorTypes 的对象/场景配置与 vec3 的 XYZ 矩阵数学。
 * [OUTPUT]: 局部/世界仿射变换（可注入每个祖先的实时局部位姿）、完整子树选择与保留路标的重新挂载。
 * [POS]: 分组、跨层、创建落点共用的纯坐标边界，不依赖渲染引擎。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md。
 */
import type { DirectorObject, DirectorScene, Vec3 } from './directorTypes'
import { add, applyMat3, eulerXYZToMatrix, RAD_TO_DEG, type Mat3, type Transform } from './vec3'

export type SceneFrame = { basis: Mat3; position: Vec3 }
const identity = (): SceneFrame => ({ basis: [1, 0, 0, 0, 1, 0, 0, 0, 1], position: { x: 0, y: 0, z: 0 } })

export function localFrame(transform: Transform): SceneFrame {
  const basis = eulerXYZToMatrix(transform.rotation)
  const scale = [transform.scale.x, transform.scale.y, transform.scale.z]
  return { basis: basis.map((value, i) => value * scale[i % 3]) as Mat3, position: { ...transform.position } }
}

export function sceneFrame(config: DirectorScene['sceneConfig']): SceneFrame {
  return localFrame({ ...config, scale: { x: config.scale, y: config.scale, z: config.scale } })
}

export function transformPoint(frame: SceneFrame, point: Vec3): Vec3 {
  return add(applyMat3(frame.basis, point), frame.position)
}

export function multiplyFrames(a: SceneFrame, b: SceneFrame): SceneFrame {
  const basis = new Array<number>(9).fill(0) as Mat3
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    for (let k = 0; k < 3; k++) basis[row * 3 + col] += a.basis[row * 3 + k] * b.basis[k * 3 + col]
  }
  return { basis, position: transformPoint(a, b.position) }
}

function determinant(m: Mat3): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
}

export function invertFrame(frame: SceneFrame): SceneFrame {
  const m = frame.basis, det = determinant(m)
  if (Math.abs(det) < 1e-12) throw new Error('Cannot invert a zero-scale scene transform')
  const basis = [
    m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
    m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
    m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3],
  ].map(value => value / det) as Mat3
  return { basis, position: applyMat3(basis, { x: -frame.position.x, y: -frame.position.y, z: -frame.position.z }) }
}

// 与 Three XYZ 分解同约定。非均匀缩放叠加旋转会产生 TRS 无法精确表达的剪切。
export function frameTransform(frame: SceneFrame): Transform {
  const m = frame.basis
  const sx = Math.hypot(m[0], m[3], m[6]) * (determinant(m) < 0 ? -1 : 1)
  const sy = Math.hypot(m[1], m[4], m[7]), sz = Math.hypot(m[2], m[5], m[8])
  const r = m.map((value, i) => value / ([sx, sy, sz][i % 3] || 1))
  const y = Math.asin(Math.max(-1, Math.min(1, r[2])))
  const x = Math.abs(r[2]) < 0.9999999 ? Math.atan2(-r[5], r[8]) : Math.atan2(r[7], r[4])
  const z = Math.abs(r[2]) < 0.9999999 ? Math.atan2(-r[1], r[0]) : 0
  return { position: { ...frame.position }, rotation: { x: x * RAD_TO_DEG, y: y * RAD_TO_DEG, z: z * RAD_TO_DEG }, scale: { x: sx, y: sy, z: sz } }
}

export function objectWorldFrame(objects: readonly DirectorObject[], objectId?: string, readTransform: (object: DirectorObject) => Transform = (object) => object): SceneFrame {
  const byId = new Map(objects.map(object => [object.id, object]))
  const chain: DirectorObject[] = [], seen = new Set<string>()
  let object = objectId ? byId.get(objectId) : undefined
  while (object && !seen.has(object.id)) {
    chain.unshift(object)
    seen.add(object.id)
    object = object.parentId ? byId.get(object.parentId) : undefined
  }
  return chain.reduce((frame, item) => multiplyFrames(frame, localFrame(readTransform(item))), identity())
}

export function subtreeIds(objects: readonly DirectorObject[], roots: readonly string[]): Set<string> {
  const result = new Set(roots)
  let changed = true
  while (changed) {
    changed = false
    for (const object of objects) if (object.parentId && result.has(object.parentId) && !result.has(object.id)) {
      result.add(object.id)
      changed = true
    }
  }
  return result
}

export function selectedRoots(objects: readonly DirectorObject[], ids: readonly string[]): DirectorObject[] {
  const selected = new Set(ids), byId = new Map(objects.map(object => [object.id, object]))
  return objects.filter(object => {
    if (!selected.has(object.id)) return false
    const seen = new Set([object.id])
    let parent = object.parentId ? byId.get(object.parentId) : undefined
    while (parent && !seen.has(parent.id)) {
      if (selected.has(parent.id)) return false
      seen.add(parent.id)
      parent = parent.parentId ? byId.get(parent.parentId) : undefined
    }
    return true
  })
}

/** 映射旧父空间到新父空间；rest 与每个路标一起变换，播放不会跳回旧坐标。 */
export function transformObject(object: DirectorObject, parentChange: SceneFrame): void {
  Object.assign(object, frameTransform(multiplyFrames(parentChange, localFrame(object))))
  for (const point of object.motionTrajectory ?? []) {
    const transform = frameTransform(multiplyFrames(parentChange, localFrame({
      position: { x: point.x, y: point.y, z: point.z }, rotation: { x: point.pitch, y: point.yaw, z: point.roll }, scale: { x: 1, y: 1, z: 1 },
    })))
    point.x = transform.position.x; point.y = transform.position.y; point.z = transform.position.z
    point.pitch = transform.rotation.x; point.yaw = transform.rotation.y; point.roll = transform.rotation.z
  }
}
