import { BrowserWindow, screen } from "electron";
import type { Rectangle, WebContents } from "electron";
import path from "node:path";
import { installBrowserResourceCaptureBridge } from "../core/browserViewBridges";
import { browserAssetOverlaysByWindow, browserViews } from "../core/browserViewState";
import { clampNumber, getSenderWindow, normalizeBounds, readViewId, sameRectangle } from "../core/browserViewUtils";
import type {
  BrowserAssetOverlayCaptureRequest,
  BrowserAssetOverlayDockMode,
  BrowserAssetOverlayPayload,
  BrowserAssetOverlayPromptRequest,
  BrowserAssetOverlayRecord,
  BrowserAssetOverlayRect,
} from "../core/browserViewTypes";

const BROWSER_ASSET_OVERLAY_SHAPE_SLOP = 10;
let browserAssetOverlayRendererUrlResolver: (() => string) | null = null;

export function setBrowserAssetOverlayRendererUrlResolver(resolver?: () => string): void {
  browserAssetOverlayRendererUrlResolver = resolver ?? browserAssetOverlayRendererUrlResolver;
}

export function getOwnerWindowForSender(sender: WebContents): BrowserWindow {
  const win = getSenderWindow(sender);
  const parent = win.getParentWindow();
  return parent && !parent.isDestroyed() ? parent : win;
}

export function getOverlayForSender(sender: WebContents): BrowserAssetOverlayRecord | null {
  const owner = getOwnerWindowForSender(sender);
  return browserAssetOverlaysByWindow.get(owner.id) ?? null;
}


export function normalizeOverlayBounds(bounds: Partial<Rectangle> | undefined): Rectangle {
  return normalizeBounds(bounds);
}

export function normalizeOverlayDockMode(value: unknown): BrowserAssetOverlayDockMode {
  return value === "left" || value === "right" ? value : null;
}


export function normalizeOverlayRect(rect: Partial<BrowserAssetOverlayRect> | null | undefined): BrowserAssetOverlayRect | null {
  if (!rect) return null;
  const left = Math.round(Number(rect.left));
  const top = Math.round(Number(rect.top));
  const width = Math.round(Number(rect.width));
  const height = Math.round(Number(rect.height));
  if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  if (width <= 0 || height <= 0) return null;
  return {
    left,
    top,
    width,
    height,
    right: Math.round(Number(rect.right ?? left + width)),
    bottom: Math.round(Number(rect.bottom ?? top + height)),
  };
}


export function sameOverlayRect(
  left: BrowserAssetOverlayRect | null | undefined,
  right: BrowserAssetOverlayRect | null | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.left === right.left &&
    left.top === right.top &&
    left.right === right.right &&
    left.bottom === right.bottom &&
    left.width === right.width &&
    left.height === right.height
  );
}

function overlayRendererUrl(): string {
  const base = browserAssetOverlayRendererUrlResolver?.();
  if (!base) throw new Error("Browser asset overlay renderer URL is unavailable");
  const url = new URL(base);
  url.searchParams.set("nomiOverlay", "browserAsset");
  url.hash = "/browser-asset-overlay";
  return url.toString();
}

function browserAssetOverlayWindowBounds(owner: BrowserWindow, hostBounds: Rectangle): Rectangle {
  const contentBounds = owner.getContentBounds();
  return {
    x: contentBounds.x + hostBounds.x,
    y: contentBounds.y + hostBounds.y,
    width: hostBounds.width,
    height: hostBounds.height,
  };
}

export function sendBrowserAssetOverlayConfig(
  record: BrowserAssetOverlayRecord,
  captureRequest: BrowserAssetOverlayCaptureRequest | null = null,
  promptRequest: BrowserAssetOverlayPromptRequest | null = null,
): void {
  if (record.window.isDestroyed()) return;
  record.window.webContents.send("browser:asset-overlay:config", {
    opened: record.window.isVisible(),
    viewId: record.viewId,
    bounds: record.hostBounds,
    captureEnabled: record.captureEnabled,
    captureRequest,
    promptRequest,
  });
}

