import { contextBridge, ipcRenderer, webUtils } from "electron";
import { importNativeFileFromPreload } from "./assets/nativeFileBridge";
import { createCanvasReadSurfacePreloadBridge } from './surfacePortPreloadBridge';
import type { ProjectAgentExecutionEvent, ProjectAgentPatch } from './shared/projectAgentContracts';

type SyncResult<T> = { ok: true; value: T } | { ok: false; error: string };
type ProductionDeepLinkPayload = { projectId: string; runId?: string; nodeId?: string; artifactId?: string };
let queuedProductionDeepLink: ProductionDeepLinkPayload | null = null;
const productionDeepLinkListeners = new Set<(payload: ProductionDeepLinkPayload) => void>();
ipcRenderer.on("nomi:production-deep-link", (_event, payload: ProductionDeepLinkPayload) => {
  queuedProductionDeepLink = payload;
  for (const listener of productionDeepLinkListeners) listener(payload);
  if (productionDeepLinkListeners.size > 0) queuedProductionDeepLink = null;
});

function invokeSync<T>(channel: string, ...args: unknown[]): T {
  const result = ipcRenderer.sendSync(channel, ...args) as SyncResult<T>;
  if (!result || result.ok !== true) {
    throw new Error(result?.error || `Desktop IPC failed: ${channel}`);
  }
  return result.value;
}

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
  logRendererCrash: (message: unknown) => ipcRenderer.send("nomi:log:renderer-crash", message),
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
      pick: () => ipcRenderer.invoke("nomi:settings:project-location-pick"),
      reset: () => ipcRenderer.invoke("nomi:settings:project-location-reset"),
      reveal: () => ipcRenderer.invoke("nomi:settings:project-location-reveal"),
    },
    automationPolicy: {
      get: () => ipcRenderer.invoke("nomi:settings:automation-policy-get"),
      set: (payload: unknown) => ipcRenderer.invoke("nomi:settings:automation-policy-set", payload),
    },
    assetRelay: {
      get: () => ipcRenderer.invoke("nomi:settings:asset-relay-get"),
      set: (payload: unknown) => ipcRenderer.invoke("nomi:settings:asset-relay-set", payload),
    },
    systemPrompts: {
      get: () => ipcRenderer.invoke("nomi:settings:system-prompts-get"),
      set: (payload: unknown) => ipcRenderer.invoke("nomi:settings:system-prompts-set", payload),
    },
    generationModelDefaults: {
      get: () => ipcRenderer.invoke("nomi:settings:generation-model-defaults-get"),
      set: (payload: unknown) => ipcRenderer.invoke("nomi:settings:generation-model-defaults-set", payload),
    },
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
    save: (projectId: string, record: unknown) => invokeSync("nomi:projects:save", projectId, record),
    saveAsync: (projectId: string, record: unknown) =>
      ipcRenderer.invoke("nomi:projects:save-async", projectId, record),
    delete: (projectId: string) => invokeSync("nomi:projects:delete", projectId),
  },
  clipboard: {
    readFilePaths: () => ipcRenderer.invoke("nomi:clipboard:read-file-paths") as Promise<string[]>,
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
  },
  productionRuns: {
    list: (projectId: string) => ipcRenderer.invoke("nomi:production-runs:list", { projectId }),
    read: (projectId: string, runId: string) => ipcRenderer.invoke("nomi:production-runs:read", { projectId, runId }),
    createDraft: (payload: unknown) => ipcRenderer.invoke("nomi:production-runs:create-draft", payload),
    command: (projectId: string, runId: string, command: unknown) =>
      ipcRenderer.invoke("nomi:production-runs:command", { projectId, runId, command }),
    materializeStoryboard: (projectId: string, runId: string, artifactId: string, expectedVersion: number) =>
      ipcRenderer.invoke("nomi:production-runs:materialize-storyboard", { projectId, runId, artifactId, expectedVersion }),
    events: (projectId: string, runId: string, afterCursor: number) =>
      ipcRenderer.invoke("nomi:production-runs:events", { projectId, runId, afterCursor }),
    // P4 S6：返工一镜（同 Run 新 Job + 单镜确认 + 派发）；续拍已停批次（manual=急停继续 / budget=提额续拍）。
    rework: (projectId: string, runId: string, shotId?: string) =>
      ipcRenderer.invoke("nomi:production-runs:rework", { projectId, runId, ...(shotId ? { shotId } : {}) }),
    resumeBatch: (projectId: string, runId: string, reason: "budget" | "manual") =>
      ipcRenderer.invoke("nomi:production-runs:resume-batch", { projectId, runId, reason }),
  },
  assets: {
    list: (payload: unknown) => ipcRenderer.invoke("nomi:assets:list", payload),
    // 素材文件夹（素材面收敛 2026-07-22 转正）：per-project 落盘,素材库唯一消费者。
    foldersGet: (payload: unknown) => ipcRenderer.invoke("nomi:assets:folders-get", payload),
    foldersSave: (payload: unknown) => ipcRenderer.invoke("nomi:assets:folders-save", payload),
    // 素材写入层（writeAsset/moveAssetFile）落盘即广播——素材库面板/素材盒徽章的统一回流信号，
    // 任何导入路径（浏览器捕捞/拖拽/上传/agent）免费获得刷新（M0 捕捞窗私有 onImported 的接任者）。
    onUpdated: (cb: (payload: unknown) => void) => {
      const listener = (_: unknown, v: unknown) => cb(v);
      ipcRenderer.on("nomi:assets:updated", listener);
      return () => ipcRenderer.removeListener("nomi:assets:updated", listener);
    },
    importRemoteUrl: (payload: unknown) => ipcRenderer.invoke("nomi:assets:import-remote-url", payload),
    importFile: (payload: unknown) => ipcRenderer.invoke("nomi:assets:import-file", payload),
    // 原生文件选择器返回的 File 由 preload 就地解析路径；路径不暴露给页面，且大视频不再整份穿过 renderer IPC。
    importNativeFile: (file: File, payload: Record<string, unknown>) => importNativeFileFromPreload(file, payload, {
      getPathForFile: (nativeFile) => webUtils.getPathForFile(nativeFile),
      invoke: (channel, request) => ipcRenderer.invoke(channel, request),
    }),
    copyFiles: (payload: unknown) => ipcRenderer.invoke("nomi:assets:copy-files", payload),
    copyProjectAsset: (payload: unknown) => ipcRenderer.invoke("nomi:assets:copy-project-asset", payload),
    // 播放懒自愈：nomi-local 视频解不了（HEVC 存量/供应商 HEVC 产物）→ 主进程转码出新 MP4 资产。
    ensurePlayable: (payload: unknown) => ipcRenderer.invoke("nomi:assets:ensure-playable", payload),
    // 引导示例项目：把随包成图落成项目资产，回 clientId → nomi-local URL（渲染侧算不出稳定地址）。
    seedOnboardingDemo: (payload: unknown) => ipcRenderer.invoke("nomi:assets:seed-onboarding-demo", payload),
    download: (payload: unknown) =>
      ipcRenderer.invoke("nomi:assets:download", payload) as Promise<{
        ok: boolean;
        canceled?: boolean;
        path?: string;
      }>,
    // 自动另存（生成完成即调，best-effort）+ 集中设置页读写/选目录。
    autoSave: (payload: unknown) =>
      ipcRenderer.invoke("nomi:assets:auto-save", payload) as Promise<{ ok: boolean; path?: string }>,
    getAutoSavePrefs: () =>
      ipcRenderer.invoke("nomi:settings:auto-save-get") as Promise<{ enabled: boolean; dir: string }>,
    setAutoSavePrefs: (payload: unknown) =>
      ipcRenderer.invoke("nomi:settings:auto-save-set", payload) as Promise<{ enabled: boolean; dir: string }>,
    pickSaveDir: () => ipcRenderer.invoke("nomi:settings:pick-dir") as Promise<{ dir: string }>,
  },
  browser: {
    createView: (payload: unknown) => ipcRenderer.invoke("browser:view:create", payload) as Promise<{ viewId: number }>,
    destroyView: (payload: unknown) => ipcRenderer.send("browser:view:destroy", payload),
    navigate: (payload: unknown) => ipcRenderer.send("browser:view:navigate", payload),
    back: (payload: unknown) => ipcRenderer.send("browser:view:back", payload),
    forward: (payload: unknown) => ipcRenderer.send("browser:view:forward", payload),
    reload: (payload: unknown) => ipcRenderer.send("browser:view:reload", payload),
    resize: (payload: unknown) => ipcRenderer.send("browser:view:resize", payload),
    show: (payload: unknown) => ipcRenderer.send("browser:view:show", payload),
    hide: (payload: unknown) => ipcRenderer.send("browser:view:hide", payload),
    importMedia: (payload: unknown) => ipcRenderer.invoke("browser:view:import-media", payload),
    capturePromptImage: (payload: unknown) => ipcRenderer.invoke("browser:view:capture-prompt-image", payload),
    selectPromptScreenshot: (payload: unknown) =>
      ipcRenderer.invoke("browser:view:select-prompt-screenshot", payload),
    capturePromptScreenshot: (payload: unknown) =>
      ipcRenderer.invoke("browser:view:capture-prompt-screenshot", payload),
    readPromptExtractionSettings: (payload: unknown) =>
      ipcRenderer.invoke("browser:prompt-extraction-settings:read", payload),
    writePromptExtractionSettings: (payload: unknown) =>
      ipcRenderer.invoke("browser:prompt-extraction-settings:write", payload),
    setResourceCapture: (payload: unknown) => ipcRenderer.send("browser:view:set-resource-capture", payload),
    captureResource: (payload: unknown) => ipcRenderer.send("browser:view:capture-resource", payload),
    showChromeMenu: (payload: unknown) => ipcRenderer.invoke("browser:chrome-menu:show", payload),
    assetOverlay: {
      open: (payload: unknown) => ipcRenderer.send("browser:asset-overlay:open", payload),
      updateHost: (payload: unknown) => ipcRenderer.send("browser:asset-overlay:update-host", payload),
      close: () => ipcRenderer.send("browser:asset-overlay:close"),
      captureRequest: (payload: unknown) => ipcRenderer.send("browser:asset-overlay:capture-request", payload),
      ready: () => ipcRenderer.send("browser:asset-overlay:ready"),
      setInteractive: (payload: unknown) => ipcRenderer.send("browser:asset-overlay:set-interactive", payload),
      finishDrag: () => ipcRenderer.send("browser:asset-overlay:finish-drag"),
      setState: (payload: unknown) => ipcRenderer.send("browser:asset-overlay:set-state", payload),
      importToCanvas: (payload: unknown) => ipcRenderer.send("browser:asset-overlay:import-to-canvas", payload),
      canvasImportAvailable: () => ipcRenderer.invoke("browser:asset-overlay:canvas-import-available"),
      onConfig: (callback: (event: unknown) => void) => {
        const listener = (_event: unknown, payload: unknown) => callback(payload);
        ipcRenderer.on("browser:asset-overlay:config", listener as never);
        return () => {
          ipcRenderer.removeListener("browser:asset-overlay:config", listener as never);
        };
      },
      onState: (callback: (event: unknown) => void) => {
        const listener = (_event: unknown, payload: unknown) => callback(payload);
        ipcRenderer.on("browser:asset-overlay:state", listener as never);
        return () => {
          ipcRenderer.removeListener("browser:asset-overlay:state", listener as never);
        };
      },
      onImportToCanvas: (callback: (event: unknown) => void) => {
        const listener = (_event: unknown, payload: unknown) => callback(payload);
        ipcRenderer.on("browser:asset-overlay:import-to-canvas", listener as never);
        return () => {
          ipcRenderer.removeListener("browser:asset-overlay:import-to-canvas", listener as never);
        };
      },
    },
    onPromptCapture: (callback: (event: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on("browser:view:prompt-capture", listener as never);
      return () => {
        ipcRenderer.removeListener("browser:view:prompt-capture", listener as never);
      };
    },
    onTextPromptSave: (callback: (event: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on("browser:view:text-prompt-save", listener as never);
      return () => {
        ipcRenderer.removeListener("browser:view:text-prompt-save", listener as never);
      };
    },
    onResourceCapture: (callback: (event: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on("browser:view:resource-capture", listener as never);
      return () => {
        ipcRenderer.removeListener("browser:view:resource-capture", listener as never);
      };
    },
    onState: (callback: (event: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on("browser:view:state", listener as never);
      return () => {
        ipcRenderer.removeListener("browser:view:state", listener as never);
      };
    },
  },
  video: {
    extractFrame: (payload: unknown) =>
      ipcRenderer.invoke("nomi:video:extract-frame", payload) as Promise<{ url: string }>,
    extractFilmstrip: (payload: unknown) =>
      ipcRenderer.invoke("nomi:video:extract-filmstrip", payload) as Promise<{ url: string; tiles: number; tileHeight: number }>,
    detectShotCuts: (payload: unknown) =>
      ipcRenderer.invoke("nomi:video:detect-shot-cuts", payload) as Promise<unknown>,
    deconstruct: (payload: unknown) =>
      ipcRenderer.invoke("nomi:video:deconstruct", payload) as Promise<unknown>,
  },
  connector: {
    tikhub: {
      keyStatus: () => ipcRenderer.invoke("nomi:connector:tikhub:key-status") as Promise<unknown>,
      saveKey: (payload: unknown) => ipcRenderer.invoke("nomi:connector:tikhub:save-key", payload) as Promise<unknown>,
      clearKey: () => ipcRenderer.invoke("nomi:connector:tikhub:clear-key") as Promise<unknown>,
      routeStatus: () => ipcRenderer.invoke("nomi:connector:tikhub:route-status") as Promise<unknown>,
      setRoute: (payload: unknown) => ipcRenderer.invoke("nomi:connector:tikhub:set-route", payload) as Promise<unknown>,
      resolveShareUrl: (payload: unknown) => ipcRenderer.invoke("nomi:connector:tikhub:resolve-share-url", payload) as Promise<unknown>,
      importToProject: (payload: unknown) => ipcRenderer.invoke("nomi:connector:tikhub:import-to-project", payload) as Promise<unknown>,
    },
  },
  screenshot: {
    get: () => ipcRenderer.invoke("nomi:screenshot:get") as Promise<unknown>,
    set: (payload: unknown) => ipcRenderer.invoke("nomi:screenshot:set", payload) as Promise<unknown>,
    openPermissionSettings: () => ipcRenderer.invoke("nomi:screenshot:open-permission-settings") as Promise<unknown>,
    setProjectId: (projectId: string) => ipcRenderer.invoke("nomi:screenshot:set-project", projectId) as Promise<unknown>,
    // 走查专用：对应的 handler 只在主进程 NOMI_E2E=1 时注册，生产环境这里会直接 reject（门禁在主进程侧）。
    e2eCapture: () => ipcRenderer.invoke("nomi:screenshot:e2e-capture") as Promise<unknown>,
    onCaptured: (cb: (payload: { url: string; width: number; height: number }) => void) => {
      const listener = (_: unknown, value: { url: string; width: number; height: number }) => cb(value);
      ipcRenderer.on("nomi:screenshot:captured", listener);
      return () => ipcRenderer.removeListener("nomi:screenshot:captured", listener);
    },
    onDenied: (cb: (payload: { screenAccess: string }) => void) => {
      const listener = (_: unknown, value: { screenAccess: string }) => cb(value);
      ipcRenderer.on("nomi:screenshot:denied", listener);
      return () => ipcRenderer.removeListener("nomi:screenshot:denied", listener);
    },
    onFailed: (cb: (payload: { reason: string }) => void) => {
      const listener = (_: unknown, value: { reason: string }) => cb(value);
      ipcRenderer.on("nomi:screenshot:failed", listener);
      return () => ipcRenderer.removeListener("nomi:screenshot:failed", listener);
    },
  },
  image: {
    decomposeLayers: (payload: unknown) =>
      ipcRenderer.invoke("nomi:image:decompose-layers", payload) as Promise<{ layers: string[] }>,
  },
  dreamina: {
    status: () => ipcRenderer.invoke("nomi:dreamina:status"),
    loginStart: () => ipcRenderer.invoke("nomi:dreamina:login-start"),
    loginPoll: (deviceCode: string) => ipcRenderer.invoke("nomi:dreamina:login-poll", deviceCode),
    logout: () => ipcRenderer.invoke("nomi:dreamina:logout"),
    install: () => ipcRenderer.invoke("nomi:dreamina:install"),
  },
  scene3d: {
    framesToVideo: (payload: unknown) =>
      ipcRenderer.invoke("nomi:scene3d:frames-to-video", payload) as Promise<{ url: string; assetId?: string }>,
  },
  exports: {
    startJob: (payload: unknown) => ipcRenderer.invoke("nomi:exports:start-job", payload),
    list: () => ipcRenderer.invoke("nomi:exports:list"),
    writeTempInput: (payload: unknown) => ipcRenderer.invoke("nomi:exports:write-temp-input", payload),
    finishTempInput: (payload: unknown) => ipcRenderer.invoke("nomi:exports:finish-temp-input", payload),
    status: (jobId: string) => ipcRenderer.invoke("nomi:exports:status", jobId),
    verify: (jobId: string) => ipcRenderer.invoke("nomi:exports:verify", jobId),
    cancel: (jobId: string) => ipcRenderer.invoke("nomi:exports:cancel", jobId),
    onEvent: (callback: (event: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on("nomi:exports:event", listener as never);
      return () => {
        ipcRenderer.removeListener("nomi:exports:event", listener as never);
      };
    },
    showInFolder: (payload: unknown) => ipcRenderer.invoke("nomi:exports:show-in-folder", payload),
  },
  tasks: {
    cancel: (taskId: string) => ipcRenderer.invoke("nomi:tasks:cancel", taskId) as Promise<{ ok: boolean }>,
    run: (payload: unknown) => ipcRenderer.invoke("nomi:tasks:run", payload),
    result: (payload: unknown) => ipcRenderer.invoke("nomi:tasks:result", payload),
    runComfyCandidateTest: (payload: unknown) => ipcRenderer.invoke("nomi:tasks:comfy-candidate-test", payload),
    cancelComfyCandidateTest: (payload: unknown) => ipcRenderer.invoke("nomi:tasks:comfy-candidate-cancel", payload),
    // 付费守卫：真人确认后铸一次性令牌（绑 nodeIds），返回不透明 grantId 随生成请求下传。
    grantSpend: (payload: unknown) =>
      ipcRenderer.invoke("nomi:tasks:grant-spend", payload) as Promise<{ grantId: string }>,
    // 文本任务流式（逐 token）：start 返回 streamId，onTextEvent 收 delta/done/error。
    runTextStream: (payload: unknown) =>
      ipcRenderer.invoke("nomi:tasks:text:stream", payload) as Promise<{ streamId: string }>,
    cancelTextStream: (streamId: string) => ipcRenderer.invoke("nomi:tasks:text:cancel", { streamId }),
    onTextEvent: (streamId: string, callback: (event: unknown) => void) => {
      const listener = (_event: unknown, payload: { streamId: string; event: unknown }) => {
        if (payload && payload.streamId === streamId) callback(payload.event);
      };
      ipcRenderer.on("nomi:tasks:text:event", listener as never);
      return () => {
        ipcRenderer.removeListener("nomi:tasks:text:event", listener as never);
      };
    },
    // ComfyUI ws 进度桥（P 轨）：watch 登记 → 主进程推 progress/preview/queue/done；interrupt=安全定向取消。
    comfyuiWatch: (payload: unknown) => ipcRenderer.invoke("nomi:tasks:comfyui:watch", payload),
    comfyuiUnwatch: (promptId: string) => ipcRenderer.invoke("nomi:tasks:comfyui:unwatch", promptId),
    comfyuiInterrupt: (promptId: string) => ipcRenderer.invoke("nomi:tasks:comfyui:interrupt", promptId),
    onComfyuiProgress: (callback: (event: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on("nomi:tasks:comfyui:progress", listener as never);
      return () => {
        ipcRenderer.removeListener("nomi:tasks:comfyui:progress", listener as never);
      };
    },
  },
  events: {
    append: (projectId: string, events: unknown[]) =>
      ipcRenderer.invoke("nomi:events:append", { projectId, events }) as Promise<{
        ok: boolean;
        count: number;
        lastSeq: number;
      }>,
    read: (projectId: string, fromSeq: number) =>
      ipcRenderer.invoke("nomi:events:read", { projectId, fromSeq }) as Promise<{ ok: boolean; events: unknown[] }>,
  },
  memory: {
    get: (projectId: string) =>
      ipcRenderer.invoke("nomi:memory:get", { projectId }) as Promise<{ ok: boolean; facts: unknown[] }>,
    update: (projectId: string, factId: string, patch: { text?: string; pinned?: boolean }) =>
      ipcRenderer.invoke("nomi:memory:update", { projectId, factId, patch }) as Promise<{
        ok: boolean;
        facts: unknown[];
      }>,
    remove: (projectId: string, factId: string) =>
      ipcRenderer.invoke("nomi:memory:remove", { projectId, factId }) as Promise<{ ok: boolean; facts: unknown[] }>,
    add: (projectId: string, text: string, kind?: string) =>
      ipcRenderer.invoke("nomi:memory:add", { projectId, text, kind }) as Promise<{ ok: boolean; facts: unknown[] }>,
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
  review: {
    onEvent: (callback: (payload: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on("nomi:review:event", listener as never);
      return () => ipcRenderer.removeListener("nomi:review:event", listener as never);
    },
  },
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
    integrationSessionConfirm: (payload: { sessionId: string; expectedRevision: number; challengeId: string }) =>
      ipcRenderer.invoke("nomi:integration-session:confirm", payload),
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
  update: {
    appInfo: () => ipcRenderer.invoke("nomi:app:version"),
    check: () => ipcRenderer.invoke("nomi:update:check"),
    download: () => ipcRenderer.invoke("nomi:update:download"),
    install: () => ipcRenderer.invoke("nomi:update:install"),
    openDownload: () => ipcRenderer.invoke("nomi:update:open-download"),
    onEvent: (callback: (event: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on("nomi:update:event", listener as never);
      return () => {
        ipcRenderer.removeListener("nomi:update:event", listener as never);
      };
    },
  },
  assetTransport: {
    /** 每种媒体类型现在实际会走的第一条上传通道（设置页状态卡；优先级真相在 main 的解析器里）。 */
    describeChannels: () => invokeSync("nomi:asset-transport:channels:describe"),
  },
  modelCatalog: {
    listVendors: () => invokeSync("nomi:model-catalog:vendors:list"),
    listModels: (params?: unknown) => invokeSync("nomi:model-catalog:models:list", params),
    listMappings: (params?: unknown) => invokeSync("nomi:model-catalog:mappings:list", params),
    health: () => invokeSync("nomi:model-catalog:health"),
    upsertVendor: (payload: unknown) => invokeSync("nomi:model-catalog:vendor:upsert", payload),
    deleteVendor: (key: string) => invokeSync("nomi:model-catalog:vendor:delete", key),
    upsertVendorApiKey: (vendorKey: string, payload: unknown) =>
      invokeSync("nomi:model-catalog:vendor-api-key:upsert", vendorKey, payload),
    clearVendorApiKey: (vendorKey: string) => invokeSync("nomi:model-catalog:vendor-api-key:clear", vendorKey),
    upsertModel: (payload: unknown) => invokeSync("nomi:model-catalog:model:upsert", payload),
    /** 改类型 = 改 kind + 按新 kind 重建调用通道（单事务）。见 catalog/modelRetype.ts。 */
    retypeModel: (payload: { vendorKey: string; modelKey: string; kind: string }) =>
      invokeSync("nomi:model-catalog:model:retype", payload),
    customCallContract: () => invokeSync("nomi:model-catalog:custom-call:contract"),
    customCallConfigGet: (vendorKey: string) =>
      invokeSync("nomi:model-catalog:custom-call:config:get", vendorKey),
    customCallConfigSave: (vendorKey: string, payload: unknown) =>
      invokeSync("nomi:model-catalog:custom-call:config:save", vendorKey, payload),
    customCallAiInstruction: (payload: unknown) => invokeSync("nomi:model-catalog:custom-call:ai-instruction", payload),
    customCallTestRun: (payload: unknown) => ipcRenderer.invoke("nomi:model-catalog:custom-call:test-run", payload),
    customCallTestGet: (payload: unknown) => ipcRenderer.invoke("nomi:model-catalog:custom-call:test-get", payload),
    customCallTestLatest: (payload: unknown) => ipcRenderer.invoke("nomi:model-catalog:custom-call:test-latest", payload),
    customCallTestCancel: (payload: unknown) => ipcRenderer.invoke("nomi:model-catalog:custom-call:test-cancel", payload),
    customCallDraftCreate: (payload: unknown) => invokeSync("nomi:model-catalog:custom-call:draft-create", payload),
    customCallDraftFinalize: (payload: unknown) => invokeSync("nomi:model-catalog:custom-call:draft-finalize", payload),
    deleteModel: (vendorKey: string, modelKey: string) =>
      invokeSync("nomi:model-catalog:model:delete", vendorKey, modelKey),
    deleteModels: (targets: { vendorKey: string; modelKey: string }[]) =>
      invokeSync("nomi:model-catalog:models:delete", targets),
    upsertMapping: (payload: unknown) => invokeSync("nomi:model-catalog:mapping:upsert", payload),
    deleteMapping: (id: string) => invokeSync("nomi:model-catalog:mapping:delete", id),
    exportPackage: (params?: unknown) => invokeSync("nomi:model-catalog:export", params),
    importPackage: (payload: unknown) => invokeSync("nomi:model-catalog:import", payload),
    testMapping: (id: string, payload: unknown) => ipcRenderer.invoke("nomi:model-catalog:mapping:test", id, payload),
    fetchDocs: (payload: unknown) => ipcRenderer.invoke("nomi:model-catalog:docs:fetch", payload),
    probeComfyui: (baseUrl?: string) => ipcRenderer.invoke("nomi:model-catalog:comfyui:probe", baseUrl),
    // 本地文本模型（Ollama / LM Studio / LocalAI）：探端口 + 能力预检。旧 preload 无此口 → UI 兜住 undefined。
    probeLocalTextEndpoints: () => ipcRenderer.invoke("nomi:local-text:probe"),
    probeLocalTextCapability: (payload: { baseUrl: string; modelId: string }) =>
      ipcRenderer.invoke("nomi:local-text:capability", payload),
    analyzeComfyWorkflow: (text: string) => invokeSync("nomi:model-catalog:comfyui:analyze-workflow", text),
    reconcileComfyWorkflow: (text: string, vendorKey?: string) =>
      ipcRenderer.invoke("nomi:model-catalog:comfyui:reconcile-workflow", text, vendorKey),
    reconcileComfyWorkflows: (items: Array<{ id: string; text: string }>, vendorKey?: string) =>
      ipcRenderer.invoke("nomi:model-catalog:comfyui:reconcile-workflows", items, vendorKey),
    // T1：贴什么格式都吃（界面格式借 ComfyUI 前端自动转 API）。
    analyzeComfyWorkflowSmart: (text: string, vendorKey?: string) =>
      ipcRenderer.invoke("nomi:model-catalog:comfyui:analyze-workflow-smart", text, vendorKey),
    // T2：读用户自己 ComfyUI 里的官方模板库。
    listComfyuiTemplates: (vendorKey?: string) =>
      ipcRenderer.invoke("nomi:model-catalog:comfyui:templates", vendorKey),
    getComfyuiTemplateDetail: (name: string, vendorKey?: string) =>
      ipcRenderer.invoke("nomi:model-catalog:comfyui:template-detail", name, vendorKey),
    listComfyuiPresets: () => invokeSync("nomi:model-catalog:comfyui:presets"),
    importComfyWorkflow: (payload: { text: string; binding: unknown; labelZh: string; enumOptions?: unknown; vendorKey?: string; uiWorkflowText?: string }) =>
      invokeSync("nomi:model-catalog:comfyui:import-workflow", payload),
    updateComfyWorkflow: (payload: { modelKey: string; text: string; binding: unknown; labelZh: string; enumOptions?: unknown; vendorKey?: string; uiWorkflowText?: string }) =>
      invokeSync("nomi:model-catalog:comfyui:update-workflow", payload),
  },
  skill: {
    list: () => invokeSync("nomi:skill:list"),
    exportPackage: (dirName: string) => invokeSync("nomi:skill:export", dirName),
    importPackage: (payload: unknown) => ipcRenderer.invoke("nomi:skill:import", payload),
    deleteByDir: (dirName: string) => invokeSync("nomi:skill:delete", dirName),
  },
  capability: {
    // 「接入 AI 编程助手」卡：读状态/配置 + 一键写入/撤销 ~/.claude.json。
    mcpInfo: () => invokeSync("nomi:capability:mcp-info"),
    installMcp: (client?: string) => invokeSync("nomi:capability:mcp-install", client),
    uninstallMcp: (client?: string) => invokeSync("nomi:capability:mcp-uninstall", client),
    // 自定义 MCP 客户端 profile（方案 A：任意支持 MCP stdio 的工具接入）。
    listCustomMcpProfiles: () => invokeSync("nomi:capability:mcp-custom-profiles"),
    registerCustomMcpProfile: (profile: unknown) => invokeSync("nomi:capability:mcp-custom-profile-register", profile),
    removeCustomMcpProfile: (key: string) => invokeSync("nomi:capability:mcp-custom-profile-remove", key),
    // 自定义客户端列表变化的实时回流：外部进程（mcpNodeLauncher）检测写入文件后，主进程 watch 到变化广播到这里。
    onMcpProfilesChanged: (cb: () => void) => {
      const listener = () => cb();
      ipcRenderer.on("nomi:mcp:profiles-changed", listener);
      return () => ipcRenderer.removeListener("nomi:mcp:profiles-changed", listener);
    },
    // 实连验证（异步）：真起一次配置里那条命令握手，用来分辨「配置里有这行字」和「还真连得上」。
    verifyMcp: (client?: string) => ipcRenderer.invoke("nomi:capability:mcp-verify", client),
    // A 模式实时桥：主进程把外部 MCP 的画布读/写/付费确认转发到这里，渲染层处理后回结果（按 id 配对）。
    onApply: (handler: (op: string, payload: unknown) => unknown | Promise<unknown>) => {
      const listener = (_event: unknown, message: { id?: number; op?: string; payload?: unknown }) => {
        const id = message?.id;
        void (async () => {
          try {
            const result = await handler(String(message?.op || ""), message?.payload);
            ipcRenderer.send("nomi:capability:apply-reply", { id, ok: true, result });
          } catch (error) {
            ipcRenderer.send("nomi:capability:apply-reply", {
              id,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        })();
      };
      ipcRenderer.on("nomi:capability:apply", listener);
      return () => ipcRenderer.removeListener("nomi:capability:apply", listener);
    },
  },
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
  projectAgent: {
    open: (binding: unknown) => ipcRenderer.invoke('nomi:projectAgent:open', { binding }),
    snapshot: (subscriptionId: string) => ipcRenderer.invoke('nomi:projectAgent:snapshot', { subscriptionId }),
    command: (command: unknown) => ipcRenderer.invoke('nomi:projectAgent:command', command),
    release: (subscriptionId: string) => ipcRenderer.invoke('nomi:projectAgent:release', { subscriptionId }),
    readProposalReceipt: (subscriptionId: string) =>
      ipcRenderer.invoke('nomi:projectAgent:proposalReceipt:read', { subscriptionId }),
    writeProposalReceipt: (subscriptionId: string, input: { expectedRevision: number; proposalId: string; operationId: string; lifecycle: string; proposal: unknown }) =>
      ipcRenderer.invoke('nomi:projectAgent:proposalReceipt:write', {
        subscriptionId,
        expectedRevision: input.expectedRevision,
        proposalId: input.proposalId,
        operationId: input.operationId,
        lifecycle: input.lifecycle,
        proposal: input.proposal,
      }),
    transitionProposalReceipt: (subscriptionId: string, input: { expectedRevision: number; proposalId: string; operationId: string; lifecycle: string }) =>
      ipcRenderer.invoke('nomi:projectAgent:proposalReceipt:transition', {
        subscriptionId,
        expectedRevision: input.expectedRevision,
        proposalId: input.proposalId,
        operationId: input.operationId,
        lifecycle: input.lifecycle,
      }),
    clearProposalReceipt: (subscriptionId: string, input: { expectedRevision: number; proposalId: string; operationId: string }) =>
      ipcRenderer.invoke('nomi:projectAgent:proposalReceipt:clear', { subscriptionId, ...input }),
    onPatch: (handler: (patch: ProjectAgentPatch) => void) => {
      const listener = (_event: unknown, payload: unknown) => {
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) handler(payload as ProjectAgentPatch);
      };
      ipcRenderer.on('nomi:projectAgent:patch', listener as never);
      return () => ipcRenderer.removeListener('nomi:projectAgent:patch', listener as never);
    },
    onEvent: (handler: (event: ProjectAgentExecutionEvent) => void) => {
      const listener = (_event: unknown, payload: unknown) => {
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) handler(payload as ProjectAgentExecutionEvent);
      };
      ipcRenderer.on('nomi:projectAgent:event', listener as never);
      return () => ipcRenderer.removeListener('nomi:projectAgent:event', listener as never);
    },
  },
});
