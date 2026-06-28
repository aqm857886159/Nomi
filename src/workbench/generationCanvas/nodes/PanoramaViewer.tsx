import React from 'react'
import { createPortal } from 'react-dom'
import { EquirectangularAdapter, Viewer, type PanoData, type ViewerConfig } from '@photo-sphere-viewer/core'
import '@photo-sphere-viewer/core/index.css'
import { IconCamera, IconMaximize, IconX } from '@tabler/icons-react'
import { NomiImage } from '../../../design/media'
import { cn } from '../../../utils/cn'
import { WorkbenchIconButton } from '../../../design/workbenchActions'
import { toast } from '../../../ui/toast'

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
  onEnterFullscreen?: (trigger: (() => void) | null) => void
  onScreenshot?: (screenshot: PanoramaScreenshot) => void
}

type PhotoSphereViewerConfig = Pick<
  ViewerConfig,
  'keyboard' | 'mousemove' | 'mousewheel' | 'moveInertia' | 'touchmoveTwoFingers'
>

type PhotoSphereRendererInternals = {
  renderer?: {
    domElement?: HTMLCanvasElement
  }
}

type PanoramaCaptureRatioId = '16:9' | '9:16' | '1:1' | '4:3'

type PanoramaCaptureRatio = {
  id: PanoramaCaptureRatioId
  label: string
  width: number
  height: number
}

type PanoramaCaptureFeedback = {
  tone: 'info' | 'success' | 'error'
  message: string
}

const PANORAMA_FULLSCREEN_CONFIG: PhotoSphereViewerConfig = {
  keyboard: 'always',
  mousemove: true,
  mousewheel: true,
  moveInertia: true,
  touchmoveTwoFingers: false,
}

const PANORAMA_CAPTURE_RATIOS: PanoramaCaptureRatio[] = [
  { id: '16:9', label: '16:9', width: 16, height: 9 },
  { id: '9:16', label: '9:16', width: 9, height: 16 },
  { id: '1:1', label: '1:1', width: 1, height: 1 },
  { id: '4:3', label: '4:3', width: 4, height: 3 },
]

const DEFAULT_CAPTURE_RATIO_ID: PanoramaCaptureRatioId = '16:9'
const CAPTURE_FRAME_HORIZONTAL_INSET = 48
const CAPTURE_FRAME_VERTICAL_INSET = 96
const PhotoSphereViewerContext = React.createContext<Viewer | null>(null)

function buildFullEquirectangularPanoData(image: HTMLImageElement): PanoData {
  return {
    isEquirectangular: true,
    fullWidth: image.width,
    fullHeight: image.height,
    croppedWidth: image.width,
    croppedHeight: image.height,
    croppedX: 0,
    croppedY: 0,
    poseHeading: 0,
    posePitch: 0,
    poseRoll: 0,
  }
}

function getCaptureRatio(ratioId: PanoramaCaptureRatioId): PanoramaCaptureRatio {
  return PANORAMA_CAPTURE_RATIOS.find((ratio) => ratio.id === ratioId) || PANORAMA_CAPTURE_RATIOS[0]
}

function getPhotoSphereCanvas(viewer: Viewer | null): HTMLCanvasElement | null {
  const rendererInternals = viewer?.renderer as unknown as PhotoSphereRendererInternals | undefined
  const internalCanvas = rendererInternals?.renderer?.domElement
  if (internalCanvas instanceof HTMLCanvasElement) return internalCanvas
  return (viewer?.container.querySelector('canvas') as HTMLCanvasElement | null) ?? null
}

