import type { GenerationCanvasEdge, GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import { getGenerationNodeExecutionKind } from '../model/generationNodeKinds'
import { persistActiveWorkbenchProjectNow } from '../../project/workbenchProjectSession'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { generationNodeExecutor, type GenerationNodeExecutor } from './generationNodeExecutor'
import { resolveGenerationReferences } from './generationReferenceResolver'
import { hasArchetypeArrayReferences, resolveArchetypeForModel } from '../nodes/controls/archetypeMeta'

export type RunGenerationNodeOptions = {
  executor?: GenerationNodeExecutor
  retry?: {
    maxAttempts?: number
    baseDelayMs?: number
  }
}

type GenerationRunContext = {
  nodes?: GenerationCanvasNode[]
  edges?: GenerationCanvasEdge[]
}

type RetryableGenerationError = Error & {
  status?: number
  code?: unknown
}

const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BASE_DELAY_MS = 350

function isRetryableGenerationError(error: unknown): boolean {
  if (error instanceof TypeError) return true
  if (!(error instanceof Error)) return false
  const candidate = error as RetryableGenerationError
  if (typeof candidate.status === 'number') {
    return candidate.status === 408 || candidate.status === 409 || candidate.status === 425 || candidate.status === 429 || candidate.status >= 500
  }
  const message = candidate.message.trim().toLowerCase()
  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('socket') ||
    message.includes('timeout') ||
    message.includes('temporarily unavailable') ||
    message.includes('rate limit')
  )
}

function normalizeRetryAttempts(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_ATTEMPTS
  return Math.max(1, Math.min(5, Math.floor(value)))
}

function normalizeBaseDelayMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_BASE_DELAY_MS
  return Math.max(0, Math.min(3_000, Math.floor(value)))
}

async function waitForRetry(attempt: number, baseDelayMs: number): Promise<void> {
  if (baseDelayMs <= 0) return
  await new Promise((resolve) => globalThis.setTimeout(resolve, baseDelayMs * 2 ** Math.max(0, attempt - 1)))
}

export async function runGenerationNode(
  nodeId: string,
  options: RunGenerationNodeOptions = {},
): Promise<GenerationNodeResult> {
  const id = String(nodeId || '').trim()
  if (!id) throw new Error('nodeId is required')

  const initialState = useGenerationCanvasStore.getState()
  const initialNode = initialState.nodes.find((node) => node.id === id)
  if (!initialNode) throw new Error('node not found')
  if (!canRunGenerationNode(initialNode, { nodes: initialState.nodes, edges: initialState.edges })) {
    throw new Error(initialNode.kind === 'video'
      ? '视频节点缺少上游真实图片或视频资产 URL。请先生成或选择首帧/参考图后再生成视频。'
      : `暂不支持「${initialNode.kind}」类型节点的生成`)
  }

  const run = initialState.appendNodeRun(id, {
    status: 'queued',
    startedAt: Date.now(),
    updatedAt: Date.now(),
  })
  useGenerationCanvasStore.getState().setNodeProgress(id, {
    runId: run.id,
    phase: 'queued',
    message: '准备生成',
    percent: 0,
  })

  try {
    const executor = options.executor ?? generationNodeExecutor
    const maxAttempts = normalizeRetryAttempts(options.retry?.maxAttempts)
    const baseDelayMs = normalizeBaseDelayMs(options.retry?.baseDelayMs)
    let result: GenerationNodeResult | null = null
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const state = useGenerationCanvasStore.getState()
      const node = state.nodes.find((candidate) => candidate.id === id) || initialNode
      try {
        result = await executor(node, {
          nodes: state.nodes,
          edges: state.edges,
        })
        break
      } catch (error: unknown) {
        if (attempt >= maxAttempts || !isRetryableGenerationError(error)) {
          throw error
        }
        useGenerationCanvasStore.getState().setNodeProgress(id, {
          runId: run.id,
          phase: 'retrying-fetch',
          message: `正在重试 (${attempt + 1}/${maxAttempts})`,
          percent: Math.min(90, attempt * 10),
        })
        await waitForRetry(attempt, baseDelayMs)
      }
    }
    if (!result) throw new Error('生成失败')
    useGenerationCanvasStore.getState().addNodeResult(id, result)
    await persistActiveWorkbenchProjectNow().catch(() => {})
    return result
  } catch (error: unknown) {
    // Store the RAW message; the UI (NodeErrorReport) runs classifyGenerationError
    // to show a human reason + hint + the raw detail. Keeping node.error a plain
    // string avoids a persisted-shape migration for existing project files.
    const rawMessage = error instanceof Error && error.message ? error.message : '生成失败'
    useGenerationCanvasStore.getState().setNodeStatus(id, 'error', rawMessage)
    throw error
  }
}

