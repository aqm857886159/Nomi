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
import type { ImageUrlSlot } from './parameterControlModel'

export { resolveArchetypeForModel }
export type { ModelArchetype, ArchetypeMode, ModelArchetypeVariant }

/**
 * 单图 frame 槽 → 现有 flat 传输键映射（首/尾帧，走画布边 + 单缩略图）。url 键即传输读取的键
 * （runtime taskTemplateParams 读 extras.firstFrameUrl/lastFrameUrl）；ref 键记住来源节点 id。
 */
const FRAME_SLOT_FLAT: Partial<Record<ArchetypeReferenceSlotKind, { urlKey: string; refKey: string; group: ImageUrlSlot['group'] }>> = {
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

/** 当前激活的模式（无命名空间 meta 或 modeId 失效时落到 defaultModeId）。 */
export function currentArchetypeMode(archetype: ModelArchetype, meta: Record<string, unknown> | undefined): ArchetypeMode {
  const stored = readArchetypeNodeMeta(meta)
  const modeId = stored?.id === archetype.id ? stored.modeId : ''
  return archetype.modes.find((m) => m.id === modeId)
    ?? archetype.modes.find((m) => m.id === archetype.defaultModeId)
    ?? archetype.modes[0]
}

/**
 * 当前激活的变体（对称 currentArchetypeMode）。读 `meta.archetype.variantId`，回落 defaultVariantId，
 * 再回落 variants[0]。无 variants 档案 → null（UI 不显示变体段，传输不带变体 model）。
 */
export function currentArchetypeVariant(archetype: ModelArchetype, meta: Record<string, unknown> | undefined): ModelArchetypeVariant | null {
  const variants = archetype.variants
  if (!variants || variants.length === 0) return null
  const stored = readArchetypeNodeMeta(meta)
  const variantId = stored?.id === archetype.id ? stored.variantId : ''
  return variants.find((v) => v.id === variantId)
    ?? variants.find((v) => v.id === archetype.defaultVariantId)
    ?? variants[0]
}

export type ArchetypeVariantChoice = { id: string; label: string }

/** 变体分段切换的选项（标签 = 变体自己的名字）。无 variants / 仅 1 个 → 空（UI 不显示该段）。 */
export function archetypeVariantChoices(archetype: ModelArchetype): ArchetypeVariantChoice[] {
  const variants = archetype.variants
  if (!variants || variants.length <= 1) return []
  return variants.map((v) => ({ id: v.id, label: v.label }))
}

export type ArchetypeModeChoice = { id: string; vendorTerm: string; hint: string }

/** 模式分段切换的选项（标签 = 模型自己的真名 vendorTerm；仅当 >1 模式时 UI 才显示该段）。 */
export function archetypeModeChoices(archetype: ModelArchetype): ArchetypeModeChoice[] {
  return archetype.modes.map((mode) => ({
    id: mode.id,
    vendorTerm: mode.vendorTerm,
    hint: mode.hint,
  }))
}

/** 当前模式的**单图 frame 槽** → 现有 ImageUrlSlot（首/尾帧，走画布边）。数组槽见 archetypeModeArraySlots。 */
export function archetypeModeSlots(mode: ArchetypeMode): ImageUrlSlot[] {
  return mode.slots.flatMap((slot): ImageUrlSlot[] => {
    const flat = FRAME_SLOT_FLAT[slot.kind]
    if (!flat) return []
    return [{ key: flat.urlKey, label: slot.label, group: flat.group }]
  })
}

export type ArchetypeArraySlot = {
  metaKey: string
  label: string
  min: number
  max: number
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
    return [{
      metaKey: route.metaKey,
      label: slot.label,
      min: slot.min,
      max: slot.max,
      accept: route.accept,
      numbered,
      // 编号语义靠 tile 上的 ①②③ 徽标自明（样张 v4）；character1..N 是发送前投影，用户永不可见。
      ...(numbered ? { caption: '按放入顺序编号 ①②③' } : {}),
    }]
  })
}

