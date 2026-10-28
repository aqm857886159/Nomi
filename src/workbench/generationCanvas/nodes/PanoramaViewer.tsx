/**
 * [INPUT]: 依赖 @photo-sphere-viewer/core 的 Viewer / EquirectangularAdapter、
 *          ../../generation/pageLayer 的 GenerationPageLayer（全屏态挂进生成页那一格）、../../generation/pageLayerContext 的页格层租户状态与 active、
 *          ../../../design 的 NomiImage / WorkbenchIconButton、../../project/projectCanvasReadSurface（截图开始时捕获项目执行上下文）
 * [OUTPUT]: 对外提供 PanoramaViewer 与 PanoramaScreenshot 类型
 * [POS]: generationCanvas/nodes 的全景查看器：卡片内嵌 + 全屏两态共用一个 psv Viewer 实例；
 *        全屏态是**生成页里的一块**（2026-10-29 起经 GenerationPageLayer 挂进画布那一格，不再是挂 body 的 fixed 层）：
 *        尺寸按那一格量（容器查询单位），顶栏 / 左栏 / Agent 都不被盖；点「创作」「预览」随生成页一起藏、回来还开着；
 *        藏着时 Esc 与 psv 的键盘控制都停（psv 的 keyboard:'always' 挂在 window 上，留着会吞别的页的方向键）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { notify } from '../../../ui/notificationPolicy'
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { EquirectangularAdapter, Viewer, type PanoData, type ViewerConfig } from '@photo-sphere-viewer/core'
import '@photo-sphere-viewer/core/index.css'
import { IconCamera, IconMaximize, IconX } from '@tabler/icons-react'
import { NomiImage } from '../../../design/media'
import { cn } from '../../../utils/cn'
import { WorkbenchIconButton } from '../../../design/actions'
import { GenerationPageLayer } from '../../generation/pageLayer'
import { setGenerationPageLayerTenantOpen, useGenerationPageLayerActive, useGenerationPageLayerTenantOpen } from '../../generation/pageLayerContext'
import i18n from '../../../i18n'
import { withProjectAction, type ProjectExecutionContext } from '../../project/projectCanvasReadSurface'
import { isProjectImportCancellation } from '../adapters/assetImportAdapter'

export type PanoramaScreenshot = {
  /** PNG Blob，不是 base64：全景图动辄 8K，base64 进 store 会被逐次 JSON 深拷贝 + 全量存盘。 */
  blob: Blob
  dimensions: { width: number; height: number }
  title?: string
  prompt?: string
  source?: string
}

type PanoramaViewerProps = {
  nodeId: string
  imageUrl: string
  width: number
  height: number
  onEnterFullscreen?: (trigger: (() => void) | null) => void
  onScreenshot?: (screenshot: PanoramaScreenshot, project: ProjectExecutionContext) => void
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

async function cropCurrentPanoramaFrame(viewer: Viewer, frameElement: HTMLElement): Promise<PanoramaScreenshot | null> {
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
  const outputCanvas = new OffscreenCanvas(sourceWidth, sourceHeight)
  const context = outputCanvas.getContext('2d')
  if (!context) return null

  try {
    context.drawImage(canvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight)
    const blob = await outputCanvas.convertToBlob({ type: 'image/png' })
    if (!blob) return null
    return {
      blob,
      dimensions: { width: outputCanvas.width, height: outputCanvas.height },
      title: i18n.t('generationCommon.panorama.screenshotTitle'),
      prompt: i18n.t('generationCommon.panorama.screenshotPrompt'),
      source: 'panorama-framed-screenshot',
    }
  } catch {
    // Canvas export can be blocked if a remote panorama image is loaded without CORS support.
    return null
  }
}

function captureFramedPanoramaView(viewer: Viewer, frameElement: HTMLElement): Promise<PanoramaScreenshot | null> {
  return new Promise((resolve) => {
    let resolved = false
    let timeout: ReturnType<typeof setTimeout> | null = null
    const finish = () => {
      if (resolved) return
      resolved = true
      if (timeout) clearTimeout(timeout)
      void cropCurrentPanoramaFrame(viewer, frameElement).then(resolve)
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
  const layerActive = useGenerationPageLayerActive()

  // psv 的 keyboard:'always' 把方向键 / 加减号监听挂在 window 上并 preventDefault：藏着（切去别的页）时必须停，
  // 否则创作页文本框里的方向键会被它吞掉。运行时开关，不重建 viewer（视角不丢）。
  React.useEffect(() => {
    if (!viewer) return
    if (layerActive) viewer.startKeyboardControl()
    else viewer.stopKeyboardControl()
  }, [layerActive, viewer])

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
        // resize(size) writes fixed pixels onto its parent. A remounted node can start
        // before the page cell reaches its final size, trapping the viewer at that size.
        nextViewer.autoSize()
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
  captureFrameRef: React.RefObject<HTMLDivElement | null>
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
  captureFrameRef: React.RefObject<HTMLDivElement | null>
  captureRatioId: PanoramaCaptureRatioId
  onCaptureRatioChange: (ratioId: PanoramaCaptureRatioId) => void
  onClose: () => void
  onScreenshot?: (screenshot: PanoramaScreenshot, project: ProjectExecutionContext) => void
}): JSX.Element {
  const { t } = useTranslation()
  const viewer = React.useContext(PhotoSphereViewerContext)
  const feedbackHostId = React.useId()
  const [capturing, setCapturing] = React.useState(false)
  const [feedback, setFeedback] = React.useState<PanoramaCaptureFeedback | null>(null)
  const mountedRef = React.useRef(true)
  const feedbackTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const showFeedback = React.useCallback((nextFeedback: PanoramaCaptureFeedback) => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    notify({ identity: `panorama-capture:${feedbackHostId}`, reason: 'capture', message: nextFeedback.message, level: 'inline', present: (message) => setFeedback({ ...nextFeedback, message }) })
    if (nextFeedback.tone !== 'success') return
    feedbackTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setFeedback(null)
    }, 2200)
  }, [feedbackHostId])

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    }
  }, [])

  const handleScreenshot = React.useCallback(async () => {
    if (capturing) return
    if (!viewer || !captureFrameRef.current) {
      showFeedback({ tone: 'info', message: t('generationCommon.panorama.notReady') })
      return
    }

    const captureFrame = captureFrameRef.current
    await withProjectAction(async (project) => {
      setCapturing(true)
      showFeedback({ tone: 'info', message: t('generationCommon.panorama.capturing') })
      try {
        const screenshot = await captureFramedPanoramaView(viewer, captureFrame)
        project.assertCurrent()
        if (!screenshot) {
          showFeedback({ tone: 'error', message: t('generationCommon.panorama.captureFailed') })
          return
        }
        onScreenshot?.(screenshot, project)
        showFeedback({ tone: 'success', message: t('generationCommon.panorama.created') })
      } catch (error) {
        if (project.signal.aborted || isProjectImportCancellation(error)) return
        showFeedback({ tone: 'error', message: t('generationCommon.panorama.captureFailed') })
      } finally {
        if (mountedRef.current && !project.signal.aborted) setCapturing(false)
      }
    })
  }, [captureFrameRef, capturing, onScreenshot, showFeedback, t, viewer])

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
          label={
            capturing ? t('generationCommon.panorama.capturingShort') : t('generationCommon.panorama.captureFrame')
          }
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
          label={t('generationCommon.panorama.closePreview')}
          icon={<IconX size={15} />}
          onClick={onClose}
        />
      </div>
    </>
  )
}

