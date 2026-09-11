/**
 * 底栏「哪几个参数自己占一颗下拉 chip、哪些收进 ⚙」的**唯一判据**
 * （docs/design/2026-09-10-node-composer-bar-v1.md §B，2026-09-11 02:10 用户拍板方案 B）。
 *
 * 要权衡的那一个东西：底栏这条带子的常驻宽度是有限的，而「每个参数一颗 chip」的价值
 * 恰恰来自**一步到位**——多一颗 chip 就多占一格宽，多收一颗进 ⚙ 就多一次点击。
 * 判据必须能同时回答「露哪几颗」和「露不下时先收哪颗」，而且两个答案都得从档案 derive。
 *
 * 判据（三条，缺一不可）：
 *   ① **档案声明了这个语义角色**（比例 / 时长 / 清晰度，`parameterControlRole` 是全仓唯一的角色表）。
 *      档案没声明就没有这颗 chip——不补默认值、不假装模型支持它。
 *      为什么只有这三个角色够用：它们是**值本身就读得懂**的那一批（`16:9`、`5s`、`1080p`），
 *      chip 上不写参数名也认得出。种子 / 生成音频 / 负向提示词写成 `12345`、`开` 谁也读不出是什么，
 *      那种参数摆出来占的是宽度、给的是问号——它们的家是 ⚙（一功能一个家，§1.5.2）。
 *   ② **点开确实能选**：有候选项，或是能从 min/max/step 切出有限档位的数值区间
 *      （档案里 `duration` 常声明成 `number` + 区间而不是枚举，见 electron/shared/videoCapabilities/seedance.ts）。
 *      切不出档位的连续量（denoise 0–1 未声明步长）留在 ⚙ 里用输入框/滑杆，chip 装不下它。
 *   ③ **不是开关**：boolean 的 chip 只会显示「开 / 关」，读不出它管的是什么。
 *
 * 顺序按角色固定（比例 → 时长 → 清晰度），不随档案声明顺序漂：底栏是用户每次生成前都要扫的
 * 同一行，比例这颗今天在第一位、换个模型跑到第三位，等于每换一次模型都要重新找一遍。
 * 退位也按这个顺序**从尾巴退**（先退清晰度，再退时长），因为越靠前的越是「决定出什么」。
 */
import {
  catalogControlInitialValue,
  controlInitialValue,
  controlValueToString,
  isParameterControl,
  optionLabel,
  optionValue,
  parameterControlRole,
  type DynamicModelControl,
  type ParameterRole,
} from './controls/parameterControlModel'
import { hasUsableSliderStep } from './controls/numericDraft'

/** 露出顺序 = 决策顺序：先定画面形状，再定它多长，最后才是清晰度（也是最影响价格的那一档在前）。 */
export const PRIMARY_ROLE_ORDER: readonly ParameterRole[] = ['aspect', 'duration', 'resolution']

/**
 * 数值区间能切出多少档还算「一个下拉」。
 * 上限从下拉本身的尺寸推：`NomiSelect` 的列表高 240px、每行 30px（`src/design/NomiSelect.tsx`）
 * = 一屏 8 行，允许到一屏的两倍（滚一次就到底）。再多的连续量（步进 0.05 的强度这类）
 * 用下拉选本来就是错的形态，它留在 ⚙ 里的滑杆/输入框上。
 * 现役最长的一条是 Seedance 的时长 4–15s（12 档），在这个上限内。
 */
export const MAX_CHIP_RANGE_STEPS = 16

/** 数值区间 → 离散档位；切不出（无区间 / 步长废掉 / 档数过多）返回空数组。 */
export function numericRangeChipOptions(control: DynamicModelControl): { value: string; label: string }[] {
  if (!isParameterControl(control)) return []
  if (control.type !== 'number') return []
  const { min, max, step } = control
  if (typeof min !== 'number' || typeof max !== 'number') return []
  if (!hasUsableSliderStep(min, max, step)) return []
  const effectiveStep = typeof step === 'number' && step > 0 ? step : 1
  const count = Math.floor((max - min) / effectiveStep) + 1
  if (count > MAX_CHIP_RANGE_STEPS) return []
  return Array.from({ length: count }, (_, index) => {
    // 浮点步长累加会渲出 0.30000000000000004；按档位序号乘再定点回原步长的小数位。
    const decimals = (String(effectiveStep).split('.')[1] || '').length
    const value = Number((min + index * effectiveStep).toFixed(decimals))
    return { value: String(value), label: String(value) }
  })
}

