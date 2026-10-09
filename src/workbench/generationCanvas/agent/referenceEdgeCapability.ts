// 参考边能力校验(T8 根治轨迹盲连)。纯函数,可单测。
//
// 根因:connect_nodes 过去只校验「两端节点存在」,不查目标模型支不支持这条参考——
// 让 agent 凭故事结构盲连,连出静默无效边(连上了、落库了,生成期却被丢弃):
//   ① 非素材节点(镜头笔记/输出等)→生成节点:源不产可参考资产,在参考维度纯噪音。
//      文本节点是例外:文本→图片/视频的通用 reference 边会作为 prompt 上下文,不落参考槽。
//   ② character_ref → 不声明任何图片参考槽的纯文生模型(如 imagen-4):到 archetype
//      input-builder 进不去(buildArchetypeInputParams 只发当前模式声明的槽键),静默丢弃。
//
// 唯一真相源 = 模型 archetype 的参考槽声明(electron/shared/modelArchetypes,supplier-agnostic)。
// 这里把「边语义(mode)+源资产类型」对照「目标模型 archetype 任意模式声明的参考槽」校验,
// 只放行模型真能消费的边;放不行的进 skipped + reason,诚实回报给 LLM(它据此改模型/模式或删边)。
//
// 跨「所有模式」union 校验(非当前模式):拒的是「这个模型根本不吃这类参考」的硬错(用户两例),
// 不拒「模型支持但当前选错模式」的软错(那个由 availableModels 喂能力给 agent + 用户在计划卡
// 改模式兜)——避免误伤可恢复的模式选择问题。目标未声明档案(未知/未设模型)一律放行(P4 通用回退)。
import type { GenerationCanvasEdge, GenerationCanvasEdgeMode, GenerationCanvasNode, GenerationNodeKind } from '../model/generationCanvasTypes'
import { getGenerationNodeDefinition, getGenerationNodeExecutionKind } from '../model/generationNodeKinds'
import type { ArchetypeMode, ArchetypeReferenceSlotKind, ModelArchetype } from '../../../../electron/shared/modelArchetypes'
import { MODEL_ARCHETYPES, resolveArchetypeForModel } from '../../../../electron/shared/modelArchetypes'
import { currentArchetypeMode } from '../nodes/controls/archetypeMeta'

/** 源节点产出的可参考资产类型;text/shot/output 等无产出 → null(不能作参考源)。 */
import { SLOT_ACCEPTS, type ReferenceAssetKind } from '../../../../electron/shared/modelArchetypes/anchorPolicy'
export { SLOT_ACCEPTS, type ReferenceAssetKind } from '../../../../electron/shared/modelArchetypes/anchorPolicy'

/** `target_takes_no_input`：目标这一类节点根本不收输入（上传素材 / 文本……，见种类定义的 `connects.input`）。 */
export type EdgeSkipReason = 'dangling' | 'source_not_referenceable' | 'unsupported_reference' | 'target_takes_no_input'

export type EdgeCapabilityResult = { ok: true } | { ok: false; reason: EdgeSkipReason }

/**
 * 源节点能给出哪种可参考资产。先问种类定义「有没有能给下游用的产出」（`connects.output`，唯一 owner）——
 * 没有 → null；有 → 按执行语义 derive（与 resolver 取参考的口径一致）：可执行视频→video、可执行图片→image、
 * 可执行音频→audio；文本的产出是给下游的**提示词上下文**、不是参考素材 → null（文本边走 isTextPromptEdge）；
 * 不执行但有产出的种类（素材 / 全景 / 导演台 / 画板）看产物 result.type。
 */
