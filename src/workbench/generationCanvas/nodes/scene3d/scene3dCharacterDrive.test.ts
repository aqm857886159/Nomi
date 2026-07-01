import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  groundMoveDirection,
  facingYawFromDirection,
  shortestAngleDelta,
  normalizeAngle,
  dampYaw,
  applyGroundTranslation,
  locomotionForSpeed,
  groundSpeedForFlySpeed,
  isArmLocomotionTrackName,
  locomotionAnimationClip,
  shouldRecordLocomotionResume,
  CHARACTER_DRIVE_FLY_SPEED_MIN,
  CHARACTER_DRIVE_FLY_SPEED_MAX,
  groundSpeedMultiplier,
  jumpArcOffset,
  CHARACTER_DRIVE_RUN_SPEED_MULTIPLIER,
  CHARACTER_DRIVE_CROUCH_SPEED_MULTIPLIER,
  CHARACTER_DRIVE_JUMP_HEIGHT,
  CHARACTER_DRIVE_JUMP_DURATION,
} from './scene3dCharacterDrive'
import {
  LOCOMOTION_RUN_SPEED_THRESHOLD,
  LOCOMOTION_WALK_SPEED_THRESHOLD,
} from './scene3dConstants'

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

describe('groundSpeedForFlySpeed', () => {
  it('滑块最低档 → 走路速度（远低于 run 阈值）', () => {
    const speed = groundSpeedForFlySpeed(CHARACTER_DRIVE_FLY_SPEED_MIN)
    expect(speed).toBeGreaterThan(LOCOMOTION_WALK_SPEED_THRESHOLD)
    expect(speed).toBeLessThan(LOCOMOTION_RUN_SPEED_THRESHOLD)
    expect(locomotionForSpeed(speed)).toBe('walk')
  })

  it('滑块最高档 → 越过 run 阈值（奔跑）', () => {
    const speed = groundSpeedForFlySpeed(CHARACTER_DRIVE_FLY_SPEED_MAX)
    expect(speed).toBeGreaterThan(LOCOMOTION_RUN_SPEED_THRESHOLD)
    expect(locomotionForSpeed(speed)).toBe('run')
  })

  it('滑块单调递增 → 速度单调递增', () => {
    let prev = -Infinity
    for (let s = CHARACTER_DRIVE_FLY_SPEED_MIN; s <= CHARACTER_DRIVE_FLY_SPEED_MAX; s += 1) {
      const speed = groundSpeedForFlySpeed(s)
      expect(speed).toBeGreaterThan(prev)
      prev = speed
    }
  })

  it('存在一个中高档使桶从 walk 翻成 run（run 真能被滑块触发）', () => {
    const walkAtLow = locomotionForSpeed(groundSpeedForFlySpeed(CHARACTER_DRIVE_FLY_SPEED_MIN))
    const runAtHigh = locomotionForSpeed(groundSpeedForFlySpeed(CHARACTER_DRIVE_FLY_SPEED_MAX))
    expect(walkAtLow).toBe('walk')
    expect(runAtHigh).toBe('run')
  })

  it('clamp 越界输入到滑块范围（不爆速/不负速）', () => {
    expect(groundSpeedForFlySpeed(-100)).toBeCloseTo(groundSpeedForFlySpeed(CHARACTER_DRIVE_FLY_SPEED_MIN), 6)
    expect(groundSpeedForFlySpeed(9999)).toBeCloseTo(groundSpeedForFlySpeed(CHARACTER_DRIVE_FLY_SPEED_MAX), 6)
  })
})

