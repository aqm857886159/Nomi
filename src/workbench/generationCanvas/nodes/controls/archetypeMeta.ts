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
 * 往数组参考槽追加一个 URL 的**纯**单源逻辑（去重 + 上限判定）。renderer 的 handleArrayAdd、
 * 拖入(useNodeAssetDrop)、连线(completeNodeConnection)三处入口共用它——保证「加参考」只有一套
 * 去重/上限规则（规则 1：不开第 N 条写路径）。写入 / toast 由调用方按返回状态决定。
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
  references?: { firstFrameUrl?: string | null; lastFrameUrl?: string | null; referenceImages?: readonly string[] },
): Record<string, string | string[]> {
  const mode = currentArchetypeMode(archetype, meta)
  const out: Record<string, string | string[]> = {}
  for (const slot of mode.slots) {
    const inputKey = slotInputKey(slot)
    const asArray = slotAsArray(slot)
    const arr = ARRAY_SLOT_ROUTE[slot.kind]
    if (arr) {
      // 切片1 修边投递：手动拖入的 meta 数组 + 画布边产出的实时参考图（references.referenceImages，
      // 含 character_ref/style_ref/composition_ref 边的图）合并、去重、截到 slot.max。此前档案模型
      // 只读 meta、把边的图丢了——agent 连的 character_ref 边对主流模型连了等于没连。仅 image 槽收
      // 图片边（video/audio 槽不污染）；cap 至 slot.max 顺带封死手动超额导致的 vendor 422。
      const metaList = readArchetypeArray(meta, arr.metaKey)
      const edgeList = arr.accept === 'image' ? (references?.referenceImages ?? []) : []
      const merged: string[] = []
      for (const candidate of [...metaList, ...edgeList]) {
        const url = typeof candidate === 'string' ? candidate.trim() : ''
        if (url && !merged.includes(url)) merged.push(url)
      }
      const capped = slot.max > 0 ? merged.slice(0, slot.max) : merged
      if (capped.length) out[inputKey] = capped
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
