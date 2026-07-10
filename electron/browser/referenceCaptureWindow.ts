// 参考捕捞窗（PR#33 重做规格 M0）：单 BrowserWindow（chrome = 我们的 renderer #/reference-capture）
// + 单 WebContentsView（独立 partition，不可信内容面）。用户浏览任意网页，右键「捕捞」把图片/视频
// 存进项目素材库；工具条可整页截图捕捞。见 docs/plan/2026-07-10-reference-capture-window.md。
//
// 安全基线（Nomi 首个不可信内容面，deny-by-default）：
//  - 捕捞 session：权限请求/检查一律拒（摄像头/地理位置/通知…全拒，捕捞用不上任何权限）。
//  - 弹窗（window.open）：http(s) 在本视图内跟进（单视图，无多标签），其余拒。
//  - 顶层导航：仅放行 http(s)。
//  - chrome 窗自身：将任何离开本地渲染入口的导航拦下（与主窗同款纵深防御）。
//
// 入库契约（403 整类不复发）：捕捞素材只存本地字节，meta.originalUrl 恒为 null → runtime.writeAsset
// 不写 sidecar `.meta` → 永不进 48h 信任窗 → 防盗链外站 URL 永不直发 vendor。
import { BrowserWindow, Menu, MenuItem, WebContentsView, ipcMain, session, shell } from "electron";
import type { IpcMainInvokeEvent, Session } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { writeAsset } from "../runtime";
import { parseDataUrl } from "../assets/assetBytes";
import { captureFileName, isCapturableMediaUrl } from "./captureNaming";

const PARTITION = "persist:nomi-reference-capture";
const TOOLBAR_HEIGHT = 48; // chrome renderer 的工具条固定高（h-12）；view 从这条线以下铺满。
const CAPTURE_MAX_BYTES = 200 * 1024 * 1024; // 与 importRemoteAsset 同上限
const CAPTURE_TIMEOUT_MS = 120_000;
const START_URL = "https://www.bing.com/images/search?q=%E5%8F%82%E8%80%83%E5%9B%BE";

type CaptureWindowState = {
  win: BrowserWindow;
  view: WebContentsView;
  projectId: string;
};

let current: CaptureWindowState | null = null;
// 一次只跑一个捕捞下载（串行足够：用户右键→等 toast；避免 will-download 归属歧义）。
let downloadInFlight: {
  savePath: string;
  resolve: (v: { savePath: string; contentType: string }) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
} | null = null;

function sendChromeState(state: CaptureWindowState): void {
  if (state.win.isDestroyed()) return;
  const contents = state.view.webContents;
  state.win.webContents.send("nomi:browser-capture:state", {
    url: contents.getURL(),
    title: contents.getTitle(),
    loading: contents.isLoading(),
    canGoBack: contents.canGoBack(),
    canGoForward: contents.canGoForward(),
  });
}

function sendCaptureDone(state: CaptureWindowState, payload: { ok: boolean; name?: string; error?: string }): void {
  if (!state.win.isDestroyed()) state.win.webContents.send("nomi:browser-capture:capture-done", payload);
}

/** 捕捞成功后广播给所有窗口（主窗素材库据此 refresh + toast）。 */
function broadcastImported(projectId: string, name: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("nomi:browser-capture:imported", { projectId, name });
  }
}

function importCapturedBytes(
  state: CaptureWindowState,
  bytes: Buffer,
  fileName: string,
  contentType: string,
  pageUrl: string,
): void {
  // originalUrl 恒 null：捕捞图多为防盗链外站 URL，绝不能进 sidecar 信任窗（plan 验收门 3）。
  writeAsset(state.projectId, bytes, fileName, contentType, {
    kind: "browser-capture",
    pageUrl: /^https?:\/\//i.test(pageUrl) ? pageUrl : null,
    originalUrl: null,
  });
  broadcastImported(state.projectId, fileName);
  sendCaptureDone(state, { ok: true, name: fileName });
}

/** 经 view 自己的 session 下载（自动带该站 cookie），Referer 指向当前页（过防盗链）。 */
function downloadViaSession(state: CaptureWindowState, url: string, pageUrl: string): Promise<{ savePath: string; contentType: string }> {
  if (downloadInFlight) return Promise.reject(new Error("已有捕捞在进行中，请稍候"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-ref-capture-"));
  const savePath = path.join(dir, `capture-${crypto.randomUUID()}`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const pending = downloadInFlight;
      downloadInFlight = null;
      pending?.reject(new Error("捕捞下载超时（120s）"));
    }, CAPTURE_TIMEOUT_MS);
    downloadInFlight = { savePath, resolve, reject, timer };
    const headers = /^https?:\/\//i.test(pageUrl) ? { Referer: pageUrl } : undefined;
    // webContents.downloadURL：blob: 也能在页面上下文里解析；触发 session 的 will-download。
    state.view.webContents.downloadURL(url, headers ? { headers } : undefined);
  });
}

