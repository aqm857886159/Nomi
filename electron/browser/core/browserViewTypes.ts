import type { BrowserWindow, Rectangle, WebContentsView } from "electron";

export type BrowserViewRecord = {
  viewId: number;
  tabId: string;
  ownerWindowId: number;
  view: WebContentsView;
  lastBounds: Rectangle;
  resourceCaptureEnabled: boolean;
  promptCategories: BrowserPromptCategory[];
};

export type BrowserViewCreatePayload = {
  tabId?: unknown;
  partition?: unknown;
};

export type BrowserViewIdPayload = {
  viewId?: unknown;
};

export type BrowserViewNavigatePayload = BrowserViewIdPayload & {
  url?: unknown;
};

export type BrowserViewResizePayload = BrowserViewIdPayload & {
  bounds?: Partial<Rectangle>;
};

export type BrowserViewImportImagePayload = BrowserViewIdPayload & {
  projectId?: unknown;
  url?: unknown;
  fileName?: unknown;
  title?: unknown;
};

export type BrowserViewImportMediaPayload = BrowserViewImportImagePayload & {
  mediaType?: unknown;
};

export type BrowserViewPromptImagePayload = BrowserViewIdPayload & {
  projectId?: unknown;
  url?: unknown;
  fileName?: unknown;
  title?: unknown;
};

export type BrowserViewPromptScreenshotPayload = BrowserViewIdPayload & {
  projectId?: unknown;
  fileName?: unknown;
  title?: unknown;
  sourceRect?: BrowserResourceCaptureRectPayload;
};

export type BrowserChromeMenuItemPayload = {
  id?: unknown;
  label?: unknown;
  description?: unknown;
  type?: unknown;
  enabled?: unknown;
};

export type BrowserChromeMenuPayload = {
  x?: unknown;
  y?: unknown;
  width?: unknown;
  items?: unknown;
};

export type BrowserResourceCaptureRectPayload = {
  left?: unknown;
  top?: unknown;
  width?: unknown;
  height?: unknown;
};

export type BrowserResourceCapturePayload = {
  url?: unknown;
  mediaType?: unknown;
  title?: unknown;
  fileName?: unknown;
  pageUrl?: unknown;
  pageTitle?: unknown;
  extractionMode?: unknown;
  sourceRect?: BrowserResourceCaptureRectPayload;
};

export type BrowserPromptCategory = {
  id: string;
  label: string;
};

export type BrowserPromptCategoriesPayload = BrowserViewIdPayload & {
  categories?: unknown;
};

export type BrowserPromptScreenshotSelectionResult =
  | {
      ok: true;
      rect: { left: number; top: number; width: number; height: number };
    }
  | {
      ok: false;
      reason?: "cancelled" | "error";
      message?: string;
    };

export type BrowserDownloadResult = {
  absolutePath: string;
  fileName: string;
  contentType: string;
  mediaType: "image" | "video" | null;
  cleanupDir: string;
};

export type BrowserAssetOverlayDockMode = "left" | "right" | null;

export type BrowserAssetOverlayRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type BrowserAssetOverlayCaptureRequest = {
  requestId?: unknown;
  url?: unknown;
  mediaType?: unknown;
  title?: unknown;
  fileName?: unknown;
  sourceRect?: Partial<BrowserAssetOverlayRect>;
};

export type BrowserAssetOverlayPromptRequest = {
  requestId?: unknown;
  sourceType?: unknown;
};

export type BrowserAssetOverlayPayload = BrowserViewIdPayload & {
  bounds?: Partial<Rectangle>;
  captureRequest?: BrowserAssetOverlayCaptureRequest;
  promptRequest?: BrowserAssetOverlayPromptRequest;
};

export type BrowserAssetOverlayStatePayload = {
  dockMode?: unknown;
  popoverRect?: Partial<BrowserAssetOverlayRect> | null;
  captureEnabled?: unknown;
};

export type BrowserAssetOverlayRecord = {
  ownerWindowId: number;
  window: BrowserWindow;
  hostBounds: Rectangle;
  viewId: number | null;
  captureEnabled: boolean;
  rendererReady: boolean;
  pendingShow: boolean;
  pendingCaptureRequest: BrowserAssetOverlayCaptureRequest | null;
  pendingPromptRequest: BrowserAssetOverlayPromptRequest | null;
  dockMode: BrowserAssetOverlayDockMode;
  popoverRect: BrowserAssetOverlayRect | null;
  pointerInteractive: boolean;
  hoverInteractive: boolean;
  dragInteractive: boolean;
  hoverInteractiveTimer: NodeJS.Timeout | null;
  dragInteractiveResetTimer: NodeJS.Timeout | null;
};

export type BrowserChromeMenuItem =
  | {
      id: string;
      label: string;
      description: string;
      type: "normal";
      enabled: boolean;
    }
  | {
      type: "separator";
    };

export type BrowserChromeMenuRecord = {
  ownerWindowId: number;
  window: BrowserWindow;
  settled: boolean;
  resolve: (result: { id: string | null }) => void;
};
