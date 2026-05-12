import React from 'react'
import { IconDownload, IconGrid3x3, IconLayoutGrid, IconMaximize, IconUpload } from '@tabler/icons-react'
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
import PanoramaViewer, { type PanoramaScreenshot } from './PanoramaViewer'
import { appendDownloadSuffix, downloadUrl } from '../../../../utils/download'

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
type ImageGridSize = 2 | 3

type ImageGridTile = {
  dataUrl: string
  width: number
  height: number
  row: number
  column: number
}

const RESIZE_DIRECTIONS: ResizeDirection[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
const MIN_NODE_WIDTH = 240
const MAX_NODE_WIDTH = 680
const MIN_NODE_HEIGHT = 120
const MAX_NODE_HEIGHT = 520
const TIMELINE_TRACK_CLIPS_SELECTOR = '.workbench-timeline-track__clips'
const VIDEO_CONTROLS_HIT_AREA_PX = 48

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

function imageGridTileNodeSize(width: number, height: number, preferredWidth: number): { width: number; height: number; previewHeight: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  const aspectRatio = width / height
  const nodeWidth = clampNumber(preferredWidth, MIN_NODE_WIDTH, MAX_NODE_WIDTH)
  const previewHeight = Math.max(1, Math.round(nodeWidth / aspectRatio))
  return {
    width: nodeWidth,
    height: previewHeight,
    previewHeight,
  }
}

function loadImageForCanvas(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Unable to load image.'))
    if (!url.startsWith('data:') && !url.startsWith('blob:')) {
      image.crossOrigin = 'anonymous'
    }
    image.src = url
  })
}

