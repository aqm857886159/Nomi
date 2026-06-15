import React from 'react'
import { createPortal } from 'react-dom'
import ReactPannellum, { usePannellum } from 'react-pannellum'
import { IconCamera, IconMaximize, IconX } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { WorkbenchIconButton } from '../../../design'

export type PanoramaScreenshot = {
  dataUrl: string
  dimensions: { width: number; height: number }
  title?: string
  prompt?: string
  source?: string
}

type PanoramaViewerProps = {
  imageUrl: string
  width: number
  height: number
  onEnterFullscreen?: (trigger: () => void) => void
  onCaptureFourView?: (trigger: () => void) => void
  onScreenshot?: (screenshot: PanoramaScreenshot) => void
}

type PanoramaDialogToolbarProps = {
  onClose: () => void
  onScreenshot?: (screenshot: PanoramaScreenshot) => void
}

type PanoramaFourViewCaptureBinderProps = {
  onCaptureFourView?: (trigger: () => void) => void
  onScreenshot?: (screenshot: PanoramaScreenshot) => void
}

type PannellumApi = ReturnType<typeof usePannellum>

type PannellumRenderer = {
  render?: (
    pitch: number,
    yaw: number,
    hfov: number,
    params?: { roll?: number; returnImage?: boolean },
  ) => string | undefined
}

type PannellumViewerWithRenderer = {
  getRenderer?: () => PannellumRenderer | undefined
}

type PanoramaCaptureView = {
  pitch: number
  yaw: number
  hfov: number
}

type PanoramaDirectionView = {
  yaw: number
}

const DEGREES_TO_RADIANS = Math.PI / 180
const PANORAMA_CARDINAL_VIEWS: PanoramaDirectionView[] = [
  { yaw: 0 },
  { yaw: 180 },
  { yaw: 90 },
  { yaw: -90 },
]

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function getPanoramaCanvas(container: HTMLElement | undefined): HTMLCanvasElement | null {
  return (
    container?.querySelector('.pnlm-render-container > canvas') ||
    container?.querySelector('canvas')
  ) as HTMLCanvasElement | null
}

function getScreenshotDimensions(container: HTMLElement | undefined, canvas: HTMLCanvasElement | null): PanoramaScreenshot['dimensions'] {
  const rect = container?.getBoundingClientRect()
  const width = canvas?.width || canvas?.clientWidth || Math.round(rect?.width || 0)
  const height = canvas?.height || canvas?.clientHeight || Math.round(rect?.height || 0)
  return {
    width: Math.max(1, width),
    height: Math.max(1, height),
  }
}

function getCurrentCaptureView(pannellum: PannellumApi): PanoramaCaptureView | null {
  const pitch = pannellum.getPitch()
  const yaw = pannellum.getYaw()
  const hfov = pannellum.getHfov()
  if (!isFiniteNumber(pitch) || !isFiniteNumber(yaw) || !isFiniteNumber(hfov)) return null
  return { pitch, yaw, hfov }
}

function renderPanoramaView(pannellum: PannellumApi, view: PanoramaCaptureView, returnImage: boolean): string | undefined {
  const container = pannellum.getContainer()
  const viewer = pannellum.getViewer() as (PannellumViewerWithRenderer & object) | null
  const renderer = viewer?.getRenderer?.()
  if (!container || !renderer?.render) return undefined

  const configRoll = pannellum.getConfig()?.roll
  const roll = isFiniteNumber(configRoll) ? configRoll : 0
  try {
    return renderer.render(
      view.pitch * DEGREES_TO_RADIANS,
      view.yaw * DEGREES_TO_RADIANS,
      view.hfov * DEGREES_TO_RADIANS,
      { roll: roll * DEGREES_TO_RADIANS, ...(returnImage ? { returnImage: true } : {}) },
    )
  } catch {
    return undefined
  }
}

function capturePanoramaView(pannellum: PannellumApi, view: PanoramaCaptureView): PanoramaScreenshot | null {
  const container = pannellum.getContainer()
  const canvas = getPanoramaCanvas(container)
  const dataUrl = renderPanoramaView(pannellum, view, true)

  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null
  return {
    dataUrl,
    dimensions: getScreenshotDimensions(container, canvas),
  }
}

function captureCurrentPanoramaView(pannellum: PannellumApi): PanoramaScreenshot | null {
  const currentView = getCurrentCaptureView(pannellum)
  if (!currentView) return null
  pannellum.stopMovement()
  return capturePanoramaView(pannellum, currentView)
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Unable to load panorama screenshot.'))
    image.src = dataUrl
  })
}

function drawImageCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const imageRatio = image.width / Math.max(1, image.height)
  const targetRatio = width / Math.max(1, height)
  const sourceWidth = imageRatio > targetRatio ? image.height * targetRatio : image.width
  const sourceHeight = imageRatio > targetRatio ? image.height : image.width / targetRatio
  const sourceX = (image.width - sourceWidth) / 2
  const sourceY = (image.height - sourceHeight) / 2
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height)
}

