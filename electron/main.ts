import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { downloadAssetToDisk } from "./assets/downloadAsset";
import {
  createProject,
  deleteProject,
  deleteModelCatalogMapping,
  deleteModelCatalogModel,
  deleteModelCatalogVendor,
  exportModelCatalogPackage,
  fetchModelCatalogDocs,
  fetchTaskResult,
  getModelCatalogHealth,
  importLocalFile,
  importModelCatalogPackage,
  importRemoteAsset,
  listProjectAssets,
  listModelCatalogMappings,
  listModelCatalogModels,
  listModelCatalogVendors,
  listProjects,
  readProject,
  resolveProjectRelativePath,
  runTask,
  saveProject,
  testModelCatalogMapping,
  upsertModelCatalogMapping,
  upsertModelCatalogModel,
  upsertModelCatalogVendor,
  upsertModelCatalogVendorApiKey,
  clearModelCatalogVendorApiKey,
  ensureBuiltinModelSeeds,
} from "./runtime";
import { extractVideoFrameToAsset } from "./video/extractVideoFrame";
import { listSkillsForRenderer } from "./skills/skillIpc";
import { exportSkillPackageByName, importSkillPackageToUserDir } from "./skills/skillPackage";
import { openWorkspaceFolder, selectWorkspaceFolder } from "./workspace/workspaceIpc";
import { listWorkspaceFiles, resolveWorkspaceFilePath } from "./workspace/workspaceFileIndex";
import { installCrashHandlers, logCrash } from "./crashLog";
import { applySystemProxy } from "./systemProxy";
import { registerExportJobIpc } from "./export/exportJobIpc";
import { abortAllActiveExports } from "./export/exportJobs";
import { registerAgentChatV2Ipc } from "./ai/agentChatV2Ipc";
import { registerTextStreamIpc } from "./ai/textStreamIpc";
import { registerConversationsIpc } from "./conversations/conversationsIpc";
import { setEventLogSecretsProvider } from "./events/eventLogRepository";
import { registerEventsIpc } from "./events/eventsIpc";
import { registerMemoryIpc } from "./memory/memoryIpc";
import { catalogSecretsProvider } from "./events/secretsProvider";
import { VendorRequestError, encodeVendorErrorMessage } from "./vendor/vendorHttp";
import { traceVendorCompleted } from "./events/vendorCallTrace";
import { registerOnboardingIpc } from "./ai/onboarding/onboardingIpc";
import { registerUpdaterIpc } from "./update/autoUpdater";
import { startCapabilityCore, stopCapabilityCore, setOpenProjectId } from "./capabilityCore/appIntegration";

// 尽早安装：捕获引导阶段起的 uncaughtException / unhandledRejection，落盘到 app logs（P0-8）。
installCrashHandlers();

// 单实例锁（能力核前提，docs/plan/2026-06-20）：保证同一 user-data 只有一个 app 实例 = 工程文件的
// 唯一写者，外部 CLI/MCP 才能安全地「app 开着走 RPC、关着走 headless」。隔离实例（eval/promo 用独立
// --user-data-dir）拿到的是各自的锁，不受影响。拿不到锁 = 已有实例在跑 → 让出（聚焦老窗后退出）。
const hasSingleInstanceLock = app.requestSingleInstanceLock();
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

if (isDev && devRemoteDebuggingPort) {
  app.commandLine.appendSwitch("remote-debugging-port", devRemoteDebuggingPort);
}

