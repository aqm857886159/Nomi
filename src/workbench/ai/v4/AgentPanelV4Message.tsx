import { V4Row, V4Shimmer } from './AgentPanelV4Row'
// Agent 面板 v4 · 积木 ① 用户气泡 · ② 助手文本（含思考行）
//
// 定稿 Vocabulary 板 ①②：用户气泡右对齐 ink 深底，附件缩成 chip **在气泡内**；
// 助手文本纯文本无框（AI Elements Message assistant 无底色），三态只改行尾：
// 生成中光标 · 完成（**hover 才显**复制/重来）· 已中断（灰字 + 继续）。超长只折叠不换形态。
//
// 思考行是 Process 板时刻 2：shimmer 文字 +「4s · esc 打断」。刻意**不用转圈**——
// 转圈没有时间感，秒数才告诉用户「没死」。它是助手文本的一个状态，不是第九个积木。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../utils/cn'
import { AgentPanelV4Markdown } from './AgentPanelV4Markdown'
import { ActionIcon, IconCheck, IconChevronRight, IconCopy, IconRefresh } from './AgentPanelV4Icons'
import { useClipboardCopy } from '../../../design'
import { Message, MessageActions, MessageResponse } from './vendor/aiElementsPrimitives'
import { SkillMedia } from '../../skillLibrary/SkillMedia'
import type { V4AssistantStatus, V4Chip } from './agentPanelV4Types'

/**
 * 附件 / 技能 / 选中片段三种 chip **同一形态**（定稿 Composer 板批注）。
 *
 * 技能那颗印它自己的封面——和 composer 上那颗是**同一个渲染件**（`SkillMedia`）。
 * 从前这里对三种 kind 一律画一个灰方块，用户问的是「是不是缩略图显示不了」
 * （2026-09-10）：他挂技能时在 composer 上看见的是封面，发出去就变成一个色块，
 * 同一颗 chip 长成两副样子。没封面的技能仍落到 `SkillMedia` 自己的图标占位。
 */
function BubbleChip({ chip, onDark }: { chip: V4Chip; onDark: boolean }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-nomi-sm px-2 py-0 pl-1 text-micro',
        onDark ? 'bg-nomi-paper/15' : 'border border-nomi-line text-nomi-ink-80',
      )}
      data-v4-chip={chip.kind}
    >
      {chip.kind === 'skill' ? (
        <SkillMedia cover={chip.cover} preview={chip.preview} iconSize={12} className="size-4 shrink-0 rounded-sm object-cover" />
      ) : (
        <span
          className={cn(
            'h-3 w-4 shrink-0 rounded-sm',
            chip.kind === 'clip' ? 'bg-nomi-track-video' : onDark ? 'bg-nomi-paper/40' : 'bg-nomi-ink-20',
          )}
          aria-hidden="true"
        />
      )}
      <span className="truncate">{chip.label}</span>
    </span>
  )
}

export function V4UserBubble({
  text,
  chips,
  darkMode = false,
}: {
  text: string
  chips?: readonly V4Chip[]
  darkMode?: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const lines = text.split(/\r?\n/)
  return (
    <div
      className={cn(
        'self-end max-w-[86%] rounded-nomi px-3 py-2 text-body-sm',
        // 暗色下用 ink-10 底而不是纯黑（定稿 Dark 板批注）：token 翻转后纯 ink 会变成浅色块。
        darkMode ? 'bg-nomi-ink-10 text-nomi-ink' : 'bg-nomi-ink text-nomi-paper',
      )}
      data-v4-block="user"
    >
      {chips?.length ? (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <BubbleChip key={chip.label} chip={chip} onDark={!darkMode} />
          ))}
        </div>
      ) : null}
      {lines.length > 12 ? (
        <details className="group/user-input">
          <summary className="cursor-pointer list-none">
            <span className="block whitespace-pre-wrap group-open/user-input:hidden">{lines.slice(0, 12).join('\n')}</span>
            <span className="text-micro group-open/user-input:hidden">{t('agentPanelV4.expand')}</span>
            <span className="hidden text-micro group-open/user-input:inline">{t('agentPanelV4.collapse')}</span>
          </summary>
          <p className="m-0 whitespace-pre-wrap">{text}</p>
        </details>
      ) : <p className="m-0 whitespace-pre-wrap">{text}</p>}
    </div>
  )
}

