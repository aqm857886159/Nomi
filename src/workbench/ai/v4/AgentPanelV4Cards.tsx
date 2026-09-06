// Agent 面板 v4 · 积木 ④ 任务卡 · ⑤ 介入槽 · ⑥ 队列行
//
// ④ 任务卡（定稿 Vocabulary 板）：卡头 = 类型 icon + 标题 + 状态 + 右侧计数/用时/**花费**，
// 卡体 = 提示词摘录（2 行）+ 参数 chip + 进度条 / 缩略图 / 结果。五态：排队 · 生成中 · 完成 · 失败 · 已停止。
// 多候选 = 完成态结果区多张缩略图，**点一张即采用**（用户拍板）——采用态是 accent 描边 + 左上角标，
// 不是把整格填成 accent 底（那会让缩略图本身看不见）。每张卡都带花费，MiniMax 没有，这是我们要赢的地方。
//
// ⑤ 介入槽：**一个组件，kind 不同**（审批 / 付费 / 反问 / 计划 / 缺凭证 / 有出入）。
// 永远只在 composer 上方那一格出现。按钮只有「确认 / 不要」；**可撤销**的改动才显示「不再问 →」
// （= 权限抬一档），不可逆的和花钱的永远逐次问；拒绝原因渐进披露（reject-reason kind）。
//
// ⑥ 队列行：只在「运行中还继续输入」时出现在 composer 顶上；完成的划掉；空队列不渲染。
import React from 'react'
import { cn } from '../../../utils/cn'
import {
  ActionIcon,
  IconAlertTriangle,
  IconCheck,
  IconX,
  StatusSpinner,
} from './AgentPanelV4Icons'
import { V4ErrorBar } from './AgentPanelV4Receipt'
import { V4OptionChips } from './AgentPanelV4Message'
import type {
  InterventionData,
  QueueRowData,
  TaskCardData,
  V4InterventionKind,
  V4TaskStatus,
} from './agentPanelV4Types'

const TASK_TONE: Record<V4TaskStatus, string> = {
  queued: 'text-nomi-ink-40',
  running: 'text-nomi-accent',
  complete: 'text-nomi-success',
  failed: 'text-nomi-danger',
  stopped: 'text-nomi-warning',
}

function TaskStatusIcon({ status }: { status: V4TaskStatus }): JSX.Element {
  if (status === 'complete') return <IconCheck size={13} aria-hidden="true" />
  if (status === 'failed') return <IconAlertTriangle size={13} aria-hidden="true" />
  if (status === 'stopped') return <IconX size={13} aria-hidden="true" />
  return <StatusSpinner size={13} />
}

