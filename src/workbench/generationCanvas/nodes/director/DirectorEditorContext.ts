/**
 * [INPUT]: 依赖 react 的 createContext/useContext、zustand 的 useStore、./model/directorStore 的 DirectorStore / DirectorStoreState
 * [OUTPUT]: 对外提供 DirectorStoreContext、useDirectorStore(selector)、useDirectorStoreApi()
 * [POS]: director 的 store 注入点：DirectorEditor 创建 store 后经此 Provider 下发；面板/时间轴/场景组件只通过这两个 hook
 *        读写，渲染循环用 useDirectorStoreApi().getState() 免订阅读取。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { DirectorStore, DirectorStoreState } from './model/directorStore'

export const DirectorStoreContext = createContext<DirectorStore | null>(null)

export function useDirectorStoreApi(): DirectorStore {
  const store = useContext(DirectorStoreContext)
  if (!store) throw new Error('DirectorStoreContext missing: wrap with DirectorEditor')
  return store
}

export function useDirectorStore<T>(selector: (state: DirectorStoreState) => T): T {
  return useStore(useDirectorStoreApi(), selector)
}