/** 当前模式是否含「角色参考」槽（按序 character1..N，即 @ 引用投影的目标槽）。 */
export function modeHasCharacterSlot(mode: ArchetypeMode): boolean {
  return mode.slots.some((slot) => Boolean(slot.characterIndexed))
}

/**
 * 当前模式是否已放入任何数组参考（omni 角色图/视频/音频任一非空）。
 * video 节点据此判断「可生成」——omni 不靠首/尾帧，靠参考数组；缺它会被误判为「需要首帧」而锁死生成。
 * 接受任意非空字符串（含 nomi-local://，传输前 R1 会本地化），不做 http 过滤——这只是「有没有参考」的判断。
 */
export function hasArchetypeArrayReferences(meta: Record<string, unknown> | undefined, archetype: ModelArchetype): boolean {
  const mode = currentArchetypeMode(archetype, meta)
  return archetypeModeArraySlots(mode).some((slot) => readArchetypeArray(meta, slot.metaKey).length > 0)
}

/** 当前模式的「源视频」单槽（HappyHorse video-edit）。返回 meta 存储键 + 标签；无则 null。 */
export function archetypeModeSourceVideoSlot(mode: ArchetypeMode): { metaKey: string; label: string } | null {
  const slot = mode.slots.find((s) => s.kind === 'source_video')
  return slot ? { metaKey: 'sourceVideoUrl', label: slot.label } : null
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
  | { status: 'full' }

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
  if (current.length >= slot.max) return { status: 'full' }
  return { status: 'added', next: [...current, trimmed] }
}

/** 当前模式的标量参数（复用现有 ModelParameterControl 渲染路径）。 */
export function archetypeModeParams(mode: ArchetypeMode): ModelParameterControl[] {
  return mode.params
}

/** 当前模式的 per-mode model enum（HappyHorse 4 端点合 1 靠它；Seedance 各模式同 model → null）。 */
export function archetypeModeModelEnum(archetype: ModelArchetype, meta: Record<string, unknown> | undefined): string | null {
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
  const keep = stored?.id === archetype.id && stored.variantId
    && archetype.variants?.some((v) => v.id === stored.variantId)
  return keep ? stored!.variantId : defaultVariantIdOf(archetype)
}

/**
 * 切到 nextModeId：只改 node.meta.archetype.modeId（参考值全局保留，不搬不清）。返回**整份新 meta**。
 * 互斥不在这里发生——发生在 buildArchetypeInputParams（只发当前模式声明的槽键）。这样切回时照片还在。
 * variantId 跟随保留（切 mode 不动变体）；无变体档案则不写 variantId 键。
 */
export function applyArchetypeModeSwitch(
  meta: Record<string, unknown>,
  archetype: ModelArchetype,
  nextModeId: string,
): Record<string, unknown> {
  const nextMode = archetype.modes.find((m) => m.id === nextModeId) ?? archetype.modes[0]
  const variantId = preservedVariantId(meta, archetype)
  return { ...meta, archetype: { id: archetype.id, modeId: nextMode.id, ...(variantId ? { variantId } : {}) } }
}

/**
 * 把存量 meta 里「已不在新变体允许选项内」的 select 参数夹回该参数的 defaultValue（通用·按档案声明派生，
 * 不 hardcode 任何 key）。根治 D1：标准变体选了 4k → 切到「快速」变体（清晰度只剩 480/720）→ 存量 4k
 * 仍被发出 → 供应商 400/422。变体只收窄「选项」，本函数顺带收窄「已存的值」，让 UI 与发送一致。
 */
