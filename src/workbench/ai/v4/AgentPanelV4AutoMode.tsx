// Agent 面板 v4 · 「全自动」档的常驻提醒（2026-09-10 用户拍板 · 增量 2）
//
// 为什么需要它：三档里只有「全自动」会让 Nomi 在**没有人看着**的时候连着做可撤销的改动。
// 另外两档每一步都会在介入槽里现身，用户不可能忘了自己开着什么；全自动恰恰相反——
// 它的特征就是「什么都不问」，于是「我现在是不是开着全自动」这件事在界面上没有任何痕迹。
// composer 底栏那颗档位钮本身不算：它三档长得一模一样，读它等于每次都要低头确认一遍。
//
// 所以这一条是**状态的痕迹**，不是第二个开关（§1.5.2 一功能一个家）：
//   · 它只在 `project` 档出现，别的档一行都不渲染；
//   · 它上面唯一的动作是**退回上一档**——开全自动的家仍然是 composer 底栏那颗钮，
//     这里只提供「我不想要了」这条最短的出路（用户原话：可点回「自动改」）。
//
// 尺寸按「极小」拿：一条 h-6 的微字横条，靠 warning-soft 底 + 一颗点被眼睛抓到，
// 不用 icon——设计定稿 ⑧ 禁用闪光/机器人头那一族，而「自动」正是最容易被画成闪电的地方。
import React from 'react'
import { V4Row } from './AgentPanelV4Row'

export function V4AutoModeBanner({
  label,
  note,
  revertLabel,
  onRevert,
}: {
  /** 档位名（「全自动」）。 */
  label: string
  /** 那句诚实交代：仍然会问的是什么。 */
  note: string
  /** 退回上一档那颗小钮的文案（「回到自动改」）。 */
  revertLabel: string
  onRevert?: () => void
}): JSX.Element {
  return (
    <V4Row
      as="div"
      className="h-6 shrink-0 rounded-nomi-sm border border-nomi-warning-edge bg-nomi-warning-soft px-2 text-micro text-nomi-warning-ink"
      data-v4-block="auto-mode"
    >
      <span className="size-1.5 shrink-0 rounded-pill bg-nomi-warning" aria-hidden="true" />
      <span className="shrink-0 font-semibold">{label}</span>
      {/* 这句话是本条存在的理由：用户对「全自动」最合理的恐惧是「它会不会偷偷把钱花了」。
          把答案就摆在提醒里，比让他去翻档位说明省一整趟（D4 缺口/边界明着标）。 */}
      <span className="min-w-0 truncate">{note}</span>
      <button
        type="button"
        onClick={onRevert}
        data-v4-control="auto-mode-revert"
        // 描边而不是裸文字：这一条整行都是 warning 色的微字，一句裸文字混在里面看不出是能点的
        // （设计系统 §4.1 C1「可点要看得出来」）。一圈 edge 色的细边是这个尺寸下最省的可点信号。
        className="h-5 shrink-0 rounded-pill border border-nomi-warning-edge px-1.5 font-medium text-nomi-warning-ink hover:bg-nomi-warning-edge"
      >
        {revertLabel}
      </button>
    </V4Row>
  )
}
