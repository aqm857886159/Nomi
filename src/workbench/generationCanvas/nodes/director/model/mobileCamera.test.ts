import { describe, expect, it } from 'vitest'
import { focalMmToFov } from './cameraLens'
import { applyMobilePacket, decodeMobilePacket, encodeMobilePacket, mobilePacketFromValues, MOBILE_PACKET_BYTES, spatialFromMobilePose, type MobilePacket } from './mobileCamera'

const ZERO: MobilePacket = { moveX: 0, moveZ: 0, elevation: 0, dPitch: 0, dYaw: 0, dRoll: 0, focalLengthMm: 0, resetPose: 0 }
const POSE = { position: { x: 0, y: 1.5, z: 0 }, yaw: 0, pitch: 0, roll: 5, fov: 50 }

describe('mobileCamera 包编解码', () => {
  it('32 字节小端 Float32 往返', () => {
    const packet: MobilePacket = { ...ZERO, moveX: 0.5, dYaw: -1.25, focalLengthMm: 35, resetPose: 1 }
    const buffer = encodeMobilePacket(packet)
    expect(buffer.byteLength).toBe(MOBILE_PACKET_BYTES)
    expect(decodeMobilePacket(buffer)).toEqual(packet)
  })
  it('不足 32 字节返回 null，NaN 归零', () => {
    expect(decodeMobilePacket(new ArrayBuffer(8))).toBeNull()
    const buffer = encodeMobilePacket(ZERO)
    new DataView(buffer).setFloat32(0, Number.NaN, true)
    expect(decodeMobilePacket(buffer)?.moveX).toBe(0)
  })
  it('values 数组与空间位姿转换', () => {
    expect(mobilePacketFromValues([0.5, -1, 0.25, 1, 2, 3, 35, 1])).toEqual({
      moveX: 0.5, moveZ: -1, elevation: 0.25, dPitch: 1, dYaw: 2, dRoll: 3, focalLengthMm: 35, resetPose: 1,
    })
    expect(mobilePacketFromValues([1, 2])).toBeNull()
    expect(spatialFromMobilePose({ position: { x: 1, y: 2, z: 3 }, yaw: 10, pitch: -4, roll: 2, fov: 50 })).toEqual({
      position: { x: 1, y: 2, z: 3 }, rotation: { x: -4, y: 10, z: 2 }, fov: 50,
    })
  })
})

describe('applyMobilePacket', () => {
  it('摇杆前推沿机位朝向走 2m/s；yaw 90° 时前 = +X', () => {
    const forward = applyMobilePacket(POSE, { ...ZERO, moveZ: 1 }, 0.25)
    expect(forward.position.z).toBeCloseTo(0.5)
    const turned = applyMobilePacket({ ...POSE, yaw: 90 }, { ...ZERO, moveZ: 1 }, 0.25)
    expect(turned.position.x).toBeCloseTo(0.5)
    expect(turned.position.z).toBeCloseTo(0)
  })
  it('升降 1.5m/s，dt 夹到 0.25s 防掉帧跳变', () => {
    expect(applyMobilePacket(POSE, { ...ZERO, elevation: 1 }, 1).position.y).toBeCloseTo(1.5 + 1.5 * 0.25)
  })
  it('陀螺仪增量累加，pitch 夹 ±89，复位横滚归零', () => {
    const next = applyMobilePacket(POSE, { ...ZERO, dYaw: 10, dPitch: 100, dRoll: 3 }, 0.016)
    expect(next.yaw).toBe(10)
    expect(next.pitch).toBe(89)
    expect(next.roll).toBe(8)
    expect(applyMobilePacket(POSE, { ...ZERO, resetPose: 1, dRoll: 3 }, 0.016).roll).toBe(0)
  })
  it('焦距 > 0 才改 fov，按镜头换算', () => {
    expect(applyMobilePacket(POSE, ZERO, 0.016).fov).toBe(50)
    expect(applyMobilePacket(POSE, { ...ZERO, focalLengthMm: 85 }, 0.016).fov).toBeCloseTo(focalMmToFov(85))
  })
})
