// 内置「模型档案」与生成节点 UI 之间的桥（C2b）。
//
// 职责：把档案的 modes/slots/params（src/config/modelArchetypes，供应商无关）映射成节点 UI
// 需要的三样东西 —— ① 模式分段切换的选项、② 当前模式的参考槽（复用现有 ImageUrlSlot 形状）、
// ③ 当前模式的标量参数。
//
// **参考图存储模型（对齐样张 v3）**：参考值按 slot 键**全局**存在 flat meta 里（firstFrameUrl /
// lastFrameUrl…），跨模式持久——切模式只改变「显示哪些槽」，不搬动/清空数据，所以切回照片还在
// （真实用户 F4「怕丢上传」）。**模式互斥（M2）发生在 `buildArchetypeInputParams`**：它只把**当前模式
// 声明的槽键**打进 archetypeInput，残留的别的模式的键根本不进 body（§2 坑2，避免 Seedance 422）。
// node.meta.archetype 只记 { id, modeId }（当前模式），不囤参考数据。
//
// C2b 只处理首帧 / 尾帧两类 frame 槽，映射到现有 flat 传输键（firstFrameUrl/lastFrameUrl），
// 传输层零改动。image_ref / video_ref / audio_ref（数组槽）在 C3 接入档案驱动的 input-builder。
import type { ModelParameterControl } from '../../../../config/modelCatalogMeta'
import {
  type ArchetypeMode,
  type ArchetypeReferenceSlotKind,
  type ModelArchetype,
  type ModelArchetypeVariant,
  resolveArchetypeForModel,
  specializeArchetypeForVariant,
} from '../../../../config/modelArchetypes'
import type { ImageUrlSlot } from '../../model/parameterReferenceSlots'
import { translateModelDisplayText } from '../../../../i18n/modelDisplayText'
import {
  DEFAULT_SLOT_INPUT_KEY,
  modeSlotReach,
  wireReferencedParamKeys,
  type SlotReach,
} from '../../../../../electron/catalog/referenceReachability'

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
  modeId: string
  /** 当前选中的变体 id（可选；无变体档案 / 旧 meta 未写时为空，由 currentArchetypeVariant 回落默认）。 */
  variantId: string
}

function readArchetypeNodeMeta(meta: Record<string, unknown> | undefined): ArchetypeNodeMeta | null {
  const value = meta?.archetype
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id : ''
  const modeId = typeof record.modeId === 'string' ? record.modeId : ''
  if (!id || !modeId) return null
  const variantId = typeof record.variantId === 'string' ? record.variantId : ''
  return { id, modeId, variantId }
}

/** 有效变体 id，兼容档案声明的历史别名；无匹配返回空串。 */
function canonicalVariantIdOf(archetype: ModelArchetype, variantId: string | null | undefined): string {
  const raw = typeof variantId === 'string' ? variantId.trim() : ''
  if (!raw || !archetype.variants?.length) return ''
  if (archetype.variants.some((v) => v.id === raw)) return raw
  const alias = archetype.variantIdAliases?.[raw]
  return alias && archetype.variants.some((v) => v.id === alias) ? alias : ''
}

/** 当前激活的模式（无命名空间 meta 或 modeId 失效时落到 defaultModeId）。 */
export function currentArchetypeMode(
  archetype: ModelArchetype,
  meta: Record<string, unknown> | undefined,
): ArchetypeMode {
  const stored = readArchetypeNodeMeta(meta)
  const modeId = stored && (stored.id === archetype.id || archetype.legacyIds?.includes(stored.id)) ? stored.modeId : ''
  return (
    archetype.modes.find((m) => m.id === modeId) ??
    archetype.modes.find((m) => m.id === archetype.defaultModeId) ??
    archetype.modes[0]
  )
}

/**
 * 当前激活的变体（对称 currentArchetypeMode）。读 `meta.archetype.variantId`，回落 defaultVariantId，
 * 再回落 variants[0]。无 variants 档案 → null（UI 不显示变体段，传输不带变体 model）。
 */
