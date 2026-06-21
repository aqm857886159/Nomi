// 能力核 · 编排层（见 docs/plan/2026-06-20-capability-core-headless-exposure.md）。
//
// 把纯图操作（canvasGraph）接到真实的工程持久化（projects/repository）与生成引擎（runtime.runTask）。
// 这是「外部 agent / CLI / MCP 驱动 Nomi」的**主进程**单一执行口——所有传输（RPC / 头less host）
// 都调这里，不各自实现一遍（P1）。
//
// 模式说明：本文件实现 **B 模式**（app 关着，直接读写 project.json）。当 app 开着时，
// 工程的内存 store 才是真相、会防抖回盘覆盖文件改动（见 workbenchProjectSession），故 app 开着时
// 图变更必须经运行中实例（A 模式，rpcServer 转发给 renderer），不能在此直写文件。调用方（rpcServer/
// host）负责按「app 是否开着」选模式；本核只管把 B 模式做对、做纯。
//
// 真相源（P1）：generate 不重建 archetype→body——runTask 主进程内部据 catalog mapping + extras
// 自己组装请求体（findExecutableModel / requestPipeline / 资产本地化）。本核只构造高层 TaskRequest。
import { listProjects, readProject, saveProject, createProject, type ProjectRecord } from '../projects/repository'
import { readCatalog } from '../catalog/catalogStore'
import { mintSpendGrant } from '../spendGrant'
import {
  addNodes,
  connectNodes,
  deleteNodes,
  normalizeSnapshot,
  readCanvas,
  setNodePrompt,
  type CanvasSnapshot,
  type ConnectionSpec,
  type NodeSpec,
} from './canvasGraph'

/** 生成意图（粗粒度）→ 默认 ProfileKind。调用方也可显式传 kind 覆盖。 */
export type GenerateIntent = 'image' | 'video' | 'text' | 'audio'

type TaskResultLike = {
  id?: string
  status?: string
  // 字段宽容：runtime.TaskResult 的可空字段（string | null）也吃，避免传输边界处理 null
  assets?: Array<{
    type?: string
    url?: string
    thumbnailUrl?: string | null
    providerUrl?: string | null
    assetId?: string | null
    text?: string | null
  }>
  raw?: unknown
}

/** runTask 的形状（注入式，便于单测构造请求体而不真打 vendor）。 */
export type RunTaskFn = (payload: { vendor: string; request: unknown }) => Promise<TaskResultLike>

/** fetchTaskResult 的形状（注入式）。异步 vendor（modelscope 图 / 视频）返 queued，需轮询到终态。 */
export type FetchTaskResultFn = (payload: { taskId: string; vendor: string; taskKind: string; prompt: string; modelKey: string }) => Promise<{ result: TaskResultLike }>

const TERMINAL_STATUSES = new Set(['succeeded', 'failed'])

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function defaultKindForIntent(intent: GenerateIntent, hasReferences: boolean): string {
  switch (intent) {
    case 'image':
      return 'text_to_image'
    case 'video':
      return hasReferences ? 'image_to_video' : 'text_to_video'
    case 'audio':
      return 'text_to_audio'
    default:
      return 'chat'
  }
}

/**
 * 文本生成的文本落在 result.raw（textTaskRunner 返回 assets:[] + raw=provider 响应，真机实测）。
 * best-effort 从常见位置抽干净文本：裸字符串 / {text} / OpenAI {choices[0].message.content} / {content}。
 */
function extractTextFromRaw(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>
    if (typeof record.text === 'string') return record.text
    if (typeof record.content === 'string') return record.content
    const choices = record.choices as Array<{ message?: { content?: unknown } }> | undefined
    const content = choices?.[0]?.message?.content
    if (typeof content === 'string') return content
  }
  return ''
}

/** 读取项目的画布快照（normalize 后），坏/缺数据降级为空。 */
function readProjectSnapshot(record: ProjectRecord): CanvasSnapshot {
  const payload = (record.payload && typeof record.payload === 'object' ? (record.payload as Record<string, unknown>) : {}) as Record<string, unknown>
  return normalizeSnapshot(payload.generationCanvas)
}

/** 把改好的快照写回 record.payload.generationCanvas，其余 payload 字段原样保留（不碰 timeline 等）。 */
function writeProjectSnapshot(record: ProjectRecord, snapshot: CanvasSnapshot): ProjectRecord {
  const payload = (record.payload && typeof record.payload === 'object' ? { ...(record.payload as Record<string, unknown>) } : {}) as Record<string, unknown>
  payload.generationCanvas = snapshot
  return { ...record, payload }
}

