/**
 * 内置浏览器这一族的桥面形状：视图边界、素材浮层、提示词/资源抓取事件，以及 `browser` 那一支。
 *
 * 从 src/desktop/bridge.ts 抽出来（R9：bridge.ts 顶着 800 行硬上限，每加一条桥都在撞线）。
 * **只搬家、不改形状**：每个字段、每句注释逐字保留；bridge.ts 用 `browser?: DesktopBrowserSurface`
 * 组装，并原样 re-export 这些类型名，既有 `from './bridge'` 的 import 面不变。
 */
import type { DesktopAssetDto } from './bridgeMedia'
// 仅类型的回指：DesktopBrowserPromptScreenshotSelection 留在 bridge.ts（它的 reason 联合是
// check:vocabularies 在册、按路径记身份的 debt site），这里只借它的形状，编译期即擦除。
import type { DesktopBrowserPromptScreenshotSelection } from './bridge'
import type { BrowserPromptExtractionRunOutcome, BrowserPromptExtractionRunRequest } from '../../electron/shared/contracts/browserPromptExtraction'

export type DesktopBrowserViewBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type DesktopBrowserAssetOverlayDockMode = 'left' | 'right' | null

export type DesktopBrowserChromeMenuItem = {
  id?: string
  label?: string
  description?: string
  type?: 'normal' | 'separator'
  enabled?: boolean
}

export type DesktopBrowserChromeMenuResult = {
  id: string | null
}

export type DesktopBrowserAssetOverlayRect = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export type DesktopBrowserAssetOverlayCaptureRequest = {
  requestId: string
  url: string
  mediaType?: 'image' | 'video'
  title?: string
  fileName?: string
  sourceRect?: DesktopBrowserAssetOverlayRect
}

export type DesktopBrowserAssetOverlayConfig = {
  /** 父窗口已提交的项目（主进程签发，浮层只用来显示/标注；null = 父窗口没有打开项目）。 */
  projectBinding?: import('../../electron/shared/projectBinding').ProjectBinding | null
  opened: boolean
  viewId: number | null
  bounds: DesktopBrowserViewBounds | null
  captureEnabled?: boolean
  captureRequest?: DesktopBrowserAssetOverlayCaptureRequest | null
}

export type DesktopBrowserAssetOverlayState = {
  opened: boolean
  dockMode?: DesktopBrowserAssetOverlayDockMode
  popoverRect?: DesktopBrowserAssetOverlayRect | null
  captureEnabled?: boolean
}

export type DesktopBrowserViewState = {
  viewId: number
  tabId: string
  url: string
  title: string
  favicon?: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
}

export type DesktopBrowserResourceCaptureRect = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export type DesktopBrowserResourceCaptureEvent =
  | {
      ok: true
      viewId: number
      tabId: string
      url: string
      mediaType: 'image' | 'video'
      title?: string
      fileName?: string
      pageUrl?: string
      pageTitle?: string
      sourceRect?: DesktopBrowserResourceCaptureRect
    }
  | {
      ok: false
      viewId: number
      tabId: string
      reason: 'empty' | 'error'
      message?: string
    }

export type DesktopBrowserPromptCaptureEvent =
  | {
      ok: true
      viewId: number
      tabId: string
      url: string
      title?: string
      fileName?: string
      pageUrl?: string
      pageTitle?: string
      extractionMode?: 'replicate' | 'style'
      sourceRect?: DesktopBrowserResourceCaptureRect
    }
  | {
      ok: false
      viewId: number
      tabId: string
      reason: 'empty' | 'error'
      message?: string
    }

export type DesktopBrowserTextPromptSaveEvent =
  | {
      ok: true
      viewId: number
      tabId: string
      prompt: string
      promptType: string
      pageUrl?: string
      pageTitle?: string
    }
  | {
      ok: false
      viewId: number
      tabId: string
      reason: 'error'
      message?: string
    }

export type DesktopBrowserPromptReferenceResult = {
  dataUrl: string
  referenceUrl: string
  fileName: string
  title?: string
  sourceUrl?: string
  pageUrl?: string
  pageTitle?: string
  asset?: DesktopAssetDto
  sourceRect?: DesktopBrowserResourceCaptureRect
}

