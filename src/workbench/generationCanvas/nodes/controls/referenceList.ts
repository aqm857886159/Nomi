// 参考图的唯一主人（方向检查 docs/audit/2026-10-22-composer-reference-slots-direction.md 的「重写」）。
//
// 节点上只存**一份有序参考列表**（meta.referenceImageUrls）：创作者上传 / 从素材库放进来的图，按放入顺序排。
// 「这张图现在落哪个槽、在不在用」不存，每次从这份列表 + 当前档案方式 + 连线占位**推导**（placeUploadedImages）。
// 所以：
// - 换方式、换模型不改这份列表——切过去再切回来，一张不少、顺序不变；
// - 界面（参考行、「未用到」、「+」满额）和请求组装（档案输入、标准参考面）问的是同一个函数，标的就是发的；
// - 首帧 / 尾帧不再是存储位置：首尾帧方式下，列表里排在前面、没被连线占掉的图依次落首帧、尾帧，其余「未用到」。
//
// 旧数据（firstFrameUrl / lastFrameUrl / first_frame_url / referenceImageUrl / referenceImages 这些按槽存的键）
// 读的时候归一进这份列表（readReferenceList），任何一次参考写入都把它落成规范形（withReferenceList 删掉旧键）。
// 归一顺序按**当前方式看得见的在前**：首尾帧方式 = 首帧、尾帧、再数组；参考方式 = 数组、再首尾帧——
// 存量节点打开时，参考行里原来看得见的图位置不变，原来看不见的残留排到后面（槽有空位就在用，否则「未用到」）。
//
// 视频 / 音频参考、源视频不在这份列表里：它们各住各的键（referenceVideoUrls / referenceAudioUrls / sourceVideoUrl），
// 也不会在槽种之间迁移。
//
// **旧工程里以前藏着的图先放一边**（#1269 合并前条件 4，协调 10-23 定、已报用户）：旧节点上那些旧界面在当时那个方式下
// 根本不显示的键（参考方式里残留的首 / 尾帧、首尾帧方式里残留的参考数组、snake 别名……），读进列表后一律记进
// 「先放一边」（PARKED_KEY）：不落槽、不发，参考行里淡显「未用到」；用户点它一下才算放回在用。用户没主动放进来的图，
// 不替他花钱。判据只看旧界面真实显示了什么（main 上的 resolveReferenceSlots：首帧槽读 firstFrameUrl、尾帧槽读
// lastFrameUrl、参考数组槽读 referenceImageUrls，别的键一概不显示），按节点记着的那个方式（meta.archetype）算。
import { resolveModelArchetype, type ArchetypeMode, type ArchetypeReferenceSlotKind } from '../../../../../electron/shared/modelArchetypes'
import { REFERENCE_PARKED_KEY } from '../../../../../electron/shared/modelArchetypes/referenceKeys'

/** 这份有序列表住的键（和参考数组槽的存储键同一个，旧数据里纯参考方式的节点因此不用迁移）。 */
export const REFERENCE_LIST_KEY = 'referenceImageUrls'

/**
 * 列表没有「空位」，首尾帧却有一种合法的空：首帧空着、只放了尾帧（对调后、或直接往尾帧格里放）。这一个开关记下它：
 * 开着时，首帧槽不收上传图，列表的第一张落尾帧。只在首尾帧方式里有意义；别的方式忽略它（列表照常从第一张落）。
 */
export const FIRST_FRAME_EMPTY_KEY = 'referenceFirstFrameEmpty'

/**
 * 列表里「先放一边」的图（旧工程打开时界面看不见的残留）：不落槽、不发，用户点回在用才算（见文件头）。
 * 键名住在 shared 的通用参考键表旁边：它装的是图，请求组装要把它当参考键清掉，不能随 `...meta` 进 extras。
 */
export const PARKED_KEY = REFERENCE_PARKED_KEY

/** 收上传图片的槽种（按方式里的声明顺序依次落）。 */
const IMAGE_UPLOAD_SLOT_KINDS: ReadonlySet<ArchetypeReferenceSlotKind> = new Set(['first_frame', 'last_frame', 'image_ref'])

