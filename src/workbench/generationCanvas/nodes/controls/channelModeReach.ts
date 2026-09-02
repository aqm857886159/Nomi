// 「档案声明的能力」×「这条渠道真发得出的键」——**渲染层的收窄判据**（模式级 + 槽级）。
//
// 为什么单独一个模块：archetypeMeta 管的是「档案 → UI 形状」的映射（模式/槽/参数怎么长、meta 怎么读写），
// 与供应商无关；本模块管的是「这家到底发不发得出」，是**档案 × mapping** 的对账。两件事的输入不同、
// 变更理由也不同（前者跟着档案走，后者跟着渠道 mapping 走），混在一个文件里迟早互相牵连。
//
// 判据本身**一律复用** electron/catalog/referenceReachability（modeSlotReach / SlotReach）——那是 UI 收窄
// 与第三闸（生成时拒发）共用的唯一尺子。这里只做「模式级」与「按存储键索引」两层包装，绝不另写一份可达性
// 判断：UI 说能发、闸门判发不出，正是本仓反复在修的那类病。
//
// modeSlotReach/SlotReach 从 archetypeMeta **转**进来而不是本文件直连 electron/：`src-no-import-electron`
// 是棘轮门岗，archetypeMeta 那条越界已登记在基线里，新开文件直连会被判成新增违规（基线只减不增）。
import type { ArchetypeMode, ModelArchetype } from '../../../../config/modelArchetypes'
import {
  currentArchetypeMode,
  modeSlotReach,
  referenceSlotStorage,
  type SlotReach,
} from './archetypeMeta'
import { translateModelDisplayText } from '../../../../i18n/modelDisplayText'

/**
 * 一个模式在**这条渠道**上的 create body 查询结果。
 * - `body`：查到了 mapping（body 可以是任何 JSON）。
 * - `null`：**桶已知、但这个模式没有属于自己的 mapping**（U1 之后 selectTaskMapping 不再借别的模式的
 *   线缆，取不到就是真取不到）→ 判据 (a)，该模式在这家发不出去。
 * - `undefined`：**查不出来**（老 preload / 拿不到 bridge / 未知 vendor / 自建中转）→ **fail-open**，
 *   一律不收窄。绝不因为查不到就藏用户的模式，与槽级收窄同一条纪律。
 */
export type ModeChannelBody = { body: unknown } | null | undefined

/**
 * **模式栏收窄的唯一判据**（U4）——这个模式在这条渠道上到底立不立得住。
 *
 * 为什么模式也要收窄：模式**名字本身就是承诺**。模式栏上出现「多图参考」，用户读到的是「这个模型经这家
 * 能吃多张参考图」；这家其实发不出去，就是撒谎——而且要等到点了生成才被第三闸拒。
 *
 * 判据（隐藏当且仅当满足其一）：
 * - (a) 桶已知但这个模式**没有自己的 mapping**（bodyResult === null）；
 * - (b) 声明了参考槽、且**全部** reach = `none`（= `modeIsUsable` 为假）。
 *
 * 永不隐藏：无槽的纯文生模式；以及 `undefined`（查不到 body）时的任何模式。
 *
 * **为什么没有「多图塌成单图就隐藏」这一条**（曾经写过，实测后删掉——记在这里防止有人再加回来）：
 * 初版判据里有第三条「声明 max>1 却只拿到单图聚合位 → 隐藏」，理由是「多图参考只能放 1 张 = 名不副实且
 * 与 i2v 重复」。全仓实测后它只命中一个目标：`runway/grok_imagine_1_5/i2v`——Runway 的 Grok **确实支持**
 * 图生视频，只是一次一张；档案声明 max=7 是 apimart 那条线的容量。按这条判据它会被隐藏，等于**删掉一个
 * 真能用的功能**。真正名不副实的那些（happyhorse 的多图参考等）在 U1/U3 之后都落进判据 (a)：它们压根
 * 没有自己的 mapping。所以「承载力缩水」是**槽级**的事——槽如实收成 1 张即可（NodeParameterControls 已在
 * 做），不是模式级的隐藏理由。
 *
 * 判据复用 `modeSlotReach` / `modeIsUsable`（electron/catalog/referenceReachability）——与第三闸、与槽级
 * 徽标**同一把尺子**。这里绝不另写一份可达性判断：UI 说能发、闸门判发不出，正是本仓反复在修的那类病。
 */