export type GenerationErrorReport = {
  /** Short human reason, e.g. 配额或限流. */
  reason: string
  /** Actionable suggestion sentence (empty for unknown errors). */
  hint: string
  /** Original raw error message (any "→ hint" tail from older builds stripped). */
  raw: string
}

/**
 * 未命中任何已知分类时，从 raw 里抠一句**可读首行**当 reason——而不是又甩一句
 * "生成失败"（那会和顶部状态徽标重复，对用户零信息）。优先解析 JSON 里的
 * message/error 字段，否则取第一行非空文本并截断。抠不出可读内容才返回 ''。
 */
function extractReadableErrorLine(raw: string): string {
  const source = String(raw || '').trim()
  if (!source) return ''
  // 1) provider 常把报错塞进 JSON：{ error: { message } } / { message } / { error }
  try {
    const parsed = JSON.parse(source) as unknown
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      const errorField = record.error
      const candidates = [
        typeof errorField === 'object' && errorField ? (errorField as Record<string, unknown>).message : undefined,
        typeof errorField === 'string' ? errorField : undefined,
        record.message,
        record.detail,
        record.error_description,
      ]
      for (const value of candidates) {
        if (typeof value === 'string' && value.trim()) return truncateLine(value.trim())
      }
    }
  } catch {
    // 不是 JSON，走纯文本路径
  }
  // 2) 纯文本：取第一行非空内容
  const firstLine = source.split('\n').map((line) => line.trim()).find(Boolean)
  return firstLine ? truncateLine(firstLine) : ''
}

function truncateLine(value: string): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > 100 ? `${clean.slice(0, 99)}…` : clean
}

/**
 * Single source of truth: classify a raw API error into a human reason + hint.
 * The generation runner stores the raw message; the node error UI calls this to
 * render. Common cases: API key 无效、模型未配置、配额/限流、网络/超时、内容拦截。
 */
export function classifyGenerationError(message: string): GenerationErrorReport {
  // Strip any legacy "\n→ hint" tail that older builds baked into node.error.
  const raw = String(message || '').split('\n→')[0].trim() || '生成失败'
  const lower = raw.toLowerCase()
  if (lower.includes('api key') || lower.includes('apikey') || lower.includes('unauthorized') || lower.includes('401')) {
    return { reason: 'API Key 无效', hint: '请在「模型接入」页检查这个模型的 API Key。', raw }
  }
  // 余额不足要和限流分开——用户动作不同（充值 vs 等待）。只匹配明确指向余额/欠费的词，
  // 避免把 OpenAI 的 insufficient_quota（配额）误判成余额。
  if (raw.includes('余额') || lower.includes('balance') || raw.includes('欠费') || lower.includes('arrears') || lower.includes('402')) {
    return { reason: '余额不足', hint: '服务商账户余额不足，请到服务商充值后重试，或在「模型接入」换一个模型。', raw }
  }
  if (lower.includes('quota') || lower.includes('rate limit') || lower.includes('429') || lower.includes('insufficient')) {
    return { reason: '配额或限流', hint: '服务商配额已用尽或触发限流，请稍后重试，或在「模型接入」换一个模型。', raw }
  }
  // 我们自己的轮询超时（视频长任务常见）——不是网络问题，任务多半还在服务商侧跑，
  // 不该归到"网络超时"误导用户去查网络。
  if (raw.includes('轮询超时') || lower.includes('task poll timeout')) {
    return { reason: '生成超时', hint: '视频生成较慢，等待超过上限。任务可能仍在进行，请稍后重新生成，或换更快的模型（如 Seedance Fast）。', raw }
  }
  if (lower.includes('timeout') || lower.includes('etimedout') || lower.includes('econnreset') || lower.includes('network')) {
    return { reason: '网络超时', hint: '网络问题，请检查网络后重试。', raw }
  }
  if (lower.includes('model') && (lower.includes('not found') || lower.includes('未找到') || lower.includes('not configured'))) {
    return { reason: '模型未配置', hint: '这个模型没配好，请去「模型接入」页设置。', raw }
  }
  if (lower.includes('content') && (lower.includes('policy') || lower.includes('safety') || lower.includes('filter'))) {
    return { reason: '提示词被拦截', hint: '提示词触发了安全策略，请修改后重试。', raw }
  }
  // 兜底：抠 raw 可读首行当 reason（没有就退回"生成失败"），并给一句通用建议，
  // 别让用户对着空白干瞪眼。
  return {
    reason: extractReadableErrorLine(raw) || '生成失败',
    hint: '可能是服务商临时故障或额度问题，建议稍等重试，或换一个模型。',
    raw,
  }
}

