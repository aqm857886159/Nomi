import { app, BrowserWindow, dialog, ipcMain, protocol, session, shell } from "electron";
import type { Rectangle, WebContents } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createProject, deleteProject, listProjects, readProject, saveProject } from "./projects/repository";
import {
  clearModelCatalogVendorApiKey,
  deleteModelCatalogMapping,
  deleteModelCatalogModel,
  deleteModelCatalogVendor,
  ensureBuiltinModelSeeds,
  exportModelCatalogPackage,
  getModelCatalogHealth,
  importModelCatalogPackage,
  listModelCatalogMappings,
  listModelCatalogModels,
  listModelCatalogVendors,
  upsertModelCatalogMapping,
  upsertModelCatalogModel,
  upsertModelCatalogVendor,
  upsertModelCatalogVendorApiKey,
} from "./catalog/catalogStore";
import { runTaskWithIdempotency } from "./submissionLedger";
import { mintSpendGrant } from "./spendGrant";
import { openWorkspaceFolder, selectWorkspaceFolder } from "./workspace/workspaceIpc";
import { listWorkspaceFiles, resolveWorkspaceFilePath } from "./workspace/workspaceFileIndex";
import { registerWorkspaceFileDeleteIpc } from "./workspace/workspaceFileDelete";
import { installCrashHandlers, logCrash } from "./crashLog";
import { registerExportJobIpc } from "./export/exportJobIpc";
import { registerAgentChatV2Ipc } from "./ai/agentChatV2Ipc";
import { registerTextStreamIpc } from "./ai/textStreamIpc";
import { registerConversationsIpc } from "./conversations/conversationsIpc";
import { setEventLogSecretsProvider } from "./events/eventLogRepository";
import { registerEventsIpc } from "./events/eventsIpc";
import { registerMemoryIpc } from "./memory/memoryIpc";
import { registerPromptLibraryIpc } from "./promptLibrary/promptLibraryIpc";
import { registerBrowserViewIpc } from "./browser/core/browserViews";
import { registerBrowserPromptExtractionSettingsIpc } from "./browser/settings/browserPromptExtractionSettings";
import { catalogSecretsProvider } from "./events/secretsProvider";
import { registerOnboardingIpc } from "./ai/onboarding/onboardingIpc";
import { registerUpdaterIpc } from "./update/autoUpdater";
import { setRendererTarget } from "./capabilityCore/rendererBridge";
import { registerReferenceCaptureIpc } from "./browser/referenceCaptureWindow";
import { readMcpInfo, installMcp, uninstallMcp } from "./capabilityCore/mcpConfig";
import { registerLocalProtocol } from "./protocol/localProtocol";
import { installWindowCloseConfirmation } from "./windowCloseConfirmation";

// 尽早安装：捕获引导阶段起的 uncaughtException / unhandledRejection，落盘到 app logs（P0-8）。
installCrashHandlers();

const configuredUserDataDir = String(process.env.NOMI_ELECTRON_USER_DATA_DIR || "").trim();
if (configuredUserDataDir) {
  // dev-electron.mjs 会按 renderer 端口分配独立 profile；这里若不真正切到该目录，
  // Electron 仍会复用全局 userData，把旧的 Vite chunk/code cache 吃回来，出现
  // 「主界面加载失败但纯 Vite 页面正常」这类很像灵异事件的缓存串味。
  app.setPath("userData", configuredUserDataDir);
}

// 单实例锁（能力核前提，docs/plan/2026-06-20）：保证同一 user-data 只有一个 app 实例 = 工程文件的
// 唯一写者，外部 CLI/MCP 才能安全地「app 开着走 RPC、关着走 headless」。隔离实例（eval/promo 用独立
// --user-data-dir）拿到的是各自的锁，不受影响。拿不到锁 = 已有实例在跑 → 让出（聚焦老窗后退出）。
// MCP stdio 模式：Claude Code / Codex 用 Nomi 自身二进制 + env NOMI_MCP_STDIO=1 把它拉起当 MCP server
//（见 docs/plan/2026-06-24-packaged-mcp-stdio-server.md）。此模式**绝不抢单实例锁**——否则 GUI 在跑时
// 它会被判第二实例而自杀；也不开窗、不起 IPC，只跑进程内 stdio JSON-RPC（下方 GUI whenReady 由
// hasSingleInstanceLock=false 自动跳过）。
const isMcpStdio = process.env.NOMI_MCP_STDIO === "1";
const allowE2eMultiInstance = process.env.NOMI_E2E_ALLOW_MULTI_INSTANCE === "1";
const hasSingleInstanceLock = isMcpStdio ? false : allowE2eMultiInstance ? true : app.requestSingleInstanceLock();
if (!isMcpStdio && !allowE2eMultiInstance) {
  if (!hasSingleInstanceLock) {
    app.quit();
  } else {
    app.on("second-instance", () => {
      const [existing] = BrowserWindow.getAllWindows();
      if (existing) {
        if (existing.isMinimized()) existing.restore();
        existing.focus();
      }
    });
  }
}
if (isMcpStdio) {
  void app
    .whenReady()
    .then(async () => {
      const { startMcpStdioServer } = await import("./capabilityCore/mcpStdioServer");
      await startMcpStdioServer();
    })
    .catch((error) => {
      process.stderr.write(`[nomi:mcp-stdio] 启动失败: ${error instanceof Error ? error.message : String(error)}\n`);
      app.exit(1);
    });
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "nomi-local",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL || process.env.NOMI_DESKTOP_DEV);
const devRemoteDebuggingPort = process.env.NOMI_DESKTOP_REMOTE_DEBUGGING_PORT;
const DEV_RENDERER_LOAD_ATTEMPTS = 20;
const DEV_RENDERER_LOAD_RETRY_MS = 500;
let mainWindowRef: BrowserWindow | null = null;
let isRecreatingMainWindow = false;
const lowMemoryMode = process.env.NOMI_LOW_MEMORY_MODE === "1";
const capabilityCoreDisabled =
  process.env.NOMI_DISABLE_CAPABILITY_CORE === "1" || (lowMemoryMode && process.env.NOMI_KEEP_CAPABILITY_CORE !== "1");