function cropCurrentPanoramaFrame(viewer: Viewer, frameElement: HTMLElement): PanoramaScreenshot | null {
  const canvas = getPhotoSphereCanvas(viewer)
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) return null

  const containerRect = viewer.container.getBoundingClientRect()
  const frameRect = frameElement.getBoundingClientRect()
  const left = Math.max(frameRect.left, containerRect.left)
  const top = Math.max(frameRect.top, containerRect.top)
  const right = Math.min(frameRect.right, containerRect.right)
  const bottom = Math.min(frameRect.bottom, containerRect.bottom)
  if (right <= left || bottom <= top || containerRect.width <= 0 || containerRect.height <= 0) return null

  const scaleX = canvas.width / containerRect.width
  const scaleY = canvas.height / containerRect.height
  const sourceX = Math.max(0, Math.round((left - containerRect.left) * scaleX))
  const sourceY = Math.max(0, Math.round((top - containerRect.top) * scaleY))
  const sourceWidth = Math.max(1, Math.min(canvas.width - sourceX, Math.round((right - left) * scaleX)))
  const sourceHeight = Math.max(1, Math.min(canvas.height - sourceY, Math.round((bottom - top) * scaleY)))
  const outputCanvas = document.createElement('canvas')
  outputCanvas.width = sourceWidth
  outputCanvas.height = sourceHeight
  const context = outputCanvas.getContext('2d')
  if (!context) return null

  try {
    context.drawImage(canvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight)
    return {
      dataUrl: outputCanvas.toDataURL('image/png'),
      dimensions: { width: outputCanvas.width, height: outputCanvas.height },
      title: '全景截图',
      prompt: '全景取景框截图',
      source: 'panorama-framed-screenshot',
    }
  } catch {
    // Canvas export can be blocked if a remote panorama image is loaded without CORS support.
    return null
  }
}

function captureFramedPanoramaView(
  viewer: Viewer,
  frameElement: HTMLElement,
): Promise<PanoramaScreenshot | null> {
  return new Promise((resolve) => {
    let resolved = false
    let timeout: ReturnType<typeof setTimeout> | null = null
    const finish = () => {
      if (resolved) return
      resolved = true
      if (timeout) clearTimeout(timeout)
      resolve(cropCurrentPanoramaFrame(viewer, frameElement))
    }
    viewer.addEventListener('render', finish, { once: true })
    timeout = setTimeout(finish, 250)
    viewer.needsUpdate()
  })
}

