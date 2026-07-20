import React from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { IconBrush, IconX } from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'
import { WorkbenchButton } from '../../../../design'
import { toast } from '../../../../ui/toast'
import { FULLSCREEN_Z_INDEX } from '../scene3d/scene3dConstants'
import type {
  GenerationCanvasEdge,
  GenerationCanvasNode,
  GenerationNodeResult,
} from '../../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { persistNodeImageFile } from '../../adapters/persistNodeImage'
import WhiteboardDrawingTool, { type WhiteboardDrawingToolHandle } from './WhiteboardDrawingTool'
import type { WhiteboardResultLibraryItem } from './whiteboardTypes'
import type { WhiteboardInitialImage, WhiteboardState } from './whiteboardTypes'
import { readWhiteboardState, serializeWhiteboardState } from './whiteboardState'
import { getCanvasDimensions } from './lib/canvas'
import { mediaNodeSize } from '../nodeSizing'
import i18n from '../../../../i18n'

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

function mergeWhiteboardSnapshotHistory(
  nextResult: GenerationNodeResult,
  previousResult: GenerationNodeResult | undefined,
  previousHistory: GenerationNodeResult[] | undefined,
): GenerationNodeResult[] {
  const history: GenerationNodeResult[] = []
  const seen = new Set<string>()
  const add = (result: GenerationNodeResult | undefined) => {
    if (!result) return
    const key = result.id || result.url || result.thumbnailUrl || result.text || ''
    if (!key || seen.has(key)) return
    seen.add(key)
    history.push(result)
  }
  add(nextResult)
  add(previousResult)
  ;(previousHistory || []).forEach(add)
  return history
}

function dimensionsForWhiteboardState(state: WhiteboardState | null): ReturnType<typeof getCanvasDimensions> | null {
  return state ? getCanvasDimensions(state.activeRatio, 1280) : null
}

