import { BrowserWindow } from "electron";
import type { Rectangle, WebContents } from "electron";
import { browserViews, browserViewsByWindow } from "./browserViewState";
import type { BrowserPromptCategory, BrowserViewIdPayload, BrowserViewRecord } from "./browserViewTypes";
import { desktopT } from "../../i18n";

function defaultBrowserPromptCategories(): readonly BrowserPromptCategory[] {
  return [
    { id: "image", label: desktopT("browser.promptCategory.image") },
    { id: "video", label: desktopT("browser.promptCategory.video") },
  ];
}

export function clampNumber(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export function getSenderWindow(sender: WebContents): BrowserWindow {
  const win = BrowserWindow.fromWebContents(sender);
  if (!win || win.isDestroyed()) throw new Error("Browser window is unavailable");
  return win;
}

export function readViewId(payload: BrowserViewIdPayload): number {
  const value = Number(payload?.viewId);
  if (!Number.isFinite(value) || value <= 0) throw new Error("viewId is required");
  return value;
}

export function getBrowserViewForSender(sender: WebContents, payload: BrowserViewIdPayload): BrowserViewRecord {
  const record = browserViews.get(readViewId(payload));
  if (!record) throw new Error("Browser view not found");
  const win = getSenderWindow(sender);
  const parent = win.getParentWindow();
  if (record.ownerWindowId !== win.id && record.ownerWindowId !== parent?.id) {
    throw new Error("Browser view belongs to another window");
  }
  return record;
}

export function bringBrowserViewToFront(record: BrowserViewRecord): void {
  const win = BrowserWindow.fromId(record.ownerWindowId);
  if (!win || win.isDestroyed()) return;
  win.contentView.addChildView(record.view);
}

export function normalizeBounds(bounds: Partial<Rectangle> | undefined): Rectangle {
  const x = Math.max(0, Math.round(Number(bounds?.x ?? 0)));
  const y = Math.max(0, Math.round(Number(bounds?.y ?? 0)));
  const width = Math.max(0, Math.round(Number(bounds?.width ?? 0)));
  const height = Math.max(0, Math.round(Number(bounds?.height ?? 0)));
  return { x, y, width, height };
}

export function sameRectangle(left: Rectangle | null | undefined, right: Rectangle | null | undefined): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

export function normalizeBrowserUrl(url: unknown): string {
  const value = String(url || "").trim();
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http(s) browser URLs are supported");
  }
  return parsed.toString();
}

export function normalizePromptExtractionMode(value: unknown): "replicate" | "style" {
  return value === "style" ? "style" : "replicate";
}

export function normalizePromptCategories(input: unknown): BrowserPromptCategory[] {
  const normalized: BrowserPromptCategory[] = [];
  const seen = new Set<string>();
  const pushCategory = (idValue: unknown, labelValue: unknown): void => {
    const id = typeof idValue === "string" ? idValue.trim() : "";
    const label = typeof labelValue === "string" ? labelValue.trim() : "";
    if (!id || !label || seen.has(id)) return;
    seen.add(id);
    normalized.push({ id, label });
  };

  for (const category of defaultBrowserPromptCategories()) pushCategory(category.id, category.label);
  if (Array.isArray(input)) {
    for (const category of input) {
      if (!category || typeof category !== "object") continue;
      const candidate = category as { id?: unknown; label?: unknown };
      pushCategory(candidate.id, candidate.label);
    }
  }
  return normalized;
}

export function sendBrowserViewState(record: BrowserViewRecord): void {
  const win = BrowserWindow.fromId(record.ownerWindowId);
  if (!win || win.isDestroyed()) return;
  const contents = record.view.webContents;
  win.webContents.send("browser:view:state", {
    viewId: record.viewId,
    tabId: record.tabId,
    url: contents.getURL(),
    title: contents.getTitle(),
    canGoBack: contents.canGoBack(),
    canGoForward: contents.canGoForward(),
    loading: contents.isLoading(),
  });
}

export function destroyBrowserView(record: BrowserViewRecord): void {
  browserViews.delete(record.viewId);
  browserViewsByWindow.get(record.ownerWindowId)?.delete(record.viewId);
  const win = BrowserWindow.fromId(record.ownerWindowId);
  void record.view.webContents.session.cookies.flushStore().catch(() => undefined);
  try {
    record.view.setVisible(false);
    win?.contentView.removeChildView(record.view);
  } catch {
    // The owner window may already be closing.
  }
  if (!record.view.webContents.isDestroyed()) {
    record.view.webContents.close({ waitForBeforeUnload: false });
  }
}
