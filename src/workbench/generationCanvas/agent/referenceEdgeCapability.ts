// 参考边能力校验(T8 根治轨迹盲连)。纯函数,可单测。
//
// 根因:connect_nodes 过去只校验「两端节点存在」,不查目标模型支不支持这条参考——
// 让 agent 凭故事结构盲连,连出两类静默无效边(连上了、落库了,生成期却被丢弃):
//   ① 文本/镜头笔记节点 → 图片节点:文本不产可参考资产(生成 prompt 只取 node.prompt,
//      不拼上游;resolver 只认源节点的 result URL),这条边在参考维度纯噪音。
//   ② character_ref → 不声明任何图片参考槽的纯文生模型(如 imagen-4):到 archetype
//      input-builder 进不去(buildArchetypeInputParams 只发当前模式声明的槽键),静默丢弃。
//
// 唯一真相源 = 模型 archetype 的参考槽声明(src/config/modelArchetypes,supplier-agnostic)。
// 这里把「边语义(mode)+源资产类型」对照「目标模型 archetype 任意模式声明的参考槽」校验,
// 只放行模型真能消费的边;放不行的进 skipped + reason,诚实回报给 LLM(它据此改模型/模式或删边)。
//
// 跨「所有模式」union 校验(非当前模式):拒的是「这个模型根本不吃这类参考」的硬错(用户两例),
// 不拒「模型支持但当前选错模式」的软错(那个由 availableModels 喂能力给 agent + 用户在计划卡
// 改模式兜)——避免误伤可恢复的模式选择问题。目标未声明档案(未知/未设模型)一律放行(P4 通用回退)。
import type { GenerationCanvasEdge, GenerationCanvasEdgeMode, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getGenerationNodeDefinition, getGenerationNodeExecutionKind } from '../model/generationNodeKinds'
import type { ArchetypeMode, ArchetypeReferenceSlotKind, ModelArchetype } from '../../../config/modelArchetypes'
import { getArchetypeById, resolveArchetypeForModel } from '../../../config/modelArchetypes'
import { currentArchetypeMode } from '../nodes/controls/archetypeMeta'

/** 源节点产出的可参考资产类型;text/shot/output 等无产出 → null(不能作参考源)。 */
export type ReferenceAssetKind = 'image' | 'video'

export type EdgeSkipReason = 'dangling' | 'source_not_referenceable' | 'unsupported_reference'

export type EdgeCapabilityResult = { ok: true } | { ok: false; reason: EdgeSkipReason }

/**
 * 源节点能给出哪种可参考资产。按节点 kind 的执行语义 derive(与 resolver 取参考的口径一致):
 * 可执行视频→video、可执行图片→image、非执行但 providesImageReference(asset/panorama/scene3d…)→image。
 * 文本/镜头/输出等(无 execution+不提供图参考)→ null:它们没有可被下游当参考的产物。
 */
export function referenceAssetKindForNode(node: GenerationCanvasNode): ReferenceAssetKind | null {
  const exec = getGenerationNodeExecutionKind(node.kind)
  if (exec === 'video') return 'video'
  if (exec === 'image') return 'image'
  return getGenerationNodeDefinition(node.kind).providesImageReference ? 'image' : null
}

/** 每种参考槽能被哪种源资产喂。first_frame 收视频=尾帧接力(resolver 抽帧),故收 image+video。 */
export const SLOT_ACCEPTS: Record<ArchetypeReferenceSlotKind, readonly ReferenceAssetKind[]> = {
  first_frame: ['image', 'video'],
  last_frame: ['image'],
  image_ref: ['image'],
  video_ref: ['video'],
  source_video: ['video'],
  audio_ref: [], // 当前无音频源节点种类;音频参考只能手动上传到槽,不经画布边
}

/**
 * 边语义 → 它要落到目标模型的哪些参考槽(任一满足即可)。通用 reference 接受任意槽。
 *
 * first_frame 同时认 `image_ref`:i2v 模型的「首帧输入槽」声明不统一——Hailuo 标 first_frame，
 * 而 Kling/Veo/Wan/Sora/seedance-apimart 把首帧输入归到通用 image_ref 数组槽(i2v 的输入图 = 首帧)。
 * 两者都能消费 keyframe→video 的首帧边,故都放行:resolver 已把首帧边的图源同时塞进 referenceImages
 * (→ image_ref 槽,archetypeMeta array 路由) 和 firstFrameUrl (→ first_frame 槽),投递端两条路都通。
 * 不放行就会把这条边静默丢弃 → 对账误报「批准已连接/实际未连接」(用户反复撞见的根因)。
 */
