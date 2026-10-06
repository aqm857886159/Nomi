import { isAutoOptionValue, optionsAreAspectRatios } from '../../../../electron/shared/aspectRatioValue'
import { hasFlatOptions, type DynamicModelControl } from './controls/parameterControlModel'

type ParameterOption = { value: string; text: string }

export type ParameterOptionPurpose = 'generic' | 'aspect-ratio' | 'provider'

export type LocalizedParameterOption = {
  value: string
  text: string
  isAuto: boolean
}

/** 内部参数值保持供应商无关，只把自动语义收敛到当前语言的展示文字。 */
export function localizeAutoOption(
  value: string,
  text: string,
  autoLabel: string,
): LocalizedParameterOption {
  const isAuto = isAutoOptionValue(value) || isAutoOptionValue(text)
  return { value, text: isAuto ? autoLabel : text, isAuto }
}

/** Semantic roles stay stable across models; only generic enums use overflow heuristics. */
export function resolveParameterOptionPurpose(
  options: readonly ParameterOption[],
  requested: ParameterOptionPurpose = 'generic',
): ParameterOptionPurpose {
  if (requested !== 'generic') return requested
  // 判据与宿主准入层「Agent 说的比例落到哪个控件」是同一个（`electron/shared/aspectRatioValue.ts`）。
  return optionsAreAspectRatios(options) ? 'aspect-ratio' : 'generic'
}

/**
 * 一组选项在参数面板里怎么摆。**三种都是摊开的、点一下就选中**——
 * 面板里不再套下拉（2026-09-11 13:00 用户真机拍板：pill → 面板 → 下拉 → 列表 → 选，四步太多）。
 *
 * · `chips-row`（短标签）——一排 chip，超宽自动换行，当前值高亮。
 * · `chips-column`（长标签：模型文件名、长枚举）——一项一行，读得全；挤成等宽格子等于没摊开。
 * · `searchable-list`（候选超过 `FLAT_OPTION_LIMIT`）——搜索框 + **默认就展开**的一列可点项。
 *   它和下拉的差别不是外观，是**步数**：列表已经在你眼前，不需要再点开一次。
 *
 * 语义角色（比例 / 供应商）恒 `chips-row`：比例那组每项带比例小图形，一眼选对画幅靠的就是它。
 */
export type ParameterOptionLayout = 'chips-row' | 'chips-column' | 'searchable-list'

/**
 * 摊平的上限。**为什么是 8**：面板宽 320px，一列可点项每行 28px，列表区一屏就是 8 行
 * （与 `NomiSelect` 那份「240px / 30px = 8 行」同一个尺子）。到这个数为止，全部选项一眼可见、
 * 不用滚也不用搜；再多就该给搜索框了，否则摊开反而变成一条要翻的长卷。
 */
export const FLAT_OPTION_LIMIT = 8

/** 面板最小分段宽下，全角字约占两个 ASCII 格。超过这个宽度的标签排成一排就只剩省略号。 */
const ROW_LABEL_CELLS = 8
const labelCells = (text: string): number => Array.from(text)
  .reduce((width, char) => width + ((char.codePointAt(0) ?? 0) > 255 ? 2 : 1), 0)

export function parameterOptionLayout(
  options: readonly { text: string }[],
  purpose: ParameterOptionPurpose = 'generic',
): ParameterOptionLayout {
  if (purpose !== 'generic') return 'chips-row'
  if (options.length > FLAT_OPTION_LIMIT) return 'searchable-list'
  return options.every(({ text }) => labelCells(text) <= ROW_LABEL_CELLS) ? 'chips-row' : 'chips-column'
}

/**
 * 「底栏 pill 点开直接就是这一个参数的选项列表」成不成立——成立就返回那个控件，否则 null。
 *
 * 为什么要有这条路（2026-09-11 13:00 用户真机拍板）：面板的价值是「一次打开连改多项」。
 * 只有一个参数时它没有那个价值，只剩一层壳——图片节点只有尺寸，改一次要走
 * pill → 面板 → 下拉 → 列表 → 选，四步。直出之后两步。
 *
 * 四个条件缺一不可，而且都是「面板里还有没有别的东西」这同一个问题的不同面：
 * chips 摆法的触发器是 ⚙（它本来就只收长尾，不是这条路的宿主）、供应商和生成方式也各占一组、
 * 而没有候选项的控件（滑杆 / 数字框 / 开关）脱了小标题就读不出在调什么。
 */
export function soloOptionControl(input: {
  controls: readonly DynamicModelControl[]
  hasProvider: boolean
  hasModeChoices: boolean
  chipsMode: boolean
}): DynamicModelControl | null {
  if (input.chipsMode || input.hasProvider || input.hasModeChoices) return null
  if (input.controls.length !== 1) return null
  return hasFlatOptions(input.controls[0]) ? input.controls[0] : null
}
