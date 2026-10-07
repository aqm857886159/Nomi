// 版本卡片（原地铺开成宫格）的两块界面：
// - NodeVersionCountBadge：图片右上角内侧的数字角标**就是入口**（用户 2026-10-07 拍板，替换节点身后的叠卡）。
//   点它铺开，铺开时角标是按下态；再点它（或按 Esc）收起。
// - NodeVersionGrid：铺开的宫格。每张卡就是那一版的画面本身，和节点一样大、一样的圆角 / 描边 / 阴影，
//   不加标题条；版本号是角上的小字，主图带「✓ 主图」（✓ 只表示状态）；悬停才出动作条；点卡 = 预览；
//   视频卡悬停播放、拖底边进度；按着 Alt/⌥ 拖一张出去 = 复制成独立素材卡；不按 Alt 拖 = 拖整组（交给画布内核）。
//
// 几何只来自 versionGridLayout.ts（纯函数），这里不量 DOM。数据（哪几版、谁是主图）由宿主
// NodeVersionCardsHost 从 model/nodeResultLifecycle.ts 读，这里不拼版本列表。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconCheck, IconDownload, IconLoader2, IconMovie, IconTrash } from '../../../../vendor/tablerIcons'
import { cn } from '../../../../utils/cn'
import { DeferredNodeVideo } from '../DeferredNodeMedia'
import { historyVideoTimeFromPointer, nudgeHistoryVideoTime } from '../historyVideoScrub'
import type { VersionGridLayout } from './versionGridLayout'

export type VersionCardEntry = Readonly<{
  identity: string
  versionNo: number
  type: 'image' | 'video'
  /** 画布上挂的预览图（视频是封面；没有封面就是空串）。 */
  previewUrl: string
  /** 原始地址（视频卡悬停播放、Alt 拖出复制用）。 */
  url?: string
}>

/** 按下到松开移动超过这么多屏幕像素，就是一次拖动（拖整组）而不是点卡预览。 */
const CLICK_SLOP_PX = 4

/**
 * 版本入口 = 图片右上角内侧的数字角标（用户 2026-10-07 拍板）。只写数字，不加图标、不写「版」字；只有 1 版时没有。
 * 位置：左右正中是连线把手，上方是标题和选中浮条，下方是提示词框——图片右上角内侧都不冲突。
 * 点它原地铺开宫格；铺开时角标变成按下态，再点它或按 Esc 收起。只读画布只显示数字、不能点开。
 */
export function NodeVersionCountBadge({
  count,
  expanded,
  readOnly = false,
  onToggle,
}: {
  count: number
  expanded: boolean
  readOnly?: boolean
  onToggle: () => void
}): JSX.Element | null {
  const { t } = useTranslation()
  if (count < 2) return null
  const label = expanded ? t('generationCommon.versionCards.collapseAria') : t('generationCommon.versionCards.expandAria', { count })
  const look = cn(
    'absolute right-2 top-2 z-[4] inline-flex h-5 min-w-5 items-center justify-center rounded-pill border px-1.5',
    'text-micro font-semibold leading-none tabular-nums shadow-nomi-sm',
    // 压在画面上的东西用不随明暗翻转的媒体色（白底深字），暗色主题里也是同一枚浅色角标——和卡上「第 N 版」小字同一条规矩。
    expanded ? 'border-nomi-accent bg-nomi-accent text-nomi-media-ink' : 'border-nomi-overlay-chip/25 bg-nomi-media-ink/[0.88] text-nomi-overlay-chip-strong',
  )
  if (readOnly && !expanded) {
    return <span className={look} data-version-badge aria-label={label}>{count}</span>
  }
  return (
    <button
      type="button"
      // nodrag / no-pan：画布内核拖节点是节点元素上的原生 mousedown，只认这两个类；点角标不该拖动节点。
      className={cn(look, 'nodrag generation-canvas-react-flow__no-pan pointer-events-auto cursor-pointer transition-colors duration-nomi-fast ease-nomi-fast', !expanded && 'hover:bg-nomi-media-ink', 'focus-visible:outline-2 focus-visible:outline-nomi-accent focus-visible:outline-offset-1')}
      aria-label={label}
      aria-pressed={expanded}
      title={label}
      data-version-badge
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => { if (event.key === 'Escape' && expanded) { event.stopPropagation(); onToggle() } }}
      onClick={(event) => { event.stopPropagation(); onToggle() }}
    >
      {count}
    </button>
  )
}

