import { describe, it, expect } from 'vitest'
import { buildCameraMoveScene } from './cameraMoveBuilder'
import { cameraWithPlaybackPosition } from './scene3dPlayback'
import { CAMERA_SPEED_DURATION } from './cameraMoveVocab'
import type { Scene3DState, Scene3DVector3 } from './scene3dTypes'

// 主体在原点。相机到主体的水平距离（XZ 平面），运镜几何用这个判断推/拉/环绕半径。
function distXZ(p: Scene3DVector3): number {
  return Math.hypot(p[0], p[2])
}

// 相机绕 Y 的方位角（度）：0 = +Z 方向。用来判断环绕扫过的角度与方向。
function azimuthDeg(p: Scene3DVector3): number {
  return (Math.atan2(p[0], p[2]) * 180) / Math.PI
}

// 在轨迹起点(t=0)与终点(t=duration)采样真实相机位姿。
function sample(state: Scene3DState, t: number): Scene3DVector3 {
  return cameraWithPlaybackPosition(state, state.cameras[0], t).position
}

function startEnd(state: Scene3DState): { start: Scene3DVector3; end: Scene3DVector3; duration: number } {
  const duration = state.sceneTimeline.totalDuration
  return { start: sample(state, 0), end: sample(state, duration), duration }
}

describe('buildCameraMoveScene', () => {
  it('push_in: 终点比起点离主体更近', () => {
    const { start, end } = startEnd(buildCameraMoveScene({ move: 'push_in' }))
    expect(distXZ(end)).toBeLessThan(distXZ(start))
  })

  it('pull_out: 终点比起点离主体更远', () => {
    const { start, end } = startEnd(buildCameraMoveScene({ move: 'pull_out' }))
    expect(distXZ(end)).toBeGreaterThan(distXZ(start))
  })

  it('orbit_left / orbit_right: 半径守恒且方位角大幅扫过，方向相反', () => {
    const left = startEnd(buildCameraMoveScene({ move: 'orbit_left' }))
    const right = startEnd(buildCameraMoveScene({ move: 'orbit_right' }))
    // 半径（到主体距离）起终点近似相等 ≈ d
    expect(distXZ(left.end)).toBeCloseTo(distXZ(left.start), 1)
    expect(distXZ(right.end)).toBeCloseTo(distXZ(right.start), 1)
    // 大幅扫过：方位角变化显著
    const leftDelta = azimuthDeg(left.end) - azimuthDeg(left.start)
    const rightDelta = azimuthDeg(right.end) - azimuthDeg(right.start)
    expect(Math.abs(leftDelta)).toBeGreaterThan(60)
    expect(Math.abs(rightDelta)).toBeGreaterThan(60)
    // 方向相反：扫过符号相反
    expect(Math.sign(leftDelta)).toBe(-Math.sign(rightDelta))
  })

  it('arc_left / arc_right: 小角度弧线，方向相反', () => {
    const left = startEnd(buildCameraMoveScene({ move: 'arc_left' }))
    const right = startEnd(buildCameraMoveScene({ move: 'arc_right' }))
    const leftDelta = azimuthDeg(left.end) - azimuthDeg(left.start)
    const rightDelta = azimuthDeg(right.end) - azimuthDeg(right.start)
    expect(Math.abs(leftDelta)).toBeGreaterThan(10)
    expect(Math.sign(leftDelta)).toBe(-Math.sign(rightDelta))
  })

  it('crane_up: 终点高于起点；crane_down: 终点低于起点', () => {
    const up = startEnd(buildCameraMoveScene({ move: 'crane_up' }))
    expect(up.end[1]).toBeGreaterThan(up.start[1])
    const down = startEnd(buildCameraMoveScene({ move: 'crane_down' }))
    expect(down.end[1]).toBeLessThan(down.start[1])
  })

  it('track_left: 终点 X 更小；track_right: 终点 X 更大', () => {
    const left = startEnd(buildCameraMoveScene({ move: 'track_left' }))
    expect(left.end[0]).toBeLessThan(left.start[0])
    const right = startEnd(buildCameraMoveScene({ move: 'track_right' }))
    expect(right.end[0]).toBeGreaterThan(right.start[0])
  })

  it('每个运镜：绑定引用相机、followTarget 指向主体、时长按速度', () => {
    const speeds: Array<['slow' | 'medium' | 'fast', number]> = [
      ['slow', CAMERA_SPEED_DURATION.slow],
      ['medium', CAMERA_SPEED_DURATION.medium],
      ['fast', CAMERA_SPEED_DURATION.fast],
    ]
    for (const [speed, duration] of speeds) {
      const state = buildCameraMoveScene({ move: 'orbit_left', speed })
      const camera = state.cameras[0]
      const subject = state.objects[0]
      const binding = state.trajectoryBindings[0]
      expect(binding.objects[0].objectId).toBe(camera.id)
      expect(binding.trajectoryId).toBe(state.trajectories[0].id)
      expect(camera.followTargetId).toBe(subject.id)
      expect(state.sceneTimeline.totalDuration).toBe(duration)
      expect(binding.endTime).toBe(duration)
    }
  })

  it('主体是落地的 mannequin，相机起点 = 轨迹首点', () => {
    const state = buildCameraMoveScene({ move: 'push_in' })
    expect(state.objects[0].type).toBe('mannequin')
    expect(state.objects[0].position[1]).toBeCloseTo(1.25, 5)
    const firstPoint = state.trajectories[0].points[0].position
    expect(state.cameras[0].position).toEqual(firstPoint)
  })
})
