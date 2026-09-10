import { describe, expect, it } from 'vitest'
import { dollyZoomCompensatedFov, dollyZoomDistanceScale, zoomFovRamp } from './cameraMoveFovMath'

describe('zoomFovRamp · 变焦 FOV 数学', () => {
  it('变焦推收窄、变焦拉放宽、非变焦运镜返回 null', () => {
    expect(zoomFovRamp('zoom_in', 40, 1)!.fovTo).toBeLessThan(40)
    expect(zoomFovRamp('zoom_out', 40, 1)!.fovTo).toBeGreaterThan(40)
    expect(zoomFovRamp('push_in', 40, 1)).toBeNull()
    expect(zoomFovRamp('orbit_left', 40, 1)).toBeNull()
  })

  it('希区柯克恒等式：tan(fov0/2)·d0 = tan(fov1/2)·d1（主体成像高度不变）', () => {
    const DEG = Math.PI / 180
    const base = 40
    const scale = dollyZoomDistanceScale(1)
    const compensated = dollyZoomCompensatedFov(base, scale)
    expect(Math.tan((base / 2) * DEG) * 1).toBeCloseTo(Math.tan((compensated / 2) * DEG) * scale, 3)
    expect(zoomFovRamp('dolly_zoom', base, 1)!.fovTo).toBeCloseTo(compensated, 5)
  })

  it('fov 两端 clamp 在 6-120', () => {
    expect(zoomFovRamp('zoom_out', 100, 1)!.fovTo).toBe(120)
    expect(zoomFovRamp('zoom_in', 8, 1)!.fovTo).toBe(6)
  })
})
