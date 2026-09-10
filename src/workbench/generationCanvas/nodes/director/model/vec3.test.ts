import { describe, expect, it } from 'vitest'
import { applyTransform, eulerXYZToMatrix, forwardFromAngles, lookAtAngles, rotateY, wrapDeg } from './vec3'

describe('vec3', () => {
  it('lookAtAngles: +Z is yaw 0, +X is yaw 90, looking down gives positive pitch', () => {
    expect(lookAtAngles({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 5 })).toEqual({ yaw: 0, pitch: 0, roll: 0 })
    expect(lookAtAngles({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }).yaw).toBe(90)
    expect(lookAtAngles({ x: 0, y: 3, z: 0 }, { x: 0, y: 0, z: 3 }).pitch).toBe(45)
    expect(lookAtAngles({ x: 0, y: 5, z: 0 }, { x: 0, y: 0, z: 0 }).pitch).toBe(90)
  })

  it('forwardFromAngles inverts lookAtAngles', () => {
    const angles = lookAtAngles({ x: 1, y: 2, z: 3 }, { x: 4, y: 1, z: -2 })
    const forward = forwardFromAngles(angles.yaw, angles.pitch)
    const expected = { x: 3, y: -1, z: -5 }
    const len = Math.hypot(expected.x, expected.y, expected.z)
    expect(forward.x).toBeCloseTo(expected.x / len, 3)
    expect(forward.y).toBeCloseTo(expected.y / len, 3)
    expect(forward.z).toBeCloseTo(expected.z / len, 3)
  })

  it('rotateY turns +Z toward +X for positive angles and wraps degrees', () => {
    const r = rotateY({ x: 0, y: 0, z: 1 }, 90)
    expect(r.x).toBeCloseTo(1)
    expect(r.z).toBeCloseTo(0)
    expect(wrapDeg(-30)).toBe(330)
    expect(wrapDeg(725)).toBe(5)
  })

  it('eulerXYZToMatrix matches three.js XYZ order (Ry 90° maps +Z to +X)', () => {
    const m = eulerXYZToMatrix({ x: 0, y: 90, z: 0 })
    const v = applyTransform({ x: 0, y: 0, z: 1 }, { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 90, z: 0 }, scale: { x: 1, y: 1, z: 1 } })
    expect(m[2]).toBeCloseTo(1)
    expect(v.x).toBeCloseTo(1)
    expect(v.z).toBeCloseTo(0)
  })

  it('applyTransform scales, rotates, then translates', () => {
    const out = applyTransform(
      { x: 1, y: 0, z: 0 },
      { position: { x: 10, y: 0, z: 0 }, rotation: { x: 0, y: 90, z: 0 }, scale: { x: 2, y: 2, z: 2 } },
    )
    expect(out.x).toBeCloseTo(10)
    expect(out.z).toBeCloseTo(-2)
  })
})
