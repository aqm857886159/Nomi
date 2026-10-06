// Agent 面板 v4 · 积木 ③ 一行收据（AI Elements Tool）
//
// 定稿 Vocabulary 板 ③：一行 28px = 对象 icon + 动作名 + 摘要 + 右侧状态。
// **只有「还有内容可看」才有 ›**，点开就地展开（`.rcptbody`：输入 / 输出两段 pre）。
// 技能载入、附件读取、布局改动都是它，**内联在发生的位置、不置顶**（用户点名 + 实验室 D1）。
// 失败留在原行变红 + 一句话原因，**不弹窗不 toast**（Process 板时刻 5）——
// 错误发生在哪一行就留在哪一行，用户回看时能对上。
import React, { type JSX } from 'react'
import { projectToolOutput } from './agentPanelV4ToolOutput'
import { AgentPanelV4Markdown } from './AgentPanelV4Markdown'
import { V4Row, V4Shimmer } from './AgentPanelV4Row'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../utils/cn'
import { ActionIcon, IconAlertTriangle, IconCheck, IconChevronRight, ToolStatusIcon } from './AgentPanelV4Icons'
import type { ToolReceipt, V4FlowItem } from './agentPanelV4Types'

// The base :root :focus-visible selector is more specific than a utility class.
// Only these summaries use the requested full accent; keyboard focus stays native.
const SUMMARY_FOCUS = 'outline-none focus-visible:outline-2 focus-visible:!outline-[var(--nomi-accent)] focus-visible:outline-offset-2'

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
  const expandable = Boolean(receipt.output)
  // 答完的反问不红：协议上它是一次 `output-denied`（lane 只有准 / 不准），但用户没有拒绝
  // 任何东西——他回答了一个问题。红色在这条面板上只说一件事「这里出问题了」，
  // 给一次正常的作答打上它，等于每答一个问题就在历史里留一条假警报。
  const tone = receipt.answered ? 'text-nomi-ink-60' : STATUS_TONE[receipt.status] ?? 'text-nomi-accent'
  const row = (
    <>
      <span className="shrink-0 text-nomi-ink-60">
        <ActionIcon action={receipt.action} />
      </span>
      <span className="shrink-0 font-medium text-nomi-ink-80">{receipt.label}</span>
      {receipt.summary ? <div className="min-w-0 line-clamp-1 text-micro text-nomi-ink-40"><AgentPanelV4Markdown text={receipt.summary} /></div> : null}
      <span className={cn('flex shrink-0 items-center gap-1 text-micro', tone)}>
        {receipt.answered ? <IconCheck size={12} aria-hidden="true" /> : <ToolStatusIcon status={receipt.status} />}
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
            className="text-nomi-ink-40 transition-transform group-open/receipt:rotate-90"
          />
        ) : null}
      </span>
    </>
  )
  if (!expandable) {
    return (
      <V4Row
        className="min-h-7 rounded-nomi-sm px-2 text-caption text-nomi-ink-60"
        data-v4-block="tool"
        data-status={receipt.status}
        {...(receipt.answered ? { 'data-answered': 'true' } : {})}
      >
        {row}
      </V4Row>
    )
  }
  return (
    <details
      open={receipt.expanded}
      className="group/receipt"
      data-v4-block="tool"
      data-status={receipt.status}
    >
      <V4Row as="summary"
        className={cn(
          'min-h-7 cursor-pointer list-none rounded-nomi-sm px-2 text-caption text-nomi-ink-60 hover:bg-nomi-ink-05',
          'group-open/receipt:bg-nomi-ink-05', SUMMARY_FOCUS,
        )}
      >
        {row}
      </V4Row>
      <div className="mt-1 rounded-nomi-sm border border-nomi-line-soft bg-nomi-paper px-2.5 py-2 text-caption text-nomi-ink-60">
        {receipt.output ? <ReceiptBlock labelKey="agentPanelV4.output" value={receipt.output} markdown /> : null}
      </div>
    </details>
  )
}

/** 宿主确定性给出的那句提示（ToolReceipt.notice），画在流水行外面、不随过程行收起。 */
export function V4ReceiptNotice({ text }: { text: string }): JSX.Element {
  return (
    <p className="m-0 rounded-nomi-sm border border-nomi-accent/30 bg-nomi-accent-soft px-2 py-1 text-caption text-nomi-ink-80" data-v4-notice="director-patch">
      {text}
    </p>
  )
}

