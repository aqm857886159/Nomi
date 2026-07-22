import React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { getDesktopActiveProjectId } from '../../../desktop/activeProject'
import {
  getDesktopBridge,
  type DesktopBrowserAssetOverlayCaptureRequest,
  type DesktopBrowserAssetOverlayConfig,
  type DesktopBrowserAssetOverlayDockMode,
  type DesktopBrowserAssetOverlayRect,
} from '../../../desktop/bridge'
// 素材盒真删走 confirmDialog；overlay 是独立 React root，必须自挂宿主，
// 否则确认请求进 preMountQueue 永不 resolve（主窗宿主在 NomiStudioApp，跨窗口不共享）。
import { ConfirmDialogHost } from '../../../design'
import type { NomiBrowserAsset } from '../assets/browserAssetData'
import { browserAssetFromDesktopAsset } from '../popover/browserAssetPopoverUtils'
import {
  NomiBrowserAssetPopover,
  type BrowserAssetCaptureRequest,
  type BrowserAssetRemoteImportInput,
} from '../popover/NomiBrowserAssetPopover'
import { subscribeBrowserAssetsImportToCanvas } from './globalAssetPopoverEvents'
import type { FloatingWindowBoundsRect } from '../window/useResizableFloatingWindow'

type OverlayCaptureFlyoutRect = {
  left: number
  top: number
  width: number
  height: number
}

type OverlayCaptureFlyout = {
  id: string
  url: string
  mediaType: 'image' | 'video'
  sourceRect: OverlayCaptureFlyoutRect
  targetRect: OverlayCaptureFlyoutRect
}

const CAPTURE_FLYOUT_TARGET_WIDTH = 96
const CAPTURE_FLYOUT_KEYFRAME_TIMES = [0, 0.18, 1]

function canDownloadFromBrowserView(url: string): boolean {
  return /^(https?:\/\/|blob:)/i.test(url)
}

function sameBoundsRect(left: FloatingWindowBoundsRect | null, right: FloatingWindowBoundsRect | null): boolean {
  if (left === right) return true
  if (!left || !right) return false
  return (
    Math.round(left.left) === Math.round(right.left) &&
    Math.round(left.top) === Math.round(right.top) &&
    Math.round(left.right) === Math.round(right.right) &&
    Math.round(left.bottom) === Math.round(right.bottom) &&
    Math.round(left.width) === Math.round(right.width) &&
    Math.round(left.height) === Math.round(right.height)
  )
}

function overlayStateKey(
  dockMode: DesktopBrowserAssetOverlayDockMode,
  popoverRect: DesktopBrowserAssetOverlayRect | null,
  captureEnabled: boolean,
): string {
  const rectKey = popoverRect
    ? [
        Math.round(popoverRect.left),
        Math.round(popoverRect.top),
        Math.round(popoverRect.right),
        Math.round(popoverRect.bottom),
        Math.round(popoverRect.width),
        Math.round(popoverRect.height),
      ].join(':')
    : 'null'
  return `${dockMode ?? 'none'}|${rectKey}|${captureEnabled ? '1' : '0'}`
}

function captureRequestForPopover(
  request: DesktopBrowserAssetOverlayCaptureRequest,
): BrowserAssetCaptureRequest | null {
  const url = typeof request.url === 'string' ? request.url.trim() : ''
  const requestId = typeof request.requestId === 'string' ? request.requestId.trim() : ''
  if (!url || !requestId) return null
  return {
    requestId,
    url,
    mediaType: request.mediaType === 'video' ? 'video' : 'image',
    title: typeof request.title === 'string' ? request.title : undefined,
    fileName: typeof request.fileName === 'string' ? request.fileName : undefined,
  }
}

function localSourceRectFromCapture(
  request: DesktopBrowserAssetOverlayCaptureRequest,
  config: DesktopBrowserAssetOverlayConfig,
): OverlayCaptureFlyoutRect | null {
  const rect = request.sourceRect
  if (!rect || !config.bounds) return null
  return {
    left: Math.round(rect.left - config.bounds.x),
    top: Math.round(rect.top - config.bounds.y),
    width: Math.max(24, Math.round(rect.width)),
    height: Math.max(24, Math.round(rect.height)),
  }
}

