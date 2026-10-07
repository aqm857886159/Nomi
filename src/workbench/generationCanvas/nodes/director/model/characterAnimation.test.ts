import { describe, expect, it } from 'vitest'
import { ACTION_ALIASES, ACTION_LIBRARY, findActionEntry, LEGACY_APPROXIMATE_ACTIONS, legacyPoseToAction, resolveActionAlias, T_POSE_ACTION_ID } from './actionLibrary'
import { UAL_ACTIONS } from './assetCatalog/ualActions'
import { presetPoseRotations } from './posePresets'
import type { ActionClip, LookAtClip } from './directorTypes'
import { distributeHeadAim, lookAtWeightAt, solveHeadAim } from './lookAtSolve'
import { blendBoneRotations, resolveActionBlend, resolvePoseKeyframes } from './poseBlend'

function action(id: string, startTime: number, endTime: number, clipType: ActionClip['clipType'] = 'action'): ActionClip {
  return { id, name: id, clipType, actionPose: 'walk', startTime, endTime, startFrame: startTime * 30, endFrame: endTime * 30 }
}

describe('poseBlend', () => {
  it('fades in over 0.25s at a clip start, holds to the end, then fades back to rest over 0.25s after it', () => {
    const clips = [action('a', 1, 3)]
    expect(resolveActionBlend(clips, 0.5).clip).toBeNull()
    expect(resolveActionBlend(clips, 1).weight).toBe(0)
    expect(resolveActionBlend(clips, 1.125).weight).toBeCloseTo(0.5)
    expect(resolveActionBlend(clips, 2).weight).toBe(1)
    // 片段尾不淡出：末帧仍满权重
    expect(resolveActionBlend(clips, 2.875).weight).toBe(1)
    expect(resolveActionBlend(clips, 3).weight).toBe(1)
    const tail = resolveActionBlend(clips, 3.1)
    expect(tail.clip?.id).toBe('a')
    expect(tail.weight).toBeCloseTo(0.6)
  })

  it('cross-blends neighbours whose gap is at most 0.5s instead of fading to rest', () => {
    const clips = [action('a', 0, 2), action('b', 2.4, 4)]
    const inGap = resolveActionBlend(clips, 2.2)
    expect(inGap.clip?.id).toBe('b')
    expect(inGap.previous?.id).toBe('a')
    expect(inGap.weight).toBeCloseTo(0.5)
    expect(inGap.previousWeight).toBeCloseTo(0.5)
    // a 的尾部不淡出到静止（下一段贴得近）
    expect(resolveActionBlend(clips, 1.95).weight).toBe(1)
    // 间隙 0.4s ≥ 0.2s：b 开头从静止预设淡入，不再带 a（0.2 阈值）
    const head = resolveActionBlend(clips, 2.5)
    expect(head.previous).toBeNull()
    expect(head.weight).toBeCloseTo(0.4)
    // 间隙 <0.2s：b 开头前 0.25s 从 a 的末帧交叉
    const tight = [action('a', 0, 2), action('b', 2.1, 4)]
    const cross = resolveActionBlend(tight, 2.2)
    expect(cross.clip?.id).toBe('b')
    expect(cross.previous?.id).toBe('a')
    expect(cross.previousWeight).toBeCloseTo(1 - cross.weight)
    // 姿态片段不参与交叉：前一段是 custom_pose 就从静止预设淡入
    const posed = [action('p', 0, 2, 'custom_pose'), action('b', 2.1, 4)]
    expect(resolveActionBlend(posed, 2.2).previous).toBeNull()
    expect(resolveActionBlend(posed, 2.05).clip).toBeNull()
  })

  it('resolves keyframe pairs inside a custom pose clip and clamps outside', () => {
    const clip: ActionClip = {
      ...action('p', 0, 4, 'custom_pose'),
      keyframes: [
        { id: 'k1', time: 1, frame: 30, boneRotations: { head: { x: 0, y: 0, z: 0 } } },
        { id: 'k2', time: 3, frame: 90, boneRotations: { head: { x: 40, y: 0, z: 0 } } },
      ],
    }
    expect(resolvePoseKeyframes(clip, 0.5)).toEqual({ a: clip.keyframes![0], b: null, alpha: 0 })
    const middle = resolvePoseKeyframes(clip, 2)
    expect(middle.a?.id).toBe('k1')
    expect(middle.b?.id).toBe('k2')
    expect(middle.alpha).toBeCloseTo(0.5)
    expect(resolvePoseKeyframes(clip, 5).a?.id).toBe('k2')
    expect(blendBoneRotations(middle.a!.boneRotations, middle.b!.boneRotations, middle.alpha).head.x).toBeCloseTo(20)
  })
})

