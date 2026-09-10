/**
 * [INPUT]: 依赖 ../../model/directorTypes 的 DirectorObject / DirectorModelDisplayMode、../sceneTheme 的 CLAY_COLOR / DEFAULT_PRIMITIVE_COLOR
 * [OUTPUT]: 对外提供 PrimitiveMaterialSpec、primitiveMaterialSpec（三种显示模式下几何体材质参数）
 * [POS]: director/scene/entities 的材质求值（纯函数，与组件分文件）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { DirectorModelDisplayMode, DirectorObject } from '../../model/directorTypes'
import { CLAY_COLOR, DEFAULT_PRIMITIVE_COLOR } from '../sceneTheme'

export type PrimitiveMaterialSpec = {
  color: string | number
  roughness: number
  metalness: number
  opacity: number
  transparent: boolean
  depthWrite: boolean
  wireframe: boolean
  flatShading: boolean
}

export function primitiveMaterialSpec(object: DirectorObject, mode: DirectorModelDisplayMode): PrimitiveMaterialSpec {
  const opacity = object.opacity ?? 1
  if (mode === 'clay') {
    return { color: CLAY_COLOR, roughness: 0.9, metalness: 0, opacity: 1, transparent: false, depthWrite: true, wireframe: object.wireframe ?? false, flatShading: object.flatShading ?? false }
  }
  if (mode === 'translucent') {
    return { color: object.color || DEFAULT_PRIMITIVE_COLOR, roughness: 0.4, metalness: 0, opacity: 0.35, transparent: true, depthWrite: false, wireframe: object.wireframe ?? false, flatShading: object.flatShading ?? false }
  }
  return {
    color: object.color || DEFAULT_PRIMITIVE_COLOR,
    roughness: object.roughness ?? 0.4,
    metalness: object.metalness ?? 0.1,
    opacity,
    transparent: opacity < 1,
    depthWrite: true,
    wireframe: object.wireframe ?? false,
    flatShading: object.flatShading ?? false,
  }
}
