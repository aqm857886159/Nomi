import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { NomiImage } from '../../design/media'
import { useWorkbenchStore } from '../workbenchStore'
import { resolveActiveClipsAtFrame } from './timelineMath'
import { useVideoPlaybackHeal } from '../../media/useVideoPlaybackHeal'
import { usePreviewVideoPlayheadSync } from '../preview/usePreviewVideoPlayheadSync'
import { findTimelineTransitionForClipType, resolveTimelineTransitionsAtFrame } from './timelineTransition'
import { TimelineTransitionLayer } from '../preview/TimelineTransitionLayer'
import { getDesktopActiveProjectId } from '../../desktop/activeProject'
import { recordVideoPlaybackState } from '../../media/videoPlaybackTelemetry'

/**
 * 生成页时间轴的迷你画面窗：跟随播放头显示当前帧，治「画布上盲剪」——
 * 预览页播放器是成片台，这里只是取景小窗（同一 playhead 单一真相源，不做并行播放器）。
 * 视频/图片/空隙三态；可收起成小签（会话内记住）。仅时间轴展开时挂载（由宿主控制）。
 */
export default function TimelineMiniPreview(): JSX.Element | null {
  const { t } = useTranslation()
  const playheadFrame = useWorkbenchStore((state) => state.timeline.playheadFrame)
  const fps = useWorkbenchStore((state) => state.timeline.fps)
  const [collapsed, setCollapsed] = React.useState(
    () => globalThis.localStorage?.getItem('nomi.timelineMiniPreview.collapsed') === '1',
  )
  const setCollapsedPersist = (next: boolean) => {
    setCollapsed(next)
    try {
      globalThis.localStorage?.setItem('nomi.timelineMiniPreview.collapsed', next ? '1' : '0')
    } catch {
      /* 私有模式等存不了就算了 */
    }
  }

  const timeline = useWorkbenchStore((state) => state.timeline)
  const activeClips = React.useMemo(() => resolveActiveClipsAtFrame(timeline, playheadFrame), [timeline, playheadFrame])
  const activeTransitions = React.useMemo(
    () => resolveTimelineTransitionsAtFrame(timeline, playheadFrame),
    [playheadFrame, timeline],
  )
  const imageTransition = findTimelineTransitionForClipType(activeTransitions, 'image')
  const videoTransition = findTimelineTransitionForClipType(activeTransitions, 'video')
  const videoClip = activeClips.find((clip) => clip.type === 'video') ?? null
  const imageClip = activeClips.find((clip) => clip.type === 'image') ?? null
  const hasAnyClip = timeline.tracks.some((track) => track.clips.length > 0)

  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const heal = useVideoPlaybackHeal({ rawUrl: videoClip?.url ?? '' })
  usePreviewVideoPlayheadSync(videoRef, {
    videoClip,
    videoUrl: heal.playbackUrl,
    playheadFrame,
    fps,
    playing: false,
  })

  // 时间轴空无一物：不打扰（面板自己的空态引导在轨道上）
  if (!hasAnyClip) return null

  const timecode = `${(playheadFrame / Math.max(1, fps)).toFixed(1)}s`

  if (collapsed) {
    return (
      <button
        type="button"
        className={cn(
          'workbench-timeline-minipreview__pill',
          'absolute bottom-3 right-3 z-[8] inline-flex items-center gap-1.5',
          'rounded-full border border-[var(--workbench-border)] bg-nomi-paper px-2.5 py-1.5',
          'text-micro font-medium text-nomi-ink-60 shadow-workbench-pop cursor-pointer',
          'hover:bg-nomi-ink-05 hover:text-nomi-ink',
        )}
        // 常驻底部：画布上的选择浮条得让开这一块（量法见
        // generationCanvas/reactFlow/useCanvasBottomDockRects.ts）。
        data-canvas-bottom-dock="true"
        aria-label={t('timelineEditor.miniPreview.expand')}
        onClick={() => setCollapsedPersist(false)}
      >
        <IconChevronUp size={13} stroke={1.8} aria-hidden="true" />
        {t('timelineEditor.miniPreview.title')}
      </button>
    )
  }

  return (
    <div
      className={cn(
        'workbench-timeline-minipreview',
        'absolute bottom-3 right-3 z-[8] w-[248px] overflow-hidden',
        'rounded-nomi border border-[var(--workbench-border)]',
        'bg-nomi-paper shadow-workbench-pop',
      )}
      // 常驻底部：画布上的选择浮条得让开这一块（量法见
      // generationCanvas/reactFlow/useCanvasBottomDockRects.ts）。
      data-canvas-bottom-dock="true"
      aria-label={t('timelineEditor.miniPreview.title')}
    >
      <div className={cn('flex items-center justify-between gap-2 px-2.5 py-1.5')}>
        <span className="text-micro font-medium text-nomi-ink-60">{t('timelineEditor.miniPreview.title')}</span>
        <span className="ml-auto font-mono text-micro tabular-nums text-nomi-ink-40">{timecode}</span>
        <button
          type="button"
          className={cn(
            'inline-grid place-items-center w-5 h-5 rounded-nomi-sm border-0 bg-transparent',
            'text-nomi-ink-40 cursor-pointer hover:bg-nomi-ink-05 hover:text-nomi-ink',
          )}
          aria-label={t('timelineEditor.miniPreview.collapse')}
          onClick={() => setCollapsedPersist(true)}
        >
          <IconChevronDown size={13} stroke={1.8} aria-hidden="true" />
        </button>
      </div>
      <div className={cn('relative aspect-video w-full bg-[var(--nomi-paper)] overflow-hidden')}>
        {imageClip && !imageTransition ? (
          <NomiImage className="absolute inset-0 z-[1] h-full w-full object-contain" src={imageClip.url || imageClip.thumbnailUrl || ''} alt="" />
        ) : null}
        {imageTransition ? (
          <TimelineTransitionLayer
            resolved={imageTransition}
            playheadFrame={playheadFrame}
            fps={fps}
            zIndex={1}
          />
        ) : null}
        {videoClip && !videoTransition ? (
          <video
            ref={videoRef}
            className="absolute inset-0 z-[2] h-full w-full object-contain"
            src={heal.playbackUrl}
            crossOrigin="use-credentials"
            muted
            playsInline
            preload="metadata"
            onError={(event) => {
              recordVideoPlaybackState(getDesktopActiveProjectId(), { phase: 'error', rawUrl: videoClip?.url ?? '', readyState: event.currentTarget.readyState, networkState: event.currentTarget.networkState, mediaErrorCode: event.currentTarget.error?.code })
              heal.onError(event)
            }}
            onLoadedMetadata={(event) => {
              recordVideoPlaybackState(getDesktopActiveProjectId(), { phase: 'metadata', rawUrl: videoClip?.url ?? '', readyState: event.currentTarget.readyState, networkState: event.currentTarget.networkState })
              heal.onLoadedMetadata(event)
            }}
            onCanPlay={(event) => recordVideoPlaybackState(getDesktopActiveProjectId(), { phase: 'canplay', rawUrl: videoClip?.url ?? '', readyState: event.currentTarget.readyState, networkState: event.currentTarget.networkState })}
          />
        ) : null}
        {videoTransition ? (
          <TimelineTransitionLayer
            resolved={videoTransition}
            playheadFrame={playheadFrame}
            fps={fps}
            zIndex={2}
          />
        ) : null}
        {!videoClip && !imageClip && !videoTransition && !imageTransition ? (
          <div className={cn('absolute inset-0 grid place-items-center')}>
            <span className="text-micro font-medium text-[var(--nomi-ink-40)]">{t('timelinePreview.gapHint')}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
