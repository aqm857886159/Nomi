// 视频节点底栏「方式」一格的菜单：列哪几行、每行叫什么、哪行能点、每行下面那句小字（纯函数，档案算出来）。
//
// 能不能点只有一个判据：选了它，唯一 owner modeForInputs 真的会按它发（放得下这次全部输入）。所以菜单里能点的
// 永远就是点了会生效的，点了不生效的一律置灰并写原因、报数（设计卡「11-12 改向」③）。
// 名字按方式的**槽能力**推，不按意图词猜（Veo 3.1 的 single 意图其实是多图参考）；认不出的用档案真名。
import type { ArchetypeMode, ArchetypeReferenceSlotKind, ModelArchetype } from '../../../../../electron/shared/modelArchetypes'
import { modeForInputs, modeRelayedCount, modeTakenCount, type ModeInput } from '../../../../../electron/shared/modelArchetypes/modeForInputs'
import { SLOT_ACCEPTS, type ReferenceAssetKind } from '../../../../../electron/shared/modelArchetypes/anchorPolicy'
import { zhGenerationCommon } from '../../../../i18n/locales/generationCommon'

export type ModeDisplayKind = 'text' | 'image' | 'firstLast' | 'reference' | 'other'

/** 一句要翻译的话：key + 值；list 是要按「、 / 或」拼起来塞进 values.list 的几小段。 */
export type ModeMenuText = {
  key: string
  values?: Record<string, string | number>
  list?: { items: ModeMenuText[]; joiner: 'and' | 'or' }
  /** 塞进 values.name 的方式名（统一叫法的 key，或档案真名）。 */
  name?: ModeMenuText | string
}

export type ModeMenuRow = {
  id: string
  /** 这一行是哪一类（定图标）；撞名时类不变、名字改用档案真名。 */
  kind: ModeDisplayKind
  /** 有它就用它当名字：kind 是 other，或两个方式归成同一类（撞名）时的档案真名（已翻译过的 vendorTerm）；否则按 kind 取统一叫法。 */
  vendorTerm?: string
  disabled: boolean
  description: ModeMenuText
}

export type ModeMenuModel = { rows: ModeMenuRow[]; activeId: string }

const KEY = 'generationCommon.modeMenu'
const ARRAY_SLOT_KINDS: ReadonlySet<ArchetypeReferenceSlotKind> = new Set(['image_ref', 'video_ref', 'audio_ref'])
const ASSET_ORDER: readonly ReferenceAssetKind[] = ['image', 'video', 'audio']

function capacity(slot: ArchetypeMode['slots'][number]): number {
  return slot.max ?? (ARRAY_SLOT_KINDS.has(slot.kind) ? Number.POSITIVE_INFINITY : 1)
}

function slotOf(mode: ArchetypeMode, kind: ArchetypeReferenceSlotKind) {
  return mode.slots.find((slot) => slot.kind === kind)
}

/** 档案里有没有一个「只有首帧」的方式（有它，可灵 4.0 那种「首帧 + 尾帧可不填」才叫首尾帧；没有它就叫图生视频）。 */
function hasPureFirstFrameMode(archetype: ModelArchetype): boolean {
  return archetype.modes.some((mode) => {
    const kinds = new Set(mode.slots.map((slot) => slot.kind))
    if (kinds.has('first_frame') && !kinds.has('last_frame') && !kinds.has('source_video')) return true
    const ref = slotOf(mode, 'image_ref')
    return Boolean(ref) && mode.slots.length === 1 && capacity(ref!) === 1
  })
}

/** 这个方式在全产品叫什么（文生视频 / 图生视频 / 首尾帧 / 全能参考；认不出 = other，用档案真名）。 */
export function modeDisplayKind(archetype: ModelArchetype, mode: ArchetypeMode): ModeDisplayKind {
  const kinds = new Set(mode.slots.map((slot) => slot.kind))
  if (mode.slots.length === 0) return 'text'
  if (kinds.has('source_video')) return 'other'
  const last = slotOf(mode, 'last_frame')
  if (kinds.has('first_frame') && last) {
    if (last.min > 0) return 'firstLast'
    return hasPureFirstFrameMode(archetype) ? 'firstLast' : 'image'
  }
  if (kinds.has('first_frame') && mode.slots.every((slot) => slot.kind === 'first_frame')) return 'image'
  const ref = slotOf(mode, 'image_ref')
  // 只收图的单格：1 张，或 2 张且是首帧 / 首尾帧意图（可灵 3.0 的 image_ref[0] 当开头、[1] 当结尾）→ 图生视频。
  if (ref && mode.slots.length === 1 && (capacity(ref) === 1 || (capacity(ref) === 2 && ['single', 'firstlast'].includes(String(mode.intent))))) return 'image'
  if (kinds.has('image_ref') || kinds.has('video_ref') || kinds.has('audio_ref')) return 'reference'
  return 'other'
}

