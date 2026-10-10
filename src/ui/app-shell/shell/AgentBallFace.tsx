// Agent 小球的长相（10-08 外壳拍板稿 Chrome 板「Agent 小球 · 四种状态，都不会自己弹开」）。
// 只画，不判断：状态与条数由宿主（ShellAgentHost 读 residentActivity 的角标投影）算好传进来，
// 所以设计实验室能不带宿主把四档一格一格截出来。
//   空闲：纸色圆 + Nomi 标；处理中：外面一圈 accent 环；出错：右上一粒 danger 点；
//   等你确认 N：同一位置变成 warning 胶囊（要花钱的事等你点头，不自己弹开）。
//   有未读（收起期间来了新回复 / 工具跑完）：右上一颗强调色小点（外壳共用的 DotMark，同顶栏「新版本」图标上那颗）；
//   「等你确认 N」优先：两者同时在时只出胶囊；出错点占同一个角，出错时不叠未读点（10-08 协调拍板：原有功能一个不少）。
import React, { type JSX } from 'react'
import { NomiLogoMark } from '../../../design'
import { cn } from '../../../utils/cn'
import type { V4DockStatus } from '../../../workbench/ai/v4/agentPanelV4DockStatus'
import { agentBallIsPill } from './agentFormStore'
import { DotMark } from './DotMark'

export const AgentBallFace = React.forwardRef<HTMLButtonElement, {
  status: V4DockStatus | null
  pendingCount: number
  /** 收起期间攒下的未读条数（residentActivity 角标投影的 dockUnreadCount）。 */
  unreadCount?: number
  /** 胶囊里那句（「等你确认 2」）；不是胶囊时只进 aria-label。 */
  label: string
  title?: string
  className?: string
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'title'>>(function AgentBallFace({ status, pendingCount, unreadCount = 0, label, title, className, ...rest }, ref): JSX.Element {
  const pill = agentBallIsPill(status, pendingCount)
  const unreadDot = !pill && status !== 'failed' && unreadCount > 0
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'relative flex h-11 items-center justify-center rounded-pill border-0 p-0',
        'shadow-nomi-md transition-[background,box-shadow,width] duration-nomi-fast ease-nomi-fast',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nomi-accent',
        pill
          ? 'gap-2 bg-nomi-warning-soft pl-2.5 pr-3.5 text-body-sm font-medium text-nomi-warning-ink ring-1 ring-nomi-warning-edge hover:brightness-[0.98]'
          : cn('w-11 bg-nomi-paper ring-1 ring-nomi-line-soft hover:bg-nomi-ink-05', status === 'running' && 'ring-2 ring-nomi-accent'),
        className,
      )}
      // 无障碍名带上状态（出错只有一粒点，读屏得听到「有一步没成」）。
      aria-label={title ?? label}
      title={title ?? label}
      data-agent-ball={pill ? 'pending' : status ?? 'idle'}
      data-agent-dock-status={status ?? 'idle'}
      data-agent-dock-count={pendingCount}
      data-agent-dock-unread={unreadCount}
      {...rest}
    >
      <NomiLogoMark size={pill ? 22 : 24} />
      {pill ? <span className="whitespace-nowrap tabular-nums">{label}</span> : null}
      {status === 'running' && !pill ? (
        // 真在跑才转；减弱动效时只留那圈静态 accent 环。
        <span className="pointer-events-none absolute -inset-[3px] animate-spin rounded-full border-2 border-transparent border-t-nomi-accent motion-reduce:animate-none motion-reduce:border-t-transparent" aria-hidden="true" data-agent-ball-progress />
      ) : null}
      {unreadDot ? <DotMark className="right-0 top-0 size-2.5 ring-nomi-paper" /> : null}
      {status === 'failed' && !pill ? <span className="absolute right-0 top-0 size-2.5 rounded-full bg-nomi-danger ring-2 ring-nomi-paper" aria-hidden="true" /> : null}
    </button>
  )
})
