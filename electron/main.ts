import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell, webContents as electronWebContents } from "electron";
import type { WebContents } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
  runAgentChatV2,
  clearAgentChatV2History,
  runTask,
  saveProject,
  showExportInFolder,
  cancelExportJob,
  getExportJobStatus,
  startExportJob,
  writeExportTempInput,
  finishExportTempInput,
  subscribeExportJobEvents,
  testModelCatalogMapping,
  upsertModelCatalogMapping,
  upsertModelCatalogModel,
  upsertModelCatalogVendor,
  upsertModelCatalogVendorApiKey,
  clearModelCatalogVendorApiKey,
  commitOnboardedModelToCatalog,
  commitManualOpenAiCompatibleModels,
  resolveOnboardingAgentFromCatalog,
  ensureBuiltinModelSeeds,
  normalizeProviderKind,
} from "./runtime";
import { runOnboardingTrial } from "./ai/onboarding/agent";
import type { ModelKind } from "./ai/onboarding/types";
import type { AiSdkProviderKind } from "./catalog/types";
import { openWorkspaceFolder, selectWorkspaceFolder } from "./workspace/workspaceIpc";
import { listWorkspaceFiles, resolveWorkspaceFilePath } from "./workspace/workspaceFileIndex";
import { installCrashHandlers, logCrash } from "./crashLog";
import { applySystemProxy, describeNetworkError } from "./systemProxy";

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
const exportJobEventSubscriptions = new Map<number, () => void>();

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
  ipcMain.handle("nomi:model-catalog:mapping:test", (_event, id, payload) => testModelCatalogMapping(id, payload));
  ipcMain.handle("nomi:assets:import-remote-url", (_event, payload) => importRemoteAsset(payload));
  ipcMain.handle("nomi:assets:import-file", (_event, payload) => importLocalFile(payload));
  ipcMain.handle("nomi:assets:list", (_event, payload) => listProjectAssets(payload));
  ipcMain.handle("nomi:exports:start-job", (event, payload) => {
    registerExportJobEventForwarding(event.sender);
    return startExportJob(payload);
  });
  ipcMain.handle("nomi:exports:write-temp-input", (event, payload) => {
    registerExportJobEventForwarding(event.sender);
    return writeExportTempInput(payload);
  });
  ipcMain.handle("nomi:exports:finish-temp-input", (event, payload) => {
    registerExportJobEventForwarding(event.sender);
    return finishExportTempInput(payload);
  });
  ipcMain.handle("nomi:exports:status", (event, jobId) => {
    registerExportJobEventForwarding(event.sender);
    return getExportJobStatus(jobId);
  });
  ipcMain.handle("nomi:exports:cancel", (event, jobId) => {
    registerExportJobEventForwarding(event.sender);
    return cancelExportJob(jobId);
  });
  ipcMain.handle("nomi:exports:show-in-folder", (_event, payload) => showExportInFolder(payload));
  ipcMain.handle("nomi:tasks:run", (_event, payload) => runTask(payload));
  ipcMain.handle("nomi:tasks:result", (_event, payload) => fetchTaskResult(payload));
  registerAgentChatV2Ipc();
  registerOnboardingIpc();
}

function registerExportJobEventForwarding(contents: WebContents): void {
  if (exportJobEventSubscriptions.has(contents.id)) return;
  const unsubscribe = subscribeExportJobEvents((payload) => {
    const target = electronWebContents.fromId(contents.id);
    if (!target || target.isDestroyed()) return;
    target.send("nomi:exports:event", payload);
  });
  exportJobEventSubscriptions.set(contents.id, unsubscribe);
  contents.once("destroyed", () => {
    exportJobEventSubscriptions.get(contents.id)?.();
    exportJobEventSubscriptions.delete(contents.id);
  });
}

// ---------------------------------------------------------------------------
// Agent chat V2 — real streaming + tool-call confirmation
// ---------------------------------------------------------------------------

type AgentChatV2Session = {
  sessionId: string;
  webContentsId: number;
  pendingConfirmations: Map<string, {
    resolve: (decision: { ok: true; result: unknown } | { ok: false; message: string }) => void;
  }>;
  cancelled: boolean;
};

const agentChatV2Sessions = new Map<string, AgentChatV2Session>();

function sendChatV2Event(session: AgentChatV2Session, event: unknown): void {
  const target: WebContents | undefined = electronWebContents.fromId(session.webContentsId) || undefined;
  if (!target || target.isDestroyed()) return;
  target.send("nomi:agents:chatV2:event", { sessionId: session.sessionId, event });
}

