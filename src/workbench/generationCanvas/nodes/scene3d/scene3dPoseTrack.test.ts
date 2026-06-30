import { describe, it, expect } from 'vitest'
import { buildPoseTrack, samplePoseKeyframe, poseKeyframeKey, frameMotionSource } from './scene3dPoseTrack'
import type { Scene3DPoseKeyframe } from './scene3dTypes'

const crouch = { mixamorigSpine: [10, 0, 0] as [number, number, number] }
const wave = { mixamorigRightArm: [-40, 0, 0] as [number, number, number] }

describe('buildPoseTrack', () => {
  it('按 time 升序排序（录制事件可能乱序到达）', () => {
    const track = buildPoseTrack([
      { time: 2, presetId: 'wave', pose: wave },
      { time: 0, presetId: 'walk', pose: crouch },
      { time: 1, presetId: 'squat', pose: crouch },
    ])
    expect(track.map((k) => k.time)).toEqual([0, 1, 2])
    expect(track.map((k) => k.presetId)).toEqual(['walk', 'squat', 'wave'])
  })

  it('塌合连续同 preset（省得离屏反复重摆同一姿势）', () => {
    const track = buildPoseTrack([
      { time: 0, presetId: 'walk', pose: crouch },
      { time: 1, presetId: 'walk', pose: crouch },
      { time: 2, presetId: 'squat', pose: wave },
      { time: 3, presetId: 'squat', pose: wave },
      { time: 4, presetId: 'walk', pose: crouch },
    ])
    // walk(留最早的0) · squat(留最早的2) · walk(再次出现，留4)
    expect(track.map((k) => [k.time, k.presetId])).toEqual([
      [0, 'walk'],
      [2, 'squat'],
      [4, 'walk'],
    ])
  })

  it('连续 rest（presetId 缺省/无 pose）也塌合', () => {
    const track = buildPoseTrack([
      { time: 0, presetId: 'standing' },
      { time: 1, presetId: 'standing' },
    ])
    expect(track).toHaveLength(1)
    expect(track[0].time).toBe(0)
  })

  it('滤掉非有限/负时间戳', () => {
    const track = buildPoseTrack([
      { time: -1, presetId: 'walk', pose: crouch },
      { time: Number.NaN, presetId: 'squat', pose: wave },
      { time: 0.5, presetId: 'wave', pose: wave },
    ])
    expect(track.map((k) => k.time)).toEqual([0.5])
  })

  it('深 clone：改返回值的 pose 不污染输入', () => {
    const src = { time: 0, presetId: 'squat', pose: { mixamorigSpine: [10, 0, 0] as [number, number, number] } }
    const track = buildPoseTrack([src])
    track[0].pose!.mixamorigSpine[0] = 999
    expect(src.pose.mixamorigSpine[0]).toBe(10)
  })

  it('空输入 → 空轨道', () => {
    expect(buildPoseTrack([])).toEqual([])
  })

  it('同 time 不同 preset 保持稳定输入序', () => {
    const track = buildPoseTrack([
      { time: 1, presetId: 'a', pose: crouch },
      { time: 1, presetId: 'b', pose: wave },
    ])
    expect(track.map((k) => k.presetId)).toEqual(['a', 'b'])
  })
})

