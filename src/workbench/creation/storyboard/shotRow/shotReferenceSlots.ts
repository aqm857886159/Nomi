import type { AssetSlot } from '../../../assets/AssetReference'
import type { AssetKind } from '../../../assets/assetTypes'
import type { ArchetypeMode, ArchetypeReferenceSlot } from '../../../../config/modelArchetypes/types'
import type { PlanReferenceBinding, PlanShot } from '../../../generationCanvas/agent/storyboardPlan'
import {
  referenceSlotAccept,
  referenceSlotIsArray,
  referenceSlotStorage,
} from '../../../generationCanvas/nodes/controls/archetypeMeta'
import { translateModelDisplayText } from '../../../../i18n/modelDisplayText'

/**
 * 分镜行的**按槽参考绑定**层（纯函数，可单测）。
 *
 * 为什么存在：行里以前只有 `shot.anchorIds` 这一个无类型关系袋，表达不了「这张放首帧、那段放参考视频」——
 * 于是具名槽（首/尾帧、源视频）永远填不进去、数组槽（30 图 / 10 视频 / 10 音频）被压成一个匿名「@」格。
 * 这一层把**档案声明**（kind / min / max / asArray / characterIndexed）翻译成画布节点那套已验证的
 * `AssetSlot` 描述符（P1：复用 AssetReference / AssetTile / AssetPicker，不另造一套参考槽 UI），
 * 并把绑定值投影进节点 meta（P4：请求体仍由 `buildArchetypeInputParams` 按 `inputKey`/`asArray` 构造，
 * 分镜侧不写任何供应商分支）。
 *
 * 键的选择：用 **slot.kind**（而不是 inputKey）。kind 是跨供应商稳定的语义身份；inputKey 是传输细节，
 * 同一语义槽换供应商就会变，拿它当持久化键 = 换个中转就全部丢绑定。
 */

/** 该 mode 的所有声明槽 → 画布同款 AssetSlot 描述符（顺序 = 档案声明顺序）。 */
export function storyboardAssetSlots(mode: ArchetypeMode | null | undefined): AssetSlot[] {
  if (!mode) return []
  return mode.slots.map((slot): AssetSlot => ({
    key: slot.kind,
    label: translateModelDisplayText(slot.label),
    accept: referenceSlotAccept(slot.kind),
    form: referenceSlotIsArray(slot) ? 'array' : 'single',
    // 分镜行没有画布边（行是 plan 上的编辑态，节点可能还没建）→ 一律存 plan、落画布时投影进 meta。
    persistAsEdge: false,
    numbered: Boolean(slot.characterIndexed),
    ...(slot.max !== undefined ? { max: slot.max } : {}),
  }))
}

/** 某槽当前的有序绑定（未知/缺省 → 空）。 */
export function shotBindingsOf(shot: PlanShot, slotKey: string): PlanReferenceBinding[] {
  const bucket = shot.referenceBindings?.[slotKey]
  return Array.isArray(bucket) ? bucket.filter((item) => Boolean(item?.url)) : []
}

/** AssetReference 的 valuesByKey：单槽 → url 串（空串=空），数组槽 → url 列表。 */
export function shotBindingValues(mode: ArchetypeMode | null | undefined, shot: PlanShot): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const slot of mode?.slots ?? []) {
    const urls = shotBindingsOf(shot, slot.kind).map((binding) => binding.url)
    out[slot.kind] = referenceSlotIsArray(slot) ? urls : urls[0] ?? ''
  }
  return out
}

export type ShotBindingAppend =
  | { status: 'added'; patch: Pick<PlanShot, 'referenceBindings'> }
  | { status: 'wrong-kind'; accept: 'image' | 'video' | 'audio' }
  | { status: 'duplicate' }
  | { status: 'full'; max: number }

/** 写回一个 bucket（保留未知键：只覆盖这一个槽，别的原样带过去）。 */
function withBucket(shot: PlanShot, slotKey: string, next: PlanReferenceBinding[]): Pick<PlanShot, 'referenceBindings'> {
  return { referenceBindings: { ...(shot.referenceBindings ?? {}), [slotKey]: next } }
}

/**
 * 往槽里加一条绑定。三条拒绝各有其人话理由：
 * - `wrong-kind`：视频槽拒图片、图片槽拒视频（判据是 `referenceSlotAccept`，单源）；
 * - `duplicate`：同一 url 已在该槽（重复发送只是白烧钱）；
 * - `full`：到声明上限（`max` 缺省 = 供应商没公布上限 → 不拦）。
 * 单槽（asArray=false）语义是**替换**，不是「满了」——首帧就一张，再选一张就是换掉它。
 */
export function appendShotBinding(
  shot: PlanShot,
  slot: ArchetypeReferenceSlot,
  binding: PlanReferenceBinding,
  bindingKind: AssetKind,
): ShotBindingAppend {
  const accept = referenceSlotAccept(slot.kind)
  if (bindingKind !== accept) return { status: 'wrong-kind', accept }
  const url = binding.url.trim()
  if (!url) return { status: 'duplicate' }
  const current = shotBindingsOf(shot, slot.kind)
  if (!referenceSlotIsArray(slot)) {
    return { status: 'added', patch: withBucket(shot, slot.kind, [{ ...binding, url }]) }
  }
  if (current.some((item) => item.url === url)) return { status: 'duplicate' }
  if (slot.max !== undefined && current.length >= slot.max) return { status: 'full', max: slot.max }
  return { status: 'added', patch: withBucket(shot, slot.kind, [...current, { ...binding, url }]) }
}

/** 删一条（index 越界 → 原样不动，返回 null 让调用方跳过写入）。 */
export function removeShotBinding(shot: PlanShot, slotKey: string, index: number): Pick<PlanShot, 'referenceBindings'> | null {
  const current = shotBindingsOf(shot, slotKey)
  if (index < 0 || index >= current.length) return null
  return withBucket(shot, slotKey, current.filter((_, position) => position !== index))
}

/** 同槽内重排（characterIndexed 槽的 ①②③ = 发送顺序，所以顺序是语义不是装饰）。 */
export function reorderShotBinding(
  shot: PlanShot,
  slotKey: string,
  from: number,
  to: number,
): Pick<PlanShot, 'referenceBindings'> | null {
  const current = shotBindingsOf(shot, slotKey)
  if (from === to || from < 0 || to < 0 || from >= current.length || to >= current.length) return null
  const next = [...current]
  const [moved] = next.splice(from, 1)
  if (!moved) return null
  next.splice(to, 0, moved)
  return withBucket(shot, slotKey, next)
}

/**
 * 绑定 → 节点 meta 的投影（落画布/跑之前的唯一写入点）。存储键取自 `referenceSlotStorage`——
 * 与画布节点同一张表，于是 `buildArchetypeInputParams` 原封不动地按 `inputKey`/`asArray` 构造请求体。
 * 只投影**当前 mode 声明的槽**，且**空绑定也写空值**——否则用户刚删掉的首帧还留在 meta 里被发出去。
 */
export function shotReferenceMetaPatch(
  mode: ArchetypeMode | null | undefined,
  shot: PlanShot,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const slot of mode?.slots ?? []) {
    const storage = referenceSlotStorage(slot)
    if (!storage) continue
    const urls = shotBindingsOf(shot, slot.kind).map((binding) => binding.url)
    patch[storage.metaKey] = storage.isArray ? urls : urls[0] ?? ''
  }
  return patch
}
