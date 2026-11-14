/**
 * 生成底栏挤的时候「谁先让、让到哪」——画布节点、画布列表详情、分镜行、参考卡四处同一条，只在这里定义一次
 * （2026-11-14 参数面板 PR 独立验收真问题 1：分镜行窄了模型名先被截成「Seedance …」）。
 *
 * 顺序（能在别处看全的先让，名字和影响花钱的最后让）：
 *   ① 生成钮收成只剩「↑」（读屏名不变，悬停提示写钮上原来的字）；
 *   ② 参数摘要从后往前整值地减（`summaryFitCandidates`，三个值 → 两个 → 一个），一个值不截半截——
 *      摘要里的值点开面板就能看全；
 *   ③ 方式格收成只剩图标（悬停 / 读屏给全名）——方式决定这一镜要放什么输入，比摘要里的值要紧；
 *      选中的方式没有图标就不收（保留文字），直接进 ④；
 *   ④ 以上都让完还放不下，模型名才末尾省略（title 是全名）。
 * 2026-11-14 协调裁决：②③ 原来是反的，那样画布 600 宽默认值下 34 格会从「写方式名、摘要退掉比例」变成「方式只剩图标」，
 * 而画布 600 宽是用户看过真截图拍过板的样子。高级设置图标、提示词工具不让。让的判据只有底栏自己的宽（容器宽），不读窗口宽。
 *
 * 让到第几步由 `InlineParameterBar` 量一次，经 `ComposerBarYieldContext` 发给生成钮；方式格读同一个值。
 */
import React from 'react'

export type ComposerYieldStep = {
  /** ① 生成钮只剩「↑」。 */
  sendIconOnly: boolean
  /** ② 摘要用第几档候选（0 = 全部值）。 */
  summaryIndex: number
  /** ③ 方式格只剩图标。 */
  modeIconOnly: boolean
  /** ④ 模型名允许末尾省略。 */
  modelEllipsis: boolean
}

export const COMPOSER_YIELD_NONE: ComposerYieldStep = Object.freeze({ sendIconOnly: false, modeIconOnly: false, summaryIndex: 0, modelEllipsis: false })

/**
 * 从「什么都不让」到「全让完」的每一级，按上面的顺序。某一步在这只底栏上没有东西可让（画布的生成钮本来就没字、
 * 方式没有图标、摘要只有一个值）就不出那一级。
 */
export function composerYieldLadder({ sendCollapsible, modeCollapsible, summaryCandidates }: {
  sendCollapsible: boolean
  modeCollapsible: boolean
  /** 摘要从全到简有几档（`summaryFitCandidates(...).length`；没有摘要或不能退 = 1）。 */
  summaryCandidates: number
}): ComposerYieldStep[] {
  const steps: ComposerYieldStep[] = [COMPOSER_YIELD_NONE]
  let current = COMPOSER_YIELD_NONE
  const push = (patch: Partial<ComposerYieldStep>): void => { current = { ...current, ...patch }; steps.push(current) }
  if (sendCollapsible) push({ sendIconOnly: true })
  for (let index = 1; index < summaryCandidates; index += 1) push({ summaryIndex: index })
  if (modeCollapsible) push({ modeIconOnly: true })
  push({ modelEllipsis: true })
  return steps
}

type IconBearing = { value?: string; glyph?: React.ReactNode; icon?: unknown }
const iconOf = (option: IconBearing | undefined): unknown => (
  option?.glyph && React.isValidElement(option.glyph) ? option.glyph.type : option?.glyph ?? option?.icon
)

/**
 * ③ 方式格能不能收成图标：选中的方式有图标，且同一个菜单里没有别的方式用同一个图标——
 * 参考 / 编辑 / 延长共用一个图标的菜单，收成图标就分不清是哪一种了。认不出就不收、保留文字，直接进 ④。
 */
export function modeIconRecognizable(options: readonly IconBearing[] | undefined, value: string | undefined): boolean {
  const selected = options?.find((option) => option.value === value)
  const icon = iconOf(selected)
  if (!icon) return false
  return !options!.some((option) => option !== selected && iconOf(option) === icon)
}

/** 发给底栏里别的组件（生成钮）的那一份：默认 = 没在让（不在这只底栏里的用法一个像素不变）。 */
export const ComposerBarYieldContext = React.createContext<Pick<ComposerYieldStep, 'sendIconOnly'>>({ sendIconOnly: false })
