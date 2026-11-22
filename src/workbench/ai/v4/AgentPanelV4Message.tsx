import { hasMentions, parsePromptSegments, mentionUrlsInOrder } from '../../assets/promptMentions'
import AssetInlineReference from '../../assets/AssetInlineReference'
import { V4Row, V4Shimmer } from './AgentPanelV4Row'
// Agent 面板 v4 · 积木 ① 用户气泡 · ② 助手文本（含思考行）
//
// 定稿 Vocabulary 板 ①②：用户气泡右对齐 ink 深底，附件缩成 chip **在气泡内**；
// 助手文本纯文本无框（AI Elements Message assistant 无底色），三态只改行尾：
// 生成中光标 · 完成（**hover 才显**复制/重来）· 已中断（灰字 + 继续）。超长只折叠不换形态。
//
// 思考行是 Process 板时刻 2：shimmer 文字 +「4s · esc 打断」。刻意**不用转圈**——
// 转圈没有时间感，秒数才告诉用户「没死」。它是助手文本的一个状态，不是第九个积木。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../utils/cn'
import { AgentPanelV4Markdown } from './AgentPanelV4Markdown'
import { ActionIcon, IconBooks, IconBulb, IconCheck, IconChevronRight, IconCopy, IconRefresh } from './AgentPanelV4Icons'
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
        chip.cover || chip.preview
          ? <SkillMedia cover={chip.cover} preview={chip.preview} illustration={chip.illustration} iconSize={12} className="size-4 shrink-0 rounded-sm object-cover" />
          : <IconBooks size={13} stroke={1.6} className="shrink-0" aria-hidden="true" />
      ) : chip.kind === 'prompt' ? (
        <IconBulb size={13} stroke={1.6} className="shrink-0" aria-hidden="true" />
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
  const inlineUrls = new Set(mentionUrlsInOrder(text))
  const visibleChips = chips?.filter(chip=>!chip.reference || !inlineUrls.has(chip.reference.url))
  const renderContent = (value:string) => hasMentions(value) ? parsePromptSegments(value).map((segment,index)=> segment.type==='text' ? segment.value
    : <AssetInlineReference key={index} {...chips?.find(chip=>chip.reference?.url===segment.url)?.reference} url={segment.url} />) : value
  return (
    <div
      className={cn(
        'self-end max-w-[86%] rounded-nomi px-3 py-2 text-body-sm',
        // 暗色下用 ink-10 底而不是纯黑（定稿 Dark 板批注）：token 翻转后纯 ink 会变成浅色块。
        darkMode ? 'bg-nomi-ink-10 text-nomi-ink' : 'bg-nomi-ink text-nomi-paper',
      )}
      data-v4-block="user"
    >
      {visibleChips?.length ? (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {visibleChips.map((chip) => (
            <BubbleChip key={chip.id ?? chip.label} chip={chip} onDark={!darkMode} />
          ))}
        </div>
      ) : null}
      {lines.length > 12 ? (
        <details className="group/user-input">
          <summary className="cursor-pointer list-none">
            <span className="block whitespace-pre-wrap group-open/user-input:hidden">{renderContent(lines.slice(0, 12).join('\n'))}</span>
            <span className="text-micro group-open/user-input:hidden">{t('agentPanelV4.expand')}</span>
            <span className="hidden text-micro group-open/user-input:inline">{t('agentPanelV4.collapse')}</span>
          </summary>
          <p className="m-0 whitespace-pre-wrap">{renderContent(text)}</p>
        </details>
      ) : <p className="m-0 whitespace-pre-wrap">{renderContent(text)}</p>}
    </div>
  )
}

export function V4AssistantMessage({
  text,
  status,
  skill,
  labels,
  onCopy,
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
  labels: { copy: string; retry: string; continue: string; stopped: string }
  /**
   * 三个动作都可缺，**缺了就不画那颗钮**。
   *
   * 从前缺了照画（「设计实验室单件取景时没有宿主可调，钮仍在，只是按下去没有去处」）——
   * 而没有 handler 的钮和有 handler 的钮在界面上长得一模一样。2026-09-14 用户报「重试点了
   * 没反应」的机器成因就是这个：`ProjectAgentResidentShell` 的 `flowHandlers` 从头到尾没有
   * `onRetry` 这一项，钮照画、点了什么都不发生，TypeScript 也不会说话（它是可选的）。
   * 「钮在」从此等价于「这件事这里做得了」——宿主漏接一个动作，界面上立刻看得出少了一颗钮。
   */
  onCopy?: (text: string) => void | Promise<void>
  onRetry?: () => void
  /** 「继续」= 给这个还活着的回合追加一句指令（`turn.steer`），不是重发。 */
  onContinue?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  // 「已复制」不是装饰。复制本身 3ms 就完成了，而它**没有任何可见结果**——剪贴板在系统里，
  // 不在屏幕上。用户点完看不到任何变化，唯一能得到的结论就是「这颗钮坏了」
  //（2026-09-14 用户原话：复制点了没反应；真机探针证明剪贴板确实拿到了正文）。
  //
  // ✓ **只在真的写进去之后才打**：写剪贴板会失败（非安全上下文、权限被拒、文档没聚焦），
  // 而一颗「失败了也照样打勾」的钮比不打勾更糟——它把一次失败说成了成功。
  const [copied, setCopied] = React.useState(false)
  React.useEffect(() => {
    if (!copied) return undefined
    const timer = window.setTimeout(() => setCopied(false), 1_600)
    return () => window.clearTimeout(timer)
  }, [copied])
  // 一次在模型吐出第一个字之前就被叫停的回合正文是空的。有半句话时那半句话自己就是回执；
  // 没有话时必须由这一行来当回执，否则「停止」在界面上不留任何痕迹。
  const stoppedWithoutProse = status === 'interrupted' && !text.trim()
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
        {status === 'complete' && (onCopy || onRetry) ? (
          <MessageActions className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            {onCopy ? (
              <button
                type="button"
                aria-label={labels.copy}
                data-v4-copied={copied ? 'true' : undefined}
                onClick={() => { void Promise.resolve(onCopy(text)).then(() => setCopied(true), () => setCopied(false)) }}
                className="grid size-[22px] place-items-center rounded-nomi-sm hover:bg-nomi-ink-05"
              >
                {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              </button>
            ) : null}
            {onRetry ? (
              <button
                type="button"
                aria-label={labels.retry}
                onClick={onRetry}
                className="grid size-[22px] place-items-center rounded-nomi-sm hover:bg-nomi-ink-05"
              >
                <IconRefresh size={14} />
              </button>
            ) : null}
          </MessageActions>
        ) : null}
        {stoppedWithoutProse ? (
          <p className="m-0 text-caption text-nomi-ink-60" data-v4-stopped="true">{labels.stopped}</p>
        ) : null}
        {status === 'interrupted' && !stoppedWithoutProse ? (
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