let runtimeModulePromise: Promise<typeof import("./runtime")> | null = null;
let capabilityCoreModule: typeof import("./capabilityCore/appIntegration") | null = null;
let capabilityCoreModulePromise: Promise<typeof import("./capabilityCore/appIntegration")> | null = null;
let activeCapabilityProjectId = "";
let capabilityPortCache: number | null = null;

function loadRuntimeModule(): Promise<typeof import("./runtime")> {
  runtimeModulePromise ??= import("./runtime");
  return runtimeModulePromise;
}

async function loadCapabilityCoreModule(): Promise<typeof import("./capabilityCore/appIntegration")> {
  if (capabilityCoreModule) return capabilityCoreModule;
  capabilityCoreModulePromise ??= import("./capabilityCore/appIntegration").then((module) => {
    capabilityCoreModule = module;
    return module;
  });
  return capabilityCoreModulePromise;
}

function setActiveCapabilityProject(projectId: string): void {
  activeCapabilityProjectId = String(projectId || "").trim();
  if (capabilityCoreModule) capabilityCoreModule.setOpenProjectId(activeCapabilityProjectId);
}

function getActiveCapabilityPort(): number | null {
  return capabilityPortCache;
}

async function startDesktopCapabilityCore(): Promise<void> {
  const core = await loadCapabilityCoreModule();
  core.setOpenProjectId(activeCapabilityProjectId);
  await core.startCapabilityCore(
    async (payload) => {
      const { runTask } = await loadRuntimeModule();
      return runTask(payload);
    },
    async (payload) => {
      const { fetchTaskResult } = await loadRuntimeModule();
      return fetchTaskResult(payload);
    },
  );
  capabilityPortCache = core.getCapabilityPort();
}

function stopDesktopCapabilityCore(): void {
  capabilityCoreModule?.stopCapabilityCore();
  capabilityPortCache = null;
}

if (devRemoteDebuggingPort) {
  app.commandLine.appendSwitch("remote-debugging-port", devRemoteDebuggingPort);
}
if (
  (lowMemoryMode && process.env.NOMI_KEEP_HARDWARE_ACCELERATION !== "1") ||
  process.env.NOMI_DISABLE_HARDWARE_ACCELERATION === "1"
) {
  app.disableHardwareAcceleration();
}
if (lowMemoryMode) {
  app.commandLine.appendSwitch("disable-features", "AudioServiceOutOfProcess");
}
if ((lowMemoryMode && process.env.NOMI_KEEP_GPU_PROCESS !== "1") || process.env.NOMI_IN_PROCESS_GPU === "1") {
  app.commandLine.appendSwitch("in-process-gpu");
}
// Opt-in low-memory mode for constrained machines. V8 --jitless removes the
// large executable-code reservation that dominates the studio renderer on
// Windows, but it also disables WebAssembly-backed features such as local
// background removal. Keep the default on the full-capability path.
if (lowMemoryMode || process.env.NOMI_DISABLE_V8_JIT === "1") {
  app.commandLine.appendSwitch("js-flags", "--jitless");
} else if (process.env.NOMI_V8_FLAGS) {
  app.commandLine.appendSwitch("js-flags", process.env.NOMI_V8_FLAGS);
}

