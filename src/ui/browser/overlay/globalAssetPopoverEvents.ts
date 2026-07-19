// 素材盒事件：主窗全局浮窗、浏览器伴生弹层和拖上画布各用独立事件，避免两个宿主串台。
const GLOBAL_ASSET_POPOVER_EVENT = 'nomi-global-asset-popover-open'
const BROWSER_ASSET_POPOVER_EVENT = 'nomi-browser-asset-popover-open'
const BROWSER_ASSET_IMPORT_TO_CANVAS_EVENT = 'nomi-browser-asset-import-to-canvas'

export type GlobalAssetPopoverAnchorRect = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export type GlobalAssetPopoverEventDetail = {
  opened: boolean
  anchorRect?: GlobalAssetPopoverAnchorRect | null
}

export type BrowserAssetPopoverEventDetail = {
  opened: boolean
}

export type BrowserAssetCanvasImportItem = {
  id: string
  type: 'image' | 'video' | 'prompt'
  title: string
  subtitle?: string
  previewUrl?: string
  prompt?: string
}

export type BrowserAssetCanvasImportEventDetail = {
  assets: BrowserAssetCanvasImportItem[]
}

export function getGlobalAssetPopoverAnchorRect(element: HTMLElement | null): GlobalAssetPopoverAnchorRect | null {
  if (!element) return null
  const rect = element.getBoundingClientRect()
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  }
}

export function dispatchGlobalAssetPopoverOpen(
  opened: boolean,
  anchorRect?: GlobalAssetPopoverAnchorRect | null,
): void {
  window.dispatchEvent(
    new CustomEvent<GlobalAssetPopoverEventDetail>(GLOBAL_ASSET_POPOVER_EVENT, {
      detail: { opened, anchorRect },
    }),
  )
}

export function dispatchBrowserAssetPopoverOpen(opened: boolean): void {
  window.dispatchEvent(
    new CustomEvent<BrowserAssetPopoverEventDetail>(BROWSER_ASSET_POPOVER_EVENT, { detail: { opened } }),
  )
}

export function dispatchBrowserAssetsImportToCanvas(assets: readonly BrowserAssetCanvasImportItem[]): void {
  window.dispatchEvent(
    new CustomEvent<BrowserAssetCanvasImportEventDetail>(BROWSER_ASSET_IMPORT_TO_CANVAS_EVENT, {
      detail: { assets: [...assets] },
    }),
  )
}

export function subscribeBrowserAssetPopoverOpen(
  callback: (opened: boolean, detail: BrowserAssetPopoverEventDetail) => void,
): () => void {
  const listener = (event: Event): void => {
    const detail = (event as CustomEvent<BrowserAssetPopoverEventDetail>).detail
    callback(Boolean(detail?.opened), { opened: Boolean(detail?.opened) })
  }
  window.addEventListener(BROWSER_ASSET_POPOVER_EVENT, listener)
  return () => window.removeEventListener(BROWSER_ASSET_POPOVER_EVENT, listener)
}

export function subscribeGlobalAssetPopoverOpen(
  callback: (opened: boolean, detail: GlobalAssetPopoverEventDetail) => void,
): () => void {
  const listener = (event: Event): void => {
    const detail = (event as CustomEvent<GlobalAssetPopoverEventDetail>).detail
    callback(Boolean(detail?.opened), {
      opened: Boolean(detail?.opened),
      anchorRect: detail?.anchorRect ?? null,
    })
  }
  window.addEventListener(GLOBAL_ASSET_POPOVER_EVENT, listener)
  return () => window.removeEventListener(GLOBAL_ASSET_POPOVER_EVENT, listener)
}

export function subscribeBrowserAssetsImportToCanvas(
  callback: (assets: BrowserAssetCanvasImportItem[], detail: BrowserAssetCanvasImportEventDetail) => void,
): () => void {
  const listener = (event: Event): void => {
    const detail = (event as CustomEvent<BrowserAssetCanvasImportEventDetail>).detail
    const assets = Array.isArray(detail?.assets) ? detail.assets : []
    callback(assets, { assets })
  }
  window.addEventListener(BROWSER_ASSET_IMPORT_TO_CANVAS_EVENT, listener)
  return () => window.removeEventListener(BROWSER_ASSET_IMPORT_TO_CANVAS_EVENT, listener)
}
