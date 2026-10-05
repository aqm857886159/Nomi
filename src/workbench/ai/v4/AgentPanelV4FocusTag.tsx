/**
 * Agent 输入框上的「正在改：镜头 N」标签（3D-BOX，Claude Design 画布「3D-BOX · 正在改：镜头 N」，用户 10-06 拍板）。
 *
 * 纯展示：文字、提示、清除动作都由容器给。它不是附件 chip——不随发送清掉，反映的是导演台此刻的选中；
 * × 清的是导演台里的选中（唯一 owner），标签跟着消失。
 * 长相按画布：26px 高、8px 圆角、accent 淡底 + accent 边，左摄像机图标、主文字、浅色实测（只在单镜时有）、右 ×。
 */
import React, { type JSX } from 'react'
import { IconVideo, IconX } from '../../../vendor/tablerIcons'

export type AgentPanelV4FocusTagProps = Readonly<{
  label: string
  /** 「· 中近景 · 固定」：单选一镜且量得到时才有。 */
  detail?: string
  hint: string
  clearLabel: string
  onClear: () => void
}>

export function AgentPanelV4FocusTag({ label, detail, hint, clearLabel, onClear }: AgentPanelV4FocusTagProps): JSX.Element {
  return (
    <span
      className="inline-flex h-[26px] max-w-full shrink-0 items-center gap-1.5 self-start whitespace-nowrap rounded-nomi-sm border border-nomi-accent/30 bg-nomi-accent-soft pl-2 pr-1 text-caption"
      title={hint}
      data-v4-focus-tag="director-shot"
    >
      <IconVideo size={16} stroke={1.75} className="shrink-0 text-nomi-accent" aria-hidden="true" />
      <span className="min-w-0 truncate font-medium text-nomi-ink">{label}</span>
      {detail ? <span className="min-w-0 truncate text-nomi-ink-60">{detail}</span> : null}
      <button
        type="button"
        className="grid size-5 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-60 hover:bg-nomi-ink-05"
        aria-label={clearLabel}
        title={clearLabel}
        onClick={onClear}
      >
        <IconX size={14} stroke={1.75} aria-hidden="true" />
      </button>
    </span>
  )
}
