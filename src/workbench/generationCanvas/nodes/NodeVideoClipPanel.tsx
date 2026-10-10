// 视频节点「剪辑」面板：贴着节点下沿弹出（不进全局时间轴、不弹全屏窗口），拖入点 / 出点 → 预览保留的这一段 → 确认。
//
// 入点 / 出点手柄、拖动手感、时间尺、播放头，全是剪辑节点那条 `ClipNodeTimeline`（一条视频放成一个片段，片段的左右边就是入点 / 出点），
// 手势入口与命中垫规则都在它里面（#1145 / #1149 的统一入口），这里不另写一套裁切。新的只有面板外壳、预览播放和三行读数：
//   · 读数（入点 / 出点 / 保留）跟着 `onResizeLive`（拖手柄的每一帧）走，松手后读已提交的值；
//   · 预览：卡里一个 `<video>`，只播入点—出点之间那一段（播到出点自己停回入点）；拖入点时画面跟着入点、拖出点时跟着出点；
//   · 确认 / 取消用 `DecisionBar`（确认在右），关闭用 `WorkbenchIconButton`。
// 面板像浮条一样反向缩放，画布缩到 50% 时仍是屏幕上的原尺寸，照常可用。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useViewport } from '@xyflow/react'
import { IconPlayerPause, IconPlayerPlay, IconX } from '@tabler/icons-react'
import ClipNodeTimeline from './ClipNodeTimeline'
import { DecisionBar } from '../../../design'
import { WorkbenchIconButton } from '../../../design/actions'
import { resizeClipEdge } from '../../timeline/timelineEdit'
import type { TimelineState } from '../../timeline/timelineTypes'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { cn } from '../../../utils/cn'
import { frameTimecode } from './frameTimecode'
import { MIN_TRIM_SECONDS, type VideoTrimRange } from './trimVideoToNode'

/** 面板里时间轴用的帧率：只是「帧」这个刻度的单位（0.1 秒精度读数 / 手势吸附），不是视频真实帧率。 */
export const TRIM_FPS = 30
const CLIP_ID = 'video-trim-clip'
export const CLIP_PANEL_WIDTH = 480

