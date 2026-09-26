import { contextBridge, ipcRenderer, webUtils } from "electron";
import { createCanvasReadSurfacePreloadBridge } from './surfacePortPreloadBridge';
import { getSetChannels, invokeSync } from "./preload/ipcCall";
// 四族桥面各自成模块（R9：preload.ts 是组装层，桥面本身不占它的额度）。形状逐字节不变。
import { creationBridge } from "./preload/creationBridge";
import { mediaBridge } from "./preload/mediaBridge";
import { modelOnboardingBridge } from "./preload/modelOnboardingBridge";
import { runtimeBridge } from "./preload/runtimeBridge";

type ProductionDeepLinkPayload = { projectId: string; runId?: string; nodeId?: string; artifactId?: string };
let queuedProductionDeepLink: ProductionDeepLinkPayload | null = null;
const productionDeepLinkListeners = new Set<(payload: ProductionDeepLinkPayload) => void>();
ipcRenderer.on("nomi:production-deep-link", (_event, payload: ProductionDeepLinkPayload) => {
  queuedProductionDeepLink = payload;
  for (const listener of productionDeepLinkListeners) listener(payload);
  if (productionDeepLinkListeners.size > 0) queuedProductionDeepLink = null;
});

contextBridge.exposeInMainWorld("nomiDesktop", {
  platform: process.platform,
  i18n: {
    setLocale: (locale: "zh-CN" | "en") => ipcRenderer.send("nomi:i18n:set-locale", locale),
    // 首启探测系统语言用；拿不到就返回 ""（渲染层据此回落默认语言，绝不抛断首帧）。
    // 测试铁律：E2E/走查默认关探测（否则跟随 CI 机器系统语言 → 全批中文选择器测试崩），
    // 回落默认中文；仅「首启语言探测」专项走查显式 NOMI_TEST_SYSTEM_LOCALE=1 才真探测。
    getSystemLocale: (): string => {
      if (process.env.NOMI_E2E === "1" && process.env.NOMI_TEST_SYSTEM_LOCALE !== "1") return "";
      try {
        return invokeSync<string>("nomi:i18n:get-system-locale");
      } catch {
        return "";
      }
    },
  },
  // 窗口控制（Windows 自绘标题栏用；mac 原生 chrome 不调用）。窄面：仅 min/max/close + 最大化态订阅。
  window: {
    minimize: () => ipcRenderer.invoke("nomi:window:minimize"),
    maximize: () => ipcRenderer.invoke("nomi:window:maximize"),
    close: () => ipcRenderer.invoke("nomi:window:close"),
    confirmClose: (requestId: string) =>
      ipcRenderer.send("nomi:window:close-response", { requestId, confirmed: true }),
    cancelClose: (requestId: string) =>
      ipcRenderer.send("nomi:window:close-response", { requestId, confirmed: false }),
    onCloseRequest: (cb: (payload: { requestId: string }) => void) => {
      const listener = (_: unknown, payload: { requestId: string }) => cb(payload);
      ipcRenderer.on("nomi:window:close-request", listener);
      return () => ipcRenderer.removeListener("nomi:window:close-request", listener);
    },
    onMaximized: (cb: (maximized: boolean) => void) => {
      const listener = (_: unknown, v: boolean) => cb(v);
      ipcRenderer.on("nomi:window:maximized", listener);
      return () => ipcRenderer.removeListener("nomi:window:maximized", listener);
    },
    onCanvasZoomShortcut: (cb: (direction: -1 | 1) => void) => {
      const listener = (_: unknown, direction: -1 | 1) => cb(direction);
      ipcRenderer.on("nomi:canvas:zoom-shortcut", listener);
      return () => ipcRenderer.removeListener("nomi:canvas:zoom-shortcut", listener);
    },
  },
  // 渲染层 → 主进程日志的唯一通道。渲染层只经 src/desktop/rendererLog.ts 调它；形状校验、脱敏、限流在主进程。
  log: {
    report: (entry: unknown) => ipcRenderer.send("nomi:log:renderer", entry),
  },
  app: {
    reopenLibraryWindow: () => ipcRenderer.send("nomi:app:reopen-library-window"),
    hardReloadWindow: () => ipcRenderer.send("nomi:app:hard-reload-window"),
    onProductionDeepLink: (cb: (payload: ProductionDeepLinkPayload) => void) => {
      productionDeepLinkListeners.add(cb);
      if (queuedProductionDeepLink) {
        const pending = queuedProductionDeepLink;
        queueMicrotask(() => cb(pending));
        queuedProductionDeepLink = null;
      }
      return () => productionDeepLinkListeners.delete(cb);
    },
  },
  settings: {
    projectLocation: {
      get: () => ipcRenderer.invoke("nomi:settings:project-location-get"),
      check: () => ipcRenderer.invoke("nomi:settings:project-location-check"),
      pick: () => ipcRenderer.invoke("nomi:settings:project-location-pick"),
      reset: () => ipcRenderer.invoke("nomi:settings:project-location-reset"),
      reveal: () => ipcRenderer.invoke("nomi:settings:project-location-reveal"),
    },
    automationPolicy: getSetChannels("nomi:settings:automation-policy-get", "nomi:settings:automation-policy-set"),
    assetRelay: getSetChannels("nomi:settings:asset-relay-get", "nomi:settings:asset-relay-set"),
    systemPrompts: getSetChannels("nomi:settings:system-prompts-get", "nomi:settings:system-prompts-set"),
    generationModelDefaults: getSetChannels("nomi:settings:generation-model-defaults-get", "nomi:settings:generation-model-defaults-set"),
    attentionSound: {
      get: () => ipcRenderer.invoke("nomi:settings:attention-sound-get"),
      set: (value: unknown) => ipcRenderer.invoke("nomi:settings:attention-sound-set", value),
      pick: () => ipcRenderer.invoke("nomi:settings:attention-sound-pick"),
      reset: () => ipcRenderer.invoke("nomi:settings:attention-sound-reset"),
      preview: () => ipcRenderer.invoke("nomi:settings:attention-sound-preview"),
      stop: () => ipcRenderer.invoke("nomi:settings:attention-sound-stop"),
    },
    vendorPreference: getSetChannels("nomi:settings:vendor-preference-get", "nomi:settings:vendor-preference-set"),
    modelBoxPreference: getSetChannels("nomi:settings:model-box-preference-get", "nomi:settings:model-box-preference-set"),
    canvasMenuPreference: getSetChannels("nomi:settings:canvas-menu-preference-get", "nomi:settings:canvas-menu-preference-set"),
    telemetry: {
      get: () => ipcRenderer.invoke("nomi:settings:telemetry-get"),
      set: (payload: unknown) => ipcRenderer.invoke("nomi:settings:telemetry-set", payload),
      summary: () => ipcRenderer.invoke("nomi:settings:telemetry-summary"),
      deleteAll: () => ipcRenderer.invoke("nomi:settings:telemetry-delete"),
    },
    diagnostics: {
      exportBundle: () => ipcRenderer.invoke("nomi:diagnostics:export"),
      openTraceDirectory: (laneName?: string) => ipcRenderer.invoke("nomi:diagnostics:open-agent-trace", laneName),
    },
  },
  telemetry: {
    track: (payload: unknown) => ipcRenderer.invoke("nomi:telemetry:track", payload),
  },
  feedback: {
    preview: (payload: unknown) => ipcRenderer.invoke("nomi:feedback:preview", payload),
    send: (payload: unknown) => ipcRenderer.invoke("nomi:feedback:send", payload),
  },
  browserChromeMenu: {
    select: (id: unknown) => ipcRenderer.send("browser:chrome-menu:select", id),
    cancel: () => ipcRenderer.send("browser:chrome-menu:cancel"),
  },
  proxy: {
    get: () => ipcRenderer.invoke("nomi:proxy:get"),
    set: (payload: unknown) => ipcRenderer.invoke("nomi:proxy:set", payload),
    test: () => ipcRenderer.invoke("nomi:proxy:test"),
  },
  workspace: {
    selectFolder: () => ipcRenderer.invoke("nomi:workspace:select-folder"),
    openFolder: (payload: unknown) => ipcRenderer.invoke("nomi:workspace:open-folder", payload),
    listFiles: (payload: unknown) => ipcRenderer.invoke("nomi:workspace:list-files", payload),
    revealFile: (payload: unknown) => ipcRenderer.invoke("nomi:workspace:reveal-file", payload),
    deleteFiles: (payload: unknown) => ipcRenderer.invoke("nomi:workspace:delete-files", payload),
    revealProjectFolder: (payload: unknown) => ipcRenderer.invoke("nomi:workspace:reveal-project-folder", payload),
    syncInspect: (payload: string | { projectId: string; adopt?: boolean }) => ipcRenderer.invoke("nomi:workspace:sync-inspect", payload),
    syncReveal: (projectId: string) => ipcRenderer.invoke("nomi:workspace:sync-reveal", projectId),
    syncCopyConflict: (payload: unknown) => ipcRenderer.invoke("nomi:workspace:sync-copy-conflict", payload),
  },
  // 系统通知：任务跑完且窗口失焦时才发（判失焦在渲染层，主进程只负责发+点击拉回窗口）。
  notifications: {
    show: (payload: unknown) => ipcRenderer.invoke("nomi:notifications:show", payload),
  },
  projects: {
    list: () => invokeSync("nomi:projects:list"),
    listAsync: () => ipcRenderer.invoke("nomi:projects:list-async"),
    create: (record: unknown) => invokeSync("nomi:projects:create", record),
    read: (projectId: string) => invokeSync("nomi:projects:read", projectId),
    readAsync: (projectId: string) => ipcRenderer.invoke("nomi:projects:read-async", projectId),
    diagnose: (projectId: string) => ipcRenderer.invoke("nomi:projects:diagnose", projectId),
    recover: (projectId: string) => ipcRenderer.invoke("nomi:projects:recover", projectId),
    save: (projectId: string, record: unknown) =>
      ipcRenderer.invoke("nomi:projects:save-async", projectId, record),
    delete: (projectId: string) => invokeSync("nomi:projects:delete", projectId),
  },
  clipboard: {
    readFilePaths: () => ipcRenderer.invoke("nomi:clipboard:read-file-paths") as Promise<string[]>,
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
  },
  // 这两支**故意**留在组装层，不随各族桥面搬家：它们里的 `vendorHealth.state` 与
  // `textBrain.status` 两个字面量联合是 check:vocabularies 在册的 debt site，而 debt 的身份
  // 含文件路径——搬一次家就被读成「新开一处 debt」，而真正的收敛（中立合同）是另一件事。
  onboarding: {
    integrationHandoffList: () => ipcRenderer.invoke("nomi:integration-handoff:list"),
    integrationHandoffAck: (requestId: string) => ipcRenderer.invoke("nomi:integration-handoff:ack", requestId),
    integrationHandoffSubscribe: (callback: (entry: unknown) => void) => {
      const listener = (_event: unknown, entry: unknown) => callback(entry)
      ipcRenderer.on("nomi:integration-handoff:changed", listener as never)
      ipcRenderer.send("nomi:integration-handoff:subscribe")
      return () => ipcRenderer.removeListener("nomi:integration-handoff:changed", listener as never)
    },
    integrationSessionSaveCredential: (payload: { sessionId: string; expectedRevision: number; apiKey: string }) =>
      ipcRenderer.invoke("nomi:integration-session:credential", payload),
    integrationSessionPrepareComfy: (payload: {
      vendorKey: string; name: string; workflow: string; binding: unknown; modelKey?: string;
      enumOptions?: unknown; uiWorkflow?: string;
    }) => ipcRenderer.invoke("nomi:integration-session:comfyui:prepare", payload),
    integrationSessionStartSelfCheck: (payload: { sessionId: string; expectedRevision: number }) =>
      ipcRenderer.invoke("nomi:integration-session:start-self-check", payload),
    integrationSessionGet: (sessionId: string) => ipcRenderer.invoke("nomi:integration-session:get", { sessionId }),
    antigravityStatus: () => ipcRenderer.invoke("nomi:antigravity:status"),
    antigravityTest: (payload?: unknown) => ipcRenderer.invoke("nomi:antigravity:test", payload),
    antigravityCancel: () => ipcRenderer.invoke("nomi:antigravity:cancel"),
    httpConnectionConfigure: (payload: unknown) =>
      ipcRenderer.invoke("nomi:integration-certification:http:configure", payload),
    httpCertificationStart: (payload: unknown) =>
      ipcRenderer.invoke("nomi:integration-certification:http:start", payload),
    certificationGet: (payload: unknown) =>
      ipcRenderer.invoke("nomi:integration-certification:get", payload),
    certificationCancel: (payload: unknown) =>
      ipcRenderer.invoke("nomi:integration-certification:cancel", payload),
    certificationList: (payload: unknown) =>
      ipcRenderer.invoke("nomi:integration-certification:list", payload),
    httpConnectionListModels: (payload: unknown) =>
      ipcRenderer.invoke("nomi:integration-certification:http:existing:list-models", payload),
    httpCertificationStartExisting: (payload: unknown) =>
      ipcRenderer.invoke("nomi:integration-certification:http:existing:start", payload),
    httpCertificationRetry: (payload: unknown) =>
      ipcRenderer.invoke("nomi:integration-certification:http:retry", payload),
    guessKinds: (payload: unknown) =>
      ipcRenderer.invoke("nomi:onboarding:guess-kinds", payload) as Promise<{
        kinds: Record<string, "text" | "image" | "video" | "audio">;
      }>,
    testConnection: (payload: unknown) =>
      ipcRenderer.invoke("nomi:onboarding:test-connection", payload) as Promise<{
        ok: boolean;
        status?: number;
        error?: string;
      }>,
    listModels: (payload: unknown) =>
      ipcRenderer.invoke("nomi:onboarding:list-models", payload) as Promise<{
        ok: boolean;
        models?: string[];
        status?: number;
        error?: string;
      }>,
    vendorHealth: (payload: unknown) =>
      ipcRenderer.invoke("nomi:onboarding:vendor-health", payload) as Promise<{
        vendorKey: string;
        state: "reachable" | "unreachable" | "unsupported";
        reason?: string;
        checkedAt: number;
      }>,
  },
  promptLibrary: {
    list: () =>
      ipcRenderer.invoke("nomi:prompt-library:list") as Promise<{ ok: boolean; prompts: unknown[]; error?: string }>,
    textBrain: () =>
      ipcRenderer.invoke("nomi:prompt-library:text-brain") as Promise<{
        ok: boolean;
        brain: { vendor: string; modelKey: string } | null;
        status: "ok" | "locked" | "missing";
      }>,
    userList: () =>
      ipcRenderer.invoke("nomi:prompt-library:user-list") as Promise<{
        ok: boolean;
        prompts: unknown[];
        error?: string;
      }>,
    userAdd: (input: { title?: string; prompt: string; promptType: "image" | "video"; tags?: string[]; referenceImages?: { url: string; title?: string; sourceUrl?: string }[] }) =>
      ipcRenderer.invoke("nomi:prompt-library:user-add", input) as Promise<{
        ok: boolean;
        prompts: unknown[];
        error?: string;
      }>,
    userUpdate: (id: string, patch: { title?: string; prompt?: string; promptType?: "image" | "video" }) =>
      ipcRenderer.invoke("nomi:prompt-library:user-update", { id, patch }) as Promise<{
        ok: boolean;
        prompts: unknown[];
        error?: string;
      }>,
    userDelete: (id: string) =>
      ipcRenderer.invoke("nomi:prompt-library:user-delete", { id }) as Promise<{
        ok: boolean;
        prompts: unknown[];
        error?: string;
      }>,
  },
  ...runtimeBridge,
  ...mediaBridge,
  ...creationBridge,
  ...modelOnboardingBridge,
  surface: createCanvasReadSurfacePreloadBridge(
    (channel, payload) => ipcRenderer.invoke(channel, payload),
    {
      subscribe: (channel, listener) => {
        const wrapped = (_event: unknown, payload: unknown) => listener(payload);
        ipcRenderer.on(channel, wrapped);
        return () => ipcRenderer.removeListener(channel, wrapped);
      },
      send: (channel, payload) => ipcRenderer.send(channel, payload),
    },
  ),
});
