/**
 * [INPUT]: 依赖 ./directorTypes 的 Vec3
 * [OUTPUT]: 对外提供 vec3 纯数学：add/sub/scale/length/distance/normalize、degToRad/radToDeg、
 *           lookAtAngles（位置+目标 → yaw/pitch/roll）、forwardFromAngles、eulerXYZToMatrix、applyTransform、
 *           rotateY、wrapDeg、clampPitch
 * [POS]: director/model 的零依赖向量层（不引 three，保证纯层可在 node 单测里跑）。
 *        角度约定：yaw 从 +Z 向 +X 转（度），pitch 正值为俯视，roll 绕视线；相机欧拉序 YXZ。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { Vec3 } from './directorTypes'

export const DEG_TO_RAD = Math.PI / 180
export const RAD_TO_DEG = 180 / Math.PI

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z }
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

export function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s }
}

export function length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z)
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
}

export function normalize(a: Vec3): Vec3 {
  const len = length(a)
  return len > 1e-9 ? scale(a, 1 / len) : vec3()
}

export function wrapDeg(deg: number): number {
  return ((deg % 360) + 360) % 360
}

// 角度差归到 (-180, 180]：算「相对转角」必须用它，wrapDeg 的 0–360 会把左转 82° 算成 278°（2026-09-02 视线不转头栽过）
export function signedDeg(deg: number): number {
  const wrapped = wrapDeg(deg)
  return wrapped > 180 ? wrapped - 360 : wrapped
}

export function clampPitch(deg: number, limit: number = 89): number {
  return Math.max(-limit, Math.min(limit, deg))
}

// 相机在 position 看向 target 时的 yaw/pitch（度，roll=0）。yaw=0 朝 +Z，pitch>0 俯视。
export function lookAtAngles(position: Vec3, target: Vec3): { yaw: number; pitch: number; roll: number } {
  const d = sub(target, position)
  const horizontal = Math.hypot(d.x, d.z)
  const yaw = wrapDeg(Math.atan2(d.x, d.z) * RAD_TO_DEG)
  const pitch = horizontal < 1e-9 && Math.abs(d.y) < 1e-9 ? 0 : -Math.atan2(d.y, horizontal) * RAD_TO_DEG
  return { yaw: Number(yaw.toFixed(2)), pitch: Number(clampPitch(pitch, 90).toFixed(2)), roll: 0 }
}

// yaw/pitch → 单位前向量（与 lookAtAngles 互逆）
export function forwardFromAngles(yawDeg: number, pitchDeg: number): Vec3 {
  const yaw = yawDeg * DEG_TO_RAD
  const pitch = pitchDeg * DEG_TO_RAD
  return { x: Math.cos(pitch) * Math.sin(yaw), y: -Math.sin(pitch), z: Math.cos(pitch) * Math.cos(yaw) }
}

// 绕 Y 轴旋转（度）：(x, z) 平面上的旋转（正角把 +Z 转向 +X）
export function rotateY(v: Vec3, deg: number): Vec3 {
  const r = deg * DEG_TO_RAD
  const c = Math.cos(r)
  const s = Math.sin(r)
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c }
}

export type Mat3 = [number, number, number, number, number, number, number, number, number]

// three.js Euler 'XYZ'（度）→ 旋转矩阵 R = Rx · Ry · Rz（行主序 3×3）
export function eulerXYZToMatrix(rotationDeg: Vec3): Mat3 {
  const a = rotationDeg.x * DEG_TO_RAD
  const b = rotationDeg.y * DEG_TO_RAD
  const c = rotationDeg.z * DEG_TO_RAD
  const ca = Math.cos(a), sa = Math.sin(a)
  const cb = Math.cos(b), sb = Math.sin(b)
  const cc = Math.cos(c), sc = Math.sin(c)
  // 与 three Matrix4.makeRotationFromEuler('XYZ') 同式
  return [
    cb * cc, -cb * sc, sb,
    ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb,
    sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb,
  ]
}

export function applyMat3(m: Mat3, v: Vec3): Vec3 {
  return {
    x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
    y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
    z: m[6] * v.x + m[7] * v.y + m[8] * v.z,
  }
}

export type Transform = { position: Vec3; rotation: Vec3; scale: Vec3 }

// 把局部坐标点按 (scale → rotation XYZ → position) 变到父空间（等价 three Matrix4.compose 后 applyMatrix4）
export function applyTransform(local: Vec3, transform: Transform): Vec3 {
  const scaled = { x: local.x * transform.scale.x, y: local.y * transform.scale.y, z: local.z * transform.scale.z }
  const rotated = applyMat3(eulerXYZToMatrix(transform.rotation), scaled)
  return add(rotated, transform.position)
}

export function round(v: Vec3, digits: number = 4): Vec3 {
  const f = 10 ** digits
  return { x: Math.round(v.x * f) / f, y: Math.round(v.y * f) / f, z: Math.round(v.z * f) / f }
}
