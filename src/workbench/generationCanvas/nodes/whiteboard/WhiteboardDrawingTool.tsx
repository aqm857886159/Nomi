import React from 'react'
import {
  IconBrush,
  IconCamera,
  IconCheck,
  IconChevronDown,
  IconEraser,
  IconEye,
  IconEyeOff,
  IconMaximize,
  IconMinimize,
  IconPhoto,
  IconPhotoPlus,
  IconPointer,
  IconSquare,
  IconTrash,
} from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'
import { toast } from '../../../../ui/toast'
import { persistNodeImageFile } from '../../adapters/persistNodeImage'
import {
  ASPECT_RATIOS,
  COMMON_COLORS,
  clampBrushSize,
  getCanvasDimensions,
  type AspectRatioKey,
  type CanvasAsset,
  type LayerItem,
  type ToolKey,
} from './lib/canvas'
import {
  LeaferCanvas,
  type CanvasObjectTarget,
  type CanvasStroke,
  type LeaferCanvasHandle,
} from './WhiteboardLeaferCanvas'
import type { WhiteboardInitialImage, WhiteboardState } from './whiteboardTypes'
import {
  createDefaultWhiteboardState,
  createImageAssetForCanvas,
  createWhiteboardId,
  loadImageSize,
  serializeWhiteboardState,
} from './whiteboardState'

type AssetPanelItem = {
  id: string
  layerId: string
  name: string
  visible: boolean
  locked: boolean
  url: string
  width: number
  height: number
  target: CanvasObjectTarget
}

export type WhiteboardResultLibraryItem = {
  id: string
  nodeId: string
  name: string
  url: string
  width?: number
  height?: number
}

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
  onScreenshot?: () => void
}

const ASSET_DRAG_MIME = 'application/x-nomi-whiteboard-asset'

type LibraryTabKey = 'board' | 'results'

type LibraryDragPayload =
  | { source: 'board'; assetId: string }
  | { source: 'result'; itemId: string }

const TOOL_ITEMS: Array<{ key: ToolKey; label: string; icon: React.ReactNode; disabled?: boolean }> = [
  { key: 'brush', label: '画笔', icon: <IconBrush size={17} stroke={1.7} /> },
  { key: 'select', label: '选择', icon: <IconPointer size={17} stroke={1.7} /> },
  { key: 'eraser', label: '橡皮', icon: <IconEraser size={17} stroke={1.7} /> },
  { key: 'shape', label: '形状', icon: <IconSquare size={17} stroke={1.7} />, disabled: true },
]

type AspectRatioPopoverProps = {
  value: AspectRatioKey
  onChange: (value: AspectRatioKey) => void
}

