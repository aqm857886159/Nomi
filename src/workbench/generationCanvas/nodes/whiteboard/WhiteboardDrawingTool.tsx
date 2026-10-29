import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconEye, IconEyeOff, IconTrash } from '@tabler/icons-react'
import { useStateHistory } from '@mantine/hooks'
import { cn } from '../../../../utils/cn'
import { notify } from '../../../../ui/notificationPolicy'
import { persistNodeImageFile } from '../../adapters/persistNodeImage'
import { isProjectImportCancellation } from '../../adapters/assetImportAdapter'
import { withProjectAction, type ProjectExecutionContext } from '../../../project/projectCanvasReadSurface'
import { clampBrushSize, getCanvasDimensions, type CanvasDimensions, type AspectRatioKey, type ToolKey } from './lib/canvas'
import {
  LeaferCanvas,
  type CanvasObjectTarget,
  type CanvasStroke,
  type LeaferCanvasHandle,
} from './WhiteboardLeaferCanvas'
import type { WhiteboardInitialImage, WhiteboardInitialImageStatus, WhiteboardResultLibraryItem, WhiteboardState } from './whiteboardTypes'
import {
  createDefaultWhiteboardState,
  createImageAssetForCanvas,
  createWhiteboardId,
  loadImageSize,
  serializeWhiteboardState,
} from './whiteboardState'
import { applyTextChanges, createWhiteboardText, type TextMeasure } from './whiteboardTextMetrics'
import { WhiteboardEditingToolbar } from './WhiteboardEditingToolbar'
import { WhiteboardLibraryPanel, type WhiteboardLibraryTabKey } from './WhiteboardLibraryPanel'
import { useWhiteboardFrameSize } from './useWhiteboardFrameSize'
import { whiteboardCanvasDimensions } from './whiteboardRasterState'
import { blobToDataUrl, removeBackgroundBlob } from '../../../../lib/removeBackground'
import { removeBackgroundFailureMessage, removeBackgroundProgressMessage } from '../localImageOpPhase'
import {
  ASSET_DRAG_MIME,
  assessDeleteTarget,
  clampCanvasPosition,
  deleteTargetFromState,
  getAssetPanelItems,
  groupTargetsIntoLayer,
  isWhiteboardAssetDrag,
  parseLibraryDragPayload,
  stripFileExtension,
  type AssetPanelItem,
  type LibraryDragPayload,
} from './whiteboardStateOps'

export type WhiteboardDrawingToolHandle = {
  captureViewportFile: (filename?: string) => Promise<File>
  initialImageStatus: () => WhiteboardInitialImageStatus
  isBusy: () => boolean
  getState: () => WhiteboardState
}

type WhiteboardDrawingToolProps = {
  onDone?: () => void
  onAbort?: () => void
  feedback?: string | null
  onRasterBaseline?: (state: WhiteboardState) => void
  onDraftChange?: () => void
  onBoardDimensionsChange?: (dimensions: CanvasDimensions) => void
  ownerNodeId: string
  initialState?: WhiteboardState
  initialImage?: WhiteboardInitialImage
  canvasImageItems?: WhiteboardResultLibraryItem[]
  resultItems?: WhiteboardResultLibraryItem[]
  screenshotBusy?: boolean
  screenshotLabel?: string
  focusResultsOnScreenshot?: boolean
  onScreenshot?: () => void
}

function fileToDataUrl(file: File, errorMessage: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }
      reject(new Error(errorMessage))
    }
    reader.onerror = () => reject(reader.error || new Error(errorMessage))
    reader.readAsDataURL(file)
  })
}

function getInitialState(
  initialState: WhiteboardState | undefined,
  initialImage: WhiteboardInitialImage | undefined,
): WhiteboardState {
  return initialState
    ? serializeWhiteboardState(initialState)
    : createDefaultWhiteboardState(initialImage?.aspectRatio || '16:9')
}