function mustReadProject(projectId: string): ProjectRecord {
  const record = readProject(projectId)
  if (!record) throw new Error(`项目不存在: ${projectId}`)
  return record
}

// ── 工程级 ─────────────────────────────────────────────────────────────

export function listAllProjects(): Array<{ id: string; name: string; updatedAt: number }> {
  return listProjects().map((project) => ({ id: project.id, name: project.name, updatedAt: project.updatedAt }))
}

export function createNamedProject(name?: string): { id: string; name: string } {
  const record = createProject(name ? { name } : {})
  return { id: record.id, name: record.name }
}

/** 列出 catalog 里可执行的模型（enabled），供外部 agent 选型。 */
export function listAvailableModels(): Array<{ vendor: string; vendorName: string; modelKey: string; kind: string; label: string }> {
  const state = readCatalog()
  const vendorName = new Map(state.vendors.map((vendor) => [vendor.key, vendor.name] as const))
  return state.models
    .filter((model) => model.enabled)
    .map((model) => ({
      vendor: model.vendorKey,
      vendorName: vendorName.get(model.vendorKey) || model.vendorKey,
      modelKey: model.modelKey,
      kind: model.kind,
      label: model.labelZh || model.modelKey,
    }))
}

// ── 画布级（B 模式：直写 project.json）──────────────────────────────────

export function readProjectCanvas(projectId: string): ReturnType<typeof readCanvas> {
  return readCanvas(readProjectSnapshot(mustReadProject(projectId)))
}

export function addProjectNodes(projectId: string, specs: NodeSpec[]): { ids: string[] } {
  const record = mustReadProject(projectId)
  const { snapshot, ids } = addNodes(readProjectSnapshot(record), specs)
  saveProject(projectId, writeProjectSnapshot(record, snapshot))
  return { ids }
}

export function connectProjectNodes(projectId: string, connections: ConnectionSpec[]): {
  edgeIds: string[]
  skipped: Array<{ connection: ConnectionSpec; reason: string }>
} {
  const record = mustReadProject(projectId)
  const result = connectNodes(readProjectSnapshot(record), connections)
  saveProject(projectId, writeProjectSnapshot(record, result.snapshot))
  return { edgeIds: result.edgeIds, skipped: result.skipped }
}

export function setProjectNodePrompt(projectId: string, nodeId: string, prompt: string, title?: string): { changed: boolean } {
  const record = mustReadProject(projectId)
  const { snapshot, changed } = setNodePrompt(readProjectSnapshot(record), nodeId, prompt, title)
  if (changed) saveProject(projectId, writeProjectSnapshot(record, snapshot))
  return { changed }
}

export function deleteProjectNodes(projectId: string, nodeIds: string[]): { deleted: string[] } {
  const record = mustReadProject(projectId)
  const { snapshot, deleted } = deleteNodes(readProjectSnapshot(record), nodeIds)
  if (deleted.length) saveProject(projectId, writeProjectSnapshot(record, snapshot))
  return { deleted }
}

// ── 生成（复用主进程 runtime.runTask；B 模式落结果回节点）─────────────────

export type GenerateInput = {
  projectId: string
  /** 既有节点 id；不给则用 prompt 新建一个节点再生成。 */
  nodeId?: string
  /** 新建节点时的提示词；既有节点不给则用节点现有 prompt。 */
  prompt?: string
  intent?: GenerateIntent
  /** 显式 ProfileKind（如 text_to_image）；不给则由 intent 推。 */
  kind?: string
  vendor: string
  modelKey: string
  /** 透传进 extras 的生成参数（width/height/seed/duration…），主进程 archetypeInput 映射。 */
  params?: Record<string, unknown>
  /** 参考图（公网 URL 或 nomi-local://），落进 extras.referenceImages。 */
  references?: string[]
  title?: string
}

/**
 * 触发一次生成。构造高层 TaskRequest → runTask（主进程组装请求体 + 发 vendor + 落资产）。
 * 异步 vendor（modelscope 图 / 视频）首调返 queued → 用 fetchTaskResultFn **在本进程内**轮询到终态
 * （taskCache 是进程内的，host 退出即丢，故不能跨调用轮询，必须本调用内等完）。再把结果写回节点。
 * runTask/fetchTaskResult 注入式（测试不真打 vendor）。
 */
