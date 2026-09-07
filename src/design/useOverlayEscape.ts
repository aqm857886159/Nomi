import React from 'react'
import { hasOpenDialogAbove } from './overlayLayers'

/**
 * 手写浮层的 Esc 关闭原语。
 *
 * 为什么要有它：走 `DesignModal`（Mantine）的弹层 Esc 是白送的，手写 `fixed inset-0` 的那批没有——
 * 于是「更重的决定（花钱）反而比更轻的决定（删除）保障更差」。这个钩子把那条缺口收成一份实现，
 * 而不是让每个手写壳各自抄一遍 keydown（R28：防线建在最早能拦住的那层；P1：不留并行版）。
 *
 * 让位规则走 overlayLayers 的统一契约：本层之上还叠着别的对话框时**不接管** Esc，
 * 由最上面那层自己关（不自己数 z-index，也不越级替别人关）。
 *
 * @param ref     浮层里那个带 role="dialog" 的元素（层级判定靠它 + 它的祖先 z-index）
 * @param active  浮层是否显示中；false 时不挂监听
 * @param onEscape 用户按 Esc 时该发生什么（通常 = 点「取消/关闭」）
 */
export function useOverlayEscape(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  onEscape: () => void,
): void {
  const handlerRef = React.useRef(onEscape)
  handlerRef.current = onEscape

  React.useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent): void => {
      // isComposing：输入法候选窗里的 Esc 是「取消候选」，不是「关弹层」。
      // defaultPrevented：里层控件（下拉/菜单）已经吃掉这次 Esc 了。
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return
      const dialog = ref.current
      if (!dialog || hasOpenDialogAbove(dialog)) return
      event.preventDefault()
      event.stopPropagation()
      handlerRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [ref, active])
}