function registerAgentChatV2Ipc(): void {
  ipcMain.handle("nomi:agents:chatV2:start", async (event, payload: Record<string, unknown>) => {
    const sessionId = `chatV2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const session: AgentChatV2Session = {
      sessionId,
      webContentsId: event.sender.id,
      pendingConfirmations: new Map(),
      cancelled: false,
    };
    agentChatV2Sessions.set(sessionId, session);

    // Run the agent loop asynchronously so the IPC call can return the
    // sessionId immediately; the renderer subscribes to events first.
    queueMicrotask(() => {
      void runAgentChatV2(payload as Parameters<typeof runAgentChatV2>[0], {
        emit: (evt) => sendChatV2Event(session, evt),
        awaitToolConfirmation: ({ toolCallId, toolName, args }) => new Promise((resolve) => {
          if (session.cancelled) {
            resolve({ ok: false, message: "session cancelled" });
            return;
          }
          session.pendingConfirmations.set(toolCallId, { resolve });
          sendChatV2Event(session, {
            type: "tool-call-pending",
            toolCallId,
            toolName,
            args,
          });
        }),
      })
        .then((result) => {
          sendChatV2Event(session, { type: "result", result });
          sendChatV2Event(session, { type: "done", reason: "finished" });
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          sendChatV2Event(session, { type: "error", message });
          sendChatV2Event(session, { type: "done", reason: "error" });
        })
        .finally(() => {
          agentChatV2Sessions.delete(sessionId);
        });
    });

    return { sessionId };
  });

  ipcMain.handle("nomi:agents:chatV2:confirmTool", async (_event, payload: {
    sessionId: string;
    toolCallId: string;
    decision: { ok: true; result?: unknown } | { ok: false; message?: string };
  }) => {
    const session = agentChatV2Sessions.get(payload.sessionId);
    if (!session) return { ok: false, error: "session not found" };
    const pending = session.pendingConfirmations.get(payload.toolCallId);
    if (!pending) return { ok: false, error: "tool call not pending" };
    session.pendingConfirmations.delete(payload.toolCallId);
    if (payload.decision && payload.decision.ok === true) {
      pending.resolve({ ok: true, result: payload.decision.result ?? null });
    } else {
      const message = (payload.decision && (payload.decision as { message?: string }).message) || "rejected by user";
      pending.resolve({ ok: false, message });
    }
    return { ok: true };
  });

  ipcMain.handle("nomi:agents:chatV2:cancel", async (_event, payload: { sessionId: string }) => {
    const session = agentChatV2Sessions.get(payload.sessionId);
    if (!session) return { ok: false, error: "session not found" };
    session.cancelled = true;
    // Resolve all pending confirmations as rejected so the agent loop exits.
    for (const [toolCallId, pending] of session.pendingConfirmations) {
      pending.resolve({ ok: false, message: "session cancelled" });
      session.pendingConfirmations.delete(toolCallId);
    }
    return { ok: true };
  });

  // "新对话" — wipe the shared conversation memory for a sessionKey so the next
  // turn starts fresh (no key = wipe all).
  ipcMain.handle("nomi:agents:chatV2:clearSession", async (_event, payload: { sessionKey?: string }) => {
    clearAgentChatV2History(payload?.sessionKey);
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Onboarding (M5.4) — IPC bridge for the Wizard UI
// ---------------------------------------------------------------------------

type OnboardingSession = {
  trialId: string;
  webContentsId: number;
  cancelled: boolean;
};

const onboardingSessions = new Map<string, OnboardingSession>();

function sendOnboardingEvent(session: OnboardingSession, event: unknown): void {
  const target: WebContents | undefined = electronWebContents.fromId(session.webContentsId) || undefined;
  if (!target || target.isDestroyed()) return;
  target.send("nomi:onboarding:event", { trialId: session.trialId, event });
}

/** 单协议探测结果。mismatch=true 表示像「路由/协议不对」（可换下一个协议试）。 */
type ProtocolProbe = { ok: boolean; status?: number; error?: string; mismatch?: boolean };

/**
 * 用极小请求体探测一个 wire protocol 是否接受。三协议各自的 URL/认证/body 形状：
 *  - anthropic        : host root + /v1/messages，x-api-key + anthropic-version，messages 体（剥尾随 /v1 防双拼）
 *  - openai-responses : {baseUrl}/responses，bearer，{input, max_output_tokens}（非 messages！）
 *  - openai-compatible: {baseUrl}/chat/completions，bearer，{messages, max_tokens}
 */
async function probeOneProtocol(
  kind: AiSdkProviderKind,
  rawBaseUrl: string,
  apiKey: string,
  modelId: string,
  extraHeaders: Record<string, string>,
  signal: AbortSignal,
): Promise<ProtocolProbe> {
  let url: string;
  let headers: Record<string, string>;
  let body: Record<string, unknown>;
  if (kind === "anthropic") {
    const root = (rawBaseUrl || "https://api.anthropic.com").replace(/\/v1$/i, "");
    url = `${root}/v1/messages`;
    headers = {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
      ...extraHeaders,
    };
    body = { model: modelId || "claude-3-5-haiku-latest", max_tokens: 1, messages: [{ role: "user", content: "ping" }] };
  } else if (kind === "openai-responses") {
    url = `${rawBaseUrl}/responses`;
    headers = { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}), ...extraHeaders };
    body = { model: modelId || "gpt-4o-mini", input: "ping", max_output_tokens: 16 };
  } else {
    url = `${rawBaseUrl}/chat/completions`;
    headers = { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}), ...extraHeaders };
    body = { model: modelId || "gpt-3.5-turbo", messages: [{ role: "user", content: "ping" }], max_tokens: 1 };
  }
  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
    if (res.ok) return { ok: true, status: res.status };
    const text = await res.text().catch(() => "");
    // 404/405/501/502/503 多为「路由/协议不对」→ 换下一个协议；401/403/400 多为鉴权/请求问题（不是协议错）。
    const mismatch = [404, 405, 501, 502, 503].includes(res.status);
    return { ok: false, status: res.status, error: text.slice(0, 300) || `HTTP ${res.status}`, mismatch };
  } catch (error) {
    return { ok: false, error: describeNetworkError(error), mismatch: true };
  }
}

function registerOnboardingIpc(): void {
  ipcMain.handle("nomi:onboarding:start", async (event, payload: Record<string, unknown>) => {
    const docsUrl = String(payload?.docsUrl || "").trim();
    const userApiKey = String(payload?.userApiKey || "").trim();
    if (!docsUrl) throw new Error("docsUrl required");
    if (!userApiKey) throw new Error("userApiKey required");

    // The onboarding doc-reader LLM is resolved in this priority order:
    //   1. payload.agent — explicit override (the Lab CLI passes --agent-* here).
    //   2. a configured TEXT model in the catalog — the product path. This is the
    //      model the user already added in 模型设置 (e.g. dm-fox GPT-5.5); it works
    //      identically in dev and a packaged app, no env / no .secrets needed.
    //   3. NOMI_ONBOARDING_AGENT_* env vars — dev/headless fallback only.
    const agentConfig = (payload?.agent || {}) as Record<string, unknown>;
    const fromCatalog = resolveOnboardingAgentFromCatalog();
    const agent = {
      // 单一归一化器（R1）：不再 `as ProviderKind` 裸 cast——任意脏值流经 normalizeProviderKind 才到工厂。
      providerKind: normalizeProviderKind(
        agentConfig.providerKind || fromCatalog?.providerKind || process.env.NOMI_ONBOARDING_AGENT_PROVIDER,
      ),
      baseUrl: String(agentConfig.baseUrl || fromCatalog?.baseUrl || process.env.NOMI_ONBOARDING_AGENT_BASE_URL || ""),
      modelId: String(agentConfig.modelId || fromCatalog?.modelId || process.env.NOMI_ONBOARDING_AGENT_MODEL || ""),
      apiKey: String(agentConfig.apiKey || fromCatalog?.apiKey || process.env.NOMI_ONBOARDING_AGENT_KEY || ""),
      // Replay the catalog vendor's custom headers so the doc-reader reaches the
      // same relay/proxy gateway the user's text model is behind.
      ...(fromCatalog?.extraHeaders ? { extraHeaders: fromCatalog.extraHeaders } : {}),
    };
    if (!agent.baseUrl || !agent.modelId || !agent.apiKey) {
      throw new Error(
        "Onboarding agent not configured. Add a text model (e.g. GPT/Kimi) in 模型设置 first — it will be used to read the docs.",
      );
    }

    // Optional target kind hint; if absent, the agent infers from the docs.
    const targetKind = (payload?.targetKind as ModelKind) || undefined;

    const trialId = `onboard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const session: OnboardingSession = { trialId, webContentsId: event.sender.id, cancelled: false };
    onboardingSessions.set(trialId, session);

    queueMicrotask(() => {
      void runOnboardingTrial({
        trialId,
        docsUrl,
        targetKind: targetKind ?? ("image" as ModelKind), // initial seed; the agent overrides it via set_model_kind after reading the docs
        userApiKey,
        agent,
        // Async APIs legitimately need ~11 tool calls (create + query stage),
        // and a self-corrected 404 can eat one more. 10 was too tight and left
        // drafts "partial" (test passed, query stage never wired). 14 gives margin.
        maxSteps: Number(payload?.maxSteps) || 14,
        onEvent: (evt) => sendOnboardingEvent(session, evt),
      })
        .then((outcome) => {
          // Auto-commit on success so the wizard's "success" event already shows the persisted model.
          let committedModel: unknown = null;
          if (outcome.status === "success") {
            try {
              committedModel = commitOnboardedModelToCatalog({ outcome, userApiKey });
            } catch (e) {
              const message = e instanceof Error ? e.message : String(e);
              sendOnboardingEvent(session, { type: "commit-error", message });
            }
          }
          sendOnboardingEvent(session, { type: "result", outcome, committedModel });
          sendOnboardingEvent(session, { type: "done", reason: "finished" });
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          sendOnboardingEvent(session, { type: "error", message });
          sendOnboardingEvent(session, { type: "done", reason: "error" });
        })
        .finally(() => {
          onboardingSessions.delete(trialId);
        });
    });

    return { trialId };
  });

  ipcMain.handle("nomi:onboarding:cancel", async (_event, payload: { trialId: string }) => {
    const session = onboardingSessions.get(payload.trialId);
    if (!session) return { ok: false, error: "session not found" };
    // True cancellation requires plumbing AbortSignal through generateText.
    // For now flag the session; the next "done" emit will see cancelled=true.
    session.cancelled = true;
    sendOnboardingEvent(session, { type: "cancelled" });
    return { ok: true };
  });

  // PRIMARY model-adding path — manual provider entry (BaseURL + key + models).
  // Deterministic openai-compatible text commit; reuses the single catalog write
  // path. No forced connectivity test (aligns with opencode; see test-connection).
  ipcMain.handle("nomi:onboarding:manual-commit", async (_event, payload: Record<string, unknown>) => {
    try {
      // R1：走唯一 normalizeProviderKind（接受 openai-responses），不再 2 值 clamp。
      const providerKind = normalizeProviderKind(payload?.providerKind);
      const headers: Record<string, string> = {};
      if (payload?.headers && typeof payload.headers === "object") {
        for (const [k, v] of Object.entries(payload.headers as Record<string, unknown>)) {
          headers[String(k)] = String(v ?? "");
        }
      }
      const result = commitManualOpenAiCompatibleModels({
        vendorName: String(payload?.vendorName || ""),
        baseUrl: String(payload?.baseUrl || ""),
        apiKey: String(payload?.apiKey || ""),
        providerKind,
        headers,
        models: Array.isArray(payload?.models)
          ? (payload.models as Array<Record<string, unknown>>).map((m) => ({
              id: String(m?.id || ""),
              displayName: m?.displayName ? String(m.displayName) : undefined,
            }))
          : [],
      });
      return { ok: true, vendorKey: result.vendorKey, committed: result.committed };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  });

  // 接口协议探测（auto-probe）+ 连接测试。非阻塞，永不 gate 保存。
  // 真实用户接不进来的根因是「不知道选哪个协议」（P4）——默认让主进程替他试：
  // chat↔responses 共享 /v1 baseURL + bearer，只 path/body 不同，挨个发极小请求探测；
  // anthropic（host root + x-api-key）仅当 hostname 像 anthropic 或地址留空时纳入。
  // 专家在表单展开「接口协议」强制指定时，payload.providerKind 给定 → 只测那一个。
  ipcMain.handle("nomi:onboarding:test-connection", async (_event, payload: Record<string, unknown>) => {
    const rawBaseUrl = String(payload?.baseUrl || "").trim().replace(/\/+$/, "");
    const apiKey = String(payload?.apiKey || "").trim();
    const modelId = String(payload?.modelId || "").trim();
    const forcedKind = payload?.providerKind ? normalizeProviderKind(payload.providerKind) : undefined;
    const autoProbe = payload?.autoProbe === true && !forcedKind;
    // User-supplied relay/proxy headers replay on every probe so a gateway that gates
    // on them doesn't report a false failure.
    const extraHeaders: Record<string, string> = {};
    if (payload?.headers && typeof payload.headers === "object") {
      for (const [k, v] of Object.entries(payload.headers as Record<string, unknown>)) {
        const key = String(k).trim();
        const value = String(v ?? "").trim();
        if (key && value) extraHeaders[key] = value;
      }
    }
    // 候选协议：强制 → 只它；自动 → chat+responses（+anthropic 当 hostname 像 anthropic 或地址留空）。
    let candidates: AiSdkProviderKind[];
    if (forcedKind) {
      candidates = [forcedKind];
    } else if (autoProbe) {
      const host = (() => {
        try { return new URL(rawBaseUrl).hostname; } catch { return ""; }
      })();
      const anthropicLikely = !rawBaseUrl || /anthropic|claude/i.test(host);
      candidates = !rawBaseUrl
        ? ["anthropic"]
        : anthropicLikely
          ? ["anthropic", "openai-compatible", "openai-responses"]
          : ["openai-compatible", "openai-responses"];
    } else {
      candidates = ["openai-compatible"];
    }
    // openai-* 必须有 http(s) 地址；anthropic 可留空（托管默认）。无地址且无 anthropic 候选 → 直接报错。
    if (!/^https?:\/\//i.test(rawBaseUrl) && !candidates.includes("anthropic")) {
      return { ok: false, error: "接入地址需以 http:// 或 https:// 开头" };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      let best: (ProtocolProbe & { kind: AiSdkProviderKind }) | null = null;
      for (const kind of candidates) {
        // openai-* 没地址就跳过（避免 fetch 无效 URL）。
        if (kind !== "anthropic" && !/^https?:\/\//i.test(rawBaseUrl)) continue;
        const r = await probeOneProtocol(kind, rawBaseUrl, apiKey, modelId, extraHeaders, controller.signal);
        if (r.ok) return { ok: true, status: r.status, detectedKind: kind };
        // 留住「最该报给用户」的错：非 mismatch（鉴权/请求错，可操作）优先于 mismatch（换协议）。
        if (!best || (best.mismatch && !r.mismatch)) best = { ...r, kind };
      }
      return { ok: false, status: best?.status, error: best?.error || "连接失败", detectedKind: forcedKind };
    } finally {
      clearTimeout(timeout);
    }
  });

  // Auto-discover the endpoint's models via the standard list-models call, so the
  // user picks from real model ids instead of guessing/typing. Relays are usually
  // OpenAI-compatible and expose this; when they don't, the UI falls back to manual
  // id entry (this just returns ok:false and nothing is blocked).
  ipcMain.handle("nomi:onboarding:list-models", async (_event, payload: Record<string, unknown>) => {
    // R1：唯一归一化器。openai-responses 与 openai-compatible 一样走 GET {baseUrl}/models。
    const providerKind = normalizeProviderKind(payload?.providerKind);
    const rawBaseUrl = String(payload?.baseUrl || "").trim().replace(/\/+$/, "");
    const baseUrl =
      providerKind === "anthropic" && !rawBaseUrl ? "https://api.anthropic.com" : rawBaseUrl;
    const apiKey = String(payload?.apiKey || "").trim();
    if (!/^https?:\/\//i.test(baseUrl)) return { ok: false, error: "接入地址需以 http:// 或 https:// 开头" };
    const extraHeaders: Record<string, string> = {};
    if (payload?.headers && typeof payload.headers === "object") {
      for (const [k, v] of Object.entries(payload.headers as Record<string, unknown>)) {
        const key = String(k).trim();
        const value = String(v ?? "").trim();
        if (key && value) extraHeaders[key] = value;
      }
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      // openai-compatible baseUrl already ends in /v1 → /models; anthropic baseUrl
      // is the host root → /v1/models.
      const url =
        providerKind === "anthropic" ? `${baseUrl}/v1/models` : `${baseUrl}/models`;
      const headers: Record<string, string> =
        providerKind === "anthropic"
          ? {
              "anthropic-version": "2023-06-01",
              ...(apiKey ? { "x-api-key": apiKey } : {}),
              ...extraHeaders,
            }
          : {
              ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
              ...extraHeaders,
            };
      const res = await fetch(url, { method: "GET", headers, signal: controller.signal });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, status: res.status, error: text.slice(0, 300) || `HTTP ${res.status}` };
      }
      const json = (await res.json().catch(() => null)) as { data?: Array<{ id?: unknown }> } | null;
      const models = Array.isArray(json?.data)
        ? json!.data.map((m) => String(m?.id || "").trim()).filter(Boolean)
        : [];
      return { ok: true, models };
    } catch (error) {
      return { ok: false, error: describeNetworkError(error) };
    } finally {
      clearTimeout(timeout);
    }
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
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (error) {
      const message = error instanceof Error ? error.message : "local asset not found";
      return new Response(message, { status: 404 });
    }
  });
}

app.whenReady().then(async () => {
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
