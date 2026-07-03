import { describe, it, expect } from 'vitest'
import {
  applyCameraMovePreset,
  cameraMovePresetPathPoints,
  dollyZoomCompensatedFov,
  dollyZoomDistanceScale,
  nextCameraMoveStartTime,
  zoomFovRamp,
} from './cameraMovePreset'
import { buildCameraMoveScene } from './cameraMoveBuilder'
import { CAMERA_MOVES } from './cameraMoveVocab'
import { createDefaultScene3DState } from './scene3dSerializer'
import type { Scene3DCamera, Scene3DState, Scene3DVector3 } from './scene3dTypes'

const DEG = Math.PI / 180

function camera(extra: Partial<Scene3DCamera> = {}): Scene3DCamera {
  return {
    id: 'cam1',
    name: '相机1',
    visible: true,
    position: [2, 1.45, 4],
    rotation: [0, 0, 0],
    target: [0, 1.35, 0],
    fov: 40,
    aspectRatio: '16:9',
    lensDepth: 0,
    near: 0.1,
    far: 200,
    ...extra,
  }
}

function stateWithCamera(): Scene3DState {
  return { ...createDefaultScene3DState(), cameras: [camera()] }
}

describe('cameraMovePresetPathPoints · 13 招路径', () => {
  it('每招 ≥2 个有限点，且起点恒为当前机位（应用预设绝不跳机位）', () => {
    const position: Scene3DVector3 = [2, 1.45, 4]
    const target: Scene3DVector3 = [0, 1.35, 0]
    for (const move of CAMERA_MOVES) {
      const points = cameraMovePresetPathPoints(move, position, target, 1)
      expect(points.length, move).toBeGreaterThanOrEqual(2)
      points.forEach((point) => point.forEach((value) => expect(Number.isFinite(value), move).toBe(true)))
      expect(points[0][0], move).toBeCloseTo(position[0], 3)
      expect(points[0][1], move).toBeCloseTo(position[1], 3)
      expect(points[0][2], move).toBeCloseTo(position[2], 3)
    }
  })

  it('推近末点比起点更近目标，拉远相反；幅度越大越狠', () => {
    const target: Scene3DVector3 = [0, 1.35, 0]
    const dist = (p: Scene3DVector3) => Math.hypot(p[0] - target[0], p[1] - target[1], p[2] - target[2])
    const start: Scene3DVector3 = [2, 1.45, 4]
    const pushFull = cameraMovePresetPathPoints('push_in', start, target, 1)
    const pushHalf = cameraMovePresetPathPoints('push_in', start, target, 0.5)
    expect(dist(pushFull.at(-1)!)).toBeLessThan(dist(start))
    expect(dist(pushFull.at(-1)!)).toBeLessThan(dist(pushHalf.at(-1)!))
    const pull = cameraMovePresetPathPoints('pull_out', start, target, 1)
    expect(dist(pull.at(-1)!)).toBeGreaterThan(dist(start))
  })

  it('环绕按幅度缩放扫角（a=0.5 → 150°），全程保持水平距离与机高', () => {
    const target: Scene3DVector3 = [0, 1, 0]
    const start: Scene3DVector3 = [0, 2, 5]
    const points = cameraMovePresetPathPoints('orbit_left', start, target, 0.5)
    const azimuth = (p: Scene3DVector3) => Math.atan2(p[0] - target[0], p[2] - target[2])
    const sweep = (azimuth(points.at(-1)!) - azimuth(points[0])) / DEG
    expect(sweep).toBeCloseTo(150, 1)
    points.forEach((p) => {
      expect(Math.hypot(p[0], p[2] - 0)).toBeCloseTo(5, 3)
      expect(p[1]).toBeCloseTo(2, 4)
    })
  })

  it('升镜上移、降镜下移且不穿地（下限 y=0.25）', () => {
    const target: Scene3DVector3 = [0, 1.35, 0]
    const up = cameraMovePresetPathPoints('crane_up', [0, 1.45, 5], target, 1)
    expect(up.at(-1)![1]).toBeGreaterThan(1.45)
    const down = cameraMovePresetPathPoints('crane_down', [0, 0.4, 5], target, 1)
    expect(down.at(-1)![1]).toBeGreaterThanOrEqual(0.25)
  })

  it('横移沿屏幕左右方向平移、不改机高', () => {
    // 相机在 +z 看向原点（面朝 -z）：屏幕右 = +x（与 builder track_right 的 x 递增语义一致）。
    const target: Scene3DVector3 = [0, 1.35, 0]
    const right = cameraMovePresetPathPoints('track_right', [0, 1.45, 5], target, 1)
    expect(right.at(-1)![0]).toBeGreaterThan(0)
    expect(right.at(-1)![1]).toBeCloseTo(1.45, 4)
    const left = cameraMovePresetPathPoints('track_left', [0, 1.45, 5], target, 1)
    expect(left.at(-1)![0]).toBeLessThan(0)
  })

  it('变焦推/拉机位原地（2mm epsilon），希区柯克机位后拉', () => {
    const target: Scene3DVector3 = [0, 1.35, 0]
    const start: Scene3DVector3 = [0, 1.45, 5]
    const zoomPoints = cameraMovePresetPathPoints('zoom_in', start, target, 1)
    const travel = Math.hypot(
      zoomPoints.at(-1)![0] - start[0],
      zoomPoints.at(-1)![1] - start[1],
      zoomPoints.at(-1)![2] - start[2],
    )
    expect(travel).toBeLessThan(0.01)
    const dolly = cameraMovePresetPathPoints('dolly_zoom', start, target, 1)
    expect(dolly.at(-1)![2]).toBeCloseTo(5 * dollyZoomDistanceScale(1) - 0 + target[2] + (start[2] - target[2]) * 0 * 0, 0)
    expect(Math.hypot(dolly.at(-1)![0], dolly.at(-1)![2])).toBeGreaterThan(5)
  })
})

