import React from 'react'
import { BROWSER_DIALOG_ROOT_SELECTOR, CANVAS_IMPORT_TARGET_SELECTOR } from './browserAssetPopoverConstants'

// contained（独立透明 overlay 窗）下父窗有没有画布导入目标，靠跨窗探针轮询——本窗 DOM 探不到父窗。
const CONTAINED_PROBE_INTERVAL_MS = 2000

/**
 * 可用性信号从哪来（纯决策，单测锁死回归 dfc47477）：
 * - 未开 → `none`（恒 false）。
 * - contained：有探针 → `probe`（跨窗）；无探针 → `none`（不谎报）。**关键：绝不能是 none-when-hasProbe。**
 * - 非 contained → `dom`（本窗查画布目标）。
 */
export type CanvasImportAvailabilitySource = 'dom' | 'probe' | 'none'

export function canvasImportAvailabilitySource(
  popoverOpen: boolean,
  contained: boolean,
  hasProbe: boolean,
): CanvasImportAvailabilitySource {
  if (!popoverOpen) return 'none'
  if (contained) return hasProbe ? 'probe' : 'none'
  return 'dom'
}

/**
 * 「当前能不能把素材放到画布」的可用性信号（单一真相，两态收口，P1 无并行版）：
 * - **应用内浮窗**（contained=false）：本窗 DOM 直接查 `CANVAS_IMPORT_TARGET_SELECTOR`，MutationObserver 跟随；
 *   浏览器全屏 dialog 在场时（`BROWSER_DIALOG_ROOT_SELECTOR`）画布被挡，判不可用。
 * - **独立 overlay 窗**（contained=true）：素材盒是父窗之外的透明子窗，DOM 探针跨窗探不到画布；
 *   改**消费 overlay 经 IPC 传入的探针** `probeCanvasImportAvailable`——开时即探 + 每 2s 轮询。
 *   （回归根因：`dfc47477` 后 contained 分支曾无条件置 false、从不调这个探针，导致 ready 素材永远送不进画布。）
 * - contained 但没探针（异常/无桥）：无从判断 → false。
 */
export function useCanvasImportAvailability({
  popoverOpen,
  contained,
  probeCanvasImportAvailable,
}: {
  popoverOpen: boolean
  contained: boolean
  probeCanvasImportAvailable?: () => Promise<boolean>
}): boolean {
  const [available, setAvailable] = React.useState(false)

  React.useEffect(() => {
    const source = canvasImportAvailabilitySource(popoverOpen, contained, Boolean(probeCanvasImportAvailable))
    if (source === 'none') {
      setAvailable(false)
      return undefined
    }

    // contained：跨窗探针（DOM 探不到父窗画布）。开时即探 + 定时轮询。
    if (source === 'probe' && probeCanvasImportAvailable) {
      let disposed = false
      const probe = (): void => {
        void probeCanvasImportAvailable()
          .then((result) => {
            if (!disposed) setAvailable(Boolean(result))
          })
          .catch(() => {
            if (!disposed) setAvailable(false)
          })
      }
      probe()
      const timer = window.setInterval(probe, CONTAINED_PROBE_INTERVAL_MS)
      return () => {
        disposed = true
        window.clearInterval(timer)
      }
    }

    // 应用内浮窗：本窗 DOM 探 + MutationObserver 跟随画布/浏览器 dialog 的进出。
    if (typeof document === 'undefined') {
      setAvailable(false)
      return undefined
    }
    const update = (): void => {
      setAvailable(
        Boolean(document.querySelector(CANVAS_IMPORT_TARGET_SELECTOR)) &&
          !document.querySelector(BROWSER_DIALOG_ROOT_SELECTOR),
      )
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-nomi-generation-canvas-import-target'],
    })
    return () => observer.disconnect()
  }, [contained, popoverOpen, probeCanvasImportAvailable])

  return available
}