const WhiteboardDrawingTool = React.forwardRef<WhiteboardDrawingToolHandle, WhiteboardDrawingToolProps>(
  function WhiteboardDrawingTool(
    {
      ownerNodeId,
      onDone,
      onAbort,
      feedback: externalFeedback,
      onDraftChange,
      onRasterBaseline,
      onBoardDimensionsChange,
      initialState,
      initialImage,
      canvasImageItems = [],
      resultItems = [],
      screenshotBusy = false,
      screenshotLabel,
      focusResultsOnScreenshot = true,
      onScreenshot,
    },
    ref,
  ) {
    const { t } = useTranslation()
    const [feedback, setFeedback] = React.useState<string | null>(null)
    const reportFeedback = React.useCallback((message: string) => {
      notify({ identity: `whiteboard:${ownerNodeId}`, reason: 'editing', message, level: 'inline', present: setFeedback })
    }, [ownerNodeId])
    const effectiveScreenshotLabel = screenshotLabel ?? t('generationCommon.whiteboard.screenshotAndCreateNode')
    // Opening a board is for drawing: the first drag draws (0.23.0 behaviour, restored 2026-10-22 after #1189 made it select).
    const [activeTool, setActiveTool] = React.useState<ToolKey>('brush')
    const [selectedColor, setSelectedColor] = React.useState('#2563eb')
    const [brushSize, setBrushSize] = React.useState(10)
    const [initialDocument] = React.useState(() => ({ state: getInitialState(initialState, initialImage) }))
    const initialDocumentRef = React.useRef(initialDocument)
    const snapshotsRef = React.useRef(new Map([[0, initialDocumentRef.current]]))
    const revisionRef = React.useRef(0)
    const [revision, history, historyState] = useStateHistory(0)
    const historySet = history.set
    const document = snapshotsRef.current.get(revision) ?? initialDocumentRef.current
    const documentRef = React.useRef(document)
    documentRef.current = document
    const storeDocument = React.useCallback((value: typeof document) => {
      const id = ++revisionRef.current
      snapshotsRef.current.set(id, value)
      while (snapshotsRef.current.size > 50) snapshotsRef.current.delete(snapshotsRef.current.keys().next().value!)
      documentRef.current = value
      historySet(id)
    }, [historySet])
    const [activeLayerId, setActiveLayerId] = React.useState(document.state.activeLayerId)
    const state = React.useMemo(() => ({ ...document.state, activeLayerId }), [document.state, activeLayerId])
    const setState = React.useCallback((updater: React.SetStateAction<WhiteboardState>) => {
      const previous = documentRef.current
      const current = { ...previous.state, sceneTransforms: leaferCanvasRef.current?.getSceneTransforms() ?? previous.state.sceneTransforms }
      const next = typeof updater === 'function' ? updater(current) : updater
      setActiveLayerId(next.activeLayerId)
      if (previous.state === next) return
      storeDocument({ ...previous, state: next })
    }, [storeDocument])
    const [panel, setPanel] = React.useState<import('./WhiteboardEditingToolbar').WhiteboardPanel>(null)
    const [selectedTargets, setSelectedTargets] = React.useState<CanvasObjectTarget[]>([])
    const [textSize, setTextSize] = React.useState(32)
    const frameRef = React.useRef<HTMLDivElement | null>(null)
    // The only path from the frame's size to the board's size; ratio, size field and undo settle through it (2026-10-27).
    const frameSize = useWhiteboardFrameSize({
      frameRef,
      readDocumentDimensions: () => whiteboardCanvasDimensions(documentRef.current.state),
      commitDimensions: (dimensions) => setState((value) => ({ ...value, canvasDimensions: dimensions })),
      onFitFrame: onBoardDimensionsChange,
    })
    const settleFrame = frameSize.settle
    const [activeCanvasObject, setActiveCanvasObject] = React.useState<CanvasObjectTarget | null>(null)
    const [initialImageStatus, setInitialImageStatus] = React.useState<WhiteboardInitialImageStatus>(initialImage?.url && !initialState ? 'loading' : 'ready')
    const [initialImportAttempt, setInitialImportAttempt] = React.useState(0)
    const [uploading, setUploading] = React.useState(false)
    const [removeBgBusy, setRemoveBgBusy] = React.useState(false)
    const [removeBgTargetId, setRemoveBgTargetId] = React.useState<string | null>(null)
    const [removeBgProgress, setRemoveBgProgress] = React.useState<number | null>(null)
    // 首次抠图要下 ~50MB（启动预热已删）。只显示静态「抠图中」会让人以为卡死，
    // 故把 worker 报上来的阶段 key 翻成人话，与节点画布共用同一份映射。
    const [removeBgPhase, setRemoveBgPhase] = React.useState<string | null>(null)
    const [assetDragOver, setAssetDragOver] = React.useState(false)
    const [activeLibraryTab, setActiveLibraryTab] = React.useState<WhiteboardLibraryTabKey>('board')
    const leaferCanvasRef = React.useRef<LeaferCanvasHandle | null>(null)
    const fileInputRef = React.useRef<HTMLInputElement | null>(null)
    const importedInitialImageRef = React.useRef('')

    const canvasDimensions = React.useMemo(
      () => frameSize.liveDimensions ?? whiteboardCanvasDimensions({ canvasDimensions: state.canvasDimensions, activeRatio: state.activeRatio }),
      [frameSize.liveDimensions, state.canvasDimensions, state.activeRatio],
    )
    const canvasDimensionsRef = React.useRef(canvasDimensions)
    canvasDimensionsRef.current = canvasDimensions
    const assetPanelItems = React.useMemo(
      () => getAssetPanelItems(state.layers, state.canvasAssets).reverse(),
      [state.canvasAssets, state.layers],
    )
    const resultItemById = React.useMemo(
      () => new Map([...canvasImageItems, ...resultItems].map((item) => [item.id, item])),
      [canvasImageItems, resultItems],
    )

    React.useImperativeHandle(
      ref,
      () => ({
        captureViewportFile: (filename?: string) => {
          if (!leaferCanvasRef.current) throw new Error(t('generationCommon.whiteboard.canvasNotReady'))
          return leaferCanvasRef.current.captureViewportFile(filename)
        },
        initialImageStatus: () => initialImageStatus,
        isBusy: () => initialImageStatus !== 'ready' || uploading || removeBgBusy,
        getState: () => serializeWhiteboardState({ ...documentRef.current.state, canvasDimensions, activeLayerId, sceneTransforms: leaferCanvasRef.current?.getSceneTransforms() ?? documentRef.current.state.sceneTransforms }),
      }),
      [canvasDimensions, activeLayerId, initialImageStatus, uploading, removeBgBusy, t],
    )

    const setActiveRatio = React.useCallback((activeRatio: AspectRatioKey) => {
      const dimensions = getCanvasDimensions(activeRatio, canvasDimensions.width)
      setState((current) => ({ ...current, activeRatio, canvasDimensions: dimensions }))
      settleFrame(dimensions)
    }, [canvasDimensions.width, settleFrame, setState])

    const commitStroke = React.useCallback(
      (stroke: CanvasStroke) => {
        setState((current) => {
          if (stroke.tool !== 'brush') {
            return { ...current, strokes: [...current.strokes, stroke] }
          }
          const layerId = createWhiteboardId('stroke-layer')
          const nextStroke = { ...stroke, layerId }
          const strokeIndex = current.layers.filter((layer) => layer.id.startsWith('stroke-layer')).length + 1
          return {
            ...current,
            activeLayerId: layerId,
            strokes: [...current.strokes, nextStroke],
            layers: [
              ...current.layers,
              {
                id: layerId,
                name: t('generationCommon.whiteboard.brushPath', { index: strokeIndex }),
                visible: true,
                locked: false,
                opacity: 1,
                kind: 'drawing',
                thumbnail: 'checker',
              },
            ],
          }
        })
        setActiveCanvasObject({ kind: 'stroke', id: stroke.id })
      },
      [t, setState],
    )

    const addImageToCanvas = React.useCallback(
      async (url: string, name: string, project: ProjectExecutionContext) => {
        project.assertCurrent()
        const imageSize = await loadImageSize(url)
        project.assertCurrent()
        if (!imageSize) throw new Error(t('generationCommon.whiteboard.imageReadFailed'))
        const { asset, layer } = createImageAssetForCanvas({
          url,
          name: name ?? t('generationCommon.whiteboard.importedImage'),
          ratio: state.activeRatio,
          dimensions: canvasDimensionsRef.current,
          imageSize,
        })
        setState((current) => ({
          ...current,
          canvasAssets: [...current.canvasAssets, asset],
          layers: [...current.layers, layer],
          activeLayerId: layer.id,
        }))
        return asset.id
      },
      [state.activeRatio, t, setState],
    )

    React.useEffect(() => {
      if (!initialImage?.url || importedInitialImageRef.current === initialImage.url || initialState) return
      importedInitialImageRef.current = initialImage.url
      setInitialImageStatus('loading')
      void withProjectAction(async (project) => {
        try {
          await addImageToCanvas(initialImage.url, t('generationCommon.whiteboard.originalImage'), project)
          project.assertCurrent()
          onRasterBaseline?.(serializeWhiteboardState(documentRef.current.state))
          setInitialImageStatus('ready')
        } catch (error) {
          if (project.signal.aborted || isProjectImportCancellation(error)) return
          setInitialImageStatus('failed')
          reportFeedback(t('generationCommon.whiteboard.importFailed'))
        }
      })
    }, [initialImportAttempt, onRasterBaseline, addImageToCanvas, initialImage?.url, initialState, reportFeedback, t])

    const handleUploadImage = React.useCallback(
      async (file: File | null | undefined) => {
        if (!file) return
        setFeedback(null)
        if (!file.type.startsWith('image/')) {
          reportFeedback(t('generationCommon.whiteboard.selectImageFile'))
          return
        }
        await withProjectAction(async (project) => {
          setUploading(true)
          try {
            const localUrl = await persistNodeImageFile(file, ownerNodeId, project)
            project.assertCurrent()
            const url = localUrl || (await fileToDataUrl(file, t('generationCommon.whiteboard.imageReadFailed')))
            project.assertCurrent()
            const assetId = await addImageToCanvas(url, file.name || t('generationCommon.whiteboard.importedImage'), project)
            // A picture the creator imports is picked up for placing; the source image seeded on open is not (the brush stays active).
            setActiveCanvasObject({ kind: 'asset', id: assetId })
            setActiveTool('select')
          } catch (error) {
            if (project.signal.aborted || isProjectImportCancellation(error)) return
            reportFeedback(
              error instanceof Error && error.message ? error.message : t('generationCommon.whiteboard.importFailed'),
            )
          } finally {
            if (!project.signal.aborted) setUploading(false)
          }
        })
      },
      [addImageToCanvas, ownerNodeId, t, reportFeedback],
    )

    const handleColorSelect = React.useCallback((color: string) => {
      setSelectedColor(color)
    }, [])

    const toggleLayerVisibility = React.useCallback((layerId: string) => {
      setState((current) => ({
        ...current,
        layers: current.layers.map((layer) => (layer.id === layerId ? { ...layer, visible: !layer.visible } : layer)),
      }))
    }, [setState])

    const selectAssetPanelItem = React.useCallback((item: AssetPanelItem) => {
      setActiveLayerId(item.layerId)
      setActiveCanvasObject(item.target)
      setActiveTool('select')
    }, [])

    const addLibraryImageToCanvasPoint = React.useCallback(
      (input: { url: string; name: string; width: number; height: number; point: { x: number; y: number } }) => {
        const layerId = createWhiteboardId('asset-layer')
        const assetIdCopy = createWhiteboardId('asset')
        const aspectRatio = input.height > 0 ? input.width / input.height : 1
        const maxW = canvasDimensions.width
        const maxH = canvasDimensions.height
        let width = Math.max(1, input.width)
        let height = Math.max(1, input.height)
        if (width > maxW) {
          width = maxW
          height = Math.round(width / aspectRatio)
        }
        if (height > maxH) {
          height = maxH
          width = Math.round(height * aspectRatio)
        }
        width = Math.max(1, width)
        height = Math.max(1, height)
        const x = clampCanvasPosition(Math.round(input.point.x - width / 2), width, canvasDimensions.width)
        const y = clampCanvasPosition(Math.round(input.point.y - height / 2), height, canvasDimensions.height)
        const baseName = stripFileExtension(input.name || t('generationCommon.whiteboard.asset'))
        const copyName = t('generationCommon.whiteboard.copyName', { name: baseName })

        setState((current) => ({
          ...current,
          canvasAssets: [
            ...current.canvasAssets,
            {
              id: assetIdCopy,
              layerId,
              name: copyName,
              url: input.url,
              source: 'upload',
              x,
              y,
              width,
              height,
            },
          ],
          layers: [
            ...current.layers,
            {
              id: layerId,
              name: copyName,
              visible: true,
              locked: false,
              opacity: 1,
              kind: 'asset',
              thumbnail: 'image',
            },
          ],
          activeLayerId: layerId,
        }))
        setActiveCanvasObject({ kind: 'asset', id: assetIdCopy })
        setActiveTool('select')
      },
      [canvasDimensions.height, canvasDimensions.width, t, setState],
    )

    const duplicateAssetToCanvasPoint = React.useCallback(
      (assetId: string, point: { x: number; y: number }) => {
        const sourceAsset = state.canvasAssets.find((asset) => asset.id === assetId)
        if (!sourceAsset) return
        addLibraryImageToCanvasPoint({
          url: sourceAsset.url,
          name: sourceAsset.name || t('generationCommon.whiteboard.asset'),
          width: sourceAsset.width,
          height: sourceAsset.height,
          point,
        })
      },
      [addLibraryImageToCanvasPoint, state.canvasAssets, t],
    )

    const addResultToCanvasPoint = React.useCallback(
      (itemId: string, point: { x: number; y: number }) => {
        const item = resultItemById.get(itemId)
        if (!item) return
        addLibraryImageToCanvasPoint({
          url: item.url,
          name: item.name || t('generationCommon.whiteboard.resultImage'),
          width: item.width || Math.round(canvasDimensions.width * 0.72),
          height: item.height || Math.round(canvasDimensions.width * 0.72),
          point,
        })
      },
      [addLibraryImageToCanvasPoint, canvasDimensions.width, resultItemById, t],
    )

    const handleAssetDragStart = React.useCallback(
      (event: React.DragEvent<HTMLElement>, payload: LibraryDragPayload) => {
        event.dataTransfer.effectAllowed = 'copy'
        const serialized = JSON.stringify(payload)
        event.dataTransfer.setData(ASSET_DRAG_MIME, serialized)
        event.dataTransfer.setData('text/plain', payload.source === 'board' ? payload.assetId : payload.itemId)
      },
      [],
    )

    const handleCanvasAssetDragOver = React.useCallback((event: React.DragEvent<HTMLElement>) => {
      if (!isWhiteboardAssetDrag(event.dataTransfer)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      setAssetDragOver(true)
    }, [])

    const handleCanvasAssetDrop = React.useCallback(
      (event: React.DragEvent<HTMLElement>) => {
        if (!isWhiteboardAssetDrag(event.dataTransfer)) return
        event.preventDefault()
        const payload = parseLibraryDragPayload(event.dataTransfer)
        const point = leaferCanvasRef.current?.clientPointToCanvasPoint(event.clientX, event.clientY)
        setAssetDragOver(false)
        if (!payload || !point) return
        if (payload.source === 'board') duplicateAssetToCanvasPoint(payload.assetId, point)
        else addResultToCanvasPoint(payload.itemId, point)
      },
      [addResultToCanvasPoint, duplicateAssetToCanvasPoint],
    )

    const groupCanvasObjects = React.useCallback((targets: CanvasObjectTarget[]) => {
      setState((current) => groupTargetsIntoLayer(current, targets))
    }, [setState])

    const deleteCanvasObject = React.useCallback((target: CanvasObjectTarget) => {
      // 静默 no-op 根治：锁定/背景层删除给明确反馈（此前 deleteTargetFromState 无声吞掉，
      // 用户体感「删不掉又没人告诉我为什么」）。
      setFeedback(null)
      const verdict = assessDeleteTarget(state, target)
      if (verdict === 'locked') { reportFeedback(t('generationCommon.whiteboard.deleteBlockedLocked')); return }
      if (verdict === 'background') { reportFeedback(t('generationCommon.whiteboard.deleteBlockedBackground')); return }
      setState((current) => deleteTargetFromState(current, target))
      setActiveCanvasObject(null)
    }, [state, t, reportFeedback, setState])

    const handleScreenshotClick = React.useCallback(() => {
      if (focusResultsOnScreenshot) setActiveLibraryTab('results')
      onScreenshot?.()
    }, [focusResultsOnScreenshot, onScreenshot])

    const handleRemoveBackground = React.useCallback(
      async (target: CanvasObjectTarget) => {
        if (removeBgBusy || target.kind !== 'asset') return
        const asset = state.canvasAssets.find((a) => a.id === target.id)
        if (!asset?.url) return
        await withProjectAction(async (project) => {
          setFeedback(null)
          const createdAt = Date.now()
          setRemoveBgBusy(true)
          setRemoveBgTargetId(asset.id)
          setRemoveBgProgress(0)
          setRemoveBgPhase(null)
          try {
            const blob = await removeBackgroundBlob(asset.url, ({ key, current, total }) => {
              if (project.signal.aborted) return
              if (total > 0) setRemoveBgProgress(Math.round((current / total) * 100))
              setRemoveBgPhase(removeBackgroundProgressMessage(key))
            })
            project.assertCurrent()
            const file = new File([blob], `rmbg-${asset.id}-${createdAt}.png`, { type: 'image/png' })
            const localUrl = await persistNodeImageFile(file, ownerNodeId, project)
            project.assertCurrent()
            const finalUrl = localUrl ?? (await blobToDataUrl(blob))
            project.assertCurrent()
            setState((current) => ({
              ...current,
              canvasAssets: current.canvasAssets.map((item) =>
                item.id === asset.id ? { ...item, url: finalUrl } : item,
              ),
            }))
            setActiveCanvasObject({ kind: 'asset', id: asset.id })
            setActiveTool('select')
          } catch (error) {
            if (project.signal.aborted || isProjectImportCancellation(error)) return
            reportFeedback(removeBackgroundFailureMessage(error))
          } finally {
            if (!project.signal.aborted) {
              setRemoveBgBusy(false)
              setRemoveBgTargetId(null)
              setRemoveBgProgress(null)
              setRemoveBgPhase(null)
            }
          }
        })
      },
      [ownerNodeId, removeBgBusy, state.canvasAssets, reportFeedback, setState],
    )

    const selectedText = activeCanvasObject?.kind === 'text' ? state.texts?.find((item) => item.id === activeCanvasObject.id) : undefined
    const measureText: TextMeasure = (content, fontSize) => leaferCanvasRef.current?.measureText(content, fontSize) ?? null
    const editText = (changes: Parameters<typeof applyTextChanges>[1]) => {
      if (!selectedText) return
      setState((current) => ({ ...current, texts: current.texts?.map((item) => item.id === selectedText.id ? applyTextChanges(item, changes, measureText) : item) }))
    }
    const placeText = (point: { x: number; y: number }) => {
      const id = createWhiteboardId('text')
      const layerId = createWhiteboardId('text-layer')
      const text: string = t('generationCommon.whiteboard.textPlaceholder')
      const created = createWhiteboardText({ id, layerId, text, x: point.x, y: point.y, fontSize: textSize, color: selectedColor }, measureText)
      if (!created) return
      setState((current) => ({ ...current, activeLayerId: layerId,
        texts: [...(current.texts ?? []), created],
        layers: [...current.layers, { id: layerId, name: text, visible: true, locked: false, opacity: 1, kind: 'text', thumbnail: 'checker' }],
      }))
      setActiveCanvasObject({ kind: 'text', id })
      setActiveTool('select')
    }
    const handleDimensionsChange = (dimensions: CanvasDimensions) => {
      const safe = { width: Math.round(Math.max(64, Math.min(4096, dimensions.width))), height: Math.round(Math.max(64, Math.min(4096, dimensions.height))) }
      setState((current) => ({ ...current, canvasDimensions: safe }))
      settleFrame(safe)
    }

    React.useEffect(() => { if (initialImageStatus === 'ready') onDraftChange?.() }, [revision, initialImageStatus, onDraftChange])
    const canUndo = historyState.current > 0 && snapshotsRef.current.has(historyState.history[historyState.current - 1])
    const canRedo = historyState.current < historyState.history.length - 1 && snapshotsRef.current.has(historyState.history[historyState.current + 1])
    const moveHistory = (direction: 'back' | 'forward') => {
      if (direction === 'back' ? !canUndo : !canRedo) return
      const target = snapshotsRef.current.get(historyState.history[historyState.current + (direction === 'back' ? -1 : 1)])!
      setActiveLayerId(target.state.activeLayerId)
      settleFrame(whiteboardCanvasDimensions(target.state))
      history[direction]()
    }

    const panelContent = panel === 'materials' ? (
      <div className="w-[360px] overflow-hidden">
        <WhiteboardLibraryPanel compact activeObject={activeCanvasObject} activeTab={activeLibraryTab} assetPanelItems={assetPanelItems}
          canvasImageItems={canvasImageItems} resultItems={resultItems} onActiveTabChange={setActiveLibraryTab}
          onAssetDragEnd={() => setAssetDragOver(false)} onAssetDragStart={handleAssetDragStart} onDeleteTarget={deleteCanvasObject}
          onSelectAsset={selectAssetPanelItem} onToggleLayerVisibility={toggleLayerVisibility} />
      </div>
    ) : panel === 'layers' ? (
      <div className="max-h-[320px] w-[300px] nowheel overflow-y-auto p-1">
        {[...state.layers].reverse().map((layer) => {
          const target: CanvasObjectTarget | undefined = layer.kind === 'group' ? { kind: 'group', id: layer.id }
            : state.canvasAssets.find((item) => item.layerId === layer.id) ? { kind: 'asset', id: state.canvasAssets.find((item) => item.layerId === layer.id)!.id }
            : state.texts?.find((item) => item.layerId === layer.id) ? { kind: 'text', id: state.texts.find((item) => item.layerId === layer.id)!.id }
            : state.strokes.find((item) => item.layerId === layer.id && item.tool !== 'eraser') ? { kind: 'stroke', id: state.strokes.find((item) => item.layerId === layer.id && item.tool !== 'eraser')!.id } : undefined
          return <div key={layer.id} className="flex h-8 items-center gap-1 rounded-nomi-sm px-1 hover:bg-nomi-ink-05">
            <button type="button" className="min-w-0 flex-1 truncate text-left text-caption" onClick={() => { setActiveLayerId(layer.id); setActiveCanvasObject(target ?? null); setActiveTool('select') }}>{layer.name}</button>
            <button type="button" className="grid size-7 place-items-center" aria-label={t(layer.visible ? 'generationCommon.whiteboard.library.hide' : 'generationCommon.whiteboard.library.show', { name: layer.name })} onClick={() => toggleLayerVisibility(layer.id)}>{layer.visible ? <IconEye size={15} /> : <IconEyeOff size={15} />}</button>
            {target && !layer.locked ? <button type="button" className="grid size-7 place-items-center text-nomi-ink-40 hover:text-workbench-danger" aria-label={t('generationCommon.whiteboard.deleteSelected')} onClick={() => deleteCanvasObject(target)}><IconTrash size={15} /></button> : null}
          </div>
        })}
      </div>
    ) : null

    return (
      <div ref={frameRef} tabIndex={-1} className={cn('whiteboard-tool nodrag nopan nokey nowheel absolute inset-0 overflow-visible text-nomi-ink', screenshotBusy && 'pointer-events-none',
        '[--accent:var(--nomi-accent)] [--accent-strong:var(--nomi-accent)] [--canvas:var(--nomi-paper)]')}
        onKeyDownCapture={(event) => {
          if (screenshotBusy) { event.preventDefault(); event.stopPropagation(); return }
          if (event.nativeEvent.isComposing || event.keyCode === 229) return
          const target = event.target as HTMLElement
          if (event.key === 'Escape' && panel) { event.preventDefault(); event.stopPropagation(); setPanel(null); return }
          if (target.closest('input,textarea,select,[contenteditable=true]')) { event.stopPropagation(); return }
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.stopPropagation(); moveHistory(event.shiftKey ? 'forward' : 'back'); return }
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (panel) setPanel(null); else if (initialImageStatus === 'failed') onAbort?.(); else if (initialImageStatus === 'ready' && !uploading && !removeBgBusy) onDone?.(); return }
          if (leaferCanvasRef.current?.handleKeyDown(event.nativeEvent)) { event.preventDefault(); event.stopPropagation() }
        }}
        onPointerDownCapture={(event) => { if ((event.target as HTMLElement).closest('[data-whiteboard-stage]')) event.currentTarget.focus({ preventScroll: true }) }}>
        <div data-whiteboard-stage="true" className={cn('absolute inset-0 overflow-hidden rounded-nomi bg-nomi-paper', assetDragOver && 'ring-2 ring-inset ring-nomi-ink-40', initialImageStatus !== 'ready' && 'pointer-events-none')}
          onDragOver={handleCanvasAssetDragOver} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setAssetDragOver(false) }} onDrop={handleCanvasAssetDrop}>
          <LeaferCanvas ref={leaferCanvasRef} ratio={state.activeRatio} dimensions={canvasDimensions} fitMode="inline"
            activeTool={activeTool} activeLayerId={activeLayerId} layers={state.layers} assets={state.canvasAssets} texts={state.texts}
            sceneTransforms={state.sceneTransforms} onSceneTransformsChange={(sceneTransforms) => setState((current) => ({ ...current, sceneTransforms }))}
            onSelectionChange={setSelectedTargets} color={selectedColor} brushSize={brushSize} strokes={state.strokes} activeObjectTarget={activeCanvasObject}
            removingBackgroundTargetId={removeBgTargetId} removingBackgroundProgress={removeBgProgress} onStrokeCommit={commitStroke}
            onLayerSelect={setActiveLayerId} onObjectSelect={(target, layerId) => { setActiveLayerId(layerId); setActiveCanvasObject(target) }}
            onObjectsGroup={groupCanvasObjects} onObjectDelete={deleteCanvasObject} onRemoveBackground={handleRemoveBackground}
            onTextPlace={placeText} />
        </div>
        {initialImageStatus === 'failed' ? <div role="alert" className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-nomi bg-nomi-paper px-4 text-body-sm">
          <p className="m-0 text-nomi-ink-60">{t('generationCommon.whiteboard.importFailed')}</p>
          <div className="flex items-center gap-2">
            <button type="button" className="rounded-nomi-sm border border-nomi-line px-3 py-1.5 text-nomi-ink" onClick={onAbort}>{t('common.cancel')}</button>
            <button type="button" className="rounded-nomi-sm bg-nomi-accent px-3 py-1.5 text-nomi-paper" onClick={() => { importedInitialImageRef.current = ''; setFeedback(null); setInitialImageStatus('loading'); setInitialImportAttempt((attempt) => attempt + 1) }}>{t('generationCommon.whiteboard.retryImport')}</button>
          </div>
        </div> : null}
        <WhiteboardEditingToolbar activeTool={activeTool} onToolChange={setActiveTool} color={selectedText?.color ?? selectedColor}
          onColorChange={(color) => { handleColorSelect(color); if (selectedText) editText({ color }) }} brushSize={brushSize} onBrushSizeChange={(size) => setBrushSize(clampBrushSize(size))}
          textValue={selectedText?.text} onTextValueChange={(text) => editText({ text })} textSize={selectedText?.fontSize ?? (activeTool === 'text' ? textSize : undefined)} onTextSizeChange={(size) => { setTextSize(size); if (selectedText) editText({ fontSize: size }) }}
          canUndo={canUndo} canRedo={canRedo} onUndo={() => moveHistory('back')} onRedo={() => moveHistory('forward')}
          onUpload={() => fileInputRef.current?.click()} uploading={uploading || initialImageStatus !== 'ready'} panel={panel} onPanelChange={setPanel} panelContent={panelContent}
          selectedTargets={selectedTargets} onFlip={(axis) => leaferCanvasRef.current?.flipSelection(axis)} onGroup={() => leaferCanvasRef.current?.groupSelection()}
          onDelete={() => leaferCanvasRef.current?.deleteSelection()} onRemoveBackground={() => { if (activeCanvasObject) void handleRemoveBackground(activeCanvasObject) }} removeBgBusy={removeBgBusy}
          ratio={state.activeRatio} onRatioChange={setActiveRatio} dimensions={canvasDimensions} onDimensionsChange={handleDimensionsChange}
          onScreenshot={onScreenshot && initialImageStatus === 'ready' ? handleScreenshotClick : undefined} screenshotBusy={screenshotBusy} screenshotLabel={effectiveScreenshotLabel} onDone={() => { if (initialImageStatus === 'ready' && !uploading && !removeBgBusy) onDone?.() }}
          feedback={externalFeedback ?? feedback ?? (removeBgBusy ? removeBgPhase ?? t('generationCommon.whiteboard.removingBackground') : null)} />
        <input ref={fileInputRef} className="hidden" type="file" accept="image/*" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void handleUploadImage(file) }} />
      </div>
    )
  },
)

export default WhiteboardDrawingTool