export function currentArchetypeVariant(
  archetype: ModelArchetype,
  meta: Record<string, unknown> | undefined,
): ModelArchetypeVariant | null {
  const variants = archetype.variants
  if (!variants || variants.length === 0) return null
  const stored = readArchetypeNodeMeta(meta)
  const variantId = stored?.id === archetype.id ? canonicalVariantIdOf(archetype, stored.variantId) : ''
  return (
    variants.find((v) => v.id === variantId) ?? variants.find((v) => v.id === archetype.defaultVariantId) ?? variants[0]
  )
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
  archetype: ModelArchetype,
  references?: ResolvedReferenceValues,
): boolean {
  const mode = currentArchetypeMode(archetype, meta)
  return mode.slots.some((slot) => {
    const route = ARRAY_SLOT_ROUTE[slot.kind]
    if (route) {
      return (
        readArchetypeArray(meta, route.metaKey).length > 0 ||
        edgeListForArraySlotAccept(route.accept, references).length > 0
      )
    }
    const metaKey = SINGLE_SLOT_META_KEY[slot.kind]
    if (!metaKey) return false
    const uploaded = typeof meta?.[metaKey] === 'string' ? (meta[metaKey] as string).trim() : ''
    return Boolean(uploaded || filledValueForSingleSlot(slot.kind, references))
  })
}

/** 当前模式的「源视频」单槽（HappyHorse video-edit）。返回 meta 存储键 + 标签；无则 null。 */
export function archetypeModeSourceVideoSlot(mode: ArchetypeMode): { metaKey: string; label: string } | null {
  const slot = mode.slots.find((s) => s.kind === 'source_video')
  return slot ? { metaKey: 'sourceVideoUrl', label: translateModelDisplayText(slot.label) } : null
}

