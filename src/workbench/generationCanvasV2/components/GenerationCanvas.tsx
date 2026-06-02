import React from 'react'
import { IconCopy, IconCut, IconX } from '@tabler/icons-react'
import { Scissors } from 'lucide-react'
import { WorkbenchButton, WorkbenchIconButton } from '../../../design'
import { toast } from '../../../ui/toast'
import { cn } from '../../../utils/cn'
import CanvasToolbar, { NodeAddMenu } from './CanvasToolbar'
import { importImageFilesToGenerationCanvas } from '../adapters/assetImportAdapter'
import { getDesktopBridge } from '../../../desktop/bridge'
import { EDGE_MODE_LABEL } from '../model/graphOps'
import type { GenerationCanvasNode, GenerationNodeKind } from '../model/generationCanvasTypes'
import { getGenerationNodeComponent } from '../nodes/renderRegistry'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { notifyModelOptionsRefresh, useModelOptionsState } from '../../../config/useModelOptions'
import '../styles/generationCanvas.css'

const GENERATION_PROVIDER = 'chatfire'
const GENERATION_DEFAULT_BASE_URL = 'https://api.chatfire.site'
const OPEN_MODEL_CATALOG_EVENT = 'nomi-open-model-catalog'
const WHEEL_ZOOM_FACTOR = 1.24
const WHEEL_ZOOM_DELTA = 120
const WHEEL_LINE_HEIGHT = 16
const WHEEL_PAGE_HEIGHT = 800

type GenerationCanvasProps = {
  readOnly?: boolean
}

type WheelZoomEvent = Pick<WheelEvent, 'deltaMode' | 'deltaY'>

type ActiveEdge = {
  id: string
  position?: { x: number; y: number }
}

function readProviderSetting(key: 'apiKey' | 'baseUrl'): string {
  if (typeof window === 'undefined') return key === 'baseUrl' ? GENERATION_DEFAULT_BASE_URL : ''
  try {
    const storageKey = key === 'apiKey' ? 'api-keys-by-provider' : 'base-urls-by-provider'
    const value = JSON.parse(window.localStorage.getItem(storageKey) || '{}') as Record<string, unknown>
    const configured = typeof value[GENERATION_PROVIDER] === 'string' ? value[GENERATION_PROVIDER].trim() : ''
    if (configured) return configured
  } catch {
    // ignore invalid local settings
  }
  if (key === 'apiKey') {
    try {
      return window.localStorage.getItem('tapcanvas_public_api_key')?.trim() || ''
    } catch {
      return ''
    }
  }
  return GENERATION_DEFAULT_BASE_URL
}