async function splitImageIntoGrid(url: string, gridSize: ImageGridSize): Promise<ImageGridTile[]> {
  if (typeof document === 'undefined') return []
  const image = await loadImageForCanvas(url)
  const imageWidth = image.naturalWidth || image.width
  const imageHeight = image.naturalHeight || image.height
  if (!imageWidth || !imageHeight) return []

  const sourceTileWidth = imageWidth / gridSize
  const sourceTileHeight = imageHeight / gridSize
  const outputTileWidth = Math.max(1, Math.round(sourceTileWidth))
  const outputTileHeight = Math.max(1, Math.round(sourceTileHeight))
  const tiles: ImageGridTile[] = []
  for (let row = 0; row < gridSize; row += 1) {
    const sourceY = row * sourceTileHeight
    for (let column = 0; column < gridSize; column += 1) {
      const sourceX = column * sourceTileWidth
      const canvas = document.createElement('canvas')
      canvas.width = outputTileWidth
      canvas.height = outputTileHeight
      const context = canvas.getContext('2d')
      if (!context) continue
      context.drawImage(image, sourceX, sourceY, sourceTileWidth, sourceTileHeight, 0, 0, outputTileWidth, outputTileHeight)
      tiles.push({
        dataUrl: canvas.toDataURL('image/png'),
        width: outputTileWidth,
        height: outputTileHeight,
        row,
        column,
      })
    }
  }
  return tiles
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
  const addNode = useGenerationCanvasStore((state) => state.addNode)
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const storeConnectNodes = useGenerationCanvasStore((state) => state.connectNodes)
  const pendingConnectionSourceId = useGenerationCanvasStore((state) => state.pendingConnectionSourceId)
  const canvasZoom = useGenerationCanvasStore((state) => state.canvasZoom)
  const panoramaFullscreenRef = React.useRef<(() => void) | null>(null)
  const panoramaFourViewRef = React.useRef<(() => void) | null>(null)
  const [splittingGridSize, setSplittingGridSize] = React.useState<ImageGridSize | null>(null)
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

  const handlePanoramaFileChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = (loadEvent) => {
      const dataUrl = loadEvent.target?.result
      if (typeof dataUrl !== 'string') return
      updateNode(node.id, { result: { id: `panorama-${Date.now()}`, type: 'image', url: dataUrl, createdAt: Date.now() } })
    }
    reader.readAsDataURL(file)
  }, [node.id, updateNode])

  const status = node.status || 'idle'
  const size = node.size || { width: 320, height: 360 }
  const isImageGridSplitNode = node.kind === 'image' && typeof node.meta?.source === 'string' && node.meta.source.startsWith('image-grid-split-')
  const storedPreviewHeight = typeof node.meta?.previewHeight === 'number' && Number.isFinite(node.meta.previewHeight)
    ? isImageGridSplitNode
      ? Math.max(1, Math.round(node.meta.previewHeight))
      : clampNumber(Math.round(node.meta.previewHeight), 120, 520)
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
  const handlePanoramaScreenshot = React.useCallback((screenshot: PanoramaScreenshot) => {
    const { dataUrl, dimensions } = screenshot
    const createdAt = Date.now()
    const screenshotNode = addNode({
      kind: 'image',
      title: screenshot.title || '全景截图',
      prompt: screenshot.prompt || '全景视口截图',
      position: {
        x: Math.round(node.position.x + visualSize.width + 80),
        y: Math.round(node.position.y),
      },
    })
    const result = {
      id: `panorama-shot-${screenshotNode.id}-${createdAt}`,
      type: 'image' as const,
      url: dataUrl,
      createdAt,
    }
    const screenshotSize = mediaNodeSize(dimensions.width, dimensions.height)
    updateNode(screenshotNode.id, {
      result,
      history: [result],
      status: 'success',
      ...(screenshotSize ? { size: { width: screenshotSize.width, height: screenshotSize.height } } : {}),
      meta: {
        ...(screenshotNode.meta || {}),
        source: screenshot.source || 'panorama-screenshot',
        sourceNodeId: node.id,
        localOnly: true,
        imageWidth: dimensions.width,
        imageHeight: dimensions.height,
        imageAspectRatio: dimensions.width / Math.max(1, dimensions.height),
      },
    })
    storeConnectNodes(node.id, screenshotNode.id, 'reference')
  }, [addNode, node.id, node.position.x, node.position.y, storeConnectNodes, updateNode, visualSize.width])

  const handleDownloadResult = React.useCallback(() => {
    const resultUrl = String(node.result?.url || '').trim()
    if (!resultUrl) return
    void downloadUrl({
      url: resultUrl,
      filename: appendDownloadSuffix(node.title || node.kind || 'generation-node', Date.now()),
      preferBlob: true,
      fallbackTarget: '_blank',
    })
  }, [node.kind, node.result?.url, node.title])

  const handleVideoPointerDown = React.useCallback((event: React.PointerEvent<HTMLVideoElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const isNativeControlsArea = event.clientY >= rect.bottom - VIDEO_CONTROLS_HIT_AREA_PX
    if (!isNativeControlsArea) return

    selectNode(node.id, event.shiftKey)
    event.stopPropagation()
  }, [node.id, selectNode])

  const handleImageGridSplit = React.useCallback(async (gridSize: ImageGridSize) => {
    const imageUrl = node.result?.type === 'image' ? node.result.url : undefined
    if (!imageUrl || splittingGridSize !== null) return

    setSplittingGridSize(gridSize)
    try {
      const tiles = await splitImageIntoGrid(imageUrl, gridSize)
      if (tiles.length !== gridSize * gridSize) return
      const createdAt = Date.now()
      const gap = 42
      const preferredTileWidth = Math.max(MIN_NODE_WIDTH, Math.round(visualSize.width / gridSize))
      const firstTileSize = imageGridTileNodeSize(tiles[0]?.width || 1, tiles[0]?.height || 1, preferredTileWidth)
      const layoutWidth = firstTileSize?.width || 240
      const layoutHeight = firstTileSize?.previewHeight || 180
      const baseX = Math.round(node.position.x + visualSize.width + 80)
      const baseY = Math.round(node.position.y)

      tiles.forEach((tile, index) => {
        const tileSize = imageGridTileNodeSize(tile.width, tile.height, layoutWidth)
        const tileNode = addNode({
          kind: 'image',
          title: `${node.title || '图片'} ${gridSize}x${gridSize} 切片 ${index + 1}`,
          prompt: `${gridSize}x${gridSize} 图片切片 ${tile.row + 1}-${tile.column + 1}`,
          position: {
            x: baseX + tile.column * (layoutWidth + gap),
            y: baseY + tile.row * (layoutHeight + gap),
          },
          select: false,
        })
        const result = {
          id: `image-split-${tileNode.id}-${createdAt}-${index}`,
          type: 'image' as const,
          url: tile.dataUrl,
          createdAt,
        }
        updateNode(tileNode.id, {
          result,
          history: [result],
          status: 'success',
          ...(tileSize ? { size: { width: tileSize.width, height: tileSize.height } } : {}),
          meta: {
            ...(tileNode.meta || {}),
            source: `image-grid-split-${gridSize}x${gridSize}`,
            sourceNodeId: node.id,
            localOnly: true,
            gridSize,
            gridRow: tile.row,
            gridColumn: tile.column,
            imageWidth: tile.width,
            imageHeight: tile.height,
            imageAspectRatio: tile.width / Math.max(1, tile.height),
            previewHeight: tileSize?.previewHeight,
          },
        })
        storeConnectNodes(node.id, tileNode.id, 'reference')
      })
    } catch {
      // Image splitting can fail if the source image cannot be loaded into a canvas due to CORS.
    } finally {
      setSplittingGridSize(null)
    }
  }, [
    addNode,
    node.id,
    node.position.x,
    node.position.y,
    node.result,
    node.title,
    splittingGridSize,
    storeConnectNodes,
    updateNode,
    visualSize.width,
  ])

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

      {node.kind === 'panorama' && selected && !readOnly && node.result?.url ? (
        <div
          className="generation-canvas-v2-node__panorama-toolbar"
          role="toolbar"
          aria-label="全景图操作"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            className="generation-canvas-v2-node__panorama-toolbar-item"
            type="button"
            onClick={() => panoramaFullscreenRef.current?.()}
          >
            <IconMaximize size={16} stroke={1.8} />
            <span>全景预览</span>
          </button>
          <button
            className="generation-canvas-v2-node__panorama-toolbar-item generation-canvas-v2-node__panorama-toolbar-item--icon"
            type="button"
            aria-label="四视图截图"
            title="四视图截图"
            onClick={() => panoramaFourViewRef.current?.()}
          >
            <IconLayoutGrid size={16} stroke={1.8} />
          </button>
          <span className="generation-canvas-v2-node__panorama-toolbar-divider" />
          <label className="generation-canvas-v2-node__panorama-toolbar-item">
            <IconUpload size={16} stroke={1.8} />
            <span>重新上传</span>
            <input type="file" accept="image/*" onChange={handlePanoramaFileChange} />
          </label>
        </div>
      ) : null}

      {node.kind === 'image' && selected && !readOnly && node.result?.type === 'image' && node.result.url ? (
        <div
          className="generation-canvas-v2-node__panorama-toolbar"
          role="toolbar"
          aria-label="图片切图操作"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            className="generation-canvas-v2-node__panorama-toolbar-item generation-canvas-v2-node__panorama-toolbar-item--icon"
            type="button"
            aria-label="下载图片"
            title="下载图片"
            onClick={handleDownloadResult}
          >
            <IconDownload size={16} stroke={1.8} />
          </button>
          <span className="generation-canvas-v2-node__panorama-toolbar-divider" />
          <button
            className="generation-canvas-v2-node__panorama-toolbar-item generation-canvas-v2-node__panorama-toolbar-item--icon"
            type="button"
            aria-label="2x2 切图"
            title="2x2 切图"
            disabled={splittingGridSize !== null}
            onClick={() => { void handleImageGridSplit(2) }}
          >
            <IconLayoutGrid size={16} stroke={1.8} />
          </button>
          <button
            className="generation-canvas-v2-node__panorama-toolbar-item generation-canvas-v2-node__panorama-toolbar-item--icon"
            type="button"
            aria-label="3x3 切图"
            title="3x3 切图"
            disabled={splittingGridSize !== null}
            onClick={() => { void handleImageGridSplit(3) }}
          >
            <IconGrid3x3 size={16} stroke={1.8} />
          </button>
        </div>
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
        {node.kind === 'panorama' ? (
          node.result?.url || node.meta?.imageUrl ? (
            <PanoramaViewer
              imageUrl={(node.result?.url || node.meta?.imageUrl) as string}
              width={visualSize.width}
              height={previewHeight}
              onEnterFullscreen={(trigger) => { panoramaFullscreenRef.current = trigger }}
              onCaptureFourView={(trigger) => { panoramaFourViewRef.current = trigger }}
              onScreenshot={handlePanoramaScreenshot}
            />
          ) : (
            <div className="generation-canvas-v2-node__panorama-empty">
              <label
                className="generation-canvas-v2-node__panorama-upload"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <span>+ 上传全景图</span>
                <input type="file" accept="image/*" onChange={handlePanoramaFileChange} />
              </label>
            </div>
          )
        ) : node.result?.url ? (
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
              onPointerDown={handleVideoPointerDown}
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

      {selected && !readOnly && node.kind !== 'panorama' ? (
        <div
          className="generation-canvas-v2-node__composer"
          style={{
            width: composerLayout.width,
            maxHeight: composerLayout.maxHeight,
            top: `calc(100% + ${composerLayout.gap}px)`,
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <>
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
            </>
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
