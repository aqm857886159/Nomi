// 设计实验室 · 屏「视频节点的下一步」· 浮条与取景台（骨架卡 + 生产浮条积木）。
//
// 浮条这一排用的全是生产积木：外壳 `FloatingToolbarShell`、下拉 `ToolbarActionMenu`（→ `WorkbenchMenu`）、
// 按钮 `ToolbarButton` / `ToolbarIconButton`、分隔 `ToolbarDivider`，右半段的「提取深度」是生产的 `NodeDepthActionButton`。
// 新的只有**哪几颗钮、排什么顺序**：「抽帧▾」改名「截帧▾」并多一项「当前帧」，「剪辑」是新钮。
//
// 唯一的占位是**节点卡本身**（同 `videoDepth/videoDepthLabKit.tsx`、`nodeQuickActions/…LabKit.tsx` 的理由：真卡会把
// 现役浮条一起渲出来，没法把新浮条挂上去）。外壳类名与现役卡逐字相同；里面是一个真 `<video>`，所以播放头是真的。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconCut, IconDownload, IconFocusCentered, IconLayoutRows, IconMaximize, IconPhoto, IconPlayerTrackNext, IconPlayerTrackPrev, IconTable } from '@tabler/icons-react'
import { LabCanvasViewport } from '../labCanvasViewport'
import '../../../workbench/generationCanvas/styles/generationCanvas.css'
import {
  FloatingToolbarShell,
  TOOLBAR_ICON as I,
  ToolbarButton,
  ToolbarDivider,
  ToolbarDuplicateVariantButton,
  ToolbarIconButton,
  ToolbarProvenanceButton,
} from '../../../workbench/generationCanvas/nodes/NodeFloatingToolbar'
import { ToolbarActionMenu } from '../../../workbench/generationCanvas/nodes/ToolbarActionMenu'
import NodeDepthActionButton from '../../../workbench/generationCanvas/videoDepth/NodeDepthActionButton'
import type { WorkbenchMenuIcon } from '../../../design/menu'
import type { GenerationCanvasNode } from '../../../workbench/generationCanvas/model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../../workbench/generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../../../workbench/workbenchStore'
import { cn } from '../../../utils/cn'
import { holdDesignLabReady } from '../labReadyHold'
import { installCatalogBridge } from '../nodeComposerBar/nodeComposerBarLabKit'
import { useLabLocale } from '../versionCards/versionCardsFlowLabKit'
import { COPY, timecode, type VnLocale } from './videoNodeNextCopy'
import { PLAYHEAD_SECONDS, VIDEO } from './videoNodeNextFixtures'

export const VN_CARD = { width: 340, height: 191 } as const
export const VN_CELL_WIDTH = 980
export const VN_CELL_HEIGHT = 760
const noop = (): void => undefined

export function videoSourceNode(locale: VnLocale): GenerationCanvasNode {
  return {
    id: 'vn-source',
    kind: 'video',
    title: COPY[locale].sourceTitle,
    categoryId: 'shots',
    position: { x: 0, y: 0 },
    size: { ...VN_CARD },
    status: 'success',
    meta: { videoWidth: 640, videoHeight: 360, videoAspectRatio: 16 / 9, modelKey: 'seedance-2', modelVendor: 'apimart' },
    result: { id: 'vn-source-r', type: 'video', url: VIDEO, createdAt: 1 },
  } as GenerationCanvasNode
}

// ── 浮条 ─────────────────────────────────────────────────────────────────────

