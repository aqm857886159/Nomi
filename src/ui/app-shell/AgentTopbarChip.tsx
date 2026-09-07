// Agent 收起角标的**长相**（09-01 定稿 §11.2 缩小三档 · 收起态；样张「屏 E · 布局 · B①」）。
//
// 收起态的家是顶栏右簇「浏览器」与「设置」之间那一格，不是内容区右上角。理由在定稿里：
// 顶栏是**唯一**跨创作/分镜/生成/预览四个面常驻的 chrome，所以四个面收起后角标都落这一格、
// 切面不挪窝，win32 也一样（NomiAppBar 两平台都渲染）。画在内容区右上角的那一版每换一个面
// 就换一个落点，用户得重新找它——那正是「一功能一个家」要挡掉的东西。
//
// 这里只画，不判断：出不出、叠什么、tooltip 说什么，全由 `CollapsedAiChip` 按宿主真相算好传进来。
// 分开的理由是设计实验室：那几格要能在没有宿主的情况下把各档状态一格一格截出来。
import React from 'react'
import { NomiLogoMark, Tooltip, TooltipContent, TooltipTrigger, WorkbenchButton } from '../../design'
import { cn } from '../../utils/cn'
import { AGENT_TOPBAR_CHIP_SETTLE_MS, type AgentTopbarChipBadge } from './agentTopbarChipBadge'

/**
 * 「刚变过」是一段**时间**，不是一个属性。
 *
 * `settleKey` 每换一个值就重新点一次表（未读数变了 = 来了新动静）。表走完把类名摘掉，
 * 动画因此只播一遍：`animation` 留在元素上时，任何一次重排都可能让它重播成「常闪」。
 */
function useSettlePulse(settleKey: string | number): boolean {
  const [settling, setSettling] = React.useState(false)
  const first = React.useRef(true)
  React.useEffect(() => {
    if (first.current) {
      first.current = false
      return undefined
    }
    setSettling(true)
    const timer = setTimeout(() => setSettling(false), AGENT_TOPBAR_CHIP_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [settleKey])
  return settling
}

/**
 * 两种长相都**骑在钮的右上角**，不排进钮的行里。
 *
 * `TaskCenterButton` 的数字是排进行里的，因为那颗钮忙起来整块填 accent、数字反白刚好；
 * 这颗是透明 ghost 钮，纸色数字落在纸色顶栏上就是隐形，而且窄窗（≤1600）它要收成 30px 方块，
 * 行里再挂一粒就撑破那个方块。所以数字粒沿用它的**语法**（`min-w-4 rounded-pill text-micro
 * tabular-nums`），换掉的只是配色方向：accent 底、纸色字——和旁边那颗蓝点同一族。
 */
function ChipBadge({ badge, settling }: { badge: AgentTopbarChipBadge; settling: boolean }): JSX.Element | null {
  if (badge.kind === 'none') return null
  // 脉冲只加在**出现/变多**的那一刻，之后角标就静静待着。`motion-reduce` 一起摘掉。
  const settle = settling ? 'animate-nomi-badge-settle motion-reduce:animate-none' : undefined
  const settleAttr = settling ? { 'data-agent-dock-settle': 'true' } : {}
  if (badge.kind === 'dot') {
    return (
      <span
        className={cn('pointer-events-none absolute -right-0.5 -top-0.5 size-2 rounded-pill bg-nomi-accent', settle)}
        data-agent-dock-badge="dot"
        {...settleAttr}
        aria-hidden="true"
      />
    )
  }
  return (
    <span
      className={cn(
        'pointer-events-none absolute -right-1 -top-1 min-w-4 rounded-pill bg-nomi-accent px-1',
        'text-center text-micro leading-4 tabular-nums text-nomi-paper',
        settle,
      )}
      data-agent-dock-badge="count"
      {...settleAttr}
      aria-hidden="true"
    >
      {badge.count}
    </span>
  )
}

/**
 * 顶栏那一格角标。形态**逐条复刻**它的邻居（浏览器 / 设置那两颗 ghost 钮）：
 * `h-[30px]` + `px-2.5` + `gap-1.5` + `rounded-[var(--nomi-radius-sm)]`，窄窗（≤1600）
 * 一起收成 30px 方块。不复刻就会在一排等高的钮里冒出一颗不一样高的，那是最刺眼的那种不一致。
 *
 * logo 用的是同一枚 `NomiLogoMark`：几何只有一个持有者（P1），角标不重画一份 N。
 */
export function AgentTopbarChip({
  label,
  tooltip,
  status,
  badge,
  settleKey = 0,
  onOpen,
  reason,
}: {
  /** 钮上那个词（窄窗隐藏，只剩 logo）。 */
  label: string
  /** hover 那一行人话 + 无障碍名共用同一句（同一件事两个说法就是 R14.1 要横扫的）。 */
  tooltip: string
  /** 五档注意力状态。**只进 tooltip 与这个属性**，不各画一种图形。 */
  status: string
  badge: AgentTopbarChipBadge
  /** 换值 = 来了新动静，点一次 420ms 的表。 */
  settleKey?: string | number
  onOpen: () => void
  /** 这颗角标为什么在（`resident-collapsed` / `deconstruction-exclusive`）。同格只出一颗，理由不同、家相同。 */
  reason: string
}): JSX.Element {
  const settling = useSettlePulse(settleKey)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <WorkbenchButton
          className={cn(
            'nomi-appbar__ghost',
            'app-no-drag relative',
            'inline-flex items-center gap-1.5 h-[30px] px-2.5',
            'border border-transparent rounded-[var(--nomi-radius-sm)]',
            'bg-transparent text-[var(--nomi-ink-80)] font-inherit text-body-sm',
            'transition-[background,color] duration-[var(--nomi-transition-fast)]',
            'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
            'max-[1600px]:w-[30px] max-[1600px]:justify-center max-[1600px]:p-0',
          )}
          aria-label={tooltip}
          data-agent-topbar-badge="true"
          data-v4-block="dock"
          data-v4-control="dock-open"
          data-agent-dock-reason={reason}
          data-agent-dock-status={status}
          data-agent-dock-badge-kind={badge.kind}
          data-agent-dock-count={badge.kind === 'count' ? badge.count : 0}
          onClick={onOpen}
        >
          <NomiLogoMark size={18} />
          <span className={cn('nomi-appbar__action-text', 'max-[1600px]:hidden')}>{label}</span>
          <ChipBadge badge={badge} settling={settling} />
        </WorkbenchButton>
      </TooltipTrigger>
      {/* tooltip 落在 portal 里（不在钮的子树中），走查按 `data-agent-dock-hint` 从窗口根找它。 */}
      <TooltipContent side="bottom" data-agent-dock-hint="true">{tooltip}</TooltipContent>
    </Tooltip>
  )
}
