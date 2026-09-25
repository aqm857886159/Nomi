/**
 * 接入模型面（供应商目录、映射、ComfyUI workflow 导入）的桥面形状。
 *
 * 从 src/desktop/bridge.ts 抽出来（R9）。只搬家、不改形状；bridge.ts 用
 * `modelCatalog: DesktopModelCatalogSurface` 组装。
 */
import type { CustomCallBridge } from './modelCatalogBridgeTypes'
import type { ComfyWorkflowMutationResult } from './comfyCandidateContracts'

export type DesktopModelCatalogSurface = CustomCallBridge & {
  onChanged?: (cb: () => void) => () => void
  listVendors: () => unknown[]
  listModels: (params?: unknown) => unknown[]
  listMappings: (params?: unknown) => unknown[]
  health: () => unknown
  upsertVendor: (payload: unknown) => unknown
  deleteVendor: (key: string) => void
  upsertVendorApiKey: (vendorKey: string, payload: unknown) => Promise<unknown>
  clearVendorApiKey: (vendorKey: string) => unknown
  /**
   * 「验这家的 key 要不要花钱、大概多少」。旧 preload 没有这个方法 → 可选，调用方须兜住
   * undefined（兜不住时按「说不准」显示，**不许**默认显示「免费验证」）。
   */
  credentialProbePlan?: (vendorKey: string) => Promise<{ cost: 'free' | 'paid'; amount: number | null }>
  upsertModel: (payload: unknown) => unknown
  /**
   * 改类型 = 改 kind + 按新 kind 重建调用通道（单事务，见 electron/catalog/modelRetype.ts）。
   * 刻意不复用 upsertModel：只改 kind 不重建通道等于把「类型错」换成「没有通道」，仍然跑不了。
   * 可选（`?`）：旧 preload 没有这个方法，调用方须自己兜住 undefined。
   */
  retypeModel?: (payload: { vendorKey: string; modelKey: string; kind: string }) => unknown
  deleteModel: (vendorKey: string, modelKey: string) => void
  deleteModels: (targets: { vendorKey: string; modelKey: string }[]) => void
  upsertMapping: (payload: unknown) => unknown
  deleteMapping: (id: string) => void
  /** 导出一份配置包；**不收参数**——密钥永远不跟着包走。 */
  exportPackage: () => unknown
  /** 导入；第二个参数是冲突处置（缺省 = 保留本机已有）。旧 preload 会忽略它。 */
  importPackage: (payload: unknown, options?: unknown) => unknown
  testMapping: (id: string, payload: unknown) => Promise<unknown>
  fetchDocs: (payload: unknown) => Promise<unknown>
  probeComfyui: (baseUrl?: string) => Promise<
    { ok: true; summary: string; version?: string; protocol?: 'enhanced' | 'compatibility' } | { ok: false; error: string }
  >
  /** 本地文本端口探测（Ollama 11434 / LM Studio 1234 / LocalAI 8080）+ 能力预检（判「支持 Agent / 仅对话 / 探不出」）。旧 preload 可能没有 → 可选。 */
  probeLocalTextEndpoints?: () => Promise<{ hits: Array<{ id: 'ollama' | 'lmstudio' | 'localai'; label: string; baseUrl: string; models: string[] }> }>
  probeLocalTextCapability?: (payload: { baseUrl: string; modelId: string }) => Promise<{ verdict: 'agent' | 'chat-only' | 'unknown'; detail?: string }>
  /** 校验 + 识别 workflow_api.json 可绑定节点（同步）。analysis 结构见 comfyuiWorkflowImport.WorkflowAnalysis。 */
  analyzeComfyWorkflow: (text: string) => { ok: true; analysis: unknown } | { ok: false; error: string }
  /** 缺件对账（异步问本机 /object_info）：缺节点类 + 引用了本机没有的模型文件 + combo 可选值。旧 preload 可能没有 → 可选。 */
  reconcileComfyWorkflow?: (text: string, vendorKey?: string) => Promise<
    | {
        ok: true
        serverReachable: boolean
        unknownNodeTypes: string[]
        missingEnumValues: Array<{ nodeId: string; classType: string; title?: string; inputKey: string; value: string }>
        enumOptions?: Array<{ classType: string; inputKey: string; options: Array<string | number | boolean> }>
        /** 没见过的 combo 外壳（node class + input key + 原始 spec），供「反馈给 Nomi」诊断用。旧 preload 可能没有 → UI 兜住 undefined。 */
        unknownComboShapes?: Array<{ classType: string; inputKey: string; spec: unknown }>
      }
    | { ok: false; error: string }
  >
  /** 设置页批量缺件对账：整台实例共享一次 /object_info，结果按 id 回传。 */
  reconcileComfyWorkflows?: (items: Array<{ id: string; text: string }>, vendorKey?: string) => Promise<
    | {
        ok: true
        results: Array<{
          id: string
          result:
            | {
                ok: true
                serverReachable: boolean
                unknownNodeTypes: string[]
                missingEnumValues: Array<{ nodeId: string; classType: string; title?: string; inputKey: string; value: string }>
                enumOptions?: Array<{ classType: string; inputKey: string; options: Array<string | number | boolean> }>
                unknownComboShapes?: Array<{ classType: string; inputKey: string; spec: unknown }>
              }
            | { ok: false; error: string }
        }>
      }
    | { ok: false; error: string }
  >
  /** T1：贴什么格式都吃——界面格式借 ComfyUI 自己的前端转成 API 再分析。旧 preload 可能没有 → 可选。 */
  analyzeComfyWorkflowSmart?: (text: string, vendorKey?: string) => Promise<
    | { ok: true; analysis: unknown; convertedText?: string; sourceWorkflowText?: string }
    | { ok: false; error: string }
  >
  /** T2：读用户自己 ComfyUI 里的官方模板库（几百个）。null = 没连上/这台没有模板包。 */
  listComfyuiTemplates?: (vendorKey?: string) => Promise<Array<{
    name: string; title: string; description: string; group: string; groupType: string
    tags: string[]; tutorialUrl: string; thumbnailUrl: string
  }> | null>
  /** T2：取一个模板并备好导入所需（已转 API 格式 + 缺件对账 + combo 选项）。 */
  getComfyuiTemplateDetail?: (name: string, vendorKey?: string) => Promise<
    | {
        apiText: string
        uiWorkflowText: string
        unknownNodeTypes: string[]
        missingEnumValues: Array<{ nodeId: string; classType: string; title?: string; inputKey: string; value: string }>
        enumOptions: Array<{ classType: string; inputKey: string; options: Array<string | number | boolean> }>
        serverReachable: boolean
      }
    | { error: string }
  >
  /** ComfyUI 预置模板清单（S5）：静态数据，启用前走 reconcile 缺件闸。旧 preload 可能没有 → 可选。 */
  listComfyuiPresets?: () => Array<{
    key: string; labelZh: string; descZh: string; workflowText: string; binding: unknown
    models: Array<{ file: string; dir: string; url: string }>
  }>
  /** 按绑定落库为用户自有 model+mapping（同步）。enumOptions 可选 = combo 参数烤成真实文件下拉。 */
  importComfyWorkflow: (payload: { text: string; binding: unknown; labelZh: string; enumOptions?: unknown; vendorKey?: string; uiWorkflowText?: string }) =>
    ComfyWorkflowMutationResult
  /** 用同一 modelKey 更新已导入 workflow（同步）。 */
  updateComfyWorkflow?: (payload: { modelKey: string; text: string; binding: unknown; labelZh: string; enumOptions?: unknown; vendorKey?: string; uiWorkflowText?: string }) =>
    ComfyWorkflowMutationResult
}
