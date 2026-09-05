import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconPlus } from '@tabler/icons-react'
import { WorkbenchIconButton } from '../../../design/actions'
import { useFilmstrip } from '../../../media/useFilmstrip'
import { cn } from '../../../utils/cn'
import { canvasDragExceededThreshold } from '../components/canvasPointerGestureModel'
import type { TimelineClip, TimelineState } from '../../timeline/timelineTypes'
import type { SnapResult } from '../../timeline/snapping'
import {
  resolveClipNodeFilmstripStyle,
  resolveClipNodeTimelineLayout,
  resolveClipNodeTimelineViewport,
} from './clipNodeTimelineLayout'
import {
  clipNodeClientDeltaToFrames,
  resolveClipNodeDragTarget,
  resolveClipNodeResizeTarget,
  type ClipNodeResizeTarget,
} from './clipNodeDragModel'
import { formatClipNodeDuration } from './clipNodeVisual'

type ClipNodeTimelineProps = {
  timeline: TimelineState
  canvasZoom: number
  selectedClipId?: string
  onSelectClip: (clipId: string, frame: number) => void
  onMoveClip: (clipId: string, startFrame: number) => void
  onResizeClip: (clipId: string, edge: 'left' | 'right', deltaFrame: number) => void
  onScrubPlayhead?: (frame: number) => void
  onAddMaterial?: () => void
}

type ClipDragPreview = {
  clipId: string
  startFrame: number
  snap: SnapResult | null
}

type ClipResizePreview = ClipNodeResizeTarget & {
  clipId: string
  edge: 'left' | 'right'
}

function ClipThumb({ clip, pxPerFrame }: { clip: TimelineClip; pxPerFrame: number }): JSX.Element {
  const filmstrip = useFilmstrip(clip.type === 'video' && !clip.thumbnailUrl ? clip.url : '')
  if (clip.type === 'image' && (clip.thumbnailUrl || clip.url)) {
    return <img src={clip.thumbnailUrl || clip.url} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />
  }
  if (clip.type === 'video' && clip.thumbnailUrl) {
    return <img src={clip.thumbnailUrl} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />
  }
  if (clip.type === 'video' && filmstrip?.status === 'ready') {
    const filmstripStyle = resolveClipNodeFilmstripStyle(clip, pxPerFrame)
    return (
      <span
        className="absolute inset-0 bg-nomi-ink-05"
        style={{
          backgroundImage: `url(${JSON.stringify(filmstrip.url)})`,
          ...filmstripStyle,
          backgroundRepeat: 'no-repeat',
        }}
        data-clip-filmstrip="true"
        aria-hidden="true"
      />
    )
  }
  return <span className="absolute inset-0 bg-nomi-ink-10" aria-hidden="true" />
}

function ClipHandle({
  edge,
  canvasZoom,
  onPointerDown,
}: {
  edge: 'left' | 'right'
  canvasZoom: number
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>, edge: 'left' | 'right') => void
}): JSX.Element {
  const { t } = useTranslation()
  const hitWidth = Math.min(28, Math.max(16, 12 / Math.max(0.2, canvasZoom)))

  return (
    <button
      type="button"
      data-clip-handle="true"
      className={cn(
        'absolute inset-y-0 z-30 grid cursor-ew-resize place-items-center border-0 bg-nomi-paper/10 p-0 transition-colors hover:bg-nomi-accent/30 focus-visible:bg-nomi-accent/30 focus-visible:outline-none',
        edge === 'left' ? 'left-0' : 'right-0',
      )}
      style={{ width: hitWidth }}
      aria-label={edge === 'left' ? t('generationCommon.clipNode.resizeStart') : t('generationCommon.clipNode.resizeEnd')}
      title={edge === 'left' ? t('generationCommon.clipNode.resizeStart') : t('generationCommon.clipNode.resizeEnd')}
      onPointerDown={(event) => onPointerDown(event, edge)}
      onClick={(event) => event.stopPropagation()}
    >
      <span className="block h-6 w-1 rounded-full bg-nomi-paper shadow-nomi-sm" aria-hidden="true" />
    </button>
  )
}

