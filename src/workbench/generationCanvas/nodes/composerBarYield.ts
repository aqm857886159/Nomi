/**
 * 生成底栏挤的时候「谁留下」——画布节点、画布列表详情、分镜行、参考卡四处同一条，只在这里定义一次
 * （2026-11-14 参数面板 PR 独立验收真问题 1：分镜行窄了模型名先被截成「Seedance …」）。
 *
 * 一张按重要性排的清单（能在别处看全的排后面，名字和影响花钱的排前面；2026-11-14 协调裁决的顺序）：
 *   ① 模型名完整（放不下就末尾省略，title 是全名；它是终点：模型名都放不下，后面的一样都不放）；
 *   ② 方式格写全名（放不下就只剩图标，悬停 / 读屏给全名）——方式决定这一镜要放什么输入；
 *      选中的方式没有图标就一直写全名，不在清单里；
 *   ③ 参数摘要从后往前的整值（`summaryFitCandidates`，一个值 → 两个 → 三个），一个值不截半截——
 *      摘要里的值点开面板就能看全；
 *   ④ 生成钮上的字（放不下就只剩「↑」，读屏名不变，悬停提示写钮上原来的字）。
 * 挑法：先全收（最省地方的样子），再按清单从要紧的往下一件一件放回，放得下就放、放不下就跳过看下一件
 * （2026-11-21 D-1121-bar-yield-priority-list：「明明有空位置 为什么缩小」）。放不下一个整值的空位就留着，
 * 不截半个值、不拿方式名去换（D-1121-bar-yield-zh-slack-accept）。
 * 高级设置图标、提示词工具不让。判据只有底栏自己的宽（容器宽），不读窗口宽。
 *
 * 留下哪些由 `InlineParameterBar` 量一次，经 `ComposerBarYieldContext` 发给生成钮；方式格读同一个值。
 */
import React from 'react'

export type ComposerYieldStep = {
  /** ④ 生成钮只剩「↑」。 */
  sendIconOnly: boolean
  /** ③ 摘要用第几档候选（0 = 全部值）。 */
  summaryIndex: number
  /** ② 方式格只剩图标。 */
  modeIconOnly: boolean
  /** ① 模型名允许末尾省略。 */
  modelEllipsis: boolean
}

export const COMPOSER_YIELD_NONE: ComposerYieldStep = Object.freeze({ sendIconOnly: false, modeIconOnly: false, summaryIndex: 0, modelEllipsis: false })

/**
 * 按上面的清单挑这只底栏的样子。`fits(step)` 回答「这个样子整条放不放得下」（由底栏用量到的宽答，这里不碰 DOM）。
 * 某一件在这只底栏上没有东西可让（画布的生成钮本来就没字、方式没有图标、摘要只有一个值）就不进清单。
 */
export function composerYieldPick({ sendCollapsible, modeCollapsible, summaryCandidates, fits }: {
  sendCollapsible: boolean
  modeCollapsible: boolean
  /** 摘要从全到简有几档（`summaryFitCandidates(...).length`；没有摘要或不能退 = 1）。 */
  summaryCandidates: number
  fits: (step: ComposerYieldStep) => boolean
}): ComposerYieldStep {
  let step: ComposerYieldStep = {
    sendIconOnly: sendCollapsible,
    modeIconOnly: modeCollapsible,
    summaryIndex: Math.max(0, summaryCandidates - 1),
    modelEllipsis: true,
  }
  const full = { ...step, modelEllipsis: false }
  // ① 模型名是终点：它都放不下，整条只能全收、模型名省略。
  if (!fits(full)) return step
  step = full
  const restores: Partial<ComposerYieldStep>[] = [
    ...(modeCollapsible ? [{ modeIconOnly: false }] : []),
    ...Array.from({ length: Math.max(0, summaryCandidates - 1) }, (_, index) => ({ summaryIndex: summaryCandidates - 2 - index })),
    ...(sendCollapsible ? [{ sendIconOnly: false }] : []),
  ]
  for (const patch of restores) {
    const next = { ...step, ...patch }
    if (fits(next)) step = next
  }
  return step
}

export function sameComposerYieldStep(a: ComposerYieldStep, b: ComposerYieldStep): boolean {
  return a.sendIconOnly === b.sendIconOnly && a.modeIconOnly === b.modeIconOnly && a.summaryIndex === b.summaryIndex && a.modelEllipsis === b.modelEllipsis
}

/**
 * ② 方式格能不能收成图标：选中的方式有图标就收（同一菜单里几种方式共用一个图标也收——全名在悬停、读屏、下拉里都有，
 * 模型名连着价钱，排在它前面；2026-11-14 协调裁决）。没有图标就不收、一直写全名。
 */
export function modeHasIcon(options: readonly { value?: string; glyph?: React.ReactNode; icon?: unknown }[] | undefined, value: string | undefined): boolean {
  const selected = options?.find((option) => option.value === value)
  return Boolean(selected?.glyph || selected?.icon)
}

/** 发给底栏自己画的唯一生成钮的那一份：默认 = 没在让（不在这只底栏里的用法一个像素不变）。 */
export const ComposerBarYieldContext = React.createContext<Pick<ComposerYieldStep, 'sendIconOnly'>>({ sendIconOnly: false })
