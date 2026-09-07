// Agent 面板 v4 · 积木 ③ 一行收据（AI Elements Tool）
//
// 定稿 Vocabulary 板 ③：一行 28px = 对象 icon + 动作名 + 摘要 + 右侧状态。
// **只有「还有内容可看」才有 ›**，点开就地展开（`.rcptbody`：输入 / 输出两段 pre）。
// 技能载入、附件读取、布局改动都是它，**内联在发生的位置、不置顶**（用户点名 + 实验室 D1）。
// 失败留在原行变红 + 一句话原因，**不弹窗不 toast**（Process 板时刻 5）——
// 错误发生在哪一行就留在哪一行，用户回看时能对上。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../utils/cn'
import { ActionIcon, IconAlertTriangle, IconChevronRight, ToolStatusIcon } from './AgentPanelV4Icons'
import type { ToolReceipt, V4FlowItem } from './agentPanelV4Types'

const STATUS_TONE: Record<string, string> = {
  'output-available': 'text-nomi-success',
  'output-error': 'text-nomi-danger',
  'output-denied': 'text-nomi-danger',
}

export function V4ToolReceipt({
  receipt,
  statusLabel,
  undoLabel,
  onUndo,
}: {
  receipt: ToolReceipt
  statusLabel: string
  undoLabel?: string
  onUndo?: () => void
}): JSX.Element {
  const expandable = Boolean(receipt.input || receipt.output)
  const tone = STATUS_TONE[receipt.status] ?? 'text-nomi-accent'
  const row = (
    <>
      <span className="shrink-0 text-nomi-ink-60">
        <ActionIcon action={receipt.action} />
      </span>
      <span className="shrink-0 font-medium text-nomi-ink-80">{receipt.label}</span>
      {receipt.summary ? <span className="truncate text-micro text-nomi-ink-40">{receipt.summary}</span> : null}
      <span className={cn('ml-auto flex shrink-0 items-center gap-1 text-micro', tone)}>
        <ToolStatusIcon status={receipt.status} />
        {receipt.trailing ?? statusLabel}
        {receipt.undoable && undoLabel ? (
          // `<details>` 的 summary 里点这个钮会连带把展开体折起来——那是浏览器默认行为，
          // 不是 bug，但用户按的是「撤销」不是「收起」。stopPropagation 把两件事分开。
          <button
            type="button"
            className="text-nomi-accent"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onUndo?.()
            }}
          >
            {undoLabel}
          </button>
        ) : null}
        {/* › 只在有展开体时出现：没有内容可看的行不该给用户一个空按钮。 */}
        {expandable ? (
          <IconChevronRight
            size={12}
            className="text-nomi-ink-40 transition-transform group-open:rotate-90"
          />
        ) : null}
      </span>
    </>
  )
  if (!expandable) {
    return (
      <div
        className="flex min-h-7 items-center gap-[7px] rounded-nomi-sm px-2 text-caption text-nomi-ink-60"
        data-v4-block="tool"
        data-status={receipt.status}
      >
        {row}
      </div>
    )
  }
  return (
    <details
      open={receipt.expanded}
      className="group"
      data-v4-block="tool"
      data-status={receipt.status}
    >
      <summary
        className={cn(
          'flex min-h-7 cursor-pointer list-none items-center gap-[7px] rounded-nomi-sm px-2 text-caption text-nomi-ink-60 hover:bg-nomi-ink-05',
          'group-open:bg-nomi-ink-05',
        )}
      >
        {row}
      </summary>
      <div className="mt-1 rounded-nomi-sm border border-nomi-line-soft bg-nomi-paper px-2.5 py-2 text-caption text-nomi-ink-60">
        {receipt.input ? <ReceiptBlock labelKey="agentPanelV4.input" value={receipt.input} /> : null}
        {receipt.output ? <ReceiptBlock labelKey="agentPanelV4.output" value={receipt.output} /> : null}
      </div>
    </details>
  )
}

function ReceiptBlock({ labelKey, value }: { labelKey: string; value: string }): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="mb-1.5 last:mb-0">
      <div className="mb-0.5 text-micro text-nomi-ink-40">{t(labelKey)}</div>
      <pre className="m-0 whitespace-pre-wrap rounded-nomi-sm bg-nomi-ink-05 px-2 py-1.5 font-nomi-mono text-micro text-nomi-ink-80">
        {value}
      </pre>
    </div>
  )
}