function ClipItem({
  clip,
  selected,
  timeline,
  pxPerFrame,
  canvasZoom,
  left,
  width,
  previewStartFrame,
  resizePreview,
  onSelectClip,
  onMoveClip,
  onResizeClip,
  onDragPreview,
  onResizePreview,
}: Pick<ClipNodeTimelineProps, 'onSelectClip' | 'onMoveClip' | 'onResizeClip'> & {
  clip: TimelineClip
  selected: boolean
  timeline: TimelineState
  pxPerFrame: number
  canvasZoom: number
  left: number
  width: number
  previewStartFrame?: number
  resizePreview?: ClipResizePreview
  onDragPreview: (preview: ClipDragPreview | null) => void
  onResizePreview: (preview: ClipResizePreview | null) => void
}): JSX.Element {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const [resizingEdge, setResizingEdge] = React.useState<'left' | 'right' | null>(null)
  const didDragRef = React.useRef(false)
  const lastSnapKeyRef = React.useRef<string | null>(null)
  const { t } = useTranslation()

  const pulseSnap = React.useCallback(() => {
    const node = ref.current
    if (!node || typeof node.animate !== 'function') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    node.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.015)' }, { transform: 'scale(1)' }], {
      duration: 130,
      easing: 'cubic-bezier(.2,.7,.3,1)',
    })
  }, [])

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if ((event.target as HTMLElement).closest('[data-clip-handle]')) return
    event.preventDefault()
    event.stopPropagation()
    const target = event.currentTarget
    const pointerId = event.pointerId
    const originX = event.clientX
    const originY = event.clientY
    const originStart = clip.startFrame
    let lastTarget = { startFrame: originStart, snap: null as SnapResult | null }
    let didDrag = false
    let finished = false
    didDragRef.current = false
    lastSnapKeyRef.current = null
    target.setPointerCapture(pointerId)

    const cleanup = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleCancel)
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('blur', handleCancel)
      target.removeEventListener('lostpointercapture', handleLostPointerCapture)
    }

    const finish = (commit: boolean) => {
      if (finished) return
      finished = true
      cleanup()
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
      setDragging(false)
      onDragPreview(null)
      lastSnapKeyRef.current = null
      if (didDrag) window.setTimeout(() => { didDragRef.current = false }, 0)
      if (commit && didDrag && lastTarget.startFrame !== originStart) {
        onMoveClip(clip.id, lastTarget.startFrame)
      }
    }

    function handleMove(moveEvent: PointerEvent) {
      if (moveEvent.pointerId !== pointerId) return
      if (!didDrag && !canvasDragExceededThreshold(originX, originY, moveEvent.clientX, moveEvent.clientY)) return
      moveEvent.preventDefault()
      if (!didDrag) {
        didDrag = true
        didDragRef.current = true
        setDragging(true)
      }
      const screenPxPerFrame = pxPerFrame * Math.max(0.1, canvasZoom)
      const desiredStartFrame = originStart + clipNodeClientDeltaToFrames(moveEvent.clientX - originX, pxPerFrame, canvasZoom)
      const resolved = resolveClipNodeDragTarget({
        timeline,
        clipId: clip.id,
        desiredStartFrame,
        pxPerFrame: screenPxPerFrame,
        snapping: !moveEvent.shiftKey,
      })
      if (!resolved) return
      lastTarget = resolved
      const snapKey = resolved.snap ? `${resolved.snap.frame}:${resolved.snap.point.type}` : null
      if (snapKey && snapKey !== lastSnapKeyRef.current) pulseSnap()
      lastSnapKeyRef.current = snapKey
      onDragPreview({ clipId: clip.id, ...resolved })
    }

    function handleUp(upEvent: PointerEvent) {
      if (upEvent.pointerId !== pointerId) return
      finish(true)
    }

    function handleCancel(cancelEvent: Event) {
      if (cancelEvent instanceof PointerEvent && cancelEvent.pointerId !== pointerId) return
      finish(false)
    }

    function handleKeyDown(keyEvent: KeyboardEvent) {
      if (keyEvent.key !== 'Escape') return
      keyEvent.preventDefault()
      finish(false)
    }

    function handleLostPointerCapture(captureEvent: PointerEvent) {
      if (captureEvent.pointerId !== pointerId) return
      finish(false)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleCancel)
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('blur', handleCancel)
    target.addEventListener('lostpointercapture', handleLostPointerCapture)
  }

  const beginResize = (event: React.PointerEvent<HTMLButtonElement>, edge: 'left' | 'right'): void => {
    event.preventDefault()
    event.stopPropagation()
    const target = event.currentTarget
    const pointerId = event.pointerId
    const originX = event.clientX
    let lastTarget: ClipNodeResizeTarget | null = null
    let didResize = false
    let finished = false
    let animationFrame = 0
    let pendingMove: { clientX: number; shiftKey: boolean } | null = null
    lastSnapKeyRef.current = null
    target.setPointerCapture(pointerId)

    const applyMove = (move: { clientX: number; shiftKey: boolean }) => {
      const desiredDeltaFrame = clipNodeClientDeltaToFrames(move.clientX - originX, pxPerFrame, canvasZoom)
      if (!didResize && Math.abs(move.clientX - originX) < 2) return
      const screenPxPerFrame = pxPerFrame * Math.max(0.1, canvasZoom)
      const resolved = resolveClipNodeResizeTarget({
        timeline,
        clipId: clip.id,
        edge,
        desiredDeltaFrame,
        pxPerFrame: screenPxPerFrame,
        snapping: !move.shiftKey,
      })
      if (!resolved) return
      didResize = true
      lastTarget = resolved
      setResizingEdge(edge)
      const snapKey = resolved.snap ? `${resolved.snap.frame}:${resolved.snap.point.type}` : null
      if (snapKey && snapKey !== lastSnapKeyRef.current) pulseSnap()
      lastSnapKeyRef.current = snapKey
      onResizePreview({ clipId: clip.id, edge, ...resolved })
    }

    const flushPendingMove = () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
      animationFrame = 0
      if (!pendingMove) return
      const move = pendingMove
      pendingMove = null
      applyMove(move)
    }

    const cleanup = () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
      animationFrame = 0
      pendingMove = null
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleCancel)
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('blur', handleCancel)
      target.removeEventListener('lostpointercapture', handleLostPointerCapture)
    }

    const finish = (commit: boolean) => {
      if (finished) return
      if (commit) flushPendingMove()
      finished = true
      cleanup()
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
      setResizingEdge(null)
      onResizePreview(null)
      lastSnapKeyRef.current = null
      if (commit && didResize && lastTarget && lastTarget.deltaFrame !== 0) {
        onResizeClip(clip.id, edge, lastTarget.deltaFrame)
      }
    }

    function handleMove(moveEvent: PointerEvent) {
      if (moveEvent.pointerId !== pointerId) return
      moveEvent.preventDefault()
      pendingMove = { clientX: moveEvent.clientX, shiftKey: moveEvent.shiftKey }
      if (animationFrame) return
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0
        if (!pendingMove) return
        const move = pendingMove
        pendingMove = null
        applyMove(move)
      })
    }

    function handleUp(upEvent: PointerEvent) {
      if (upEvent.pointerId !== pointerId) return
      finish(true)
    }

    function handleCancel(cancelEvent: Event) {
      if (cancelEvent instanceof PointerEvent && cancelEvent.pointerId !== pointerId) return
      finish(false)
    }

    function handleKeyDown(keyEvent: KeyboardEvent) {
      if (keyEvent.key !== 'Escape') return
      keyEvent.preventDefault()
      finish(false)
    }

    function handleLostPointerCapture(captureEvent: PointerEvent) {
      if (captureEvent.pointerId !== pointerId) return
      finish(false)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleCancel)
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('blur', handleCancel)
    target.addEventListener('lostpointercapture', handleLostPointerCapture)
  }

  const handleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    event.stopPropagation()
    if (didDragRef.current) {
      didDragRef.current = false
      return
    }
    const rect = ref.current?.getBoundingClientRect()
    const ratio = rect?.width ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : 0
    const visibleFrames = Math.max(1, clip.endFrame - clip.startFrame)
    onSelectClip(clip.id, Math.min(clip.endFrame - 1, clip.startFrame + Math.floor(ratio * visibleFrames)))
  }

  const resizeDurationDelta = resizePreview
    ? (resizePreview.clip.endFrame - resizePreview.clip.startFrame) - (clip.endFrame - clip.startFrame)
    : 0
  const resizeDuration = resizePreview ? (resizePreview.clip.endFrame - resizePreview.clip.startFrame) / Math.max(1, timeline.fps || 30) : 0
  const resizeDurationLabel = `${resizeDurationDelta >= 0 ? '+' : '-'}${Math.abs(resizeDurationDelta / Math.max(1, timeline.fps || 30)).toFixed(1)}s · ${resizeDuration.toFixed(1)}s`

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      data-testid="clip-node-clip"
      data-clip-id={clip.id}
      data-start-frame={resizePreview?.clip.startFrame ?? previewStartFrame ?? clip.startFrame}
      data-end-frame={resizePreview?.clip.endFrame ?? clip.endFrame}
      data-persisted-start-frame={clip.startFrame}
      data-persisted-end-frame={clip.endFrame}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-resizing={resizingEdge ?? 'false'}
      data-resize-limited={resizePreview?.limited ? 'true' : 'false'}
      className={cn(
        'absolute inset-y-1 overflow-hidden rounded-nomi-sm border text-left shadow-nomi-sm',
        'cursor-grab select-none touch-none active:cursor-grabbing',
        clip.type === 'video' ? 'border-workbench-video/60 bg-workbench-video-soft' : 'border-nomi-accent/60 bg-nomi-accent-soft',
        selected ? 'ring-2 ring-inset ring-nomi-accent' : 'ring-1 ring-inset ring-transparent',
        dragging || resizingEdge ? 'z-40 opacity-90' : 'z-10',
      )}
      style={{ left, width }}
      onPointerDown={beginDrag}
      onClick={handleClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelectClip(clip.id, clip.startFrame)
        }
      }}
    >
      <ClipThumb clip={clip} pxPerFrame={pxPerFrame} />
      {dragging ? (
        <span className="pointer-events-none absolute right-1 top-1 z-20 rounded-nomi-sm bg-[var(--nomi-snap-tag)] px-1 py-px font-mono text-micro tabular-nums text-[var(--nomi-paper)]">
          {formatClipNodeDuration(previewStartFrame ?? clip.startFrame, timeline.fps || 30)}
        </span>
      ) : null}
      {resizingEdge && resizePreview ? (
        <span className="pointer-events-none absolute right-1 top-1 z-20 rounded-nomi-sm bg-[var(--nomi-snap-tag)] px-1 py-px font-mono text-micro tabular-nums text-[var(--nomi-paper)]">
          {resizeDurationLabel}
        </span>
      ) : null}
      <span className="absolute inset-x-0 bottom-0 truncate bg-nomi-paper/80 px-1.5 py-1 text-micro font-medium text-nomi-ink">{clip.label || t('generationCommon.clipNode.timeline')}</span>
      {selected ? <>
        <ClipHandle edge="left" canvasZoom={canvasZoom} onPointerDown={beginResize} />
        <ClipHandle edge="right" canvasZoom={canvasZoom} onPointerDown={beginResize} />
      </> : null}
    </div>
  )
}