describe('samplePoseKeyframe（step-hold：取 time ≤ t 的最近一帧）', () => {
  const track: Scene3DPoseKeyframe[] = buildPoseTrack([
    { time: 0, presetId: 'walk', pose: crouch },
    { time: 2, presetId: 'squat', pose: wave },
    { time: 4, presetId: 'wave', pose: wave },
  ])

  it('t 早于首帧 → undefined（落回静态基准 pose）', () => {
    const before = buildPoseTrack([{ time: 1, presetId: 'walk', pose: crouch }])
    expect(samplePoseKeyframe(before, 0.5)).toBeUndefined()
  })

  it('t 命中关键帧时刻 → 该帧', () => {
    expect(samplePoseKeyframe(track, 2)?.presetId).toBe('squat')
  })

  it('t 在两帧之间 → 较早那帧（保持上一个动作）', () => {
    expect(samplePoseKeyframe(track, 1.9)?.presetId).toBe('walk')
    expect(samplePoseKeyframe(track, 3.9)?.presetId).toBe('squat')
  })

  it('t 超过末帧 → 末帧（保持最后动作）', () => {
    expect(samplePoseKeyframe(track, 99)?.presetId).toBe('wave')
  })

  it('空轨道 → undefined', () => {
    expect(samplePoseKeyframe([], 1)).toBeUndefined()
  })

  it('未排序输入也能正确取最近过去帧（不假设已排序）', () => {
    const messy: Scene3DPoseKeyframe[] = [
      { time: 4, presetId: 'wave', pose: wave },
      { time: 0, presetId: 'walk', pose: crouch },
      { time: 2, presetId: 'squat', pose: wave },
    ]
    expect(samplePoseKeyframe(messy, 3)?.presetId).toBe('squat')
  })
})

describe('poseKeyframeKey（离屏「只在边界换 pose」判重身份键）', () => {
  it('undefined 关键帧 → base', () => {
    expect(poseKeyframeKey(undefined)).toBe('base')
  })

  it('有 presetId → preset:<id>（同 preset 同 key，不重摆）', () => {
    expect(poseKeyframeKey({ time: 1, presetId: 'squat', pose: wave })).toBe('preset:squat')
    expect(poseKeyframeKey({ time: 9, presetId: 'squat', pose: crouch })).toBe('preset:squat')
  })

  it('无 presetId 但有 pose → 由 pose 形状决定，不同 pose 不同 key', () => {
    const a = poseKeyframeKey({ time: 1, pose: crouch })
    const b = poseKeyframeKey({ time: 1, pose: wave })
    expect(a).not.toBe(b)
    expect(a).toBe(poseKeyframeKey({ time: 5, pose: { mixamorigSpine: [10, 0, 0] } }))
  })

  it('无 presetId 无 pose → base', () => {
    expect(poseKeyframeKey({ time: 1 })).toBe('base')
  })
})

// locomotion 与 poseTrack 共存判定：静态动作打断走路；松开/没切就走路。
describe('frameMotionSource（离屏：该帧播 locomotion 还是静态 pose）', () => {
  const crouchTrack: Scene3DPoseKeyframe[] = buildPoseTrack([
    { time: 1, presetId: 'crouch', pose: crouch }, // 1s 切下蹲
  ])

  it('有 locomotionClip、无 poseTrack → 全程 locomotion（腿迈）', () => {
    expect(frameMotionSource(undefined, 'walk', 0)).toBe('locomotion')
    expect(frameMotionSource([], 'walk', 5)).toBe('locomotion')
  })

  it('有 locomotionClip，t 在切下蹲前 → locomotion（还没打断）', () => {
    expect(frameMotionSource(crouchTrack, 'walk', 0.5)).toBe('locomotion')
  })

  it('有 locomotionClip，t 落在下蹲段 → static-pose（静态优先，打断走路）', () => {
    expect(frameMotionSource(crouchTrack, 'walk', 1)).toBe('static-pose')
    expect(frameMotionSource(crouchTrack, 'walk', 3)).toBe('static-pose')
  })

  it('无 locomotionClip、无非 base 关键帧 → static-base（老行为零回归）', () => {
    expect(frameMotionSource(undefined, undefined, 2)).toBe('static-base')
    expect(frameMotionSource([], undefined, 2)).toBe('static-base')
  })

  it('无 locomotionClip 但命中非 base 关键帧 → static-pose（纯 poseTrack 路径不变）', () => {
    expect(frameMotionSource(crouchTrack, undefined, 2)).toBe('static-pose')
  })

  it('命中 base 关键帧（rest：无 preset 无 pose）+ locomotionClip → 回到 locomotion（松开静态动作就走路）', () => {
    const track = buildPoseTrack([
      { time: 0, presetId: 'crouch', pose: crouch },
      { time: 2 }, // 2s 松开回 rest（无 preset/无 pose = base）
    ])
    expect(frameMotionSource(track, 'walk', 1)).toBe('static-pose')
    expect(frameMotionSource(track, 'walk', 2)).toBe('locomotion')
    expect(frameMotionSource(track, 'walk', 3)).toBe('locomotion')
  })

  it('录制起点 seed 的 base 帧（presetId undefined）+ locomotionClip → 起步即 locomotion', () => {
    // useScene3DTakeRecorder 录制起点 seed {presetId: undefined, pose: startPose}；
    // 若 startPose 缺省（站立）则 key=base → 从 0s 起就走路。
    const track = buildPoseTrack([{ time: 0 }])
    expect(frameMotionSource(track, 'walk', 0)).toBe('locomotion')
  })
})

