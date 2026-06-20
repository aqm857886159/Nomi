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
  workspace: {
    selectFolder: () => ipcRenderer.invoke("nomi:workspace:select-folder"),
    openFolder: (payload: unknown) => ipcRenderer.invoke("nomi:workspace:open-folder", payload),
    listFiles: (payload: unknown) => ipcRenderer.invoke("nomi:workspace:list-files", payload),
    revealFile: (payload: unknown) => ipcRenderer.invoke("nomi:workspace:reveal-file", payload),
    revealProjectFolder: (payload: unknown) => ipcRenderer.invoke("nomi:workspace:reveal-project-folder", payload),
  },
  projects: {
    list: () => invokeSync("nomi:projects:list"),
    create: (record: unknown) => invokeSync("nomi:projects:create", record),
    read: (projectId: string) => invokeSync("nomi:projects:read", projectId),
    save: (projectId: string, record: unknown) => invokeSync("nomi:projects:save", projectId, record),
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
  },
});
