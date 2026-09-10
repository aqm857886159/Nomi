/**
 * [INPUT]: 依赖 react 的 createContext/useContext、./sceneRefs 的 SceneRefRegistry
 * [OUTPUT]: 对外提供 SceneRegistryContext、useSceneRegistry()
 * [POS]: director/scene 的运行时对象表注入点：DirectorCanvas 创建一份 registry 下发，各 Entity 挂载时登记，
 *        拾取/gizmo/标签/出片按 id 取 Object3D。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createContext, useContext } from 'react'
import type { SceneRefRegistry } from './sceneRefs'

export const SceneRegistryContext = createContext<SceneRefRegistry | null>(null)

export function useSceneRegistry(): SceneRefRegistry {
  const registry = useContext(SceneRegistryContext)
  if (!registry) throw new Error('SceneRegistryContext missing: mount inside DirectorCanvas')
  return registry
}
