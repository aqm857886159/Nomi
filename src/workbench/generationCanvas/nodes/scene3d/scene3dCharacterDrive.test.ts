import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  groundMoveDirection,
  facingYawFromDirection,
  shortestAngleDelta,
  normalizeAngle,
  dampYaw,
  applyGroundTranslation,
} from './scene3dCharacterDrive'

describe('groundMoveDirection', () => {
  it('无按键 → 零向量', () => {
    expect(groundMoveDirection({}, 0).lengthSq()).toBe(0)
  })

  it('对向按键抵消 → 零向量', () => {
    expect(groundMoveDirection({ KeyW: true, KeyS: true }, 0).lengthSq()).toBe(0)
    expect(groundMoveDirection({ KeyA: true, KeyD: true }, 0).lengthSq()).toBe(0)
  })

  it('yaw=0 时 W 朝 -Z（与相机前向约定一致）', () => {
    const dir = groundMoveDirection({ KeyW: true }, 0)
    expect(dir.x).toBeCloseTo(0, 5)
    expect(dir.y).toBe(0)
    expect(dir.z).toBeCloseTo(-1, 5)
  })

  it('yaw=0 时 S 朝 +Z', () => {
    const dir = groundMoveDirection({ KeyS: true }, 0)
    expect(dir.z).toBeCloseTo(1, 5)
  })

  it('yaw=0 时 D 朝 +X（相机右手边）', () => {
    const dir = groundMoveDirection({ KeyD: true }, 0)
    expect(dir.x).toBeCloseTo(1, 5)
    expect(dir.z).toBeCloseTo(0, 5)
  })

  it('箭头键与 WASD 等价', () => {
    const wasd = groundMoveDirection({ KeyW: true, KeyD: true }, 0.7)
    const arrows = groundMoveDirection({ ArrowUp: true, ArrowRight: true }, 0.7)
    expect(arrows.x).toBeCloseTo(wasd.x, 6)
    expect(arrows.z).toBeCloseTo(wasd.z, 6)
  })

  it('结果恒为单位向量（对角线不超速）', () => {
    const dir = groundMoveDirection({ KeyW: true, KeyD: true }, 1.2)
    expect(dir.length()).toBeCloseTo(1, 5)
  })

  it('相机转 90°（yaw=π/2）时 W 朝 -X（移动跟随相机朝向旋转）', () => {
    const dir = groundMoveDirection({ KeyW: true }, Math.PI / 2)
    expect(dir.x).toBeCloseTo(-1, 5)
    expect(dir.z).toBeCloseTo(0, 5)
  })

  it('y 分量恒为 0（贴地，无飞行）', () => {
    expect(groundMoveDirection({ KeyW: true, KeyA: true }, 0.3).y).toBe(0)
  })
})

describe('facingYawFromDirection', () => {
  it('零向量 → null（无移动时保持当前朝向）', () => {
    expect(facingYawFromDirection(new THREE.Vector3(0, 0, 0))).toBeNull()
  })

  it('朝 -Z → yaw 0（角色正面朝 -Z）', () => {
    expect(facingYawFromDirection(new THREE.Vector3(0, 0, -1))).toBeCloseTo(0, 5)
  })

  it('朝 +X → yaw -π/2（绕 Y 旋转后 -Z 指向 +X）', () => {
    expect(facingYawFromDirection(new THREE.Vector3(1, 0, 0))).toBeCloseTo(-Math.PI / 2, 5)
  })

  it('朝 +Z → yaw π（背对 -Z 起始朝向）', () => {
    expect(Math.abs(facingYawFromDirection(new THREE.Vector3(0, 0, 1)) ?? 0)).toBeCloseTo(Math.PI, 5)
  })

  it('面向 yaw 后旋转该角度的 -Z 轴确实指回移动方向（往返一致）', () => {
    const direction = new THREE.Vector3(0.6, 0, -0.8).normalize()
    const yaw = facingYawFromDirection(direction)!
    const forward = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, yaw, 0))
    expect(forward.x).toBeCloseTo(direction.x, 5)
    expect(forward.z).toBeCloseTo(direction.z, 5)
  })
})

describe('normalizeAngle / shortestAngleDelta', () => {
  it('归一化到 (-π, π]', () => {
    expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 5)
    expect(normalizeAngle(-Math.PI * 3)).toBeCloseTo(Math.PI, 5)
    expect(normalizeAngle(0)).toBe(0)
  })

  it('最短角差走短弧（跨 ±π 不绕远路）', () => {
    // 从 +170° 转到 -170°：短弧是 +20°，不是 -340°
    const current = THREE.MathUtils.degToRad(170)
    const target = THREE.MathUtils.degToRad(-170)
    const delta = shortestAngleDelta(current, target)
    expect(THREE.MathUtils.radToDeg(delta)).toBeCloseTo(20, 3)
  })
})

describe('dampYaw', () => {
  it('单帧向 target 靠近但不过冲', () => {
    const next = dampYaw(0, Math.PI / 2, 12, 0.016)
    expect(next).toBeGreaterThan(0)
    expect(next).toBeLessThan(Math.PI / 2)
  })

  it('已到 target → 直接吸附返回 target', () => {
    expect(dampYaw(Math.PI / 4, Math.PI / 4, 12, 0.016)).toBeCloseTo(Math.PI / 4, 5)
  })

  it('多帧累积收敛到 target', () => {
    let yaw = 0
    for (let i = 0; i < 120; i += 1) yaw = dampYaw(yaw, Math.PI / 2, 12, 0.016)
    expect(yaw).toBeCloseTo(Math.PI / 2, 3)
  })

  it('跨 ±π 走短弧收敛（不绕地球）', () => {
    let yaw = THREE.MathUtils.degToRad(170)
    const target = THREE.MathUtils.degToRad(-170)
    yaw = dampYaw(yaw, target, 12, 0.016)
    // 应朝 +180° 方向（增大）走，而非朝 0 绕回
    expect(yaw).toBeGreaterThan(THREE.MathUtils.degToRad(170))
  })
})

describe('applyGroundTranslation', () => {
  it('平移 x/z，y 锁到 groundY（贴地不飞行）', () => {
    const next = applyGroundTranslation([1, 99, 2], 0.5, -0.25, 3.75)
    expect(next).toEqual([1.5, 3.75, 1.75])
  })

  it('y 始终来自 groundY，与传入 position.y 无关', () => {
    expect(applyGroundTranslation([0, 5, 0], 0, 0, 1.25)[1]).toBe(1.25)
  })
})
