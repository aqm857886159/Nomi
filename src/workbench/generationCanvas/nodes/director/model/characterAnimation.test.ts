import { describe, expect, it } from 'vitest'
import { findActionEntry, legacyPoseToAction, resolveActionAlias } from './actionLibrary'
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
  it('resolves aliases and converts preset radians to degrees', () => {
    expect(resolveActionAlias('跑步')?.id).toBe('running')
    expect(resolveActionAlias('Sitting')?.id).toBe('male_sitting_pose_1')
    expect(findActionEntry('standard_walk')?.file).toBe('StandardWalk')
    expect(legacyPoseToAction('single-knee')).toBe('kneeling')
    expect(legacyPoseToAction('squat')).toBeUndefined()
    const tpose = presetPoseRotations('t-pose')
    expect(tpose?.mixamorigLeftArm?.x).toBeCloseTo(-67.5, 1)
    expect(presetPoseRotations('nope')).toBeNull()
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
