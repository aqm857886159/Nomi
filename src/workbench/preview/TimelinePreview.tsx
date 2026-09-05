import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../utils/cn'
import { useWorkbenchStore } from '../workbenchStore'
import type { TimelineClip, TimelineState } from '../timeline/timelineTypes'
import { resolveActiveTextClipsAtFrame } from '../timeline/timelineMath'
import { resolveTextBox, resolveOverlayTransform } from '../timeline/textLayout'
import { resolveClipFraming } from '../timeline/clipFraming'
import { framingOfTarget, resolveFramingTarget } from '../timeline/framingTarget'
import { PreviewControlBar } from './PreviewControlBar'
import { framingToMediaStyle, mediaFitClass, framingOffsetFromDrag } from './previewMediaFraming'
import { fitPreviewStageSize } from './previewStageLayout'
import OverlaySelectionBox from './OverlaySelectionBox'
import type { PreviewAspectRatio } from '../workbenchTypes'
import { findClipByType as findClip } from '../player/timelinePlayback'
import { usePreviewBgmPlayback } from './usePreviewBgmPlayback'
import { PREVIEW_RATIOS } from './previewAspectRatios'
import { exportTimelineToMp4, type ExportTimelineToMp4Options } from '../export/exportApi'
import { markChecklistStep } from '../onboarding/onboardingState'
import { toast } from '../../ui/toast'
import { useVideoPlaybackHeal } from '../../media/useVideoPlaybackHeal'
import { computeTimelineDuration } from '../timeline/timelineMath'
import { getDesktopBridge } from '../../desktop/bridge'
import { getDesktopActiveProjectId } from '../../desktop/activeProject'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { selectStableCanvasNodes } from '../generationCanvas/store/canvasNodeProjection'
import { resolveTimelineClipPlaybackUrl } from '../timeline/timelinePlaybackUrl'
import { usePreviewVideoPlayheadSync } from './usePreviewVideoPlayheadSync'
import { findTimelineTransitionForClipType, resolveTimelineTransitionsAtFrame } from '../timeline/timelineTransition'
import { TimelineTransitionLayer } from './TimelineTransitionLayer'
import { resolvePreviewMediaVolume } from '../timeline/clipAudio'
import { recordVideoPlaybackState } from '../../media/videoPlaybackTelemetry'

type TimelinePreviewProps = {
  activeClips: TimelineClip[]
  aspectRatio: PreviewAspectRatio
  fps: number
  playheadFrame: number
  timeline: TimelineState
}

type PreviewExportStatus = 'idle' | 'preparing' | 'recording' | 'converting' | 'done' | 'error'

