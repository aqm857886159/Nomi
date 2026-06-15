import React from 'react'
import { IconChevronDown, IconDownload, IconLetterCase, IconPlayerPause, IconPlayerPlay, IconRefresh, IconX, IconZoomIn, IconZoomOut } from '@tabler/icons-react'
import { NomiLoadingMark, NomiSelect, WorkbenchButton, WorkbenchIconButton } from '../../design'
import { cn } from '../../utils/cn'
import { useWorkbenchStore } from '../workbenchStore'
import type { TimelineClip, TimelineState } from '../timeline/timelineTypes'
import { resolveActiveTextClipsAtFrame } from '../timeline/timelineMath'
import { resolveTextBox, resolveOverlayTransform } from '../timeline/textLayout'
import { resolveClipFraming, clampFramingScale, type ClipFit } from '../timeline/clipFraming'
import { TextClipStyleControls } from './TextClipStyleControls'
import { CONTROL_ICON_BUTTON_CLASS } from './previewControlTokens'
import { framingToMediaStyle, mediaFitClass, framingOffsetFromDrag } from './previewMediaFraming'
import { fitPreviewStageSize } from './previewStageLayout'
import OverlaySelectionBox from './OverlaySelectionBox'
import type { PreviewAspectRatio } from '../workbenchTypes'
import { resolveVideoClipMediaTimeSeconds } from '../player/timelinePlayback'
import { exportTimelineToMp4, type ExportTimelineToMp4Options } from '../export/exportApi'
import { buildMp4ExportButtonTitle } from '../export/exportCopy'
import { toast } from '../../ui/toast'
import { buildVideoPlaybackUrl } from '../../media/videoPlaybackUrl'
import { diagnoseVideoPlaybackFailure, logVideoPlaybackFailure } from '../../media/videoPlaybackDiagnostics'
import { computeTimelineDuration } from '../timeline/timelineMath'
import { getDesktopBridge } from '../../desktop/bridge'
import { getDesktopActiveProjectId } from '../../desktop/activeProject'

type TimelinePreviewProps = {
  activeClips: TimelineClip[]
  aspectRatio: PreviewAspectRatio
  fps: number
  playheadFrame: number
  timeline: TimelineState
}

type PreviewExportStatus = 'idle' | 'preparing' | 'recording' | 'converting' | 'done' | 'error'

function findClip(activeClips: TimelineClip[], type: TimelineClip['type']): TimelineClip | null {
  return activeClips.find((clip) => clip.type === type) || null
}

const PREVIEW_RATIOS: Array<{ value: PreviewAspectRatio; label: string; title: string; css: string; width: number; height: number }> = [
  { value: '16:9', label: '16:9', title: '横屏 / YouTube / B站', css: '16 / 9', width: 16, height: 9 },
  { value: '9:16', label: '9:16', title: '竖屏 / 短视频', css: '9 / 16', width: 9, height: 16 },
  { value: '1:1', label: '1:1', title: '方形 / 信息流', css: '1 / 1', width: 1, height: 1 },
  { value: '4:5', label: '4:5', title: '社媒竖图 / Feed', css: '4 / 5', width: 4, height: 5 },
  { value: '3:4', label: '3:4', title: '竖版海报 / 封面', css: '3 / 4', width: 3, height: 4 },
  { value: '4:3', label: '4:3', title: '传统横屏', css: '4 / 3', width: 4, height: 3 },
  { value: '21:9', label: '21:9', title: '电影宽屏', css: '21 / 9', width: 21, height: 9 },
]

