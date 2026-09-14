import React from 'react'
import { ImageGeneration, type ImageGenerationHandle, type ImageGenerationCycleEvent, type ImageGenerationPreset } from 'img-fx'
import { cn } from '../../../utils/cn'
import { useReducedProcessMotion } from './useReducedProcessMotion'
import { ProgressRevealCanvas } from './ProgressRevealCanvas'
// 兜底扫光带的样式由这个组件自己带：等待层会被画布以外的宿主挂载（设计实验室、节点直挂），
// 指望「反正 GenerationCanvas 会 import 整份画布样式」，结果就是实验室里那格根本看不到带子；
// 而把整份画布样式挂到等待层上又会改到别的面，所以只带自己这一条。
import './generationWaitingSurface.css'

const MAX_EFFECTS = 4
const effectOwners = new Set<symbol>()
const effectListeners = new Set<() => void>()
function notifyEffects(): void { for (const listener of effectListeners) listener() }

/** First mounted visible nodes own the four slots; releasing one wakes static waiters. */
function useEffectSlot(eligible: boolean): boolean {
  const owner = React.useRef(Symbol('waiting-effect'))
  const [admitted, setAdmitted] = React.useState(false)
  React.useEffect(() => {
    const token = owner.current
    const claim = () => {
      if (eligible && !effectOwners.has(token) && effectOwners.size < MAX_EFFECTS) effectOwners.add(token)
      setAdmitted(effectOwners.has(token))
    }
    effectListeners.add(claim)
    claim()
    return () => {
      effectListeners.delete(claim)
      if (effectOwners.delete(token)) notifyEffects()
    }
  }, [eligible])
  return eligible && admitted
}

function readPalette() {
  const style = getComputedStyle(document.documentElement)
  const read = (name: string) => style.getPropertyValue(name).trim()
  return {
    theme: document.documentElement.dataset.theme,
    cardBg: read('--nomi-ink-05'),
    colors: [read('--nomi-paper'), read('--nomi-accent-soft'), read('--nomi-accent'), null, null, null, null],
  }
}

function WaitingEffect({ source, final, paused, preset, onComplete }: {
  source?: string
  final: boolean
  paused: boolean
  preset: ImageGenerationPreset
  onComplete?: () => void
}): JSX.Element {
  const handle = React.useRef<ImageGenerationHandle>(null)
  const lastSource = React.useRef<string>()
  const [cycle, setCycle] = React.useState<ImageGenerationCycleEvent>({ phase: 'idle', src: null })
  const [palette, setPalette] = React.useState(readPalette)
  const images = React.useMemo(() => source ? [source] : [], [source])
  React.useEffect(() => {
    const observer = new MutationObserver(() => { lastSource.current = undefined; setPalette(readPalette()) })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  React.useEffect(() => {
    if (!source || paused || !handle.current) return
    if (lastSource.current !== source || !handle.current.isImageActive()) {
      if (handle.current.isImageActive()) handle.current.triggerRegenerate({ durationMs: 100, tintFromImage: false })
      else handle.current.triggerReveal({ hold: 'manual' })
      lastSource.current = source
    }
  }, [source, paused, palette])
  const onCycle = (event: ImageGenerationCycleEvent) => {
    setCycle(event)
    if (final && event.phase === 'visible' && event.src === source) onComplete?.()
  }
  return <ImageGeneration key={palette.theme} ref={handle} preset={preset} images={images} autoReveal={false}
    theme="auto" cardBg={palette.cardBg} colors={palette.colors} paused={paused} onCycle={onCycle}
    className="!absolute inset-0 size-full rounded-nomi" data-process-fx data-image-source={source ?? ''} data-image-count={images.length} data-cycle-phase={cycle.phase} children={<div className="size-full rounded-nomi" />} />
}

/** Shared image/video boundary: no fabricated image, and final output cannot retain an overlay. */
export function GenerationWaitingSurface({ audio = false, previewUrl, finalUrl, completed = false, onComplete,
  previewLabel, percent, zoom = 1, inViewport = true, preset = 'sweep-gradient', motion, progressReveal, label }: {
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
  preset?: ImageGenerationPreset
  /**
   * 进度驱动的渐显（导入用）：格子数 = ratio，不跑 img-fx 的时间揭示。
   * 生成没有真进度，所以生成路径不传它，继续按时间揭示。
   */
  progressReveal?: { ratio: number; imageUrl?: string }
  /** 过程中的左上角小标签（完成即消失；不新增常驻控件）。 */
  label?: string
}): JSX.Element {
  const reduced = useReducedProcessMotion() || motion === 'reduced'
  const admitted = useEffectSlot(!audio && !reduced && inViewport && zoom >= 0.4)
  const [documentHidden, setDocumentHidden] = React.useState(false)
  React.useEffect(() => {
    const update = () => setDocumentHidden(document.hidden)
    update()
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  React.useEffect(() => {
    if (!completed) return
    if (!admitted || !finalUrl || documentHidden) { onComplete?.(); return }
    // Reserve one render/commit margin inside the 1.2s wall-clock limit.
    const deadline = window.setTimeout(() => onComplete?.(), 1100)
    return () => window.clearTimeout(deadline)
  }, [completed, admitted, finalUrl, documentHidden, onComplete])
  // 进度驱动时 img-fx 只负责底下的 shader：真图由 ProgressRevealCanvas 按字节比例一格格盖上去。
  const source = progressReveal ? undefined : completed ? finalUrl : previewUrl
  return <div data-generation-waiting data-process-zoom={zoom} data-process-motion={reduced ? 'reduced' : 'full'}
    className="absolute inset-0 overflow-hidden rounded-nomi bg-nomi-ink-05 pointer-events-none">
    {admitted ? <WaitingEffect key={completed ? 'final' : 'preview'} source={source} final={completed && !progressReveal}
      paused={documentHidden || !inViewport} preset={preset} onComplete={onComplete} />
      : <div data-process-static-band className="generation-canvas-v2-node__waiting-band absolute inset-x-0 top-1/2 h-8 -translate-y-1/2" />}
    {progressReveal && admitted ? <ProgressRevealCanvas imageUrl={progressReveal.imageUrl} ratio={progressReveal.ratio} /> : null}
    {audio ? <div data-process-audio-waiting className="absolute inset-x-4 top-1/2 flex h-8 -translate-y-1/2 items-center justify-center gap-1" aria-hidden>
      {Array.from({ length: 24 }, (_, index) => <span key={index} className="h-6 w-1 shrink-0 rounded-full bg-nomi-ink-30" />)}
    </div> : null}
    {!admitted && source ? <img src={source} alt="" className="absolute inset-0 size-full object-contain" draggable={false} /> : null}
    {label ? <span data-process-label className="absolute top-3 left-3 rounded-full bg-[var(--nomi-overlay-chip)] px-3 py-1 text-caption text-nomi-media-ink">{label}</span> : null}
    {previewUrl && !completed ? <>
      <div data-process-preview-scrim className="absolute inset-0 bg-[var(--nomi-scrim)]" />
      <span className="absolute top-12 left-3 rounded-full bg-[var(--nomi-overlay-chip)] px-3 py-1 text-body text-nomi-media-ink">{previewLabel}</span>
    </> : null}
    {percent !== undefined && !completed ? <div data-process-progress className="absolute inset-x-0 bottom-0 h-1 bg-nomi-ink-10">
      <div className={cn('h-full bg-nomi-accent', !reduced && 'transition-[width] duration-200')} style={{ width: `${percent}%` }} />
    </div> : null}
  </div>
}
