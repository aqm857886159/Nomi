import { describe, expect, it } from 'vitest'
import { FOCAL_MM_MAX, FOCAL_MM_MIN, LENS_PRESETS, focalMmToFov, fovToFocalMm, syncFocalLength } from './cameraLens'

// 35mm 全幅等效、片高 24mm：fov = 2·atan(12 / mm)（three 的 fov 是竖直向）
const RAD_TO_DEG = 180 / Math.PI
const referenceFov = (mm: number) => 2 * Math.atan(12 / mm) * RAD_TO_DEG
const referenceMm = (fov: number) => Math.round(12 / Math.tan((fov / 2) / RAD_TO_DEG))

describe('cameraLens', () => {
  it('uses the 24mm sensor formula inside the 12–200mm range', () => {
    for (const mm of [12, 24, 35, 50, 85, 135, 200]) {
      expect(focalMmToFov(mm)).toBeCloseTo(referenceFov(mm), 1)
    }
    for (const fov of [10, 27, 45, 60, 90]) {
      expect(Math.round(fovToFocalMm(fov))).toBe(referenceMm(fov))
    }
  })

  it('extends the range to 300mm without changing V1', () => {
    expect(FOCAL_MM_MIN).toBe(12)
    expect(FOCAL_MM_MAX).toBe(300)
    expect(focalMmToFov(300)).toBeCloseTo(4.58, 1)
    expect(fovToFocalMm(1)).toBe(300)
  })

  it('round-trips presets without drifting a step', () => {
    for (const preset of LENS_PRESETS) {
      expect(Math.round(fovToFocalMm(focalMmToFov(preset.mm)))).toBe(preset.mm)
    }
  })

  it('syncFocalLength keeps fov as the truth and repairs missing values', () => {
    const camera = syncFocalLength({ fov: 45, focalLengthMm: 999 })
    expect(camera.fov).toBe(45)
    expect(camera.focalLengthMm).toBeCloseTo(29, 0)
    const broken = syncFocalLength({ fov: Number.NaN, focalLengthMm: 0 })
    expect(broken.fov).toBe(50)
  })
})
