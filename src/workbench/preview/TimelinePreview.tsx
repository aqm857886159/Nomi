import React from 'react'
import { IconChevronDown, IconDownload, IconLetterCase, IconMinus, IconPlayerPause, IconPlayerPlay, IconPlus, IconRefresh, IconZoomIn, IconZoomOut } from '@tabler/icons-react'
import { NomiLoadingMark, NomiSelect, WorkbenchButton, WorkbenchIconButton } from '../../design'
import { cn } from '../../utils/cn'
import { useWorkbenchStore } from '../workbenchStore'
import type { TimelineClip, TimelineState } from '../timeline/timelineTypes'
import { resolveActiveTextClipsAtFrame } from '../timeline/timelineMath'
import { resolveTextBox, resolveOverlayTransform } from '../timeline/textLayout'
import { TEXT_FONTS, DEFAULT_TEXT_FONT_ID } from '../timeline/textFonts'
import { SCALE_MIN, SCALE_MAX } from '../timeline/overlayTransform'
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
  const playerRef = React.useRef<HTMLDivElement | null>(null)
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
  const [exportStatus, setExportStatus] = React.useState<PreviewExportStatus>('idle')
  const [exportRatio, setExportRatio] = React.useState(0)
  const [playbackError, setPlaybackError] = React.useState('')
  const [editingTextId, setEditingTextId] = React.useState('')
  const [editingDraft, setEditingDraft] = React.useState('')
  const [textMenuOpen, setTextMenuOpen] = React.useState(false)
  const textMenuRef = React.useRef<HTMLDivElement | null>(null)
  const [sizePctDraft, setSizePctDraft] = React.useState('')
  const [textSnapGuides, setTextSnapGuides] = React.useState<{ x: number | null; y: number | null }>({ x: null, y: null })
  const addTimelineTextClip = useWorkbenchStore((state) => state.addTimelineTextClip)
  const updateTimelineTextClip = useWorkbenchStore((state) => state.updateTimelineTextClip)
  const updateTimelineTextClipTransform = useWorkbenchStore((state) => state.updateTimelineTextClipTransform)
  const updateTimelineTextClipFont = useWorkbenchStore((state) => state.updateTimelineTextClipFont)
  const selectTimelineTextClip = useWorkbenchStore((state) => state.selectTimelineTextClip)
  const selectedTextClipId = useWorkbenchStore((state) => state.selectedTextClipId)
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
    }
  }, [aspectRatio, exportBusy, timeline])

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
  // 「适应」=contain（整画面内缩、留边）/「填充」=cover（铺满、裁边）。
  // 之前 object-contain 写死，fitMode 改了没人消费 → 点了没效果，这里 derive 出来。
  const objectFitClass = fitMode === 'cover' ? 'object-cover' : 'object-contain'

  // 文字叠加层（字幕/标题卡）：当前帧 active 的文字 clip，按 stage 像素几何摆放。
  const activeTextClips = resolveActiveTextClipsAtFrame(timeline, playheadFrame)
  // 选中的文字 clip → 控制条出字号/字体精确控件
  const selectedTextClip = (timeline.textClips ?? []).find((clip) => clip.id === selectedTextClipId) || null
  const selectedTextScale = selectedTextClip ? resolveOverlayTransform(selectedTextClip).scale : 1
  const selectedTextFontId = selectedTextClip?.fontFamily ?? DEFAULT_TEXT_FONT_ID
  const selectedSizePct = Math.round(selectedTextScale * 100)

  // 字号输入框：未聚焦时跟随真实 scale，聚焦编辑时用本地 draft。
  React.useEffect(() => { setSizePctDraft(String(selectedSizePct)) }, [selectedSizePct, selectedTextClipId])

  const applyTextScale = React.useCallback((scale: number) => {
    if (!selectedTextClipId) return
    updateTimelineTextClipTransform(selectedTextClipId, { scale: Math.min(SCALE_MAX, Math.max(SCALE_MIN, scale)) }, { commit: true })
  }, [selectedTextClipId, updateTimelineTextClipTransform])

  const commitSizePct = React.useCallback(() => {
    const pct = Number(sizePctDraft)
    if (Number.isFinite(pct) && pct > 0) applyTextScale(pct / 100)
  }, [applyTextScale, sizePctDraft])

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
            objectFitClass,
          )} src={imageClip.url} alt={imageClip.label || ''} style={mediaStyle} />
        ) : null}
        {videoUrl ? (
          <video
            ref={videoRef}
            className={cn(
              'workbench-preview-player__video',
              'absolute inset-0 z-[2] w-full h-full bg-transparent select-none will-change-transform',
              objectFitClass,
            )}
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
            'hover:bg-[var(--nomi-accent)] hover:text-[var(--nomi-paper)]',
          )}
          label={playing ? '暂停' : '播放'}
          icon={playing ? <IconPlayerPause size={16} stroke={2} /> : <IconPlayerPlay size={16} stroke={2} />}
          onClick={togglePlayback}
          disabled={isEmpty}
          title={isEmpty ? '时间轴为空' : undefined}
        />
        <span className="text-[11px] opacity-60 tabular-nums min-w-[60px]">
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
          value={fitMode}
          options={[
            { value: 'contain', label: '适应' },
            { value: 'cover', label: '填充' },
          ]}
          onChange={(value) => setFitMode(value as PreviewFitMode)}
        />
        <div className={cn(
          'workbench-preview-player__control-separator',
          'w-px h-5 bg-[var(--workbench-border-soft)]',
        )} aria-hidden="true" />
        <div className={cn(
          'workbench-preview-player__control-group',
          'flex-none inline-flex items-center gap-[3px]',
        )} aria-label="预览构图">
          <WorkbenchIconButton className={cn('workbench-preview-player__icon-button', 'w-6 h-6 inline-grid place-items-center p-0 border border-transparent rounded-full bg-transparent text-[var(--workbench-muted)] cursor-pointer hover:bg-[var(--workbench-hover)] hover:text-[var(--workbench-ink)]')} label="缩小画面" icon={<IconZoomOut size={16} />} onClick={() => updateMediaScale(-0.1)} disabled={!hasMedia} />
          <span className={cn(
            'workbench-preview-player__zoom-label',
            'min-w-[38px] text-[var(--workbench-muted)] text-[11px] font-bold tabular-nums text-center',
          )} aria-label="当前缩放">{Math.round(mediaScale * 100)}%</span>
          <WorkbenchIconButton className={cn('workbench-preview-player__icon-button', 'w-6 h-6 inline-grid place-items-center p-0 border border-transparent rounded-full bg-transparent text-[var(--workbench-muted)] cursor-pointer hover:bg-[var(--workbench-hover)] hover:text-[var(--workbench-ink)]')} label="重置画面" icon={<IconRefresh size={16} />} onClick={resetMediaTransform} disabled={!hasMedia} />
          <WorkbenchIconButton className={cn('workbench-preview-player__icon-button', 'w-6 h-6 inline-grid place-items-center p-0 border border-transparent rounded-full bg-transparent text-[var(--workbench-muted)] cursor-pointer hover:bg-[var(--workbench-hover)] hover:text-[var(--workbench-ink)]')} label="放大画面" icon={<IconZoomIn size={16} />} onClick={() => updateMediaScale(0.1)} disabled={!hasMedia} />
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
                className={cn('flex items-center gap-2 px-2 py-1.5 rounded-[var(--nomi-radius-sm)] text-left text-[12px] text-[var(--workbench-ink)] hover:bg-[var(--workbench-hover)]')}
                onClick={() => addText('caption')}>
                <IconLetterCase size={14} className="flex-none text-[var(--workbench-text)]" />
                <span className="flex-1">字幕</span>
                <span className="text-[var(--workbench-muted-soft)] text-[11px]">底部 · 小</span>
              </button>
              <button type="button" role="menuitem"
                className={cn('flex items-center gap-2 px-2 py-1.5 rounded-[var(--nomi-radius-sm)] text-left text-[12px] text-[var(--workbench-ink)] hover:bg-[var(--workbench-hover)]')}
                onClick={() => addText('title')}>
                <IconLetterCase size={14} className="flex-none text-[var(--workbench-text)]" />
                <span className="flex-1">标题</span>
                <span className="text-[var(--workbench-muted-soft)] text-[11px]">居中 · 大</span>
              </button>
            </div>
          ) : null}
        </div>
        {selectedTextClip ? (
          <>
            <div className={cn('workbench-preview-player__control-separator', 'w-px h-5 bg-[var(--workbench-border-soft)]')} aria-hidden="true" />
            <div className={cn('workbench-preview-player__text-style', 'flex-none inline-flex items-center gap-1.5')} aria-label="文字样式">
              <span className="text-[11px] text-[var(--workbench-muted)] font-bold">字号</span>
              <div className="inline-flex items-center gap-[3px]">
                <WorkbenchIconButton className={cn('w-6 h-6 inline-grid place-items-center p-0 border border-transparent rounded-full bg-transparent text-[var(--workbench-muted)] cursor-pointer hover:bg-[var(--workbench-hover)] hover:text-[var(--workbench-ink)]')} label="减小字号" icon={<IconMinus size={14} />} onClick={() => applyTextScale(selectedTextScale - 0.1)} />
                <input
                  className={cn('w-[40px] h-6 text-center text-[11px] font-bold tabular-nums', 'rounded-[var(--nomi-radius-sm)] border border-[var(--workbench-border)] bg-[var(--nomi-paper)] text-[var(--workbench-ink)] outline-none focus:border-[var(--nomi-accent)]')}
                  value={sizePctDraft}
                  inputMode="numeric"
                  aria-label="字号百分比"
                  onChange={(event) => setSizePctDraft(event.target.value.replace(/[^0-9]/g, ''))}
                  onBlur={commitSizePct}
                  onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }}
                />
                <span className="text-[11px] text-[var(--workbench-muted-soft)]">%</span>
                <WorkbenchIconButton className={cn('w-6 h-6 inline-grid place-items-center p-0 border border-transparent rounded-full bg-transparent text-[var(--workbench-muted)] cursor-pointer hover:bg-[var(--workbench-hover)] hover:text-[var(--workbench-ink)]')} label="增大字号" icon={<IconPlus size={14} />} onClick={() => applyTextScale(selectedTextScale + 0.1)} />
              </div>
              <NomiSelect
                ariaLabel="字体"
                leadingLabel="字体"
                size="xs"
                value={selectedTextFontId}
                options={TEXT_FONTS.map((font) => ({ value: font.id, label: font.label }))}
                onChange={(value) => { if (selectedTextClipId) updateTimelineTextClipFont(selectedTextClipId, value) }}
              />
            </div>
          </>
        ) : null}
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
