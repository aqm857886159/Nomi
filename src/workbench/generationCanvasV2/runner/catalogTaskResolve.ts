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
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import {
  getGenerationNodeCatalogKind,
  getGenerationNodeExecutionKind,
  isVideoLikeGenerationNodeKind,
} from '../model/generationNodeKinds'
import type { ResolvedGenerationReferences } from './generationReferenceResolver'
import { resolveArchetypeForModel } from '../../../config/modelArchetypes'
import { currentArchetypeMode } from '../nodes/controls/archetypeMeta'
import { loadUsableVendorKeys, remapArchetypeMode, resolveUsableModelForNode } from './usableVendorModel'

export type CatalogTaskActionOptions = {
  references?: Partial<ResolvedGenerationReferences>
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
  let usable: Set<string> | null = null
  try {
    usable = await loadUsableVendorKeys(listVendors)
  } catch {
    usable = null
  }
  if (!usable) return node

  // Happy path：钉死的供应商现在仍可用 → 原样执行（绝大多数情况）。
  if (vendor && usable.has(vendor)) return node
  // 钉了供应商但它现在不可用、却又没有 modelKey 可据以重解析 → 直接报清晰错误。
  if (!modelKey) {
    throw new Error(`供应商「${vendor}」已断开，且该节点未记录模型。请重新连接，或在该节点上改选已连接供应商的模型。`)
  }

  const listCatalogModels = options.listCatalogModels || listWorkbenchModelCatalogModels
  let models: ModelCatalogModelDto[]
  try {
    models = await listCatalogModels({ kind: catalogKindForNode(node), enabled: true })
  } catch (error: unknown) {
    const message = error instanceof Error && error.message ? error.message : String(error)
    throw new Error(`模型目录解析失败：${message}`)
  }

  const meta = node.meta || {}
  const modelAlias = asTrimmedString(meta.modelAlias)
  const match = resolveUsableModelForNode({ modelKey, modelAlias, vendor, meta, models, usable })
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
    ? remapArchetypeMode(sourceArchetype, asTrimmedString((meta.archetype as { modeId?: unknown } | undefined)?.modeId) || undefined, targetArchetype)
    : null

  return {
    ...node,
    meta: {
      ...meta,
      modelKey: asTrimmedString(match.modelKey) || modelKey,
      modelAlias: asTrimmedString(match.modelAlias) || modelKey,
      modelVendor: resolvedVendor,
      vendor: resolvedVendor,
      modelLabel: asTrimmedString(match.labelZh) || modelKey,
      ...(remappedArchetype ? { archetype: remappedArchetype } : {}),
      ...(isVideoLikeGenerationNodeKind(node.kind)
        ? { videoModel: asTrimmedString(match.modelKey) || modelKey, videoModelVendor: resolvedVendor }
        : { imageModel: asTrimmedString(match.modelKey) || modelKey, imageModelVendor: resolvedVendor }),
    },
  }
}

export function resolveTaskKind(node: GenerationCanvasNode, references: Partial<ResolvedGenerationReferences>): TaskKind {
  const executionKind = getGenerationNodeExecutionKind(node.kind)
  const meta = node.meta || {}
  // 认得档案的模型（视频**或图像**）：mapping 桶**显式**由档案声明（当前模式 transportTaskKind 覆盖 > 档案级），
  // 不靠参考启发式猜——否则 Seedance omni（无首帧）会被误判 text_to_video 撞到别的模型；图像档案的文生图/改图
  // taskKind 也得各走各的桶。modelKey 精确路由（findTaskMapping）再保证打到本模型的 mapping。
  if (executionKind === 'video' || executionKind === 'image') {
    const archetype = resolveArchetypeForModel({ modelKey: asTrimmedString(meta.modelKey), modelAlias: asTrimmedString(meta.modelAlias), meta })
    if (archetype) return currentArchetypeMode(archetype, meta).transportTaskKind ?? archetype.transportTaskKind
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
  throw new Error(`${node.kind} generation is not implemented yet`)
}