export function NextVideoToolbar({ node, locale, playheadSeconds = PLAYHEAD_SECONDS, onTrim = noop, trimActive = false }: { node: GenerationCanvasNode; locale: VnLocale; playheadSeconds?: number; onTrim?: () => void; trimActive?: boolean }): JSX.Element {
  const { t } = useTranslation()
  const c = COPY[locale]
  return (
    <FloatingToolbarShell ariaLabel={t('generationCommon.videoToolbar.aria')} lockNodeId={node.id}>
      <ToolbarActionMenu
        id="capture-frame"
        icon={<IconPhoto size={I.size} stroke={I.stroke} />}
        label={t('generationCommon.videoToolbar.captureFrame')}
        menuLabel={t('generationCommon.videoToolbar.captureFrame')}
        items={[
          { id: 'capture-current', icon: IconFocusCentered as WorkbenchMenuIcon, label: t('generationCommon.videoToolbar.currentFrame'), shortcut: timecode(playheadSeconds), onSelect: noop },
          { id: 'capture-first', icon: IconPlayerTrackPrev as WorkbenchMenuIcon, label: t('generationCommon.videoToolbar.firstFrame'), onSelect: noop },
          { id: 'capture-last', icon: IconPlayerTrackNext as WorkbenchMenuIcon, label: t('generationCommon.videoToolbar.lastFrame'), onSelect: noop },
        ]}
      />
      <ToolbarButton icon={<IconCut size={I.size} stroke={I.stroke} />} label={c.trim} actionId="trim" accent={trimActive} onClick={onTrim} />
      <ToolbarActionMenu
        id="break-down"
        icon={<IconLayoutRows size={I.size} stroke={I.stroke} />}
        label={t('generationCommon.videoToolbar.breakDown')}
        menuLabel={t('generationCommon.videoToolbar.breakDown')}
        items={[
          { id: 'shot-cuts', icon: IconLayoutRows as WorkbenchMenuIcon, label: t('generationCommon.videoToolbar.shotCuts'), onSelect: noop },
          { id: 'shot-table', icon: IconTable as WorkbenchMenuIcon, label: t('generationCommon.videoToolbar.shotTable'), onSelect: noop },
        ]}
      />
      <NodeDepthActionButton reportFeedback={noop} node={node} />
      <ToolbarDuplicateVariantButton nodeId={node.id} />
      <ToolbarDivider />
      <ToolbarIconButton icon={<IconMaximize size={I.size} stroke={I.stroke} />} title={t('generationCommon.videoToolbar.fullscreen')} ariaLabel={t('generationCommon.videoToolbar.fullscreenAria')} onClick={noop} />
      <ToolbarIconButton icon={<IconDownload size={I.size} stroke={I.stroke} />} ariaLabel={t('generationCommon.imageToolbar.download')} title={t('generationCommon.imageToolbar.downloadHint')} onClick={noop} />
      <ToolbarProvenanceButton onOpen={noop} />
    </FloatingToolbarShell>
  )
}

// ── 视频卡（骨架外壳 + 真 <video>）───────────────────────────────────────────────

/**
 * 真 <video>：停在 `at` 秒。seeked 且数据够播（readyState ≥ 3）之后再多握 1.5 秒才放行：Chromium 原生控件在 seek 之后会画一圈
 * 「缓冲」转圈，实测要到 seeked 后一秒多才收（readyState 早就是 4）；这个转圈没有事件可等，只能等它自己收。
 * 不带原生控件的那个（剪辑面板里的预览）没有转圈，不必等——`controls={false}` 时直接放行。
 */
export function PausedVideo({ at, className, controls = true, muted = true }: { at: number; className?: string; controls?: boolean; muted?: boolean }): JSX.Element {
  const ref = React.useRef<HTMLVideoElement>(null)
  // 持有必须在提交当帧登记（layout effect）：放到 passive effect 里，就绪旗的探测可能先于登记举起来。
  React.useLayoutEffect(() => {
    const video = ref.current
    if (!video) return undefined
    const release = holdDesignLabReady('video-node-next:seek')
    let frame = 0
    let settleTimer = 0
    let seeked = false
    const settle = (): void => {
      if (!seeked || video.seeking || video.readyState < 3) return
      if (!controls) { frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => release()) }); return }
      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(release, 1500)
    }
    const onSeeked = (): void => { seeked = true; settle() }
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('canplay', settle)
    const seek = (): void => { video.currentTime = at }
    if (video.readyState >= 1) seek()
    else video.addEventListener('loadedmetadata', seek, { once: true })
    const timer = window.setTimeout(release, 12000)
    return () => {
      window.clearTimeout(timer)
      window.clearTimeout(settleTimer)
      cancelAnimationFrame(frame)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('canplay', settle)
      release()
    }
  }, [at, controls])
  return <video ref={ref} src={VIDEO} className={className} controls={controls} muted={muted} playsInline preload="auto" />
}

export function VideoCard({ title, at = PLAYHEAD_SECONDS, selected = true, toolbar, below, zoom = 1, left, top }: {
  title: string
  at?: number
  selected?: boolean
  toolbar?: React.ReactNode
  /** 贴着卡下沿弹出的东西（剪辑面板）；放在卡的定位祖先里才能跟着卡走。 */
  below?: React.ReactNode
  zoom?: number
  left: number
  top: number
}): JSX.Element {
  return (
    <div
      className="group/node absolute"
      style={{ left, top, width: VN_CARD.width, height: VN_CARD.height, ...(zoom !== 1 ? { transform: `scale(${zoom})`, transformOrigin: 'top left' } : {}) }}
      data-vn-source-card
    >
      {toolbar}
      <div className={cn('generation-canvas-v2-node__preview', 'relative h-full w-full overflow-hidden rounded-nomi shadow-nomi-md ring-1 ring-inset', selected ? 'ring-nomi-accent' : 'ring-nomi-line', 'bg-nomi-ink-05')}>
        <PausedVideo at={at} className="h-full w-full object-contain bg-nomi-ink-05" />
      </div>
      <span className="pointer-events-none absolute left-[10px] top-[10px] z-[3] rounded-nomi-sm bg-nomi-paper/[0.82] px-2 py-[3px] text-micro font-medium text-nomi-ink-80 backdrop-blur-[8px]">{title}</span>
      {below}
    </div>
  )
}

