import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconBrush,
  IconCamera,
  IconCheck,
  IconMaximize,
  IconMinimize,
  IconPhotoPlus,
  IconTrash,
} from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'
import { toast } from '../../../../ui/toast'
import { persistNodeImageFile } from '../../adapters/persistNodeImage'
import { COMMON_COLORS, clampBrushSize, getCanvasDimensions, type AspectRatioKey, type ToolKey } from './lib/canvas'
import {
  LeaferCanvas,
  type CanvasObjectTarget,
  type CanvasStroke,
  type LeaferCanvasHandle,
} from './WhiteboardLeaferCanvas'
import type { WhiteboardInitialImage, WhiteboardResultLibraryItem, WhiteboardState } from './whiteboardTypes'
import {
  createDefaultWhiteboardState,
  createImageAssetForCanvas,
  createWhiteboardId,
  loadImageSize,
  serializeWhiteboardState,
} from './whiteboardState'
import { AspectRatioPopover, TOOL_ITEMS, ToolIconButton } from './WhiteboardToolbarControls'
import { WhiteboardLibraryPanel, type WhiteboardLibraryTabKey } from './WhiteboardLibraryPanel'
import { blobToDataUrl, removeBackgroundBlob } from '../../../../lib/removeBackground'
import {
  ASSET_DRAG_MIME,
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
  getState: () => WhiteboardState
}

type WhiteboardDrawingToolProps = {
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

function normalizeHexColor(value: string): string {
  return value.trim().toLowerCase()
}

function getSwatchForeground(hexColor: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hexColor)
  if (!match) return '#ffffff'
  const value = match[1]
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000
  return luminance > 170 ? '#111827' : '#ffffff'
}

