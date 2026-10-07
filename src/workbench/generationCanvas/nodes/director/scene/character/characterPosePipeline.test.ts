import * as THREE from 'three'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { DirectorObject } from '../../model/directorTypes'
import { prepareCharacterModel } from './characterAsset'
import { createCharacterPoseContext, poseCharacterFrame } from './characterPosePipeline'
import { loadPoseClipsFrom, samplePoseClip } from './poseClipLibrary'
import { loadUalMannequinForTest } from './ualMannequin.testkit'

vi.mock('../../../../../../desktop/rendererLog', () => ({ logRendererError: () => {}, logRendererWarn: () => {} }))

let scene: THREE.Object3D
beforeAll(async () => {
  const gltf = await loadUalMannequinForTest()
  loadPoseClipsFrom(gltf)
  scene = gltf.scene
})

const person = (posePreset: string, actionPose = 'Walk_Loop', startTime = 0): DirectorObject => ({
  id: 'p', name: 'p', type: 'character', rig: 'ual', modelPath: 'builtin:ual',
  position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: true, locked: false,
  posePreset,
  actionClips: [{ id: 'c', name: 'c', clipType: 'action', actionPose, startTime, endTime: startTime + 10, startFrame: 0, endFrame: 300 }],
})

/** 一帧之后全部骨的局部四元数 + 骨盆位置 */
function poseAfterFrame(object: DirectorObject, time: number): number[] {
  const context = createCharacterPoseContext(prepareCharacterModel(scene, { builtin: true, rig: 'ual' }).object)
  poseCharacterFrame(context, object, time, { keepBasePose: false })
  return [...context.allBones.flatMap((bone) => bone.quaternion.toArray()), ...context.baseBones.get('hips')!.position.toArray()]
}

const maxDiff = (a: number[], b: number[]) => Math.max(...a.map((value, index) => Math.abs(value - b[index])))

describe('姿态管线的群众快路径不改结果', () => {
  it('动作片段满权重时静止预设不起作用：坐姿预设与 T 字预设下的走路姿态逐骨相同（跳过预设套骨是等价的）', () => {
    expect(maxDiff(poseAfterFrame(person('Sitting_Idle_Loop'), 2), poseAfterFrame(person('tpose'), 2))).toBeLessThan(1e-9)
  })

  it('片段淡入中（头 0.25 秒）静止预设仍参与：结果随预设不同', () => {
    expect(maxDiff(poseAfterFrame(person('Sitting_Idle_Loop', 'Walk_Loop', 1), 1.1), poseAfterFrame(person('tpose', 'Walk_Loop', 1), 1.1))).toBeGreaterThan(0.01)
  })

  it('同一动作同一时刻：100 人共用一份采样；换时刻就重采', () => {
    const a = samplePoseClip('Walk_Loop', 0.5)
    expect(samplePoseClip('Walk_Loop', 0.5)).toBe(a)
    expect(samplePoseClip('Walk_Loop', 0.5 + 1 / 30)).not.toBe(a)
  })

  it('keepBasePose = false 不碰 basePose；true 时当帧就是动作层之后的姿态', () => {
    const context = createCharacterPoseContext(prepareCharacterModel(scene, { builtin: true, rig: 'ual' }).object)
    poseCharacterFrame(context, person('Idle_Loop'), 2, { keepBasePose: false })
    expect(context.basePose.size).toBe(0)
    poseCharacterFrame(context, person('Idle_Loop'), 2)
    expect(context.basePose.size).toBe(context.allBones.length)
    for (const bone of context.allBones) expect(context.basePose.get(bone)!.angleTo(bone.quaternion)).toBeLessThan(1e-6)
  })
})
