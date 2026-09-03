import { app, BrowserWindow, dialog, ipcMain, protocol, session, shell } from "electron";
import type { Rectangle, WebContents } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createProject, deleteProject, diagnoseProject, listProjects, readProject, recoverProject, saveProject } from "./projects/repository";
import { registerProjectsIpc } from "./projects/projectsIpc";
import { registerAssetsIpc } from "./assets/assetsIpc";
import {
  clearModelCatalogVendorApiKey,
  deleteModelCatalogMapping,
  deleteModelCatalogModel,
  deleteModelCatalogModels,
  deleteModelCatalogVendor,
  ensureBuiltinModelSeeds,
  exportModelCatalogPackage,
  getModelCatalogHealth,
  listModelCatalogMappings,
  listModelCatalogModels,
  listModelCatalogVendors,
} from "./catalog/catalogStore";
import { importRendererCatalogPackage, upsertRendererCatalogMapping, upsertRendererCatalogModel, upsertRendererCatalogVendor, upsertRendererCatalogVendorApiKey } from "./catalog/rendererCatalogMutation";
import { registerAssetTransportIpc } from "./assetTransportIpc";
import { retypeModelCatalogModel } from "./catalog/modelRetype";
import { registerTaskIpcHandlers } from "./tasks/taskIpcHandlers";
import { registerNotificationIpc } from "./notificationIpc";
import { openWorkspaceFolder, selectWorkspaceFolder } from "./workspace/workspaceIpc";
import { listWorkspaceFiles, resolveWorkspaceFilePath } from "./workspace/workspaceFileIndex";
import { registerWorkspaceFileDeleteIpc } from "./workspace/workspaceFileDelete";
import { logCrash } from "./crashLog";
import { installMainProcessLifecycle } from "./mainProcessLifecycle";
import { registerExportJobIpc } from "./export/exportJobIpc";
import { registerTextStreamIpc } from "./ai/textStreamIpc";
import { setEventLogSecretsProvider } from "./events/eventLogRepository";
import { registerEventsIpc } from "./events/eventsIpc";
import { registerMemoryIpc } from "./memory/memoryIpc";
import { registerPromptLibraryIpc } from "./promptLibrary/promptLibraryIpc";
import { registerBrowserViewIpc } from "./browser/core/browserViews";
import { registerBrowserPromptExtractionSettingsIpc } from "./browser/settings/browserPromptExtractionSettings";
import { applyProxyAtBoot, registerProxyIpc } from "./proxyIpc";
import { catalogSecretsProvider } from "./events/secretsProvider";
import { registerOnboardingIpc } from "./ai/onboarding/onboardingIpc";
import { registerProviderAdapterIpc } from "./providerAdapter/ipc";
import { registerExistingConnectionIpc } from "./providerAdapter/existingConnectionIpc";
import { registerUpdaterIpc } from "./update/autoUpdater";
import { setRendererTarget } from "./capabilityCore/rendererBridge";
import { readMcpInfo, installMcp, uninstallMcp } from "./capabilityCore/mcpConfig";
import { verifyMcp } from "./capabilityCore/mcpVerify";
import { registerCustomMcpProfileIpc, watchMcpProfiles } from "./capabilityCore/mcpProfiles";
import { registerLocalProtocol } from "./protocol/localProtocol";
import { installMainWindowInteractions } from "./mainWindowInteractions";
import { getMainWindow, setMainWindow } from "./mainWindowRegistry";
import { createMainWindowGuard } from "./mainWindowPresence";
import { assertTrustedSender } from "./ipcSenderGuard";
import { registerScreenshotIpc } from "./screenshot/screenshotIpc";
import { registerVideoIpc } from "./video/videoIpc";
import { registerTikhubConnectorIpc } from "./connectors/tikhubConnectorIpc";
import { desktopT, registerI18nIpc, setDesktopLocale } from "./i18n";
import { registerSettingsIpc } from "./settings/registerSettingsIpc";
import { registerIntegrationHandoffIpc } from "./integrationCertification/handoffQueue";
import { registerIntegrationSessionIpc } from "./integrationCertification/integrationSessionIpc";
import { registerProductionRunIpc } from "./productionRun/productionRunIpc";
import { registerProductionActionIpc } from "./productionRun/productionActionIpc";
import { installProductionRunDesktopLifecycle } from "./productionRun/productionRunDesktopLifecycle";
import { canvasReadSurfaceRuntime } from "./capabilityCore/canvasReadSurfaceRuntime";
import { registerDesktopCanvasReadRuntime, type CanvasReadExecutionRuntime } from "./capabilityCore/canvasReadMainRuntime";
import { createPiCanvasReadIpcCapture, createPiCanvasReadTransportAdapter } from "./capabilityCore/canvasReadTransportAdapters";
import { createPiDocumentReadTransportAdapter } from "./capabilityCore/documentReadTransportAdapters";
import { createPiDocumentWriteTransportAdapter } from "./capabilityCore/documentWriteTransportAdapters";
import { createPiCanvasWriteTransportAdapter } from "./capabilityCore/canvasWriteTransportAdapters";
import {
  createPiTimelineReadTransportAdapter,
  createPiTimelineWriteTransportAdapter,
} from "./capabilityCore/timelineTransportAdapters";
import { createPiPhase4SurfaceTransportAdapter } from "./capabilityCore/phase4SurfaceTransportAdapters";
import { createPiSkillWriteTransportAdapter } from "./capabilityCore/skillWriteTransportAdapters";
import { createPiSkillReadTransportAdapter } from "./capabilityCore/skillReadTransportAdapters";
import { createPiProductionRunTransportAdapter } from "./capabilityCore/productionRunTransportAdapters";
import { getProductionRunService } from "./productionRun/productionRunRuntime";
import { getSettingsRoot } from "./runtimePaths";
import { getInstalledProductionProjectAgentHost, installProductionProjectAgentHost } from "./projectAgentHost/projectAgentProductionRuntime";
import { createProjectAgentRepositoryRouter } from "./projectAgentHost/projectAgentRepositoryRouter";
import { registerProjectAgentIpc } from "./projectAgentHost/projectAgentIpc";
import { migrateProjectAgentLegacy } from "./projectAgentHost/projectAgentMigration";
import { createProjectAgentProposalReceiptService } from "./projectAgentHost/projectAgentProposalReceiptStore";
import { resolveProjectAgentAttachmentClaims } from "./assets/projectAssetStore";
import { getWorkspaceRepositoryDeps } from "./runtimePaths";
import { ensureWorkspaceProjectIdentity } from "./workspace/workspaceProjectIdentity";
import { resolveWorkspaceProjectDir } from "./workspace/workspaceRepository";
import { installContentSecurityPolicy } from "./contentSecurityPolicy";
import { registerSkillIpc } from "./skills/skillIpc";
installMainProcessLifecycle(app);
const configuredUserDataDir = String(process.env.NOMI_ELECTRON_USER_DATA_DIR || "").trim();
if (configuredUserDataDir) {
  // dev-electron.mjs 按 renderer 端口隔离 profile，避免复用旧 Vite chunk/code cache。
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
// Dev/test MCP may load dist-electron/main.js directly, so Electron cannot read
// package.json and otherwise identifies as "Electron". Match the GUI identity
// before app ready or safeStorage ciphertext written by Nomi cannot be opened.
if (isMcpStdio && process.env.NOMI_APP_NAME) app.setName(process.env.NOMI_APP_NAME);
const allowE2eMultiInstance = process.env.NOMI_E2E_ALLOW_MULTI_INSTANCE === "1";
const hasSingleInstanceLock = isMcpStdio ? false : allowE2eMultiInstance ? true : app.requestSingleInstanceLock();
const { ensureArtifactPreviewSecret, flushPendingProductionDeepLink } = installProductionRunDesktopLifecycle({ isMcpStdio, allowE2eMultiInstance, hasSingleInstanceLock, ensureMainWindow: () => ensureMainWindow() });
if (isMcpStdio) {
  void app
    .whenReady()
    .then(async () => {
      ensureArtifactPreviewSecret();
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
let isRecreatingMainWindow = false;
const lowMemoryMode = process.env.NOMI_LOW_MEMORY_MODE === "1";
const capabilityCoreDisabled =
  process.env.NOMI_DISABLE_CAPABILITY_CORE === "1" || (lowMemoryMode && process.env.NOMI_KEEP_CAPABILITY_CORE !== "1");
let runtimeModulePromise: Promise<typeof import("./runtime")> | null = null;
let capabilityCoreModule: typeof import("./capabilityCore/appIntegration") | null = null;
let capabilityCoreModulePromise: Promise<typeof import("./capabilityCore/appIntegration")> | null = null;
let capabilityPortCache: number | null = null;
let desktopCanvasReadExecutionRuntime: CanvasReadExecutionRuntime | null = null;

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

function getActiveCapabilityPort(): number | null {
  return capabilityPortCache;
}

async function startDesktopCapabilityCore(): Promise<void> {
  if (!desktopCanvasReadExecutionRuntime) throw new Error("Canvas read execution runtime is unavailable");
  const core = await loadCapabilityCoreModule();
  await core.startCapabilityCore(
    async (payload) => {
      const { runTask } = await loadRuntimeModule();
      return runTask(payload);
    },
    async (payload) => {
      const { fetchTaskResult } = await loadRuntimeModule();
      return fetchTaskResult(payload);
    },
    { canvasReadExecutionRuntime: desktopCanvasReadExecutionRuntime, onGenerationReady: (factory) => getInstalledProductionProjectAgentHost()?.setGenerationAdapterFactory(factory) },
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
  // render-process-gone 不在这里挂：已由 installProcessGoneHandlers 装在 app 上（落盘 + console），
  // 覆盖所有窗口而不只是主窗，且生产环境也留证。
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
  setMainWindow(mainWindow); // 主窗口单一真相（registry）；closed 条件清理防窗口重建竞态误清新窗
  installMainWindowInteractions(mainWindow);
  mainWindow.on("closed", () => {
    if (getMainWindow() === mainWindow) setMainWindow(null);
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
    const main = getMainWindow();
    if (!main || main === mainWindow || main.webContents === mainWindow.webContents) setRendererTarget(null);
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

// 零窗口自愈的唯一入口（issue #62）；activate / second-instance / 窗口重建失败都走它。
const ensureMainWindow = createMainWindowGuard({ createWindow, onWindowReady: () => flushPendingProductionDeepLink() });

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
      void ensureMainWindow(); // 重建失败会永久停在零窗口（window-all-closed 已被重建标记跳过）→ 补建兜底
    });
}

function registerSyncIpc<TArgs extends unknown[], TResult>(
  channel: string,
  handler: (...args: TArgs) => TResult,
): void {
  ipcMain.on(channel, (event, ...args: TArgs) => {
    try {
      assertTrustedSender(event); event.returnValue = { ok: true, value: handler(...args) };
    } catch (error) {
      event.returnValue = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
function registerIpc(): void {
  const selectedWorkspaceRoots = new Set<string>();
  // Static app-main Surface authority: registered before createWindow and
  // independent from the delayed/optional external capability core.
  const canvasReadExecutionRuntime = registerDesktopCanvasReadRuntime();
  desktopCanvasReadExecutionRuntime = canvasReadExecutionRuntime;
  const projectAgentCanvasReadCapture = createPiCanvasReadIpcCapture({
    surfaceCapture: canvasReadExecutionRuntime.surfaceCapture,
    registry: canvasReadSurfaceRuntime.registry,
    capturedSnapshots: canvasReadSurfaceRuntime.capturedSnapshots,
    executor: canvasReadExecutionRuntime.executor,
  });
  // ProjectAgentHost is an app-process owner. It is installed once before the
  // first BrowserWindow and receives the already-registered Surface authority;
  // window recreation only opens/releases subscriptions on this owner.
  installProductionProjectAgentHost({
    createRepository: () => createProjectAgentRepositoryRouter({ rootDir: getSettingsRoot() }),
    subscribeSurface: () => canvasReadSurfaceRuntime.subscribeCommittedProject(() => undefined),
    productionRun: (binding) => createPiProductionRunTransportAdapter({ service: getProductionRunService(), binding }),
    registerIpc: (runtime) => registerProjectAgentIpc({
      runtime,
      surfaceCapture: canvasReadExecutionRuntime.surfaceCapture,
      captureCanvasRead: (event, binding, requestId) => {
        const capturedPort = canvasReadExecutionRuntime.surfaceCapture.captureCommittedCanvasReadPort(event, binding);
        return createPiCanvasReadTransportAdapter({
          registry: canvasReadSurfaceRuntime.registry,
          capturedPort,
          requestId,
          executor: canvasReadExecutionRuntime.executor,
        });
      },
      captureCanvasReadSnapshot: (event, binding, handle, requestId) => projectAgentCanvasReadCapture.capture(
        event,
        { capturedCanvasReadSnapshot: handle, projectId: binding.projectId },
        requestId,
      ),
      captureDocumentRead: (event, binding, requestId) => createPiDocumentReadTransportAdapter({
        registry: canvasReadSurfaceRuntime.registry,
        capturedPort: canvasReadExecutionRuntime.surfaceCapture.captureCommittedCanvasReadPort(event, binding),
        requestId,
        executor: canvasReadExecutionRuntime.executor,
      }),
      captureDocumentWrite: (event, binding, requestId) => createPiDocumentWriteTransportAdapter({
        registry: canvasReadSurfaceRuntime.registry,
        capturedPort: canvasReadExecutionRuntime.surfaceCapture.captureCommittedCanvasReadPort(event, binding),
        requestId,
        executor: canvasReadExecutionRuntime.executor,
      }),
      captureCanvasWrite: (event, binding, requestId) => {
        const capturedPort = canvasReadExecutionRuntime.surfaceCapture.captureCommittedCanvasReadPort(event, binding);
        const surfacePortRuntime = canvasReadExecutionRuntime.surfacePortRuntime;
        if (!surfacePortRuntime) throw new Error("surface_port_unavailable");
        return createPiCanvasWriteTransportAdapter({
          registry: canvasReadSurfaceRuntime.registry,
          capturedPort,
          requestId,
          port: surfacePortRuntime.createCanvasWritePort(capturedPort),
          executor: canvasReadExecutionRuntime.executor,
        });
      },
      captureTimelineRead: (event, binding, requestId) => createPiTimelineReadTransportAdapter({
        registry: canvasReadSurfaceRuntime.registry,
        capturedPort: canvasReadExecutionRuntime.surfaceCapture.captureCommittedCanvasReadPort(event, binding),
        requestId,
        executor: canvasReadExecutionRuntime.executor,
      }),
      captureTimelineWrite: (event, binding, requestId) => createPiTimelineWriteTransportAdapter({
        registry: canvasReadSurfaceRuntime.registry,
        capturedPort: canvasReadExecutionRuntime.surfaceCapture.captureCommittedCanvasReadPort(event, binding),
        requestId,
        executor: canvasReadExecutionRuntime.executor,
      }),
      capturePhase4Surface: (event, binding, requestId) => createPiPhase4SurfaceTransportAdapter({
        registry: canvasReadSurfaceRuntime.registry,
        capturedPort: canvasReadExecutionRuntime.surfaceCapture.captureCommittedCanvasReadPort(event, binding),
        requestId,
        executor: canvasReadExecutionRuntime.executor,
      }),
      captureSkillWrite: (_event, binding) => createPiSkillWriteTransportAdapter({
        // The package importer is main-process owned.  Binding remains part
        // of the Host approval/queue envelope; no renderer data is trusted by
        // this adapter.
        binding,
        now: () => Date.now(),
      }),
      captureSkillRead: (_event, _binding) => createPiSkillReadTransportAdapter(),
      prepareProject: async (binding) => {
        const root = resolveWorkspaceProjectDir(binding.projectId, getWorkspaceRepositoryDeps());
        if (!root) throw new Error("project_identity_unavailable");
        const identity = await ensureWorkspaceProjectIdentity(root);
        if (
          identity.projectId !== binding.projectId ||
          identity.immutableProjectUuid !== binding.immutableProjectUuid ||
          identity.projectGeneration !== binding.projectGeneration
        ) {
          throw new Error("project_binding_stale");
        }
        migrateProjectAgentLegacy({
          projectRoot: root,
          binding,
          router: runtime.repositoryRouter,
        });
        return {
          proposalReceipts: createProjectAgentProposalReceiptService({ projectRoot: root, binding }),
          resolveAttachmentClaims: (claims) => resolveProjectAgentAttachmentClaims(binding.projectId, claims),
        };
      },
    }),
  });
  registerI18nIpc();
  // 会话式模型接入的可信渲染层交接（凭据保存/确认/handoff 队列）。0b6441c6 移植时这两行被误删，而
  // preload 与 OnboardingWizard/IntegrationConfirmationPanel 仍调这些通道（No handler registered）；
  // model-integration-trusted-audio.e2e 抓到后按根因恢复注册。
  registerIntegrationHandoffIpc();
  registerIntegrationSessionIpc();
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
  registerProjectsIpc({
    registerSyncIpc,
    listProjects,
    createProject,
    readProject,
    saveProject,
    deleteProject,
    diagnoseProject,
    recoverProject,
  });
  ipcMain.on("nomi:app:reopen-library-window", (event) => {
    assertTrustedSender(event);
    recreateMainWindowFromSender(event.sender, { preserveRoute: false, reason: "reopen library window" });
  });
  ipcMain.on("nomi:app:hard-reload-window", (event) => {
    assertTrustedSender(event);
    recreateMainWindowFromSender(event.sender, { preserveRoute: true, reason: "hard reload window" });
  });
  registerSyncIpc("nomi:model-catalog:vendors:list", listModelCatalogVendors);
  registerSyncIpc("nomi:model-catalog:models:list", (params?: unknown) => {
    // Renderer 热更新不会重启 Electron main；读取时补一次内置种子，避免 onboarding
    // 长时间停留在旧的持久化目录（例如 APIMart 缺 Grok Imagine 1.5）。
    ensureBuiltinModelSeeds();
    return listModelCatalogModels(params);
  });
  registerSyncIpc("nomi:model-catalog:mappings:list", listModelCatalogMappings);
  registerSyncIpc("nomi:model-catalog:health", getModelCatalogHealth);
  registerSyncIpc("nomi:model-catalog:vendor:upsert", upsertRendererCatalogVendor);
  registerSyncIpc("nomi:model-catalog:vendor:delete", deleteModelCatalogVendor);
  registerSyncIpc("nomi:model-catalog:vendor-api-key:upsert", upsertRendererCatalogVendorApiKey);
  registerSyncIpc("nomi:model-catalog:vendor-api-key:clear", clearModelCatalogVendorApiKey);
  registerSyncIpc("nomi:model-catalog:model:upsert", upsertRendererCatalogModel);
  // 改类型是**领域操作**不是字段 upsert：改 kind 的同时要按新 kind 重建调用通道，否则只是把
  // 「类型错」换成「没有通道」（见 catalog/modelRetype.ts 文件头）。故走自己的 IPC，不复用 upsert。
  registerSyncIpc("nomi:model-catalog:model:retype", retypeModelCatalogModel);
  registerSyncIpc("nomi:model-catalog:model:delete", deleteModelCatalogModel);
  registerSyncIpc("nomi:model-catalog:models:delete", deleteModelCatalogModels);
  registerSyncIpc("nomi:model-catalog:mapping:upsert", upsertRendererCatalogMapping);
  registerSyncIpc("nomi:model-catalog:mapping:delete", deleteModelCatalogMapping);
  registerSyncIpc("nomi:model-catalog:export", exportModelCatalogPackage);
  registerSyncIpc("nomi:model-catalog:import", importRendererCatalogPackage);
  // 域 IPC 各住各的模块（给 main.ts 800 行门腾空间；新通道加到对应模块，别回填这里）。comfy 那棵树重 → 惰性 require；素材通道薄 → 顶部静态 import。
  (require("./comfyuiIpc") as typeof import("./comfyuiIpc")).registerComfyuiIpc(registerSyncIpc);
  registerAssetTransportIpc(registerSyncIpc);
  // 自定义调用域（契约/AI 指令/试跑）住 electron/catalog/customCallIpc.ts（同上，腾 800 行门）。
  const { registerCustomCallIpc } = require("./catalog/customCallIpc") as typeof import("./catalog/customCallIpc");
  registerCustomCallIpc(registerSyncIpc);
  // 系统通知（任务跑完且窗口失焦时）住 electron/notificationIpc.ts，同样为 800 行门腾空间。
  // 静态 import 而非惰性 require：该文件只依赖 electron 本身，载入零成本，且不吃 no-require-imports 警告配额。
  registerNotificationIpc();
  // Skill / Playbook 域在自己的 IPC 模块；ZIP import 异步流式解析，不能阻塞 renderer。
  registerSkillIpc(registerSyncIpc);

  ipcMain.handle("nomi:model-catalog:docs:fetch", async (event, payload) => {
    assertTrustedSender(event);
    const { fetchModelCatalogDocs } = await import("./catalog/catalogCommit");
    return fetchModelCatalogDocs(payload);
  });
  // 即梦会员（dreamina CLI）：设备码登录/账户检测/安装（异步，spawn 本地 CLI）。
  ipcMain.handle("nomi:dreamina:status", async (event) => {
    assertTrustedSender(event);
    const { dreaminaStatus } = await import("./catalog/dreaminaLoginIpc");
    return dreaminaStatus();
  });
  ipcMain.handle("nomi:dreamina:login-start", async (event) => {
    assertTrustedSender(event);
    const { dreaminaLoginStart } = await import("./catalog/dreaminaLoginIpc");
    return dreaminaLoginStart();
  });
  ipcMain.handle("nomi:dreamina:login-poll", async (event, deviceCode: unknown) => {
    assertTrustedSender(event);
    const { dreaminaLoginPoll } = await import("./catalog/dreaminaLoginIpc");
    return dreaminaLoginPoll(String(deviceCode || ""));
  });
  ipcMain.handle("nomi:dreamina:logout", async (event) => {
    assertTrustedSender(event);
    const { dreaminaLogout } = await import("./catalog/dreaminaLoginIpc");
    return dreaminaLogout();
  });
  ipcMain.handle("nomi:dreamina:install", async (event) => {
    assertTrustedSender(event);
    const { dreaminaInstall } = await import("./catalog/dreaminaLoginIpc");
    return dreaminaInstall();
  });
  ipcMain.handle("nomi:workspace:select-folder", async (event) => {
    assertTrustedSender(event);
    const selection = await selectWorkspaceFolder({ showOpenDialog: (options) => dialog.showOpenDialog(options) });
    if (!selection.canceled) selectedWorkspaceRoots.add(selection.rootPath);
    return selection;
  });
  ipcMain.handle("nomi:workspace:open-folder", (event, payload) => {
    assertTrustedSender(event);
    return openWorkspaceFolder(payload, {
      createProject,
      selectedRootPaths: selectedWorkspaceRoots,
      confirmInitialize: async (rootPath) => {
        const result = await dialog.showMessageBox({
          type: "question",
          buttons: [desktopT("common.cancel"), desktopT("common.initialize")],
          defaultId: 1,
          cancelId: 0,
          message: desktopT("workspace.initializeTitle"),
          detail: desktopT("workspace.initializeDetail", { path: rootPath }),
        });
        return result.response === 1;
      },
    });
  });
  ipcMain.handle("nomi:workspace:list-files", (event, payload) => {
    assertTrustedSender(event);
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
  ipcMain.handle("nomi:workspace:reveal-file", (event, payload) => {
    assertTrustedSender(event);
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
  ipcMain.handle("nomi:workspace:reveal-project-folder", (event, payload) => {
    assertTrustedSender(event);
    const projectId = String((payload as { projectId?: unknown } | null)?.projectId || "").trim();
    if (!projectId) throw new Error("projectId is required");
    const project = readProject(projectId) as { lastKnownRootPath?: unknown } | null;
    const rootPath = typeof project?.lastKnownRootPath === "string" ? path.resolve(project.lastKnownRootPath) : "";
    if (!rootPath) throw new Error("Project folder is unavailable");
    void shell.openPath(rootPath);
    return { ok: true };
  });
  ipcMain.handle("nomi:model-catalog:mapping:test", async (event, id, payload) => {
    assertTrustedSender(event);
    const { testModelCatalogMapping } = await import("./catalog/catalogCommit");
    return testModelCatalogMapping(id, payload);
  });
  ipcMain.handle("nomi:assets:import-remote-url", async (event, payload) => {
    assertTrustedSender(event);
    const { importRemoteAsset } = await loadRuntimeModule();
    return importRemoteAsset(payload);
  });
  ipcMain.handle("nomi:assets:list", async (event, payload) => {
    assertTrustedSender(event);
    const { listProjectAssets } = await loadRuntimeModule();
    return listProjectAssets(payload);
  });
  registerAssetsIpc();
  registerSettingsIpc();
  registerVideoIpc();
  registerScreenshotIpc();
  registerTikhubConnectorIpc();
  ipcMain.handle("nomi:image:decompose-layers", async (event, payload) => {
    assertTrustedSender(event);
    const { decomposeLayers } = await import("./image/decomposeLayers");
    return decomposeLayers(payload);
  });
  ipcMain.handle("nomi:scene3d:frames-to-video", async (event, payload) => {
    assertTrustedSender(event);
    const { framesToVideoAsset } = await import("./video/framesToVideo");
    return framesToVideoAsset(payload);
  });
  registerExportJobIpc({
    getActiveProjectSelection: () => canvasReadSurfaceRuntime.getCommittedProjectSelection(),
  });
  registerTaskIpcHandlers(loadRuntimeModule);
  // 「接入 AI 编程助手」卡：读接入状态/配置片段 + 一键写入/撤销 ~/.claude.json 的 mcpServers.nomi。
  registerSyncIpc("nomi:capability:mcp-info", () => readMcpInfo(getActiveCapabilityPort()));
  registerSyncIpc("nomi:capability:mcp-install", installMcp);
  registerSyncIpc("nomi:capability:mcp-uninstall", uninstallMcp);
  registerCustomMcpProfileIpc();
  // 实连验证（异步：真起一次配置里那条命令握手）。「配置里有这行字」≠「还连得上」，见 mcpVerify 头注释。
  ipcMain.handle("nomi:capability:mcp-verify", (event, client: unknown) => (assertTrustedSender(event), verifyMcp(typeof client === "string" ? client : undefined)));
  registerTextStreamIpc();
  registerEventsIpc();
  registerMemoryIpc();
  registerPromptLibraryIpc();
  registerBrowserPromptExtractionSettingsIpc();
  registerProxyIpc();
  registerBrowserViewIpc(getRendererUrl);
  registerOnboardingIpc();
  (require("./localRuntime/localTextEndpointHandlers") as typeof import("./localRuntime/localTextEndpointHandlers")).registerLocalTextEndpointIpc();
  registerProviderAdapterIpc();
  registerExistingConnectionIpc();
  registerProductionRunIpc();
  registerProductionActionIpc({
    getActiveProjectId: () => canvasReadSurfaceRuntime.getCommittedProjectSelection()?.projectId ?? "",
    loadCore: loadCapabilityCoreModule,
  }); // P4 S6 返工/续拍
  registerUpdaterIpc();
  // M0 独立捕捞窗已退役（方案A 2026-07-12）：捕捞面收敛到应用内浏览器（registerBrowserViewIpc）。
  // S4-1 评测安全铁律:事件落盘前,已配置的 vendor key 精确匹配脱敏(形态兜底之外的地基)。
  setEventLogSecretsProvider(catalogSecretsProvider);
}
const SKIP_CROSS_ORIGIN_ISOLATION = process.env.NOMI_E2E === "1";
const SKIP_CROSS_ORIGIN_ISOLATION_FOR_WINDOWS_FRAMELESS = process.platform === "win32";

// 非主实例（没拿到单实例锁）不启动 UI / RPC——已让出给老实例（second-instance 已聚焦它）。
// 单实例锁本身在文件顶部定义（main 与本批独立都加了同一锁，合并去重，根治全局 index 并发覆盖）。
if (hasSingleInstanceLock)
  app
    .whenReady()
    .then(async () => {
      setDesktopLocale(app.getLocale());
      ensureArtifactPreviewSecret();
      watchMcpProfiles();
      try {
        app.setAsDefaultProtocolClient("nomi");
      } catch {
        // Registration is best-effort in dev and on platforms that disallow it.
      }
      registerLocalProtocol();
      installContentSecurityPolicy(session.defaultSession, {
        isDev,
        lowMemoryMode,
        skipCrossOriginIsolation: SKIP_CROSS_ORIGIN_ISOLATION,
        skipCrossOriginIsolationForWindowsFrameless: SKIP_CROSS_ORIGIN_ISOLATION_FOR_WINDOWS_FRAMELESS,
        disableCrossOriginIsolation: process.env.NOMI_DISABLE_CROSS_ORIGIN_ISOLATION === "1",
      });
      // Start before exposing IPC/window. Painting is not blocked; appFetch
      // waits for this configuration instead of silently sending early direct.
      void applyProxyAtBoot()
        .then(() => import("./vendor/vendorBaseFallbackBoot"))
        .then((m) => m.configureVendorBaseFallbackAtBoot())
        .catch((error) => console.error("[nomi:desktop] network boot failed:", error));
      // 写入内置模型种子（Seedance 等主流模型档案）；幂等、存在即跳过，不覆盖用户已有记录。
      // sync 且渲染层一进库就读 catalog → 须在 createWindow 前完成。
      try {
        ensureBuiltinModelSeeds();
      } catch (error) {
        console.error("[nomi:desktop] ensureBuiltinModelSeeds failed:", error);
      }
      registerIpc();
      await createWindow();
      // 外部 capability RPC 不是首窗依赖，且它一旦 listen 就可能收到会解析凭据的 models/generation 请求。
      // 必须在窗口完成后才暴露；失败显式消化，不能反向拖垮已经可用的首窗。低内存模式仍默认跳过。
      if (!capabilityCoreDisabled) {
        void startDesktopCapabilityCore().catch((error) => {
          console.error("[nomi:desktop] startCapabilityCore failed:", error);
        });
      }
      flushPendingProductionDeepLink();
      setTimeout(
        () => {
          // 存量中转模型升级会在真实探测前按需解密凭据；首窗完成后再让出一个后台时段调度，
          // 避免 OS Keychain 阻塞初始窗口或调试握手。动态导入/维护失败均显式消化，不反向拖垮首窗。
          void import("./catalog/relayNativeWireUpgrade")
            .then((m) => m.scheduleRelayNativeWireUpgrade())
            .catch(() => console.warn("[nomi:desktop] post-window catalog maintenance unavailable"));
          // 全局截图热键：默认关，只有用户在设置里开过才会真注册（见 screenshot/screenshotHotkey.ts）。
          void import("./screenshot/screenshotHotkey")
            .then(({ applyScreenshotHotkey }) => applyScreenshotHotkey())
            .catch((error) => console.error("[nomi:desktop] screenshot hotkey boot failed:", error));
        },
        lowMemoryMode ? 15000 : 3000,
      );

      app.on("activate", () => void ensureMainWindow()); // macOS 关窗后进程不退，点 Dock 靠这条把窗口建回来
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