/** 旧数据里按槽存的图片键：只读进列表，写的时候删掉。单值键 / 数组键分开（数组键 referenceImages 是旧快照）。 */
const LEGACY_FIRST_KEYS = ['firstFrameUrl', 'first_frame_url'] as const
const LEGACY_LAST_KEYS = ['lastFrameUrl', 'last_frame_url'] as const
const LEGACY_SINGLE_ALIASES = ['referenceImageUrl'] as const
const LEGACY_ARRAY_ALIASES = ['referenceImages'] as const
/** 旧数据里跟着这些键写的节点引用 / 槽声明影子：规范形里一并删掉，免得「看不见的旧家」又被别处读出来。 */
const LEGACY_SHADOW_KEYS = [
  'firstFrameRef', 'firstFrameReference', 'firstFrameUrl_nodeRef',
  'lastFrameRef', 'lastFrameReference', 'lastFrameUrl_nodeRef',
  'referenceImageRef', 'referenceImageRefs',
] as const

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : []
}
function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

export function isImageUploadSlot(kind: ArchetypeReferenceSlotKind): boolean {
  return IMAGE_UPLOAD_SLOT_KINDS.has(kind)
}

function modeShowsFramesFirst(mode: Pick<ArchetypeMode, 'slots'> | null | undefined): boolean {
  return !mode || mode.slots.some((slot) => slot.kind === 'first_frame' || slot.kind === 'last_frame')
}

/** meta 里还躺着旧的按槽存的图片键吗（规范形里一个都不该有）。 */
export function hasLegacyReferenceKeys(meta: Record<string, unknown> | undefined): boolean {
  if (!meta) return false
  return [...LEGACY_FIRST_KEYS, ...LEGACY_LAST_KEYS, ...LEGACY_SINGLE_ALIASES].some((key) => text(meta[key]))
    || LEGACY_ARRAY_ALIASES.some((key) => strings(meta[key]).length > 0)
}

/**
 * 节点的有序参考列表（读口唯一）。规范形直接返回 meta.referenceImageUrls；旧数据按「当前方式看得见的在前」归一。
 * mode 传当前方式；不传按首尾帧在前（与旧的搬图函数同一顺序）。
 */
export function readReferenceList(meta: Record<string, unknown> | undefined, mode?: Pick<ArchetypeMode, 'slots'> | null): string[] {
  const list = strings(meta?.[REFERENCE_LIST_KEY])
  if (!meta || !hasLegacyReferenceKeys(meta)) return dedupe(list)
  // 驼峰和 snake 两个首帧键（尾帧同理）都存着、又不是同一张时，第一张按首帧排，另一张不丢——排进后面的旧图里（旧界面从没显示过它）。
  const firsts = dedupe(LEGACY_FIRST_KEYS.map((key) => text(meta[key])))
  const lasts = dedupe(LEGACY_LAST_KEYS.map((key) => text(meta[key])))
  const frames = [...firsts.slice(0, 1), ...lasts.slice(0, 1)]
  const aliases = [
    ...firsts.slice(1), ...lasts.slice(1),
    ...LEGACY_SINGLE_ALIASES.map((key) => text(meta[key])),
    ...LEGACY_ARRAY_ALIASES.flatMap((key) => strings(meta[key])),
  ]
  return dedupe(modeShowsFramesFirst(mode) ? [...frames, ...list, ...aliases] : [...list, ...frames, ...aliases])
}

/** 首帧格是不是「特意空着」（见 FIRST_FRAME_EMPTY_KEY）。旧数据里只存了尾帧、没存首帧，同样算。 */
export function firstFrameLeftEmpty(meta: Record<string, unknown> | undefined): boolean {
  if (!meta) return false
  if (meta[FIRST_FRAME_EMPTY_KEY] === true) return true
  return !LEGACY_FIRST_KEYS.some((key) => text(meta[key])) && LEGACY_LAST_KEYS.some((key) => text(meta[key]))
}

type ModeSlots = Pick<ArchetypeMode, 'slots'>