describe('locomotionForSpeed', () => {
  it('零速 / 极微速 → idle（站立）', () => {
    expect(locomotionForSpeed(0)).toBe('idle')
    expect(locomotionForSpeed(LOCOMOTION_WALK_SPEED_THRESHOLD - 1e-6)).toBe('idle')
  })

  it('walk 阈值（含边界）~run 阈值之间 → walk', () => {
    expect(locomotionForSpeed(LOCOMOTION_WALK_SPEED_THRESHOLD)).toBe('walk')
    expect(locomotionForSpeed((LOCOMOTION_WALK_SPEED_THRESHOLD + LOCOMOTION_RUN_SPEED_THRESHOLD) / 2)).toBe('walk')
    expect(locomotionForSpeed(LOCOMOTION_RUN_SPEED_THRESHOLD - 1e-6)).toBe('walk')
  })

  it('达到/超过 run 阈值 → run', () => {
    expect(locomotionForSpeed(LOCOMOTION_RUN_SPEED_THRESHOLD)).toBe('run')
    expect(locomotionForSpeed(LOCOMOTION_RUN_SPEED_THRESHOLD + 10)).toBe('run')
  })

  it('负速取绝对值分桶（速度是标量大小）', () => {
    expect(locomotionForSpeed(-LOCOMOTION_RUN_SPEED_THRESHOLD)).toBe('run')
    expect(locomotionForSpeed(-(LOCOMOTION_WALK_SPEED_THRESHOLD + 0.01))).toBe('walk')
  })
})

describe('isArmLocomotionTrackName（#2 手臂链 track 过滤）', () => {
  it('左右肩/大臂/前臂/手/手指 track 全判为手臂链', () => {
    for (const bone of [
      'mixamorigLeftShoulder', 'mixamorigRightShoulder',
      'mixamorigLeftArm', 'mixamorigRightArm',
      'mixamorigLeftForeArm', 'mixamorigRightForeArm',
      'mixamorigLeftHand', 'mixamorigRightHand',
      'mixamorigLeftHandThumb1', 'mixamorigRightHandIndex3',
    ]) {
      expect(isArmLocomotionTrackName(`${bone}.quaternion`)).toBe(true)
      expect(isArmLocomotionTrackName(`${bone}.position`)).toBe(true)
    }
  })

  it('腿/髋/脊/头/颈/脚 track 不判为手臂链（留它们被动画驱动）', () => {
    for (const bone of [
      'mixamorigHips', 'mixamorigSpine', 'mixamorigSpine1', 'mixamorigSpine2',
      'mixamorigNeck', 'mixamorigHead',
      'mixamorigLeftUpLeg', 'mixamorigRightUpLeg',
      'mixamorigLeftLeg', 'mixamorigRightLeg',
      'mixamorigLeftFoot', 'mixamorigRightFoot',
      'mixamorigLeftToeBase', 'mixamorigRightToeBase',
    ]) {
      expect(isArmLocomotionTrackName(`${bone}.quaternion`)).toBe(false)
    }
  })

  it('无 Left/Right 前缀的中线骨（即便名里含 Arm 字样的脊椎也不会误命中）', () => {
    expect(isArmLocomotionTrackName('mixamorigSpine.quaternion')).toBe(false)
    expect(isArmLocomotionTrackName('mixamorigHips.position')).toBe(false)
  })
})

describe('locomotionAnimationClip（#9 idle 不靠 clip）', () => {
  it('idle / 空 → undefined（走静态站姿路径，不靠推帧）', () => {
    expect(locomotionAnimationClip('idle')).toBeUndefined()
    expect(locomotionAnimationClip('')).toBeUndefined()
    expect(locomotionAnimationClip(undefined)).toBeUndefined()
  })

  it('walk / run → 原 clip 名（交给 mixer 驱动腿）', () => {
    expect(locomotionAnimationClip('walk')).toBe('walk')
    expect(locomotionAnimationClip('run')).toBe('run')
  })
})

