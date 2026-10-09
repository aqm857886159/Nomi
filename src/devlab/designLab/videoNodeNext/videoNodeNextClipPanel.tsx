// 设计实验室 · 屏「视频节点的下一步」· 剪辑面板（贴着视频节点下沿弹出）。
//
// 入点 / 出点手柄、拖动手感、时间尺、播放头，全是生产的 `ClipNodeTimeline` 本体（剪辑节点同一条时间轴）：
// 一条视频放成一个片段，片段的左右边就是入点 / 出点——不另画一套裁切。新的只有面板外壳和三行读数：
//   · 外壳：生产的面板皮（`rounded-nomi border-nomi-line bg-nomi-paper shadow-nomi-lg`，同「按镜头拆」面板）、
//     确认 / 取消用生产的 `DecisionBar`（确认在右），关闭用 `WorkbenchIconButton`；
//   · 读数：入点 / 出点 / 保留时长。时间轴自己拖动时只显示「-3.2s · 20.8s」，不显示时间码，所以读数靠观察片段元素上的
//     `data-start-frame` / `data-end-frame`（生产时间轴拖动中就会更新它们）实时跟——接线时给时间轴加一个可选的
//     `onResizePreview` 回调即可替掉这个观察（约 5 行，见设计卡）。
//
// 「拖动入点中」那一格不是画出来的：挂载后对生产的入点手柄发一串真实的 pointerdown / pointermove（不发 pointerup），
// 于是时间轴停在拖动态——和用户按住手柄不放是同一个状态。
import React, { type JSX } from 'react'
import { IconPlayerPause, IconPlayerPlay, IconX } from '@tabler/icons-react'
import ClipNodeTimeline from '../../../workbench/generationCanvas/nodes/ClipNodeTimeline'
import { DecisionBar } from '../../../design'
import { WorkbenchIconButton } from '../../../design/actions'
import { resizeClipEdge } from '../../../workbench/timeline/timelineEdit'
import type { TimelineState } from '../../../workbench/timeline/timelineTypes'
import { cn } from '../../../utils/cn'
import { holdDesignLabReady } from '../labReadyHold'
import { COPY, timecode, type VnLocale } from './videoNodeNextCopy'
import { DURATION_SECONDS, FILMSTRIP, FILMSTRIP_TRIM, FPS, TOTAL_FRAMES, VIDEO } from './videoNodeNextFixtures'
import { LabStage, NextVideoToolbar, PausedVideo, useLocaleHold, useMountHold, useSeededSource, VideoCard, videoSourceNode, VN_CARD, VN_CELL_WIDTH } from './videoNodeNextToolbarKit'

const CLIP_ID = 'vn-clip'
const noop = (): void => undefined

export type ClipScenario =
  /** 刚打开：入点在最左、出点在最右。 */
  | { kind: 'open' }
  /** 按住入点手柄往右拖（`dragToSeconds` 秒处），还没松手。 */
  | { kind: 'drag-in'; dragToSeconds: number }
  /** 已经设好 in–out，正在预览（播放头在保留区间里；视频冻在这一帧，界面显示「播放中」）。 */
  | { kind: 'preview'; fromSeconds: number; toSeconds: number; atSeconds: number }

function makeTimeline(title: string, startSeconds: number, endSeconds: number, playheadSeconds: number): TimelineState {
  const startFrame = Math.round(startSeconds * FPS)
  const endFrame = Math.round(endSeconds * FPS)
  return {
    version: 1,
    fps: FPS,
    scale: 1,
    playheadFrame: Math.round(playheadSeconds * FPS),
    textClips: [],
    tracks: [{
      id: 'vn-track',
      type: 'video',
      label: '',
      clips: [{
        id: CLIP_ID,
        type: 'video',
        sourceNodeId: 'vn-source',
        label: title,
        startFrame,
        endFrame,
        frameCount: TOTAL_FRAMES,
        offsetStartFrame: startFrame,
        offsetEndFrame: Math.max(0, TOTAL_FRAMES - endFrame),
        url: VIDEO,
        thumbnailUrl: startFrame > 0 || endFrame < TOTAL_FRAMES ? FILMSTRIP_TRIM : FILMSTRIP,
      }],
    }],
  }
}

