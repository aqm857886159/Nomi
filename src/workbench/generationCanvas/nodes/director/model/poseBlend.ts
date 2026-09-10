/**
 * [INPUT]: 依赖 ./directorTypes（ActionClip / BoneKeyframe / Vec3）、./timeGrid 的 FRAME_EPSILON
 * [OUTPUT]: 对外提供 ACTION_FADE_SECONDS / ACTION_GAP_BLEND_SECONDS / ACTION_PREVIOUS_CROSS_SECONDS、ActionBlend、resolveActionBlend、PoseSample、resolvePoseKeyframes、blendBoneRotations
 * [POS]: director/model 的动作混合纯数学：时刻 t 落在哪段动作、以多大权重、和上一段怎么交叉；
 *        custom_pose 片段内关键帧对与插值系数。真正的四元数 slerp 在 scene 层做，这里给出「谁和谁、多少」。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ActionClip, BoneKeyframe, Vec3 } from './directorTypes'
import { FRAME_EPSILON } from './timeGrid'

export const ACTION_FADE_SECONDS = 0.25
export const ACTION_GAP_BLEND_SECONDS = 0.5
/** 上一片段结束到本片段开始的间隙小于它，才从上一片段末帧交叉淡入（否则从静止预设淡入）—— 0.2 */
export const ACTION_PREVIOUS_CROSS_SECONDS = 0.2

export type ActionBlend = {
  clip: ActionClip | null
  // clip 的权重（0–1）；余下权重给 previous，previous 也没有就给静止姿态
  weight: number
  // clip 内的本地时间（循环动作按 clip 时长取模在 scene 层做）
  localTime: number
  previous: ActionClip | null
  previousWeight: number
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))
const isCustom = (clip: ActionClip): boolean => clip.clipType === 'custom_pose'

// 时刻 t 的动作片段与混合权重：
//   片段内：头 0.25s 淡入——上一片段挨得近（<0.2s）且不是姿态片段就从它末帧交叉，否则从静止预设；片段尾**不**淡出
//   片段外：相邻两段（都非姿态片段）间隙 ≤0.5s 时按间隙位置交叉；否则上一片段结束后 0.25s 内从它末帧淡回静止预设
export function resolveActionBlend(clips: ActionClip[], time: number): ActionBlend {
  const sorted = [...clips].sort((a, b) => a.startTime - b.startTime)
  const current = sorted.find((clip) => time >= clip.startTime - FRAME_EPSILON && time <= clip.endTime + FRAME_EPSILON) ?? null
  if (current) {
    const index = sorted.indexOf(current)
    const previous = index > 0 ? sorted[index - 1] : null
    const localTime = Math.max(0, time - current.startTime)
    if (isCustom(current) || localTime >= ACTION_FADE_SECONDS) return { clip: current, weight: 1, localTime, previous: null, previousWeight: 0 }
    const weight = clamp01(localTime / ACTION_FADE_SECONDS)
    const crossFromPrevious = previous !== null && !isCustom(previous) && current.startTime - previous.endTime < ACTION_PREVIOUS_CROSS_SECONDS
    return { clip: current, weight, localTime, previous: crossFromPrevious ? previous : null, previousWeight: crossFromPrevious ? 1 - weight : 0 }
  }
  const before = sorted.filter((clip) => clip.endTime < time).pop() ?? null
  const after = sorted.find((clip) => clip.startTime > time) ?? null
  if (before && after && !isCustom(before) && !isCustom(after) && after.startTime - before.endTime <= ACTION_GAP_BLEND_SECONDS) {
    const alpha = clamp01((time - before.endTime) / Math.max(FRAME_EPSILON, after.startTime - before.endTime))
    return { clip: after, weight: alpha, localTime: 0, previous: before, previousWeight: 1 - alpha }
  }
  if (before && !isCustom(before) && time - before.endTime < ACTION_FADE_SECONDS) {
    const weight = 1 - clamp01((time - before.endTime) / ACTION_FADE_SECONDS)
    return { clip: before, weight, localTime: before.endTime - before.startTime, previous: null, previousWeight: 0 }
  }
  return { clip: null, weight: 0, localTime: 0, previous: null, previousWeight: 0 }
}

export type PoseSample = { a: BoneKeyframe | null; b: BoneKeyframe | null; alpha: number }

// custom_pose 片段在 t 处的关键帧对：首帧之前停在首帧，末帧之后停在末帧，中间给出 a→b 的插值系数
export function resolvePoseKeyframes(clip: ActionClip, time: number): PoseSample {
  const frames = [...(clip.keyframes ?? [])].sort((a, b) => a.time - b.time)
  if (frames.length === 0) return { a: null, b: null, alpha: 0 }
  if (time <= frames[0].time) return { a: frames[0], b: null, alpha: 0 }
  const last = frames[frames.length - 1]
  if (time >= last.time) return { a: last, b: null, alpha: 0 }
  for (let index = 0; index < frames.length - 1; index += 1) {
    const a = frames[index]
    const b = frames[index + 1]
    if (time >= a.time && time <= b.time) {
      const span = Math.max(FRAME_EPSILON, b.time - a.time)
      return { a, b, alpha: clamp01((time - a.time) / span) }
    }
  }
  return { a: last, b: null, alpha: 0 }
}

function lerpDeg(from: number, to: number, alpha: number): number {
  let delta = ((to - from + 540) % 360) - 180
  if (delta < -180) delta += 360
  return from + delta * alpha
}

// 欧拉度的逐骨插值（纯层 / 单测用；scene 层用四元数 slerp 得到同样的端点）
export function blendBoneRotations(a: Record<string, Vec3>, b: Record<string, Vec3>, alpha: number): Record<string, Vec3> {
  const result: Record<string, Vec3> = {}
  const bones = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const bone of bones) {
    const from = a[bone] ?? { x: 0, y: 0, z: 0 }
    const to = b[bone] ?? { x: 0, y: 0, z: 0 }
    result[bone] = { x: lerpDeg(from.x, to.x, alpha), y: lerpDeg(from.y, to.y, alpha), z: lerpDeg(from.z, to.z, alpha) }
  }
  return result
}
