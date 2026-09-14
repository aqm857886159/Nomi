import React from 'react'
import type { StageDockRect } from './selectionToolbarPlacement'
import {
  BOTTOM_DOCK_ATTR,
  collectBottomDockRects,
  resolveBottomDockScope,
} from '../../generation/workspaceBottomDocks'

/**
 * 「我常驻在工作区底部，别把浮层排到我身上」——标记与范围的 owner 已上移到外壳层
 * （`src/workbench/generation/workspaceBottomDocks.ts`）。
 *
 * 2026-09-13 之前这里自己持有标记名与范围（`.workbench-generation__canvas`），
 * 而时间轴胶囊那一侧在 `GenerationWorkspace` 里又写了第二份同样的查询——两份都把范围钉在
 * 画布这棵子树上，于是 Nomi 面板收起后那条浮起的输入条（工作区的孩子、不是画布的孩子）
 * 在两份名单里都不存在。合成一个 owner、范围提到工作区之后，这里只剩「什么时候重量」。
 *
 * 转发 `CANVAS_BOTTOM_DOCK_ATTR` 是为了不动 5 处现役标记与走查锚点的名字：
 * 要改的是「在哪一层找」，不是「叫什么名字」。
 */
export const CANVAS_BOTTOM_DOCK_ATTR = BOTTOM_DOCK_ATTR

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
    const scope = resolveBottomDockScope(host)
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
    const next: StageDockRect[] = collectBottomDockRects(host, stage)
    setRects((previous) => (sameRects(previous, next) ? previous : next))
  }, [active, hostRef, layoutRevision])

  return rects
}
