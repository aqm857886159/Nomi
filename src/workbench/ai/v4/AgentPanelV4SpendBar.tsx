// Agent 面板 v4 · ⑤ 介入槽的**付费那一档**：花钱的确认只有这一种长相（2026-11-22 从 `V4Intervention` 拆出来，换 + 删）。
//
// kind='spend' 的卡都画在这里，不分是哪一家产的：
// · 对话里起草的镜头的确认条（`agentPanelSpendCard` 投影：一行共同参数 + 两颗按钮，SpendAskSplit 板）；
// · lane 付费工具的审批（标题 + 徽章 + 「范围：仅这一次」）；
// · 设计实验室的分镜批量样张（计划行）。
// 标题、徽章、范围、计划行**有就画、没有就不画**——按数据有无，不按 kind 或产地分支。
//
// 和审批 / 提问卡（`V4Intervention`）只差三处，都出自 SpendAskSplit 板：
// · 按钮一行用设计系统 `WorkbenchButton size="md"`（32px 高、13px 字），主按钮再加粗。
//   板上是 13px / 600 / 约 30px（`source/Rows.dc.html` 的 `.b1` / `.b2`）；尺寸阶梯上没有 30，取 md 那一档 32，不写任意值。
// · 参数一行和按钮一行之间不画横线（ask.params / ask.actions）。
// · 正在发出 / 没成两态（ask.sending / card.failure）：标题前转圈或警示、外框换警示色、「先不发了」「去改镜 N」。
// 标题行、卡体、拒绝原因的渐进披露和审批卡是同一份（`AgentPanelV4SlotShell.tsx` 的卡族零件），不各写一份。
import React, { type JSX } from 'react'
import { WorkbenchButton } from '../../../design'
import { IconAlertTriangle, IconChevronRight, IconFocus2, StatusSpinner } from './AgentPanelV4Icons'
import { V4Row } from './AgentPanelV4Row'
import { SlotContent, SlotRejectActions, slotTitle, useSlotReject, V4SlotShell } from './AgentPanelV4SlotShell'
import type { InterventionData } from './agentPanelV4Types'

/**
 * 逐镜价格折叠（SpendCardQ1 板 card.per-shot，D5）。
 *
 * 只在各镜价格不同时出现（投影定的）：折叠口一句「逐镜」，展开每镜一行「镜号 · 模型 · 比例 · 时长」+ 那一镜的价。
 * 合计金额哪里都不印（10-08「界面不谈钱」）；算不出价的那一档投影根本不给这一块——不是印 `¥0`。
 */
function V4PriceRow({ price }: { price: NonNullable<InterventionData['price']> }): JSX.Element {
  return (
    <details className="group" data-v4-block="price-per-item">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-micro text-nomi-ink-40">
        <IconChevronRight size={12} className="group-open:rotate-90" aria-hidden="true" />
        {price.perItemLabel}
      </summary>
      <div className="mt-1 flex flex-col gap-0.5">
        {price.perItem.map((item) => (
          <V4Row as="div" key={item.label} className="text-micro text-nomi-ink-60">
            <span className="min-w-0 truncate">{item.label}</span>
            <span className="shrink-0 tabular-nums">{item.amount}</span>
          </V4Row>
        ))}
      </div>
    </details>
  )
}