function isSameWhiteboardState(a: WhiteboardState | undefined, b: WhiteboardState | null): boolean {
  if (!a || !b) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

export default function WhiteboardModal({
  nodeId,
  sourceKind,
  nodeTitle,
  initialState,
  initialImage,
  onClose,
}: WhiteboardModalProps): JSX.Element | null {
  const { t } = useTranslation()
  const drawingRef = React.useRef<WhiteboardDrawingToolHandle | null>(null)
  const [screenshotBusy, setScreenshotBusy] = React.useState(false)
  const addNode = useGenerationCanvasStore((state) => state.addNode)
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const connectNodes = useGenerationCanvasStore((state) => state.connectNodes)
  const sourceNode = useGenerationCanvasStore((state) => state.nodes.find((node) => node.id === nodeId) || null)
  const canvasImageItems = useGenerationCanvasStore((state) => getAllCanvasImageResults(state.nodes, nodeId))
  const resultItems = useGenerationCanvasStore((state) => getConnectedImageResults(state.nodes, state.edges, nodeId))
  const savingRef = React.useRef(false)

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

  const persistWhiteboardState = React.useCallback(
    (stateOverride?: WhiteboardState | null) => {
      const nextState = drawingRef.current?.getState()
      const serializedState = stateOverride || nextState
      if (!serializedState) return null
      const latest = useGenerationCanvasStore.getState().nodes.find((node) => node.id === nodeId)
      updateNode(nodeId, {
        meta: {
          ...(latest?.meta || {}),
          whiteboardState: serializeWhiteboardState(serializedState),
        },
      })
      return serializeWhiteboardState(serializedState)
    },
    [nodeId, updateNode],
  )

  const exitFullscreenIfNeeded = React.useCallback(() => {
    if (typeof document !== 'undefined' && document.fullscreenElement) {
      void document.exitFullscreen()
    }
  }, [])

  const captureFile = React.useCallback(() => {
    const filename = `nomi-whiteboard-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
    if (!drawingRef.current) throw new Error(t('generationCommon.whiteboard.canvasNotReady'))
    return drawingRef.current.captureViewportFile(filename)
  }, [t])

  const saveImageWhiteboardSnapshot = React.useCallback(
    async (whiteboardState: WhiteboardState | null, options?: { skipIfUnchanged?: boolean }) => {
      const latestSource = useGenerationCanvasStore.getState().nodes.find((node) => node.id === nodeId)
      if (!latestSource) throw new Error(t('generationCommon.whiteboard.imageNodeMissing'))
      const serializedState = whiteboardState ? serializeWhiteboardState(whiteboardState) : null
      if (
        options?.skipIfUnchanged &&
        serializedState &&
        isSameWhiteboardState(readWhiteboardState(latestSource), serializedState)
      ) {
        return false
      }

      const file = await captureFile()
      const snapshotUrl = await persistNodeImageFile(file, nodeId)
      if (!snapshotUrl) throw new Error(t('generationCommon.whiteboard.snapshotSaveFailed'))

      const dimensions = dimensionsForWhiteboardState(serializedState)
      const snapshotResult = makeWhiteboardSnapshotResult(nodeId, snapshotUrl)
      const snapshotSize = dimensions
        ? mediaNodeSize(dimensions.width, dimensions.height, latestSource.size?.width)
        : null
      updateNode(nodeId, {
        result: snapshotResult,
        history: mergeWhiteboardSnapshotHistory(snapshotResult, latestSource.result, latestSource.history),
        status: 'success',
        error: undefined,
        progress: undefined,
        ...(snapshotSize && latestSource.meta?.userResized !== true
          ? { size: { width: snapshotSize.width, height: snapshotSize.height } }
          : {}),
        meta: {
          ...(latestSource.meta || {}),
          source: 'whiteboard-edit',
          localOnly: false,
          uploadStatus: 'uploaded',
          ...(serializedState ? { whiteboardState: serializedState } : {}),
          ...(dimensions
            ? {
                imageWidth: dimensions.width,
                imageHeight: dimensions.height,
                imageAspectRatio: dimensions.width / Math.max(1, dimensions.height),
                previewHeight: snapshotSize?.previewHeight ?? latestSource.meta?.previewHeight,
              }
            : {}),
        },
      })
      return true
    },
    [captureFile, nodeId, t, updateNode],
  )

  const handleClose = React.useCallback(() => {
    if (savingRef.current) return
    const currentWhiteboardState = drawingRef.current?.getState() || null
    if (sourceKind !== 'image') {
      persistWhiteboardState(currentWhiteboardState)
      exitFullscreenIfNeeded()
      onClose()
      return
    }
    savingRef.current = true
    setScreenshotBusy(true)
    void (async () => {
      try {
        const saved = await saveImageWhiteboardSnapshot(currentWhiteboardState, { skipIfUnchanged: true })
        if (saved) toast(t('generationCommon.whiteboard.savedPrimary'), 'success')
        exitFullscreenIfNeeded()
        onClose()
      } catch (error) {
        savingRef.current = false
        setScreenshotBusy(false)
        toast(
          error instanceof Error && error.message ? error.message : t('generationCommon.whiteboard.saveFailed'),
          'error',
        )
      }
    })()
  }, [exitFullscreenIfNeeded, onClose, persistWhiteboardState, saveImageWhiteboardSnapshot, sourceKind, t])

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

  const handleCreateScreenshotNode = React.useCallback(async () => {
    if (screenshotBusy) return
    setScreenshotBusy(true)
    try {
      const currentWhiteboardState = drawingRef.current?.getState() || null
      if (sourceKind === 'image') {
        await saveImageWhiteboardSnapshot(currentWhiteboardState)
        toast(t('generationCommon.whiteboard.savedPrimary'), 'success')
        return
      }

      persistWhiteboardState(currentWhiteboardState)
      const file = await captureFile()
      const snapshotUrl = await persistNodeImageFile(file, nodeId)
      if (!snapshotUrl) throw new Error(t('generationCommon.whiteboard.snapshotSaveFailed'))

      const latestState = useGenerationCanvasStore.getState()
      const latestSource = latestState.nodes.find((node) => node.id === nodeId)
      const dimensions = dimensionsForWhiteboardState(currentWhiteboardState)

      const created = addNode({
        kind: 'image',
        title: t('generationCommon.whiteboard.screenshotName', {
          title: latestSource?.title || t('generationCommon.whiteboard.title'),
        }),
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
          history: [
            snapshotResult,
            ...(latestSourceAfterCreate?.history || []).filter((entry) => entry.id !== snapshotResult.id),
          ],
          status: 'success',
        })
      }
      connectNodes(nodeId, created.id, 'reference')
      toast(t('generationCommon.whiteboard.screenshotCreated'), 'success')
    } catch (error) {
      toast(
        error instanceof Error && error.message ? error.message : t('generationCommon.whiteboard.screenshotFailed'),
        'error',
      )
    } finally {
      setScreenshotBusy(false)
    }
  }, [
    addNode,
    captureFile,
    connectNodes,
    nodeId,
    persistWhiteboardState,
    saveImageWhiteboardSnapshot,
    screenshotBusy,
    sourceKind,
    t,
    updateNode,
  ])

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
      aria-label={t('generationCommon.whiteboard.title')}
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
            {nodeTitle || sourceNode?.title || t('generationCommon.whiteboard.title')}
          </div>
        </div>
        <WorkbenchButton
          className="h-8 min-h-8 w-8 rounded-nomi-sm p-0"
          title={t('generationCommon.whiteboard.close')}
          aria-label={t('generationCommon.whiteboard.closeAria')}
          onClick={handleClose}
        >
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
            screenshotLabel={
              sourceKind === 'image'
                ? t('generationCommon.whiteboard.savePrimary')
                : t('generationCommon.whiteboard.screenshotAndCreateNode')
            }
            focusResultsOnScreenshot={sourceKind !== 'image'}
            onScreenshot={() => {
              void handleCreateScreenshotNode()
            }}
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

function makeImageResultLibraryItem(
  node: GenerationCanvasNode,
  source: 'canvas' | 'result',
): WhiteboardResultLibraryItem | null {
  if (node.result?.type !== 'image') return null
  const url = node.result.url || node.result.providerUrl || node.result.thumbnailUrl || ''
  if (!url) return null
  return {
    id: `${source}:${node.id}:${node.result.id || url}`,
    nodeId: node.id,
    name: node.title || i18n.t('generationCommon.whiteboard.imageResult'),
    url,
    width: readNumber(node.meta?.imageWidth),
    height: readNumber(node.meta?.imageHeight),
  }
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}
