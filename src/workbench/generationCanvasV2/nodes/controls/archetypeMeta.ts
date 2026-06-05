// 内置「模型档案」与生成节点 UI 之间的桥（C2b）。
//
// 职责：把档案的 modes/slots/params（src/config/modelArchetypes，供应商无关）映射成节点 UI
// 需要的三样东西 —— ① 模式分段切换的选项、② 当前模式的参考槽（复用现有 ImageUrlSlot 形状）、
// ③ 当前模式的标量参数。
//
// **参考图存储模型（对齐样张 v3）**：参考值按 slot 键**全局**存在 flat meta 里（firstFrameUrl /
// lastFrameUrl…），跨模式持久——切模式只改变「显示哪些槽」，不搬动/清空数据，所以切回照片还在
// （真实用户 F4「怕丢上传」）。**模式互斥（M2）发生在传输投影**：`projectArchetypeFrameExtras`
// 只把**当前模式声明的槽键**放进请求，残留的别的模式的键不进 body（§2 坑2，避免 Seedance 422）。
// node.meta.archetype 只记 { id, modeId }（当前模式），不囤参考数据。
//
// C2b 只处理首帧 / 尾帧两类 frame 槽，映射到现有 flat 传输键（firstFrameUrl/lastFrameUrl），
// 传输层零改动。image_ref / video_ref / audio_ref（数组槽）在 C3 接入档案驱动的 input-builder。
import type { ModelParameterControl } from '../../../../config/modelCatalogMeta'
import {
  type ArchetypeMode,
  type ArchetypeReferenceSlotKind,
  type ModelArchetype,
  resolveArchetypeForModel,
} from '../../../../config/modelArchetypes'
import type { ImageUrlSlot } from './parameterControlModel'

export { resolveArchetypeForModel }
export type { ModelArchetype, ArchetypeMode }

/**
 * 单图 frame 槽 → 现有 flat 传输键映射（首/尾帧，走画布边 + 单缩略图）。url 键即传输读取的键
 * （runtime taskTemplateParams 读 extras.firstFrameUrl/lastFrameUrl）；ref 键记住来源节点 id。
 */
const FRAME_SLOT_FLAT: Partial<Record<ArchetypeReferenceSlotKind, { urlKey: string; refKey: string; group: ImageUrlSlot['group'] }>> = {
  first_frame: { urlKey: 'firstFrameUrl', refKey: 'firstFrameRef', group: 'first_frame' },
  last_frame: { urlKey: 'lastFrameUrl', refKey: 'lastFrameRef', group: 'last_frame' },
}