export function V4SpendBar({
  data,
  confirmRef,
  body,
  labels,
  onConfirm,
  onReject,
  onPlanToggle,
  planCollapsed = false,
  waiting = true,
}: {
  data: InterventionData
  confirmRef?: React.Ref<HTMLButtonElement>
  /** 卡体（指向元素 + 说明行，`AgentPanelV4SpendCardBody`）。给了就替掉 `data.params` 那排只读 chip。 */
  body?: React.ReactNode
  labels: { confirm: string; reject: string; cancel: string; confirmReject: string }
  onConfirm?: () => void
  onReject?: (reason?: string) => void
  /** 计划行勾选（实验室分镜批量样张带计划行）。必填，理由同 `V4Intervention.onPlanToggle`。 */
  onPlanToggle: (label: string, checked: boolean) => void
  planCollapsed?: boolean
  /** 缺席 = 在等（推导见 `V4SlotShell.waiting`）。正在发出时不装成还在等人点。 */
  waiting?: boolean
}): JSX.Element {
  const reject = useSlotReject(data, onReject)
  // 否定钮任何时候都能点（不随动作在路上置灰）；没成时说「先不发了」（板 card.failure.decline）。
  const dismiss = (
    <WorkbenchButton size="md" className="shrink-0" onClick={reject.dismiss} data-v4-control="slot-dismiss">
      {data.dismissLabel ?? labels.reject}
    </WorkbenchButton>
  )
  // 标题前的图标只在两种时候有（板 card.progress / card.failure）：正在发出（转圈）、没成（警示）。
  const titleIcon = data.progress
    ? <span className="shrink-0 self-center text-nomi-accent" data-v4-block="slot-title-icon"><StatusSpinner size={14} /></span>
    : data.failed
      ? <span className="shrink-0 self-center text-nomi-danger-ink" data-v4-block="slot-title-icon"><IconAlertTriangle size={14} aria-hidden="true" /></span>
      : null
  const title = slotTitle(data, titleIcon)
  const footer = (
    // 动作行放不下一行时折成两行：右边这一组保持一组、靠右（2026-10-01）。
    <V4Row as="div" className="flex-wrap text-caption" data-v4-block="actions">
      {data.progress ? (
        // 正在一段一段发出（板 2026-11-15 ask.sending）：不摆主动作，左边转圈 + 进度那一句、右边「取消」就是停下。
        // 条上没有标题时转圈挪到这一行。这一句是条上唯一的一句话：正文字号、加粗、墨色（样张的 `.st` / `.spin`）。
        <>
          <span className="flex min-w-0 items-center gap-1.5 text-body-sm font-semibold text-nomi-ink" data-v4-block="slot-progress">
            {title ? null : <span className="shrink-0 text-nomi-ink" data-v4-block="slot-title-icon"><StatusSpinner size={12} /></span>}
            {data.progress.hint}
          </span>
          <span className="flex-1" />
          {dismiss}
        </>
      ) : reject.open ? (
        <SlotRejectActions reject={reject} labels={labels} size="md" />
      ) : (
        // 安静次按钮在左、深色主按钮在右；否定钮是这一组最左的文字「取消」（设计系统 §1.9.1，右上角没有 ×）。
        <span className="flex grow items-center justify-end gap-1.5" data-v4-block="card-actions">
          {dismiss}
          <WorkbenchButton
            ref={waiting ? confirmRef : undefined}
            variant="primary"
            size="md"
            onClick={onConfirm}
            disabled={data.actionsDisabled === true}
            data-v4-control="confirm"
            // 单动作最小宽 72px（agent 专章 §8.2），阶梯上没有 72，取上一档 80（`min-w-20`）。加粗是板上 `.b1` 的 600。
            className="min-w-20 shrink-0 font-semibold"
          >
            {/* 「去改镜 N」「去看镜 N」：这一下是去画布上那个节点，前面是全仓「定位」那一个图形（设计系统 §6）。 */}
            {data.confirmIcon === 'locate' ? <IconFocus2 size={14} stroke={1.8} aria-hidden="true" className="shrink-0" /> : null}
            {data.confirmLabel ?? labels.confirm}
            {/* 板上 `.b1 span`：回车记号不跟着加粗。 */}
            <span aria-hidden="true" className="text-micro font-normal opacity-70">⏎</span>
          </WorkbenchButton>
        </span>
      )}
    </V4Row>
  )
  return (
    <V4SlotShell
      kind={data.kind}
      waiting={waiting && !data.progress}
      {...(data.failed ? { tone: 'danger' as const } : {})}
      footerDivider={false}
      {...(title ? { title } : {})}
      footer={footer}
    >
      <SlotContent data={data} body={body} reject={reject} planCollapsed={planCollapsed} onPlanToggle={onPlanToggle}>
        {data.price ? <V4PriceRow price={data.price} /> : null}
      </SlotContent>
    </V4SlotShell>
  )
}