/** 读 meta 里某数组槽的当前 URL 列表（健壮：非数组 / 含空串都过滤掉）。 */
export function readArchetypeArray(meta: Record<string, unknown> | undefined, metaKey: string): string[] {
  const value = meta?.[metaKey]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

export type ArchetypeArrayAppend =
  | { status: 'added'; next: string[] }
  | { status: 'empty' }
  | { status: 'duplicate' }
  | { status: 'full'; max: number }

/**
 * 往数组参考槽追加一个 URL 的**纯**单源逻辑（去重 + 上限判定）。**仅 meta-only 上传路径**用它：
 * renderer 的 handleArrayAdd（手动粘 URL）、拖入磁盘文件(useNodeAssetDrop)——这两处无源节点、是真上传。
 * 画布连线（completeNodeConnection）已收口成「建有序边」，不再写 meta（audit 2026-06-16 §1d），故不在此列。
 * 保证「加上传参考」只有一套去重/上限规则（规则 1：不开第 N 条写路径）。写入 / toast 由调用方按返回状态决定。
 */
export function appendArchetypeArrayValue(
  meta: Record<string, unknown> | undefined,
  slot: ArchetypeArraySlot,
  url: string,
): ArchetypeArrayAppend {
  const trimmed = url.trim()
  if (!trimmed) return { status: 'empty' }
  const current = readArchetypeArray(meta, slot.metaKey)
  if (current.includes(trimmed)) return { status: 'duplicate' }
  if (slot.max !== undefined && current.length >= slot.max) return { status: 'full', max: slot.max }
  return { status: 'added', next: [...current, trimmed] }
}

/** 当前模式的标量参数（复用现有 ModelParameterControl 渲染路径）。 */
export function archetypeModeParams(mode: ArchetypeMode): ModelParameterControl[] {
  return mode.params.map(localizeModelParameterControl)
}

export function localizeModelParameterControl(control: ModelParameterControl): ModelParameterControl {
  return {
    ...control,
    label: translateModelDisplayText(control.label),
    ...(control.placeholder ? { placeholder: translateModelDisplayText(control.placeholder) } : {}),
    ...(control.options
      ? {
          options: control.options.map((option) => ({
            ...option,
            label: translateModelDisplayText(option.label),
          })),
        }
      : {}),
  }
}

/** 当前模式的 per-mode model enum（HappyHorse 4 端点合 1 靠它；Seedance 各模式同 model → null）。 */
export function archetypeModeModelEnum(
  archetype: ModelArchetype,
  meta: Record<string, unknown> | undefined,
): string | null {
  return currentArchetypeMode(archetype, meta).modelEnum ?? null
}

/** 默认变体 id（无 variants → 空串；声明 variants 时取 defaultVariantId 回落 variants[0]）。 */
function defaultVariantIdOf(archetype: ModelArchetype): string {
  const variants = archetype.variants
  if (!variants || variants.length === 0) return ''
  return (variants.find((v) => v.id === archetype.defaultVariantId) ?? variants[0]).id
}

/** 保留当前 variantId（同档案）或回落默认（换档案 / 旧 meta 无 variantId）。 */
function preservedVariantId(meta: Record<string, unknown>, archetype: ModelArchetype): string {
  const stored = readArchetypeNodeMeta(meta)
  const keep = stored?.id === archetype.id ? canonicalVariantIdOf(archetype, stored.variantId) : ''
  return keep || defaultVariantIdOf(archetype)
}

/**
 * 切到 nextModeId：改 node.meta.archetype.modeId，并把**存量越界的 select 值夹回新模式的默认**
 * （参考值/照片全局保留，不搬不清）。返回**整份新 meta**。
 * 互斥不在这里发生——发生在 buildArchetypeInputParams（只发当前模式声明的槽键）。这样切回时照片还在。
 * variantId 跟随保留（切 mode 不动变体）；无变体档案则不写 variantId 键。
 *
 * ⚠️ 这里必须和 applyArchetypeVariantSwitch 一样调 clampMetaToModeParams —— **模式和变体一样会收窄参数**。
 * 2026-08-26 走查实测：火山 Seedance 2.5 在「文生视频」选了 16:9，切到「首帧」（官方硬约束 ratio 只能
 * adaptive，档案已把选项收窄成一项）后，UI 上一个选中项都没有，而 meta 里那个 16:9 原封不动留着并照发
 * —— 正好触发档案注释说要防的 InvalidParameter.TaskTypeConstraint（任务已创建才异步报错、额度已排队）。
 * 收窄了「选项」却不收窄「已存的值」= UI 与发送不一致。通用坑，不是 Seedance 专属。
 */
export function applyArchetypeModeSwitch(
  meta: Record<string, unknown>,
  archetype: ModelArchetype,
  nextModeId: string,
): Record<string, unknown> {
  const variantId = preservedVariantId(meta, archetype)
  // 按当前变体特化后再取模式参数：变体与模式**都**可能收窄同一个 select，夹的必须是两层叠加后的选项集。
  const specialized = specializeArchetypeForVariant(archetype, variantId)
  const nextMode = specialized.modes.find((m) => m.id === nextModeId) ?? specialized.modes[0]
  const clamped = nextMode ? clampMetaToModeParams(meta, nextMode.params) : meta
  return { ...clamped, archetype: { id: archetype.id, modeId: nextMode.id, ...(variantId ? { variantId } : {}) } }
}

/**
 * 把存量 meta 里「已不在新变体允许选项内」的 select 参数夹回该参数的 defaultValue（通用·按档案声明派生，
 * 不 hardcode 任何 key）。根治 D1：标准变体选了 4k → 切到「快速」变体（清晰度只剩 480/720）→ 存量 4k
 * 仍被发出 → 供应商 400/422。变体只收窄「选项」，本函数顺带收窄「已存的值」，让 UI 与发送一致。
 */
function clampMetaToModeParams(
  meta: Record<string, unknown>,
  modeParams: ModelParameterControl[],
): Record<string, unknown> {
  let next = meta
  for (const param of modeParams) {
    if (param.type !== 'select' || !param.options || param.options.length === 0) continue
    if (!(param.key in next)) continue
    const allowed = param.options.map((o) => o.value)
    if (allowed.includes(next[param.key] as string)) continue
    // 存量值越界 → 回落该参数 defaultValue（无 default 则删键，由下游取档案默认）。
    next = { ...next }
    if (param.defaultValue !== undefined) next[param.key] = param.defaultValue
    else delete next[param.key]
  }
  return next
}

/**
 * 切到 nextVariantId：改 node.meta.archetype.variantId（对称 applyArchetypeModeSwitch；不动 modeId、
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
  const modeId = stored?.id === archetype.id && stored.modeId ? stored.modeId : archetype.defaultModeId
  const canonicalNextId = canonicalVariantIdOf(archetype, nextVariantId)
  const nextVariant =
    variants.find((v) => v.id === canonicalNextId) ??
    variants.find((v) => v.id === archetype.defaultVariantId) ??
    variants[0]
  // 按新变体特化出当前模式的参数声明，把存量越界的 select 值夹回默认（D1：4k→fast 变体不再漏发）。
  const specialized = specializeArchetypeForVariant(archetype, nextVariant.id)
  const mode =
    specialized.modes.find((m) => m.id === modeId) ??
    specialized.modes.find((m) => m.id === specialized.defaultModeId) ??
    specialized.modes[0]
  const clamped = mode ? clampMetaToModeParams(meta, mode.params) : meta
  return { ...clamped, archetype: { id: archetype.id, modeId, variantId: nextVariant.id } }
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
): { modelKey: string; archetype: { id: string; modeId: string; variantId: string } } | null {
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
  const baseModelKey =
    archetype.catalogModelKey ?? (variants.find((v) => v.id === archetype.defaultVariantId) ?? variants[0]).modelKey
  // modelKey 已是基础 → variantId 是权威（缺则 currentArchetypeVariant 回落默认），无需迁移、幂等 no-op。
  // **绝不能用基础串反推变体**——基础串映射到 standard 会把已选的 fast/face 冲掉。
  const stored = readArchetypeNodeMeta(meta)
  if (norm(currentKey) === norm(baseModelKey)) {
    const canonicalStoredId = stored?.id === archetype.id ? canonicalVariantIdOf(archetype, stored.variantId) : ''
    // 已下线 variantId（face/fast-face）即使 modelKey 已折叠，也要改写成当前有效 id，避免节点默默回默认。
    if (canonicalStoredId && canonicalStoredId !== stored?.variantId) {
      return {
        modelKey: baseModelKey,
        archetype: { id: archetype.id, modeId: stored!.modeId, variantId: canonicalStoredId },
      }
    }
    return null
  }
  // modelKey 是变体全串（旧项目钉死的具体变体）→ 折叠成基础 modelKey + 从串 derive variantId。
  const matched = variants.find(
    (variant) =>
      norm(variant.modelKey) === norm(currentKey) ||
      (variant.identifierPatterns ?? []).some((p) => norm(p) === norm(currentKey)),
  )
  if (!matched) return null
  const modeId = stored?.id === archetype.id && stored.modeId ? stored.modeId : archetype.defaultModeId
  return { modelKey: baseModelKey, archetype: { id: archetype.id, modeId, variantId: matched.id } }
}

/**
 * 初次落地（节点刚选到一个有档案的模型、还没有命名空间 meta 时）：写入默认模式的 archetype 命名空间。
 * 幂等：已是该档案则返回 null（不循环）。变体档案同时初始化 variantId（由 applyArchetypeModeSwitch 写）。
 */
export function ensureArchetypeNodeMeta(
  meta: Record<string, unknown>,
  archetype: ModelArchetype,
): Record<string, unknown> | null {
  const stored = readArchetypeNodeMeta(meta)
  if (stored && archetype.legacyIds?.includes(stored.id)) {
    const mode = currentArchetypeMode(archetype, meta)
    return applyArchetypeModeSwitch(preserveLegacyPixelRatio(meta, mode), archetype, mode.id)
  }
  // 已是该档案：若有变体但 variantId 缺/失效 → 补默认变体（旧 meta 升级）；否则幂等 null。
  if (stored?.id === archetype.id) {
    if (!(archetype.variants?.length ?? 0)) return null
    const canonicalStoredId = canonicalVariantIdOf(archetype, stored.variantId)
    if (stored.variantId && canonicalStoredId === stored.variantId) return null
    return applyArchetypeVariantSwitch(meta, archetype, canonicalStoredId || defaultVariantIdOf(archetype))
  }
  return applyArchetypeModeSwitch(meta, archetype, archetype.defaultModeId)
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

// 缺省 API 输入键（模型契约，供应商无关）的**单一真相源**在 electron/catalog/referenceReachability——
// 渲染层（发送构造）与 electron 侧（渠道承载力判定 + 第三闸）必须同一张表，否则「UI 以为发得出、
// 闸门判发不出」会再次分家（本轮修的正是这类）。slot.inputKey 仍可逐槽覆盖。
const DEFAULT_AS_ARRAY: Record<ArchetypeReferenceSlotKind, boolean> = {
  first_frame: false,
  last_frame: false,
  source_video: false,
  image_ref: true,
  video_ref: true,
  audio_ref: true,
}
/** 角色数组合并（combineSlotsInto）时 slot.kind → 缺省 role；slot.roleName 可覆盖。
 *  单一真相源：role 默认派生自 kind，避免 role 与 kind 两条平行真相源（P1）。 */
/**
 * 方舟 content 项的 role 取值单一真相源。五个值全部来自官方字段表
 * （`content[].role`：first_frame / last_frame / reference_image / reference_video / reference_audio）。
 * video_ref / audio_ref 两条以前漏了 —— 图片参考带 role、参考视频/音频裸奔，属于半接
 * （2026-07-31 拿到中转交付文档逐项对账时抓出）。
 */
const DEFAULT_ROLE_FOR_KIND: Partial<Record<ArchetypeReferenceSlotKind, string>> = {
  first_frame: 'first_frame',
  last_frame: 'last_frame',
  image_ref: 'reference_image',
  video_ref: 'reference_video',
  audio_ref: 'reference_audio',
}

/** 构造层产出的通用 input 值：标量 / 数组 / 角色对象数组（combineSlotsInto）。模板引擎原样透传。 */
type ArchetypeInputValue =
  | string
  | Record<string, unknown>
  | string[]
  | Array<{ url: string; role: string }>
  | Array<Record<string, unknown>>

/** 一个声明槽在 meta 里的存储形态（单一真相源：槽→存储键 的知识只在这里）。无存储映射 → null。 */
export type ReferenceSlotStorage = { metaKey: string; isArray: boolean }
export function referenceSlotStorage(slot: { kind: ArchetypeReferenceSlotKind }): ReferenceSlotStorage | null {
  const arr = ARRAY_SLOT_ROUTE[slot.kind]
  if (arr) return { metaKey: arr.metaKey, isArray: true }
  const single = SINGLE_SLOT_META_KEY[slot.kind]
  if (single) return { metaKey: single, isArray: false }
  return null
}

function slotInputKey(slot: { kind: ArchetypeReferenceSlotKind; inputKey?: string }): string {
  return slot.inputKey ?? DEFAULT_SLOT_INPUT_KEY[slot.kind]
}
function slotAsArray(slot: { kind: ArchetypeReferenceSlotKind; asArray?: boolean }): boolean {
  return slot.asArray ?? DEFAULT_AS_ARRAY[slot.kind]
}

/**
 * 「这个槽是一格还是一袋」的**唯一判据**（P1）：声明的 `asArray` 优先，缺省按 kind 推（DEFAULT_AS_ARRAY）。
 * 从前分镜行另有一份写死的 `NAMED_FRAME_SLOT_KINDS` 集合与这里并列——两份真相源今天恰好一致、
 * 明天任一档案写 `asArray` 覆盖就分家。任何「单槽 vs 数组槽」的分叉都必须问这个函数。
 */
export function referenceSlotIsArray(slot: { kind: ArchetypeReferenceSlotKind; asArray?: boolean }): boolean {
  return slotAsArray(slot)
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

function volcengineImageContentItem(url: string, role: string): Record<string, unknown> {
  return { type: 'image_url', image_url: { url }, role }
}

function volcengineContentItem(inputKey: string, url: string): Record<string, unknown> | null {
  if (inputKey === 'volcengine_first_image_content')
    return volcengineImageContentItem(url, DEFAULT_ROLE_FOR_KIND.first_frame ?? 'first_frame')
  if (inputKey === 'volcengine_first_role_image_content')
    return volcengineImageContentItem(url, DEFAULT_ROLE_FOR_KIND.first_frame ?? 'first_frame')
  if (inputKey === 'volcengine_last_role_image_content')
    return volcengineImageContentItem(url, DEFAULT_ROLE_FOR_KIND.last_frame ?? 'last_frame')
  return null
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
  archetype: ModelArchetype,
  edgeImageUrls: readonly string[],
): string[] {
  const mode = currentArchetypeMode(archetype, meta)
  const slot = mode.slots.find((s) => ARRAY_SLOT_ROUTE[s.kind]?.accept === 'image')
  const route = slot ? ARRAY_SLOT_ROUTE[slot.kind] : undefined
  if (!slot || !route) return []
  return mergeOrderedReferenceImageUrls(edgeImageUrls, readArchetypeArray(meta, route.metaKey), slot.max)
}

/** 当前模式所有数组媒体参考的发送顺序 + 类型编号，供 @imageN/@videoN/@audioN 共用。 */
export function orderedSentMediaReferenceUrls(
  meta: Record<string, unknown>,
  archetype: ModelArchetype,
  edgeReferences: {
    image?: readonly string[]
    video?: readonly string[]
    audio?: readonly string[]
  },
): Array<{ url: string; kind: 'image' | 'video' | 'audio'; index: number }> {
  const mode = currentArchetypeMode(archetype, meta)
  const counts: Record<'image' | 'video' | 'audio', number> = { image: 0, video: 0, audio: 0 }
  const out: Array<{ url: string; kind: 'image' | 'video' | 'audio'; index: number }> = []
  for (const slot of mode.slots) {
    const route = ARRAY_SLOT_ROUTE[slot.kind]
    if (!route) continue
    const kind = route.accept
    const edgeUrls = edgeReferences[kind] ?? []
    const urls = mergeOrderedReferenceImageUrls(edgeUrls, readArchetypeArray(meta, route.metaKey), slot.max)
    for (const url of urls) {
      counts[kind] += 1
      out.push({ url, kind, index: counts[kind] })
    }
  }
  return out
}

/**
 * **档案驱动的 input 构建（M1 单源 + M2 互斥 + M3 enum 覆盖）**：renderer 据当前模式把参考值打成
 * 最终的**通用 snake input 参数**（key = slot 的 API 名，值 = 标量或数组）。只含当前模式声明的键
 * → 别的模式的残留键根本不进结果（M2，§2 坑2）。供应商 mapping body 直接读 request.params.<key>
 * （kie 文档的尾随空格 quirk 在 kie body 单独照抄，§2 坑1）。返回对象放进 extras.archetypeInput，
 * runtime 原样铺进 params（electron/catalog/archetypeInput）。
 */
export function buildArchetypeInputParams(
  meta: Record<string, unknown>,
  archetype: ModelArchetype,
  references?: EdgeReferenceLists & {
    firstFrameUrl?: string | null
    lastFrameUrl?: string | null
  },
): Record<string, ArchetypeInputValue> {
  const mode = currentArchetypeMode(archetype, meta)
  const out: Record<string, ArchetypeInputValue> = {}
  for (const slot of mode.slots) {
    const inputKey = slotInputKey(slot)
    const asArray = slotAsArray(slot)
    const arr = ARRAY_SLOT_ROUTE[slot.kind]
    if (arr) {
      // 画布边产出的实时参考图 + 手动拖入的 meta 数组，经 mergeOrderedReferenceImageUrls 单源合并：
      // **连线在前、上传在后**（option 2 · 2026-06-25 拍板），去重、截到 slot.max——与面板编号①②③、
      // @ 候选、@ 投影 character{N} 同一顺序，杜绝张冠李戴。仅 image 槽收图片边（video/audio 槽不污染，
      // edgeList=[]）；cap 顺带封死手动超额导致的 vendor 422。
      const metaList = readArchetypeArray(meta, arr.metaKey)
      // 按槽资产类型喂对应的连线参考（B4：video_ref/audio_ref 槽此前只收 meta 上传，连线的视频/音频被丢）。
      // 这条规则与判定侧 hasArchetypeArrayReferences 共用同一个函数，别在这里就地展开成 ternary。
      const edgeList = edgeListForArraySlotAccept(arr.accept, references)
      const capped = mergeOrderedReferenceImageUrls(edgeList, metaList, slot.max)
      if (capped.length) {
        if (inputKey === 'volcengine_image_contents') {
          const role = DEFAULT_ROLE_FOR_KIND.image_ref ?? 'reference_image'
          out[inputKey] = capped.map((url) => volcengineImageContentItem(url, role))
        } else if (inputKey === 'volcengine_video_contents') {
          const role = DEFAULT_ROLE_FOR_KIND.video_ref ?? 'reference_video'
          out[inputKey] = capped.map((url) => ({ type: 'video_url', video_url: { url }, role }))
        } else if (inputKey === 'volcengine_audio_contents') {
          const role = DEFAULT_ROLE_FOR_KIND.audio_ref ?? 'reference_audio'
          out[inputKey] = capped.map((url) => ({ type: 'audio_url', audio_url: { url }, role }))
        } else if (!slotAsArray(slot) && slot.max === 1) {
          // 声明 asArray:false 的单容量数组路由槽（Agnes i2v 的 image）→ 发**单图字符串**，声明说话算话。
          // 旧实现无视 asArray 恒发数组 → Agnes Go 后端 Alias.image(string) 解析失败，Windows 用户
          // 只能手改 asar 把模板打成 image.0 顶着（2026-07-06 群反馈实锤）。修在构造层而非各家模板：
          // 声明层的 asArray 从此对数组路由槽也生效，同类档案不再逐个踩。
          out[inputKey] = capped[0]
        } else {
          out[inputKey] = capped
        }
      }
      continue
    }
    const metaKey = SINGLE_SLOT_META_KEY[slot.kind]
    if (!metaKey) continue
    // 单值槽的连线来源与判定侧共用 sentValueForSingleSlot —— 此前这里只认首/尾帧，source_video 槽
    // 连了线也取不到值（meta.sourceVideoUrl 为空 → video_url 键根本不发），HappyHorse 视频编辑
    // 「拖一段视频进去」等于白拖（2026-08-20 不变量测试扫出，与判定侧同一根因）。
    const fromRef = sentValueForSingleSlot(slot.kind, references)
    const raw =
      typeof fromRef === 'string' && fromRef.trim()
        ? fromRef.trim()
        : typeof meta[metaKey] === 'string'
          ? (meta[metaKey] as string).trim()
          : ''
    if (raw) {
      out[inputKey] = volcengineContentItem(inputKey, raw) ?? (asArray ? [raw] : raw)
    }
  }
  // 角色数组合并（通用原语）：把本模式有值的槽 → [{url, role}] 落在 combineSlotsInto.key，删被合并的
  // 扁平键（M2 互斥）。role = slot.roleName ?? 由 kind 派生（单源）。键名来自档案声明，不写死/不 if-vendor。
  // 必须在此构造层拼好整个数组——模板引擎丢得掉 undefined 键/元素，但丢不掉 {url:undefined} 对象（坑）。
  if (mode.combineSlotsInto) {
    const flat = mode.combineSlotsInto.flat === true
    // 扁平模式（Veo 首尾帧）：有序 string[]，[0]=首 [1]=尾。非扁平（Seedance）：[{url,role}]。
    const combinedFlat: string[] = []
    const combinedRoles: Array<{ url: string; role: string }> = []
    for (const slot of mode.slots) {
      const role = slot.roleName ?? DEFAULT_ROLE_FOR_KIND[slot.kind]
      if (!flat && !role) continue
      const inputKey = slotInputKey(slot)
      const value = out[inputKey]
      const push = (url: string) => {
        if (flat) combinedFlat.push(url)
        else combinedRoles.push({ url, role: role as string })
      }
      if (typeof value === 'string') push(value)
      else if (Array.isArray(value))
        value.forEach((item) => {
          if (typeof item === 'string') push(item)
        })
      delete out[inputKey]
    }
    const combined = flat ? combinedFlat : combinedRoles
    if (combined.length) out[mode.combineSlotsInto.key] = combined
  }
  // 模式级固定 body 参数（generation_type 等不需用户选的常量）。在 model 字段之前并入，键不与槽/参数冲突。
  if (mode.fixedParams) {
    for (const [key, value] of Object.entries(mode.fixedParams)) out[key] = value
  }
  // model 字段（变体 > per-mode enum > 不带）：
  // ① 变体轴（A）：选中变体的 modelKey 决定实际发请求的 model（如 doubao-seedance-2.0-fast）。
  //    变体优先于 mode.modelEnum——变体跨所有 mode 生效，是更外层的身份。
  // ② per-mode enum 覆盖（M3，HappyHorse）：无变体时按当前模式的 modelEnum。
  // ③ 都无（如 kie Seedance 各模式同 model 且无变体）→ 不带，catalog body 仍用 {{model.modelKey}}。
  const variant = currentArchetypeVariant(archetype, meta)
  if (variant) out.model = variant.modelKey
  else if (mode.modelEnum) out.model = mode.modelEnum
  return out
}