/** 每种素材这个方式最多收几件（Infinity = 档案没写上限）；不收的不出现。 */
function assetCapacities(mode: ArchetypeMode): Map<ReferenceAssetKind, number> {
  const caps = new Map<ReferenceAssetKind, number>()
  for (const slot of mode.slots) {
    // 首帧格也收视频（视频接力抽首帧），但对人说「放图」：按格子的主素材算。
    const asset: ReferenceAssetKind = slot.kind === 'video_ref' || slot.kind === 'source_video' ? 'video' : slot.kind === 'audio_ref' ? 'audio' : 'image'
    caps.set(asset, (caps.get(asset) ?? 0) + capacity(slot))
  }
  if (mode.maxTotalReferences !== undefined) for (const [asset, cap] of caps) caps.set(asset, Math.min(cap, mode.maxTotalReferences))
  return caps
}

function minImages(mode: ArchetypeMode): number {
  return mode.slots.filter((slot) => SLOT_ACCEPTS[slot.kind].includes('image')).reduce((sum, slot) => sum + slot.min, 0)
}

function limitItem(asset: ReferenceAssetKind, cap: number): ModeMenuText {
  const noun = asset === 'image' ? 'Images' : asset === 'video' ? 'Videos' : 'Audios'
  return Number.isFinite(cap) ? { key: `${KEY}.limit${noun}`, values: { count: cap } } : { key: `${KEY}.kind${noun}` }
}

/** 能点的那行写它要什么、上限多少。 */
function enabledDescription(kind: ModeDisplayKind, mode: ArchetypeMode): ModeMenuText {
  if (mode.slots.length === 0) return { key: `${KEY}.textOnly` }
  const last = slotOf(mode, 'last_frame')
  if (kind === 'image' && (last || (assetCapacities(mode).get('image') ?? 1) >= 2)) return { key: `${KEY}.startOptionalEnd` }
  if (kind === 'image') return { key: `${KEY}.oneStart` }
  if (kind === 'firstLast') return { key: last && last.min > 0 ? `${KEY}.startAndEnd` : `${KEY}.startOptionalEnd` }
  const caps = assetCapacities(mode)
  const items = ASSET_ORDER.filter((asset) => caps.has(asset)).map((asset) => limitItem(asset, caps.get(asset)!))
  const allFinite = ASSET_ORDER.every((asset) => !caps.has(asset) || Number.isFinite(caps.get(asset)!))
  return { key: allFinite ? `${KEY}.upTo` : `${KEY}.takes`, list: { items, joiner: 'and' } }
}

/** 还没放东西时，带图那几行写「先放什么」。 */
function emptyDescription(kind: ModeDisplayKind, mode: ArchetypeMode): ModeMenuText {
  const caps = assetCapacities(mode)
  if (kind === 'image' || kind === 'firstLast') {
    const need = Math.max(1, minImages(mode))
    const most = caps.get('image') ?? need
    return need === most || !Number.isFinite(most) ? { key: `${KEY}.needImages`, values: { count: need } } : { key: `${KEY}.needImagesRange`, values: { min: need, max: most } }
  }
  const nouns = ASSET_ORDER.filter((asset) => caps.has(asset)).map((asset): ModeMenuText => ({ key: `${KEY}.kind${asset === 'image' ? 'Images' : asset === 'video' ? 'Videos' : 'Audios'}` }))
  return { key: `${KEY}.needKinds`, list: { items: nouns, joiner: 'or' } }
}

/** 放了东西却点不了的那行：写原因、报数。 */
function blockedDescription(mode: ArchetypeMode, inputs: readonly ModeInput[], firstFrameEmpty: boolean, name: ModeMenuText | string): ModeMenuText {
  const count = inputs.length
  const unit = inputs.every((input) => input.asset === 'image') ? 'Images' : 'Items'
  if (mode.slots.length === 0) return { key: `${KEY}.textTakesNone${unit}`, values: { count } }
  // 只能把参考视频当接力首帧的，那段视频按「用不上」数（owner 不让偏好这样收，见 modeForInputs ②）。
  const taken = modeTakenCount(mode, inputs, { firstFrameEmpty }) - modeRelayedCount(mode, inputs, { firstFrameEmpty })
  if (taken < count) {
    if (taken === 0) return { key: `${KEY}.takesNone${unit}`, values: { count } }
    if (taken === 1) return { key: `${KEY}.takesOne${unit}`, values: { count }, name }
    return { key: `${KEY}.takesUpTo${unit}`, values: { count, taken }, name }
  }
  const missing = Math.max(1, mode.slots.reduce((sum, slot) => sum + slot.min, 0) - taken)
  return { key: `${KEY}.needsMore`, values: { count: missing } }
}

/**
 * 视频节点方式格的菜单。visible：按渠道可达性收窄过的方式（archetypeModeChoices），只列模型真有、这家发得出的。
 * resolvedModeId：唯一 owner 这次现算出的方式（方式格显示它、带勾的是它）。少于两行 → null（不显示方式格）。
 */