/**
 * 同一个工具连着调 N 次时的那一行（积木 ③ 的容器态）。
 *
 * 长相与一行收据同构——icon + 动作名 + 摘要 + 右侧状态 + ›——只多一个 `×N` 计数。
 * 展开体里逐条渲染的就是普通的 `V4ToolReceipt`，所以这里没有第二套收据样式。
 *
 * 行内必须带**原因**（`reason`）：2026-09-06 用户在打包版上连吃六条
 * 「创建或修改镜头卡 · ⚠ <1s」，一个字的原因都没有，只能靠模型自己在正文里猜。
 * 一行收据的意义就是「不展开也知道发生了什么」，没有原因的失败行做不到这件事。
 */
export function V4ToolGroup({
  group,
  statusLabel,
}: {
  group: Extract<V4FlowItem, { kind: 'tool-group' }>
  statusLabel: string
}): JSX.Element {
  const { t } = useTranslation()
  const tone = STATUS_TONE[group.status] ?? 'text-nomi-accent'
  return (
    <details className="group" data-v4-block="tool-group" data-status={group.status} data-count={group.count}>
      <summary
        className={cn(
          'flex min-h-7 cursor-pointer list-none items-center gap-[7px] rounded-nomi-sm px-2 text-caption text-nomi-ink-60 hover:bg-nomi-ink-05',
          'group-open:bg-nomi-ink-05',
        )}
      >
        <span className="shrink-0 text-nomi-ink-60">
          <ActionIcon action={group.action} />
        </span>
        <span className="shrink-0 font-medium text-nomi-ink-80">{group.label}</span>
        <span className="shrink-0 font-nomi-mono text-micro text-nomi-ink-40">
          {t('agentPanelV4.toolGroupCount', { count: group.count })}
        </span>
        {group.reason ? <span className="truncate text-micro text-nomi-ink-40">{group.reason}</span> : null}
        <span className={cn('ml-auto flex shrink-0 items-center gap-1 text-micro', tone)}>
          <ToolStatusIcon status={group.status} />
          {group.trailing || statusLabel}
          <IconChevronRight size={12} className="text-nomi-ink-40 transition-transform group-open:rotate-90" />
        </span>
      </summary>
      <div className="mt-1 flex flex-col gap-0.5 border-l border-nomi-line-soft pl-1.5">
        {group.receipts.map((receipt, index) => (
          <V4ToolReceipt key={`${receipt.label}-${index}`} receipt={receipt} statusLabel={statusLabel} />
        ))}
      </div>
    </details>
  )
}

/**
 * 反复试的过程里，模型说给自己听的那几段（积木 ② 的收起态）。
 *
 * 定稿 ⑦「过程反馈按 Claude Code」：过程默认收起，只有**最终回答**摊开。
 * 平铺的时候它和最终回答一样宽、一样黑，用户得逐段读完才知道哪一段是给他的。
 */
export function V4Process({ label, segments }: { label: string; segments: readonly string[] }): JSX.Element {
  const { t } = useTranslation()
  return (
    <details className="group" data-v4-block="process" data-count={segments.length}>
      <summary className="flex min-h-7 cursor-pointer list-none items-center gap-[7px] rounded-nomi-sm px-2 text-caption text-nomi-ink-40 hover:bg-nomi-ink-05">
        <span className="shrink-0">
          <ActionIcon action="think" />
        </span>
        <span className="truncate">{label}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1 text-micro">
          {t('agentPanelV4.processExpand')}
          <IconChevronRight size={12} className="transition-transform group-open:rotate-90" />
        </span>
      </summary>
      <div className="mt-1 flex flex-col gap-1.5 border-l border-nomi-line-soft py-1 pl-2.5">
        {segments.map((segment, index) => (
          <p key={index} className="m-0 whitespace-pre-wrap text-caption text-nomi-ink-60">
            {segment}
          </p>
        ))}
      </div>
    </details>
  )
}

/**
 * 失败行下方的一句话原因 + 一个动作（`.errbar`）。付费任务必须标「未扣费」。
 * 它跟着收据或任务卡走，不是独立积木。
 */
export function V4ErrorBar({ reason, action, onAction }: { reason: string; action?: string; onAction?: () => void }): JSX.Element {
  return (
    <div
      className="flex items-center gap-2 rounded-nomi-sm bg-nomi-danger-soft px-2.5 py-1.5 text-caption text-nomi-danger"
      data-v4-block="errorbar"
    >
      <IconAlertTriangle size={13} aria-hidden="true" />
      <span className="flex-1">{reason}</span>
      {action ? (
        <button type="button" className="font-medium text-nomi-ink-80" onClick={onAction}>
          {action}
        </button>
      ) : null}
    </div>
  )
}
