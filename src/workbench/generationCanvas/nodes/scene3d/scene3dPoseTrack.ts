import type { Scene3DPoseKeyframe, Scene3DVector3 } from './scene3dTypes'

// pose-over-time 纯函数层（零 THREE / 零常量依赖，便于单测）。
// 录 take 时把每次切动作记成 {time, presetId, pose} 事件，经 buildPoseTrack 归一成关键帧序列；
// 回放/离屏在时刻 t 用 samplePoseKeyframe 取「当前生效」的关键帧（step-hold，不插值——
// 动作是离散切换，给 previz 木偶在蹲/挥手之间做线性插值无意义，step-hold 也让离屏确定性平凡）。

// 录制事件（recorder 产物的输入形态）。time 为绝对场景时间轴秒。
export type Scene3DPoseEvent = {
  time: number
  presetId?: string
  pose?: Record<string, Scene3DVector3>
}

function clonePose(pose?: Record<string, Scene3DVector3>): Record<string, Scene3DVector3> | undefined {
  if (!pose) return undefined
  return Object.fromEntries(
    Object.entries(pose).map(([boneName, rotation]) => [boneName, [...rotation] as Scene3DVector3]),
  )
}

// 关键帧的稳定身份键：连续同 key 段塌合成一帧，离屏据此「只在边界重摆骨架」。
// presetId 优先（同 preset 视为同一动作，即便 pose 数值有别）；否则由 pose 形状决定；都无 → base（rest）。
export function poseKeyframeKey(keyframe: Scene3DPoseKeyframe | Scene3DPoseEvent | undefined): string {
  if (!keyframe) return 'base'
  if (keyframe.presetId) return `preset:${keyframe.presetId}`
  if (keyframe.pose && Object.keys(keyframe.pose).length > 0) {
    const shape = Object.entries(keyframe.pose)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([bone, rot]) => `${bone}:${rot.join(',')}`)
      .join('|')
    return `pose:${shape}`
  }
  return 'base'
}

// 录制事件 → 归一关键帧序列：滤非法时间 → 升序稳定排序 → 塌合连续同 key → 深 clone。
export function buildPoseTrack(events: ReadonlyArray<Scene3DPoseEvent>): Scene3DPoseKeyframe[] {
  const valid = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => Number.isFinite(event.time) && event.time >= 0)
  // 稳定排序：time 相同保持输入序（录制先后）。
  valid.sort((a, b) => (a.event.time - b.event.time) || (a.index - b.index))

  const track: Scene3DPoseKeyframe[] = []
  let lastKey: string | null = null
  for (const { event } of valid) {
    const key = poseKeyframeKey(event)
    if (key === lastKey) continue // 连续同动作：上一帧已 hold，跳过冗余
    lastKey = key
    track.push({
      time: event.time,
      presetId: event.presetId,
      pose: clonePose(event.pose),
    })
  }
  return track
}

// 某帧的「动作来源」判定（纯逻辑，离屏 locomotion 与 poseTrack 共存的单一真相）：
// - 'static-pose'：该时刻 poseTrack 命中非 base 关键帧（用户切了静态动作，如下蹲）→ 静态姿势优先，
//   打断走路动画（pose 取该关键帧的 pose）。
// - 'locomotion'：有 locomotionClip 且当前未被静态动作打断 → 播 locomotion clip（腿迈）。
// - 'static-base'：既无 locomotion 也未命中非 base 关键帧 → 老行为，落回静态基准 pose。
// 复用 samplePoseKeyframe + poseKeyframeKey 判 base，不另立口径。
export type Scene3DFrameMotionSource = 'locomotion' | 'static-pose' | 'static-base'

export function frameMotionSource(
  track: ReadonlyArray<Scene3DPoseKeyframe> | undefined,
  locomotionClip: string | undefined,
  time: number,
): Scene3DFrameMotionSource {
  const keyframe = track && track.length > 0 ? samplePoseKeyframe(track, time) : undefined
  const poseInterrupts = poseKeyframeKey(keyframe) !== 'base'
  if (poseInterrupts) return 'static-pose'
  if (locomotionClip) return 'locomotion'
  return 'static-base'
}

// 时刻 t 当前生效的关键帧（step-hold：time ≤ t 的最近一帧）。
// t 早于首帧 / 空轨道 → undefined（调用方落回静态基准 pose）。不假设已排序。
export function samplePoseKeyframe(
  track: ReadonlyArray<Scene3DPoseKeyframe>,
  time: number,
): Scene3DPoseKeyframe | undefined {
  let best: Scene3DPoseKeyframe | undefined
  for (const keyframe of track) {
    if (keyframe.time > time) continue
    if (!best || keyframe.time > best.time) best = keyframe
  }
  return best
}