const EDGE_MODE_SLOTS: Record<GenerationCanvasEdgeMode, readonly ArchetypeReferenceSlotKind[]> = {
  reference: ['image_ref', 'video_ref', 'first_frame', 'last_frame', 'source_video', 'audio_ref'],
  first_frame: ['first_frame', 'image_ref'],
  last_frame: ['last_frame'],
  style_ref: ['image_ref'],
  character_ref: ['image_ref'],
  composition_ref: ['image_ref'],
}

/** 从节点 meta 解析模型档案:优先 meta.archetype.id(命名空间),回退 meta.modelKey 身份匹配。无 → null。 */
export function archetypeForNode(node: GenerationCanvasNode): ModelArchetype | null {
  const meta = node.meta
  if (!meta || typeof meta !== 'object') return null
  const record = meta as Record<string, unknown>
  const arch = record.archetype
  const archId = arch && typeof arch === 'object' ? (arch as Record<string, unknown>).id : undefined
  if (typeof archId === 'string' && archId) {
    const byId = getArchetypeById(archId)
    if (byId) return byId
  }
  const modelKey = record.modelKey
  if (typeof modelKey === 'string' && modelKey) {
    const modelVendor = record.modelVendor
    return resolveArchetypeForModel({
      modelKey,
      vendorKey: typeof modelVendor === 'string' ? modelVendor : null,
      meta,
    })
  }
  return null
}

/**
 * 这个档案有没有「参考视频」槽,有的话该用哪个模式(运镜参考喂入用)。纯函数,可单测。
 * 返回第一个声明了 `video_ref` 槽的模式的 id + 该槽的 meta 存储键(referenceVideoUrls)+ API 输入键;
 * 没有任何模式吃参考视频 → null(降级成 prompt floor)。从 archetype 派生,不写死任何 model 字符串。
 */
export function findVideoRefMode(
  archetype: ModelArchetype | null,
): { modeId: string; metaKey: string; inputKey: string } | null {
  if (!archetype) return null
  for (const mode of archetype.modes) {
    const slot = mode.slots.find((s) => s.kind === 'video_ref')
    if (slot) {
      return {
        modeId: mode.id,
        metaKey: 'referenceVideoUrls',
        inputKey: slot.inputKey ?? 'reference_video_urls',
      }
    }
  }
  return null
}

/** 目标模型跨所有模式声明过的参考槽种类(union);无档案 → null(放行,不校验)。 */
function targetSlotKinds(node: GenerationCanvasNode): Set<ArchetypeReferenceSlotKind> | null {
  const archetype = archetypeForNode(node)
  if (!archetype) return null
  const set = new Set<ArchetypeReferenceSlotKind>()
  for (const mode of archetype.modes) for (const slot of mode.slots) set.add(slot.kind)
  return set
}

/**
 * 这条参考边目标模型到底吃不吃。源无可参考资产(文本) → source_not_referenceable;
 * 目标声明了档案但任何模式都没有能消费「该 mode + 该源资产」的槽 → unsupported_reference;
 * 其余(含目标无档案)→ ok。
 */
export function validateReferenceEdge(
  source: GenerationCanvasNode,
  target: GenerationCanvasNode,
  mode: GenerationCanvasEdgeMode | undefined,
): EdgeCapabilityResult {
  const asset = referenceAssetKindForNode(source)
  if (!asset) return { ok: false, reason: 'source_not_referenceable' }
  const slotKinds = targetSlotKinds(target)
  if (!slotKinds) return { ok: true }
  const required = EDGE_MODE_SLOTS[mode ?? 'reference']
  const satisfiable = required.some((slot) => slotKinds.has(slot) && SLOT_ACCEPTS[slot].includes(asset))
  return satisfiable ? { ok: true } : { ok: false, reason: 'unsupported_reference' }
}

/**
 * 手动连线时按**目标当前模式**挑边语义（mode）的单一真相源。地基收口（audit 2026-06-16 §1d）：
 * 数组参考槽（image_ref，characterIndexed，如 Seedance omni 的「角色参考」最多 9 张）现在也建有序边，
 * 故落它的边要用 `character_ref` 语义（按序对应 character1..N），而非首/尾帧——后者会污染 firstFrameUrl、
 * 触发尾帧接力误判，且在 omni 模式被 M2 互斥丢掉。
 *
 * 规则（image 源 → video 目标）：
 * - 目标当前模式有 characterIndexed 的 image_ref 数组槽 → `character_ref`（数组参考，有序）。
 * - 否则（单帧 i2v：Hailuo/Seedance first/firstlast）→ 沿用首/尾帧填空：无首帧边→first_frame，
 *   已有首帧→last_frame（与历史 connectToNode 行为一致）。
 * 其余源/目标组合 → `reference`（通用，由 resolveReferenceSlots 按源资产挑槽）。
 */
