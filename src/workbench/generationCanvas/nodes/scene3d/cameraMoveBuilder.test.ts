import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildCameraMoveScene } from './cameraMoveBuilder'
import { cameraWithPlaybackPosition } from './scene3dPlayback'
import { CAMERA_SPEED_DURATION, CAMERA_MOVE_FRAMING, CAMERA_MOVES } from './cameraMoveVocab'
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
    // 大幅扫过 + 方向相反：在轨迹中点（≈150°，远离 atan2 在 ±180° 的环绕处）取方位角判断，
    // 不在终点（300° 会被 atan2 折回 -60°，恰落在阈值边界 → float 抖动 flaky）。
    const leftMidAz = azimuthDeg(sample(buildCameraMoveScene({ move: 'orbit_left' }), left.duration / 2))
    const rightMidAz = azimuthDeg(sample(buildCameraMoveScene({ move: 'orbit_right' }), right.duration / 2))
    expect(Math.abs(leftMidAz)).toBeGreaterThan(120)
    expect(Math.abs(rightMidAz)).toBeGreaterThan(120)
    // 方向相反：中点方位角符号相反。
    expect(Math.sign(leftMidAz)).toBe(-Math.sign(rightMidAz))
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

  it('每个运镜：绑定引用相机、相机不设 followTargetId（注视静态胸口点）、时长按速度', () => {
    const speeds: Array<['slow' | 'medium' | 'fast', number]> = [
      ['slow', CAMERA_SPEED_DURATION.slow],
      ['medium', CAMERA_SPEED_DURATION.medium],
      ['fast', CAMERA_SPEED_DURATION.fast],
    ]
    for (const [speed, duration] of speeds) {
      const state = buildCameraMoveScene({ move: 'orbit_left', speed })
      const camera = state.cameras[0]
      const binding = state.trajectoryBindings[0]
      expect(binding.objects[0].objectId).toBe(camera.id)
      expect(binding.trajectoryId).toBe(state.trajectories[0].id)
      // P0-A：主体静止、只有相机绑轨迹，故不设 followTargetId，否则注视点会被加半身高跑到头顶。
      expect(camera.followTargetId).toBeUndefined()
      // 注视固定胸口点。
      expect(camera.target).toEqual([0, 1.35, 0])
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

// 取景回归（锁 P0-A 注视点 + P1-A 距离/fov）：旧测只看相机「位置」，看不出它「看哪」「主体在不在框里」。
// 这里在真实播放位姿下，用 framing 的 fov 建一台 16:9 透视相机，把主体竖向 [0,2.5]（x=z=0）投影到 NDC，
// 断言主体中心（Y≈1.25）落在 NDC 竖向 [-0.9,0.9] 内（在框内、没被裁）。
describe('camera-move framing regression (在框内不裁)', () => {
  const ASPECT = 16 / 9

  // 用真实播放采样的位姿 + framing fov 建透视相机，把世界点 Y=worldY（x=z=0）投到 NDC.y。
  function projectSubjectNdcY(state: Scene3DState, t: number, fov: number, worldY: number): number {
    const playback = cameraWithPlaybackPosition(state, state.cameras[0], t)
    const cam = new THREE.PerspectiveCamera(fov, ASPECT, 0.1, 200)
    cam.position.set(playback.position[0], playback.position[1], playback.position[2])
    const target = playback.target ?? [0, 1.35, 0]
    cam.lookAt(new THREE.Vector3(target[0], target[1], target[2]))
    cam.updateMatrixWorld(true)
    cam.updateProjectionMatrix()
    return new THREE.Vector3(0, worldY, 0).project(cam).y
  }

  // framing 数学：可见竖向 = 2·d·tan(fov/2) 必须 ≥ 3.0（主体 2.5 + 约 20% 余量）。
  it('每个景别的 framing：可见竖向 ≥ 3.0（主体 2.5 留余量）', () => {
    for (const shot of ['wide', 'medium', 'close'] as const) {
      const { distance, fov } = CAMERA_MOVE_FRAMING[shot]
      const visibleVertical = 2 * distance * Math.tan((fov * Math.PI) / 180 / 2)
      expect(visibleVertical).toBeGreaterThanOrEqual(3.0)
    }
  })

  it('每个运镜（medium 景别）：主体中心 Y≈1.25 在 t=0 与 t=end 都落在 NDC [-0.9,0.9]', () => {
    const { fov } = CAMERA_MOVE_FRAMING.medium
    for (const move of CAMERA_MOVES) {
      const state = buildCameraMoveScene({ move, shot: 'medium' })
      const duration = state.sceneTimeline.totalDuration
      for (const t of [0, duration]) {
        const centerNdc = projectSubjectNdcY(state, t, fov, 1.25)
        expect(Math.abs(centerNdc)).toBeLessThanOrEqual(0.9)
      }
    }
  })
})