describe('zoomFovRamp · 变焦 FOV 数学', () => {
  it('变焦推收窄、变焦拉放宽、非变焦运镜返回 null', () => {
    expect(zoomFovRamp('zoom_in', 40, 1)!.fovTo).toBeLessThan(40)
    expect(zoomFovRamp('zoom_out', 40, 1)!.fovTo).toBeGreaterThan(40)
    expect(zoomFovRamp('push_in', 40, 1)).toBeNull()
  })

  it('希区柯克恒等式：tan(fov0/2)·d0 = tan(fov1/2)·d1（主体成像高度不变）', () => {
    const scale = dollyZoomDistanceScale(1)
    const fov1 = dollyZoomCompensatedFov(40, scale)
    const size0 = Math.tan((40 / 2) * DEG) * 1
    const size1 = Math.tan((fov1 / 2) * DEG) * scale
    expect(size1).toBeCloseTo(size0, 3)
  })

  it('fov 两端 clamp 在 12-120', () => {
    expect(zoomFovRamp('zoom_in', 14, 1)!.fovTo).toBeGreaterThanOrEqual(12)
    expect(zoomFovRamp('zoom_out', 90, 1)!.fovTo).toBeLessThanOrEqual(120)
  })
})

describe('applyCameraMovePreset · 追加与串联', () => {
  it('落一段：轨迹+绑定追加、时长写进时间轴、相机被绑定', () => {
    const result = applyCameraMovePreset(stateWithCamera(), 'cam1', { move: 'push_in', duration: 4, amplitude: 0.6 })!
    expect(result.state.trajectories).toHaveLength(1)
    expect(result.state.trajectoryBindings).toHaveLength(1)
    expect(result.state.trajectories[0].name).toBe('推近')
    expect(result.state.trajectoryBindings[0].objects[0].objectId).toBe('cam1')
    expect(result.startTime).toBe(0)
    expect(result.endTime).toBe(4)
    expect(result.state.sceneTimeline.totalDuration).toBeGreaterThanOrEqual(4)
  })

  it('连点串联：第二段从第一段末尾接力，总时长随之延长', () => {
    const first = applyCameraMovePreset(stateWithCamera(), 'cam1', { move: 'push_in', duration: 5, amplitude: 1 })!
    const second = applyCameraMovePreset(first.state, 'cam1', { move: 'orbit_left', duration: 6, amplitude: 1 })!
    expect(second.startTime).toBe(5)
    expect(second.endTime).toBe(11)
    expect(second.state.sceneTimeline.totalDuration).toBe(11)
    expect(nextCameraMoveStartTime(second.state)).toBe(11)
  })

  it('变焦招在 binding 上落 fov 渐变端点；机位招不落', () => {
    const zoom = applyCameraMovePreset(stateWithCamera(), 'cam1', { move: 'dolly_zoom', duration: 5, amplitude: 1 })!
    expect(zoom.state.trajectoryBindings[0].fovFrom).toBe(40)
    expect(zoom.state.trajectoryBindings[0].fovTo).toBeLessThan(40)
    const push = applyCameraMovePreset(stateWithCamera(), 'cam1', { move: 'push_in', duration: 5, amplitude: 1 })!
    expect(push.state.trajectoryBindings[0].fovFrom).toBeUndefined()
  })

  it('时长/幅度越界 clamp；相机不存在返回 null；原 state 不被改写', () => {
    const base = stateWithCamera()
    const result = applyCameraMovePreset(base, 'cam1', { move: 'push_in', duration: 99, amplitude: 9 })!
    expect(result.endTime - result.startTime).toBe(12)
    expect(applyCameraMovePreset(base, 'ghost', { move: 'push_in', duration: 5, amplitude: 1 })).toBeNull()
    expect(base.trajectories).toHaveLength(0)
    expect(base.trajectoryBindings).toHaveLength(0)
  })
})

describe('buildCameraMoveScene · AI 路径吃到变焦三招', () => {
  it('dolly_zoom：binding 带补偿后的 fov 渐变，机位后拉', () => {
    const state = buildCameraMoveScene({ move: 'dolly_zoom' })
    const binding = state.trajectoryBindings[0]
    expect(binding.fovFrom).toBe(40)
    expect(binding.fovTo).toBeLessThan(40)
    const points = state.trajectories[0].points
    expect(Math.abs(points.at(-1)!.position[2])).toBeGreaterThan(Math.abs(points[0].position[2]))
  })

  it('zoom_in：机位原地、fov 收窄；老 10 招 binding 不带 fov 字段', () => {
    const zoom = buildCameraMoveScene({ move: 'zoom_in' })
    expect(zoom.trajectoryBindings[0].fovTo).toBeLessThan(zoom.trajectoryBindings[0].fovFrom!)
    const orbit = buildCameraMoveScene({ move: 'orbit_left' })
    expect(orbit.trajectoryBindings[0].fovFrom).toBeUndefined()
    expect(orbit.trajectoryBindings[0].fovTo).toBeUndefined()
  })
})
