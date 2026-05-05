import React from 'react'
import { IconCursorText, IconFilePlus, IconReplace, IconSend2 } from '@tabler/icons-react'
import { NomiAILabel, NomiLoadingMark, WorkbenchButton, WorkbenchIconButton } from '../../design'
import ReactMarkdown from 'react-markdown'
import { sendWorkbenchAiMessage } from '../ai/workbenchAiClient'
import { AiReplyActionButton } from '../ai/AiReplyActionButton'
import { handleAiComposerKeyDown } from '../ai/aiComposerKeyboard'
import type { WorkbenchAiMessage } from '../ai/workbenchAiTypes'
import { openWorkbenchModelIntegration, WorkbenchAiHeaderActions } from '../ai/WorkbenchAiHeaderActions'
import { useWorkbenchStore } from '../workbenchStore'
import {
  buildCreationAiPrompt,
  CREATION_AI_MODES,
  extractWorkbenchDocumentText,
  getCreationDocumentActionLabel,
  getCreationAiMode,
  parseCreationDocumentAction,
  type CreationAiModeId,
} from './creationAiModes'
import type { CreationDocumentAction, CreationDocumentActionType } from '../workbenchTypes'
import { useTransientScrollingClass } from './useTransientScrollingClass'

function readUrlParam(name: string): string {
  if (typeof window === 'undefined') return ''
  try {
    return String(new URL(window.location.href).searchParams.get(name) || '').trim()
  } catch {
    return ''
  }
}

function readWorkbenchAiReplyText(response: unknown): string {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return ''
  const record = response as Record<string, unknown>
  const text = typeof record.text === 'string' ? record.text.trim() : ''
  if (text) return text
  const responseValue = record.response
  if (responseValue && typeof responseValue === 'object' && !Array.isArray(responseValue)) {
    const nestedText = (responseValue as Record<string, unknown>).text
    return typeof nestedText === 'string' ? nestedText.trim() : ''
  }
  return ''
}

