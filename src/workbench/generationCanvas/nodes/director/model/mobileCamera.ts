/**
 * [INPUT]: 依赖 ./directorTypes 的 Vec3、./vec3 的 DEG_TO_RAD、./cameraLens 的 clampFocalMm / focalMmToFov
 * [OUTPUT]: 对外提供 MobilePacket、MOBILE_PACKET_BYTES、decodeMobilePacket / encodeMobilePacket / mobilePacketFromValues、MobileCameraSpeeds、DEFAULT_MOBILE_SPEEDS、applyMobilePacket、MobileCameraPose、spatialFromMobilePose
 * [POS]: director/model 的手机虚拟相机纯数学（32 字节 Float32 包 `[moveX, moveZ, elevation, dPitch, dYaw, dRoll, focalLengthMm, resetPose]`）：
 *        手机 = 物理云台——陀螺仪给 pan/tilt/roll 增量（度），摇杆给机位水平位移（相机 yaw 系下，米/秒 × dt），升降条给高度，滑块给焦距；
 *        编解码与积分都是纯函数，electron 桥、渲染层、单测共用同一份。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { clampFocalMm, focalMmToFov } from './cameraLens'
import type { Vec3 } from './directorTypes'
import { DEG_TO_RAD } from './vec3'

export const MOBILE_PACKET_FLOATS = 8
export const MOBILE_PACKET_BYTES = MOBILE_PACKET_FLOATS * 4

export type MobilePacket = {
  // 摇杆：-1..1（右 / 前为正）
  moveX: number
  moveZ: number
  // 升降条：-1..1（上为正）
  elevation: number
  // 陀螺仪增量（度）
  dPitch: number
  dYaw: number
  dRoll: number
  // 焦距（mm）；≤0 = 不改
  focalLengthMm: number
  // 1 = 复位横滚
  resetPose: number
}

export function decodeMobilePacket(buffer: ArrayBuffer | Uint8Array): MobilePacket | null {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  if (bytes.byteLength < MOBILE_PACKET_BYTES) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, MOBILE_PACKET_BYTES)
  const read = (index: number) => {
    const value = view.getFloat32(index * 4, true)
    return Number.isFinite(value) ? value : 0
  }
  return { moveX: read(0), moveZ: read(1), elevation: read(2), dPitch: read(3), dYaw: read(4), dRoll: read(5), focalLengthMm: read(6), resetPose: read(7) }
}

export function encodeMobilePacket(packet: MobilePacket): ArrayBuffer {
  const buffer = new ArrayBuffer(MOBILE_PACKET_BYTES)
  const view = new DataView(buffer)
  const values = [packet.moveX, packet.moveZ, packet.elevation, packet.dPitch, packet.dYaw, packet.dRoll, packet.focalLengthMm, packet.resetPose]
  values.forEach((value, index) => view.setFloat32(index * 4, value, true))
  return buffer
}

export function mobilePacketFromValues(values: number[]): MobilePacket | null {
  if (values.length < MOBILE_PACKET_FLOATS) return null
  const num = (index: number) => {
    const value = values[index]
    return Number.isFinite(value) ? value : 0
  }
  return {
    moveX: num(0),
    moveZ: num(1),
    elevation: num(2),
    dPitch: num(3),
    dYaw: num(4),
    dRoll: num(5),
    focalLengthMm: num(6),
    resetPose: num(7),
  }
}

export function spatialFromMobilePose(pose: MobileCameraPose): { position: Vec3; rotation: Vec3; fov: number } {
  return { position: pose.position, rotation: { x: pose.pitch, y: pose.yaw, z: pose.roll }, fov: pose.fov }
}

export type MobileCameraSpeeds = { moveMetersPerSecond: number; elevationMetersPerSecond: number }
// 平移 2m/s、升降 1.5m/s（本地持久）
export const DEFAULT_MOBILE_SPEEDS: MobileCameraSpeeds = { moveMetersPerSecond: 2, elevationMetersPerSecond: 1.5 }

export type MobileCameraPose = { position: Vec3; yaw: number; pitch: number; roll: number; fov: number }

const PITCH_LIMIT = 89

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function clampStick(value: number): number {
  return clamp(value, -1, 1)
}

// 一包 → 新位姿：位移在机位 yaw 系（yaw 从 +Z 起，与 lookAtAngles 同约定：forward = (sin yaw, 0, cos yaw)）；角度直接累加，pitch 夹 ±89，roll 复位归零
export function applyMobilePacket(pose: MobileCameraPose, packet: MobilePacket, dtSeconds: number, speeds: MobileCameraSpeeds = DEFAULT_MOBILE_SPEEDS): MobileCameraPose {
  const dt = clamp(dtSeconds, 0, 0.25)
  const yawRad = pose.yaw * DEG_TO_RAD
  const forward = { x: Math.sin(yawRad), z: Math.cos(yawRad) }
  const right = { x: Math.cos(yawRad), z: -Math.sin(yawRad) }
  const moveX = clampStick(packet.moveX) * speeds.moveMetersPerSecond * dt
  const moveZ = clampStick(packet.moveZ) * speeds.moveMetersPerSecond * dt
  const lift = clampStick(packet.elevation) * speeds.elevationMetersPerSecond * dt
  const position = {
    x: pose.position.x + forward.x * moveZ + right.x * moveX,
    y: pose.position.y + lift,
    z: pose.position.z + forward.z * moveZ + right.z * moveX,
  }
  const yaw = pose.yaw + packet.dYaw
  const pitch = clamp(pose.pitch + packet.dPitch, -PITCH_LIMIT, PITCH_LIMIT)
  const roll = packet.resetPose >= 0.5 ? 0 : pose.roll + packet.dRoll
  const fov = packet.focalLengthMm > 0 ? focalMmToFov(clampFocalMm(packet.focalLengthMm)) : pose.fov
  return { position, yaw, pitch, roll, fov }
}
