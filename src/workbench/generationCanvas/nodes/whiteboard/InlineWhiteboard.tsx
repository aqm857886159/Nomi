import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { notify } from '../../../../ui/notificationPolicy'
import type {
  GenerationCanvasEdge,
  GenerationCanvasNode,
  GenerationNodeResult,
} from '../../model/generationCanvasTypes'
import { appendNodeResultVersion } from '../../model/nodeResultLifecycle'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { persistNodeImageFile } from '../../adapters/persistNodeImage'
import { isProjectImportCancellation } from '../../adapters/assetImportAdapter'
import { withProjectAction, type ProjectExecutionContext } from '../../../project/projectCanvasReadSurface'
import WhiteboardDrawingTool, { type WhiteboardDrawingToolHandle } from './WhiteboardDrawingTool'
import type { WhiteboardResultLibraryItem } from './whiteboardTypes'
import type { WhiteboardInitialImage, WhiteboardState } from './whiteboardTypes'
import { readWhiteboardState, serializeWhiteboardState, whiteboardDraftIdentity } from './whiteboardState'
import { whiteboardCanvasDimensions, whiteboardHasVisibleContent, whiteboardRasterStateKey } from './whiteboardRasterState'
import { getCanvasDimensions } from './lib/canvas'
import { useNodeAttachedPanel } from '../nodeAttachedPanel'
import { registerWhiteboardFinish } from './whiteboardSession'
import { computeMediaMetaPatch, mediaNodeSize, resolveNodeVisualSize } from '../nodeSizing'
import i18n from '../../../../i18n'

