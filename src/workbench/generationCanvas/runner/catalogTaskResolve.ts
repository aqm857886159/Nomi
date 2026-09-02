import {
  type BillingModelKind,
  type ModelCatalogModelDto,
  type ModelCatalogVendorDto,
  listWorkbenchModelCatalogModels,
  listWorkbenchModelCatalogVendors,
} from '../../api/modelCatalogApi'
import {
  type TaskKind,
  type TaskRequestDto,
  type TaskResultDto,
} from '../../api/taskApi'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { projectParameterReferenceSlots } from '../model/parameterReferenceSlots'
import type { GenerationProgressPhase } from '../../observability/narrate'
import {
  getGenerationNodeCatalogKind,
  getGenerationNodeExecutionKind,
  isVideoLikeGenerationNodeKind,
} from '../model/generationNodeKinds'
import type { ResolvedGenerationReferences } from './generationReferenceResolver'
import {
  modeTransportFor,
  replaceCustomCapabilityContractMeta,
  resolveArchetypeForModel,
} from '../../../config/modelArchetypes'
import { currentArchetypeMode } from '../nodes/controls/archetypeMeta'
import { isComfyuiVendorKey } from '../model/comfyuiVendor'
import { resolveComfyWorkflowTaskKind } from '../../../../electron/catalog/comfyuiWorkflowTaskContract'
import { readParameterReferenceContract } from '../../../../electron/catalog/parameterReferenceContract'
import { remapArchetypeMode, resolveUsableModelForNode, usableVendorKeys } from './usableVendorModel'

export type CatalogTaskActionOptions = {
  references?: Partial<ResolvedGenerationReferences>
  /** Re-resolve declared inputs against the freshly selected catalog model, without persisting URLs. */
  referenceContext?: { nodes?: GenerationCanvasNode[]; edges?: GenerationCanvasEdge[] }
  /** Optional bounded QA retry instruction appended to the model prompt for this one run. */
  promptSuffix?: string
  /** 付费守卫令牌：真人确认后铸的 grantId，随 request.extras 下到主进程 runTask 核验消费。 */
  grantId?: string
  /** 提交幂等键（= node run.id）：随 request.extras 下到主进程，让同一次意图提交 at-most-once（不二次下单）。 */
  idempotencyKey?: string
  /** Renderer disclosure gate for a public temporary-host fallback. */
  anonymousAssetHostingConsent?: 'allow'
  runTask?: (vendor: string, request: TaskRequestDto) => Promise<TaskResultDto>
  listCatalogModels?: (params: { kind: BillingModelKind; enabled: true }) => Promise<ModelCatalogModelDto[]>
  listCatalogVendors?: () => Promise<ModelCatalogVendorDto[]>
  fetchTaskResult?: (payload: {
    taskId: string
    vendor?: string
    taskKind?: TaskKind
    prompt?: string | null
    modelKey?: string | null
  }) => Promise<{ vendor: string; result: TaskResultDto }>
  pollIntervalMs?: number
  pollTimeoutMs?: number
  /** 轮询抖动的随机源（默认 Math.random）。只为让抖动可直测，产品代码不传。 */
  pollRandom?: () => number
  /** S2 进度报告:catalog 任务各阶段回报(phase 经 narrate 翻成人话,治 bug② 卡 30 秒像死了)。 */
  onProgress?: (progress: { phase: GenerationProgressPhase; message: string; taskId?: string }) => void
  /** 文本任务逐 token 回调(流式)。仅文本 kind 生效;提供时走流式通道,否则一次性返回。 */
  onTextDelta?: (delta: string) => void
  /** 测试注入:替换流式文本执行(默认 runWorkbenchTextTaskStream),避免触网/desktop runtime。 */
  runTextStream?: (
    vendor: string,
    request: TaskRequestDto,
    opts: { onDelta?: (delta: string) => void },
  ) => Promise<TaskResultDto>
}

export function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function asFiniteNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => asTrimmedString(item)).filter(Boolean)
}

export function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

