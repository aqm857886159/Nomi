import { resolveModelParams } from '../../../../../electron/shared/videoCapabilities/resolveModelParams'
// 内置「模型档案」与生成节点 UI 之间的桥（C2b）。
//
// 职责：把档案的 modes/slots/params（electron/shared/modelArchetypes，供应商无关）映射成节点 UI
// 需要的三样东西 —— ① 模式分段切换的选项、② 当前模式的参考槽（复用现有 ImageUrlSlot 形状）、
// ③ 当前模式的标量参数。
//
// **参考图存储模型（2026-10-22 方向检查重写）**：上传的图片只存**一份有序列表**（referenceList.ts，
// meta.referenceImageUrls），跨模式、跨模型不动；「落哪个槽、在不在用」每次由 placeUploadedImages 推导，
// 参考行（resolveReferencePlacement）和发送（buildArchetypeInputParams / uploadPlacementForMode）同一个函数。
// 视频 / 音频 / 源视频仍按 slot 键存在 flat meta 里。**模式互斥（M2）**：archetypeInput 只含当前模式声明的槽键。
// node.meta.archetype 只记 { id, modeId }（当前模式），不囤参考数据。
//
// C2b 只处理首帧 / 尾帧两类 frame 槽，映射到现有 flat 传输键（firstFrameUrl/lastFrameUrl），
// 传输层零改动。image_ref / video_ref / audio_ref（数组槽）在 C3 接入档案驱动的 input-builder。
import {
  type ArchetypeMode,
  type ArchetypeReferenceSlotKind,
  type ModelArchetype,
  type ModelArchetypeVariant,
  archetypeBaseModelKey,
  archetypeVariantForModelId,
  canonicalArchetypeVariantId,
  resolveArchetypeForModel,
  resolveArchetypeVariant,
  specializeArchetypeForVariant,
} from '../../../../../electron/shared/modelArchetypes'
import type { ImageUrlSlot } from '../../model/parameterReferenceSlots'
import { translateModelDisplayText } from '../../../../i18n/modelDisplayText'
import { firstFrameLeftEmpty, isImageUploadSlot, listPlacementInputs, normalizeReferenceListMeta, placeUploadedImages, readParkedReferences, readReferenceList, withReferenceList, type UploadPlacement } from './referenceList'
import { readModePreference, withHumanModePreference } from './modePreference'
import { modeForInputs, type ModeForInputsResult, type ModeInput } from '../../../../../electron/shared/modelArchetypes/modeForInputs'
import { EDGE_MODE_SLOTS, isTextPromptEdge, referenceAssetKindForNode } from '../../../../../electron/shared/canvas/edgeAdmission'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { readArchetypeArray } from './archetypeArrayValues'
export { appendArchetypeArrayValue, archetypeArrayWrite, readArchetypeArray, readArchetypeArrayForWrite, type ArchetypeArrayAppend } from './archetypeArrayValues'
import {
  modeSlotReach,
  wireReferencedParamKeys,
  type SlotReach,
} from '../../../../../electron/catalog/referenceReachability'
export { archetypeModeParams, archetypeModeSourceVideoSlot, localizeModelParameterControl } from './archetypeModePresentation'
import { lowerGenerationIntent, loweringAsArray, type IntentReference } from '../../../../../electron/shared/generationLowering/lowerGenerationIntent'
import { declarationForMode } from '../../../../../electron/shared/generationLowering/declarationForMode'

export { resolveArchetypeForModel }
export type { ModelArchetype, ArchetypeMode, ModelArchetypeVariant }

// 可达性判据（第三闸与 UI 收窄共用的那把尺子）经**本模块**转出给渲染层的其它文件（channelModeReach）。
// 为什么从这里转、而不是让它各自 import electron/：`src-no-import-electron` 是棘轮门岗，本文件那条越界
// 已登记在 boundaries-baseline 里；新开一个文件直连 electron/ 会被判成**新增**违规（棘轮只减不增，绝不
// 许把新违规追加进基线）。转出一次 = 渲染层对 electron/ 的入口仍只有这一处，基线不涨。
export { modeSlotReach, wireReferencedParamKeys }
export type { SlotReach }

/**
 * 单图 frame 槽 → 现有 flat 传输键映射（首/尾帧，走画布边 + 单缩略图）。url 键即传输读取的键
 * （runtime taskTemplateParams 读 extras.firstFrameUrl/lastFrameUrl）；ref 键记住来源节点 id。
 */
const FRAME_SLOT_FLAT: Partial<
  Record<ArchetypeReferenceSlotKind, { urlKey: string; refKey: string; group: ImageUrlSlot['group'] }>
> = {
  first_frame: { urlKey: 'firstFrameUrl', refKey: 'firstFrameRef', group: 'first_frame' },
  last_frame: { urlKey: 'lastFrameUrl', refKey: 'lastFrameRef', group: 'last_frame' },
}

/**
 * 多参考**数组**槽（C3）→ 路由键。值有两个来源：① 有序画布边（edge.order 保 character1..N，
 * audit 2026-06-16 §1d 收口）② 手动上传存 meta（无源节点的真上传）；两者在 resolveReferenceSlots/
 * buildArchetypeInputParams 合并去重、按序。
 * - metaKey：渲染层把**手动上传**的数组存这（camelCase，全局持久，跨模式保留）。
 * - paramKey：runtime taskTemplateParams 映射出的**通用 snake 参数键**（与供应商无关）。
 *   供应商真正的 input 键（如 kie 的 `reference_video_urls ` 含尾随空格 §2 坑1）只在该供应商的
 *   mapping body 里写一次（electron/catalog/kieSeedance），不在这里 —— 档案供应商无关（M1 单源）。
 */
type ArraySlotRoute = { metaKey: string; paramKey: string; accept: 'image' | 'video' | 'audio' }
const ARRAY_SLOT_ROUTE: Partial<Record<ArchetypeReferenceSlotKind, ArraySlotRoute>> = {
  image_ref: { metaKey: 'referenceImageUrls', paramKey: 'reference_image_urls', accept: 'image' },
  video_ref: { metaKey: 'referenceVideoUrls', paramKey: 'reference_video_urls', accept: 'video' },
  audio_ref: { metaKey: 'referenceAudioUrls', paramKey: 'reference_audio_urls', accept: 'audio' },
}

