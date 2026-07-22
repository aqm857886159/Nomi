import { describe, expect, it } from 'vitest'
import {
  objectSubjectAabb,
  projectAabbScreenRect,
  projectPointToScreen,
  solveSafeFrameCamera,
  subjectsUnionAabb,
  type Scene3DAabb,
} from './scene3dSafeFrame'
import type { Scene3DObject, Scene3DVector3 } from './scene3dTypes'

function mannequin(position: Scene3DVector3, scale = 2.5): Scene3DObject {
  return {
    id: `m-${position.join('_')}`,
    name: '假人',
    type: 'mannequin',
    visible: true,
    position,
    rotation: [0, 0, 0],
    scale: [scale, scale, scale],
    color: '#EF4444',
  } as Scene3DObject
}

// 画幅 → aspect(宽/高)
const ASPECTS: Record<string, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
  '1:1': 1,
  '2.39:1': 2.39,
}

// 求解目标安全矩形 [0.10, 0.90]（只允许浮点 epsilon）。
const MARGIN = 0.1
const SAFE_LO = 0.1
const SAFE_HI = 0.9
const EPS = 1e-6
const DIRECTIONS: Scene3DVector3[] = [
  [0, 0.15, 1], // 近正面略俯
  [0.6, 0.35, 0.8], // 3/4 视角
  [-0.7, 0.25, 0.6], // 另一侧
]

function assertFramed(box: Scene3DAabb, aspectLabel: string, aspect: number, direction: Scene3DVector3, fov = 45): void {
  const solution = solveSafeFrameCamera({ subject: box, direction, fovVerticalDeg: fov, aspect, margin: MARGIN })
  const rect = projectAabbScreenRect(box, solution.position, solution.target, fov, aspect)
  expect(rect, `${aspectLabel} 主体应在相机前方`).not.toBeNull()
  // 头脚左右都不越安全矩形（求解口径保守，实际略内于边界即通过）。
  expect(rect!.minX, `${aspectLabel} 左边界`).toBeGreaterThanOrEqual(SAFE_LO - EPS)
  expect(rect!.maxX, `${aspectLabel} 右边界`).toBeLessThanOrEqual(SAFE_HI + EPS)
  expect(rect!.minY, `${aspectLabel} 上边界(头)`).toBeGreaterThanOrEqual(SAFE_LO - EPS)
  expect(rect!.maxY, `${aspectLabel} 下边界(脚)`).toBeLessThanOrEqual(SAFE_HI + EPS)
}

describe('projectPointToScreen', () => {
  it('主体中心投到屏幕正中(0.5,0.5)', () => {
    const box = objectSubjectAabb(mannequin([0, 1.25, 0]))!
    const solution = solveSafeFrameCamera({ subject: box, direction: [0.6, 0.35, 0.8], fovVerticalDeg: 45, aspect: 16 / 9, margin: MARGIN })
    const screen = projectPointToScreen(box.center, solution.position, solution.target, 45, 16 / 9)
    expect(screen).not.toBeNull()
    expect(screen!.x).toBeCloseTo(0.5, 3)
    expect(screen!.y).toBeCloseTo(0.5, 3)
  })

  it('相机后方的点 → null', () => {
    expect(projectPointToScreen([0, 0, -5], [0, 0, 0], [0, 0, 1], 45, 1)).toBeNull()
  })
})

describe('solveSafeFrameCamera — 单人不截头（6 画幅 × 3 方位）', () => {
  const standing = objectSubjectAabb(mannequin([0, 1.25, 0]))!
  for (const [label, aspect] of Object.entries(ASPECTS)) {
    for (let d = 0; d < DIRECTIONS.length; d += 1) {
      it(`${label} · 方位${d} 单人站立在安全画幅内`, () => {
        assertFramed(standing, `${label}/dir${d}`, aspect, DIRECTIONS[d])
      })
    }
  }
})

describe('solveSafeFrameCamera — 下蹲/举手（姿势外扩仍不截头）', () => {
  // 下蹲：更矮（scale 小），必落在站立包围盒内。举手：用更高包围盒模拟（POSE_HEADROOM 已含 30% 余量）。
  const crouch = objectSubjectAabb(mannequin([0, 0.9, 0], 1.8))!
  const raisedArm: Scene3DAabb = { center: [0, 1.5, 0], half: [0.6, 1.7, 0.45] }
  for (const [label, aspect] of Object.entries(ASPECTS)) {
    it(`${label} 下蹲不截头`, () => assertFramed(crouch, `${label}/crouch`, aspect, [0.5, 0.3, 0.8]))
    it(`${label} 举手不截头`, () => assertFramed(raisedArm, `${label}/raised`, aspect, [0.5, 0.3, 0.8]))
  }
})

describe('solveSafeFrameCamera — 双人 union 不截头', () => {
  const twoPerson = subjectsUnionAabb([mannequin([-1.6, 1.25, 0]), mannequin([1.6, 1.25, 0])])!
  for (const [label, aspect] of Object.entries(ASPECTS)) {
    for (let d = 0; d < DIRECTIONS.length; d += 1) {
      it(`${label} · 方位${d} 双人分站两人都在画幅内`, () => {
        assertFramed(twoPerson, `${label}/dir${d}`, aspect, DIRECTIONS[d])
      })
    }
  }
})

describe('subjectsUnionAabb', () => {
  it('只框真人，灯/几何不参与构图', () => {
    const light = { ...mannequin([5, 5, 5]), type: 'light' } as Scene3DObject
    const geom = { ...mannequin([9, 9, 9]), type: 'geometry', geometry: 'box' } as unknown as Scene3DObject
    const box = subjectsUnionAabb([mannequin([0, 1.25, 0]), light, geom])!
    // union 中心不被 [5,5,5]/[9,9,9] 拉偏——只有那个假人参与。y 中心 = 脚底 1.25 + 视觉半高 1.25 = 2.5。
    expect(box.center[0]).toBeCloseTo(0, 5)
    expect(box.center[1]).toBeCloseTo(2.5, 5)
  })

  it('无主体 → null', () => {
    expect(subjectsUnionAabb([])).toBeNull()
  })
})
