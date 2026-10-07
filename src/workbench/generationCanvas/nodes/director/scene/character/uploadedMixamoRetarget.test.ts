import * as THREE from 'three'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { RIG_BONE_MAPS, SEMANTIC_BONES, type SemanticBone } from '../../model/rigs'
import { UAL_FRAME_CORRECTION } from './canonicalBoneFrame'
import { MANNEQUIN_REST_ROTATION_KEY } from './mannequinSkeleton'
import { loadPoseClipsFrom, poseClipSourceBind, samplePoseClip } from './poseClipLibrary'
import { applyPoseSnapshot, baseBoneName, bindWorldQuaternionsByBaseName, HIPS_BASE_NAME, indexBonesByBaseName } from './poseSnapshot'
import { loadUalMannequinForTest } from './ualMannequin.testkit'

vi.mock('../../../../../../desktop/rendererLog', () => ({ logRendererError: () => {}, logRendererWarn: () => {} }))

// 用户上传的 Mixamo 角色吃 UAL 动作（读档迁移只换动作 id，骨架不动）。仓库里已没有 Mixamo 模型（x-bot 已删），
// 这里照修正表里入库的 Mixamo 绑定朝向合成一副 Mixamo 命名骨架（Armature 外层 +90°X、骨盆 −90°X，与 Mixamo 导出同构），真实上传模型的效果另记 unverified。
const PARENT: Partial<Record<SemanticBone, SemanticBone>> = {
  spine: 'hips', spine1: 'spine', spine2: 'spine1', neck: 'spine2', head: 'neck',
  leftShoulder: 'spine2', leftArm: 'leftShoulder', leftForeArm: 'leftArm', leftHand: 'leftForeArm',
  rightShoulder: 'spine2', rightArm: 'rightShoulder', rightForeArm: 'rightArm', rightHand: 'rightForeArm',
  leftUpLeg: 'hips', leftLeg: 'leftUpLeg', leftFoot: 'leftLeg', leftToeBase: 'leftFoot',
  rightUpLeg: 'hips', rightLeg: 'rightUpLeg', rightFoot: 'rightLeg', rightToeBase: 'rightFoot',
}

function syntheticMixamo(): THREE.Group {
  const root = new THREE.Group()
  const armature = new THREE.Object3D()
  armature.name = 'Armature'
  armature.quaternion.setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0))
  root.add(armature)
  const armatureWorld = armature.quaternion.clone()
  const bones = new Map<SemanticBone, THREE.Bone>()
  for (const semantic of SEMANTIC_BONES) {
    const bone = new THREE.Bone()
    bone.name = RIG_BONE_MAPS.mixamo[semantic].replace('mixamorig', 'mixamorig:')
    const parent = PARENT[semantic]
    const parentWorld = parent ? new THREE.Quaternion().fromArray(UAL_FRAME_CORRECTION.bones[parent].canonicalBindWorld) : armatureWorld.clone()
    bone.quaternion.copy(parentWorld.invert().multiply(new THREE.Quaternion().fromArray(UAL_FRAME_CORRECTION.bones[semantic].canonicalBindWorld)))
    // 骨盆世界高 1.04：Armature 绕 X 转了 +90°，局部 (0,0,-1.04) 才落在世界 (0,1.04,0)；其它骨给个非零长度（只为让父子链有长度，不影响朝向断言）
    if (semantic === 'hips') bone.position.set(0, 0, -1.04)
    else bone.position.set(0, 0.1, 0)
    ;(parent ? bones.get(parent)! : armature).add(bone)
    bones.set(semantic, bone)
  }
  root.traverse((object) => {
    if ((object as THREE.Bone).isBone) object.userData[MANNEQUIN_REST_ROTATION_KEY] = [object.rotation.x, object.rotation.y, object.rotation.z]
  })
  root.updateMatrixWorld(true)
  return root
}

/** 相对 root 的累积朝向 */
function rootRelative(object: THREE.Object3D, root: THREE.Object3D): THREE.Quaternion {
  const chain: THREE.Object3D[] = []
  for (let node: THREE.Object3D | null = object; node && node !== root; node = node.parent) chain.unshift(node)
  return chain.reduce((acc, node) => acc.multiply(node.quaternion), new THREE.Quaternion())
}

describe('上传的 Mixamo 角色吃 UAL 动作（合成 Mixamo 骨架 + 真 UAL glb）', () => {
  beforeAll(async () => {
    loadPoseClipsFrom(await loadUalMannequinForTest())
  })

  it('Mixamo 骨名（带冒号）与 UAL 骨名落在同一套基名上，22 根语义骨一一对应', () => {
    for (const semantic of SEMANTIC_BONES) expect(baseBoneName(RIG_BONE_MAPS.mixamo[semantic].replace('mixamorig', 'mixamorig:'))).toBe(baseBoneName(RIG_BONE_MAPS.ual[semantic]))
  })

  for (const [actionId, time] of [['Walk_Loop', 0.4], ['Sitting_Idle_Loop', 0.8], ['Punch_Jab', 0.3]] as const) {
    it(`${actionId}：22 根语义骨的世界朝向变化与 UAL 源骨架一致（< 0.5°）`, () => {
      const target = syntheticMixamo()
      const bones = indexBonesByBaseName(target)
      const targetBind = bindWorldQuaternionsByBaseName(target)
      const sourceBind = poseClipSourceBind(actionId)!
      const sample = samplePoseClip(actionId, time)!
      const restHips = bones.get(HIPS_BASE_NAME)!.position.clone()
      applyPoseSnapshot(bones, sample, { weight: 1, sourceBind, targetBindWorld: targetBind, root: target, restHips })
      target.updateMatrixWorld(true)
      for (const semantic of SEMANTIC_BONES) {
        const key = baseBoneName(RIG_BONE_MAPS.ual[semantic])
        const sourceDelta = sample.get(key)!.world.clone().multiply(sourceBind.get(key)!.world.clone().invert())
        const bone = bones.get(key)!
        const targetDelta = rootRelative(bone, target).multiply(targetBind.get(key)!.clone().invert())
        expect(sourceDelta.angleTo(targetDelta), `${actionId} ${semantic}`).toBeLessThan((0.5 * Math.PI) / 180)
      }
    })
  }

  it('坐姿的骨盆下沉换算到 Mixamo 骨架（Armature 外层转了 90°）：骨盆竖直方向变低', () => {
    const target = syntheticMixamo()
    const bones = indexBonesByBaseName(target)
    const hips = bones.get(HIPS_BASE_NAME)!
    const restHips = hips.position.clone()
    applyPoseSnapshot(bones, samplePoseClip('Sitting_Idle_Loop', 0.8)!, { weight: 1, sourceBind: poseClipSourceBind('Sitting_Idle_Loop')!, targetBindWorld: bindWorldQuaternionsByBaseName(target), root: target, restHips })
    target.updateMatrixWorld(true)
    const worldY = hips.getWorldPosition(new THREE.Vector3()).y
    expect(worldY).toBeLessThan(1.04 - 0.3)
    expect(worldY).toBeGreaterThan(0.2)
  })
})