function useElementSize(element: HTMLElement | null): { width: number; height: number } {
  const [size, setSize] = React.useState({ width: 0, height: 0 })

  React.useLayoutEffect(() => {
    if (!element) {
      setSize({ width: 0, height: 0 })
      return undefined
    }

    const update = () => {
      const rect = element.getBoundingClientRect()
      setSize({
        width: Math.max(0, Math.round(rect.width)),
        height: Math.max(0, Math.round(rect.height)),
      })
    }
    update()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  return size
}

function computeCaptureFrameSize(
  panelSize: { width: number; height: number },
  captureRatio: PanoramaCaptureRatio,
): { width: number; height: number } | null {
  if (panelSize.width <= 0 || panelSize.height <= 0) return null
  const ratio = captureRatio.width / captureRatio.height
  const maxWidth = Math.max(1, panelSize.width - CAPTURE_FRAME_HORIZONTAL_INSET)
  const maxHeight = Math.max(1, panelSize.height - CAPTURE_FRAME_VERTICAL_INSET)
  if (maxWidth / maxHeight > ratio) {
    const height = Math.max(1, Math.round(maxHeight))
    return { width: Math.max(1, Math.round(height * ratio)), height }
  }
  const width = Math.max(1, Math.round(maxWidth))
  return { width, height: Math.max(1, Math.round(width / ratio)) }
}

function PhotoSpherePanoramaViewer({
  children,
  config,
  imageUrl,
}: {
  children?: React.ReactNode
  config: PhotoSphereViewerConfig
  imageUrl: string
}): JSX.Element {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const [viewer, setViewer] = React.useState<Viewer | null>(null)

  React.useLayoutEffect(() => {
    const container = containerRef.current
    if (!container || !imageUrl) return undefined

    container.innerHTML = ''
    const nextViewer = new Viewer({
      container,
      panorama: imageUrl,
      adapter: EquirectangularAdapter.withConfig({
        resolution: 128,
        useXmpData: false,
      }),
      panoData: buildFullEquirectangularPanoData,
      navbar: false,
      loadingTxt: '',
      canvasBackground: '#000',
      defaultYaw: 0,
      defaultPitch: 0,
      defaultZoomLvl: 50,
      rendererParameters: {
        alpha: false,
        antialias: false,
        powerPreference: 'low-power',
        preserveDrawingBuffer: true,
      },
      ...config,
    })
    setViewer(nextViewer)

    let cancelled = false
    let firstFrame = 0
    let secondFrame = 0
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    let resizeObserver: ResizeObserver | null = null
    const runResize = () => {
      if (cancelled) return
      const rect = container.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      try {
        nextViewer.resize({
          width: `${Math.round(rect.width)}px`,
          height: `${Math.round(rect.height)}px`,
        })
        nextViewer.needsUpdate()
      } catch {
        /* The native viewer can be between initialization and first render. */
      }
    }

    nextViewer.addEventListener('ready', runResize, { once: true })
    firstFrame = requestAnimationFrame(() => {
      runResize()
      secondFrame = requestAnimationFrame(runResize)
    })
    settleTimer = setTimeout(runResize, 240)

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(runResize)
      resizeObserver.observe(container)
    }

    return () => {
      cancelled = true
      cancelAnimationFrame(firstFrame)
      cancelAnimationFrame(secondFrame)
      if (settleTimer) clearTimeout(settleTimer)
      resizeObserver?.disconnect()
      setViewer((currentViewer) => (currentViewer === nextViewer ? null : currentViewer))
      try {
        nextViewer.destroy()
      } catch {
        /* The native viewer can already be torn down by React remounts. */
      }
      container.innerHTML = ''
    }
  }, [config, imageUrl])

  return (
    <PhotoSphereViewerContext.Provider value={viewer}>
      <div
        ref={containerRef}
        className="h-full w-full [&_.psv-container]:!bg-nomi-ink"
        style={{ width: '100%', height: '100%' }}
      />
      {children}
    </PhotoSphereViewerContext.Provider>
  )
}

function PanoramaCaptureOverlay({
  captureFrameRef,
  captureRatio,
  frameSize,
}: {
  captureFrameRef: React.RefObject<HTMLDivElement>
  captureRatio: PanoramaCaptureRatio
  frameSize: { width: number; height: number } | null
}): JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center" aria-hidden="true">
      <div
        ref={captureFrameRef}
        data-panorama-capture-frame
        className="relative rounded-nomi-sm border border-nomi-paper/[0.92]"
        style={{
          width: frameSize?.width ?? 'auto',
          height: frameSize?.height ?? `max(1px, calc(100% - ${CAPTURE_FRAME_VERTICAL_INSET}px))`,
          maxWidth: `max(1px, calc(100% - ${CAPTURE_FRAME_HORIZONTAL_INSET}px))`,
          maxHeight: `max(1px, calc(100% - ${CAPTURE_FRAME_VERTICAL_INSET}px))`,
          aspectRatio: `${captureRatio.width} / ${captureRatio.height}`,
          boxSizing: 'border-box',
          flex: '0 0 auto',
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.56), 0 0 0 1px rgba(0, 0, 0, 0.45) inset',
        }}
      >
        <span className="absolute left-[-1px] top-[-1px] h-5 w-5 rounded-tl-[6px] border-l-2 border-t-2 border-nomi-paper" />
        <span className="absolute right-[-1px] top-[-1px] h-5 w-5 rounded-tr-[6px] border-r-2 border-t-2 border-nomi-paper" />
        <span className="absolute bottom-[-1px] left-[-1px] h-5 w-5 rounded-bl-[6px] border-b-2 border-l-2 border-nomi-paper" />
        <span className="absolute bottom-[-1px] right-[-1px] h-5 w-5 rounded-br-[6px] border-b-2 border-r-2 border-nomi-paper" />
      </div>
    </div>
  )
}

