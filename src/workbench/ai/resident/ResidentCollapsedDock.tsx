import React from 'react'

/**
 * How much room the preview's own transport needs. The dock hangs off the
 * bottom of the box the resident is mounted in, and the transport bar hangs off
 * the bottom of the player inside it — anchoring the composer at `bottom: 0`
 * puts it on top of play/pause and the timecode, i.e. it covers the very
 * controls "结果全屏" exists to give back. The bar wraps at narrow widths, so
 * its height is measured rather than assumed.
 *
 * The host box is read from the dock's own `offsetParent` instead of a named
 * stage class: the editing surface moved onto a panel system (T1, 2026-09-05)
 * and the old `.workbench-preview__stage` selector stopped matching anything.
 * A dead selector here fails silently — clearance stays 0 and the composer
 * lands right back on the transport — so the anchor has to be structural.
 */
function useTransportClearance(dockRef: React.RefObject<HTMLDivElement | null>): number {
  const [clearance, setClearance] = React.useState(0)
  React.useLayoutEffect(() => {
    const host = dockRef.current?.offsetParent
    if (!(host instanceof HTMLElement)) return undefined
    // Measure the gap from the host's bottom to the transport's top rather than
    // the transport's own height: the player leaves its own padding under the
    // bar, so height alone still lands the composer on the play button. The bar
    // is re-queried per measurement so a late-mounting player is picked up.
    const measure = (): void => {
      const bar = document.querySelector<HTMLElement>('.workbench-preview-player__control-bar')
      setClearance(bar ? Math.max(0, host.getBoundingClientRect().bottom - bar.getBoundingClientRect().top) : 0)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    const bar = document.querySelector<HTMLElement>('.workbench-preview-player__control-bar')
    if (bar) observer.observe(bar)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
    // The composer re-renders on every keystroke; rebuilding the observer that
    // often is waste. Host resizes (panel drags, transport wrapping) already
    // re-measure, and `measure` re-queries the bar, so a late player is caught.
  }, [dockRef])
  return clearance
}

/**
 * What Nomi looks like once the user hands the screen back to the result
 * (design contract §2.6, "结果全屏"). Collapsing hides the transcript, not the
 * conversation: the very same composer drops to the bottom edge of the preview
 * stage, centred. The intervention slot rides along inside it, so an edit plan
 * can still be read and approved without giving the panel its column back.
 *
 * The dock is positioned against the collapsed dock `<aside>`, which spans the
 * preview stage — the timeline sits below that box, so `bottom` here is the
 * preview's lower edge and the plan highlight underneath stays visible.
 *
 * 这里**没有**「叫回 Nomi」按钮：收起后叫回它的入口只有一个，就是面板系统在最右侧
 * 留下的 32px 图标条（合同 §2.1，状态点见 residentActivity）。上一版两个入口并存
 * ——图标条写「展开 Nomi」、画面右上角又浮一颗「叫回 Nomi」胶囊——同一个动作两个名字
 * 两个位置，还把画面右上角挡掉一块。
 */
export function ResidentCollapsedDock({ children }: { children: React.ReactNode }): JSX.Element {
  const dockRef = React.useRef<HTMLDivElement>(null)
  const transportClearance = useTransportClearance(dockRef)
  return <div ref={dockRef} className="pointer-events-none absolute inset-x-0 z-40 flex justify-center px-4 pb-3" style={{ bottom: transportClearance }}>
    <div className="pointer-events-auto grid w-full max-w-[560px] gap-1.5" data-agent-collapsed-dock="true">
      {children}
    </div>
  </div>
}
