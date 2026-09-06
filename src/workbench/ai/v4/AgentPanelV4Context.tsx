// Agent 面板 v4 · 积木 ⑧ 上下文用量（AI Elements Context）
//
// 定稿 Vocabulary 板 ⑧：头部一个小环 + 百分比，展开出**真实** token 分项与本线程花费。
// 它替换的是现役那句「还能聊 ~40 轮」的估计（用户点名要真实用量）。
// 环用 conic-gradient 画（`.ctx .ring`），不是 SVG 描边——两者在 12px 上的观感差一圈毛边。
import React from 'react'
import { IconChevronDown } from './AgentPanelV4Icons'
import type { ContextUsage } from './agentPanelV4Types'

export function V4ContextRing({
  usage,
  labels,
  expanded = false,
}: {
  usage: ContextUsage
  labels: {
    context: string
    input: string
    output: string
    reasoning: string
    cache: string
    threadCost: string
  }
  expanded?: boolean
}): JSX.Element {
  const percent = Math.min(100, Math.round((usage.used / usage.max) * 100))
  // 画布写的是「62.4K / 200K」不是「62,400 / 200,000」——230px 宽的卡里，
  // 千分位把这一行挤成两截，而用户要的是一眼看出比例。
  const kilo = (value: number): string => `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}K`
  const rows: readonly [string, string][] = [
    [labels.input, usage.input],
    [labels.output, usage.output],
    [labels.reasoning, usage.reasoning],
    [labels.cache, usage.cache],
  ]
  return (
    <details className="relative" open={expanded} data-v4-block="context">
      <summary
        className="inline-flex h-[22px] cursor-pointer list-none items-center gap-[5px] rounded-pill border border-nomi-line pl-[5px] pr-2 text-micro font-normal text-nomi-ink-60"
        aria-label={labels.context}
      >
        <span
          className="relative size-3 shrink-0 rounded-pill after:absolute after:inset-[2.5px] after:rounded-pill after:bg-nomi-paper after:content-['']"
          style={{
            background: `conic-gradient(var(--nomi-accent) ${percent}%, var(--nomi-ink-10) 0)`,
          }}
          aria-hidden="true"
        />
        {percent}%
        <IconChevronDown size={11} />
      </summary>
      <div className="absolute right-0 top-full z-10 mt-1 w-[230px] overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper text-caption shadow-nomi-md">
        <div className="p-2.5 pb-0">
          <div className="flex items-center justify-between">
            <strong>{percent}%</strong>
            <span className="text-nomi-ink-60">
              {kilo(usage.used)} / {kilo(usage.max)}
            </span>
          </div>
          <div className="my-2 h-1 overflow-hidden rounded-sm bg-nomi-ink-10">
            <div className="h-full rounded-sm bg-nomi-accent" style={{ width: `${percent}%` }} />
          </div>
          <dl className="m-0 grid gap-0.5 pb-2.5">
            {rows.map(([term, value]) => (
              <div key={term} className="flex justify-between py-0.5 text-nomi-ink-60">
                <dt>{term}</dt>
                <dd className="m-0 font-medium text-nomi-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <footer className="flex justify-between bg-nomi-ink-05 px-2.5 py-2 font-medium">
          <span>{labels.threadCost}</span>
          <span>{usage.cost}</span>
        </footer>
      </div>
    </details>
  )
}
