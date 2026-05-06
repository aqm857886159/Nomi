import React from 'react'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { useWorkbenchStore } from '../../../workbenchStore'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import {
  encodeTimelineGenerationNodeDragPayload,
  TIMELINE_GENERATION_NODE_DRAG_MIME,
} from '../../../timeline/timelineDragPayload'
import { clientXToFrame } from '../../../timeline/timelineEdit'
import { buildClipFromGenerationNode } from '../../model/buildClipFromGenerationNode'
import { canRunGenerationNode, rerunGenerationNodeAsNewNode, runGenerationNode } from '../../runner/generationRunController'
import { WorkbenchButton } from '../../../../design'
import NodeParameterControls from './NodeParameterControls'
import { buildVideoPlaybackUrl } from '../../../../media/videoPlaybackUrl'
import { diagnoseVideoPlaybackFailure, logVideoPlaybackFailure } from '../../../../media/videoPlaybackDiagnostics'

const STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  running: '生成中',
  error: '生成失败',
}

type BaseGenerationNodeProps = {
  node: GenerationCanvasNode
  selected: boolean
  readOnly?: boolean
}

type FloatingComposerLayout = {
  width: number
  maxHeight: number
  gap: number
  promptRows: number
}

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const RESIZE_DIRECTIONS: ResizeDirection[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
const MIN_NODE_WIDTH = 240
const MAX_NODE_WIDTH = 680
const MIN_NODE_HEIGHT = 120
const MAX_NODE_HEIGHT = 520
const TIMELINE_TRACK_CLIPS_SELECTOR = '.workbench-timeline-track__clips'

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function readFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function nodeWidthForAspectRatio(aspectRatio: number): number {
  if (aspectRatio >= 1.75) return 420
  if (aspectRatio <= 0.72) return 260
  return 340
}

function floatingComposerLayout(width: number, height: number, kind: GenerationCanvasNode['kind']): FloatingComposerLayout {
  const aspectRatio = width / Math.max(1, height)
  const panelWidth = aspectRatio >= 1.55
    ? clampNumber(Math.round(width * 0.88), 360, 560)
    : aspectRatio <= 0.78
      ? clampNumber(Math.round(width * 1.18), 320, 420)
      : clampNumber(Math.round(width * 0.98), 330, 500)
  const maxHeight = clampNumber(Math.round(height * 0.72), 176, kind === 'video' ? 260 : 220)
  const gap = width >= 420 ? 14 : 10
  return {
    width: panelWidth,
    maxHeight,
    gap,
    promptRows: kind === 'video' ? 4 : width >= 420 ? 3 : 2,
  }
}

function mediaNodeSize(width: number, height: number, preferredWidth?: number): { width: number; height: number; previewHeight: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  const aspectRatio = width / height
  const nodeWidth = clampNumber(preferredWidth || nodeWidthForAspectRatio(aspectRatio), 240, 680)
  const previewHeight = clampNumber(Math.round(nodeWidth / aspectRatio), 120, 520)
  return {
    width: nodeWidth,
    height: previewHeight,
    previewHeight,
  }
}

function findTimelineDropTarget(clientX: number, clientY: number): HTMLElement | null {
  if (typeof document.elementFromPoint !== 'function') return null
  const element = document.elementFromPoint(clientX, clientY)
  if (!element) return null
  return element.closest(TIMELINE_TRACK_CLIPS_SELECTOR)
}

export default function BaseGenerationNode({ node, selected, readOnly = false }: BaseGenerationNodeProps): JSX.Element {
  const selectNode = useGenerationCanvasStore((state) => state.selectNode)
  const captureHistory = useGenerationCanvasStore((state) => state.captureHistory)
  const moveNode = useGenerationCanvasStore((state) => state.moveNode)
  const moveSelectedNodes = useGenerationCanvasStore((state) => state.moveSelectedNodes)
  const selectedNodeIds = useGenerationCanvasStore((state) => state.selectedNodeIds)
  const startConnection = useGenerationCanvasStore((state) => state.startConnection)
  const connectToNode = useGenerationCanvasStore((state) => state.connectToNode)
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const pendingConnectionSourceId = useGenerationCanvasStore((state) => state.pendingConnectionSourceId)
  const canvasZoom = useGenerationCanvasStore((state) => state.canvasZoom)
  const dragStartRef = React.useRef<{
    pointerX: number
    pointerY: number
    x: number
    y: number
    lastDeltaX: number
    lastDeltaY: number
    multi: boolean
    dragging: boolean
  } | null>(null)
  const resizeStartRef = React.useRef<{
    pointerX: number
    pointerY: number
    x: number
    y: number
    width: number
    height: number
    direction: ResizeDirection
  } | null>(null)
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('button, input, textarea, select')) return
    if ((target as HTMLElement).tagName === 'VIDEO') return
    event.stopPropagation()
    if (readOnly) {
      selectNode(node.id, event.shiftKey)
      return
    }
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    captureHistory()
    dragStartRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      x: node.position.x,
      y: node.position.y,
      lastDeltaX: 0,
      lastDeltaY: 0,
      multi: selected && selectedNodeIds.length > 1,
      dragging: false,
    }
    selectNode(node.id, event.shiftKey)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const resizeStart = resizeStartRef.current
    if (resizeStart) {
      const effectiveZoom = canvasZoom || 1
      const deltaX = Math.round((event.clientX - resizeStart.pointerX) / effectiveZoom)
      const deltaY = Math.round((event.clientY - resizeStart.pointerY) / effectiveZoom)
      const pullsWest = resizeStart.direction.includes('w')
      const pullsEast = resizeStart.direction.includes('e')
      const pullsNorth = resizeStart.direction.includes('n')
      const pullsSouth = resizeStart.direction.includes('s')
      const nextWidth = pullsWest
        ? clampNumber(resizeStart.width - deltaX, MIN_NODE_WIDTH, MAX_NODE_WIDTH)
        : pullsEast
          ? clampNumber(resizeStart.width + deltaX, MIN_NODE_WIDTH, MAX_NODE_WIDTH)
          : resizeStart.width
      const nextHeight = pullsNorth
        ? clampNumber(resizeStart.height - deltaY, MIN_NODE_HEIGHT, MAX_NODE_HEIGHT)
        : pullsSouth
          ? clampNumber(resizeStart.height + deltaY, MIN_NODE_HEIGHT, MAX_NODE_HEIGHT)
          : resizeStart.height
      updateNode(node.id, {
        position: {
          x: pullsWest ? resizeStart.x + resizeStart.width - nextWidth : resizeStart.x,
          y: pullsNorth ? resizeStart.y + resizeStart.height - nextHeight : resizeStart.y,
        },
        size: {
          width: nextWidth,
          height: nextHeight,
        },
        meta: {
          ...(node.meta || {}),
          userResized: true,
        },
      })
      return
    }
    const dragStart = dragStartRef.current
    if (!dragStart) return
    const effectiveZoom = canvasZoom || 1
    const deltaX = Math.round((event.clientX - dragStart.pointerX) / effectiveZoom)
    const deltaY = Math.round((event.clientY - dragStart.pointerY) / effectiveZoom)
    if (!dragStart.dragging) {
      if (Math.abs(deltaX) < 2 && Math.abs(deltaY) < 2) return
      dragStart.dragging = true
    }
    event.preventDefault()
    event.stopPropagation()
    if (dragStart.multi) {
      moveSelectedNodes({
        x: deltaX - dragStart.lastDeltaX,
        y: deltaY - dragStart.lastDeltaY,
      })
      dragStart.lastDeltaX = deltaX
      dragStart.lastDeltaY = deltaY
      return
    }
    moveNode(node.id, {
      x: Math.round(dragStart.x + deltaX),
      y: Math.round(dragStart.y + deltaY),
    })
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragStart = dragStartRef.current
    const timelineDropTarget = dragStart?.dragging && node.result?.url
      ? findTimelineDropTarget(event.clientX, event.clientY)
      : null
    if (timelineDropTarget) {
      const timeline = useWorkbenchStore.getState().timeline
      const rect = timelineDropTarget.getBoundingClientRect()
      const startFrame = clientXToFrame(event.clientX, rect.left, timeline.scale)
      const clip = buildClipFromGenerationNode(node, {
        fps: timeline.fps,
        startFrame,
      })
      if (clip) {
        useWorkbenchStore.getState().addTimelineClipAtFrame(clip, clip.type, startFrame)
        if (!dragStart?.multi) {
          moveNode(node.id, {
            x: dragStart?.x ?? node.position.x,
            y: dragStart?.y ?? node.position.y,
          })
        }
      }
    }
    dragStartRef.current = null
    resizeStartRef.current = null
    if (
      typeof event.currentTarget.hasPointerCapture === 'function' &&
      typeof event.currentTarget.releasePointerCapture === 'function' &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleTimelineDragStart = (event: React.DragEvent<HTMLElement>, resultId?: string) => {
    event.stopPropagation()
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(
      TIMELINE_GENERATION_NODE_DRAG_MIME,
      encodeTimelineGenerationNodeDragPayload(node, resultId),
    )
  }

  const handleResizePointerDown = (direction: ResizeDirection) => (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (readOnly) return
    captureHistory()
    resizeStartRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      x: node.position.x,
      y: node.position.y,
      width: visualSize.width,
      height: visualSize.height,
      direction,
    }
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
  }

  const updateMediaDimensions = (width: number, height: number) => {
    const nextSize = mediaNodeSize(width, height, node.size?.width)
    if (!nextSize) return
    const meta = node.meta || {}
    const previousWidth = readFiniteNumber(meta.imageWidth ?? meta.videoWidth)
    const previousHeight = readFiniteNumber(meta.imageHeight ?? meta.videoHeight)
    const userResized = meta.userResized === true
    const mediaPatch = node.result?.type === 'video'
      ? { videoWidth: width, videoHeight: height, videoAspectRatio: width / height }
      : { imageWidth: width, imageHeight: height, imageAspectRatio: width / height }
    const shouldPatchSize = !userResized && (
      node.size?.width !== nextSize.width ||
      node.size?.height !== nextSize.height
    )
    if (previousWidth === width && previousHeight === height && !shouldPatchSize) return
    updateNode(node.id, {
      ...(shouldPatchSize ? { size: { width: nextSize.width, height: nextSize.height } } : {}),
      meta: {
        ...meta,
        ...mediaPatch,
        previewHeight: nextSize.previewHeight,
      },
    })
  }

  const handleGenerate = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (readOnly) return
    const state = useGenerationCanvasStore.getState()
    if (!canRunGenerationNode(node, { nodes: state.nodes, edges: state.edges })) return
    try {
      if (hasResult) {
        await rerunGenerationNodeAsNewNode(node.id)
      } else {
        await runGenerationNode(node.id)
      }
    } catch {
      // runGenerationNode records the explicit failure on the node; the card renders it below the prompt.
    }
  }

  const status = node.status || 'idle'
  const size = node.size || { width: 320, height: 360 }
  const storedPreviewHeight = typeof node.meta?.previewHeight === 'number' && Number.isFinite(node.meta.previewHeight)
    ? clampNumber(Math.round(node.meta.previewHeight), 120, 520)
    : null
  const hasResult = Boolean(node.result?.url)
  const previewHeight = storedPreviewHeight ?? clampNumber(size.height, 120, 520)
  const visualSize = {
    width: Math.max(MIN_NODE_WIDTH, size.width),
    height: previewHeight,
  }
  const isGenerating = status === 'queued' || status === 'running'
  const generationState = useGenerationCanvasStore.getState()
  const canGenerate = canRunGenerationNode(node, { nodes: generationState.nodes, edges: generationState.edges }) && !isGenerating
  const canSendToTimeline = hasResult && status !== 'error'
  const showStatusBadge = status === 'queued' || status === 'running' || status === 'error'
  const composerLayout = floatingComposerLayout(visualSize.width, visualSize.height, node.kind)

  return (
    <article
      className="generation-canvas-v2-node"
      data-kind={node.kind}
      data-expanded={selected ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'}
      data-status={status}
      style={{
        transform: `translate(${node.position.x}px, ${node.position.y}px)`,
        width: visualSize.width,
        height: visualSize.height,
        gridTemplateRows: `${previewHeight}px`,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {!readOnly ? (
        <>
          <WorkbenchButton
            className="generation-canvas-v2-node__handle generation-canvas-v2-node__handle--input"
            aria-label="连接到此节点"
            data-active={pendingConnectionSourceId && pendingConnectionSourceId !== node.id ? 'true' : 'false'}
            onClick={(event) => {
              event.stopPropagation()
              connectToNode(node.id)
            }}
          />
          <WorkbenchButton
            className="generation-canvas-v2-node__handle generation-canvas-v2-node__handle--output"
            aria-label="从此节点开始连线"
            data-active={pendingConnectionSourceId === node.id ? 'true' : 'false'}
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              if (typeof event.currentTarget.releasePointerCapture === 'function') {
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
              startConnection(node.id)
            }}
          />
        </>
      ) : null}

      <header className="generation-canvas-v2-node__header">
        {showStatusBadge ? (
          <span className="generation-canvas-v2-node__status" data-status={status}>{STATUS_LABEL[status] ?? status}</span>
        ) : null}
      </header>

      {status === 'error' && node.error && !selected ? (
        <div className="generation-canvas-v2-node__error-peek" title={node.error}>
          {node.error.length > 40 ? node.error.slice(0, 40) + '…' : node.error}
        </div>
      ) : null}

      <div
        className="generation-canvas-v2-node__preview"
        data-timeline-draggable={canSendToTimeline ? 'true' : 'false'}
        draggable={false}
      >
        {node.result?.url ? (
          node.result.type === 'video' ? (
            <video
              className="generation-canvas-v2-node__media generation-canvas-v2-node__media--video"
              src={buildVideoPlaybackUrl(node.result.url)}
              crossOrigin="use-credentials"
              controls
              muted
              playsInline
              preload="metadata"
              draggable={false}
              onPointerDown={(e) => e.stopPropagation()}
              onLoadedMetadata={(event) => {
                updateMediaDimensions(event.currentTarget.videoWidth, event.currentTarget.videoHeight)
              }}
              onError={(event) => {
                void diagnoseVideoPlaybackFailure(node.result?.url || '', event.currentTarget.error).then(logVideoPlaybackFailure)
              }}
            />
          ) : (
            <img
              className="generation-canvas-v2-node__media"
              src={node.result.url}
              alt=""
              draggable={false}
              onLoad={(event) => {
                updateMediaDimensions(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)
              }}
            />
          )
        ) : (
          <div className="generation-canvas-v2-node__empty">
            {selected ? null : <span style={{ fontSize: 11, opacity: 0.45, pointerEvents: 'none' }}>点击节点填写提示词</span>}
          </div>
        )}
      </div>

      {canSendToTimeline && !readOnly ? (
        <WorkbenchButton
          className="generation-canvas-v2-node__timeline-drag"
          aria-label="拖到时间线"
          title="拖到时间线"
          draggable
          onDragStart={(event) => handleTimelineDragStart(event)}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span className="generation-canvas-v2-node__timeline-drag-line" />
          <span className="generation-canvas-v2-node__timeline-drag-line" />
          <span className="generation-canvas-v2-node__timeline-drag-line" />
        </WorkbenchButton>
      ) : null}

      {selected && !readOnly ? (
        <div
          className="generation-canvas-v2-node__composer"
          style={{
            width: composerLayout.width,
            maxHeight: composerLayout.maxHeight,
            top: `calc(100% + ${composerLayout.gap}px)`,
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {node.kind === 'video' || node.kind === 'image' || node.kind === 'keyframe' || node.kind === 'character' || node.kind === 'scene' ? (
            <NodeParameterControls node={node} section="references" valueOnly />
          ) : null}
          <textarea
            className="generation-canvas-v2-node__prompt-input"
            value={node.prompt}
            rows={composerLayout.promptRows}
            placeholder={
              node.kind === 'video'
                ? '描述这一段视频的镜头、动作和节奏...'
                : node.kind === 'text'
                  ? '输入文本内容...'
                  : '描述这一帧的画面...'
            }
            onChange={(event) => updateNode(node.id, { prompt: event.currentTarget.value })}
          />
          {status === 'error' && node.error ? (
            <div className="generation-canvas-v2-node__error" role="alert">
              生成失败：{node.error}
            </div>
          ) : null}
          <div className="generation-canvas-v2-node__footer">
            <NodeParameterControls node={node} section="parameters" valueOnly />
            {(() => {
              const disabledReason = !canGenerate && !isGenerating
                ? node.kind === 'video'
                  ? '需要先连接一个图片节点作为首帧'
                  : node.kind === 'image'
                    ? undefined
                    : `「${node.kind}」类型暂不支持直接生成`
                : undefined
              return (
                <span title={disabledReason} style={{ display: 'contents' }}>
                  <WorkbenchButton
                    className="generation-canvas-v2-node__generate"
                    aria-label="生成素材"
                    disabled={!canGenerate}
                    onClick={handleGenerate}
                  >
                    {isGenerating ? '生成中' : hasResult ? '重新生成' : '生成 →'}
                  </WorkbenchButton>
                </span>
              )
            })()}
          </div>
        </div>
      ) : null}
      {selected && !readOnly ? RESIZE_DIRECTIONS.map((direction) => (
        <WorkbenchButton
          key={direction}
          className={`generation-canvas-v2-node__resize-zone generation-canvas-v2-node__resize-zone--${direction}`}
          aria-label={`从${direction}方向调整节点尺寸`}
          title="调整节点尺寸"
          onPointerDown={handleResizePointerDown(direction)}
        />
      )) : null}
    </article>
  )
}