// ── 取景台 ────────────────────────────────────────────────────────────────────

export function LabStage({ width = VN_CELL_WIDTH, height = VN_CELL_HEIGHT, zoom = 1, children }: { width?: number; height?: number; zoom?: number; children: React.ReactNode }): JSX.Element {
  return (
    <div data-design-lab-stage="video-node-next" className="workbench-generation__canvas relative overflow-hidden rounded-nomi border border-nomi-line" style={{ width, height }}>
      {/* 真画布的舞台类：点阵底色 + 浮条「左右夹住、太窄就折行」的测量都认它。 */}
      <div className="generation-canvas-v2__stage group/canvas"><LabCanvasViewport zoom={zoom}>{children}</LabCanvasViewport></div>
    </div>
  )
}

/**
 * 就绪旗的探测只在首次提交的 passive effect 里看一眼持有数（`designLab.tsx` 的 markReady）；而这几个格子的内容要等
 * 种 store 的那次同步重渲才挂上（挂上去的 <video> / 菜单才会登记自己的持有），登记晚于那一眼就等于没登记。
 * 所以格子在**首次提交**就先握一把，等内容挂上（`ready`）之后的 passive effect 再放——那时子孙的持有早已登记。
 */
export function useMountHold(ready: boolean): void {
  const releaseRef = React.useRef<(() => void) | null>(null)
  React.useLayoutEffect(() => {
    releaseRef.current = holdDesignLabReady('video-node-next:stage')
    return () => { releaseRef.current?.(); releaseRef.current = null }
  }, [])
  React.useEffect(() => {
    if (!ready) return
    releaseRef.current?.()
    releaseRef.current = null
  }, [ready])
}

/** 种进 store：浮条里的「复制」钮读 store。 */
export function useSeededSource(node: GenerationCanvasNode): boolean {
  const [ready, setReady] = React.useState(false)
  React.useLayoutEffect(() => {
    installCatalogBridge()
    useWorkbenchStore.setState({ activeCategoryId: 'shots' })
    useGenerationCanvasStore.setState({ nodes: [node], edges: [], selectedNodeIds: [node.id] })
    setReady(true)
  }, [node])
  return ready
}

export function useLocaleHold(locale: VnLocale): boolean {
  return useLabLocale(locale)
}

/** 像用户一样点开浮条上某颗下拉（真实 click）；开出来再举旗。 */
export function useOpenToolbarMenu(rootRef: React.RefObject<HTMLElement | null>, id: string | undefined, enabled: boolean): void {
  React.useLayoutEffect(() => {
    if (!id || !enabled) return undefined
    const release = holdDesignLabReady(`video-node-next:menu:${id}`)
    let frame = 0
    let tries = 0
    const tick = (): void => {
      const trigger = rootRef.current?.querySelector<HTMLButtonElement>(`[data-toolbar-action-menu="${id}"]`)
      if (trigger && trigger.getAttribute('aria-expanded') !== 'true') trigger.click()
      tries += 1
      if (document.querySelector(`[data-testid="toolbar-action-menu-${id}"]`)) { frame = requestAnimationFrame(() => release()); return }
      if (tries > 120) { release(); return }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame); release() }
  }, [enabled, id, rootRef])
}

/** 格 1 / 格 12：选中视频卡 + 新浮条（可选点开某颗下拉）。`zoom` < 1 = 缩小画布。 */
export function ToolbarStage({ locale, open, zoom = 1 }: { locale: VnLocale; open?: 'capture-frame' | 'break-down'; zoom?: number }): JSX.Element {
  const node = React.useMemo(() => videoSourceNode(locale), [locale])
  const seeded = useSeededSource(node)
  const localeReady = useLocaleHold(locale)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const ready = seeded && localeReady
  useMountHold(ready)
  useOpenToolbarMenu(rootRef, open, ready)
  const left = Math.round((VN_CELL_WIDTH - VN_CARD.width * zoom) / 2)
  return (
    <LabStage zoom={zoom} height={zoom < 1 ? 450 : 520}>
      <div ref={rootRef}>
        {ready ? <VideoCard left={left} top={290} zoom={zoom} title={node.title} toolbar={<NextVideoToolbar node={node} locale={locale} />} /> : null}
      </div>
    </LabStage>
  )
}
