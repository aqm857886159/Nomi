import { V4Row } from './AgentPanelV4Row'
import { formatV4Tokens } from './agentPanelV4UsageFormat'
import { resolveAnchoredPlacement } from '../../generationCanvas/nodes/anchoredPlacement'
// Agent 面板 v4 · 积木 ⑧ 上下文用量（AI Elements Context）
//
// 定稿 Vocabulary 板 ⑧：头部一个小环 + 百分比，展开出**真实** token 分项与本线程花费。
// 它替换的是现役那句「还能聊 ~40 轮」的估计（用户点名要真实用量）。
// 环用 conic-gradient 画（`.ctx .ring`），不是 SVG 描边——两者在 12px 上的观感差一圈毛边。
//
// 接线后新增的一条纪律：**每个数都可能没有**（`ContextUsage` 全部可选）。
// 没有 `max` 就没有百分比可算——那时环画成整圈 ink-10（灰），钮上显示 `—` 而不是 `0%`。
// `0%` 是一个断言（「你几乎没用上下文」），而我们那一刻其实是「不知道这个模型多大」。
// 分项同理：宿主没给的行整行不渲染，不留 `0` 也不留 `—` 占位——空行是噪音。
import React from 'react'
import { cn } from '../../../utils/cn'
import { IconChevronDown } from './AgentPanelV4Icons'
import type { ContextUsage } from './agentPanelV4Types'

function contextPercent(usage: ContextUsage): number | undefined {
  if (usage.used === undefined || usage.max === undefined || usage.max <= 0) return undefined
  return Math.min(100, Math.round((usage.used / usage.max) * 100))
}

export function V4ContextRing({
  usage,
  labels,
  expanded = false,
  onToggle,
}: {
  usage: ContextUsage
  labels: {
    context: string
    input: string
    output: string
    reasoning: string
    cache: string
    threadCost: string
    /** 「这个数我们没有」的占位。只用在钮上那一处，分项行是整行不渲染。 */
    unknown: string
    /** 没有分母、但有用量时钮上那句话（`{{amount}}` 占位）。 */
    usedOnly: string
  }
  expanded?: boolean
  onToggle?: (open: boolean) => void
}): JSX.Element {
  const percent = contextPercent(usage)
  // 画布写的是「62.4K / 200K」不是「62,400 / 200,000」——230px 宽的卡里，
  // 千分位把这一行挤成两截，而用户要的是一眼看出比例。
  const anchorRef = React.useRef<HTMLDetailsElement>(null)
  const popoverRef = React.useRef<HTMLDivElement>(null)
  const [open, setOpen] = React.useState(expanded)
  const [position, setPosition] = React.useState<React.CSSProperties>({ left: 0 })
  React.useLayoutEffect(() => {
    const anchor = anchorRef.current
    const popover = popoverRef.current
    if (!open || !anchor || !popover) return
    const panel = anchor.closest('[data-v4-panel], [data-agent-panel], .workbench-generation__ai') ?? anchor.parentElement?.parentElement
    const update = () => {
      const bounds = panel?.getBoundingClientRect()
      const node = anchor.getBoundingClientRect()
      const placement = resolveAnchoredPlacement({
        stage: { left: Math.max(0, bounds?.left ?? 0), right: Math.min(window.innerWidth, bounds?.right ?? window.innerWidth), top: Math.max(0, bounds?.top ?? 0), bottom: Math.min(window.innerHeight, bounds?.bottom ?? window.innerHeight) },
        anchor: node, width: 230, height: popover.scrollHeight, gap: 4, aboveClearance: 0,
      })
      setPosition({ left: placement.left - node.left, top: placement.top - node.top, width: placement.width, maxHeight: placement.height })
    }
    update()
    const observer = new ResizeObserver(update)
    if (panel) observer.observe(panel)
    window.addEventListener('resize', update)
    return () => { observer.disconnect(); window.removeEventListener('resize', update) }
  }, [open])
  const rows = ([
    [labels.input, usage.input],
    [labels.output, usage.output],
    [labels.reasoning, usage.reasoning],
    [labels.cache, usage.cache],
  ] as const).filter((row): row is readonly [string, string] => Boolean(row[1]))
  return (
    <details
      ref={anchorRef}
      className="relative"
      open={expanded}
      data-v4-block="context"
      data-context-known={percent === undefined ? undefined : 'true'}
      onToggle={(event) => { setOpen(event.currentTarget.open); onToggle?.(event.currentTarget.open) }}
    >
      <V4Row as="summary"
        className={cn(
          'h-[22px] cursor-pointer list-none rounded-pill border border-nomi-line text-micro font-normal text-nomi-ink-60',
          percent === undefined ? 'px-2' : 'pl-[5px] pr-2',
        )}
        aria-label={labels.context}
      >
        {/* 没有分母就**不画环**。一个恒定的灰圈是个假仪表：它长得和「用量为 0」一模一样，
            而我们那一刻其实是「不知道这个模型多大」。这时候钮上改说一句我们真的知道的话——
            「已用 12.3k」。连用量都没有（一个回合都还没结算）才退回「—」。
            2026-09-06 打包版实测：真实目录里的对话模型全都没写 contextWindow，
            于是用户看到的是一整排空圈 + 「—」，一个能读的数都没有。 */}
        {percent === undefined ? null : (
          <span
            className="relative size-3 shrink-0 rounded-pill after:absolute after:inset-[2.5px] after:rounded-pill after:bg-nomi-paper after:content-['']"
            style={{ background: `conic-gradient(var(--nomi-accent) ${percent}%, var(--nomi-ink-10) 0)` }}
            aria-hidden="true"
          />
        )}
        {percent !== undefined
          ? `${percent}%`
          : usage.used !== undefined
            ? labels.usedOnly.replace('{{amount}}', formatV4Tokens(usage.used))
            : labels.unknown}
        <IconChevronDown size={11} />
      </V4Row>
      <div ref={popoverRef} style={position} className="absolute left-0 top-full z-10 w-[230px] overflow-auto rounded-nomi border border-nomi-line bg-nomi-paper text-caption shadow-nomi-md">
        <div className="p-2.5 pb-0">
          <V4Row as="div" className="">
            <strong>{percent === undefined ? labels.unknown : `${percent}%`}</strong>
            {usage.used !== undefined ? (
              <span className="text-nomi-ink-60">
                {formatV4Tokens(usage.used)}
                {usage.max !== undefined ? ` / ${formatV4Tokens(usage.max)}` : ''}
              </span>
            ) : null}
          </V4Row>
          {/* 进度条和环读同一个 `percent`。没有百分比时不画一根 0 宽的条——
              那看起来像「用量是 0」，而不是「不知道」。 */}
          {percent === undefined ? null : (
            <div className="my-2 h-1 overflow-hidden rounded-sm bg-nomi-ink-10">
              <div className="h-full rounded-sm bg-nomi-accent" style={{ width: `${percent}%` }} />
            </div>
          )}
          {rows.length ? (
            <dl className="m-0 grid gap-0.5 pb-2.5">
              {rows.map(([term, value]) => (
                <div key={term} className="flex gap-1.5 py-0.5 text-nomi-ink-60">
                  <dt>{term}</dt>
                  <dd className="m-0 font-medium text-nomi-ink">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
        {usage.cost ? (
          <footer className="flex gap-1.5 bg-nomi-ink-05 px-2.5 py-2 font-medium">
            <span>{labels.threadCost}</span>
            <span>{usage.cost}</span>
          </footer>
        ) : null}
      </div>
    </details>
  )
}