/** 观察片段元素上的 data-start-frame / data-end-frame（生产时间轴拖动中会更新它们），给读数和预览帧用。 */
function useLiveTrim(rootRef: React.RefObject<HTMLElement | null>, initial: { start: number; end: number }): { start: number; end: number; resizing: 'left' | 'right' | null } {
  const [live, setLive] = React.useState<{ start: number; end: number; resizing: 'left' | 'right' | null }>({ ...initial, resizing: null })
  React.useEffect(() => {
    let frame = 0
    const tick = (): void => {
      const clip = rootRef.current?.querySelector<HTMLElement>('[data-testid="clip-node-clip"]')
      if (clip) {
        const start = Number(clip.dataset.startFrame)
        const end = Number(clip.dataset.endFrame)
        const resizing = clip.dataset.resizing === 'left' || clip.dataset.resizing === 'right' ? clip.dataset.resizing : null
        if (Number.isFinite(start) && Number.isFinite(end)) {
          setLive((prev) => (prev.start === start && prev.end === end && prev.resizing === resizing ? prev : { start, end, resizing }))
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [rootRef])
  return live
}

/** 对生产的入点手柄发一串真实指针事件，停在拖动中（不发 pointerup）。 */
function useHoldInHandleDrag(rootRef: React.RefObject<HTMLElement | null>, dragToFrames: number | null): void {
  React.useLayoutEffect(() => {
    if (dragToFrames == null) return undefined
    const release = holdDesignLabReady('video-node-next:drag-in')
    let frame = 0
    let tries = 0
    const tick = (): void => {
      tries += 1
      const root = rootRef.current
      const clip = root?.querySelector<HTMLElement>('[data-testid="clip-node-clip"]')
      const handle = clip?.querySelector<HTMLElement>('[data-clip-handle]')
      const box = clip?.getBoundingClientRect()
      const hit = handle?.getBoundingClientRect()
      if (clip && handle && box && hit && box.width > 40 && hit.width > 0) {
        const pxPerFrame = box.width / Math.max(1, Number(clip.dataset.endFrame) - Number(clip.dataset.startFrame))
        const x0 = hit.left + hit.width / 2
        const y0 = hit.top + hit.height / 2
        const init = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientY: y0 }
        // 合成事件没有「活着的指针」，生产手柄调 setPointerCapture 会抛；这一帧里把它换成空操作，发完立刻还原。
        const proto = HTMLElement.prototype
        const original = proto.setPointerCapture
        proto.setPointerCapture = () => undefined
        try {
          handle.dispatchEvent(new PointerEvent('pointerdown', { ...init, clientX: x0 }))
        } finally {
          proto.setPointerCapture = original
        }
        const steps = 6
        for (let step = 1; step <= steps; step += 1) {
          window.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: x0 + (dragToFrames * pxPerFrame * step) / steps }))
        }
        frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => release()) })
        return
      }
      if (tries > 240) { release(); return }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame); release() }
  }, [dragToFrames, rootRef])
}

export const CLIP_PANEL_WIDTH = 480