/**
 * 旧节点「当时那个方式」：节点记着的档案 + modeId（按记着的档案 id 走入口；记着的方式认不出就落档案默认方式）。
 * 档案也认不出（旧档案 id、还没初始化过 archetype 的节点）→ 用调用方给的方式；都没有 → null（不判先放一边）。
 */
function legacySeenMode(meta: Record<string, unknown>, fallback?: ModeSlots | null): ModeSlots | null {
  const stored = meta.archetype && typeof meta.archetype === 'object' ? meta.archetype as { id?: unknown; modeId?: unknown } : null
  // 只看方式的参考槽（各档相同）：按记着的档案 id 走入口，不按 id 直接查表。
  const archetype = typeof stored?.id === 'string' ? resolveModelArchetype({ vendorKey: null, meta: { archetypeId: stored.id } }, { variant: { variantId: undefined, modelId: undefined } }) : null
  if (!archetype) return fallback ?? null
  return archetype.modes.find((mode) => mode.id === stored?.modeId) ?? archetype.modes.find((mode) => mode.id === archetype.defaultModeId) ?? archetype.modes[0] ?? fallback ?? null
}

/** 旧界面在这个方式下看得见的那几张：有首帧槽才显示 firstFrameUrl、有尾帧槽才显示 lastFrameUrl、有参考数组槽才显示 referenceImageUrls。 */
function legacyVisibleUrls(meta: Record<string, unknown>, mode: ModeSlots): Set<string> {
  const has = (kind: ArchetypeReferenceSlotKind) => mode.slots.some((slot) => slot.kind === kind)
  return new Set([
    ...(has('first_frame') && text(meta.firstFrameUrl) ? [text(meta.firstFrameUrl)] : []),
    ...(has('last_frame') && text(meta.lastFrameUrl) ? [text(meta.lastFrameUrl)] : []),
    ...(has('image_ref') ? strings(meta[REFERENCE_LIST_KEY]) : []),
  ])
}

/**
 * 列表里「先放一边」的图（∩ 列表）。规范形节点：读落盘的那一份；旧节点：另加旧界面在当时那个方式下看不见的全部旧图
 * （方式认不出就只认落盘的，不猜）。mode：调用方当前的方式，只在节点没记方式时兜底。
 */
export function readParkedReferences(meta: Record<string, unknown> | undefined, mode?: ModeSlots | null): string[] {
  if (!meta) return []
  const list = new Set(readReferenceList(meta, mode))
  const parked = new Set(strings(meta[PARKED_KEY]))
  if (hasLegacyReferenceKeys(meta)) {
    const seen = legacySeenMode(meta, mode)
    if (seen) {
      const visible = legacyVisibleUrls(meta, seen)
      for (const url of list) if (!visible.has(url)) parked.add(url)
    }
  }
  return [...list].filter((url) => parked.has(url))
}

/**
 * 落槽要的那组输入（参考行 resolveReferencePlacement 与发送 uploadPlacementForMode 都只从这里取，两边分不了家）：
 * 有序列表、首帧是否特意空着、先放一边的图。
 */
export function listPlacementInputs(meta: Record<string, unknown> | undefined, mode: ModeSlots | null | undefined): { list: string[]; firstFrameEmpty: boolean; parked: ReadonlySet<string> } {
  return { list: readReferenceList(meta, mode), firstFrameEmpty: firstFrameLeftEmpty(meta), parked: new Set(readParkedReferences(meta, mode)) }
}

/**
 * 写回规范形：只留这份列表（和首帧是否特意空着、先放一边的图），旧的按槽存的键和它们的影子删掉。返回新 meta（不改入参）。
 * firstFrameEmpty 不传 = 保持原状（旧数据只存尾帧的那种也落成开关）；列表空了开关一并清掉。
 * 先放一边：原来的（旧节点按当时那个方式现算）∩ 新列表，减去 unpark（用户主动放进来 / 点回在用的图）。
 * mode：节点没记方式时，判旧图看不看得见用的兜底方式。
 */