describe('lookAtSolve', () => {
  const clip: LookAtClip = {
    id: 'l',
    name: 'l',
    targetType: 'object',
    targetId: 'x',
    enablePitch: true,
    targetHeightOffset: 0,
    targetBodyPart: 'face',
    startTime: 1,
    endTime: 3,
    startFrame: 30,
    endFrame: 90,
    blendInDuration: 0.4,
    blendOutDuration: 0.4,
    weight: 1,
    clampingAngle: 80,
  }

  it('ramps the clip weight in and out and is zero outside', () => {
    expect(lookAtWeightAt(clip, 0.5)).toBe(0)
    expect(lookAtWeightAt(clip, 1.2)).toBeCloseTo(0.5)
    expect(lookAtWeightAt(clip, 2)).toBe(1)
    expect(lookAtWeightAt(clip, 2.8)).toBeCloseTo(0.5)
  })

  it('clamps the head yaw to the clamping angle and fades beyond it', () => {
    const aim = solveHeadAim({ headPosition: { x: 0, y: 1.6, z: 0 }, targetPosition: { x: 0, y: 1.6, z: -5 }, bodyYaw: 0, clampingAngle: 80, enablePitch: true, weight: 1 })
    // 目标在正后方 = 180°：夹到 80°，超出 100° > 40° 衰减完全 → 权重 0
    expect(Math.abs(aim.yaw)).toBeCloseTo(80)
    expect(aim.weight).toBe(0)
    const side = solveHeadAim({ headPosition: { x: 0, y: 1.6, z: 0 }, targetPosition: { x: 5, y: 1.6, z: 0 }, bodyYaw: 0, clampingAngle: 80, enablePitch: false, weight: 1 })
    // 正侧方 90° 超过限幅 80° → 夹到 80°，但只超 10°（< 40° 衰减带）仍保留大部分权重
    expect(side.yaw).toBeCloseTo(80)
    expect(side.pitch).toBe(0)
    expect(side.weight).toBeGreaterThan(0)
    const shares = distributeHeadAim({ yaw: 40, pitch: 10, weight: 1 })
    expect(shares.head.yaw + shares.neck.yaw + shares.spine.yaw).toBeCloseTo(40)
  })
})

