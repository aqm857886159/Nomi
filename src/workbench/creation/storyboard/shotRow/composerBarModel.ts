import type { ArchetypeMode, ModelArchetype } from '../../../../config/modelArchetypes/types'
import type { ModelParameterControl } from '../../../../config/modelCatalogMeta'

/**
 * 提示词底栏的**控件集合投影**（设计合同 v6 §2.3，2026-09-05 用户拍板；2026-09-06 返工三收成一行）。
 *
 * 硬规则一：一个控件要么因为这个模型/模式真的支持而**出现且可点**，要么因为不支持而**整枚不渲染**——
 * 不允许"渲染出来但置灰"这第三态。置灰控件是"这里本来该有个东西"的视觉噪音，用户还得猜它为什么
 * 点不动；而分镜表的最高优先级是批量扫视，每行多一枚死控件就多一份干扰。
 *
 * 硬规则二（P4 通用第一）：参数从**档案**（`ArchetypeMode.params`）derive，与画布图片/视频节点的
 * `resolveRenderedControls` 读同一份声明——分镜行不许自己写"模型 → 控件"的映射表（那是 P1 的并行版：
 * 档案改了 UI 不跟着改）。与参考列（`referenceZoneView` 按 `mode.slots` derive）是**同一份档案的
 * 两个投影**，换 mode 时两边必须同帧重画。
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
 * - number / text 这类要键盘输入的不进底栏——底栏是横向扫视区，它们住模型自己的参数面板。
 */
export function composerBarParams(mode: ArchetypeMode | null | undefined): ModelParameterControl[] {
  if (!mode) return []
  return mode.params.filter((control) => {
    if (OWNED_ELSEWHERE.has(control.key)) return false
    if (control.type === 'select') return control.options.length > 0
    return control.type === 'boolean'
  })
}

/**
 * 一行里**哪些参数摆出来、哪些收进行尾 ⋯**（2026-09-06 用户反馈三：「参数框为啥那么多？
 * 我们画布上的图片节点本身参数没那么多。能不能变成一行、再简洁些」）。
 *
 * 判据只有一条，且是从"这一行是拿来扫的"推出来的：
 *   - **select 摆出来**——它显示的是一个**值**（`1080p`、`竖版`）。值就是这一镜和别的镜的差别，
 *     扫一列就能看出哪镜不一样，占的横向预算换回了信息。
 *   - **boolean 收起来**——它显示的是一个**开关**。一排开关在扫视行里全是同一个形状、同一种颜色，
 *     读不出差别却各占一枚胶囊，正是用户说的"很乱"。开着的开关用 ⋯ 上的一颗小圆点报信，
 *     具体开了哪几个进弹层（一功能一个家：开关的家是这枚 ⋯，不是行上）。
 *
 * 对照画布：画布节点把**全部**参数收进一枚摘要 pill（`InlineParameterBar` 的 `summaryTrigger`），
 * 底栏上只剩「模型芯片 + 变体 + 摘要 pill」三枚。分镜行比画布多摆几枚 select，是因为它要**跨行**
 * 比较；但量级必须是同一档，不能是画布三枚、分镜九枚。
 */
export type ComposerBarPlan = {
  /** 摆在行上的 select 胶囊（顺序 = 档案声明顺序）。 */
  inline: ModelParameterControl[]
  /** 收进行尾 ⋯ 弹层的开关。 */
  overflow: ModelParameterControl[]
}

export function composerBarPlan(mode: ArchetypeMode | null | undefined): ComposerBarPlan {
  const params = composerBarParams(mode)
  return {
    inline: params.filter((control) => control.type === 'select'),
    overflow: params.filter((control) => control.type === 'boolean'),
  }
}

/** 模式胶囊的选项；只有一种模式的模型**不出这枚胶囊**（一个选项的选择器不是选择，是噪音）。 */
export function composerModeOptions(
  archetype: ModelArchetype | null | undefined,
): { value: string; label: string }[] {
  if (!archetype || archetype.modes.length < 2) return []
  return archetype.modes.map((mode) => ({ value: mode.id, label: mode.vendorTerm }))
}
