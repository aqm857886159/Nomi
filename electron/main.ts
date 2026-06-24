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
import { framesToVideoAsset } from "./video/framesToVideo";
import { mintSpendGrant } from "./spendGrant";
import { listSkillsForRenderer } from "./skills/skillIpc";
import { deleteUserSkill, exportSkillPackageByName, importSkillPackageToUserDir } from "./skills/skillPackage";
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
import { registerPromptLibraryIpc } from "./promptLibrary/promptLibraryIpc";
import { catalogSecretsProvider } from "./events/secretsProvider";
import { VendorRequestError, encodeVendorErrorMessage } from "./vendor/vendorHttp";
import { traceVendorCompleted } from "./events/vendorCallTrace";
import { registerOnboardingIpc } from "./ai/onboarding/onboardingIpc";
import { registerUpdaterIpc } from "./update/autoUpdater";
import { startCapabilityCore, stopCapabilityCore, setOpenProjectId, getCapabilityPort } from "./capabilityCore/appIntegration";
import { setRendererTarget } from "./capabilityCore/rendererBridge";
import { readMcpInfo, installMcp, uninstallMcp } from "./capabilityCore/mcpConfig";
import { startMcpStdioServer } from "./capabilityCore/mcpStdioServer";

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
const hasSingleInstanceLock = isMcpStdio ? false : app.requestSingleInstanceLock();
if (!isMcpStdio) {
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
  void app.whenReady().then(startMcpStdioServer).catch((error) => {
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

if (isDev && devRemoteDebuggingPort) {
  app.commandLine.appendSwitch("remote-debugging-port", devRemoteDebuggingPort);
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

  // 能力核 A 模式实时桥：登记当前窗口 webContents，让主进程把外部 MCP 的画布改动/付费确认
  // 转发进运行中的渲染层（所见即所得）。窗口销毁即清除，避免向死窗口发送。
  setRendererTarget(mainWindow.webContents);
  mainWindow.webContents.on("destroyed", () => setRendererTarget(null));

  registerDevDiagnostics(mainWindow, rendererUrl);
  if (isDev) {
    try {
      await mainWindow.webContents.session.clearCache();
    } catch (error) {
      console.warn("[nomi:desktop] failed to clear dev session cache:", error);
    }
  }
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
  registerSyncIpc("nomi:skill:delete", (dirName: unknown) => deleteUserSkill(String(dirName || "")));

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
  ipcMain.handle("nomi:scene3d:frames-to-video", (_event, payload) => framesToVideoAsset(payload));
  registerExportJobIpc();
  // 付费守卫铸令牌：仅由渲染层「真人确认」事件链调用（务实纵深：铸造面小而审计过 + 主进程硬闸兜底）。
  ipcMain.handle("nomi:tasks:grant-spend", (_event, payload) => {
    const raw = (payload || {}) as { nodeIds?: unknown; maxAttemptsPerNode?: unknown };
    const nodeIds = Array.isArray(raw.nodeIds) ? raw.nodeIds.map((id) => String(id)) : [];
    const maxAttemptsPerNode = typeof raw.maxAttemptsPerNode === "number" ? raw.maxAttemptsPerNode : undefined;
    return { grantId: mintSpendGrant({ nodeIds, ...(maxAttemptsPerNode ? { maxAttemptsPerNode } : {}) }) };
  });
  ipcMain.handle("nomi:tasks:run", (_event, payload) => runTaskIpcGuard(payload, () => runTask(payload)));
  ipcMain.handle("nomi:tasks:result", (_event, payload) => runTaskIpcGuard(payload, () => fetchTaskResult(payload)));
  // 能力核 A/B 守卫：renderer 在打开/切换/关闭项目时上报当前打开的 projectId，
  // 让外部调用拒绝直写「正在窗口里编辑」的工程（防内存 store 回盘覆盖，见 capabilityCore/rpcServer）。
  ipcMain.on("nomi:capability:active-project", (_event, projectId: unknown) => setOpenProjectId(String(projectId || "")));
  // 「接入 AI 编程助手」卡：读接入状态/配置片段 + 一键写入/撤销 ~/.claude.json 的 mcpServers.nomi。
  registerSyncIpc("nomi:capability:mcp-info", () => readMcpInfo(getCapabilityPort()));
  registerSyncIpc("nomi:capability:mcp-install", installMcp);
  registerSyncIpc("nomi:capability:mcp-uninstall", uninstallMcp);
  registerAgentChatV2Ipc();
  registerTextStreamIpc();
  registerConversationsIpc();
  registerEventsIpc();
  registerMemoryIpc();
  registerPromptLibraryIpc();
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
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: http://127.0.0.1:5273",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' nomi-local: https: ws://127.0.0.1:5273 http://127.0.0.1:5273",
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

// 非主实例（没拿到单实例锁）不启动 UI / RPC——已让出给老实例（second-instance 已聚焦它）。
// 单实例锁本身在文件顶部定义（main 与本批独立都加了同一锁，合并去重，根治全局 index 并发覆盖）。
if (hasSingleInstanceLock) app.whenReady().then(async () => {
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
  // E(冷启动 P0)：代理探测与能力核都不是窗口首帧的依赖，挡在窗口前是纯浪费——并行后台跑，窗口立即出。
  //  · applySystemProxy：PAC/Clash 环境下 resolveProxy 可阻塞数十~数百 ms；它只需在「用户触发的
  //    出站请求」(测连接/调 AI，首帧后数秒)前完成，此处先于 createWindow 启动即有足够提前量(内部不抛)。
  //  · startCapabilityCore(外部 MCP 的本地 RPC 广告)：fail-open，本就不影响 app。
  void applySystemProxy(session.defaultSession).catch((error) => {
    console.error("[nomi:desktop] applySystemProxy failed:", error);
  });
  void startCapabilityCore(runTask, fetchTaskResult).catch((error) => {
    console.error("[nomi:desktop] startCapabilityCore failed:", error);
  });
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
