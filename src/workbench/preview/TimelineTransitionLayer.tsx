import React from 'react'
import { useTranslation } from 'react-i18next'
import { NomiImage } from '../../design/media'
import type { TimelineClip } from '../timeline/timelineTypes'
import type { ResolvedTimelineTransition } from '../timeline/timelineTransition'
import { resolveClipFraming } from '../timeline/clipFraming'
import { resolveTimelineClipPlaybackUrl } from '../timeline/timelinePlaybackUrl'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { selectStableCanvasNodes } from '../generationCanvas/store/canvasNodeProjection'
import { useVideoPlaybackHeal } from '../../media/useVideoPlaybackHeal'
import { cn } from '../../utils/cn'
import { resolvePreviewMediaVolume } from '../timeline/clipAudio'
import { framingToMediaStyle, mediaFitClass } from './previewMediaFraming'
import { usePreviewVideoPlayheadSync } from './usePreviewVideoPlayheadSync'

type StageSize = { width: number; height: number } | null

type TransitionFrameProps = {
  clip: TimelineClip
  opacity: number
  sampleFrame: number
  playheadFrame: number
  fps: number
  playing: boolean
  volume: number
  muted: boolean
  stageSize: StageSize
  onPlaybackError?: (message: string) => void
  onPlaybackStop?: () => void
}

function TransitionFrame({
  clip,
  opacity,
  sampleFrame,
  playheadFrame,
  fps,
  playing,
  volume,
  muted,
  stageSize,
  onPlaybackError,
  onPlaybackStop,
}: TransitionFrameProps): JSX.Element {
  const { t } = useTranslation()
  // 转场层同 TimelinePreview：只按 sourceNodeId 解析回放 URL，不读 position → 位置稳定投影（suspect #1）。
  const generationNodes = useGenerationCanvasStore(selectStableCanvasNodes)
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const rawVideoUrl = clip.type === 'video' ? resolveTimelineClipPlaybackUrl(clip, generationNodes) : ''
  const heal = useVideoPlaybackHeal({ rawUrl: rawVideoUrl })
  const framing = resolveClipFraming(clip)
  const mediaStyle = framingToMediaStyle(framing, stageSize)
  const frame = playing ? playheadFrame : sampleFrame

  usePreviewVideoPlayheadSync(videoRef, {
    videoClip: clip.type === 'video' ? clip : null,
    videoUrl: heal.playbackUrl,
    playheadFrame: frame,
    fps,
    playing,
  })

  React.useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.volume = resolvePreviewMediaVolume(clip, frame, volume, muted)
    video.muted = muted
  }, [clip, frame, heal.playbackUrl, muted, volume])

  React.useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (!playing) {
      if (!video.paused) video.pause()
      return
    }
    void video.play().catch((error: unknown) => {
      const message = error instanceof Error && error.message ? error.message : 'video play failed'
      onPlaybackError?.(t('timelinePreview.videoPlayFailed', { message }))
      onPlaybackStop?.()
    })
  }, [heal.playbackUrl, onPlaybackError, onPlaybackStop, playing, t])

  React.useEffect(() => {
    if (heal.healingText) onPlaybackError?.(heal.healingText)
    else if (heal.failureText) onPlaybackError?.(t('timelinePreview.videoLoadFailed', { message: heal.failureText }))
  }, [heal.failureText, heal.healingText, onPlaybackError, t])

  return (
    <div className="absolute inset-0 bg-[var(--nomi-paper)]" style={{ opacity }} aria-hidden="true">
      {clip.type === 'image' ? (
        <NomiImage
          eager
          className={cn('absolute inset-0 h-full w-full select-none', mediaFitClass(framing))}
          src={clip.url || clip.thumbnailUrl || ''}
          alt=""
          style={mediaStyle}
        />
      ) : heal.playbackUrl ? (
        <video
          ref={videoRef}
          className={cn('absolute inset-0 h-full w-full select-none', mediaFitClass(framing))}
          src={heal.playbackUrl}
          crossOrigin="use-credentials"
          muted={muted}
          playsInline
          preload="auto"
          style={mediaStyle}
          onError={(event) => {
            heal.onError(event)
            onPlaybackStop?.()
          }}
          onLoadedMetadata={heal.onLoadedMetadata}
        />
      ) : null}
    </div>
  )
}

export type TimelineTransitionLayerProps = {
  resolved: ResolvedTimelineTransition
  playheadFrame: number
  fps: number
  playing?: boolean
  volume?: number
  muted?: boolean
  stageSize?: StageSize
  zIndex?: number
  onPlaybackError?: (message: string) => void
  onPlaybackStop?: () => void
}

export function TimelineTransitionLayer({
  resolved,
  playheadFrame,
  fps,
  playing = false,
  volume = 0,
  muted = true,
  stageSize = null,
  zIndex = 1,
  onPlaybackError,
  onPlaybackStop,
}: TimelineTransitionLayerProps): JSX.Element {
  return (
    <div
      className={cn(
        'workbench-preview-transition absolute inset-0 overflow-hidden pointer-events-none',
        resolved.backdrop === 'black' ? 'bg-black' : 'bg-[var(--nomi-paper)]',
      )}
      data-transition-type={resolved.transition.type}
      data-transition-progress={resolved.progress.toFixed(3)}
      style={{ zIndex }}
      aria-hidden="true"
    >
      <TransitionFrame
        clip={resolved.fromClip}
        opacity={resolved.outgoingOpacity}
        sampleFrame={Math.max(resolved.fromClip.startFrame, resolved.fromClip.endFrame - 1)}
        playheadFrame={playheadFrame}
        fps={fps}
        playing={false}
        volume={volume}
        muted={muted}
        stageSize={stageSize}
        onPlaybackError={onPlaybackError}
        onPlaybackStop={onPlaybackStop}
      />
      <TransitionFrame
        clip={resolved.toClip}
        opacity={resolved.incomingOpacity}
        sampleFrame={playheadFrame}
        playheadFrame={playheadFrame}
        fps={fps}
        playing={playing}
        volume={volume}
        muted={muted}
        stageSize={stageSize}
        onPlaybackError={onPlaybackError}
        onPlaybackStop={onPlaybackStop}
      />
    </div>
  )
}
