import { notify } from '../../../ui/notificationPolicy'
import React from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { IconDownload, IconExternalLink, IconScissors } from '@tabler/icons-react'
import { NomiSegmented, WorkbenchButton, WorkbenchIconButton } from '../../../design'
import { cn } from '../../../utils/cn'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useAllProjectAssets } from '../../assets/useAllProjectAssets'
import AssetPicker from '../../assets/AssetPicker'
import AssetPickerPopover from '../../assets/AssetPickerPopover'
import type { AssetRef } from '../../assets/assetTypes'
import { getActiveWorkbenchProjectId } from '../../project/workbenchProjectSession'
import {
  appendClipNodeSource,
  clipNodeSourceFromAsset,
  readClipNodeMeta,
} from './clipNodeModel'
import { MagneticConnectionHandle } from './NodeConnectionHandles'
import { completeNodeConnection } from './completeNodeConnection'
import type { ConnectionAnchorSide } from '../store/canvasStoreTypes'
import { getNodeSizeBounds, resolveNodeVisualSize } from './nodeSizing'
import { useNodeDragResize } from './useNodeDragResize'
import { useCanvasLiveZoom } from '../reactFlow/canvasViewportScale'
import { exportTimelineToMp4 } from '../../export/exportApi'
import { getDesktopBridge } from '../../../desktop/bridge'
import { buildWorkspaceFileUrl } from '../../explorer/workspaceFileDrag'
import ClipNodePreview from './ClipNodePreview'
import ClipNodeTimeline from './ClipNodeTimeline'
import ClipNodeActionToolbar from './ClipNodeActionToolbar'
import { createExclusiveClipNodeUpload, importClipNodeAsset } from './clipNodeUpload'
import {
  clipNodeTimelineFromMeta,
  duplicateClipNode,
  moveClipNode,
  nudgeClipNode,
  removeClipNode,
  resizeClipNode,
  splitClipNode,
} from './clipNodeSequence'
import { buildClipNodeOutputPatch } from './clipNodeOutput'
import { formatClipNodeDuration, resolveClipNodeVisualMode } from './clipNodeVisual'
import { buildClipNodeExportTasks, type ClipNodeExportScope } from './clipNodeExport'
import { dispatchTimelineShortcut } from '../../timeline/timelineShortcuts'
import { useTimelinePlaybackClock } from '../../timeline/useTimelinePlaybackClock'
import { readVideoDurationSeconds } from '../../../media/videoDurationProbe'

type Props = { node: unknown; selected: boolean; readOnly?: boolean }
type ClipNodeExportDestination = 'canvas' | 'download'
type ClipNodeExportAction = `${ClipNodeExportScope}-${ClipNodeExportDestination}`