export function sendBrowserAssetOverlayState(record: BrowserAssetOverlayRecord, opened = record.window.isVisible()): void {
  const owner = BrowserWindow.fromId(record.ownerWindowId);
  if (!owner || owner.isDestroyed()) return;
  owner.webContents.send("browser:asset-overlay:state", {
    opened,
    dockMode: opened ? record.dockMode : null,
    popoverRect: opened ? record.popoverRect : null,
    captureEnabled: opened ? record.captureEnabled : false,
  });
}

function setBrowserAssetOverlayShape(record: BrowserAssetOverlayRecord, rects: Rectangle[]): void {
  const shapedWindow = record.window as BrowserWindow & { setShape?: (rects: Rectangle[]) => void };
  try {
    shapedWindow.setShape?.(rects);
  } catch {
    // Shape support is platform-dependent; mouse forwarding remains as the fallback.
  }
}

export function applyBrowserAssetOverlayShape(record: BrowserAssetOverlayRecord): void {
  if (record.window.isDestroyed()) return;
  if (!record.dockMode || !record.popoverRect) {
    setBrowserAssetOverlayShape(record, []);
    return;
  }
  const rawLeft = Math.round(record.popoverRect.left - record.hostBounds.x);
  const rawTop = Math.round(record.popoverRect.top - record.hostBounds.y);
  const rawRight = rawLeft + Math.round(record.popoverRect.width);
  const rawBottom = rawTop + Math.round(record.popoverRect.height);
  const left = clampNumber(rawLeft - BROWSER_ASSET_OVERLAY_SHAPE_SLOP, 0, record.hostBounds.width);
  const top = clampNumber(rawTop - BROWSER_ASSET_OVERLAY_SHAPE_SLOP, 0, record.hostBounds.height);
  const right = clampNumber(rawRight + BROWSER_ASSET_OVERLAY_SHAPE_SLOP, left + 1, record.hostBounds.width);
  const bottom = clampNumber(rawBottom + BROWSER_ASSET_OVERLAY_SHAPE_SLOP, top + 1, record.hostBounds.height);
  setBrowserAssetOverlayShape(record, [
    {
      x: left,
      y: top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
    },
  ]);
}

export function applyBrowserAssetOverlayMouseEvents(record: BrowserAssetOverlayRecord): void {
  if (record.window.isDestroyed()) return;
  const shapedDockInteractive = Boolean(record.dockMode && record.popoverRect);
  const interactive =
    shapedDockInteractive || record.pointerInteractive || record.hoverInteractive || record.dragInteractive;
  record.window.setIgnoreMouseEvents(!interactive, { forward: true });
}

export function showBrowserAssetOverlay(
  record: BrowserAssetOverlayRecord,
  captureRequest: BrowserAssetOverlayCaptureRequest | null = null,
  promptRequest: BrowserAssetOverlayPromptRequest | null = null,
): void {
  if (record.window.isDestroyed()) return;
  if (!record.rendererReady) {
    record.pendingShow = true;
    if (captureRequest) record.pendingCaptureRequest = captureRequest;
    if (promptRequest) record.pendingPromptRequest = promptRequest;
    return;
  }
  record.pendingShow = false;
  const pendingCaptureRequest = captureRequest ?? record.pendingCaptureRequest;
  const pendingPromptRequest = promptRequest ?? record.pendingPromptRequest;
  record.pendingCaptureRequest = null;
  record.pendingPromptRequest = null;
  if (!record.window.isVisible()) record.window.showInactive();
  record.window.moveTop();
  sendBrowserAssetOverlayConfig(record, pendingCaptureRequest, pendingPromptRequest);
  sendBrowserAssetOverlayState(record, true);
}

