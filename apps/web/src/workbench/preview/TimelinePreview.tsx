import React from 'react'
import { IconDownload, IconPlayerPause, IconPlayerPlay, IconRefresh, IconZoomIn, IconZoomOut } from '@tabler/icons-react'
import { NomiLoadingMark, WorkbenchButton, WorkbenchIconButton } from '../../design'
import { useWorkbenchStore } from '../workbenchStore'
import type { TimelineClip, TimelineState } from '../timeline/timelineTypes'
import type { PreviewAspectRatio } from '../workbenchTypes'
import { resolveVideoClipMediaTimeSeconds } from '../player/timelinePlayback'
import { exportTimelineToWebm, type ExportStatus } from '../export/timelineWebmExport'
import { buildVideoPlaybackUrl } from '../../media/videoPlaybackUrl'
import { diagnoseVideoPlaybackFailure, logVideoPlaybackFailure } from '../../media/videoPlaybackDiagnostics'

type TimelinePreviewProps = {
  activeClips: TimelineClip[]
  aspectRatio: PreviewAspectRatio
  fps: number
  playheadFrame: number
  timeline: TimelineState
}

function findClip(activeClips: TimelineClip[], type: TimelineClip['type']): TimelineClip | null {
  return activeClips.find((clip) => clip.type === type) || null
}

const PREVIEW_MAX_STAGE_WIDTH = 1040

type PreviewFitMode = 'contain' | 'cover'

const PREVIEW_RATIOS: Array<{ value: PreviewAspectRatio; label: string; title: string; css: string; width: number; height: number }> = [
  { value: '16:9', label: '16:9', title: '横屏 / YouTube / B站', css: '16 / 9', width: 16, height: 9 },
  { value: '9:16', label: '9:16', title: '竖屏 / 短视频', css: '9 / 16', width: 9, height: 16 },
  { value: '1:1', label: '1:1', title: '方形 / 信息流', css: '1 / 1', width: 1, height: 1 },
  { value: '4:5', label: '4:5', title: '社媒竖图 / Feed', css: '4 / 5', width: 4, height: 5 },
  { value: '3:4', label: '3:4', title: '竖版海报 / 封面', css: '3 / 4', width: 3, height: 4 },
  { value: '4:3', label: '4:3', title: '传统横屏', css: '4 / 3', width: 4, height: 3 },
  { value: '21:9', label: '21:9', title: '电影宽屏', css: '21 / 9', width: 21, height: 9 },
]

export function fitPreviewStageSize(params: {
  containerWidth: number
  containerHeight: number
  ratioWidth: number
  ratioHeight: number
  maxWidth?: number
}): { width: number; height: number } {
  const containerWidth = Math.max(0, Number(params.containerWidth) || 0)
  const containerHeight = Math.max(0, Number(params.containerHeight) || 0)
  const ratioWidth = Math.max(1, Number(params.ratioWidth) || 1)
  const ratioHeight = Math.max(1, Number(params.ratioHeight) || 1)
  const maxWidth = Math.max(1, Number(params.maxWidth) || PREVIEW_MAX_STAGE_WIDTH)
  if (containerWidth <= 0 || containerHeight <= 0) {
    return { width: 0, height: 0 }
  }

  const ratio = ratioWidth / ratioHeight
  let width = Math.min(containerWidth, maxWidth, containerHeight * ratio)
  let height = width / ratio
  if (height > containerHeight) {
    height = containerHeight
    width = height * ratio
  }
  return {
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(height)),
  }
}

function clampPreviewScale(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(0.25, Math.min(4, value))
}

