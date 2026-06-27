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
import crypto from 'node:crypto'
import { listProjects, createProject, readProject } from '../projects/repository'
import { readCatalog } from '../catalog/catalogStore'
import {
  addNodes,
  connectNodes,
  deleteNodes,
  readCanvas,
  setNodePrompt,
  type CanvasSnapshot,
  type ConnectionSpec,
  type NodeSpec,
} from './canvasGraph'
import type { ProjectGateway } from './gateway'

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

/** 把目标节点的 status（可带 error）改写进快照（其余节点/边原样）。供生成各阶段的实时态用。 */
function setNodeStatusInSnapshot(snapshot: CanvasSnapshot, nodeId: string, status: string, error?: string): CanvasSnapshot {
  return {
    ...snapshot,
    nodes: snapshot.nodes.map((node) => (node.id === nodeId ? { ...node, status, ...(error ? { error } : {}) } : node)),
  }
}

/** 把生成结果落回目标节点（success/error 态 + result 对象）。形状与 renderer GenerationNodeResult 对齐。 */
function writeResultToSnapshot(snapshot: CanvasSnapshot, nodeId: string, result: TaskResultLike, intent: GenerateIntent): CanvasSnapshot {
  const primary = (result.assets || [])[0]
  const text = intent === 'text' ? extractTextFromRaw(result.raw) : (typeof primary?.text === 'string' ? primary.text : '')
  const hasOutput = Boolean(primary || text)
  return {
    ...snapshot,
    nodes: snapshot.nodes.map((item) =>
      item.id === nodeId
        ? {
            ...item,
            status: result.status === 'succeeded' ? 'success' : result.status === 'failed' ? 'error' : (typeof item.status === 'string' ? item.status : 'idle'),
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
    ),
  }
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

// ── 画布级（经 ProjectGateway：A 模式转发渲染层 / B 模式直写盘，统一逻辑）──────

export async function readProjectCanvas(gateway: ProjectGateway): Promise<ReturnType<typeof readCanvas>> {
  return readCanvas(await gateway.readDoc())
}

export async function addProjectNodes(gateway: ProjectGateway, specs: NodeSpec[]): Promise<{ ids: string[] }> {
  const { snapshot, ids } = addNodes(await gateway.readDoc(), specs)
  await gateway.apply(snapshot)
  return { ids }
}

export async function connectProjectNodes(gateway: ProjectGateway, connections: ConnectionSpec[]): Promise<{
  edgeIds: string[]
  skipped: Array<{ connection: ConnectionSpec; reason: string }>
}> {
  const result = connectNodes(await gateway.readDoc(), connections)
  await gateway.apply(result.snapshot)
  return { edgeIds: result.edgeIds, skipped: result.skipped }
}

export async function setProjectNodePrompt(gateway: ProjectGateway, nodeId: string, prompt: string, title?: string): Promise<{ changed: boolean }> {
  const { snapshot, changed } = setNodePrompt(await gateway.readDoc(), nodeId, prompt, title)
  if (changed) await gateway.apply(snapshot)
  return { changed }
}

export async function deleteProjectNodes(gateway: ProjectGateway, nodeIds: string[]): Promise<{ deleted: string[] }> {
  const { snapshot, deleted } = deleteNodes(await gateway.readDoc(), nodeIds)
  if (deleted.length) await gateway.apply(snapshot)
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
  gateway: ProjectGateway,
  runTaskFn: RunTaskFn,
  fetchTaskResultFn?: FetchTaskResultFn,
): Promise<{
  nodeId: string
  status: string
  assets: TaskResultLike['assets']
}> {
  let snapshot = await gateway.readDoc()

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

  // 先把节点以「排队中」态写出去——A 模式：节点立即出现在画布（所见即所得）；B 模式：落盘占位。
  snapshot = setNodeStatusInSnapshot(snapshot, nodeId, 'queued')
  await gateway.apply(snapshot)

  // 付费确认：A 模式弹实时卡，真人点确认才铸令牌；B 模式只认 env 逃生口。
  // 不在此硬拦——enforcement 仍在 runTask 内的 assertAndConsumeSpendGrant（红队不变量：主进程硬闸）；
  // 未确认 = 不带 grantId，runTask 会 fail-fast 抛「未确认」并秒回，不死等、不烧额度。
  const projectName = readProject(input.projectId)?.name
  const grantId = await gateway.confirmSpend({
    projectId: input.projectId,
    ...(projectName ? { projectName } : {}),
    nodeId,
    intent,
    vendor: input.vendor,
    modelKey: input.modelKey,
    prompt,
  })

  // 进入生成中态（A 模式：节点显示「生成中」）。
  snapshot = setNodeStatusInSnapshot(snapshot, nodeId, 'running')
  await gateway.apply(snapshot)

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
      ...(grantId ? { grantId } : {}),
      // 提交幂等键：headless 路自生一个（本路无重试循环故无双发向量，纯纵深防御 + 未来若加重试已护住）。
      idempotencyKey: `mcp-${crypto.randomUUID()}`,
    },
  }

  let result: TaskResultLike
  try {
    result = await runTaskFn({ vendor: input.vendor, request })

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
  } catch (error) {
    // 失败（含未授权/超时）→ 把节点落 error 态写出去（A 模式：用户立刻看到失败 + 原因），再透传错误给 agent。
    const message = error instanceof Error ? error.message : String(error)
    try {
      await gateway.apply(setNodeStatusInSnapshot(await gateway.readDoc(), nodeId, 'error', message))
    } catch {
      /* 写 error 态失败不掩盖原始错误 */
    }
    throw error
  }

  // 落结果回节点。重读快照（A 模式用户可能挪过卡）再写目标节点。图/视频/音频走首资产；文本在 raw。
  const persisted = writeResultToSnapshot(await gateway.readDoc(), nodeId, result, intent)
  await gateway.apply(persisted)

  const primary = (result.assets || [])[0]
  const text = intent === 'text' ? extractTextFromRaw(result.raw) : (typeof primary?.text === 'string' ? primary.text : '')
  return { nodeId, status: result.status || 'unknown', assets: result.assets || [], ...(text ? { text } : {}) }
}
