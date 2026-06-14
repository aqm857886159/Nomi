// 助手消息 / 用户消息的「单一渲染真相源」（P1）：创作助手与画布助手共用这两个组件，
// 保证两边「发言」长得完全一致——左对齐·一行 Nomi 身份·真 markdown·token 字号·极简状态标。
// 纯展示组件：各面板把自己的状态模型（创作 message.status / 画布「处理中...」哨兵）映射成下面的 props。
import React from 'react'
import { IconPlayerStopFilled } from '@tabler/icons-react'
import { NomiLoadingMark, NomiLogoMark } from '../../design'
import { cn } from '../../utils/cn'
import { NomiMarkdown } from '../common/NomiMarkdown'
import { AiReplyActionButton } from './AiReplyActionButton'
import { AttachmentRail } from './composer/AttachmentRail'
import { narrateTurnStats } from '../observability/narrate'
import type { WorkbenchAiMessage } from './workbenchAiTypes'
import type { ComposerAttachment } from './composer/composerAttachmentTypes'

/** 一行轻身份：真 brand logo mark + 「Nomi」名。两个助手共用，是「同一个 Nomi」的锚。 */
function NomiIdentityRow(): JSX.Element {
  return (
    <div className={cn('flex items-center gap-1.5 mb-1')} data-assistant-identity="true">
      <NomiLogoMark size={16} />
      <span className={cn('text-micro font-semibold text-nomi-ink-60 leading-none')}>Nomi</span>
    </div>
  )
}

/** 流式吐字的三点动画（统一两面板）。 */
function StreamingDots(): JSX.Element {
  return (
    <span className={cn('inline-flex gap-1 mt-1.5')} aria-hidden data-streaming-dots="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn('block w-1 h-1 rounded-full bg-nomi-ink-40 animate-pulse')}
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  )
}

export type AssistantMessageViewProps = {
  content: string
  attachments?: ComposerAttachment[]
  /** 流式中（等首 token 或吐字）。无 content 时显示 loading mark + pendingLabel；有 content 时显示 markdown + 三点。 */
  streaming?: boolean
  /** 等首 token 时的状态文字（创作侧 pending 的 content）。 */
  pendingLabel?: string
  /** 用户主动「停止」第三态（中性「已停止」，非错误样式）。 */
  cancelled?: boolean
  /** 内容是错误文本（「（错误）」开头）→ 不显示 reply action。 */
  isError?: boolean
  turnStats?: WorkbenchAiMessage['turnStats']
  /** reply action 的 hover 容器类（两面板各有自己的）。 */
  replyActionClassName: string
}

/** 助手发言（左对齐·无气泡填充·身份行 + markdown 正文 + 极简状态标）。 */
export function AssistantMessageView({
  content,
  attachments,
  streaming = false,
  pendingLabel,
  cancelled = false,
  isError = false,
  turnStats,
  replyActionClassName,
}: AssistantMessageViewProps): JSX.Element {
  const hasContent = content.trim().length > 0
  return (
    <div className={cn('self-start w-full max-w-full')} data-role="assistant">
      <NomiIdentityRow />
      {attachments?.length ? <AttachmentRail attachments={attachments} readOnly className={cn('mb-1.5')} /> : null}
      {streaming && !hasContent ? (
        <div className={cn('flex items-center gap-2')}>
          <NomiLoadingMark size={14} label="处理中" />
          {pendingLabel ? <span className={cn('text-bodySm text-nomi-ink-60 leading-snug')}>{pendingLabel}</span> : null}
        </div>
      ) : (
        <NomiMarkdown compact>{content}</NomiMarkdown>
      )}
      {streaming && hasContent ? <StreamingDots /> : null}
      {cancelled ? (
        <span className={cn('mt-1.5 inline-flex items-center gap-1 text-micro text-nomi-ink-40')}>
          <IconPlayerStopFilled size={11} />
          已停止
        </span>
      ) : null}
      {!streaming && !cancelled && !isError && hasContent ? (
        <AiReplyActionButton className={replyActionClassName} content={content} />
      ) : null}
      {turnStats?.totalTokens ? (
        <span className={cn('block mt-1 text-micro text-nomi-ink-40')}>{narrateTurnStats(turnStats.totalTokens, turnStats)}</span>
      ) : null}
    </div>
  )
}

export type UserMessageBubbleProps = {
  content: string
  attachments?: ComposerAttachment[]
}

/** 用户消息（右对齐 ink-05 气泡，两面板一致）。 */
export function UserMessageBubble({ content, attachments }: UserMessageBubbleProps): JSX.Element {
  return (
    <div
      className={cn(
        'self-end max-w-[88%] py-2 px-3 rounded-nomi rounded-br-[4px]',
        'bg-nomi-ink-05 text-nomi-ink text-bodySm leading-[1.55] whitespace-pre-wrap',
      )}
      data-role="user"
    >
      {attachments?.length ? <AttachmentRail attachments={attachments} readOnly className={cn('mb-1.5')} /> : null}
      {content}
    </div>
  )
}
