import { V4Row } from './AgentPanelV4Row'
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
import { useTranslation } from 'react-i18next'
import { AgentPanelV4Markdown } from './AgentPanelV4Markdown'
import { NomiSegmented } from '../../../design'
import { cn } from '../../../utils/cn'
import {
  ActionIcon,
  IconAlertTriangle,
  IconCheck,
  IconChevronRight,
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
      <V4Row as="header" className="px-2.5 py-2 text-caption font-medium text-nomi-ink">
        <ActionIcon action={task.action} />
        <div className="min-w-0 line-clamp-1"><AgentPanelV4Markdown text={task.title} /></div>
        <span className={cn('flex shrink-0 items-center gap-1 font-normal', TASK_TONE[task.status])}>
          <TaskStatusIcon status={task.status} />
          {labels.status[task.status]}
        </span>
        {task.trailing ? (
          <span className="shrink-0 text-micro font-normal text-nomi-ink-40">{task.trailing}</span>
        ) : null}
      </V4Row>
      {/* 卡体只要**有东西可放**就开：首版漏了 footnote / undoable 两项，于是
        「2 处改动 · 同一个 ⌘Z + 撤销」那一行整条不见了，卡片看起来只剩一个标题。 */}
      {task.excerpt || task.params || task.candidates || task.error || task.footnote || task.undoable || task.progress !== undefined ? (
        <div className="flex flex-col gap-1.5 px-2.5 pb-2.5">
          {task.excerpt ? (
            <AgentPanelV4Markdown text={task.excerpt} />
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
              {task.candidates.map((candidate, index) => {
                const canAdopt = Boolean(onAdopt && candidate.canAdopt && !candidate.adopted && !candidate.pending)
                const Tile = canAdopt ? 'button' : 'div'
                return <Tile
                  {...(canAdopt ? { type: 'button' as const, 'aria-label': `${labels.adopt} ${candidate.tag}`,
                    onClick: () => onAdopt?.(candidate.tag, index) } : {})}
                  key={candidate.artifactId ?? candidate.tag}
                  data-artifact-id={candidate.artifactId}
                  data-adopted={candidate.adopted ? 'true' : undefined}
                  className={cn(
                    'relative h-10 w-16 shrink-0 overflow-hidden rounded-nomi-sm border border-nomi-line',
                    candidate.pending ? 'bg-nomi-ink-05' : 'bg-nomi-ink-10',
                    // 采用 = accent 描边（outline 不占位，缩略图不缩水）+ 左上角标。
                    candidate.adopted && 'outline outline-2 outline-offset-1 outline-nomi-accent',
                  )}
                >
                  {candidate.thumbnailUrl ? <img src={candidate.thumbnailUrl} alt="" className="size-full object-cover" /> : null}
                  {/* 角标写的是**这一张是谁**（画布 Vocabulary 板是「采用」、FlowGeneration 板是「2 ✓」），
                      由数据给；`adopted` 只管那圈 accent 描边，不改写文字。 */}
                  <span className="absolute left-1 top-1 rounded-sm bg-nomi-overlay-chip px-1 text-micro leading-[15px] text-nomi-paper">
                    {candidate.tag}
                  </span>
                </Tile>
              })}
            </div>
          ) : null}
          {task.progress !== undefined ? (
            <div className="h-[3px] overflow-hidden rounded-sm bg-nomi-ink-10">
              <div className="h-full bg-nomi-accent" style={{ width: `${task.progress}%` }} />
            </div>
          ) : null}
          {task.error ? <V4ErrorBar reason={task.error} action={task.errorAction} onAction={onErrorAction} /> : null}
          {task.footnote || task.footnoteTrailing || task.undoable ? (
            <V4Row as="div" className="text-micro text-nomi-ink-40">
              <AgentPanelV4Markdown text={task.footnote ?? ''} />
              {task.footnoteTrailing ? <span className="shrink-0">{task.footnoteTrailing}</span> : null}
              {task.undoable ? (
                <button type="button" className="font-medium text-nomi-accent" onClick={onUndo}>
                  {labels.undo}
                </button>
              ) : null}
            </V4Row>
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
  'missing-card': 'think',
}

function SlotIcon({ kind }: { kind: V4InterventionKind }): JSX.Element {
  if (kind === 'approval-irreversible' || kind === 'deviation' || kind === 'missing-card') return <IconAlertTriangle size={13} aria-hidden="true" />
  if (kind === 'approval-reversible' || kind === 'reject-reason') return <IconCheck size={13} aria-hidden="true" />
  return <ActionIcon action={SLOT_ACTION[kind]} size={13} />
}

/**
 * 翻页器（`‹ 2/4 ›`）+ 范围切换（`逐镜 | 全部`）+ 键盘提示（`←→`）。
 *
 * **2026-09-10 v3：它从槽头搬到了动作行上方那一行。** 两条理由：
 *
 * ① 它现在决定主按钮上印的那个数——「逐镜」印这一页的价、「全部」印合计。
 *    改一个数的控件必须和那个数在一处，否则用户按下去之前得在两处之间来回对。
 * ② 槽头在 390px 面板里已经排满了（icon + 标题 + 「付费 · Nomi 选的」），
 *    再塞一个范围切换就会挤出视口——而范围切换和翻页器必须挨着（用户 2026-09-10：
 *    「翻页器旁加一个『全部』切换」）。
 *
 * 排布仍守 2026-09-09 的通用规则：三件都在内容流里紧跟彼此，**不靠自动外边距顶到右缘**
 * （`check:tokens` 对 `src/workbench/ai/` 是硬零——连注释里写出那个类名都会被它数进去）。
 *
 * 只有一项时调用方不传 `pager`，整行不渲染——「1/1」是一句废话，而单镜卡也没有「全部」可言。
 */
function V4Pager({
  pager,
  onPage,
  onScope,
}: {
  pager: NonNullable<InterventionData['pager']>
  onPage?: (index: number) => void
  onScope?: (value: 'each' | 'all') => void
}): JSX.Element {
  const { t } = useTranslation()
  const step = (delta: number): void => onPage?.((pager.index + delta + pager.total) % pager.total)
  const arrow = 'flex size-5 shrink-0 items-center justify-center rounded-nomi-sm text-nomi-accent hover:bg-nomi-info-edge disabled:opacity-40'
  const scope = pager.scope
  return (
    <V4Row as="div" className="shrink-0 gap-0.5 font-normal" data-v4-block="pager">
      <button type="button" className={arrow} aria-label={t('agentPanelV4.pagerPrev')} disabled={pager.total < 2} onClick={() => step(-1)} data-v4-control="pager-prev">
        <IconChevronRight size={12} className="rotate-180" aria-hidden="true" />
      </button>
      <span className="tabular-nums text-micro">{`${pager.index + 1}/${pager.total}`}</span>
      <button type="button" className={arrow} aria-label={t('agentPanelV4.pagerNext')} disabled={pager.total < 2} onClick={() => step(1)} data-v4-control="pager-next">
        <IconChevronRight size={12} aria-hidden="true" />
      </button>
      {/* 键盘提示：只印两个箭头。它不是说明文字，是**告诉你这里有快捷键**的最短形式；
          写成「按左右键翻页」就是让用户多读一行（D1）。 */}
      {pager.keyHint ? (
        <span className="ml-1 shrink-0 select-none text-micro text-nomi-ink-40" data-v4-block="pager-keyhint">
          {pager.keyHint}
        </span>
      ) : null}
      {scope ? (
        <NomiSegmented
          value={scope.value}
          onChange={(value) => onScope?.(value === 'all' ? 'all' : 'each')}
          ariaLabel={scope.ariaLabel}
          density="compact"
          // 宽度写死 w-32（128px）不是凑数：NomiSegmented 的列是 `auto-fit, minmax(56px, 1fr)`，
          // 容器窄于「2×56 + 列间距 4 + 内边距 8 = 124」时 auto-fit 会塌成一列，
          // 两档就竖着摞起来（v3 首轮实测就是这样）。128 是能横着放下两档的最小整数格。
          className="ml-1.5 w-32 shrink-0"
          options={[
            { value: 'each', label: scope.eachLabel },
            { value: 'all', label: scope.allLabel },
          ]}
        />
      ) : null}
    </V4Row>
  )
}

/**
 * ⑤ 介入槽的**价格行**（形态 9 · B-02）。
 *
 * 一行两端：左边说「怎么算出来的」，右边是加粗合计。合计缺席时右边印的是那句
 * 「暂时算不出价格」——不是 `¥0`。三种可能（免费 / 算不出 / 真的零元）里，
 * 印 0 恰好是唯一会让用户误以为「这次不花钱」的那一种。
 */
function V4PriceRow({ price }: { price: NonNullable<InterventionData['price']> }): JSX.Element {
  const known = Boolean(price.total)
  return (
    <div className="flex flex-col gap-1" data-v4-block="price">
      {/* 合计**紧跟**算式，不用 flex-1 把它推到右缘（2026-09-09 用户拍板：行尾附属信息紧跟内容）。
          推到右缘的代价不是好不好看：算式和它的结果之间会横着一大片空白，
          读的人得把视线甩过去才知道那个数是这一行算出来的。 */}
      <V4Row as="div" className="text-caption text-nomi-ink-60">
        <span className="min-w-0 truncate">{price.breakdown}</span>
        {known && price.totalLabel ? (
          <span className="shrink-0 text-micro text-nomi-ink-40">{price.totalLabel}</span>
        ) : null}
        <span
          className={cn('shrink-0 tabular-nums', known ? 'font-semibold text-nomi-ink' : 'text-nomi-warning')}
          data-v4-price={known ? 'total' : 'unavailable'}
        >
          {price.total ?? price.unavailable}
        </span>
      </V4Row>
      {price.perItem?.length ? (
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
      ) : null}
    </div>
  )
}

export function V4Intervention({
  data,
  composer,
  labels,
  onConfirm,
  onPage,
  onScope,
  onReject,
  onEscalate,
  onAlternate,
  onOption,
  onPlanToggle,
  onCollapsePlan,
}: {
  data: InterventionData
  /**
   * 卡体 = **画布节点那张生成框整件**（`NodeGenerationComposer host="panel"`）：
   * 上边提示词、下边那条参数条，和用户在画布上改一个镜头时看到的是同一个东西。
   *
   * 2026-09-10 用户退回 v1 时说得很直接：「你没有用我们下面那种一行的模式——上边是提示词，
   * 下边是那些参数组件……要和画布里一样的真实体验」。所以这里收的不是一条参数条，
   * 是**整件 composer**；卡壳只负责它周围那圈东西（槽头 / 价格行 / 动作）。
   * 槽里不重画一份长得像的（重画一份就是并行版，P1）。
   *
   * 给了它就**替掉** `data.params` 那排只读 chip——同一张卡上不许既摆一排不能点的 chip、
   * 又摆一条能点的参数条（那是同一件事的两个说法）。
   */
  composer?: React.ReactNode
  labels: { confirm: string; reject: string; escalate: string; cancel: string; confirmReject: string; collapsePlan: string }
  /** 确认。计划槽传的是当前勾选集，其余档传 `undefined`。 */
  onConfirm?: () => void
  /** 翻到第几张卡（`data.pager` 在时才有意义）。 */
  onPage?: (index: number) => void
  /** 切范围：这一镜 / 全部（`data.pager.scope` 在时才有意义）。 */
  onScope?: (value: 'each' | 'all') => void
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
  // 反问只有选项 chip；「本该有卡却没有」是一条**报错**，没有可点的东西——
  // 给它一个「确认」按钮等于让用户去确认一件我们自己都没渲染出来的事。
  const hasActions = data.kind !== 'question' && data.kind !== 'missing-card'
  // 计划槽底栏照画布画的那样收尾：主动作 + 「改一下」…… 「收起 ▴」，没有「不要」——
  // 计划是清单，取消一项靠取消勾选，整张不要就是不勾任何一项。
  const isPlan = data.kind === 'plan'
  const pager = data.pager
  /**
   * 卡聚焦时 ← → 翻页（2026-09-10 用户要求）。
   *
   * 两条边界：
   * · 焦点在提示词编辑器/输入框里时**不接管**——那儿的左右键是移动光标，抢走它等于把打字弄坏。
   * · 只在有翻页器时才接管，否则一张普通卡吃掉方向键会让页面滚不动。
   */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (!pager || !onPage) return
    const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
    if (!delta) return
    const target = event.target as HTMLElement | null
    if (target?.closest('input, textarea, [contenteditable="true"]')) return
    event.preventDefault()
    onPage((pager.index + delta + pager.total) % pager.total)
  }
  return (
    <aside
      className="overflow-hidden rounded-nomi border border-nomi-accent bg-nomi-paper"
      data-v4-block="intervention"
      data-kind={data.kind}
      // 有翻页器才可聚焦：焦点是「← → 归谁管」的唯一凭据，没有翻页器的卡不该抢 Tab 序。
      {...(pager ? { tabIndex: 0, onKeyDown: handleKeyDown } : {})}
    >
      <V4Row as="header" className="bg-nomi-accent-soft px-2.5 py-2 text-caption font-semibold text-nomi-accent">
        {data.hideIcon ? null : <SlotIcon kind={data.kind} />}
        <AgentPanelV4Markdown text={data.title} />
        {data.badge ? <span className="shrink-0 font-normal opacity-85">{data.badge}</span> : null}
      </V4Row>
      <div className="flex flex-col gap-1.5 px-2.5 py-2 text-caption text-nomi-ink">
        {data.summary ? <AgentPanelV4Markdown text={data.summary} /> : null}
        {composer ?? (data.params?.length ? (
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
        ) : null)}
        {data.price ? <V4PriceRow price={data.price} /> : null}
        {data.options?.length ? (
          <V4OptionChips options={data.options} selectedOption={data.selectedOption} onSelect={onOption} />
        ) : null}
        {data.plan?.length ? (
          <div className="flex flex-col gap-1">
            {data.plan.map((row, index) => (
              <div key={`${index}-${row.label}`} className="flex items-start gap-2 py-[3px] text-caption text-nomi-ink-80">
                <input
                  type="checkbox"
                  aria-label={row.label}
                  checked={row.checked}
                  onChange={(event) => onPlanToggle?.(row.label, event.target.checked)}
                  className="mt-0.5 size-3.5 shrink-0 accent-nomi-accent"
                />
                {row.technical ? (
                  <details className="group min-w-0 flex-1" data-v4-block="plan-detail">
                    <summary className="flex cursor-pointer list-none items-start gap-1">
                      <div className="min-w-0 flex-1"><AgentPanelV4Markdown text={row.label} />{row.detail ? <AgentPanelV4Markdown text={row.detail} /> : null}</div>
                      <IconChevronRight size={12} className="mt-0.5 shrink-0 group-open:rotate-90" aria-hidden="true" />
                    </summary>
                    <pre className="m-0 mt-1 whitespace-pre-wrap break-all font-nomi-mono text-micro text-nomi-ink-40">{row.technical}</pre>
                  </details>
                ) : <div className="min-w-0 flex-1"><AgentPanelV4Markdown text={row.label} />{row.detail ? <AgentPanelV4Markdown text={row.detail} /> : null}</div>}
              </div>
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
        <footer className="flex flex-col gap-1.5 border-t border-nomi-line-soft px-2.5 py-2 text-caption">
        {/* 翻页 + 范围切换单独占一行，压在主按钮正上方：它们决定按钮上印的那个数，
            所以要挨着它；而挤进同一行会让 390px 的卡横向溢出（实测 350px 可用宽放不下）。 */}
        {pager && !rejecting && data.kind !== 'reject-reason' ? (
          <V4Pager pager={pager} onPage={onPage} onScope={onScope} />
        ) : null}
        <V4Row as="div" className="text-caption">
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
              <V4Row as="button"
                type="button"
                onClick={onConfirm}
                data-v4-control="confirm"
                className="h-7 rounded-nomi-sm border border-nomi-ink bg-nomi-ink px-2.5 text-nomi-paper"
              >
                {data.kind === 'approval-irreversible' || data.kind === 'spend' ? (
                  <IconCheck size={12} aria-hidden="true" />
                ) : null}
                {data.confirmLabel ?? labels.confirm}
              </V4Row>
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
                // 否定动作 = 一颗 ×（2026-09-10 拍板的按钮规则：一屏一个主动作、否定动作用 ×）。
                // 它和「生成」并排在同一行，仍是同一个决定的两面；但**不是第二颗文字按钮**——
                // 两颗一样重的文字钮会让人在花钱的卡上多想一秒「哪颗是往前」。
                // 它也不直接发拒绝：有原因输入时先把那一行摊开（渐进披露），
                // 第二下「确认不要」才真的回给宿主。文案没消失，它是这颗 × 的无障碍名与 tooltip。
                <button
                  type="button"
                  aria-label={labels.reject}
                  title={labels.reject}
                  className="grid size-[22px] shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-danger"
                  onClick={() => (data.reasonPlaceholder ? setRejecting(true) : onReject?.())}
                  data-v4-control="reject"
                >
                  <IconX size={14} aria-hidden="true" />
                </button>
              )}
            </>
          )}
        </V4Row>
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
        <V4Row as="div" key={`${rowIndex}-${row.title}`} className="h-6 text-caption text-nomi-ink-80" data-status={row.status}>
          <span
            className={cn(
              'size-1.5 shrink-0 rounded-pill',
              row.status === 'running' ? 'bg-nomi-accent' : 'bg-nomi-ink-30',
            )}
            aria-hidden="true"
          />
          <span className={cn('min-w-0 truncate', row.status === 'complete' && 'text-nomi-ink-40 line-through')}>
            {row.title}
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-micro text-nomi-ink-40">
            {row.actions?.map((action) => (
              <button type="button" key={action} className="font-medium text-nomi-ink-80" onClick={() => onAction?.(rowIndex, action)}>
                {action}
              </button>
            ))}
            {row.destructiveAction ? (
              <button type="button" aria-label={row.destructiveAction} className="grid size-[22px] place-items-center rounded-nomi-sm text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-danger" onClick={() => onDestructiveAction?.(rowIndex)}>
                <IconX size={14} aria-hidden="true" />
              </button>
            ) : null}
            {row.actions?.length || row.destructiveAction ? null : labels[row.status]}
          </span>
        </V4Row>
      ))}
    </section>
  )
}
