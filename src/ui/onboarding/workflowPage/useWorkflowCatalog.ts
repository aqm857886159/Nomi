/**
 * 工作流设置整页的数据层：后端清单 / 这台的工作流 / 原始 JSON 草稿 / 缺件对账 / 连通探测。
 * plan: docs/plan/2026-08-12-model-settings-home-and-comfyui-workflow-page.md
 *
 * 全部走既有 IPC，**后端零改动**：listVendors / listModels / listMappings / probeComfyui /
 * reconcileComfyWorkflows。抽成 hook 是为了让页面组件只管「摆」和「改」，不被取数撑爆
 * （R9：写码前想清楚分层）。
 */
import React from 'react'
import { getDesktopBridge } from '../../../desktop/bridge'
import { isComfyuiVendorKey } from '../../../workbench/generationCanvas/model/comfyuiVendor'
import { COMFYUI_VENDOR_KEY } from '../ComfyuiLocalCard'
import { workflowMediaBindings, type WorkflowBinding } from '../comfyuiWorkflowBinding'
import type { EnumOption } from '../comfyuiCanvasPreview'
import type { BackendRow, WorkflowRow } from './WorkflowSidebar'

/** 内置文生图：没有原始 JSON 草稿，绑定改不了（列出来但标 builtin）。 */
export const BUILTIN_COMFYUI_TXT2IMG_MODEL_KEY = 'comfyui-txt2img'

export type WorkflowDraft = { text: string; binding?: WorkflowBinding; uiWorkflowText?: string }
export type WorkflowReconcile = {
  serverReachable: boolean
  unknownNodeTypes: string[]
  missingEnumValues: Array<{ nodeId: string; classType: string; inputKey: string; value: string }>
  enumOptions?: EnumOption[]
}

type RawModel = { modelKey: string; labelZh: string; kind?: string; enabled: boolean; meta?: unknown }

/** meta 里的导入草稿（新导入都有）。 */
function readWorkflowDraft(meta: unknown): WorkflowDraft | null {
  if (!meta || typeof meta !== 'object') return null
  const draft = (meta as { comfyWorkflowImport?: unknown }).comfyWorkflowImport
  if (!draft || typeof draft !== 'object') return null
  const text = (draft as { text?: unknown }).text
  const binding = (draft as { binding?: unknown }).binding
  const uiWorkflowText = (draft as { uiWorkflowText?: unknown }).uiWorkflowText
  if (typeof text !== 'string' || !binding || typeof binding !== 'object') return null
  return { text, binding: binding as WorkflowBinding, ...(typeof uiWorkflowText === 'string' ? { uiWorkflowText } : {}) }
}

/** 老导入没存草稿时，从 mapping 里的模板图回填正文（绑定回落到重新自动识别）。 */
function readDraftFromMapping(
  mappings: Array<Record<string, unknown>>,
  modelKey: string,
  vendorKey: string,
): WorkflowDraft | null {
  const mapping = mappings.find((item) => item.vendorKey === vendorKey && item.modelKey === modelKey)
  const create = mapping?.create
  const body = create && typeof create === 'object' ? (create as { body?: unknown }).body : null
  const prompt = body && typeof body === 'object' ? (body as { prompt?: unknown }).prompt : null
  if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) return null
  return { text: JSON.stringify(prompt, null, 2) }
}

/** 画布上会有几个可填字段 = 角色槽 + 可调字段（和左栏预览同口径，别让列表和预览各报一个数）。 */
function fieldCountOf(binding: WorkflowBinding | undefined): number {
  if (!binding) return 0
  let count = (binding.params ?? binding.numeric ?? []).length
  if (binding.promptNodeId && binding.promptInputKey) count += 1
  count += workflowMediaBindings(binding).length
  return count
}

export type WorkflowCatalog = {
  /** False until this backend's local catalog has loaded; an empty loaded catalog is still ready. */
  ready: boolean
  backends: BackendRow[]
  workflows: WorkflowRow[]
  /** 选中这台的工作流原始 JSON + 已存绑定。 */
  draftOf: (modelKey: string) => WorkflowDraft | null
  labelOf: (modelKey: string) => string
  /** 选中这台的缺件对账（含 enumOptions，保存时要烤回参数控件）。 */
  reconcileOf: (modelKey: string) => WorkflowReconcile | null
  reachable: boolean | null
  refresh: () => void
}