export default function TimelinePreview({ activeClips, aspectRatio, fps, playheadFrame, timeline }: TimelinePreviewProps): JSX.Element {
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
  // 当前在跑导出的 jobId（供进度区「取消」按钮调 exports.cancel）。exportApi 内部生成 jobId
  // 不直接回传 UI，故这里订阅导出事件、按当前项目相关性捕获（per-project 单 active 锁 →
  // 同一项目同时至多一个在跑 job，相关性可靠）。
  const cancelJobIdRef = React.useRef('')
  const [canCancelExport, setCanCancelExport] = React.useState(false)
  const [stageSize, setStageSize] = React.useState<{ width: number; height: number } | null>(null)
  const [exportStatus, setExportStatus] = React.useState<PreviewExportStatus>('idle')
  const [exportRatio, setExportRatio] = React.useState(0)
  const [playbackError, setPlaybackError] = React.useState('')
  const [editingTextId, setEditingTextId] = React.useState('')
  const [editingDraft, setEditingDraft] = React.useState('')
  const [textMenuOpen, setTextMenuOpen] = React.useState(false)
  const textMenuRef = React.useRef<HTMLDivElement | null>(null)
  const [textSnapGuides, setTextSnapGuides] = React.useState<{ x: number | null; y: number | null }>({ x: null, y: null })
  const addTimelineTextClip = useWorkbenchStore((state) => state.addTimelineTextClip)
  const updateTimelineTextClip = useWorkbenchStore((state) => state.updateTimelineTextClip)
  const updateTimelineTextClipTransform = useWorkbenchStore((state) => state.updateTimelineTextClipTransform)
  const selectTimelineTextClip = useWorkbenchStore((state) => state.selectTimelineTextClip)
  const selectedTextClipId = useWorkbenchStore((state) => state.selectedTextClipId)
  const setPreviewAspectRatio = useWorkbenchStore((state) => state.setPreviewAspectRatio)
  const setTimelineClipFraming = useWorkbenchStore((state) => state.setTimelineClipFraming)
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
  // 取景 per-clip（P0-5）：控件作用于主媒体 clip（视频优先，z-2 在上）；渲染时各媒体用自己的 framing。
  const framingClipId = (videoClip ?? imageClip)?.id ?? ''
  const imageFraming = resolveClipFraming(imageClip ?? undefined)
  const videoFraming = resolveClipFraming(videoClip ?? undefined)
  const framing = videoClip ? videoFraming : imageFraming
  const isEmpty = timeline.tracks.every(t => t.clips.length === 0) && (timeline.textClips ?? []).length === 0
  const totalFrames = computeTimelineDuration(timeline)
  const currentSeconds = (playheadFrame / (timeline.fps || 30)).toFixed(1)
  const totalSeconds = (totalFrames / (timeline.fps || 30)).toFixed(1)
  const exportBusy = exportStatus === 'preparing' || exportStatus === 'recording' || exportStatus === 'converting'
  const exportTitle = buildMp4ExportButtonTitle({
    aspectRatio,
    isEmpty,
    isRecording: exportStatus === 'recording',
    isConverting: exportStatus === 'converting',
    progressPercent: exportRatio * 100,
  })

  React.useEffect(() => {
    const video = videoRef.current
    if (!video || !videoClip?.url) return
    if (playing) return
    const nextTime = resolveVideoClipMediaTimeSeconds({ clip: videoClip, playheadFrame, fps })
    if (!Number.isFinite(nextTime)) return
    if (Math.abs(video.currentTime - nextTime) < 0.08) return
    video.currentTime = nextTime
  }, [fps, playheadFrame, videoClip, playing])

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

  const updateMediaScale = React.useCallback((delta: number) => {
    if (!framingClipId) return
    setTimelineClipFraming(framingClipId, { scale: clampFramingScale(framing.scale + delta) }, { commit: true })
  }, [framingClipId, framing.scale, setTimelineClipFraming])

  const resetMediaTransform = React.useCallback(() => {
    if (!framingClipId) return
    setTimelineClipFraming(framingClipId, { scale: 1, offsetX: 0, offsetY: 0 }, { commit: true })
  }, [framingClipId, setTimelineClipFraming])

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
      setExportRatio(0)
      const projectId = getDesktopActiveProjectId().trim()
      const result = await exportTimelineToMp4({
        timeline,
        aspectRatio,
        projectId,
        resolution: '1080p',
        quality: 'standard',
        onProgress: (progress: Parameters<NonNullable<ExportTimelineToMp4Options['onProgress']>>[0]) => {
          setExportStatus(progress.status)
          setExportRatio(progress.ratio)
        },
      })
      toast(`已导出到项目 exports 文件夹：${result.relativePath}`, 'success')
      void getDesktopBridge()?.exports.showInFolder({ projectId, relativePath: result.relativePath }).catch(() => undefined)
      setExportStatus('idle')
    } catch (error) {
      setExportStatus('idle')
      const message = error instanceof Error ? error.message : '导出失败'
      toast(message, 'error')
    } finally {
      cancelJobIdRef.current = ''
      setCanCancelExport(false)
    }
  }, [aspectRatio, exportBusy, timeline])

  // 导出进行中订阅导出事件，捕获当前项目在跑 job 的 id（供「取消」按钮）。
  // exportApi 内部生成 jobId 不回传 UI；per-project 单 active 锁保证相关性可靠。
  React.useEffect(() => {
    if (!exportBusy) return
    const bridge = getDesktopBridge()
    const projectId = getDesktopActiveProjectId().trim()
    if (!bridge?.exports?.onEvent || !bridge.exports.cancel || !projectId) return
    const unsubscribe = bridge.exports.onEvent((event) => {
      if (event.projectId !== projectId) return
      const stage = event.snapshot.progress.stage
      const active = stage !== 'succeeded' && stage !== 'failed' && stage !== 'cancelled'
      if (active && event.jobId) {
        cancelJobIdRef.current = event.jobId
        setCanCancelExport(true)
      }
    })
    return () => unsubscribe?.()
  }, [exportBusy])

  const handleCancelExport = React.useCallback(() => {
    const jobId = cancelJobIdRef.current
    if (!jobId) return
    setCanCancelExport(false)
    // 后端 cancelExportJob abort 在跑的 ffmpeg → finishTempInput 抛 Cancelled，
    // handleExport 的 catch 收口（复位状态 + toast），这里不重复弹错。
    void getDesktopBridge()?.exports.cancel(jobId).catch((error: unknown) => {
      console.warn('Failed to cancel export job', error)
    })
  }, [])

  // 右上角「导出」在预览页时派发本事件 → 直接触发导出（handleExport 已自带 busy/空 守卫）。
  React.useEffect(() => {
    const onRequest = () => { void handleExport() }
    window.addEventListener('nomi-request-export', onRequest as EventListener)
    return () => window.removeEventListener('nomi-request-export', onRequest as EventListener)
  }, [handleExport])

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
    if (!framingClipId) return
    if ((event.target as HTMLElement).closest('button')) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      clipId: framingClipId,
      startX: event.clientX,
      startY: event.clientY,
      originOffsetX: framing.offsetX,
      originOffsetY: framing.offsetY,
    }
  }, [framingClipId, framing.offsetX, framing.offsetY])

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
    )} aria-label="预览播放器">
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
                'font-[var(--nomi-font-display)] text-lg tracking-tight text-[var(--workbench-muted)]',
              )}>画面预览</span>
              <span className={cn(
                'workbench-preview-player__placeholder-sub',
                'text-xs text-[var(--workbench-muted-soft)]',
              )}>{"从「生成区」拖入素材即可显示"}</span>
            </div>
          ) : null}
        </div>
        {playbackError ? (
          <div className={cn(
            'workbench-preview-player__media-error',
            'absolute left-3 right-3 bottom-3 z-[4]',
            'py-[7px] px-[9px] bg-[color-mix(in_srgb,var(--nomi-paper)_90%,transparent)]',
            'text-[var(--workbench-danger)] text-xs leading-[1.35] pointer-events-none',
          )} role="alert">
            {playbackError}
          </div>
        ) : null}
        {imageClip?.url ? (
          <img className={cn(
            'workbench-preview-player__image',
            'absolute inset-0 z-[1] w-full h-full bg-transparent select-none will-change-transform',
            imageFitClass,
          )} src={imageClip.url} alt={imageClip.label || ''} style={imageStyle} />
        ) : null}
        {videoUrl ? (
          <video
            ref={videoRef}
            className={cn(
              'workbench-preview-player__video',
              'absolute inset-0 z-[2] w-full h-full bg-transparent select-none will-change-transform',
              videoFitClass,
            )}
            src={videoPlaybackUrl}
            crossOrigin="use-credentials"
            muted
            playsInline
            style={videoStyle}
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
                borderRadius: 'var(--nomi-radius-md)',
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
                    <div style={contentStyle} onDoubleClick={(event) => { event.stopPropagation(); beginEditText(clip.id, clip.text) }} title="拖动移动 · 四角缩放 · 双击改字">
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
                  title="点选 · 双击改字"
                >
                  {clip.text}
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
      </div>
      {/* 控制条：stage 下方独立一行（不再 absolute 浮在画面上遮挡底部字幕）。
          section 不裁剪 → 下拉/安全框可正常溢出；居中、不被 flex 挤压。 */}
      <div className={cn(
        'workbench-preview-player__control-bar',
        'relative z-[3] shrink-0 max-w-full inline-flex items-center gap-1.5 p-[5px]',
        'border border-[var(--workbench-border)] rounded-full',
        'bg-[color-mix(in_oklch,var(--nomi-paper)_88%,transparent)]',
        'shadow-[var(--workbench-shadow-sm)] backdrop-blur-[12px] backdrop-saturate-[1.2]',
        // 子项一律不被 flex 挤压：避免画幅/显示下拉被截成「1…」「适.」、导出/安全框折两行。
        '[&>*]:shrink-0',
      )} role="toolbar" aria-label="预览控制">
        <WorkbenchIconButton
          className={cn(
            'workbench-preview-player__play',
            'w-[30px] h-[30px] grid place-items-center border-0 rounded-full',
            'bg-[var(--nomi-ink)] text-[var(--nomi-paper)]',
            // 禁用态（时间轴为空）不再 hover 高亮成「假可点」：enabled: 门控自身 accent hover，
            // 并用 disabled:hover: 把基类那条无条件 hover:bg-workbench-hover 钉回静息 ink/paper。
            'enabled:hover:bg-[var(--nomi-accent)] enabled:hover:text-[var(--nomi-paper)]',
            'disabled:hover:bg-[var(--nomi-ink)] disabled:hover:text-[var(--nomi-paper)]',
          )}
          label={playing ? '暂停' : '播放'}
          icon={playing ? <IconPlayerPause size={16} stroke={2} /> : <IconPlayerPlay size={16} stroke={2} />}
          onClick={togglePlayback}
          disabled={isEmpty}
          title={isEmpty ? '时间轴为空' : undefined}
        />
        <span className="text-micro opacity-60 tabular-nums min-w-[60px]">
          {currentSeconds}s / {totalSeconds}s
        </span>
        <div className={cn(
          'workbench-preview-player__control-separator',
          'w-px h-5 bg-[var(--workbench-border-soft)]',
        )} aria-hidden="true" />
        <NomiSelect
          ariaLabel="预览画幅"
          leadingLabel="画幅"
          size="xs"
          value={aspectRatio}
          options={PREVIEW_RATIOS.map((ratio) => ({ value: ratio.value, label: ratio.label }))}
          onChange={(value) => setPreviewAspectRatio(value as PreviewAspectRatio)}
        />
        <div className={cn(
          'workbench-preview-player__control-separator',
          'w-px h-5 bg-[var(--workbench-border-soft)]',
        )} aria-hidden="true" />
        <NomiSelect
          ariaLabel="画面适配"
          leadingLabel="显示"
          size="xs"
          value={framing.fit}
          options={[
            { value: 'contain', label: '适应' },
            { value: 'cover', label: '填充' },
          ]}
          onChange={(value) => { if (framingClipId) setTimelineClipFraming(framingClipId, { fit: value as ClipFit }, { commit: true }) }}
        />
        <div className={cn(
          'workbench-preview-player__control-separator',
          'w-px h-5 bg-[var(--workbench-border-soft)]',
        )} aria-hidden="true" />
        <div className={cn(
          'workbench-preview-player__control-group',
          'flex-none inline-flex items-center gap-[3px]',
        )} aria-label="预览构图">
          <WorkbenchIconButton className={cn('workbench-preview-player__icon-button', CONTROL_ICON_BUTTON_CLASS)} label="缩小画面" icon={<IconZoomOut size={16} />} onClick={() => updateMediaScale(-0.1)} disabled={!hasMedia} />
          <span className={cn(
            'workbench-preview-player__zoom-label',
            'min-w-[38px] text-[var(--workbench-muted)] text-micro font-bold tabular-nums text-center',
          )} aria-label="当前缩放">{Math.round(framing.scale * 100)}%</span>
          <WorkbenchIconButton className={cn('workbench-preview-player__icon-button', CONTROL_ICON_BUTTON_CLASS)} label="重置画面" icon={<IconRefresh size={16} />} onClick={resetMediaTransform} disabled={!hasMedia} />
          <WorkbenchIconButton className={cn('workbench-preview-player__icon-button', CONTROL_ICON_BUTTON_CLASS)} label="放大画面" icon={<IconZoomIn size={16} />} onClick={() => updateMediaScale(0.1)} disabled={!hasMedia} />
        </div>
        <div className={cn(
          'workbench-preview-player__control-separator',
          'w-px h-5 bg-[var(--workbench-border-soft)]',
        )} aria-hidden="true" />
        <div ref={textMenuRef} className={cn(
          'workbench-preview-player__text-tools',
          'relative flex-none inline-flex items-center',
        )} aria-label="添加文字">
          <WorkbenchButton
            className={cn('h-7 px-2.5 inline-flex items-center gap-1 border border-[var(--workbench-border)] rounded-full whitespace-nowrap bg-transparent text-[var(--workbench-muted)] text-micro font-bold cursor-pointer hover:bg-[var(--workbench-hover)] hover:text-[var(--workbench-ink)]')}
            aria-label="添加文字"
            aria-expanded={textMenuOpen}
            title="加字幕 / 标题（都是文字，可自由拖动缩放）"
            onClick={() => setTextMenuOpen((open) => !open)}
          >
            <IconLetterCase size={14} />文字<IconChevronDown size={12} className="opacity-60" />
          </WorkbenchButton>
          {textMenuOpen ? (
            <div className={cn(
              'workbench-preview-player__text-menu',
              'absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 z-[5]',
              'min-w-[148px] p-1 flex flex-col gap-0.5',
              'rounded-[var(--nomi-radius-md)] border border-[var(--workbench-border)]',
              'bg-[var(--nomi-paper)] shadow-[var(--workbench-shadow-pop)]',
            )} role="menu">
              <button type="button" role="menuitem"
                className={cn('flex items-center gap-2 px-2 py-1.5 rounded-[var(--nomi-radius-sm)] text-left text-caption text-[var(--workbench-ink)] hover:bg-[var(--workbench-hover)]')}
                onClick={() => addText('caption')}>
                <IconLetterCase size={14} className="flex-none text-[var(--workbench-text)]" />
                <span className="flex-1">字幕</span>
                <span className="text-[var(--workbench-muted-soft)] text-micro">底部 · 小</span>
              </button>
              <button type="button" role="menuitem"
                className={cn('flex items-center gap-2 px-2 py-1.5 rounded-[var(--nomi-radius-sm)] text-left text-caption text-[var(--workbench-ink)] hover:bg-[var(--workbench-hover)]')}
                onClick={() => addText('title')}>
                <IconLetterCase size={14} className="flex-none text-[var(--workbench-text)]" />
                <span className="flex-1">标题</span>
                <span className="text-[var(--workbench-muted-soft)] text-micro">居中 · 大</span>
              </button>
            </div>
          ) : null}
        </div>
        <TextClipStyleControls timeline={timeline} selectedTextClipId={selectedTextClipId} />
        <div className={cn(
          'workbench-preview-player__control-separator',
          'w-px h-5 bg-[var(--workbench-border-soft)]',
        )} aria-hidden="true" />
        {(exportStatus === 'preparing' || exportStatus === 'recording' || exportStatus === 'converting') ? (
          <div className={cn(
            'workbench-preview-player__export-progress',
            'flex items-center gap-2 px-2',
          )}>
            <div className={cn(
              'workbench-preview-player__export-progress-bar-track',
              'w-20 h-1 bg-white/15 rounded-sm overflow-hidden',
            )}>
              <div
                className={cn(
                  'workbench-preview-player__export-progress-bar',
                  'h-1 bg-[var(--mantine-color-blue-5,#339af0)] rounded-sm transition-[width] duration-200 ease-in-out min-w-1',
                )}
                style={{ width: `${Math.round(exportRatio * 100)}%` }}
              />
            </div>
            <span className={cn(
              'workbench-preview-player__export-progress-label',
              'text-xs text-white/70 whitespace-nowrap',
            )}>
              {exportStatus === 'preparing' ? '准备中…' : exportStatus === 'converting' ? '转码 MP4…' : `导出中 ${Math.round(exportRatio * 100)}%`}
            </span>
            <WorkbenchIconButton
              className={cn(
                'workbench-preview-player__export-cancel',
                'w-6 h-6 inline-grid place-items-center p-0 rounded-full border-0 bg-transparent text-[var(--workbench-muted)]',
                'enabled:cursor-pointer enabled:hover:bg-[var(--workbench-hover)] enabled:hover:text-[var(--workbench-danger)]',
                // 同 CONTROL_ICON_BUTTON_CLASS：钉死基类无条件 hover，禁用态（准备中）不假高亮。
                'disabled:hover:bg-transparent disabled:hover:text-[var(--workbench-muted)]',
              )}
              label="取消导出"
              title={canCancelExport ? '取消导出' : '准备中，暂不可取消'}
              icon={<IconX size={14} />}
              onClick={handleCancelExport}
              disabled={!canCancelExport}
            />
          </div>
        ) : null}
        <WorkbenchButton
          className={cn(
            'workbench-preview-player__export-button',
            'h-7 px-3 border border-transparent rounded-full whitespace-nowrap',
            'inline-flex items-center justify-center gap-1.5',
            'bg-[var(--nomi-ink)] text-[var(--nomi-paper)] text-micro font-bold cursor-pointer',
            'hover:bg-[var(--nomi-accent)] hover:text-[var(--nomi-paper)]',
            'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-[var(--nomi-ink)]',
          )}
          aria-label="导出 MP4"
          onClick={handleExport}
          disabled={exportBusy || isEmpty}
          title={exportTitle}
        >
          {exportBusy ? <NomiLoadingMark size={15} className={cn('workbench-preview-player__spinner', 'animate-spin')} /> : <IconDownload size={15} />}
          导出 MP4
        </WorkbenchButton>
      </div>
    </section>
  )
}
