import {
  type BillingModelKind,
  type ModelCatalogModelDto,
  listWorkbenchModelCatalogModels,
} from '../../api/modelCatalogApi'
import {
  type TaskAssetDto,
  type TaskKind,
  type TaskRequestDto,
  type TaskResultDto,
  fetchWorkbenchTaskResultByVendor,
  runWorkbenchTaskByVendor,
} from '../../api/taskApi'
import type {
  GenerationCanvasNode,
  GenerationNodeResult,
  GenerationProvenance,
  GenerationResultType,
} from '../model/generationCanvasTypes'
import {
  getGenerationNodeCatalogKind,
  getGenerationNodeExecutionKind,
  isVideoLikeGenerationNodeKind,
} from '../model/generationNodeKinds'
import type { ResolvedGenerationReferences } from './generationReferenceResolver'
import { resolveArchetypeForModel } from '../../../config/modelArchetypes'
import { buildArchetypeInputParams } from '../nodes/controls/archetypeMeta'

export type CatalogTaskActionOptions = {
  references?: Partial<ResolvedGenerationReferences>
  runTask?: (vendor: string, request: TaskRequestDto) => Promise<TaskResultDto>
  listCatalogModels?: (params: { kind: BillingModelKind; enabled: true }) => Promise<ModelCatalogModelDto[]>
  fetchTaskResult?: (payload: {
    taskId: string
    vendor?: string
    taskKind?: TaskKind
    prompt?: string | null
    modelKey?: string | null
  }) => Promise<{ vendor: string; result: TaskResultDto }>
  pollIntervalMs?: number
  pollTimeoutMs?: number
}

const TERMINAL_STATUSES = new Set(['succeeded', 'failed'])

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asFiniteNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => asTrimmedString(item)).filter(Boolean)
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function selectedVendor(node: GenerationCanvasNode): string {
  const meta = node.meta || {}
  return (
    asTrimmedString(meta.modelVendor) ||
    asTrimmedString(meta.vendor) ||
    asTrimmedString(meta.imageModelVendor) ||
    asTrimmedString(meta.videoModelVendor)
  )
}

function selectedModelKey(node: GenerationCanvasNode): string {
  const meta = node.meta || {}
  return (
    asTrimmedString(meta.modelKey) ||
    asTrimmedString(meta.modelAlias) ||
    asTrimmedString(meta.imageModel) ||
    asTrimmedString(meta.videoModel)
  )
}

function normalizedModelIdentifier(value: string): string {
  const trimmed = value.trim()
  return trimmed.startsWith('models/') ? trimmed.slice(7) : trimmed
}

function catalogKindForNode(node: GenerationCanvasNode): BillingModelKind {
  return getGenerationNodeCatalogKind(node.kind)
}

function modelMatchesIdentifier(model: ModelCatalogModelDto, identifier: string): boolean {
  const normalized = normalizedModelIdentifier(identifier)
  const candidates = [
    model.modelKey,
    model.modelAlias || '',
  ].map((value) => normalizedModelIdentifier(String(value || '').trim())).filter(Boolean)
  return candidates.includes(normalized)
}

