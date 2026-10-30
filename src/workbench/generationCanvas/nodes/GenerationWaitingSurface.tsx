import React, { type JSX } from 'react'
import { ProgressRevealCanvas } from './ProgressRevealCanvas'
/** Shared image/video boundary: no fabricated image, and final output cannot retain an overlay. */
export function GenerationWaitingSurface({ audio = false, previewUrl, finalUrl, completed = false, onComplete,
  previewLabel, percent, zoom = 1, inViewport = true, progressReveal, label }: {
  audio?: boolean
  motion?: 'reduced'
  previewUrl?: string
  finalUrl?: string
  completed?: boolean
  onComplete?: () => void
  previewLabel: string
  percent?: number
  zoom?: number
  inViewport?: boolean
  /**
   * 导入按真实字节比例绘制格子；没有新进度就不绘制。
   */
  progressReveal?: { ratio: number; imageUrl?: string }
  /** 过程中的左上角小标签（完成即消失；不新增常驻控件）。 */
  label?: string
}): JSX.Element {
  React.useEffect(() => {
    if (completed) onComplete?.()
  }, [completed, onComplete])
  const source = progressReveal ? undefined : completed ? finalUrl : previewUrl
  return <div data-generation-waiting data-process-zoom={zoom} data-process-motion="reduced" data-process-in-viewport={inViewport}
    className="absolute inset-0 overflow-hidden rounded-nomi bg-nomi-ink-05 pointer-events-none">
    {!audio ? <div data-process-static-grid aria-hidden className="absolute inset-0 bg-[linear-gradient(135deg,var(--nomi-ink-20),var(--nomi-ink-05)_70%)] [mask-image:repeating-linear-gradient(90deg,var(--nomi-ink)_0_14px,transparent_14px_16px),repeating-linear-gradient(0deg,var(--nomi-ink)_0_14px,transparent_14px_16px)] [mask-composite:intersect]" /> : null}
    {progressReveal ? <ProgressRevealCanvas imageUrl={progressReveal.imageUrl} ratio={progressReveal.ratio} /> : null}
    {audio ? <div data-process-audio-waiting className="absolute inset-x-4 top-1/2 flex h-8 -translate-y-1/2 items-center justify-center gap-1" aria-hidden>
      {Array.from({ length: 24 }, (_, index) => <span key={index} className="h-6 w-1 shrink-0 rounded-full bg-nomi-ink-30" />)}
    </div> : null}
    {source ? <img src={source} alt="" className="absolute inset-0 size-full object-contain" draggable={false} /> : null}
    {label ? <span data-process-label className="absolute top-3 left-3 rounded-full bg-[var(--nomi-overlay-chip)] px-3 py-1 text-caption text-nomi-media-ink">{label}</span> : null}
    {previewUrl && !completed ? <>
      <div data-process-preview-scrim className="absolute inset-0 bg-[var(--nomi-scrim)]" />
      <span className="absolute top-12 left-3 rounded-full bg-[var(--nomi-overlay-chip)] px-3 py-1 text-body text-nomi-media-ink">{previewLabel}</span>
    </> : null}
    {percent !== undefined && !completed ? <div data-process-progress className="absolute inset-x-0 bottom-0 h-1 bg-nomi-ink-10">
      <div className="h-full bg-nomi-accent" style={{ width: `${percent}%` }} />
    </div> : null}
  </div>
}