export function buildModeMenu(args: {
  /** 只有视频节点有方式格；图片节点放了图就是按图改（⑨），声音 / 3D 用它们自己的模式栏。 */
  nodeKind: 'video' | 'other'
  archetype: ModelArchetype
  visible: readonly { id: string; vendorTerm: string }[]
  inputs: readonly ModeInput[]
  firstFrameEmpty?: boolean
  resolvedModeId: string
}): ModeMenuModel | null {
  const { archetype, inputs } = args
  if (args.nodeKind !== 'video') return null
  const firstFrameEmpty = Boolean(args.firstFrameEmpty)
  const visibleIds = new Set(args.visible.map((choice) => choice.id))
  const listed = archetype.modes.filter((mode) => visibleIds.has(mode.id) || mode.id === args.resolvedModeId)
  if (listed.length < 2) return null
  const shapes = listed.map((mode) => modeDisplayKind(archetype, mode))
  const named = resolveClashes(listed, shapes)
  const termOf = (mode: ArchetypeMode) => args.visible.find((choice) => choice.id === mode.id)?.vendorTerm ?? mode.vendorTerm
  const rows = listed.map((mode, index): ModeMenuRow => {
    // 小字按槽形状说（shape）；名字和图标按撞名消解之后的类（kind）。
    const shape = shapes[index]!
    const { kind, clash } = named[index]!
    const takesEffect = modeForInputs(archetype, inputs, { modeId: mode.id, chosenBy: 'human' }, { firstFrameEmpty }).mode.id === mode.id
    const name: ModeMenuText | string = clash || kind === 'other' ? termOf(mode) : { key: modeKindNameKey(kind) }
    const description = takesEffect
      ? enabledDescription(shape, mode)
      : inputs.length === 0 ? emptyDescription(shape, mode) : blockedDescription(mode, inputs, firstFrameEmpty, name)
    return {
      id: mode.id,
      kind,
      ...(clash || kind === 'other' ? { vendorTerm: termOf(mode) } : {}),
      disabled: !takesEffect,
      description,
    }
  })
  return { rows, activeId: args.resolvedModeId }
}

/** 档案真名（档案按中文原文写）正好是四个统一叫法之一 → 对应的类。 */
const KIND_BY_ARCHETYPE_TERM = new Map(
  (Object.entries(zhGenerationCommon.modeMenu.name) as [Exclude<ModeDisplayKind, 'other'>, string][]).map(([kind, term]) => [term, kind]),
)

/**
 * 两个方式按槽形状归成同一类（会撞名）时怎么叫：档案真名正好是四个统一叫法之一、又不是这一类的，按真名归过去
 * （2026-11-12 真 App 复现：APIMart Seedance 2.0 的「图生视频」1–9 张单格和「全能参考」都按形状归成全能参考，
 * 首尾帧尾帧可不放又按形状叫成图生视频——菜单里两行都叫「图生视频」、两行没图标。按真名归回图生视频 / 全能参考 / 首尾帧）；
 * 归不过去、还撞着的，名字用档案真名，类（图标）不变。每一轮至少有一行定下来，轮数不超过行数。
 */
function resolveClashes(listed: readonly ArchetypeMode[], shapes: readonly ModeDisplayKind[]): { kind: ModeDisplayKind; clash: boolean }[] {
  const rows = listed.map((mode, index) => ({ mode, kind: shapes[index]!, clash: false }))
  for (let round = 0; round < rows.length; round += 1) {
    const crowded = rows.filter((row) => !row.clash && row.kind !== 'other' && rows.some((other) => other !== row && !other.clash && other.kind === row.kind))
    if (!crowded.length) break
    const moved = crowded.filter((row) => {
      const byTerm = KIND_BY_ARCHETYPE_TERM.get(row.mode.vendorTerm)
      if (!byTerm || byTerm === row.kind) return false
      row.kind = byTerm
      return true
    })
    if (moved.length) continue
    for (const row of crowded) row.clash = true
  }
  return rows.map(({ kind, clash }) => ({ kind, clash }))
}

/** 全产品四个统一叫法的 i18n key（方式格、菜单、行尾「已改成…」、空节点快捷入口共用）。 */
export function modeKindNameKey(kind: Exclude<ModeDisplayKind, 'other'>): string {
  return `${KEY}.name.${kind}`
}

/** 把 ModeMenuText 翻成一句话（宿主壳只传 t）。 */
export function renderModeMenuText(t: (key: string, values?: Record<string, unknown>) => string, text: ModeMenuText): string {
  const name = text.name === undefined ? {} : { name: typeof text.name === 'string' ? text.name : renderModeMenuText(t, text.name) }
  if (!text.list) return t(text.key, { ...text.values, ...name })
  const parts = text.list.items.map((item) => renderModeMenuText(t, item))
  const separator = t('generationCommon.modeMenu.listSeparator')
  const joined = parts.length <= 1 || text.list.joiner === 'and'
    ? parts.join(separator)
    : `${parts.slice(0, -1).join(separator)}${t('generationCommon.modeMenu.listOr')}${parts[parts.length - 1]}`
  return t(text.key, { ...text.values, ...name, list: joined })
}

/** 一行的显示名。 */
export function modeRowName(t: (key: string, values?: Record<string, unknown>) => string, row: Pick<ModeMenuRow, 'kind' | 'vendorTerm'>): string {
  if (row.vendorTerm !== undefined) return row.vendorTerm
  return row.kind === 'other' ? '' : t(modeKindNameKey(row.kind))
}
