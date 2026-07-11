import type { BrowserAssetOverlayRecord, BrowserViewRecord } from "./browserViewTypes";

export const browserViews = new Map<number, BrowserViewRecord>();
export const browserViewsByWindow = new Map<number, Set<number>>();
export const browserAssetOverlaysByWindow = new Map<number, BrowserAssetOverlayRecord>();

let nextBrowserViewId = 1;

export function allocateBrowserViewId(): number {
  const viewId = nextBrowserViewId;
  nextBrowserViewId += 1;
  return viewId;
}
