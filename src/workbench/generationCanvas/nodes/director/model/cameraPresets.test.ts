import { describe, expect, it } from 'vitest'
import { CAMERA_PRESETS, buildCameraFromPreset } from './cameraPresets'

describe('cameraPresets', () => {
  it('ships all 14 presets', () => {
    expect(CAMERA_PRESETS.map((preset) => preset.id)).toEqual([
      'current', 'front_medium', 'front_closeup', 'front_wide', 'side_follow', 'side_closeup', 'back_medium',
      'high_wide', 'high_40', 'low_angle', 'low_wide', 'ots_left', 'ots_right', 'birds_eye',
    ])
  })

  it('front_closeup relative to a subject at (2,0,3) facing +X lands on its +X side looking at its face', () => {
    const preset = CAMERA_PRESETS.find((item) => item.id === 'front_closeup')!
    const camera = buildCameraFromPreset({
      preset,
      id: 'cam',
      name: '机位 1',
      subject: { position: { x: 2, y: 0, z: 3 }, rotation: { x: 0, y: 90, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    })
    expect(camera.position.x).toBeCloseTo(3.2)
    expect(camera.position.y).toBeCloseTo(1.6)
    expect(camera.position.z).toBeCloseTo(3)
    // 预设只给位姿，不挂看向字段
    expect(camera.lookAtType).toBeUndefined()
    expect(camera.lookAtCoords).toBeUndefined()
    expect(camera.yaw).toBeCloseTo(270)
    expect(camera.fov).toBe(35)
    expect(camera.focalLengthMm).toBeCloseTo(38.1, 0)
  })

  it('without a subject the preset is placed around the world origin', () => {
    const preset = CAMERA_PRESETS.find((item) => item.id === 'birds_eye')!
    const camera = buildCameraFromPreset({ preset, id: 'cam', name: 'x' })
    expect(camera.position).toEqual({ x: 0, y: 8, z: 0.1 })
    expect(camera.pitch).toBeGreaterThan(85)
    expect(camera.fov).toBe(60)
  })

  it('"current" freezes the free camera pose and rounds its fov', () => {
    const camera = buildCameraFromPreset({
      preset: CAMERA_PRESETS[0],
      id: 'cam',
      name: 'x',
      currentView: { position: { x: 1, y: 2, z: 3 }, yaw: 12.5, pitch: -3, roll: 0, fov: 33.4 },
    })
    expect(camera.position).toEqual({ x: 1, y: 2, z: 3 })
    expect(camera.yaw).toBe(12.5)
    expect(camera.fov).toBe(33)
    expect(camera.lookAtType).toBeUndefined()
  })
})