export default function ClipNodeTimeline({
  timeline,
  canvasZoom,
  selectedClipId,
  onSelectClip,
  onMoveClip,
  onResizeClip,
  onScrubPlayhead,
  onAddMaterial,
}: ClipNodeTimelineProps): JSX.Element {
  const { t } = useTranslation()
  const track = timeline.tracks[0]
  const clips = track?.clips ?? []
  const [axisWidth, setAxisWidth] = React.useState(420)
  const [dragPreview, setDragPreview] = React.useState<ClipDragPreview | null>(null)
  const [resizePreview, setResizePreview] = React.useState<ClipResizePreview | null>(null)
  const axisRef = React.useRef<HTMLDivElement | null>(null)
  React.useLayoutEffect(() => {
    const axis = axisRef.current
    if (!axis) return
    const update = () => setAxisWidth(Math.max(160, axis.clientWidth))
    update()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(update)
      observer.observe(axis)
      return () => observer.disconnect()
    }
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  const viewport = React.useMemo(
    () => resolveClipNodeTimelineViewport({ viewportWidth: axisWidth, timeline }),
    [axisWidth, timeline],
  )
  const layouts = React.useMemo(() => resolveClipNodeTimelineLayout(timeline, viewport), [timeline, viewport])
  const ticks = React.useMemo(() => {
    const fps = Math.max(1, timeline.fps || 30)
    const tickCount = Math.floor(viewport.axisEndSeconds / 10)
    return Array.from({ length: tickCount + 1 }, (_, index) => {
      const seconds = index * 10
      const frame = Math.round(seconds * fps)
      return { frame, pixel: viewport.frameToPixel(frame), label: formatClipNodeDuration(frame, fps) }
    })
  }, [timeline.fps, viewport])

  const scrubAtClientX = (clientX: number): void => {
    const content = axisRef.current?.firstElementChild
    if (!(content instanceof HTMLElement)) return
    const rect = content.getBoundingClientRect()
    const localPixel = (clientX - rect.left) / Math.max(0.1, canvasZoom)
    const frame = Math.min(viewport.timelineEndFrame, viewport.pixelToFrame(localPixel))
    onScrubPlayhead?.(frame)
  }

  const beginScrub = (event: React.PointerEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement
    if (target.closest('[data-testid="clip-node-clip"]') || target.closest('button')) return
    event.preventDefault()
    event.stopPropagation()
    const pointerId = event.pointerId
    const currentTarget = event.currentTarget
    currentTarget.setPointerCapture(pointerId)
    scrubAtClientX(event.clientX)
    const move = (moveEvent: PointerEvent) => scrubAtClientX(moveEvent.clientX)
    const end = () => {
      if (currentTarget.hasPointerCapture(pointerId)) currentTarget.releasePointerCapture(pointerId)
      currentTarget.removeEventListener('pointermove', move)
      currentTarget.removeEventListener('pointerup', end)
      currentTarget.removeEventListener('pointercancel', end)
    }
    currentTarget.addEventListener('pointermove', move)
    currentTarget.addEventListener('pointerup', end)
    currentTarget.addEventListener('pointercancel', end)
  }

  const activeSnap = dragPreview?.snap ?? resizePreview?.snap ?? null

  return (
    <section className="grid gap-1.5" aria-label={t('generationCommon.clipNode.timeline')} onWheel={(event) => event.stopPropagation()}>
      <div
        ref={axisRef}
        className="relative h-20 min-w-0 overflow-x-auto overflow-y-hidden overscroll-contain rounded-nomi-sm border border-nomi-line bg-nomi-bg"
      >
        <div
          className="relative h-full"
          style={{ width: viewport.contentWidth, minWidth: '100%' }}
          onPointerDown={beginScrub}
          data-testid="clip-node-axis-content"
        >
          <div className="absolute top-1.5 h-5" style={{ left: viewport.leadingSlotWidth + viewport.axisInset, width: viewport.timelineWidth }} data-testid="clip-node-ruler" aria-label={t('generationCommon.clipNode.scrub')}>
            {ticks.map((tick, index) => (
              <span
                key={`${tick.frame}-${index}`}
                className={cn(
                  'absolute top-0 text-micro text-nomi-ink/55',
                  index === 0 ? 'translate-x-0' : '-translate-x-1/2',
                )}
                style={{ left: tick.pixel - viewport.leadingSlotWidth - viewport.axisInset }}
              >
                {tick.label}
              </span>
            ))}
          </div>
          <div className="pointer-events-none absolute top-7 h-1 border-t border-nomi-paper/15" style={{ left: viewport.leadingSlotWidth + viewport.axisInset, width: viewport.timelineWidth }} aria-hidden="true">
            {ticks.map((tick) => (
              <span key={`mark-${tick.frame}`} className="absolute top-0 h-2 border-l border-nomi-paper/20" style={{ left: tick.pixel - viewport.leadingSlotWidth - viewport.axisInset }} />
            ))}
          </div>
          <div className="absolute bottom-2 h-10" style={{ left: viewport.leadingSlotWidth + viewport.axisInset, width: viewport.timelineWidth }} data-testid="clip-node-media-lane">
            <span
              className="pointer-events-none absolute inset-y-0 z-20 w-px bg-nomi-accent"
              style={{ left: Math.max(0, viewport.frameToPixel(timeline.playheadFrame) - viewport.leadingSlotWidth - viewport.axisInset) }}
              data-testid="clip-node-playhead"
              aria-hidden="true"
            />
            {clips.map((clip) => {
              const layout = layouts.find((item) => item.id === clip.id)
              if (!layout) return null
              const previewStartFrame = dragPreview?.clipId === clip.id ? dragPreview.startFrame : undefined
              const clipResizePreview = resizePreview?.clipId === clip.id ? resizePreview : undefined
              const previewLeft = clipResizePreview
                ? Math.round(clipResizePreview.clip.startFrame * viewport.pxPerFrame)
                : previewStartFrame == null
                  ? layout.left
                  : Math.round(previewStartFrame * viewport.pxPerFrame)
              const previewWidth = clipResizePreview
                ? Math.max(4, Math.round((clipResizePreview.clip.endFrame - clipResizePreview.clip.startFrame) * viewport.pxPerFrame))
                : layout.width
              return (
                <ClipItem
                  key={clip.id}
                  clip={clip}
                  selected={clip.id === selectedClipId}
                  timeline={timeline}
                  pxPerFrame={viewport.pxPerFrame}
                  canvasZoom={canvasZoom}
                  left={previewLeft}
                  width={previewWidth}
                  previewStartFrame={previewStartFrame}
                  resizePreview={clipResizePreview}
                  onSelectClip={onSelectClip}
                  onMoveClip={onMoveClip}
                  onResizeClip={onResizeClip}
                  onDragPreview={(preview) => {
                    setResizePreview(null)
                    setDragPreview(preview)
                  }}
                  onResizePreview={(preview) => {
                    setDragPreview(null)
                    setResizePreview(preview)
                  }}
                />
              )
            })}
            {!clips.length ? <div className="absolute inset-0 grid place-items-center text-micro text-nomi-ink/55">{t('generationCommon.nodeEmpty.clip.description')}</div> : null}
          </div>
          {activeSnap ? (
            <div
              className="pointer-events-none absolute inset-y-0 z-50 w-0"
              style={{ left: viewport.frameToPixel(activeSnap.frame) }}
              data-testid="clip-node-snap-guide"
              aria-hidden="true"
            >
              <span className="absolute inset-y-0 left-0 w-px -translate-x-1/2 bg-[repeating-linear-gradient(var(--nomi-snap)_0_4px,transparent_4px_8px)]" />
              <span className="absolute left-1 top-0.5 whitespace-nowrap rounded-nomi-sm bg-[var(--nomi-snap-tag)] px-1 font-mono text-micro leading-[14px] text-[var(--nomi-paper)]">
                {activeSnap.point.label}
              </span>
            </div>
          ) : null}
          {onAddMaterial ? (
            <WorkbenchIconButton
              label={t('generationCommon.clipNode.addMaterial')}
              icon={<IconPlus size={20} />}
              className="absolute bottom-2 left-2 size-12 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-nomi-ink hover:bg-nomi-accent hover:text-nomi-paper"
              onClick={onAddMaterial}
            />
          ) : null}
        </div>
      </div>
    </section>
  )
}
