import type { NomiBrowserAsset, NomiBrowserAssetSource, NomiBrowserAssetSourceDefinition, NomiBrowserAssetTab, NomiBrowserAssetTabDefinition } from '../assets/browserAssetData'
import type { BrowserPromptExtractionMode } from '../prompt/browserPromptExtraction'
import type { FloatingWindowAnchorRect, FloatingWindowBoundsRect } from '../window/useResizableFloatingWindow'

export type BrowserPromptExtractionTemplate = {
  id: string
  title: string
  prompt: string
  builtin?: boolean
  createdAt?: string
  updatedAt?: string
}

export type BrowserPromptExtractionTemplateSettings = {
  version: 1
  selectedTemplateIds: Record<BrowserPromptExtractionMode, string>
  defaultOverrides: Partial<Record<BrowserPromptExtractionMode, { title?: string; prompt?: string; updatedAt?: string }>>
  customTemplates: Partial<Record<BrowserPromptExtractionMode, BrowserPromptExtractionTemplate[]>>
}

export type BrowserAssetPopoverDockMode = 'left' | 'right' | null

export type BrowserAssetRemoteImportInput = {
  url: string
  title?: string
  fileName?: string
  mediaType?: 'image' | 'video'
}

export type BrowserAssetCaptureRequest = BrowserAssetRemoteImportInput & {
  requestId: string
}

export type BrowserAssetPromptReference = {
  url: string
  title?: string
  sourceUrl?: string
}

export type BrowserAssetPromptCaptureRect = {
  left: number
  top: number
  width: number
  height: number
}

export type BrowserAssetPromptCaptureRequest = {
  requestId: string
  sourceType: 'image' | 'screenshot'
  extractionMode?: BrowserPromptExtractionMode
  viewId?: number
  title?: string
  fileName?: string
  pageUrl?: string
  pageTitle?: string
  sourceUrl?: string
  modelImageUrl?: string
  sourceRect?: BrowserAssetPromptCaptureRect
  referenceImages?: readonly BrowserAssetPromptReference[]
}

export type NomiBrowserAssetPopoverProps = {
  className?: string
  placement?: 'absolute' | 'fixed'
  surface?: 'floating' | 'contained'
  opened?: boolean
  anchorRect?: FloatingWindowAnchorRect | null
  boundsRect?: FloatingWindowBoundsRect | null
  dockable?: boolean
  dockPresentation?: 'overlay' | 'edge' | 'split'
  defaultOpened?: boolean
  defaultSource?: NomiBrowserAssetSource
  defaultTab?: NomiBrowserAssetTab
  showTrigger?: boolean
  /** 素材盒的数据桶；undefined 跟随当前项目，空字符串表示全局桶。 */
  libraryProjectId?: string | null
  assets?: readonly NomiBrowserAsset[]
  tabs?: readonly NomiBrowserAssetTabDefinition[]
  sourceTabs?: readonly NomiBrowserAssetSourceDefinition[]
  onOpenChange?: (opened: boolean) => void
  onWindowRectChange?: (rect: FloatingWindowBoundsRect | null) => void
  /**
   * 溢出整窗的模态（如提示词提取设置，fixed inset-0 居中）在场时触发。
   * 原生 overlay 承载态下，可点热区默认只覆盖卡片矩形；这类模态铺满整个透明窗、
   * 落在卡片外的死区里会被点穿到网页——overlay 收到此信号后把整窗上报为可点。
   */
  onFullWindowModalChange?: (present: boolean) => void
  onDockModeChange?: (dockMode: BrowserAssetPopoverDockMode) => void
  onAssetSelect?: (asset: NomiBrowserAsset) => void
  onCreateFolder?: (folder: NomiBrowserAsset) => void
  onImportRemoteAsset?: (input: BrowserAssetRemoteImportInput) => Promise<NomiBrowserAsset>
  browserCaptureEnabled?: boolean
  browserCaptureDisabled?: boolean
  browserCaptureRequest?: BrowserAssetCaptureRequest | null
  browserPromptCaptureRequest?: BrowserAssetPromptCaptureRequest | null
  onBrowserCaptureToggle?: () => void
  /** contained（独立透明窗）模式下经 IPC 探测父窗有没有画布导入目标——DOM 探针跨窗探不到。 */
  probeCanvasImportAvailable?: () => Promise<boolean>
}

export type AssetPopoverDockMode = BrowserAssetPopoverDockMode
export type AssetPopoverViewMode = 'grid' | 'list'

export type AssetContextMenuState = {
  assetId: string
  x: number
  y: number
}

export type BlankContextMenuState = {
  x: number
  y: number
}

export type MarqueeState = {
  startX: number
  startY: number
  currentX: number
  currentY: number
}

export type MarqueePointerState = {
  clientX: number
  clientY: number
}