function writeProviderSettings(apiKey: string, baseUrl: string) {
  if (typeof window === 'undefined') return
  const nextKey = apiKey.trim()
  const nextBaseUrl = baseUrl.trim() || GENERATION_DEFAULT_BASE_URL
  const apiKeys = JSON.parse(window.localStorage.getItem('api-keys-by-provider') || '{}') as Record<string, string>
  const baseUrls = JSON.parse(window.localStorage.getItem('base-urls-by-provider') || '{}') as Record<string, string>
  if (nextKey) apiKeys[GENERATION_PROVIDER] = nextKey
  else delete apiKeys[GENERATION_PROVIDER]
  baseUrls[GENERATION_PROVIDER] = nextBaseUrl
  window.localStorage.setItem('api-keys-by-provider', JSON.stringify(apiKeys))
  window.localStorage.setItem('base-urls-by-provider', JSON.stringify(baseUrls))
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function getWheelZoomFactor(event: WheelZoomEvent): number {
  const deltaModeMultiplier = event.deltaMode === 1
    ? WHEEL_LINE_HEIGHT
    : event.deltaMode === 2
      ? WHEEL_PAGE_HEIGHT
      : 1
  const deltaPixels = clampNumber(event.deltaY * deltaModeMultiplier, -WHEEL_ZOOM_DELTA, WHEEL_ZOOM_DELTA)
  return Math.pow(WHEEL_ZOOM_FACTOR, -deltaPixels / WHEEL_ZOOM_DELTA)
}

function createInitialViewport(): { zoom: number; offset: { x: number; y: number } } {
  if (typeof window !== 'undefined' && window.innerWidth < 700) {
    return {
      zoom: 0.86,
      offset: { x: -20, y: -220 },
    }
  }
  return {
    zoom: 1,
    offset: { x: 0, y: 0 },
  }
}

function getNodeSize(node: GenerationCanvasNode): { width: number; height: number } {
  return {
    width: node.size?.width || 300,
    height: node.size?.height || 220,
  }
}

function getSelectedBounds(nodes: readonly GenerationCanvasNode[], selectedNodeIds: readonly string[]): {
  minX: number
  minY: number
  width: number
} | null {
  const selected = new Set(selectedNodeIds)
  const selectedNodes = nodes.filter((node) => selected.has(node.id))
  if (!selectedNodes.length) return null
  const minX = Math.min(...selectedNodes.map((node) => node.position.x))
  const minY = Math.min(...selectedNodes.map((node) => node.position.y))
  const maxX = Math.max(...selectedNodes.map((node) => node.position.x + getNodeSize(node).width))
  return {
    minX,
    minY,
    width: Math.max(0, maxX - minX),
  }
}

export default function GenerationCanvas({ readOnly = false }: GenerationCanvasProps): JSX.Element {
  const isReady = useGenerationCanvasStore((state) => state.isReady)
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const edges = useGenerationCanvasStore((state) => state.edges)
  const selectedNodeIds = useGenerationCanvasStore((state) => state.selectedNodeIds)
  const addNode = useGenerationCanvasStore((state) => state.addNode)
  const clearSelection = useGenerationCanvasStore((state) => state.clearSelection)
  const setCanvasZoom = useGenerationCanvasStore((state) => state.setCanvasZoom)
  const deleteSelectedNodes = useGenerationCanvasStore((state) => state.deleteSelectedNodes)
  const copySelectedNodes = useGenerationCanvasStore((state) => state.copySelectedNodes)
  const cutSelectedNodes = useGenerationCanvasStore((state) => state.cutSelectedNodes)
  const pasteNodes = useGenerationCanvasStore((state) => state.pasteNodes)
  const selectNodesInRect = useGenerationCanvasStore((state) => state.selectNodesInRect)
  const disconnectEdge = useGenerationCanvasStore((state) => state.disconnectEdge)
  const pendingConnectionSourceId = useGenerationCanvasStore((state) => state.pendingConnectionSourceId)
  const connectToNode = useGenerationCanvasStore((state) => state.connectToNode)
  const cancelConnection = useGenerationCanvasStore((state) => state.cancelConnection)
  const undo = useGenerationCanvasStore((state) => state.undo)
  const redo = useGenerationCanvasStore((state) => state.redo)
  const markReady = useGenerationCanvasStore((state) => state.markReady)
  const selectedSet = React.useMemo(() => new Set(selectedNodeIds), [selectedNodeIds])
  const nodeById = React.useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const selectedBounds = React.useMemo(() => getSelectedBounds(nodes, selectedNodeIds), [nodes, selectedNodeIds])
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [apiKey, setApiKey] = React.useState(() => readProviderSetting('apiKey'))
  const [baseUrl, setBaseUrl] = React.useState(() => readProviderSetting('baseUrl'))
  const [settingsSaved, setSettingsSaved] = React.useState(false)
  const hasApiKey = apiKey.trim().length > 0
  const imageModelOptionsState = useModelOptionsState('image')
  const videoModelOptionsState = useModelOptionsState('video')
  const imageModelOptions = imageModelOptionsState.options
  const videoModelOptions = videoModelOptionsState.options
  const modelOptionsStatusMessage = imageModelOptionsState.statusMessage || videoModelOptionsState.statusMessage

  // Pan/zoom state
  const initialViewport = React.useMemo(() => createInitialViewport(), [])
  const [zoom, setZoom] = React.useState(initialViewport.zoom)
  const [offset, setOffset] = React.useState(initialViewport.offset)
  const isPanningRef = React.useRef(false)
  const panStartRef = React.useRef<{ clientX: number; clientY: number; offsetX: number; offsetY: number } | null>(null)
  const offsetFrameRef = React.useRef<number | null>(null)
  const pendingOffsetRef = React.useRef<{ x: number; y: number } | null>(null)
  const boxSelectRef = React.useRef<{
    additive: boolean
    originClientX: number
    originClientY: number
    originCanvasX: number
    originCanvasY: number
  } | null>(null)
  const stageRef = React.useRef<HTMLDivElement>(null)
  const [selectionBox, setSelectionBox] = React.useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)
  const [contextNodeMenu, setContextNodeMenu] = React.useState<{
    stageX: number
    stageY: number
    canvasX: number
    canvasY: number
  } | null>(null)
  const [pendingCursorPos, setPendingCursorPos] = React.useState<{ x: number; y: number } | null>(null)
  const [isPanning, setIsPanning] = React.useState(false)
  const [activeEdge, setActiveEdge] = React.useState<ActiveEdge | null>(null)
  const activeEdgeId = activeEdge?.id ?? null

  React.useEffect(() => {
    markReady()
  }, [markReady])

  React.useEffect(() => {
    if (!activeEdgeId || edges.some((edge) => edge.id === activeEdgeId)) return
    setActiveEdge(null)
  }, [activeEdgeId, edges])

  // Refs so drag-connection effect can read latest values without re-subscribing
  const offsetRef = React.useRef(offset)
  offsetRef.current = offset
  const zoomRef = React.useRef(zoom)
  zoomRef.current = zoom
  const nodesRef = React.useRef(nodes)
  nodesRef.current = nodes

  const scheduleOffset = React.useCallback((nextOffset: { x: number; y: number }) => {
    offsetRef.current = nextOffset
    pendingOffsetRef.current = nextOffset
    if (offsetFrameRef.current !== null) return
    offsetFrameRef.current = window.requestAnimationFrame(() => {
      offsetFrameRef.current = null
      const pending = pendingOffsetRef.current
      pendingOffsetRef.current = null
      if (pending) setOffset(pending)
    })
  }, [])

  React.useEffect(() => () => {
    if (offsetFrameRef.current !== null) {
      window.cancelAnimationFrame(offsetFrameRef.current)
      offsetFrameRef.current = null
    }
  }, [])

  // Keep store zoom in sync so BaseGenerationNode can read it
  React.useEffect(() => {
    setCanvasZoom(zoom)
  }, [zoom, setCanvasZoom])

  React.useEffect(() => {
    if (!contextNodeMenu) return undefined
    const closeMenu = () => setContextNodeMenu(null)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }
    window.addEventListener('pointerdown', closeMenu)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('blur', closeMenu)
    return () => {
      window.removeEventListener('pointerdown', closeMenu)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('blur', closeMenu)
    }
  }, [contextNodeMenu])

  // Drag-to-connect: track pointer while a connection is being drawn
  React.useEffect(() => {
    if (readOnly) return undefined
    if (!pendingConnectionSourceId) {
      setPendingCursorPos(null)
      return
    }
    const handleMove = (event: PointerEvent) => {
      if (!stageRef.current) return
      const rect = stageRef.current.getBoundingClientRect()
      const o = offsetRef.current
      const z = zoomRef.current
      setPendingCursorPos({
        x: (event.clientX - rect.left - o.x) / z,
        y: (event.clientY - rect.top - o.y) / z,
      })
    }
    const handleUp = (event: PointerEvent) => {
      if (!stageRef.current) return
      const rect = stageRef.current.getBoundingClientRect()
      const canvasX = (event.clientX - rect.left - offsetRef.current.x) / zoomRef.current
      const canvasY = (event.clientY - rect.top - offsetRef.current.y) / zoomRef.current
      const targetNode = nodesRef.current.find((n) => {
        const w = n.size?.width || 300
        const h = n.size?.height || 220
        return canvasX >= n.position.x && canvasX <= n.position.x + w &&
               canvasY >= n.position.y && canvasY <= n.position.y + h
      })
      if (targetNode && targetNode.id !== pendingConnectionSourceId) {
        connectToNode(targetNode.id)
      } else {
        cancelConnection()
      }
      setPendingCursorPos(null)
    }
    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleUp)
    return () => {
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleUp)
    }
  }, [pendingConnectionSourceId, connectToNode, cancelConnection, readOnly])

  React.useEffect(() => {
    if (readOnly) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      const key = event.key.toLowerCase()
      const mod = event.metaKey || event.ctrlKey
      if (event.key === 'Escape') {
        setActiveEdge(null)
        cancelConnection()
        return
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        if (!selectedNodeIds.length) return
        event.preventDefault()
        deleteSelectedNodes()
        return
      }
      if (!mod) return
      if (key === 'c') {
        event.preventDefault()
        copySelectedNodes()
        return
      }
      if (key === 'x') {
        event.preventDefault()
        cutSelectedNodes()
        return
      }
      if (key === 'v') {
        event.preventDefault()
        pasteNodes()
        return
      }
      if (key === 'z' && event.shiftKey) {
        event.preventDefault()
        redo()
        return
      }
      if (key === 'z') {
        event.preventDefault()
        undo()
        return
      }
      if (key === 'y') {
        event.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [cancelConnection, copySelectedNodes, cutSelectedNodes, deleteSelectedNodes, pasteNodes, readOnly, redo, selectedNodeIds.length, undo])

  React.useEffect(() => {
    const handleOpenSettings = () => {
      setSettingsOpen(true)
      setSettingsSaved(false)
    }
    window.addEventListener('nomi-open-generation-settings', handleOpenSettings)
    return () => window.removeEventListener('nomi-open-generation-settings', handleOpenSettings)
  }, [])

  const handleSaveSettings = () => {
    writeProviderSettings(apiKey, baseUrl)
    const desktop = getDesktopBridge()
    if (desktop) {
      desktop.modelCatalog.upsertVendor({
        key: GENERATION_PROVIDER,
        name: 'ChatFire OpenAI Compatible',
        enabled: true,
        baseUrlHint: baseUrl.trim() || GENERATION_DEFAULT_BASE_URL,
        authType: 'bearer',
      })
      if (apiKey.trim()) {
        desktop.modelCatalog.upsertVendorApiKey(GENERATION_PROVIDER, { apiKey: apiKey.trim(), enabled: true })
      }
      notifyModelOptionsRefresh('all')
    }
    setApiKey(readProviderSetting('apiKey'))
    setBaseUrl(readProviderSetting('baseUrl'))
    setSettingsSaved(true)
  }

  const handleStageDrop = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (readOnly) return
    const files = Array.from(event.dataTransfer.files || []).filter((file) => file.type.startsWith('image/'))
    if (!files.length) return
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    void importImageFilesToGenerationCanvas(files, {
      basePosition: {
        x: (event.clientX - rect.left - offset.x) / zoom,
        y: (event.clientY - rect.top - offset.y) / zoom,
      },
    })
  }, [offset, readOnly, zoom])

  const handleStagePanStart = (event: React.PointerEvent<HTMLDivElement>) => {
    setContextNodeMenu(null)
    setActiveEdge(null)
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest(
      '.generation-canvas-v2-node, .generation-canvas-v2-toolbar, .generation-canvas-v2__zoom-bar, .generation-canvas-v2__selection-toolbar, .generation-canvas-v2__edge-hit, .generation-canvas-v2__edge-cut, button, input, textarea, select, [role="menu"], [role="menuitem"]',
    )) {
      return
    }
    if (pendingConnectionSourceId && !readOnly) {
      cancelConnection()
    }
    // Left drag on empty canvas = pan
    isPanningRef.current = true
    setIsPanning(true)
    panStartRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      offsetX: offset.x,
      offsetY: offset.y,
    }
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
  }

  const handleStagePanMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanningRef.current || !panStartRef.current) return
    scheduleOffset({
      x: panStartRef.current.offsetX + (event.clientX - panStartRef.current.clientX),
      y: panStartRef.current.offsetY + (event.clientY - panStartRef.current.clientY),
    })
  }

  const handleStagePanEnd = (event?: React.PointerEvent<HTMLDivElement>) => {
    if (isPanningRef.current && panStartRef.current && event) {
      const dx = Math.abs(event.clientX - panStartRef.current.clientX)
      const dy = Math.abs(event.clientY - panStartRef.current.clientY)
      // Pure click (no drag) on empty canvas = clear selection
      if (dx < 4 && dy < 4) clearSelection()
    }
    isPanningRef.current = false
    setIsPanning(false)
    panStartRef.current = null
    boxSelectRef.current = null
    if (offsetFrameRef.current !== null) {
      window.cancelAnimationFrame(offsetFrameRef.current)
      offsetFrameRef.current = null
    }
    if (pendingOffsetRef.current) {
      setOffset(pendingOffsetRef.current)
      pendingOffsetRef.current = null
    }
    setSelectionBox(null)
    if (event &&
      typeof event.currentTarget.hasPointerCapture === 'function' &&
      typeof event.currentTarget.releasePointerCapture === 'function' &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleStagePointerDownCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!activeEdgeId) return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('.generation-canvas-v2__edge-hit, .generation-canvas-v2__edge-cut')) return
    setActiveEdge(null)
  }

  const getCanvasPointFromClientPoint = React.useCallback((clientX: number, clientY: number) => {
    if (!stageRef.current) return null
    const rect = stageRef.current.getBoundingClientRect()
    return {
      x: (clientX - rect.left - offsetRef.current.x) / zoomRef.current,
      y: (clientY - rect.top - offsetRef.current.y) / zoomRef.current,
    }
  }, [])

  const handleWheel = React.useCallback((event: WheelEvent) => {
    event.preventDefault()
    setContextNodeMenu(null)
    if (!stageRef.current) return
    const rect = stageRef.current.getBoundingClientRect()
    const mouseX = event.clientX - rect.left
    const mouseY = event.clientY - rect.top
    const currentZoom = zoomRef.current
    const currentOffset = offsetRef.current
    const nextZoom = clampNumber(currentZoom * getWheelZoomFactor(event), 0.2, 3)
    const zoomRatio = nextZoom / currentZoom
    const nextOffset = {
      x: mouseX - (mouseX - currentOffset.x) * zoomRatio,
      y: mouseY - (mouseY - currentOffset.y) * zoomRatio,
    }
    zoomRef.current = nextZoom
    scheduleOffset(nextOffset)
    setZoom(nextZoom)
  }, [scheduleOffset])

  React.useEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    stage.addEventListener('wheel', handleWheel, { passive: false })
    return () => stage.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  const handleStageContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    if (readOnly || !stageRef.current) return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest(
      '.generation-canvas-v2-node, .generation-canvas-v2-toolbar, .generation-canvas-v2__zoom-bar, .generation-canvas-v2__selection-toolbar, .generation-canvas-v2__edge, .generation-canvas-v2__edge-preview, button, input, textarea, select, [role="menu"], [role="menuitem"]',
    )) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    clearSelection()
    const rect = stageRef.current.getBoundingClientRect()
    const stageX = event.clientX - rect.left
    const stageY = event.clientY - rect.top
    const menuWidth = 148
    const menuHeight = 330
    setContextNodeMenu({
      stageX: clampNumber(stageX, 8, Math.max(8, rect.width - menuWidth - 8)),
      stageY: clampNumber(stageY, 8, Math.max(8, rect.height - menuHeight - 8)),
      canvasX: Math.round((stageX - offsetRef.current.x) / zoomRef.current),
      canvasY: Math.round((stageY - offsetRef.current.y) / zoomRef.current),
    })
  }

  const handleAddContextNode = (kind: GenerationNodeKind) => {
    if (!contextNodeMenu) return
    addNode({ kind, position: { x: contextNodeMenu.canvasX, y: contextNodeMenu.canvasY } })
    setContextNodeMenu(null)
  }

  const fitView = React.useCallback(() => {
    if (!nodes.length || !stageRef.current) return
    const rect = stageRef.current.getBoundingClientRect()
    const padding = 80
    const minX = Math.min(...nodes.map((n) => n.position.x))
    const minY = Math.min(...nodes.map((n) => n.position.y))
    const maxX = Math.max(...nodes.map((n) => n.position.x + (n.size?.width || 300)))
    const maxY = Math.max(...nodes.map((n) => n.position.y + (n.size?.height || 220)))
    const contentW = maxX - minX + padding * 2
    const contentH = maxY - minY + padding * 2
    const nextZoom = Math.min(1.2, Math.min(rect.width / contentW, rect.height / contentH))
    setZoom(nextZoom)
    setOffset({
      x: (rect.width - contentW * nextZoom) / 2 - (minX - padding) * nextZoom,
      y: (rect.height - contentH * nextZoom) / 2 - (minY - padding) * nextZoom,
    })
  }, [nodes])

  const getToolbarInsertionPosition = React.useCallback(() => {
    const rect = stageRef.current?.getBoundingClientRect()
    const viewportAnchor = rect
      ? { x: rect.width * 0.38, y: rect.height * 0.42 }
      : { x: 360, y: 280 }
    const basePosition = {
      x: Math.round((viewportAnchor.x - offset.x) / zoom),
      y: Math.round((viewportAnchor.y - offset.y) / zoom),
    }
    const occupied = new Set(nodes.map((node) => `${Math.round(node.position.x)},${Math.round(node.position.y)}`))
    for (let index = 0; index < 12; index += 1) {
      const candidate = {
        x: basePosition.x + index * 34,
        y: basePosition.y + index * 28,
      }
      if (!occupied.has(`${candidate.x},${candidate.y}`)) return candidate
    }
    return basePosition
  }, [nodes, offset.x, offset.y, zoom])

  const zoomPercent = Math.round(zoom * 100)
  const selectedCount = selectedNodeIds.length

  return (
    <section
      className={cn(
        'generation-canvas-v2',
        'grid grid-rows-[minmax(0,1fr)] w-full h-full min-w-0 min-h-0 bg-[#f7f7f9] text-workbench-ink',
      )}
      aria-label="AI 影像创作画布"
      data-ready={isReady ? 'true' : undefined}
    >
      <div className={cn('generation-canvas-v2__main', 'relative w-full h-full min-w-0 min-h-0')}>
        {settingsOpen ? (
          <div
            className={cn(
              'generation-canvas-v2__provider-popover',
              'absolute top-4 right-4 z-[12] grid gap-[10px]',
              'w-[min(360px,calc(100vw-40px))] p-3',
              'border border-workbench-border rounded-[12px]',
              'bg-white/[0.98] shadow-workbench-pop pointer-events-auto',
            )}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div
              className={cn(
                'flex items-center justify-between gap-2 pb-2',
                'border-b border-workbench-border/[0.58] text-workbench-muted text-xs',
              )}
              aria-label="模型目录状态"
            >
              <span>系统模型目录</span>
              <strong className="text-workbench-ink text-xs font-[650]">{imageModelOptions.length} 图 / {videoModelOptions.length} 视频</strong>
              <WorkbenchButton onClick={() => { window.dispatchEvent(new CustomEvent(OPEN_MODEL_CATALOG_EVENT)) }}>接入模型</WorkbenchButton>
            </div>
            <p className={cn('m-0 text-workbench-muted text-xs leading-[1.45]')}>
              {modelOptionsStatusMessage
                ? modelOptionsStatusMessage
                : '可选模型来自模型目录；没有模型时请打开"模型接入"，让 Agent 根据官方文档生成草案并确认写入。'}
            </p>
            <label className="grid gap-[5px] text-workbench-muted text-xs">
              <span>API Key</span>
              <input
                className={cn(
                  'h-[34px] min-w-0 px-[10px]',
                  'border border-workbench-border rounded-workbench-control',
                  'bg-workbench-surface-solid text-workbench-ink font-[inherit] text-[13px]',
                )}
                type="password"
                value={apiKey}
                placeholder="粘贴生成渠道 API Key"
                onChange={(event) => {
                  setApiKey(event.target.value)
                  setSettingsSaved(false)
                }}
              />
            </label>
            <label className="grid gap-[5px] text-workbench-muted text-xs">
              <span>Base URL</span>
              <input
                className={cn(
                  'h-[34px] min-w-0 px-[10px]',
                  'border border-workbench-border rounded-workbench-control',
                  'bg-workbench-surface-solid text-workbench-ink font-[inherit] text-[13px]',
                )}
                value={baseUrl}
                placeholder={GENERATION_DEFAULT_BASE_URL}
                onChange={(event) => {
                  setBaseUrl(event.target.value)
                  setSettingsSaved(false)
                }}
              />
            </label>
            <div className={cn('flex justify-end gap-2')}>
              <WorkbenchButton onClick={handleSaveSettings}>保存</WorkbenchButton>
              <WorkbenchButton onClick={() => setSettingsOpen(false)}>关闭</WorkbenchButton>
            </div>
            <p className="m-0 text-xs" data-tone={hasApiKey ? 'success' : 'error'}>
              {settingsSaved ? '已保存生成渠道配置。' : hasApiKey ? '当前已配置生成渠道 Key。' : '旧渠道 Key 未配置；新模型优先通过"模型接入"写入模型目录。'}
            </p>
          </div>
        ) : null}
        {!readOnly ? <CanvasToolbar getInsertionPosition={getToolbarInsertionPosition} /> : null}
        <div
          className="generation-canvas-v2__stage"
          ref={stageRef}
          data-panning={isPanning ? 'true' : undefined}
          onPointerDownCapture={handleStagePointerDownCapture}
          onPointerDown={handleStagePanStart}
          onPointerMove={handleStagePanMove}
          onPointerUp={handleStagePanEnd}
          onContextMenu={handleStageContextMenu}
          onDragOver={(event) => {
            if (readOnly) return
            if (Array.from(event.dataTransfer.types).includes('Files')) {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }
          }}
          onDrop={handleStageDrop}
        >
          <div
            className={cn('generation-canvas-v2__canvas', 'absolute inset-0 origin-top-left')}
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
          >
            <svg className="generation-canvas-v2__edges" aria-label="节点连接线">
              {edges.map((edge) => {
                const source = nodeById.get(edge.source)
                const target = nodeById.get(edge.target)
                if (!source || !target) return null
                const sourceSize = source.size || { width: 300, height: 220 }
                const targetSize = target.size || { width: 300, height: 220 }
                const startX = source.position.x + sourceSize.width
                const startY = source.position.y + sourceSize.height / 2
                const endX = target.position.x
                const endY = target.position.y + targetSize.height / 2
                const control = Math.max(64, Math.min(140, Math.abs(endX - startX) * 0.45))
                const mode = edge.mode || 'reference'
                const midX = (startX + endX) / 2
                const midY = (startY + endY) / 2
                const path = `M ${startX} ${startY} C ${startX + control} ${startY}, ${endX - control} ${endY}, ${endX} ${endY}`
                const isActiveEdge = activeEdgeId === edge.id
                const cutPosition = isActiveEdge && activeEdge?.position ? activeEdge.position : { x: midX, y: midY }
                return (
                  <g key={edge.id} className="generation-canvas-v2__edge" data-mode={mode} data-active={isActiveEdge ? 'true' : undefined}>
                    <path className="generation-canvas-v2__edge-path" d={path} />
                    {!readOnly ? (
                      <path
                        className="generation-canvas-v2__edge-hit"
                        d={path}
                        role="button"
                        tabIndex={0}
                        aria-label={`选择连接线：${source.title} 到 ${target.title}`}
                        onPointerDown={(event) => {
                          event.stopPropagation()
                          setActiveEdge({
                            id: edge.id,
                            position: getCanvasPointFromClientPoint(event.clientX, event.clientY) ?? { x: midX, y: midY },
                          })
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return
                          event.preventDefault()
                          setActiveEdge({ id: edge.id })
                        }}
                      />
                    ) : null}
                    {isActiveEdge && !readOnly ? (
                      <foreignObject className="generation-canvas-v2__edge-cut-object" x={cutPosition.x - 18} y={cutPosition.y - 18} width="36" height="36">
                        <div className={cn('generation-canvas-v2__edge-cut-wrap', 'grid w-9 h-9 place-items-center pointer-events-auto')}>
                          <button
                            type="button"
                            className={cn(
                              'generation-canvas-v2__edge-cut',
                              'inline-grid w-[30px] h-[30px] place-items-center p-0 border-0 rounded-full',
                              'bg-nomi-paper text-workbench-danger cursor-pointer',
                              'shadow-[0_8px_24px_rgba(18,24,38,0.18),0_0_0_1px_rgba(18,24,38,0.08)]',
                              'hover:bg-workbench-danger hover:text-nomi-paper',
                            )}
                            aria-label={`断开连接：${source.title} 到 ${target.title}`}
                            title={`断开连接：${EDGE_MODE_LABEL[mode]}`}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation()
                              disconnectEdge(edge.id)
                              setActiveEdge(null)
                            }}
                          >
                            <Scissors size={16} strokeWidth={2.2} aria-hidden="true" />
                          </button>
                        </div>
                      </foreignObject>
                    ) : null}
                  </g>
                )
              })}
              {(() => {
                if (!pendingConnectionSourceId || !pendingCursorPos) return null
                const sourceNode = nodeById.get(pendingConnectionSourceId)
                if (!sourceNode) return null
                const sourceSize = getNodeSize(sourceNode)
                const startX = sourceNode.position.x + sourceSize.width
                const startY = sourceNode.position.y + sourceSize.height / 2
                const endX = pendingCursorPos.x
                const endY = pendingCursorPos.y
                const ctrl = Math.max(40, Math.abs(endX - startX) * 0.45)
                return (
                  <path
                    className="generation-canvas-v2__edge-preview"
                    d={`M ${startX} ${startY} C ${startX + ctrl} ${startY}, ${endX - ctrl} ${endY}, ${endX} ${endY}`}
                  />
                )
              })()}
            </svg>
            <div className={cn('generation-canvas-v2__nodes', 'absolute top-0 left-0 w-[4000px] h-[3000px]')}>
              <React.Suspense fallback={null}>
                {nodes.map((node) => {
                  const NodeComponent = getGenerationNodeComponent(node.kind)
                  return (
                    <NodeComponent key={node.id} node={node} selected={selectedSet.has(node.id)} readOnly={readOnly} />
                  )
                })}
              </React.Suspense>
            </div>
            {selectedBounds && selectedCount > 1 && !readOnly ? (
              <div
                className={cn(
                  'generation-canvas-v2__selection-toolbar',
                  'absolute z-[11] inline-flex items-center gap-1 px-[6px] py-1',
                  'border border-nomi-line rounded-full',
                  'bg-nomi-paper/[0.96] shadow-nomi-md pointer-events-auto',
                )}
                style={{
                  transform: `translate(${Math.round(selectedBounds.minX + selectedBounds.width / 2)}px, ${Math.round(Math.max(24, selectedBounds.minY - 44))}px) translateX(-50%)`,
                }}
                aria-label="选中区域操作"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <span className={cn('px-[6px] text-nomi-ink-60 text-[11px] whitespace-nowrap')}>{selectedCount} 个节点</span>
                <WorkbenchIconButton label="复制选中节点" icon={<IconCopy size={14} />} onClick={copySelectedNodes} />
                <WorkbenchIconButton label="剪切选中节点" icon={<IconCut size={14} />} onClick={cutSelectedNodes} />
                <WorkbenchIconButton label="清除选择" icon={<IconX size={14} />} onClick={clearSelection} />
              </div>
            ) : null}
          </div>
          {nodes.length === 0 ? (
            <div className={cn(
              'absolute top-[48%] left-1/2 grid gap-[6px]',
              'text-workbench-muted text-[13px] text-center',
              '-translate-x-1/2 -translate-y-1/2',
            )}>
              <strong>开始搭建生成链路</strong>
              <span>添加文本、角色、图片或视频节点。</span>
            </div>
          ) : null}
          {selectionBox ? (
            <div
              className={cn(
                'generation-canvas-v2__selection-box',
                'absolute z-[7] border border-nomi-accent bg-nomi-accent/[0.09] pointer-events-none',
              )}
              style={{
                left: selectionBox.left,
                top: selectionBox.top,
                width: selectionBox.width,
                height: selectionBox.height,
              }}
              aria-hidden="true"
            />
          ) : null}
          {contextNodeMenu ? (
            <NodeAddMenu
              className={cn('generation-canvas-v2__context-node-menu', 'z-[20]')}
              style={{ left: contextNodeMenu.stageX, top: contextNodeMenu.stageY }}
              onPointerDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
              onAddNode={handleAddContextNode}
            />
          ) : null}
        </div>
        <div
          className={cn(
            'generation-canvas-v2__zoom-bar',
            'absolute left-4 bottom-6 z-[8] inline-flex items-center gap-[2px]',
            'min-h-9 p-1 border border-workbench-border rounded-nomi',
            'bg-nomi-paper shadow-workbench-sm',
          )}
          aria-label="画布缩放"
        >
          <WorkbenchButton aria-label="适应视图" title={nodes.length === 0 ? '画布为空' : '适应视图'} disabled={nodes.length === 0} onClick={fitView}>⌖</WorkbenchButton>
          <WorkbenchButton
            aria-label="重置视图"
            title="重置视图"
            onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }) }}
          >▦</WorkbenchButton>
          <input
            className="w-[78px] accent-workbench-accent"
            type="range"
            min="20"
            max="300"
            value={zoomPercent}
            aria-label="缩放比例"
            onChange={(e) => setZoom(Number(e.target.value) / 100)}
          />
          <WorkbenchButton aria-label="画布帮助" title="画布帮助" onClick={() => toast('快捷键：S 分割 · Cmd+D 复制 · Delete 删除 · ← → 移动播放头 · Ctrl+滚轮 缩放', 'info')}>?</WorkbenchButton>
        </div>
      </div>
    </section>
  )
}