export default function PanoramaViewer({
  nodeId,
  imageUrl,
  width,
  height,
  onEnterFullscreen,
  onScreenshot,
}: PanoramaViewerProps): JSX.Element {
  const { t } = useTranslation()
  const fullscreen = useGenerationPageLayerTenantOpen('panorama', nodeId)
  const setFullscreen = React.useCallback((open: boolean) => setGenerationPageLayerTenantOpen('panorama', nodeId, open), [nodeId])
  const [captureRatioId, setCaptureRatioId] = React.useState<PanoramaCaptureRatioId>(DEFAULT_CAPTURE_RATIO_ID)
  const instanceId = React.useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const [panelElement, setPanelElement] = React.useState<HTMLElement | null>(null)
  const captureFrameRef = React.useRef<HTMLDivElement | null>(null)
  const panelSize = useElementSize(panelElement)
  const captureRatio = getCaptureRatio(captureRatioId)
  const captureFrameSize = computeCaptureFrameSize(panelSize, captureRatio)
  const openFullscreen = React.useCallback(() => {
    setFullscreen(true)
  }, [setFullscreen])

  React.useLayoutEffect(() => {
    onEnterFullscreen?.(openFullscreen)
    return () => onEnterFullscreen?.(null)
  }, [onEnterFullscreen, openFullscreen])

  // Esc 关闭。藏着（切去别的页 / 列表视图）时不接：那一下 Esc 是别的页的。
  // （此前这里还锁 body / html 的滚动——那是挂 body 的模态时代的做法；整个 App 在 main.tsx 里本来就锁着，查看器现在是页面里的一块，不再有页面级滚动可锁。）
  const layerActive = useGenerationPageLayerActive()
  React.useEffect(() => {
    if (!fullscreen || !layerActive) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [fullscreen, layerActive, setFullscreen])

  if (!imageUrl) {
    return (
      <div className="flex items-center justify-center text-caption opacity-50" style={{ width, height }}>
        {t('generationCommon.panorama.empty')}
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
            aria-label={t('generationCommon.panorama.enterAria')}
          >
            <IconMaximize size={14} stroke={1.6} />
            {t('generationCommon.panorama.enter')}
          </button>
        </div>
      </div>

      {fullscreen ? (
        <GenerationPageLayer>
          <div
            className={cn(
              // 页格内的查看器：铺满生成页那一格（层本身 absolute inset-0），按那一格量尺寸（[container-type:size] + cq 单位），
              // 不再用视口单位——页格比窗口小，视口单位会让面板超出它。
              'flex size-full items-center justify-center overflow-hidden p-8 overscroll-contain [container-type:size]',
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
                'relative w-[min(100cqw,calc(100cqh*16/9))] aspect-video overflow-hidden rounded-nomi-lg',
                'bg-nomi-ink shadow-nomi-lg',
              )}
              data-panorama-dialog-panel
              role="dialog"
              aria-label={t('generationCommon.panorama.preview')}
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
                  onScreenshot={(screenshot, project) => onScreenshot?.(screenshot, project)}
                />
              </PhotoSpherePanoramaViewer>
            </section>
          </div>
        </GenerationPageLayer>
      ) : null}
    </>
  )
}
