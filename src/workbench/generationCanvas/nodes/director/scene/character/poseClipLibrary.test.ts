import * as THREE from 'three'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ACTION_LIBRARY, findActionEntry, T_POSE_ACTION_ID } from '../../model/actionLibrary'
import { actionSampleTime, loadPoseClipsFrom, poseClipSourceBind, poseClipStatus, samplePoseClip } from './poseClipLibrary'
import type { PoseSnapshot } from './poseSnapshot'
import { loadUalMannequinForTest } from './ualMannequin.testkit'

vi.mock('../../../../../../desktop/rendererLog', () => ({ logRendererError: () => {}, logRendererWarn: () => {} }))

/** 两份快照逐骨最大角差（弧度） */
function maxAngle(a: PoseSnapshot, b: PoseSnapshot): number {
  let max = 0
  for (const [key, bone] of a) {
    const other = b.get(key)
    if (other) max = Math.max(max, bone.world.angleTo(other.world))
  }
  return max
}
const clone = (snapshot: PoseSnapshot): PoseSnapshot => new Map([...snapshot].map(([key, bone]) => [key, { quaternion: bone.quaternion.clone(), position: bone.position.clone(), world: bone.world.clone() }]))

describe('poseClipLibrary（真 UAL glb，一个文件出全部动作）', () => {
  beforeAll(async () => {
    loadPoseClipsFrom(await loadUalMannequinForTest())
  })

  it('43 个动作都能在 glb 里找到并采到快照；T-Pose 恒为绑定姿态', () => {
    for (const entry of ACTION_LIBRARY) {
      if (entry.id === T_POSE_ACTION_ID) {
        expect(poseClipStatus(entry.id)).toBe('missing')
        expect(samplePoseClip(entry.id, 1)).toBeNull()
        continue
      }
      expect(poseClipStatus(entry.id), entry.id).toBe('ready')
      const snapshot = samplePoseClip(entry.id, 0.1)
      expect(snapshot?.get('hips'), entry.id).toBeDefined()
      expect(snapshot?.get('leftarm'), entry.id).toBeDefined()
      expect(poseClipSourceBind(entry.id)).not.toBeNull()
    }
    expect(poseClipStatus('standing_idle')).toBe('missing')
  })

  it('循环动作按时长取模：t 与 t + 时长 同一姿态', () => {
    const entry = findActionEntry('Walk_Loop')!
    const a = clone(samplePoseClip(entry.id, 0.3)!)
    const b = samplePoseClip(entry.id, 0.3 + entry.durationSec * 3)!
    expect(maxAngle(a, b)).toBeLessThan(2e-3)
    const mid = samplePoseClip(entry.id, 0.3 + entry.durationSec / 2)!
    expect(maxAngle(a, mid)).toBeGreaterThan(0.05)
  })

  it('单次动作夹在末帧：超出时长后一直是末帧，不回到开头循环抖动', () => {
    for (const id of ['Hit_Chest', 'Death01', 'Pistol_Aim_Neutral']) {
      const entry = findActionEntry(id)!
      expect(entry.kind).not.toBe('loop')
      const end = clone(samplePoseClip(id, entry.durationSec)!)
      const later = samplePoseClip(id, entry.durationSec + 7.3)!
      expect(maxAngle(end, later), id).toBeLessThan(2e-3)
    }
    const death = findActionEntry('Death01')!
    const start = clone(samplePoseClip('Death01', 0)!)
    expect(maxAngle(start, samplePoseClip('Death01', death.durationSec + 1)!)).toBeGreaterThan(0.2)
  })

  it('同一时刻交替采两个动作互不干扰（每个动作自己一副源骨架）', () => {
    const walk = clone(samplePoseClip('Walk_Loop', 0.4)!)
    samplePoseClip('Sitting_Idle_Loop', 0.4)
    expect(maxAngle(walk, samplePoseClip('Walk_Loop', 0.4)!)).toBeLessThan(2e-3)
  })

  it('actionSampleTime：循环取模（含负时刻）、非循环夹到 [0, 时长]', () => {
    expect(actionSampleTime({ kind: 'loop' }, 2, 5)).toBeCloseTo(1)
    expect(actionSampleTime({ kind: 'loop' }, 2, -0.5)).toBeCloseTo(1.5)
    expect(actionSampleTime({ kind: 'once' }, 2, 5)).toBe(2)
    expect(actionSampleTime({ kind: 'once' }, 2, -1)).toBe(0)
    expect(actionSampleTime({ kind: 'pose' }, 0.16, 3)).toBeCloseTo(0.16)
  })

  it('源 bind 快照是 T 字绑定姿态：左右上臂沿 ±X 张开', () => {
    const bind = poseClipSourceBind('Idle_Loop')!
    const left = new THREE.Vector3(0, 1, 0).applyQuaternion(bind.get('leftarm')!.world)
    const right = new THREE.Vector3(0, 1, 0).applyQuaternion(bind.get('rightarm')!.world)
    expect(Math.abs(left.x)).toBeGreaterThan(0.9)
    expect(Math.sign(left.x)).toBe(-Math.sign(right.x))
  })
})