function ReceiptBlock({ labelKey, value, markdown = false }: { labelKey: string; value: string; markdown?: boolean }): JSX.Element {
  const { t } = useTranslation()
  const content = markdown ? projectToolOutput(value) : { technical: value }
  return (
    <div className="mb-1.5 last:mb-0">
      <div className="mb-0.5 text-micro text-nomi-ink-40">{t(labelKey)}</div>
      {content.markdown !== undefined ? <AgentPanelV4Markdown text={content.markdown} /> : null}
      {content.technical !== undefined ? <pre className="m-0 whitespace-pre-wrap rounded-nomi-sm bg-nomi-ink-05 px-2 py-1.5 font-nomi-mono text-micro text-nomi-ink-80">
        {content.technical}
      </pre> : null}
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
  undoLabel,
  onUndo,
}: {
  group: Extract<V4FlowItem, { kind: 'tool-group' }>
  statusLabel: string
  undoLabel?: string
  onUndo?: (toolCallId: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const tone = STATUS_TONE[group.status] ?? 'text-nomi-accent'
  return (
    <details className="group/tool-group" data-v4-block="tool-group" data-status={group.status} data-count={group.count}>
      <V4Row as="summary"
        className={cn(
          'min-h-7 cursor-pointer list-none rounded-nomi-sm px-2 text-caption text-nomi-ink-60 hover:bg-nomi-ink-05',
          'group-open/tool-group:bg-nomi-ink-05', SUMMARY_FOCUS,
        )}
      >
        <span className="shrink-0 text-nomi-ink-60">
          <ActionIcon action={group.action} />
        </span>
        <span className="shrink-0 font-medium text-nomi-ink-80">{group.label}</span>
        <span className="shrink-0 font-nomi-mono text-micro text-nomi-ink-40">
          {t('agentPanelV4.toolGroupCount', { count: group.count })}
        </span>
        {group.reason ? <div className="min-w-0 line-clamp-1 text-micro text-nomi-ink-40"><AgentPanelV4Markdown text={group.reason} /></div> : null}
        <span className={cn('flex shrink-0 items-center gap-1 text-micro', tone)}>
          <ToolStatusIcon status={group.status} />
          {group.trailing || statusLabel}
          <IconChevronRight size={12} className="text-nomi-ink-40 transition-transform group-open/tool-group:rotate-90" />
        </span>
      </V4Row>
      <div className="mt-1 flex flex-col gap-0.5 border-l border-nomi-line-soft pl-1.5">
        {group.receipts.map((receipt, index) => (
          <V4ToolReceipt key={`${receipt.label}-${index}`} receipt={receipt} statusLabel={statusLabel}
            undoLabel={undoLabel} onUndo={() => { if (receipt.toolCallId) onUndo?.(receipt.toolCallId) }} />
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
export function V4Process({ label, segments, running, elapsed, failed, retryNote, children }: {
  label: string; segments: readonly string[]; running?: boolean; elapsed?: string; failed?: boolean; retryNote?: string; children?: React.ReactNode
}): JSX.Element {
  const { t } = useTranslation()
  const bodyRef = React.useRef<HTMLDivElement>(null)
  const [long, setLong] = React.useState(false)
  const [expanded, setExpanded] = React.useState(false)
  // 带着未解决失败的那一段**自己展开**：定稿要求「错误留在它那一行」，而收起的过程行会把
  // 那一行连同它下面的红条一起藏掉。展开之后用户照样能手动收起（它仍是可控的 details）。
  const [open, setOpen] = React.useState(Boolean(failed))
  React.useEffect(() => { if (failed) setOpen(true) }, [failed])
  React.useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const measure = () => {
      if (body.getBoundingClientRect().height === 0) return
      setLong(body.scrollHeight > Number.parseFloat(getComputedStyle(body).lineHeight) * 12 + 1)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(body)
    measure()
    return () => observer.disconnect()
  }, [children, segments])
  return (
    <details key={running ? "running" : "settled"} open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className={cn(
      'group/process text-nomi-ink-60',
      // Neutral text belongs to the process; status colors, icons and elapsed time do not.
      '[&_:is(.text-nomi-ink,.text-nomi-ink-80,.text-nomi-ink-40):not(svg):not([data-process-elapsed])]:text-nomi-ink-60',
      '[&_.font-medium]:font-normal [&_.font-semibold]:font-normal [&_.font-bold]:font-normal',
      // Markdown emphasis and inline syntax colors cannot outrank their container either.
      '[&_[data-v4-markdown]_*]:!text-nomi-ink-60 [&_[data-v4-markdown]_*]:!font-normal',
    )} data-v4-block="process" data-running={Boolean(running)}>
      <V4Row as="summary" className={cn("min-h-7 cursor-pointer list-none rounded-nomi-sm px-2 text-caption text-nomi-ink-60 hover:bg-nomi-ink-05 [&>svg]:text-nomi-ink-40", SUMMARY_FOCUS)}>
        <ActionIcon action={running ? 'think' : 'document'} />
        <>{running ? <V4Shimmer>{label}</V4Shimmer> : <span className="min-w-0 truncate">{label}</span>}</>
        {elapsed ? <span data-process-elapsed className="shrink-0 font-nomi-mono text-micro text-nomi-ink-40">{elapsed}</span> : null}
        <IconChevronRight size={12} className="shrink-0 text-nomi-ink-40 transition-transform group-open/process:rotate-90" />
      </V4Row>
      <div ref={bodyRef} className={cn("mt-1 flex flex-col gap-1.5 border-l border-nomi-line-soft py-1 pl-2.5 text-caption leading-relaxed", !expanded && "max-h-[12lh] overflow-hidden", long && !expanded && "[mask-image:linear-gradient(black_80%,transparent)]")} data-process-folded={long && !expanded}>
        {children ?? segments.map((segment, index) => <AgentPanelV4Markdown key={index} text={segment} />)}
        {/* 「它还在自己修」——一句灰字，展开才看得见（2026-09-21 用户拍板②）。
            摘要那一行已经说了「第 N 次尝试」，这里说的是**为什么**又来一次。 */}
        {retryNote ? <p className="m-0 text-micro text-nomi-ink-40" data-v4-process-retry-note>{retryNote}</p> : null}
      </div>
      {long ? <button type="button" className="mt-1 text-micro text-nomi-ink-60" onClick={() => setExpanded(value => !value)}>{t(expanded ? 'agentPanelV4.collapse' : 'agentPanelV4.expand')}</button> : null}
    </details>
  )
}

/**
 * 失败行下方的一句话原因 + 一个动作（`.errbar`）。付费任务必须标「未扣费」。
 * 它跟着收据或任务卡走，不是独立积木。
 */
export function V4ErrorBar({ reason, action, onAction, feedbackLabel, onFeedback }: {
  reason: string
  action?: string
  onAction?: () => void
  /**
   * 「反馈」那一颗（2026-09-15）。**刻意做成第二个可选 prop，而不是把 `action` 改成数组**：
   * 这一行同时被 #789（停止/复制/重试回执）和 tool-face v2 改着，把 `{kind:'error'}` 的形状
   * 从 `action?: string` 拓成动作数组会让三条 lane 在同几行上撞车，而收益只是少一个 prop。
   * 两颗都没接时这一行和以前逐字一样（画出来的钮必须接得上宿主 —— #789 立的那条规矩）。
   */
  feedbackLabel?: string
  onFeedback?: () => void
}): JSX.Element {
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-nomi-sm bg-nomi-danger-soft px-2.5 py-1.5 text-caption text-nomi-danger"
      data-v4-block="errorbar"
    >
      <IconAlertTriangle size={13} aria-hidden="true" />
      <AgentPanelV4Markdown text={reason} />
      {action ? (
        <button type="button" className="font-medium text-nomi-ink-80" onClick={onAction}>
          {action}
        </button>
      ) : null}
      {feedbackLabel && onFeedback ? (
        <button type="button" data-v4-feedback className="font-medium text-nomi-ink-80" onClick={onFeedback}>
          {feedbackLabel}
        </button>
      ) : null}
    </div>
  )
}