const WhiteboardDrawingTool = React.forwardRef<WhiteboardDrawingToolHandle, WhiteboardDrawingToolProps>(
  function WhiteboardDrawingTool(
    {
      ownerNodeId,
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
    const effectiveScreenshotLabel = screenshotLabel ?? t('generationCommon.whiteboard.screenshotAndCreateNode')
    const [activeTool, setActiveTool] = React.useState<ToolKey>('brush')
    const [selectedColor, setSelectedColor] = React.useState('#2563eb')
    const [brushSize, setBrushSize] = React.useState(10)
    const [state, setState] = React.useState<WhiteboardState>(() => getInitialState(initialState, initialImage))
    const [activeCanvasObject, setActiveCanvasObject] = React.useState<CanvasObjectTarget | null>(null)
    const [uploading, setUploading] = React.useState(false)
    const [removeBgBusy, setRemoveBgBusy] = React.useState(false)
    const [removeBgTargetId, setRemoveBgTargetId] = React.useState<string | null>(null)
    const [removeBgProgress, setRemoveBgProgress] = React.useState<number | null>(null)
    const [assetDragOver, setAssetDragOver] = React.useState(false)
    const [activeLibraryTab, setActiveLibraryTab] = React.useState<WhiteboardLibraryTabKey>('board')
    const leaferCanvasRef = React.useRef<LeaferCanvasHandle | null>(null)
    const fullscreenPanelRef = React.useRef<HTMLDivElement | null>(null)
    const fileInputRef = React.useRef<HTMLInputElement | null>(null)
    const importedInitialImageRef = React.useRef('')
    const [isFullscreen, setIsFullscreen] = React.useState(false)

    const canvasDimensions = React.useMemo(() => getCanvasDimensions(state.activeRatio, 1280), [state.activeRatio])
    const assetPanelItems = React.useMemo(
      () => getAssetPanelItems(state.layers, state.canvasAssets).reverse(),
      [state.canvasAssets, state.layers],
    )
    const boardLibraryItemCount = assetPanelItems.length + canvasImageItems.length
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
        getState: () => serializeWhiteboardState(state),
      }),
      [state, t],
    )

    const setActiveRatio = React.useCallback((activeRatio: AspectRatioKey) => {
      setState((current) => ({ ...current, activeRatio }))
    }, [])

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
      [t],
    )

    const addImageToCanvas = React.useCallback(
      async (url: string, name?: string) => {
        const imageSize = await loadImageSize(url)
        const { asset, layer } = createImageAssetForCanvas({
          url,
          name: name ?? t('generationCommon.whiteboard.importedImage'),
          ratio: state.activeRatio,
          imageSize,
        })
        setState((current) => ({
          ...current,
          canvasAssets: [...current.canvasAssets, asset],
          layers: [...current.layers, layer],
          activeLayerId: layer.id,
        }))
        setActiveCanvasObject({ kind: 'asset', id: asset.id })
        setActiveTool('select')
      },
      [state.activeRatio, t],
    )

    React.useEffect(() => {
      if (!initialImage?.url || importedInitialImageRef.current === initialImage.url || initialState) return
      importedInitialImageRef.current = initialImage.url
      void addImageToCanvas(initialImage.url, t('generationCommon.whiteboard.originalImage'))
    }, [addImageToCanvas, initialImage?.url, initialState, t])

    React.useEffect(() => {
      if (typeof document === 'undefined') return undefined
      const handleFullscreenChange = () => {
        setIsFullscreen(document.fullscreenElement === fullscreenPanelRef.current)
      }
      document.addEventListener('fullscreenchange', handleFullscreenChange)
      return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }, [])

    const handleUploadImage = React.useCallback(
      async (file: File | null | undefined) => {
        if (!file) return
        if (!file.type.startsWith('image/')) {
          toast(t('generationCommon.whiteboard.selectImageFile'), 'warning')
          return
        }
        setUploading(true)
        try {
          const localUrl = await persistNodeImageFile(file, ownerNodeId)
          const url = localUrl || (await fileToDataUrl(file, t('generationCommon.whiteboard.imageReadFailed')))
          await addImageToCanvas(url, file.name || t('generationCommon.whiteboard.importedImage'))
        } catch (error) {
          toast(
            error instanceof Error && error.message ? error.message : t('generationCommon.whiteboard.importFailed'),
            'error',
          )
        } finally {
          setUploading(false)
        }
      },
      [addImageToCanvas, ownerNodeId, t],
    )

    const handleColorSelect = React.useCallback((color: string) => {
      setSelectedColor(color)
      setActiveTool('brush')
    }, [])

    const toggleLayerVisibility = React.useCallback((layerId: string) => {
      setState((current) => ({
        ...current,
        layers: current.layers.map((layer) => (layer.id === layerId ? { ...layer, visible: !layer.visible } : layer)),
      }))
    }, [])

    const selectAssetPanelItem = React.useCallback((item: AssetPanelItem) => {
      setState((current) => ({ ...current, activeLayerId: item.layerId }))
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
      [canvasDimensions.height, canvasDimensions.width, t],
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
    }, [])

    const deleteCanvasObject = React.useCallback((target: CanvasObjectTarget) => {
      setState((current) => deleteTargetFromState(current, target))
      setActiveCanvasObject(null)
    }, [])

    const toggleFullscreen = React.useCallback(() => {
      const panel = fullscreenPanelRef.current
      if (!panel || typeof document === 'undefined') return
      if (document.fullscreenElement) {
        void document.exitFullscreen()
        return
      }
      void panel.requestFullscreen?.()
    }, [])

    const handleScreenshotClick = React.useCallback(() => {
      if (focusResultsOnScreenshot) setActiveLibraryTab('results')
      onScreenshot?.()
    }, [focusResultsOnScreenshot, onScreenshot])

    const handleRemoveBackground = React.useCallback(
      (target: CanvasObjectTarget) => {
        if (removeBgBusy || target.kind !== 'asset') return
        const asset = state.canvasAssets.find((a) => a.id === target.id)
        if (!asset?.url) return
        const createdAt = Date.now()
        setRemoveBgBusy(true)
        setRemoveBgTargetId(asset.id)
        setRemoveBgProgress(0)
        void (async () => {
          try {
            const blob = await removeBackgroundBlob(asset.url, ({ current, total }) => {
              if (total > 0) setRemoveBgProgress(Math.round((current / total) * 100))
            })
            const file = new File([blob], `rmbg-${asset.id}-${createdAt}.png`, { type: 'image/png' })
            const localUrl = await persistNodeImageFile(file, ownerNodeId)
            const finalUrl = localUrl ?? (await blobToDataUrl(blob))
            setState((current) => ({
              ...current,
              canvasAssets: current.canvasAssets.map((item) =>
                item.id === asset.id ? { ...item, url: finalUrl } : item,
              ),
            }))
            setActiveCanvasObject({ kind: 'asset', id: asset.id })
            setActiveTool('select')
            toast(t('generationCommon.whiteboard.backgroundRemoved'), 'success')
          } catch {
            toast(t('generationCommon.whiteboard.removeBackgroundFailed'), 'error')
          } finally {
            setRemoveBgBusy(false)
            setRemoveBgTargetId(null)
            setRemoveBgProgress(null)
          }
        })()
      },
      [ownerNodeId, removeBgBusy, state.canvasAssets, t],
    )

    return (
      <div
        ref={fullscreenPanelRef}
        className={cn(
          'whiteboard-tool grid h-full min-h-0 w-full overflow-hidden',
          'bg-nomi-bg text-nomi-ink',
          '[--accent:var(--nomi-accent)] [--accent-strong:var(--nomi-accent)] [--canvas:var(--nomi-paper)]',
          '[--danger:var(--workbench-danger)] [--muted:var(--nomi-ink-60)] [--text:var(--nomi-ink)]',
        )}
        style={isFullscreen ? { width: '100vw', height: '100vh' } : undefined}
      >
        <div className="flex h-full min-h-0 w-full overflow-hidden">
          <section className="grid min-h-0 min-w-0 flex-[1_1_0] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-r border-nomi-line-soft bg-nomi-ink-05">
            <header className="flex min-h-[54px] shrink-0 items-center gap-3 border-b border-nomi-line-soft bg-nomi-paper px-4 shadow-nomi-sm">
              <div className="flex min-w-0 items-center gap-2">
                <div className="truncate text-title font-semibold text-nomi-ink">
                  {t('generationCommon.whiteboard.title')}
                </div>
                <span className="rounded-full border border-nomi-line bg-nomi-ink-05 px-2.5 py-1 text-caption font-medium tabular-nums text-nomi-ink-60">
                  {state.activeRatio}
                </span>
                {removeBgBusy ? (
                  <span
                    className="rounded-full bg-nomi-ink-10 px-2.5 py-1 text-caption font-medium text-nomi-ink-60"
                    role="status"
                    aria-label={t('generationCommon.whiteboard.removingBackgroundAria')}
                    aria-busy="true"
                  >
                    {t('generationCommon.whiteboard.removingBackground')}
                  </span>
                ) : null}
              </div>

              <div className="ml-auto flex shrink-0 items-center gap-1">
                <ToolIconButton
                  title={effectiveScreenshotLabel}
                  aria-label={effectiveScreenshotLabel}
                  disabled={!onScreenshot || screenshotBusy}
                  onClick={handleScreenshotClick}
                >
                  <IconCamera size={17} stroke={1.7} />
                </ToolIconButton>
                <ToolIconButton
                  title={
                    isFullscreen
                      ? t('generationCommon.whiteboard.exitFullscreen')
                      : t('generationCommon.whiteboard.fullscreen')
                  }
                  aria-label={
                    isFullscreen
                      ? t('generationCommon.whiteboard.exitFullscreen')
                      : t('generationCommon.whiteboard.fullscreen')
                  }
                  onClick={toggleFullscreen}
                >
                  {isFullscreen ? <IconMinimize size={17} stroke={1.7} /> : <IconMaximize size={17} stroke={1.7} />}
                </ToolIconButton>
              </div>
            </header>

            <main
              className={cn(
                'relative grid min-h-0 place-items-center overflow-hidden bg-nomi-ink-05 [container-type:size]',
                isFullscreen ? 'p-0' : 'p-4',
                assetDragOver &&
                  'after:pointer-events-none after:absolute after:inset-3 after:rounded-nomi after:border after:border-dashed after:border-nomi-accent after:bg-nomi-accent-soft/40',
              )}
              onDragOver={handleCanvasAssetDragOver}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setAssetDragOver(false)
              }}
              onDrop={handleCanvasAssetDrop}
            >
              <LeaferCanvas
                ref={leaferCanvasRef}
                ratio={state.activeRatio}
                dimensions={canvasDimensions}
                fitMode={isFullscreen ? 'bounded' : 'natural'}
                activeTool={activeTool}
                activeLayerId={state.activeLayerId}
                layers={state.layers}
                assets={state.canvasAssets}
                color={selectedColor}
                brushSize={brushSize}
                strokes={state.strokes}
                activeObjectTarget={activeCanvasObject}
                removingBackgroundTargetId={removeBgTargetId}
                removingBackgroundProgress={removeBgProgress}
                onStrokeCommit={commitStroke}
                onLayerSelect={(layerId) => setState((current) => ({ ...current, activeLayerId: layerId }))}
                onObjectSelect={(target, layerId) => {
                  setState((current) => ({ ...current, activeLayerId: layerId }))
                  setActiveCanvasObject(target)
                }}
                onObjectsGroup={groupCanvasObjects}
                onObjectDelete={deleteCanvasObject}
                onRemoveBackground={handleRemoveBackground}
              />
            </main>

            <footer className="shrink-0 border-t border-nomi-line-soft bg-nomi-paper px-3 py-2 shadow-nomi-sm">
              <div className="flex min-h-11 flex-wrap items-center justify-center gap-2">
                <div className="flex items-center gap-1 rounded-nomi border border-nomi-line bg-nomi-ink-05 p-1">
                  {TOOL_ITEMS.map((item) => (
                    <ToolIconButton
                      key={item.key}
                      active={activeTool === item.key}
                      title={t(`generationCommon.whiteboard.${item.labelKey}` as 'generationCommon.whiteboard.brush')}
                      aria-label={t(
                        `generationCommon.whiteboard.${item.labelKey}` as 'generationCommon.whiteboard.brush',
                      )}
                      disabled={item.disabled}
                      onClick={() => {
                        if (!item.disabled) setActiveTool(item.key)
                      }}
                    >
                      {item.icon}
                    </ToolIconButton>
                  ))}
                </div>

                <button
                  type="button"
                  className={cn(
                    'grid size-9 shrink-0 place-items-center rounded-nomi-sm border border-nomi-line bg-nomi-paper text-nomi-ink-60',
                    'transition-colors hover:bg-nomi-ink-05 hover:text-nomi-ink disabled:cursor-not-allowed disabled:opacity-40',
                  )}
                  title={t('generationCommon.whiteboard.importImage')}
                  aria-label={t('generationCommon.whiteboard.importImage')}
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <IconPhotoPlus size={17} stroke={1.7} />
                </button>

                <div className="flex items-center gap-1.5 rounded-nomi border border-nomi-line bg-nomi-ink-05 p-1">
                  <label
                    className={cn(
                      'relative grid size-9 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-nomi-sm border border-nomi-line bg-nomi-paper shadow-nomi-sm',
                      'transition-colors hover:border-nomi-ink-20 hover:bg-nomi-paper focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-nomi-accent',
                    )}
                    title={t('generationCommon.whiteboard.customBrushColor')}
                    aria-label={t('generationCommon.whiteboard.customBrushColor')}
                  >
                    <span
                      className="pointer-events-none absolute inset-1 rounded-nomi-sm border"
                      style={{
                        backgroundColor: selectedColor,
                        borderColor:
                          normalizeHexColor(selectedColor) === '#ffffff'
                            ? 'rgba(17, 24, 39, 0.28)'
                            : 'rgba(255, 255, 255, 0.28)',
                      }}
                      aria-hidden
                    />
                    <IconBrush
                      size={14}
                      stroke={2}
                      className="pointer-events-none relative z-[1]"
                      style={{
                        color: getSwatchForeground(selectedColor),
                        filter: 'drop-shadow(0 1px 1px rgba(0, 0, 0, 0.35))',
                      }}
                      aria-hidden
                    />
                    <input
                      className="absolute inset-0 z-[2] h-full w-full cursor-pointer opacity-0"
                      type="color"
                      value={selectedColor}
                      aria-label={t('generationCommon.whiteboard.customBrushColor')}
                      onChange={(event) => handleColorSelect(event.currentTarget.value)}
                    />
                  </label>
                  <span className="h-7 w-px bg-nomi-line-soft" aria-hidden />
                  {COMMON_COLORS.map((color) => {
                    const active = normalizeHexColor(selectedColor) === normalizeHexColor(color)
                    return (
                      <button
                        key={color}
                        type="button"
                        className={cn(
                          'relative grid size-8 shrink-0 place-items-center rounded-full border bg-nomi-paper p-[3px] shadow-nomi-sm transition-transform',
                          'hover:scale-105 hover:border-nomi-ink-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nomi-accent',
                          active ? 'border-nomi-accent' : 'border-nomi-line-soft',
                        )}
                        data-active={active ? 'true' : 'false'}
                        title={color}
                        aria-label={t('generationCommon.whiteboard.colorAria', { color })}
                        aria-pressed={active}
                        style={{
                          boxShadow: active
                            ? '0 0 0 2px var(--nomi-accent), 0 1px 4px rgba(15, 23, 42, 0.16)'
                            : undefined,
                        }}
                        onClick={() => handleColorSelect(color)}
                      >
                        <span
                          className="absolute inset-[3px] rounded-full border"
                          style={{
                            backgroundColor: color,
                            borderColor:
                              normalizeHexColor(color) === '#ffffff'
                                ? 'rgba(17, 24, 39, 0.28)'
                                : 'rgba(255, 255, 255, 0.18)',
                          }}
                          aria-hidden
                        />
                        {active ? (
                          <IconCheck
                            size={15}
                            stroke={2.5}
                            className="relative z-[1]"
                            style={{
                              color: getSwatchForeground(color),
                              filter: 'drop-shadow(0 1px 1px rgba(0, 0, 0, 0.45))',
                            }}
                            aria-hidden
                          />
                        ) : null}
                      </button>
                    )
                  })}
                </div>

                <label className="flex min-w-[168px] items-center gap-2 rounded-nomi border border-nomi-line bg-nomi-ink-05 px-2.5 py-1.5 text-caption text-nomi-ink-60">
                  <span className="w-8 shrink-0 tabular-nums">{brushSize}</span>
                  <input
                    className="h-5 min-w-0 flex-1 cursor-pointer accent-nomi-accent"
                    type="range"
                    min={4}
                    max={96}
                    value={brushSize}
                    onChange={(event) => setBrushSize(clampBrushSize(Number(event.currentTarget.value)))}
                  />
                </label>

                <AspectRatioPopover value={state.activeRatio} onChange={setActiveRatio} />

                <button
                  type="button"
                  className={cn(
                    'grid size-9 shrink-0 place-items-center rounded-nomi-sm border border-nomi-line bg-nomi-paper text-nomi-ink-60',
                    'transition-colors hover:bg-workbench-danger-soft hover:text-workbench-danger disabled:cursor-not-allowed disabled:opacity-40',
                  )}
                  title={t('generationCommon.whiteboard.deleteSelected')}
                  aria-label={t('generationCommon.whiteboard.deleteSelected')}
                  disabled={!activeCanvasObject}
                  onClick={() => {
                    if (activeCanvasObject) deleteCanvasObject(activeCanvasObject)
                  }}
                >
                  <IconTrash size={17} stroke={1.7} />
                </button>
              </div>
            </footer>
          </section>

          {!isFullscreen ? (
            <WhiteboardLibraryPanel
              activeObject={activeCanvasObject}
              activeTab={activeLibraryTab}
              assetPanelItems={assetPanelItems}
              boardLibraryItemCount={boardLibraryItemCount}
              canvasImageItems={canvasImageItems}
              resultItems={resultItems}
              onActiveTabChange={setActiveLibraryTab}
              onAssetDragEnd={() => setAssetDragOver(false)}
              onAssetDragStart={handleAssetDragStart}
              onDeleteTarget={deleteCanvasObject}
              onSelectAsset={selectAssetPanelItem}
              onToggleLayerVisibility={toggleLayerVisibility}
            />
          ) : null}
        </div>
        <input
          ref={fileInputRef}
          className="hidden"
          type="file"
          accept="image/*"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            void handleUploadImage(file)
          }}
        />
      </div>
    )
  },
)

export default WhiteboardDrawingTool
