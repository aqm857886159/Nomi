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
  },
  exports: {
    start: (payload: unknown) => ipcRenderer.invoke("nomi:exports:start", payload),
    showInFolder: (filePath: string) => ipcRenderer.invoke("nomi:exports:show-in-folder", filePath),
  },
  tasks: {
    run: (payload: unknown) => ipcRenderer.invoke("nomi:tasks:run", payload),
    result: (payload: unknown) => ipcRenderer.invoke("nomi:tasks:result", payload),
  },
  agents: {
    chat: (payload: unknown) => ipcRenderer.invoke("nomi:agents:chat", payload),
    chatV2Start: (payload: unknown) => ipcRenderer.invoke("nomi:agents:chatV2:start", payload) as Promise<{ sessionId: string }>,
    confirmTool: (sessionId: string, toolCallId: string, decision: unknown) =>
      ipcRenderer.invoke("nomi:agents:chatV2:confirmTool", { sessionId, toolCallId, decision }),
    cancelChatV2: (sessionId: string) =>
      ipcRenderer.invoke("nomi:agents:chatV2:cancel", { sessionId }),
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
});