async function resolveExecutableNodeFromCatalog(
  node: GenerationCanvasNode,
  options: CatalogTaskActionOptions,
): Promise<GenerationCanvasNode> {
  const vendor = selectedVendor(node)
  const modelKey = selectedModelKey(node)
  if (vendor || !modelKey) return node

  const listCatalogModels = options.listCatalogModels || listWorkbenchModelCatalogModels
  let models: ModelCatalogModelDto[]
  try {
    models = await listCatalogModels({ kind: catalogKindForNode(node), enabled: true })
  } catch (error: unknown) {
    const message = error instanceof Error && error.message ? error.message : String(error)
    throw new Error(`模型目录解析失败：${message}`)
  }

  const matches = models.filter((model) => model.enabled && modelMatchesIdentifier(model, modelKey))
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `模型目录中找不到可执行模型：${modelKey}`
        : `模型目录中存在多个同名模型，请重新选择模型：${modelKey}`,
    )
  }

  const match = matches[0]
  const resolvedVendor = asTrimmedString(match.vendorKey)
  if (!resolvedVendor) throw new Error(`模型目录缺少 vendorKey：${modelKey}`)
  return {
    ...node,
    meta: {
      ...(node.meta || {}),
      modelKey: asTrimmedString(match.modelKey) || modelKey,
      modelAlias: asTrimmedString(match.modelAlias) || modelKey,
      modelVendor: resolvedVendor,
      vendor: resolvedVendor,
      modelLabel: asTrimmedString(match.labelZh) || modelKey,
      ...(isVideoLikeGenerationNodeKind(node.kind)
        ? { videoModel: asTrimmedString(match.modelKey) || modelKey, videoModelVendor: resolvedVendor }
        : { imageModel: asTrimmedString(match.modelKey) || modelKey, imageModelVendor: resolvedVendor }),
    },
  }
}

function resolveTaskKind(node: GenerationCanvasNode, references: Partial<ResolvedGenerationReferences>): TaskKind {
  const executionKind = getGenerationNodeExecutionKind(node.kind)
  if (executionKind === 'video') {
    // 认得档案的模型：mapping 桶**显式**由档案声明（archetype.transportTaskKind），不靠参考启发式猜——
    // 否则 Seedance omni（无首帧）会被误判成 text_to_video 而撞到 HappyHorse 的 mapping。同一档案所有模式
    // 打同一 createTask 端点（供应商按 model enum 自分流）。
    const meta = node.meta || {}
    const archetype = resolveArchetypeForModel({ modelKey: asTrimmedString(meta.modelKey), modelAlias: asTrimmedString(meta.modelAlias), meta })
    if (archetype) return archetype.transportTaskKind
    const hasFrame = Boolean(
      asTrimmedString(references.firstFrameUrl) ||
      asTrimmedString(references.lastFrameUrl) ||
      (references.referenceImages?.length || 0) > 0,
    )
    return hasFrame ? 'image_to_video' : 'text_to_video'
  }
  if (executionKind === 'image') {
    const hasReference = (references.referenceImages?.length || 0) > 0
    return hasReference ? 'image_edit' : 'text_to_image'
  }
  // C5: 文本节点走 chat（runtime 的 wantedKind=text 分支 → /v1/chat/completions）。
  if (executionKind === 'text') return 'chat'
  throw new Error(`${node.kind} generation is not implemented yet`)
}

const TEXT_TASK_KINDS = new Set<TaskKind>(['chat', 'prompt_refine', 'image_to_prompt'])

/**
 * C5: 从 chat 任务的 raw 响应里取出模型生成的文本。runtime 文本分支直接 POST
 * /v1/chat/completions 并把响应原样放进 raw（assets 为空），所以这里要兼容
 * OpenAI（choices[].message.content）与 Anthropic Messages（content[].text）两种形状。
 */
function extractTextFromChatRaw(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return ''
  const record = raw as Record<string, unknown>
  const choices = record.choices
  if (Array.isArray(choices) && choices.length) {
    const first = choices[0] as Record<string, unknown> | undefined
    const message = first?.message as Record<string, unknown> | undefined
    const content = message?.content
    if (typeof content === 'string') return content.trim()
    if (Array.isArray(content)) {
      return content
        .map((part) => (typeof part === 'string' ? part : asTrimmedString((part as Record<string, unknown>)?.text)))
        .filter(Boolean)
        .join('')
        .trim()
    }
    const legacyText = asTrimmedString(first?.text)
    if (legacyText) return legacyText
  }
  const content = record.content
  if (Array.isArray(content)) {
    const joined = content
      .map((part) => asTrimmedString((part as Record<string, unknown>)?.text))
      .filter(Boolean)
      .join('')
      .trim()
    if (joined) return joined
  }
  return asTrimmedString(record.text)
}

