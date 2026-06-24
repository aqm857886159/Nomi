import React from 'react'
import { createPortal } from 'react-dom'
import { IconBrush, IconX } from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'
import { WorkbenchButton } from '../../../../design'
import { toast } from '../../../../ui/toast'
import { FULLSCREEN_Z_INDEX } from '../scene3d/scene3dConstants'
import type { GenerationCanvasEdge, GenerationCanvasNode, GenerationNodeResult } from '../../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { persistNodeImageFile } from '../../adapters/persistNodeImage'
import WhiteboardDrawingTool, { type WhiteboardDrawingToolHandle, type WhiteboardResultLibraryItem } from './WhiteboardDrawingTool'
import type { WhiteboardInitialImage, WhiteboardState } from './whiteboardTypes'
import { serializeWhiteboardState } from './whiteboardState'
import { getCanvasDimensions } from './lib/canvas'

type WhiteboardModalProps = {
  nodeId: string
  sourceKind: 'whiteboard' | 'image'
  nodeTitle?: string
  initialState?: WhiteboardState
  initialImage?: WhiteboardInitialImage
  onClose: () => void
}

function makeWhiteboardSnapshotResult(nodeId: string, url: string): GenerationNodeResult {
  return {
    id: `whiteboard-snapshot-${nodeId}-${Date.now()}`,
    type: 'image',
    url,
    createdAt: Date.now(),
  }
}

