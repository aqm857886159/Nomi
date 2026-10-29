import { BrowserWindow } from "electron";
import type { Rectangle, WebContents } from "electron";
import { browserViews, browserViewsByWindow } from "./browserViewState";
import { BROWSER_IMAGE_PROMPT_CONSOLE_PREFIX } from "./browserViewBridges";
import { normalizeCaptureSourceRect } from "../media/browserCaptureSource";
import type { BrowserResourceCapturePayload, BrowserViewIdPayload, BrowserViewRecord } from "./browserViewTypes";
import type { BrowserPromptExtractionMode } from "../../shared/contracts/browserPromptExtraction";

export class BrowserViewUnavailableError extends Error {
  constructor(message = "Browser view is unavailable") {
    super(message);
    this.name = "BrowserViewUnavailableError";
  }
}

export function clampNumber(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export function getSenderWindow(sender: WebContents): BrowserWindow {
  const win = BrowserWindow.fromWebContents(sender);
  if (!win || win.isDestroyed()) throw new BrowserViewUnavailableError("Browser window is unavailable");
  return win;
}

export function readViewId(payload: BrowserViewIdPayload): number {
  const value = Number(payload?.viewId);
  if (!Number.isFinite(value) || value <= 0) throw new Error("viewId is required");
  return value;
}

export function getBrowserViewForSender(sender: WebContents, payload: BrowserViewIdPayload): BrowserViewRecord {
  const record = browserViews.get(readViewId(payload));
  if (!record) throw new BrowserViewUnavailableError("Browser view not found");
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

export function normalizePromptExtractionMode(value: unknown): BrowserPromptExtractionMode {
  return value === "style" ? "style" : "replicate";
}

/** 页内「提取」转给主窗口的那一条事件（`browser:view:prompt-capture`）。 */
export type BrowserPromptCaptureEvent =
  | {
      ok: true;
      viewId: number;
      tabId: string;
      url: string;
      title: string;
      fileName: string;
      pageUrl: string;
      pageTitle: string;
      extractionMode: BrowserPromptExtractionMode;
      sourceRect?: NonNullable<ReturnType<typeof normalizeCaptureSourceRect>>;
    }
  | { ok: false; viewId: number; tabId: string; reason: "empty" | "error"; message?: string };

/**
 * 页内图片「提取」经 console 转出来的那一行 → 发给主窗口的事件；不是这个前缀 = null。
 *
 * 这一行网页自己就能写（按钮注入在网页主世界里，docs/plan/2026-10-27-browser-extract-grant.md 第二节），
 * 所以里面的东西全不可信：图片地址只用来抓图、上卡的「图片」那一行，标题只在库条目没标题时兜底。
 * **来源页不用网页自报的**：一律换成主进程手里这个视图的真实地址（`getURL()`，网页改不了），付费卡上的「来源页」只用它。
 */
export function promptCaptureEventFromConsole(record: BrowserViewRecord, message: string): BrowserPromptCaptureEvent | null {
  if (!message.startsWith(BROWSER_IMAGE_PROMPT_CONSOLE_PREFIX)) return null;
  const base = { viewId: record.viewId, tabId: record.tabId };
  try {
    const payload = JSON.parse(message.slice(BROWSER_IMAGE_PROMPT_CONSOLE_PREFIX.length)) as BrowserResourceCapturePayload | null;
    const url = typeof payload?.url === "string" ? payload.url.trim() : "";
    if (!url) return { ok: false, ...base, reason: "empty" };
    return {
      ok: true,
      ...base,
      url,
      title: typeof payload?.title === "string" ? payload.title : "",
      fileName: typeof payload?.fileName === "string" ? payload.fileName : "",
      pageUrl: record.view.webContents.getURL(),
      pageTitle: typeof payload?.pageTitle === "string" ? payload.pageTitle : "",
      extractionMode: normalizePromptExtractionMode(payload?.extractionMode),
      sourceRect: normalizeCaptureSourceRect(record, payload?.sourceRect) || undefined,
    };
  } catch (error) {
    return { ok: false, ...base, reason: "error", message: error instanceof Error ? error.message : String(error) };
  }
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
