import { nodeHasResultStack, productionMetaOf } from './useNodeResultHistory'
import { notify } from '../../../ui/notificationPolicy'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconCheck,
  IconDownload,
  IconEye,
  IconMovie,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '../../../utils/cn'
import { confirmDialog } from '../../../design'
import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import { listStableNodeMediaResults, resultIdentity } from '../model/nodeResultLifecycle'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { canvasNodeToAssetRefs } from '../../assets/assetTypes'
import { deleteAssetResult } from '../../assets/deleteAssetResult'
import { CardStackPeeks } from '../components/CardStackPeeks'
import NodeMediaPreviewDialog from './NodeMediaPreviewDialog'
import { DeferredNodeVideo } from './DeferredNodeMedia'
import { NODE_SCROLL_REGION_CLASS_NAME } from './nodeScrollRegionClassName'
import { useResultDownload } from './useResultDownload'
import { isProjectExecutionContextCurrent, withProjectAction } from '../../project/projectCanvasReadSurface'
import { reworkProductionShot } from '../../production/productionShotActions'
import { historyVideoTimeFromPointer, nudgeHistoryVideoTime } from './historyVideoScrub'
import { resolveResultStackPlacement, type ResultStackPlacement } from './nodeResultStackPlacement'
import { getGenerationNodeIcon } from './renderRegistry'
import { CANVAS_RESULT_DRAG_MIME, encodeCanvasResultDrag } from '../components/canvasResultDrag'
import { logRendererError } from '../../../desktop/rendererLog'

const INITIAL_VISIBLE_RESULTS = 12

/**
 * 版本堆叠伪卡上的媒体示能。复用 `getGenerationNodeIcon` 这个唯一出口，所以
 * 「左侧栏那颗图标和堆叠上这颗不是同一个」在结构上不可能发生（同 renderRegistry 的注释）。
 * 插件节点解析不到就不画——宁可回到原外观，也不猜一个错的媒体类型。
 */
function StackMediaGlyph({ kind }: { kind: GenerationCanvasNode['kind'] }): JSX.Element | null {
  const Icon = React.useMemo(() => {
    try {
      return getGenerationNodeIcon(kind)
    } catch {
      return null
    }
  }, [kind])
  if (!Icon) return null
  return <Icon size={14} stroke={1.6} aria-hidden="true" />
}

function resultTitle(node: GenerationCanvasNode, index: number): string {
  return `${node.title || ''} · ${index + 1}`
}