function PanoramaDialogControls({
  captureFrameRef,
  captureRatioId,
  onCaptureRatioChange,
  onClose,
  onScreenshot,
}: {
  captureFrameRef: React.RefObject<HTMLDivElement>
  captureRatioId: PanoramaCaptureRatioId
  onCaptureRatioChange: (ratioId: PanoramaCaptureRatioId) => void
  onClose: () => void
  onScreenshot?: (screenshot: PanoramaScreenshot) => void
}): JSX.Element {
  const viewer = React.useContext(PhotoSphereViewerContext)
  const [capturing, setCapturing] = React.useState(false)
  const [feedback, setFeedback] = React.useState<PanoramaCaptureFeedback | null>(null)
  const mountedRef = React.useRef(true)
  const feedbackTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const showFeedback = React.useCallback((nextFeedback: PanoramaCaptureFeedback) => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    setFeedback(nextFeedback)
    feedbackTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setFeedback(null)
    }, 2200)
  }, [])

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    }
  }, [])

  const handleScreenshot = React.useCallback(() => {
    if (capturing) return
    if (!viewer || !captureFrameRef.current) {
      showFeedback({ tone: 'info', message: '全景还没准备好，请稍后再试' })
      toast('全景还没准备好，请稍后再试', 'info')
      return
    }

    setCapturing(true)
    showFeedback({ tone: 'info', message: '截图中…' })
    void captureFramedPanoramaView(viewer, captureFrameRef.current)
      .then((screenshot) => {
        if (!screenshot) {
          showFeedback({ tone: 'error', message: '截图失败，请重试' })
          toast('截图失败，请重试', 'error')
          return
        }
        onScreenshot?.(screenshot)
        showFeedback({ tone: 'success', message: '已创建全景截图节点' })
      })
      .catch(() => {
        showFeedback({ tone: 'error', message: '截图失败，请重试' })
        toast('截图失败，请重试', 'error')
      })
      .finally(() => {
        if (mountedRef.current) setCapturing(false)
      })
  }, [captureFrameRef, capturing, onScreenshot, showFeedback, viewer])

  return (
    <>
      {feedback ? (
        <div
          className={cn(
            'pointer-events-none absolute bottom-6 left-1/2 z-[4] -translate-x-1/2',
            'rounded-pill border px-4 py-2 text-caption font-semibold shadow-[0_14px_34px_rgba(0,0,0,0.42)]',
            feedback.tone === 'success'
              ? 'border-white/85 bg-white text-black'
              : feedback.tone === 'error'
                ? 'border-white/40 bg-workbench-danger text-white'
                : 'border-white/20 bg-black/90 text-white',
          )}
          role="status"
          aria-live="polite"
        >
          {feedback.message}
        </div>
      ) : null}

      <div
        className={cn(
          'absolute left-1/2 top-3 z-[3] flex -translate-x-1/2 items-center gap-1 p-1',
          'rounded-pill border border-nomi-line bg-nomi-paper shadow-nomi-md',
          'backdrop-blur-[12px] saturate-[1.2]',
        )}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {PANORAMA_CAPTURE_RATIOS.map((ratio) => (
          <button
            key={ratio.id}
            type="button"
            className={cn(
              'h-7 rounded-full px-2.5 text-micro font-medium tabular-nums transition-colors duration-150',
              captureRatioId === ratio.id
                ? 'bg-nomi-ink text-nomi-paper'
                : 'bg-transparent text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink',
            )}
            aria-pressed={captureRatioId === ratio.id}
            onClick={() => onCaptureRatioChange(ratio.id)}
          >
            {ratio.label}
          </button>
        ))}
      </div>

      <div
        className={cn(
          'absolute right-3 top-3 z-[3] flex items-center gap-1 p-1.5',
          'rounded-pill border border-nomi-line bg-nomi-paper shadow-nomi-md',
          'backdrop-blur-[12px] saturate-[1.2]',
        )}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <WorkbenchIconButton
          className={cn(
            'inline-grid h-6 w-6 place-items-center p-0',
            'rounded-full border border-transparent bg-transparent text-nomi-ink-60 cursor-pointer',
            'hover:bg-nomi-ink-05 hover:text-nomi-ink',
            'disabled:opacity-45 disabled:cursor-wait',
          )}
          label={capturing ? '截图中' : '截图取景框'}
          icon={<IconCamera size={15} />}
          disabled={capturing}
          onClick={handleScreenshot}
        />
        <WorkbenchIconButton
          className={cn(
            'inline-grid h-6 w-6 place-items-center p-0',
            'rounded-full border border-transparent bg-transparent text-nomi-ink-60 cursor-pointer',
            'hover:bg-nomi-ink-05 hover:text-nomi-ink',
            'disabled:opacity-45 disabled:cursor-wait',
          )}
          label="关闭预览"
          icon={<IconX size={15} />}
          onClick={onClose}
        />
      </div>
    </>
  )
}

