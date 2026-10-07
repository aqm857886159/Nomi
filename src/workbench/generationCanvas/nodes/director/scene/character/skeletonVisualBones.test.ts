import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { boneChainOf, isVisualBone } from './skeletonVisualBones'
import { loadUalMannequinForTest } from './ualMannequin.testkit'

describe('骨骼可视化规则（Mixamo 与 UAL 同一条）', () => {
  it('手指 / 末端 / 骨架根不画，躯干四肢都画', () => {
    for (const name of ['mixamorigLeftHandIndex1', 'mixamorig:RightHandThumb2', 'mixamorigHeadTop_End', 'mixamorigLeftToe_End', 'DEF-f_index01L', 'DEF-thumb03R', 'DEF-f_pinky02L', 'root']) expect(isVisualBone(name), name).toBe(false)
    for (const name of ['mixamorigHips', 'mixamorigLeftArm', 'mixamorigLeftToeBase', 'DEF-hips', 'DEF-spine003', 'DEF-upper_armL', 'DEF-shinR', 'DEF-toeL', 'DEF-head']) expect(isVisualBone(name), name).toBe(true)
  })

  it('配色链：UAL 的 thigh / shin 归腿、upper_arm / forearm 归手臂（不按 Mixamo 字面名）', () => {
    expect(boneChainOf('DEF-thighL')).toBe('leg')
    expect(boneChainOf('DEF-shinR')).toBe('leg')
    expect(boneChainOf('DEF-footL')).toBe('leg')
    expect(boneChainOf('DEF-upper_armR')).toBe('arm')
    expect(boneChainOf('DEF-forearmL')).toBe('arm')
    expect(boneChainOf('DEF-shoulderL')).toBe('arm')
    expect(boneChainOf('DEF-spine002')).toBe('spine')
    expect(boneChainOf('mixamorigLeftUpLeg')).toBe('leg')
    expect(boneChainOf('mixamorigRightForeArm')).toBe('arm')
  })

  it('真 UAL 骨架：画 22 根（6 躯干 + 双侧肩臂手 8 + 双侧腿脚趾 8），手指 30 根全跳过', async () => {
    const { scene } = await loadUalMannequinForTest()
    const drawn: string[] = []
    scene.traverse((object) => {
      if ((object as THREE.Bone).isBone && isVisualBone(object.name)) drawn.push(object.name)
    })
    expect(drawn).toHaveLength(22)
  })
})