export default function WhiteboardModal({
  nodeId,
  sourceKind,
  nodeTitle,
  initialState,
  initialImage,
  onClose,
}: WhiteboardModalProps): JSX.Element | null {
  const drawingRef = React.useRef<WhiteboardDrawingToolHandle | null>(null)
  const [screenshotBusy, setScreenshotBusy] = React.useState(false)
  const addNode = useGenerationCanvasStore((state) => state.addNode)
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const connectNodes = useGenerationCanvasStore((state) => state.connectNodes)
  const sourceNode = useGenerationCanvasStore((state) => state.nodes.find((node) => node.id === nodeId) || null)
  const canvasImageItems = useGenerationCanvasStore((state) => getAllCanvasImageResults(state.nodes, nodeId))
  const resultItems = useGenerationCanvasStore((state) => getConnectedImageResults(state.nodes, state.edges, nodeId))

  React.useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const { body } = document
    const previousOverflow = body.style.overflow
    const previousOverscroll = body.style.overscrollBehavior
    body.style.overflow = 'hidden'
    body.style.overscrollBehavior = 'none'
    return () => {
      body.style.overflow = previousOverflow
      body.style.overscrollBehavior = previousOverscroll
    }
  }, [])

  const persistWhiteboardState = React.useCallback(() => {
    if (sourceKind !== 'whiteboard') return
    const nextState = drawingRef.current?.getState()
    if (!nextState) return
    const latest = useGenerationCanvasStore.getState().nodes.find((node) => node.id === nodeId)
    updateNode(nodeId, {
      meta: {
        ...(latest?.meta || {}),
        whiteboardState: serializeWhiteboardState(nextState),
      },
    })
  }, [nodeId, sourceKind, updateNode])

  const handleClose = React.useCallback(() => {
    persistWhiteboardState()
    if (typeof document !== 'undefined' && document.fullscreenElement) {
      void document.exitFullscreen()
    }
    onClose()
  }, [onClose, persistWhiteboardState])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      handleClose()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [handleClose])

  const captureFile = React.useCallback(() => {
    const filename = `nomi-whiteboard-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
    if (!drawingRef.current) throw new Error('画布还未准备好')
    return drawingRef.current.captureViewportFile(filename)
  }, [])

  const handleCreateScreenshotNode = React.useCallback(async () => {
    if (screenshotBusy) return
    setScreenshotBusy(true)
    try {
      persistWhiteboardState()
      const file = await captureFile()
      const snapshotUrl = await persistNodeImageFile(file, nodeId)
      if (!snapshotUrl) throw new Error('画板截图保存失败，请稍后重试')

      const latestState = useGenerationCanvasStore.getState()
      const latestSource = latestState.nodes.find((node) => node.id === nodeId)
      const currentWhiteboardState = drawingRef.current?.getState()
      const dimensions = currentWhiteboardState ? getCanvasDimensions(currentWhiteboardState.activeRatio, 1280) : null
      const created = addNode({
        kind: 'image',
        title: `${latestSource?.title || '画板'} 截图`,
        prompt: '',
        position: {
          x: Math.round((latestSource?.position.x || 120) + (latestSource?.size?.width || 320) + 80),
          y: Math.round((latestSource?.position.y || 360) + 260),
        },
        categoryId: latestSource?.categoryId || 'shots',
        select: false,
        meta: {
          source: 'whiteboard-screenshot',
          sourceNodeId: nodeId,
          ...(dimensions ? { imageWidth: dimensions.width, imageHeight: dimensions.height } : {}),
        },
      })
      const snapshotResult = makeWhiteboardSnapshotResult(created.id, snapshotUrl)
      updateNode(created.id, {
        result: snapshotResult,
        history: [snapshotResult],
        status: 'success',
        meta: {
          ...(created.meta || {}),
          source: 'whiteboard-screenshot',
          sourceNodeId: nodeId,
          ...(dimensions ? { imageWidth: dimensions.width, imageHeight: dimensions.height } : {}),
        },
      })
      if (sourceKind === 'whiteboard') {
        const latestSourceAfterCreate = useGenerationCanvasStore.getState().nodes.find((node) => node.id === nodeId)
        updateNode(nodeId, {
          result: snapshotResult,
          history: [snapshotResult, ...(latestSourceAfterCreate?.history || []).filter((entry) => entry.id !== snapshotResult.id)],
          status: 'success',
        })
      }
      connectNodes(nodeId, created.id, 'reference')
      toast('已创建画板截图节点', 'success')
    } catch (error) {
      toast(error instanceof Error && error.message ? error.message : '画板截图失败', 'error')
    } finally {
      setScreenshotBusy(false)
    }
  }, [addNode, captureFile, connectNodes, nodeId, persistWhiteboardState, screenshotBusy, sourceKind, updateNode])

  const shell = (
    <div
      data-nomi-whiteboard-modal="true"
      className={cn(
        'workbench-shell fixed inset-0 isolate flex h-[100dvh] w-screen flex-col overflow-hidden',
        'bg-[var(--workbench-bg)] text-[var(--workbench-ink)] font-[var(--nomi-font-sans)]',
      )}
      style={{ zIndex: FULLSCREEN_Z_INDEX }}
      role="dialog"
      aria-modal="true"
      aria-label="画板"
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <header className="relative z-[2] flex min-h-[52px] shrink-0 items-center gap-3 border-b border-[var(--workbench-border)] bg-[var(--workbench-surface-solid)] px-4 shadow-nomi-sm">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <IconBrush size={18} className="shrink-0 text-[var(--workbench-muted)]" />
          <div className="min-w-0 truncate text-body-sm font-medium text-[var(--workbench-ink)]">
            {nodeTitle || sourceNode?.title || '画板'}
          </div>
        </div>
        <WorkbenchButton className="h-8 min-h-8 w-8 rounded-nomi-sm p-0" title="关闭" aria-label="关闭画板" onClick={handleClose}>
          <IconX size={16} />
        </WorkbenchButton>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--workbench-bg)]">
        <div className="min-h-0 flex-1 overflow-hidden">
          <WhiteboardDrawingTool
            ref={drawingRef}
            ownerNodeId={nodeId}
            initialState={initialState}
            initialImage={initialImage}
            canvasImageItems={canvasImageItems}
            resultItems={resultItems}
            screenshotBusy={screenshotBusy}
            onScreenshot={() => { void handleCreateScreenshotNode() }}
          />
        </div>
      </main>
    </div>
  )

  return typeof document === 'undefined' ? shell : createPortal(shell, document.body)
}

function getConnectedImageResults(
  nodes: GenerationCanvasNode[],
  edges: GenerationCanvasEdge[],
  nodeId: string,
): WhiteboardResultLibraryItem[] {
  const childNodeIds = new Set<string>()
  for (const edge of edges) {
    if (edge.source === nodeId) childNodeIds.add(edge.target)
  }
  return nodes.flatMap((node) => {
    if (!childNodeIds.has(node.id)) return []
    const item = makeImageResultLibraryItem(node, 'result')
    return item ? [item] : []
  })
}

function getAllCanvasImageResults(nodes: GenerationCanvasNode[], ownerNodeId: string): WhiteboardResultLibraryItem[] {
  return nodes.flatMap((node) => {
    if (node.id === ownerNodeId) return []
    const item = makeImageResultLibraryItem(node, 'canvas')
    return item ? [item] : []
  })
}

function makeImageResultLibraryItem(node: GenerationCanvasNode, source: 'canvas' | 'result'): WhiteboardResultLibraryItem | null {
  if (node.result?.type !== 'image') return null
  const url = node.result.url || node.result.providerUrl || node.result.thumbnailUrl || ''
  if (!url) return null
  return {
    id: `${source}:${node.id}:${node.result.id || url}`,
    nodeId: node.id,
    name: node.title || '图片结果',
    url,
    width: readNumber(node.meta?.imageWidth),
    height: readNumber(node.meta?.imageHeight),
  }
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}