function firstAsset(result: TaskResultDto, expectedType: GenerationResultType): TaskAssetDto {
  const asset = result.assets.find((item) => item.type === expectedType && asTrimmedString(item.url))
  if (!asset) {
    const label = expectedType === 'image' ? '图片' : '视频'
    throw new Error(`模型任务完成但没有返回${label}地址`)
  }
  return asset
}

function generationTypeForTask(taskKind: TaskKind): GenerationResultType {
  if (taskKind === 'text_to_video' || taskKind === 'image_to_video') return 'video'
  return 'image'
}

function readFailureMessageFromRaw(raw: unknown): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ''
  const record = raw as Record<string, unknown>
  const direct = [
    record.message,
    record.error,
    record.errorMessage,
    record.failureReason,
    record.reason,
  ]
  for (const value of direct) {
    const text = asTrimmedString(value)
    if (text) return text
  }
  const nested = [record.raw, record.response, record.data, record.result]
  for (const value of nested) {
    const text = readFailureMessageFromRaw(value)
    if (text) return text
  }
  return ''
}

function describeTaskFailure(result: TaskResultDto): string {
  const rawMessage = readFailureMessageFromRaw(result.raw)
  const suffix = [
    result.id ? `taskId=${result.id}` : '',
    result.kind ? `kind=${result.kind}` : '',
  ].filter(Boolean).join(', ')
  const prefix = rawMessage || '模型任务执行失败'
  return suffix ? `${prefix} (${suffix})` : prefix
}

function readDurationSeconds(node: GenerationCanvasNode): number | undefined {
  const meta = node.meta || {}
  return asFiniteNumber(meta.durationSeconds) ?? asFiniteNumber(meta.videoDuration)
}

function buildReferenceExtras(
  node: GenerationCanvasNode,
  references: Partial<ResolvedGenerationReferences>,
): Record<string, unknown> {
  const meta = node.meta || {}
  const referenceImages = uniqueStrings([
    ...readStringArray(meta.referenceImages),
    ...(references.referenceImages || []),
  ])
  const styleReferenceImages = uniqueStrings([
    ...readStringArray(meta.styleReferenceImages),
    ...(references.styleReferenceImages || []),
  ])
  const characterReferenceImages = uniqueStrings([
    ...readStringArray(meta.characterReferenceImages),
    ...(references.characterReferenceImages || []),
  ])
  const compositionReferenceImages = uniqueStrings([
    ...readStringArray(meta.compositionReferenceImages),
    ...(references.compositionReferenceImages || []),
  ])
  // 认得档案的模型 → renderer 据**当前模式**把参考值打成完整 snake input（含 per-mode enum），放进
  // extras.archetypeInput，runtime 原样铺进 params（M1/M2/M3）。别的模式的残留键根本不进结果（互斥）。
  // 认不出 → 现有无条件带首/尾帧（非档案模型走老路）。
  const archetype = resolveArchetypeForModel({
    modelKey: asTrimmedString(meta.modelKey),
    modelAlias: asTrimmedString(meta.modelAlias),
    meta,
  })
  if (archetype) {
    const archetypeInput = buildArchetypeInputParams(meta, archetype, {
      firstFrameUrl: asTrimmedString(references.firstFrameUrl) || null,
      lastFrameUrl: asTrimmedString(references.lastFrameUrl) || null,
    })
    return {
      ...(referenceImages.length ? { referenceImages } : {}),
      archetypeInput,
      ...(styleReferenceImages.length ? { styleReferenceImages } : {}),
      ...(characterReferenceImages.length ? { characterReferenceImages } : {}),
      ...(compositionReferenceImages.length ? { compositionReferenceImages } : {}),
    }
  }

  const firstFrameUrl = asTrimmedString(references.firstFrameUrl) || asTrimmedString(meta.firstFrameUrl)
  const lastFrameUrl = asTrimmedString(references.lastFrameUrl) || asTrimmedString(meta.lastFrameUrl)
  return {
    ...(referenceImages.length ? { referenceImages } : {}),
    ...(firstFrameUrl ? { firstFrameUrl } : {}),
    ...(lastFrameUrl ? { lastFrameUrl } : {}),
    ...(styleReferenceImages.length ? { styleReferenceImages } : {}),
    ...(characterReferenceImages.length ? { characterReferenceImages } : {}),
    ...(compositionReferenceImages.length ? { compositionReferenceImages } : {}),
  }
}

