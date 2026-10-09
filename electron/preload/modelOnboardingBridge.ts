/**
 * 接入模型一族（引导 / 模型目录 / 连接器 / 更新）的 preload 桥面。
 *
 * 从 electron/preload.ts 抽出来（R9：preload.ts 顶着 800 行硬上限，每加一条桥都在撞线）。
 * 这里**只搬家、不改行为**：每个键、每条频道名、每句注释都逐字保留，preload.ts 用 `...modelOnboardingBridge` 组装，暴露给渲染层的对象形状逐字节不变。
 */
import { ipcRenderer } from "electron";
import { invokeSync, unwrapIpcResult } from "./ipcCall";

export const modelOnboardingBridge = {
  modelCatalog: {
    onChanged: (cb: () => void) => {
      const listener = () => cb();
      ipcRenderer.on("nomi:model-catalog:changed", listener);
      return () => ipcRenderer.removeListener("nomi:model-catalog:changed", listener);
    },
    listVendors: () => invokeSync("nomi:model-catalog:vendors:list"),
    listModels: (params?: unknown) => invokeSync("nomi:model-catalog:models:list", params),
    listMappings: (params?: unknown) => invokeSync("nomi:model-catalog:mappings:list", params),
    health: () => invokeSync("nomi:model-catalog:health"),
    upsertVendor: (payload: unknown) => invokeSync("nomi:model-catalog:vendor:upsert", payload),
    deleteVendor: (key: string) => invokeSync("nomi:model-catalog:vendor:delete", key),
    upsertVendorApiKey: async (vendorKey: string, payload: unknown) => {
      const channel = "nomi:model-catalog:vendor-api-key:upsert";
      return unwrapIpcResult(await ipcRenderer.invoke(channel, vendorKey, payload), channel);
    },
    clearVendorApiKey: (vendorKey: string) => invokeSync("nomi:model-catalog:vendor-api-key:clear", vendorKey),
    /** 「验这家的 key 要不要花钱、大概多少」——接入页按钮文案的唯一料源（T-MO-10）。 */
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
    exportPackage: () => invokeSync("nomi:model-catalog:export"),
    importPackage: (payload: unknown, options?: unknown) => invokeSync("nomi:model-catalog:import", payload, options),
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
  connector: {
    tikhub: {
      keyStatus: () => ipcRenderer.invoke("nomi:connector:tikhub:key-status") as Promise<unknown>,
      saveKey: (payload: unknown) => ipcRenderer.invoke("nomi:connector:tikhub:save-key", payload) as Promise<unknown>,
      clearKey: () => ipcRenderer.invoke("nomi:connector:tikhub:clear-key") as Promise<unknown>,
      routeStatus: () => ipcRenderer.invoke("nomi:connector:tikhub:route-status") as Promise<unknown>,
      setRoute: (payload: unknown) => ipcRenderer.invoke("nomi:connector:tikhub:set-route", payload) as Promise<unknown>,
      resolveShareUrl: (payload: unknown) => ipcRenderer.invoke("nomi:connector:tikhub:resolve-share-url", payload) as Promise<unknown>,
      importToProject: (payload: unknown) => ipcRenderer.invoke("nomi:connector:tikhub:import-to-project", payload) as Promise<unknown>,
      searchReferences: (payload: unknown) => ipcRenderer.invoke("nomi:connector:tikhub:search-references", payload) as Promise<unknown>,
      importReference: (payload: unknown) => ipcRenderer.invoke("nomi:connector:tikhub:import-reference", payload) as Promise<unknown>,
    },
  },
  update: {
    appInfo: () => ipcRenderer.invoke("nomi:app:version"),
    check: () => ipcRenderer.invoke("nomi:update:check"),
    download: () => ipcRenderer.invoke("nomi:update:download"),
    install: () => ipcRenderer.invoke("nomi:update:install"),
    openDownload: () => ipcRenderer.invoke("nomi:update:open-download"),
    snapshot: () => ipcRenderer.invoke("nomi:update:snapshot"),
    reportBusy: (count: number) => ipcRenderer.invoke("nomi:update:report-busy", count),
    dismiss: (request: unknown) => ipcRenderer.invoke("nomi:update:dismiss", request),
    onEvent: (callback: (event: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on("nomi:update:event", listener as never);
      return () => {
        ipcRenderer.removeListener("nomi:update:event", listener as never);
      };
    },
  },
};
