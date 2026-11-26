/**
 * 设置 › 模型 首页「接别家的模型」下面那两行入口（「用 AI 帮我接入」「其他接入方式」）共用的一套行结构：
 * 拍板图 ModelSurfaces M1 的 `.card.row.g12`（内边距 10 / 12）+ 28px 图标块（描边、圆角、淡底）+ 标题 / 说明 + 行尾箭头。
 * 两行各自是不同的控件（一个 <details>，一个 <button>），所以这里只共用外观类名和内容，不共用外壳。
 */
import React, { type JSX } from 'react'
import { IconChevronRight } from '@tabler/icons-react'

import { cn } from '../../utils/cn'

/** 行外壳的外观：描边卡片 + 内边距；高度由内容（图标块 28px + 上下内边距）决定，两行一致。 */
export const MODEL_ENTRY_ROW_CLASS = 'rounded-nomi-sm border border-nomi-line bg-nomi-paper px-3 py-2.5'

/** 行内一排：图标块、文字、箭头，间距同一个令牌。 */
export const MODEL_ENTRY_HEAD_CLASS = 'flex w-full items-center gap-3 text-left'

export function ModelEntryIcon({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <span data-model-entry-icon className="grid size-7 shrink-0 place-items-center rounded-nomi-sm border border-nomi-line bg-nomi-ink-05 text-nomi-ink-80">
      {children}
    </span>
  )
}

export function ModelEntryText({ title, hint }: { title: React.ReactNode; hint: React.ReactNode }): JSX.Element {
  return (
    <span className="min-w-0 flex-1">
      <strong data-model-entry-title className="block text-body-sm font-semibold text-nomi-ink">{title}</strong>
      <span data-model-entry-hint className="block text-caption text-nomi-ink-60">{hint}</span>
    </span>
  )
}

/** 行尾箭头：「用 AI」那行展开时转 90°，由外壳的 `group-open:` 驱动，所以类名可追加。 */
export function ModelEntryChevron({ className }: { className?: string }): JSX.Element {
  return <IconChevronRight data-model-entry-chevron size={13} stroke={1.8} className={cn('shrink-0 text-nomi-ink-60', className)} aria-hidden="true" />
}