export function buildCatalogTaskRequest(
  node: GenerationCanvasNode,
  options: CatalogTaskActionOptions = {},
): { vendor: string; request: TaskRequestDto } {
  const vendor = selectedVendor(node)
  if (!vendor) throw new Error('请先在模型管理里选择一个可用模型')
  const modelKey = selectedModelKey(node)
  if (!modelKey) throw new Error('请先选择模型')
  const prompt = asTrimmedString(node.prompt)
  if (!prompt) throw new Error('prompt is required')

  const references = options.references || {}
  const kind = resolveTaskKind(node, references)
  const meta = node.meta || {}
  const width = asFiniteNumber(meta.width)
  const height = asFiniteNumber(meta.height)
  const steps = asFiniteNumber(meta.steps)
  const cfgScale = asFiniteNumber(meta.cfgScale)
  const seed = asFiniteNumber(meta.seed)

  return {
    vendor,
    request: {
      kind,
      prompt,
      ...(typeof seed === 'number' ? { seed } : {}),
      ...(typeof width === 'number' ? { width } : {}),
      ...(typeof height === 'number' ? { height } : {}),
      ...(typeof steps === 'number' ? { steps } : {}),
      ...(typeof cfgScale === 'number' ? { cfgScale } : {}),
      extras: {
        ...meta,
        modelKey,
        modelAlias: asTrimmedString(meta.modelAlias) || modelKey,
        nodeId: node.id,
        nodeKind: node.kind,
        ...buildReferenceExtras(node, references),
      },
    },
  }
}