function CardShell({ children, className }: { children: React.ReactNode; className?: string }): JSX.Element {
  // 与节点预览同一套外壳（BaseGenerationNode 的 generation-canvas-v2-node__preview）：卡长得就是节点。
  return <div className={cn('relative h-full w-full overflow-hidden rounded-nomi shadow-nomi-md ring-1 ring-inset ring-nomi-line bg-nomi-ink-05', className)}>{children}</div>
}

/**
 * 悬停条。UI 统一的两条（用户 2026-10-06）：
 * - 「✓」只表示**状态**（卡角的「✓ 主图」），不当动作图标：「设为主图」是纯文字按钮；
 * - 常用的在前，**删除永远在最右**、用分隔线和前面隔开。
 */
function VersionCardBar({ versionNo, primary, readOnly, onSetPrimary, onDownload, onDelete }: {
  versionNo: number
  primary: boolean
  readOnly: boolean
  onSetPrimary?: () => void
  onDownload?: () => void
  onDelete?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const button = 'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-nomi-sm border-0 bg-transparent text-body-sm leading-none whitespace-nowrap cursor-pointer transition-colors duration-nomi-fast ease-nomi-fast'
  return (
    <div
      role="toolbar"
      aria-label={t('generationCommon.versionCards.barAria', { n: versionNo })}
      data-version-card-bar
      // 拖动画布 / 拖整组时动作条跟其它浮层一起隐身（同一面画布级拖动旗）；卡片本身是组的一部分，照样跟着走。
      className="nodrag generation-canvas-react-flow__no-pan pointer-events-auto absolute bottom-[calc(100%+6px)] left-1/2 z-[2] inline-flex -translate-x-1/2 items-center gap-1 rounded-nomi border border-nomi-line bg-nomi-paper px-1.5 py-1 shadow-nomi-md group-data-[dragging=true]/canvas:invisible"
      onPointerDown={(event) => event.stopPropagation()}
      // 点动作不选中节点：选中会浮出生成框、正好压住下面一排版本卡（和点卡片预览同一条）。
      onClick={(event) => event.stopPropagation()}
    >
      {!primary && !readOnly ? (
        <button type="button" data-version-action="set-primary" className={cn(button, 'px-3 font-medium text-nomi-accent hover:bg-nomi-accent-soft')} onClick={onSetPrimary}>
          {t('generationCommon.versionCards.setPrimary')}
        </button>
      ) : null}
      <button type="button" data-version-action="download" className={cn(button, 'w-8 text-nomi-ink-80 hover:bg-nomi-ink-05')} aria-label={t('generationCommon.versionCards.download')} title={t('generationCommon.versionCards.download')} onClick={onDownload}>
        <IconDownload size={16} stroke={1.6} aria-hidden="true" />
      </button>
      {!readOnly ? (
        <>
          <span className="mx-0.5 h-4 w-px bg-nomi-line" aria-hidden="true" />
          <button type="button" data-version-action="delete" className={cn(button, 'w-8 text-nomi-ink-80 hover:bg-nomi-danger-soft hover:text-nomi-danger')} aria-label={t('generationCommon.versionCards.delete')} title={t('generationCommon.versionCards.delete')} onClick={onDelete}>
            <IconTrash size={16} stroke={1.6} aria-hidden="true" />
          </button>
        </>
      ) : null}
    </div>
  )
}

/** 视频卡：悬停就播（静音循环），底边是进度条，可拖、聚焦后 ← → 一次 1 秒。移开复位。 */
function VersionVideoMedia({ entry, active }: { entry: VersionCardEntry; active: boolean }): JSX.Element {
  const { t } = useTranslation()
  const hostRef = React.useRef<HTMLSpanElement | null>(null)
  const draggingPointerRef = React.useRef<number | null>(null)
  const [mounted, setMounted] = React.useState(false)
  const [duration, setDuration] = React.useState(0)
  const [currentTime, setCurrentTime] = React.useState(0)
  const video = (): HTMLVideoElement | null => hostRef.current?.querySelector('video') ?? null
  React.useEffect(() => { if (active) setMounted(true) }, [active])
  React.useEffect(() => {
    const media = video()
    if (!media) return
    if (active) { void media.play().catch(() => undefined); return }
    media.pause()
    media.currentTime = 0
    setCurrentTime(0)
  }, [active, mounted])
  const seek = (event: React.PointerEvent<HTMLDivElement>): void => {
    const media = video()
    if (!media) return
    const time = historyVideoTimeFromPointer(event.clientX, event.currentTarget.getBoundingClientRect(), media.duration)
    if (time == null) return
    media.currentTime = time
    setCurrentTime(time)
  }
  const progress = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0
  return (
    <span ref={hostRef} className="absolute inset-0 block" data-version-video-active={active ? 'true' : undefined}>
      {mounted && entry.url ? (
        <DeferredNodeVideo
          src={entry.url}
          className={cn('h-full w-full object-contain', !active && 'hidden')}
          muted
          loop
          autoPlay={active}
          playsInline
          preload="metadata"
          aria-hidden={!active}
          onLoadedMetadata={(event) => { setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0); setCurrentTime(event.currentTarget.currentTime) }}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        />
      ) : null}
      {!active || !mounted ? (
        entry.previewUrl
          ? <img src={entry.previewUrl} alt="" draggable={false} className="h-full w-full object-contain" />
          : <span className="grid h-full w-full place-items-center text-nomi-ink-40" aria-hidden="true"><IconMovie size={22} stroke={1.5} /></span>
      ) : null}
      <div
        className={cn(
          // nodrag / no-pan：画布内核的拖节点是挂在节点元素上的原生 mousedown，React 的 stopPropagation 截不住；
          // 不标这两个类，拖进度条会同时拖动整个节点，画布停在「拖动中」、之后的点击都被吞（10-06 真画布实测）。
          'nodrag generation-canvas-react-flow__no-pan absolute bottom-0 left-0 right-0 z-[3] h-4 cursor-ew-resize px-1.5 pb-1 pt-2 transition-opacity duration-150',
          active ? 'opacity-100' : 'pointer-events-none opacity-0',
          'focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-nomi-accent focus-visible:outline-offset-1',
        )}
        role="slider"
        tabIndex={0}
        aria-label={t('generationCommon.versionCards.videoProgress')}
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={currentTime}
        aria-valuetext={t('generationCommon.versionCards.videoProgressValue', { current: Math.round(currentTime), duration: Math.round(duration) })}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
          event.currentTarget.focus()
          draggingPointerRef.current = event.pointerId
          event.currentTarget.setPointerCapture?.(event.pointerId)
          seek(event)
        }}
        onPointerMove={(event) => { if (draggingPointerRef.current === event.pointerId) { event.stopPropagation(); seek(event) } }}
        onPointerUp={(event) => {
          if (draggingPointerRef.current !== event.pointerId) return
          event.stopPropagation()
          seek(event)
          draggingPointerRef.current = null
          if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={(event) => { if (draggingPointerRef.current === event.pointerId) draggingPointerRef.current = null }}
        onKeyDown={(event) => {
          const media = video()
          if (!media) return
          const time = nudgeHistoryVideoTime(media.currentTime, event.key, media.duration)
          if (time == null) return
          event.preventDefault()
          event.stopPropagation()
          media.currentTime = time
          setCurrentTime(time)
        }}
      >
        <span className="block h-1 overflow-hidden rounded-pill bg-nomi-paper/50 shadow-nomi-sm" aria-hidden="true">
          <span className="block h-full rounded-pill bg-nomi-paper" style={{ width: `${progress * 100}%` }} />
        </span>
      </div>
    </span>
  )
}

