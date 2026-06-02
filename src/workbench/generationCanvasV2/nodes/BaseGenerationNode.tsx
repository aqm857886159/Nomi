import React from 'react'
import { IconGrid3x3, IconLayoutGrid, IconMaximize, IconSchema, IconUpload } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useWorkbenchStore } from '../../workbenchStore'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import {
  encodeTimelineGenerationNodeDragPayload,
  TIMELINE_GENERATION_NODE_DRAG_MIME,
} from '../../timeline/timelineDragPayload'
import { clientXToFrame } from '../../timeline/timelineEdit'
import { buildClipFromGenerationNode } from '../model/buildClipFromGenerationNode'
import { canRunGenerationNode, rerunGenerationNodeAsNewNode, runGenerationNode } from '../runner/generationRunController'
import { WorkbenchButton } from '../../../design'
import NodeParameterControls from './NodeParameterControls'
import { buildVideoPlaybackUrl } from '../../../media/videoPlaybackUrl'
import { diagnoseVideoPlaybackFailure, logVideoPlaybackFailure } from '../../../media/videoPlaybackDiagnostics'
import PanoramaViewer, { type PanoramaScreenshot } from './PanoramaViewer'
import { persistActiveWorkbenchProjectNow } from '../../project/workbenchProjectSession'
import { createEmptySemanticScene } from './semanticScene/semanticSceneSerializer'
import {
  getGenerationNodeExecutionKind,
  getGenerationNodePromptPlaceholder,
  isImageLikeGenerationNodeKind,
  isVideoLikeGenerationNodeKind,
} from '../model/generationNodeKinds'

const STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  running: '生成中',
  error: '生成失败',
}