describe('actionLibrary', () => {
  it('动作库 = T-Pose + UAL 去掉 _RM 的 43 个原生动作，id 唯一、都在 UAL 元数据里', () => {
    expect(ACTION_LIBRARY[0].id).toBe(T_POSE_ACTION_ID)
    expect(ACTION_LIBRARY).toHaveLength(44)
    expect(new Set(ACTION_LIBRARY.map((entry) => entry.id)).size).toBe(44)
    const ualIds = new Set(UAL_ACTIONS.map((meta) => meta.id))
    for (const entry of ACTION_LIBRARY.slice(1)) {
      expect(ualIds.has(entry.id), entry.id).toBe(true)
      expect(entry.id.endsWith('_RM'), entry.id).toBe(false)
    }
  })

  it('循环 / 单次 / 单姿势：Sword_Idle 带 idle 标签按循环，零点几秒的瞄准按单姿势，受击按单次', () => {
    expect(findActionEntry('Sword_Idle')?.kind).toBe('loop')
    expect(findActionEntry('Pistol_Aim_Neutral')?.kind).toBe('pose')
    expect(findActionEntry('Hit_Chest')?.kind).toBe('once')
    expect(findActionEntry('Walk_Loop')?.kind).toBe('loop')
    expect(findActionEntry(T_POSE_ACTION_ID)?.kind).toBe('pose')
  })

  it('旧 Mixamo 动作 id 按施工计划 §3 对应表解析（读档迁移与别名同一张表）', () => {
    const table: Record<string, string> = {
      tpose: T_POSE_ACTION_ID,
      standing_idle: 'Idle_Loop',
      standard_walk: 'Walk_Loop',
      running: 'Jog_Fwd_Loop',
      male_sitting_pose_1: 'Sitting_Idle_Loop',
      male_sitting_pose: 'Crouch_Idle_Loop',
      kneeling: 'Fixing_Kneeling',
      kneeling_idle: 'Fixing_Kneeling',
      kneeling_down: 'Fixing_Kneeling',
      standing_up: 'Idle_Loop',
    }
    for (const [legacy, expected] of Object.entries(table)) expect(resolveActionAlias(legacy)?.id, legacy).toBe(expected)
    expect([...LEGACY_APPROXIMATE_ACTIONS].sort()).toEqual(['kneeling', 'kneeling_down', 'kneeling_idle', 'male_sitting_pose', 'standing_up'])
    for (const target of Object.values(ACTION_ALIASES)) expect(findActionEntry(target), target).toBeDefined()
  })

  it('resolves aliases and converts preset radians to degrees', () => {
    expect(resolveActionAlias('跑步')?.id).toBe('Jog_Fwd_Loop')
    expect(resolveActionAlias('Sitting')?.id).toBe('Sitting_Idle_Loop')
    expect(resolveActionAlias('idle_loop')?.id).toBe('Idle_Loop')
    expect(findActionEntry('Walk_Loop')?.clip).toBe('Walk_Loop')
    expect(legacyPoseToAction('single-knee')).toBe('Fixing_Kneeling')
    expect(legacyPoseToAction('squat')).toBeUndefined()
    const tpose = presetPoseRotations('t-pose')
    expect(tpose?.mixamorigLeftArm?.x).toBeCloseTo(-67.5, 1)
    expect(presetPoseRotations('nope')).toBeNull()
  })
})

describe('solveHeadAim 扣掉动作层已转过的头', () => {
  it('动作已经让头转向目标：只补差值；没转过（站立）时与原来一样；限幅仍按相对身体算', () => {
    const base = { headPosition: { x: 0, y: 1.6, z: 0 }, targetPosition: { x: 5, y: 1.6, z: 5 }, bodyYaw: 0, clampingAngle: 80, enablePitch: false, weight: 1 }
    expect(solveHeadAim(base).yaw).toBeCloseTo(45)
    expect(solveHeadAim({ ...base, currentHeadYaw: 0 }).yaw).toBeCloseTo(45)
    expect(solveHeadAim({ ...base, currentHeadYaw: 40 }).yaw).toBeCloseTo(5)
    expect(solveHeadAim({ ...base, currentHeadYaw: 60 }).yaw).toBeCloseTo(-15)
    expect(solveHeadAim({ ...base, currentHeadYaw: 350 }).yaw).toBeCloseTo(55)
    const far = solveHeadAim({ ...base, targetPosition: { x: 5, y: 1.6, z: -0.8816 }, clampingAngle: 80, currentHeadYaw: 30 })
    expect(far.yaw).toBeCloseTo(50)
    expect(far.weight).toBeGreaterThan(0)
  })
})

describe('solveHeadAim 左右对称', () => {
  it('目标在身体左侧：相对转角为负且不被 0–360 折成大角（权重不归零）', () => {
    // 身体朝 -68°，目标方位 -150° → 相对 -82°，夹到 -80°，超限 2° 只轻微衰减
    const aim = solveHeadAim({ headPosition: { x: 0, y: 1.6, z: 0 }, targetPosition: { x: -0.5, y: 1.6, z: -0.87 }, bodyYaw: -68, clampingAngle: 80, enablePitch: false, weight: 1 })
    expect(aim.yaw).toBe(-80)
    expect(aim.weight).toBeGreaterThan(0.9)
  })
  it('目标在身体右侧：相对转角为正', () => {
    const aim = solveHeadAim({ headPosition: { x: 0, y: 1.6, z: 0 }, targetPosition: { x: 1, y: 1.6, z: 1 }, bodyYaw: 0, clampingAngle: 80, enablePitch: false, weight: 1 })
    expect(aim.yaw).toBeCloseTo(45, 0)
    expect(aim.weight).toBe(1)
  })
})