type ArchetypeNodeMeta = {
  id: string
  /** 当前选中的变体 id（可选；无变体档案 / 旧 meta 未写时为空，由 currentArchetypeVariant 回落默认）。 */
  variantId: string
}

/** 存着的档案 id + 变体。**不读 modeId**：存着的方式只经 modePreference.readModePreference 当偏好读。 */
function readArchetypeNodeMeta(meta: Record<string, unknown> | undefined): ArchetypeNodeMeta | null {
  const value = meta?.archetype
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id : ''
  if (!id) return null
  const variantId = typeof record.variantId === 'string' ? record.variantId : ''
  return { id, variantId }
}

/** 节点上存着的 archetype 记录原样（带着走用：切变体、迁移时偏好和来历标记一个字不改）。 */
function storedArchetypeRecord(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  const value = meta?.archetype
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

/** 档案里按 id 取方式；认不出落默认、再落第一个。 */
export function archetypeModeById(archetype: ModelArchetype, modeId: string | null | undefined): ArchetypeMode {
  return archetype.modes.find((m) => m.id === modeId) ?? archetype.modes.find((m) => m.id === archetype.defaultModeId) ?? archetype.modes[0]
}

/** 存着的偏好对应的方式（只给「旧界面当时看得见哪几张」这类问存盘本身的地方用；问这次按什么发一律走 effectiveArchetypeMode）。 */
function storedPreferenceMode(archetype: ModelArchetype, meta: Record<string, unknown> | undefined): ArchetypeMode {
  return archetypeModeById(archetype, readModePreference(archetype, meta)?.modeId)
}

export type ModeGraph = { nodes: readonly GenerationCanvasNode[]; edges: readonly GenerationCanvasEdge[] }
export type ArchetypeModeResolution = ModeForInputsResult
export type CollectedModeInputs = { inputs: ModeInput[]; firstFrameEmpty: boolean }

const UPLOAD_SLOTS = EDGE_MODE_SLOTS.reference

/**
 * 这个节点这次实际放进来的东西：画布边（边的角色 × 源素材种类；上游还没出图也算——先跑上游备齐参考）
 * + 节点自己的上传（参考图列表里没「先放一边」的、参考视频 / 音频、源视频）。
 * **不从已解析的参考值收**：解析参考（落哪一格）本身要先知道方式，从那儿收会绕圈。
 */
export function collectModeInputs(node: Pick<GenerationCanvasNode, 'id' | 'meta' | 'kind'>, graph: ModeGraph): CollectedModeInputs {
  const meta = (node.meta || {}) as Record<string, unknown>
  const inputs: ModeInput[] = []
  const nodesById = nodesByIdOf(graph.nodes)
  for (const edge of graph.edges) {
    if (edge.target !== node.id || edge.targetParamKey) continue
    const source = nodesById.get(edge.source)
    if (!source || isTextPromptEdge(source, node as GenerationCanvasNode, edge.mode)) continue
    const asset = referenceAssetKindForNode(source)
    if (!asset) continue
    inputs.push({ slots: EDGE_MODE_SLOTS[edge.mode ?? 'reference'], asset })
  }
  const parked = new Set(readParkedReferences(meta))
  for (const url of readReferenceList(meta)) if (!parked.has(url)) inputs.push({ slots: UPLOAD_SLOTS, asset: 'image' })
  for (const url of readArchetypeArray(meta, 'referenceVideoUrls')) if (url) inputs.push({ slots: UPLOAD_SLOTS, asset: 'video' })
  for (const url of readArchetypeArray(meta, 'referenceAudioUrls')) if (url) inputs.push({ slots: UPLOAD_SLOTS, asset: 'audio' })
  if (typeof meta.sourceVideoUrl === 'string' && meta.sourceVideoUrl.trim()) inputs.push({ slots: ['source_video', 'video_ref'], asset: 'video' })
  return { inputs, firstFrameEmpty: firstFrameLeftEmpty(meta) }
}

const nodesByIdCache = new WeakMap<readonly GenerationCanvasNode[], Map<string, GenerationCanvasNode>>()
function nodesByIdOf(nodes: readonly GenerationCanvasNode[]): Map<string, GenerationCanvasNode> {
  const cached = nodesByIdCache.get(nodes)
  if (cached) return cached
  const next = new Map(nodes.map((candidate) => [candidate.id, candidate]))
  nodesByIdCache.set(nodes, next)
  return next
}

const resolutionCache = new WeakMap<readonly GenerationCanvasEdge[], WeakMap<readonly GenerationCanvasNode[], WeakMap<object, Map<ModelArchetype, ArchetypeModeResolution>>>>()

/**
 * **渲染层问「这次按哪种方式发 / 图怎么摆」的唯一入口**：收一次输入，问唯一 owner modeForInputs。
 * 返回 { mode（发什么：发送、生成钮、任务种类、参数）, layout（图怎么摆：分段高亮、参考行格子、拖放、新连线语义）}。
 * archetype 传调用方手里那份（按变体特化过的也行，方式 id 不变）。graph 传节点所在的画布（没有画布就传 { nodes: [node], edges: [] }）。
 */
export function effectiveArchetypeMode(
  archetype: ModelArchetype,
  node: Pick<GenerationCanvasNode, 'id' | 'meta' | 'kind'>,
  graph: ModeGraph,
): ArchetypeModeResolution {
  let byNodes = resolutionCache.get(graph.edges)
  if (!byNodes) { byNodes = new WeakMap(); resolutionCache.set(graph.edges, byNodes) }
  let byNode = byNodes.get(graph.nodes)
  if (!byNode) { byNode = new WeakMap(); byNodes.set(graph.nodes, byNode) }
  let byArchetype = byNode.get(node)
  if (!byArchetype) { byArchetype = new Map(); byNode.set(node, byArchetype) }
  const cached = byArchetype.get(archetype)
  if (cached) return cached
  const meta = (node.meta || {}) as Record<string, unknown>
  const collected = collectModeInputs(node, graph)
  const resolved = modeForInputs(archetype, collected.inputs, readModePreference(archetype, meta), { firstFrameEmpty: collected.firstFrameEmpty })
  byArchetype.set(archetype, resolved)
  return resolved
}

/**
 * 发送链路上「这次按哪种方式发」：画布路解析参考时已现算过一次（references.archetypeMode）就用那一份；
 * 没经画布解析（只有这个节点）就按节点自己的输入现算。archetype 是发送侧认的那份（同一方式 id）。
 */
export function sendArchetypeMode(
  archetype: ModelArchetype,
  node: Pick<GenerationCanvasNode, 'id' | 'meta' | 'kind'>,
  references?: { archetypeMode?: ArchetypeModeResolution },
): ArchetypeMode {
  const resolved = references?.archetypeMode?.mode
  // 跨档案迁移（同一模型换到另一家的档案）时方式 id 可能不同：按同一种意图对上。
  return archetype.modes.find((mode) => mode.id === resolved?.id)
    ?? (resolved ? archetype.modes.find((mode) => mode.intent === resolved.intent) : undefined)
    ?? effectiveArchetypeMode(archetype, node, { nodes: [node as GenerationCanvasNode], edges: [] }).mode
}

/**
 * 再放进一件东西（拖入 / 上传 / 粘贴一张参考）之后图怎么摆——拖放落哪一格由「放进去之后的输入」现算，
 * 不先把方式写进节点（空视频节点拖一张图进来：放之后按参考摆，有参考格可落）。
 */
export function effectiveArchetypeModeWithUpload(
  archetype: ModelArchetype,
  node: Pick<GenerationCanvasNode, 'id' | 'meta' | 'kind'>,
  graph: ModeGraph,
  asset: 'image' | 'video' | 'audio',
): ArchetypeModeResolution {
  return effectiveArchetypeModeWithInputs(archetype, node, graph, [{ slots: UPLOAD_SLOTS, asset }])
}

/** 再放进几件东西（各带想落的槽）之后的摆法——落地回写一组参考前先问「放完之后按什么摆」。 */
export function effectiveArchetypeModeWithInputs(
  archetype: ModelArchetype,
  node: Pick<GenerationCanvasNode, 'id' | 'meta' | 'kind'>,
  graph: ModeGraph,
  extra: readonly ModeInput[],
): ArchetypeModeResolution {
  const meta = (node.meta || {}) as Record<string, unknown>
  const collected = collectModeInputs(node, graph)
  return modeForInputs(archetype, [...collected.inputs, ...extra], readModePreference(archetype, meta), { firstFrameEmpty: collected.firstFrameEmpty })
}

/** 只有一个节点、没有画布时的输入（节点自己的上传）。 */
export function lonelyNodeGraph(node: GenerationCanvasNode): ModeGraph {
  return { nodes: [node], edges: [] }
}

/** 这个节点存着的 variantId（只认同一档案的）与模型名——问唯一 owner 时的那组输入。 */
function variantInputOf(archetype: ModelArchetype, meta: Record<string, unknown> | undefined): { variantId?: string; modelId?: unknown } {
  const stored = readArchetypeNodeMeta(meta)
  return { ...(stored?.id === archetype.id ? { variantId: stored.variantId } : {}), modelId: meta?.modelKey }
}

/**
 * 当前激活的变体（对称 effectiveArchetypeMode）。判定只问唯一 owner `resolveArchetypeVariant`：
 * 存着的 variantId → 模型名是某个变体的专属 key → 默认变体 → 第一个。付费卡与宿主派发问的是同一个函数、
 * 同一组输入（2026-09-26：以前宿主自己拿模型名反推，卡上写 Fast、派出去是 standard）。
 * 无 variants 档案 → null（UI 不显示变体段，传输不带变体 model）。
 */
export function currentArchetypeVariant(
  archetype: ModelArchetype,
  meta: Record<string, unknown> | undefined,
): ModelArchetypeVariant | null {
  return resolveArchetypeVariant(archetype, variantInputOf(archetype, meta))
}

export type ArchetypeVariantChoice = { id: string; label: string }

/** 变体分段切换的选项（标签 = 变体自己的名字）。无 variants / 仅 1 个 → 空（UI 不显示该段）。 */
export function archetypeVariantChoices(archetype: ModelArchetype): ArchetypeVariantChoice[] {
  const variants = archetype.variants
  if (!variants || variants.length <= 1) return []
  return variants.map((v) => ({ id: v.id, label: translateModelDisplayText(v.label) }))
}

/** 当前模式的**单图 frame 槽** → 现有 ImageUrlSlot（首/尾帧，走画布边）。数组槽见 archetypeModeArraySlots。 */
export function archetypeModeSlots(mode: ArchetypeMode): ImageUrlSlot[] {
  return mode.slots.flatMap((slot): ImageUrlSlot[] => {
    const flat = FRAME_SLOT_FLAT[slot.kind]
    if (!flat) return []
    return [{ key: flat.urlKey, label: translateModelDisplayText(slot.label), group: flat.group }]
  })
}

export type ArchetypeArraySlot = {
  metaKey: string
  label: string
  min: number
  max?: number
  accept: 'image' | 'video' | 'audio'
  /** 角色图按序标 ①②③ = prompt 的 character1..N（U2）；视频/音频不编号。 */
  numbered: boolean
  /** 组下方一条共享说明（U2：把槽→prompt 词的链接显性化）。 */
  caption?: string
}

/** 当前模式的**数组**参考槽（角色图 / 视频 / 音频）。meta-only。numbered/caption 由 characterIndexed 决定
 *  ——只有「按序对应 character1..N」的角色槽才标 ①②③ + 给说明；普通参考图（如 video-edit）不标。 */
export function archetypeModeArraySlots(mode: ArchetypeMode): ArchetypeArraySlot[] {
  return mode.slots.flatMap((slot): ArchetypeArraySlot[] => {
    const route = ARRAY_SLOT_ROUTE[slot.kind]
    if (!route) return []
    const numbered = Boolean(slot.characterIndexed)
    return [
      {
        metaKey: route.metaKey,
        label: translateModelDisplayText(slot.label),
        min: slot.min,
        max: slot.max,
        accept: route.accept,
        numbered,
        // 编号语义靠 tile 上的 ①②③ 徽标自明（样张 v4）；character1..N 是发送前投影，用户永不可见。
        ...(numbered ? { caption: translateModelDisplayText('按放入顺序编号 ①②③') } : {}),
      },
    ]
  })
}

/** 当前模式是否含「角色参考」槽（按序 character1..N，即 @ 引用投影的目标槽）。 */
export function modeHasCharacterSlot(mode: ArchetypeMode): boolean {
  return mode.slots.some((slot) => Boolean(slot.characterIndexed))
}

/** 画布边解析出的参考，按资产类型分成三列（generationReferenceResolver 按源节点 result.type 分流）。 */
export type EdgeReferenceLists = {
  referenceImages?: readonly string[]
  referenceVideos?: readonly string[]
  referenceAudios?: readonly string[]
}

/** 画布边解析结果的判定/发送共用视图（= ResolvedGenerationReferences 的子集，避免反向依赖 runner）。 */
export type ResolvedReferenceValues = EdgeReferenceLists & {
  firstFrameUrl?: string | null
  lastFrameUrl?: string | null
  relayFromVideoUrl?: string | null
}

/**
 * 数组槽 ← 画布边的**唯一映射规则**：槽收哪种资产，就喂 resolver 分流出的哪一列。
 *
 * 判定（hasArchetypeArrayReferences）与发送（buildArchetypeInputParams）必须共用这一份。此前只有发送侧
 * 写了这段分流、判定侧只读 meta 手动上传 → 「连线放了一段参考视频」明明发得出去（也在缩略图上显示着），
 * ↑ 按钮却灰着还提示「需要先添加参考素材」（2026-08-20 用户反馈）。回归自 f3b573f0（B4 把视频从
 * referenceImages 拆出去修好发送侧，判定侧没跟着改）——在这一层收成一个函数，两侧从此不可能再分裂。
 */
function edgeListForArraySlotAccept(
  accept: ArraySlotRoute['accept'],
  references: EdgeReferenceLists | undefined,
): readonly string[] {
  if (accept === 'image') return references?.referenceImages ?? []
  if (accept === 'video') return references?.referenceVideos ?? []
  if (accept === 'audio') return references?.referenceAudios ?? []
  return []
}

/**
 * 画布边给某个**单值**槽（首帧/尾帧/源视频）解析出的、**真正发上线的值**；没有则空串。
 * 首帧只认已解析好的 firstFrameUrl —— 绝不把 relayFromVideoUrl（还没抽帧的源视频）当首帧发出去，
 * 那条「不冒充」不变量由 relayFrameResolver 兜（它在提交前把真尾帧填进 firstFrameUrl）。
 */
function sentValueForSingleSlot(
  kind: ArchetypeReferenceSlotKind,
  references: ResolvedReferenceValues | undefined,
): string {
  if (kind === 'first_frame') return references?.firstFrameUrl?.trim() || ''
  if (kind === 'last_frame') return references?.lastFrameUrl?.trim() || ''
  if (kind === 'source_video') return references?.referenceVideos?.[0]?.trim() || ''
  return ''
}

/**
 * 判定用：这个单值槽「有没有东西」。比发送侧多认一个 relayFromVideoUrl —— 首帧槽连了视频时，
 * 抽帧是**提交时**的一步，不是能不能点的前提；判定阶段它就代表「这个槽已经放了东西」。
 */
function filledValueForSingleSlot(
  kind: ArchetypeReferenceSlotKind,
  references: ResolvedReferenceValues | undefined,
): string {
  const sent = sentValueForSingleSlot(kind, references)
  if (sent) return sent
  return kind === 'first_frame' ? references?.relayFromVideoUrl?.trim() || '' : ''
}

/**
 * 发送 / 判定侧的上传图落槽：连线占位从画布边解析结果（references）算，上传图交给 placeUploadedImages——
 * 和参考行 resolveReferencePlacement 同一个函数、同一份有序列表，所以「标在用的」=「发出去的」。
 * purpose='judge' 时首帧槽连着待抽帧的视频也算占位（同 filledValueForSingleSlot）；'send' 只认真发上线的值。
 */
export function uploadPlacementForMode(
  meta: Record<string, unknown> | undefined,
  mode: ArchetypeMode,
  references: ResolvedReferenceValues | undefined,
  purpose: 'send' | 'judge' = 'send',
): UploadPlacement {
  const countBySlot: number[] = []
  const urls = new Set<string>()
  let occupied = 0
  mode.slots.forEach((slot, slotIndex) => {
    const route = ARRAY_SLOT_ROUTE[slot.kind]
    let edgeCount = 0
    if (route) {
      const fromEdges = mergeOrderedReferenceImageUrls(edgeListForArraySlotAccept(route.accept, references), [], slot.max)
      if (route.accept === 'image') fromEdges.forEach((url) => urls.add(url))
      edgeCount = fromEdges.length
      // 视频 / 音频上传各住各的键：只占总数预算，不占图片槽。
      if (route.accept !== 'image') occupied += mergeOrderedReferenceImageUrls(fromEdges, readArchetypeArray(meta, route.metaKey), slot.max).length - edgeCount
    } else {
      const value = purpose === 'judge' ? filledValueForSingleSlot(slot.kind, references) : sentValueForSingleSlot(slot.kind, references)
      if (value) {
        edgeCount = 1
        if (isImageUploadSlot(slot.kind)) urls.add(value)
      } else if (slot.kind === 'source_video' && typeof meta?.sourceVideoUrl === 'string' && meta.sourceVideoUrl.trim()) occupied += 1
    }
    countBySlot[slotIndex] = edgeCount
    occupied += edgeCount
  })
  const inputs = listPlacementInputs(meta, mode)
  return placeUploadedImages(mode, inputs.list, { countBySlot, urls }, {
    ...(mode.maxTotalReferences === undefined ? {} : { totalBudget: mode.maxTotalReferences - occupied }),
    firstFrameEmpty: inputs.firstFrameEmpty,
    parked: inputs.parked,
  })
}

/**
 * **当前模式的参考槽里是否已经放进了任何东西 —— 判定侧的唯一入口。**
 *
 * 覆盖**所有**槽种（数组槽 image_ref/video_ref/audio_ref + 单值槽 first_frame/last_frame/source_video）
 * × **两条来源**（画布边 + meta 手动上传），与显示（resolveReferenceSlots）、发送
 * （buildArchetypeInputParams）同一口径。
 *
 * 为什么要收成一个函数：此前判定是一串就地展开的 OR（referenceImages 非空 / firstFrameUrl 有值 /
 * 只读 meta 的数组判断），每加一种槽就得记得再补一条，于是漏了三处 —— 连线的参考视频（用户 2026-08-20
 * 报的「↑ 点不动」）、尾帧接力（显示写着「待抽帧」按钮却死）、HappyHorse 视频编辑的源视频槽。
 * 按「遍历本模式声明的槽」写，新槽种自动被覆盖，不必再逐处想起来补。
 *
 * 接受任意非空字符串（含 nomi-local://，传输前 R1 会本地化），不做 http 过滤——这只是「有没有参考」。
 */
export function hasAnyArchetypeReference(
  meta: Record<string, unknown> | undefined,
  mode: ArchetypeMode,
  references?: ResolvedReferenceValues,
): boolean {
  const placement = uploadPlacementForMode(meta, mode, references, 'judge')
  return mode.slots.some((slot, slotIndex) => {
    if (isImageUploadSlot(slot.kind) && placement.bySlot[slotIndex]!.length > 0) return true
    const route = ARRAY_SLOT_ROUTE[slot.kind]
    if (route) {
      return (
        (route.accept !== 'image' && readArchetypeArray(meta, route.metaKey).length > 0) ||
        edgeListForArraySlotAccept(route.accept, references).length > 0
      )
    }
    if (isImageUploadSlot(slot.kind)) return Boolean(filledValueForSingleSlot(slot.kind, references))
    const metaKey = SINGLE_SLOT_META_KEY[slot.kind]
    if (!metaKey) return false
    const uploaded = typeof meta?.[metaKey] === 'string' ? (meta[metaKey] as string).trim() : ''
    return Boolean(uploaded || filledValueForSingleSlot(slot.kind, references))
  })
}

const ARRAY_SLOT_ROUTES = Object.entries(ARRAY_SLOT_ROUTE) as Array<[ArchetypeReferenceSlotKind, ArraySlotRoute]>

/** 还没挑模型的节点：把参考素材先放进对应的持久化列表，等自动选模时再按档案槽落位。 */
export function withUnplacedArrayReferences(
  meta: Record<string, unknown>,
  accept: ArraySlotRoute['accept'],
  urls: readonly string[],
): Record<string, unknown> {
  const route = ARRAY_SLOT_ROUTES.find(([, candidate]) => candidate.accept === accept)?.[1]
  if (!route) return meta
  const next = [...new Set([...readArchetypeArray(meta, route.metaKey), ...urls.map((url) => url.trim()).filter(Boolean)])]
  return accept === 'image' ? withReferenceList(meta, next) : { ...meta, [route.metaKey]: next }
}

/** 当前模式的 per-mode model enum（HappyHorse 4 端点合 1 靠它；Seedance 各模式同 model → null）。 */
export function archetypeModeModelEnum(mode: ArchetypeMode): string | null {
  return mode.modelEnum ?? null
}

/** 切模式时跟着写回的 variantId = 此刻显示的那个变体（无 variants → 空串）。 */
function preservedVariantId(meta: Record<string, unknown>, archetype: ModelArchetype): string {
  return currentArchetypeVariant(archetype, meta)?.id ?? ''
}

/**
 * 人手选了一个摆法（参数面板点分段、点歧义提示、声音方式栏——只有这 3 扇门调它）：写偏好 + `modeChosenBy: 'human'`。
 * 机器（连线、换模型、自动参考、交付…）不再写方式：这次按什么发由 effectiveArchetypeMode 按输入现算。
 * 参数不在这里夹：按现算出的方式在读 / 发的时候收窄（clampParamsToMode），删了图就回到原来存的值。
 * 旧工程按槽存的参考图，先按**改之前存着的方式**落成规范形（旧界面那时看不见的记进「先放一边」，#1269 条件 4）。
 */
export function applyHumanModeChoice(
  rawMeta: Record<string, unknown>,
  archetype: ModelArchetype,
  modeId: string,
): Record<string, unknown> {
  const meta = normalizeReferenceListMeta(rawMeta, storedPreferenceMode(archetype, rawMeta)) ?? rawMeta
  const variantId = preservedVariantId(meta, archetype)
  const next = withHumanModePreference(meta, archetype.id, archetypeModeById(archetype, modeId).id)
  return variantId ? { ...next, archetype: { ...(next.archetype as object), variantId } } : next
}

/**
 * 换模型 / 换供应商时偏好怎么带：不再替节点挑方式（方式在发送时按输入现算）。人手选过的摆法是意图——新档案有同一种
 * 意图的方式就带过去、仍算人手选的；来历不明的不带（新档案按输入现算）。同一档案 → 原样。
 */
export function carryHumanModePreference(
  meta: Record<string, unknown>,
  fromArchetype: ModelArchetype | null,
  toArchetype: ModelArchetype,
): Record<string, unknown> {
  if (!fromArchetype || fromArchetype.id === toArchetype.id) return meta
  const preference = readModePreference(fromArchetype, meta)
  const intent = preference?.chosenBy === 'human' ? fromArchetype.modes.find((mode) => mode.id === preference.modeId)?.intent : undefined
  const carried = intent ? toArchetype.modes.find((mode) => mode.intent === intent) : undefined
  return carried ? withHumanModePreference(meta, toArchetype.id, carried.id) : meta
}

/**
 * 按方式声明把存着的下拉值收窄（读 / 发时用，不写回）。火山 Seedance 2.5 文生存了 16:9 → 放一张首帧，现算成首帧方式
 * （比例官方只收 adaptive）→ 面板显示、请求发出的都是 adaptive；删了图回到文生 → 还是 16:9（2026-08-26 走查那一类）。
 */
export function clampParamsToMode(meta: Record<string, unknown>, archetype: ModelArchetype, mode: ArchetypeMode): Record<string, unknown> {
  const specialized = specializeArchetypeForVariant(archetype, preservedVariantId(meta, archetype))
  const declared = specialized.modes.find((candidate) => candidate.id === mode.id) ?? mode
  return resolveModelParams({ controls: declared.params, intent: {}, previousParams: meta, policy: { author: '人手', invalid: '只修下拉不管数值' } }).params
}

/**
 * 迁移 / 初次落地时重写 archetype 记录（不是方式切换）：按变体特化后把越界下拉值夹回 modeId 的声明，
 * 偏好来历标记原样带着（同档案时）。
 */
function rewriteArchetypeRecord(
  rawMeta: Record<string, unknown>,
  archetype: ModelArchetype,
  modeId: string,
  keep: Record<string, unknown> = {},
): Record<string, unknown> {
  const meta = normalizeReferenceListMeta(rawMeta, storedPreferenceMode(archetype, rawMeta)) ?? rawMeta
  const variantId = preservedVariantId(meta, archetype)
  const specialized = specializeArchetypeForVariant(archetype, variantId)
  const nextMode = specialized.modes.find((m) => m.id === modeId) ?? specialized.modes[0]
  const clamped = nextMode ? resolveModelParams({ controls: nextMode.params, intent: {}, previousParams: meta, policy: { author: '人手', invalid: '只修下拉不管数值' } }).params : meta
  return { ...clamped, archetype: { ...keep, id: archetype.id, modeId: nextMode.id, ...(variantId ? { variantId } : {}) } }
}

/**
 * 切到 nextVariantId：改 node.meta.archetype.variantId（不动方式偏好、
 * 不动参考值）+ 夹取被新变体收窄掉的越界参数值（D1）。返回**整份新 meta**。无效 variantId → 回落默认。
 * 无 variants 档案 → no-op（原样返回 meta）。
 */
export function applyArchetypeVariantSwitch(
  meta: Record<string, unknown>,
  archetype: ModelArchetype,
  nextVariantId: string,
): Record<string, unknown> {
  const variants = archetype.variants
  if (!variants || variants.length === 0) return meta
  const stored = readArchetypeNodeMeta(meta)
  const modeId = readModePreference(archetype, meta)?.modeId || archetype.defaultModeId
  // 用户点的那一档；认不出的 id 与不传一样落默认变体（唯一 owner 的规则）。
  const nextVariant = resolveArchetypeVariant(archetype, { variantId: nextVariantId })!
  // 按新变体特化出当前模式的参数声明，把存量越界的 select 值夹回默认（D1：4k→fast 变体不再漏发）。
  const specialized = specializeArchetypeForVariant(archetype, nextVariant.id)
  const mode =
    specialized.modes.find((m) => m.id === modeId) ??
    specialized.modes.find((m) => m.id === specialized.defaultModeId) ??
    specialized.modes[0]
  const clamped = mode ? resolveModelParams({ controls: mode.params, intent: {}, previousParams: meta, policy: { author: '人手', invalid: '只修下拉不管数值' } }).params : meta
  return { ...clamped, archetype: { ...(stored?.id === archetype.id ? storedArchetypeRecord(meta) : {}), id: archetype.id, modeId: mode?.id ?? modeId, variantId: nextVariant.id } }
}

/**
 * **迁移层（变体合并最大风险点）**：旧项目 node.meta.modelKey 钉的是具体变体串（如 `doubao-seedance-2.0-fast`），
 * 合并后 picker 只剩基础 modelKey。此函数把旧变体 modelKey 归一成：① modelKey 改写成基础变体的 modelKey
 * （让节点能在 picker 里选中、不变空）、② meta.archetype.variantId 写成对应变体（保住「用户当初要的是 fast」）。
 * 按 variant.identifierPatterns / variant.modelKey 匹配旧 modelKey。
 *
 * 幂等：modelKey 已是某变体的基础 modelKey 且 variantId 已对 → 返回 null（不循环写）。
 * 无 variants 档案 / 认不出旧串 → 返回 null。返回**待 patch 的字段**（含 modelKey + archetype），由调用方合并。
 */
export function normalizeArchetypeVariantMeta(
  meta: Record<string, unknown>,
  archetype: ModelArchetype,
): { modelKey: string; archetype: Record<string, unknown> & { id: string; variantId: string } } | null {
  const variants = archetype.variants
  if (!variants || variants.length === 0) return null
  const currentKey = typeof meta.modelKey === 'string' ? meta.modelKey.trim() : ''
  if (!currentKey) return null

  const norm = (v: string) => v.trim().toLowerCase()
  // picker/catalog 折叠后只列**基础 modelKey**。它可与 UI 默认变体不同（APIMart Seedance 默认 Fast，
  // catalog 仍保留标准行）；归一后必须把 meta.modelKey 设成基础行，
  // 否则变体全串(doubao-seedance-2.0-fast)在 picker(只有基础选项 + findModelOptionByIdentifier 精确匹配)
  // 命中不到 → 选择显示空（这正是「最大风险点」）。变体信息只由 variantId 承载（与 applyArchetypeVariantSwitch
  // 一致：切变体只改 variantId、不动 modelKey）。
  const baseModelKey = archetypeBaseModelKey(archetype)!
  // modelKey 已是基础 → variantId 是权威（缺则 currentArchetypeVariant 回落默认），无需迁移、幂等 no-op。
  // **绝不能用基础串反推变体**——基础串映射到 standard 会把已选的 fast/face 冲掉（唯一 owner 同一条规则）。
  const stored = readArchetypeNodeMeta(meta)
  if (norm(currentKey) === norm(baseModelKey)) {
    const canonicalStoredId = stored?.id === archetype.id ? canonicalArchetypeVariantId(archetype, stored.variantId) : ''
    // 已下线 variantId（face/fast-face）即使 modelKey 已折叠，也要改写成当前有效 id，避免节点默默回默认。
    if (canonicalStoredId && canonicalStoredId !== stored?.variantId) {
      return {
        modelKey: baseModelKey,
        archetype: { ...storedArchetypeRecord(meta), id: archetype.id, variantId: canonicalStoredId },
      }
    }
    return null
  }
  // modelKey 是变体全串（旧项目钉死的具体变体）→ 折叠成基础 modelKey + 从串 derive variantId。
  const matched = archetypeVariantForModelId(archetype, currentKey)
  if (!matched) return null
  const modeId = readModePreference(archetype, meta)?.modeId || archetype.defaultModeId
  return { modelKey: baseModelKey, archetype: { ...(stored?.id === archetype.id ? storedArchetypeRecord(meta) : {}), id: archetype.id, modeId, variantId: matched.id } }
}

/**
 * 初次落地（节点刚选到一个有档案的模型、还没有命名空间 meta 时）：写入默认模式的 archetype 命名空间。
 * 幂等：已是该档案则返回 null（不循环）。变体档案同时初始化 variantId（由 rewriteArchetypeRecord 写）。
 */
export function ensureArchetypeNodeMeta(
  meta: Record<string, unknown>,
  archetype: ModelArchetype,
): Record<string, unknown> | null {
  const stored = readArchetypeNodeMeta(meta)
  if (stored && archetype.legacyIds?.includes(stored.id)) {
    const mode = storedPreferenceMode(archetype, meta)
    const chosenBy = storedArchetypeRecord(meta).modeChosenBy
    return rewriteArchetypeRecord(preserveLegacyPixelRatio(meta, mode), archetype, mode.id, chosenBy === undefined ? {} : { modeChosenBy: chosenBy })
  }
  // 已是该档案：若有变体但 variantId 缺/失效 → 补默认变体（旧 meta 升级）；否则幂等 null。
  if (stored?.id === archetype.id) {
    if (!(archetype.variants?.length ?? 0)) return null
    const canonicalStoredId = canonicalArchetypeVariantId(archetype, stored.variantId)
    if (stored.variantId && canonicalStoredId === stored.variantId) return null
    return applyArchetypeVariantSwitch(meta, archetype, currentArchetypeVariant(archetype, meta)?.id ?? '')
  }
  return rewriteArchetypeRecord(meta, archetype, archetype.defaultModeId)
}

/** Split legacy pixel size into the new profile's ratio before its size is clamped.
 * Only declared legacy-profile migrations use this; explicit ratio choices win. */
function preserveLegacyPixelRatio(meta: Record<string, unknown>, mode: ArchetypeMode): Record<string, unknown> {
  const pixels = typeof meta.size === 'string' ? /^(\d+)x(\d+)$/.exec(meta.size) : null
  const size = mode.params.find((param) => param.key === 'size')
  const ratio = mode.params.find((param) => param.key === 'ratio' || param.key === 'aspect_ratio')
  if (!pixels || !size || size.options?.some((option) => option.value === meta.size)
    || !ratio || meta[ratio.key] !== undefined) return meta
  const width = Number(pixels[1]); const height = Number(pixels[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return meta
  const matching = ratio.options?.find((option) => {
    const parts = /^(\d+):(\d+)$/.exec(String(option.value))
    return parts && width * Number(parts[2]) === height * Number(parts[1])
  })
  return matching ? { ...meta, [ratio.key]: matching.value } : meta
}

/** 单图 frame 槽（含 source_video）在 meta 里的存储键。source_video UI 本轮从简（meta 直存）。 */
const SINGLE_SLOT_META_KEY: Partial<Record<ArchetypeReferenceSlotKind, string>> = {
  first_frame: 'firstFrameUrl',
  last_frame: 'lastFrameUrl',
  source_video: 'sourceVideoUrl',
}

// 参考放进哪个键、什么形状、带什么 role：只有 electron/shared/generationLowering/lowerGenerationIntent.ts 回答
// （画布路、主进程 headless 路、Run 路同一个函数）。这里只负责把画布上的东西说成「每个槽收哪些地址」。

/** 一个声明槽在 meta 里的存储形态（单一真相源：槽→存储键 的知识只在这里）。无存储映射 → null。 */
export type ReferenceSlotStorage = { metaKey: string; isArray: boolean }
export function referenceSlotStorage(slot: { kind: ArchetypeReferenceSlotKind }): ReferenceSlotStorage | null {
  const arr = ARRAY_SLOT_ROUTE[slot.kind]
  if (arr) return { metaKey: arr.metaKey, isArray: true }
  const single = SINGLE_SLOT_META_KEY[slot.kind]
  if (single) return { metaKey: single, isArray: false }
  return null
}

/**
 * 「这个槽是一格还是一袋」的**唯一判据**（P1）：声明的 `asArray` 优先，缺省按 kind 推——判据住在降级函数旁边
 * （loweringAsArray），发出去的形状与界面上的一格 / 一袋同一个答案。任何「单槽 vs 数组槽」的分叉都必须问这个函数。
 */
export function slotAsArray(slot: { kind: ArchetypeReferenceSlotKind; asArray?: boolean }): boolean {
  return loweringAsArray(slot)
}

/** 单帧槽收哪种媒体（数组槽由 ARRAY_SLOT_ROUTE 给）。首/尾帧收图、源视频收视频。 */
const SINGLE_SLOT_ACCEPT: Partial<Record<ArchetypeReferenceSlotKind, 'image' | 'video' | 'audio'>> = {
  first_frame: 'image',
  last_frame: 'image',
  source_video: 'video',
}

/**
 * 槽接受哪种媒体的**唯一真相源**（声明里没有这个字段，只能由 kind 推——brief §D1 已核实）。
 * 「视频槽拒图片、图片槽拒视频」的判据就是它，不许在各消费端各推一遍。
 */
export function referenceSlotAccept(kind: ArchetypeReferenceSlotKind): 'image' | 'video' | 'audio' {
  return ARRAY_SLOT_ROUTE[kind]?.accept ?? SINGLE_SLOT_ACCEPT[kind] ?? 'image'
}

/**
 * 「有序参考图列表」单一真相源（option 2 · 2026-06-25 用户拍板）：**连线在前、上传在后**、去重、截到 maxCap。
 * 面板编号①②③（resolveReferenceSlots）、@ 候选、@ 发送投影 character{N}、实际发送的 reference_image 数组
 * 四处共用同一顺序——杜绝「面板①与模型 character1 不是同一张」的张冠李戴。edgeImageUrls = 画布边解析出的
 * 有序图（与 resolveReferenceSlots 同口径：边按 order 升序在前）。maxCap ≤ 0 表示不截断。
 */
export function mergeOrderedReferenceImageUrls(
  edgeImageUrls: readonly string[],
  uploadUrls: readonly string[],
  maxCap?: number,
): string[] {
  const merged: string[] = []
  for (const candidate of [...edgeImageUrls, ...uploadUrls]) {
    const url = typeof candidate === 'string' ? candidate.trim() : ''
    if (url && !merged.includes(url)) merged.push(url)
  }
  return maxCap !== undefined && maxCap > 0 ? merged.slice(0, maxCap) : merged
}

/**
 * 当前模式「发给模型 + @ 投影 character{N}」共用的有序图片参考 URL 列表（option 2：连线在前）。
 * = buildArchetypeInputParams 给 image_ref 槽算出的同一份列表，projectPromptForSend 复用它 → 保证
 * character{N} 编号与实际发送的 reference_image 数组逐位一致。当前模式无 image 数组槽 → []。
 */
export function orderedSentImageReferenceUrls(
  meta: Record<string, unknown>,
  mode: ArchetypeMode,
  edgeImageUrls: readonly string[],
): string[] {
  const slotIndex = mode.slots.findIndex((s) => ARRAY_SLOT_ROUTE[s.kind]?.accept === 'image')
  const slot = mode.slots[slotIndex]
  if (!slot) return []
  const placed = uploadPlacementForMode(meta, mode, { referenceImages: edgeImageUrls }).bySlot[slotIndex]!
  return mergeOrderedReferenceImageUrls(edgeImageUrls, placed, slot.max)
}

/** 当前模式所有数组媒体参考的发送顺序 + 类型编号，供 @imageN/@videoN/@audioN 共用。 */
export function orderedSentMediaReferenceUrls(
  meta: Record<string, unknown>,
  mode: ArchetypeMode,
  edgeReferences: {
    image?: readonly string[]
    video?: readonly string[]
    audio?: readonly string[]
  },
): Array<{ url: string; kind: 'image' | 'video' | 'audio'; index: number }> {
  const counts: Record<'image' | 'video' | 'audio', number> = { image: 0, video: 0, audio: 0 }
  const out: Array<{ url: string; kind: 'image' | 'video' | 'audio'; index: number }> = []
  const placement = uploadPlacementForMode(meta, mode, {
    referenceImages: edgeReferences.image ?? [], referenceVideos: edgeReferences.video ?? [], referenceAudios: edgeReferences.audio ?? [],
  })
  for (const [slotIndex, slot] of mode.slots.entries()) {
    const route = ARRAY_SLOT_ROUTE[slot.kind]
    if (!route) continue
    const kind = route.accept
    const edgeUrls = edgeReferences[kind] ?? []
    const uploads = kind === 'image' ? placement.bySlot[slotIndex]! : readArchetypeArray(meta, route.metaKey)
    const urls = mergeOrderedReferenceImageUrls(edgeUrls, uploads, slot.max)
    for (const url of urls) {
      counts[kind] += 1
      out.push({ url, kind, index: counts[kind] })
    }
  }
  return out
}

/**
 * **档案驱动的 input 构建（M1 单源 + M2 互斥）**：renderer 据当前模式把参考值打成
 * 最终的**通用 snake input 参数**（key = slot 的 API 名，值 = 标量或数组）。只含当前模式声明的键
 * → 别的模式的残留键根本不进结果（M2，§2 坑2）。供应商 mapping body 直接读 request.params.<key>
 * （kie 文档的尾随空格 quirk 在 kie body 单独照抄，§2 坑1）。返回对象放进 extras.archetypeInput，
 * runtime 原样铺进 params（electron/catalog/archetypeInput）。
 * **不带 model**：发哪个 model 串由主进程 electron/shared/modelArchetypes/wireModelIdentity.resolveWireModel 按连接契约决定
 * （2026-10-16：这里塞的 kie 拆分名盖掉了自建中转的模型名）。节点只存选择（meta.archetype 的 modeId / variantId）。
 */
export function buildArchetypeInputParams(
  meta: Record<string, unknown>,
  mode: ArchetypeMode,
  references?: EdgeReferenceLists & {
    firstFrameUrl?: string | null
    lastFrameUrl?: string | null
  },
): Readonly<Record<string, unknown>> {
  const intent: IntentReference[] = []
  // 上传图落哪个槽：和参考行同一个函数（uploadPlacementForMode → placeUploadedImages），列表里用不上的图不进来。
  const placement = uploadPlacementForMode(meta, mode, references)
  for (const [slotIndex, slot] of mode.slots.entries()) {
    const arr = ARRAY_SLOT_ROUTE[slot.kind]
    if (arr) {
      // 画布边产出的实时参考图 + 手动拖入的 meta 数组，经 mergeOrderedReferenceImageUrls 单源合并：
      // **连线在前、上传在后**（option 2 · 2026-06-25 拍板），去重、截到 slot.max——与面板编号①②③、
      // @ 候选、@ 投影 character{N} 同一顺序，杜绝张冠李戴。仅 image 槽收图片边（video/audio 槽不污染，
      // edgeList=[]）；cap 顺带封死手动超额导致的 vendor 422。
      const metaList = arr.accept === 'image' ? placement.bySlot[slotIndex]! : readArchetypeArray(meta, arr.metaKey)
      // 按槽资产类型喂对应的连线参考（B4：video_ref/audio_ref 槽此前只收 meta 上传，连线的视频/音频被丢）。
      // 这条规则与判定侧 hasArchetypeArrayReferences 共用同一个函数，别在这里就地展开成 ternary。
      const edgeList = edgeListForArraySlotAccept(arr.accept, references)
      for (const url of mergeOrderedReferenceImageUrls(edgeList, metaList, slot.max)) intent.push({ binding: slotIndex, value: url })
      continue
    }
    const metaKey = SINGLE_SLOT_META_KEY[slot.kind]
    if (!metaKey) continue
    // 单值槽的连线来源与判定侧共用 sentValueForSingleSlot —— 此前这里只认首/尾帧，source_video 槽
    // 连了线也取不到值（meta.sourceVideoUrl 为空 → video_url 键根本不发），HappyHorse 视频编辑
    // 「拖一段视频进去」等于白拖（2026-08-20 不变量测试扫出，与判定侧同一根因）。
    const fromRef = sentValueForSingleSlot(slot.kind, references)
    const uploaded = isImageUploadSlot(slot.kind)
      ? placement.bySlot[slotIndex]![0] ?? ''
      : typeof meta[metaKey] === 'string' ? (meta[metaKey] as string).trim() : ''
    const raw = typeof fromRef === 'string' && fromRef.trim() ? fromRef.trim() : uploaded
    if (raw) intent.push({ binding: slotIndex, value: raw })
  }
  // 放进哪个键、单图还是数组、火山 content 项、角色数组合并、模式固定参数：全部由共享解析写入过程按绑定回答（绑定序 = 槽序）。
  // 画布这边已经按槽上限截过，降级不会再报超量。renderer 只拿解析产物的独立冻结快照（跨 IPC 本来就只剩普通数据）。
  return lowerGenerationIntent(declarationForMode(mode), { references: intent }).snapshot()
}
