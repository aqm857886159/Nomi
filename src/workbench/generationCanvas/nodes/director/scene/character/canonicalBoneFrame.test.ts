import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import ualRigReference from '../../../../../../assets/director/ual/ual-rig.json'
import { RIG_BONE_MAPS, SEMANTIC_BONES, type SemanticBone } from '../../model/rigs'
import { attachCanonicalBoneFrames, UAL_FRAME_CORRECTION } from './canonicalBoneFrame'
import { applyBoneRotationOffsets, applyLookAtOffsets, findBoneByName, findSemanticBone, indexBones, offsetFromBase, type BoneIndex } from './characterRig'
import { baseBoneName, UAL_BASE_NAME_ALIASES } from './poseSnapshot'
import { loadUalMannequinForTest } from './ualMannequin.testkit'

const DEG = Math.PI / 180

/** 相对场景根的累积朝向（与生成脚本同一口径） */
function sceneRelativeWorld(object: THREE.Object3D, root: THREE.Object3D): THREE.Quaternion {
  const chain: THREE.Object3D[] = []
  for (let node: THREE.Object3D | null = object; node && node !== root; node = node.parent) chain.unshift(node)
  return chain.reduce((acc, node) => acc.multiply(node.quaternion), new THREE.Quaternion())
}

const quat = (value: number[]) => new THREE.Quaternion().fromArray(value)
/** 两个朝向是否同一旋转（q 与 −q 等价） */
const sameRotation = (a: THREE.Quaternion, b: THREE.Quaternion, eps = 1e-4) => Math.abs(Math.abs(a.dot(b)) - 1) < eps

// 可复现的伪随机（不进快照的随机数会让失败没法复现）
function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

/** 照入库的规范绑定朝向搭一副只有语义骨的 Mixamo 规范骨架（x-bot.glb 已删，对账只认 json） */
function canonicalSkeleton(): { root: THREE.Group; index: BoneIndex } {
  const root = new THREE.Group()
  const parents: Partial<Record<SemanticBone, SemanticBone>> = {
    spine: 'hips', spine1: 'spine', spine2: 'spine1', neck: 'spine2', head: 'neck',
    leftShoulder: 'spine2', leftArm: 'leftShoulder', leftForeArm: 'leftArm', leftHand: 'leftForeArm',
    rightShoulder: 'spine2', rightArm: 'rightShoulder', rightForeArm: 'rightArm', rightHand: 'rightForeArm',
    leftUpLeg: 'hips', leftLeg: 'leftUpLeg', leftFoot: 'leftLeg', leftToeBase: 'leftFoot',
    rightUpLeg: 'hips', rightLeg: 'rightUpLeg', rightFoot: 'rightLeg', rightToeBase: 'rightFoot',
  }
  const bones = new Map<SemanticBone, THREE.Bone>()
  for (const semantic of SEMANTIC_BONES) {
    const entry = UAL_FRAME_CORRECTION.bones[semantic]
    const bone = new THREE.Bone()
    bone.name = entry.canonicalBone
    const parentSemantic = parents[semantic]
    const parentWorld = parentSemantic ? quat(UAL_FRAME_CORRECTION.bones[parentSemantic].canonicalBindWorld) : new THREE.Quaternion()
    bone.quaternion.copy(parentWorld.invert().multiply(quat(entry.canonicalBindWorld)))
    ;(parentSemantic ? bones.get(parentSemantic)! : root).add(bone)
    bones.set(semantic, bone)
  }
  root.updateMatrixWorld(true)
  return { root, index: indexBones(root) }
}

