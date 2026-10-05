import type { GenerationCanvasNode } from '../../../generationCanvas/model/generationCanvasTypes'
import { nodeShotField, overriddenShotFields } from '../../../generationCanvas/model/storyboardOverrides'
import type { ModelOption } from '../../../../config/models'
import { resolveArchetypeForModel } from '../../../../../electron/shared/modelArchetypes'
import type { ArchetypeMode, ArchetypeReferenceSlot, ModelArchetype } from '../../../../../electron/shared/modelArchetypes/types'
import type { PlanAnchor, PlanShot } from '../../../generationCanvas/agent/storyboardPlan'
import { defaultCarrierForKind } from '../../../generationCanvas/agent/storyboardPlanEdits'
import { slotAsArray } from '../../../generationCanvas/nodes/controls/archetypeMeta'
import { firstFrameEdgeSlot } from '../../../generationCanvas/runner/referenceSlots'
import { bindingsOf, type ReferenceBindingMap } from './shotReferenceSlots'

/**
 * 分镜行的**纯 derive 层**（v5 表形态）：画面格红态与参考区三形态都从「该行模型的档案 mode」
 * 推出来，与渲染解耦、可单测。storyboardPlanEdits 管 plan 的编辑，这里管「plan × 模型档案」的
 * 只读投影——档案是另一个真相源（P4 通用第一：按 slot 声明渲染，不为具体模型写 if）。
 */

/** 解析该镜当前生效的档案 mode（modeId 缺省 → 档案默认 mode）。无模型/无档案 → null。 */
export function resolveShotArchetypeMode(
  modelOption: ModelOption | null | undefined,
  modeId: string | undefined,
): { archetype: ModelArchetype; mode: ArchetypeMode } | null {
  if (!modelOption) return null
  const archetype = resolveArchetypeForModel({
    modelKey: modelOption.modelKey || modelOption.value,
    modelAlias: modelOption.modelAlias,
    vendorKey: modelOption.vendor,
    meta: modelOption.meta,
  })
  if (!archetype) return null
  const modes = archetype.modes
  const mode = modes.find((m) => m.id === modeId) ?? modes.find((m) => m.id === archetype.defaultModeId) ?? modes[0]
  if (!mode) return null
  return { archetype, mode }
}

/** 这一行参考列里摆着的绑定，是不是来自这张锚（binding.anchorId）。「引用」只有这一种读法：看得见的绑定。 */
export function shotBindsAnchor(shot: PlanShot, anchorId: string): boolean {
  return Object.values(shot.referenceBindings ?? {}).some((bindings) => Array.isArray(bindings) && bindings.some((binding) => binding?.anchorId === anchorId && Boolean(binding.url)))
}

/**
 * 该镜引用的视觉锚 = 行上参考列里真摆着的、来自某张锚的绑定。
 * 以前读的是 shot.anchorIds——那个关系发出去时会被展开成看不见的追加与参考边（「巨龙」变人物的成因）；
 * 现在 anchorIds 不产生任何作用，等待 / 锁定 / 参考已变这些行状态只认看得见的绑定。
 */
export function referencedVisualAnchors(shot: PlanShot, anchors: readonly PlanAnchor[]): PlanAnchor[] {
  return anchors.filter((anchor) => (anchor.carrier ?? defaultCarrierForKind(anchor.kind)) === 'visual' && shotBindsAnchor(shot, anchor.id))
}

/**
 * 这一镜「计划中的首帧」在生成时落进本模式的哪个槽；没开首帧 / 图片镜 / 本模式收不下 → null。
 *
 * 开了首帧的视频镜落画布是「首帧图节点 —first_frame 边→ 视频节点」（storyboardPlan.buildShotRowNodes），
 * 所以这里问的就是「一条首帧边落哪个槽」——判据归 `firstFrameEdgeSlot`（画布参考槽显示与容量判断同一条），
 * 不在分镜侧再写一份。首帧槽优先，没有就是 image_ref[0]（APIMart Seedance 2.0、Kling、Wan 的图生视频）。
 */
export function plannedFirstFrameSlot(
  mode: ArchetypeMode | null | undefined,
  shot: PlanShot,
): ArchetypeReferenceSlot | null {
  if (!mode || shot.shotKind === 'image' || shot.keyframe?.enabled !== true) return null
  return firstFrameEdgeSlot(mode.slots)
}

/** 除绑定之外，生成时还会往槽里放东西的两条来源。 */
export type RequiredSlotCredits = {
  /** 计划首帧落的槽（`plannedFirstFrameSlot`）；无 → null。 */
  plannedFirstFrame: ArchetypeReferenceSlot | null
}

/**
 * **缺必填参考**的槽——行状态（画面格「缺X参考」、批量排除、场组头计数）与参考列红态的**唯一判定**。
 * 判据只有一条：**按声明算** —— `min` 是唯一的必填信号，已绑定或生成时会供给的来源不足才缺。
 * - 计划首帧记在它生成时真正落的那个槽上（`plannedFirstFrameSlot`）。单值槽（首帧）里它和已绑定的那张
 *   至多算一个来源；数组槽（image_ref）里两者都会发出去，相加；
 * - 无模型/无档案（默认模型）→ 无契约可判，恒 []。
 *
 * 修过两次：以前「非 image_ref 的必填槽无条件返回 true」（Seedance 首帧/首尾帧、Veo 首尾帧永远红）；
 * 之后又只把计划首帧记在 first_frame 槽上——只有 image_ref 的图生视频开了首帧也永远红、进不了批量，
 * 而那张首帧生成时照样发进了 image_ref（0.22.0 回归）。
 */
export function missingRequiredSlotsOf(
  mode: ArchetypeMode | null | undefined,
  bindings: ReferenceBindingMap | undefined,
  credits: RequiredSlotCredits,
): ArchetypeReferenceSlot[] {
  if (!mode) return []
  return mode.slots.filter((slot) => {
    if (slot.min < 1) return false
    const bound = bindingsOf(bindings, slot.kind).length
    const planned = credits.plannedFirstFrame?.kind === slot.kind ? 1 : 0
    const own = slotAsArray(slot) ? bound + planned : Math.max(bound, planned)
    return own < slot.min
  })
}

/** 镜头行的那一份：绑定 = `shot.referenceBindings`，来源 = 计划首帧。锚不再单独记功——它要算，就得摆成绑定。 */
export function missingRequiredSlots(
  mode: ArchetypeMode | null | undefined,
  shot: PlanShot,
  _anchors?: readonly PlanAnchor[],
): ArchetypeReferenceSlot[] {
  return missingRequiredSlotsOf(mode, shot.referenceBindings, {
    plannedFirstFrame: plannedFirstFrameSlot(mode, shot),
  })
}

// 参考列的视图模型**不在这一层**：v6 改成「一个槽一个格」之后它由 `shotReferenceCells.ts` 拥有
// （v5 的 `referenceZoneView` / `ReferenceZoneView` 已随本次改版删除——它把数组槽的每一张素材
// 都摊成一个 tile，正是行高被撑爆的成因，见合同 §4.1 规则①）。

/** Single owner: unmarked fields belong to the plan; marked fields belong to the original canvas node. */
export function effectiveShotValue(shot: PlanShot, node: GenerationCanvasNode | null | undefined, field: string): unknown {
  if (node && overriddenShotFields(node).includes(field)) return nodeShotField(node, field)
  if (field.startsWith('params.')) return shot.params?.[field.slice(7)]
  return shot[field as keyof PlanShot]
}