export default function TimelinePreview({ activeClips, aspectRatio, fps, playheadFrame, timeline }: TimelinePreviewProps): JSX.Element {
  const playerRef = React.useRef<HTMLElement | null>(null)
  const stageRef = React.useRef<HTMLDivElement | null>(null)
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const dragRef = React.useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const [stageSize, setStageSize] = React.useState<{ width: number; height: number } | null>(null)
  const [mediaScale, setMediaScale] = React.useState(1)
  const [mediaOffset, setMediaOffset] = React.useState({ x: 0, y: 0 })
  const [fitMode, setFitMode] = React.useState<PreviewFitMode>('contain')
  const [safeAreaVisible, setSafeAreaVisible] = React.useState(false)
  const [exportStatus, setExportStatus] = React.useState<ExportStatus>('idle')
  const [exportRatio, setExportRatio] = React.useState(0)
  const [playbackError, setPlaybackError] = React.useState('')
  const setPreviewAspectRatio = useWorkbenchStore((state) => state.setPreviewAspectRatio)
  const playing = useWorkbenchStore((state) => state.timelinePlaying)
  const setTimelinePlaying = useWorkbenchStore((state) => state.setTimelinePlaying)
  const setTimelinePlayhead = useWorkbenchStore((state) => state.setTimelinePlayhead)
  const videoClip = findClip(activeClips, 'video')
  const imageClip = findClip(activeClips, 'image')
  const videoUrl = videoClip?.url || ''
  const videoPlaybackUrl = videoUrl ? buildVideoPlaybackUrl(videoUrl) : ''
  const activeRatio = PREVIEW_RATIOS.find((ratio) => ratio.value === aspectRatio) || PREVIEW_RATIOS[0]
  const activeMediaKey = videoClip?.url || imageClip?.url || ''
  const hasMedia = Boolean(activeMediaKey)

  React.useEffect(() => {
    const video = videoRef.current
    if (!video || !videoClip?.url) return
    const nextTime = resolveVideoClipMediaTimeSeconds({ clip: videoClip, playheadFrame, fps })
    if (!Number.isFinite(nextTime)) return
    if (Math.abs(video.currentTime - nextTime) < 0.08) return
    video.currentTime = nextTime
  }, [fps, playheadFrame, videoClip])

  React.useEffect(() => {
    const video = videoRef.current
    if (!video || !videoClip?.url) return
    if (playing) {
      setPlaybackError('')
      void video.play().catch((error: unknown) => {
        const message = error instanceof Error && error.message ? error.message : 'video play failed'
        setPlaybackError(`视频播放失败：${message}`)
        setTimelinePlaying(false)
      })
      return
    }
    if (!video.paused) {
      try {
        video.pause()
      } catch {
        // jsdom does not implement media controls; browsers do.
      }
    }
  }, [playing, setTimelinePlaying, videoClip?.url])

  React.useEffect(() => {
    setPlaybackError('')
  }, [videoPlaybackUrl])

  React.useLayoutEffect(() => {
    const target = playerRef.current
    if (!target || typeof window === 'undefined') return

    const measure = () => {
      const rect = target.getBoundingClientRect()
      const style = window.getComputedStyle(target)
      const paddingX = Number.parseFloat(style.paddingLeft || '0') + Number.parseFloat(style.paddingRight || '0')
      const paddingY = Number.parseFloat(style.paddingTop || '0') + Number.parseFloat(style.paddingBottom || '0')
      const next = fitPreviewStageSize({
        containerWidth: rect.width - paddingX,
        containerHeight: rect.height - paddingY,
        ratioWidth: activeRatio.width,
        ratioHeight: activeRatio.height,
      })
      setStageSize((prev) => {
        if (prev && prev.width === next.width && prev.height === next.height) return prev
        return next.width > 0 && next.height > 0 ? next : null
      })
    }

    measure()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure)
      observer.observe(target)
      return () => observer.disconnect()
    }
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [activeRatio.height, activeRatio.width])

  React.useEffect(() => {
    setMediaScale(1)
    setMediaOffset({ x: 0, y: 0 })
  }, [activeMediaKey, aspectRatio])

  const updateMediaScale = React.useCallback((delta: number) => {
    setMediaScale((prev) => clampPreviewScale(prev + delta))
  }, [])

  const resetMediaTransform = React.useCallback(() => {
    setMediaScale(1)
    setMediaOffset({ x: 0, y: 0 })
  }, [])

  const handleExport = React.useCallback(async () => {
    if (exportStatus === 'preparing' || exportStatus === 'recording') return
    try {
      setExportStatus('preparing')
      setExportRatio(0)
      await exportTimelineToWebm({
        timeline,
        aspectRatio,
        onProgress: (progress) => {
          setExportStatus(progress.status)
          setExportRatio(progress.ratio)
        },
      })
    } catch (error) {
      setExportStatus('error')
      const message = error instanceof Error ? error.message : '导出失败'
      window.alert(message)
    }
  }, [aspectRatio, exportStatus, timeline])

  const togglePlayback = React.useCallback(() => {
    const durationFrame = timeline.tracks.reduce((maxFrame, track) => {
      const trackEndFrame = track.clips.reduce((trackMax, clip) => Math.max(trackMax, clip.endFrame), 0)
      return Math.max(maxFrame, trackEndFrame)
    }, 0)
    if (durationFrame <= 0) return
    if (playheadFrame >= durationFrame) {
      setTimelinePlayhead(0)
    }
    setTimelinePlaying(!playing)
  }, [playheadFrame, playing, setTimelinePlayhead, setTimelinePlaying, timeline.tracks])

  const beginDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!hasMedia) return
    if ((event.target as HTMLElement).closest('button')) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: mediaOffset.x,
      originY: mediaOffset.y,
    }
  }, [hasMedia, mediaOffset.x, mediaOffset.y])

  const moveDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setMediaOffset({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    })
  }, [])

  const endDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // ignore
    }
  }, [])

  const mediaStyle = {
    transform: `translate(${mediaOffset.x}px, ${mediaOffset.y}px) scale(${mediaScale})`,
  }

  return (
    <section ref={playerRef} className="workbench-preview-player" aria-label="预览播放器">
      <div
        ref={stageRef}
        className="workbench-preview-player__stage"
        data-aspect-ratio={activeRatio.value}
        data-fit-mode={fitMode}
        data-has-media={hasMedia ? 'true' : 'false'}
        style={{
          aspectRatio: activeRatio.css,
          ...(stageSize ? { width: `${stageSize.width}px`, height: `${stageSize.height}px` } : null),
        }}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="workbench-preview-player__canvas" aria-hidden={hasMedia ? 'true' : 'false'}>
          {!hasMedia ? (
            <div className="workbench-preview-player__placeholder">
              <span className="workbench-preview-player__placeholder-title">画面预览</span>
              <span className="workbench-preview-player__placeholder-sub">从「生成区」拖入素材即可显示</span>
            </div>
          ) : null}
        </div>
        <div className="workbench-preview-player__control-bar" role="toolbar" aria-label="预览控制">
          <WorkbenchIconButton
            className="workbench-preview-player__play"
            label={playing ? '暂停' : '播放'}
            icon={playing ? <IconPlayerPause size={16} stroke={2} /> : <IconPlayerPlay size={16} stroke={2} />}
            onClick={togglePlayback}
          />
          <div className="workbench-preview-player__control-separator" aria-hidden="true" />
          <div className="workbench-preview-player__select-control">
            <span className="workbench-preview-player__control-label">画幅</span>
            <select
              className="workbench-preview-player__select"
              aria-label="预览画幅"
              value={aspectRatio}
              onChange={(event) => setPreviewAspectRatio(event.currentTarget.value as PreviewAspectRatio)}
            >
              {PREVIEW_RATIOS.map((ratio) => (
                <option key={ratio.value} value={ratio.value}>
                  {ratio.label}
                </option>
              ))}
            </select>
          </div>
          <div className="workbench-preview-player__control-separator" aria-hidden="true" />
          <div className="workbench-preview-player__select-control">
            <span className="workbench-preview-player__control-label">显示</span>
            <select
              className="workbench-preview-player__select"
              aria-label="画面适配"
              value={fitMode}
              onChange={(event) => setFitMode(event.currentTarget.value as PreviewFitMode)}
            >
              <option value="contain">适应</option>
              <option value="cover">填充</option>
            </select>
          </div>
          <div className="workbench-preview-player__control-separator" aria-hidden="true" />
          <div className="workbench-preview-player__control-group" aria-label="预览构图">
            <WorkbenchIconButton className="workbench-preview-player__icon-button" label="缩小画面" icon={<IconZoomOut size={16} />} onClick={() => updateMediaScale(-0.1)} disabled={!hasMedia} />
            <span className="workbench-preview-player__zoom-label" aria-label="当前缩放">{Math.round(mediaScale * 100)}%</span>
            <WorkbenchIconButton className="workbench-preview-player__icon-button" label="重置画面" icon={<IconRefresh size={16} />} onClick={resetMediaTransform} disabled={!hasMedia} />
            <WorkbenchIconButton className="workbench-preview-player__icon-button" label="放大画面" icon={<IconZoomIn size={16} />} onClick={() => updateMediaScale(0.1)} disabled={!hasMedia} />
          </div>
          <div className="workbench-preview-player__control-separator" aria-hidden="true" />
          <WorkbenchIconButton
            className="workbench-preview-player__icon-button"
            label="导出 WebM"
            onClick={handleExport}
            disabled={exportStatus === 'preparing' || exportStatus === 'recording'}
            title={exportStatus === 'recording' ? `导出中 ${Math.round(exportRatio * 100)}%` : '导出 WebM'}
            icon={exportStatus === 'preparing' || exportStatus === 'recording' ? <NomiLoadingMark size={16} className="workbench-preview-player__spinner" /> : <IconDownload size={16} />}
          />
          <WorkbenchButton
            className="workbench-preview-player__mode"
            aria-label="切换安全框"
            aria-pressed={safeAreaVisible}
            data-active={safeAreaVisible ? 'true' : 'false'}
            onClick={() => setSafeAreaVisible((value) => !value)}
          >
            安全框
          </WorkbenchButton>
        </div>
        {safeAreaVisible ? <div className="workbench-preview-player__safe-area" aria-hidden="true" /> : null}
        {playbackError ? (
          <div className="workbench-preview-player__media-error" role="alert">
            {playbackError}
          </div>
        ) : null}
        {imageClip?.url ? (
          <img className="workbench-preview-player__image" src={imageClip.url} alt={imageClip.label || ''} style={mediaStyle} />
        ) : null}
        {videoUrl ? (
          <video
            ref={videoRef}
            className="workbench-preview-player__video"
            src={videoPlaybackUrl}
            crossOrigin="use-credentials"
            muted
            playsInline
            style={mediaStyle}
            onError={() => {
              void diagnoseVideoPlaybackFailure(videoUrl, videoRef.current?.error || null).then((diagnostics) => {
                logVideoPlaybackFailure(diagnostics)
                const message = diagnostics.probeMessage
                setPlaybackError(message ? `视频加载失败：${message}` : '视频加载失败：代理无法读取该视频地址')
              })
              setTimelinePlaying(false)
            }}
          />
        ) : null}
      </div>
    </section>
  )
}
