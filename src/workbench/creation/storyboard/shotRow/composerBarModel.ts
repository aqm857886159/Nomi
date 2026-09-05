import type { ArchetypeMode, ModelArchetype } from '../../../../config/modelArchetypes/types'
import type { ModelParameterControl } from '../../../../config/modelCatalogMeta'

export const COMPOSER_GRID_SLOTS = ['model', 'mode', 'aspect', 'duration', 'quality', 'media', 'generate'] as const
export type ComposerGridSlot = typeof COMPOSER_GRID_SLOTS[number]

/** Every row owns the same seven columns; empty capabilities still occupy their column. */
export function composerBarLayout(): readonly ComposerGridSlot[] {
  return COMPOSER_GRID_SLOTS
}

/**
 * 提示词底栏的**控件集合投影**（设计合同 v6 §2.3，2026-09-05 用户拍板）。
 *
 * 硬规则：一个控件要么因为这个模型/模式真的支持而**出现且可点**，要么因为不支持而**整枚不渲染**——
 * 不允许"渲染出来但置灰"这第三态。置灰控件是"这里本来该有个东西"的视觉噪音，用户还得猜它为什么
 * 点不动；而分镜表的最高优先级是批量扫视，每行多一枚死控件就多一份干扰。
 *
 * 因此这一层**从档案运行时 derive**，组件里不许写"模型 → 控件"的映射表（那是 P1 的并行版：
 * 档案改了 UI 不跟着改）。与参考列（`referenceZoneView` 按 `mode.slots` derive）是**同一份档案的
 * 两个投影**——换 mode 时两边必须同帧重画。
 */

/** 底栏不渲染这些键：它们各自另有 owner，出现在这里就是第二份真相。 */
const OWNED_ELSEWHERE = new Set([
  // 画幅是「整片默认 + 行级覆盖」两段的，owner 是 storyboardAspectScope；底栏只在覆盖时出一枚胶囊。
  'aspect_ratio',
  // 时长的 owner 是 PlanShot.durationSec（合计时长、时间轴停留都读它）；底栏那枚「时长」写的就是它。
  'duration',
])

/**
 * 底栏要渲染的档案参数（顺序 = 档案声明顺序）。
 * - `mode` 缺省（默认模型、契约未知）→ **空**：不知道能调什么就一枚都不出，不假装。
 * - select 无选项 = 供应商没给可选值 → 不渲染（渲染出来点开是空的，等于死控件）。
 * - number / text 这类要键盘输入的不进底栏——底栏是横向扫视区，它们住 ▾ 展开的参数面板。
 */
export function composerBarParams(mode: ArchetypeMode | null | undefined): ModelParameterControl[] {
  if (!mode) return []
  return mode.params.filter((control) => {
    if (OWNED_ELSEWHERE.has(control.key)) return false
    if (control.type === 'select') return control.options.length > 0
    return control.type === 'boolean'
  })
}

/** 模式胶囊的选项；只有一种模式的模型**不出这枚胶囊**（一个选项的选择器不是选择，是噪音）。 */
export function composerModeOptions(
  archetype: ModelArchetype | null | undefined,
): { value: string; label: string }[] {
  if (!archetype || archetype.modes.length < 2) return []
  return archetype.modes.map((mode) => ({ value: mode.id, label: mode.vendorTerm }))
}