export function referenceAssetKindForNode(node: GenerationCanvasNode): ReferenceAssetKind | null {
  const definition = getGenerationNodeDefinition(node.kind)
  if (!definition.connects.output) return null
  const exec = getGenerationNodeExecutionKind(node.kind)
  if (exec === 'video') return 'video'
  if (exec === 'image') return 'image'
  // 音频节点(kind='audio')的产物是且只能是音频参考(用户报的根因「声音节点连不上视频节点」)。
  if (exec === 'audio') return 'audio'
  if (exec) return null
  // 素材节点(kind='asset')**一个种类同时承载导入的图、视频和音频**——真实媒体类型必须看产物
  // result.type，不能一律当图参考。否则导入的视频被判 image → 连成 character_ref → 落「角色参考」
  // 图槽 → 显示成 <img src=video.mp4> 加载失败(用户报的「上传视频却显示图片/加载失败」)，且与发送侧
  // (generationReferenceResolver 按 result.type 把视频/音频分流进 referenceVideos/referenceAudios)
  // 口径分裂。看 result.type 后:视频 → video_ref 槽、音频 → audio_ref 槽。无产物(上传中)默认 image。
  if (node.result?.type === 'video') return 'video'
  if (node.result?.type === 'audio') return 'audio'
  return 'image'
}

/**
 * 文本节点的通用 reference 出边不是“参考素材”，而是下游生成 prompt 的上下文补充。
 * 只允许喂给图片/视频/3D 生成节点（吃 prompt 的媒体生成面）；其它边语义仍走正常参考能力校验。
 * 口径与 collectConnectedTextPromptParts 的目标判定一致，改必同改。
 */
export function isTextPromptEdge(
  source: GenerationCanvasNode,
  target: GenerationCanvasNode,
  mode: GenerationCanvasEdgeMode | undefined = 'reference',
): boolean {
  if ((mode ?? 'reference') !== 'reference' || source.kind !== 'text') return false
  const targetExec = getGenerationNodeExecutionKind(target.kind)
  return targetExec === 'image' || targetExec === 'video' || targetExec === 'model3d'
}

/** 每种参考槽能被哪种源资产喂。first_frame 收视频=尾帧接力(resolver 抽帧),故收 image+video。 */


/**
 * 边语义 → 它要落到目标模型的哪些参考槽(任一满足即可)。通用 reference 接受任意槽。
 *
 * first_frame 同时认 `image_ref`:i2v 模型的「首帧输入槽」声明不统一——Hailuo 标 first_frame，
 * 而 Kling/Veo/Wan/seedance-apimart 把首帧输入归到通用 image_ref 数组槽(i2v 的输入图 = 首帧)。
 * 两者都能消费 keyframe→video 的首帧边,故都放行:resolver 已把首帧边的图源同时塞进 referenceImages
 * (→ image_ref 槽,archetypeMeta array 路由) 和 firstFrameUrl (→ first_frame 槽),投递端两条路都通。
 * 不放行就会把这条边静默丢弃 → 对账误报「批准已连接/实际未连接」(用户反复撞见的根因)。
 */
const EDGE_MODE_SLOTS: Record<GenerationCanvasEdgeMode, readonly ArchetypeReferenceSlotKind[]> = {
  // 顺序即偏好（preferredSlotKinds）：视频先参考视频 / 源视频，最后才退成首帧接力。
  reference: ['image_ref', 'video_ref', 'source_video', 'first_frame', 'last_frame', 'audio_ref'],
  first_frame: ['first_frame', 'image_ref'],
  last_frame: ['last_frame'],
  style_ref: ['image_ref'],
  character_ref: ['image_ref'],
  composition_ref: ['image_ref'],
}

