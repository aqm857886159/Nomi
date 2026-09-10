import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { LegacyScene3DState, LegacyVec3 } from '../migration/legacyScene3dTypes'
import { LegacyTrajectorySampler } from '../migration/legacyTrajectorySampler'
import { buildCameraMoveScene } from './cameraMoveBuilder'
import { CAMERA_MOVE_FRAMING, CAMERA_MOVES, CAMERA_SPEED_DURATION } from './cameraMoveVocab'

function distXZ(p: LegacyVec3): number {
  return Math.hypot(p[0], p[2])
}

function azimuthDeg(p: LegacyVec3): number {
  return (Math.atan2(p[0], p[2]) * 180) / Math.PI
}

function sample(state: LegacyScene3DState, t: number): LegacyVec3 {
  return new LegacyTrajectorySampler(state).cameraPose(state.cameras[0], t).position
}

function startEnd(state: LegacyScene3DState): { start: LegacyVec3; end: LegacyVec3; duration: number } {
  const duration = state.trajectoryBindings[0].endTime
  return { start: sample(state, 0), end: sample(state, duration), duration }
}

describe('buildCameraMoveScene', () => {
  it('push_in: 终点比起点离主体更近；pull_out 相反', () => {
    const push = startEnd(buildCameraMoveScene({ move: 'push_in' }))
    expect(distXZ(push.end)).toBeLessThan(distXZ(push.start))
    const pull = startEnd(buildCameraMoveScene({ move: 'pull_out' }))
    expect(distXZ(pull.end)).toBeGreaterThan(distXZ(pull.start))
  })

  it('orbit_left / orbit_right: 半径守恒且方位角大幅扫过，方向相反', () => {
    const left = startEnd(buildCameraMoveScene({ move: 'orbit_left' }))
    const right = startEnd(buildCameraMoveScene({ move: 'orbit_right' }))
    expect(distXZ(left.end)).toBeCloseTo(distXZ(left.start), 1)
    expect(distXZ(right.end)).toBeCloseTo(distXZ(right.start), 1)
    const leftMidAz = azimuthDeg(sample(buildCameraMoveScene({ move: 'orbit_left' }), left.duration / 2))
    const rightMidAz = azimuthDeg(sample(buildCameraMoveScene({ move: 'orbit_right' }), right.duration / 2))
    expect(Math.abs(leftMidAz)).toBeGreaterThan(120)
    expect(Math.abs(rightMidAz)).toBeGreaterThan(120)
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

  it('crane_up 终点更高、crane_down 更低；track_left 终点 X 更小、track_right 更大', () => {
    const up = startEnd(buildCameraMoveScene({ move: 'crane_up' }))
    expect(up.end[1]).toBeGreaterThan(up.start[1])
    const down = startEnd(buildCameraMoveScene({ move: 'crane_down' }))
    expect(down.end[1]).toBeLessThan(down.start[1])
    const left = startEnd(buildCameraMoveScene({ move: 'track_left' }))
    expect(left.end[0]).toBeLessThan(left.start[0])
    const right = startEnd(buildCameraMoveScene({ move: 'track_right' }))
    expect(right.end[0]).toBeGreaterThan(right.start[0])
  })

  it('每个速度：绑定引用相机、相机注视静态胸口点（不跟随）、时长按速度', () => {
    for (const speed of ['slow', 'medium', 'fast'] as const) {
      const state = buildCameraMoveScene({ move: 'orbit_left', speed })
      const camera = state.cameras[0]
      const binding = state.trajectoryBindings[0]
      expect(binding.objects[0].objectId).toBe(camera.id)
      expect(binding.trajectoryId).toBe(state.trajectories[0].id)
      expect(camera.followTargetId).toBeUndefined()
      expect(camera.target).toEqual([0, 1.35, 0])
      expect(binding.endTime).toBe(CAMERA_SPEED_DURATION[speed])
    }
  })

  it('主体是落地的 mannequin，相机起点 = 轨迹首点', () => {
    const state = buildCameraMoveScene({ move: 'push_in' })
    expect(state.objects[0].type).toBe('mannequin')
    expect(state.objects[0].position[1]).toBeCloseTo(1.25, 5)
    expect(state.cameras[0].position).toEqual(state.trajectories[0].points[0].position)
  })

  it('变焦三招：dolly_zoom 带补偿后的 fov 渐变且机位后拉；zoom_in 机位原地 fov 收窄；机位招不带 fov 字段', () => {
    const dolly = buildCameraMoveScene({ move: 'dolly_zoom' })
    expect(dolly.trajectoryBindings[0].fovFrom).toBeDefined()
    expect(dolly.trajectoryBindings[0].fovTo!).toBeLessThan(dolly.trajectoryBindings[0].fovFrom!)
    const dollyEnds = startEnd(dolly)
    expect(distXZ(dollyEnds.end)).toBeGreaterThan(distXZ(dollyEnds.start))
    const zoom = buildCameraMoveScene({ move: 'zoom_in' })
    const zoomEnds = startEnd(zoom)
    expect(distXZ(zoomEnds.end)).toBeCloseTo(distXZ(zoomEnds.start), 2)
    expect(zoom.trajectoryBindings[0].fovTo!).toBeLessThan(zoom.trajectoryBindings[0].fovFrom!)
    expect(buildCameraMoveScene({ move: 'push_in' }).trajectoryBindings[0].fovFrom).toBeUndefined()
  })
})

// 取景回归：真实播放位姿下，用 framing 的 fov 建 16:9 透视相机，主体中心 Y≈1.25 投到 NDC 竖向 [-0.9,0.9] 内
describe('camera-move framing regression (在框内不裁)', () => {
  const ASPECT = 16 / 9

  function projectSubjectNdcY(state: LegacyScene3DState, t: number, fov: number, worldY: number): number {
    const pose = new LegacyTrajectorySampler(state).cameraPose(state.cameras[0], t)
    const cam = new THREE.PerspectiveCamera(fov, ASPECT, 0.1, 200)
    cam.position.set(pose.position[0], pose.position[1], pose.position[2])
    cam.lookAt(new THREE.Vector3(pose.target[0], pose.target[1], pose.target[2]))
    cam.updateMatrixWorld(true)
    cam.updateProjectionMatrix()
    return new THREE.Vector3(0, worldY, 0).project(cam).y
  }

  it('每个景别的 framing：可见竖向 ≥ 3.0（主体 2.5 留余量）', () => {
    for (const shot of ['wide', 'medium', 'close'] as const) {
      const { distance, fov } = CAMERA_MOVE_FRAMING[shot]
      expect(2 * distance * Math.tan((fov * Math.PI) / 180 / 2)).toBeGreaterThanOrEqual(3.0)
    }
  })

  it('每个运镜（medium 景别）：主体中心在 t=0 与 t=end 都落在 NDC [-0.9,0.9]', () => {
    const { fov } = CAMERA_MOVE_FRAMING.medium
    for (const move of CAMERA_MOVES) {
      const state = buildCameraMoveScene({ move, shot: 'medium' })
      const duration = state.trajectoryBindings[0].endTime
      for (const t of [0, duration]) expect(Math.abs(projectSubjectNdcY(state, t, fov, 1.25))).toBeLessThanOrEqual(0.9)
    }
  })

  it('灰模布景：模板 + 道具就位，主体仍唯一假人，运镜路径不受布景影响', () => {
    const plain = buildCameraMoveScene({ move: 'push_in' })
    const withBackdrop = buildCameraMoveScene({ move: 'push_in', sceneTemplate: 'street', props: [{ kind: 'tree', position: [3, -1] }] })
    expect(withBackdrop.objects.length).toBeGreaterThan(plain.objects.length)
    expect(withBackdrop.objects.filter((o) => o.type === 'mannequin')).toHaveLength(1)
    expect(withBackdrop.objects.some((o) => o.type === 'prop')).toBe(true)
    expect(startEnd(withBackdrop).start).toEqual(startEnd(plain).start)
    expect(startEnd(withBackdrop).end).toEqual(startEnd(plain).end)
    expect(withBackdrop.objects.some((o) => o.propKind === 'tree' && o.position[0] === 3 && o.position[1] === 0 && o.position[2] === -1)).toBe(true)
    expect(buildCameraMoveScene({ move: 'orbit_left' }).objects).toHaveLength(1)
  })
})