export function withReferenceList(
  meta: Record<string, unknown>,
  list: readonly string[],
  options: { firstFrameEmpty?: boolean; unpark?: readonly string[]; mode?: ModeSlots | null } = {},
): Record<string, unknown> {
  const clean = dedupe(list.map(text))
  const keepGap = (options.firstFrameEmpty ?? firstFrameLeftEmpty(meta)) && clean.length > 0
  const unpark = new Set((options.unpark ?? []).map(text))
  const parked = readParkedReferences(meta, options.mode).filter((url) => clean.includes(url) && !unpark.has(url))
  const next: Record<string, unknown> = { ...meta, [REFERENCE_LIST_KEY]: clean }
  for (const key of [...LEGACY_FIRST_KEYS, ...LEGACY_LAST_KEYS, ...LEGACY_SINGLE_ALIASES, ...LEGACY_ARRAY_ALIASES, ...LEGACY_SHADOW_KEYS]) delete next[key]
  if (keepGap) next[FIRST_FRAME_EMPTY_KEY] = true
  else delete next[FIRST_FRAME_EMPTY_KEY]
  if (parked.length) next[PARKED_KEY] = parked
  else delete next[PARKED_KEY]
  return next
}

/** 旧数据就地落成规范形（读口顺序 = 写回顺序，所以界面上看到的不会因为这一步变；以前藏着的图记进先放一边）。已是规范形返回 null。 */
export function normalizeReferenceListMeta(meta: Record<string, unknown>, mode?: ModeSlots | null): Record<string, unknown> | null {
  return hasLegacyReferenceKeys(meta) ? withReferenceList(meta, readReferenceList(meta, mode), { mode }) : null
}

/** 连线已经占掉的位置：每个槽占几格（按 mode.slots 下标），以及已经由连线放进槽里的地址（上传同一张不重复算）。 */
export type EdgeOccupancy = { countBySlot: readonly number[]; urls: ReadonlySet<string> }

export type UploadPlacement = {
  /** 每个槽（按 mode.slots 下标）落进来的上传图，按列表顺序。非图片槽恒为 []。 */
  bySlot: string[][]
  /** 在列表里、但当前方式放不下（或不收图、或先放一边）的图——界面淡显「未用到」，请求里不许出现。 */
  unused: string[]
  /** unused 里「先放一边」的那几张（旧工程残留）：用户点一下才放回在用。 */
  parked: string[]
}

/**
 * **上传图落槽的唯一规则**：列表按顺序依次落进当前方式里收图的槽（首帧 → 尾帧 → 参考数组，按声明顺序），
 * 每个槽的容量 = 声明上限（首 / 尾帧 1 格）− 连线已占；放不下的进 unused。
 * totalBudget：档案的参考总数上限（maxTotalReferences）扣掉连线与视频 / 音频之后还剩几张图，超出的同样 unused。
 * capOf：渠道只收得下更少时（如中转只有单图位）按槽收窄上限；不传按声明。
 * parked：先放一边的图（旧工程残留，见文件头）——有空位也不落，直接 unused（连线已经把同一张放进槽里的除外）。
 * 纯函数：界面（resolveReferenceSlots）和请求（buildArchetypeInputParams）都只从这里拿结果。
 */
