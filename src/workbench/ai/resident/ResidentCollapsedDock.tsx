import React from 'react'
import { IconChevronLeft } from '@tabler/icons-react'
import { NomiLogoMark } from '../../../design'
import { cn } from '../../../utils/cn'

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
 */
export function ResidentCollapsedDock({
  recallLabel,
  statusLabel,
  statusToneClassName,
  onRecall,
  children,
}: {
  recallLabel: string
  statusLabel: string
  statusToneClassName: string
  onRecall: () => void
  children: React.ReactNode
}): JSX.Element {
  const dockRef = React.useRef<HTMLDivElement>(null)
  const transportClearance = useTransportClearance(dockRef)
  return <>
    <button type="button" className="pointer-events-auto absolute right-0 top-0 z-40 flex h-9 w-fit max-w-[calc(100vw-24px)] items-center gap-1.5 rounded-pill border border-nomi-line bg-nomi-paper px-2 text-left text-caption text-nomi-ink shadow-nomi-md transition-[box-shadow,transform] duration-[var(--nomi-transition-fast)] motion-reduce:transition-none hover:-translate-y-px hover:shadow-nomi-lg" aria-label={recallLabel} title={recallLabel} aria-controls="project-agent-resident" aria-expanded="false" data-agent-resident-collapsed="true" onClick={onRecall}>
      <NomiLogoMark size={17} />
      <span className={cn('size-1.5 shrink-0 rounded-pill', statusToneClassName)} aria-hidden="true" />
      <span className="max-w-[8rem] shrink truncate">{statusLabel}</span>
      <IconChevronLeft size={14} className="shrink-0 text-nomi-ink-40" aria-hidden="true" />
    </button>
    <div ref={dockRef} className="pointer-events-none absolute inset-x-0 z-40 flex justify-center px-4 pb-3" style={{ bottom: transportClearance }}>
      <div className="pointer-events-auto grid w-full max-w-[560px] gap-1.5" data-agent-collapsed-dock="true">
        {children}
      </div>
    </div>
  </>
}