export function V4AssistantMessage({
  text,
  status,
  skill,
  labels,
  onRetry,
  onContinue,
}: {
  text: string
  status: V4AssistantStatus
  /**
   * 这一轮挂着的技能名。有它就在气泡头上印一行凭据——**选了技能之后对话里看不到它**，
   * 用户只能猜到底用上没有（2026-09-10 反馈 #6）。缺席 = 这一轮没挂技能，那一行整行不渲染。
   */
  skill?: string
  labels: { copy: string; copied: string; copyFailed: string; retry: string; continue: string }
  /** 两个动作可缺：设计实验室单件取景时没有宿主可调，钮仍在，只是按下去没有去处。
   *  **复制不在此列**——它不需要宿主（写剪贴板是浏览器的事），所以它没有 handler，
   *  按钮自己做完整件事、自己亮回执。曾经它是一根 `onCopy` 线，宿主那头只写了
   *  `void navigator.clipboard?.writeText(text)`，成败一起吞掉：用户点了复制什么都没发生。 */
  onRetry?: () => void
  /** 「继续」= 给这个还活着的回合追加一句指令（`turn.steer`），不是重发。 */
  onContinue?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const clipboard = useClipboardCopy()
  return (
    <div className="group" data-v4-block="assistant" data-status={status}>
      <Message role="assistant">
        {skill ? (
          <p className="m-0 mb-1 truncate text-micro text-nomi-ink-60" data-v4-skill-used={skill}>
            {t('agentPanelV4.skillUsed', { name: skill })}
          </p>
        ) : null}
        <MessageResponse streaming={status === 'streaming'}>
          <AgentPanelV4Markdown text={text} streaming={status === 'streaming'} />
        </MessageResponse>
        {/* 完成态才有动作，且 **hover 才显**——定稿 ②「hover 出复制/重来两个图标」。 */}
        {status === 'complete' ? (
          <MessageActions className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <button
              type="button"
              aria-label={clipboard.copied ? labels.copied : clipboard.failed ? labels.copyFailed : labels.copy}
              data-v4-copy-state={clipboard.state}
              onClick={() => { void clipboard.copy(text) }}
              className={cn(
                'grid size-[22px] place-items-center rounded-nomi-sm hover:bg-nomi-ink-05',
                clipboard.copied && 'text-workbench-success',
                clipboard.failed && 'text-workbench-danger',
              )}
            >
              {clipboard.copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </button>
            <button
              type="button"
              aria-label={labels.retry}
              onClick={onRetry}
              className="grid size-[22px] place-items-center rounded-nomi-sm hover:bg-nomi-ink-05"
            >
              <IconRefresh size={14} />
            </button>
          </MessageActions>
        ) : null}
        {status === 'interrupted' ? (
          <button
            type="button"
            onClick={onContinue}
            className="mt-1 inline-flex items-center gap-1 text-caption text-nomi-ink-60"
          >
            {labels.continue}
            <IconChevronRight size={12} />
          </button>
        ) : null}
      </Message>
    </div>
  )
}

/**
 * 一排选项 chip。**一份**长相，两个用处：介入槽的「反问」和对话流里的「缺参数」。
 * 早先它只长在介入槽里；缺参数改走对话流（2026-09-06 拍板 ④）时如果照抄一遍，
 * 同一种 chip 就有了两份 className，改一次圆角要改两处——那正是 R14.1 横扫的东西。
 */
export function V4OptionChips({
  options,
  selectedOption,
  onSelect,
}: {
  options: readonly string[]
  selectedOption?: number
  onSelect?: (option: string, index: number) => void
}): JSX.Element {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option, index) => (
        <button
          type="button"
          key={option}
          aria-pressed={index === selectedOption}
          onClick={() => onSelect?.(option, index)}
          className={cn(
            'inline-flex h-[26px] items-center rounded-pill border px-2.5 text-caption',
            index === selectedOption
              ? 'border-nomi-accent bg-nomi-accent-soft text-nomi-accent'
              : 'border-nomi-line text-nomi-ink-80',
          )}
        >
          {option}
        </button>
      ))}
    </div>
  )
}

/**
 * 缺参数（`missing_param`）的家：**一条助手提问 + 一排建议 chip**，就地长在对话流里。
 *
 * 为什么不进介入槽：那个槽问的是「要不要让我做这件事」——它有确认/不要两个出口，
 * 出现时压在 composer 上方、挡住输入。而缺参数根本不是审批，是 Nomi 少问了一句话；
 * 把「你想要几秒？」放进一个带「不要」按钮的框里，用户得先想明白「不要」是什么意思。
 * 放回对话流，它就长得跟任何一次追问一样：点 chip 是快捷答案，直接打字也一样能答。
 */
export function V4Suggestion({
  text,
  options,
  onSelect,
}: {
  text: string
  options: readonly string[]
  onSelect?: (option: string) => void
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5" data-v4-block="suggestion">
      <Message role="assistant">
        <MessageResponse>
          <AgentPanelV4Markdown text={text} />
        </MessageResponse>
      </Message>
      <V4OptionChips options={options} onSelect={(option) => onSelect?.(option)} />
    </div>
  )
}

/**
 * 思考行（Process 板时刻 2）。`brain` icon **只在这一行出现**，秒数与 esc 提示在同一行右端。
 * shimmer 走背景渐变裁字，不是骨架屏。
 */
export function V4Thinking({ label, meta, text, streaming }: {
  label: string
  meta: string
  text?: string
  streaming?: boolean
}): JSX.Element {
  const { t } = useTranslation()
  // Only measure the live interval we actually observed. Restored history has no duration.
  const [seconds, setSeconds] = React.useState<number>()
  React.useEffect(() => {
    if (!streaming) return undefined
    const started = performance.now()
    setSeconds(0)
    const timer = window.setInterval(() => setSeconds(Math.floor((performance.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [streaming])
  const row = (
    <>
      <span className="shrink-0"><ActionIcon action="think" /></span>
      {streaming === false ? <span className="min-w-0 truncate">{t('agentPanelV4.thinkingDone')}</span> : <V4Shimmer>{label}</V4Shimmer>}
      <span className="shrink-0 whitespace-nowrap font-nomi-mono text-micro text-nomi-ink-40">
        {seconds === undefined ? meta : t('agentPanelV4.thinkingSeconds', { count: seconds })}
      </span>
      {text ? <IconChevronRight size={12} className="shrink-0 transition-transform group-open:rotate-90" /> : null}
    </>
  )
  return (
    <div className="min-w-0 text-caption text-nomi-ink-60" data-v4-block="thinking" data-streaming={streaming}>
      {text ? (
        <details className="group">
          <V4Row as="summary" className="min-h-7 cursor-pointer list-none [&::-webkit-details-marker]:hidden">{row}</V4Row>
          <div className="whitespace-pre-wrap break-words py-2 text-body-sm [overflow-wrap:anywhere]" data-v4-thinking-body="true">{text}</div>
        </details>
      ) : <V4Row className="min-h-7">{row}</V4Row>}
    </div>
  )
}
