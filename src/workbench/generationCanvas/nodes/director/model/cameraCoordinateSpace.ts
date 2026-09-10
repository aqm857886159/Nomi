/**
 * [INPUT]: sceneObjectGraph 的纯矩阵组合、cameraPresets 的 CurrentViewPose、vec3 的度/弧度换算。
 * [OUTPUT]: transformCameraPose：跨坐标空间转换相机逻辑位姿，保留 YXZ 朝向与逻辑 FOV。
 * [POS]: POV、手机、录制、截图和跨场景搬移共用的相机世界/局部边界；不包含 three 相机的 -Z 翻转。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md。
 */
import type { CurrentViewPose } from './cameraPresets'
import { multiplyFrames, type SceneFrame } from './sceneObjectGraph'
import { DEG_TO_RAD, RAD_TO_DEG, wrapDeg } from './vec3'

export function transformCameraPose(pose: CurrentViewPose, frame: SceneFrame): CurrentViewPose {
  const x = pose.pitch * DEG_TO_RAD, y = pose.yaw * DEG_TO_RAD, z = pose.roll * DEG_TO_RAD
  const sx = Math.sin(x), cx = Math.cos(x), sy = Math.sin(y), cy = Math.cos(y), sz = Math.sin(z), cz = Math.cos(z)
  const result = multiplyFrames(frame, { position: pose.position, basis: [
    cy * cz + sy * sx * sz, -cy * sz + sy * sx * cz, sy * cx,
    cx * sz, cx * cz, -sx,
    -sy * cz + cy * sx * sz, sy * sz + cy * sx * cz, cy * cx,
  ] })
  // 场景缩放不改变镜头方向；先逐列归一化，再按 YXZ 反解（含俯仰 ±90° 的万向锁分支）。
  const m = result.basis
  const scale = [Math.hypot(m[0], m[3], m[6]), Math.hypot(m[1], m[4], m[7]), Math.hypot(m[2], m[5], m[8])]
  if (scale.some((value) => value < 1e-12)) throw new Error('Cannot transform a camera through a zero-scale frame')
  const r = m.map((value, i) => value / scale[i % 3])
  const pitch = Math.asin(-Math.max(-1, Math.min(1, r[5])))
  const ordinary = Math.abs(r[5]) < 0.9999999
  const yaw = ordinary ? Math.atan2(r[2], r[8]) : Math.atan2(-r[6], r[0])
  const roll = ordinary ? Math.atan2(r[3], r[4]) : 0
  return { position: result.position, pitch: pitch * RAD_TO_DEG, yaw: wrapDeg(yaw * RAD_TO_DEG), roll: roll * RAD_TO_DEG, fov: pose.fov }
}
