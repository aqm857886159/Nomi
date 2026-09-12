/**
 * 生成浮框底栏中段的「B 簇」——帮我写提示词的那三件：🎥 运镜 · ✦ 效果 · ✨ 优化。
 *
 * 为什么单独一个文件：这两件的**触发器外观**必须一模一样（缩小一号的纯 icon、hover 出名字、
 * 可带一个激活点），而它们的弹层与逻辑分别住在 useNodeEffectChips /
 * NodePromptOptimizer 三处。把外观抄三份就是三个平行版（P1），下一次调间距只会改中一份。
 * 这里只放**外观与分组**，一行业务逻辑都没有。
 *
 * 形制依据（docs/design/2026-09-10-node-composer-bar-v1.md §v1.1，2026-09-11 用户拍板）：
 * - 尺寸取设计系统已有的小号档 `WorkbenchIconButton size="sm"`（28px），**没造新尺寸**；
 *   一行里「决策位」（带文字，30px）与「工具位」（无文字，28px）靠文字有无 + 尺寸差分层。
 * - 图标 16 / stroke 2（§6 工作区按钮档，由 WorkbenchIconButton 的 `[&>svg]` 统一给）。
 * - 名字退到 hover：底栏的常驻宽度要留给「出什么 / 花多少」，「运镜 · 推近 中」这种已选值
 *   回显不占常驻位。用设计系统的 Radix `Tooltip`（120ms）而不是原生 `title`——纯 icon 的
 *   可读性本来就是这一版最大的风险（卡点表 ①），一秒多的系统级延迟会把它变成真问题。
 *   因此按钮显式传 `title=""` 压掉 WorkbenchIconButton 默认挂的原生 title，否则两个气泡叠着出。
 */
import React from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, WorkbenchIconButton } from '../../../design'

/** 簇容器：一个有名字的分组（§1.5.3「分段要有名字」），走查按这个属性找它。 */
export function NodePromptToolCluster({ ariaLabel, children }: { ariaLabel: string; children: React.ReactNode }): JSX.Element {
  return (
    <TooltipProvider delayDuration={120}>
      <div
        role="group"
        aria-label={ariaLabel}
        data-prompt-tool-cluster="true"
        data-bar-segment="prompt-tools"
        className="inline-flex shrink-0 items-center gap-0.5"
      >
        {children}
      </div>
    </TooltipProvider>
  )
}

/**
 * 名字里的 `IconButton` 是**契约的一部分**，不是随手起的：本仓「纯 icon + hover 名字」这一族
 * 一律叫 `*IconButton`（`WorkbenchIconButton` 是原型），文案门岗 `check:controls` 按这个后缀
 * 判「`label` 是看得见的文字还是 hover 名字」（scripts/lib/jsxControls.mjs + control-contract-copy.mjs）。
 * 叫 `NodePromptToolButton` 时它被当成带文字的按钮，hover 名字「效果与提示词库」被按 §1.8
 * 的「≤4 字」量了一遍判红——而 §1.8 明说 hover 名字刻意不量。改名等于把这颗按钮真实的形态
 * 讲给门岗听，不是绕过它：形态一旦退化成带文字的按钮，名字就该跟着改，门岗也就该量它。
 */
type NodePromptToolIconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** 走查与簇内顺序的锚点：effects / optimize。 */
  toolId: string
  icon: React.ReactNode
  /** hover 出的那个名字，同时是 aria-label。已选值的回显也走它（运镜报「推近 · 中」）。 */
  label: string
  /** 可选的状态点已选时点亮的小圆点。 */
  active?: boolean
  /** 禁用时必须说清为什么点不了（§1.6 C1/C4）：禁用的 button 自己不触发 title，得靠外层包一层。 */
  disabledReason?: string
}

export const NodePromptToolIconButton = React.forwardRef<HTMLButtonElement, NodePromptToolIconButtonProps>(
  function NodePromptToolIconButton({ toolId, icon, label, active, disabledReason, ...buttonProps }, ref): JSX.Element {
    const button = (
      <Tooltip>
        <TooltipTrigger asChild>
          <WorkbenchIconButton
            {...buttonProps}
            ref={ref}
            size="sm"
            icon={icon}
            label={label}
            title=""
            data-prompt-tool={toolId}
          />
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    )
    return (
      <span className="relative inline-flex">
        {buttonProps.disabled && disabledReason
          ? <span title={disabledReason} style={{ display: 'contents' }}>{button}</span>
          : button}
        {active ? (
          <span
            aria-hidden
            data-prompt-tool-active="true"
            className="pointer-events-none absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-nomi-accent"
          />
        ) : null}
      </span>
    )
  },
)