export function resolveTaskArchetype(meta: Record<string, unknown>) {
  const vendor = asTrimmedString(meta.modelVendor) || asTrimmedString(meta.vendor)
  const modelKey = asTrimmedString(meta.modelKey) || asTrimmedString(meta.modelAlias)
  // 本地 ComfyUI workflow 是用户导入的通用图，不是内置档案模型。旧节点可能残留上一模型的
  // meta.archetype，若继续信它，参考图会被投到 archetypeInput 而不是 workflow 的 flat 参数。
  // 判据必须用前缀判据而非字面量：第 2+ 台实例的 key 是 `comfyui-local-{slug}`（见
  // AddComfyuiInstanceButton），硬比 'comfyui-local' 只保得住第一台。
  if (isComfyuiVendorKey(vendor)) return null
  return resolveArchetypeForModel({
    modelKey,
    modelAlias: asTrimmedString(meta.modelAlias),
    vendorKey: vendor || null,
    meta,
  })
}

export function selectedVendor(node: GenerationCanvasNode): string {
  const meta = node.meta || {}
  return (
    asTrimmedString(meta.modelVendor) ||
    asTrimmedString(meta.vendor) ||
    asTrimmedString(meta.imageModelVendor) ||
    asTrimmedString(meta.videoModelVendor)
  )
}

export function selectedModelKey(node: GenerationCanvasNode): string {
  const meta = node.meta || {}
  return (
    asTrimmedString(meta.modelKey) ||
    asTrimmedString(meta.modelAlias) ||
    asTrimmedString(meta.imageModel) ||
    asTrimmedString(meta.videoModel)
  )
}

function catalogKindForNode(node: GenerationCanvasNode): BillingModelKind {
  return getGenerationNodeCatalogKind(node.kind)
}

export async function resolveExecutableNodeFromCatalog(
  node: GenerationCanvasNode,
  options: CatalogTaskActionOptions,
): Promise<GenerationCanvasNode> {
  const vendor = selectedVendor(node)
  const modelKey = selectedModelKey(node)

  // 没钉供应商也没 modelKey → 交给下游报「请先选择模型」（保持原行为）。
  if (!vendor && !modelKey) return node

  // 「可用供应商」需要 catalog runtime；非 Electron 上下文（单测/Web）拿不到 → 退回旧行为：信任钉死的
  // 供应商（无法重解析，但也不该误抛）。能拿到时才进入「断开→自动迁移」新逻辑。
  const listVendors = options.listCatalogVendors || listWorkbenchModelCatalogVendors
  let vendors: ModelCatalogVendorDto[]
  let usable: Set<string>
  try {
    vendors = await listVendors()
    usable = usableVendorKeys(vendors)
  } catch {
    return node
  }
  const listCatalogModels = options.listCatalogModels || listWorkbenchModelCatalogModels
  let models: ModelCatalogModelDto[] | null = null

  // Even an available vendor can have an updated parameter declaration. Refresh from the actual catalog.
  // Vendor availability is not proof that this exact model is executable: a sibling can keep the source
  // vendor alive after this model has migrated to a candidate revision. A missing exact row therefore
  // continues into the same whole-catalog lineage resolver used for disconnected vendors.
  if (vendor && usable.has(vendor)) {
    try {
      models = await listCatalogModels({ kind: catalogKindForNode(node), enabled: true })
      const match = models.find((model) =>
        model.published && model.vendorKey === vendor && [model.modelKey, model.modelAlias].includes(modelKey),
      )
      if (match) return { ...node, meta: projectParameterReferenceSlots(node.meta || {}, match.meta) }
    } catch {
      // Non-desktop/test callers may have no model catalog bridge; retain their already validated declaration.
      return node
    }
  }
  // 钉了供应商但它现在不可用、却又没有 modelKey 可据以重解析 → 直接报清晰错误。
  if (!modelKey) {
    throw new Error(`供应商「${vendor}」已断开，且该节点未记录模型。请重新连接，或在该节点上改选已连接供应商的模型。`)
  }

  if (!models) {
    try {
      models = await listCatalogModels({ kind: catalogKindForNode(node), enabled: true })
    } catch (error: unknown) {
      const message = error instanceof Error && error.message ? error.message : String(error)
      const catalogError = new Error(`模型目录解析失败：${message}`) as Error & { cause?: unknown }
      catalogError.cause = error
      throw catalogError
    }
  }

  const meta = node.meta || {}
  const modelAlias = asTrimmedString(meta.modelAlias)
  const match = resolveUsableModelForNode({ modelKey, modelAlias, vendor, meta, models, vendors, usable })
  if (!match) {
    const sourceArchetype = resolveArchetypeForModel({ modelKey, modelAlias, vendorKey: vendor, meta })
    const brand = sourceArchetype?.label || asTrimmedString(meta.modelLabel) || modelKey
    throw new Error(`当前没有已连接的供应商提供「${brand}」模型。请重新连接原供应商，或在该节点上改选一个已连接供应商的模型。`)
  }

  const resolvedVendor = asTrimmedString(match.vendorKey)
  if (!resolvedVendor) throw new Error(`模型目录缺少 vendorKey：${modelKey}`)
  // 跨档案迁移（family 兜底，如 Seedance kie↔apimart）时把 node.meta.archetype 重映射到目标档案；
  // 同档案（同 id）保持原样（参数槽会按新 vendorKey 自动特化，无需动用户填的值）。
  const sourceArchetype = resolveArchetypeForModel({ modelKey, modelAlias, vendorKey: vendor, meta })
  const targetArchetype = resolveArchetypeForModel({ modelKey: match.modelKey, modelAlias: match.modelAlias, vendorKey: resolvedVendor, meta: match.meta })
  const remappedArchetype = targetArchetype
    ? remapArchetypeMode(sourceArchetype, asTrimmedString((meta.archetype as { modeId?: unknown } | undefined)?.modeId) || undefined, targetArchetype, vendor, resolvedVendor)
    : null
  const migratedMeta = replaceCustomCapabilityContractMeta(meta, match.meta)

  return {
    ...node,
    meta: projectParameterReferenceSlots({
      ...migratedMeta,
      modelKey: asTrimmedString(match.modelKey) || modelKey,
      modelAlias: asTrimmedString(match.modelAlias) || modelKey,
      modelVendor: resolvedVendor,
      vendor: resolvedVendor,
      modelLabel: asTrimmedString(match.labelZh) || modelKey,
      ...(remappedArchetype ? { archetype: remappedArchetype } : {}),
      ...(isVideoLikeGenerationNodeKind(node.kind)
        ? { videoModel: asTrimmedString(match.modelKey) || modelKey, videoModelVendor: resolvedVendor }
        : { imageModel: asTrimmedString(match.modelKey) || modelKey, imageModelVendor: resolvedVendor }),
    }, match.meta),
  }
}

