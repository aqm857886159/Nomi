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
import { contextPercent } from './agentPanelV4Projection'

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
  const kilo = (value: number): string => `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}K`
  const rows = ([
    [labels.input, usage.input],
    [labels.output, usage.output],
    [labels.reasoning, usage.reasoning],
    [labels.cache, usage.cache],
  ] as const).filter((row): row is readonly [string, string] => Boolean(row[1]))
  return (
    <details
      className="relative"
      open={expanded}
      data-v4-block="context"
      data-context-known={percent === undefined ? undefined : 'true'}
      onToggle={(event) => onToggle?.((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary
        className={cn(
          'inline-flex h-[22px] cursor-pointer list-none items-center gap-[5px] rounded-pill border border-nomi-line text-micro font-normal text-nomi-ink-60',
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
            ? labels.usedOnly.replace('{{amount}}', kilo(usage.used))
            : labels.unknown}
        <IconChevronDown size={11} />
      </summary>
      <div className="absolute right-0 top-full z-10 mt-1 w-[230px] overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper text-caption shadow-nomi-md">
        <div className="p-2.5 pb-0">
          <div className="flex items-center justify-between">
            <strong>{percent === undefined ? labels.unknown : `${percent}%`}</strong>
            {usage.used !== undefined ? (
              <span className="text-nomi-ink-60">
                {kilo(usage.used)}
                {usage.max !== undefined ? ` / ${kilo(usage.max)}` : ''}
              </span>
            ) : null}
          </div>
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
                <div key={term} className="flex justify-between py-0.5 text-nomi-ink-60">
                  <dt>{term}</dt>
                  <dd className="m-0 font-medium text-nomi-ink">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
        {usage.cost ? (
          <footer className="flex justify-between bg-nomi-ink-05 px-2.5 py-2 font-medium">
            <span>{labels.threadCost}</span>
            <span>{usage.cost}</span>
          </footer>
        ) : null}
      </div>
    </details>
  )
}