export default function ClipNode({ node: rawNode, selected, readOnly = false }: Props): JSX.Element {
  const node = rawNode as GenerationCanvasNode
  const [feedback, setFeedback] = React.useState<string | null>(null)
  const reportFeedback = React.useCallback((message: string) => {
    notify({ identity: `ClipNode:${node.id}`, reason: 'interaction', message, level: 'inline', present: setFeedback })
  }, [node.id])

  const { t } = useTranslation()
  const canvasNodes = useGenerationCanvasStore((state) => state.nodes)
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const addNode = useGenerationCanvasStore((state) => state.addNode)
  const connectNodes = useGenerationCanvasStore((state) => state.connectNodes)
  const selectNode = useGenerationCanvasStore((state) => state.selectNode)
  const captureHistory = useGenerationCanvasStore((state) => state.captureHistory)
  const commitPersistedChange = useGenerationCanvasStore((state) => state.commitPersistedChange)
  const moveNode = useGenerationCanvasStore((state) => state.moveNode)
  const moveSelectedNodes = useGenerationCanvasStore((state) => state.moveSelectedNodes)
  // 画布缩放的唯一真相是 React Flow 的 transform（见 reactFlow/canvasViewportScale.ts）。
  // 这里读错一格，卡内时间轴的拖/裁就会按错误的屏幕像素→帧换算走位。
  const canvasZoom = useCanvasLiveZoom()
  const isMultiSelectActive = useGenerationCanvasStore((state) => selected && state.selectedNodeIds.length > 1)
  const startConnection = useGenerationCanvasStore((state) => state.startConnection)
  const pendingSourceId = useGenerationCanvasStore((state) => state.pendingConnectionSourceId)
  const pendingSourceSide = useGenerationCanvasStore((state) => state.pendingConnectionSourceSide)
  const upstreamMedia = useGenerationCanvasStore((state) => state.edges
    .filter((edge) => edge.target === node.id)
    .map((edge) => state.nodes.find((candidate) => candidate.id === edge.source))
    .filter((candidate): candidate is GenerationCanvasNode => Boolean(candidate?.result?.url && (candidate.result.type === 'image' || candidate.result.type === 'video'))))
  const { refresh } = useAllProjectAssets()
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [playheadFrame, setPlayheadFrame] = React.useState(0)
  const [playing, setPlaying] = React.useState(false)
  const [exporting, setExporting] = React.useState<ClipNodeExportAction | null>(null)
  const [exportScope, setExportScope] = React.useState<ClipNodeExportScope>('full')
  const [editingOpen, setEditingOpen] = React.useState(false)
  const [exportMenuOpen, setExportMenuOpen] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const [uploadError, setUploadError] = React.useState<string | null>(null)
  const [retryUploadFile, setRetryUploadFile] = React.useState<File | null>(null)
  const uploadExclusiveRef = React.useRef(createExclusiveClipNodeUpload())
  const articleRef = React.useRef<HTMLElement | null>(null)
  const [anchorRect, setAnchorRect] = React.useState<DOMRect | null>(null)
  const visualSize = resolveNodeVisualSize(node)
  const sizeBounds = getNodeSizeBounds(node.kind)
  const { handlePointerDown, handlePointerMove, handlePointerUp } = useNodeDragResize({ reportFeedback,
    node,
    selected,
    readOnly,
    isMultiSelectActive,
    sizeBounds,
    visualSize,
    selectNode,
    captureHistory,
    moveNode,
    moveSelectedNodes,
    updateNode,
    commitPersistedChange,
  })
  const meta = React.useMemo(() => readClipNodeMeta(node.meta), [node.meta])
  const timeline = React.useMemo(() => clipNodeTimelineFromMeta(meta), [meta])
  const timelineForView = React.useMemo(
    () => ({ ...timeline, playheadFrame: Math.min(playheadFrame, timeline.tracks[0]?.clips.at(-1)?.endFrame ?? 0) }),
    [playheadFrame, timeline],
  )
  const timelineClips = React.useMemo(() => timeline.tracks[0]?.clips ?? [], [timeline])
  const selectedClipId = meta.selectedClipId ? `clip-${meta.selectedClipId}` : undefined
  const activeClip = timelineClips.find((clip) => clip.id === selectedClipId)
  const visualMode = resolveClipNodeVisualMode({ hasClips: timelineClips.length > 0, editingOpen, selectedClip: Boolean(activeClip) })
  const durationFrames = timelineClips.reduce((max, clip) => Math.max(max, clip.endFrame), 0)
  const upstreamMediaKey = upstreamMedia.map((source) => source.id).join('|')
  const clipActionDisabledReason = exporting
    ? t('generationCommon.clipNode.exporting')
    : !activeClip
      ? t('generationCommon.clipNode.selectToEdit')
      : undefined
  const canEditActiveClip = !clipActionDisabledReason
  const canSplitActiveClip = Boolean(
    canEditActiveClip
    && activeClip
    && playheadFrame > activeClip.startFrame
    && playheadFrame < activeClip.endFrame,
  )
  const splitDisabledReason = canSplitActiveClip
    ? undefined
    : clipActionDisabledReason ?? t('generationCommon.clipNode.splitUnavailable')

  React.useEffect(() => {
    if (selected) return
    setEditingOpen(false)
    setExportMenuOpen(false)
    setPlaying(false)
  }, [selected])

  React.useEffect(() => {
    const endFrame = timeline.tracks[0]?.clips.at(-1)?.endFrame ?? 0
    setPlayheadFrame((current) => Math.min(current, endFrame))
  }, [timeline])

  useTimelinePlaybackClock({
    playing,
    playheadFrame,
    durationFrame: durationFrames,
    fps: timeline.fps,
    onPlayheadChange: setPlayheadFrame,
    onPlayingChange: setPlaying,
  })

  React.useLayoutEffect(() => {
    if (!editingOpen || !articleRef.current) return
    const updateAnchor = () => setAnchorRect(articleRef.current?.getBoundingClientRect() ?? null)
    updateAnchor()
    window.addEventListener('resize', updateAnchor)
    window.addEventListener('scroll', updateAnchor, true)
    return () => {
      window.removeEventListener('resize', updateAnchor)
      window.removeEventListener('scroll', updateAnchor, true)
    }
  }, [canvasZoom, editingOpen, exportMenuOpen, node.position.x, node.position.y, visualSize.width, visualSize.height])

  const persist = React.useCallback((next: ReturnType<typeof readClipNodeMeta>, options?: { history?: boolean }) => {
    updateNode(node.id, { meta: { ...(node.meta ?? {}), clip: next } }, options)
  }, [node.id, node.meta, updateNode])

  React.useEffect(() => {
    if (!upstreamMediaKey) return
    const known = new Set([
      ...meta.clips.map((clip) => clip.sourceNodeId ?? clip.id),
      ...(meta.excludedSourceNodeIds ?? []),
    ])
    const additions = upstreamMedia
      .filter((source) => !known.has(source.id))
      .map((source) => ({
        id: source.id,
        sourceNodeId: source.id,
        type: source.result!.type as 'image' | 'video',
        label: source.title || source.result!.type,
        url: source.result!.url!,
        ...(source.result!.thumbnailUrl ? { thumbnailUrl: source.result!.thumbnailUrl } : {}),
        durationSeconds: source.result!.durationSeconds ?? 6,
        trimStart: 0,
        trimEnd: source.result!.durationSeconds ?? 6,
      }))
    if (!additions.length) return
    persist({
      ...meta,
      sourceNodeIds: [...meta.sourceNodeIds, ...additions.map((source) => source.id)],
      clips: [...meta.clips, ...additions],
      selectedClipId: additions[additions.length - 1].id,
    })
  }, [meta, persist, upstreamMedia, upstreamMediaKey])

  const handleConnectionStart = (event: React.PointerEvent<HTMLElement>, side: ConnectionAnchorSide): void => {
    event.stopPropagation()
    startConnection(node.id, side)
  }

  const addAsset = React.useCallback(async (asset: AssetRef) => {
    const durationSeconds = asset.kind === 'video' ? await readVideoDurationSeconds(asset.renderUrl) : null
    const source = clipNodeSourceFromAsset(asset, durationSeconds)
    if (!source) return
    const currentNode = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id)
    if (!currentNode) return
    const currentMeta = readClipNodeMeta(currentNode.meta)
    updateNode(node.id, {
      meta: {
        ...(currentNode.meta ?? {}),
        clip: appendClipNodeSource(currentMeta, source),
      },
    })
    setPickerOpen(false)
    setUploadError(null)
    setRetryUploadFile(null)
    setEditingOpen(false)
  }, [node.id, updateNode])

  const upload = React.useCallback(async (file: File) => {
    await uploadExclusiveRef.current(async () => {
      const projectId = getActiveWorkbenchProjectId()
      setRetryUploadFile(file)
      setUploadError(null)
      if (!projectId) {
        setUploadError(t('generationCommon.clipNode.uploadFailed'))
        return
      }
      setUploading(true)
      try {
        const result = await importClipNodeAsset(file, projectId)
        if (result.error || !result.asset) {
          setUploadError(t('generationCommon.clipNode.uploadFailed'))
          return
        }
        await addAsset(result.asset)
        setRetryUploadFile(null)
        refresh()
      } finally {
        setUploading(false)
      }
    })
  }, [addAsset, refresh, t])

  const closePicker = React.useCallback(() => {
    if (uploading) return
    setPickerOpen(false)
    setUploadError(null)
    setRetryUploadFile(null)
  }, [uploading])

  const selectClip = React.useCallback((clipId: string, frame: number) => {
    if (!selected) selectNode(node.id)
    persist({ ...meta, selectedClipId: clipId.replace(/^clip-/, '') }, { history: false })
    setPlayheadFrame(frame)
    setPlaying(false)
    setEditingOpen(true)
    setExportMenuOpen(false)
  }, [meta, node.id, persist, selectNode, selected])

  const selectFrame = React.useCallback((frame: number) => {
    if (!timelineClips.length) return
    const boundedFrame = Math.max(0, Math.min(frame, Math.max(0, durationFrames - 1)))
    const containingClip = timelineClips.find((clip) => boundedFrame >= clip.startFrame && boundedFrame < clip.endFrame)
    const closestClip = containingClip ?? timelineClips.reduce((closest, clip) => {
      const closestDistance = Math.min(
        Math.abs(boundedFrame - closest.startFrame),
        Math.abs(boundedFrame - Math.max(closest.startFrame, closest.endFrame - 1)),
      )
      const clipDistance = Math.min(
        Math.abs(boundedFrame - clip.startFrame),
        Math.abs(boundedFrame - Math.max(clip.startFrame, clip.endFrame - 1)),
      )
      return clipDistance < closestDistance ? clip : closest
    })
    selectClip(closestClip.id, boundedFrame)
  }, [durationFrames, selectClip, timelineClips])

  const handleMoveClip = React.useCallback((clipId: string, startFrame: number) => {
    const current = timelineClips.find((clip) => clip.id === clipId)
    if (!current) return
    const next = moveClipNode(meta, clipId, startFrame)
    const moved = clipNodeTimelineFromMeta(next).tracks[0]?.clips.find((clip) => clip.id === clipId)
    if (!moved || moved.startFrame === current.startFrame) return
    captureHistory()
    persist({ ...next, selectedClipId: clipId.replace(/^clip-/, '') }, { history: false })
    setPlaying(false)
  }, [captureHistory, meta, persist, timelineClips])

  const handleResizeClip = React.useCallback((clipId: string, edge: 'left' | 'right', deltaFrame: number) => {
    const current = timelineClips.find((clip) => clip.id === clipId)
    if (!current || deltaFrame === 0) return
    const next = resizeClipNode(meta, clipId, edge, deltaFrame)
    const resized = clipNodeTimelineFromMeta(next).tracks[0]?.clips.find((clip) => clip.id === clipId)
    if (!resized || (resized.startFrame === current.startFrame && resized.endFrame === current.endFrame)) return
    captureHistory()
    persist({ ...next, selectedClipId: clipId.replace(/^clip-/, '') }, { history: false })
    setPlaying(false)
  }, [captureHistory, meta, persist, timelineClips])

  const handleSplitClip = React.useCallback((clipId: string, frame: number) => {
    const existingIds = new Set(meta.clips.map((clip) => clip.id))
    const next = splitClipNode(meta, clipId, frame)
    const splitSource = next.clips.find((clip) => !existingIds.has(clip.id))
    if (next === meta) return
    captureHistory()
    persist({ ...next, selectedClipId: splitSource?.id ?? meta.selectedClipId }, { history: false })
  }, [captureHistory, meta, persist])

  const handleRemoveClip = React.useCallback((clipId: string) => {
    const next = removeClipNode(meta, clipId)
    if (next.clips.length === meta.clips.length) return
    captureHistory()
    persist(next, { history: false })
    setPlaying(false)
    if (!next.clips.length) {
      setEditingOpen(false)
      setExportMenuOpen(false)
    }
  }, [captureHistory, meta, persist])

  const handleDuplicateClip = React.useCallback((clipId: string) => {
    const next = duplicateClipNode(meta, clipId)
    if (next.clips.length === meta.clips.length) return
    captureHistory()
    persist(next, { history: false })
  }, [captureHistory, meta, persist])

  const handleNudgeClip = React.useCallback((clipId: string, deltaFrame: number) => {
    const next = nudgeClipNode(meta, clipId, deltaFrame)
    if (next === meta) return
    captureHistory()
    persist(next, { history: false })
  }, [captureHistory, meta, persist])

  const handleExport = async (scope: ClipNodeExportScope, destination: ClipNodeExportDestination): Promise<void> => {
    const projectId = getActiveWorkbenchProjectId()
    const tasks = buildClipNodeExportTasks(timeline, scope)
    if (!projectId || tasks.length === 0 || exporting) return
    const action: ClipNodeExportAction = `${scope}-${destination}`
    setExporting(action)
    try {
      const completed: Array<{ task: (typeof tasks)[number]; relativePath: string }> = []
      for (const task of tasks) {
        const result = await exportTimelineToMp4({
          timeline: task.timeline,
          aspectRatio: '16:9',
          projectId,
          resolution: '1080p',
          quality: 'standard',
          outputName: task.outputName,
        })
        completed.push({ task, relativePath: result.relativePath })
      }

      if (destination === 'download') {
        const revealed = completed.at(-1)
        if (revealed) {
          await getDesktopBridge()?.exports.showInFolder({ projectId, relativePath: revealed.relativePath }).catch(() => undefined)
        }
      } else {
        for (const { task, relativePath } of completed) {
          const existing = canvasNodes.find((candidate) => (
            candidate.kind === 'video'
            && candidate.meta?.sourceClipNodeId === node.id
            && (task.sourceClipId
              ? candidate.meta?.sourceClipId === task.sourceClipId
              : !candidate.meta?.sourceClipId)
          ))
          const outputNode = existing ?? addNode({
            kind: 'video',
            title: task.sourceClipId
              ? t('generationCommon.clipNode.outputClipTitle', { index: task.index + 1 })
              : t('generationCommon.clipNode.outputNodeTitle'),
            position: {
              x: node.position.x + visualSize.width + 80,
              y: node.position.y + (task.sourceClipId ? task.index * 180 : -180),
            },
            categoryId: node.categoryId,
            select: false,
          })
          updateNode(outputNode.id, buildClipNodeOutputPatch({
            sourceClipNodeId: node.id,
            ...(task.sourceClipId ? { sourceClipId: task.sourceClipId } : {}),
            outputUrl: buildWorkspaceFileUrl(projectId, relativePath),
            relativePath,
            durationSeconds: task.durationFrames / Math.max(1, task.timeline.fps),
          }))
          // Default reference edges retain the canvas's light, label-free resting state.
          connectNodes(node.id, outputNode.id)
        }
      }
      setExportMenuOpen(false)
      if (destination === 'download') reportFeedback(t('generationCommon.clipNode.exportDownloadComplete', { count: completed.length }))
    } catch (error) {
      reportFeedback(error instanceof Error ? error.message : t('generationCommon.clipNode.exportFailed'))
    } finally {
      setExporting(null)
    }
  }

  const closeEditing = React.useCallback((): void => {
    setEditingOpen(false)
    setExportMenuOpen(false)
    setPlaying(false)
  }, [])

  React.useEffect(() => {
    if (!selected || !editingOpen || !activeClip || readOnly) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeEditing()
        return
      }
      dispatchTimelineShortcut(event, {
        hasSelection: true,
        hasPrimaryClip: true,
        hasSelectedTextClip: false,
        splitMode: false,
      }, (action) => {
        switch (action.type) {
          case 'undo': useGenerationCanvasStore.getState().undo(); break
          case 'redo': useGenerationCanvasStore.getState().redo(); break
          case 'nudge-playhead': setPlayheadFrame((frame) => Math.max(0, Math.min(durationFrames, frame + action.delta))); break
          case 'remove-selection': handleRemoveClip(activeClip.id); break
          case 'split-primary': handleSplitClip(activeClip.id, playheadFrame); break
          case 'duplicate-primary': handleDuplicateClip(activeClip.id); break
          case 'nudge-primary': handleNudgeClip(activeClip.id, action.delta); break
          case 'exit-split-mode':
          case 'remove-text-selection': break
        }
      })
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [activeClip, closeEditing, durationFrames, editingOpen, handleDuplicateClip, handleNudgeClip, handleRemoveClip, handleSplitClip, playheadFrame, readOnly, selected])

  const floatingLayerStyle = React.useMemo<React.CSSProperties | null>(() => {
    if (!anchorRect || typeof window === 'undefined') return null
    const width = 430
    const height = 286
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, anchorRect.left + anchorRect.width / 2 - width / 2))
    const top = anchorRect.top >= height + 20
      ? anchorRect.top - height - 12
      : Math.min(window.innerHeight - height - 12, anchorRect.bottom + 12)
    return { position: 'fixed', left, top: Math.max(12, top), zIndex: 1000 }
  }, [anchorRect])

  const exportLayerStyle = React.useMemo<React.CSSProperties | null>(() => {
    if (!anchorRect || typeof window === 'undefined') return null
    const width = 248
    const height = 92
    const gap = 12
    const fitsRight = anchorRect.right + gap + width <= window.innerWidth - gap
    const fitsLeft = anchorRect.left - gap - width >= gap
    const left = fitsRight
      ? anchorRect.right + gap
      : fitsLeft
        ? anchorRect.left - gap - width
        : Math.max(gap, Math.min(window.innerWidth - width - gap, anchorRect.right - width))
    const top = fitsRight || fitsLeft
      ? Math.max(gap, Math.min(window.innerHeight - height - gap, anchorRect.top))
      : Math.max(gap, Math.min(window.innerHeight - height - gap, anchorRect.bottom + gap))
    return { position: 'fixed', left, top, zIndex: 1001 }
  }, [anchorRect])

  return (
    <article
      ref={articleRef}
      className={cn('generation-canvas-v2-node absolute block cursor-grab select-none touch-none overflow-visible', selected ? 'z-50' : '')}
      style={{ transform: `translate(${node.position.x}px, ${node.position.y}px)`, width: visualSize.width, height: visualSize.height }}
      data-node-id={node.id}
      data-kind={node.kind}
      data-selected={selected ? 'true' : 'false'}
      data-clip-node="true"
      data-clip-mode={visualMode}
      onWheel={(event) => event.stopPropagation()}
      onClick={(event) => {
        if (event.target === event.currentTarget) closeEditing()
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {feedback ? <p role="status" className="m-0 px-2 py-1 text-caption text-nomi-ink-60">{feedback}</p> : null}
      {!readOnly ? <>
        <MagneticConnectionHandle side="left" active={pendingSourceId === node.id || pendingSourceSide === 'left'} pendingTarget={Boolean(pendingSourceId && pendingSourceId !== node.id)} onStart={handleConnectionStart} onComplete={(event) => { event.stopPropagation(); completeNodeConnection(node.id, reportFeedback) }} />
        <MagneticConnectionHandle side="right" active={pendingSourceId === node.id || pendingSourceSide === 'right'} pendingTarget={Boolean(pendingSourceId && pendingSourceId !== node.id)} onStart={handleConnectionStart} onComplete={(event) => { event.stopPropagation(); completeNodeConnection(node.id, reportFeedback) }} />
      </> : null}

      {visualMode === 'editing' && activeClip && floatingLayerStyle ? createPortal(
        <div style={floatingLayerStyle} onPointerDown={(event) => event.stopPropagation()}>
          <ClipNodePreview
            timeline={timelineForView}
            playheadFrame={playheadFrame}
            playing={playing}
            onPlayingChange={setPlaying}
            onPlayheadChange={setPlayheadFrame}
            onClose={closeEditing}
          />
        </div>, document.body,
      ) : null}

      <div
        className={cn('generation-canvas-v2-node__preview flex h-full w-full flex-col overflow-hidden rounded-nomi border bg-nomi-paper shadow-nomi-md', selected ? 'ring-2 ring-nomi-accent' : 'ring-1 ring-inset ring-nomi-line')}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeEditing()
        }}
      >
        <header
          className="flex h-8 shrink-0 cursor-grab items-center gap-2 px-3 active:cursor-grabbing"
          data-testid="clip-node-drag-handle"
          onPointerDown={handlePointerDown}
        >
          <IconScissors size={15} className="text-nomi-accent" />
          <span className="truncate text-body-sm font-semibold text-nomi-ink">{t('generationCommon.clipNode.axis')}</span>
          <span className="ml-auto text-micro text-nomi-ink/60">{t('generationCommon.clipNode.count', { count: timelineClips.length })}</span>
          <span className="text-micro text-nomi-ink/45">·</span>
          <span className="text-micro text-nomi-ink/60">{t('generationCommon.clipNode.totalDuration', { duration: formatClipNodeDuration(durationFrames, timeline.fps) })}</span>
          {!readOnly ? (
            <>
              <ClipNodeActionToolbar
                canEdit={canEditActiveClip}
                canSplit={canSplitActiveClip}
                editDisabledReason={clipActionDisabledReason}
                splitDisabledReason={splitDisabledReason}
                onSplit={() => { if (activeClip) handleSplitClip(activeClip.id, playheadFrame) }}
                onDuplicate={() => { if (activeClip) handleDuplicateClip(activeClip.id) }}
                onRemove={() => { if (activeClip) handleRemoveClip(activeClip.id) }}
              />
              <span className="h-4 w-px shrink-0 bg-nomi-line-soft" aria-hidden="true" />
              <WorkbenchIconButton
                label={t('generationCommon.clipNode.export')}
                icon={<IconDownload size={15} />}
                className="shrink-0 bg-transparent text-nomi-ink-60 hover:bg-nomi-accent-soft hover:text-nomi-accent"
                disabled={!timelineClips.length || Boolean(exporting) || !getActiveWorkbenchProjectId()}
                aria-expanded={exportMenuOpen}
                data-testid="clip-node-export"
                onClick={() => setExportMenuOpen((value) => !value)}
              />
            </>
          ) : null}
        </header>
        <div className="min-h-0 flex-1 px-2 pb-2" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
          <ClipNodeTimeline
            timeline={timelineForView}
            canvasZoom={canvasZoom}
            selectedClipId={selectedClipId}
            onSelectClip={selectClip}
            onMoveClip={handleMoveClip}
            onResizeClip={handleResizeClip}
            onScrubPlayhead={selectFrame}
            onAddMaterial={readOnly ? undefined : () => { setUploadError(null); setRetryUploadFile(null); setPickerOpen(true) }}
          />
        </div>
      </div>

      {exportMenuOpen && !readOnly && exportLayerStyle ? createPortal(
        <div
          style={exportLayerStyle}
          className="w-[248px] rounded-nomi border border-nomi-line bg-nomi-paper p-2 text-nomi-ink shadow-nomi-lg"
          role="dialog"
          aria-label={t('generationCommon.clipNode.exportOptions')}
          data-testid="clip-node-export-menu"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <NomiSegmented
            value={exportScope}
            options={[
              { value: 'full', label: t('generationCommon.clipNode.exportFull') },
              { value: 'segments', label: t('generationCommon.clipNode.exportSegments', { count: timelineClips.length }) },
            ]}
            onChange={(value) => setExportScope(value as ClipNodeExportScope)}
            ariaLabel={t('generationCommon.clipNode.exportScope')}
            className="rounded-nomi-sm p-0.5"
            itemClassName="min-h-7 py-0.5"
          />
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <WorkbenchButton
              variant="default"
              size="sm"
              loading={exporting === `${exportScope}-canvas`}
              disabled={Boolean(exporting)}
              onClick={() => void handleExport(exportScope, 'canvas')}
            >
              <IconExternalLink />{t('generationCommon.clipNode.exportToCanvas')}
            </WorkbenchButton>
            <WorkbenchButton
              variant="primary"
              size="sm"
              loading={exporting === `${exportScope}-download`}
              disabled={Boolean(exporting)}
              onClick={() => void handleExport(exportScope, 'download')}
            >
              <IconDownload />{t('generationCommon.clipNode.exportDownload')}
            </WorkbenchButton>
          </div>
        </div>, document.body,
      ) : null}

      {pickerOpen ? (
        <AssetPickerPopover onClose={closePicker}>
          <div className="grid gap-1.5">
            <AssetPicker
              projectId={getActiveWorkbenchProjectId()}
              accept={['image', 'video']}
              onPick={(asset) => void addAsset(asset)}
              onUpload={(file) => void upload(file)}
              uploading={uploading}
            />
            {uploadError ? (
              <div role="alert" className="flex items-center gap-2 rounded-nomi-sm border border-nomi-danger/40 bg-nomi-danger-soft px-2 py-1.5 text-micro text-nomi-danger">
                <span className="min-w-0 flex-1">{uploadError}</span>
                <WorkbenchButton
                  variant="default"
                  size="sm"
                  className="shrink-0 border-nomi-danger/40 text-nomi-danger hover:bg-nomi-danger-soft"
                  disabled={!retryUploadFile || uploading}
                  onClick={() => { if (retryUploadFile) void upload(retryUploadFile) }}
                >
                  {t('generationCommon.clipNode.retryUpload')}
                </WorkbenchButton>
              </div>
            ) : null}
          </div>
        </AssetPickerPopover>
      ) : null}
    </article>
  )
}