function clampMetaToModeParams(meta: Record<string, unknown>, modeParams: ModelParameterControl[]): Record<string, unknown> {
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
  const modeId = (stored?.id === archetype.id && stored.modeId) ? stored.modeId : archetype.defaultModeId
  const nextVariant = variants.find((v) => v.id === nextVariantId) ?? variants.find((v) => v.id === archetype.defaultVariantId) ?? variants[0]
  // 按新变体特化出当前模式的参数声明，把存量越界的 select 值夹回默认（D1：4k→fast 变体不再漏发）。
  const specialized = specializeArchetypeForVariant(archetype, nextVariant.id)
  const mode = specialized.modes.find((m) => m.id === modeId) ?? specialized.modes.find((m) => m.id === specialized.defaultModeId) ?? specialized.modes[0]
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
  // picker/catalog 折叠后只列**基础 modelKey** = 默认变体的 modelKey。归一后必须把 meta.modelKey 设成它，
  // 否则变体全串(doubao-seedance-2.0-fast)在 picker(只有基础选项 + findModelOptionByIdentifier 精确匹配)
  // 命中不到 → 选择显示空（这正是「最大风险点」）。变体信息只由 variantId 承载（与 applyArchetypeVariantSwitch
  // 一致：切变体只改 variantId、不动 modelKey）。
  const baseModelKey = (variants.find((v) => v.id === archetype.defaultVariantId) ?? variants[0]).modelKey
  // modelKey 已是基础 → variantId 是权威（缺则 currentArchetypeVariant 回落默认），无需迁移、幂等 no-op。
  // **绝不能用基础串反推变体**——基础串映射到 standard 会把已选的 fast/face 冲掉。
  if (norm(currentKey) === norm(baseModelKey)) return null
  // modelKey 是变体全串（旧项目钉死的具体变体）→ 折叠成基础 modelKey + 从串 derive variantId。
  const matched = variants.find((variant) =>
    norm(variant.modelKey) === norm(currentKey) || (variant.identifierPatterns ?? []).some((p) => norm(p) === norm(currentKey)),
  )
  if (!matched) return null
  const stored = readArchetypeNodeMeta(meta)
  const modeId = (stored?.id === archetype.id && stored.modeId) ? stored.modeId : archetype.defaultModeId
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
  // 已是该档案：若有变体但 variantId 缺/失效 → 补默认变体（旧 meta 升级）；否则幂等 null。
  if (stored?.id === archetype.id) {
    const needsVariant = (archetype.variants?.length ?? 0) > 0
      && !archetype.variants!.some((v) => v.id === stored.variantId)
    if (!needsVariant) return null
    return applyArchetypeVariantSwitch(meta, archetype, defaultVariantIdOf(archetype))
  }
  return applyArchetypeModeSwitch(meta, archetype, archetype.defaultModeId)
}

/** 单图 frame 槽（含 source_video）在 meta 里的存储键。source_video UI 本轮从简（meta 直存）。 */
const SINGLE_SLOT_META_KEY: Partial<Record<ArchetypeReferenceSlotKind, string>> = {
  first_frame: 'firstFrameUrl',
  last_frame: 'lastFrameUrl',
  source_video: 'sourceVideoUrl',
}

/** 缺省的 API 输入键（模型契约，供应商无关）。slot.inputKey 可覆盖。 */
const DEFAULT_INPUT_KEY: Record<ArchetypeReferenceSlotKind, string> = {
  first_frame: 'first_frame_url',
  last_frame: 'last_frame_url',
  image_ref: 'reference_image_urls',
  video_ref: 'reference_video_urls',
  audio_ref: 'reference_audio_urls',
  source_video: 'video_url',
}
const DEFAULT_AS_ARRAY: Record<ArchetypeReferenceSlotKind, boolean> = {
  first_frame: false, last_frame: false, source_video: false,
  image_ref: true, video_ref: true, audio_ref: true,
}
/** 角色数组合并（combineSlotsInto）时 slot.kind → 缺省 role；slot.roleName 可覆盖。
 *  单一真相源：role 默认派生自 kind，避免 role 与 kind 两条平行真相源（P1）。 */