/** chip 的候选项（档案声明的枚举优先；纯区间数值才 derive 档位）。 */
export function parameterChipOptions(control: DynamicModelControl): { value: string; label: string }[] {
  if (!isParameterControl(control)) {
    return control.options.map((option) => ({ value: optionValue(option), label: optionLabel(option) }))
  }
  if (control.options.length > 0) {
    return control.options.map((option) => ({ value: controlValueToString(option.value), label: option.label }))
  }
  return numericRangeChipOptions(control)
}

/** chip 当前值（与面板读的是同一条 meta → 默认值链，chip 和面板不会各说各话）。 */
export function parameterChipValue(control: DynamicModelControl, meta: Record<string, unknown>): string {
  return isParameterControl(control)
    ? controlInitialValue(control, meta)
    : catalogControlInitialValue(control, meta)
}

function isChipEligible(control: DynamicModelControl): boolean {
  if (isParameterControl(control) && control.type === 'boolean') return false
  return parameterChipOptions(control).length > 0
}

/**
 * 把档案给出的控件分成「底栏 chip 候选」与「其余」。
 * `rest` 保持**档案声明顺序**——它就是 ⚙ 面板里的顺序，面板不该被 chip 的排序规则带偏。
 */
export function splitPrimaryParameterControls(controls: readonly DynamicModelControl[]): {
  primary: DynamicModelControl[]
  rest: DynamicModelControl[]
} {
  const ranked: { control: DynamicModelControl; rank: number }[] = []
  const rest: DynamicModelControl[] = []
  const takenRoles = new Set<ParameterRole>()
  for (const control of controls) {
    const role = parameterControlRole(control)
    const rank = role ? PRIMARY_ROLE_ORDER.indexOf(role) : -1
    // 同一个角色只留第一个：档案去重后本不该出现两枚，真出现了也只摆一枚（两枚说同一件事更糟）。
    if (role && rank >= 0 && !takenRoles.has(role) && isChipEligible(control)) {
      takenRoles.add(role)
      ranked.push({ control, rank })
      continue
    }
    rest.push(control)
  }
  return {
    primary: ranked.sort((a, b) => a.rank - b.rank).map((entry) => entry.control),
    rest,
  }
}

/**
 * 按「装得下几颗」切一刀。装不下的**退回 ⚙**（不换行、不缩成看不清的小字）。
 * `visibleCount` 由组件量出来（真实盒子宽度），这里只负责「从尾巴退、不重排、不跳着退」这条规则。
 */
export function planParameterChips(
  primary: readonly DynamicModelControl[],
  visibleCount: number,
): { chips: DynamicModelControl[]; demoted: DynamicModelControl[] } {
  const safeCount = Math.max(0, Math.min(primary.length, Math.floor(visibleCount)))
  return { chips: primary.slice(0, safeCount), demoted: primary.slice(safeCount) }
}

/**
 * ⚙ 里到底放哪些控件：档案声明的全部控件里，去掉此刻摆在底栏上的那几颗。
 * 退回来的 chip 自动回到它在档案里的原位——顺序不因为它刚从底栏退下来就变。
 */
export function overflowParameterControls(
  controls: readonly DynamicModelControl[],
  chips: readonly DynamicModelControl[],
): DynamicModelControl[] {
  const chipKeys = new Set(chips.map((control) => control.key))
  return controls.filter((control) => !chipKeys.has(control.key))
}

/**
 * chip 上那句短文案。
 *
 * 时长补单位只在**纯数字**时做：档案里 duration 的选项标签有的是「5」、有的已经写成「5s」/「5 秒」，
 * 无条件套单位会渲出「5ss」——一条只在某些模型上才现形的假文案（2026-09-11 v1.1 踩过）。
 */
export function parameterChipLabel(
  control: DynamicModelControl,
  optionText: string,
  formatSeconds: (value: string) => string,
): string {
  if (parameterControlRole(control) !== 'duration') return optionText
  return /^\d+(\.\d+)?$/.test(optionText) ? formatSeconds(optionText) : optionText
}