type InlineWhiteboardProps = {
  nodeId: string
  sourceKind: 'whiteboard' | 'image'
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

function dimensionsForWhiteboardState(state: WhiteboardState | null): ReturnType<typeof getCanvasDimensions> | null {
  return state ? whiteboardCanvasDimensions(state) : null
}

function isSameWhiteboardState(a: WhiteboardState | undefined, b: WhiteboardState | null): boolean {
  if (!a || !b) return false
  return whiteboardRasterStateKey(a) === whiteboardRasterStateKey(b)
}

export default function InlineWhiteboard({
  nodeId,
  sourceKind,
  initialState,
  initialImage,
  onClose,
}: InlineWhiteboardProps): JSX.Element | null {
  const { t } = useTranslation()
  const [feedback, setFeedback] = React.useState<string | null>(null)
  const reportFeedback = React.useCallback((message: string) => {
    notify({ identity: `whiteboard:${nodeId}`, reason: 'save', message, level: 'inline', present: setFeedback })
  }, [nodeId])
  const drawingRef = React.useRef<WhiteboardDrawingToolHandle | null>(null)
  const [screenshotBusy, setScreenshotBusy] = React.useState(false)
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const addDerivedOutput = useGenerationCanvasStore((state) => state.addDerivedOutput)
  const sourceNode = useGenerationCanvasStore((state) => state.nodes.find((node) => node.id === nodeId) || null)
  const canvasImageItems = useGenerationCanvasStore((state) => getAllCanvasImageResults(state.nodes, nodeId))
  const resultItems = useGenerationCanvasStore((state) => getConnectedImageResults(state.nodes, state.edges, nodeId))
  const savingRef = React.useRef(false)
  const [projectLifetime] = React.useState(() => withProjectAction(project => project))
  const [savedStateRef] = React.useState(() => ({ current: sourceNode?.meta?.whiteboardHasUnsavedChanges === true
    ? readWhiteboardState({ meta: { whiteboardState: (sourceNode.result?.raw && typeof sourceNode.result.raw === 'object' ? (sourceNode.result.raw as Record<string, unknown>).whiteboardState : undefined) } }) ?? null
    : initialState ? serializeWhiteboardState(initialState) : null }))
  const draftIdentityRef = React.useRef(sourceNode ? whiteboardDraftIdentity(sourceNode) : `board:${nodeId}`)
  const lastDraftRef = React.useRef('')
  const pendingDraftRef = React.useRef<WhiteboardState | null>(null)
  const draftTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const [initialDimensions] = React.useState(() => initialState?.canvasDimensions ?? getCanvasDimensions(initialState?.activeRatio ?? initialImage?.aspectRatio ?? '16:9', 1280))
  const hostScaleRef = React.useRef(sourceNode ? resolveNodeVisualSize(sourceNode).width / initialDimensions.width : 1)

  React.useEffect(() => {
    const latest = useGenerationCanvasStore.getState().nodes.find(node => node.id === nodeId)
    if (!latest) return
    const size = { width: initialDimensions.width * hostScaleRef.current, height: initialDimensions.height * hostScaleRef.current }
    updateNode(nodeId, { size, meta: { ...latest.meta, previewHeight: size.height, whiteboardFrameScale: hostScaleRef.current, whiteboardResultIdentity: draftIdentityRef.current } }, { history: false, persist: false, emit: false })
  }, [initialDimensions, nodeId, updateNode])

  useNodeAttachedPanel(nodeId)
  const persistWhiteboardState = React.useCallback(
    (stateOverride?: WhiteboardState | null) => {
      if (projectLifetime?.signal.aborted) return null
      const serializedState = stateOverride ? serializeWhiteboardState(stateOverride) : drawingRef.current?.getState()
      if (!serializedState) return null
      const signature = JSON.stringify([serializedState, draftIdentityRef.current])
      if (lastDraftRef.current === signature) return serializedState
      lastDraftRef.current = signature
      const latest = useGenerationCanvasStore.getState().nodes.find((node) => node.id === nodeId)
      if (!latest) return null
      updateNode(nodeId, {
        meta: {
          ...(latest?.meta || {}),
          whiteboardState: serializedState,
          whiteboardHasUnsavedChanges: !isSameWhiteboardState(savedStateRef.current ?? undefined, serializedState),
          whiteboardResultIdentity: draftIdentityRef.current,
        },
      }, { history: false })
      return serializedState
    },
    [nodeId, projectLifetime, savedStateRef, updateNode],
  )

  const flushDraft = React.useCallback(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
    draftTimerRef.current = null
    const draft = pendingDraftRef.current
    pendingDraftRef.current = null
    if (draft) persistWhiteboardState(draft)
  }, [persistWhiteboardState])
  const scheduleDraft = React.useCallback(() => {
    // React detaches child handles before passive cleanup. Capture while the document is still mounted.
    pendingDraftRef.current = drawingRef.current?.getState() ?? null
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
    draftTimerRef.current = setTimeout(flushDraft, 250)
  }, [flushDraft])
  React.useEffect(() => flushDraft, [flushDraft])

  const resizeBoard = React.useCallback((dimensions: { width: number; height: number }) => {
    if (projectLifetime?.signal.aborted) return
    const latest = useGenerationCanvasStore.getState().nodes.find(node => node.id === nodeId)
    if (!latest) return
    const width = dimensions.width * hostScaleRef.current
    const height = dimensions.height * hostScaleRef.current
    updateNode(nodeId, { size: { width, height }, meta: { ...latest.meta, userResized: true, previewHeight: height } })
  }, [nodeId, projectLifetime, updateNode])

  const setRasterBaseline = React.useCallback((state: WhiteboardState) => { savedStateRef.current = state }, [savedStateRef])

  const captureFile = React.useCallback(() => {
    const filename = `nomi-whiteboard-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
    if (!drawingRef.current) throw new Error(t('generationCommon.whiteboard.canvasNotReady'))
    return drawingRef.current.captureViewportFile(filename)
  }, [t])

  const saveImageWhiteboardSnapshot = React.useCallback(
    async (whiteboardState: WhiteboardState | null, project: ProjectExecutionContext, options?: { skipIfUnchanged?: boolean }) => {
      project.assertCurrent()
      const sourceAtStart = useGenerationCanvasStore.getState().nodes.find((node) => node.id === nodeId)
      if (!sourceAtStart) throw new Error(t('generationCommon.whiteboard.imageNodeMissing'))
      const serializedState = whiteboardState ? serializeWhiteboardState(whiteboardState) : null
      // Unchanged only counts when that raster already exists as the node's result: a board saved as state alone
      // (before 2026-10-22, or never finished) still gets its picture on the next Done.
      if (
        options?.skipIfUnchanged &&
        serializedState &&
        sourceAtStart.result?.url &&
        isSameWhiteboardState(savedStateRef.current ?? undefined, serializedState)
      ) {
        persistWhiteboardState(serializedState)
        return false
      }

      const file = await captureFile()
      project.assertCurrent()
      const snapshotUrl = await persistNodeImageFile(file, nodeId, project)
      project.assertCurrent()
      if (!snapshotUrl) throw new Error(t('generationCommon.whiteboard.drawingSaveFailed'))
      const latestSource = useGenerationCanvasStore.getState().nodes.find(node => node.id === nodeId)
      if (!latestSource) throw new Error(t('generationCommon.whiteboard.imageNodeMissing'))

      const dimensions = dimensionsForWhiteboardState(serializedState)
      const snapshotResult = { ...makeWhiteboardSnapshotResult(nodeId, snapshotUrl), raw: { whiteboardState: serializedState } }
      const mediaMeta = dimensions
        ? computeMediaMetaPatch({ resultType: snapshotResult.type, meta: latestSource.meta || {}, width: dimensions.width, height: dimensions.height })?.meta
        : undefined
      const snapshotSize = dimensions
        ? mediaNodeSize(dimensions.width, dimensions.height, latestSource.size?.width)
        : null
      updateNode(nodeId, {
        ...appendNodeResultVersion(latestSource, snapshotResult),
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
          whiteboardResultIdentity: snapshotResult.id,
          whiteboardHasUnsavedChanges: false,
          ...(mediaMeta || {}),
          ...(dimensions ? { previewHeight: snapshotSize?.previewHeight ?? latestSource.meta?.previewHeight } : {}),
        },
      })
      savedStateRef.current = serializedState
      draftIdentityRef.current = snapshotResult.id
      return true
    },
    [captureFile, nodeId, persistWhiteboardState, savedStateRef, t, updateNode],
  )

  const handleClose = React.useCallback(async (): Promise<boolean> => {
    if (savingRef.current) return false
    if (drawingRef.current?.isBusy()) { reportFeedback(t('generationCommon.whiteboard.operationInProgress')); return false }
    setFeedback(null)
    const currentWhiteboardState = drawingRef.current?.getState() || null
    // Done leaves a picture on the node (user 2026-10-22, replaces board O40 "Done saves state only"). The one exception is a
    // board that has never produced a picture and has nothing on it: it keeps showing the launcher, so Done saves state only.
    const hasResult = Boolean(useGenerationCanvasStore.getState().nodes.find((node) => node.id === nodeId)?.result?.url)
    if (!hasResult && !(currentWhiteboardState && whiteboardHasVisibleContent(currentWhiteboardState))) {
      persistWhiteboardState(currentWhiteboardState)
      onClose()
      return true
    }
    savingRef.current = true
    setScreenshotBusy(true)
    let closed = false
    await withProjectAction(async (project) => {
      try {
        await saveImageWhiteboardSnapshot(currentWhiteboardState, project, { skipIfUnchanged: true })
        project.assertCurrent()
        onClose()
        closed = true
      } catch (error) {
        if (project.signal.aborted || isProjectImportCancellation(error)) return
        reportFeedback(error instanceof Error && error.message ? error.message : t('generationCommon.whiteboard.drawingSaveFailed'))
      } finally {
        savingRef.current = false
        if (!project.signal.aborted) setScreenshotBusy(false)
      }
    })
    return closed
  }, [nodeId, onClose, persistWhiteboardState, reportFeedback, saveImageWhiteboardSnapshot, t])

  React.useEffect(() => registerWhiteboardFinish(handleClose), [handleClose])

  const handleCreateScreenshotNode = React.useCallback(async () => {
    if (screenshotBusy) return null
    if (drawingRef.current?.isBusy()) { reportFeedback(t('generationCommon.whiteboard.operationInProgress')); return null }
    return await withProjectAction(async (project) => {
      setScreenshotBusy(true)
      setFeedback(null)
      try {
        project.assertCurrent()
        const currentWhiteboardState = drawingRef.current?.getState() || null
        if (sourceKind === 'image') {
          await saveImageWhiteboardSnapshot(currentWhiteboardState, project)
          project.assertCurrent()
          return nodeId
        }

        persistWhiteboardState(currentWhiteboardState)
        const file = await captureFile()
        project.assertCurrent()
        const snapshotUrl = await persistNodeImageFile(file, nodeId, project)
        project.assertCurrent()
        if (!snapshotUrl) throw new Error(t('generationCommon.whiteboard.screenshotSaveFailed'))

        const latestState = useGenerationCanvasStore.getState()
        const latestSource = latestState.nodes.find((node) => node.id === nodeId)
        const dimensions = dimensionsForWhiteboardState(currentWhiteboardState)
        const screenshotMeta = dimensions
          ? computeMediaMetaPatch({ resultType: 'image', meta: {}, width: dimensions.width, height: dimensions.height })?.meta
          : undefined

        // 截图卡 + 出处边是一个原子动作（addDerivedOutput）：源必须是白板节点。
        const created = addDerivedOutput({
          sourceNodeId: nodeId,
          kind: 'whiteboard-snapshot',
          mode: 'reference',
          node: {
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
              ...(screenshotMeta || {}),
            },
          },
        })
        if (!created) throw new Error(t('generationCommon.whiteboard.screenshotSaveFailed'))
        const snapshotResult = { ...makeWhiteboardSnapshotResult(created.id, snapshotUrl), raw: { whiteboardState: currentWhiteboardState } }
        updateNode(created.id, {
          result: snapshotResult,
          history: [snapshotResult],
          status: 'success',
          meta: {
            ...(created.meta || {}),
            source: 'whiteboard-screenshot',
            sourceNodeId: nodeId,
            ...(screenshotMeta || {}),
          },
        })
        if (sourceKind === 'whiteboard') {
          const latestSourceAfterCreate = useGenerationCanvasStore.getState().nodes.find((node) => node.id === nodeId)
          const sourceMeta = dimensions
            ? computeMediaMetaPatch({ resultType: snapshotResult.type, meta: latestSourceAfterCreate?.meta || {}, width: dimensions.width, height: dimensions.height })?.meta
            : undefined
          updateNode(nodeId, {
            ...appendNodeResultVersion(latestSourceAfterCreate ?? {}, snapshotResult),
            status: 'success',
            meta: { ...latestSourceAfterCreate?.meta, ...sourceMeta, whiteboardResultIdentity: snapshotResult.id },
          })
          draftIdentityRef.current = snapshotResult.id
          // The board's picture now matches this state, so an immediate Done adds no duplicate version.
          if (currentWhiteboardState) savedStateRef.current = serializeWhiteboardState(currentWhiteboardState)
        }
        return created.id
      } catch (error) {
        if (project.signal.aborted || isProjectImportCancellation(error)) return null
        // The camera saves the drawing on an image entry and makes a screenshot node on a board entry; say which one failed.
        reportFeedback(
          error instanceof Error && error.message
            ? error.message
            : sourceKind === 'image'
              ? t('generationCommon.whiteboard.drawingSaveFailed')
              : t('generationCommon.whiteboard.screenshotSaveFailed'),
        )
        return null
      } finally {
        if (!project.signal.aborted) setScreenshotBusy(false)
      }
    })
  }, [
    addDerivedOutput,
    captureFile,
    nodeId,
    persistWhiteboardState,
    saveImageWhiteboardSnapshot,
    savedStateRef,
    screenshotBusy,
    reportFeedback,
    sourceKind,
    t,
    updateNode,
  ])

  return (
    <div data-nomi-inline-whiteboard="true" className="nodrag nopan nokey nowheel absolute inset-0 z-[8] cursor-default rounded-nomi bg-nomi-paper text-nomi-ink"
      onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
      <WhiteboardDrawingTool
        ref={drawingRef} ownerNodeId={nodeId} initialState={initialState} initialImage={initialImage}
        canvasImageItems={canvasImageItems} resultItems={resultItems} screenshotBusy={screenshotBusy}
        screenshotLabel={sourceKind === 'image' ? t('generationCommon.whiteboard.savePrimary') : t('generationCommon.whiteboard.screenshotAndCreateNode')}
        focusResultsOnScreenshot={sourceKind !== 'image'} onScreenshot={() => void handleCreateScreenshotNode()}
        onDone={() => void handleClose()} onAbort={onClose} feedback={feedback}
        onRasterBaseline={setRasterBaseline}
        onDraftChange={scheduleDraft}
        onBoardDimensionsChange={resizeBoard}
      />
    </div>
  )
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