async function composeFourViewScreenshot(screenshots: PanoramaScreenshot[]): Promise<PanoramaScreenshot | null> {
  const firstScreenshot = screenshots[0]
  if (!firstScreenshot || screenshots.length !== 4) return null

  const cellWidth = Math.max(1, firstScreenshot.dimensions.width)
  const cellHeight = Math.max(1, Math.round(cellWidth * 9 / 16))
  const canvas = document.createElement('canvas')
  canvas.width = cellWidth * 2
  canvas.height = cellHeight * 2
  const context = canvas.getContext('2d')
  if (!context) return null

  const images = await Promise.all(screenshots.map((screenshot) => loadImage(screenshot.dataUrl)))
  context.fillStyle = '#000'
  context.fillRect(0, 0, canvas.width, canvas.height)
  images.forEach((image, index) => {
    drawImageCover(
      context,
      image,
      (index % 2) * cellWidth,
      Math.floor(index / 2) * cellHeight,
      cellWidth,
      cellHeight,
    )
  })

  return {
    dataUrl: canvas.toDataURL('image/png'),
    dimensions: {
      width: canvas.width,
      height: canvas.height,
    },
    title: '全景四视图',
    prompt: '全景前后左右四视图',
    source: 'panorama-four-view-screenshot',
  }
}

async function captureFourViewScreenshot(pannellum: PannellumApi): Promise<PanoramaScreenshot | null> {
  const currentView = getCurrentCaptureView(pannellum)
  if (!currentView) return null

  pannellum.stopMovement()
  const screenshots = PANORAMA_CARDINAL_VIEWS.map((view) => (
    capturePanoramaView(pannellum, {
      pitch: 0,
      yaw: view.yaw,
      hfov: currentView.hfov,
    })
  ))
  renderPanoramaView(pannellum, currentView, false)

  const capturedScreenshots = screenshots.filter((screenshot): screenshot is PanoramaScreenshot => screenshot !== null)
  if (capturedScreenshots.length !== PANORAMA_CARDINAL_VIEWS.length) return null
  return composeFourViewScreenshot(capturedScreenshots)
}

function PanoramaExportableViewer({ children, imageUrl, viewerId }: { children: React.ReactNode; imageUrl: string; viewerId: string }): JSX.Element {
  React.useLayoutEffect(() => {
    if (typeof HTMLCanvasElement === 'undefined') return undefined
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    const patchedGetContext = function patchedGetContext(
      this: HTMLCanvasElement,
      contextId: string,
      options?: unknown,
    ) {
      const shouldPreserve =
        (contextId === 'webgl' || contextId === 'experimental-webgl') &&
        this.parentElement?.classList.contains('pnlm-render-container') &&
        this.closest('[data-panorama-dialog-panel]')
      if (!shouldPreserve) {
        return originalGetContext.call(this, contextId as never, options as never)
      }
      return originalGetContext.call(this, contextId as never, {
        ...(typeof options === 'object' && options ? options : {}),
        preserveDrawingBuffer: true,
      } as never)
    } as HTMLCanvasElement['getContext']
    HTMLCanvasElement.prototype.getContext = patchedGetContext
    return () => {
      if (HTMLCanvasElement.prototype.getContext === patchedGetContext) {
        HTMLCanvasElement.prototype.getContext = originalGetContext
      }
    }
  }, [])

  return (
    <ReactPannellum
      id={viewerId}
      sceneId="fullscreen"
      imageSource={imageUrl}
      config={{ autoLoad: true, showZoomCtrl: false, showFullscreenCtrl: false, mouseZoom: true, draggable: true }}
      style={{ width: '100%', height: '100%' }}
    >
      {children}
    </ReactPannellum>
  )
}

function PanoramaDialogToolbar({ onClose, onScreenshot }: PanoramaDialogToolbarProps): JSX.Element {
  const pannellum = usePannellum()

  const handleScreenshot = React.useCallback(() => {
    const renderedScreenshot = captureCurrentPanoramaView(pannellum)
    if (renderedScreenshot) {
      onScreenshot?.(renderedScreenshot)
      return
    }

    const container = pannellum.getContainer()
    const canvas = getPanoramaCanvas(container)
    if (!canvas) return
    requestAnimationFrame(() => {
      try {
        onScreenshot?.({
          dataUrl: canvas.toDataURL('image/png'),
          dimensions: getScreenshotDimensions(container, canvas),
        })
      } catch {
        // Canvas export can be blocked if the panorama image is cross-origin without CORS headers.
      }
    })
  }, [onScreenshot, pannellum])

  return (
    <div
      className={cn(
        'absolute top-3 right-3 z-[2] flex items-center gap-1 p-[5px]',
        'border border-border-subtle rounded-pill',
        'bg-white/88 shadow-sm backdrop-blur-[12px] saturate-[1.2]',
      )}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <WorkbenchIconButton
        className={cn(
          'inline-grid w-6 h-6 place-items-center p-0',
          'border border-transparent rounded-full',
          'bg-transparent text-text-tertiary cursor-pointer',
          'hover:bg-surface-inline hover:text-text-primary',
          'disabled:opacity-45 disabled:cursor-wait',
        )}
        label="截图当前视口"
        icon={<IconCamera size={15} />}
        onClick={handleScreenshot}
      />
      <WorkbenchIconButton
        className={cn(
          'inline-grid w-6 h-6 place-items-center p-0',
          'border border-transparent rounded-full',
          'bg-transparent text-text-tertiary cursor-pointer',
          'hover:bg-surface-inline hover:text-text-primary',
          'disabled:opacity-45 disabled:cursor-wait',
        )}
        label="关闭预览"
        icon={<IconX size={15} />}
        onClick={onClose}
      />
    </div>
  )
}