export function normalizeCatalogTaskResult(
  result: TaskResultDto,
  node: GenerationCanvasNode,
): GenerationNodeResult {
  if (result.status === 'failed') {
    throw new Error(describeTaskFailure(result))
  }
  // C5: 文本任务没有 asset，文本在 raw 里。单独成支，不走下面的图片/视频 asset 逻辑。
  if (TEXT_TASK_KINDS.has(result.kind)) {
    const text = extractTextFromChatRaw(result.raw)
    if (!text) throw new Error('模型任务完成但没有返回文本内容')
    const provenance = extractProvenanceFromTaskResult(result)
    return {
      id: `${node.id}-${result.id || Date.now()}`,
      type: 'text',
      text,
      model: selectedModelKey(node) || undefined,
      taskId: result.id,
      taskKind: 'text',
      raw: result.raw,
      createdAt: Date.now(),
      ...(provenance ? { provenance } : {}),
    }
  }
  const inferredType = generationTypeForTask(result.kind)
  // Prefer actual asset type over taskKind inference — if the API returns a video asset, show video
  const firstVideoAsset = result.assets.find((item) => item.type === 'video' && asTrimmedString(item.url))
  const firstImageAsset = result.assets.find((item) => item.type === 'image' && asTrimmedString(item.url))
  const asset = firstVideoAsset || firstImageAsset || result.assets.find((item) => asTrimmedString(item.url))
  if (!asset) throw new Error(inferredType === 'video' ? '模型任务完成但没有返回视频地址' : '模型任务完成但没有返回图片地址')
  const type = (asset.type === 'video' || asset.type === 'image') ? asset.type : inferredType
  // E11: propagate provenance from electron TaskResult into the node result.
  const provenance = extractProvenanceFromTaskResult(result)
  return {
    id: `${node.id}-${result.id || Date.now()}`,
    type,
    url: asset.url,
    thumbnailUrl: asset.thumbnailUrl || undefined,
    model: selectedModelKey(node) || undefined,
    durationSeconds: type === 'video' ? readDurationSeconds(node) : undefined,
    taskId: result.id,
    taskKind: type,
    assetId: asset.assetId || undefined,
    assetRefId: asset.assetRefId || undefined,
    raw: result.raw,
    createdAt: Date.now(),
    ...(provenance ? { provenance } : {}),
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}

async function waitForCatalogTaskResult(
  vendor: string,
  request: TaskRequestDto,
  initialResult: TaskResultDto,
  options: CatalogTaskActionOptions,
): Promise<TaskResultDto> {
  if (TERMINAL_STATUSES.has(initialResult.status)) return initialResult
  const pollIntervalMs = options.pollIntervalMs ?? 1500
  const defaultTimeout = (request.kind === 'text_to_video' || request.kind === 'image_to_video') ? 300000 : 120000
  const pollTimeoutMs = options.pollTimeoutMs ?? defaultTimeout
  const startedAt = Date.now()
  const fetchResult = options.fetchTaskResult || fetchWorkbenchTaskResultByVendor

  let current = initialResult
  while (!TERMINAL_STATUSES.has(current.status)) {
    if (Date.now() - startedAt > pollTimeoutMs) {
      throw new Error(`模型任务轮询超时: ${initialResult.id}`)
    }
    await delay(pollIntervalMs)
    const response = await fetchResult({
      taskId: initialResult.id,
      vendor,
      taskKind: request.kind,
      prompt: request.prompt,
      modelKey: asTrimmedString(request.extras?.modelKey) || null,
    })
    current = response.result
  }
  return current
}

export async function runCatalogGenerationTask(
  node: GenerationCanvasNode,
  options: CatalogTaskActionOptions = {},
): Promise<GenerationNodeResult> {
  const executableNode = await resolveExecutableNodeFromCatalog(node, options)
  const { vendor, request } = buildCatalogTaskRequest(executableNode, options)
  const runTask = options.runTask || runWorkbenchTaskByVendor
  const initialResult = await runTask(vendor, request)
  const finalResult = await waitForCatalogTaskResult(vendor, request, initialResult, options)
  return normalizeCatalogTaskResult(finalResult, executableNode)
}

/**
 * E11: Extract provenance from electron TaskResult.
 *
 * The runtime attaches a `provenance` sibling field at the TaskResult level
 * (see electron/runtime.ts runTask). This helper validates the minimum
 * required field (`timestamp`) and returns a clean GenerationProvenance
 * for the renderer to embed in node.result.provenance.
 *
 * Returns undefined for legacy results (e.g., from v0.4.0 cached tasks).
 */
function extractProvenanceFromTaskResult(result: TaskResultDto): GenerationProvenance | undefined {
  const raw = (result as TaskResultDto & { provenance?: unknown }).provenance
  if (!raw || typeof raw !== 'object') return undefined
  const rec = raw as Record<string, unknown>
  const ts = typeof rec.timestamp === 'number' ? rec.timestamp : Date.now()
  return {
    timestamp: ts,
    ...(typeof rec.provider === 'string' ? { provider: rec.provider } : {}),
    ...(typeof rec.modelKey === 'string' ? { modelKey: rec.modelKey } : {}),
    ...(typeof rec.modelVersion === 'string' ? { modelVersion: rec.modelVersion } : {}),
    ...(typeof rec.prompt === 'string' ? { prompt: rec.prompt } : {}),
    ...(typeof rec.negativePrompt === 'string' ? { negativePrompt: rec.negativePrompt } : {}),
    ...(typeof rec.seed === 'number' ? { seed: rec.seed } : {}),
    ...(rec.params && typeof rec.params === 'object' ? { params: rec.params as Record<string, unknown> } : {}),
    ...(typeof rec.vendorRequestId === 'string' ? { vendorRequestId: rec.vendorRequestId } : {}),
    ...(typeof rec.agentRunId === 'string' ? { agentRunId: rec.agentRunId } : {}),
  }
}
