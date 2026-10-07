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
  IconX,
  StatusSpinner,
} from './AgentPanelV4Icons'
import { V4ErrorBar } from './AgentPanelV4Receipt'
import { V4AskCard, type V4AskCardLabels } from './AgentPanelV4AskCard'
import { V4Pager, V4SlotShell } from './AgentPanelV4SlotShell'
import { askCardQuestions } from './agentPanelV4AskModel'
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

// 槽头那排 icon 随**带底色的卡头条**一起删掉了（2026-09-22 换壳）。
// 参照物（Beautiful UI 的 Approval / Recommendation Card）没有它：标题就是一句问话，
// 一句话自己说得清这是什么事，再加一个图标只是把同一件事说两遍。
// `SLOT_ACTION` 那张 kind→动词家族的表也随之退役——它只有 `SlotIcon` 一个消费者。

/**
 * ⑤ 介入槽的**价格行**（形态 9 · B-02）。
 *
 * 一行两端：左边说「怎么算出来的」，右边是加粗合计。合计缺席时右边印的是那句
 * 「暂时算不出价格」——不是 `¥0`。三种可能（免费 / 算不出 / 真的零元）里，
 * 印 0 恰好是唯一会让用户误以为「这次不花钱」的那一种。
 */
function V4PriceRow({ price }: { price: NonNullable<InterventionData['price']> }): JSX.Element {
  return (
    <div className="flex flex-col gap-1" data-v4-block="price">
      {/* 合计**紧跟**算式，不用 flex-1 把它推到右缘（2026-09-09 用户拍板：行尾附属信息紧跟内容）。
          推到右缘的代价不是好不好看：算式和它的结果之间会横着一大片空白，
          读的人得把视线甩过去才知道那个数是这一行算出来的。 */}
      {/* 单镜时没有算式可说（标题已经说了「这 1 段」），这一行整行不画。 */}
      {price.breakdown ? (
        <V4Row as="div" className="text-caption text-nomi-ink-60">
          <span className="min-w-0 truncate">{price.breakdown}</span>
          {/* 合计**搬到页脚左下**了（2026-09-22 换壳）：那里离按钮两厘米，是按下去之前
              最后扫的那一眼。这一行从此只说**算式**——同一个数印两处，改参数时一定有一个先漂。
              `data-v4-price` 这个锚点跟着那个数一起搬到页脚（见下面 `slot-total`），
              不在这里留一个 sr-only 的影子：走查断的是「用户看得见的那个价」，
              挂在看不见的元素上就成了另一种假绿。 */}
        </V4Row>
      ) : null}
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
  onReject,
  onEscalate,
  onAlternate,
  onBatch,
  onAnswer,
  onPlanToggle,
  onCollapsePlan,
  planCollapsed = false,
  waiting = true,
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
  labels: { confirm: string; reject: string; escalate: string; cancel: string; confirmReject: string; collapsePlan: string; expandPlan: string; ask: V4AskCardLabels }
  /** 确认。计划槽传的是当前勾选集，其余档传 `undefined`。 */
  onConfirm?: () => void
  /** 翻到第几张卡（`data.pager` 在时才有意义）。 */
  onPage?: (index: number) => void
  /** 拒绝。`reason` 是渐进披露出来的那一行，可为空。 */
  onReject?: (reason?: string) => void
  /** 「不再问 →」——**这一个能力**以后不再问，不是整个项目（2026-09-06 拍板 ②）。 */
  onEscalate?: () => void
  onAlternate?: () => void
  /** 整叠的动作（付费卡上是「生成剩下 N 张 / 段」），`data.batchLabel` 在时才有意义。 */
  onBatch?: () => void
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
  // 反问只有选项 chip，没有确认/不要——选项本身就是回答（定稿 ⑤ 反问格）。
  // 反问只有选项 chip；「本该有卡却没有」是一条**报错**，没有可点的东西——
  // 给它一个「确认」按钮等于让用户去确认一件我们自己都没渲染出来的事。
  const hasActions = data.kind !== 'question' && data.kind !== 'missing-card'
  /**
   * 「本该有卡却没有」那一张**永远不强调**（2026-09-22 待答态）。
   *
   * 它挂在槽里的理由和别的卡不是一件事：别的卡在等一个答复，它在**报一条断链**——
   * 上面根本没有可点的东西（`hasActions` 对它恒 false）。给它套上「在等你」的框，
   * 等于让用户去回答一张我们自己都没渲染出来的卡，而那正是它被造出来要说清楚的病。
   *
   * 这不是第二个 pending 布尔：它读的是已有的 `kind`，没有新字段、没有新产地。
   */
  const shellWaiting = waiting && data.kind !== 'missing-card'
  // 计划槽底栏：主动作 + 「改一下」…… 「收起 ▴/展开 ▾」，**以及和其余档一样的那颗 ×**。
  //
  // 原来这里没有 ×，理由是「整张不要就是不勾任何一项」。2026-09-11 用户实测把这条否了：
  // 逐条取消 8 个勾再确认，是让人用 8 下点击说一句「不用了」，而且当时那几个勾还点不动。
  // × 是全站统一的否定动作（一 icon 一含义），计划卡不该是唯一的例外。
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

  // 页脚先算成一个值再交给外壳：它闭包里用着 rejecting / reason / pager / labels 一大把
  // 局部量，抽成独立组件要把它们全当 prop 再传一遍，那是把一处可读的 JSX 换成十个参数。
  const slotFooter = hasActions ? (
    <>
        {/* ── 翻页那一行 = 「这一叠」：第几页 + 一共多少（2026-10-01 用户看样张后拍板）──
            翻页器本身一个像素不动（提问卡也用它）；报得出价时右端印这一叠的合计「N 张 / 段 · 合计 ¥X」（单位跟标题同一条规则）。
            单独占一行、压在动作行正上方：挤进动作行会让 390px 的卡横向溢出（实测 350px 可用宽放不下）。 */}
        {(pager || data.totalLead) && !rejecting && data.kind !== 'reject-reason' ? (
          <V4Row as="div" data-v4-block="pager-row">
            {pager ? <V4Pager pager={pager} onPage={onPage} /> : null}
            {data.totalLead ? (
              <>
                <span className="flex-1" />
                {/* 这一叠要花多少。**颜色是 ink，不是警示色**：价格不是警告（设计系统 §2.1.2b）。
                    不截断、不折行：这一行除了翻页器只有它，放得下。 */}
                <span
                  className={cn('shrink-0 whitespace-nowrap text-caption tabular-nums', data.price?.total ? 'text-nomi-ink' : 'text-nomi-ink-60')}
                  data-v4-block="slot-total"
                  // 走查认「这张卡报不报得出价」靠的就是这个属性（`PRICE_TOTAL` / `PRICE_UNAVAILABLE` 两个共享选择器）。
                  data-v4-price={data.price?.total ? 'total' : 'unavailable'}
                >
                  {data.totalLead}
                </span>
              </>
            ) : null}
          </V4Row>
        ) : null}
        {/* 动作行可以折成两行：放不下一行时，左边的整颗换到上一行（靠左），右边这一张的两颗保持一组、靠右——
            不截断、不挤压、主按钮不被挤到下一行（2026-10-01）。中文在默认面板宽下一行放得下。 */}
        <V4Row as="div" className="flex-wrap text-caption" data-v4-block="actions">
          {data.progress ? (
            // 动作已经交出去、正在一张一张走（付费卡「生成剩下 N 张」）：不摆任何按钮，只说怎么停——右上那颗 × 就是停下。
            <span className="text-caption text-nomi-ink-60" data-v4-block="slot-progress">{data.progress.hint}</span>
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
              {/* ── 左：**整叠的动作 + 元信息** ──
                  「生成剩下 N 张」（付费卡多镜时，2026-10-01 用户拍板）在最左：整叠的动作在左、这一张的动作在右，
                  最贵的那颗离主按钮最远，不容易误点。「不再问 →」「收起清单」这类次要的东西也在这一侧。 */}
              {data.batchLabel && onBatch ? (
                <WorkbenchButton size="sm" className="shrink-0" onClick={onBatch} disabled={data.actionsDisabled === true} data-v4-control="batch">
                  {data.batchLabel}
                </WorkbenchButton>
              ) : null}
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
                  否定动作那颗 × 已经搬到卡右上角，由外壳统一摆，这里不再有它。 */}
              <span className="flex grow items-center justify-end gap-1.5" data-v4-block="card-actions">
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
                  // `data-v4-price` 这个走查锚点**跟着那个数走**：多镜时它挂在翻页那一行右端的合计上；
                  // 单镜且报得出价时那一格不出现（同一个数不说两遍），数只印在这颗按钮上，锚点也就挂在这里。
                  // 未知价时不挂——那一档根本没有「合计」可言，走查靠它不存在来认。
                  {...(!data.totalLead && data.price?.total ? { 'data-v4-price': 'total' } : {})}
                  // 单动作最小宽 72px（agent 专章 §8.2），否则两个字的按钮会缩成小方块。尺寸阶梯上没有 72，取上一档 80（`min-w-20`），不写任意值。
                  className="min-w-20 shrink-0"
                >
                  {data.confirmLabel ?? labels.confirm}
                  <span aria-hidden="true" className="text-micro opacity-70">⏎</span>
                </WorkbenchButton>
              </span>
            </>
          )}
        </V4Row>
    </>
  ) : undefined
  return (
    <V4SlotShell
      kind={data.kind}
      waiting={shellWaiting}
      // 有翻页器才可聚焦：焦点是「← → 归谁管」的唯一凭据，没有翻页器的卡不该抢 Tab 序。
      {...(pager ? { tabIndex: 0, onKeyDown: handleKeyDown } : {})}
      // 标题就是**一句话**，不再是带底色卡头条里的一行小字（2026-09-22 换壳）。
      // icon 与徽章跟着卡头条一起走了：icon 在参照物里本来就没有，
      // 徽章（「不可逆」「付费」）是**元信息**，它的新家在页脚左下。
      // 徽章（「付费 · Nomi 选的」「不可逆」「可撤销」）**回到它原来的位置**：紧跟标题、同一行。
      // 上一版把它搬去了页脚左下，结果占了合计的位——真卡左下只剩「付费 · Nomi 选的」、
      // 合计不见了（用户 2026-09-22 看真机指出）。来源信息说的是「这张卡是什么」，属于标题行；
      // 页脚左下只留「这次要花多少」。
      title={(
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          <AgentPanelV4Markdown text={data.title} />
          {data.badge ? (
            <span className="shrink-0 text-micro font-normal text-nomi-ink-60" data-v4-block="slot-badge">{data.badge}</span>
          ) : null}
        </span>
      )}
      // × 统一钉在右上（三张卡一处），不再蹲在页脚右端。
      {...(hasActions ? {
        dismiss: {
          label: labels.reject,
          onClick: () => (data.reasonPlaceholder ? setRejecting(true) : onReject?.()),
        },
      } : {})}
      {...(slotFooter ? { footer: slotFooter } : {})}
    >
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
        {data.plan?.length && !planCollapsed ? (
          // 清单自己滚：卡壳是 `overflow-hidden`（圆角要它），所以清单不给自己一个滚动容器
          // 就等于「第 9 行起不存在」——用户 2026-09-11 报的 8 镜计划卡正是这样，
          // 下面几镜连同底栏一起被裁在卡外。高度上限按 6 行留（再多就该收起来读）。
          <div className="flex max-h-[13.5rem] flex-col gap-1 overflow-y-auto" data-v4-block="plan-rows">
            {data.plan.map((row, index) => (
              <div key={`${index}-${row.label}`} className="flex items-start gap-2 py-[3px] text-caption text-nomi-ink-80">
                <input
                  type="checkbox"
                  aria-label={row.label}
                  checked={row.checked}
                  onChange={(event) => onPlanToggle(row.label, event.target.checked)}
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