describe('shouldRecordLocomotionResume（#4 走→蹲→走：恢复走路时补 base 关键帧）', () => {
  it("从静态动作('')恢复到 walk/run → 该补 base 关键帧", () => {
    expect(shouldRecordLocomotionResume('', 'walk')).toBe(true)
    expect(shouldRecordLocomotionResume('', 'run')).toBe(true)
    expect(shouldRecordLocomotionResume('', 'idle')).toBe(true)
  })

  it("从静态动作('')恢复但 next 仍是 '' → 不补（没真恢复）", () => {
    expect(shouldRecordLocomotionResume('', '')).toBe(false)
    expect(shouldRecordLocomotionResume('', undefined)).toBe(false)
  })

  it('walk↔run 桶切换、idle→walk（prev 非空）→ 不补（不是从静态动作恢复）', () => {
    expect(shouldRecordLocomotionResume('walk', 'run')).toBe(false)
    expect(shouldRecordLocomotionResume('run', 'walk')).toBe(false)
    expect(shouldRecordLocomotionResume('idle', 'walk')).toBe(false)
    expect(shouldRecordLocomotionResume('walk', '')).toBe(false)
  })

  it('首次进入（prev undefined）→ 不补', () => {
    expect(shouldRecordLocomotionResume(undefined, 'walk')).toBe(false)
  })
})

describe('groundSpeedMultiplier（#C Shift 加速 / C·Ctrl 下蹲）', () => {
  it('都不按住 → 1（不缩放）', () => {
    expect(groundSpeedMultiplier(false, false)).toBe(1)
  })

  it('只按住加速 → 加速倍率', () => {
    expect(groundSpeedMultiplier(true, false)).toBe(CHARACTER_DRIVE_RUN_SPEED_MULTIPLIER)
  })

  it('只按住下蹲 → 下蹲倍率', () => {
    expect(groundSpeedMultiplier(false, true)).toBe(CHARACTER_DRIVE_CROUCH_SPEED_MULTIPLIER)
  })

  it('两个都按住 → 下蹲优先（慢下来的意图更明确）', () => {
    expect(groundSpeedMultiplier(true, true)).toBe(CHARACTER_DRIVE_CROUCH_SPEED_MULTIPLIER)
  })

  it('加速倍率 > 1、下蹲倍率 < 1（方向不能反）', () => {
    expect(CHARACTER_DRIVE_RUN_SPEED_MULTIPLIER).toBeGreaterThan(1)
    expect(CHARACTER_DRIVE_CROUCH_SPEED_MULTIPLIER).toBeLessThan(1)
  })
})

describe('jumpArcOffset（#C Space 轻跳抛物线）', () => {
  it('起跳/落地边界(t=0, t=duration) → 0（贴地）', () => {
    expect(jumpArcOffset(0)).toBe(0)
    expect(jumpArcOffset(CHARACTER_DRIVE_JUMP_DURATION)).toBe(0)
  })

  it('中点(t=duration/2) → 取最大高度', () => {
    const mid = CHARACTER_DRIVE_JUMP_DURATION / 2
    expect(jumpArcOffset(mid)).toBeCloseTo(CHARACTER_DRIVE_JUMP_HEIGHT, 5)
  })

  it('区间外（尚未起跳 / 已经落地过头）→ clamp 到 0', () => {
    expect(jumpArcOffset(-0.1)).toBe(0)
    expect(jumpArcOffset(CHARACTER_DRIVE_JUMP_DURATION + 0.2)).toBe(0)
  })

  it('区间内单调：0→中点递增，中点→duration 递减（抛物线形状，非线性台阶）', () => {
    const quarter = CHARACTER_DRIVE_JUMP_DURATION * 0.25
    const mid = CHARACTER_DRIVE_JUMP_DURATION * 0.5
    const threeQuarter = CHARACTER_DRIVE_JUMP_DURATION * 0.75
    expect(jumpArcOffset(quarter)).toBeGreaterThan(0)
    expect(jumpArcOffset(quarter)).toBeLessThan(jumpArcOffset(mid))
    expect(jumpArcOffset(threeQuarter)).toBeLessThan(jumpArcOffset(mid))
    // 对称抛物线：t 和 duration-t 偏移相同。
    expect(jumpArcOffset(quarter)).toBeCloseTo(jumpArcOffset(threeQuarter), 5)
  })

  it('自定义 height/duration 也成立', () => {
    expect(jumpArcOffset(0.5, 1, 1)).toBeCloseTo(1, 5)
    expect(jumpArcOffset(1, 1, 1)).toBe(0)
  })
})
