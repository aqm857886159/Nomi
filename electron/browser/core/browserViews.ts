import { BrowserWindow, WebContentsView, ipcMain, session, shell } from "electron";
import {
  BROWSER_IMAGE_DRAG_END_CONSOLE_MESSAGE,
  BROWSER_IMAGE_DRAG_START_CONSOLE_PREFIX,
  BROWSER_IMAGE_PROMPT_CONSOLE_PREFIX,
  BROWSER_TEXT_PROMPT_CONSOLE_PREFIX,
  installBrowserImageDragBridge,
  installBrowserPromptHoverBridge,
  installBrowserResourceCaptureBridge,
} from "./browserViewBridges";
import {
  cancelBrowserChromeMenu,
  normalizeBrowserChromeMenuPayload,
  selectBrowserChromeMenu,
  showBrowserChromeMenu,
} from "../chrome/browserViewChromeMenu";
import {
  captureBrowserPromptImage,
  captureBrowserPromptScreenshot,
  captureBrowserResource,
  importBrowserMedia,
} from "../media/browserViewMedia";
import { normalizeCaptureSourceRect } from "../media/browserCaptureSource";
import { selectBrowserPromptScreenshotRect } from "../media/browserPromptScreenshotSelection";
import {
  applyBrowserAssetOverlayMouseEvents,
  applyBrowserAssetOverlayShape,
  closeBrowserAssetOverlay,
  finishBrowserAssetOverlayDrag,
  getOverlayForSender,
  getOwnerWindowForSender,
  normalizeOverlayBounds,
  normalizeOverlayDockMode,
  normalizeOverlayRect,
  openBrowserAssetOverlay,
  sendBrowserAssetOverlayConfig,
  sendBrowserAssetOverlayState,
  setBrowserAssetOverlayCaptureEnabled,
  setBrowserAssetOverlayDragInteractive,
  setBrowserAssetOverlayHostBounds,
  setBrowserAssetOverlayViewId,
  setBrowserAssetOverlayRendererUrlResolver,
  showBrowserAssetOverlay,
  sameOverlayRect,
  updateBrowserAssetOverlayHoverInteractive,
} from "../overlay/browserViewOverlay";
import { allocateBrowserViewId, browserAssetOverlaysByWindow, browserViews, browserViewsByWindow } from "./browserViewState";
import { BROWSER_PROFILE_PARTITION, STANDARD_CHROME_UA, configureBrowserSession } from "./browserViewSession";
import {
  bringBrowserViewToFront,
  destroyBrowserView,
  getBrowserViewForSender,
  getSenderWindow,
  normalizeBounds,
  normalizeBrowserUrl,
  normalizePromptExtractionMode,
  readViewId,
  sameRectangle,
  sendBrowserViewState,
} from "./browserViewUtils";
import type {
  BrowserAssetOverlayCaptureRequest,
  BrowserAssetOverlayPayload,
  BrowserAssetOverlayStatePayload,
  BrowserChromeMenuPayload,
  BrowserResourceCapturePayload,
  BrowserViewCreatePayload,
  BrowserViewIdPayload,
  BrowserViewImportMediaPayload,
  BrowserViewNavigatePayload,
  BrowserViewPromptImagePayload,
  BrowserViewPromptScreenshotPayload,
  BrowserViewRecord,
  BrowserViewResizePayload,
} from "./browserViewTypes";

function trackBrowserView(win: BrowserWindow, record: BrowserViewRecord): void {
  let ids = browserViewsByWindow.get(win.id);
  if (!ids) {
    ids = new Set();
    browserViewsByWindow.set(win.id, ids);
    win.once("closed", () => {
      const owned = browserViewsByWindow.get(win.id);
      browserViewsByWindow.delete(win.id);
      owned?.forEach((viewId) => {
        const current = browserViews.get(viewId);
        if (current) destroyBrowserView(current);
      });
    });
  }
  ids.add(record.viewId);
}

