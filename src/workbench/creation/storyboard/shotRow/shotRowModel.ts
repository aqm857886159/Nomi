import type { ModelOption } from '../../../../config/models'
import { resolveArchetypeForModel } from '../../../../config/modelArchetypes'
import type { ArchetypeMode, ArchetypeReferenceSlot, ModelArchetype } from '../../../../config/modelArchetypes/types'
import type { ModelParameterControl } from '../../../../config/modelCatalogMeta'
import type { PlanAnchor, PlanShot } from '../../../generationCanvas/agent/storyboardPlan'
import { defaultCarrierForKind } from '../../../generationCanvas/agent/storyboardPlanEdits'

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

/** 该 mode 的画幅控件（提示词块上沿的一等胶囊）。没有该参数的模型 → null（不渲染胶囊）。 */
export function aspectControlOf(mode: ArchetypeMode | null | undefined): ModelParameterControl | null {
  if (!mode) return null
  return mode.params.find((control) => control.key === 'aspect_ratio' && control.type === 'select') ?? null
}

/** 具名帧槽（画面来源，一格一张）与数组参考槽（一批参考）的分界——与 archetypeMeta 的 asArray 缺省推断同界。 */
const NAMED_FRAME_SLOT_KINDS: ReadonlySet<ArchetypeReferenceSlot['kind']> = new Set([
  'first_frame',
  'last_frame',
  'source_video',
])

function isNamedFrameSlot(slot: ArchetypeReferenceSlot): boolean {
  return NAMED_FRAME_SLOT_KINDS.has(slot.kind)
}

/** 该镜引用的视觉锚（生成参考图那类；文本锚只拼 prompt，不占参考槽）。 */
export function referencedVisualAnchors(shot: PlanShot, anchors: readonly PlanAnchor[]): PlanAnchor[] {
  const byId = new Map(anchors.map((anchor) => [anchor.id, anchor]))
  return shot.anchorIds
    .map((id) => byId.get(id))
    .filter((anchor): anchor is PlanAnchor => !!anchor && (anchor.carrier ?? defaultCarrierForKind(anchor.kind)) === 'visual')
}

/**
 * 该镜**缺必填参考**的槽（画面格红态 + 场组头「缺必填」计数的唯一判定）。
 * - 数组图参考槽（image_ref）可被引用的视觉锚满足（落画布时锚连 reference/character_ref 边）；
 * - 具名帧槽与视频/音频参考在表层暂无来源（结果即收/上传属后续阶段）→ min≥1 即缺，亮不拦、诚实提示；
 * - 无模型/无档案（默认模型）→ 无契约可判，恒 []。
 */
export function missingRequiredSlots(
  mode: ArchetypeMode | null | undefined,
  shot: PlanShot,
  anchors: readonly PlanAnchor[],
): ArchetypeReferenceSlot[] {
  if (!mode) return []
  const visualCount = referencedVisualAnchors(shot, anchors).length
  return mode.slots.filter((slot) => {
    if (slot.min < 1) return false
    if (slot.kind === 'image_ref') return visualCount < slot.min
    return true
  })
}

/** 参考区（第三列）的三形态视图模型：不吃参考 / 槽形态展示。纯展示——绑定编辑走展开态锚 chips。 */
export type ReferenceZoneView =
  /** 有档案且该 mode slots 为空：此模型不吃参考。 */
  | { kind: 'none-accepted' }
  /** 槽形态：具名帧槽各一格（空 tile + 槽名），数组槽/无档案 → 已引用视觉锚 tiles + 「@」入口占位。 */
  | { kind: 'slots'; namedSlots: ArchetypeReferenceSlot[]; hasArrayIntake: boolean; referencedAnchors: PlanAnchor[] }

export function referenceZoneView(
  mode: ArchetypeMode | null | undefined,
  shot: PlanShot,
  anchors: readonly PlanAnchor[],
): ReferenceZoneView {
  const referencedAnchors = referencedVisualAnchors(shot, anchors)
  if (!mode) {
    // 默认模型（无档案）：契约未知，按最宽形态展示——已引用的锚 + 通用「@」入口占位。
    return { kind: 'slots', namedSlots: [], hasArrayIntake: true, referencedAnchors }
  }
  if (mode.slots.length === 0) return { kind: 'none-accepted' }
  const namedSlots = mode.slots.filter(isNamedFrameSlot)
  const hasArrayIntake = mode.slots.some((slot) => !isNamedFrameSlot(slot))
  return { kind: 'slots', namedSlots, hasArrayIntake, referencedAnchors }
}
