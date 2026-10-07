/**
 * [INPUT]: 依赖 react、../../useDirectorHotkeys 的 isTextTarget
 * [OUTPUT]: 对外提供 useDismissOnEscape(active, onDismiss)：精修里按需出现的面板（场景设置卡、资产库抽屉）按 Esc 收起
 * [POS]: director/panels/context 的 Esc 归属件。壳的 Esc 链（DirectorEditor）见到任何 data-nomi-escape-layer 就让路，
 *        所以挂了这个标记的面板必须自己把 Esc 吃掉，否则那一下 Esc 谁都不管。浮层（Popover，标记 director-popover）开着时先让浮层收，
 *        一次 Esc 只收一层（创建模式也先于面板）；输入框里的 Esc 归输入框（搜索框清空）。
 *        面板同时声明 data-nomi-hotkeys="pass"：开着时导演台快捷键照常（useDirectorHotkeys 的让路规则）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { isTextTarget } from '../../useDirectorHotkeys'

export function useDismissOnEscape(active: boolean, onDismiss: () => void): void {
  const dismissRef = React.useRef(onDismiss)
  dismissRef.current = onDismiss
  React.useEffect(() => {
    if (!active) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isTextTarget(event.target)) return
      if (document.querySelector('[data-nomi-escape-layer="director-popover"]')) return
      // 创建模式（放角色 / 画方块 / 画路径）开着时那一下 Esc 归创建模式，面板等下一下
      if (document.querySelector('[data-nomi-director-creation-mode]')) return
      event.preventDefault()
      dismissRef.current()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [active])
}
