import React from 'react'
import type { StageDockRect } from './selectionToolbarPlacement'

/**
 * 「我常驻在画布底部，别把浮层排到我身上」——由停靠区自己在 DOM 上声明的那个标记。
 *
 * 为什么是标记而不是在这里列一串 class 选择器：底部这排东西住在四个不同的组件里
 * （画布工具簇 / 批量生成停靠条 / 时间轴胶囊 / 时间轴迷你画面窗），其中两个还不在画布这棵树里。
 * 在这边抄一份名单就是又一个会烂的黑名单——少写一条不会报错，只会在某个窗口尺寸下
 * 静默地让浮条压上去（`tests/ux/_canvasHit.mjs` 顶上那段就是同一个坑的上一次）。
 * 标记写在**那个东西自己身上**，新加一块停靠区时它就在你手边。
 */
export const CANVAS_BOTTOM_DOCK_ATTR = 'data-canvas-bottom-dock'
const DOCK_SELECTOR = `[${CANVAS_BOTTOM_DOCK_ATTR}]`
/** 停靠区可能住在画布 stage 外面（时间轴胶囊、迷你画面窗是 stage 的兄弟），所以往上找这一层再查。 */
const DOCK_SCOPE_SELECTOR = '.workbench-generation__canvas'

function sameRects(a: readonly StageDockRect[], b: readonly StageDockRect[]): boolean {
  if (a.length !== b.length) return false
  return a.every((rect, index) => {
    const next = b[index]
    return (
      Math.abs(rect.left - next.left) < 1 &&
      Math.abs(rect.top - next.top) < 1 &&
      Math.abs(rect.right - next.right) < 1 &&
      Math.abs(rect.bottom - next.bottom) < 1
    )
  })
}

function resolveScope(host: HTMLElement): Element {
  return host.closest(DOCK_SCOPE_SELECTOR) ?? host
}

/**
 * 量出底部停靠区此刻在 stage 坐标系里占了哪几块。
 *
 * **现量、不写常数**：这排东西的高度由 CSS 决定（胶囊的字号、缩略图开没开、批量条有没有出现），
 * 抄一份数字进 TS 就是「尺寸双真相源」——本仓 `check:heavy-path` 专门有一条门岗在拦这种写法。
 *
 * 什么时候重量：**停靠区的几何只会因为外壳布局变而变**，所以只订两件事——
 *  · `ResizeObserver`：舞台/画布容器变大小（拉窗口、Agent 面板宽度、时间轴展开收起都会走这里）；
 *  · `MutationObserver({ childList })`：停靠区自己挂上来或摘下去。
 *    只订**直接子节点**是关键：这四块全都是画布容器或 stage 的直接孩子，
 *    而 React Flow 的节点虚拟化在更深的 `.react-flow` 里翻腾，碰不到这两份名单——
 *    否则平移画布时每一帧都要重量一次。
 *
 * `active` 是省电闸：只有选择浮条真的在这一屏时才订阅、才量。
 */
export function useCanvasBottomDockRects(
  hostRef: React.RefObject<HTMLElement>,
  active: boolean,
): readonly StageDockRect[] {
  const [layoutRevision, setLayoutRevision] = React.useState(0)
  const [rects, setRects] = React.useState<readonly StageDockRect[]>([])

  React.useEffect(() => {
    const host = hostRef.current
    if (!active || !host) return undefined
    if (typeof ResizeObserver === 'undefined' || typeof MutationObserver === 'undefined') return undefined
    const scope = resolveScope(host)
    let frame = 0
    const request = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        setLayoutRevision((revision) => revision + 1)
      })
    }
    const resize = new ResizeObserver(request)
    resize.observe(scope)
    resize.observe(host)
    const mutation = new MutationObserver(request)
    mutation.observe(scope, { childList: true })
    if (scope !== host) mutation.observe(host, { childList: true })
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      resize.disconnect()
      mutation.disconnect()
    }
  }, [active, hostRef])

  React.useLayoutEffect(() => {
    const host = hostRef.current
    if (!active || !host) {
      setRects((previous) => (previous.length ? [] : previous))
      return
    }
    const stage = host.getBoundingClientRect()
    if (!(stage.width > 0 && stage.height > 0)) return
    const next: StageDockRect[] = []
    for (const element of Array.from(resolveScope(host).querySelectorAll(DOCK_SELECTOR))) {
      const rect = element.getBoundingClientRect()
      if (!(rect.width > 0 && rect.height > 0)) continue
      next.push({
        left: rect.left - stage.left,
        top: rect.top - stage.top,
        right: rect.right - stage.left,
        bottom: rect.bottom - stage.top,
      })
    }
    setRects((previous) => (sameRects(previous, next) ? previous : next))
  }, [active, hostRef, layoutRevision])

  return rects
}
