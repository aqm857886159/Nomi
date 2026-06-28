import { contextBridge, ipcRenderer } from "electron";

type SyncResult<T> = { ok: true; value: T } | { ok: false; error: string };

function invokeSync<T>(channel: string, ...args: unknown[]): T {
  const result = ipcRenderer.sendSync(channel, ...args) as SyncResult<T>;
  if (!result || result.ok !== true) {
    throw new Error(result?.error || `Desktop IPC failed: ${channel}`);
  }
  return result.value;
}

contextBridge.exposeInMainWorld("nomiDesktop", {
  platform: process.platform,
  logRendererCrash: (message: unknown) => ipcRenderer.send("nomi:log:renderer-crash", message),
  app: {
    reopenLibraryWindow: () => ipcRenderer.send("nomi:app:reopen-library-window"),
    hardReloadWindow: () => ipcRenderer.send("nomi:app:hard-reload-window"),
  },
  workspace: {
    selectFolder: () => ipcRenderer.invoke("nomi:workspace:select-folder"),
    openFolder: (payload: unknown) => ipcRenderer.invoke("nomi:workspace:open-folder", payload),
    listFiles: (payload: unknown) => ipcRenderer.invoke("nomi:workspace:list-files", payload),
    revealFile: (payload: unknown) => ipcRenderer.invoke("nomi:workspace:reveal-file", payload),
    revealProjectFolder: (payload: unknown) => ipcRenderer.invoke("nomi:workspace:reveal-project-folder", payload),
  },
  projects: {
    list: () => invokeSync("nomi:projects:list"),
    listAsync: () => ipcRenderer.invoke("nomi:projects:list-async"),
    create: (record: unknown) => invokeSync("nomi:projects:create", record),
    read: (projectId: string) => invokeSync("nomi:projects:read", projectId),
    readAsync: (projectId: string) => ipcRenderer.invoke("nomi:projects:read-async", projectId),
    save: (projectId: string, record: unknown) => invokeSync("nomi:projects:save", projectId, record),
    saveAsync: (projectId: string, record: unknown) => ipcRenderer.invoke("nomi:projects:save-async", projectId, record),
    delete: (projectId: string) => invokeSync("nomi:projects:delete", projectId),
  },
  assets: {
    list: (payload: unknown) => ipcRenderer.invoke("nomi:assets:list", payload),
    importRemoteUrl: (payload: unknown) => ipcRenderer.invoke("nomi:assets:import-remote-url", payload),
    importFile: (payload: unknown) => ipcRenderer.invoke("nomi:assets:import-file", payload),
    download: (payload: unknown) =>
      ipcRenderer.invoke("nomi:assets:download", payload) as Promise<{
        ok: boolean;
        canceled?: boolean;
        path?: string;
      }>,
  },
  video: {
    extractFrame: (payload: unknown) =>
      ipcRenderer.invoke("nomi:video:extract-frame", payload) as Promise<{ url: string }>,
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
    writeTempInput: (payload: unknown) => ipcRenderer.invoke("nomi:exports:write-temp-input", payload),
    finishTempInput: (payload: unknown) => ipcRenderer.invoke("nomi:exports:finish-temp-input", payload),
    status: (jobId: string) => ipcRenderer.invoke("nomi:exports:status", jobId),
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
    run: (payload: unknown) => ipcRenderer.invoke("nomi:tasks:run", payload),
    result: (payload: unknown) => ipcRenderer.invoke("nomi:tasks:result", payload),
    // 付费守卫：真人确认后铸一次性令牌（绑 nodeIds），返回不透明 grantId 随生成请求下传。
    grantSpend: (payload: unknown) => ipcRenderer.invoke("nomi:tasks:grant-spend", payload) as Promise<{ grantId: string }>,
    // 文本任务流式（逐 token）：start 返回 streamId，onTextEvent 收 delta/done/error。
    runTextStream: (payload: unknown) =>
      ipcRenderer.invoke("nomi:tasks:text:stream", payload) as Promise<{ streamId: string }>,
    cancelTextStream: (streamId: string) =>
      ipcRenderer.invoke("nomi:tasks:text:cancel", { streamId }),
    onTextEvent: (streamId: string, callback: (event: unknown) => void) => {
      const listener = (_event: unknown, payload: { streamId: string; event: unknown }) => {
        if (payload && payload.streamId === streamId) callback(payload.event);
      };
      ipcRenderer.on("nomi:tasks:text:event", listener as never);
      return () => {
        ipcRenderer.removeListener("nomi:tasks:text:event", listener as never);
      };
    },
  },
  events: {
    append: (projectId: string, events: unknown[]) =>
      ipcRenderer.invoke("nomi:events:append", { projectId, events }) as Promise<{ ok: boolean; count: number; lastSeq: number }>,
    read: (projectId: string, fromSeq: number) =>
      ipcRenderer.invoke("nomi:events:read", { projectId, fromSeq }) as Promise<{ ok: boolean; events: unknown[] }>,
  },
  memory: {
    get: (projectId: string) =>
      ipcRenderer.invoke("nomi:memory:get", { projectId }) as Promise<{ ok: boolean; facts: unknown[] }>,
    update: (projectId: string, factId: string, patch: { text?: string; pinned?: boolean }) =>
      ipcRenderer.invoke("nomi:memory:update", { projectId, factId, patch }) as Promise<{ ok: boolean; facts: unknown[] }>,
    remove: (projectId: string, factId: string) =>
      ipcRenderer.invoke("nomi:memory:remove", { projectId, factId }) as Promise<{ ok: boolean; facts: unknown[] }>,
    add: (projectId: string, text: string, kind?: string) =>
      ipcRenderer.invoke("nomi:memory:add", { projectId, text, kind }) as Promise<{ ok: boolean; facts: unknown[] }>,
  },
  promptLibrary: {
    list: () => ipcRenderer.invoke("nomi:prompt-library:list") as Promise<{ ok: boolean; prompts: unknown[]; error?: string }>,
    textBrain: () => ipcRenderer.invoke("nomi:prompt-library:text-brain") as Promise<{ ok: boolean; brain: { vendor: string; modelKey: string } | null }>,
    userList: () => ipcRenderer.invoke("nomi:prompt-library:user-list") as Promise<{ ok: boolean; prompts: unknown[]; error?: string }>,
    userAdd: (input: { title?: string; prompt: string; promptType: "image" | "video" }) =>
      ipcRenderer.invoke("nomi:prompt-library:user-add", input) as Promise<{ ok: boolean; prompts: unknown[]; error?: string }>,
    userUpdate: (id: string, patch: { title?: string; prompt?: string; promptType?: "image" | "video" }) =>
      ipcRenderer.invoke("nomi:prompt-library:user-update", { id, patch }) as Promise<{ ok: boolean; prompts: unknown[]; error?: string }>,
    userDelete: (id: string) =>
      ipcRenderer.invoke("nomi:prompt-library:user-delete", { id }) as Promise<{ ok: boolean; prompts: unknown[]; error?: string }>,
  },
  review: {
    onEvent: (callback: (payload: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on("nomi:review:event", listener as never);
      return () => ipcRenderer.removeListener("nomi:review:event", listener as never);
    },
  },
  conversations: {
    read: (projectId: string) => ipcRenderer.invoke("nomi:conversations:read", { projectId }),
    write: (projectId: string, payload: { creation: unknown; generation: unknown; committedProposal?: unknown }) =>
      ipcRenderer.invoke("nomi:conversations:write", { projectId, ...payload }),
  },
  agents: {
    chatV2Start: (payload: unknown) => ipcRenderer.invoke("nomi:agents:chatV2:start", payload) as Promise<{ sessionId: string }>,
    confirmTool: (sessionId: string, toolCallId: string, decision: unknown) =>
      ipcRenderer.invoke("nomi:agents:chatV2:confirmTool", { sessionId, toolCallId, decision }),
    cancelChatV2: (sessionId: string) =>
      ipcRenderer.invoke("nomi:agents:chatV2:cancel", { sessionId }),
    clearChatV2Session: (sessionKey: string) =>
      ipcRenderer.invoke("nomi:agents:chatV2:clearSession", { sessionKey }),
    seedChatV2Session: (sessionKey: string, messages: Array<{ role: string; content: string }>) =>
      ipcRenderer.invoke("nomi:agents:chatV2:seedSession", { sessionKey, messages }),
    chatV2SessionAlive: (sessionKey: string) =>
      ipcRenderer.invoke("nomi:agents:chatV2:sessionAlive", { sessionKey }) as Promise<{ alive: boolean }>,
    onChatV2Event: (sessionId: string, callback: (event: unknown) => void) => {
      const listener = (_event: unknown, payload: { sessionId: string; event: unknown }) => {
        if (payload && payload.sessionId === sessionId) callback(payload.event);
      };
      ipcRenderer.on("nomi:agents:chatV2:event", listener as never);
      return () => {
        ipcRenderer.removeListener("nomi:agents:chatV2:event", listener as never);
      };
    },
  },
  onboarding: {
    manualCommit: (payload: unknown) =>
      ipcRenderer.invoke("nomi:onboarding:manual-commit", payload) as Promise<{
        ok: boolean;
        vendorKey?: string;
        committed?: Array<{ modelKey: string; displayName: string }>;
        error?: string;
      }>,
    guessKinds: (payload: unknown) =>
      ipcRenderer.invoke("nomi:onboarding:guess-kinds", payload) as Promise<{
        kinds: Record<string, "text" | "image" | "video">;
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
  },
  update: {
    appInfo: () => ipcRenderer.invoke("nomi:app:version"),
    check: () => ipcRenderer.invoke("nomi:update:check"),
    download: () => ipcRenderer.invoke("nomi:update:download"),
    install: () => ipcRenderer.invoke("nomi:update:install"),
    openRelease: () => ipcRenderer.invoke("nomi:update:open-release"),
    onEvent: (callback: (event: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on("nomi:update:event", listener as never);
      return () => {
        ipcRenderer.removeListener("nomi:update:event", listener as never);
      };
    },
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
    clearVendorApiKey: (vendorKey: string) =>
      invokeSync("nomi:model-catalog:vendor-api-key:clear", vendorKey),
    upsertModel: (payload: unknown) => invokeSync("nomi:model-catalog:model:upsert", payload),
    deleteModel: (vendorKey: string, modelKey: string) =>
      invokeSync("nomi:model-catalog:model:delete", vendorKey, modelKey),
    upsertMapping: (payload: unknown) => invokeSync("nomi:model-catalog:mapping:upsert", payload),
    deleteMapping: (id: string) => invokeSync("nomi:model-catalog:mapping:delete", id),
    exportPackage: (params?: unknown) => invokeSync("nomi:model-catalog:export", params),
    importPackage: (payload: unknown) => invokeSync("nomi:model-catalog:import", payload),
    testMapping: (id: string, payload: unknown) => ipcRenderer.invoke("nomi:model-catalog:mapping:test", id, payload),
    fetchDocs: (payload: unknown) => ipcRenderer.invoke("nomi:model-catalog:docs:fetch", payload),
  },
  skill: {
    list: () => invokeSync("nomi:skill:list"),
    exportPackage: (dirName: string) => invokeSync("nomi:skill:export", dirName),
    importPackage: (payload: unknown) => invokeSync("nomi:skill:import", payload),
    deleteByDir: (dirName: string) => invokeSync("nomi:skill:delete", dirName),
  },
  // 能力核：上报当前窗口打开的项目，供外部调用的 A/B 路由（决定走渲染层网关还是磁盘网关）。
  capability: {
    setActiveProject: (projectId: string) => ipcRenderer.send("nomi:capability:active-project", projectId),
    // 「接入 AI 编程助手」卡：读状态/配置 + 一键写入/撤销 ~/.claude.json。
    mcpInfo: () => invokeSync("nomi:capability:mcp-info"),
    installMcp: (client?: string) => invokeSync("nomi:capability:mcp-install", client),
    uninstallMcp: (client?: string) => invokeSync("nomi:capability:mcp-uninstall", client),
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
});