function isCursorInsideBrowserAssetOverlayPopover(record: BrowserAssetOverlayRecord): boolean {
  if (!record.popoverRect) return false;
  const owner = BrowserWindow.fromId(record.ownerWindowId);
  if (!owner || owner.isDestroyed()) return false;
  const cursor = screen.getCursorScreenPoint();
  const contentBounds = owner.getContentBounds();
  const slop = record.dockMode ? 28 : 10;
  const left = contentBounds.x + record.popoverRect.left - slop;
  const top = contentBounds.y + record.popoverRect.top - slop;
  const right = contentBounds.x + record.popoverRect.right + slop;
  const bottom = contentBounds.y + record.popoverRect.bottom + slop;
  return cursor.x >= left && cursor.x <= right && cursor.y >= top && cursor.y <= bottom;
}

export function updateBrowserAssetOverlayHoverInteractive(record: BrowserAssetOverlayRecord): void {
  const nextInteractive =
    !record.window.isDestroyed() && record.window.isVisible() && isCursorInsideBrowserAssetOverlayPopover(record);
  if (record.hoverInteractive === nextInteractive) return;
  record.hoverInteractive = nextInteractive;
  applyBrowserAssetOverlayMouseEvents(record);
}

function startBrowserAssetOverlayHoverTracking(record: BrowserAssetOverlayRecord): void {
  if (record.hoverInteractiveTimer) return;
  record.hoverInteractiveTimer = setInterval(() => updateBrowserAssetOverlayHoverInteractive(record), 80);
  updateBrowserAssetOverlayHoverInteractive(record);
}

function stopBrowserAssetOverlayHoverTracking(record: BrowserAssetOverlayRecord): void {
  if (record.hoverInteractiveTimer) {
    clearInterval(record.hoverInteractiveTimer);
    record.hoverInteractiveTimer = null;
  }
  if (!record.hoverInteractive) return;
  record.hoverInteractive = false;
  applyBrowserAssetOverlayMouseEvents(record);
}

export function setBrowserAssetOverlayDragInteractive(record: BrowserAssetOverlayRecord, interactive: boolean): void {
  record.dragInteractive = interactive;
  if (record.dragInteractiveResetTimer) {
    clearTimeout(record.dragInteractiveResetTimer);
    record.dragInteractiveResetTimer = null;
  }
  if (interactive) {
    record.dragInteractiveResetTimer = setTimeout(() => {
      record.dragInteractive = false;
      record.dragInteractiveResetTimer = null;
      applyBrowserAssetOverlayMouseEvents(record);
    }, 30_000);
  }
  applyBrowserAssetOverlayMouseEvents(record);
}

export function setBrowserAssetOverlayCaptureEnabled(record: BrowserAssetOverlayRecord, enabled: boolean): void {
  record.captureEnabled = enabled;
  if (!record.viewId) return;
  const browserRecord = browserViews.get(record.viewId);
  if (!browserRecord || browserRecord.ownerWindowId !== record.ownerWindowId) return;
  browserRecord.resourceCaptureEnabled = enabled;
  void installBrowserResourceCaptureBridge(browserRecord, enabled);
}

export function setBrowserAssetOverlayViewId(record: BrowserAssetOverlayRecord, viewId: number | null): void {
  if (record.viewId === viewId) return;
  const restoreCapture = record.captureEnabled && viewId !== null;
  if (record.captureEnabled) setBrowserAssetOverlayCaptureEnabled(record, false);
  record.viewId = viewId;
  if (restoreCapture) setBrowserAssetOverlayCaptureEnabled(record, true);
}

export function setBrowserAssetOverlayHostBounds(record: BrowserAssetOverlayRecord, bounds: Rectangle): void {
  const boundsChanged = !sameRectangle(record.hostBounds, bounds);
  record.hostBounds = bounds;
  const owner = BrowserWindow.fromId(record.ownerWindowId);
  if (!owner || owner.isDestroyed() || record.window.isDestroyed()) return;
  if (bounds.width < 1 || bounds.height < 1) {
    stopBrowserAssetOverlayHoverTracking(record);
    record.window.hide();
    return;
  }
  if (boundsChanged) {
    record.window.setBounds(browserAssetOverlayWindowBounds(owner, bounds), false);
    applyBrowserAssetOverlayShape(record);
  }
}

