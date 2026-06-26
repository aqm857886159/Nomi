// 助手消息 / 用户消息的「单一渲染真相源」（P1）：创作助手与画布助手共用这两个组件，
// 保证两边「发言」长得完全一致——左对齐·一行 Nomi 身份·真 markdown·token 字号·极简状态标。
// 纯展示组件：各面板把自己的状态模型（创作 message.status / 画布「处理中...」哨兵）映射成下面的 props。
import React from 'react'
import { IconPlayerStopFilled } from '@tabler/icons-react'
import { NomiLoadingMark, NomiLogoMark, NomiWordmark } from '../../design'
import { cn } from '../../utils/cn'
import { NomiMarkdown } from '../common/NomiMarkdown'
import { AiReplyActionButton } from './AiReplyActionButton'
import { AttachmentRail } from './composer/AttachmentRail'
import type { ComposerAttachment } from './composer/composerAttachmentTypes'

/** 一行轻身份：真 brand logo mark + 「Nomi」名。两个助手共用，是「同一个 Nomi」的锚。
 *  export 供恢复卡等同样「以 Nomi 身份发言」的组件复用（统一 logo+文字规则，单一真相源 P1）。 */
export function NomiIdentityRow(): JSX.Element {
  return (
    <div className={cn('flex items-center gap-1.5 mb-1')} data-assistant-identity="true">
      <NomiLogoMark size={16} />
      <NomiWordmark fontSize={12} className="text-nomi-ink-60" />
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
}

/** 助手发言（左对齐·无气泡填充·身份行 + markdown 正文 + 极简状态标）。
 *  memo（P0 流式卡顿）：done 消息的 props 全部引用稳定（primitives + message.* 稳定身份），
 *  流式吐字时整列表重渲只有「正在吐字那条」真变 → 历史气泡被 memo 跳过，不再陪绑重渲+重 parse。 */
export const AssistantMessageView = React.memo(function AssistantMessageView({
  content,
  attachments,
  streaming = false,
  pendingLabel,
  cancelled = false,
}: AssistantMessageViewProps): JSX.Element {
  const hasContent = content.trim().length > 0
  return (
    <div className={cn('self-start w-full max-w-full')} data-role="assistant">
      <NomiIdentityRow />
      {attachments?.length ? <AttachmentRail attachments={attachments} readOnly className={cn('mb-1.5')} /> : null}
      {streaming && !hasContent ? (
        <div className={cn('flex items-center gap-2')}>
          <NomiLoadingMark size={14} label="处理中" />
          {pendingLabel ? <span className={cn('text-body-sm text-nomi-ink-60 leading-snug')}>{pendingLabel}</span> : null}
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
      {!streaming && !cancelled && hasContent ? (
        <AiReplyActionButton content={content} />
      ) : null}
    </div>
  )
})

export type UserMessageBubbleProps = {
  content: string
  attachments?: ComposerAttachment[]
}

/** 用户消息（右对齐 ink-05 气泡，两面板一致）。memo：内容固定，流式重渲时整列表跳过。 */
export const UserMessageBubble = React.memo(function UserMessageBubble({
  content,
  attachments,
}: UserMessageBubbleProps): JSX.Element {
  return (
    <div
      className={cn(
        'self-end max-w-[88%] py-2 px-3 rounded-nomi rounded-br-[4px]',
        'bg-nomi-ink-05 text-nomi-ink text-body-sm leading-[1.55] whitespace-pre-wrap',
      )}
      data-role="user"
    >
      {attachments?.length ? <AttachmentRail attachments={attachments} readOnly className={cn('mb-1.5')} /> : null}
      {content}
    </div>
  )
})
