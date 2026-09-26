import React from 'react'
import { readDockCollapsed, writeDockCollapsed, type BottomDock } from './dockCollapsePrefs'

/**
 * 画面小窗 / 小地图这类组件内的「收起 / 展开」状态：初值读本机偏好，改一次就写回（偏好的唯一 owner 仍是 dockCollapsePrefs）。
 * 写偏好放在事件里、不放进 setState 的更新函数——更新函数要保持纯（StrictMode 下会跑两次）。
 * 时间轴面板的开合住在 workbenchStore（跨组件共享），不走这里。
 */
export function useDockCollapsed(dock: BottomDock): [collapsed: boolean, setCollapsed: (next: boolean) => void] {
  const [collapsed, setCollapsedState] = React.useState(() => readDockCollapsed(dock))
  const setCollapsed = React.useCallback((next: boolean) => {
    writeDockCollapsed(dock, next)
    setCollapsedState(next)
  }, [dock])
  return [collapsed, setCollapsed]
}