/** 浏览器面：内置浏览器视图、素材浮层、提示词/资源抓取的桥面形状。 */
export type DesktopBrowserSurface = {
  createView: (payload: { tabId: string; partition?: string }) => Promise<{ viewId: number }>
  destroyView: (payload: { viewId: number }) => void
  navigate: (payload: { viewId: number; url: string }) => void
  back: (payload: { viewId: number }) => void
  forward: (payload: { viewId: number }) => void
  reload: (payload: { viewId: number }) => void
  resize: (payload: { viewId: number; bounds: DesktopBrowserViewBounds }) => void
  show: (payload: { viewId: number }) => void
  hide: (payload: { viewId: number }) => void
  importMedia: (payload: {
    viewId: number
    url: string
    fileName?: string
    title?: string
    mediaType?: 'image' | 'video'
  }) => Promise<DesktopAssetDto>
  capturePromptImage?: (payload: {
    viewId: number
    url: string
    fileName?: string
    title?: string
  }) => Promise<DesktopBrowserPromptReferenceResult>
  capturePromptScreenshot?: (payload: {
    viewId: number
    fileName?: string
    title?: string
    sourceRect?: {
      left: number
      top: number
      width: number
      height: number
    }
  }) => Promise<DesktopBrowserPromptReferenceResult>
  /** 项目由主进程按发起窗口（浮层 = 父窗口）已提交的项目面决定，渲染层不报 projectId。 */
  readPromptExtractionSettings?: () => Promise<{ ok: boolean; settings: unknown | null; error?: string }>
  writePromptExtractionSettings?: (payload: { settings: unknown }) => Promise<{ ok: boolean; settings?: unknown; error?: string }>
  /** 整次提取在主进程跑：弹卡问人 → 铸令牌 → 发一次读图调用（只认主窗口）。 */
  runPromptExtraction?: (payload: BrowserPromptExtractionRunRequest) => Promise<BrowserPromptExtractionRunOutcome>
  selectPromptScreenshot?: (payload: { viewId: number }) => Promise<DesktopBrowserPromptScreenshotSelection>
  setResourceCapture?: (payload: { viewId: number; enabled: boolean }) => void
  captureResource?: (payload: { viewId: number }) => void
  showChromeMenu?: (payload: {
    x: number
    y: number
    width?: number
    items: DesktopBrowserChromeMenuItem[]
  }) => Promise<DesktopBrowserChromeMenuResult>
  assetOverlay?: {
    open: (payload: {
      viewId: number | null
      bounds: DesktopBrowserViewBounds
      captureRequest?: DesktopBrowserAssetOverlayCaptureRequest
    }) => void
    updateHost: (payload: { viewId?: number | null; bounds: DesktopBrowserViewBounds }) => void
    close: () => void
    captureRequest: (payload: DesktopBrowserAssetOverlayCaptureRequest) => void
    ready?: () => void
    setInteractive: (payload: { interactive: boolean }) => void
    finishDrag?: () => void
    setState: (payload: {
      dockMode?: DesktopBrowserAssetOverlayDockMode
      popoverRect?: DesktopBrowserAssetOverlayRect | null
      captureEnabled?: boolean
    }) => void
    importToCanvas?: (payload: { assets: unknown[] }) => void
    canvasImportAvailable?: () => Promise<boolean>
    onConfig: (callback: (config: DesktopBrowserAssetOverlayConfig) => void) => () => void
    onState: (callback: (state: DesktopBrowserAssetOverlayState) => void) => () => void
    onImportToCanvas?: (callback: (payload: { assets?: unknown[] }) => void) => () => void
  }
  onPromptCapture?: (callback: (event: DesktopBrowserPromptCaptureEvent) => void) => () => void
  onTextPromptSave?: (callback: (event: DesktopBrowserTextPromptSaveEvent) => void) => () => void
  onResourceCapture?: (callback: (event: DesktopBrowserResourceCaptureEvent) => void) => () => void
  onState: (callback: (event: DesktopBrowserViewState) => void) => () => void
}

