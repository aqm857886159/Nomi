import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconCamera, IconPlayerPause, IconPlayerPlay, IconVolume, IconVolumeOff } from '@tabler/icons-react'
import { useViewport } from '@xyflow/react'
import { NomiLoadingMark } from '../../../design/identity'
import { WorkbenchIconButton } from '../../../design/actions'
import { frameTimecode } from './frameTimecode'
import { markNodeVideoUserPlayback } from './nodeVideoPlayback'
import { useNodeVideoClock, useNodeVideoSession } from './useNodeVideoSession'
import { useNodeStageHost } from './nodeStageHostContext'

const BUTTON = 'shrink-0 text-nomi-media-ink hover:text-nomi-media-ink hover:bg-nomi-media-ink/20'

export function NodeVideoControls({ reportFeedback }: { reportFeedback: (message: string) => void }): React.JSX.Element {
  const host = useNodeStageHost()
  return host === 'list-detail'
    ? <NodeVideoControlsBody reportFeedback={reportFeedback} zoom={1} />
    : <CanvasNodeVideoControls reportFeedback={reportFeedback} />
}

function CanvasNodeVideoControls({ reportFeedback }: { reportFeedback: (message: string) => void }): React.JSX.Element {
  const { zoom } = useViewport()
  return <NodeVideoControlsBody reportFeedback={reportFeedback} zoom={zoom || 1} />
}

function NodeVideoControlsBody({ reportFeedback, zoom }: { reportFeedback: (message: string) => void; zoom: number }): React.JSX.Element {
  const { t } = useTranslation()
  const session = useNodeVideoSession()
  const { player } = session
  const clock = useNodeVideoClock(player)
  const labels = {
    play: t('generationCommon.videoTrim.play'),
    pause: t('generationCommon.videoTrim.pause'),
    seek: t('generationCommon.videoTrim.seek'),
    mute: t('generationCommon.videoTrim.mute'),
    unmute: t('generationCommon.videoTrim.unmute'),
  }
  return <div data-node-video-controls style={{ width: `${zoom * 100}%`, transform: `scale(${1 / zoom})`, transformOrigin: 'bottom left' }} className="nodrag nowheel absolute inset-x-0 bottom-0 flex items-center gap-1 bg-nomi-media-veil/80 px-2 py-1 text-nomi-media-ink" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key !== 'Escape') event.stopPropagation() }}>
    <WorkbenchIconButton size="sm" className={BUTTON} disabled={!player || clock.duration <= 0} label={clock.playing ? labels.pause : labels.play} onClick={() => {
      if (!player) return
      session.positioned.current = true
      if (!player.paused) player.pause()
      else {
        const range = session.selection.current
        if (range && (player.currentTime < range.start || player.currentTime >= range.end - 0.001)) player.currentTime = range.start
        markNodeVideoUserPlayback(player)
        void player.play().catch(() => undefined)
      }
    }} icon={clock.playing ? <IconPlayerPause /> : <IconPlayerPlay />} />
    <input type="range" aria-label={labels.seek} min={0} max={clock.duration || 1} step={0.01} value={clock.time} disabled={clock.duration <= 0} className="h-5 min-w-0 flex-1 cursor-pointer accent-nomi-media-ink" onChange={(event) => {
      const range = session.selection.current
      const time = Number(event.target.value)
      session.seek(range ? Math.max(range.start, Math.min(range.end - 0.001, time)) : time)
      clock.refresh()
    }} />
    {zoom >= 0.75 && <span className="pointer-events-none font-mono text-micro tabular-nums" data-node-video-time>{frameTimecode(clock.time)}</span>}
    <WorkbenchIconButton size="sm" className={BUTTON} disabled={!player} label={clock.muted ? labels.unmute : labels.mute} onClick={() => { if (player) player.muted = !player.muted }} icon={clock.muted ? <IconVolumeOff /> : <IconVolume />} />
    {session.writable && <WorkbenchIconButton size="sm" className={BUTTON} disabled={!clock.ready || session.busy} label={t('generationCommon.videoToolbar.currentFrame')} title={t('generationCommon.videoToolbar.currentFrame')} onClick={() => {
      if (!player || player.readyState < 2 || player.seeking || session.busy) return
      const atSeconds = player.currentTime
      session.seek(atSeconds)
      session.capture({ atSeconds }, reportFeedback)
    }} icon={session.busy ? <NomiLoadingMark size={16} /> : <IconCamera />} />}
  </div>
}