describe('UAL 骨名与规范骨轴修正（真 glb）', () => {
  let ual: THREE.Object3D
  let index: BoneIndex
  beforeAll(async () => {
    ual = (await loadUalMannequinForTest()).scene
    attachCanonicalBoneFrames(ual, 'ual')
    index = indexBones(ual)
  })

  it('22 根语义骨在 UAL glb 里都按 three 去点后的名字找得到；参考文件里带点的原名找不到（风险 1 钉住）', () => {
    for (const semantic of SEMANTIC_BONES) expect(findSemanticBone(index, 'ual', semantic), semantic).toBeInstanceOf(THREE.Bone)
    const dotted = Object.values(ualRigReference.semanticBones).filter((name) => name.includes('.'))
    expect(dotted.length).toBeGreaterThan(0)
    for (const name of dotted) {
      let exact = false
      ual.traverse((object) => {
        if (object.name === name) exact = true
      })
      expect(exact, name).toBe(false)
    }
  })

  it('UAL 骨基名别名：52 根 DEF 骨全落在规范（Mixamo）基名上、无重复，且与 rig 表逐骨一致', () => {
    const defBones: string[] = []
    ual.traverse((object) => {
      if ((object as THREE.Bone).isBone && object.name.startsWith('DEF-')) defBones.push(object.name)
    })
    expect(defBones).toHaveLength(52)
    const bases = defBones.map(baseBoneName)
    expect(bases.every((base) => !base.startsWith('def-')), bases.filter((base) => base.startsWith('def-')).join(',')).toBe(true)
    expect(new Set(bases).size).toBe(52)
    expect(UAL_BASE_NAME_ALIASES.size).toBe(52)
    for (const semantic of SEMANTIC_BONES) expect(baseBoneName(RIG_BONE_MAPS.ual[semantic])).toBe(baseBoneName(RIG_BONE_MAPS.mixamo[semantic]))
    expect(baseBoneName('DEF-thumb01L')).toBe(baseBoneName('mixamorig:LeftHandThumb1'))
    expect(baseBoneName('DEF-f_pinky03R')).toBe(baseBoneName('mixamorigRightHandPinky3'))
  })

  it('入库修正表与 glb 对账：骨名同 rig 表、UAL 绑定朝向与真 glb 一致、rel = 规范⁻¹·UAL', () => {
    for (const semantic of SEMANTIC_BONES) {
      const entry = UAL_FRAME_CORRECTION.bones[semantic]
      expect(entry.ualBone).toBe(RIG_BONE_MAPS.ual[semantic])
      expect(entry.canonicalBone).toBe(RIG_BONE_MAPS.mixamo[semantic])
      const bone = findBoneByName(index, entry.ualBone)!
      expect(sameRotation(sceneRelativeWorld(bone, ual), quat(entry.ualBindWorld)), semantic).toBe(true)
      expect(sameRotation(quat(entry.canonicalBindWorld).invert().multiply(quat(entry.ualBindWorld)), quat(entry.rel)), semantic).toBe(true)
    }
  })

  it('同一组规范偏移：写在 UAL 上的世界朝向变化 = 写在规范骨上的世界朝向变化（22 根逐根、随机 20 组）', () => {
    const random = seeded(20261007)
    for (const semantic of SEMANTIC_BONES) {
      const entry = UAL_FRAME_CORRECTION.bones[semantic]
      const bone = findBoneByName(index, entry.ualBone)!
      const bind = bone.quaternion.clone()
      const canonicalWorld = quat(entry.canonicalBindWorld)
      for (let trial = 0; trial < 20; trial += 1) {
        const offset = { x: (random() - 0.5) * 180, y: (random() - 0.5) * 180, z: (random() - 0.5) * 180 }
        bone.quaternion.copy(bind)
        const before = sceneRelativeWorld(bone, ual)
        applyBoneRotationOffsets(index, { [entry.ualBone]: offset })
        const after = sceneRelativeWorld(bone, ual)
        const ualDelta = after.multiply(before.invert())
        const o = new THREE.Quaternion().setFromEuler(new THREE.Euler(offset.x * DEG, offset.y * DEG, offset.z * DEG))
        const canonicalDelta = canonicalWorld.clone().multiply(o).multiply(canonicalWorld.clone().invert())
        expect(sameRotation(ualDelta, canonicalDelta), `${semantic} ${JSON.stringify(offset)}`).toBe(true)
        // 读回（IK / Gizmo 写回的口径）= 原规范偏移
        const readBack = offsetFromBase(bone, bind)
        const readQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(readBack.x * DEG, readBack.y * DEG, readBack.z * DEG))
        expect(sameRotation(readQuat, o, 1e-3), `${semantic} read back`).toBe(true)
      }
      bone.quaternion.copy(bind)
    }
  })

  it('视线分配：UAL 头 / 颈 / 胸的世界朝向变化与规范骨架一致', () => {
    const canonical = canonicalSkeleton()
    const aim = { head: { yaw: 25, pitch: -12 }, neck: { yaw: 15, pitch: -6 }, spine: { yaw: 10, pitch: 4 } }
    const watched: SemanticBone[] = ['spine1', 'neck', 'head']
    const capture = (root: THREE.Object3D, rigIndex: BoneIndex, rig: 'ual' | 'mixamo') =>
      watched.map((semantic) => sceneRelativeWorld(findSemanticBone(rigIndex, rig, semantic)!, root))
    const ualBefore = capture(ual, index, 'ual')
    const canonicalBefore = capture(canonical.root, canonical.index, 'mixamo')
    const binds = watched.map((semantic) => findSemanticBone(index, 'ual', semantic)!.quaternion.clone())
    const up = new THREE.Vector3(0, 1, 0)
    applyLookAtOffsets(index, 'ual', aim, up)
    applyLookAtOffsets(canonical.index, 'mixamo', aim, up)
    const ualAfter = capture(ual, index, 'ual')
    const canonicalAfter = capture(canonical.root, canonical.index, 'mixamo')
    watched.forEach((semantic, i) => {
      const ualDelta = ualAfter[i].clone().multiply(ualBefore[i].clone().invert())
      const canonicalDelta = canonicalAfter[i].clone().multiply(canonicalBefore[i].clone().invert())
      expect(ualDelta.angleTo(new THREE.Quaternion()), semantic).toBeGreaterThan(0.05)
      expect(sameRotation(ualDelta, canonicalDelta), semantic).toBe(true)
    })
    watched.forEach((semantic, i) => findSemanticBone(index, 'ual', semantic)!.quaternion.copy(binds[i]))
  })

  it('不挂修正表的 rig（Mixamo / 用户上传）偏移原样右乘', () => {
    const canonical = canonicalSkeleton()
    const bone = findSemanticBone(canonical.index, 'mixamo', 'leftArm')!
    const bind = bone.quaternion.clone()
    applyBoneRotationOffsets(canonical.index, { mixamorigLeftArm: { x: 30, y: 0, z: 0 } })
    const expected = bind.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(30 * DEG, 0, 0)))
    expect(sameRotation(bone.quaternion, expected)).toBe(true)
  })
})
