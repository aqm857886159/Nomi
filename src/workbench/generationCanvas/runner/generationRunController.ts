import type { GenerationCanvasEdge, GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import { getGenerationNodeExecutionKind } from '../model/generationNodeKinds'
import { persistActiveWorkbenchProjectNow } from '../../project/workbenchProjectSession'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { toast } from '../../../ui/toast'
import { mintSpendGrant } from '../../api/taskApi'
import { describeGenerationCost, useSpendConfirmStore } from '../spend/spendConfirm'
import { generationNodeExecutor, type GenerationNodeExecutor } from './generationNodeExecutor'
import { narrateGenerationError, narrateProgress, type GenerationErrorKind } from '../../observability/narrate'
import { parseVendorErrorFromMessage, stripVendorErrorMarker } from './vendorErrorIpc'
import type { DependencyWavePlan } from './dependencyWaves'
import { resolveGenerationReferences } from './generationReferenceResolver'
import { currentArchetypeMode, hasArchetypeArrayReferences, resolveArchetypeForModel } from '../nodes/controls/archetypeMeta'

export type RunGenerationNodeOptions = {
  executor?: GenerationNodeExecutor
  retry?: {
    maxAttempts?: number
    baseDelayMs?: number
  }
  /** 付费守卫令牌：真人确认后铸的 grantId，透传到 executor → request.extras 供主进程核验。 */
  grantId?: string
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
    message: narrateProgress('queued'),
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
          ...(options.grantId ? { grantId: options.grantId } : {}),
          // S2:catalog 任务各阶段回报 → 节点进度(人话已由 narrate 翻好)。
          onProgress: (progress) => {
            useGenerationCanvasStore.getState().setNodeProgress(id, {
              runId: run.id,
              phase: progress.phase,
              message: progress.message,
              ...(progress.taskId ? { taskId: progress.taskId } : {}),
            })
          },
        })
        break
      } catch (error: unknown) {
        if (attempt >= maxAttempts || !isRetryableGenerationError(error)) {
          throw error
        }
        useGenerationCanvasStore.getState().setNodeProgress(id, {
          runId: run.id,
          phase: 'retrying',
          // 文案走 narrate 注册表(S2 纪律:展示文案不许散落字面量)。
          message: narrateProgress('retrying', { attempt: attempt + 1, maxAttempts }),
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
  /**
   * 服务商的**真实原话**（如「官方算力限制，请等待一段时间后再进行使用」）。分类标题
   * 只说"哪一类"，这条说"服务商到底咋讲的"——以前它被埋进折叠的「技术详情」，用户一脸懵逼。
   * 只在它与 reason 不同、且有信息量时给（unknown 类的 reason 本身就是原话，不重复）。
   */
  providerMessage?: string
  /** Original raw error message (any "→ hint" tail from older builds stripped). */
  raw: string
}

/** 上游原话提到可见区前的清洗：去掉占位、与 reason 重复、过长。 */
function pickProviderMessage(candidate: string | undefined, reason: string): string {
  const msg = String(candidate || '').replace(/\s+/g, ' ').trim()
  if (!msg || msg === '(no detail from provider)' || msg === reason) return ''
  return msg.length > 200 ? `${msg.slice(0, 199)}…` : msg
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
const STRUCTURED_KINDS: readonly GenerationErrorKind[] = ['auth', 'balance', 'quota', 'network', 'server', 'input']

/** legacy 字符串 → 类别(老项目持久化的 node.error / 非 vendor 错误的兜底识别;文案不在这里)。 */
function detectLegacyErrorKind(raw: string): GenerationErrorKind | null {
  const lower = raw.toLowerCase()
  if (lower.includes('api key') || lower.includes('apikey') || lower.includes('unauthorized') || lower.includes('401')) return 'auth'
  // 余额不足要和限流分开——用户动作不同(充值 vs 等待)。只匹配明确指向余额/欠费的词,
  // 避免把 OpenAI 的 insufficient_quota(配额)误判成余额。
  if (raw.includes('余额') || lower.includes('balance') || raw.includes('欠费') || lower.includes('arrears') || lower.includes('402')) return 'balance'
  if (lower.includes('quota') || lower.includes('rate limit') || lower.includes('429') || lower.includes('insufficient')) return 'quota'
  // 我们自己的轮询超时(视频长任务常见)——不是网络问题,任务多半还在服务商侧跑。
  if (raw.includes('轮询超时') || lower.includes('task poll timeout')) return 'poll-timeout'
  if (lower.includes('timeout') || lower.includes('etimedout') || lower.includes('econnreset') || lower.includes('network')) return 'network'
  if (lower.includes('model') && (lower.includes('not found') || lower.includes('未找到') || lower.includes('not configured'))) return 'model-config'
  if (lower.includes('content') && (lower.includes('policy') || lower.includes('safety') || lower.includes('filter'))) return 'content-policy'
  return null
}

export function classifyGenerationError(message: string): GenerationErrorReport {
  // S4-2:structured 优先(VendorRequestError 经 IPC 标记穿透,源头保留的事实,不是猜);
  // 老数据/非 vendor 错误退回 legacy 正则识别。两条路只产 kind,文案统一出自 narrate 词表。
  const structured = parseVendorErrorFromMessage(message)
  if (structured?.category && (STRUCTURED_KINDS as readonly string[]).includes(structured.category)) {
    const { reason, hint } = narrateGenerationError(structured.category as GenerationErrorKind)
    const providerMessage = pickProviderMessage(structured.upstreamMsg, reason)
    return { reason, hint, raw: stripVendorErrorMarker(message), ...(providerMessage ? { providerMessage } : {}) }
  }
  // Strip any legacy "\n→ hint" tail that older builds baked into node.error.
  const raw = stripVendorErrorMarker(String(message || '')).split('\n→')[0].trim() || '生成失败'
  const kind = detectLegacyErrorKind(raw)
  if (kind) {
    const { reason, hint } = narrateGenerationError(kind)
    const providerMessage = pickProviderMessage(extractReadableErrorLine(raw), reason)
    return { reason, hint, raw, ...(providerMessage ? { providerMessage } : {}) }
  }
  // 兜底:抠 raw 可读首行当 reason,通用建议出自 narrate 的 unknown 词条。
  return {
    reason: extractReadableErrorLine(raw) || narrateGenerationError('unknown').reason,
    hint: narrateGenerationError('unknown').hint,
    raw,
  }
}

export type RunGenerationNodesBatchOptions = RunGenerationNodeOptions & {
  /** Maximum concurrent runs. Defaults to 6（用户拍板：同一波内尽量并行，框选 6 个镜头能一起跑，
   *  不再一个一个来）。有依赖的镜头仍按波次串行（锚先于镜头），这只调「同波内同时几个」。上限 8。 */
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
  if (typeof value !== 'number' || !Number.isFinite(value)) return 6
  return Math.max(1, Math.min(8, Math.floor(value)))
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
          ...(options.grantId ? { grantId: options.grantId } : {}),
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

/**
 * 按拓扑波次执行批量生成(harness S2b,替代平铺 FIFO 的入口):
 * - 波内并行(沿用 runGenerationNodesBatch 的并发池/重试语义);
 * - 波间串行:依赖节点等到上游真完成才开跑——参考图不再"没出来就裸跑";
 * - blocked(上游缺果/环)与"上游本批失败"的下游 → **显式失败**,人话原因,可单独重试。
 */
export async function runGenerationNodesByPlan(
  plan: DependencyWavePlan,
  options: RunGenerationNodesBatchOptions = {},
): Promise<RunGenerationNodesBatchResult> {
  const successes: RunGenerationNodesBatchResult['successes'] = []
  const failures: RunGenerationNodesBatchResult['failures'] = []
  const failNode = (nodeId: string, message: string) => {
    const error = new Error(message)
    useGenerationCanvasStore.getState().setNodeStatus(nodeId, 'error', message)
    failures.push({ nodeId, error })
    options.onNodeResult?.({ ok: false, nodeId, error })
  }
  for (const blocked of plan.blocked) failNode(blocked.nodeId, blocked.detail)

  const plannedIds = new Set(plan.waves.flat())
  const internalDeps = new Map<string, string[]>()
  for (const edge of plan.edgesUsed) {
    if (!plannedIds.has(edge.source) || !plannedIds.has(edge.target)) continue
    internalDeps.set(edge.target, [...(internalDeps.get(edge.target) ?? []), edge.source])
  }

  const failedIds = new Set(plan.blocked.map((blocked) => blocked.nodeId))
  for (const wave of plan.waves) {
    // 上游本批失败 → 下游显式失败(不裸跑、不死等),其余照常并行。
    const runnable: string[] = []
    for (const nodeId of wave) {
      const failedDep = (internalDeps.get(nodeId) ?? []).find((dep) => failedIds.has(dep))
      if (failedDep) {
        failedIds.add(nodeId)
        const depTitle = useGenerationCanvasStore.getState().nodes.find((node) => node.id === failedDep)?.title || failedDep
        failNode(nodeId, `上游「${depTitle}」本批生成失败,本节点未执行`)
      } else {
        runnable.push(nodeId)
      }
    }
    if (runnable.length === 0) continue
    const result = await runGenerationNodesBatch(runnable, options)
    successes.push(...result.successes)
    for (const failure of result.failures) {
      failedIds.add(failure.nodeId)
      failures.push(failure)
    }
  }
  return { totalCount: plan.waves.flat().length + plan.blocked.length, successes, failures }
}

/**
 * 单节点生成/重试/重新生成的轻确认 + 铸令牌 + 跑（付费守卫，务实纵深 A1）。
 * rerun=true 先复制出新节点再绑令牌跑。抽到此处而非内联进 NodeGenerationComposer /
 * BaseGenerationNode（后者 908 行顶格巨壳，不喂；BaseGenerationNode 复用其现有 controller import 行）。
 */
export async function confirmAndRunNode(nodeId: string, opts: { rerun?: boolean } = {}): Promise<void> {
  const ok = await useSpendConfirmStore.getState().requestConfirm({
    title: opts.rerun ? '重新生成' : '开始生成',
    message: describeGenerationCost(1),
    confirmLabel: opts.rerun ? '重新生成' : '生成',
    light: true,
  })
  if (!ok) return
  let runId = nodeId
  if (opts.rerun) {
    const dup = useGenerationCanvasStore.getState().duplicateNodeForRegeneration(nodeId)
    if (!dup) return
    runId = dup.id
  }
  let grantId: string
  try {
    grantId = await mintSpendGrant([runId])
  } catch (error) {
    toast(error instanceof Error && error.message ? error.message : '付费授权失败', 'error')
    return
  }
  try {
    await runGenerationNode(runId, { grantId })
  } catch {
    // 失败已记在节点上（卡片渲染人话错误），这里不再弹。
  }
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
  // 声音：配音(台词缺失下游兜底，同 text 可生成)；转写需先有音频参考(audio_ref 槽)。
  if (executionKind === 'audio') {
    if (!('meta' in node)) return true
    const meta = node.meta || {}
    const audioArchetype = resolveArchetypeForModel({
      modelKey: typeof meta.modelKey === 'string' ? meta.modelKey : undefined,
      modelAlias: typeof meta.modelAlias === 'string' ? meta.modelAlias : undefined,
      meta,
    })
    const mode = audioArchetype ? currentArchetypeMode(audioArchetype, meta) : null
    const needsAudioRef = (mode?.slots || []).some((slot) => slot.kind === 'audio_ref')
    if (!needsAudioRef) return true
    return Boolean(audioArchetype && hasArchetypeArrayReferences(meta, audioArchetype))
  }
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
