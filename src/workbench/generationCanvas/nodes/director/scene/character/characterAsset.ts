/**
 * [INPUT]: 依赖 three（类型）、./mannequinAssets 的 MANNEQUIN_MODEL_URL
 * [OUTPUT]: 对外提供 resolveCharacterModelUrl、isFbxUrl、hasMixamoRig
 * [POS]: director/scene/character 的角色资产小工具（零 React）：内置假人 builtin:* → 内置 X Bot；用户上传按 modelPath；FBX / GLB 分 loader；
 *        Mixamo 骨骼检测决定「升格为角色还是普通模型」。CharacterEntity 与 ModelEntity 共用，不放组件文件里（react-refresh 只认组件导出）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type * as THREE from 'three'
import { MANNEQUIN_MODEL_URL } from './mannequinAssets'

export function resolveCharacterModelUrl(modelPath: string | undefined): string {
  return !modelPath || modelPath.startsWith('builtin:') ? MANNEQUIN_MODEL_URL : modelPath
}

export function isFbxUrl(url: string): boolean {
  return /\.fbx(?:[?#].*)?$/i.test(url)
}

export function hasMixamoRig(root: THREE.Object3D): boolean {
  let found = false
  root.traverse((object) => {
    if (!found && (object as THREE.Bone).isBone && /mixamorig/i.test(object.name)) found = true
  })
  return found
}