function PanoramaFourViewCaptureBinder({ onCaptureFourView, onScreenshot }: PanoramaFourViewCaptureBinderProps): null {
  const pannellum = usePannellum()
  const capturingRef = React.useRef(false)

  React.useLayoutEffect(() => {
    onCaptureFourView?.(() => {
      if (capturingRef.current) return
      capturingRef.current = true
      void captureFourViewScreenshot(pannellum)
        .then((screenshot) => {
          if (screenshot) onScreenshot?.(screenshot)
        })
        .finally(() => {
          capturingRef.current = false
        })
    })
  }, [onCaptureFourView, onScreenshot, pannellum])

  return null
}

export default function PanoramaViewer({ imageUrl, width, height, onEnterFullscreen, onCaptureFourView, onScreenshot }: PanoramaViewerProps): JSX.Element {
  const [fullscreen, setFullscreen] = React.useState(false)
  const instanceId = React.useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const previewViewerId = `panorama-viewer-${instanceId}`
  const fullscreenViewerId = `panorama-fullscreen-${instanceId}`

  React.useLayoutEffect(() => {
    onEnterFullscreen?.(() => {
      setFullscreen(true)
    })
  }, [onEnterFullscreen])

  React.useEffect(() => {
    if (!fullscreen) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [fullscreen])

  if (!imageUrl) {
    return (
      <div
        className="flex items-center justify-center text-xs opacity-50"
        style={{ width, height }}
      >
        上传全景图或连接图片节点
      </div>
    )
  }

  return (
    <>
      <div
        className="group relative overflow-hidden rounded"
        style={{ width, height }}
      >
        <ReactPannellum
          id={previewViewerId}
          sceneId="main"
          imageSource={imageUrl}
          config={{ autoLoad: true, showZoomCtrl: false, showFullscreenCtrl: false, mouseZoom: false, draggable: false }}
          style={{ width: '100%', height: '100%' }}
        >
          <PanoramaFourViewCaptureBinder onCaptureFourView={onCaptureFourView} onScreenshot={onScreenshot} />
        </ReactPannellum>
        {/* 覆盖层：默认不拦事件（保留单击选中/拖动节点），悬停浮现「进入全景」按钮。
            之前只有节点上方那个浮动按钮能进全屏（需选中+有结果+非只读），用户双击图片无反应，
            这里给一个不依赖节点选中态的直接入口。 */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              setFullscreen(true)
            }}
            className={cn(
              'pointer-events-auto inline-flex items-center gap-1.5 rounded-full',
              'px-3 py-1.5 text-micro font-medium text-white',
              'bg-[rgba(15,18,22,0.64)] backdrop-blur-[6px]',
              'opacity-0 transition-opacity duration-150 group-hover:opacity-100',
              'hover:bg-[rgba(15,18,22,0.8)] focus-visible:opacity-100',
            )}
            aria-label="进入全景预览"
          >
            <IconMaximize size={14} stroke={1.8} />进入全景
          </button>
        </div>
      </div>

      {fullscreen && typeof document !== 'undefined' ? createPortal(
        <div
          className={cn(
            'fixed inset-0 z-[9999] flex items-center justify-center p-8',
            'bg-[rgba(15,18,22,0.72)] backdrop-blur-[10px]',
          )}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            if (event.target === event.currentTarget) setFullscreen(false)
          }}
        >
          <section
            className={cn(
              'relative w-[min(96vw,calc((100vh-64px)*16/9))] aspect-video',
              'max-h-[calc(100vh-64px)] overflow-hidden rounded-lg',
              'bg-black shadow-[0_24px_72px_rgba(15,18,22,0.42)]',
            )}
            data-panorama-dialog-panel
            role="dialog"
            aria-modal="true"
            aria-label="全景预览"
          >
            <PanoramaExportableViewer imageUrl={imageUrl} viewerId={fullscreenViewerId}>
              <PanoramaDialogToolbar
                onClose={() => setFullscreen(false)}
                onScreenshot={(screenshot) => onScreenshot?.(screenshot)}
              />
            </PanoramaExportableViewer>
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  )
}