export function V4TaskCard({
  task,
  labels,
  onAdopt,
  onUndo,
  onErrorAction,
}: {
  task: TaskCardData
  labels: { status: Record<V4TaskStatus, string>; adopt: string; undo: string }
  onAdopt?: (tag: string, index: number) => void
  onUndo?: () => void
  onErrorAction?: () => void
}): JSX.Element {
  return (
    <article
      className="overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper"
      data-v4-block="task"
      data-status={task.status}
    >
      <header className="flex items-center gap-[7px] px-2.5 py-2 text-caption font-medium text-nomi-ink">
        <ActionIcon action={task.action} />
        <span className="truncate">{task.title}</span>
        <span className={cn('flex shrink-0 items-center gap-1 font-normal', TASK_TONE[task.status])}>
          <TaskStatusIcon status={task.status} />
          {labels.status[task.status]}
        </span>
        {task.trailing ? (
          <span className="ml-auto shrink-0 text-micro font-normal text-nomi-ink-40">{task.trailing}</span>
        ) : null}
      </header>
      {/* 卡体只要**有东西可放**就开：首版漏了 footnote / undoable 两项，于是
        「2 处改动 · 同一个 ⌘Z + 撤销」那一行整条不见了，卡片看起来只剩一个标题。 */}
      {task.excerpt || task.params || task.candidates || task.error || task.footnote || task.undoable || task.progress !== undefined ? (
        <div className="flex flex-col gap-1.5 px-2.5 pb-2.5">
          {task.excerpt ? (
            <p className="m-0 line-clamp-2 text-caption text-nomi-ink-60">{task.excerpt}</p>
          ) : null}
          {task.params?.length ? (
            <div className="flex flex-wrap gap-1">
              {task.params.map((param) => (
                <span
                  key={param}
                  className="inline-flex h-5 items-center rounded-pill bg-nomi-ink-05 px-[7px] text-micro text-nomi-ink-60"
                >
                  {param}
                </span>
              ))}
              {task.cost ? (
                <span className="inline-flex h-5 items-center rounded-pill bg-nomi-warning-soft px-[7px] text-micro text-nomi-warning">
                  {task.cost}
                </span>
              ) : null}
            </div>
          ) : null}
          {task.candidates?.length ? (
            <div className="flex gap-1.5">
              {task.candidates.map((candidate, index) => (
                <button
                  type="button"
                  key={candidate.tag}
                  aria-label={`${labels.adopt} ${candidate.tag}`}
                  onClick={() => onAdopt?.(candidate.tag, index)}
                  data-adopted={candidate.adopted ? 'true' : undefined}
                  className={cn(
                    'relative h-10 w-16 shrink-0 overflow-hidden rounded-nomi-sm border border-nomi-line',
                    candidate.pending ? 'bg-nomi-ink-05' : 'bg-nomi-ink-10',
                    // 采用 = accent 描边（outline 不占位，缩略图不缩水）+ 左上角标。
                    candidate.adopted && 'outline outline-2 outline-offset-1 outline-nomi-accent',
                  )}
                >
                  {/* 角标写的是**这一张是谁**（画布 Vocabulary 板是「采用」、FlowGeneration 板是「2 ✓」），
                      由数据给；`adopted` 只管那圈 accent 描边，不改写文字。 */}
                  <span className="absolute left-1 top-1 rounded-sm bg-nomi-overlay-chip px-1 text-micro leading-[15px] text-nomi-paper">
                    {candidate.tag}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {task.progress !== undefined ? (
            <div className="h-[3px] overflow-hidden rounded-sm bg-nomi-ink-10">
              <div className="h-full bg-nomi-accent" style={{ width: `${task.progress}%` }} />
            </div>
          ) : null}
          {task.error ? <V4ErrorBar reason={task.error} action={task.errorAction} onAction={onErrorAction} /> : null}
          {task.footnote || task.footnoteTrailing || task.undoable ? (
            <div className="flex items-center gap-2 text-micro text-nomi-ink-40">
              <span className="flex-1 truncate">{task.footnote ?? ''}</span>
              {task.footnoteTrailing ? <span className="shrink-0">{task.footnoteTrailing}</span> : null}
              {task.undoable ? (
                <button type="button" className="font-medium text-nomi-accent" onClick={onUndo}>
                  {labels.undo}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

/** 槽头 icon 按 kind 取的是**这件事是什么**，不是状态（定稿 ⑤ 六张槽各自的 icon）。 */
const SLOT_ACTION: Record<V4InterventionKind, Parameters<typeof ActionIcon>[0]['action']> = {
  'approval-irreversible': 'think',
  'approval-reversible': 'think',
  'reject-reason': 'think',
  spend: 'spend',
  question: 'question',
  plan: 'plan',
  credential: 'credential',
  deviation: 'think',
}

function SlotIcon({ kind }: { kind: V4InterventionKind }): JSX.Element {
  if (kind === 'approval-irreversible' || kind === 'deviation') return <IconAlertTriangle size={13} aria-hidden="true" />
  if (kind === 'approval-reversible' || kind === 'reject-reason') return <IconCheck size={13} aria-hidden="true" />
  return <ActionIcon action={SLOT_ACTION[kind]} size={13} />
}

export function V4Intervention({
  data,
  labels,
  onConfirm,
  onReject,
  onEscalate,
  onAlternate,
  onOption,
  onPlanToggle,
  onCollapsePlan,
}: {
  data: InterventionData
  labels: { confirm: string; reject: string; escalate: string; cancel: string; confirmReject: string; collapsePlan: string }
  /** 确认。计划槽传的是当前勾选集，其余档传 `undefined`。 */
  onConfirm?: () => void
  /** 拒绝。`reason` 是渐进披露出来的那一行，可为空。 */
  onReject?: (reason?: string) => void
  /** 「不再问 →」——**这一个能力**以后不再问，不是整个项目（2026-09-06 拍板 ②）。 */
  onEscalate?: () => void
  onAlternate?: () => void
  onOption?: (option: string, index: number) => void
  onPlanToggle?: (label: string, checked: boolean) => void
  onCollapsePlan?: () => void
}): JSX.Element {
  // 拒绝原因是**渐进披露**的：先点「不要」，才出现那一行输入和「确认不要」。
  // 一上来就摆一个输入框，等于要求用户为每一次拒绝写作文。
  const [rejecting, setRejecting] = React.useState(false)
  const [reason, setReason] = React.useState('')
  // 「不再问 →」只在**可撤销**的改动上出现（定稿 §3）：不可逆和花钱的永远逐次问。
  //
  // ⚠️ 作用域：它等价于现役 `approvalScope: 'always'`，即「**这一个能力**以后不用再问」，
  // **不是**把项目的 approvalPolicy 抬一档。两者差别很大——抬档会让所有同类能力一起放行，
  // 那是扩大授权面，而用户点的是「这件事我信得过」。早先 v4 的 `escalatePermission()`
  // 走的是抬全局档那条路，已随本次接线删除。
  const canEscalate = (data.kind === 'approval-reversible' || data.kind === 'reject-reason') && Boolean(onEscalate)
  // 反问只有选项 chip，没有确认/不要——选项本身就是回答（定稿 ⑤ 反问格）。
  const hasActions = data.kind !== 'question'
  // 计划槽底栏照画布画的那样收尾：主动作 + 「改一下」…… 「收起 ▴」，没有「不要」——
  // 计划是清单，取消一项靠取消勾选，整张不要就是不勾任何一项。
  const isPlan = data.kind === 'plan'
  return (
    <aside
      className="overflow-hidden rounded-nomi border border-nomi-accent bg-nomi-paper"
      data-v4-block="intervention"
      data-kind={data.kind}
    >
      <header className="flex items-center gap-1.5 bg-nomi-accent-soft px-2.5 py-2 text-caption font-semibold text-nomi-accent">
        <SlotIcon kind={data.kind} />
        <span className="min-w-0 flex-1">{data.title}</span>
        {data.badge ? <span className="shrink-0 font-normal opacity-85">{data.badge}</span> : null}
      </header>
      <div className="flex flex-col gap-1.5 px-2.5 py-2 text-caption text-nomi-ink">
        {data.summary ? <p className="m-0">{data.summary}</p> : null}
        {data.params?.length ? (
          <div className="flex flex-wrap gap-1">
            {data.params.map((param) => (
              <span
                key={param}
                className="inline-flex h-5 items-center rounded-pill bg-nomi-ink-05 px-[7px] text-micro text-nomi-ink-60"
              >
                {param}
              </span>
            ))}
          </div>
        ) : null}
        {data.options?.length ? (
          <V4OptionChips options={data.options} selectedOption={data.selectedOption} onSelect={onOption} />
        ) : null}
        {data.plan?.length ? (
          <div className="flex flex-col gap-1">
            {data.plan.map((row) => (
              <label key={row.label} className="flex items-center gap-2 py-[3px] text-caption text-nomi-ink-80">
                <input
                  type="checkbox"
                  checked={row.checked}
                  onChange={(event) => onPlanToggle?.(row.label, event.target.checked)}
                  className="size-3.5 shrink-0 accent-nomi-accent"
                />
                <span className="min-w-0 flex-1 truncate">{row.label}</span>
                {row.detail ? (
                  <span className="shrink-0 font-nomi-mono text-micro text-nomi-ink-40">{row.detail}</span>
                ) : null}
              </label>
            ))}
          </div>
        ) : null}
        {data.reasonPlaceholder && (rejecting || data.kind === 'reject-reason') ? (
          <input
            type="text"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={data.reasonPlaceholder}
            aria-label={data.reasonPlaceholder}
            data-v4-control="reject-reason"
            className="h-7 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2 text-caption text-nomi-ink placeholder:text-nomi-ink-40"
          />
        ) : null}
        {data.scope ? <p className="m-0 text-micro text-nomi-ink-60">{data.scope}</p> : null}
      </div>
      {hasActions ? (
        <footer className="flex items-center gap-1.5 border-t border-nomi-line-soft px-2.5 py-2 text-caption">
          {rejecting || data.kind === 'reject-reason' ? (
            <>
              <span className="flex-1" />
              <button
                type="button"
                className="h-7 rounded-nomi-sm px-2.5 text-nomi-ink-60"
                onClick={() => { setRejecting(false); setReason('') }}
                data-v4-control="cancel-reject"
              >
                {labels.cancel}
              </button>
              <button
                type="button"
                className="h-7 rounded-nomi-sm px-2.5 text-nomi-danger"
                onClick={() => onReject?.(reason.trim() || undefined)}
                data-v4-control="confirm-reject"
              >
                {labels.confirmReject}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onConfirm}
                data-v4-control="confirm"
                className="inline-flex h-7 items-center gap-1 rounded-nomi-sm border border-nomi-ink bg-nomi-ink px-2.5 text-nomi-paper"
              >
                {data.kind === 'approval-irreversible' || data.kind === 'spend' ? (
                  <IconCheck size={12} aria-hidden="true" />
                ) : null}
                {data.confirmLabel ?? labels.confirm}
              </button>
              {canEscalate ? (
                <button type="button" className="text-micro text-nomi-ink-40" onClick={onEscalate} data-v4-control="escalate">
                  {labels.escalate}
                </button>
              ) : null}
              {data.alternateLabel ? (
                <button type="button" className="h-7 rounded-nomi-sm px-2.5 text-nomi-ink-60" onClick={onAlternate} data-v4-control="alternate">
                  {data.alternateLabel}
                </button>
              ) : null}
              <span className="flex-1" />
              {isPlan ? (
                <button type="button" className="text-micro text-nomi-ink-40" onClick={onCollapsePlan}>
                  {labels.collapsePlan}
                </button>
              ) : (
                // 「不要」不直接发拒绝：它先把那一行原因摊开（渐进披露），
                // 第二下「确认不要」才真的回给宿主。一次点击就否掉一个提案，
                // 手滑的成本是整回合重来。
                <button
                  type="button"
                  className="h-7 rounded-nomi-sm px-2.5 text-nomi-danger"
                  onClick={() => (data.reasonPlaceholder ? setRejecting(true) : onReject?.())}
                  data-v4-control="reject"
                >
                  {labels.reject}
                </button>
              )}
            </>
          )}
        </footer>
      ) : null}
    </aside>
  )
}

export function V4Queue({
  rows,
  labels,
  onAction,
  onDestructiveAction,
}: {
  rows: readonly QueueRowData[]
  labels: Record<QueueRowData['status'], string>
  /** 行尾动作。索引是**行序**，因为队列的身份就是它的位置（插队改的正是这个）。 */
  onAction?: (rowIndex: number, action: string) => void
  onDestructiveAction?: (rowIndex: number) => void
}): JSX.Element | null {
  // 空队列不渲染（定稿 ⑥）：一个空框比没有框更吵。
  if (!rows.length) return null
  return (
    <section
      className="flex flex-col gap-0.5 rounded-nomi-sm border border-nomi-line-soft bg-nomi-ink-05 px-2 py-1.5"
      data-v4-block="queue"
    >
      {rows.map((row, rowIndex) => (
        // key 用行序而不是标题：两条一模一样的排队消息是完全合法的（「再来一张」×2），
        // 用标题当 key 时 React 会把它们当成同一行，删掉第一条后第二条会跟着消失。
        <div key={`${rowIndex}-${row.title}`} className="flex h-6 items-center gap-2 text-caption text-nomi-ink-80" data-status={row.status}>
          <span
            className={cn(
              'size-1.5 shrink-0 rounded-pill',
              row.status === 'running' ? 'bg-nomi-accent' : 'bg-nomi-ink-30',
            )}
            aria-hidden="true"
          />
          <span className={cn('min-w-0 flex-1 truncate', row.status === 'complete' && 'text-nomi-ink-40 line-through')}>
            {row.title}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-micro text-nomi-ink-40">
            {row.actions?.map((action) => (
              <button type="button" key={action} className="font-medium text-nomi-ink-80" onClick={() => onAction?.(rowIndex, action)}>
                {action}
              </button>
            ))}
            {row.destructiveAction ? (
              <button type="button" className="font-medium text-nomi-danger" onClick={() => onDestructiveAction?.(rowIndex)}>
                {row.destructiveAction}
              </button>
            ) : null}
            {row.actions?.length || row.destructiveAction ? null : labels[row.status]}
          </span>
        </div>
      ))}
    </section>
  )
}