function disableOverlayResourceCapture(record: BrowserAssetOverlayRecord): void {
  setBrowserAssetOverlayCaptureEnabled(record, false);
}

export function closeBrowserAssetOverlay(record: BrowserAssetOverlayRecord): void {
  disableOverlayResourceCapture(record);
  setBrowserAssetOverlayDragInteractive(record, false);
  stopBrowserAssetOverlayHoverTracking(record);
  record.pointerInteractive = false;
  record.pendingShow = false;
  record.pendingCaptureRequest = null;
  record.pendingPromptRequest = null;
  record.dockMode = null;
  record.popoverRect = null;
  if (!record.window.isDestroyed()) {
    applyBrowserAssetOverlayShape(record);
    record.window.setIgnoreMouseEvents(false);
    record.window.hide();
    sendBrowserAssetOverlayConfig(record);
  }
  sendBrowserAssetOverlayState(record, false);
}

function ensureBrowserAssetOverlay(owner: BrowserWindow): BrowserAssetOverlayRecord {
  const current = browserAssetOverlaysByWindow.get(owner.id);
  if (current && !current.window.isDestroyed()) return current;

  const overlayWindow = new BrowserWindow({
    parent: owner,
    modal: false,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    title: "Nomi Browser Asset Overlay",
    webPreferences: {
      preload: path.join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  overlayWindow.setMenuBarVisibility(false);
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  const record: BrowserAssetOverlayRecord = {
    ownerWindowId: owner.id,
    window: overlayWindow,
    hostBounds: { x: 0, y: 0, width: 0, height: 0 },
    viewId: null,
    captureEnabled: false,
    rendererReady: false,
    pendingShow: false,
    pendingCaptureRequest: null,
    pendingPromptRequest: null,
    dockMode: null,
    popoverRect: null,
    pointerInteractive: false,
    hoverInteractive: false,
    dragInteractive: false,
    hoverInteractiveTimer: null,
    dragInteractiveResetTimer: null,
  };
  browserAssetOverlaysByWindow.set(owner.id, record);

  overlayWindow.once("closed", () => {
    if (record.hoverInteractiveTimer) clearInterval(record.hoverInteractiveTimer);
    if (record.dragInteractiveResetTimer) clearTimeout(record.dragInteractiveResetTimer);
    if (browserAssetOverlaysByWindow.get(owner.id) === record) {
      browserAssetOverlaysByWindow.delete(owner.id);
    }
  });
  owner.once("closed", () => {
    if (!overlayWindow.isDestroyed()) overlayWindow.destroy();
    browserAssetOverlaysByWindow.delete(owner.id);
  });
  overlayWindow.webContents.on("did-finish-load", () => sendBrowserAssetOverlayConfig(record));
  void overlayWindow.loadURL(overlayRendererUrl());
  return record;
}

export function openBrowserAssetOverlay(
  owner: BrowserWindow,
  payload: BrowserAssetOverlayPayload,
  captureRequest: BrowserAssetOverlayCaptureRequest | null = null,
  promptRequest: BrowserAssetOverlayPromptRequest | null = null,
): BrowserAssetOverlayRecord {
  const viewId = payload.viewId === null || payload.viewId === undefined ? null : readViewId(payload);
  if (viewId !== null) {
    const browserRecord = browserViews.get(viewId);
    if (!browserRecord || browserRecord.ownerWindowId !== owner.id) throw new Error("Browser view not found");
  }
  const record = ensureBrowserAssetOverlay(owner);
  setBrowserAssetOverlayViewId(record, viewId);
  setBrowserAssetOverlayHostBounds(record, normalizeOverlayBounds(payload.bounds));
  record.pointerInteractive = false;
  record.hoverInteractive = false;
  record.dragInteractive = false;
  startBrowserAssetOverlayHoverTracking(record);
  applyBrowserAssetOverlayMouseEvents(record);
  showBrowserAssetOverlay(record, captureRequest, promptRequest);
  return record;
}

