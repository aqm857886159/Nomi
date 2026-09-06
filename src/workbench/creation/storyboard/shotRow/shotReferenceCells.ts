import type { AssetSlot } from '../../../assets/AssetReference'
import type { ArchetypeMode, ArchetypeReferenceSlot } from '../../../../config/modelArchetypes/types'
import type { PlanReferenceBinding } from '../../../generationCanvas/agent/storyboardPlan'
import { bindingsOf, storyboardAssetSlots, type ReferenceBindingMap } from './shotReferenceSlots'

/**
 * 参考列的**格模型**（合同 v6 §4.1/§4.2，用户逐字拍板的两条硬规则）：
 *
 *   ① **一个槽一个格，不是一张图一个格**——首帧/尾帧/图片/视频/音频各一格；
 *      能放多张的槽画成叠放格 + 计数角标，点开是浮层网格。
 *   ② 参考列固定单行、最多三格、永不换行（列宽由 `REFERENCE_COLUMN_WIDTH` 从固定盒 derive）。
 *
 * v5 是"一张图一个格"（逐张渲染 tile），Seedance 全能参考那种 30 图槽会把行高撑爆。
 * 改成"槽是格的单位"之后，一个 image_ref 槽不管装 1 张还是 30 张，在参考列里永远只占一个格，
 * 行高因此稳定——这正是表格"批量扫视"能力的前提。
 *
 * 这一层是**纯 derive**：只画当前 mode 声明的槽（换 mode 整列重画，不留上一个 mode 的残留），
 * 必填只看 `min`（`ArchetypeReferenceSlot` 上没有 required 字段，别凭空发明），
 * `max` 缺省 = 供应商没公布上限 → 角标只显 N 不显分母（不能编造一个假上限）。
 */

export type ShotReferenceCell = {
  /** 槽的语义身份（= `ArchetypeReferenceSlotKind`，跨供应商稳定）。 */
  key: string
  label: string
  /** 该槽当前的有序绑定（0 张 = 空格；≥2 张 = 叠放格）。 */
  bindings: PlanReferenceBinding[]
  /** 声明上限；缺省 = 供应商没公布（角标不显分母）。 */
  max?: number
  /** `min ≥ 1` → 红「必填」；`min = 0` → 灰「可选」。判据只有 min 这一条。 */
  required: boolean
  /** characterIndexed 的槽才给 ①②③（对应 prompt 里的 character1..N）；其余槽不编号。 */
  numbered: boolean
  /** 画布同款 AssetSlot 描述符（喂 AssetPicker / 上传校验，复用已验证的那一套）。 */
  assetSlot: AssetSlot
  declared: ArchetypeReferenceSlot
}

export type ShotReferenceColumn =
  /** 该 mode 不吃参考（`slots: []`，如 t2v）：一行灰字，`@` 仍可把锚写进提示词。 */
  | { kind: 'none-accepted' }
  /** 声明了槽 → 逐槽出格。 */
  | { kind: 'cells'; cells: ShotReferenceCell[] }
  /** 默认模型（无档案）契约未知 → 退回通用「@ 加」格，不假装知道能收什么。 */
  | { kind: 'unknown-contract' }

/**
 * 镜头行与（v6 §2.2 展开态的）锚行共用同一套参考列解剖，所以入参是**绑定记录**而不是 PlanShot。
 */
export function referenceColumnOf(
  mode: ArchetypeMode | null | undefined,
  bindings: ReferenceBindingMap | undefined,
): ShotReferenceColumn {
  if (!mode) return { kind: 'unknown-contract' }
  if (mode.slots.length === 0) return { kind: 'none-accepted' }
  const assetSlots = storyboardAssetSlots(mode)
  const cells = mode.slots.map((declared, index): ShotReferenceCell => ({
    key: declared.kind,
    label: assetSlots[index]?.label ?? declared.label,
    bindings: bindingsOf(bindings, declared.kind),
    ...(declared.max !== undefined ? { max: declared.max } : {}),
    required: declared.min >= 1,
    numbered: Boolean(declared.characterIndexed),
    assetSlot: assetSlots[index],
    declared,
  }))
  return { kind: 'cells', cells }
}

/** 计数角标文案的数据（`max` 缺省时 total = null，UI 只显 N 不显分母）。 */
export function cellCount(cell: ShotReferenceCell): { used: number; total: number | null } {
  return { used: cell.bindings.length, total: cell.max ?? null }
}