export default function PanoramaViewer({
  imageUrl,
  width,
  height,
  onEnterFullscreen,
  onScreenshot,
}: PanoramaViewerProps): JSX.Element {
  const [fullscreen, setFullscreen] = React.useState(false)
  const [captureRatioId, setCaptureRatioId] = React.useState<PanoramaCaptureRatioId>(DEFAULT_CAPTURE_RATIO_ID)
  const instanceId = React.useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const [panelElement, setPanelElement] = React.useState<HTMLElement | null>(null)
  const captureFrameRef = React.useRef<HTMLDivElement | null>(null)
  const panelSize = useElementSize(panelElement)
  const captureRatio = getCaptureRatio(captureRatioId)
  const captureFrameSize = computeCaptureFrameSize(panelSize, captureRatio)
  const openFullscreen = React.useCallback(() => {
    setFullscreen(true)
  }, [])

  React.useLayoutEffect(() => {
    onEnterFullscreen?.(openFullscreen)
    return () => onEnterFullscreen?.(null)
  }, [onEnterFullscreen, openFullscreen])

  React.useEffect(() => {
    if (!fullscreen) return undefined
    const body = document.body
    const root = document.documentElement
    const previousBodyOverflow = body.style.overflow
    const previousRootOverflow = root.style.overflow
    body.style.overflow = 'hidden'
    root.style.overflow = 'hidden'
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      body.style.overflow = previousBodyOverflow
      root.style.overflow = previousRootOverflow
    }
  }, [fullscreen])

  if (!imageUrl) {
    return (
      <div
        className="flex items-center justify-center text-caption opacity-50"
        style={{ width, height }}
      >
        上传全景图或连接图片节点
      </div>
    )
  }

  return (
    <>
      <div
        className="group relative overflow-hidden rounded-nomi bg-nomi-ink"
        style={{ width, height }}
        data-panorama-viewer-id={instanceId}
      >
        <NomiImage
          src={imageUrl}
          className="h-full w-full object-cover object-center pointer-events-none select-none"
          alt=""
        />
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              openFullscreen()
            }}
            className={cn(
              'pointer-events-auto inline-flex items-center gap-1.5 rounded-full',
              'px-3 py-1.5 text-micro font-medium text-nomi-paper',
              'bg-[color-mix(in_oklab,var(--nomi-ink)64%,transparent)] backdrop-blur-[6px]',
              'opacity-0 transition-opacity duration-150 group-hover:opacity-100',
              'hover:bg-[color-mix(in_oklab,var(--nomi-ink)80%,transparent)] focus-visible:opacity-100',
            )}
            aria-label="进入全景预览"
          >
            <IconMaximize size={14} stroke={1.6} />进入全景
          </button>
        </div>
      </div>

      {fullscreen && typeof document !== 'undefined' ? createPortal(
        <div
          className={cn(
            'fixed inset-0 z-[9999] flex h-[100dvh] w-screen items-center justify-center overflow-hidden p-8 overscroll-contain',
            'bg-workbench-backdrop backdrop-blur-[10px]',
          )}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            if (event.target === event.currentTarget) setFullscreen(false)
          }}
        >
          <section
            ref={setPanelElement}
            className={cn(
              'relative w-[min(96vw,calc((100vh-64px)*16/9))] aspect-video',
              'max-h-[calc(100vh-64px)] overflow-hidden rounded-nomi-lg',
              'bg-nomi-ink shadow-nomi-lg',
            )}
            data-panorama-dialog-panel
            role="dialog"
            aria-modal="true"
            aria-label="全景预览"
          >
            <PhotoSpherePanoramaViewer
              key={`fullscreen-${imageUrl}`}
              imageUrl={imageUrl}
              config={PANORAMA_FULLSCREEN_CONFIG}
            >
              <PanoramaCaptureOverlay
                captureFrameRef={captureFrameRef}
                captureRatio={captureRatio}
                frameSize={captureFrameSize}
              />
              <PanoramaDialogControls
                captureFrameRef={captureFrameRef}
                captureRatioId={captureRatioId}
                onCaptureRatioChange={setCaptureRatioId}
                onClose={() => setFullscreen(false)}
                onScreenshot={(screenshot) => onScreenshot?.(screenshot)}
              />
            </PhotoSpherePanoramaViewer>
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  )
}
