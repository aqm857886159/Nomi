import React from 'react'
import { Group, Stack, Text } from '@mantine/core'
import ReactMarkdown from 'react-markdown'
import { $ } from '../../../canvas/i18n'
import { DesignBadge } from '../../../design'
import type { ChatMessage } from '../AiChatDialog.types'
import {
  dedupeProgressLines,
  extractLatestTodoBlock,
  formatTurnVerdictSummary,
  summarizeThinkingText,
} from '../AiChatDialog.utils'

export default function ChatBubble({ message }: { message: ChatMessage }): JSX.Element {
  const isUser = message.role === 'user'
  const { markdownText, todoItems } = React.useMemo(
    () => extractLatestTodoBlock(message.content),
    [message.content],
  )
  const thinkingSummary = React.useMemo(() => summarizeThinkingText(message.content), [message.content])
  const progressLines = React.useMemo(
    () => dedupeProgressLines(Array.isArray(message.progressLines) ? message.progressLines : []),
    [message.progressLines],
  )
  const verdictSummary = React.useMemo(
    () => formatTurnVerdictSummary(message.turnVerdict ?? null),
    [message.turnVerdict],
  )
  const diagnosticFlags = React.useMemo(
    () => Array.isArray(message.diagnosticFlags) ? message.diagnosticFlags : [],
    [message.diagnosticFlags],
  )
  const shouldRenderMarkdown = Boolean(String(markdownText || '').trim())
  const wrapClassName = [
    'tc-ai-chat-bubble',
    isUser ? 'tc-ai-chat-bubble--user' : 'tc-ai-chat-bubble--assistant',
  ].join(' ')

  return (
    <Group className={wrapClassName} justify={isUser ? 'flex-end' : 'flex-start'} align="flex-start" gap={10} wrap="nowrap">
      <div className="tc-ai-chat-bubble__card">
        <Group className="tc-ai-chat-bubble__meta" justify="space-between" align="center" gap={10} mb={6} wrap="nowrap">
          <Group className="tc-ai-chat-bubble__meta-left" gap={6} align="center" wrap="nowrap">
            <DesignBadge className="tc-ai-chat-bubble__role" size="xs" radius="sm" variant="light" color={isUser ? 'gray' : 'blue'}>
              {isUser ? $('你') : $('AI')}
            </DesignBadge>
            {!isUser && message.turnVerdict?.status === 'partial' ? (
              <DesignBadge className="tc-ai-chat-bubble__verdict-badge" size="xs" radius="sm" variant="light" color="yellow">
                {$('部分完成')}
              </DesignBadge>
            ) : null}
            {!isUser && message.turnVerdict?.status === 'failed' ? (
              <DesignBadge className="tc-ai-chat-bubble__verdict-badge" size="xs" radius="sm" variant="light" color="red">
                {$('结构失败')}
              </DesignBadge>
            ) : null}
          </Group>
          <Text className="tc-ai-chat-bubble__time" size="xs" c="dimmed">
            {message.ts}
          </Text>
        </Group>
        {!isUser && verdictSummary ? (
          <div className="tc-ai-chat-bubble__verdict">
            <Text className="tc-ai-chat-bubble__verdict-text" size="xs" c={message.turnVerdict?.status === 'failed' ? 'red' : 'yellow'}>
              {verdictSummary}
            </Text>
          </div>
        ) : null}
        {message.phase === 'thinking' && !isUser ? (
          <div className="tc-ai-chat-thinking" aria-label="ai-chat-thinking">
            <div className="tc-ai-chat-thinking__header">
              <Text className="tc-ai-chat-thinking__title">正在处理</Text>
            </div>
            <div className="tc-ai-chat-thinking__progress" aria-hidden="true">
              <div className="tc-ai-chat-thinking__progress-bar" />
            </div>
            <div className="tc-ai-chat-thinking__lines">
              <p className="tc-ai-chat-thinking__line" style={{ opacity: 1, transform: 'translateY(0)' }}>
                {thinkingSummary}
              </p>
              {progressLines.map((line, index) => (
                <p
                  key={`${message.id}-progress-${index}`}
                  className="tc-ai-chat-thinking__line"
                  style={{ opacity: 0.82, transform: 'translateY(0)' }}
                >
                  {line}
                </p>
              ))}
            </div>
            <p className="tc-ai-chat-thinking__comfort">处理细节已收起，完成后会给你最终结果。</p>
          </div>
        ) : (
          <div className="tc-ai-chat-bubble__content tc-ai-chat-markdown">
            {shouldRenderMarkdown ? (
              <ReactMarkdown
                components={{
                  p: ({ node: _node, ...props }) => <p className="tc-ai-chat-markdown__paragraph" {...props} />,
                  a: ({ node: _node, ...props }) => <a className="tc-ai-chat-markdown__link" target="_blank" rel="noreferrer" {...props} />,
                  ul: ({ node: _node, ...props }) => <ul className="tc-ai-chat-markdown__list tc-ai-chat-markdown__list--unordered" {...props} />,
                  ol: ({ node: _node, ...props }) => <ol className="tc-ai-chat-markdown__list tc-ai-chat-markdown__list--ordered" {...props} />,
                  li: ({ node: _node, ...props }) => <li className="tc-ai-chat-markdown__list-item" {...props} />,
                  blockquote: ({ node: _node, ...props }) => <blockquote className="tc-ai-chat-markdown__blockquote" {...props} />,
                  img: ({ node: _node, ...props }) => <img className="tc-ai-chat-markdown__image" loading="lazy" referrerPolicy="no-referrer" {...props} />,
                  h1: ({ node: _node, ...props }) => <h1 className="tc-ai-chat-markdown__heading tc-ai-chat-markdown__heading--h1" {...props} />,
                  h2: ({ node: _node, ...props }) => <h2 className="tc-ai-chat-markdown__heading tc-ai-chat-markdown__heading--h2" {...props} />,
                  h3: ({ node: _node, ...props }) => <h3 className="tc-ai-chat-markdown__heading tc-ai-chat-markdown__heading--h3" {...props} />,
                  h4: ({ node: _node, ...props }) => <h4 className="tc-ai-chat-markdown__heading tc-ai-chat-markdown__heading--h4" {...props} />,
                  code: ({ node: _node, className, children, ...props }) => {
                    const isInline = !String(className || '').includes('language-')
                    if (isInline) {
                      return <code className="tc-ai-chat-markdown__code tc-ai-chat-markdown__code--inline" {...props}>{children}</code>
                    }
                    return <code className={`tc-ai-chat-markdown__code tc-ai-chat-markdown__code--block ${className || ''}`.trim()} {...props}>{children}</code>
                  },
                  pre: ({ node: _node, ...props }) => <pre className="tc-ai-chat-markdown__pre" {...props} />,
                  hr: ({ node: _node, ...props }) => <hr className="tc-ai-chat-markdown__divider" {...props} />,
                  table: ({ node: _node, ...props }) => <table className="tc-ai-chat-markdown__table" {...props} />,
                  thead: ({ node: _node, ...props }) => <thead className="tc-ai-chat-markdown__table-head" {...props} />,
                  tbody: ({ node: _node, ...props }) => <tbody className="tc-ai-chat-markdown__table-body" {...props} />,
                  tr: ({ node: _node, ...props }) => <tr className="tc-ai-chat-markdown__table-row" {...props} />,
                  th: ({ node: _node, ...props }) => <th className="tc-ai-chat-markdown__table-cell tc-ai-chat-markdown__table-cell--head" {...props} />,
                  td: ({ node: _node, ...props }) => <td className="tc-ai-chat-markdown__table-cell tc-ai-chat-markdown__table-cell--body" {...props} />,
                }}
              >
                {markdownText}
              </ReactMarkdown>
            ) : null}
          </div>
        )}
        {!isUser && todoItems.length > 0 ? (
          <div className="tc-ai-chat-bubble__todo" aria-label="todo-write">
            <Group className="tc-ai-chat-bubble__todo-header" justify="space-between" align="center" gap={8} mb={8} wrap="nowrap">
              <Text className="tc-ai-chat-bubble__todo-title" size="xs" fw={700}>
                Todo
              </Text>
              <DesignBadge className="tc-ai-chat-bubble__todo-badge" size="xs" radius="sm" variant="light" color="orange">
                {todoItems.filter((item) => item.status === 'completed').length}/{todoItems.length}
              </DesignBadge>
            </Group>
            <Stack className="tc-ai-chat-bubble__todo-list" gap={6}>
              {todoItems.map((item, index) => (
                <Group key={`${message.id}_todo_${index}`} className="tc-ai-chat-bubble__todo-item" gap={8} align="flex-start" wrap="nowrap">
                  <span className={`tc-ai-chat-bubble__todo-mark tc-ai-chat-bubble__todo-mark--${item.status}`} aria-hidden="true">
                    {item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '•' : ''}
                  </span>
                  <Text className="tc-ai-chat-bubble__todo-text" size="sm">
                    {item.content}
                  </Text>
                </Group>
              ))}
            </Stack>
          </div>
        ) : null}
        {!isUser && diagnosticFlags.length > 0 ? (
          <div className="tc-ai-chat-bubble__diagnostics" aria-label="chat-diagnostics">
            <Stack className="tc-ai-chat-bubble__diagnostics-list" gap={6} mt={8}>
              {diagnosticFlags.map((flag, index) => (
                <div key={`${message.id}_diagnostic_${flag.code}_${index}`} className="tc-ai-chat-bubble__diagnostic-item">
                  <Group className="tc-ai-chat-bubble__diagnostic-header" gap={8} align="center" wrap="nowrap">
                    <DesignBadge
                      className="tc-ai-chat-bubble__diagnostic-badge"
                      size="xs"
                      radius="sm"
                      variant="light"
                      color={flag.severity === 'high' ? 'red' : 'yellow'}
                    >
                      {flag.severity === 'high' ? $('高风险') : $('提示')}
                    </DesignBadge>
                    <Text className="tc-ai-chat-bubble__diagnostic-title" size="xs" fw={700}>
                      {flag.title}
                    </Text>
                  </Group>
                  <Text className="tc-ai-chat-bubble__diagnostic-detail" size="xs" c="dimmed">
                    {flag.detail}
                  </Text>
                </div>
              ))}
            </Stack>
          </div>
        ) : null}
        {Array.isArray(message.assets) && message.assets.length > 0 ? (
          <Group className="tc-ai-chat-bubble__assets" gap={8} mt={8} align="flex-start" wrap="wrap">
            {message.assets.map((asset, idx) => {
              const url = String(asset?.url || '').trim()
              if (!url) return null
              const preview = String(asset?.thumbnailUrl || url).trim()
              return (
                <a
                  key={`${message.id}_asset_${idx}`}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="tc-ai-chat-bubble__asset-link"
                >
                  <img
                    className="tc-ai-chat-bubble__asset-image"
                    src={preview}
                    alt={asset.title || `asset-${idx + 1}`}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                </a>
              )
            })}
          </Group>
        ) : null}
      </div>
    </Group>
  )
}