export function resolveTaskKind(node: GenerationCanvasNode, references: Partial<ResolvedGenerationReferences>): TaskKind {
  const executionKind = getGenerationNodeExecutionKind(node.kind)
  const meta = node.meta || {}
  // 认得档案的模型（视频**或图像**）：mapping 桶**显式**由档案声明（供应商特化 > 当前模式 > 档案级，
  // 收口在 modeTransportFor），不靠参考启发式猜——否则 Seedance omni（无首帧）会被误判 text_to_video
  // 撞到别的模型；图像档案的文生图/改图 taskKind 也得各走各的桶。供应商这一档是必要的：同一模型身份
  // 在 kie 是单端点（text_to_video）、在 Runway 图模式走 /v1/image_to_video，桶不同。
  // modelKey 精确路由（findTaskMapping）再保证打到本模型的 mapping。
  // model3d 同走档案声明桶（text_to_3d / image_to_3d 由模式 transportTaskKind 决定）。此前这里漏 3D →
  // RunningHub 混元/Meshy（带档案、非 comfy）直接砸到底部 throw「not implemented yet」（同族 kind 边界漏 3D）。
  if (executionKind === 'video' || executionKind === 'image' || executionKind === 'audio' || executionKind === 'model3d') {
    const archetype = resolveTaskArchetype(meta)
    if (archetype) {
      const transport = modeTransportFor(currentArchetypeMode(archetype, meta), archetype, selectedVendor(node))
      if (transport) return transport
    }
  }
  const parameterContract = readParameterReferenceContract(meta)
  if (isComfyuiVendorKey(selectedVendor(node)) && parameterContract && isComfyuiVendorKey(parameterContract.vendorKey)
    && (executionKind === 'image' || executionKind === 'video' || executionKind === 'model3d')) {
    return resolveComfyWorkflowTaskKind(executionKind, parameterContract.slots)
  }
  if (executionKind === 'video') {
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
  // 音频节点档案缺失时的兜底（正常 AUDIO_MODELS 都带档案，走上面的 transportTaskKind）。
  if (executionKind === 'audio') return 'text_to_audio'
  // 3D 档案缺失时的兜底（自定义直连），启发式与 image/video 同口径：有图参考 → 图生3D。
  if (executionKind === 'model3d') {
    const hasReference = Boolean(asTrimmedString(references.firstFrameUrl)) || (references.referenceImages?.length || 0) > 0
    return hasReference ? 'image_to_3d' : 'text_to_3d'
  }
  throw new Error(`${node.kind} generation is not implemented yet`)
}
