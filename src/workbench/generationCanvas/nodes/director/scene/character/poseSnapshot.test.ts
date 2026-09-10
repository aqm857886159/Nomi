import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { MANNEQUIN_REST_ROTATION_KEY } from './mannequinSkeleton'
import { applyPoseSnapshot, baseBoneName, bindWorldQuaternionsByBaseName, blendPoseSnapshots, indexBonesByBaseName, snapshotBones, type PoseSnapshot } from './poseSnapshot'

function rig(names: string[], hips: [number, number, number]): THREE.Group {
  const root = new THREE.Group()
  let parent: THREE.Object3D = root
  names.forEach((name, index) => {
    const bone = new THREE.Bone()
    bone.name = name
    if (index === 0) bone.position.set(...hips)
    else bone.position.set(0, 0.4, 0)
    parent.add(bone)
    parent = bone
  })
  return root
}

const Y = new THREE.Vector3(0, 1, 0)
const X = new THREE.Vector3(1, 0, 0)

describe('poseSnapshot', () => {
  it('骨名归一：mixamorig: 前缀 / 无冒号前缀 / _N 后缀都归到同一基名', () => {
    expect(baseBoneName('mixamorig:Hips')).toBe('hips')
    expect(baseBoneName('mixamorigHips')).toBe('hips')
    expect(baseBoneName('mixamorig1LeftArm')).toBe('leftarm')
    expect(baseBoneName('LeftArm_2')).toBe('leftarm')
  })

  it('快照混合：alpha 0 = a、1 = b、中间按 smoothstep 走；只在一边出现的骨原样带过', () => {
    const a: PoseSnapshot = new Map([
      ['hips', { quaternion: new THREE.Quaternion(), position: new THREE.Vector3(0, 100, 0), world: new THREE.Quaternion() }],
      ['onlya', { quaternion: new THREE.Quaternion(), position: new THREE.Vector3(1, 0, 0), world: new THREE.Quaternion() }],
    ])
    const b: PoseSnapshot = new Map([
      ['hips', { quaternion: new THREE.Quaternion().setFromAxisAngle(Y, Math.PI / 2), position: new THREE.Vector3(0, 60, 0), world: new THREE.Quaternion().setFromAxisAngle(Y, Math.PI / 2) }],
      ['onlyb', { quaternion: new THREE.Quaternion(), position: new THREE.Vector3(2, 0, 0), world: new THREE.Quaternion() }],
    ])
    expect(blendPoseSnapshots(a, b, 0)!.get('hips')!.position.y).toBeCloseTo(100)
    expect(blendPoseSnapshots(a, b, 1)!.get('hips')!.position.y).toBeCloseTo(60)
    const mid = blendPoseSnapshots(a, b, 0.5)!
    expect(mid.get('hips')!.position.y).toBeCloseTo(80)
    expect(mid.get('hips')!.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(Math.PI / 4, 3)
    expect(mid.get('onlya')!.position.x).toBe(1)
    expect(mid.get('onlyb')!.position.x).toBe(2)
    expect(blendPoseSnapshots(null, b, 0.3)).toBe(b)
  })

  it('套骨 = 角色 bind × 源增量：源骨从 bind 转 90°，角色（bind 本身带 30°）得到 30°+90°；权重减半得一半', () => {
    // 源：FBX 骨架，bind 无旋转；帧里脊椎绕 X 转 90°
    const source = rig(['mixamorig:Hips', 'mixamorig:Spine'], [0, 100, 0])
    const sourceBind = snapshotBones(source)
    source.children[0].children[0].quaternion.setFromAxisAngle(X, Math.PI / 2)
    const frame = snapshotBones(source)
    // 角色：glb 骨架，脊椎 bind 自带绕 X 30°（记在 userData rest）
    const target = rig(['mixamorigHips', 'mixamorigSpine'], [0, 1, 0])
    const spine = target.children[0].children[0] as THREE.Bone
    spine.userData[MANNEQUIN_REST_ROTATION_KEY] = [Math.PI / 6, 0, 0]
    spine.rotation.set(Math.PI / 6, 0, 0)
    const bones = indexBonesByBaseName(target)
    const targetBindWorld = bindWorldQuaternionsByBaseName(target)
    applyPoseSnapshot(bones, frame, { weight: 1, sourceBind, targetBindWorld, root: target, restHips: new THREE.Vector3(0, 1, 0) })
    expect(bones.get('spine')!.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(Math.PI / 6 + Math.PI / 2, 4)
    spine.rotation.set(Math.PI / 6, 0, 0)
    applyPoseSnapshot(bones, frame, { weight: 0.5, sourceBind, targetBindWorld, root: target, restHips: new THREE.Vector3(0, 1, 0) })
    expect(bones.get('spine')!.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(Math.PI / 6 + Math.PI / 4, 4)
  })

  it('骨盆跨坐标系：源 rest 骨盆在 +Y 100cm、角色 rest 骨盆在 −Z 1m → 源下蹲 40cm 变成角色沿 −Z 缩短 0.4m；旋转增量直接右乘（局部系），世界朝向与源一致', () => {
    const source = rig(['mixamorig:Hips'], [0, 100, 0])
    const sourceBind = snapshotBones(source)
    source.children[0].position.set(0, 60, 0)
    source.children[0].quaternion.setFromAxisAngle(Y, Math.PI / 2) // 绕源「向上」轴转 90°
    const frame = snapshotBones(source)
    // 角色：Armature 绕 X +90°（Blender 导出惯例），骨盆 bind 自带 −90° 抵消 → 骨盆世界朝向与源一致（实测两边都是 [0.0065,0,0,1]）
    const target = new THREE.Group()
    const armature = new THREE.Group()
    armature.name = 'Armature'
    armature.quaternion.setFromAxisAngle(X, Math.PI / 2)
    target.add(armature)
    const targetHips = new THREE.Bone()
    targetHips.name = 'mixamorigHips'
    targetHips.position.set(0, 0, -1)
    armature.add(targetHips)
    targetHips.quaternion.setFromAxisAngle(X, -Math.PI / 2)
    targetHips.userData[MANNEQUIN_REST_ROTATION_KEY] = [-Math.PI / 2, 0, 0]
    target.updateMatrixWorld(true)
    const bones = indexBonesByBaseName(target)
    const targetBindWorld = bindWorldQuaternionsByBaseName(target)
    applyPoseSnapshot(bones, frame, { weight: 1, sourceBind, targetBindWorld, root: target, restHips: new THREE.Vector3(0, 0, -1) })
    const hips = bones.get('hips')!
    expect(hips.position.x).toBeCloseTo(0, 5)
    expect(hips.position.y).toBeCloseTo(0, 5)
    expect(hips.position.z).toBeCloseTo(-0.6, 5)
    // 世界朝向 = 源帧的世界朝向（绕世界 Y 转 90°）
    target.updateMatrixWorld(true)
    const world = hips.getWorldQuaternion(new THREE.Quaternion())
    const expected = new THREE.Quaternion().setFromAxisAngle(Y, Math.PI / 2)
    expect(world.angleTo(expected)).toBeCloseTo(0, 4)
  })
})
