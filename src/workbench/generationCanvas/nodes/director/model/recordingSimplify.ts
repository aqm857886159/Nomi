/**
 * [INPUT]: 依赖 ./directorTypes 的 Vec3 / Waypoint、./vec3 的 distance、./timeGrid 的 secondsToFrame
 * [OUTPUT]: 对外提供 CameraMotionSample、SAMPLE_THRESHOLDS、shouldRecordSample、simplifySamplesToWaypoints、isRecordingTooShort
 * [POS]: director/model 的录制运镜采样与简化（清单 §6 C2）：录制时按位移/角度/时间阈值决定是否记样本，停止时把
 *        原始样本简化成可编辑的关键帧路标；V1 的 takeRecording 保留全部样本，
 *        这里的简化是 V2 新能力（方案 §11 P1）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { Vec3, Waypoint } from './directorTypes'
import { secondsToFrame } from './timeGrid'
import { distance } from './vec3'

export type CameraMotionSample = {
  time: number
  position: Vec3
  yaw: number
  pitch: number
  roll: number
  fov: number
}

// 录制时的采样闸：位移 ≥2cm 或 yaw/pitch ≥0.5° 或 距上一样本 ≥1 帧
export const SAMPLE_THRESHOLDS = { distance: 0.02, angleDeg: 0.5 } as const

export function shouldRecordSample(previous: CameraMotionSample | undefined, next: CameraMotionSample, frameSeconds: number): boolean {
  if (!previous) return true
  const moved = distance(previous.position, next.position) >= SAMPLE_THRESHOLDS.distance
  const turned = Math.abs(next.yaw - previous.yaw) >= SAMPLE_THRESHOLDS.angleDeg || Math.abs(next.pitch - previous.pitch) >= SAMPLE_THRESHOLDS.angleDeg
  const aged = next.time - previous.time >= frameSeconds
  return moved || turned || aged
}

// 录制 <0.3s 且位移 <5cm 且样本 <3 视为误触
export function isRecordingTooShort(samples: CameraMotionSample[], cumulativeDistance: number): boolean {
  if (samples.length === 0) return true
  const span = samples[samples.length - 1].time - samples[0].time
  return span < 0.3 && cumulativeDistance < 0.05 && samples.length < 3
}

// 简化阈值：转向 >6° / 俯仰 >4° / 位移 >0.6m 且距上一关键帧 ≥0.25s；或每 0.5s 强制留一帧；首尾必留
export const SIMPLIFY_THRESHOLDS = { yawDeg: 6, pitchDeg: 4, distance: 0.6, minInterval: 0.25, maxInterval: 0.5 } as const

function toWaypoint(sample: CameraMotionSample, id: string, clipId: string): Waypoint {
  return {
    id,
    x: sample.position.x,
    y: sample.position.y,
    z: sample.position.z,
    yaw: sample.yaw,
    pitch: sample.pitch,
    roll: sample.roll,
    time: sample.time,
    frameIndex: secondsToFrame(sample.time),
    clipId,
  }
}

export function simplifySamplesToWaypoints(samples: CameraMotionSample[], clipId: string, makeId: () => string): Waypoint[] {
  if (samples.length === 0) return []
  if (samples.length === 1) return [toWaypoint(samples[0], makeId(), clipId)]
  const result: Waypoint[] = [toWaypoint(samples[0], makeId(), clipId)]
  let kept = samples[0]
  for (let i = 1; i < samples.length - 1; i += 1) {
    const sample = samples[i]
    const dt = sample.time - kept.time
    const bigChange =
      Math.abs(sample.yaw - kept.yaw) > SIMPLIFY_THRESHOLDS.yawDeg ||
      Math.abs(sample.pitch - kept.pitch) > SIMPLIFY_THRESHOLDS.pitchDeg ||
      distance(kept.position, sample.position) > SIMPLIFY_THRESHOLDS.distance
    if ((bigChange && dt >= SIMPLIFY_THRESHOLDS.minInterval) || dt >= SIMPLIFY_THRESHOLDS.maxInterval) {
      result.push(toWaypoint(sample, makeId(), clipId))
      kept = sample
    }
  }
  const last = samples[samples.length - 1]
  if (result.length === 1 || last.time - result[result.length - 1].time >= 0.05) {
    result.push(toWaypoint(last, makeId(), clipId))
  }
  return result
}