function registerDevDiagnostics(mainWindow: BrowserWindow, rendererUrl: string): void {
  if (!isDev) return;

  console.log(`[nomi:desktop] loading renderer: ${rendererUrl}`);

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
  if (isDev) return "http://127.0.0.1:5173";
  return pathToFileURL(path.join(__dirname, "../dist/index.html")).toString();
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

async function createWindow(): Promise<void> {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#f6f3ee",
    title: "Nomi",
    icon: path.join(__dirname, "../build/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // External http(s) links (e.g. the "get your API key" link → provider console)
  // open in the user's real browser, never as a new in-app Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  const rendererUrl = getRendererUrl();
  registerDevDiagnostics(mainWindow, rendererUrl);
  await loadRendererWithRetry(mainWindow, rendererUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
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
    if (error instanceof VendorRequestError) {
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
  registerSyncIpc("nomi:projects:list", listProjects);
  registerSyncIpc("nomi:projects:create", (record: unknown) => {
    if (record && typeof record === "object" && typeof (record as { rootPath?: unknown }).rootPath === "string") {
      throw new Error("Use nomi:workspace:open-folder to create or open folder-backed projects");
    }
    return createProject(record);
  });
  registerSyncIpc("nomi:projects:read", readProject);
  registerSyncIpc("nomi:projects:save", saveProject);
  registerSyncIpc("nomi:projects:delete", deleteProject);
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

  // Skill / Playbook 域（业务函数在 electron/skills/*，这里只接同步 IPC 管道）。
  registerSyncIpc("nomi:skill:list", listSkillsForRenderer);
  registerSyncIpc("nomi:skill:export", (dirName: unknown) =>
    exportSkillPackageByName(String(dirName || ""), Date.now()),
  );
  registerSyncIpc("nomi:skill:import", (payload: unknown) => importSkillPackageToUserDir(payload));

  ipcMain.handle("nomi:model-catalog:docs:fetch", (_event, payload) => fetchModelCatalogDocs(payload));
  ipcMain.handle("nomi:workspace:select-folder", async () => {
    const selection = await selectWorkspaceFolder({ showOpenDialog: (options) => dialog.showOpenDialog(options) });
    if (!selection.canceled) selectedWorkspaceRoots.add(selection.rootPath);
    return selection;
  });
  ipcMain.handle("nomi:workspace:open-folder", (_event, payload) => openWorkspaceFolder(payload, {
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
  }));
  ipcMain.handle("nomi:workspace:list-files", (_event, payload) => {
    const projectId = String((payload as { projectId?: unknown } | null)?.projectId || "").trim();
    if (!projectId) throw new Error("projectId is required");
    const project = readProject(projectId) as { lastKnownRootPath?: unknown } | null;
    const rootPath = typeof project?.lastKnownRootPath === "string" ? project.lastKnownRootPath : "";
    if (!rootPath) throw new Error("Project folder is unavailable");
    return listWorkspaceFiles({
      rootPath,
      maxFiles: typeof (payload as { limit?: unknown } | null)?.limit === "number" ? (payload as { limit: number }).limit : undefined,
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
  ipcMain.handle("nomi:workspace:reveal-project-folder", (_event, payload) => {
    const projectId = String((payload as { projectId?: unknown } | null)?.projectId || "").trim();
    if (!projectId) throw new Error("projectId is required");
    const project = readProject(projectId) as { lastKnownRootPath?: unknown } | null;
    const rootPath = typeof project?.lastKnownRootPath === "string" ? path.resolve(project.lastKnownRootPath) : "";
    if (!rootPath) throw new Error("Project folder is unavailable");
    void shell.openPath(rootPath);
    return { ok: true };
  });
  ipcMain.handle("nomi:model-catalog:mapping:test", (_event, id, payload) => testModelCatalogMapping(id, payload));
  ipcMain.handle("nomi:assets:import-remote-url", (_event, payload) => importRemoteAsset(payload));
  ipcMain.handle("nomi:assets:import-file", (_event, payload) => importLocalFile(payload));
  ipcMain.handle("nomi:assets:list", (_event, payload) => listProjectAssets(payload));
  ipcMain.handle("nomi:assets:download", (_event, payload) => downloadAssetToDisk(payload));
  ipcMain.handle("nomi:video:extract-frame", (_event, payload) => extractVideoFrameToAsset(payload));
  registerExportJobIpc();
  ipcMain.handle("nomi:tasks:run", (_event, payload) => runTaskIpcGuard(payload, () => runTask(payload)));
  ipcMain.handle("nomi:tasks:result", (_event, payload) => runTaskIpcGuard(payload, () => fetchTaskResult(payload)));
  // 能力核 A/B 守卫：renderer 在打开/切换/关闭项目时上报当前打开的 projectId，
  // 让外部调用拒绝直写「正在窗口里编辑」的工程（防内存 store 回盘覆盖，见 capabilityCore/rpcServer）。
  ipcMain.on("nomi:capability:active-project", (_event, projectId: unknown) => setOpenProjectId(String(projectId || "")));
  registerAgentChatV2Ipc();
  registerTextStreamIpc();
  registerConversationsIpc();
  registerEventsIpc();
  registerMemoryIpc();
  registerOnboardingIpc();
  registerUpdaterIpc();
  // S4-1 评测安全铁律:事件落盘前,已配置的 vendor key 精确匹配脱敏(形态兜底之外的地基)。
  setEventLogSecretsProvider(catalogSecretsProvider);
}

function registerLocalProtocol(): void {
  protocol.handle("nomi-local", async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== "asset") {
        return new Response("Unsupported nomi-local host", { status: 404 });
      }
      const [projectId, ...relativeParts] = decodeURIComponent(url.pathname.replace(/^\/+/, "")).split("/");
      const relativePath = relativeParts.join("/");
      const filePath = resolveProjectRelativePath(projectId, relativePath);
      const fileResponse = await net.fetch(pathToFileURL(filePath).toString());
      // canvas.toDataURL() 需要 CORS 头，否则 crossOrigin='anonymous' 加载的图片会污染画布
      // 导致九宫格/裁切等操作静默失败（SecurityError 被吞掉）。
      const corsHeaders = new Headers(fileResponse.headers);
      corsHeaders.set("Access-Control-Allow-Origin", "*");
      return new Response(fileResponse.body, { status: fileResponse.status, headers: corsHeaders });
    } catch (error) {
      const message = error instanceof Error ? error.message : "local asset not found";
      return new Response(message, { status: 404 });
    }
  });
}

// 非主实例（没拿到单实例锁）不启动 UI / RPC——已让出给老实例（second-instance 已聚焦它）。
if (hasSingleInstanceLock) app.whenReady().then(async () => {
  registerLocalProtocol();
  // 启动即探测系统/环境代理并应用到全局 fetch，让"测试连接/调 AI API/拉模型"能穿透代理。
  // 失败只记日志、不抛——绝不拖垮启动。须在任何出站请求前完成。
  await applySystemProxy(session.defaultSession);
  // 写入内置模型种子（Seedance 等主流模型档案）；幂等、存在即跳过，不覆盖用户已有记录。
  try {
    ensureBuiltinModelSeeds();
  } catch (error) {
    console.error("[nomi:desktop] ensureBuiltinModelSeeds failed:", error);
  }
  registerIpc();
  // 能力核对外口（RPC + 实例广告）：让外部 Claude Code/Codex 经 CLI/MCP 在本地驱动 Nomi。
  // fail-open：内部不抛，绝不影响 app 启动。
  await startCapabilityCore(runTask, fetchTaskResult);
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow().catch((error) => {
        console.error("[nomi:desktop] failed to recreate window:", error);
      });
    }
  });
}).catch((error) => {
  console.error("[nomi:desktop] failed to start:", error);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// 退出时中止所有在跑导出，否则 ffmpeg 子进程会变孤儿（继续占 CPU/写文件，直到自己跑完）。
// abort → ffmpegRunner 监听 abort 后 kill 子进程。同步、不抛，绝不拖住退出。
app.on("before-quit", () => {
  // 能力核退出清理：清实例广告 + 关 RPC，让外部探测立刻知道「app 已关」。同步、不抛。
  stopCapabilityCore();
  try {
    const aborted = abortAllActiveExports();
    if (aborted > 0) console.log(`[nomi:desktop] aborted ${aborted} in-flight export(s) on quit`);
  } catch (error) {
    console.error("[nomi:desktop] failed to abort exports on quit:", error);
  }
});
