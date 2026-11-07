import { canvasWindowInput } from '../../shortcutSurface'
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useViewport } from '@xyflow/react'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { NomiImage } from '../../../design/media'
import { useFilmstrip } from '../../../media/useFilmstrip'
import { useNodeAttachedPanel } from './nodeAttachedPanel'
import { MIN_TRIM_SECONDS } from './trimVideoToNode'
import { useNodeVideoClock, useNodeVideoSession } from './useNodeVideoSession'
import { VideoTrimFilmstrip } from './VideoTrimFilmstrip'

/** Selection lives below the card; the guarded source player is the only preview. */
export default function NodeVideoClipPanel({ node, onClose }: { node: GenerationCanvasNode; onClose: () => void }): JSX.Element {
  const { t } = useTranslation()
  const { zoom: canvasZoom } = useViewport()
  const zoom = canvasZoom || 1
  useNodeAttachedPanel(node.id)
  const { player, setEditing, selection, seek } = useNodeVideoSession()
  const clock = useNodeVideoClock(player)
  const duration = clock.duration
  const [range, setRange] = React.useState({ start: 0, end: duration })
  const filmstrip = useFilmstrip(node.result?.url)
  React.useEffect(() => {
    setEditing(true)
    return () => { player?.pause(); selection.current = null; setEditing(false) }
  }, [player, selection, setEditing])
  React.useEffect(() => {
    const next = { start: 0, end: duration }
    setRange(next)
    selection.current = next
    seek(0)
  }, [duration, selection, seek])
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
      document.querySelector<HTMLButtonElement>(`[data-node-id="${CSS.escape(node.id)}"] [data-toolbar-action="trim"]`)?.focus()
    }
    canvasWindowInput.addEventListener('keydown', onKey)
    return () => canvasWindowInput.removeEventListener('keydown', onKey)
  }, [node.id, onClose])
  React.useEffect(() => {
    if (!player || !clock.playing) return
    let frame = 0
    const tick = () => {
      const active = selection.current
      if (!active) return
      if (player.currentTime >= active.end) { player.pause(); player.currentTime = Math.max(active.start, active.end - 0.001); return }
      if (player.currentTime < active.start) player.currentTime = active.start
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [clock.playing, player, selection])
  const change = (edge: 'start' | 'end', value: number) => {
    const next = edge === 'start'
      ? { ...range, start: Math.max(0, Math.min(range.end - MIN_TRIM_SECONDS, value)) }
      : { ...range, end: Math.min(duration, Math.max(range.start + MIN_TRIM_SECONDS, value)) }
    setRange(next)
    selection.current = next
    seek(edge === 'end' ? Math.max(next.start, next.end - 0.001) : next.start)
  }
  const canEdit = Boolean(player && player.readyState >= 1 && !player.error && duration > 0 && range.end - range.start >= MIN_TRIM_SECONDS - 1e-9)
  return <div className="absolute left-1/2 z-[20]" style={{ top: `calc(100% + ${14 / zoom}px)`, transform: `translateX(-50%) scale(${1 / zoom})`, transformOrigin: 'top center' }}>
    <div role="dialog" aria-label={t('generationCommon.videoTrim.panelAria')} data-video-clip-panel className="nodrag nowheel flex flex-col gap-2" style={{ width: Math.max(260, node.size?.width ?? 340) }} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key !== 'Escape') event.stopPropagation() }}>
      <VideoTrimFilmstrip duration={duration || 1} range={range} time={clock.time} disabled={!canEdit} labels={{ seek: t('generationCommon.videoTrim.seek'), start: t('generationCommon.videoTrim.tcIn'), end: t('generationCommon.videoTrim.tcOut') }} onChange={change} onSeek={seek}>
        {filmstrip?.status === 'ready' ? <NomiImage src={filmstrip.url} alt="" className="h-full w-full object-fill" /> : <span className="flex h-full w-full items-center justify-center px-3 text-micro text-nomi-ink-60">{t(filmstrip?.status === 'failed' ? 'generationCommon.videoTrim.filmstripFailed' : 'generationCommon.videoTrim.filmstripLoading')}</span>}
      </VideoTrimFilmstrip>
    </div>
  </div>
}
