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

// 尽早安装：捕获引导阶段起的 uncaughtException / unhandledRejection，落盘到 app logs（P0-8）。
installCrashHandlers();

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

  // 纵深防御：setWindowOpenHandler 只拦新窗口，拦不住顶层框架自身被诱导导航
  // （window.location = 'http://evil'）。一旦发生，整个 app 会变成加载远端页面的浏览器。
  // 这里把任何「离开本地渲染入口」的顶层导航一律拦下；外链改走系统浏览器。
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url === rendererUrl) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });

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
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: http://127.0.0.1:5173",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' nomi-local: https: ws://127.0.0.1:5173 http://127.0.0.1:5173",
    ].join("; ");
  }
  return [
    ...common,
    // prod：vite 产物为外链脚本，无需 inline/eval。但 3D 编辑器要 'wasm-unsafe-eval'（Three.js
    // GLTF/meshopt 解码器实例化 WASM）+ blob:（解码 worker 经 blob 脚本 importScripts）。
    // 'wasm-unsafe-eval' 只放行 WASM 编译，不开放危险的 JS eval（比 'unsafe-eval' 收得紧）。
    "script-src 'self' 'wasm-unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' nomi-local: https:",
  ].join("; ");
}

function installContentSecurityPolicy(targetSession: Electron.Session): void {
  const csp = buildContentSecurityPolicy();
  targetSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });
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

// 单实例锁：本地优先应用的全局 index（catalog.json / recent-workspaces.json）是单一文件，
// 每次变更走「读全量 → 改 → 写全量」的非原子 read-modify-write。两个实例并发改写会互相
// 用旧快照覆盖（A 读 N 条→B 删 1 条写回→A 基于旧 N 条写回，B 的删除被整体覆盖蒸发）——
// 这正是「并行会话抢 index 推坏」的运行时同类。拿不到锁直接退出、把已有窗口前置，根治整类。
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}
app.on("second-instance", () => {
  const [existing] = BrowserWindow.getAllWindows();
  if (!existing) return;
  if (existing.isMinimized()) existing.restore();
  existing.focus();
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return; // 第二个实例：已在退出，引导一律跳过
  registerLocalProtocol();
  installContentSecurityPolicy(session.defaultSession);
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
  try {
    const aborted = abortAllActiveExports();
    if (aborted > 0) console.log(`[nomi:desktop] aborted ${aborted} in-flight export(s) on quit`);
  } catch (error) {
    console.error("[nomi:desktop] failed to abort exports on quit:", error);
  }
});
