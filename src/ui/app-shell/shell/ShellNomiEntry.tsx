// 顶栏最右那颗 Nomi 入口（NomiEntryTopbar 板 nomi-entry；设计卡 docs/plan/2026-11-22-nomi-entry-topbar.md + 2026-11-28 方案 A 开合舞台移交）。
// 收起的面板只从这里叫回（取代内容区右下的小球）：点一下开 / 收，⌘J、⌘\、别处的「叫回」都落到同一个形态 store。
//   收起（!open）：28px 图标钮里一张 26px 的 NomiAgentFace（live），五种状态；放得下（≥900）且有待确认时整颗钮长成浅橙胶囊「等你确认 N」，否则脸 + 角标 / 红蓝点；
//   打开（open）：活小人移交舞台至下方 AgentPanelV4Panel 头部，顶栏入口退成安静的线性侧栏开关图标（按下底色 ink-10，全屏最多 1 颗活小人）。
// 长相判断只在 nomiEntryLook 里做一次；分两层：useNomiEntry（useNomiEntry.ts）读 store 算好，NomiEntryButton 只画（设计实验室经 NomiEntryPreview 用它）。
import React, { type JSX } from 'react'
import { IconLayoutSidebarRightCollapse } from '@tabler/icons-react'
import { NomiAgentFace } from '../../../design'
import { cn } from '../../../utils/cn'
import { BAR_ICON_BUTTON } from './barIconButton'
import { DotMark } from './DotMark'
import type { NomiEntryLook } from './nomiEntryLook'
import { useNomiEntryView, type NomiEntryState } from './useNomiEntry'

/** 入口里那张脸的边长（按钮 28，四周各留 1）。 */
const NOMI_ENTRY_FACE_SIZE = 26

type NomiEntryButtonProps = {
  look: NomiEntryLook
  pendingCount: number
  /** 胶囊里那句（「等你确认 N」）；不是胶囊时不画。 */
  capsuleText: string
  /** 面板此刻开着（按下底色、aria-pressed）。 */
  open: boolean
  /** 悬停 / 读屏那一句（宿主外面那层 BarTooltip 用同一句）。 */
  label: string
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label' | 'aria-pressed'>

export const NomiEntryButton = React.forwardRef<HTMLButtonElement, NomiEntryButtonProps>(function NomiEntryButton(
  { look, pendingCount, capsuleText, open, label, className, ...rest },
  ref,
): JSX.Element {
  const capsule = look.shape === 'capsule'
  // 角标 / 点外圈描一圈「它底下那块」的颜色：静止 = 外壳底色，悬停 = ink-05，按下 = ink-10（板上 under）。
  const under = open ? 'ring-nomi-ink-10' : 'ring-nomi-chrome group-hover/entry:ring-nomi-ink-05'
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'group/entry',
        capsule
          ? cn(
            'app-no-drag relative inline-flex h-7 shrink-0 items-center gap-1.5 rounded-pill border-0 pl-2 pr-2.5',
            'bg-nomi-warning-soft text-nomi-warning-ink ring-1 ring-inset ring-nomi-warning-edge',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-nomi-ink',
          )
          : cn(BAR_ICON_BUTTON, open && 'bg-nomi-ink-10 hover:bg-nomi-ink-10'),
        className,
      )}
      aria-label={label}
      aria-pressed={open}
      data-shell-nomi-entry
      data-status={look.status}
      data-pending={pendingCount}
      data-shape={look.shape}
      {...rest}
    >
      {capsule ? (
        <>
          {/* 胶囊里的两只眼（照搬旧小球胶囊的长相：浅橙底、橙描边、橙字，2026-10-27 形象）。 */}
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true" className="block shrink-0">
            <rect x="0" y="0" width="4.4" height="11" rx="2.2" fill="currentColor" />
            <rect x="6.6" y="0" width="4.4" height="11" rx="2.2" fill="currentColor" />
          </svg>
          <span className="whitespace-nowrap text-body-sm font-semibold tabular-nums" data-nomi-entry-capsule>{capsuleText}</span>
        </>
      ) : look.shape === 'toggle' ? (
        <IconLayoutSidebarRightCollapse aria-hidden="true" data-nomi-entry-toggle="" />
      ) : (
        <>
          {/* 脸的舞台下沿比上沿多留一个形象单位：整体上移 1px，让 22u 的身体在 28px 钮里正中。 */}
          <span className="pointer-events-none absolute left-px top-0 block size-[26px]" aria-hidden="true">
            <NomiAgentFace pose={look.status} size={NOMI_ENTRY_FACE_SIZE} className="[&_[data-nomi-agent-body]]:shadow-none" ringProps={{ 'data-nomi-entry-progress': true }} />
          </span>
          {look.badge ? (
            <span
              className={cn(
                'pointer-events-none absolute -top-1 right-0 h-3.5 min-w-3.5 rounded-pill px-1 text-center text-micro font-semibold leading-[14px] tabular-nums',
                'bg-nomi-warning-soft text-nomi-warning-ink shadow-[inset_0_0_0_1px_var(--nomi-warning-edge)] ring-2',
                under,
              )}
              aria-hidden="true"
              data-nomi-entry-badge
            >
              {look.badge}
            </span>
          ) : null}
          {look.dot ? <DotMark tone={look.dot === 'failed' ? 'danger' : 'accent'} className={cn('right-px top-0.5 size-[7px]', under)} data-nomi-entry-dot={look.dot} /> : null}
        </>
      )}
    </button>
  )
})

/** 设计实验室用：按给定原料画一颗入口（不读 store、不接点击）。 */
export function NomiEntryPreview({ className, ...state }: NomiEntryState & { className?: string }): JSX.Element {
  const view = useNomiEntryView(state)
  return <NomiEntryButton look={view.look} pendingCount={state.pendingCount} capsuleText={view.capsuleText} open={state.open} label={view.label} title={view.label} className={className} />
}
