import React from 'react'
import { IconCursorText, IconFilePlus, IconMovie, IconReplace, IconSend2 } from '@tabler/icons-react'
import { NomiAILabel, NomiLoadingMark, WorkbenchButton, WorkbenchIconButton } from '../../design'
import ReactMarkdown from 'react-markdown'
import { cn } from '../../utils/cn'
import { sendWorkbenchAiMessage } from '../ai/workbenchAiClient'
import { AiReplyActionButton } from '../ai/AiReplyActionButton'
import { handleAiComposerKeyDown } from '../ai/aiComposerKeyboard'
import type { WorkbenchAiMessage } from '../ai/workbenchAiTypes'
import { openWorkbenchModelIntegration, WorkbenchAiHeaderActions } from '../ai/WorkbenchAiHeaderActions'
import { useWorkbenchStore } from '../workbenchStore'
import { requestStoryboardPlanning } from '../generationCanvasV2/agent/storyboardLauncher'
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

const STORYBOARD_REQUEST_PATTERN = /拆镜头|分镜|拆分/

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
  const setWorkspaceMode = useWorkbenchStore((state) => state.setWorkspaceMode)
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

  const launchStoryboardPlanning = React.useCallback((displayPrompt = '🎬 拆镜头') => {
    const storyText = (selectedText || documentText).trim()
    if (!storyText) {
      setError('先在左侧写一段故事，再让 AI 拆镜头。')
      return
    }
    const now = Date.now()
    setMessages((prev) => [
      ...prev,
      { id: `creation_ai_user_${now}`, role: 'user', content: displayPrompt },
      { id: `creation_ai_assistant_${now + 1}`, role: 'assistant', content: '已切到生成区，正在让 AI 拆镜头。' },
    ])
    setDraft('')
    setError('')
    setWorkspaceMode('generation')
    // Allow the generation workspace + assistant panel to mount before
    // dispatching the CustomEvent it listens for.
    window.setTimeout(() => {
      requestStoryboardPlanning({ storyText, source: 'creation-ai-panel' })
    }, 60)
  }, [documentText, selectedText, setDraft, setError, setMessages, setWorkspaceMode])

  const send = React.useCallback(async () => {
    if (sending) return
    const userRequest = draft.trim()
    if (!userRequest && !selectedText && !documentText) return
    if (STORYBOARD_REQUEST_PATTERN.test(userRequest)) {
      launchStoryboardPlanning(userRequest || '🎬 拆镜头')
      return
    }
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
      const response = await sendWorkbenchAiMessage(
        {
          prompt,
          displayPrompt,
          sessionKey: `nomi:creation:${projectId || 'local'}:${activeMode.id}`,
          projectId,
          flowId: '',
          projectName: '',
          skillKey: `workbench.creation.${activeMode.id}`,
          skillName: activeMode.title,
          mode: 'auto',
        },
        {
          onContent: (_delta, streamedText) => {
            setMessages((prev) => prev.map((message) => (
              message.id === pendingId ? { ...message, content: streamedText || '处理中...' } : message
            )))
          },
        },
      )
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
  }, [activeMode, applyDocumentAction, documentText, draft, launchStoryboardPlanning, selectedText, sending])

  const suggestions = React.useMemo(() => [
    '一段悬疑开场',
    '续写下一段',
    '改成更童话的语气',
  ], [])

  const handleNewConversation = React.useCallback(() => {
    resetConversation()
  }, [resetConversation])

  return (
    <aside
      className={cn(
        'workbench-creation-ai',
        'grid grid-rows-[44px_minmax(0,1fr)_auto_auto]',
        '[grid-template-areas:"header"_"messages"_"error"_"composer"]',
        'min-w-0 min-h-0 overflow-hidden',
      )}
      aria-label="AI 创作区"
    >
      <header
        className={cn(
          'workbench-creation-ai__header',
          '[grid-area:header] flex items-center justify-between gap-[10px] min-w-0',
        )}
      >
        <div className={cn('workbench-creation-ai__title', 'inline-flex items-center gap-2')}>
          <NomiAILabel suffix="创作" />
        </div>
        <WorkbenchAiHeaderActions
          className={cn(
            'workbench-creation-ai__header-actions',
            'inline-flex items-center flex-nowrap gap-[6px] ml-auto whitespace-nowrap',
          )}
          actionClassName={cn(
            'workbench-creation-ai__header-action',
            'inline-flex items-center justify-center shrink-0 cursor-pointer whitespace-nowrap',
            'focus-visible:outline-2 focus-visible:outline-workbench-focus focus-visible:outline-offset-2',
          )}
          onModelIntegration={openWorkbenchModelIntegration}
          onNewConversation={handleNewConversation}
        />
      </header>

      <div
        ref={messagesScrollRef}
        className={cn(
          'workbench-creation-ai__messages',
          '[grid-area:messages] min-h-0 overflow-auto',
        )}
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className={cn('workbench-creation-ai__empty', 'h-full grid place-content-center justify-items-center')}>
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
              className={cn(
                'workbench-creation-ai__message',
                `workbench-creation-ai__message--${message.role}`,
                'p-[10px_11px] whitespace-pre-wrap',
              )}
            >
              <div className={cn('workbench-creation-ai__message-content workbench-creation-ai-markdown', 'whitespace-normal')}>
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
                <div className={cn('workbench-creation-ai__message-actions', 'flex justify-stretch mt-[10px] pt-2')}>
                  {message.documentAction ? (
                    <div className={cn('workbench-creation-ai__tool-preview', 'w-full flex items-center justify-between gap-2')}>
                      <span className={cn('workbench-creation-ai__tool-name', 'min-w-0 inline-flex items-center gap-[6px]')}>
                        {actionIcon(message.documentAction.type)}
                        {getCreationDocumentActionLabel(message.documentAction.type)}
                      </span>
                      <WorkbenchButton
                        className={cn('workbench-creation-ai__message-action', 'inline-flex items-center gap-[5px] px-2 font-inherit cursor-pointer disabled:cursor-not-allowed disabled:opacity-45')}
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

      {error ? (
        <div
          className={cn(
            'workbench-creation-ai__error',
            '[grid-area:error] py-2 px-3',
            'border-t border-[color-mix(in_srgb,var(--workbench-danger)_16%,transparent)]',
            'bg-workbench-danger-soft text-workbench-danger',
            'text-xs leading-[1.45]',
          )}
        >
          {error}
        </div>
      ) : null}

      <footer className={cn('workbench-creation-ai__composer', '[grid-area:composer]')}>
        <textarea
          className={cn(
            'workbench-creation-ai__input',
            'w-full min-h-[78px] resize-none',
            'border-0 rounded-none bg-transparent',
            'font-inherit outline-none',
            'focus:shadow-none',
          )}
          value={draft}
          placeholder="问点什么..."
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => handleAiComposerKeyDown(event, () => void send())}
        />
        <div className={cn('workbench-creation-ai__actions', 'flex items-center justify-between gap-2')}>
          <label
            className={cn(
              'workbench-creation-ai__mode-picker',
              'min-w-0 h-[30px] inline-flex items-center gap-[6px] px-2 cursor-pointer',
            )}
            title={activeMode.description}
          >
            <span className={cn('workbench-creation-ai__mode-label', 'shrink-0 whitespace-nowrap')}>模式</span>
            <select
              className={cn(
                'workbench-creation-ai__mode-select',
                'min-w-[70px] border-0 bg-transparent font-inherit outline-none cursor-pointer',
              )}
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
          <WorkbenchButton
            className={cn(
              'workbench-creation-ai__storyboard-chip',
              'shrink-0 h-[30px] inline-flex items-center gap-[5px] px-2.5',
              'border border-nomi-line rounded-full bg-nomi-paper',
              'text-nomi-ink-80 text-[12.5px] font-medium cursor-pointer',
              'hover:bg-nomi-accent-soft/40 hover:text-nomi-accent hover:border-[color-mix(in_srgb,var(--nomi-accent)_36%,transparent)]',
              'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-nomi-paper disabled:hover:text-nomi-ink-80',
            )}
            type="button"
            title="把当前正文交给 AI 拆成镜头节点"
            disabled={sending || !(selectedText || documentText).trim()}
            onClick={() => launchStoryboardPlanning('🎬 拆镜头')}
          >
            <IconMovie size={14} />
            <span>拆镜头</span>
          </WorkbenchButton>
          <WorkbenchIconButton
            className={cn(
              'workbench-creation-ai__send',
              'shrink-0 w-[30px] inline-flex items-center justify-center cursor-pointer',
              'disabled:cursor-not-allowed disabled:opacity-[0.48]',
              'focus-visible:outline-2 focus-visible:outline-workbench-focus focus-visible:outline-offset-2',
            )}
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