export type NodeVersionGridProps = {
  nodeId: string
  layout: VersionGridLayout<VersionCardEntry>
  node: Readonly<{ width: number; height: number }>
  primaryIdentity: string
  readOnly?: boolean
  /** 按着 Alt/⌥：这一刻拖版本卡是「复制出去」而不是拖整组。 */
  altHeld?: boolean
  /** 悬停中的那一版（它和它的动作条浮到最上层）；实验室用它钉住悬停态。 */
  hoveredIdentity?: string
  onHoverChange?: (identity: string) => void
  onPreview?: (entry: VersionCardEntry) => void
  onSetPrimary?: (entry: VersionCardEntry) => void
  onDownload?: (entry: VersionCardEntry) => void
  onDelete?: (entry: VersionCardEntry) => void
  onShowAll?: () => void
  onCopyDragStart?: (event: React.DragEvent<HTMLElement>, entry: VersionCardEntry) => void
  onEscape?: () => void
}

export function NodeVersionGrid({
  nodeId, layout, node, primaryIdentity, readOnly = false, altHeld = false, hoveredIdentity,
  onHoverChange, onPreview, onSetPrimary, onDownload, onDelete, onShowAll, onCopyDragStart, onEscape,
}: NodeVersionGridProps): JSX.Element {
  const { t } = useTranslation()
  const pressRef = React.useRef<{ x: number; y: number } | null>(null)
  return (
    <div
      // 外框就是整块宫格占的地方（相对节点左上角）：量得到、看得见；格子按外框内的坐标摆。
      className="pointer-events-none absolute"
      style={{ left: layout.bounds.x, top: layout.bounds.y, width: layout.bounds.width, height: layout.bounds.height }}
      data-version-grid={nodeId}
      data-version-grid-columns={layout.columns}
      data-version-grid-placement={layout.bounds.x < 0 ? 'left' : 'right'}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onEscape?.() } }}
    >
      {layout.cells.map((cell) => {
        const style: React.CSSProperties = { left: cell.x - layout.bounds.x, top: cell.y - layout.bounds.y, width: node.width, height: node.height }
        if (cell.kind === 'pending') {
          return (
            <div key="pending" className="absolute" style={style} data-version-card="pending">
              <CardShell className="grid place-items-center bg-nomi-ink-05">
                <span className="flex flex-col items-center gap-1 text-caption text-nomi-ink-60" role="status">
                  <IconLoader2 size={18} stroke={1.6} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  <b className="font-semibold text-nomi-ink-80">{t('generationCommon.versionCards.pending')}</b>
                  <span className="text-micro">{t('generationCommon.versionCards.pendingCaption')}</span>
                </span>
              </CardShell>
            </div>
          )
        }
        if (cell.kind === 'more') {
          const peek = cell.hidden.slice(0, 3)
          return (
            <div key="more" className="absolute" style={style} data-version-card="more">
              <button
                type="button"
                className="nodrag generation-canvas-react-flow__no-pan pointer-events-auto block h-full w-full cursor-pointer rounded-nomi border border-dashed border-nomi-ink-20 bg-nomi-ink-05 p-0 text-nomi-ink-80 hover:border-nomi-ink-40"
                aria-label={t('generationCommon.versionCards.moreAria', { count: cell.hidden.length })}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => { event.stopPropagation(); onShowAll?.() }}
              >
                <span className="relative mx-auto mb-2 block h-[44%] w-[56%]">
                  {peek.map((entry, peekIndex) => (
                    entry.previewUrl ? (
                      <img
                        key={entry.identity}
                        src={entry.previewUrl}
                        alt=""
                        draggable={false}
                        className="absolute inset-0 h-full w-full rounded-nomi-sm object-cover shadow-nomi-sm ring-1 ring-nomi-line"
                        style={{ transform: `translate(${(peekIndex - 1) * 10}px, ${(1 - peekIndex) * 4}px) rotate(${(peekIndex - 1) * 3}deg)`, zIndex: 3 - peekIndex }}
                      />
                    ) : null
                  ))}
                </span>
                <span className="block text-title font-semibold tabular-nums">{t('generationCommon.versionCards.moreCount', { count: cell.hidden.length })}</span>
                <span className="block text-micro text-nomi-ink-60">{t('generationCommon.versionCards.moreCaption', { count: cell.hidden.length })}</span>
              </button>
            </div>
          )
        }
        const entry = cell.version
        const primary = entry.identity === primaryIdentity
        const hovered = entry.identity === hoveredIdentity
        return (
          <div
            key={entry.identity}
            // 悬停的那一张连同动作条浮到最上层：压过节点自己的浮条（z-12），不被它盖住（10-06 对账页 §1 第 5 条）。
            className={cn('absolute', hovered ? 'z-[13]' : 'z-[1]')}
            style={style}
            data-version-card={entry.versionNo}
            data-version-identity={entry.identity}
            data-primary={primary ? 'true' : undefined}
            draggable={altHeld && !readOnly && Boolean(entry.url)}
            onDragStart={(event) => onCopyDragStart?.(event, entry)}
            onPointerEnter={() => onHoverChange?.(entry.identity)}
            onPointerLeave={() => onHoverChange?.('')}
            onFocusCapture={() => onHoverChange?.(entry.identity)}
          >
            {hovered ? (
              <VersionCardBar
                versionNo={entry.versionNo}
                primary={primary}
                readOnly={readOnly}
                onSetPrimary={() => onSetPrimary?.(entry)}
                onDownload={() => onDownload?.(entry)}
                onDelete={() => onDelete?.(entry)}
              />
            ) : null}
            <button
              type="button"
              className="pointer-events-auto block h-full w-full cursor-pointer border-0 bg-transparent p-0"
              aria-label={t('generationCommon.versionCards.previewAria', { n: entry.versionNo })}
              // 不拦 pointerdown：按住拖就是拖整组（画布内核拖节点，卡跟着走）。只有没怎么动的那一下才是「点卡预览」。
              onPointerDown={(event) => { pressRef.current = { x: event.clientX, y: event.clientY } }}
              onClick={(event) => {
                const press = pressRef.current
                pressRef.current = null
                if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_SLOP_PX) return
                event.stopPropagation()
                onPreview?.(entry)
              }}
            >
              <CardShell className={hovered ? 'ring-nomi-ink-20' : undefined}>
                {entry.type === 'video'
                  ? <VersionVideoMedia entry={entry} active={hovered} />
                  : <img src={entry.previewUrl} alt="" draggable={false} className="h-full w-full object-contain" />}
                <span className={cn('absolute rounded-pill bg-nomi-overlay-chip px-1.5 py-0.5 text-micro font-semibold tabular-nums text-nomi-media-ink', entry.type === 'video' ? 'right-1.5 top-1.5' : 'bottom-1.5 left-1.5')} data-version-card-number>
                  {node.width < 200 ? t('generationCommon.versionCards.versionTiny', { n: entry.versionNo }) : t('generationCommon.versionCards.versionShort', { n: entry.versionNo })}
                </span>
                {primary ? (
                  <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-pill bg-nomi-accent px-1.5 py-0.5 text-micro font-semibold text-nomi-paper" data-version-card-primary>
                    <IconCheck size={11} stroke={2.2} aria-hidden="true" />
                    {t('generationCommon.versionCards.primary')}
                  </span>
                ) : null}
              </CardShell>
            </button>
          </div>
        )
      })}
    </div>
  )
}
