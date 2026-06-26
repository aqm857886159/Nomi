import type { GenerationCanvasEdge, GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import { getGenerationNodeExecutionKind } from '../model/generationNodeKinds'
import { persistActiveWorkbenchProjectNow } from '../../project/workbenchProjectSession'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useWorkbenchStore } from '../../workbenchStore'
import { toast } from '../../../ui/toast'
import { mintSpendGrant } from '../../api/taskApi'
import { describeGenerationCost, useSpendConfirmStore } from '../spend/spendConfirm'
import { generationNodeExecutor, type GenerationNodeExecutor } from './generationNodeExecutor'
import { narrateProgress } from '../../observability/narrate'
import { isRecoverableTimeoutError } from './recoverableTimeout'
// 错误分类(classifyGenerationError)已抽到 observability/classifyError(人话叶子层,生成域+对话域共用);
// 这里 re-export 保持 NodeErrorReport / classifyGenerationError.test 等既有 import 不破。
export { classifyGenerationError, type GenerationErrorReport } from '../../observability/classifyError'
import type { DependencyWavePlan } from './dependencyWaves'
import { resolveGenerationReferences } from './generationReferenceResolver'
import { currentArchetypeMode, hasArchetypeArrayReferences, resolveArchetypeForModel } from '../nodes/controls/archetypeMeta'
import type { GenerationNodeKind } from '../model/generationCanvasTypes'

/** 节点 kind → 付费预估用的产物口径（视频/配音/画面），喂给 describeGenerationCost 报对名词与时长。 */
function spendCostKind(kind: GenerationNodeKind): 'image' | 'video' | 'audio' {
  const exec = getGenerationNodeExecutionKind(kind)
  return exec === 'video' ? 'video' : exec === 'audio' ? 'audio' : 'image'
}

/** 一批节点的产物口径：全同则取该类，混合则 'mixed'，喂给 describeGenerationCost 报对名词。 */
export function spendCostKindForNodes(ids: string[]): 'image' | 'video' | 'audio' | 'mixed' {
  const nodes = useGenerationCanvasStore.getState().nodes
  const kinds = new Set(
    ids
      .map((id) => nodes.find((n) => n.id === id))
      .filter((n): n is GenerationCanvasNode => Boolean(n))
      .map((n) => spendCostKind(n.kind)),
  )
  if (kinds.size === 1) return [...kinds][0]
  return kinds.size === 0 ? 'image' : 'mixed'
}

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
    // 可找回超时：上游可能仍在跑/已出片 → 落 recoverable（不进红色错误桶），给「重新拉取」入口。
    // taskId 已在 run 记录里持久化，recover 动作从节点重建续查（重启后也能拉）。
    if (isRecoverableTimeoutError(error)) {
      useGenerationCanvasStore.getState().setNodeStatus(id, 'recoverable', error.message)
      throw error
    }
    // Store the RAW message; the UI (NodeErrorReport) runs classifyGenerationError
    // to show a human reason + hint + the raw detail. Keeping node.error a plain
    // string avoids a persisted-shape migration for existing project files.
    const rawMessage = error instanceof Error && error.message ? error.message : '生成失败'
    useGenerationCanvasStore.getState().setNodeStatus(id, 'error', rawMessage)
    throw error
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
  const node = useGenerationCanvasStore.getState().nodes.find((n) => n.id === nodeId)
  const ok = await useSpendConfirmStore.getState().requestConfirm({
    title: opts.rerun ? '重新生成' : '开始生成',
    message: describeGenerationCost(1, node ? spendCostKind(node.kind) : 'image'),
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

/**
 * In-place 重生成（C0）：同节点重出 —— **不 duplicate、不换 id、不动 shotIndex**。
 * `runGenerationNode` 本就原地（addNodeResult 把新 result 设为 node.result、旧的进 history），
 * 这里加「轻确认 + 铸令牌（不绕付费闸）+ 完成后回填时间轴」。产物贴回原节点后，
 * 时间轴里引用该节点的 clip 走回填闸（位置不变、URL providerUrl 优先、trim 越界夹取）。
 * 与「基于此生成变体」(confirmAndRunNode{rerun} / rerunGenerationNodeAsNewNode = duplicate) 分流，
 * 别共用一个口子（一个改这一镜、一个长出新镜）。
 */
export async function regenerateNodeInPlace(nodeId: string): Promise<void> {
  const id = String(nodeId || '').trim()
  if (!id) return
  const node = useGenerationCanvasStore.getState().nodes.find((n) => n.id === id)
  const ok = await useSpendConfirmStore.getState().requestConfirm({
    title: '重新生成',
    message: describeGenerationCost(1, node ? spendCostKind(node.kind) : 'image'),
    confirmLabel: '重新生成',
    light: true,
  })
  if (!ok) return
  let grantId: string
  try {
    grantId = await mintSpendGrant([id])
  } catch (error) {
    toast(error instanceof Error && error.message ? error.message : '付费授权失败', 'error')
    return
  }
  try {
    const result = await runGenerationNode(id, { grantId })
    useWorkbenchStore.getState().reconcileTimelineForUpdatedNodes(id, result)
  } catch {
    // 失败已记在节点卡片（人话错误），不再弹。
  }
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
