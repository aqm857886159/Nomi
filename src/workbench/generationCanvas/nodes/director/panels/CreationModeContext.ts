/**
 * [INPUT]: 依赖 react、../scene/creation/useCharacterPlacement 的 CharacterPlacementApi、../scene/creation/useBoxDraw 的 BoxDrawApi
 * [OUTPUT]: 对外提供 CreationModeContext / useCreationMode()：角色放置与画框两个创建模式的注入接缝
 * [POS]: director/panels 的创建模式注入点。两个 hook 的所有权仍在 DirectorEditor 的 EditorBody（它同时喂视口的指针路由与
 *        DirectorCanvas 的 ghost ref），顶栏的「＋添加」菜单只是第二个发起方 —— 用 context 而不是把 hook 再调一次，
 *        否则同一模式会有两份互不知情的状态（P1 的并行版）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import type { BoxDrawApi } from '../scene/creation/useBoxDraw'
import type { CharacterPlacementApi } from '../scene/creation/useCharacterPlacement'

export type CreationModeApi = {
  placement: CharacterPlacementApi
  boxDraw: BoxDrawApi
}

export const CreationModeContext = React.createContext<CreationModeApi | null>(null)

export function useCreationMode(): CreationModeApi {
  const value = React.useContext(CreationModeContext)
  if (!value) throw new Error('useCreationMode 必须在 CreationModeContext.Provider 内使用')
  return value
}