function registerDevDiagnostics(mainWindow: BrowserWindow, rendererUrl: string): void {
  if (!isDev) return;

  console.log(`[nomi:desktop] loading renderer: ${rendererUrl}`);
  if (configuredUserDataDir) {
    console.log(`[nomi:desktop] userData dir: ${configuredUserDataDir}`);
  }

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[nomi:desktop] renderer load failed (${errorCode}): ${errorDescription} ${validatedURL}`);
  });
  mainWindow.webContents.on("did-finish-load", () => {
    console.log("[nomi:desktop] renderer did finish load");
  });
  mainWindow.webContents.on("dom-ready", () => {
    console.log("[nomi:desktop] renderer dom ready");
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[nomi:desktop] renderer process gone:", details);
  });
  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error(`[nomi:desktop] preload failed: ${preloadPath}`, error);
  });
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    const method = level >= 2 ? console.error : console.log;
    method(`[nomi:renderer:${level}] ${message} (${sourceId}:${line})`);
  });
}

function getRendererUrl(): string {
  const explicit = process.env.VITE_DEV_SERVER_URL || process.env.NOMI_RENDERER_URL;
  if (explicit) return explicit;
  if (isDev) return "http://127.0.0.1:5273";
  return pathToFileURL(path.join(__dirname, "../dist/index.html")).toString();
}

function getRendererUrlWithRoute(currentUrl?: string): string {
  const rendererUrl = getRendererUrl();
  if (!currentUrl) return rendererUrl;
  try {
    const current = new URL(currentUrl);
    const routeHash = current.hash && current.hash.startsWith("#/") ? current.hash : "";
    const explicitProjectId = current.searchParams.get("projectId")?.trim() || "";
    const next = new URL(rendererUrl);
    if (routeHash) {
      next.hash = routeHash;
    } else if (explicitProjectId) {
      next.hash = `/studio?projectId=${encodeURIComponent(explicitProjectId)}`;
    }
    return next.toString();
  } catch {
    return rendererUrl;
  }
}

function isRendererEntryUrl(url: string, rendererUrl: string): boolean {
  try {
    const actual = new URL(url);
    const expected = new URL(rendererUrl);
    if (actual.protocol !== expected.protocol) return false;
    if (actual.protocol === "file:") return actual.pathname === expected.pathname;
    return actual.origin === expected.origin && actual.pathname === expected.pathname;
  } catch {
    return url === rendererUrl;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadRendererWithRetry(mainWindow: BrowserWindow, rendererUrl: string): Promise<void> {
  const attempts = isDev ? DEV_RENDERER_LOAD_ATTEMPTS : 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await mainWindow.loadURL(rendererUrl);
      return;
    } catch (error) {
      lastError = error;
      if (!isDev || mainWindow.isDestroyed() || attempt === attempts) break;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[nomi:desktop] renderer load attempt ${attempt}/${attempts} failed: ${message}`);
      await wait(DEV_RENDERER_LOAD_RETRY_MS);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function createWindow(
  options: { bounds?: Rectangle; maximize?: boolean; rendererUrl?: string } = {},
): Promise<BrowserWindow> {
  const mainWindow = new BrowserWindow({
    width: options.bounds?.width ?? 1440,
    height: options.bounds?.height ?? 960,
    ...(options.bounds ? { x: options.bounds.x, y: options.bounds.y } : {}),
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#f6f3ee",
    title: "Nomi",
    // Windows：去原生标题栏，改用渲染层自绘 windowbar（WindowControls）。
    // macOS/Linux：保留原生窗口 chrome（红绿灯/拖拽/缩放全交系统，零回归）。
    frame: process.platform !== "win32",
    icon: path.join(__dirname, "../build/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindowRef = mainWindow;
  installWindowCloseConfirmation(mainWindow);
  mainWindow.on("closed", () => {
    if (mainWindowRef === mainWindow) mainWindowRef = null;
  });

  // Windows 自绘标题栏需要知道最大化态来切「最大化/还原」图标。窗口级监听随窗口销毁回收（无泄漏）。
  mainWindow.on("maximize", () => mainWindow.webContents.send("nomi:window:maximized", true));
  mainWindow.on("unmaximize", () => mainWindow.webContents.send("nomi:window:maximized", false));

  // External http(s) links (e.g. the "get your API key" link → provider console)
  // open in the user's real browser, never as a new in-app Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  const rendererUrl = options.rendererUrl || getRendererUrl();

  // 纵深防御：setWindowOpenHandler 只拦新窗口，拦不住顶层框架自身被诱导导航
  // （window.location = 'http://evil'）。一旦发生，整个 app 会变成加载远端页面的浏览器。
  // 这里把任何「离开本地渲染入口」的顶层导航一律拦下；外链改走系统浏览器。
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isRendererEntryUrl(url, rendererUrl)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });

  // 能力核 A 模式实时桥：登记当前窗口 webContents，让主进程把外部 MCP 的画布改动/付费确认
  // 转发进运行中的渲染层（所见即所得）。窗口销毁即清除，避免向死窗口发送。
  setRendererTarget(mainWindow.webContents);
  mainWindow.webContents.on("destroyed", () => {
    if (!mainWindowRef || mainWindowRef === mainWindow || mainWindowRef.webContents === mainWindow.webContents) {
      setRendererTarget(null);
    }
  });

  registerDevDiagnostics(mainWindow, rendererUrl);
  if (isDev) {
    try {
      await mainWindow.webContents.session.clearCache();
    } catch (error) {
      console.warn("[nomi:desktop] failed to clear dev session cache:", error);
    }
  }
  await loadRendererWithRetry(mainWindow, rendererUrl);

  if (options.maximize) mainWindow.maximize();

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
  return mainWindow;
}

function recreateMainWindowFromSender(sender: WebContents, options: { preserveRoute: boolean; reason: string }): void {
  if (isRecreatingMainWindow) return;
  const oldWindow = BrowserWindow.fromWebContents(sender);
  const bounds = oldWindow && !oldWindow.isDestroyed() ? oldWindow.getBounds() : undefined;
  const maximize = oldWindow && !oldWindow.isDestroyed() ? oldWindow.isMaximized() : false;
  const rendererUrl = options.preserveRoute
    ? getRendererUrlWithRoute(oldWindow && !oldWindow.isDestroyed() ? oldWindow.webContents.getURL() : undefined)
    : getRendererUrl();
  isRecreatingMainWindow = true;
  if (oldWindow && !oldWindow.isDestroyed()) oldWindow.destroy();
  void Promise.all([
    session.defaultSession.clearCache().catch(() => undefined),
    session.defaultSession.clearCodeCaches({}).catch(() => undefined),
  ])
    .then(() => createWindow({ bounds, maximize, rendererUrl }))
    .then((nextWindow) => nextWindow.focus())
    .catch((error) => {
      console.error(`[nomi:desktop] failed to recreate window for ${options.reason}:`, error);
    })
    .finally(() => {
      isRecreatingMainWindow = false;
    });
}

function registerSyncIpc<TArgs extends unknown[], TResult>(
  channel: string,
  handler: (...args: TArgs) => TResult,
): void {
  ipcMain.on(channel, (event, ...args: TArgs) => {
    try {
      event.returnValue = { ok: true, value: handler(...args) };
    } catch (error) {
      event.returnValue = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

// S4-2:VendorRequestError 的 structured 经 base64 标记穿 IPC(rejection 只剩 message 字符串);
// 顺带补「创建即失败」的 vendor.call.completed(failed) 事件(成功/轮询终态在 runtime 内记)。
async function runTaskIpcGuard<T>(payload: unknown, thunk: () => Promise<T>): Promise<T> {
  try {
    return await thunk();
  } catch (error) {
    const { VendorRequestError, encodeVendorErrorMessage } = await import("./vendor/vendorHttp");
    if (error instanceof VendorRequestError) {
      const { traceVendorCompleted } = await import("./events/vendorCallTrace");
      const extras = (payload as { request?: { extras?: Record<string, unknown> } })?.request?.extras || {};
      traceVendorCompleted(String(extras.projectId || ""), {
        runId: `failed-${Math.random().toString(36).slice(2, 10)}`,
        ...(extras.nodeId ? { nodeId: String(extras.nodeId) } : {}),
        status: "failed",
        assetCount: 0,
        error: error.structured,
      });
      throw new Error(encodeVendorErrorMessage(error));
    }
    throw error;
  }
}

function registerIpc(): void {
  const selectedWorkspaceRoots = new Set<string>();
  // 渲染层崩溃（RootErrorBoundary）也落到同一崩溃日志（P0-8）。
  ipcMain.on("nomi:log:renderer-crash", (_event, message: unknown) => logCrash("renderer", String(message)));
  // 窗口控制（Windows 自绘标题栏）：只注册一次，作用于发起请求的那个窗口（fromWebContents），
  // 而非闭包捕获某个窗口实例——后者会在第二次 createWindow（重开库/activate）时重复注册 handle 抛错、崩窗。
  ipcMain.handle("nomi:window:minimize", (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.handle("nomi:window:maximize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle("nomi:window:close", (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  registerSyncIpc("nomi:projects:list", listProjects);
  ipcMain.handle("nomi:projects:list-async", () => listProjects());
  registerSyncIpc("nomi:projects:create", (record: unknown) => {
    if (record && typeof record === "object" && typeof (record as { rootPath?: unknown }).rootPath === "string") {
      throw new Error("Use nomi:workspace:open-folder to create or open folder-backed projects");
    }
    return createProject(record);
  });
  registerSyncIpc("nomi:projects:read", readProject);
  ipcMain.handle("nomi:projects:read-async", (_event, projectId: unknown) => readProject(String(projectId || "")));
  registerSyncIpc("nomi:projects:save", saveProject);
  ipcMain.handle("nomi:projects:save-async", (_event, projectId: unknown, record: unknown) =>
    saveProject(String(projectId || ""), record),
  );
  registerSyncIpc("nomi:projects:delete", deleteProject);
  ipcMain.on("nomi:app:reopen-library-window", (event) => {
    recreateMainWindowFromSender(event.sender, { preserveRoute: false, reason: "reopen library window" });
  });
  ipcMain.on("nomi:app:hard-reload-window", (event) => {
    recreateMainWindowFromSender(event.sender, { preserveRoute: true, reason: "hard reload window" });
  });
  registerSyncIpc("nomi:model-catalog:vendors:list", listModelCatalogVendors);
  registerSyncIpc("nomi:model-catalog:models:list", listModelCatalogModels);
  registerSyncIpc("nomi:model-catalog:mappings:list", listModelCatalogMappings);
  registerSyncIpc("nomi:model-catalog:health", getModelCatalogHealth);
  registerSyncIpc("nomi:model-catalog:vendor:upsert", upsertModelCatalogVendor);
  registerSyncIpc("nomi:model-catalog:vendor:delete", deleteModelCatalogVendor);
  registerSyncIpc("nomi:model-catalog:vendor-api-key:upsert", upsertModelCatalogVendorApiKey);
  registerSyncIpc("nomi:model-catalog:vendor-api-key:clear", clearModelCatalogVendorApiKey);
  registerSyncIpc("nomi:model-catalog:model:upsert", upsertModelCatalogModel);
  registerSyncIpc("nomi:model-catalog:model:delete", deleteModelCatalogModel);
  registerSyncIpc("nomi:model-catalog:mapping:upsert", upsertModelCatalogMapping);
  registerSyncIpc("nomi:model-catalog:mapping:delete", deleteModelCatalogMapping);
  registerSyncIpc("nomi:model-catalog:export", exportModelCatalogPackage);
  registerSyncIpc("nomi:model-catalog:import", importModelCatalogPackage);
  // 本地 ComfyUI 健康探测（接入卡启用/重检调用；async，直连 localhost /system_stats）。
  ipcMain.handle("nomi:model-catalog:comfyui:probe", (_event, baseUrl: unknown) => {
    const { probeComfyuiSystemStats } = require("./comfyuiProbe") as typeof import("./comfyuiProbe");
    return probeComfyuiSystemStats(String(baseUrl || ""));
  });

  // Skill / Playbook 域（业务函数在 electron/skills/*，这里只接同步 IPC 管道）。
  registerSyncIpc("nomi:skill:list", () => {
    const { listSkillsForRenderer } = require("./skills/skillIpc") as typeof import("./skills/skillIpc");
    return listSkillsForRenderer();
  });
  registerSyncIpc("nomi:skill:export", (dirName: unknown) => {
    const { exportSkillPackageByName } = require("./skills/skillPackage") as typeof import("./skills/skillPackage");
    return exportSkillPackageByName(String(dirName || ""), Date.now());
  });
  registerSyncIpc("nomi:skill:import", (payload: unknown) => {
    const { importSkillPackageToUserDir } = require("./skills/skillPackage") as typeof import("./skills/skillPackage");
    return importSkillPackageToUserDir(payload);
  });
  registerSyncIpc("nomi:skill:delete", (dirName: unknown) => {
    const { deleteUserSkill } = require("./skills/skillPackage") as typeof import("./skills/skillPackage");
    return deleteUserSkill(String(dirName || ""));
  });

  ipcMain.handle("nomi:model-catalog:docs:fetch", async (_event, payload) => {
    const { fetchModelCatalogDocs } = await import("./catalog/catalogCommit");
    return fetchModelCatalogDocs(payload);
  });
  // 即梦会员（dreamina CLI）：设备码登录/账户检测/安装（异步，spawn 本地 CLI）。
  ipcMain.handle("nomi:dreamina:status", async () => {
    const { dreaminaStatus } = await import("./catalog/dreaminaLoginIpc");
    return dreaminaStatus();
  });
  ipcMain.handle("nomi:dreamina:login-start", async () => {
    const { dreaminaLoginStart } = await import("./catalog/dreaminaLoginIpc");
    return dreaminaLoginStart();
  });
  ipcMain.handle("nomi:dreamina:login-poll", async (_event, deviceCode: unknown) => {
    const { dreaminaLoginPoll } = await import("./catalog/dreaminaLoginIpc");
    return dreaminaLoginPoll(String(deviceCode || ""));
  });
  ipcMain.handle("nomi:dreamina:logout", async () => {
    const { dreaminaLogout } = await import("./catalog/dreaminaLoginIpc");
    return dreaminaLogout();
  });
  ipcMain.handle("nomi:dreamina:install", async () => {
    const { dreaminaInstall } = await import("./catalog/dreaminaLoginIpc");
    return dreaminaInstall();
  });
  ipcMain.handle("nomi:workspace:select-folder", async () => {
    const selection = await selectWorkspaceFolder({ showOpenDialog: (options) => dialog.showOpenDialog(options) });
    if (!selection.canceled) selectedWorkspaceRoots.add(selection.rootPath);
    return selection;
  });
  ipcMain.handle("nomi:workspace:open-folder", (_event, payload) =>
    openWorkspaceFolder(payload, {
      createProject,
      selectedRootPaths: selectedWorkspaceRoots,
      confirmInitialize: async (rootPath) => {
        const result = await dialog.showMessageBox({
          type: "question",
          buttons: ["取消", "初始化"],
          defaultId: 1,
          cancelId: 0,
          message: "初始化 Nomi 项目文件夹？",
          detail: `Nomi 会在此文件夹创建 .nomi/，并把生成的图片、视频保存到 assets/ 和 exports/.\n\n${rootPath}`,
        });
        return result.response === 1;
      },
    }),
  );
  ipcMain.handle("nomi:workspace:list-files", (_event, payload) => {
    const projectId = String((payload as { projectId?: unknown } | null)?.projectId || "").trim();
    if (!projectId) throw new Error("projectId is required");
    const project = readProject(projectId) as { lastKnownRootPath?: unknown } | null;
    const rootPath = typeof project?.lastKnownRootPath === "string" ? project.lastKnownRootPath : "";
    if (!rootPath) throw new Error("Project folder is unavailable");
    return listWorkspaceFiles({
      rootPath,
      maxFiles:
        typeof (payload as { limit?: unknown } | null)?.limit === "number"
          ? (payload as { limit: number }).limit
          : undefined,
    });
  });
  ipcMain.handle("nomi:workspace:reveal-file", (_event, payload) => {
    const projectId = String((payload as { projectId?: unknown } | null)?.projectId || "").trim();
    const relativePath = String((payload as { relativePath?: unknown } | null)?.relativePath || "").trim();
    if (!projectId) throw new Error("projectId is required");
    const project = readProject(projectId) as { lastKnownRootPath?: unknown } | null;
    const rootPath = typeof project?.lastKnownRootPath === "string" ? path.resolve(project.lastKnownRootPath) : "";
    if (!rootPath) throw new Error("Project folder is unavailable");
    const absolutePath = resolveWorkspaceFilePath(rootPath, relativePath);
    shell.showItemInFolder(absolutePath);
    return { ok: true };
  });
  registerWorkspaceFileDeleteIpc({ readProject });
  ipcMain.handle("nomi:workspace:reveal-project-folder", (_event, payload) => {
    const projectId = String((payload as { projectId?: unknown } | null)?.projectId || "").trim();
    if (!projectId) throw new Error("projectId is required");
    const project = readProject(projectId) as { lastKnownRootPath?: unknown } | null;
    const rootPath = typeof project?.lastKnownRootPath === "string" ? path.resolve(project.lastKnownRootPath) : "";
    if (!rootPath) throw new Error("Project folder is unavailable");
    void shell.openPath(rootPath);
    return { ok: true };
  });
  ipcMain.handle("nomi:model-catalog:mapping:test", async (_event, id, payload) => {
    const { testModelCatalogMapping } = await import("./catalog/catalogCommit");
    return testModelCatalogMapping(id, payload);
  });
  ipcMain.handle("nomi:assets:import-remote-url", async (_event, payload) => {
    const { importRemoteAsset } = await loadRuntimeModule();
    return importRemoteAsset(payload);
  });
  ipcMain.handle("nomi:assets:import-file", async (_event, payload) => {
    const { importLocalFile } = await import("./assets/localFileImport");
    return importLocalFile(payload);
  });
  ipcMain.handle("nomi:assets:list", async (_event, payload) => {
    const { listProjectAssets } = await loadRuntimeModule();
    return listProjectAssets(payload);
  });
  ipcMain.handle("nomi:assets:download", async (_event, payload) => {
    const { downloadAssetToDisk } = await import("./assets/downloadAsset");
    return downloadAssetToDisk(payload);
  });
  ipcMain.handle("nomi:video:extract-frame", async (_event, payload) => {
    const { extractVideoFrameToAsset } = await import("./video/extractVideoFrame");
    return extractVideoFrameToAsset(payload);
  });
  ipcMain.handle("nomi:image:decompose-layers", async (_event, payload) => {
    const { decomposeLayers } = await import("./image/decomposeLayers");
    return decomposeLayers(payload);
  });
  ipcMain.handle("nomi:scene3d:frames-to-video", async (_event, payload) => {
    const { framesToVideoAsset } = await import("./video/framesToVideo");
    return framesToVideoAsset(payload);
  });
  registerExportJobIpc();
  // 付费守卫铸令牌：仅由渲染层「真人确认」事件链调用（务实纵深：铸造面小而审计过 + 主进程硬闸兜底）。
  ipcMain.handle("nomi:tasks:grant-spend", (_event, payload) => {
    const raw = (payload || {}) as { nodeIds?: unknown; maxAttemptsPerNode?: unknown };
    const nodeIds = Array.isArray(raw.nodeIds) ? raw.nodeIds.map((id) => String(id)) : [];
    const maxAttemptsPerNode = typeof raw.maxAttemptsPerNode === "number" ? raw.maxAttemptsPerNode : undefined;
    return { grantId: mintSpendGrant({ nodeIds, ...(maxAttemptsPerNode ? { maxAttemptsPerNode } : {}) }) };
  });
  // 提交幂等包在 IPC 边界：渲染层每次提交（含控制器重试）都经此，同 idempotencyKey 的提交内核 at-most-once
  // （堵「提交瞬间丢回执 → 重试 → 二次下单」；query 类 nomi:tasks:result 不包，查结果本就免费）。
  ipcMain.handle("nomi:tasks:run", (_event, payload) =>
    runTaskIpcGuard(payload, async () => {
      const { runTask } = await loadRuntimeModule();
      return runTaskWithIdempotency(payload, () => runTask(payload));
    }),
  );
  ipcMain.handle("nomi:tasks:result", (_event, payload) =>
    runTaskIpcGuard(payload, async () => {
      const { fetchTaskResult } = await loadRuntimeModule();
      return fetchTaskResult(payload);
    }),
  );
  // 能力核 A/B 守卫：renderer 在打开/切换/关闭项目时上报当前打开的 projectId，
  // 让外部调用拒绝直写「正在窗口里编辑」的工程（防内存 store 回盘覆盖，见 capabilityCore/rpcServer）。
  ipcMain.on("nomi:capability:active-project", (_event, projectId: unknown) =>
    setActiveCapabilityProject(String(projectId || "")),
  );
  // 「接入 AI 编程助手」卡：读接入状态/配置片段 + 一键写入/撤销 ~/.claude.json 的 mcpServers.nomi。
  registerSyncIpc("nomi:capability:mcp-info", () => readMcpInfo(getActiveCapabilityPort()));
  registerSyncIpc("nomi:capability:mcp-install", installMcp);
  registerSyncIpc("nomi:capability:mcp-uninstall", uninstallMcp);
  registerAgentChatV2Ipc();
  registerTextStreamIpc();
  registerConversationsIpc();
  registerEventsIpc();
  registerMemoryIpc();
  registerPromptLibraryIpc();
  registerBrowserPromptExtractionSettingsIpc();
  registerBrowserViewIpc(getRendererUrl);
  registerOnboardingIpc();
  registerUpdaterIpc();
  registerReferenceCaptureIpc({ getRendererUrl, preloadPath: path.join(__dirname, "preload.js") });
  // S4-1 评测安全铁律:事件落盘前,已配置的 vendor key 精确匹配脱敏(形态兜底之外的地基)。
  setEventLogSecretsProvider(catalogSecretsProvider);
}

// 纵深防御：渲染层此前在「无 CSP」环境运行，contextIsolation 是唯一防线。
// 注入严格 CSP，让任何被注入的脚本/远端内容无法自由 eval、连外站、加外部资源。
// dev/prod 分治：dev 下 vite HMR 需要 unsafe-eval + inline + ws 回连，故放宽；
// prod（打包后从 file:// 加载）收紧——脚本只许 'self'，外联仅图片/媒体/连接到 https。
function buildContentSecurityPolicy(): string {
  const common = [
    "default-src 'self' nomi-local:",
    "img-src 'self' nomi-local: https: data: blob:",
    "media-src 'self' nomi-local: https: data: blob:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
  ];
  if (isDev) {
    // vite dev server：HMR 走 ws、sourcemap/模块求值需要 eval、注入 inline 脚本与样式。
    // blob:：3D 编辑器（Three.js GLTF/meshopt 解码）的 worker 经 blob 脚本 importScripts。
    return [
      ...common,
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: http://127.0.0.1:5273",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' nomi-local: https: ws://127.0.0.1:5273 http://127.0.0.1:5273 blob:",
    ].join("; ");
  }
  return [
    ...common,
    // prod：vite 产物为外链脚本，无需 inline/eval。但 3D 编辑器要 'wasm-unsafe-eval'（Three.js
    // GLTF/meshopt 解码器实例化 WASM）+ blob:（解码 worker 经 blob 脚本 importScripts）。
    // 'wasm-unsafe-eval' 只放行 WASM 编译，不开放危险的 JS eval（比 'unsafe-eval' 收得紧）。
    "script-src 'self' 'wasm-unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' nomi-local: https: blob:",
  ].join("; ");
}

// COOP/COEP 开 cross-origin isolation（ONNX 的 SharedArrayBuffer 需要），但有两类桌面场景必须跳过：
// 1) Playwright/E2E：CDP target 握手会卡死（_electron.launch / connectOverCDP 都连不上）。
// 2) Windows frame:false 自绘标题栏：Electron 31/Chromium 在 COOP/COEP 下会把
//    -webkit-app-region: drag 命中测试全部返回 HTCLIENT，导致真实窗口无法拖动。
// 注：只关 isolation，CSP 仍照常注入（安全基线不降）。相关 WASM/ONNX 能力在这些场景退到非 SAB 路径。
const SKIP_CROSS_ORIGIN_ISOLATION = process.env.NOMI_E2E === "1";
const SKIP_CROSS_ORIGIN_ISOLATION_FOR_WINDOWS_FRAMELESS = process.platform === "win32";

function installContentSecurityPolicy(targetSession: Electron.Session): void {
  const csp = buildContentSecurityPolicy();
  const crossOriginIsolationDisabled =
    lowMemoryMode ||
    SKIP_CROSS_ORIGIN_ISOLATION ||
    SKIP_CROSS_ORIGIN_ISOLATION_FOR_WINDOWS_FRAMELESS ||
    process.env.NOMI_DISABLE_CROSS_ORIGIN_ISOLATION === "1";
  targetSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders: Record<string, string[]> = {
      ...details.responseHeaders,
      "Content-Security-Policy": [csp],
    };
    if (!crossOriginIsolationDisabled) {
      // ONNX Runtime Web 需要 SharedArrayBuffer 才能多线程推理；SharedArrayBuffer 要求 renderer 跨源隔离。
      responseHeaders["Cross-Origin-Opener-Policy"] = ["same-origin"];
      responseHeaders["Cross-Origin-Embedder-Policy"] = ["require-corp"];
    }
    callback({
      responseHeaders,
    });
  });
}

// 非主实例（没拿到单实例锁）不启动 UI / RPC——已让出给老实例（second-instance 已聚焦它）。
// 单实例锁本身在文件顶部定义（main 与本批独立都加了同一锁，合并去重，根治全局 index 并发覆盖）。
if (hasSingleInstanceLock)
  app
    .whenReady()
    .then(async () => {
      registerLocalProtocol();
      installContentSecurityPolicy(session.defaultSession);
      // 写入内置模型种子（Seedance 等主流模型档案）；幂等、存在即跳过，不覆盖用户已有记录。
      // sync 且渲染层一进库就读 catalog → 须在 createWindow 前完成。
      try {
        ensureBuiltinModelSeeds();
      } catch (error) {
        console.error("[nomi:desktop] ensureBuiltinModelSeeds failed:", error);
      }
      registerIpc();
      // E(冷启动 P0)：代理探测与能力核都不是窗口首帧的依赖，挡在窗口前是纯浪费。
      //  · applySystemProxy：窗口创建后延迟后台探测；低内存模式更晚加载，避免列表页常驻代理栈。
      //  · startCapabilityCore(外部 MCP 的本地 RPC 广告)：fail-open，本就不影响 app；低内存模式默认跳过。
      if (!capabilityCoreDisabled) {
        void startDesktopCapabilityCore().catch((error) => {
          console.error("[nomi:desktop] startCapabilityCore failed:", error);
        });
      }
      await createWindow();
      setTimeout(
        () => {
          void import("./systemProxy")
            .then(({ applySystemProxy }) => applySystemProxy(session.defaultSession))
            .catch((error) => {
              console.error("[nomi:desktop] applySystemProxy failed:", error);
            });
        },
        lowMemoryMode ? 15000 : 3000,
      );

      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          void createWindow().catch((error) => {
            console.error("[nomi:desktop] failed to recreate window:", error);
          });
        }
      });
    })
    .catch((error) => {
      console.error("[nomi:desktop] failed to start:", error);
      app.quit();
    });

app.on("window-all-closed", () => {
  if (isRecreatingMainWindow) return;
  if (process.platform !== "darwin") app.quit();
});

// 退出时中止所有在跑导出，否则 ffmpeg 子进程会变孤儿（继续占 CPU/写文件，直到自己跑完）。
// abort → ffmpegRunner 监听 abort 后 kill 子进程。同步、不抛，绝不拖住退出。
app.on("before-quit", () => {
  // 能力核退出清理：清实例广告 + 关 RPC，让外部探测立刻知道「app 已关」。同步、不抛。
  stopDesktopCapabilityCore();
  try {
    const { abortAllActiveExports } = require("./export/exportJobs") as typeof import("./export/exportJobs");
    const aborted = abortAllActiveExports();
    if (aborted > 0) console.log(`[nomi:desktop] aborted ${aborted} in-flight export(s) on quit`);
  } catch (error) {
    console.error("[nomi:desktop] failed to abort exports on quit:", error);
  }
});
