import { V4Row } from './AgentPanelV4Row'
// Agent 面板 v4 · 积木 ④ 任务卡 · ⑤ 介入槽 · ⑥ 队列行
//
// ④ 任务卡（定稿 Vocabulary 板）：卡头 = 类型 icon + 标题 + 状态 + 右侧计数/用时，
// 卡体 = 提示词摘录（2 行）+ 参数 chip + 进度条 / 缩略图 / 结果。五态：排队 · 生成中 · 完成 · 失败 · 已停止。
// 多候选 = 完成态结果区多张缩略图，**点一张即采用**（用户拍板）——采用态是 accent 描边 + 左上角标，
// 不是把整格填成 accent 底（那会让缩略图本身看不见）。
// 卡上不印金额（2026-10-27，设计系统「钱只印一处」）：定稿板上的「预估」胶囊和卡尾「已花」连同字段一起删了。
//
// ⑤ 介入槽：**一个组件，kind 不同**（审批 / 付费 / 反问 / 计划 / 缺凭证 / 有出入）。
// 永远只在 composer 上方那一格出现。按钮只有「确认 / 不要」；**可撤销**的改动才显示「不再问 →」
// （= 权限抬一档），不可逆的和花钱的永远逐次问；拒绝原因渐进披露（reject-reason kind）。
//
// ⑥ 队列行：只在「运行中还继续输入」时出现在 composer 顶上；完成的划掉；空队列不渲染。
import React, { type JSX } from 'react'
import { AgentPanelV4Markdown } from './AgentPanelV4Markdown'
import { WorkbenchButton } from '../../../design'
import { cn } from '../../../utils/cn'
import {
  ActionIcon,
  IconAlertTriangle,
  IconArrowUp,
  IconCheck,
  IconChevronRight,
  IconFocus2,
  IconX,
  StatusSpinner,
} from './AgentPanelV4Icons'
import { V4ErrorBar } from './AgentPanelV4Receipt'
import { V4AskCard, type V4AskCardLabels } from './AgentPanelV4AskCard'
import { V4SlotShell } from './AgentPanelV4SlotShell'
import { askCardQuestions } from './agentPanelV4AskModel'
import { PlanRows } from '../../shared/PlanRows'
import type { V4QuestionReply } from './agentPanelV4Question'
import type {
  InterventionData,
  QueueRowData,
  TaskCardData,
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
                    candidate.adopted && 'outline outline-1 outline-offset-1 outline-nomi-ink-40',
                  )}
                >
                  {candidate.thumbnailUrl ? <img src={candidate.thumbnailUrl} alt="" className="size-full object-cover" /> : null}
                  {/* 角标写的是**这一张是谁**（画布 Vocabulary 板是「采用」、FlowGeneration 板是「2 ✓」），
                      由数据给；`adopted` 只管那圈 accent 描边，不改写文字。 */}
                  <span className="absolute left-1 top-1 rounded-sm bg-nomi-overlay-chip px-1 text-micro leading-[15px] text-nomi-media-ink">
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
          {task.footnote || task.undoable ? (
            <V4Row as="div" className="text-micro text-nomi-ink-40">
              <AgentPanelV4Markdown text={task.footnote ?? ''} />
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

// 槽头那排 icon 随**带底色的卡头条**一起删掉了（2026-09-22 换壳）。
// 参照物（Beautiful UI 的 Approval / Recommendation Card）没有它：标题就是一句问话，
// 一句话自己说得清这是什么事，再加一个图标只是把同一件事说两遍。
// `SLOT_ACTION` 那张 kind→动词家族的表也随之退役——它只有 `SlotIcon` 一个消费者。

/**
 * ⑤ 介入槽的**逐镜价格折叠**（SpendCardQ1 板 card.per-shot，D5）。
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

export function V4Intervention({
  data,
  body,
  labels,
  onConfirm,
  onReject,
  onEscalate,
  onAlternate,
  onAnswer,
  onPlanToggle,
  onCollapsePlan,
  planCollapsed = false,
  waiting = true,
}: {
  data: InterventionData
  /**
   * 卡体（标题下、价格折叠上）。付费卡放的是**指向元素 + 一行只读摘要 + 说明行**（`AgentPanelV4SpendCardBody`，
   * SpendCardQ1 板）：卡上没有可改的东西，想改点指向元素去节点里改（设计系统 §1.0）。
   *
   * 2026-09-10 到 D2 第③步之间这里收的是**整件画布生成框**（`NodeGenerationComposer` 的面板宿主），卡上就能改参数——
   * 于是节点与卡两边各存一份、两边拉锯。D2 起改参数只有一个家：节点。
   *
   * 给了它就**替掉** `data.params` 那排只读 chip（同一张卡上同一件事不说两遍）。
   */
  body?: React.ReactNode
  labels: { confirm: string; reject: string; escalate: string; cancel: string; confirmReject: string; collapsePlan: string; expandPlan: string; ask: V4AskCardLabels }
  /** 确认。计划槽传的是当前勾选集，其余档传 `undefined`。 */
  onConfirm?: () => void
  /** 拒绝。`reason` 是渐进披露出来的那一行，可为空。 */
  onReject?: (reason?: string) => void
  /** 「不再问 →」——**这一个能力**以后不再问，不是整个项目（2026-09-06 拍板 ②）。 */
  onEscalate?: () => void
  onAlternate?: () => void
  /**
   * 用户回答了这个问题。**chip 和卡内那一行回车走同一个动作**（拍板 ⑤：选项本身就是回答）。
   * 以前这里是 `onOption`，宿主把标签填进下方 composer 就算完——那不是提交，是帮你打字。
   */
  onAnswer?: (reply: V4QuestionReply, questions: readonly string[]) => void
  /**
   * 计划行的勾选。**必填**（R28：能让编译器拦的别留给门岗）——它曾是可选 prop，
   * 宿主一个都没传，于是「不勾就是不做」这句承诺在界面上点不动
   * （2026-09-11 用户实测：8 镜计划卡无法取消）。可选 prop 的代价就是这个：
   * 少接一根线不报错，只是安静地变成一个点不动的复选框。
   * 真没有宿主的取景位（设计实验室）也得**显式**写 `() => undefined`，那是一次表态，不是遗漏。
   */
  onPlanToggle: (label: string, checked: boolean) => void
  /** 收起/展开计划清单。同上，必填。 */
  onCollapsePlan: () => void
  /** 清单当前是不是收起态（由宿主持有：它知道这张卡是哪一次待决的）。 */
  planCollapsed?: boolean
  /**
   * 这张卡在等用户回答。**缺席 = 在等**——完整推导写在 `V4SlotShell` 的同名参数上。
   * 一句话：生产里介入槽只在 `projection.pending` 在时才挂卡，而那正是
   * `laneComposerState()` 回 `'awaiting-approval'` 的同一个字段；答完 / 收回 / 已确认之后
   * 卡从槽里消失、在流里变成一行「已回答 · …」收据，不是留在原地换皮。
   * 留成可选是给设计实验室画「已答 / 已确认」那一态用的，生产侧没有人需要传。
   */
  waiting?: boolean
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
  // 反问只有选项 chip；「本该有卡却没有」是一条**报错**，没有可点的东西——
  // 给它一个「确认」按钮等于让用户去确认一件我们自己都没渲染出来的事。
  const hasActions = data.kind !== 'question' && data.kind !== 'missing-card'
  /**
   * 外框强调「在等你」的只有真的在等人回答的卡（2026-09-22 待答态）。两种不在等：
   * · 「本该有卡却没有」那一张在**报一条断链**——上面根本没有可点的东西；
   * · 动作已经交出去、正在一段一段走的那一张（`progress`，付费卡「正在发出 k/N 段」，板 card.progress 的 quiet）：
   *   它在说进度，不在等人点。
   * 这不是第二个 pending 布尔：读的是已有的 `kind` / `progress`，没有新字段、没有新产地。
   */
  const shellWaiting = waiting && data.kind !== 'missing-card' && !data.progress
  // 计划槽底栏：主动作 + 「改一下」…… 「收起 ▴/展开 ▾」，**以及和其余档一样的文字「取消」**。
  //
  // 原来这里没有 ×，理由是「整张不要就是不勾任何一项」。2026-09-11 用户实测把这条否了：
  // 逐条取消 8 个勾再确认，是让人用 8 下点击说一句「不用了」，而且当时那几个勾还点不动。
  // 否定动作是全站统一的（2026-10-07 起是决定栏里的文字「取消」，不再是右上角 ×），计划卡不该是唯一的例外。
  const isPlan = data.kind === 'plan'
  // ⑤ 的**反问那一档不走这只外壳**（2026-09-21 用户退回自拼版后的裁决）。
  //
  // 这只外壳是**确认卡**的：accent 边框 + accent 底色的槽头 + 底部那句「不再问」的作用域、
  // 以及带边框的 `V4SlotInput`（它本来是拒绝原因那一行）。反问卡从来没有「不再问 →」那颗钮
  // （`hasActions` 对 question 恒 false），于是那句作用域解释的是一个不存在的按钮；
  // 卡头也没有「这次要动什么」可印，只能塞一句「需要你定一下」的套话，把模型真正问的那句话
  // 挤到了正文里。三样都是确认卡的零件漏了过来。
  //
  // 反问卡整件用 Beautiful UI 的 Approval Card（`AgentPanelV4AskCard.tsx` 文件头有逐件对照）。
  // 它自带 ×、页脚、跳过与主按钮，所以在这里**整支早返回**——不是在外壳里加一堆
  // `kind === 'question' ? null : …`（那样两张卡会继续互相牵制，改一张永远要担心另一张）。
  //
  // ⚠️ 这一支**必须排在本组件全部 hook 之后**：同一个实例上 `data.kind` 是会变的
  // （待决队列换了一条），提前 return 会让下一次渲染少调两个 `useState`，
  // 那是 hook 顺序错位，不是样式问题。
  if (data.kind === 'question') {
    return (
      <V4AskCard
        questions={askCardQuestions(data)}
        labels={labels.ask}
        waiting={shellWaiting}
        {...(data.answerDraft ? { answerDraft: data.answerDraft } : {})}
        // 卡按契约吐整张卡的答复（答了的 + 明说跳过的）；问句表一并递上去——回给模型的那段字
        // 要带题号与问句，而写法只有 owner 那一份（`askUserReplyText`）。
        {...(onAnswer ? { onAnswer: (reply: V4QuestionReply) => onAnswer(reply, askCardQuestions(data).map((question) => question.question)) } : {})}
        onDismiss={() => onReject?.()}
      />
    )
  }

  // 页脚先算成一个值再交给外壳：它闭包里用着 rejecting / reason / labels 一大把局部量，
  // 抽成独立组件要把它们全当 prop 再传一遍，那是把一处可读的 JSX 换成十个参数。
  const dismissCard = (): void => (data.reasonPlaceholder ? setRejecting(true) : onReject?.())
  const dismissLabel = data.dismissLabel ?? labels.reject
  const slotFooter = hasActions ? (
    // 动作行可以折成两行：放不下一行时，左边的整颗换到上一行（靠左），右边这一组保持一组、靠右——
    // 不截断、不挤压、主按钮不被挤到下一行（2026-10-01）。中文在默认面板宽下一行放得下。
    <V4Row as="div" className="flex-wrap text-caption" data-v4-block="actions">
      {data.progress ? (
        // 动作已经交出去、正在一段一段走（付费卡「正在发出 k/N 段」）：不摆主动作，只说怎么停——右边那颗文字「取消」就是停下。
        <>
          <span className="text-caption text-nomi-ink-60" data-v4-block="slot-progress">{data.progress.hint}</span>
          <span className="flex-1" />
          <WorkbenchButton size="sm" className="shrink-0" onClick={dismissCard} data-v4-control="slot-dismiss">
            {dismissLabel}
          </WorkbenchButton>
        </>
      ) : rejecting || data.kind === 'reject-reason' ? (
        <>
          <span className="flex-1" />
          <WorkbenchButton size="sm" onClick={() => { setRejecting(false); setReason('') }} data-v4-control="cancel-reject">
            {labels.cancel}
          </WorkbenchButton>
          <WorkbenchButton
            size="sm"
            className="text-nomi-danger"
            onClick={() => onReject?.(reason.trim() || undefined)}
            data-v4-control="confirm-reject"
          >
            {labels.confirmReject}
          </WorkbenchButton>
        </>
      ) : (
        <>
          {/* ── 左：**元信息** ── 次要动作贴着说明文字，数量只由主按钮表达。 */}
          {canEscalate ? (
            <button type="button" className="text-micro text-nomi-ink-40" onClick={onEscalate} data-v4-control="escalate">
              {labels.escalate}
            </button>
          ) : null}
          {isPlan ? (
            <button
              type="button"
              className="text-micro text-nomi-ink-40"
              onClick={onCollapsePlan}
              data-v4-control="collapse-plan"
            >
              {planCollapsed ? labels.expandPlan : labels.collapsePlan}
            </button>
          ) : null}
          {/* ── 右：**这一张的动作**，一组、靠右。安静次按钮在左、深色主按钮在右（参照物的排法）。
              否定动作是这一组最左的文字「取消」（失败时说「先不发了」，2026-10-07 起右上角没有 ×）。 */}
          <span className="flex grow items-center justify-end gap-1.5" data-v4-block="card-actions">
            {/* 决定栏的否定钮（文字）：右组最左、紧挨主动作（设计系统 §1.9.1）。任何时候都能点（不随动作在路上置灰）。 */}
            <WorkbenchButton size="sm" className="shrink-0" onClick={dismissCard} data-v4-control="slot-dismiss">
              {dismissLabel}
            </WorkbenchButton>
            {data.alternateLabel ? (
              // 次动作 = 现役描边按钮（agent 专章 §8.2：主次只用颜色分，深底=主、描边=次；
              // 文字链不与按钮同排）。
              <WorkbenchButton size="sm" onClick={onAlternate} disabled={data.actionsDisabled === true} data-v4-control="alternate">
                {data.alternateLabel}
              </WorkbenchButton>
            ) : null}
            <WorkbenchButton
              variant="primary"
              size="sm"
              onClick={onConfirm}
              disabled={data.actionsDisabled === true}
              data-v4-control="confirm"
              // 单动作最小宽 72px（agent 专章 §8.2），否则两个字的按钮会缩成小方块。尺寸阶梯上没有 72，取上一档 80（`min-w-20`），不写任意值。
              className="min-w-20 shrink-0"
            >
              {/* 「去改镜 N」「去看镜 N」：这一下是去画布上那个节点，前面是全仓「定位」那一个图形（设计系统 §6）。 */}
              {data.confirmIcon === 'locate' ? <IconFocus2 size={14} stroke={1.8} aria-hidden="true" className="shrink-0" /> : null}
              {data.confirmLabel ?? labels.confirm}
              <span aria-hidden="true" className="text-micro opacity-70">⏎</span>
            </WorkbenchButton>
          </span>
        </>
      )}
    </V4Row>
  ) : undefined
  // 标题前的图标只在两种时候有（板 card.progress / card.failure）：正在发出（转圈）、没成（警示）。
  // 等人决定的那一档标题就是一句问话，前面不顶图标（2026-09-22 换壳：一句话自己说得清这是什么事）。
  const titleIcon = data.progress
    ? <span className="shrink-0 self-center text-nomi-accent" data-v4-block="slot-title-icon"><StatusSpinner size={14} /></span>
    : data.failed
      ? <span className="shrink-0 self-center text-nomi-danger-ink" data-v4-block="slot-title-icon"><IconAlertTriangle size={14} aria-hidden="true" /></span>
      : null
  return (
    <V4SlotShell
      kind={data.kind}
      waiting={shellWaiting}
      {...(data.failed ? { tone: 'danger' as const } : {})}
      // 标题就是**一句话**，不再是带底色卡头条里的一行小字（2026-09-22 换壳）。
      // 徽章（「生成 · Nomi 选的」「不可逆」「可撤销」）紧跟标题、同一行：来源信息说的是「这张卡是什么」，属于标题行。
      title={(
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          {titleIcon}
          <AgentPanelV4Markdown text={data.title} />
          {data.badge ? (
            <span className="shrink-0 text-micro font-normal text-nomi-ink-60" data-v4-block="slot-badge">{data.badge}</span>
          ) : null}
        </span>
      )}
      // 右上角没有 ×：这些是内联卡片不是窗口，「取消」是决定栏里的文字按钮（§1.9.1）。
      {...(slotFooter ? { footer: slotFooter } : {})}
    >
        {data.summary ? <AgentPanelV4Markdown text={data.summary} /> : null}
        {body ?? (data.params?.length ? (
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
        {data.plan?.length && !planCollapsed ? (
          // 清单自己滚：卡壳是 `overflow-hidden`（圆角要它），所以清单不给自己一个滚动容器
          // 就等于「第 9 行起不存在」——用户 2026-09-11 报的 8 镜计划卡正是这样，
          // 下面几镜连同底栏一起被裁在卡外。高度上限按 6 行留（再多就该收起来读）。
          <PlanRows
            rows={data.plan}
            onToggle={(row, checked) => onPlanToggle(row.label, checked)}
            renderLabel={(row) => (
              <>
                <AgentPanelV4Markdown text={row.label} />
                {row.detail ? <AgentPanelV4Markdown text={row.detail} /> : null}
              </>
            )}
          />
        ) : null}
        {data.reasonPlaceholder && (rejecting || data.kind === 'reject-reason') ? (
          // 这一行不自己提交：拒绝要说的那句话由底栏的「确认不要」收尾（渐进披露的第二下）。
          <V4SlotInput value={reason} placeholder={data.reasonPlaceholder} control="reject-reason" onChange={setReason} />
        ) : null}
        {data.scope ? <p className="m-0 text-micro text-nomi-ink-60">{data.scope}</p> : null}
    </V4SlotShell>
  )
}

/**
 * 槽里那一条输入。**一份长相，两个用处**：拒绝原因（渐进披露出来的那一行）和反问卡里
 * 用户自己作答的最后一行。
 *
 * 两处各写一份的代价已经算过一次了（同一种 chip 两份 className，R14.1 横扫的东西）：
 * 同一个槽里出现第二种输入写法，改一次圆角就得改两处，而其中一处永远会被忘掉。
 * 所以自由作答那一行**不是新造的样式**——它就是这一件，只多了右端那颗 ↑。
 */
function V4SlotInput({
  value,
  placeholder,
  control,
  onChange,
  onSubmit,
  submitLabel,
  autoFocus = false,
}: {
  value: string
  placeholder: string
  control: string
  onChange: (value: string) => void
  /** 缺席 = 这一行不自己提交（拒绝原因那一档由底栏的「确认不要」收尾）。 */
  onSubmit?: (value: string) => void
  /** 右端那颗 ↑ 的无障碍名。给了才画那颗钮。 */
  submitLabel?: string
  autoFocus?: boolean
}): JSX.Element {
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  // 卡一出现，光标就落在卡内这一行——这一刻在等你的东西只有它（拍板细则）。
  // 下面的 composer 没被禁用，点一下焦点就过去，卡原样留着。
  React.useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])
  return (
    <div className="flex items-center gap-1.5">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
          // **空的时候回车什么都不做**：不提交，也不把这次回车漏给别人。
          // `preventDefault` 是那条规则的后半句——这一行住在一张卡里，卡又住在面板里，
          // 不拦住的话这次回车会被外层当成「发出去」，于是要么发出一条空消息、
          // 要么把上一条草稿误发（拍板细则原话）。
          event.preventDefault()
          if (!onSubmit) return
          const text = value.trim()
          if (text) onSubmit(text)
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        data-v4-control={control}
        className="h-7 min-w-0 flex-1 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2 text-caption text-nomi-ink placeholder:text-nomi-ink-40"
      />
      {onSubmit && submitLabel ? (
        <button
          type="button"
          aria-label={submitLabel}
          title={submitLabel}
          // ↑ 和回车是**同一个动作**，不是第二个出口——所以它和回车共用同一条空值判据。
          onClick={() => { const text = value.trim(); if (text) onSubmit(text) }}
          data-v4-control={`${control}-submit`}
          className="grid size-7 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-60 hover:bg-nomi-ink-05 disabled:opacity-40"
          disabled={!value.trim()}
        >
          <IconArrowUp size={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
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
              <button type="button" key={action} disabled={row.actionsDisabled} className="font-medium text-nomi-ink-80 disabled:opacity-40" onClick={() => onAction?.(rowIndex, action)}>
                {action}
              </button>
            ))}
            {row.destructiveAction ? (
              <button type="button" aria-label={row.destructiveAction} className="grid size-[22px] place-items-center rounded-nomi-sm text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-danger" onClick={() => onDestructiveAction?.(rowIndex)}>
                <IconX size={14} aria-hidden="true" />
              </button>
            ) : null}
            {row.status === 'draft' || (!row.actions?.length && !row.destructiveAction) ? labels[row.status] : null}
          </span>
        </V4Row>
      ))}
    </section>
  )
}
