// Agent 面板 v4 · 积木 ⑦ 收起坞（我们独有，AI Elements / Beautiful UI 都没有对应件）
//
// 定稿 Collapsed 板：结果全屏时右栏收成一根 **32px** 图标条，Nomi 图标带运行状态点；
// 同一个 composer 和介入槽落到画面下沿居中，**对话不中断**。
// 来源是 MiniMax「在画布中查看」的反向——内容优先时对话别消失。
import React from 'react'
import { cn } from '../../../utils/cn'
import { IconLayoutSidebarRightCollapse, IconMessage } from './AgentPanelV4Icons'

export function V4CollapsedRail({
  running = false,
  labels,
}: {
  running?: boolean
  labels: { conversation: string; adjust: string }
}): JSX.Element {
  return (
    <div
      className="flex h-full w-8 flex-col items-center gap-1.5 border-l border-nomi-line-soft bg-nomi-paper pt-2"
      data-v4-block="dock"
    >
      <button
        type="button"
        aria-label={labels.conversation}
        className="relative grid size-6 place-items-center rounded-nomi-sm bg-nomi-accent-soft text-nomi-accent"
      >
        <IconMessage size={14} />
        {/* 运行状态点：收起了也要知道 Nomi 还在跑。 */}
        <span
          className={cn(
            'absolute right-0.5 top-0.5 size-1.5 rounded-pill',
            running ? 'bg-nomi-accent' : 'bg-transparent',
          )}
          aria-hidden="true"
        />
      </button>
      <button
        type="button"
        aria-label={labels.adjust}
        className="grid size-6 place-items-center rounded-nomi-sm text-nomi-ink-60"
      >
        <IconLayoutSidebarRightCollapse size={14} />
      </button>
    </div>
  )
}
