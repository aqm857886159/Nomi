import { BrowserWindow, Menu, WebContentsView, ipcMain, shell, session } from "electron";
import type { BrowserWindowConstructorOptions, Rectangle, Session } from "electron";
import path from "node:path";
import { parseDataUrl } from "../assets/assetBytes";
import { importLocalFile } from "../assets/localFileImport";
import { browserCaptureContentType, browserCaptureFileName, browserCaptureMediaTarget, type BrowserCaptureMediaKind } from "./browserCaptureMedia";

type CaptureState = {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  status: string;
  error: string | null;
};

type CaptureRecord = {
  projectId: string;
  window: BrowserWindow;
  view: WebContentsView;
};

const BROWSER_CAPTURE_PARTITION = "persist:nomi-browser-capture";
const BROWSER_CAPTURE_SHELL_PARTITION = "persist:nomi-browser-capture-shell";
const TOOLBAR_HEIGHT = 44;
let captureRecord: CaptureRecord | null = null;
let captureSessionHardened = false;

function normalizeCaptureUrl(raw: unknown): string {
  const text = String(raw || "").trim();
  if (!text) throw new Error("请输入网址");
  const withProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(text) ? text : `https://${text}`;
  const url = new URL(withProtocol);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("只支持 http(s) 网页");
  return url.toString();
}

function captureShellHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Nomi 参考捕捞</title><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#f6f3ee;color:#2b2823;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.bar{height:${TOOLBAR_HEIGHT}px;display:grid;grid-template-columns:auto auto minmax(0,1fr) auto;gap:6px;align-items:center;padding:6px 10px;border-bottom:1px solid rgba(43,40,35,.12);background:#fffdfa}
button{height:30px;min-width:30px;border:1px solid transparent;border-radius:6px;background:transparent;color:#4c453d;font:600 13px/1 inherit;cursor:pointer}
button:hover:not(:disabled){background:rgba(43,40,35,.06)}button:disabled{opacity:.38;cursor:default}
form{display:flex;min-width:0;gap:6px}input{height:30px;min-width:0;flex:1;border:1px solid rgba(43,40,35,.16);border-radius:6px;background:#f6f3ee;padding:0 10px;color:#2b2823;font:500 13px/30px inherit;outline:none}
input:focus{border-color:rgba(75,108,86,.55);background:#fff}.status{height:20px;min-width:140px;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(43,40,35,.55);font-size:12px}
.hint{position:absolute;left:0;right:0;top:44px;height:28px;display:none;align-items:center;justify-content:center;background:rgba(75,108,86,.94);color:white;font-size:12px;font-weight:650;z-index:2}.hint[data-open="true"]{display:flex}
</style></head><body>
<div class="bar">
  <button id="back" title="后退" aria-label="后退">‹</button>
  <button id="forward" title="前进" aria-label="前进">›</button>
  <form id="form"><input id="url" spellcheck="false" autocomplete="off" placeholder="输入参考网页地址" /></form>
  <div class="status" id="status">右键图片或视频捕捞进素材库</div>
</div>
<div class="hint" id="hint"></div>
<script>
const api = window.nomiDesktop && window.nomiDesktop.browserCapture;
const form = document.getElementById('form');
const input = document.getElementById('url');
const back = document.getElementById('back');
const forward = document.getElementById('forward');
const status = document.getElementById('status');
const hint = document.getElementById('hint');
let hintTimer = 0;
function showHint(text, danger) {
  window.clearTimeout(hintTimer);
  hint.textContent = text;
  hint.style.background = danger ? 'rgba(159,57,45,.94)' : 'rgba(75,108,86,.94)';
  hint.dataset.open = 'true';
  hintTimer = window.setTimeout(() => { hint.dataset.open = 'false'; }, 2200);
}
form.addEventListener('submit', (event) => {
  event.preventDefault();
  api && api.navigate(input.value).catch((error) => showHint(error && error.message ? error.message : String(error), true));
});
back.addEventListener('click', () => api && api.back());
forward.addEventListener('click', () => api && api.forward());
api && api.onState((state) => {
  if (document.activeElement !== input) input.value = state.url || '';
  back.disabled = !state.canGoBack;
  forward.disabled = !state.canGoForward;
  status.textContent = state.error || state.status || (state.loading ? '加载中' : '右键图片或视频捕捞进素材库');
});
api && api.onCaptureResult((result) => showHint(result.ok ? '已捕捞到素材库：' + result.name : result.error, !result.ok));
</script></body></html>`;
}

function shellOptions(parent?: BrowserWindow | null): BrowserWindowConstructorOptions {
  return {
    width: 1120,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    title: "Nomi 参考捕捞",
    backgroundColor: "#f6f3ee",
    ...(parent ? { parent } : {}),
    webPreferences: {
      preload: path.join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      partition: BROWSER_CAPTURE_SHELL_PARTITION,
    },
  };
}

function hardenCaptureSession(viewSession: Session): void {
  if (captureSessionHardened) return;
  captureSessionHardened = true;
  viewSession.setPermissionCheckHandler(() => false);
  viewSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  viewSession.setDisplayMediaRequestHandler((_request, callback) => callback({}));
}

function viewBounds(bounds: Rectangle): Rectangle {
  return { x: 0, y: TOOLBAR_HEIGHT, width: bounds.width, height: Math.max(0, bounds.height - TOOLBAR_HEIGHT) };
}

function sendState(record: CaptureRecord, patch: Partial<CaptureState> = {}): void {
  const contents = record.view.webContents;
  const state: CaptureState = {
    url: contents.getURL(),
    title: contents.getTitle(),
    loading: contents.isLoading(),
    canGoBack: contents.canGoBack(),
    canGoForward: contents.canGoForward(),
    status: "",
    error: null,
    ...patch,
  };
  if (!record.window.isDestroyed()) record.window.webContents.send("nomi:browser-capture:state", state);
}

function notifyAssetImported(projectId: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("nomi:browser-capture:asset-imported", { projectId });
  }
}

async function bytesForTarget(record: CaptureRecord, target: { url: string; kind: BrowserCaptureMediaKind; pageUrl: string; suggestedName: string }): Promise<{
  bytes: Buffer;
  contentType: string;
  fileName: string;
}> {
  if (target.url.startsWith("data:")) {
    const parsed = parseDataUrl(target.url);
    const fileName = browserCaptureFileName({ url: target.url, contentType: parsed.contentType, suggestedName: target.suggestedName, fallbackKind: target.kind });
    return { bytes: parsed.bytes, contentType: parsed.contentType, fileName };
  }
  const response = await record.view.webContents.session.fetch(target.url, {
    headers: target.pageUrl ? { Referer: target.pageUrl } : undefined,
  });
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
  const responseType = response.headers.get("content-type") || "";
  const firstName = browserCaptureFileName({ url: target.url, contentType: responseType, suggestedName: target.suggestedName, fallbackKind: target.kind });
  const contentType = browserCaptureContentType({ responseType, fileName: firstName, fallbackKind: target.kind });
  const fileName = browserCaptureFileName({ url: target.url, contentType, suggestedName: firstName, fallbackKind: target.kind });
  return { bytes: Buffer.from(await response.arrayBuffer()), contentType, fileName };
}

async function importCaptureTarget(record: CaptureRecord, target: { url: string; kind: BrowserCaptureMediaKind; pageUrl: string; suggestedName: string }): Promise<void> {
  try {
    sendState(record, { status: "正在捕捞素材" });
    const media = await bytesForTarget(record, target);
    const asset = await importLocalFile({
      projectId: record.projectId,
      bytes: media.bytes,
      contentType: media.contentType,
      fileName: media.fileName,
      kind: "browser-capture",
    }) as { name?: string };
    record.window.webContents.send("nomi:browser-capture:result", { ok: true, name: asset.name || media.fileName });
    notifyAssetImported(record.projectId);
    sendState(record, { status: "已捕捞到素材库" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record.window.webContents.send("nomi:browser-capture:result", { ok: false, error: message });
    sendState(record, { status: "", error: message });
  }
}

function installViewHandlers(record: CaptureRecord): void {
  const contents = record.view.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void contents.loadURL(url);
    } else {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  contents.on("did-start-loading", () => sendState(record, { status: "加载中" }));
  contents.on("did-stop-loading", () => sendState(record));
  contents.on("did-navigate", () => sendState(record));
  contents.on("did-navigate-in-page", () => sendState(record));
  contents.on("page-title-updated", () => sendState(record));
  contents.on("did-fail-load", (_event, code, description, failedUrl, isMainFrame) => {
    if (isMainFrame) sendState(record, { error: `${description || "加载失败"} (${code})`, url: failedUrl });
  });
  contents.on("context-menu", (event, params) => {
    event.preventDefault();
    const target = browserCaptureMediaTarget(params);
    const template: Electron.MenuItemConstructorOptions[] = [];
    if (target) {
      template.push({
        label: target.kind === "video" ? "捕捞视频到素材库" : "捕捞图片到素材库",
        click: () => void importCaptureTarget(record, {
          url: target.url,
          kind: target.kind,
          pageUrl: params.pageURL || contents.getURL(),
          suggestedName: target.suggestedName,
        }),
      });
      template.push({ type: "separator" });
    }
    template.push(
      { label: "后退", enabled: contents.canGoBack(), click: () => contents.goBack() },
      { label: "前进", enabled: contents.canGoForward(), click: () => contents.goForward() },
      { label: "刷新", click: () => contents.reload() },
    );
    Menu.buildFromTemplate(template).popup({ window: record.window, x: params.x, y: params.y, sourceType: params.menuSourceType });
  });
}

function ensureCaptureRecord(projectId: string, owner?: BrowserWindow | null): CaptureRecord {
  if (captureRecord && !captureRecord.window.isDestroyed()) {
    captureRecord.projectId = projectId;
    captureRecord.window.show();
    captureRecord.window.focus();
    sendState(captureRecord);
    return captureRecord;
  }
  const viewSession = session.fromPartition(BROWSER_CAPTURE_PARTITION);
  hardenCaptureSession(viewSession);
  const window = new BrowserWindow(shellOptions(owner));
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      session: viewSession,
    },
  });
  const record: CaptureRecord = { projectId, window, view };
  captureRecord = record;
  window.contentView.addChildView(view);
  view.setBounds(viewBounds(window.getContentBounds()));
  window.on("resize", () => view.setBounds(viewBounds(window.getContentBounds())));
  window.on("closed", () => {
    if (captureRecord === record) captureRecord = null;
    if (!view.webContents.isDestroyed()) view.webContents.close();
  });
  installViewHandlers(record);
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(captureShellHtml())}`);
  return record;
}

export function registerBrowserCaptureIpc(): void {
  ipcMain.handle("nomi:browser-capture:open", async (event, payload: { projectId?: unknown; url?: unknown } | null) => {
    const projectId = String(payload?.projectId || "").trim();
    if (!projectId) throw new Error("projectId is required");
    const owner = BrowserWindow.fromWebContents(event.sender);
    const record = ensureCaptureRecord(projectId, owner);
    if (payload?.url) await record.view.webContents.loadURL(normalizeCaptureUrl(payload.url));
    sendState(record);
    return { ok: true };
  });
  ipcMain.handle("nomi:browser-capture:navigate", async (_event, payload: { url?: unknown } | null) => {
    if (!captureRecord || captureRecord.window.isDestroyed()) throw new Error("参考捕捞窗未打开");
    await captureRecord.view.webContents.loadURL(normalizeCaptureUrl(payload?.url));
    sendState(captureRecord);
    return { ok: true };
  });
  ipcMain.handle("nomi:browser-capture:back", () => {
    if (captureRecord?.view.webContents.canGoBack()) captureRecord.view.webContents.goBack();
  });
  ipcMain.handle("nomi:browser-capture:forward", () => {
    if (captureRecord?.view.webContents.canGoForward()) captureRecord.view.webContents.goForward();
  });
  ipcMain.handle("nomi:browser-capture:reload", () => {
    captureRecord?.view.webContents.reload();
  });
  ipcMain.handle("nomi:browser-capture:close", () => {
    captureRecord?.window.close();
  });
}
