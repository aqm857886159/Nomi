// 素材盒「拖上画布」事件（托盘 → 画布主链路）。
// 2026-07-22 方案一重执行：全局浮窗（宿主A）三件套与 browser-popover 开合事件对已删——
// 前者随顶栏/库页入口一起退役，后者是订阅在、发送方为零的双向死线（P1 清理）。
const BROWSER_ASSET_IMPORT_TO_CANVAS_EVENT = 'nomi-browser-asset-import-to-canvas'

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

export function dispatchBrowserAssetsImportToCanvas(assets: readonly BrowserAssetCanvasImportItem[]): void {
  window.dispatchEvent(
    new CustomEvent<BrowserAssetCanvasImportEventDetail>(BROWSER_ASSET_IMPORT_TO_CANVAS_EVENT, {
      detail: { assets: [...assets] },
    }),
  )
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
