import { shouldReduceMotion } from '../../../design/motion'
/**
 * 反问卡。**骨架**来自 Beautiful UI 的 Approval Card（MIT，见 `vendor/BEAUTIFUL-UI-LICENSE.md`），
 * **长相百分之百是 Nomi 的**（2026-09-22 用户：「卡族换壳，主要是要用我们的设计系统」）。
 *
 * 判据只有一条：把这张卡的截图贴在 Nomi 任何一屏旁边，看不出它是外来的。
 * 所以卡上**每一样东西都是 Nomi 里已有的那个件**，不是照着 Beautiful UI 新画一个相似的：
 *
 * | 卡上的元素 | 用的是 Nomi 的哪一件 | 出处 |
 * |---|---|---|
 * | 卡壳（底色/描边/圆角） | 和同屏 composer 逐字相同 | `AgentPanelV4SlotShell.tsx` ← `AgentPanelV4Composer.tsx:181` |
 * | 右上 × | `WorkbenchIconButton size="sm"` | `src/design/actions.tsx:124`，agent 专章 §8.1 |
 * | 主按钮（继续 / 发送） | `WorkbenchButton variant="primary" size="sm"` | `src/design/actions.tsx:267` |
 * | 选项行的圆点 / 方框 | 原生 `<input type="radio|checkbox">` + `accent-nomi-accent`，与**同槽计划卡的勾选行**同一写法 | `AgentPanelV4Cards.tsx` plan-rows |
 * | 选项文字 / 说明 | `text-caption text-nomi-ink-80` / `text-micro text-nomi-ink-60`（计划行同档） | 同上 |
 * | 行 hover 底 | `bg-nomi-ink-05`（composer 里每颗钮的 hover 就是它） | `AgentPanelV4Composer.tsx:264` |
 * | 「推荐」标 | 状态徽标：11px 药丸、soft 底 + `-ink` 档小字（不可点） | 设计系统 §2.1（`-ink` 不是可选装饰）、agent 专章 §8.1 |
 * | 末行自由输入 | composer 输入框同一组字色类（透明底、无边框、`placeholder:text-nomi-ink-40`） | `AgentPanelV4Composer.tsx:250` |
 * | 页码 `‹ 1/3 ›` | 面板现役翻页器 `V4Pager`（付费卡多镜翻页用的就是它） | `AgentPanelV4SlotShell.tsx` |
 *
 * 从 Beautiful UI 拿的**只有骨架与交互**：问题作标题、竖排整行可点的选项、末行内联输入、
 * 一次一题且卡高随题滑动（空间过渡）、单选点了 480ms 自动前进、
 * 多选与自由输入等主按钮、一条在行间滑动的高亮带（220ms）、`ready` 闸防首帧撑满。
 * 它的颜色、圆角、字号、阴影、按钮长相**一个值都没带过来**。
 *
 * **「跳过」与右上 × 是两个动作**（2026-09-22 主会话裁决）：× = 整张卡不答；「跳过」= 跳过
 * **当前这一题**进下一题。所以只有一题时页脚不放「跳过」（那时它和 × 是同一件事，
 * §1.5.2 一功能一个家）；多题时才出现，用现役**次按钮**（`WorkbenchButton size="sm"`，描边档——
 * agent 专章 §8.2：主次只用颜色分；文字链不与按钮同排）。
 *
 * 我们在骨架上只加两样：选项第二行 `description`、「推荐」标（推荐项排第一）。
 */
import React, { type JSX } from 'react'
import { WorkbenchButton } from '../../../design'
import { cn } from '../../../utils/cn'
import { V4Row } from './AgentPanelV4Row'
import { V4Pager, V4SlotShell } from './AgentPanelV4SlotShell'
import {
  ASK_AUTO_ADVANCE_MS,
  EMPTY_ASK_DRAFT,
  askCardAnswer,
  askOptionIndexForArrow,
  askOptionIndexForKey,
  askSkipOutcome,
  askQuestionAnswered,
  isLastAskQuestion,
  orderedAskOptions,
  shouldAutoAdvance,
  shouldShowPager,
  shouldShowSkip,
  toggleAskOption,
  type V4AskDraft,
  type V4AskQuestion,
} from './agentPanelV4AskModel'
import type { V4QuestionReply } from './agentPanelV4Question'