function attachBrowserViewEvents(record: BrowserViewRecord): void {
  const contents = record.view.webContents;
  const notify = () => {
    sendBrowserViewState(record);
    void installBrowserImageDragBridge(record);
    void installBrowserPromptHoverBridge(record);
    if (record.resourceCaptureEnabled) void installBrowserResourceCaptureBridge(record, true);
  };
  contents.on("did-start-loading", notify);
  contents.on("did-stop-loading", notify);
  contents.on("did-navigate", notify);
  contents.on("did-navigate-in-page", notify);
  contents.on("dom-ready", () => {
    void installBrowserImageDragBridge(record);
    void installBrowserPromptHoverBridge(record);
    if (record.resourceCaptureEnabled) void installBrowserResourceCaptureBridge(record, true);
  });
  contents.on("before-input-event", (event, input) => {
    if (!record.resourceCaptureEnabled) return;
    if (input.type !== "keyDown") return;
    if (input.isAutoRepeat) return;
    if (String(input.key || "").toLowerCase() !== "c") return;
    if (!input.control && !input.meta) return;
    event.preventDefault();
    void captureBrowserResource(record);
  });
  contents.on("console-message", (_event, _level, message) => {
    if (message.startsWith(BROWSER_IMAGE_PROMPT_CONSOLE_PREFIX)) {
      const win = BrowserWindow.fromId(record.ownerWindowId);
      if (!win || win.isDestroyed()) return;
      try {
        const payload = JSON.parse(message.slice(BROWSER_IMAGE_PROMPT_CONSOLE_PREFIX.length)) as BrowserResourceCapturePayload;
        const url = typeof payload?.url === "string" ? payload.url.trim() : "";
        if (!url) {
          win.webContents.send("browser:view:prompt-capture", {
            ok: false,
            viewId: record.viewId,
            tabId: record.tabId,
            reason: "empty",
          });
          return;
        }
        win.webContents.send("browser:view:prompt-capture", {
          ok: true,
          viewId: record.viewId,
          tabId: record.tabId,
          url,
          title: typeof payload?.title === "string" ? payload.title : "",
          fileName: typeof payload?.fileName === "string" ? payload.fileName : "",
          pageUrl: typeof payload?.pageUrl === "string" ? payload.pageUrl : "",
          pageTitle: typeof payload?.pageTitle === "string" ? payload.pageTitle : "",
          extractionMode: normalizePromptExtractionMode(payload?.extractionMode),
          sourceRect: normalizeCaptureSourceRect(record, payload?.sourceRect) || undefined,
        });
      } catch (error) {
        win.webContents.send("browser:view:prompt-capture", {
          ok: false,
          viewId: record.viewId,
          tabId: record.tabId,
          reason: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    if (message.startsWith(BROWSER_TEXT_PROMPT_CONSOLE_PREFIX)) {
      const win = BrowserWindow.fromId(record.ownerWindowId);
      if (!win || win.isDestroyed()) return;
      try {
        const payload = JSON.parse(message.slice(BROWSER_TEXT_PROMPT_CONSOLE_PREFIX.length)) as {
          prompt?: unknown;
          promptType?: unknown;
          pageUrl?: unknown;
          pageTitle?: unknown;
        };
        const prompt = typeof payload?.prompt === "string" ? payload.prompt.trim() : "";
        if (!prompt) return;
        win.webContents.send("browser:view:text-prompt-save", {
          ok: true,
          viewId: record.viewId,
          tabId: record.tabId,
          prompt,
          promptType: typeof payload.promptType === "string" && payload.promptType.trim()
            ? payload.promptType.trim()
            : "image",
          pageUrl: typeof payload.pageUrl === "string" ? payload.pageUrl : "",
          pageTitle: typeof payload.pageTitle === "string" ? payload.pageTitle : "",
        });
      } catch (error) {
        win.webContents.send("browser:view:text-prompt-save", {
          ok: false,
          viewId: record.viewId,
          tabId: record.tabId,
          reason: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    if (message === BROWSER_IMAGE_DRAG_END_CONSOLE_MESSAGE) {
      const overlay = browserAssetOverlaysByWindow.get(record.ownerWindowId);
      if (overlay) setBrowserAssetOverlayDragInteractive(overlay, false);
      return;
    }
    if (!message.startsWith(BROWSER_IMAGE_DRAG_START_CONSOLE_PREFIX)) return;
    const overlay = browserAssetOverlaysByWindow.get(record.ownerWindowId);
    if (!overlay || overlay.viewId !== record.viewId || overlay.window.isDestroyed() || !overlay.window.isVisible()) {
      return;
    }
    setBrowserAssetOverlayDragInteractive(overlay, true);
  });
  contents.on("page-title-updated", notify);
  contents.on("page-favicon-updated", (_event, favicons) => {
    const win = BrowserWindow.fromId(record.ownerWindowId);
    if (!win || win.isDestroyed()) return;
    win.webContents.send("browser:view:state", {
      viewId: record.viewId,
      tabId: record.tabId,
      url: contents.getURL(),
      title: contents.getTitle(),
      favicon: favicons[0] || "",
      canGoBack: contents.canGoBack(),
      canGoForward: contents.canGoForward(),
      loading: contents.isLoading(),
    });
  });
  contents.setWindowOpenHandler(({ url }) => {
    try {
      const nextUrl = normalizeBrowserUrl(url);
      void contents.loadURL(nextUrl);
    } catch {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    try {
      normalizeBrowserUrl(url);
    } catch {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });
}

export function registerBrowserViewIpc(rendererUrlResolver?: () => string): void {
  setBrowserAssetOverlayRendererUrlResolver(rendererUrlResolver);

  ipcMain.handle("browser:view:create", async (event, payload: BrowserViewCreatePayload = {}) => {
    const win = getSenderWindow(event.sender);
    const tabId = String(payload.tabId || "").trim();
    if (!tabId) throw new Error("tabId is required");
    const partition = String(payload.partition || BROWSER_PROFILE_PARTITION);
    const viewSession = session.fromPartition(partition);
    await configureBrowserSession(viewSession);
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: true,
        session: viewSession,
      },
    });
    view.webContents.setUserAgent(STANDARD_CHROME_UA);
    view.setVisible(false);
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    win.contentView.addChildView(view);

    const record: BrowserViewRecord = {
      viewId: allocateBrowserViewId(),
      tabId,
      ownerWindowId: win.id,
      view,
      lastBounds: { x: 0, y: 0, width: 0, height: 0 },
      resourceCaptureEnabled: false,
    };
    browserViews.set(record.viewId, record);
    trackBrowserView(win, record);
    attachBrowserViewEvents(record);
    return { viewId: record.viewId };
  });

  ipcMain.on("browser:view:destroy", (event, payload: BrowserViewIdPayload) => {
    const record = getBrowserViewForSender(event.sender, payload);
    destroyBrowserView(record);
  });

  ipcMain.on("browser:view:navigate", (event, payload: BrowserViewNavigatePayload) => {
    const record = getBrowserViewForSender(event.sender, payload);
    const url = normalizeBrowserUrl(payload.url);
    void record.view.webContents.loadURL(url);
    sendBrowserViewState(record);
  });

  ipcMain.on("browser:view:back", (event, payload: BrowserViewIdPayload) => {
    const record = getBrowserViewForSender(event.sender, payload);
    if (record.view.webContents.canGoBack()) record.view.webContents.goBack();
  });

  ipcMain.on("browser:view:forward", (event, payload: BrowserViewIdPayload) => {
    const record = getBrowserViewForSender(event.sender, payload);
    if (record.view.webContents.canGoForward()) record.view.webContents.goForward();
  });

  ipcMain.on("browser:view:reload", (event, payload: BrowserViewIdPayload) => {
    getBrowserViewForSender(event.sender, payload).view.webContents.reload();
  });

  ipcMain.on("browser:view:resize", (event, payload: BrowserViewResizePayload) => {
    const record = getBrowserViewForSender(event.sender, payload);
    const bounds = normalizeBounds(payload.bounds);
    if (sameRectangle(record.lastBounds, bounds)) return;
    record.lastBounds = bounds;
    bringBrowserViewToFront(record);
    record.view.setBounds(bounds);
  });

  ipcMain.on("browser:view:show", (event, payload: BrowserViewIdPayload) => {
    const record = getBrowserViewForSender(event.sender, payload);
    bringBrowserViewToFront(record);
    record.view.setBounds(record.lastBounds);
    record.view.setVisible(true);
    sendBrowserViewState(record);
  });

  ipcMain.on("browser:view:hide", (event, payload: BrowserViewIdPayload) => {
    const record = getBrowserViewForSender(event.sender, payload);
    record.view.webContents.setBackgroundThrottling(true);
    record.view.setVisible(false);
    void record.view.webContents.session.cookies.flushStore().catch(() => undefined);
  });

  ipcMain.handle("browser:view:import-media", async (event, payload: BrowserViewImportMediaPayload) => {
    const record = getBrowserViewForSender(event.sender, payload);
    return importBrowserMedia(record, payload);
  });

  ipcMain.handle("browser:view:capture-prompt-image", async (event, payload: BrowserViewPromptImagePayload) => {
    const record = getBrowserViewForSender(event.sender, payload);
    return captureBrowserPromptImage(record, payload);
  });

  ipcMain.handle("browser:view:select-prompt-screenshot", async (event, payload: BrowserViewIdPayload) => {
    const record = getBrowserViewForSender(event.sender, payload);
    return selectBrowserPromptScreenshotRect(record);
  });

  ipcMain.handle("browser:view:capture-prompt-screenshot", async (event, payload: BrowserViewPromptScreenshotPayload) => {
    const record = getBrowserViewForSender(event.sender, payload);
    return captureBrowserPromptScreenshot(record, payload);
  });

  ipcMain.on("browser:view:set-resource-capture", (event, payload: BrowserViewIdPayload & { enabled?: unknown }) => {
    const record = getBrowserViewForSender(event.sender, payload);
    record.resourceCaptureEnabled = Boolean(payload.enabled);
    void installBrowserResourceCaptureBridge(record, record.resourceCaptureEnabled);
  });

  ipcMain.on("browser:view:capture-resource", (event, payload: BrowserViewIdPayload) => {
    const record = getBrowserViewForSender(event.sender, payload);
    if (!record.resourceCaptureEnabled) return;
    void captureBrowserResource(record);
  });

  ipcMain.handle("browser:chrome-menu:show", (event, payload: BrowserChromeMenuPayload) => {
    const owner = getOwnerWindowForSender(event.sender);
    return showBrowserChromeMenu(owner, normalizeBrowserChromeMenuPayload(payload));
  });

  ipcMain.on("browser:chrome-menu:select", (event, id: unknown) => {
    selectBrowserChromeMenu(event.sender.id, id);
  });

  ipcMain.on("browser:chrome-menu:cancel", (event) => {
    cancelBrowserChromeMenu(event.sender.id);
  });

  ipcMain.on("browser:asset-overlay:open", (event, payload: BrowserAssetOverlayPayload) => {
    const owner = getOwnerWindowForSender(event.sender);
    openBrowserAssetOverlay(owner, payload, payload.captureRequest ?? null);
  });

  ipcMain.on("browser:asset-overlay:update-host", (event, payload: BrowserAssetOverlayPayload) => {
    const record = getOverlayForSender(event.sender);
    if (!record) return;
    if (payload.viewId === null) {
      setBrowserAssetOverlayViewId(record, null);
    } else if (payload.viewId !== undefined) {
      const viewId = readViewId(payload);
      const browserRecord = browserViews.get(viewId);
      if (browserRecord?.ownerWindowId === record.ownerWindowId) setBrowserAssetOverlayViewId(record, viewId);
    }
    setBrowserAssetOverlayHostBounds(record, normalizeOverlayBounds(payload.bounds));
    sendBrowserAssetOverlayConfig(record);
  });

  ipcMain.on("browser:asset-overlay:close", (event) => {
    const record = getOverlayForSender(event.sender);
    if (record) closeBrowserAssetOverlay(record);
  });

  ipcMain.on("browser:asset-overlay:capture-request", (event, payload: BrowserAssetOverlayCaptureRequest) => {
    const owner = getOwnerWindowForSender(event.sender);
    const record = browserAssetOverlaysByWindow.get(owner.id);
    if (!record) return;
    showBrowserAssetOverlay(record, payload);
  });

  ipcMain.on("browser:asset-overlay:ready", (event) => {
    const record = getOverlayForSender(event.sender);
    if (!record) return;
    record.rendererReady = true;
    if (record.pendingShow) {
      showBrowserAssetOverlay(record);
      return;
    }
    sendBrowserAssetOverlayConfig(record);
    sendBrowserAssetOverlayState(record, record.window.isVisible());
  });

  ipcMain.on("browser:asset-overlay:set-interactive", (event, payload: { interactive?: unknown }) => {
    const record = getOverlayForSender(event.sender);
    if (!record || record.window.isDestroyed()) return;
    record.pointerInteractive = payload.interactive === true;
    applyBrowserAssetOverlayMouseEvents(record);
  });

  ipcMain.on("browser:asset-overlay:finish-drag", (event) => {
    const record = getOverlayForSender(event.sender);
    if (!record || record.window.isDestroyed()) return;
    finishBrowserAssetOverlayDrag(record);
  });

  ipcMain.on("browser:asset-overlay:set-state", (event, payload: BrowserAssetOverlayStatePayload) => {
    const record = getOverlayForSender(event.sender);
    if (!record) return;
    const nextDockMode = normalizeOverlayDockMode(payload.dockMode);
    const nextPopoverRect = normalizeOverlayRect(payload.popoverRect);
    const nextCaptureEnabled =
      payload.captureEnabled === undefined ? record.captureEnabled : Boolean(payload.captureEnabled);
    const stateChanged =
      record.dockMode !== nextDockMode ||
      !sameOverlayRect(record.popoverRect, nextPopoverRect) ||
      record.captureEnabled !== nextCaptureEnabled;
    if (!stateChanged) return;
    record.dockMode = nextDockMode;
    record.popoverRect = nextPopoverRect;
    applyBrowserAssetOverlayShape(record);
    updateBrowserAssetOverlayHoverInteractive(record);
    if (payload.captureEnabled !== undefined) {
      setBrowserAssetOverlayCaptureEnabled(record, nextCaptureEnabled);
    }
    sendBrowserAssetOverlayState(record, record.window.isVisible());
  });

  ipcMain.on("browser:asset-overlay:import-to-canvas", (event, payload: unknown) => {
    const owner = getOwnerWindowForSender(event.sender);
    if (owner.isDestroyed()) return;
    owner.webContents.send("browser:asset-overlay:import-to-canvas", payload);
  });

  // contained 素材盒问「父窗现在有没有画布导入目标」——overlay 是独立窗口，DOM 探针跨窗探不到。
  // 选择器与渲染层 browserAssetPopoverConstants.CANVAS_IMPORT_TARGET_SELECTOR 同义（跨进程无法共享常量）。
  ipcMain.handle("browser:asset-overlay:canvas-import-available", async (event) => {
    try {
      const owner = getOwnerWindowForSender(event.sender);
      if (owner.isDestroyed()) return false;
      // 不传 userGesture：这是每 3s 的后台探测，绝不能在父窗合成用户手势（会干扰进行中的拖拽/焦点）。
      const available = await owner.webContents.executeJavaScript(
        "!!document.querySelector('[data-nomi-generation-canvas-import-target=\"true\"]')",
      );
      return Boolean(available);
    } catch {
      return false;
    }
  });
}
