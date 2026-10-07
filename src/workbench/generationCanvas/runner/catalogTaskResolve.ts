import type { ProjectBinding } from '../../../../electron/shared/projectBinding'
import i18n from '../../../i18n'
import { tagNomiError } from '../../../../electron/shared/nomiErrorCodes'
import {
  type BillingModelKind,
  type ModelCatalogModelDto,
  type ModelCatalogVendorDto,
  listWorkbenchModelCatalogModels,
  listWorkbenchModelCatalogVendors,
} from '../../api/modelCatalogApi'
import {
  type FetchWorkbenchTaskResultRequestDto,
  type TaskKind,
  type TaskProjectIdentity,
  type TaskRequestDto,
  type TaskResultDto,
} from '../../api/taskApi'
import type { GenerationCanvasEdge, GenerationCanvasNode, GenerationNodeRunAttempt } from '../model/generationCanvasTypes'
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
} from '../../../../electron/shared/modelArchetypes'
import { currentArchetypeMode } from '../nodes/controls/archetypeMeta'
import { isComfyuiVendorKey } from '../model/comfyuiVendor'
import { resolveComfyWorkflowTaskKind } from '../../../../electron/catalog/comfyuiWorkflowTaskContract'
import { readParameterReferenceContract } from '../../../../electron/catalog/parameterReferenceContract'
import { remapArchetypeMode, resolveUsableModelForNode } from './usableVendorModel'
import type { MediaDimensions } from '../nodes/nodeSizing'

export type CatalogTaskActionOptions = {
  /** Intrinsic source dimensions discovered while localizing a media result. */
  onMediaDimensions?: (dimensions: MediaDimensions) => void
  references?: Partial<ResolvedGenerationReferences>
  /** Re-resolve declared inputs against the freshly selected catalog model, without persisting URLs. */
  referenceContext?: { nodes?: GenerationCanvasNode[]; edges?: GenerationCanvasEdge[] }
  /** Optional bounded QA retry instruction appended to the model prompt for this one run. */
  promptSuffix?: string
  /**
   * 单镜 Run 路（发动机收敛第一刀）：交 / 查都经主进程这一次运行的单镜 Run——要花钱的节点一律走它（单节点 ↑ 的批准是这一下点击，
   * 批量的批准是那张卡）。缺省 = 不花钱的本地 / 文本路。由控制器按节点定（`generationRunController.paidNodeLedger`）。
   */
  canvasRun?: { runRecordId: string }
  /** 提交幂等键（= node run.id）：随 request.extras 下到主进程，让同一次意图提交 at-most-once（不二次下单）。 */
  idempotencyKey?: string
  /** Renderer disclosure gate for a public temporary-host fallback. */
  anonymousAssetHostingConsent?: 'allow'
  runTask?: (vendor: string, request: TaskRequestDto, projectId: TaskProjectIdentity) => Promise<TaskResultDto>
  listCatalogModels?: (params: { kind?: BillingModelKind; enabled?: boolean; vendorKey?: string }) => Promise<ModelCatalogModelDto[]>
  listCatalogVendors?: () => Promise<ModelCatalogVendorDto[]>
  fetchTaskResult?: (payload: FetchWorkbenchTaskResultRequestDto) => Promise<{ vendor: string; result: TaskResultDto }>
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
    projectId: TaskProjectIdentity,
    opts: { onDelta?: (delta: string) => void },
  ) => Promise<TaskResultDto>
}

/** 真正提交一次任务的选项：运行所属项目（提交那一刻签发）必填。任务身份、结果本地化、接力抽帧只认它，不读「当前项目」。 */
export type CatalogTaskRunOptions = CatalogTaskActionOptions & { projectTarget: ProjectBinding }

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

/**
 * 这个节点**此刻会发给谁**：与 `buildCatalogTaskRequest` 读同一对选择器（`selectedVendor` / `selectedModelKey`），
 * 所以它就是请求真正发往的那一家、那个模型。运行开始时读一次、存进运行记录（GenerationNodeRunRecord.attempt）。
 * 选不出完整的一对（还没选模型）→ undefined：没有「发给谁」，也就没有「谁失败了」。
 */
export function dispatchedAttempt(node: GenerationCanvasNode): GenerationNodeRunAttempt | undefined {
  const vendorKey = selectedVendor(node)
  const modelKey = selectedModelKey(node)
  return vendorKey && modelKey ? { vendorKey, modelKey } : undefined
}

function catalogKindForNode(node: GenerationCanvasNode): BillingModelKind {
  return getGenerationNodeCatalogKind(node.kind)
}