/**
 * 多参考**数组**槽（C3，meta-only 不走画布边，评审 M6）→ 路由键。
 * - metaKey：渲染层把数组存这（camelCase，全局持久，跨模式保留）。
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
}

function readArchetypeNodeMeta(meta: Record<string, unknown> | undefined): ArchetypeNodeMeta | null {
  const value = meta?.archetype
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id : ''
  const modeId = typeof record.modeId === 'string' ? record.modeId : ''
  if (!id || !modeId) return null
  return { id, modeId }
}

/** 当前激活的模式（无命名空间 meta 或 modeId 失效时落到 defaultModeId）。 */
export function currentArchetypeMode(archetype: ModelArchetype, meta: Record<string, unknown> | undefined): ArchetypeMode {
  const stored = readArchetypeNodeMeta(meta)
  const modeId = stored?.id === archetype.id ? stored.modeId : ''
  return archetype.modes.find((m) => m.id === modeId)
    ?? archetype.modes.find((m) => m.id === archetype.defaultModeId)
    ?? archetype.modes[0]
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

/** 当前模式的**数组**参考槽（character1..9 / 视频 / 音频）。meta-only。 */
export function archetypeModeArraySlots(mode: ArchetypeMode): ArchetypeArraySlot[] {
  return mode.slots.flatMap((slot): ArchetypeArraySlot[] => {
    const route = ARRAY_SLOT_ROUTE[slot.kind]
    if (!route) return []
    const numbered = slot.kind === 'image_ref'
    return [{
      metaKey: route.metaKey,
      label: slot.label,
      min: slot.min,
      max: slot.max,
      accept: route.accept,
      numbered,
      ...(numbered ? { caption: '顺序对应 prompt 里的 character1…9' } : {}),
    }]
  })
}

/** 当前模式是否含「角色参考」数组槽（用于在 prompt 框旁给出 character1.. 提示，U2）。 */
export function modeHasCharacterSlot(mode: ArchetypeMode): boolean {
  return mode.slots.some((slot) => slot.kind === 'image_ref')
}

/** 读 meta 里某数组槽的当前 URL 列表（健壮：非数组 / 含空串都过滤掉）。 */
export function readArchetypeArray(meta: Record<string, unknown> | undefined, metaKey: string): string[] {
  const value = meta?.[metaKey]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

/** 当前模式的标量参数（复用现有 ModelParameterControl 渲染路径）。 */
export function archetypeModeParams(mode: ArchetypeMode): ModelParameterControl[] {
  return mode.params
}

/** 当前模式的 per-mode model enum（HappyHorse 4 端点合 1 靠它；Seedance 各模式同 model → null）。 */
export function archetypeModeModelEnum(archetype: ModelArchetype, meta: Record<string, unknown> | undefined): string | null {
  return currentArchetypeMode(archetype, meta).modelEnum ?? null
}

/**
 * 切到 nextModeId：只改 node.meta.archetype.modeId（参考值全局保留，不搬不清）。返回**整份新 meta**。
 * 互斥不在这里发生——发生在传输投影（projectArchetypeFrameExtras）。这样切回时照片还在。
 */
export function applyArchetypeModeSwitch(
  meta: Record<string, unknown>,
  archetype: ModelArchetype,
  nextModeId: string,
): Record<string, unknown> {
  const nextMode = archetype.modes.find((m) => m.id === nextModeId) ?? archetype.modes[0]
  return { ...meta, archetype: { id: archetype.id, modeId: nextMode.id } }
}

/**
 * 初次落地（节点刚选到一个有档案的模型、还没有命名空间 meta 时）：写入默认模式的 archetype 命名空间。
 * 幂等：已是该档案则返回 null（不循环）。
 */
export function ensureArchetypeNodeMeta(
  meta: Record<string, unknown>,
  archetype: ModelArchetype,
): Record<string, unknown> | null {
  const stored = readArchetypeNodeMeta(meta)
  if (stored?.id === archetype.id) return null
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

function slotInputKey(slot: { kind: ArchetypeReferenceSlotKind; inputKey?: string }): string {
  return slot.inputKey ?? DEFAULT_INPUT_KEY[slot.kind]
}
function slotAsArray(slot: { kind: ArchetypeReferenceSlotKind; asArray?: boolean }): boolean {
  return slot.asArray ?? DEFAULT_AS_ARRAY[slot.kind]
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
  references?: { firstFrameUrl?: string | null; lastFrameUrl?: string | null },
): Record<string, string | string[]> {
  const mode = currentArchetypeMode(archetype, meta)
  const out: Record<string, string | string[]> = {}
  for (const slot of mode.slots) {
    const inputKey = slotInputKey(slot)
    const asArray = slotAsArray(slot)
    const arr = ARRAY_SLOT_ROUTE[slot.kind]
    if (arr) {
      const list = readArchetypeArray(meta, arr.metaKey)
      if (list.length) out[inputKey] = list
      continue
    }
    const metaKey = SINGLE_SLOT_META_KEY[slot.kind]
    if (!metaKey) continue
    const fromRef = metaKey === 'firstFrameUrl' ? references?.firstFrameUrl
      : metaKey === 'lastFrameUrl' ? references?.lastFrameUrl
      : undefined
    const raw = (typeof fromRef === 'string' && fromRef.trim()) ? fromRef.trim()
      : (typeof meta[metaKey] === 'string' ? (meta[metaKey] as string).trim() : '')
    if (raw) out[inputKey] = asArray ? [raw] : raw
  }
  // M3：per-mode enum 覆盖（HappyHorse）。Seedance 各模式同 model → 不带，body 用 {{model.modelKey}}。
  if (mode.modelEnum) out.model = mode.modelEnum
  return out
}