export type V4AskCardLabels = Readonly<{
  /** 右上那颗 × 的无障碍名（= 这次不答）。 */
  dismiss: string
  /** 多题时页脚那颗「跳过」（= 跳过当前这一题）。只有一题时不渲染。 */
  skip: string
  continueLabel: string
  send: string
  customPlaceholder: string
  recommended: string
}>

/** 滑动曲线与时长照搬 Approval Card 的 `SLIDE`。 */
const SLIDE = 'var(--nomi-duration-spatial) var(--nomi-ease-spatial)'


/**
 * 一条滑动高亮带（Approval Card 的 `GlideMenu`）。
 *
 * 它是**这张卡上唯一的选中/悬停反馈**——正因为有它，选项行才不需要各自长一个方框。
 * 上一版每颗 chip 自带 `border` 就是把这件事做反了：三颗宽度不一的框，用户读到的是
 * 「这三个是三种不同的东西」。
 */
function AskGlideMenu({ children, className }: { children: React.ReactNode; className?: string }): JSX.Element {
  const ref = React.useRef<HTMLDivElement>(null)
  const [box, setBox] = React.useState<{ top: number; height: number } | null>(null)
  const [visible, setVisible] = React.useState(false)
  const moveTo = (target: EventTarget | null): void => {
    const container = ref.current
    if (!(target instanceof Element) || !container) return
    const row = target.closest('[data-ask-row]')
    if (!(row instanceof HTMLElement) || !container.contains(row)) return
    const containerRect = container.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    setBox({ top: rowRect.top - containerRect.top, height: rowRect.height })
    setVisible(true)
  }
  return (
    <div
      ref={ref}
      onMouseOver={(event) => moveTo(event.target)}
      onMouseLeave={() => setVisible(false)}
      onFocusCapture={(event) => moveTo(event.target)}
      onBlurCapture={(event) => {
        if (!ref.current?.contains(event.relatedTarget as Node | null)) setVisible(false)
      }}
      className={cn('relative', className)}
    >
      <span
        aria-hidden="true"
        data-ask-glide={visible && box ? 'on' : 'off'}
        className="pointer-events-none absolute inset-x-0 rounded-nomi-sm bg-nomi-ink-05"
        style={{
          top: box?.top ?? 0,
          height: box?.height ?? 0,
          opacity: box && visible ? 1 : 0,
          transition: shouldReduceMotion()
            ? 'opacity var(--nomi-duration-fast) var(--nomi-ease-out)'
            : 'top var(--nomi-duration-normal) var(--nomi-ease-spatial), height var(--nomi-duration-normal) var(--nomi-ease-spatial), opacity var(--nomi-duration-fast) var(--nomi-ease-out)',
        }}
      />
      {children}
    </div>
  )
}