export default function CreationAiPanel(): JSX.Element {
  const [sending, setSending] = React.useState(false)
  const messagesScrollRef = useTransientScrollingClass<HTMLDivElement>('workbench-scrollbar-visible')
  const workbenchDocument = useWorkbenchStore((state) => state.workbenchDocument)
  const documentTools = useWorkbenchStore((state) => state.creationDocumentTools)
  const selectedText = useWorkbenchStore((state) => state.creationSelectionText)
  const modeId = useWorkbenchStore((state) => state.creationAiModeId)
  const draft = useWorkbenchStore((state) => state.creationAiDraft)
  const messages = useWorkbenchStore((state) => state.creationAiMessages)
  const error = useWorkbenchStore((state) => state.creationAiError)
  const setModeId = useWorkbenchStore((state) => state.setCreationAiModeId)
  const setDraft = useWorkbenchStore((state) => state.setCreationAiDraft)
  const setMessages = useWorkbenchStore((state) => state.setCreationAiMessages)
  const setError = useWorkbenchStore((state) => state.setCreationAiError)
  const resetConversation = useWorkbenchStore((state) => state.resetCreationAiConversation)

  const activeMode = getCreationAiMode(modeId as CreationAiModeId)
  const documentText = React.useMemo(() => extractWorkbenchDocumentText(workbenchDocument), [workbenchDocument])

  const applyDocumentAction = React.useCallback((action: CreationDocumentAction) => {
    const content = String(action.content || '').trim()
    if (!content || !documentTools) return
    if (action.type === 'insert_at_cursor') documentTools.insertAtCursor(content)
    if (action.type === 'replace_selection') documentTools.replaceSelection(content)
    if (action.type === 'append_to_end') documentTools.appendToEnd(content)
  }, [documentTools])

  const renderMarkdown = React.useCallback((content: string) => (
    <ReactMarkdown
      components={{
        p: ({ node: _node, ...props }) => <p className="workbench-creation-ai-markdown__paragraph" {...props} />,
        ul: ({ node: _node, ...props }) => <ul className="workbench-creation-ai-markdown__list" {...props} />,
        ol: ({ node: _node, ...props }) => <ol className="workbench-creation-ai-markdown__list" {...props} />,
        li: ({ node: _node, ...props }) => <li className="workbench-creation-ai-markdown__list-item" {...props} />,
        blockquote: ({ node: _node, ...props }) => <blockquote className="workbench-creation-ai-markdown__blockquote" {...props} />,
        h1: ({ node: _node, ...props }) => <h1 className="workbench-creation-ai-markdown__heading workbench-creation-ai-markdown__heading--h1" {...props} />,
        h2: ({ node: _node, ...props }) => <h2 className="workbench-creation-ai-markdown__heading workbench-creation-ai-markdown__heading--h2" {...props} />,
        h3: ({ node: _node, ...props }) => <h3 className="workbench-creation-ai-markdown__heading workbench-creation-ai-markdown__heading--h3" {...props} />,
        code: ({ node: _node, className, children, ...props }) => {
          const isInline = !String(className || '').includes('language-')
          return isInline
            ? <code className="workbench-creation-ai-markdown__code workbench-creation-ai-markdown__code--inline" {...props}>{children}</code>
            : <code className={`workbench-creation-ai-markdown__code workbench-creation-ai-markdown__code--block ${className || ''}`.trim()} {...props}>{children}</code>
        },
        pre: ({ node: _node, ...props }) => <pre className="workbench-creation-ai-markdown__pre" {...props} />,
        hr: ({ node: _node, ...props }) => <hr className="workbench-creation-ai-markdown__divider" {...props} />,
      }}
    >
      {content}
    </ReactMarkdown>
  ), [])

  const actionIcon = React.useCallback((type: CreationDocumentActionType) => {
    if (type === 'insert_at_cursor') return <IconCursorText size={13} />
    if (type === 'replace_selection') return <IconReplace size={13} />
    return <IconFilePlus size={13} />
  }, [])

  const send = React.useCallback(async () => {
    if (sending) return
    const userRequest = draft.trim()
    if (!userRequest && !selectedText && !documentText) return
    const prompt = buildCreationAiPrompt({
      mode: activeMode,
      userRequest,
      documentText,
      selectedText,
    })
    const displayPrompt = userRequest || `${activeMode.label}：处理当前文稿`
    const userMessage: WorkbenchAiMessage = {
      id: `creation_ai_user_${Date.now()}`,
      role: 'user',
      content: displayPrompt,
    }
    const pendingId = `creation_ai_assistant_${Date.now() + 1}`
    setMessages((prev) => [...prev, userMessage, { id: pendingId, role: 'assistant', content: '处理中...' }])
    setDraft('')
    setError('')
    setSending(true)
    try {
      const projectId = readUrlParam('projectId')
      const response = await sendWorkbenchAiMessage({
        prompt,
        displayPrompt,
        sessionKey: `nomi:creation:${projectId || 'local'}:${activeMode.id}`,
        projectId,
        flowId: '',
        projectName: '',
        skillKey: `workbench.creation.${activeMode.id}`,
        skillName: activeMode.title,
        mode: 'auto',
      })
      const reply = readWorkbenchAiReplyText(response) || '（空响应：AI 没有返回文本）'
      const parsedAction = parseCreationDocumentAction(reply) ?? undefined
      const documentAction = parsedAction
      const assistantContent = documentAction?.content || reply
      setMessages((prev) => prev.map((message) => (
        message.id === pendingId ? { ...message, content: assistantContent, documentAction } : message
      )))
    } catch (err) {
      const message = err instanceof Error ? err.message : '创作 AI 调用失败'
      setError(message)
      setMessages((prev) => prev.map((item) => (
        item.id === pendingId ? { ...item, content: `（错误）${message}` } : item
      )))
    } finally {
      setSending(false)
    }
  }, [activeMode, applyDocumentAction, documentText, draft, selectedText, sending])

  const suggestions = React.useMemo(() => [
    '一段悬疑开场',
    '续写下一段',
    '改成更童话的语气',
  ], [])

  const handleNewConversation = React.useCallback(() => {
    resetConversation()
  }, [resetConversation])

  return (
    <aside className="workbench-creation-ai" aria-label="AI 创作区">
      <header className="workbench-creation-ai__header">
        <div className="workbench-creation-ai__title">
          <NomiAILabel suffix="创作" />
        </div>
        <WorkbenchAiHeaderActions
          className="workbench-creation-ai__header-actions"
          actionClassName="workbench-creation-ai__header-action"
          onModelIntegration={openWorkbenchModelIntegration}
          onNewConversation={handleNewConversation}
        />
      </header>

      <div ref={messagesScrollRef} className="workbench-creation-ai__messages" aria-live="polite">
        {messages.length === 0 ? (
          <div className="workbench-creation-ai__empty">
            <div className="workbench-creation-ai__empty-title">需要一点灵感？</div>
            <div className="workbench-creation-ai__empty-sub">告诉 AI 你想写什么，它会给你一个开头。</div>
            <div className="workbench-creation-ai__suggestions">
              {suggestions.map((suggestion) => (
                <WorkbenchButton
                  key={suggestion}
                  className="workbench-creation-ai__suggestion"
                  onClick={() => setDraft(suggestion)}
                >
                  {suggestion}
                </WorkbenchButton>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <article
              key={message.id}
              className={`workbench-creation-ai__message workbench-creation-ai__message--${message.role}`}
            >
              <div className="workbench-creation-ai__message-content workbench-creation-ai-markdown">
                {message.role === 'assistant' && message.content === '处理中...' ? (
                  <NomiLoadingMark size={15} label="处理中" />
                ) : (
                  renderMarkdown(message.content)
                )}
                {message.role === 'assistant' && message.content !== '处理中...' && !message.content.startsWith('（错误）') ? (
                  <AiReplyActionButton
                    className="workbench-creation-ai__reply-action"
                    content={message.documentAction?.content || message.content}
                  />
                ) : null}
              </div>
              {message.role === 'assistant' && message.content !== '处理中...' && !message.content.startsWith('（错误）') ? (
                <div className="workbench-creation-ai__message-actions">
                  {message.documentAction ? (
                    <div className="workbench-creation-ai__tool-preview">
                      <span className="workbench-creation-ai__tool-name">
                        {actionIcon(message.documentAction.type)}
                        {getCreationDocumentActionLabel(message.documentAction.type)}
                      </span>
                      <WorkbenchButton
                        className="workbench-creation-ai__message-action"
                        disabled={!documentTools}
                        data-primary="true"
                        onClick={() => applyDocumentAction(message.documentAction!)}
                      >
                        <span>应用</span>
                      </WorkbenchButton>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>

      {error ? <div className="workbench-creation-ai__error">{error}</div> : null}

      <footer className="workbench-creation-ai__composer">
        <textarea
          className="workbench-creation-ai__input"
          value={draft}
          placeholder="问点什么..."
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => handleAiComposerKeyDown(event, () => void send())}
        />
        <div className="workbench-creation-ai__actions">
          <label className="workbench-creation-ai__mode-picker" title={activeMode.description}>
            <span className="workbench-creation-ai__mode-label">模式</span>
            <select
              className="workbench-creation-ai__mode-select"
              aria-label="创作模式"
              value={activeMode.id}
              onChange={(event) => setModeId(event.currentTarget.value as CreationAiModeId)}
            >
              {CREATION_AI_MODES.map((mode) => (
                <option key={mode.id} value={mode.id}>
                  {mode.shortLabel}
                </option>
              ))}
            </select>
          </label>
          <WorkbenchIconButton
            className="workbench-creation-ai__send"
            label="发送"
            aria-label="创作 AI 发送"
            disabled={sending || !draft.trim()}
            onClick={() => void send()}
            icon={<IconSend2 size={15} />}
          />
        </div>
      </footer>
    </aside>
  )
}