/**
 * 从节点 meta 解析模型档案 —— **一律走发送路径同一个解析器** `resolveArchetypeForModel`。
 *
 * 为什么不能在这里就地读 `meta.archetype.id`（旧实现干过，2026-09-08 修掉）：那条捷径**跳过了
 * `legacyIds` 迁移**。档案一分为二时（Agnes Image 2.0/2.1 就是：2.1 声明 `legacyIds: ['agnes-image']`），
 * 存量节点的 meta 里还钉着旧的共享 id，发送路径按 legacyIds + 模型身份迁移到 2.1，而这里直接
 * `getArchetypeById('agnes-image')` 拿到 2.0 —— **同一个节点，两条路径认到两个不同档案**。
 * 于是「按活边自动纠正模式」的守卫拿 2.0 去算模式、写回 2.0 的 id、再按 2.0 的参数表把用户选的
 * 2.1 档位（1K/2K/4K）夹回 1024x1024，而报文仍按 2.1 渲染。用户体感就是「Agnes 2.1 连了参考图，
 * 结果不对/没传入」。
 *
 * `resolveArchetypeForModel` 自己就读 `meta.archetype.id`（readArchetypeIdFromMeta）并在其上做
 * 自定义契约 → 显式 id → legacyIds 迁移 → 身份匹配的完整解析，所以这里只要把 meta 原样交给它，
 * 不留第二套判断（P1）。modelKey 缺失时传空串：解析器退化成「只认 meta 里的显式 id」，与旧行为一致。
 */