export type BaseGenerationNodeProps = {
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
const Scene3DEditor = React.lazy(() => import('./Scene3DEditor'))
const SemanticSceneNode = React.lazy(() => import('./SemanticSceneNode'))

function Scene3DEditorLoading(): JSX.Element {
  return (
    <div className={cn('flex w-full h-full items-center justify-center bg-nomi-ink-05 text-[12px] text-nomi-ink-45')}>
      3D 编辑器加载中
    </div>
  )
}

function SemanticSceneNodeLoading(): JSX.Element {
  return (
    <div className={cn('flex w-full h-full items-center justify-center bg-nomi-ink-05 text-[12px] text-nomi-ink-45')}>
      语义场景加载中
    </div>
  )
}

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
  const commitPersistedChange = useGenerationCanvasStore((state) => state.commitPersistedChange)
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
  const moveFrameRef = React.useRef<number | null>(null)
  const pendingNodePositionRef = React.useRef<{ x: number; y: number } | null>(null)
  const pendingSelectedDeltaRef = React.useRef<{ x: number; y: number } | null>(null)

  const flushPendingMove = React.useCallback(() => {
    moveFrameRef.current = null
    const selectedDelta = pendingSelectedDeltaRef.current
    const nodePosition = pendingNodePositionRef.current
    pendingSelectedDeltaRef.current = null
    pendingNodePositionRef.current = null
    if (selectedDelta && (selectedDelta.x !== 0 || selectedDelta.y !== 0)) {
      moveSelectedNodes(selectedDelta, { persist: false })
    }
    if (nodePosition) {
      moveNode(node.id, nodePosition, { persist: false })
    }
  }, [moveNode, moveSelectedNodes, node.id])

  const requestMoveFrame = React.useCallback(() => {
    if (moveFrameRef.current !== null) return
    moveFrameRef.current = window.requestAnimationFrame(flushPendingMove)
  }, [flushPendingMove])

  const scheduleNodeMove = React.useCallback((position: { x: number; y: number }) => {
    pendingNodePositionRef.current = position
    requestMoveFrame()
  }, [requestMoveFrame])

  const scheduleSelectedMove = React.useCallback((delta: { x: number; y: number }) => {
    const pending = pendingSelectedDeltaRef.current
    pendingSelectedDeltaRef.current = pending
      ? { x: pending.x + delta.x, y: pending.y + delta.y }
      : delta
    requestMoveFrame()
  }, [requestMoveFrame])

  const flushScheduledMove = React.useCallback(() => {
    if (moveFrameRef.current !== null) {
      window.cancelAnimationFrame(moveFrameRef.current)
    }
    flushPendingMove()
  }, [flushPendingMove])

  React.useEffect(() => () => {
    if (moveFrameRef.current !== null) {
      window.cancelAnimationFrame(moveFrameRef.current)
      moveFrameRef.current = null
    }
  }, [])

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
      }, { persist: false })
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
      scheduleSelectedMove({
        x: deltaX - dragStart.lastDeltaX,
        y: deltaY - dragStart.lastDeltaY,
      })
      dragStart.lastDeltaX = deltaX
      dragStart.lastDeltaY = deltaY
      return
    }
    scheduleNodeMove({
      x: Math.round(dragStart.x + deltaX),
      y: Math.round(dragStart.y + deltaY),
    })
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    flushScheduledMove()
    const dragStart = dragStartRef.current
    const hadResize = Boolean(resizeStartRef.current)
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
          }, { persist: false })
        }
      }
    }
    if (dragStart?.dragging || hadResize) {
      commitPersistedChange()
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
  const nodeExecutionKind = getGenerationNodeExecutionKind(node.kind)
  const handleCreateSemanticSceneFromPanorama = React.useCallback(() => {
    const sourceUrl = node.result?.url || (typeof node.meta?.imageUrl === 'string' ? node.meta.imageUrl : '')
    if (!sourceUrl) return
    const semanticScene = createEmptySemanticScene({
      sourceType: 'panorama',
      sourceNodeId: node.id,
      sourceImageUrls: [sourceUrl],
      scaleHint: typeof node.meta?.scaleHint === 'string' ? node.meta.scaleHint : undefined,
    })
    const semanticNode = addNode({
      kind: 'semanticScene',
      title: `${node.title || '全景图'} 语义场景`,
      prompt: '从全景图提取建筑或开放环境语义：空间、边界、表面、开口、物体、光照和相机。',
      position: {
        x: Math.round(node.position.x + visualSize.width + 80),
        y: Math.round(node.position.y),
      },
    })
    updateNode(semanticNode.id, {
      meta: {
        ...(semanticNode.meta || {}),
        source: 'panorama-semantic-scene',
        sourceNodeId: node.id,
        semanticScene,
      },
    })
    storeConnectNodes(node.id, semanticNode.id, 'reference')
  }, [
    addNode,
    node.id,
    node.meta?.imageUrl,
    node.meta?.scaleHint,
    node.position.x,
    node.position.y,
    node.result?.url,
    node.title,
    storeConnectNodes,
    updateNode,
    visualSize.width,
  ])
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
      className={cn(
        'generation-canvas-v2-node',
        'absolute block p-0 border-0 rounded-none bg-transparent shadow-none',
        'cursor-grab select-none touch-none overflow-visible',
        'data-[selected=true]:z-[5]',
      )}
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
            className={cn(
              'generation-canvas-v2-node__handle generation-canvas-v2-node__handle--input',
              'absolute top-1/2 left-[-14px] inline-grid w-7 h-7 place-items-center p-0',
              'border-0 rounded-full bg-transparent -translate-y-1/2 cursor-crosshair',
              'opacity-80 transition-opacity duration-150 hover:opacity-100',
              'data-[active=true]:opacity-100',
            )}
            aria-label="连接到此节点"
            data-active={pendingConnectionSourceId && pendingConnectionSourceId !== node.id ? 'true' : 'false'}
            onPointerDown={(event) => {
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              connectToNode(node.id)
            }}
          >
            <span className="generation-canvas-v2-node__handle-dot" aria-hidden="true" />
          </WorkbenchButton>
          <WorkbenchButton
            className={cn(
              'generation-canvas-v2-node__handle generation-canvas-v2-node__handle--output',
              'absolute top-1/2 right-[-14px] inline-grid w-7 h-7 place-items-center p-0',
              'border-0 rounded-full bg-transparent -translate-y-1/2 cursor-crosshair',
              'opacity-80 transition-opacity duration-150 hover:opacity-100',
              'data-[active=true]:opacity-100',
            )}
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
          >
            <span className="generation-canvas-v2-node__handle-dot" aria-hidden="true" />
          </WorkbenchButton>
        </>
      ) : null}

      {node.kind === 'panorama' && selected && !readOnly && node.result?.url ? (
        <div
          className={cn(
            'generation-canvas-v2-node__panorama-toolbar',
            'absolute left-1/2 bottom-[calc(100%+18px)] z-[12]',
            'inline-flex items-center gap-1 min-h-[44px] py-[5px] px-2',
            'border border-[rgba(18,24,38,0.08)] rounded-[14px]',
            'bg-white/[0.96] shadow-[0_12px_34px_rgba(18,24,38,0.14)]',
            '-translate-x-1/2 backdrop-blur-[12px]',
          )}
          role="toolbar"
          aria-label="全景图操作"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            className={cn(
              'inline-flex items-center justify-center gap-[7px]',
              'min-w-0 min-h-[34px] px-[11px] border-0 rounded-[9px]',
              'bg-transparent text-nomi-ink-80 font-[inherit] text-[13px] leading-none whitespace-nowrap cursor-pointer',
              'hover:bg-nomi-ink-05 hover:text-nomi-ink',
            )}
            type="button"
            title="创建语义场景节点"
            onClick={handleCreateSemanticSceneFromPanorama}
          >
            <IconSchema size={16} stroke={1.8} />
            <span>语义场景</span>
          </button>
          <button
            className={cn(
              'inline-flex items-center justify-center gap-[7px]',
              'min-w-0 min-h-[34px] px-[11px] border-0 rounded-[9px]',
              'bg-transparent text-nomi-ink-80 font-[inherit] text-[13px] leading-none whitespace-nowrap cursor-pointer',
              'hover:bg-nomi-ink-05 hover:text-nomi-ink',
            )}
            type="button"
            onClick={() => panoramaFullscreenRef.current?.()}
          >
            <IconMaximize size={16} stroke={1.8} />
            <span>全景预览</span>
          </button>
          <button
            className={cn(
              'inline-flex items-center justify-center',
              'w-[34px] min-h-[34px] p-0 border-0 rounded-[9px]',
              'bg-transparent text-nomi-ink-80 font-[inherit] text-[13px] leading-none cursor-pointer',
              'hover:bg-nomi-ink-05 hover:text-nomi-ink',
            )}
            type="button"
            aria-label="四视图截图"
            title="四视图截图"
            onClick={() => panoramaFourViewRef.current?.()}
          >
            <IconLayoutGrid size={16} stroke={1.8} />
          </button>
          <span className={cn('w-px h-[22px] bg-[rgba(18,24,38,0.1)]')} />
          <label className={cn(
            'inline-flex items-center justify-center gap-[7px]',
            'min-w-0 min-h-[34px] px-[11px] border-0 rounded-[9px]',
            'bg-transparent text-nomi-ink-80 font-[inherit] text-[13px] leading-none whitespace-nowrap cursor-pointer',
            'hover:bg-nomi-ink-05 hover:text-nomi-ink',
          )}>
            <IconUpload size={16} stroke={1.8} />
            <span>重新上传</span>
            <input className="hidden" type="file" accept="image/*" onChange={handlePanoramaFileChange} />
          </label>
        </div>
      ) : null}

      {node.kind === 'image' && selected && !readOnly && node.result?.type === 'image' && node.result.url ? (
        <div
          className={cn(
            'generation-canvas-v2-node__panorama-toolbar',
            'absolute left-1/2 bottom-[calc(100%+18px)] z-[12]',
            'inline-flex items-center gap-1 min-h-[44px] py-[5px] px-2',
            'border border-[rgba(18,24,38,0.08)] rounded-[14px]',
            'bg-white/[0.96] shadow-[0_12px_34px_rgba(18,24,38,0.14)]',
            '-translate-x-1/2 backdrop-blur-[12px]',
          )}
          role="toolbar"
          aria-label="图片切图操作"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            className={cn(
              'inline-flex items-center justify-center',
              'w-[34px] min-h-[34px] p-0 border-0 rounded-[9px]',
              'bg-transparent text-nomi-ink-80 font-[inherit] text-[13px] leading-none cursor-pointer',
              'hover:bg-nomi-ink-05 hover:text-nomi-ink',
              'disabled:opacity-[0.45] disabled:cursor-wait',
            )}
            type="button"
            aria-label="2x2 切图"
            title="2x2 切图"
            disabled={splittingGridSize !== null}
            onClick={() => { void handleImageGridSplit(2) }}
          >
            <IconLayoutGrid size={16} stroke={1.8} />
          </button>
          <button
            className={cn(
              'inline-flex items-center justify-center',
              'w-[34px] min-h-[34px] p-0 border-0 rounded-[9px]',
              'bg-transparent text-nomi-ink-80 font-[inherit] text-[13px] leading-none cursor-pointer',
              'hover:bg-nomi-ink-05 hover:text-nomi-ink',
              'disabled:opacity-[0.45] disabled:cursor-wait',
            )}
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

      <header className={cn(
        'generation-canvas-v2-node__header',
        'absolute top-[10px] left-[10px] right-[10px] z-[2]',
        'flex items-center justify-start gap-2 min-h-0 p-0',
        'pointer-events-auto cursor-grab',
      )}>
        {showStatusBadge ? (
          <span
            className={cn(
              'text-[10.5px] font-medium tracking-[0.06em] uppercase',
              'py-[3px] px-2 rounded-[4px] backdrop-blur-[8px]',
              'bg-nomi-paper/[0.82] text-nomi-ink-60',
              'data-[status=success]:text-workbench-success-ink data-[status=success]:bg-workbench-success-soft',
              'data-[status=error]:text-workbench-danger data-[status=error]:bg-workbench-danger-soft',
            )}
            data-status={status}
          >
            {STATUS_LABEL[status] ?? status}
          </span>
        ) : null}
      </header>

      {status === 'error' && node.error && !selected ? (
        <div className="generation-canvas-v2-node__error-peek" title={node.error}>
          {node.error.length > 40 ? node.error.slice(0, 40) + '…' : node.error}
        </div>
      ) : null}

      <div
        className={cn(
          'generation-canvas-v2-node__preview',
          'relative w-full h-full min-h-0 overflow-hidden',
          'rounded-nomi shadow-nomi-md cursor-grab touch-none',
          'bg-[repeating-linear-gradient(45deg,var(--nomi-ink-05)_0_10px,var(--nomi-ink-10)_10px_20px)]',
        )}
        data-timeline-draggable={canSendToTimeline ? 'true' : 'false'}
        draggable={false}
      >
        {node.kind === 'semanticScene' ? (
          <React.Suspense fallback={<SemanticSceneNodeLoading />}>
            <SemanticSceneNode
              node={node}
              selected={selected}
              width={visualSize.width}
              height={previewHeight}
              readOnly={readOnly}
            />
          </React.Suspense>
        ) : node.kind === 'scene3d' ? (
          <React.Suspense fallback={<Scene3DEditorLoading />}>
            <Scene3DEditor
              node={node}
              width={visualSize.width}
              height={previewHeight}
              readOnly={readOnly}
            />
          </React.Suspense>
        ) : node.kind === 'panorama' ? (
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
            <div className={cn('flex w-full h-full items-center justify-center')}>
              <label
                className={cn(
                  'inline-flex items-center justify-center',
                  'min-w-[156px] min-h-[48px] px-[18px]',
                  'text-nomi-ink-60 text-[13px] cursor-pointer',
                )}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <span>+ 上传全景图</span>
                <input className="hidden" type="file" accept="image/*" onChange={handlePanoramaFileChange} />
              </label>
            </div>
          )
        ) : node.result?.url ? (
          node.result.type === 'video' ? (
            <video
              className={cn(
                'w-full h-full min-h-0 object-contain pointer-events-auto',
                'bg-nomi-ink-05 select-none',
              )}
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
              className={cn(
                'w-full h-full min-h-0 object-contain pointer-events-none',
                'bg-nomi-ink-05 select-none',
              )}
              src={node.result.url}
              alt=""
              draggable={false}
              onLoad={(event) => {
                updateMediaDimensions(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)
              }}
            />
          )
        ) : (
          <div className={cn('flex w-full h-full items-center justify-center flex-col gap-1 text-nomi-ink-60')}>
            {selected ? null : <span style={{ fontSize: 11, opacity: 0.45, pointerEvents: 'none' }}>点击节点填写提示词</span>}
          </div>
        )}
      </div>

      {canSendToTimeline && !readOnly ? (
        <WorkbenchButton
          className={cn(
            'generation-canvas-v2-node__timeline-drag',
            'absolute top-1/2 right-[-26px] z-[7]',
            'inline-grid grid-rows-[repeat(3,1fr)] items-center justify-center gap-[3px]',
            'w-[18px] h-[42px] m-0 py-2 px-[5px] border-0 rounded-full',
            'bg-nomi-paper/[0.8] text-nomi-ink-50 font-[inherit]',
            'cursor-grab backdrop-blur-[8px] shadow-nomi-sm',
            'opacity-0 -translate-y-1/2 transition-[opacity,color,background] duration-150 ease-out',
            'active:cursor-grabbing',
            'hover:bg-nomi-paper hover:text-nomi-ink-80',
          )}
          aria-label="拖到时间线"
          title="拖到时间线"
          draggable
          onDragStart={(event) => handleTimelineDragStart(event)}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span className={cn('block w-2 h-[1.5px] rounded-full bg-current')} />
          <span className={cn('block w-2 h-[1.5px] rounded-full bg-current')} />
          <span className={cn('block w-2 h-[1.5px] rounded-full bg-current')} />
        </WorkbenchButton>
      ) : null}

      {selected && !readOnly && node.kind !== 'panorama' && node.kind !== 'semanticScene' && node.kind !== 'scene3d' ? (
        <div
          className={cn(
            'generation-canvas-v2-node__composer',
            'absolute left-1/2 z-[8] flex flex-col gap-[6px]',
            'min-h-[150px] p-[10px]',
            'border border-nomi-line-soft rounded-nomi',
            'bg-nomi-paper shadow-nomi-lg overflow-auto',
            '-translate-x-1/2',
          )}
          style={{
            width: composerLayout.width,
            maxHeight: composerLayout.maxHeight,
            top: `calc(100% + ${composerLayout.gap}px)`,
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <>
            {isImageLikeGenerationNodeKind(node.kind) || isVideoLikeGenerationNodeKind(node.kind) ? (
                <NodeParameterControls node={node} section="references" valueOnly />
              ) : null}
              <textarea
                className={cn(
                  'generation-canvas-v2-node__prompt-input',
                  'flex-1 w-full min-h-[38px] p-0 border-0 outline-0 resize-none',
                  'bg-transparent text-nomi-ink font-[inherit] text-[12.5px] leading-[1.5]',
                  'placeholder:text-nomi-ink-40',
                )}
                value={node.prompt}
                rows={composerLayout.promptRows}
                placeholder={getGenerationNodePromptPlaceholder(node.kind)}
                onChange={(event) => updateNode(node.id, { prompt: event.currentTarget.value })}
                onBlur={() => { void persistActiveWorkbenchProjectNow().catch(() => {}) }}
              />
              {status === 'error' && node.error ? (
                <div
                  className={cn(
                    'py-[7px] px-[9px] rounded-nomi-sm',
                    'bg-workbench-danger-soft text-workbench-danger text-[11.5px] leading-[1.35]',
                  )}
                  role="alert"
                >
                  生成失败：{node.error}
                </div>
              ) : null}
              <div className={cn('flex items-center gap-1 mt-auto min-w-0 pt-1')}>
                <NodeParameterControls node={node} section="parameters" valueOnly />
                {(() => {
                  const disabledReason = !canGenerate && !isGenerating
                    ? nodeExecutionKind === 'video'
                      ? '需要先连接一个图片节点作为首帧'
                      : nodeExecutionKind === 'image'
                        ? undefined
                        : `「${node.kind}」类型暂不支持直接生成`
                    : undefined
                  return (
                    <span title={disabledReason} style={{ display: 'contents' }}>
                      <WorkbenchButton
                        className={cn(
                          'inline-flex items-center shrink-0 min-h-[24px] py-1 px-[10px]',
                          'border-0 rounded-full bg-nomi-ink text-nomi-paper',
                          'font-[inherit] text-[11px] font-medium whitespace-nowrap',
                          'hover:enabled:bg-nomi-accent',
                          'disabled:bg-nomi-ink-20 disabled:text-nomi-ink-40 disabled:cursor-not-allowed',
                        )}
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
          className={cn(
            'generation-canvas-v2-node__resize-zone',
            `generation-canvas-v2-node__resize-zone--${direction}`,
            'absolute z-[6] p-0 border-0 bg-transparent',
            'focus-visible:outline-2 focus-visible:outline-nomi-accent focus-visible:outline-offset-2',
            (direction === 'n' || direction === 's') && 'left-[10px] w-[calc(100%-20px)] h-[10px] cursor-ns-resize',
            direction === 'n' && 'top-[-5px]',
            direction === 's' && 'bottom-[-5px]',
            (direction === 'e' || direction === 'w') && 'top-[10px] w-[10px] h-[calc(100%-20px)] cursor-ew-resize',
            direction === 'e' && 'right-[-5px]',
            direction === 'w' && 'left-[-5px]',
            (direction === 'ne' || direction === 'nw' || direction === 'se' || direction === 'sw') && 'w-4 h-4',
            (direction === 'ne' || direction === 'sw') && 'cursor-nesw-resize',
            (direction === 'nw' || direction === 'se') && 'cursor-nwse-resize',
            direction === 'ne' && 'top-[-8px] right-[-8px]',
            direction === 'nw' && 'top-[-8px] left-[-8px]',
            direction === 'se' && 'right-[-8px] bottom-[-8px]',
            direction === 'sw' && 'bottom-[-8px] left-[-8px]',
          )}
          aria-label={`从${direction}方向调整节点尺寸`}
          title="调整节点尺寸"
          onPointerDown={handleResizePointerDown(direction)}
        />
      )) : null}
    </article>
  )
}