export async function generateOnProject(
  input: GenerateInput,
  runTaskFn: RunTaskFn,
  fetchTaskResultFn?: FetchTaskResultFn,
): Promise<{
  nodeId: string
  status: string
  assets: TaskResultLike['assets']
}> {
  const record = mustReadProject(input.projectId)
  let snapshot = readProjectSnapshot(record)

  // 解析/新建目标节点
  let nodeId = input.nodeId || ''
  const intent = input.intent || 'image'
  if (!nodeId) {
    const nodeKind = intent === 'video' ? 'video' : intent === 'audio' ? 'audio' : intent === 'text' ? 'text' : 'image'
    const created = addNodes(snapshot, [{ kind: nodeKind, prompt: input.prompt, title: input.title, references: input.references }])
    snapshot = created.snapshot
    nodeId = created.ids[0]
  } else if (typeof input.prompt === 'string' && input.prompt.trim()) {
    const updated = setNodePrompt(snapshot, nodeId, input.prompt, input.title)
    snapshot = updated.snapshot
  }

  const node = snapshot.nodes.find((item) => item.id === nodeId)
  if (!node) throw new Error(`节点不存在: ${nodeId}`)
  const prompt = typeof node.prompt === 'string' ? node.prompt.trim() : ''
  if (!prompt && intent !== 'audio') throw new Error('prompt is required')

  const references = input.references && input.references.length ? input.references : (Array.isArray(node.references) ? node.references : [])
  const kind = input.kind || defaultKindForIntent(intent, references.length > 0)

  const request = {
    kind,
    prompt,
    extras: {
      ...(input.params || {}),
      modelKey: input.modelKey,
      modelAlias: input.modelKey,
      projectId: input.projectId,
      nodeId,
      nodeKind: node.kind,
      ...(references.length ? { referenceImages: references } : {}),
      // headless 付费逃生口(仅评测/CLI 显式授权):env NOMI_LOOP_SPEND_OK=1 才铸令牌过付费守卫。
      // 红队不变量不动:默认不开 → AI/程序化路径仍铸不了令牌、被守卫硬拦(spendGrant.ts 信任边界)。
      // 开了 = 本进程(评测脚本)显式为本次生成授权,等价用户在 GUI 点确认。
      ...(process.env.NOMI_LOOP_SPEND_OK === '1' ? { grantId: mintSpendGrant({ nodeIds: [nodeId] }) } : {}),
    },
  }

  let result = await runTaskFn({ vendor: input.vendor, request })

  // 异步 vendor 首调返 queued/processing → 本进程内轮询到终态（视频给更长超时）。无 fetch 注入则不轮询。
  if (fetchTaskResultFn && result.status && !TERMINAL_STATUSES.has(result.status)) {
    const timeoutMs = kind === 'text_to_video' || kind === 'image_to_video' ? 300000 : 240000
    const startedAt = Date.now()
    while (result.status && !TERMINAL_STATUSES.has(result.status)) {
      if (Date.now() - startedAt > timeoutMs) break
      await delay(2000)
      const polled = await fetchTaskResultFn({
        taskId: result.id || '',
        vendor: input.vendor,
        taskKind: kind,
        prompt,
        modelKey: input.modelKey,
      })
      result = polled.result
    }
  }

  // 落结果回节点。图/视频/音频走首资产；文本无资产，文本在 raw（best-effort 抽取）。失败也保存 prompt/节点。
  const primary = (result.assets || [])[0]
  const text = intent === 'text' ? extractTextFromRaw(result.raw) : (typeof primary?.text === 'string' ? primary.text : '')
  const hasOutput = Boolean(primary || text)
  const persisted = snapshot.nodes.map((item) =>
    item.id === nodeId
      ? {
          ...item,
          status: result.status === 'succeeded' ? 'success' : result.status === 'failed' ? 'error' : item.status,
          ...(hasOutput
            ? {
                result: {
                  id: result.id || `result-${nodeId}`,
                  type: intent === 'video' ? 'video' : intent === 'audio' ? 'audio' : intent === 'text' ? 'text' : 'image',
                  ...(primary?.url ? { url: primary.url } : {}),
                  ...(primary?.thumbnailUrl ? { thumbnailUrl: primary.thumbnailUrl } : {}),
                  ...(primary?.providerUrl ? { providerUrl: primary.providerUrl } : {}),
                  ...(text ? { text } : {}),
                  ...(primary?.assetId ? { assetId: primary.assetId } : {}),
                  createdAt: Date.now(),
                },
              }
            : {}),
        }
      : item,
  )
  saveProject(input.projectId, writeProjectSnapshot(record, { ...snapshot, nodes: persisted }))

  return { nodeId, status: result.status || 'unknown', assets: result.assets || [], ...(text ? { text } : {}) }
}