// 离屏确定性的核心保证（与真 WebGL 渲染解耦的可单测部分）：
// 离屏 stepper 每帧用 samplePoseKeyframe+poseKeyframeKey 算 key，仅 key 变化时才重摆骨架
// （applyMannequinSkeletonPose+groundMannequinModel，后者含全顶点遍历）。模拟那段去重循环，
// 断言「重摆次数 = 动作切换次数」（与帧数无关 → 不掉帧）+「key 只在边界变」（step-hold → 帧准、确定）。
describe('离屏 stepper 去重不变量', () => {
  function simulateRepose(track: Scene3DPoseKeyframe[], frameTimes: number[]): { reposeCount: number; keys: string[] } {
    let applied: string | null = null
    let reposeCount = 0
    const keys: string[] = []
    for (const t of frameTimes) {
      const key = poseKeyframeKey(samplePoseKeyframe(track, t))
      keys.push(key)
      if (key !== applied) {
        reposeCount += 1
        applied = key
      }
    }
    return { reposeCount, keys }
  }

  it('120 帧、3 段动作 → 仅重摆 3 次（不随帧数膨胀）', () => {
    const track = buildPoseTrack([
      { time: 0, presetId: 'walk', pose: crouch },
      { time: 2, presetId: 'squat', pose: wave },
      { time: 3.5, presetId: 'wave', pose: wave },
    ])
    // 0..5s，120 帧（24fps×5s），均匀采样
    const frameTimes = Array.from({ length: 120 }, (_, i) => (i / 119) * 5)
    const { reposeCount } = simulateRepose(track, frameTimes)
    expect(reposeCount).toBe(3)
  })

  it('同一输入两次模拟逐键一致（确定性，无 wall-clock/随机）', () => {
    const track = buildPoseTrack([
      { time: 0, presetId: 'walk', pose: crouch },
      { time: 1, presetId: 'squat', pose: wave },
    ])
    const frameTimes = Array.from({ length: 48 }, (_, i) => (i / 47) * 2)
    const a = simulateRepose(track, frameTimes)
    const b = simulateRepose(track, frameTimes)
    expect(a.keys).toEqual(b.keys)
    expect(a.reposeCount).toBe(b.reposeCount)
  })

  it('整段无切换（单关键帧）→ 仅重摆 1 次', () => {
    const track = buildPoseTrack([{ time: 0, presetId: 'squat', pose: wave }])
    const { reposeCount } = simulateRepose(track, Array.from({ length: 60 }, (_, i) => i / 12))
    expect(reposeCount).toBe(1)
  })

  it('key 序列单调按边界推进（step-hold：到下一关键帧前不变）', () => {
    const track = buildPoseTrack([
      { time: 0, presetId: 'walk', pose: crouch },
      { time: 2, presetId: 'squat', pose: wave },
    ])
    const { keys } = simulateRepose(track, [0, 0.5, 1.99, 2, 2.5])
    expect(keys).toEqual(['preset:walk', 'preset:walk', 'preset:walk', 'preset:squat', 'preset:squat'])
  })
})
