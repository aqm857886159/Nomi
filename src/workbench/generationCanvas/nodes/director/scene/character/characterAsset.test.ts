import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { CHARACTER_HEIGHT } from '../../model/directorSpace'
import { canonicalFrameOf } from './canonicalBoneFrame'
import { prepareCharacterModel, resolveCharacterModelUrl } from './characterAsset'
import { findSemanticBone, indexBones } from './characterRig'
import { MANNEQUIN_MODEL_URL } from './mannequinAssets'
import { loadUalMannequinForTest } from './ualMannequin.testkit'

/** 按挂载组摆好后，蒙皮网格的世界竖向范围（逐顶点蒙皮，= 渲染看到的） */
function mountedSkinnedExtent(prepared: ReturnType<typeof prepareCharacterModel>): { minY: number; maxY: number } {
  const mount = new THREE.Group()
  mount.scale.setScalar(prepared.fit.scale)
  mount.position.set(0, prepared.fit.baseY, 0)
  mount.add(prepared.object)
  mount.updateMatrixWorld(true)
  prepared.skinned!.skeleton.update()
  const box = new THREE.Box3().setFromObject(mount, true)
  return { minY: box.min.y, maxY: box.max.y }
}

describe('prepareCharacterModel（真 UAL glb）', () => {
  it('内置人偶：身高 = 1.75 ±1cm、脚底在地面 ±1cm（不按骨骼范围量，否则会放大到 2 米多）', async () => {
    const { scene } = await loadUalMannequinForTest()
    const prepared = prepareCharacterModel(scene, { builtin: true, rig: 'ual' })
    const extent = mountedSkinnedExtent(prepared)
    expect(Math.abs(extent.maxY - extent.minY - CHARACTER_HEIGHT)).toBeLessThan(0.01)
    expect(Math.abs(extent.minY)).toBeLessThan(0.01)
  })

  it('克隆出的每个实例都挂上规范骨轴换算、互不共享骨骼', async () => {
    const { scene } = await loadUalMannequinForTest()
    const a = prepareCharacterModel(scene, { builtin: true, rig: 'ual' })
    const b = prepareCharacterModel(scene, { builtin: true, rig: 'ual' })
    const armA = findSemanticBone(indexBones(a.object), 'ual', 'leftArm')!
    const armB = findSemanticBone(indexBones(b.object), 'ual', 'leftArm')!
    expect(armA).not.toBe(armB)
    expect(canonicalFrameOf(armA)).toBeDefined()
    expect(canonicalFrameOf(armB)).toBeDefined()
    const mixamoTagged = prepareCharacterModel(scene, { builtin: true, rig: 'mixamo' })
    expect(canonicalFrameOf(findSemanticBone(indexBones(mixamoTagged.object), 'ual', 'leftArm')!)).toBeUndefined()
  })

  it('builtin:* 与缺省 modelPath 都指向默认人偶；上传路径原样', () => {
    expect(resolveCharacterModelUrl(undefined)).toBe(MANNEQUIN_MODEL_URL)
    expect(resolveCharacterModelUrl('builtin:x-bot')).toBe(MANNEQUIN_MODEL_URL)
    expect(resolveCharacterModelUrl('builtin:ual')).toBe(MANNEQUIN_MODEL_URL)
    expect(resolveCharacterModelUrl('nomi-asset://a.glb')).toBe('nomi-asset://a.glb')
    expect(MANNEQUIN_MODEL_URL).toContain('ual-mannequin.glb')
  })
})
