// 付费确认条的条体（2026-11-15 拆开，设计卡 docs/plan/2026-11-15-spend-ask-split.md）：一行这一批都一样的参数 + 说明行。
// 条上不画镜头——这一批镜头一行一个住在对话里（挂在 Agent 那一条生成记录下面，`GenerationReceiptPointers`），
// 这里只把投影出来的行数据交过去（`usePublishSpendOfferRows`）；条上也没有可改的东西，想改点那一行去节点里改（设计系统 §1.0）。
//
// 共同参数那一行（板 ask.params）：模型（Nomi 选的）· 比例 · 清晰度 · 时长，逐镜不同的那一项不写在这里、回到各自那一行。
// 说明行（失败原因 / 交不出去的那一镜 / 素材托管披露）照旧。3 段和 12 段条一样高：条上没有一样东西随段数变多。
import React, { type JSX } from 'react'
import { IconAlertTriangle } from './AgentPanelV4Icons'
import type { SpendCardNotice, SpendCardPointer } from './agentPanelSpendCard'
import { usePublishSpendOfferRows } from './spendCardOfferRows'

export type SpendCardBodyProps = Readonly<{
  /** 这一次出价的号：对话里那一条生成记录带着同一个号，那一组就挂在它下面。 */
  operationId: string
  /** 对话里那一组的行（条上不画）。 */
  pointers: readonly SpendCardPointer[]
  /** 条第一行：这一批都一样的参数。只在等人决定时有。 */
  summary?: string
  notices: readonly SpendCardNotice[]
  /** 一下动作在路上：行尾「不生成 ×」/「恢复」这一两秒里点了也不会生效，置灰让它看得见。 */
  busy: boolean
  /** 窄面板（≤320px）：外壳照旧传；条上已经没有标题行要缩，留着这一格不让外壳改。 */
  narrow?: boolean
  onExclude: (shotId: string) => void
  onRestore: (shotId: string) => void
}>

/** 说明行：没成的原因（警示图标 + 原因 + 别的几段此刻怎样），或者一行中性的披露（素材托管）。 */
function SpendCardNoticeLine({ notice }: { notice: SpendCardNotice }): JSX.Element {
  if (notice.tone === 'neutral') {
    return <p className="m-0 text-micro text-nomi-ink-60" data-v4-block="spend-notice" data-tone="neutral">{notice.text}</p>
  }
  return (
    <div className="flex min-w-0 items-start gap-2 text-body-sm text-nomi-ink" data-v4-block="spend-notice" data-tone="danger">
      <IconAlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-nomi-danger-ink" />
      <span className="flex min-w-0 flex-col">
        <span>{notice.text}</span>
        {notice.detail ? <small className="text-caption text-nomi-ink-60" data-v4-block="spend-notice-detail">{notice.detail}</small> : null}
      </span>
    </div>
  )
}

export function AgentPanelV4SpendCardBody({ operationId, pointers, summary, notices, busy, onExclude, onRestore }: SpendCardBodyProps): JSX.Element | null {
  const offer = React.useMemo(
    () => ({ operationId, pointers, busy, onExclude, onRestore }),
    [operationId, pointers, busy, onExclude, onRestore],
  )
  usePublishSpendOfferRows(offer)
  // 正在发出时条上只剩那一行进度 + 「取消」（外壳的页脚画）：条体一个字都没有就整块不画，不留一截空白。
  if (!summary && notices.length === 0) return null
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-v4-block="spend-body">
      {summary ? (
        <p className="m-0 min-w-0 truncate text-caption text-nomi-ink-80" data-v4-block="spend-params" title={summary}>{summary}</p>
      ) : null}
      {notices.map((notice) => <SpendCardNoticeLine key={`${notice.tone}:${notice.text}`} notice={notice} />)}
    </div>
  )
}