function HistoryVideoThumb({
  result,
  title,
  active,
  disabled,
  onSelect,
}: {
  result: GenerationNodeResult
  title: string
  active: boolean
  disabled: boolean
  onSelect: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const hostRef = React.useRef<HTMLSpanElement | null>(null)
  const draggingPointerRef = React.useRef<number | null>(null)
  const [videoMounted, setVideoMounted] = React.useState(false)
  const [duration, setDuration] = React.useState(0)
  const [currentTime, setCurrentTime] = React.useState(0)
  const video = (): HTMLVideoElement | null => hostRef.current?.querySelector('video') ?? null

  React.useEffect(() => {
    if (active) setVideoMounted(true)
  }, [active])

  React.useEffect(() => {
    const media = video()
    if (!media) return
    if (active) {
      void media.play().catch(() => undefined)
      return
    }
    media.pause()
    media.currentTime = 0
    setCurrentTime(0)
  }, [active, videoMounted])
  const seekFromPointer = (event: React.PointerEvent<HTMLDivElement>): void => {
    const media = video()
    if (!media) return
    const time = historyVideoTimeFromPointer(event.clientX, event.currentTarget.getBoundingClientRect(), media.duration)
    if (time == null) return
    media.currentTime = time
    setCurrentTime(time)
  }
  const progress = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0

  return (
    <span ref={hostRef} className="absolute inset-0 block" data-history-video-active={active ? 'true' : undefined}>
      <button
        type="button"
        className="absolute inset-0 block h-full w-full overflow-hidden border-0 bg-transparent p-0"
        aria-label={title}
        disabled={disabled}
        onClick={onSelect}
      >
        {videoMounted && result.url ? (
          <DeferredNodeVideo
            src={result.url}
            className={cn('h-full w-full object-cover', !active && 'hidden')}
            muted
            loop
            autoPlay={active}
            playsInline
            preload="metadata"
            aria-hidden={!active}
            onLoadedMetadata={(event) => {
              const nextDuration = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0
              setDuration(nextDuration)
              setCurrentTime(event.currentTarget.currentTime)
            }}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          />
        ) : result.thumbnailUrl ? (
          <img src={result.thumbnailUrl} alt="" draggable={false} className="h-full w-full object-cover" />
        ) : (
          <span className="grid h-full w-full place-items-center bg-nomi-ink-05 text-nomi-ink-40" aria-hidden="true">
            <IconMovie size={22} stroke={1.5} />
          </span>
        )}
      </button>
      <div
        className={cn(
          'absolute bottom-0 left-0 right-0 z-[3] h-4 cursor-ew-resize px-1.5 pb-1 pt-2 transition-opacity duration-150',
          active ? 'opacity-100' : 'pointer-events-none opacity-0',
          'focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-nomi-accent focus-visible:outline-offset-1',
        )}
        role="slider"
        tabIndex={0}
        aria-label={t('generationCommon.resultStack.videoProgress')}
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={currentTime}
        aria-valuetext={t('generationCommon.resultStack.videoProgressValue', {
          current: Math.round(currentTime),
          duration: Math.round(duration),
        })}
        onPointerDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
          event.currentTarget.focus()
          draggingPointerRef.current = event.pointerId
          event.currentTarget.setPointerCapture?.(event.pointerId)
          seekFromPointer(event)
        }}
        onPointerMove={(event) => {
          if (draggingPointerRef.current !== event.pointerId) return
          event.stopPropagation()
          seekFromPointer(event)
        }}
        onPointerUp={(event) => {
          if (draggingPointerRef.current !== event.pointerId) return
          event.stopPropagation()
          seekFromPointer(event)
          draggingPointerRef.current = null
          if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }}
        onPointerCancel={(event) => {
          if (draggingPointerRef.current === event.pointerId) draggingPointerRef.current = null
        }}
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

/**
 * 版本托盘里的一行：按着 Alt/⌥ 拖出去 → 在画布松手处复制出一张独立素材卡（落卡在舞台 onDrop，
 * components/canvasResultDrag.ts）。不按 Alt 的拖动直接取消——托盘里的拖动原本就什么也不做，
 * 点一下仍是「设为当前版本」。
 */
function startResultCopyDrag(event: React.DragEvent<HTMLElement>, nodeId: string, entry: GenerationNodeResult): void {
  if (!event.altKey || !entry.url) {
    event.preventDefault()
    return
  }
  event.stopPropagation()
  const thumb = event.currentTarget.querySelector('img')
  const original = thumb && thumb.naturalWidth > 0 && thumb.getAttribute('src') === entry.url ? thumb : null
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData(CANVAS_RESULT_DRAG_MIME, encodeCanvasResultDrag({
    sourceNodeId: nodeId,
    resultIdentity: resultIdentity(entry),
    ...(original ? { width: original.naturalWidth, height: original.naturalHeight } : {}),
  }))
  if (thumb) event.dataTransfer.setDragImage(thumb, thumb.width / 2, thumb.height / 2)
}

function ResultThumb({
  result,
  title,
}: {
  result: GenerationNodeResult
  title: string
}): JSX.Element {
  const thumbnail = result.thumbnailUrl || (result.type === 'image' ? result.url : '')
  if (thumbnail) return <img src={thumbnail} alt={title} draggable={false} className="h-full w-full object-cover" />
  return (
    <span className="grid h-full w-full place-items-center bg-nomi-ink-05 text-nomi-ink-40" aria-hidden="true">
      <IconMovie size={22} stroke={1.5} />
    </span>
  )
}

function ResultDownloadButton({ node, result, reportFeedback }: { node: GenerationCanvasNode; result: GenerationNodeResult; reportFeedback: (message: string) => void }): JSX.Element {
  const { t } = useTranslation()
  const download = useResultDownload(node, reportFeedback, result)
  return (
    <button
      type="button"
      className="grid size-7 place-items-center rounded-nomi-sm text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink disabled:opacity-40"
      aria-label={t('generationCommon.resultStack.download')}
      title={t('generationCommon.resultStack.download')}
      disabled={!download.canDownload || download.downloading}
      onClick={(event) => {
        event.stopPropagation()
        download.download()
      }}
    >
      <IconDownload size={14} stroke={1.8} />
    </button>
  )
}

export function NodeResultStack({
  onFeedback,
  node,
  readOnly,
  selected,
  open,
  onOpenChange,
}: {
  onFeedback: (message: string) => void
  node: GenerationCanvasNode
  readOnly: boolean
  selected: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}): JSX.Element | null {
  const feedbackOwnerRef = React.useRef<string | null>(node.id)
  feedbackOwnerRef.current = node.id
  React.useEffect(() => { feedbackOwnerRef.current = node.id; return () => { feedbackOwnerRef.current = null } }, [node.id])
  const [feedback, setFeedback] = React.useState<string | null>(null)
  const reportFeedback = React.useCallback((message: string) => {
    if (feedbackOwnerRef.current !== node.id) { onFeedback(message); return }
    notify({ identity: `NodeResultStack:${node.id}`, reason: 'interaction', message, level: 'inline', present: setFeedback })
  }, [node.id, onFeedback])

  const { t } = useTranslation()
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const selectNode = useGenerationCanvasStore((state) => state.selectNode)
  const [visibleCount, setVisibleCount] = React.useState(INITIAL_VISIBLE_RESULTS)
  const [hoveredId, setHoveredId] = React.useState('')
  const [preview, setPreview] = React.useState<GenerationNodeResult | null>(null)
  const [rerunBusy, setRerunBusy] = React.useState(false)
  const [placement, setPlacement] = React.useState<ResultStackPlacement>('right')
  const trayRef = React.useRef<HTMLElement | null>(null)
  const entries = React.useMemo(() => listStableNodeMediaResults(node), [node])
  const currentId = node.result ? resultIdentity(node.result) : ''
  const production = productionMetaOf(node)
  const showSingleProductionAction = Boolean(production && selected && entries.length === 1)
  const showStack = nodeHasResultStack(node) && (selected || entries.length >= 2)

  React.useEffect(() => {
    if (!open) {
      setHoveredId('')
      setVisibleCount(INITIAL_VISIBLE_RESULTS)
    }
  }, [open])

  React.useLayoutEffect(() => {
    if (!open) return
    const tray = trayRef.current
    const nodeHost = tray?.closest<HTMLElement>('.generation-canvas-v2-node')
    const stage = tray?.closest<HTMLElement>('.generation-canvas-v2__stage')
    if (!tray || !nodeHost || !stage) return

    const trayRect = tray.getBoundingClientRect()
    const nodeRect = nodeHost.getBoundingClientRect()
    const stageRect = stage.getBoundingClientRect()
    const currentGap = placement === 'right'
      ? trayRect.left - nodeRect.right
      : nodeRect.left - trayRect.right
    const edgePadding = 12
    setPlacement(resolveResultStackPlacement({
      leftSpace: nodeRect.left - stageRect.left - edgePadding,
      rightSpace: stageRect.right - nodeRect.right - edgePadding,
      requiredSpace: trayRect.width + Math.max(0, currentGap),
    }))
  }, [node.id, open, placement])

  if (!showStack) return null

  const switchTo = (entry: GenerationNodeResult): void => {
    if (readOnly || resultIdentity(entry) === currentId) return
    updateNode(node.id, { result: entry, status: 'success', error: undefined })
  }

  const remove = async (entry: GenerationNodeResult): Promise<void> => {
    if (readOnly) return
    // 删除动作起点签发原项目；确认框期间换了项目即取消，不删新项目的东西。
    const loaded = withProjectAction((project) => project)
    if (!loaded) return
    const confirmed = await confirmDialog({
      title: t('generationCommon.resultStack.deleteTitle'),
      message: t('generationCommon.resultStack.deleteMessage'),
      confirmLabel: t('generationCommon.resultStack.delete'),
      danger: true,
    })
    if (!confirmed || !isProjectExecutionContextCurrent(loaded)) return
    const latest = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id)
    const identity = resultIdentity(entry)
    const asset = latest
      ? canvasNodeToAssetRefs(latest).find((candidate) => candidate.ownerResultId === identity)
      : undefined
    if (!asset) {
      reportFeedback(t('generationCommon.resultStack.assetUnavailable'))
      return
    }
    try {
      const outcome = await deleteAssetResult(asset, loaded)
      if (outcome.failedFileCount > 0) reportFeedback(t('generationCommon.resultStack.deleteFileFailed'))
    } catch (error) {
      logRendererError('node-result-delete-failed', error)
      reportFeedback(t('generationCommon.resultStack.deleteFailed'))
    }
  }

  const rerun = (): void => {
    if (!production || rerunBusy) return
    // 返工属于这次 Run 的原项目：点下去那一刻签发，之后交给 Run 自己的持久身份，不因切页取消。
    withProjectAction((project) => {
      setRerunBusy(true)
      void reworkProductionShot(project.binding.projectId, production.runId, production.shotId, reportFeedback).finally(() => setRerunBusy(false))
    })
  }

  return (
    <>
      {feedback ? <p role="status" className="m-0 px-2 py-1 text-caption text-nomi-ink-60">{feedback}</p> : null}
      <CardStackPeeks
        count={entries.length}
        label={t('generationCommon.resultStack.versionCount', { count: entries.length })}
        expanded={open}
        onToggle={() => {
          if (!open) selectNode(node.id, false)
          onOpenChange(!open)
        }}
        forceTrigger={showSingleProductionAction}
        mediaGlyph={<StackMediaGlyph kind={node.kind} />}
        mediaKind={node.kind}
      />
      <AnimatePresence initial={false}>
        {open ? (
          <motion.section
            ref={trayRef}
            className={cn(
              'pointer-events-auto absolute top-0 z-[14] flex w-[320px] max-h-[420px] flex-col overflow-hidden rounded-nomi-lg',
              placement === 'right' ? 'left-[calc(100%+50px)]' : 'right-[calc(100%+50px)]',
              'border border-nomi-line bg-nomi-paper shadow-nomi-lg',
              'group-data-[dragging=true]/canvas:invisible',
            )}
            data-node-result-stack={node.id}
            data-placement={placement}
            aria-label={t('generationCommon.resultStack.trayAria', { count: entries.length })}
            initial={{ opacity: 0, x: placement === 'right' ? -8 : 8, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: placement === 'right' ? -8 : 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.2, 0.75, 0.25, 1] }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-3 border-b border-nomi-line px-3 py-2.5">
              <div>
                <div className="text-body-sm font-semibold text-nomi-ink">{t('generationCommon.resultStack.title')}</div>
                <div className="text-micro text-nomi-ink-60">{t('generationCommon.resultStack.versionCount', { count: entries.length })}</div>
              </div>
              {production && !readOnly ? (
                <button
                  type="button"
                  className="inline-flex min-h-7 items-center gap-1 rounded-nomi-sm border border-nomi-line px-2 text-micro font-medium text-nomi-ink hover:bg-nomi-ink-05 disabled:opacity-40"
                  disabled={rerunBusy}
                  onClick={rerun}
                >
                  <IconRefresh size={13} stroke={1.8} />
                  {t('generationCommon.resultStack.rerun')}
                </button>
              ) : null}
            </header>
            <div className={cn(NODE_SCROLL_REGION_CLASS_NAME, 'min-h-0 overflow-y-auto p-2')} role="list">
              {entries.slice(0, visibleCount).map((entry, index) => {
                const identity = resultIdentity(entry)
                const isCurrent = identity === currentId
                const title = resultTitle(node, index)
                return (
                  <div
                    key={identity}
                    role="listitem"
                    className={cn(
                      'group/result flex items-center gap-2 rounded-nomi p-1.5 transition-colors',
                      isCurrent ? 'bg-nomi-accent-soft' : 'hover:bg-nomi-ink-05',
                    )}
                    data-result-stack-item={identity}
                    data-current={isCurrent ? 'true' : undefined}
                    draggable={!readOnly}
                    onDragStart={(event) => startResultCopyDrag(event, node.id, entry)}
                    onPointerEnter={() => setHoveredId(identity)}
                    onPointerLeave={(event) => {
                      if (event.currentTarget.contains(document.activeElement)) return
                      setHoveredId((current) => current === identity ? '' : current)
                    }}
                    onFocusCapture={() => {
                      if (entry.type === 'video') setHoveredId(identity)
                    }}
                    onBlurCapture={(event) => {
                      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
                      setHoveredId((current) => current === identity ? '' : current)
                    }}
                  >
                    {entry.type === 'video' ? (
                      <div
                      className={cn(
                        'relative size-14 shrink-0 overflow-hidden rounded-nomi-sm border bg-nomi-ink-05',
                        isCurrent ? 'border-nomi-accent' : 'border-nomi-line',
                      )}
                    >
                      <HistoryVideoThumb
                        result={entry}
                        title={isCurrent ? t('generationCommon.resultStack.current') : t('generationCommon.resultStack.setCurrent')}
                        active={hoveredId === identity}
                        disabled={readOnly || isCurrent}
                        onSelect={() => switchTo(entry)}
                      />
                      {isCurrent ? (
                        <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-nomi-accent text-nomi-paper" aria-hidden="true">
                          <IconCheck size={10} stroke={2.5} />
                        </span>
                      ) : null}
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={cn(
                          'relative size-14 shrink-0 overflow-hidden rounded-nomi-sm border bg-nomi-ink-05',
                          isCurrent ? 'border-nomi-accent' : 'border-nomi-line',
                        )}
                        aria-label={isCurrent ? t('generationCommon.resultStack.current') : t('generationCommon.resultStack.setCurrent')}
                        disabled={readOnly || isCurrent}
                        onClick={() => switchTo(entry)}
                      >
                        <ResultThumb result={entry} title={title} />
                        {isCurrent ? (
                          <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-nomi-accent text-nomi-paper" aria-hidden="true">
                            <IconCheck size={10} stroke={2.5} />
                          </span>
                        ) : null}
                      </button>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-caption font-medium text-nomi-ink">{t('generationCommon.resultStack.versionLabel', { index: index + 1 })}</div>
                      <div className="text-micro text-nomi-ink-40">
                        {isCurrent ? t('generationCommon.resultStack.current') : entry.type === 'video' ? t('generationCommon.imagePreview.video') : t('generationCommon.imagePreview.image')}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center">
                      <button
                        type="button"
                        className="grid size-7 place-items-center rounded-nomi-sm text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink"
                        aria-label={t('generationCommon.resultStack.preview')}
                        title={t('generationCommon.resultStack.preview')}
                        onClick={() => setPreview(entry)}
                      >
                        <IconEye size={14} stroke={1.8} />
                      </button>
                      <ResultDownloadButton reportFeedback={reportFeedback} node={node} result={entry} />
                      {!readOnly ? (
                        <button
                          type="button"
                          className="grid size-7 place-items-center rounded-nomi-sm text-nomi-ink-60 hover:bg-nomi-danger-soft hover:text-nomi-danger"
                          aria-label={t('generationCommon.resultStack.delete')}
                          title={t('generationCommon.resultStack.delete')}
                          onClick={() => void remove(entry)}
                        >
                          <IconTrash size={14} stroke={1.8} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
              {entries.length > visibleCount ? (
                <button
                  type="button"
                  className="mt-1 w-full rounded-nomi-sm py-2 text-caption font-medium text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink"
                  onClick={() => setVisibleCount((count) => count + INITIAL_VISIBLE_RESULTS)}
                >
                  {t('generationCommon.resultStack.showMore', { count: entries.length - visibleCount })}
                </button>
              ) : null}
            </div>
          </motion.section>
        ) : null}
      </AnimatePresence>
      {preview?.url ? (
        <NodeMediaPreviewDialog
          mediaType={preview.type === 'video' ? 'video' : 'image'}
          url={preview.url}
          title={node.title || t('generationCommon.resultStack.title')}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </>
  )
}