export function useWorkflowCatalog(vendorKey: string, refreshToken: number): WorkflowCatalog {
  const [version, setVersion] = React.useState(0)
  const [vendors, setVendors] = React.useState<Array<{ key: string; name: string; baseUrl: string; enabled: boolean }>>([])
  const [models, setModels] = React.useState<RawModel[]>([])
  const [mappings, setMappings] = React.useState<Array<Record<string, unknown>>>([])
  const [reconciles, setReconciles] = React.useState<Map<string, WorkflowReconcile>>(new Map())
  const [probes, setProbes] = React.useState<Map<string, boolean>>(new Map())
  const [loadedVendorKey, setLoadedVendorKey] = React.useState<string | null>(null)

  const refresh = React.useCallback(() => setVersion((v) => v + 1), [])

  // 目录（同步 IPC）。vendorKey 变 → 重取这台的模型与 mapping。
  React.useEffect(() => {
    const catalog = getDesktopBridge()?.modelCatalog
    if (!catalog) return
    try {
      const allVendors = catalog.listVendors() as Array<Record<string, unknown>>
      setVendors(
        allVendors
          .filter((v) => isComfyuiVendorKey(String(v.key)))
          // 第一台恒排最前，其余按 key 稳定排序（避免顺序抖动导致列表跳位）。
          .sort((a, b) => {
            const [ka, kb] = [String(a.key), String(b.key)]
            return ka === COMFYUI_VENDOR_KEY ? -1 : kb === COMFYUI_VENDOR_KEY ? 1 : ka.localeCompare(kb)
          })
          .map((v) => ({
            key: String(v.key),
            name: String(v.name || v.key),
            baseUrl: String(v.baseUrlHint || 'http://127.0.0.1:8188'),
            enabled: v.enabled !== false,
          })),
      )
      const allModels = catalog.listModels() as Array<Record<string, unknown>>
      setModels(
        allModels
          .filter((m) => String(m.vendorKey) === vendorKey)
          .map((m) => ({
            modelKey: String(m.modelKey),
            labelZh: String(m.labelZh || m.modelKey),
            kind: typeof m.kind === 'string' ? m.kind : undefined,
            enabled: m.enabled !== false,
            meta: m.meta,
          })),
      )
      setMappings(catalog.listMappings({ vendorKey }) as Array<Record<string, unknown>>)
    } catch {
      setVendors([])
      setModels([])
      setMappings([])
    } finally {
      setLoadedVendorKey(vendorKey)
    }
  }, [vendorKey, version, refreshToken])

  const draftOf = React.useCallback(
    (modelKey: string): WorkflowDraft | null => {
      const model = models.find((m) => m.modelKey === modelKey)
      if (!model) return null
      return readWorkflowDraft(model.meta) ?? readDraftFromMapping(mappings, modelKey, vendorKey)
    },
    [models, mappings, vendorKey],
  )

  const labelOf = React.useCallback(
    (modelKey: string): string => models.find((m) => m.modelKey === modelKey)?.labelZh ?? modelKey,
    [models],
  )

  // 连通探测：每台一次。地址变了要重探（否则改完地址状态点还停在旧结论上）。
  const addresses = vendors.map((v) => `${v.key}|${v.baseUrl}`).join(',')
  React.useEffect(() => {
    const probe = getDesktopBridge()?.modelCatalog?.probeComfyui
    if (!probe) return
    let alive = true
    setProbes(new Map())
    for (const vendor of vendors) {
      void probe(vendor.baseUrl)
        .then((result) => {
          if (!alive) return
          setProbes((current) => new Map(current).set(vendor.key, Boolean(result?.ok)))
        })
        .catch(() => {
          if (alive) setProbes((current) => new Map(current).set(vendor.key, false))
        })
    }
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addresses])

  // 缺件对账：整台的草稿一次批量问询，共享一份 /object_info；旧 preload 回落单条接口。
  // seq 防串台——快速切后端时旧请求晚到不许覆盖新结果（同 ComfyuiWorkflowImportPanel 的做法）。
  const reconcileSeq = React.useRef(0)
  const draftSignature = models.map((m) => m.modelKey).join(',')
  React.useEffect(() => {
    const catalog = getDesktopBridge()?.modelCatalog
    const batchCall = catalog?.reconcileComfyWorkflows
    const singleCall = catalog?.reconcileComfyWorkflow
    if (!batchCall && !singleCall) return
    const seq = ++reconcileSeq.current
    setReconciles(new Map())
    const items = models.flatMap((model) => {
      const draft = draftOf(model.modelKey)
      return draft ? [{ id: model.modelKey, text: draft.text }] : []
    })
    if (items.length === 0) return
    if (batchCall) {
      void batchCall(items, vendorKey)
        .then((response) => {
          if (reconcileSeq.current !== seq || !response?.ok) return
          const next = new Map<string, WorkflowReconcile>()
          for (const item of response.results) {
            if (item.result.ok) next.set(item.id, item.result as WorkflowReconcile)
          }
          setReconciles(next)
        })
        .catch(() => undefined)
      return
    }
    for (const item of items) {
      void singleCall?.(item.text, vendorKey).then((result) => {
        if (reconcileSeq.current !== seq || !result?.ok) return
        setReconciles((current) => new Map(current).set(item.id, result as WorkflowReconcile))
      }).catch(() => undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftSignature, vendorKey, version, refreshToken])

  const backends: BackendRow[] = vendors.map((vendor) => ({
    vendorKey: vendor.key,
    name: vendor.name,
    baseUrl: vendor.baseUrl,
    workflowCount: vendor.key === vendorKey ? models.length : 0,
    reachable: probes.has(vendor.key) ? (probes.get(vendor.key) as boolean) : null,
    removable: vendor.key !== COMFYUI_VENDOR_KEY,
  }))

  const workflows: WorkflowRow[] = models.map((model) => {
    const draft = draftOf(model.modelKey)
    const reconcile = reconciles.get(model.modelKey) ?? null
    return {
      modelKey: model.modelKey,
      labelZh: model.labelZh,
      kind: model.kind,
      fieldCount: fieldCountOf(draft?.binding),
      missing: reconcile && reconcile.serverReachable
        ? { nodes: reconcile.unknownNodeTypes.length, files: reconcile.missingEnumValues.length }
        : null,
      missingFileNames: reconcile && reconcile.serverReachable
        ? reconcile.missingEnumValues.map((item) => item.value)
        : [],
      offline: Boolean(reconcile && !reconcile.serverReachable),
      builtin: model.modelKey === BUILTIN_COMFYUI_TXT2IMG_MODEL_KEY || !draft,
    }
  })

  return {
    ready: loadedVendorKey === vendorKey,
    backends,
    workflows,
    draftOf,
    labelOf,
    reconcileOf: React.useCallback((modelKey: string) => reconciles.get(modelKey) ?? null, [reconciles]),
    reachable: probes.has(vendorKey) ? (probes.get(vendorKey) as boolean) : null,
    refresh,
  }
}