function targetRectFromPopover(rect: FloatingWindowBoundsRect | null): OverlayCaptureFlyoutRect | null {
  if (!rect || rect.width <= 0 || rect.height <= 0) return null
  const width = Math.round(Math.min(CAPTURE_FLYOUT_TARGET_WIDTH, Math.max(52, rect.width - 32)))
  const height = Math.round(width * 0.64)
  return {
    left: Math.round(rect.left + Math.min(28, Math.max(12, rect.width * 0.08))),
    top: Math.round(Math.min(rect.bottom - height - 14, Math.max(rect.top + 64, rect.top + rect.height * 0.3))),
    width,
    height,
  }
}

function captureFlyoutScale(source: OverlayCaptureFlyoutRect, target: OverlayCaptureFlyoutRect): number {
  const sourceWidth = Math.max(1, source.width)
  return Math.max(0.66, Math.min(0.92, target.width / sourceWidth))
}

export function BrowserAssetOverlayApp(): JSX.Element {
  const desktop = React.useMemo(() => getDesktopBridge(), [])
  const browserBridge = React.useMemo(() => desktop?.browser, [desktop])
  const overlayBridge = React.useMemo(() => browserBridge?.assetOverlay, [browserBridge])
  // 稳定身份：内联 lambda 会让 popover 的探测 effect 每次渲染重跑（拖拽期间高频打 IPC，实测拖入被打断）。
  const probeCanvasImportAvailable = React.useMemo(() => (
    overlayBridge?.canvasImportAvailable
      ? () => overlayBridge.canvasImportAvailable!()
      : undefined
  ), [overlayBridge])
  const [config, setConfig] = React.useState<DesktopBrowserAssetOverlayConfig>({
    opened: false,
    viewId: null,
    bounds: null,
    captureEnabled: false,
    captureRequest: null,
  })
  const [dockMode, setDockMode] = React.useState<DesktopBrowserAssetOverlayDockMode>(null)
  const [popoverRect, setPopoverRect] = React.useState<FloatingWindowBoundsRect | null>(null)
  // 溢出整窗的模态（提示词提取设置）在场：热区从卡片矩形扩到整窗，否则点穿到网页。
  const [fullWindowModal, setFullWindowModal] = React.useState(false)
  const [captureEnabled, setCaptureEnabled] = React.useState(false)
  const [browserCaptureRequest, setBrowserCaptureRequest] = React.useState<BrowserAssetCaptureRequest | null>(null)
  const [captureFlyouts, setCaptureFlyouts] = React.useState<OverlayCaptureFlyout[]>([])
  const pendingCaptureFlyoutRef = React.useRef<DesktopBrowserAssetOverlayCaptureRequest | null>(null)
  const handledCaptureRequestIdRef = React.useRef<string | null>(null)
  const lastSentStateKeyRef = React.useRef<string | null>(null)
  const pointerDownRef = React.useRef(false)
  const interactiveRef = React.useRef<boolean | null>(null)
  const hostBoundsX = config.bounds?.x ?? null
  const hostBoundsY = config.bounds?.y ?? null
  const popoverLeft = popoverRect?.left ?? null
  const popoverTop = popoverRect?.top ?? null
  const popoverRight = popoverRect?.right ?? null
  const popoverBottom = popoverRect?.bottom ?? null
  const popoverWidth = popoverRect?.width ?? null
  const popoverHeight = popoverRect?.height ?? null

  React.useEffect(() => {
    document.documentElement.dataset.nomiOverlay = 'browserAsset'
    document.documentElement.style.background = 'transparent'
    document.documentElement.style.backgroundImage = 'none'
    document.body.style.background = 'transparent'
    document.body.style.backgroundImage = 'none'
    document.body.style.overflow = 'hidden'
    const root = document.getElementById('root')
    if (root) {
      root.style.background = 'transparent'
      root.style.backgroundImage = 'none'
    }
  }, [])

  React.useEffect(() => {
    if (!overlayBridge?.onConfig) return undefined
    const dispose = overlayBridge.onConfig((nextConfig) => {
      setConfig(nextConfig)
      setCaptureEnabled(Boolean(nextConfig.captureEnabled))
      if (!nextConfig.opened) {
        setDockMode(null)
        setPopoverRect(null)
        setBrowserCaptureRequest(null)
      }
      const request = nextConfig.captureRequest
      const requestId = typeof request?.requestId === 'string' ? request.requestId : ''
      if (request && requestId && handledCaptureRequestIdRef.current !== requestId) {
        handledCaptureRequestIdRef.current = requestId
        const popoverRequest = captureRequestForPopover(request)
        if (popoverRequest) setBrowserCaptureRequest(popoverRequest)
        pendingCaptureFlyoutRef.current = request
      }
    })
    overlayBridge.ready?.()
    return dispose
  }, [overlayBridge])

  React.useEffect(() => {
    if (!overlayBridge?.importToCanvas) return undefined
    return subscribeBrowserAssetsImportToCanvas((assets) => {
      overlayBridge.importToCanvas?.({ assets })
    })
  }, [overlayBridge])

  React.useEffect(() => {
    if (!overlayBridge || !config.opened) {
      lastSentStateKeyRef.current = null
      return
    }
    const cardRect =
      popoverLeft === null ||
      popoverTop === null ||
      popoverRight === null ||
      popoverBottom === null ||
      popoverWidth === null ||
      popoverHeight === null ||
      hostBoundsX === null ||
      hostBoundsY === null
        ? null
        : {
            left: hostBoundsX + popoverLeft,
            top: hostBoundsY + popoverTop,
            right: hostBoundsX + popoverRight,
            bottom: hostBoundsY + popoverBottom,
            width: popoverWidth,
            height: popoverHeight,
          }
    // 溢出整窗的模态在场 → 整窗都是可交互内容，热区扩到整个 overlay 窗（= 承载 view 的 bounds）。
    const fullWindowRect =
      fullWindowModal && hostBoundsX !== null && hostBoundsY !== null && config.bounds
        ? {
            left: hostBoundsX,
            top: hostBoundsY,
            right: hostBoundsX + config.bounds.width,
            bottom: hostBoundsY + config.bounds.height,
            width: config.bounds.width,
            height: config.bounds.height,
          }
        : null
    const hostRect = fullWindowRect ?? cardRect
    // 测试内省：把「上报给主进程的可点热区」挂到 window，供 R13 走查几何断言
    //（DOM 合成点击测不到窗口穿透，只能靠热区矩形几何对账，见 reference-capture.walk）。
    ;(window as unknown as { __nomiOverlayHitRect?: unknown }).__nomiOverlayHitRect = hostRect
    const stateKey = overlayStateKey(dockMode, hostRect, captureEnabled)
    if (lastSentStateKeyRef.current === stateKey) return
    lastSentStateKeyRef.current = stateKey
    overlayBridge.setState({
      dockMode,
      popoverRect: hostRect,
      captureEnabled,
    })
  }, [
    captureEnabled,
    config.opened,
    config.bounds,
    dockMode,
    fullWindowModal,
    hostBoundsX,
    hostBoundsY,
    overlayBridge,
    popoverBottom,
    popoverHeight,
    popoverLeft,
    popoverRight,
    popoverTop,
    popoverWidth,
  ])

  const setInteractive = React.useCallback(
    (interactive: boolean): void => {
      if (interactiveRef.current === interactive) return
      interactiveRef.current = interactive
      overlayBridge?.setInteractive({ interactive })
    },
    [overlayBridge],
  )

  const pointInsidePopover = React.useCallback(
    (x: number, y: number): boolean => {
      if (!config.opened) return false
      // 整窗模态在场：整窗都是可交互内容，任意点都算命中（否则模态落在卡片外死区被点穿）。
      if (fullWindowModal) return true
      if (!popoverRect) return false
      const slop = 10
      return (
        x >= popoverRect.left - slop &&
        x <= popoverRect.right + slop &&
        y >= popoverRect.top - slop &&
        y <= popoverRect.bottom + slop
      )
    },
    [config.opened, fullWindowModal, popoverRect],
  )

  React.useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      pointerDownRef.current = pointInsidePopover(event.clientX, event.clientY)
      setInteractive(pointerDownRef.current)
    }
    const handlePointerUp = (): void => {
      pointerDownRef.current = false
      setInteractive(false)
    }
    window.addEventListener('pointerdown', handlePointerDown, { capture: true })
    window.addEventListener('pointerup', handlePointerUp, { capture: true })
    window.addEventListener('pointercancel', handlePointerUp, { capture: true })
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, { capture: true })
      window.removeEventListener('pointerup', handlePointerUp, { capture: true })
      window.removeEventListener('pointercancel', handlePointerUp, { capture: true })
    }
  }, [pointInsidePopover, setInteractive])

  React.useEffect(() => {
    if (!config.opened || !fullWindowModal) {
      if (!pointerDownRef.current) setInteractive(false)
      return
    }
    setInteractive(true)
  }, [config.opened, fullWindowModal, setInteractive])

  React.useEffect(() => {
    const finishDrag = (): void => {
      pointerDownRef.current = false
      // drop 落在卡片内时 hoverInteractive 已负责维持卡片命中；不要把 pointerInteractive
      // 再置回 true，否则原生拖拽吞掉 pointermove/up 后，透明整窗会继续挡住网页。
      interactiveRef.current = false
      overlayBridge?.finishDrag?.()
    }
    window.addEventListener('drop', finishDrag, { capture: true })
    window.addEventListener('dragend', finishDrag, { capture: true })
    return () => {
      window.removeEventListener('drop', finishDrag, { capture: true })
      window.removeEventListener('dragend', finishDrag, { capture: true })
    }
  }, [overlayBridge])

  React.useEffect(() => {
    const pending = pendingCaptureFlyoutRef.current
    if (!pending || !popoverRect) return
    const sourceRect = localSourceRectFromCapture(pending, config)
    const targetRect = targetRectFromPopover(popoverRect)
    if (!sourceRect || !targetRect) return
    pendingCaptureFlyoutRef.current = null
    setCaptureFlyouts((current) => [
      ...current.slice(-2),
      {
        id: `overlay-capture-flyout-${pending.requestId || Date.now()}`,
        url: String(pending.url || ''),
        mediaType: pending.mediaType === 'video' ? 'video' : 'image',
        sourceRect,
        targetRect,
      },
    ])
  }, [config, popoverRect])

  const importBrowserAssetToLibrary = React.useCallback(
    async (input: BrowserAssetRemoteImportInput): Promise<NomiBrowserAsset> => {
      const projectId = getDesktopActiveProjectId()
      if (!projectId) throw new Error('projectId is required')
      const viewId = config.viewId
      const fallbackTitle = input.title || input.fileName || (input.mediaType === 'video' ? '网页视频' : '网页图片')
      // 原生素材盒只接受当前内置网页产生的拖拽；没有来源 WebContents 时不准换成另一套
      // 无 Cookie/Referer 的网络栈重抓 URL，否则既破坏防盗链，也会把真实错误掩盖掉。
      if (!viewId || !browserBridge?.importMedia || !canDownloadFromBrowserView(input.url)) {
        throw new Error('来源页面会话已失效，请回到原网页重新拖入')
      }
      const asset = await browserBridge.importMedia({
        viewId,
        projectId,
        url: input.url,
        fileName: input.fileName,
        title: input.title,
        mediaType: input.mediaType,
      })
      const mapped = browserAssetFromDesktopAsset(asset, fallbackTitle)
      if (!mapped) throw new Error('导入的素材无法识别为图片或视频')
      return mapped
    },
    [browserBridge, config.viewId],
  )

  const handleOpenChange = React.useCallback(
    (opened: boolean): void => {
      if (!opened) overlayBridge?.close()
    },
    [overlayBridge],
  )

  const handlePopoverRectChange = React.useCallback((nextRect: FloatingWindowBoundsRect | null): void => {
    setPopoverRect((current) => (sameBoundsRect(current, nextRect) ? current : nextRect))
  }, [])

  const toggleBrowserResourceCapture = React.useCallback((): void => {
    setCaptureEnabled((enabled) => !enabled)
  }, [])

  React.useEffect(() => {
    if (!captureEnabled || !config.viewId || !browserBridge?.captureResource) return undefined
    const viewId = config.viewId
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat) return
      if (event.key.toLowerCase() !== 'c') return
      if (!event.ctrlKey && !event.metaKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input,textarea,select,[contenteditable="true"]')) return
      event.preventDefault()
      event.stopPropagation()
      browserBridge.captureResource?.({ viewId })
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [browserBridge, captureEnabled, config.viewId])

  return (
    <div className="fixed inset-0 overflow-hidden bg-transparent font-nomi-sans text-nomi-ink">
      <NomiBrowserAssetPopover
        surface="contained"
        placement="absolute"
        opened={config.opened}
        onOpenChange={handleOpenChange}
        onWindowRectChange={handlePopoverRectChange}
        onFullWindowModalChange={setFullWindowModal}
        onDockModeChange={setDockMode}
        dockPresentation="edge"
        onImportRemoteAsset={importBrowserAssetToLibrary}
        browserCaptureEnabled={captureEnabled}
        browserCaptureDisabled={!config.viewId}
        browserCaptureRequest={browserCaptureRequest}
        onBrowserCaptureToggle={toggleBrowserResourceCapture}
        probeCanvasImportAvailable={probeCanvasImportAvailable}
      />
      <ConfirmDialogHost />
      <AnimatePresence>
        {captureFlyouts.map((flyout) => (
          <motion.div
            key={flyout.id}
            data-browser-capture-flyout=""
            className="pointer-events-none absolute left-0 top-0 z-[600] overflow-hidden rounded-nomi border border-nomi-accent bg-nomi-paper shadow-nomi-lg ring-2 ring-nomi-accent ring-offset-2 ring-offset-nomi-paper"
            initial={{
              x: flyout.sourceRect.left,
              y: flyout.sourceRect.top,
              width: flyout.sourceRect.width,
              height: flyout.sourceRect.height,
              opacity: 0.72,
              scale: 0.98,
            }}
            animate={{
              x: [
                flyout.sourceRect.left,
                flyout.sourceRect.left,
                flyout.targetRect.left,
              ],
              y: [
                flyout.sourceRect.top,
                flyout.sourceRect.top,
                flyout.targetRect.top,
              ],
              width: [
                flyout.sourceRect.width,
                flyout.sourceRect.width,
                flyout.targetRect.width,
              ],
              height: [
                flyout.sourceRect.height,
                flyout.sourceRect.height,
                flyout.targetRect.height,
              ],
              opacity: [0.78, 1, 0.08],
              scale: [0.98, 1.02, captureFlyoutScale(flyout.sourceRect, flyout.targetRect)],
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.74, times: CAPTURE_FLYOUT_KEYFRAME_TIMES, ease: [0.22, 1, 0.36, 1] }}
            onAnimationComplete={() =>
              setCaptureFlyouts((current) => current.filter((item) => item.id !== flyout.id))
            }
            aria-hidden="true"
          >
            {flyout.mediaType === 'video' ? (
              <>
                <video src={flyout.url} muted playsInline className="block size-full bg-nomi-ink object-contain" />
                <span className="absolute right-1 top-1 rounded-pill bg-nomi-accent px-1.5 py-0.5 text-micro font-semibold leading-none text-nomi-paper shadow-nomi-sm">
                  视频
                </span>
              </>
            ) : (
              <img src={flyout.url} alt="" draggable={false} className="block size-full object-contain" />
            )}
            <span className="absolute inset-0 rounded-nomi ring-1 ring-inset ring-nomi-paper/85" />
            <motion.span
              className="absolute inset-0 rounded-nomi bg-nomi-accent"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.28, 0] }}
              transition={{ duration: 0.42, times: [0, 0.28, 1], ease: 'easeOut' }}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