export function archetypeModeIsVisible(mode: ArchetypeMode, bodyResult: ModeChannelBody): boolean {
  if (bodyResult === undefined) return true // fail-open：查不到 body 一律不收窄。
  if (bodyResult === null) return false // (a) 桶已知却没有本模式的线缆 = 这家发不出这个模式。
  if (mode.slots.length === 0) return true // 纯文生模式永不隐藏。
  const reach = modeSlotReach(mode.slots, bodyResult.body, mode.combineSlotsInto?.key)
  return !reach.every((r) => r === 'none') // (b) 声明了槽却一个都发不出。
}

export type ArchetypeModeChoice = { id: string; vendorTerm: string; hint: string }

/**
 * 模式分段切换的选项（标签 = 模型自己的真名 vendorTerm；仅当 >1 模式时 UI 才显示该段）。
 *
 * `bodyForMode` 给出「该模式在这条渠道上的 create body」时，按 `archetypeModeIsVisible` 收窄——档案声明的
 * 模式集是**供应商无关**的（同一模型走哪家都是这套模式），能不能发得出去却由这家的 mapping 决定。不传
 * （或对某模式返回 `undefined`）= 查不到 = 不收窄。
 */
export function archetypeModeChoices(
  archetype: ModelArchetype,
  bodyForMode?: (mode: ArchetypeMode) => ModeChannelBody,
): ArchetypeModeChoice[] {
  return archetype.modes
    .filter((mode) => (bodyForMode ? archetypeModeIsVisible(mode, bodyForMode(mode)) : true))
    .map((mode) => ({
      id: mode.id,
      vendorTerm: translateModelDisplayText(mode.vendorTerm),
      hint: translateModelDisplayText(mode.hint),
    }))
}

/**
 * 当前模式各槽在**这条渠道**上的真实承载力，按 assetSlots 用的存储键索引。
 *
 * 判据来自 electron/catalog/referenceReachability——与第三闸**同一套计算**，不另起一份（UI 说能发、
 * 闸门判发不出，正是本轮反复在修的病）。createBody = 这条 mapping 的 create.body；拿不到时上层
 * 一律按「不收窄」处理，绝不因为查不到就把用户的槽藏掉。
 */
export function archetypeModeSlotReachByKey(mode: ArchetypeMode, createBody: unknown): Record<string, SlotReach> {
  const reach = modeSlotReach(mode.slots, createBody, mode.combineSlotsInto?.key)
  const out: Record<string, SlotReach> = {}
  mode.slots.forEach((slot, index) => {
    // 槽 → 存储键走 archetypeMeta 导出的 referenceSlotStorage（「槽→存储键」的**单一真相源**），
    // 不在这里照抄一份 FRAME_SLOT_FLAT/ARRAY_SLOT_ROUTE 映射表——抄一份就是第二处要同步的真相。
    const key = referenceSlotStorage(slot)?.metaKey
    if (key) out[key] = reach[index]
  })
  return out
}

/**
 * **模式收窄后的选择安全**（U4）：当前选中的模式被这条渠道收窄掉时，该落到哪个模式。
 *
 * 为什么必须有：收窄只改「模式栏显示哪几个」，不改 `meta.archetype.modeId`。存量节点（或换了供应商的
 * 节点）可能钉在一个已经不显示的模式上——那时模式栏一个都不高亮，而发送路径仍按那个看不见的模式投影槽，
 * UI 与发送再次分家。返回 `null` = 当前选中仍可见（幂等，调用方不写）。
 *
 * 落点顺序：档案的 `defaultModeId`（若它可见）→ 第一个可见模式。**一个可见的都没有时返回 null**——
 * 那说明判据把整个模型判死了，此时收窄本身已不可信，宁可原样留着（fail-open），也不把节点钉到某个
 * 同样发不出去的模式上。
 */
export function fallbackVisibleModeId(
  archetype: ModelArchetype,
  meta: Record<string, unknown> | undefined,
  visibleModeIds: readonly string[],
): string | null {
  if (visibleModeIds.length === 0) return null
  const current = currentArchetypeMode(archetype, meta)
  if (visibleModeIds.includes(current.id)) return null
  const preferred = visibleModeIds.includes(archetype.defaultModeId) ? archetype.defaultModeId : visibleModeIds[0]
  return preferred === current.id ? null : preferred
}