export type RunGenerationNodesBatchOptions = RunGenerationNodeOptions & {
  /** Maximum concurrent runs. Defaults to 2 so two nodes can execute in parallel without overwhelming the provider. */
  concurrency?: number
  /** Called whenever a node finishes (success or failure) so the UI can update progress. */
  onNodeResult?: (event:
    | { ok: true; nodeId: string; result: GenerationNodeResult }
    | { ok: false; nodeId: string; error: Error }
  ) => void
}

export type RunGenerationNodesBatchResult = {
  totalCount: number
  successes: Array<{ nodeId: string; result: GenerationNodeResult }>
  failures: Array<{ nodeId: string; error: Error }>
}

function normalizeConcurrency(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 2
  return Math.max(1, Math.min(4, Math.floor(value)))
}

/**
 * Run a batch of generation nodes with bounded concurrency. Each node
 * goes through the same retry/failure semantics as `runGenerationNode`,
 * so callers can still display a per-node retry button if a run fails.
 * This is the runtime used by the storyboard demo's "全部生成" action.
 */
export async function runGenerationNodesBatch(
  nodeIds: readonly string[],
  options: RunGenerationNodesBatchOptions = {},
): Promise<RunGenerationNodesBatchResult> {
  const queue = nodeIds
    .map((value) => String(value || '').trim())
    .filter((value, index, array) => Boolean(value) && array.indexOf(value) === index)
  const concurrency = normalizeConcurrency(options.concurrency)
  const successes: RunGenerationNodesBatchResult['successes'] = []
  const failures: RunGenerationNodesBatchResult['failures'] = []
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < queue.length) {
      const nextIndex = cursor
      cursor += 1
      const nodeId = queue[nextIndex]
      try {
        const result = await runGenerationNode(nodeId, {
          executor: options.executor,
          retry: options.retry,
        })
        successes.push({ nodeId, result })
        options.onNodeResult?.({ ok: true, nodeId, result })
      } catch (error: unknown) {
        const normalizedError = error instanceof Error ? error : new Error(String(error))
        failures.push({ nodeId, error: normalizedError })
        options.onNodeResult?.({ ok: false, nodeId, error: normalizedError })
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => worker())
  await Promise.all(workers)
  return { totalCount: queue.length, successes, failures }
}

export async function rerunGenerationNodeAsNewNode(
  nodeId: string,
  options: RunGenerationNodeOptions = {},
): Promise<GenerationNodeResult> {
  const state = useGenerationCanvasStore.getState()
  const duplicatedNode = state.duplicateNodeForRegeneration(nodeId)
  if (!duplicatedNode) throw new Error('node not found')
  return runGenerationNode(duplicatedNode.id, options)
}

export function canRunGenerationNode(
  node: GenerationCanvasNode | Pick<GenerationCanvasNode, 'kind'> | null | undefined,
  context: GenerationRunContext = {},
): boolean {
  if (!node) return false
  const executionKind = getGenerationNodeExecutionKind(node.kind)
  if (executionKind === 'image') return true
  // C5: 文本节点只要选了文本模型就能生成；prompt 缺失由 buildCatalogTaskRequest 兜底报错。
  if (executionKind === 'text') return true
  if (executionKind !== 'video') return false
  if (!('id' in node) || !node.id) return false
  const references = resolveGenerationReferences(node, context)
  // omni（全能参考）不靠首/尾帧，靠参考数组——单看 resolveGenerationReferences 看不到 referenceImageUrls，
  // 会把「已放参考的 omni 节点」误判为不可生成（锁死 ↑ 按钮、提示"需要首帧"）。补一条档案数组判断。
  const meta = node.meta || {}
  const archetype = resolveArchetypeForModel({
    modelKey: typeof meta.modelKey === 'string' ? meta.modelKey : undefined,
    modelAlias: typeof meta.modelAlias === 'string' ? meta.modelAlias : undefined,
    meta,
  })
  return Boolean(
    references.firstFrameUrl ||
    references.lastFrameUrl ||
    references.referenceImages.length > 0 ||
    (archetype && hasArchetypeArrayReferences(meta, archetype)),
  )
}