export function archetypeForNode(node: GenerationCanvasNode): ModelArchetype | null {
  const meta = node.meta
  if (!meta || typeof meta !== 'object') return null
  const record = meta as Record<string, unknown>
  const modelKey = typeof record.modelKey === 'string' ? record.modelKey : ''
  const modelVendor = record.modelVendor
  return resolveArchetypeForModel({
    modelKey,
    vendorKey: typeof modelVendor === 'string' ? modelVendor : null,
    meta,
  })
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
 * 这条参考边目标到底收不收——**新建**连线的总闸（手动拖线 / 点「+」/ 点选 / @ / Agent / 自动引用都经它）。
 * 目标这一类不收输入（种类定义 `connects.input === false`：上传素材、文本……）→ target_takes_no_input;
 * 文本→图片/视频的通用 reference 边作为 prompt 上下文放行;
 * 其余源无可参考资产 → source_not_referenceable;
 * 目标自己读上游边（`connects.input` 是素材列表：剪辑、导演台）→ 源资产在列表里才收，否则 unsupported_reference;
 * 目标声明了档案但任何模式都没有能消费「该 mode + 该源资产」的槽 → unsupported_reference;
 * 其余(含生成类目标还没选模型)→ ok。
 * 只管新建：已经存在的旧边（老项目）照常加载、显示、能断开，这里不回头删它们。
 */
export function validateReferenceEdge(
  source: GenerationCanvasNode,
  target: GenerationCanvasNode,
  mode: GenerationCanvasEdgeMode | undefined,
): EdgeCapabilityResult {
  const input = getGenerationNodeDefinition(target.kind).connects.input
  if (input === false) return { ok: false, reason: 'target_takes_no_input' }
  if (isTextPromptEdge(source, target, mode)) return { ok: true }
  const asset = referenceAssetKindForNode(source)
  if (!asset) return { ok: false, reason: 'source_not_referenceable' }
  if (input !== 'models') return input.includes(asset) ? { ok: true } : { ok: false, reason: 'unsupported_reference' }
  const slotKinds = targetSlotKinds(target)
  if (!slotKinds) return { ok: true }
  const required = EDGE_MODE_SLOTS[mode ?? 'reference']
  const satisfiable = required.some((slot) => slotKinds.has(slot) && SLOT_ACCEPTS[slot].includes(asset))
  return satisfiable ? { ok: true } : { ok: false, reason: 'unsupported_reference' }
}

/**
 * 从这个源拖一条线到空白处（或点「+」圈），能**新建并接上**哪几种生成节点——连线新建菜单的唯一 owner。
 *
 * 由连线能力派生，不按 kind 名单：文本给下游当 prompt 上下文（isTextPromptEdge）；其余看源产出的
 * 参考资产，有任一该种类的模型档案在任一模式里有槽收它，才算接得上。于是视频源 → 视频节点（参考视频 /
 * 尾帧接力），音频源 → 视频节点（参考音频），图片源 → 图片 + 视频。接不上的不藏，带原因（见下）。
 *
 * 2026-09-24 用户反馈「视频无法拖出下一个连线」：v0.22 起每张能连线的卡都有「+」圈，但松手处的菜单还按
 * 旧名单只认 text/image，视频拖出去松手直接被取消，连线凭空消失。
 */
/**
 * 为什么接不上（两侧菜单共用一套原因、一套文案，见 quickActions/nodeDeriveMenuModel）：
 * - `source_not_referenceable`：源根本不产可参考的素材；
 * - `no_model_accepts`：这一类节点没有任何模型收这种素材；
 * - `model_rejects`：（左「+」）这张卡**当前选的模型**不收这种素材；
 * - `not_accepted`：（左「+」）这张卡这一类根本不收这种输入（例如剪辑卡不收文字）。
 */
export type ConnectionCreateBlockReason = 'source_not_referenceable' | 'no_model_accepts' | 'model_rejects' | 'not_accepted'

export type ConnectionCreateVerdict<K extends GenerationNodeKind = GenerationNodeKind> =
  | { kind: K; ok: true }
  | { kind: K; ok: false; reason: ConnectionCreateBlockReason; asset: ReferenceAssetKind | null }

/**
 * 「从这个源能新建并接上哪一类节点」的**带原因**判据（2026-10-04 节点「用这个节点生成…」菜单：
 * 接不上的要灰掉并说原因，不是藏起来）。两个入口（拖线松手 / 点「+」）问的是同一个问题，判据只有这一份。
 */
export function connectionCreateVerdictsForSource<K extends GenerationNodeKind>(
  source: GenerationCanvasNode,
  kinds: readonly K[],
): ConnectionCreateVerdict<K>[] {
  const asset = referenceAssetKindForNode(source)
  return kinds.map((kind): ConnectionCreateVerdict<K> => {
    if (isTextPromptEdge(source, { ...source, kind })) return { kind, ok: true }
    if (!asset) return { kind, ok: false, reason: 'source_not_referenceable', asset }
    const accepted = MODEL_ARCHETYPES.some((archetype) =>
      archetype.kind === kind && archetype.modes.some((mode) => mode.slots.some((slot) => SLOT_ACCEPTS[slot.kind].includes(asset))),
    )
    return accepted ? { kind, ok: true } : { kind, ok: false, reason: 'no_model_accepts', asset }
  })
}

/** 某一类刚新建、还空着的节点（还没选模型、没有产物）——判「新建这一类接进来行不行」用。 */
function emptyNodeOfKind(kind: GenerationNodeKind, like: GenerationCanvasNode): GenerationCanvasNode {
  return { id: `new-${kind}`, kind, title: '', position: like.position, categoryId: like.categoryId, meta: {} }
}

/** 这一类节点有没有任一模型档案在任一模式里收这种素材（新建节点还没选模型时的判据，与右侧同一口径）。 */
function anyArchetypeOfKindAccepts(kind: string | undefined, asset: ReferenceAssetKind): boolean {
  return MODEL_ARCHETYPES.some((archetype) =>
    archetype.kind === kind && archetype.modes.some((mode) => mode.slots.some((slot) => SLOT_ACCEPTS[slot.kind].includes(asset))),
  )
}

/**
 * 左「+」= **给这张卡加输入**：新建哪一类节点接进来、接得上吗——以本卡为**目标**算（2026-10-08 拍板 ②；
 * 修 bug ②：以前拿右侧那份以本卡为**源**的判据来判，视频卡把图片 / 文字灰掉，文本卡却能连出 图片 → 文本）。
 * 与 `connectionCreateVerdictsForSource` 同文件、同一套原因（文案在 nodeDeriveMenuModel 一处翻译）。
 * 判据全读种类定义的 `connects.input` 与模型档案：不收输入 → not_accepted；文本 → 吃提示词的目标才收；
 * 素材列表型（剪辑 / 导演台）→ 列表里有才收；生成类 → 选了模型按这个模型（validateReferenceEdge 同口径），
 * 没选模型按这一类任一模型。
 */
export function connectionCreateVerdictsForTarget<K extends GenerationNodeKind>(
  target: GenerationCanvasNode,
  kinds: readonly K[],
): ConnectionCreateVerdict<K>[] {
  const input = getGenerationNodeDefinition(target.kind).connects.input
  return kinds.map((kind): ConnectionCreateVerdict<K> => {
    const source = emptyNodeOfKind(kind, target)
    const asset = referenceAssetKindForNode(source)
    if (input === false) return { kind, ok: false, reason: 'not_accepted', asset }
    if (isTextPromptEdge(source, target)) return { kind, ok: true }
    if (!asset) return { kind, ok: false, reason: 'not_accepted', asset }
    if (input !== 'models') return input.includes(asset) ? { kind, ok: true } : { kind, ok: false, reason: 'not_accepted', asset }
    if (archetypeForNode(target)) {
      return validateReferenceEdge(source, target, 'reference').ok ? { kind, ok: true } : { kind, ok: false, reason: 'model_rejects', asset }
    }
    return anyArchetypeOfKindAccepts(getGenerationNodeExecutionKind(target.kind), asset)
      ? { kind, ok: true }
      : { kind, ok: false, reason: 'no_model_accepts', asset }
  })
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
  if (referenceAssetKindForNode(source) === 'image' && target.kind === 'video') return preferredIncomingImageEdgeMode(target, existingEdgesToTarget)
  return 'reference'
}

function edgeModeForArchetypeMode(mode: ArchetypeMode, existingEdgesToTarget: readonly GenerationCanvasEdge[]): GenerationCanvasEdgeMode {
  if (mode.slots.some((slot) => slot.kind === 'image_ref' && Boolean(slot.characterIndexed))) return 'character_ref'
  if (mode.slots.some((slot) => slot.kind === 'first_frame')) {
    if (!existingEdgesToTarget.some((edge) => edge.mode === 'first_frame')) return 'first_frame'
    if (mode.slots.some((slot) => slot.kind === 'last_frame') && !existingEdgesToTarget.some((edge) => edge.mode === 'last_frame')) return 'last_frame'
  }
  return mode.slots.some((slot) => slot.kind === 'image_ref') ? 'reference' : 'first_frame'
}

const REFERENCE_WORKFLOW_INTENTS = ['reference', 'character', 'multimodal']

/**
 * The one ranking of which workflow an incoming image lands in: the model's declared reference
 * workflows first, then other image-reference workflows, then first-frame workflows. Both the edge
 * vocabulary (`preferredIncomingImageEdgeMode`, before the edge exists) and the mode switch
 * (`resolveTargetModeForEdge`, after it exists) read this ranking; they differ only in what
 * "this mode can take it" means. Intents and slots come from the archetype, never a model id.
 */
function preferredImageWorkflow(archetype: ModelArchetype, accepts: (mode: ArchetypeMode) => boolean): ArchetypeMode | undefined {
  return archetype.modes.find((candidate) => REFERENCE_WORKFLOW_INTENTS.includes(String(candidate.intent)) && accepts(candidate))
    ?? archetype.modes.find((candidate) => (
      candidate.slots.some((slot) => slot.kind === 'image_ref')
      && !['single', 'firstlast'].includes(String(candidate.intent))
      && accepts(candidate)
    ))
    ?? archetype.modes.find((candidate) => candidate.slots.some((slot) => slot.kind === 'first_frame') && accepts(candidate))
}

const acceptsIncomingImage = (mode: ArchetypeMode): boolean => mode.slots.some((slot) => slot.kind === 'image_ref' || slot.kind === 'first_frame')

function preferredIncomingImageEdgeMode(target: GenerationCanvasNode, existingEdgesToTarget: readonly GenerationCanvasEdge[]): GenerationCanvasEdgeMode {
  const archetype = archetypeForNode(target)
  if (!archetype) return 'first_frame'
  const currentMode = currentArchetypeMode(archetype, (target.meta || {}) as Record<string, unknown>)
  if (acceptsIncomingImage(currentMode)) return edgeModeForArchetypeMode(currentMode, existingEdgesToTarget)
  const preferred = preferredImageWorkflow(archetype, acceptsIncomingImage)
  return preferred ? edgeModeForArchetypeMode(preferred, existingEdgesToTarget) : 'reference'
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
  const currentMode = currentArchetypeMode(archetype, (target.meta || {}) as Record<string, unknown>)
  const demand: ReferenceDemand = { slots: EDGE_MODE_SLOTS[mode ?? 'reference'], asset }
  const rankOf = (candidate: ArchetypeMode): number =>
    demand.slots.findIndex((kind) => SLOT_ACCEPTS[kind].includes(asset) && candidate.slots.some((slot) => slot.kind === kind))
  // A newly connected image enters the same preferred workflow the edge vocabulary picked
  // (one ranking, see preferredImageWorkflow), restricted to modes that can take this edge.
  if (rankOf(currentMode) < 0) {
    const preferred = preferredImageWorkflow(archetype, (candidate) => rankOf(candidate) >= 0)
    if (preferred && preferred.id !== currentMode.id) return preferred.id
  }
  return resolveModeForReferenceDemand(archetype, (target.meta || {}) as Record<string, unknown>, [
    demand,
  ])
}

/** 一条「挂在节点身上的参考需求」：它想落的槽种类集合 × 源资产类型。 */
export type ReferenceDemand = { slots: readonly ArchetypeReferenceSlotKind[]; asset: ReferenceAssetKind }

/**
 * 给定若干参考需求，当前模式该不该切、切到哪（resolveTargetModeForEdge 的多需求泛化，同一份语义）。
 * 当前模式已能消费**任一**需求 → null（尊重现状，与建边 auto-promote 的幂等口径一致）；
 * 一条都收不下 → 挑「能收下需求条数最多」的模式；档案没有任何模式能收 → null（真不支持）。
 */
/**
 * 一条边（语义 × 源资产）可落的槽，**按偏好排好序**——落槽（referenceSlots.assignEdgeToSlot）与挑模式
 * （resolveModeForReferenceDemand）共用这一份顺序，不各写一张。
 */
export function preferredSlotKinds(
  mode: GenerationCanvasEdgeMode | undefined,
  asset: ReferenceAssetKind,
): ArchetypeReferenceSlotKind[] {
  return EDGE_MODE_SLOTS[mode ?? 'reference'].filter((kind) => SLOT_ACCEPTS[kind].includes(asset))
}

export function resolveModeForReferenceDemand(
  archetype: ModelArchetype,
  meta: Record<string, unknown> | undefined,
  demands: readonly ReferenceDemand[],
): string | null {
  if (!demands.length) return null
  // 这个模式收这条需求时，用得上的最好的槽在需求的偏好顺序里排第几（收不下 = -1）。
  const rankOf = (m: ArchetypeMode, d: ReferenceDemand): number =>
    d.slots.findIndex((kind) => SLOT_ACCEPTS[kind].includes(d.asset) && m.slots.some((slot) => slot.kind === kind))
  const currentMode = currentArchetypeMode(archetype, meta)
  if (demands.some((d) => rankOf(currentMode, d) >= 0)) return null
  // 收下的需求条数最多者胜；条数相同，按边的偏好顺序（EDGE_MODE_SLOTS）取槽更对口的——视频连进刚建的视频节点落「全能参考」
  // （参考视频），而不是排在前面、只能拿它做首帧接力的「图生视频」（2026-09-24 用户拍板）。
  let best: ArchetypeMode | null = null
  let bestScore = 0
  let bestRank = Infinity
  for (const m of archetype.modes) {
    const ranks = demands.map((d) => rankOf(m, d)).filter((rank) => rank >= 0)
    const rank = ranks.reduce((sum, value) => sum + value, 0)
    if (ranks.length > bestScore || (ranks.length === bestScore && ranks.length > 0 && rank < bestRank)) {
      best = m
      bestScore = ranks.length
      bestRank = rank
    }
  }
  return best && best.id !== currentMode.id ? best.id : null
}

/**
 * 按**活边**判断：目标节点当前「生成方式」收不收得下身上挂着的参考，收不下该切到哪。
 *
 * 根因（2026-07-28 群反馈「男的角色图生成出女的」）：建边时的 auto-promote 只覆盖「建边那一刻」，
 * 三条路够不到——①换模型（meta.archetype 失配落回新档案默认 t2i，边还挂着）②提示词库带参考图
 * ③auto-promote 上线前的存量边。停在 t2i 的节点在 buildArchetypeInputParams 的 M2 互斥里把参考
 * 整个丢掉、canRunGenerationNode 又对 t2i 提前放行 → 付费发出纯文生。此函数供提交咽喉/换模型处
 * reconcile 兜底（P2：让整类不再复发）。
 *
 * **只看活边，不看 meta 参考残值**：meta 参考值跨模式持久是拍板过的设计（切模式不清数据，怕丢上传），
 * 用户手动切走后残值不构成「要用参考」的意图；活边是画布上可见的连接，才是意图。
 * 文本 prompt 边（isTextPromptEdge）不是参考素材，不参与。
 */
export function resolveModeForConnectedReferences(
  target: GenerationCanvasNode,
  nodes: readonly GenerationCanvasNode[],
  edges: readonly GenerationCanvasEdge[],
  /** 连线之外、同样要这次生成带上的参考（付费卡：画布占位节点自己参考槽里摆着的值）。 */
  extra: readonly ReferenceDemand[] = [],
): string | null {
  const archetype = archetypeForNode(target)
  if (!archetype || archetype.modes.length <= 1) return null
  const demands: ReferenceDemand[] = [...extra]
  for (const edge of edges) {
    if (edge.target !== target.id) continue
    const source = nodes.find((n) => n.id === edge.source)
    if (!source || isTextPromptEdge(source, target, edge.mode)) continue
    const asset = referenceAssetKindForNode(source)
    if (!asset) continue
    demands.push({ slots: EDGE_MODE_SLOTS[edge.mode ?? 'reference'], asset })
  }
  return resolveModeForReferenceDemand(archetype, (target.meta || {}) as Record<string, unknown>, demands)
}

/** 参考的用途 → 对应的连线语义（首 / 尾帧照名；角色、通用、音频都按通用参考，落哪一格由目标的槽位解析定）。 */
export function edgeModeForReferenceRole(role: string | undefined): GenerationCanvasEdgeMode {
  return role === 'first_frame' || role === 'last_frame' ? role : 'reference'
}

/** 一条按用途给出的参考（不是连线）要的槽：和那条用途对应的连线要的一样。 */
export function referenceDemandForRole(role: string | undefined, asset: ReferenceAssetKind): ReferenceDemand {
  return { slots: EDGE_MODE_SLOTS[edgeModeForReferenceRole(role)], asset }
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

/** 从一个编组的右侧「+」拖到空白处：组内任一成员接得上就算接得上（落下后组内每个成员各连一条，收不下的由连线侧说明）；都接不上时给第一个成员的原因。 */
export function connectionCreateVerdictsForSources<K extends GenerationNodeKind>(
  sources: readonly GenerationCanvasNode[],
  kinds: readonly K[],
): ConnectionCreateVerdict<K>[] {
  const perSource = sources.map((source) => connectionCreateVerdictsForSource(source, kinds))
  return kinds.map((kind, index): ConnectionCreateVerdict<K> => {
    const candidates = perSource.map((verdicts) => verdicts[index])
    return candidates.find((verdict) => verdict.ok) ?? candidates[0] ?? { kind, ok: false, reason: 'source_not_referenceable', asset: null }
  })
}
