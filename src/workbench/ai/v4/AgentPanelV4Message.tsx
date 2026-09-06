// Agent 面板 v4 · 积木 ① 用户气泡 · ② 助手文本（含思考行）
//
// 定稿 Vocabulary 板 ①②：用户气泡右对齐 ink 深底，附件缩成 chip **在气泡内**；
// 助手文本纯文本无框（AI Elements Message assistant 无底色），三态只改行尾：
// 生成中光标 · 完成（**hover 才显**复制/重来）· 已中断（灰字 + 继续）。超长只折叠不换形态。
//
// 思考行是 Process 板时刻 2：shimmer 文字 +「4s · esc 打断」。刻意**不用转圈**——
// 转圈没有时间感，秒数才告诉用户「没死」。它是助手文本的一个状态，不是第九个积木。
import React from 'react'
import { cn } from '../../../utils/cn'
import { AgentPanelV4Markdown } from './AgentPanelV4Markdown'
import { ActionIcon, IconChevronRight, IconCopy, IconRefresh } from './AgentPanelV4Icons'
import { Message, MessageActions, MessageResponse } from './vendor/aiElementsPrimitives'
import type { V4AssistantStatus, V4Chip } from './agentPanelV4Types'

/** 附件 / 技能 / 选中片段三种 chip **同一形态**（定稿 Composer 板批注）。 */
function BubbleChip({ chip, onDark }: { chip: V4Chip; onDark: boolean }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-nomi-sm px-2 py-0 pl-1 text-micro',
        onDark ? 'bg-nomi-paper/15' : 'border border-nomi-line text-nomi-ink-80',
      )}
      data-v4-chip={chip.kind}
    >
      <span
        className={cn(
          'h-3 w-4 shrink-0 rounded-sm',
          chip.kind === 'clip' ? 'bg-nomi-track-video' : onDark ? 'bg-nomi-paper/40' : 'bg-nomi-ink-20',
        )}
        aria-hidden="true"
      />
      <span className="truncate">{chip.label}</span>
    </span>
  )
}

export function V4UserBubble({
  text,
  chips,
  darkMode = false,
}: {
  text: string
  chips?: readonly V4Chip[]
  darkMode?: boolean
}): JSX.Element {
  return (
    <div
      className={cn(
        'ml-auto max-w-[86%] rounded-nomi px-3 py-2 text-body-sm',
        // 暗色下用 ink-10 底而不是纯黑（定稿 Dark 板批注）：token 翻转后纯 ink 会变成浅色块。
        darkMode ? 'bg-nomi-ink-10 text-nomi-ink' : 'bg-nomi-ink text-nomi-paper',
      )}
      data-v4-block="user"
    >
      {chips?.length ? (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <BubbleChip key={chip.label} chip={chip} onDark={!darkMode} />
          ))}
        </div>
      ) : null}
      <p className="m-0">{text}</p>
    </div>
  )
}

export function V4AssistantMessage({
  text,
  status,
  labels,
  panelHeight,
}: {
  text: string
  status: V4AssistantStatus
  labels: { copy: string; retry: string; continue: string }
  /** 折叠阈值由它 derive（定稿：超过面板高 60% 折起来）。单件取景时不给 = 不折。 */
  panelHeight?: number
}): JSX.Element {
  return (
    <div className="group" data-v4-block="assistant" data-status={status}>
      <Message role="assistant">
        <MessageResponse streaming={status === 'streaming'}>
          {status === 'interrupted' ? (
            <p className="m-0 text-body-sm text-nomi-ink-60">{text}</p>
          ) : (
            <AgentPanelV4Markdown text={text} panelHeight={panelHeight} streaming={status === 'streaming'} />
          )}
        </MessageResponse>
        {/* 完成态才有动作，且 **hover 才显**——定稿 ②「hover 出复制/重来两个图标」。 */}
        {status === 'complete' ? (
          <MessageActions className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <button
              type="button"
              aria-label={labels.copy}
              className="grid size-[22px] place-items-center rounded-nomi-sm hover:bg-nomi-ink-05"
            >
              <IconCopy size={14} />
            </button>
            <button
              type="button"
              aria-label={labels.retry}
              className="grid size-[22px] place-items-center rounded-nomi-sm hover:bg-nomi-ink-05"
            >
              <IconRefresh size={14} />
            </button>
          </MessageActions>
        ) : null}
        {status === 'interrupted' ? (
          <button
            type="button"
            className="mt-1 inline-flex items-center gap-1 text-caption text-nomi-ink-60"
          >
            {labels.continue}
            <IconChevronRight size={12} />
          </button>
        ) : null}
      </Message>
    </div>
  )
}

/**
 * 思考行（Process 板时刻 2）。`brain` icon **只在这一行出现**，秒数与 esc 提示在同一行右端。
 * shimmer 走背景渐变裁字，不是骨架屏。
 */
export function V4Thinking({ label, meta }: { label: string; meta: string }): JSX.Element {
  return (
    <div className="inline-flex h-7 items-center gap-2 text-caption text-nomi-ink-60" data-v4-block="thinking">
      <ActionIcon action="think" />
      <span className="bg-gradient-to-r from-nomi-ink-40 via-nomi-ink to-nomi-ink-40 bg-clip-text text-transparent">
        {label}
      </span>
      <span className="ml-auto font-nomi-mono text-micro text-nomi-ink-40">{meta}</span>
    </div>
  )
}