export function ClipPanel({ locale, scenario, title }: { locale: VnLocale; scenario: ClipScenario; title: string }): JSX.Element {
  const c = COPY[locale]
  const rootRef = React.useRef<HTMLDivElement>(null)
  const initialStart = scenario.kind === 'preview' ? scenario.fromSeconds : 0
  const initialEnd = scenario.kind === 'preview' ? scenario.toSeconds : DURATION_SECONDS
  const playheadSeconds = scenario.kind === 'preview' ? scenario.atSeconds : initialStart
  const timeline = React.useMemo(() => makeTimeline(title, initialStart, initialEnd, playheadSeconds), [initialEnd, initialStart, playheadSeconds, title])
  const live = useLiveTrim(rootRef, { start: Math.round(initialStart * FPS), end: Math.round(initialEnd * FPS) })
  useHoldInHandleDrag(rootRef, scenario.kind === 'drag-in' ? Math.round(scenario.dragToSeconds * FPS) : null)

  const inSeconds = live.start / FPS
  const outSeconds = live.end / FPS
  const playing = scenario.kind === 'preview'
  // 预览画面：预览中停在播放头；拖入点时跟着入点；其余停在入点。
  const previewAt = playing ? scenario.atSeconds : inSeconds
  const chipSeconds = live.resizing === 'right' ? outSeconds : playing ? scenario.atSeconds : inSeconds

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={c.trimTitle}
      data-vn-clip-panel
      className="flex flex-col gap-3 rounded-nomi border border-nomi-line bg-nomi-paper p-3 shadow-nomi-lg"
      style={{ width: CLIP_PANEL_WIDTH }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-body font-medium text-nomi-ink">{c.trimTitle}</div>
        <WorkbenchIconButton label={c.close} icon={<IconX size={16} stroke={1.8} />} onClick={noop} />
      </div>

      <div className="relative aspect-video overflow-hidden rounded-nomi-sm bg-nomi-ink-05 ring-1 ring-inset ring-nomi-line">
        <PausedVideo at={previewAt} controls={false} className="h-full w-full object-contain" />
        <span className="pointer-events-none absolute bottom-2 right-2 rounded-nomi-sm bg-nomi-paper/[0.82] px-2 py-[3px] font-mono text-micro tabular-nums text-nomi-ink-80 backdrop-blur-[8px]">
          {timecode(chipSeconds)}
        </span>
      </div>

      <ClipNodeTimeline
        timeline={timeline}
        canvasZoom={1}
        selectedClipId={CLIP_ID}
        onSelectClip={noop}
        onMoveClip={noop}
        onResizeClip={(clipId, edge, deltaFrame) => { resizeClipEdge(timeline, clipId, edge, deltaFrame) }}
      />

      <DecisionBar
        size="md"
        cancelLabel={c.cancel}
        onCancel={noop}
        primaryLabel={c.confirm}
        onPrimary={noop}
        leading={(
          <div className="flex min-w-0 items-center gap-3">
            <WorkbenchIconButton
              label={playing ? c.pause : c.play}
              icon={playing ? <IconPlayerPause size={16} stroke={1.8} /> : <IconPlayerPlay size={16} stroke={1.8} />}
              onClick={noop}
            />
            <Readout label={c.tcIn} value={timecode(inSeconds)} active={live.resizing === 'left'} />
            <Readout label={c.tcOut} value={timecode(outSeconds)} active={live.resizing === 'right'} />
            <Readout label={c.keep} value={`${(outSeconds - inSeconds).toFixed(1)}s`} />
          </div>
        )}
      />
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

// ── 取景台：选中的视频卡 + 浮条（「剪辑」亮着）+ 贴着卡下沿的面板 ─────────────────────────────

/** 面板贴着卡的下沿、水平居中；像浮条一样反向缩放，缩小画布时仍是屏幕上的原尺寸。 */
function PanelAnchor({ zoom, children }: { zoom: number; children: React.ReactNode }): JSX.Element {
  return (
    <div
      className="absolute z-[20]"
      style={{ left: '50%', top: `calc(100% + ${14 / zoom}px)`, transform: `translateX(-50%) scale(${1 / zoom})`, transformOrigin: 'top center' }}
    >
      {children}
    </div>
  )
}

export function ClipStage({ locale, scenario, zoom = 1 }: { locale: VnLocale; scenario: ClipScenario; zoom?: number }): JSX.Element {
  const node = React.useMemo(() => videoSourceNode(locale), [locale])
  const seeded = useSeededSource(node)
  const localeReady = useLocaleHold(locale)
  const ready = seeded && localeReady
  useMountHold(ready)
  const left = Math.round((VN_CELL_WIDTH - VN_CARD.width * zoom) / 2)
  return (
    <LabStage height={CLIP_STAGE_HEIGHT} zoom={zoom}>
      {ready ? (
        <VideoCard
          left={left}
          top={zoom < 1 ? 150 : 110}
          zoom={zoom}
          title={node.title}
          toolbar={<NextVideoToolbar node={node} locale={locale} trimActive />}
          below={<PanelAnchor zoom={zoom}><ClipPanel locale={locale} scenario={scenario} title={node.title} /></PanelAnchor>}
        />
      ) : null}
    </LabStage>
  )
}

export const CLIP_STAGE_HEIGHT = 860