export function V4AskCard({
  questions,
  labels,
  answerDraft,
  waiting = true,
  onAnswer,
  onDismiss,
}: {
  questions: readonly V4AskQuestion[]
  labels: V4AskCardLabels
  /**
   * 这张卡在等用户回答。**缺席 = 在等**——理由与推导全写在 `V4SlotShell` 的同名参数上
   *（一句话：生产里卡挂着就等于 `projection.pending` 在，答完它自己会从槽里消失）。
   * 这里留成可选，是为了让设计实验室画得出「已答」那一态；生产侧没有人需要传它。
   */
  waiting?: boolean
  /**
   * 卡挂载时自由输入那一行里已经有的字（只给设计实验室画「正在打字」那一态用；
   * 生产侧永远缺席）。和 `InterventionData.answerDraft` 同一个理由、同一条规矩：
   * 不拿它给用户预填答案——替他把话写好，他就只能顺着改。
   */
  answerDraft?: string
  /** 用户把整张卡答完了。**一题一条**（契约 §8.4），没答的题不出现。 */
  onAnswer?: (reply: V4QuestionReply) => void
  /**
   * × 与「跳过」走这里（= 这次不答）。**必填**，和 `V4Intervention.onPlanToggle` 同一条规矩
   * （R28：能让编译器拦的别留给门岗）。
   *
   * 它可选过一版，代价当场就出现了：设计实验室没传，于是那颗 × 在实验室里整个不见，
   * 而我正是靠实验室截图去和实物对账的——一颗**可选**的钮在截图里和「设计上就没有」
   * 长得一模一样。跳过一次提问永远是做得到的事，不存在「这个宿主没有这个能力」，
   * 所以真没有去处的取景位也得显式写 `() => undefined`，那是一次表态，不是遗漏。
   */
  onDismiss: () => void
}): JSX.Element {
  const total = questions.length
  const [index, setIndex] = React.useState(0)
  const [drafts, setDrafts] = React.useState<readonly V4AskDraft[]>(
    () => questions.map((_, position) => (position === 0 && answerDraft
      ? Object.freeze({ picked: Object.freeze([]) as readonly number[], custom: answerDraft })
      : EMPTY_ASK_DRAFT)),
  )
  const [cursor, setCursor] = React.useState<number | undefined>(undefined)
  const trackRef = React.useRef<HTMLDivElement>(null)
  const itemRefs = React.useRef<(HTMLDivElement | null)[]>([])
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const advanceTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const measured = React.useRef(false)
  const [viewportH, setViewportH] = React.useState<number | undefined>(undefined)
  const [trackY, setTrackY] = React.useState(0)
  const [animate, setAnimate] = React.useState(false)
  /**
   * 量到第一题的高度之前**只挂当前这一题**（Approval Card 的 `ready`，照搬）。
   *
   * 不这么做的后果它自己的注释写得很清楚，我第一版漏了、走查当场抓了出来：首帧 `viewportH`
   * 还是 undefined，高度是 auto，于是三道题一起摞出来把卡撑满，量完再缩回去——用户看到
   * 卡「闪」一下。顺带还有第二个后果：静态标记渲染里三道题**全在 DOM 里**，
   * 「这张卡上有几个选项、有几行自由输入」这类判据会把看不见的那两题也数进去。
   */
  const [ready, setReady] = React.useState(false)

  const question = questions[index]
  const options = React.useMemo(() => orderedAskOptions(question?.options ?? []), [question])
  const draft = drafts[index] ?? EMPTY_ASK_DRAFT
  const multiSelect = question?.multiSelect === true
  const answered = askQuestionAnswered(draft)
  const last = isLastAskQuestion(index, total)

  // 卡高跟着这一题的真实高度走（Approval Card 的 `sync()`）：题目长短不一，
  // 卡固定高就会在短题下留一大块空、在长题下把选项裁掉。
  React.useLayoutEffect(() => {
    const item = itemRefs.current[index]
    if (!item) return
    const withAnim = measured.current && !shouldReduceMotion()
    measured.current = true
    setViewportH(item.offsetHeight)
    setTrackY(item.offsetTop)
    setAnimate(withAnim)
    setReady(true)
  }, [index, drafts, questions])

  React.useEffect(() => () => { if (advanceTimer.current) clearTimeout(advanceTimer.current) }, [])

  const setDraft = (next: V4AskDraft): void => {
    setDrafts((current) => current.map((item, position) => (position === index ? next : item)))
  }

  const submit = (nextDrafts: readonly V4AskDraft[]): void => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current)
    const reply = askCardAnswer(questions, nextDrafts)
    if (reply.answers.length) onAnswer?.(reply)
  }

  const advance = (nextDrafts: readonly V4AskDraft[]): void => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current)
    if (last) submit(nextDrafts)
    else { setIndex((current) => Math.min(total - 1, current + 1)); setCursor(undefined) }
  }

  const pick = (position: number): void => {
    const next = toggleAskOption(draft, position, multiSelect)
    const nextDrafts = drafts.map((item, at) => (at === index ? next : item))
    setDrafts(nextDrafts)
    setCursor(position)
    if (!shouldAutoAdvance(multiSelect)) return
    if (advanceTimer.current) clearTimeout(advanceTimer.current)
    advanceTimer.current = setTimeout(() => advance(nextDrafts), ASK_AUTO_ADVANCE_MS)
  }

  const skip = (): void => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current)
    const outcome = askSkipOutcome(index, drafts)
    setDrafts(outcome.drafts)
    if (outcome.next === 'next-question') { setIndex((current) => Math.min(total - 1, current + 1)); setCursor(undefined) }
    else if (outcome.next === 'submit') submit(outcome.drafts)
    else onDismiss()
  }

  const goTo = (next: number): void => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current)
    setIndex(Math.min(Math.max(next, 0), total - 1))
    setCursor(undefined)
  }

  /**
   * 键盘（任务书拍板）：↑↓ 选、数字键直选、回车继续、Esc 跳过。
   *
   * 焦点落在自由输入那一行时**不接管 ↑↓ 和数字键**——那儿的数字是用户在打字，
   * 抢走它等于让人打不出「3 秒」。回车与 Esc 两条照常接管（它们在输入框里没有别的含义）。
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    // 「在打字」只认**文本框**：选项上的原生 radio / checkbox 也是 HTMLInputElement，
    // 把它们也算成打字，↑↓ 和数字键就会在点过一个选项之后全部失灵。
    const typing = event.target instanceof HTMLInputElement && event.target.type === 'text'
    if (event.key === 'Escape') { event.preventDefault(); onDismiss(); return }
    if (event.key === 'Enter') {
      if (event.nativeEvent.isComposing) return
      event.preventDefault()
      if (answered) advance(drafts)
      return
    }
    if (typing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const next = askOptionIndexForArrow(cursor, event.key === 'ArrowDown' ? 1 : -1, options.length)
      if (next === undefined) return
      event.preventDefault()
      setCursor(next)
      return
    }
    const direct = askOptionIndexForKey(event.key, options.length)
    if (direct === undefined) return
    event.preventDefault()
    pick(direct)
  }

  if (!question) return <></>

  return (
    <V4SlotShell
      kind="question"
      waiting={waiting}
      data-ask-card="true"
      tabIndex={0}
      onKeyDown={onKeyDown}
      // × 的位置由外壳定死（卡族一处），反问卡不自己摆那颗钮。
      dismiss={{ label: labels.dismiss, onClick: onDismiss }}
      // **没有 `title`**：问题要跟着题轨一起滑（多题），钉在壳上就滑不动了，
      // 所以标题由下面每一题自己画——字号字重与外壳的标题同一档。
      footer={(
        <V4Row as="div" className="text-caption" data-v4-block="ask-footer">
          {/* 左下：页码。用的就是面板现役翻页器（付费卡多镜翻页那一颗），不另画一套。
              只有一题时整段不渲染——「1/1」是一句废话，`V4Pager` 对单项也是这条规矩。 */}
          {shouldShowPager(total) ? (
            <V4Pager pager={{ index, total }} onPage={goTo} />
          ) : null}
          <span className="flex-1" />
          {/* 「跳过」= 跳过**当前这一题**（不是整张卡——那是右上 ×）。只有一题时不渲染。 */}
          {shouldShowSkip(total) ? (
            <WorkbenchButton size="sm" onClick={skip} data-v4-control="ask-skip" className="min-w-20">
              {labels.skip}
            </WorkbenchButton>
          ) : null}
          {/* 主按钮。未作答置灰。 */}
          <WorkbenchButton
            variant="primary"
            size="sm"
            disabled={!answered}
            onClick={() => advance(drafts)}
            data-v4-control="ask-continue"
            className="min-w-20 shrink-0"
          >
            {last ? labels.send : labels.continueLabel}
            <span aria-hidden="true" className="text-micro opacity-70">⏎</span>
          </WorkbenchButton>
        </V4Row>
      )}
    >
      {/* 题轨：所有题竖着摞在一条轨上，靠 translate3d 把当前那一题推到视口里；
          外层的高度跟着当前题动（骨架来自 Approval Card，曲线与时长照搬）。 */}
      <div
        className="overflow-hidden"
        style={{ height: viewportH, transition: animate ? `height ${SLIDE}` : undefined }}
        aria-live="polite"
      >
        <div
          ref={trackRef}
          className="flex flex-col gap-6"
          style={{
            transform: `translate3d(0, ${-trackY}px, 0)`,
            transition: animate ? `transform ${SLIDE}` : undefined,
            willChange: 'transform',
          }}
        >
          {questions.map((item, position) => {
            const active = position === index
            if (!ready && !active) return null
            const itemOptions = active ? options : orderedAskOptions(item.options)
            const itemDraft = drafts[position] ?? EMPTY_ASK_DRAFT
            const multi = item.multiSelect === true
            return (
              <div
                key={`${position}-${item.question}`}
                ref={(element) => { itemRefs.current[position] = element }}
                aria-hidden={active ? undefined : true}
                data-ask-question={position}
                data-active={active ? 'true' : 'false'}
                style={{
                  opacity: active ? 1 : 0,
                  transition: animate ? `opacity ${SLIDE}` : undefined,
                  pointerEvents: active ? undefined : 'none',
                }}
              >
                {/* 问题**就是**标题（同外壳标题一档：text-body-sm / semibold，和对话流里
                    助手那段话同字号）。`pr-8` 给右上那颗 × 让位。 */}
                <h3 className="m-0 pr-8 text-body-sm font-semibold text-nomi-ink" data-v4-block="ask-question">
                  {item.question}
                </h3>
                {item.note ? (
                  <p className="m-0 mt-1 pr-8 text-caption text-nomi-ink-60" data-v4-block="ask-note">{item.note}</p>
                ) : null}
                <AskGlideMenu className="mt-2 flex flex-col gap-0.5">
                  {itemOptions.map((option, optionIndex) => {
                    const on = itemDraft.picked.includes(optionIndex)
                    return (
                      // 一行 = 一个 <label>：整行可点，圆点 / 方框是**原生控件**
                      // （同槽计划卡的勾选行就是这个写法：原生 input + `accent-nomi-accent`）。
                      // 单选圆、多选方由浏览器给，形状本身说明「能选几个」。
                      <label
                        key={option.id}
                        data-ask-row="option"
                        data-v4-control="question-option"
                        data-option-id={option.id}
                        data-cursor={active && cursor === optionIndex ? 'true' : undefined}
                        className={cn(
                          'relative z-10 flex w-full cursor-pointer items-start gap-2 rounded-nomi-sm px-1 py-1 text-caption',
                          active && cursor === optionIndex ? 'bg-nomi-ink-05' : '',
                        )}
                      >
                        <input
                          type={multi ? 'checkbox' : 'radio'}
                          name={`ask-${position}`}
                          checked={on}
                          tabIndex={active ? 0 : -1}
                          onChange={() => { if (active) pick(optionIndex) }}
                          className="mt-0.5 size-3.5 shrink-0 accent-nomi-accent"
                        />
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className={cn('min-w-0', on ? 'text-nomi-ink' : 'text-nomi-ink-80')}>{option.label}</span>
                            {/* 「推荐」= 状态徽标（不可点）：soft 底 + `-ink` 档小字。base 色压在自己的
                                soft 底上对比只有 4.3 左右，够不到 AA 小字——设计系统 §2.1 的硬规则。 */}
                            {option.recommended ? (
                              <span className="shrink-0 rounded-pill bg-nomi-info-soft px-1.5 text-micro text-nomi-info-ink" data-v4-block="ask-recommended">
                                {labels.recommended}
                              </span>
                            ) : null}
                          </span>
                          {option.description ? (
                            <span className="text-micro text-nomi-ink-60">{option.description}</span>
                          ) : null}
                        </span>
                      </label>
                    )
                  })}
                  {/* 末行自由输入：和 composer 输入框同一组字色类（透明底、无边框），
                      与选项行同宽同缩进。它永远在——只有选项的卡等于说「你只能从这几个里挑」。 */}
                  <label data-ask-row="custom" className="relative z-10 flex items-center gap-2 rounded-nomi-sm px-1 py-1">
                    {/* 空出一个控件那么宽的位，让文字和上面选项的**标签**对齐；
                        一个选项都没有时那一列不存在，再缩进就是一段没来由的空白。 */}
                    {itemOptions.length ? <span className="size-3.5 shrink-0" aria-hidden="true" /> : null}
                    <input
                      ref={active ? inputRef : undefined}
                      type="text"
                      value={itemDraft.custom}
                      tabIndex={active ? 0 : -1}
                      onChange={(event) => {
                        if (!active) return
                        const value = event.target.value
                        setDraft(Object.freeze({
                          picked: multi ? itemDraft.picked : (Object.freeze([]) as readonly number[]),
                          custom: value,
                        }))
                      }}
                      placeholder={labels.customPlaceholder}
                      aria-label={labels.customPlaceholder}
                      data-v4-control="question-answer"
                      className="min-w-0 flex-1 border-0 bg-transparent text-caption leading-normal text-nomi-ink outline-none placeholder:text-nomi-ink-40"
                    />
                  </label>
                </AskGlideMenu>
              </div>
            )
          })}
        </div>
      </div>
    </V4SlotShell>
  )
}