function AspectRatioPopover({ value, onChange }: AspectRatioPopoverProps): JSX.Element {
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!open) return undefined
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node | null)) return
      setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        className={cn(
          'inline-flex h-9 min-w-[98px] items-center gap-1.5 rounded-nomi-sm border border-nomi-line bg-nomi-ink-05 pl-3 pr-2',
          'text-caption font-medium text-nomi-ink transition-colors hover:border-nomi-ink-20 hover:bg-nomi-paper',
          open && 'border-nomi-accent bg-nomi-paper',
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`画板比例 ${value}`}
        title="画板比例"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="text-nomi-ink-40">比例</span>
        <span className="tabular-nums">{value}</span>
        <IconChevronDown size={14} stroke={1.7} className="ml-auto text-nomi-ink-40" aria-hidden />
      </button>
      {open ? (
        <div
          className={cn(
            'absolute bottom-[calc(100%+8px)] left-1/2 z-[30] w-[138px] -translate-x-1/2 rounded-nomi border border-nomi-line bg-nomi-paper p-1 shadow-nomi-md',
          )}
          role="listbox"
          aria-label="选择画板比例"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {ASPECT_RATIOS.map((ratio) => {
            const active = ratio.label === value
            return (
              <button
                key={ratio.label}
                type="button"
                role="option"
                aria-selected={active}
                className={cn(
                  'flex h-8 w-full items-center gap-2 rounded-nomi-sm px-2 text-left text-caption transition-colors',
                  active ? 'bg-nomi-accent-soft font-semibold text-nomi-accent' : 'text-nomi-ink-80 hover:bg-nomi-ink-05 hover:text-nomi-ink',
                )}
                onClick={() => {
                  onChange(ratio.label)
                  setOpen(false)
                }}
              >
                <span className="min-w-0 flex-1 tabular-nums">{ratio.label}</span>
                <span
                  className={cn('grid h-4 w-6 place-items-center rounded-sm border border-nomi-line bg-nomi-ink-05', active && 'border-nomi-accent')}
                  aria-hidden
                >
                  <span
                    className="block max-h-3 max-w-5 rounded-nomi-sm bg-current opacity-70"
                    style={{
                      aspectRatio: `${ratio.width} / ${ratio.height}`,
                      width: ratio.width >= ratio.height ? 18 : undefined,
                      height: ratio.width < ratio.height ? 12 : undefined,
                    }}
                  />
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

type ToolIconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean
}

function ToolIconButton({ active = false, className, type = 'button', ...props }: ToolIconButtonProps): JSX.Element {
  return (
    <button
      {...props}
      type={type}
      aria-pressed={active || undefined}
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-nomi-sm border border-transparent bg-transparent text-nomi-ink-60',
        'transition-colors hover:bg-nomi-paper hover:text-nomi-ink',
        'disabled:cursor-not-allowed disabled:opacity-40',
        active && 'border-nomi-line bg-nomi-paper text-nomi-accent shadow-nomi-sm',
        className,
      )}
    />
  )
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }
      reject(new Error('图片读取失败'))
    }
    reader.onerror = () => reject(reader.error || new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}

function getInitialState(initialState: WhiteboardState | undefined, initialImage: WhiteboardInitialImage | undefined): WhiteboardState {
  return initialState ? serializeWhiteboardState(initialState) : createDefaultWhiteboardState(initialImage?.aspectRatio || '16:9')
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
  function WhiteboardDrawingTool({
    ownerNodeId,
    initialState,
    initialImage,
    canvasImageItems = [],
    resultItems = [],
    screenshotBusy = false,
    onScreenshot,
  }, ref) {
    const [activeTool, setActiveTool] = React.useState<ToolKey>('brush')
    const [selectedColor, setSelectedColor] = React.useState('#2563eb')
    const [brushSize, setBrushSize] = React.useState(10)
    const [state, setState] = React.useState<WhiteboardState>(() => getInitialState(initialState, initialImage))
    const [activeCanvasObject, setActiveCanvasObject] = React.useState<CanvasObjectTarget | null>(null)
    const [uploading, setUploading] = React.useState(false)
    const [assetDragOver, setAssetDragOver] = React.useState(false)
    const [activeLibraryTab, setActiveLibraryTab] = React.useState<LibraryTabKey>('board')
    const leaferCanvasRef = React.useRef<LeaferCanvasHandle | null>(null)
    const fullscreenPanelRef = React.useRef<HTMLDivElement | null>(null)
    const fileInputRef = React.useRef<HTMLInputElement | null>(null)
    const importedInitialImageRef = React.useRef('')
    const [isFullscreen, setIsFullscreen] = React.useState(false)

    const canvasDimensions = React.useMemo(
      () => getCanvasDimensions(state.activeRatio, 1280),
      [state.activeRatio],
    )
    const assetPanelItems = React.useMemo(
      () => getAssetPanelItems(state.layers, state.canvasAssets).reverse(),
      [state.canvasAssets, state.layers],
    )
    const boardLibraryItemCount = assetPanelItems.length + canvasImageItems.length
    const resultItemById = React.useMemo(() => new Map(
      [...canvasImageItems, ...resultItems].map((item) => [item.id, item]),
    ), [canvasImageItems, resultItems])

    React.useImperativeHandle(ref, () => ({
      captureViewportFile: (filename?: string) => {
        if (!leaferCanvasRef.current) throw new Error('画布还未准备好')
        return leaferCanvasRef.current.captureViewportFile(filename)
      },
      getState: () => serializeWhiteboardState(state),
    }), [state])

    const setActiveRatio = React.useCallback((activeRatio: AspectRatioKey) => {
      setState((current) => ({ ...current, activeRatio }))
    }, [])

    const commitStroke = React.useCallback((stroke: CanvasStroke) => {
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
              name: `画笔路径 ${strokeIndex}`,
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
    }, [])

    const addImageToCanvas = React.useCallback(async (url: string, name = '导入图片') => {
      const imageSize = await loadImageSize(url)
      const { asset, layer } = createImageAssetForCanvas({
        url,
        name,
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
    }, [state.activeRatio])

    React.useEffect(() => {
      if (!initialImage?.url || importedInitialImageRef.current === initialImage.url || initialState) return
      importedInitialImageRef.current = initialImage.url
      void addImageToCanvas(initialImage.url, '原图')
    }, [addImageToCanvas, initialImage?.url, initialState])

    React.useEffect(() => {
      if (typeof document === 'undefined') return undefined
      const handleFullscreenChange = () => {
        setIsFullscreen(document.fullscreenElement === fullscreenPanelRef.current)
      }
      document.addEventListener('fullscreenchange', handleFullscreenChange)
      return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }, [])

    const handleUploadImage = React.useCallback(async (file: File | null | undefined) => {
      if (!file) return
      if (!file.type.startsWith('image/')) {
        toast('请选择图片文件', 'warning')
        return
      }
      setUploading(true)
      try {
        const localUrl = await persistNodeImageFile(file, ownerNodeId)
        const url = localUrl || await fileToDataUrl(file)
        await addImageToCanvas(url, file.name || '导入图片')
      } catch (error) {
        toast(error instanceof Error && error.message ? error.message : '导入图片失败', 'error')
      } finally {
        setUploading(false)
      }
    }, [addImageToCanvas, ownerNodeId])

    const handleColorSelect = React.useCallback((color: string) => {
      setSelectedColor(color)
      setActiveTool('brush')
    }, [])

    const toggleLayerVisibility = React.useCallback((layerId: string) => {
      setState((current) => ({
        ...current,
        layers: current.layers.map((layer) => (
          layer.id === layerId ? { ...layer, visible: !layer.visible } : layer
        )),
      }))
    }, [])

    const selectAssetPanelItem = React.useCallback((item: AssetPanelItem) => {
      setState((current) => ({ ...current, activeLayerId: item.layerId }))
      setActiveCanvasObject(item.target)
      setActiveTool('select')
    }, [])

    const addLibraryImageToCanvasPoint = React.useCallback((input: {
      url: string
      name: string
      width: number
      height: number
      point: { x: number; y: number }
    }) => {
      const layerId = createWhiteboardId('asset-layer')
      const assetIdCopy = createWhiteboardId('asset')
      const width = Math.max(1, Math.min(input.width, canvasDimensions.width))
      const height = Math.max(1, Math.min(input.height, canvasDimensions.height))
      const x = clampCanvasPosition(Math.round(input.point.x - width / 2), width, canvasDimensions.width)
      const y = clampCanvasPosition(Math.round(input.point.y - height / 2), height, canvasDimensions.height)
      const baseName = stripFileExtension(input.name || '素材')

      setState((current) => ({
        ...current,
        canvasAssets: [
          ...current.canvasAssets,
          {
            id: assetIdCopy,
            layerId,
            name: `${baseName} 副本`,
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
            name: `${baseName} 副本`,
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
    }, [canvasDimensions.height, canvasDimensions.width])

    const duplicateAssetToCanvasPoint = React.useCallback((assetId: string, point: { x: number; y: number }) => {
      const sourceAsset = state.canvasAssets.find((asset) => asset.id === assetId)
      if (!sourceAsset) return
      addLibraryImageToCanvasPoint({
        url: sourceAsset.url,
        name: sourceAsset.name || '素材',
        width: sourceAsset.width,
        height: sourceAsset.height,
        point,
      })
    }, [addLibraryImageToCanvasPoint, state.canvasAssets])

    const addResultToCanvasPoint = React.useCallback((itemId: string, point: { x: number; y: number }) => {
      const item = resultItemById.get(itemId)
      if (!item) return
      addLibraryImageToCanvasPoint({
        url: item.url,
        name: item.name || '结果图片',
        width: item.width || Math.round(canvasDimensions.width * 0.72),
        height: item.height || Math.round(canvasDimensions.height * 0.72),
        point,
      })
    }, [addLibraryImageToCanvasPoint, canvasDimensions.height, canvasDimensions.width, resultItemById])

    const handleAssetDragStart = React.useCallback((event: React.DragEvent<HTMLElement>, payload: LibraryDragPayload) => {
      event.dataTransfer.effectAllowed = 'copy'
      const serialized = JSON.stringify(payload)
      event.dataTransfer.setData(ASSET_DRAG_MIME, serialized)
      event.dataTransfer.setData('text/plain', payload.source === 'board' ? payload.assetId : payload.itemId)
    }, [])

    const handleCanvasAssetDragOver = React.useCallback((event: React.DragEvent<HTMLElement>) => {
      if (!isWhiteboardAssetDrag(event.dataTransfer)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      setAssetDragOver(true)
    }, [])

    const handleCanvasAssetDrop = React.useCallback((event: React.DragEvent<HTMLElement>) => {
      if (!isWhiteboardAssetDrag(event.dataTransfer)) return
      event.preventDefault()
      const payload = parseLibraryDragPayload(event.dataTransfer)
      const point = leaferCanvasRef.current?.clientPointToCanvasPoint(event.clientX, event.clientY)
      setAssetDragOver(false)
      if (!payload || !point) return
      if (payload.source === 'board') duplicateAssetToCanvasPoint(payload.assetId, point)
      else addResultToCanvasPoint(payload.itemId, point)
    }, [addResultToCanvasPoint, duplicateAssetToCanvasPoint])

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
      setActiveLibraryTab('results')
      onScreenshot?.()
    }, [onScreenshot])

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
          <section
            className="grid min-h-0 min-w-0 flex-[1_1_0] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-r border-nomi-line-soft bg-nomi-ink-05"
          >
            <header className="flex min-h-[54px] shrink-0 items-center gap-3 border-b border-nomi-line-soft bg-nomi-paper px-4 shadow-nomi-sm">
              <div className="flex min-w-0 items-center gap-2">
                <div className="truncate text-title font-semibold text-nomi-ink">画板</div>
                <span className="rounded-full border border-nomi-line bg-nomi-ink-05 px-2.5 py-1 text-caption font-medium tabular-nums text-nomi-ink-60">
                  {state.activeRatio}
                </span>
              </div>

              <div className="ml-auto flex shrink-0 items-center gap-1">
                <ToolIconButton
                  title="截图并创建图片节点"
                  aria-label="截图并创建图片节点"
                  disabled={!onScreenshot || screenshotBusy}
                  onClick={handleScreenshotClick}
                >
                  <IconCamera size={17} stroke={1.7} />
                </ToolIconButton>
                <ToolIconButton
                  title={isFullscreen ? '退出全屏' : '全屏'}
                  aria-label={isFullscreen ? '退出全屏' : '全屏'}
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
                assetDragOver && 'after:pointer-events-none after:absolute after:inset-3 after:rounded-nomi after:border after:border-dashed after:border-nomi-accent after:bg-nomi-accent-soft/40',
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
                onStrokeCommit={commitStroke}
                onLayerSelect={(layerId) => setState((current) => ({ ...current, activeLayerId: layerId }))}
                onObjectSelect={(target, layerId) => {
                  setState((current) => ({ ...current, activeLayerId: layerId }))
                  setActiveCanvasObject(target)
                }}
                onObjectsGroup={groupCanvasObjects}
                onObjectDelete={deleteCanvasObject}
              />
            </main>

            <footer className="shrink-0 border-t border-nomi-line-soft bg-nomi-paper px-3 py-2 shadow-nomi-sm">
              <div className="flex min-h-11 flex-wrap items-center justify-center gap-2">
                <div className="flex items-center gap-1 rounded-nomi border border-nomi-line bg-nomi-ink-05 p-1">
                  {TOOL_ITEMS.map((item) => (
                    <ToolIconButton
                      key={item.key}
                      active={activeTool === item.key}
                      title={item.label}
                      aria-label={item.label}
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
                  title="导入图片"
                  aria-label="导入图片"
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
                    title="自定义画笔颜色"
                    aria-label="自定义画笔颜色"
                  >
                    <span
                      className="pointer-events-none absolute inset-1 rounded-nomi-sm border"
                      style={{
                        backgroundColor: selectedColor,
                        borderColor: normalizeHexColor(selectedColor) === '#ffffff' ? 'rgba(17, 24, 39, 0.28)' : 'rgba(255, 255, 255, 0.28)',
                      }}
                      aria-hidden
                    />
                    <IconBrush
                      size={14}
                      stroke={2}
                      className="pointer-events-none relative z-[1]"
                      style={{ color: getSwatchForeground(selectedColor), filter: 'drop-shadow(0 1px 1px rgba(0, 0, 0, 0.35))' }}
                      aria-hidden
                    />
                    <input
                      className="absolute inset-0 z-[2] h-full w-full cursor-pointer opacity-0"
                      type="color"
                      value={selectedColor}
                      aria-label="自定义画笔颜色"
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
                        aria-label={`颜色 ${color}`}
                        aria-pressed={active}
                        style={{ boxShadow: active ? '0 0 0 2px var(--nomi-accent), 0 1px 4px rgba(15, 23, 42, 0.16)' : undefined }}
                        onClick={() => handleColorSelect(color)}
                      >
                        <span
                          className="absolute inset-[3px] rounded-full border"
                          style={{
                            backgroundColor: color,
                            borderColor: normalizeHexColor(color) === '#ffffff' ? 'rgba(17, 24, 39, 0.28)' : 'rgba(255, 255, 255, 0.18)',
                          }}
                          aria-hidden
                        />
                        {active ? (
                          <IconCheck
                            size={15}
                            stroke={2.5}
                            className="relative z-[1]"
                            style={{ color: getSwatchForeground(color), filter: 'drop-shadow(0 1px 1px rgba(0, 0, 0, 0.45))' }}
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
                  title="删除选中元素"
                  aria-label="删除选中元素"
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
          <aside
            className="flex h-full min-h-0 min-w-[320px] shrink-0 flex-col overflow-hidden bg-nomi-paper"
            style={{ flexBasis: 'clamp(340px, 28vw, 500px)' }}
          >
            <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex min-h-11 shrink-0 items-center gap-2 border-b border-nomi-line-soft px-3 text-body-sm font-medium text-nomi-ink">
                <IconPhoto size={16} stroke={1.7} className="shrink-0 text-nomi-ink-40" />
                <span className="min-w-0 flex-1 truncate">素材库</span>
                <div className="ml-auto inline-flex shrink-0 rounded-nomi-sm border border-nomi-line bg-nomi-ink-05 p-0.5">
                  {([
                    { key: 'board' as const, label: '画板', count: boardLibraryItemCount },
                    { key: 'results' as const, label: '结果', count: resultItems.length },
                  ]).map((tab) => {
                    const active = activeLibraryTab === tab.key
                    return (
                      <button
                        key={tab.key}
                        type="button"
                        className={cn(
                          'inline-flex h-7 items-center gap-1 rounded-nomi-sm px-2 text-caption transition-colors',
                          active ? 'bg-nomi-paper font-medium text-nomi-ink shadow-nomi-sm' : 'text-nomi-ink-60 hover:text-nomi-ink',
                        )}
                        aria-pressed={active}
                        onClick={() => setActiveLibraryTab(tab.key)}
                      >
                        <span>{tab.label}</span>
                        <span className="text-micro text-nomi-ink-40">{tab.count}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="grid min-h-0 content-start gap-2 overflow-y-auto p-2.5">
                {activeLibraryTab === 'board' && boardLibraryItemCount === 0 ? (
                  <div className="grid min-h-[120px] place-items-center rounded-nomi border border-dashed border-nomi-line px-3 text-center text-caption text-nomi-ink-40">
                    画板中的图片节点结果会显示在这里
                  </div>
                ) : null}
                {activeLibraryTab === 'results' && resultItems.length === 0 ? (
                  <div className="grid min-h-[120px] place-items-center rounded-nomi border border-dashed border-nomi-line px-3 text-center text-caption text-nomi-ink-40">
                    连接的图片节点结果会显示在这里
                  </div>
                ) : null}
                {activeLibraryTab === 'board' && boardLibraryItemCount > 0 ? (
                  <div className="grid grid-cols-3 gap-2">
                    {assetPanelItems.map((item) => {
                      const active = activeCanvasObject?.kind === 'asset' && activeCanvasObject.id === item.target.id
                      return (
                        <div
                          key={item.id}
                          draggable
                          className={cn(
                            'group overflow-hidden rounded-nomi-sm border bg-nomi-paper text-caption shadow-nomi-sm',
                            'cursor-grab active:cursor-grabbing',
                            active
                              ? 'border-nomi-accent bg-nomi-accent-soft text-nomi-accent'
                              : 'border-nomi-line-soft text-nomi-ink-80 hover:border-nomi-line hover:bg-nomi-ink-05',
                          )}
                          title="拖到画板中复制"
                          onDragStart={(event) => handleAssetDragStart(event, { source: 'board', assetId: item.target.id })}
                          onDragEnd={() => setAssetDragOver(false)}
                        >
                          <button
                            type="button"
                            className="block w-full bg-transparent text-left text-inherit"
                            onClick={() => selectAssetPanelItem(item)}
                          >
                            <span className="block aspect-[4/3] overflow-hidden bg-nomi-ink-05">
                              <img
                                className={cn('h-full w-full object-cover', !item.visible && 'opacity-35 grayscale')}
                                src={item.url}
                                alt=""
                                draggable={false}
                              />
                            </span>
                            <span className="block min-w-0 truncate px-1.5 py-1 text-micro">{item.name}</span>
                          </button>
                          <div className="flex items-center justify-between border-t border-nomi-line-soft px-1 py-0.5">
                            <button
                              type="button"
                              className="grid size-6 place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-paper hover:text-nomi-ink"
                              aria-label={`${item.visible ? '隐藏' : '显示'}${item.name}`}
                              onClick={() => toggleLayerVisibility(item.layerId)}
                            >
                              {item.visible ? <IconEye size={13} stroke={1.7} /> : <IconEyeOff size={13} stroke={1.7} />}
                            </button>
                            <span className="min-w-0 truncate px-1 text-micro text-nomi-ink-40">
                              {item.width} x {item.height}
                            </span>
                            <button
                              type="button"
                              className="grid size-6 place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-workbench-danger-soft hover:text-workbench-danger disabled:opacity-30"
                              disabled={item.locked}
                              aria-label={`删除${item.name}`}
                              onClick={() => deleteCanvasObject(item.target)}
                            >
                              <IconTrash size={12} stroke={1.7} />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                    {canvasImageItems.map((item) => (
                      <div
                        key={item.id}
                        draggable
                        className="group overflow-hidden rounded-nomi-sm border border-nomi-line-soft bg-nomi-paper text-caption text-nomi-ink-80 shadow-nomi-sm cursor-grab hover:border-nomi-line hover:bg-nomi-ink-05 active:cursor-grabbing"
                        title="拖到画板中添加"
                        onDragStart={(event) => handleAssetDragStart(event, { source: 'result', itemId: item.id })}
                        onDragEnd={() => setAssetDragOver(false)}
                      >
                        <span className="block aspect-[4/3] overflow-hidden bg-nomi-ink-05">
                          <img className="h-full w-full object-cover" src={item.url} alt="" draggable={false} />
                        </span>
                        <span className="block min-w-0 truncate px-1.5 py-1 text-micro">{item.name}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {activeLibraryTab === 'results' && resultItems.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2">
                    {resultItems.map((item) => (
                      <div
                        key={item.id}
                        draggable
                        className="group overflow-hidden rounded-nomi-sm border border-nomi-line-soft bg-nomi-paper text-caption text-nomi-ink-80 shadow-nomi-sm cursor-grab hover:border-nomi-line hover:bg-nomi-ink-05 active:cursor-grabbing"
                        title="拖到画板中添加"
                        onDragStart={(event) => handleAssetDragStart(event, { source: 'result', itemId: item.id })}
                        onDragEnd={() => setAssetDragOver(false)}
                      >
                        <span className="block aspect-[4/3] overflow-hidden bg-nomi-ink-05">
                          <img className="h-full w-full object-cover" src={item.url} alt="" draggable={false} />
                        </span>
                        <span className="block min-w-0 truncate px-1.5 py-1 text-micro">{item.name}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </section>
          </aside>
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

function groupTargetsIntoLayer(state: WhiteboardState, targets: CanvasObjectTarget[]): WhiteboardState {
  const groupLayerIds = new Set(targets.filter((target) => target.kind === 'group').map((target) => target.id))
  const uniqueTargets = Array.from(new Map([
    ...targets.filter((target) => target.kind === 'asset' || target.kind === 'stroke'),
    ...state.canvasAssets
      .filter((asset) => groupLayerIds.has(asset.layerId))
      .map((asset): CanvasObjectTarget => ({ kind: 'asset', id: asset.id })),
    ...state.strokes
      .filter((stroke) => groupLayerIds.has(stroke.layerId) && stroke.tool !== 'eraser')
      .map((stroke): CanvasObjectTarget => ({ kind: 'stroke', id: stroke.id })),
  ].map((target) => [`${target.kind}:${target.id}`, target])).values())
  if (uniqueTargets.length < 2) return state

  const assetIds = new Set(uniqueTargets.filter((target) => target.kind === 'asset').map((target) => target.id))
  const strokeIds = new Set(uniqueTargets.filter((target) => target.kind === 'stroke').map((target) => target.id))
  const sourceLayerIds = new Set<string>()
  for (const asset of state.canvasAssets) if (assetIds.has(asset.id)) sourceLayerIds.add(asset.layerId)
  for (const stroke of state.strokes) if (strokeIds.has(stroke.id)) sourceLayerIds.add(stroke.layerId)
  for (const groupLayerId of groupLayerIds) sourceLayerIds.add(groupLayerId)
  if (sourceLayerIds.size === 0) return state

  const groupLayerId = createWhiteboardId('group-layer')
  const nextAssets = state.canvasAssets.map((asset) => (
    assetIds.has(asset.id) ? { ...asset, layerId: groupLayerId } : asset
  ))
  const nextStrokes = state.strokes.map((stroke) => (
    strokeIds.has(stroke.id) || (stroke.tool === 'eraser' && sourceLayerIds.has(stroke.layerId))
      ? { ...stroke, layerId: groupLayerId }
      : stroke
  ))
  const layerHasElement = (layerId: string) =>
    nextAssets.some((asset) => asset.layerId === layerId) ||
    nextStrokes.some((stroke) => stroke.layerId === layerId && stroke.tool !== 'eraser')
  const nextLayers: LayerItem[] = [
    ...state.layers.filter((layer) =>
      !sourceLayerIds.has(layer.id) ||
      layer.id === 'drawing-layer-1' ||
      layerHasElement(layer.id),
    ),
    {
      id: groupLayerId,
      name: `组合 ${state.layers.filter((layer) => layer.id.startsWith('group-layer')).length + 1}`,
      visible: true,
      locked: false,
      opacity: 1,
      kind: 'group',
      thumbnail: 'checker',
    },
  ]

  return {
    ...state,
    canvasAssets: nextAssets,
    strokes: nextStrokes,
    layers: nextLayers,
    activeLayerId: groupLayerId,
  }
}

function deleteTargetFromState(state: WhiteboardState, target: CanvasObjectTarget): WhiteboardState {
  const targetLayerId =
    target.kind === 'group'
      ? target.id
      : target.kind === 'asset'
        ? state.canvasAssets.find((asset) => asset.id === target.id)?.layerId
        : state.strokes.find((stroke) => stroke.id === target.id)?.layerId
  if (!targetLayerId) return state
  const layer = state.layers.find((item) => item.id === targetLayerId)
  if (!layer || layer.kind === 'background' || layer.locked) return state

  const nextAssets = state.canvasAssets.filter((asset) =>
    !(target.kind === 'asset' && asset.id === target.id) &&
    !(target.kind === 'group' && asset.layerId === target.id),
  )
  const nextStrokes = state.strokes.filter((stroke) =>
    !(target.kind === 'stroke' && stroke.id === target.id) &&
    !(target.kind === 'group' && stroke.layerId === target.id),
  )
  const layerStillHasElement =
    nextAssets.some((asset) => asset.layerId === targetLayerId) ||
    nextStrokes.some((stroke) => stroke.layerId === targetLayerId && stroke.tool !== 'eraser')
  const removeLayer = targetLayerId !== 'drawing-layer-1' && !layerStillHasElement
  return {
    ...state,
    canvasAssets: nextAssets,
    strokes: removeLayer ? nextStrokes.filter((stroke) => stroke.layerId !== targetLayerId) : nextStrokes,
    layers: removeLayer ? state.layers.filter((item) => item.id !== targetLayerId) : state.layers,
    activeLayerId: 'drawing-layer-1',
  }
}

function getAssetPanelItems(layers: LayerItem[], assets: CanvasAsset[]): AssetPanelItem[] {
  const layerMap = new Map(layers.map((layer) => [layer.id, layer]))
  return assets.map((asset): AssetPanelItem => {
    const layer = layerMap.get(asset.layerId)
    return {
      id: `asset:${asset.id}`,
      layerId: asset.layerId,
      name: layer?.name ?? stripFileExtension(asset.name),
      visible: layer?.visible ?? true,
      locked: layer?.locked ?? false,
      url: asset.url,
      width: Math.round(asset.width),
      height: Math.round(asset.height),
      target: { kind: 'asset', id: asset.id },
    }
  })
}

function stripFileExtension(value: string): string {
  return value.replace(/\.[^.]+$/, '') || value
}

function isWhiteboardAssetDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(ASSET_DRAG_MIME)
}

function parseLibraryDragPayload(dataTransfer: DataTransfer): LibraryDragPayload | null {
  const value = dataTransfer.getData(ASSET_DRAG_MIME)
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Partial<LibraryDragPayload>
    if (parsed.source === 'board' && typeof parsed.assetId === 'string' && parsed.assetId) {
      return { source: 'board', assetId: parsed.assetId }
    }
    if (parsed.source === 'result' && typeof parsed.itemId === 'string' && parsed.itemId) {
      return { source: 'result', itemId: parsed.itemId }
    }
  } catch {
    return { source: 'board', assetId: value }
  }
  return null
}

function clampCanvasPosition(value: number, itemSize: number, canvasSize: number): number {
  return Math.min(Math.max(0, canvasSize - itemSize), Math.max(0, value))
}