export default function TimelinePreview({ activeClips, aspectRatio, fps, playheadFrame, timeline }: TimelinePreviewProps): JSX.Element {
  const { t } = useTranslation()
  const playerRef = React.useRef<HTMLDivElement | null>(null)
  const stageRef = React.useRef<HTMLDivElement | null>(null)
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const dragRef = React.useRef<{
    pointerId: number
    clipId: string
    startX: number
    startY: number
    // 拖动起点时的取景偏移（归一化分数），moveDrag 据此 + 像素位移/stage 尺寸算新偏移
    originOffsetX: number
    originOffsetY: number
  } | null>(null)
  const [stageSize, setStageSize] = React.useState<{ width: number; height: number } | null>(null)
  const [exportStatus, setExportStatus] = React.useState<PreviewExportStatus>('idle')
  const [exportProgress, setExportProgress] = React.useState(0)
  const [playbackError, setPlaybackError] = React.useState('')
  const [editingTextId, setEditingTextId] = React.useState('')
  const [editingDraft, setEditingDraft] = React.useState('')
  const [textMenuOpen, setTextMenuOpen] = React.useState(false)
  const textMenuRef = React.useRef<HTMLDivElement | null>(null)
  const [textSnapGuides, setTextSnapGuides] = React.useState<{ x: number | null; y: number | null }>({ x: null, y: null })
  // P2 播放器手感：音量/静音（clip 本就带音频，之前播放器读不到）+ 全屏（看成片整体）。
  const [volume, setVolume] = React.useState(1)
  const [muted, setMuted] = React.useState(false)
  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const addTimelineTextClip = useWorkbenchStore((state) => state.addTimelineTextClip)
  const updateTimelineTextClip = useWorkbenchStore((state) => state.updateTimelineTextClip)
  const updateTimelineTextClipTransform = useWorkbenchStore((state) => state.updateTimelineTextClipTransform)
  const selectTimelineTextClip = useWorkbenchStore((state) => state.selectTimelineTextClip)
  const selectedTextClipId = useWorkbenchStore((state) => state.selectedTextClipId)
  const exportResolution = useWorkbenchStore((state) => state.exportResolution)
  const exportQuality = useWorkbenchStore((state) => state.exportQuality)
  const setTimelineClipFraming = useWorkbenchStore((state) => state.setTimelineClipFraming)
  const selectedClipIds = useWorkbenchStore((state) => state.selectedTimelineClipIds)
  const setTimelineSelection = useWorkbenchStore((state) => state.setTimelineSelection)
  const playing = useWorkbenchStore((state) => state.timelinePlaying)
  const setTimelinePlaying = useWorkbenchStore((state) => state.setTimelinePlaying)
  const setTimelinePlayhead = useWorkbenchStore((state) => state.setTimelinePlayhead)
  // 预览只按 sourceNodeId 解析回放 URL（读 result/history），从不读 position → 位置稳定投影：
  // 画布拖动期间成片预览不再被连坐重渲（suspect #1）。
  const generationNodes = useGenerationCanvasStore(selectStableCanvasNodes)
  const videoClip = findClip(activeClips, 'video')
  const imageClip = findClip(activeClips, 'image')
  const audioClip = findClip(activeClips, 'audio')
  const activeTransitions = React.useMemo(
    () => resolveTimelineTransitionsAtFrame(timeline, playheadFrame),
    [playheadFrame, timeline],
  )
  const imageTransition = findTimelineTransitionForClipType(activeTransitions, 'image')
  const videoTransition = findTimelineTransitionForClipType(activeTransitions, 'video')
  const videoUrl = resolveTimelineClipPlaybackUrl(videoClip, generationNodes)
  // 预览播放器此前只诚实报错、不自愈：同一个 HEVC 存量片段在画布节点点一下就能自己修好，
  // 在成片预览里却永远播不了。守卫内核共用后，这里也能当场修（转码产物复用，不重复转）。
  const heal = useVideoPlaybackHeal({ rawUrl: videoUrl })
  const videoPlaybackUrl = heal.playbackUrl
  const activeRatio = PREVIEW_RATIOS.find((ratio) => ratio.value === aspectRatio) || PREVIEW_RATIOS[0]
  const activeMediaKey = videoUrl || imageClip?.url || ''
  const hasMedia = Boolean(activeMediaKey)
  // 取景 per-clip（P0-5）。2026-08-03 根治「作用域跟播放头漂移」：
  //   · 渲染 → 仍按播放头取 activeClips，每个媒体用自己的 framing（下面 imageFraming/videoFraming 不变）
  //   · 编辑 → 只认用户**选中**的那一个媒体片段（resolveFramingTarget，纯函数+不变量测试钉死）
  // 原先编辑目标也从播放头推，导致播放头一动作用对象就换人、且空隙时静默失效。
  // 三家成熟剪辑器（FCP / Firefly / OpenCut）片段属性一律跟选中走，播放头只管渲染。
  const framingTarget = resolveFramingTarget(timeline, selectedClipIds)
  const framingClipId = framingTarget?.clipId ?? ''
  const framing = framingOfTarget(framingTarget)
  const imageFraming = resolveClipFraming(imageClip ?? undefined)
  const videoFraming = resolveClipFraming(videoClip ?? undefined)
  // 舞台上此刻看得见的那个媒体片段——拖拽取景以它为准（拖你看见的那张，不是选中的那张）。
  const visibleMediaClip = videoClip ?? imageClip
  const visibleFraming = videoClip ? videoFraming : imageFraming
  const isEmpty = timeline.tracks.every(t => t.clips.length === 0) && (timeline.textClips ?? []).length === 0
  const totalFrames = computeTimelineDuration(timeline)
  const currentSeconds = (playheadFrame / (timeline.fps || 30)).toFixed(1)
  const totalSeconds = (totalFrames / (timeline.fps || 30)).toFixed(1)
  const exportBusy = exportStatus === 'preparing' || exportStatus === 'recording' || exportStatus === 'converting'
  const stopPlayback = React.useCallback(() => setTimelinePlaying(false), [setTimelinePlaying])

  usePreviewVideoPlayheadSync(videoRef, { videoClip, videoUrl, playheadFrame, fps, playing })

  // 音量/静音应用到 <video>（video 每个 clip 重挂，故 videoUrl 变也要重设）。
  React.useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.volume = resolvePreviewMediaVolume(videoClip, playheadFrame, volume, muted)
    video.muted = muted
  }, [videoUrl, videoClip, playheadFrame, volume, muted])

  // 配乐 <audio> 播放（playhead 同步 + 播放/暂停 + 音量静音）抽到 hook（R9）。
  const { audioRef, audioUrl } = usePreviewBgmPlayback(audioClip, { playing, playheadFrame, fps, volume, muted })

  // 全屏态跟随：用 fullscreenchange 同步图标，避免 document.fullscreenElement 在渲染期不反应。
  React.useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === stageRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const stepFrame = React.useCallback((delta: number) => {
    setTimelinePlayhead(Math.max(0, Math.min(totalFrames, playheadFrame + delta)))
  }, [playheadFrame, setTimelinePlayhead, totalFrames])

  const toggleFullscreen = React.useCallback(() => {
    const el = stageRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void el.requestFullscreen?.()
  }, [])

  React.useEffect(() => {
    const video = videoRef.current
    if (!video || !videoClip || !videoUrl) return
    if (playing) {
      setPlaybackError('')
      void video.play().catch((error: unknown) => {
        const message = error instanceof Error && error.message ? error.message : 'video play failed'
        setPlaybackError(t('timelinePreview.videoPlayFailed', { message }))
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
  }, [playing, setTimelinePlaying, videoClip, videoUrl, t])

  React.useEffect(() => {
    setPlaybackError('')
  }, [videoPlaybackUrl])

  // 守卫的结论 → 预览既有的报错条：自愈中说「修复中」，自愈不了才落诚实原因（修好则两者都空，自动清掉）。
  React.useEffect(() => {
    if (heal.healingText) setPlaybackError(heal.healingText)
    else if (heal.failureText) setPlaybackError(t('timelinePreview.videoLoadFailed', { message: heal.failureText }))
  }, [heal.healingText, heal.failureText, t])

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

  const addText = React.useCallback((style: 'caption' | 'title') => {
    const id = addTimelineTextClip(style, playheadFrame)
    setEditingTextId(id)
    setEditingDraft('')
    setTextMenuOpen(false)
  }, [addTimelineTextClip, playheadFrame])

  // 文字预设菜单：点外部关闭
  React.useEffect(() => {
    if (!textMenuOpen) return
    const onDown = (event: PointerEvent) => {
      if (textMenuRef.current && !textMenuRef.current.contains(event.target as globalThis.Node | null)) setTextMenuOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [textMenuOpen])

  const beginEditText = React.useCallback((id: string, text: string) => {
    selectTimelineTextClip(id)
    setEditingTextId(id)
    setEditingDraft(text)
  }, [selectTimelineTextClip])

  const commitEditText = React.useCallback((id: string) => {
    const text = editingDraft.trim()
    if (text) updateTimelineTextClip(id, text)
    setEditingTextId('')
  }, [editingDraft, updateTimelineTextClip])

  const handleExport = React.useCallback(async () => {
    if (exportBusy) return
    try {
      setExportStatus('preparing')
      setExportProgress(0)
      const projectId = getDesktopActiveProjectId().trim()
      const result = await exportTimelineToMp4({
        timeline,
        aspectRatio,
        projectId,
        resolution: exportResolution,
        quality: exportQuality,
        generationNodes,
        onProgress: (progress: Parameters<NonNullable<ExportTimelineToMp4Options['onProgress']>>[0]) => {
          setExportStatus(progress.status)
          setExportProgress(progress.ratio)
        },
      })
      toast(t('timelinePreview.exportComplete', { path: result.relativePath }), 'success')
      // 上手清单第 4 步「导出成片」打勾（导出 fire-and-forget 无持久历史，靠这里标记）。
      markChecklistStep('exported')
      void getDesktopBridge()?.exports.showInFolder({ projectId, relativePath: result.relativePath }).catch(() => undefined)
      setExportStatus('idle')
      setExportProgress(0)
    } catch (error) {
      setExportStatus('idle')
      setExportProgress(0)
      const message = error instanceof Error ? error.message : t('timelinePreview.exportFailed')
      toast(message, 'error')
    }
  }, [aspectRatio, exportBusy, exportQuality, exportResolution, generationNodes, timeline, t])

  React.useEffect(() => {
    const onExportRequest = () => { void handleExport() }
    window.addEventListener('nomi-preview-export', onExportRequest)
    return () => window.removeEventListener('nomi-preview-export', onExportRequest)
  }, [handleExport])

  // 预览页的唯一导出入口是 PreviewWorkspace 顶栏按钮；事件桥让 transport 与导出实现解耦。

  const togglePlayback = React.useCallback(() => {
    const durationFrame = computeTimelineDuration(timeline)
    if (durationFrame <= 0) return
    if (playheadFrame >= durationFrame) {
      setTimelinePlayhead(0)
    }
    setTimelinePlaying(!playing)
    // computeTimelineDuration 同时计入 tracks 与 textClips（片尾标题卡也撑时长），
    // 故依赖整个 timeline，否则改完文字轨后这个回调仍用旧时长判定空/越界。
  }, [playheadFrame, playing, setTimelinePlayhead, setTimelinePlaying, timeline])

  const beginDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    // 拖的是「舞台上看得见的那一段」，不是「当前选中的那一段」——否则会出现
    // 「拖你看见的画面、却改了另一段」。同时把它选中：编辑目标、时间轴高亮、控件读数三者从此指向同一段
    // （DaVinci 的 selection-follows-playhead 也是这么同步真实选中的，不是偷偷改一个隐藏目标）。
    const clipId = visibleMediaClip?.id ?? ''
    if (!clipId) return
    if ((event.target as HTMLElement).closest('button')) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    if (clipId !== framingClipId) setTimelineSelection([clipId])
    dragRef.current = {
      pointerId: event.pointerId,
      clipId,
      startX: event.clientX,
      startY: event.clientY,
      originOffsetX: visibleFraming.offsetX,
      originOffsetY: visibleFraming.offsetY,
    }
  }, [visibleMediaClip, visibleFraming.offsetX, visibleFraming.offsetY, framingClipId, setTimelineSelection])

  // 拖动中 commit:false，松手 commit:true 落盘一次。
  const applyDragOffset = React.useCallback((drag: NonNullable<typeof dragRef.current>, event: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    if (!stageSize) return
    const next = framingOffsetFromDrag(drag, { x: event.clientX - drag.startX, y: event.clientY - drag.startY }, stageSize)
    setTimelineClipFraming(drag.clipId, next, { commit })
  }, [stageSize, setTimelineClipFraming])

  const moveDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    applyDragOffset(drag, event, false)
  }, [applyDragOffset])

  const endDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    applyDragOffset(drag, event, true)
    dragRef.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // ignore
    }
  }, [applyDragOffset])

  const imageStyle = framingToMediaStyle(imageFraming, stageSize)
  const videoStyle = framingToMediaStyle(videoFraming, stageSize)
  const imageFitClass = mediaFitClass(imageFraming)
  const videoFitClass = mediaFitClass(videoFraming)

  // 文字叠加层（字幕/标题卡）：当前帧 active 的文字 clip，按 stage 像素几何摆放。
  const activeTextClips = resolveActiveTextClipsAtFrame(timeline, playheadFrame)
  // 选中的文字 clip → 控制条出字号/字体精确控件
  return (
    <section className={cn(
      'workbench-preview-player',
      'relative min-w-0 min-h-0 flex flex-col items-center p-8 gap-3 bg-[var(--workbench-bg)]',
    )} aria-label={t('timelinePreview.player')}>
      {/* 测量区：stage 居中于此（控制条之上的可用高度），控制条作为下方独立一行不再压住画面。 */}
      <div ref={playerRef} className="workbench-preview-player__stage-area flex-1 min-h-0 w-full grid place-items-center">
      <div
        ref={stageRef}
        className={cn(
          'workbench-preview-player__stage',
          'relative max-w-full max-h-full grid place-items-center overflow-hidden',
          'rounded-[var(--nomi-radius-lg)] border border-[var(--workbench-border)]',
          'bg-[var(--nomi-paper)] shadow-[var(--workbench-shadow-md)]',
          'cursor-default transition-[width,height] duration-[160ms] ease-in-out touch-none',
          hasMedia && 'cursor-grab active:cursor-grabbing',
        )}
        data-aspect-ratio={activeRatio.value}
        data-fit-mode={framing.fit}
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
        <div className={cn(
          'workbench-preview-player__canvas',
          'absolute inset-0 grid place-items-center pointer-events-none',
          hasMedia
            ? 'bg-[var(--nomi-paper)]'
            : 'bg-[repeating-linear-gradient(45deg,var(--nomi-ink-05)_0_12px,var(--nomi-paper)_12px_24px)]',
        )} aria-hidden={hasMedia ? 'true' : 'false'}>
          {!hasMedia ? (
            <div className={cn(
              'workbench-preview-player__placeholder',
              'flex flex-col items-center gap-1 p-0 bg-transparent border-none',
            )}>
              <span className={cn(
                'workbench-preview-player__placeholder-title',
                'font-nomi-display text-title tracking-tight text-[var(--workbench-muted)]',
              )}>{t('timelinePreview.canvas')}</span>
              <span className={cn(
                'workbench-preview-player__placeholder-sub',
                'text-caption text-[var(--workbench-muted-soft)]',
              )}>{isEmpty ? t('timelinePreview.emptyHint') : t('timelinePreview.gapHint')}</span>
            </div>
          ) : null}
        </div>
        {playbackError ? (
          <div className={cn(
            'workbench-preview-player__media-error',
            'absolute left-3 right-3 bottom-3 z-[4]',
            'py-2 px-2 bg-[color-mix(in_srgb,var(--nomi-paper)_90%,transparent)]',
            'text-[var(--workbench-danger)] text-caption leading-snug pointer-events-none',
          )} role="alert">
            {playbackError}
          </div>
        ) : null}
        {imageClip?.url && !imageTransition ? (
          <img className={cn(
            'workbench-preview-player__image',
            'absolute inset-0 z-[1] w-full h-full bg-transparent select-none will-change-transform',
            imageFitClass,
          )} src={imageClip.url} alt={imageClip.label || ''} style={imageStyle} />
        ) : null}
        {imageTransition ? (
          <TimelineTransitionLayer
            resolved={imageTransition}
            playheadFrame={playheadFrame}
            fps={fps}
            stageSize={stageSize}
            zIndex={1}
            onPlaybackError={setPlaybackError}
            onPlaybackStop={stopPlayback}
          />
        ) : null}
        {videoUrl && !videoTransition ? (
          <video
            ref={videoRef}
            className={cn(
              'workbench-preview-player__video',
              'absolute inset-0 z-[2] w-full h-full bg-transparent select-none will-change-transform',
              videoFitClass,
            )}
            src={videoPlaybackUrl}
            crossOrigin="use-credentials"
            playsInline
            style={videoStyle}
            onError={(event) => {
              recordVideoPlaybackState(getDesktopActiveProjectId(), {
                phase: 'error', rawUrl: videoUrl, readyState: event.currentTarget.readyState,
                networkState: event.currentTarget.networkState, mediaErrorCode: event.currentTarget.error?.code,
              })
              heal.onError(event)
              setTimelinePlaying(false)
            }}
            onLoadedMetadata={(event) => {
              recordVideoPlaybackState(getDesktopActiveProjectId(), { phase: 'metadata', rawUrl: videoUrl, readyState: event.currentTarget.readyState, networkState: event.currentTarget.networkState })
              heal.onLoadedMetadata(event)
            }}
            onCanPlay={(event) => recordVideoPlaybackState(getDesktopActiveProjectId(), { phase: 'canplay', rawUrl: videoUrl, readyState: event.currentTarget.readyState, networkState: event.currentTarget.networkState })}
          />
        ) : null}
        {videoTransition ? (
          <TimelineTransitionLayer
            resolved={videoTransition}
            playheadFrame={playheadFrame}
            fps={fps}
            playing={playing}
            volume={volume}
            muted={muted}
            stageSize={stageSize}
            zIndex={2}
            onPlaybackError={setPlaybackError}
            onPlaybackStop={stopPlayback}
          />
        ) : null}
        {/* 配乐 <audio>：无画面，仅播放当前音频轨 clip 的声音（试听）。currentTime/play 由上方 effect 跟 playhead。 */}
        {audioUrl ? (
          <audio
            ref={audioRef}
            src={audioUrl}
            crossOrigin="use-credentials"
            preload="auto"
            className="hidden"
            aria-hidden="true"
          />
        ) : null}
        {/* 文字叠加层（字幕/标题卡）：z 在媒体之上；容器不拦事件，仅文本框可点选/编辑。 */}
        {stageSize && activeTextClips.length > 0 ? (
          <div className="workbench-preview-player__text-layer absolute inset-0 z-[3] pointer-events-none" aria-hidden="false">
            {/* 中线吸附引导线（拖动中临时） */}
            {textSnapGuides.x !== null ? (
              <div className="absolute top-0 bottom-0 w-px bg-[var(--nomi-accent)] opacity-70 pointer-events-none" style={{ left: `${textSnapGuides.x * stageSize.width}px` }} aria-hidden="true" />
            ) : null}
            {textSnapGuides.y !== null ? (
              <div className="absolute left-0 right-0 h-px bg-[var(--nomi-accent)] opacity-70 pointer-events-none" style={{ top: `${textSnapGuides.y * stageSize.height}px` }} aria-hidden="true" />
            ) : null}
            {activeTextClips.map((clip) => {
              const box = resolveTextBox(clip, stageSize.width, stageSize.height)
              const transform = resolveOverlayTransform(clip)
              const editing = editingTextId === clip.id
              const selected = selectedTextClipId === clip.id
              const contentStyle: React.CSSProperties = {
                maxWidth: `${box.maxWidthPx}px`,
                fontSize: `${box.fontSizePx}px`,
                fontFamily: box.fontFamily,
                fontWeight: box.fontWeight,
                lineHeight: String(box.lineHeight),
                textAlign: 'center',
                color: 'var(--nomi-ink)',
                padding: box.hasBackdrop ? '0.32em 0.7em' : 0,
                background: box.hasBackdrop ? 'color-mix(in oklch, var(--nomi-paper) 86%, transparent)' : 'transparent',
                border: box.hasBackdrop ? '1px solid var(--nomi-line-soft)' : 'none',
                borderRadius: 'var(--nomi-radius)',
                // 折行契约：预览用 CSS 原生折行，导出 canvas 用 textLayout.wrapTextToWidth 复刻同一语义
                // （white-space:pre-wrap + word-break:break-word ⇔ 显式换行 + 优先整词断 + 超长词逐字断）。
                // 两端共用 box 几何（resolveTextBox）与内边距（0.32em/0.7em ↔ 导出 fontSize*1.4 budget），断行一致。
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }
              const centerStyle: React.CSSProperties = {
                left: `${box.centerX}px`,
                top: `${box.centerY}px`,
                transform: 'translate(-50%, -50%)',
              }
              if (editing) {
                return (
                  <textarea
                    key={clip.id}
                    className="workbench-preview-player__text-edit absolute pointer-events-auto resize-none outline-none overflow-hidden"
                    style={{ ...centerStyle, ...contentStyle, boxShadow: '0 0 0 2px var(--nomi-accent)' }}
                    value={editingDraft}
                    placeholder={clip.text}
                    autoFocus
                    rows={1}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => setEditingDraft(event.target.value)}
                    onBlur={() => commitEditText(clip.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        event.currentTarget.blur()
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        setEditingTextId('')
                      }
                    }}
                  />
                )
              }
              if (selected) {
                return (
                  <OverlaySelectionBox
                    key={clip.id}
                    centerNorm={transform.position}
                    scale={transform.scale}
                    stageWidth={stageSize.width}
                    stageHeight={stageSize.height}
                    onTransform={(patch, commit) => updateTimelineTextClipTransform(clip.id, patch, { commit })}
                    onSnapGuides={setTextSnapGuides}
                  >
                    <div style={contentStyle} onDoubleClick={(event) => { event.stopPropagation(); beginEditText(clip.id, clip.text) }} title={t('timelinePreview.moveResizeEdit')}>
                      {clip.text}
                    </div>
                  </OverlaySelectionBox>
                )
              }
              return (
                <div
                  key={clip.id}
                  className="workbench-preview-player__text-box absolute pointer-events-auto cursor-pointer select-none"
                  style={{ ...centerStyle, ...contentStyle }}
                  onPointerDown={(event) => { event.stopPropagation(); selectTimelineTextClip(clip.id) }}
                  onDoubleClick={(event) => { event.stopPropagation(); beginEditText(clip.id, clip.text) }}
                  title={t('timelinePreview.selectEdit')}
                >
                  {clip.text}
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
      </div>
      {/* 控制条抽成 PreviewControlBar；属性面板承载整片与片段编辑。 */}
      {exportBusy ? <div className="workbench-preview-player__export-progress absolute bottom-10 left-2 right-2 z-[4] h-1 overflow-hidden rounded-pill bg-[var(--workbench-border)]" role="progressbar" aria-label={t('timelinePreview.exportMp4')}><div className="h-full bg-[var(--workbench-accent)] transition-[width]" style={{ width: `${Math.round(exportProgress * 100)}%` }} /></div> : null}
      <PreviewControlBar
        playing={playing}
        isEmpty={isEmpty}
        onTogglePlayback={togglePlayback}
        onStepFrame={stepFrame}
        currentSeconds={currentSeconds}
        totalSeconds={totalSeconds}
        muted={muted}
        onMutedChange={setMuted}
        volume={volume}
        onVolumeChange={(next) => { setVolume(next); setMuted(next === 0) }}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        textMenuRef={textMenuRef}
        textMenuOpen={textMenuOpen}
        onTextMenuOpenChange={setTextMenuOpen}
        onAddText={addText}
        timeline={timeline}
        selectedTextClipId={selectedTextClipId}
      />
    </section>
  )
}