export function selectConnectionEdgeMode(
  source: GenerationCanvasNode,
  target: GenerationCanvasNode,
  existingEdgesToTarget: readonly GenerationCanvasEdge[],
): GenerationCanvasEdgeMode {
  const sourceKind = referenceAssetKindForNode(source)
  if (sourceKind === 'image' && target.kind === 'video') {
    const archetype = archetypeForNode(target)
    if (archetype) {
      const mode = currentArchetypeMode(archetype, (target.meta || {}) as Record<string, unknown>)
      const hasCharacterArray = mode.slots.some((slot) => slot.kind === 'image_ref' && Boolean(slot.characterIndexed))
      if (hasCharacterArray) return 'character_ref'
    }
    // 单帧 i2v：首帧空位优先，再尾帧（与历史行为一致）。
    if (!existingEdgesToTarget.some((e) => e.mode === 'first_frame')) return 'first_frame'
    if (!existingEdgesToTarget.some((e) => e.mode === 'last_frame')) return 'last_frame'
  }
  return 'reference'
}

/**
 * 连线落地后，目标该切到哪个「生成方式」才能真正消费这条参考边。纯函数，可单测，单一真相源。
 *
 * 根因（2026-06-29）：节点「生成方式」(t2i/edit/i2v…) 是 `node.meta.archetype.modeId` 的**持久状态**，
 * 默认落在 defaultModeId（如 nano-banana 的 t2i 文生图，slots:[] 无参考槽）。connectToNode 过去只建边、
 * 从不回看目标模式 → 把一张图连进新图片节点，节点仍停在「文生图」，图无槽可落，逼用户手动切「改图」。
 *
 * 规则：目标**当前模式**已有能消费（该 edge mode + 该源资产）的槽 → null（不切，尊重当前/用户的选择）；
 * 否则在档案里找**第一个**能消费的模式，返回其 id（连线后切到它，如 t2i→edit 参考图）。
 * 都不行 / 无档案 / 源无可参考产物 → null（真不支持的边 validateReferenceEdge 已在前面拦掉）。
 * 全从档案的参考槽声明派生，不写死任何 model/mode 字符串（P4 通用，与 validateReferenceEdge 同口径）。
 */
export function resolveTargetModeForEdge(
  source: GenerationCanvasNode,
  target: GenerationCanvasNode,
  mode: GenerationCanvasEdgeMode | undefined,
): string | null {
  const asset = referenceAssetKindForNode(source)
  if (!asset) return null
  const archetype = archetypeForNode(target)
  if (!archetype) return null
  const required = EDGE_MODE_SLOTS[mode ?? 'reference']
  const accepts = (m: ArchetypeMode): boolean =>
    m.slots.some((slot) => required.includes(slot.kind) && SLOT_ACCEPTS[slot.kind].includes(asset))
  const currentMode = currentArchetypeMode(archetype, (target.meta || {}) as Record<string, unknown>)
  if (accepts(currentMode)) return null
  const fallback = archetype.modes.find(accepts)
  return fallback ? fallback.id : null
}

/** 计划里的边(批准前):可能用 clientId(新节点)或真实 id(复用已有卡)。 */
export type PlannedEdgeLike = {
  source?: unknown
  target?: unknown
  sourceClientId?: unknown
  targetClientId?: unknown
  mode?: unknown
}

/**
 * 批准时按目标模型能力把边分成「连得上」「连不上」——和参数解析同理,让「你批准的」≡「实际执行的」。
 * 连不上的(目标模型不吃这类参考,如 image_ref 槽吃不了视频接力源)从批准计划里剔除,执行端不再丢、
 * 对账不再报「执行与批准有出入」。解析不出节点(未知 id)保守保留,交执行端 dangling 兜底。
 */
export function partitionConnectableEdges(
  edges: readonly PlannedEdgeLike[],
  resolveNode: (id: string) => GenerationCanvasNode | null,
): { connectable: PlannedEdgeLike[]; dropped: { edge: PlannedEdgeLike; reason: EdgeSkipReason }[] } {
  const connectable: PlannedEdgeLike[] = []
  const dropped: { edge: PlannedEdgeLike; reason: EdgeSkipReason }[] = []
  for (const edge of edges) {
    const sourceId = String(edge.sourceClientId ?? edge.source ?? '').trim()
    const targetId = String(edge.targetClientId ?? edge.target ?? '').trim()
    const source = sourceId ? resolveNode(sourceId) : null
    const target = targetId ? resolveNode(targetId) : null
    if (!source || !target) {
      connectable.push(edge)
      continue
    }
    const mode = typeof edge.mode === 'string' ? (edge.mode as GenerationCanvasEdgeMode) : undefined
    const verdict = validateReferenceEdge(source, target, mode)
    if (verdict.ok) connectable.push(edge)
    else dropped.push({ edge, reason: verdict.reason })
  }
  return { connectable, dropped }
}
