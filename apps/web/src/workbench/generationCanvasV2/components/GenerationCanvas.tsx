import React from 'react'
import { IconCopy, IconCut, IconX } from '@tabler/icons-react'
import { WorkbenchButton, WorkbenchIconButton } from '../../../design'
import { toast } from '../../../ui/toast'
import CanvasToolbar from './CanvasToolbar'
import BaseGenerationNode from './nodes/BaseGenerationNode'
import { importImageFilesToGenerationCanvas } from '../adapters/assetImportAdapter'
import { EDGE_MODE_LABEL, EDGE_MODE_ORDER } from '../model/graphOps'
import type { GenerationCanvasEdgeMode, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useModelOptionsState } from '../../../config/useModelOptions'
import '../styles/generationCanvas.css'

const GENERATION_PROVIDER = 'chatfire'
const GENERATION_DEFAULT_BASE_URL = 'https://api.chatfire.site'
const OPEN_MODEL_CATALOG_EVENT = 'nomi-open-model-catalog'

type GenerationCanvasProps = {
  readOnly?: boolean
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
  const clearSelection = useGenerationCanvasStore((state) => state.clearSelection)
  const setCanvasZoom = useGenerationCanvasStore((state) => state.setCanvasZoom)
  const deleteSelectedNodes = useGenerationCanvasStore((state) => state.deleteSelectedNodes)
  const copySelectedNodes = useGenerationCanvasStore((state) => state.copySelectedNodes)
  const cutSelectedNodes = useGenerationCanvasStore((state) => state.cutSelectedNodes)
  const pasteNodes = useGenerationCanvasStore((state) => state.pasteNodes)
  const selectNodesInRect = useGenerationCanvasStore((state) => state.selectNodesInRect)
  const updateEdgeMode = useGenerationCanvasStore((state) => state.updateEdgeMode)
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
  const [pendingCursorPos, setPendingCursorPos] = React.useState<{ x: number; y: number } | null>(null)
  const [isPanning, setIsPanning] = React.useState(false)

  React.useEffect(() => {
    markReady()
  }, [markReady])

  // Refs so drag-connection effect can read latest values without re-subscribing
  const offsetRef = React.useRef(offset)
  offsetRef.current = offset
  const zoomRef = React.useRef(zoom)
  zoomRef.current = zoom
  const nodesRef = React.useRef(nodes)
  nodesRef.current = nodes

  // Keep store zoom in sync so BaseGenerationNode can read it
  React.useEffect(() => {
    setCanvasZoom(zoom)
  }, [zoom, setCanvasZoom])

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
    const target = event.target instanceof HTMLElement ? event.target : null
    if (target?.closest(
      '.generation-canvas-v2-node, .generation-canvas-v2-toolbar, .generation-canvas-v2__zoom-bar, .generation-canvas-v2__selection-toolbar, button, input, textarea, select, [role="menu"], [role="menuitem"]',
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
    setOffset({
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
    setSelectionBox(null)
    if (event &&
      typeof event.currentTarget.hasPointerCapture === 'function' &&
      typeof event.currentTarget.releasePointerCapture === 'function' &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    if (!stageRef.current) return
    const rect = stageRef.current.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    const nextZoom = Math.max(0.2, Math.min(3, zoom * delta))
    setOffset((prev) => ({
      x: mouseX - (mouseX - prev.x) * (nextZoom / zoom),
      y: mouseY - (mouseY - prev.y) * (nextZoom / zoom),
    }))
    setZoom(nextZoom)
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
    <section className="generation-canvas-v2" aria-label="AI 影像创作画布" data-ready={isReady ? 'true' : undefined}>
      <div className="generation-canvas-v2__main">
        {settingsOpen ? (
          <div className="generation-canvas-v2__provider-popover" onPointerDown={(event) => event.stopPropagation()}>
            <div className="generation-canvas-v2__provider-summary" aria-label="模型目录状态">
              <span>系统模型目录</span>
              <strong>{imageModelOptions.length} 图 / {videoModelOptions.length} 视频</strong>
              <WorkbenchButton onClick={() => { window.dispatchEvent(new CustomEvent(OPEN_MODEL_CATALOG_EVENT)) }}>接入模型</WorkbenchButton>
            </div>
            <p className="generation-canvas-v2__provider-note">
              {modelOptionsStatusMessage
                ? modelOptionsStatusMessage
                : '可选模型来自模型目录；没有模型时请打开“模型接入”，让 Agent 根据官方文档生成草案并确认写入。'}
            </p>
            <label>
              <span>API Key</span>
              <input
                type="password"
                value={apiKey}
                placeholder="粘贴生成渠道 API Key"
                onChange={(event) => {
                  setApiKey(event.target.value)
                  setSettingsSaved(false)
                }}
              />
            </label>
            <label>
              <span>Base URL</span>
              <input
                value={baseUrl}
                placeholder={GENERATION_DEFAULT_BASE_URL}
                onChange={(event) => {
                  setBaseUrl(event.target.value)
                  setSettingsSaved(false)
                }}
              />
            </label>
            <div className="generation-canvas-v2__provider-actions">
              <WorkbenchButton onClick={handleSaveSettings}>保存</WorkbenchButton>
              <WorkbenchButton onClick={() => setSettingsOpen(false)}>关闭</WorkbenchButton>
            </div>
            <p data-tone={hasApiKey ? 'success' : 'error'}>
              {settingsSaved ? '已保存生成渠道配置。' : hasApiKey ? '当前已配置生成渠道 Key。' : '旧渠道 Key 未配置；新模型优先通过“模型接入”写入模型目录。'}
            </p>
          </div>
        ) : null}
        {!readOnly ? <CanvasToolbar getInsertionPosition={getToolbarInsertionPosition} /> : null}
        <div
          className="generation-canvas-v2__stage"
          ref={stageRef}
          data-panning={isPanning ? 'true' : undefined}
          onPointerDown={handleStagePanStart}
          onPointerMove={handleStagePanMove}
          onPointerUp={handleStagePanEnd}
          onWheel={handleWheel}
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
            className="generation-canvas-v2__canvas"
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
          >
            <svg className="generation-canvas-v2__edges" aria-hidden="true">
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
                return (
                  <g key={edge.id} className="generation-canvas-v2__edge" data-mode={mode}>
                  <path
                    d={`M ${startX} ${startY} C ${startX + control} ${startY}, ${endX - control} ${endY}, ${endX} ${endY}`}
                  />
                    <foreignObject x={midX - 54} y={midY - 15} width="108" height="30">
                      <div className="generation-canvas-v2__edge-label" title={EDGE_MODE_LABEL[mode]}>
                        <select
                          aria-label={`连接语义：${source.title} 到 ${target.title}`}
                          value={mode}
                          onChange={(event) => {
                            if (!readOnly) updateEdgeMode(edge.id, event.currentTarget.value as GenerationCanvasEdgeMode)
                          }}
                          disabled={readOnly}
                        >
                          {EDGE_MODE_ORDER.map((option) => (
                            <option key={option} value={option}>{EDGE_MODE_LABEL[option]}</option>
                          ))}
                        </select>
                        {!readOnly ? <WorkbenchButton aria-label="删除连接" onClick={() => disconnectEdge(edge.id)}>×</WorkbenchButton> : null}
                      </div>
                    </foreignObject>
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
            <div className="generation-canvas-v2__nodes">
              {nodes.map((node) => (
                <BaseGenerationNode key={node.id} node={node} selected={selectedSet.has(node.id)} readOnly={readOnly} />
              ))}
            </div>
            {selectedBounds && selectedCount > 1 && !readOnly ? (
              <div
                className="generation-canvas-v2__selection-toolbar"
                style={{
                  transform: `translate(${Math.round(selectedBounds.minX + selectedBounds.width / 2)}px, ${Math.round(Math.max(24, selectedBounds.minY - 44))}px) translateX(-50%)`,
                }}
                aria-label="选中区域操作"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <span className="generation-canvas-v2__selection-count">{selectedCount} 个节点</span>
                <WorkbenchIconButton label="复制选中节点" icon={<IconCopy size={14} />} onClick={copySelectedNodes} />
                <WorkbenchIconButton label="剪切选中节点" icon={<IconCut size={14} />} onClick={cutSelectedNodes} />
                <WorkbenchIconButton label="清除选择" icon={<IconX size={14} />} onClick={clearSelection} />
              </div>
            ) : null}
          </div>
          {nodes.length === 0 ? (
            <div className="generation-canvas-v2__empty">
              <strong>开始搭建生成链路</strong>
              <span>添加图片、视频或全景图节点。</span>
            </div>
          ) : null}
          {selectionBox ? (
            <div
              className="generation-canvas-v2__selection-box"
              style={{
                left: selectionBox.left,
                top: selectionBox.top,
                width: selectionBox.width,
                height: selectionBox.height,
              }}
              aria-hidden="true"
            />
          ) : null}
        </div>
        <div className="generation-canvas-v2__zoom-bar" aria-label="画布缩放">
          <WorkbenchButton aria-label="适应视图" title={nodes.length === 0 ? '画布为空' : '适应视图'} disabled={nodes.length === 0} onClick={fitView}>⌖</WorkbenchButton>
          <WorkbenchButton
            aria-label="重置视图"
            title="重置视图"
            onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }) }}
          >▦</WorkbenchButton>
          <input
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