const DEFAULT_ROLE_FOR_KIND: Partial<Record<ArchetypeReferenceSlotKind, string>> = {
  first_frame: 'first_frame',
  last_frame: 'last_frame',
  image_ref: 'reference_image',
}

/** 构造层产出的通用 input 值：标量 / 数组 / 角色对象数组（combineSlotsInto）。模板引擎原样透传。 */
type ArchetypeInputValue = string | Record<string, unknown> | string[] | Array<{ url: string; role: string }> | Array<Record<string, unknown>>

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
  return slot.inputKey ?? DEFAULT_INPUT_KEY[slot.kind]
}
function slotAsArray(slot: { kind: ArchetypeReferenceSlotKind; asArray?: boolean }): boolean {
  return slot.asArray ?? DEFAULT_AS_ARRAY[slot.kind]
}

function volcengineImageContentItem(url: string, role: string): Record<string, unknown> {
  return { type: 'image_url', image_url: { url }, role }
}

function volcengineContentItem(inputKey: string, url: string): Record<string, unknown> | null {
  if (inputKey === 'volcengine_first_image_content') return volcengineImageContentItem(url, DEFAULT_ROLE_FOR_KIND.first_frame ?? 'first_frame')
  if (inputKey === 'volcengine_first_role_image_content') return volcengineImageContentItem(url, DEFAULT_ROLE_FOR_KIND.first_frame ?? 'first_frame')
  if (inputKey === 'volcengine_last_role_image_content') return volcengineImageContentItem(url, DEFAULT_ROLE_FOR_KIND.last_frame ?? 'last_frame')
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
  maxCap: number,
): string[] {
  const merged: string[] = []
  for (const candidate of [...edgeImageUrls, ...uploadUrls]) {
    const url = typeof candidate === 'string' ? candidate.trim() : ''
    if (url && !merged.includes(url)) merged.push(url)
  }
  return maxCap > 0 ? merged.slice(0, maxCap) : merged
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
  references?: {
    firstFrameUrl?: string | null
    lastFrameUrl?: string | null
    referenceImages?: readonly string[]
    referenceVideos?: readonly string[]
    referenceAudios?: readonly string[]
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
      const edgeList =
        arr.accept === 'image' ? (references?.referenceImages ?? [])
        : arr.accept === 'video' ? (references?.referenceVideos ?? [])
        : arr.accept === 'audio' ? (references?.referenceAudios ?? [])
        : []
      const capped = mergeOrderedReferenceImageUrls(edgeList, metaList, slot.max)
      if (capped.length) {
        if (inputKey === 'volcengine_image_contents') {
          const role = DEFAULT_ROLE_FOR_KIND.image_ref ?? 'reference_image'
          out[inputKey] = capped.map((url) => volcengineImageContentItem(url, role))
        } else if (inputKey === 'volcengine_video_contents') {
          out[inputKey] = capped.map((url) => ({ type: 'video_url', video_url: { url } }))
        } else if (inputKey === 'volcengine_audio_contents') {
          out[inputKey] = capped.map((url) => ({ type: 'audio_url', audio_url: { url } }))
        } else {
          out[inputKey] = capped
        }
      }
      continue
    }
    const metaKey = SINGLE_SLOT_META_KEY[slot.kind]
    if (!metaKey) continue
    const fromRef = metaKey === 'firstFrameUrl' ? references?.firstFrameUrl
      : metaKey === 'lastFrameUrl' ? references?.lastFrameUrl
      : undefined
    const raw = (typeof fromRef === 'string' && fromRef.trim()) ? fromRef.trim()
      : (typeof meta[metaKey] === 'string' ? (meta[metaKey] as string).trim() : '')
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
      const push = (url: string) => { if (flat) combinedFlat.push(url); else combinedRoles.push({ url, role: role as string }) }
      if (typeof value === 'string') push(value)
      else if (Array.isArray(value)) value.forEach((item) => { if (typeof item === 'string') push(item) })
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