/**
 * 这一行是不是**整条不在目录里了**（这家启用着，却查不到任何 kind、任何启停状态的同名行）。
 *
 * 判据与执行侧逐条同序：findExecutableModel 先看「这家启用没有」，再看「记录在不在」——不在就是
 * `Model is retired`（seedBuiltins 的退役清单摘掉了它）。这里不下「退役」结论，只决定**别抢答**：
 * 行不在 → 原样交给执行侧那唯一的判定；行还在（停用 / 钥匙不通 / 类型不符）→ 仍由下面给「供应商断开」的恢复路。
 */
async function catalogRowIsGone(
  listCatalogModels: NonNullable<CatalogTaskActionOptions['listCatalogModels']>,
  vendors: readonly ModelCatalogVendorDto[],
  vendorKey: string,
  modelKey: string,
): Promise<boolean> {
  if (!modelKey || !vendors.some((row) => row.key === vendorKey && row.enabled)) return false
  const rows = await listCatalogModels({ vendorKey })
  return !rows.some((row) => row.vendorKey === vendorKey && [row.modelKey, row.modelAlias].includes(modelKey))
}

export async function resolveExecutableNodeFromCatalog(
  node: GenerationCanvasNode,
  options: CatalogTaskActionOptions,
): Promise<GenerationCanvasNode> {
  const vendor = selectedVendor(node)
  const modelKey = selectedModelKey(node)

  // 没钉供应商也没 modelKey → 交给下游报「请先选择模型」（保持原行为）。
  if (!vendor && !modelKey) return node

  // 目录需要 catalog runtime；非 Electron 上下文（单测/Web）拿不到 → 退回旧行为：信任钉死的
  // 供应商（无法重解析，但也不该误抛）。能拿到时才进入「断开→自动迁移」新逻辑。
  const listVendors = options.listCatalogVendors || listWorkbenchModelCatalogVendors
  let vendors: ModelCatalogVendorDto[]
  try {
    vendors = await listVendors()
  } catch {
    return node
  }
  const listCatalogModels = options.listCatalogModels || listWorkbenchModelCatalogModels
  let models: ModelCatalogModelDto[] | null = null

  // Even an available vendor can have an updated parameter declaration. Refresh from the actual catalog.
  // Vendor availability is not proof that this exact model is executable: a sibling can keep the source
  // vendor alive after this model has migrated to a candidate revision. A missing exact row therefore
  // continues into the same whole-catalog lineage resolver used for disconnected vendors.
  // 目录里还有没有这一行供应商，是**身份**问题不是可用性问题（可用性由每行模型自带的 availability 答）。
  // 留着这道前置判断是为了「这家整个没了」时别白跑一次目录读取——那一趟在没有 catalog bridge 的
  // 调用方那里会被下面的 catch 吞成「原样返回」，用户就再也收不到「去模型设置」那句指路了。
  if (vendor && vendors.some((row) => row.key === vendor)) {
    try {
      models = await listCatalogModels({ kind: catalogKindForNode(node), enabled: true })
      const match = models.find((model) =>
        model.availability.usable && model.vendorKey === vendor && [model.modelKey, model.modelAlias].includes(modelKey),
      )
      if (match) return { ...node, meta: projectParameterReferenceSlots(node.meta || {}, match.meta) }
      // 这家启用着、目录里却**整条都没有**这一行 = 已退役下线（如 Sora 2）。那不是「供应商断开」：
      // 原样交给执行侧的唯一判定（findExecutableModel → `Model is retired`），节点落「这个模型已经下线了」
      // +「换个模型」，身份一个字不改（2026-09-09「可用性不许改选中身份」的裁决不变）。
      if (await catalogRowIsGone(listCatalogModels, vendors, vendor, modelKey)) return node
    } catch {
      // Non-desktop/test callers may have no model catalog bridge; retain their already validated declaration.
      return node
    }
  }
  if (vendor) throw new Error(tagNomiError('model-config', i18n.t('generationCommon.node.providerDisconnected', { vendor })))

  // 钉了供应商但它现在不可用、却又没有 modelKey 可据以重解析 → 直接报清晰错误。
  if (!modelKey) {
    throw new Error(tagNomiError('model-config', `供应商「${vendor}」已断开，且该节点未记录模型。请重新连接，或在该节点上改选已连接供应商的模型。`))
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
  const match = resolveUsableModelForNode({ modelKey, modelAlias, vendor, meta, models, vendors })
  if (!match) {
    const sourceArchetype = resolveArchetypeForModel({ modelKey, modelAlias, vendorKey: vendor, meta })
    const brand = sourceArchetype?.label || asTrimmedString(meta.modelLabel) || modelKey
    throw new Error(tagNomiError('model-config', `当前没有已连接的供应商提供「${brand}」模型。请重新连接原供应商，或在该节点上改选一个已连接供应商的模型。`))
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