function installDownloadInterceptor(ses: Session): void {
  ses.on("will-download", (_event, item) => {
    const pending = downloadInFlight;
    if (!pending) {
      // 非捕捞发起的下载（页面自己触发的），一律取消：捕捞窗不做通用下载器。
      item.cancel();
      return;
    }
    if (item.getTotalBytes() > CAPTURE_MAX_BYTES) {
      downloadInFlight = null;
      clearTimeout(pending.timer);
      item.cancel();
      pending.reject(new Error("文件超过 200MB 上限"));
      return;
    }
    item.setSavePath(pending.savePath);
    item.on("updated", () => {
      if (item.getReceivedBytes() > CAPTURE_MAX_BYTES) item.cancel();
    });
    item.once("done", (_e, doneState) => {
      if (downloadInFlight !== pending) return; // 已超时清场
      downloadInFlight = null;
      clearTimeout(pending.timer);
      if (doneState === "completed") {
        pending.resolve({ savePath: pending.savePath, contentType: item.getMimeType() || "application/octet-stream" });
      } else {
        pending.reject(new Error(`捕捞下载失败（${doneState}）`));
      }
    });
  });
}

async function captureMediaUrl(state: CaptureWindowState, mediaUrl: string, kindHint: "image" | "video"): Promise<void> {
  const pageUrl = state.view.webContents.getURL();
  try {
    if (mediaUrl.startsWith("data:")) {
      const parsed = parseDataUrl(mediaUrl);
      importCapturedBytes(state, parsed.bytes, captureFileName(mediaUrl, parsed.contentType, kindHint), parsed.contentType, pageUrl);
      return;
    }
    const downloaded = await downloadViaSession(state, mediaUrl, pageUrl);
    try {
      const bytes = fs.readFileSync(downloaded.savePath);
      importCapturedBytes(state, bytes, captureFileName(mediaUrl, downloaded.contentType, kindHint), downloaded.contentType, pageUrl);
    } finally {
      fs.rmSync(path.dirname(downloaded.savePath), { recursive: true, force: true });
    }
  } catch (err) {
    sendCaptureDone(state, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

async function capturePageScreenshot(state: CaptureWindowState): Promise<void> {
  try {
    const image = await state.view.webContents.capturePage();
    const bytes = image.toPNG();
    if (!bytes.length) throw new Error("截图为空（页面可能未加载完成）");
    importCapturedBytes(state, bytes, captureFileName(state.view.webContents.getURL(), "image/png", "screenshot"), "image/png", state.view.webContents.getURL());
  } catch (err) {
    sendCaptureDone(state, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

function installContextMenu(state: CaptureWindowState): void {
  state.view.webContents.on("context-menu", (_event, params) => {
    const menu = new Menu();
    const srcUrl = params.srcURL || "";
    if (params.mediaType === "image" && isCapturableMediaUrl(srcUrl)) {
      menu.append(new MenuItem({ label: "捕捞图片到素材库", click: () => void captureMediaUrl(state, srcUrl, "image") }));
    }
    if (params.mediaType === "video" && isCapturableMediaUrl(srcUrl)) {
      menu.append(new MenuItem({ label: "捕捞视频到素材库", click: () => void captureMediaUrl(state, srcUrl, "video") }));
    }
    menu.append(new MenuItem({ label: "捕捞整页截图", click: () => void capturePageScreenshot(state) }));
    menu.popup({ window: state.win });
  });
}

/** 视图铺在固定工具条下方，随窗口 resize 重排。 */
function layoutView(state: CaptureWindowState): void {
  const [width, height] = state.win.getContentSize();
  state.view.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width, height: Math.max(0, height - TOOLBAR_HEIGHT) });
}

function hardenCaptureSession(ses: Session): void {
  // deny-by-default：捕捞用不上任何 web 权限。check + request 双拒（多数 API 先 check 后 request）。
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  installDownloadInterceptor(ses);
}

function hardenPageContents(state: CaptureWindowState): void {
  const contents = state.view.webContents;
  // 单视图无多标签：target=_blank 的 http(s) 在本视图跟进，其余（含自定义 scheme）一律拒。
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void contents.loadURL(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (!/^https?:\/\//i.test(url)) event.preventDefault();
  });
  for (const eventName of ["did-navigate", "did-navigate-in-page", "did-start-loading", "did-stop-loading", "page-title-updated"] as const) {
    contents.on(eventName as never, () => sendChromeState(state));
  }
}

function buildChromeUrl(rendererUrl: string, projectId: string): string {
  const url = new URL(rendererUrl);
  url.hash = `/reference-capture?projectId=${encodeURIComponent(projectId)}`;
  return url.toString();
}

function openCaptureWindow(projectId: string, rendererUrl: string, preloadPath: string): void {
  if (current && !current.win.isDestroyed()) {
    current.projectId = projectId; // 换项目复用同一窗
    current.win.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: "#f6f3ee",
    title: "网页捕捞 — Nomi",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  // chrome 窗自身的纵深防御（与主窗同款）：新窗一律拒、顶层导航只准本地渲染入口。
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  const chromeUrl = buildChromeUrl(rendererUrl, projectId);
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== chromeUrl && !url.startsWith(rendererUrl)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });

  const ses = session.fromPartition(PARTITION);
  hardenCaptureSession(ses);
  const view = new WebContentsView({ webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.contentView.addChildView(view);

  const state: CaptureWindowState = { win, view, projectId };
  current = state;
  hardenPageContents(state);
  installContextMenu(state);
  layoutView(state);
  win.on("resize", () => layoutView(state));
  win.on("closed", () => {
    if (current === state) current = null;
    if (downloadInFlight) {
      clearTimeout(downloadInFlight.timer);
      downloadInFlight = null;
    }
    view.webContents.close();
  });

  void win.loadURL(chromeUrl);
  void view.webContents.loadURL(START_URL);
}

/** 控制通道只认捕捞窗自己的 chrome renderer，别的 webContents 一律拒（不可信面纪律）。 */
function stateForSender(event: IpcMainInvokeEvent): CaptureWindowState | null {
  if (!current || current.win.isDestroyed()) return null;
  return event.sender === current.win.webContents ? current : null;
}

export function registerReferenceCaptureIpc(deps: { getRendererUrl: () => string; preloadPath: string }): void {
  ipcMain.handle("nomi:browser-capture:open", (_event, payload: { projectId?: string } | undefined) => {
    const projectId = String(payload?.projectId || "").trim();
    if (!projectId) throw new Error("projectId is required");
    openCaptureWindow(projectId, deps.getRendererUrl(), deps.preloadPath);
    return { ok: true };
  });
  ipcMain.handle("nomi:browser-capture:navigate", (event, payload: { url?: string } | undefined) => {
    const state = stateForSender(event);
    const url = String(payload?.url || "").trim();
    if (!state || !/^https?:\/\//i.test(url)) return { ok: false };
    void state.view.webContents.loadURL(url);
    return { ok: true };
  });
  ipcMain.handle("nomi:browser-capture:back", (event) => {
    const state = stateForSender(event);
    state?.view.webContents.goBack();
    return { ok: true };
  });
  ipcMain.handle("nomi:browser-capture:forward", (event) => {
    const state = stateForSender(event);
    state?.view.webContents.goForward();
    return { ok: true };
  });
  ipcMain.handle("nomi:browser-capture:reload", (event) => {
    const state = stateForSender(event);
    state?.view.webContents.reload();
    return { ok: true };
  });
  ipcMain.handle("nomi:browser-capture:screenshot", async (event) => {
    const state = stateForSender(event);
    if (state) await capturePageScreenshot(state);
    return { ok: true };
  });
  ipcMain.handle("nomi:browser-capture:open-external", (event) => {
    const state = stateForSender(event);
    const url = state?.view.webContents.getURL() || "";
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { ok: true };
  });
  ipcMain.handle("nomi:browser-capture:request-state", (event) => {
    const state = stateForSender(event);
    if (state) sendChromeState(state);
    return { ok: true };
  });
  // E2E 专用捕捞钩子：原生右键菜单 Playwright 驱动不了，走查用它触发与菜单项完全同一条
  // captureMediaUrl 产路（无并行拷贝）。仅 NOMI_E2E=1 时注册，生产不存在此通道。
  if (process.env.NOMI_E2E === "1") {
    ipcMain.handle("nomi:browser-capture:e2e-capture", async (_event, payload: { url?: string; kind?: string } | undefined) => {
      if (!current || current.win.isDestroyed()) return { ok: false, error: "no capture window" };
      const url = String(payload?.url || "").trim();
      if (!isCapturableMediaUrl(url)) return { ok: false, error: "not capturable" };
      await captureMediaUrl(current, url, payload?.kind === "video" ? "video" : "image");
      return { ok: true };
    });
  }
}
