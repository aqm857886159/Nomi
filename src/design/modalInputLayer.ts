/**
 * 模态输入层：现在有哪些模态开着、各自盖住哪一块。这件事的唯一 owner。
 *
 * 为什么要有它：工作区面（画布、时间轴、列表、预览）的快捷键都挂在 window / document 上，而键盘事件永远打到焦点元素、
 * 再冒泡到 window。确认框的按钮拿着焦点时按 Delete，画布照样收到、照样删。原生 `inert` 和 `<dialog>.showModal()` 都拦不住
 * window 级监听（Electron 43 实测，docs/plan/2026-10-31-modal-input-priority.md 先查别人第 2 条），只能在监听的共享边界上判断。
 *
 * 开关只来自宿主：持有 opened 状态的组件调 useModalInputLayer 登记，关闭或卸载时撤销。不查 DOM，不看 class、role、z-index，
 * 所以这一层随宿主生灭，不会残留。谁在读：workbench/shortcutSurface.ts 的 workspaceInputSurfaceIsActive，那是唯一一条「层级优先」规则。
 *
 * covers：这一层盖住哪一块。null = 整窗。灯箱只盖画布那一格，旁边的时间轴和 Agent 面板还露着、还能用，所以传那一格的元素。
 *
 * 关掉这层的那个事件派发完之前，这层还算数：Mantine 在 window 捕获期关弹层，React 紧接着在微任务里提交，同一个 Esc 再走到
 * 下面的灯箱和画布时层已经摘了。不留这一拍，按一下 Esc 就会关两层，还顺手取消后面的画框工具。
 */
import React from 'react'

type ModalInputLayer = {
  readonly covers: Element | null
  /** 关掉它的那个事件；还在派发时这层继续算数。 */
  closedDuring: Event | null
}
export type ModalInputLayerHandle = {
  /** 这一层是不是最上面那层（灯箱自己的 Esc 用：上面还叠着确认框时让路）。 */
  isTop: () => boolean
  /** 幂等：重复关不会多摘一层。 */
  close: () => void
}

let layers: ModalInputLayer[] = []
const openedListeners = new Set<(covers: Element | null) => void>()

/** 正在派发的事件：派发器自己记的（React 定更新优先级读的也是它），提交发生在派发途中的微任务里，所以这时还读得到。 */
const dispatchingEvent = (): Event | null => (typeof window === 'undefined' ? null : window.event ?? null)

function liveLayers(): readonly ModalInputLayer[] {
  if (layers.length === 0) return layers
  const event = dispatchingEvent()
  layers = layers.filter((layer) => !layer.closedDuring || layer.closedDuring === event)
  return layers
}

export function openModalInputLayer(covers: Element | null = null): ModalInputLayerHandle {
  const layer: ModalInputLayer = { covers, closedDuring: null }
  layers = [...liveLayers(), layer]
  for (const listener of [...openedListeners]) listener(covers)
  return {
    isTop: () => liveLayers().at(-1) === layer,
    close: () => {
      if (layer.closedDuring) return
      layer.closedDuring = dispatchingEvent()
      if (!layer.closedDuring) layers = layers.filter((candidate) => candidate !== layer)
    },
  }
}

/** 这个元素现在是不是被某个开着的模态盖住了。 */
export function modalInputLayerCovers(element: Element): boolean {
  return liveLayers().some((layer) => !layer.covers || layer.covers.contains(element))
}

/** 有新层打开的那一刻（层已经在栈里）：给「盖住了就打断手势」用。 */
export function onModalInputLayerOpened(listener: (covers: Element | null) => void): () => void {
  openedListeners.add(listener)
  return () => { openedListeners.delete(listener) }
}

/**
 * 宿主登记：opened 为真时这一层在栈里。返回的函数引用稳定，回答「我是不是最上面那层」。
 * 用 layout effect：提交的同一拍生效，弹层画出来之后的第一个按键就不会漏下去。
 */
export function useModalInputLayer(opened: boolean, covers: Element | null = null): () => boolean {
  const handleRef = React.useRef<ModalInputLayerHandle | null>(null)
  React.useLayoutEffect(() => {
    if (!opened) return undefined
    const handle = openModalInputLayer(covers)
    handleRef.current = handle
    return () => {
      handle.close()
      if (handleRef.current === handle) handleRef.current = null
    }
  }, [opened, covers])
  return React.useCallback(() => handleRef.current?.isTop() ?? false, [])
}