function knownDuration(node: GenerationCanvasNode): number {
  const candidates = [node.result?.durationSeconds, node.meta?.videoDuration, node.meta?.durationSeconds]
  return candidates.find((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0) ?? 0
}

export function makeTrimTimeline(node: GenerationCanvasNode, durationSeconds: number, inFrame: number, outFrame: number, playheadFrame: number): TimelineState {
  const total = Math.max(1, Math.round(durationSeconds * TRIM_FPS))
  return {
    version: 1,
    fps: TRIM_FPS,
    scale: 1,
    playheadFrame,
    textClips: [],
    tracks: [{
      id: 'video-trim-track',
      type: 'video',
      label: '',
      clips: [{
        id: CLIP_ID,
        type: 'video',
        sourceNodeId: node.id,
        label: node.title || '',
        startFrame: inFrame,
        endFrame: outFrame,
        frameCount: total,
        offsetStartFrame: inFrame,
        offsetEndFrame: Math.max(0, total - outFrame),
        url: node.result?.url ?? '',
        ...(node.result?.thumbnailUrl ? { thumbnailUrl: node.result.thumbnailUrl } : {}),
      }],
    }],
  }
}

type Live = { edge: 'left' | 'right'; startFrame: number; endFrame: number } | null

export default function NodeVideoClipPanel({ node, onClose, onConfirm }: { node: GenerationCanvasNode; onClose: () => void; onConfirm: (range: VideoTrimRange) => void }): JSX.Element {
  const { t } = useTranslation()
  const { zoom: canvasZoom } = useViewport()
  const zoom = canvasZoom || 1
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const [duration, setDuration] = React.useState(() => knownDuration(node))
  const [inFrame, setInFrame] = React.useState(0)
  const [outFrame, setOutFrame] = React.useState(() => Math.round(knownDuration(node) * TRIM_FPS))
  const [live, setLive] = React.useState<Live>(null)
  const [playing, setPlaying] = React.useState(false)
  const [time, setTime] = React.useState(0)
  const [broken, setBroken] = React.useState(false)
  const outRef = React.useRef(outFrame)
  const inRef = React.useRef(inFrame)
  inRef.current = inFrame
  outRef.current = outFrame

  // 视频真实时长以播放器为准（节点上记的时长可能没有 / 不准）：读到之后把出点放在最右。
  const onMetadata = (): void => {
    const video = videoRef.current
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return
    setBroken(false)
    if (Math.abs(video.duration - duration) > 0.05) {
      setDuration(video.duration)
      setInFrame(0)
      setOutFrame(Math.round(video.duration * TRIM_FPS))
    }
  }

  const seek = React.useCallback((seconds: number): void => {
    const video = videoRef.current
    if (!video) return
    try { video.currentTime = Math.max(0, seconds) } catch { /* 元数据没到：onMetadata 之后会再同步 */ }
    setTime(seconds)
  }, [])

  const shownIn = live ? live.startFrame : inFrame
  const shownOut = live ? live.endFrame : outFrame
  // 非播放时：画面停在入点；拖右手柄时跟着出点；拖左手柄时跟着入点。
  React.useEffect(() => {
    if (playing) return
    seek((live?.edge === 'right' ? shownOut : shownIn) / TRIM_FPS)
  }, [live?.edge, playing, seek, shownIn, shownOut])

  // 播放：只播入点—出点之间，播到出点自己停回入点。
  React.useEffect(() => {
    if (!playing) return undefined
    const video = videoRef.current
    if (!video) return undefined
    const start = inRef.current / TRIM_FPS
    const end = outRef.current / TRIM_FPS
    if (video.currentTime < start || video.currentTime >= end) video.currentTime = start
    void video.play().catch(() => setPlaying(false))
    let frame = 0
    const tick = (): void => {
      setTime(video.currentTime)
      if (video.currentTime >= end || video.ended) {
        video.pause()
        setPlaying(false)
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame); video.pause() }
  }, [playing])

  const timeline = React.useMemo(
    () => makeTrimTimeline(node, duration, inFrame, outFrame, Math.round(time * TRIM_FPS)),
    [duration, inFrame, node, outFrame, time],
  )

  const keepSeconds = (shownOut - shownIn) / TRIM_FPS
  const canConfirm = duration > 0 && !broken && keepSeconds >= MIN_TRIM_SECONDS - 1e-9
  const chipSeconds = playing ? time : (live?.edge === 'right' ? shownOut : shownIn) / TRIM_FPS

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const title = t('generationCommon.videoTrim.panelTitle')
  return (
    <div
      className="absolute left-1/2 z-[20]"
      style={{ top: `calc(100% + ${14 / zoom}px)`, transform: `translateX(-50%) scale(${1 / zoom})`, transformOrigin: 'top center' }}
    >
      <div
        role="dialog"
        aria-label={t('generationCommon.videoTrim.panelAria')}
        data-video-clip-panel="true"
        className="nodrag nowheel flex flex-col gap-3 rounded-nomi border border-nomi-line bg-nomi-paper p-3 shadow-nomi-lg"
        style={{ width: CLIP_PANEL_WIDTH }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="text-body font-medium text-nomi-ink">{title}</div>
          <WorkbenchIconButton label={t('generationCommon.videoTrim.close')} icon={<IconX size={16} stroke={1.8} />} onClick={onClose} />
        </div>

        <div className="relative aspect-video overflow-hidden rounded-nomi-sm bg-nomi-ink-05 ring-1 ring-inset ring-nomi-line">
          <video
            ref={videoRef}
            src={node.result?.url}
            aria-label={t('generationCommon.videoTrim.previewAria')}
            className="h-full w-full object-contain"
            muted
            playsInline
            preload="auto"
            onLoadedMetadata={onMetadata}
            onError={() => setBroken(true)}
          />
          <span
            data-video-clip-time="true"
            className="pointer-events-none absolute bottom-2 right-2 rounded-nomi-sm bg-nomi-paper/[0.82] px-2 py-[3px] font-mono text-micro tabular-nums text-nomi-ink-80 backdrop-blur-[8px]"
          >
            {frameTimecode(chipSeconds)}
          </span>
          {broken ? <div role="alert" className="absolute inset-0 grid place-items-center bg-nomi-paper/90 px-4 text-center text-body-sm text-nomi-ink-80">{t('generationCommon.videoTrim.noPlayer')}</div> : null}
        </div>

        <ClipNodeTimeline
          timeline={timeline}
          canvasZoom={zoom}
          selectedClipId={CLIP_ID}
          onSelectClip={() => undefined}
          onMoveClip={() => undefined}
          onResizeLive={setLive}
          onResizeClip={(clipId, edge, deltaFrame) => {
            const clip = resizeClipEdge(timeline, clipId, edge, deltaFrame).tracks[0]?.clips[0]
            if (!clip) return
            setPlaying(false)
            setInFrame(clip.startFrame)
            setOutFrame(clip.endFrame)
          }}
          onScrubPlayhead={(frame) => {
            setPlaying(false)
            const clamped = Math.min(outRef.current, Math.max(inRef.current, frame))
            seek(clamped / TRIM_FPS)
          }}
        />

        <DecisionBar
          size="md"
          cancelLabel={t('generationCommon.videoTrim.cancel')}
          onCancel={onClose}
          primaryLabel={t('generationCommon.videoTrim.confirm')}
          primaryDisabled={!canConfirm}
          onPrimary={() => { if (canConfirm) onConfirm({ startSeconds: inFrame / TRIM_FPS, endSeconds: outFrame / TRIM_FPS }) }}
          leading={(
            <div className="flex min-w-0 items-center gap-3">
              <WorkbenchIconButton
                label={playing ? t('generationCommon.videoTrim.pause') : t('generationCommon.videoTrim.play')}
                icon={playing ? <IconPlayerPause size={16} stroke={1.8} /> : <IconPlayerPlay size={16} stroke={1.8} />}
                disabled={!canConfirm}
                onClick={() => setPlaying((value) => !value)}
              />
              <Readout label={t('generationCommon.videoTrim.tcIn')} value={frameTimecode(shownIn / TRIM_FPS)} active={live?.edge === 'left'} />
              <Readout label={t('generationCommon.videoTrim.tcOut')} value={frameTimecode(shownOut / TRIM_FPS)} active={live?.edge === 'right'} />
              <Readout label={t('generationCommon.videoTrim.keep')} value={`${keepSeconds.toFixed(1)}s`} />
            </div>
          )}
        />
      </div>
    </div>
  )
}

function Readout({ label, value, active = false }: { label: string; value: string; active?: boolean }): JSX.Element {
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap text-body-sm text-nomi-ink-60">
      {label}
      <span className={cn('font-mono tabular-nums', active ? 'rounded-nomi-sm bg-nomi-accent-soft px-1 text-nomi-accent' : 'text-nomi-ink')}>{value}</span>
    </span>
  )
}