export function placeUploadedImages(
  mode: Pick<ArchetypeMode, 'slots'>,
  uploads: readonly string[],
  occupancy: EdgeOccupancy = { countBySlot: [], urls: new Set() },
  options: { totalBudget?: number; capOf?: (slotIndex: number) => number | undefined; firstFrameEmpty?: boolean; parked?: ReadonlySet<string> } = {},
): UploadPlacement {
  const bySlot: string[][] = mode.slots.map(() => [])
  // 「首帧特意空着」只在首尾帧方式里有意义（见 FIRST_FRAME_EMPTY_KEY）：只有首帧的方式里它不挡首帧。
  const keepFirstEmpty = Boolean(options.firstFrameEmpty) && mode.slots.some((slot) => slot.kind === 'last_frame')
  const remaining = mode.slots.map((slot, index) => {
    if (!isImageUploadSlot(slot.kind)) return 0
    if (slot.kind === 'first_frame' && keepFirstEmpty) return 0
    const declared = slot.max ?? (slot.kind === 'image_ref' ? Number.POSITIVE_INFINITY : 1)
    const cap = Math.min(declared, options.capOf?.(index) ?? Number.POSITIVE_INFINITY)
    return Math.max(0, cap - (occupancy.countBySlot[index] ?? 0))
  })
  let budget = options.totalBudget ?? Number.POSITIVE_INFINITY
  const unused: string[] = []
  const parked: string[] = []
  for (const url of dedupe(uploads.map(text))) {
    if (occupancy.urls.has(url)) continue // 连线已经把同一张放进槽里了：它在用，不重复占位，也不算未用到
    if (options.parked?.has(url)) {
      unused.push(url)
      parked.push(url)
      continue
    }
    const slotIndex = budget > 0 ? remaining.findIndex((left) => left > 0) : -1
    if (slotIndex < 0) {
      unused.push(url)
      continue
    }
    bySlot[slotIndex]!.push(url)
    remaining[slotIndex]! -= 1
    budget -= 1
  }
  return { bySlot, unused, parked }
}

// ── 写：都只改这一份列表（调用方用 withReferenceList 落回 meta）──────────────────────────────

/** 删一张（× 掉上传的图）。 */
export function removeFromReferenceList(list: readonly string[], url: string): string[] {
  return list.filter((item) => item !== url)
}

/**
 * 往某个槽放一张上传图（首帧 / 尾帧格子里点上传、从素材库选）。uploadsBySlot = 现在每个槽里落着的上传图（按 mode.slots 下标）。
 * 槽里已有上传图 → 原位换掉；槽空着 → 插在前面几个槽已落的图之后，让它落进下一个空槽。
 * 同一张图原来在列表别处 → 挪过来，不重复。
 * 已知简化：前面的槽也空着时（如首帧空、往尾帧放），新图按列表顺序先落前面的槽——列表没有「空位」。
 */
export function putInReferenceSlot(list: readonly string[], uploadsBySlot: readonly (readonly string[])[], slotIndex: number, url: string): string[] {
  const without = list.filter((item) => item !== url)
  const current = uploadsBySlot[slotIndex]?.[0]
  if (current && current !== url) {
    const at = without.indexOf(current)
    if (at >= 0) return [...without.slice(0, at), url, ...without.slice(at + 1)]
  }
  if (current === url) return [...list]
  const before = uploadsBySlot.slice(0, slotIndex).flat().filter((item) => item !== url)
  const after = before.length ? without.indexOf(before[before.length - 1]!) + 1 : 0
  return [...without.slice(0, after), url, ...without.slice(after)]
}

/** 首尾帧对调：两张都是上传图时，在列表里对调它们的位置。 */
export function swapInReferenceList(list: readonly string[], a: string, b: string): string[] {
  const ia = list.indexOf(a)
  const ib = list.indexOf(b)
  if (ia < 0 || ib < 0) return [...list]
  const next = [...list]
  next[ia] = b
  next[ib] = a
  return next
}

/**
 * 合并式写入用的补丁（调用方 `Object.assign(meta, patch)` / `{ ...meta, ...patch }`）：写列表，旧的按槽存的键置 undefined。
 * 这份列表是调用方（分镜绑定）整份给的、都是用户放的图：先放一边一并清掉。能拿到整份 meta 时优先用 withReferenceList（直接删键）。
 */
export function referenceListPatch(list: readonly string[], options: { firstFrameEmpty?: boolean } = {}): Record<string, unknown> {
  const clean = dedupe(list.map(text))
  const patch: Record<string, unknown> = { [REFERENCE_LIST_KEY]: clean, [FIRST_FRAME_EMPTY_KEY]: options.firstFrameEmpty && clean.length ? true : undefined, [PARKED_KEY]: undefined }
  for (const key of [...LEGACY_FIRST_KEYS, ...LEGACY_LAST_KEYS, ...LEGACY_SINGLE_ALIASES, ...LEGACY_ARRAY_ALIASES, ...LEGACY_SHADOW_KEYS]) patch[key] = undefined
  return patch
}
