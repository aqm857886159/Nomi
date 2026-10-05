/**
 * [INPUT]: 依赖 react 的 useSyncExternalStore、./directorSessionRegistry 的 subscribeDirectorShotFocus / readDirectorShotFocus
 * [OUTPUT]: 对外提供 useDirectorShotFocus：开着的导演台里选中的计划镜头（没有 = null），给 Agent 输入框上的「正在改：镜头 N」标签订阅
 * [POS]: 只读投影的 React 口子；数据 owner 是编辑器 store 的 selection（经会话登记处），这里不存任何东西。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { readDirectorShotFocus, subscribeDirectorShotFocus } from './directorSessionRegistry'
import type { DirectorShotFocus } from './model/directorShotFocus'

export function useDirectorShotFocus(enabled: boolean): DirectorShotFocus | null {
  const focus = React.useSyncExternalStore(subscribeDirectorShotFocus, readDirectorShotFocus, () => null)
  return enabled ? focus : null
}
