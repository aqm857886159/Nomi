import React from 'react'
import { IconCursorText, IconFilePlus, IconMovie, IconPencil, IconPlayerStopFilled, IconReplace, IconSend2, IconSparkles } from '@tabler/icons-react'
import { NomiLoadingMark, NomiLogoMark, NomiSelect, WorkbenchButton, WorkbenchIconButton } from '../../design'
import { NomiMarkdown } from '../common/NomiMarkdown'
import { cn } from '../../utils/cn'
import { runWorkbenchAgent, workbenchSessionKey, type ToolCallEvent } from '../ai/workbenchAgentRunner'
import { clearWorkbenchAgentSession } from '../../api/desktopClient'
import { AiReplyActionButton } from '../ai/AiReplyActionButton'
import { handleAiComposerKeyDown } from '../ai/aiComposerKeyboard'
import type { WorkbenchAiMessage } from '../ai/workbenchAiTypes'
import { WorkbenchAiHeaderActions } from '../ai/WorkbenchAiHeaderActions'
import { AssistantToolsFold } from '../ai/AssistantToolsFold'
import { useWorkbenchStore } from '../workbenchStore'
import { requestStoryboardPlanning } from '../generationCanvasV2/agent/storyboardLauncher'
import { requestFixationPlanning } from '../generationCanvasV2/agent/fixationLauncher'
import {
  buildCreationAiPrompt,
  CREATION_AI_MODES,
  extractWorkbenchDocumentText,
  getCreationAiMode,
  type CreationAiModeId,
} from './creationAiModes'
import { useTransientScrollingClass } from './useTransientScrollingClass'

const STORYBOARD_REQUEST_PATTERN = /拆镜头|分镜|拆分/

// The creation agent's write tools map 1:1 to the editor's document mutations.
// Read tools auto-confirm without a card; write tools queue a confirmation card.
const WRITE_TOOL_NAMES = ['insert_at_cursor', 'replace_selection', 'append_to_end'] as const
type WriteToolName = (typeof WRITE_TOOL_NAMES)[number]

type PendingDocToolCall = {
  toolCallId: string
  toolName: WriteToolName
  content: string
  confirm: (decision: { ok: true; result?: unknown } | { ok: false; message?: string }) => Promise<void>
}

function isWriteTool(name: string): name is WriteToolName {
  return (WRITE_TOOL_NAMES as readonly string[]).includes(name)
}

function writeToolLabel(name: WriteToolName): string {
  if (name === 'insert_at_cursor') return '插入到光标'
  if (name === 'replace_selection') return '替换选区'
  return '追加到文末'
}

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
  // Cancel handle for the in-flight agent turn (user "Stop").
  const cancelRef = React.useRef<(() => void) | null>(null)
  const [pendingToolCalls, setPendingToolCalls] = React.useState<PendingDocToolCall[]>([])
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

  // Keep a live ref so the tool-call handler always sees the freshest editor
  // tools without re-creating `send` on every editor remount.
  const documentToolsRef = React.useRef(documentTools)
  documentToolsRef.current = documentTools

  const activeMode = getCreationAiMode(modeId as CreationAiModeId)
  const documentText = React.useMemo(() => extractWorkbenchDocumentText(workbenchDocument), [workbenchDocument])

  const resolvePending = React.useCallback((
    toolCallId: string,
    decision: { ok: true; result?: unknown } | { ok: false; message?: string },
  ) => {
    setPendingToolCalls((current) => {
      const target = current.find((item) => item.toolCallId === toolCallId)
      if (target) void target.confirm(decision)
      return current.filter((item) => item.toolCallId !== toolCallId)
    })
  }, [])

  // Run the actual editor mutation for an approved write tool, then resolve the
  // backend tool call so the agent loop can continue.
  const applyWriteTool = React.useCallback((call: PendingDocToolCall) => {
    const tools = documentToolsRef.current
    if (!tools) {
      void resolvePending(call.toolCallId, { ok: false, message: 'editor_not_ready' })
      return
    }
    if (call.toolName === 'insert_at_cursor') tools.insertAtCursor(call.content)
    else if (call.toolName === 'replace_selection') tools.replaceSelection(call.content)
    else tools.appendToEnd(call.content)
    void resolvePending(call.toolCallId, { ok: true, result: { applied: true } })
  }, [resolvePending])


  const writeToolIcon = React.useCallback((name: WriteToolName) => {
    if (name === 'insert_at_cursor') return <IconCursorText size={13} />
    if (name === 'replace_selection') return <IconReplace size={13} />
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

  // Tier2 定妆：把剧本交给 AI，按剧本为主要角色/场景建卡 + 注入身份板提示词（与拆镜头同构）。
  const launchFixationPlanning = React.useCallback((displayPrompt = '🎭 立角色卡') => {
    const storyText = (selectedText || documentText).trim()
    if (!storyText) {
      setError('先在左侧写一段剧本，再让 AI 按剧本定妆。')
      return
    }
    const now = Date.now()
    setMessages((prev) => [
      ...prev,
      { id: `creation_ai_user_${now}`, role: 'user', content: displayPrompt },
      { id: `creation_ai_assistant_${now + 1}`, role: 'assistant', content: '已切到生成区，正在让 AI 按剧本为角色/场景定妆。' },
    ])
    setDraft('')
    setError('')
    setWorkspaceMode('generation')
    window.setTimeout(() => {
      requestFixationPlanning({ storyText, source: 'creation-ai-panel' })
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
    const prompt = buildCreationAiPrompt({ mode: activeMode, userRequest })
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
      const response = await runWorkbenchAgent({
        prompt,
        displayPrompt,
        sessionKey: workbenchSessionKey(),
        projectId: readUrlParam('projectId'),
        skillKey: `workbench.creation.${activeMode.id}`,
        skillName: activeMode.title,
        onContent: (_delta, streamedText) => {
          setMessages((prev) => prev.map((message) => (
            message.id === pendingId ? { ...message, content: streamedText || '处理中...' } : message
          )))
        },
        onCancelReady: (cancel) => {
          cancelRef.current = cancel
        },
        onToolCall: (event: ToolCallEvent) => {
          // Read tools auto-execute against the live editor.
          if (event.toolName === 'read_full_text') {
            void event.confirm({ ok: true, result: { text: documentToolsRef.current?.readFullText() ?? '' } })
            return
          }
          if (event.toolName === 'read_selection') {
            void event.confirm({ ok: true, result: { text: documentToolsRef.current?.readSelectionText() ?? '' } })
            return
          }
          // Write tools wait for explicit user approval through a card.
          if (isWriteTool(event.toolName)) {
            const args = (event.args && typeof event.args === 'object') ? event.args as Record<string, unknown> : {}
            const content = typeof args.content === 'string' ? args.content : ''
            setPendingToolCalls((current) => [...current, {
              toolCallId: event.toolCallId,
              toolName: event.toolName as WriteToolName,
              content,
              confirm: event.confirm,
            }])
            return
          }
          void event.confirm({ ok: false, message: `unknown tool ${event.toolName}` })
        },
      })
      const reply = readWorkbenchAiReplyText(response) || '（空响应：AI 没有返回文本）'
      setMessages((prev) => prev.map((message) => (
        message.id === pendingId ? { ...message, content: reply } : message
      )))
    } catch (err) {
      const message = err instanceof Error ? err.message : '创作 AI 调用失败'
      setError(message)
      setMessages((prev) => prev.map((item) => (
        item.id === pendingId ? { ...item, content: `（错误）${message}` } : item
      )))
    } finally {
      setSending(false)
      cancelRef.current = null
    }
  }, [activeMode, documentText, draft, launchStoryboardPlanning, selectedText, sending, setDraft, setError, setMessages])

  const suggestions = React.useMemo(() => [
    '一段悬疑开场',
    '续写下一段',
    '改成更童话的语气',
  ], [])

  const handleNewConversation = React.useCallback(() => {
    setPendingToolCalls([])
    resetConversation()
    // Wipe the shared backend memory so both areas start a fresh thread.
    void clearWorkbenchAgentSession(workbenchSessionKey())
  }, [resetConversation])

  return (
    <aside
      className={cn(
        'workbench-creation-ai',
        'grid grid-rows-[44px_auto_minmax(0,1fr)_auto_auto]',
        '[grid-template-areas:"header"_"tools"_"messages"_"error"_"composer"]',
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
        {/* 样张头部：Nomi 标 + 「助手」+ 上下文胶囊（✎ 创作）。 */}
        <div className={cn('workbench-creation-ai__title', 'inline-flex items-center gap-2 min-w-0')}>
          <NomiLogoMark size={18} />
          <span className={cn('text-bodySm font-semibold text-nomi-ink')}>助手</span>
        </div>
        <div className={cn('inline-flex items-center gap-2 ml-auto shrink-0')}>
          <span className={cn('inline-flex items-center gap-1 text-micro text-nomi-ink-40 whitespace-nowrap')}>
            <IconPencil size={13} stroke={1.7} />创作
          </span>
          <WorkbenchAiHeaderActions
            className={cn('inline-flex items-center flex-nowrap gap-1')}
            actionClassName={cn(
              'size-6 inline-grid place-items-center shrink-0',
              'p-0 border-0 rounded-nomi-sm bg-transparent text-nomi-ink-60 cursor-pointer',
              'hover:bg-nomi-ink-05 hover:text-nomi-ink',
              'focus-visible:outline-2 focus-visible:outline-workbench-focus focus-visible:outline-offset-2',
            )}
            onNewConversation={handleNewConversation}
          />
        </div>
      </header>

      <div className={cn('[grid-area:tools]')}>
        <AssistantToolsFold tools={['读全文', '读选区', '插入到光标', '替换选区', '追加到文末']} />
      </div>

      <div
        ref={messagesScrollRef}
        className={cn(
          'workbench-creation-ai__messages',
          '[grid-area:messages] min-h-0 overflow-auto',
        )}
        aria-live="polite"
      >
        {messages.length === 0 && pendingToolCalls.length === 0 ? (
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
              <div className={cn('workbench-creation-ai__message-content', 'whitespace-normal')}>
                {message.role === 'assistant' && message.content === '处理中...' ? (
                  <NomiLoadingMark size={15} label="处理中" />
                ) : (
                  <NomiMarkdown compact>{message.content}</NomiMarkdown>
                )}
                {message.role === 'assistant' && message.content !== '处理中...' && !message.content.startsWith('（错误）') ? (
                  <AiReplyActionButton
                    className="workbench-creation-ai__reply-action"
                    content={message.content}
                  />
                ) : null}
              </div>
            </article>
          ))
        )}

        {pendingToolCalls.length > 0 ? (
          <div className={cn('workbench-creation-ai__tool-calls', 'flex flex-col gap-2 p-[10px_11px]')}>
            {pendingToolCalls.map((call) => (
              <div
                key={call.toolCallId}
                className={cn(
                  'workbench-creation-ai__tool-call',
                  'flex flex-col gap-2 p-3 rounded-nomi border border-nomi-accent-soft bg-nomi-accent-soft/40',
                )}
                data-tool-call-id={call.toolCallId}
              >
                <div className={cn('workbench-creation-ai__tool-call-head', 'inline-flex items-center gap-[6px] text-nomi-accent text-[12.5px] font-medium')}>
                  {writeToolIcon(call.toolName)}
                  {writeToolLabel(call.toolName)}
                </div>
                <div className={cn('workbench-creation-ai__tool-call-body', 'max-h-[160px] overflow-auto text-nomi-ink text-[13px] leading-[1.5] whitespace-pre-wrap')}>
                  {call.content || '（空内容）'}
                </div>
                <div className={cn('flex items-center justify-end gap-2 mt-1')}>
                  <WorkbenchButton
                    className={cn('h-7 px-3 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-nomi-ink-80 text-[12px] cursor-pointer hover:bg-nomi-ink-05')}
                    onClick={() => resolvePending(call.toolCallId, { ok: false, message: 'rejected by user' })}
                  >
                    拒绝
                  </WorkbenchButton>
                  <WorkbenchButton
                    className={cn('h-7 px-3 rounded-nomi-sm border-0 bg-nomi-ink text-nomi-paper text-[12px] cursor-pointer hover:bg-nomi-accent disabled:cursor-not-allowed disabled:opacity-45')}
                    data-primary="true"
                    disabled={!documentTools}
                    onClick={() => applyWriteTool(call)}
                  >
                    应用
                  </WorkbenchButton>
                </div>
              </div>
            ))}
          </div>
        ) : null}
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
            'w-full min-h-14 resize-none',
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
          <NomiSelect
            ariaLabel="创作模式"
            leadingLabel="模式"
            size="sm"
            title={activeMode.description}
            value={activeMode.id}
            options={CREATION_AI_MODES.map((mode) => ({ value: mode.id, label: mode.shortLabel }))}
            onChange={(value) => setModeId(value as CreationAiModeId)}
          />
          <button
            className={cn(
              // 纯 button + NomiSelect trigger 同款 chrome（WorkbenchButton 会强加自己的
              // 圆角/字重，导致 chip 变圆角矩形而非全圆 pill，故不用它）。
              'workbench-creation-ai__storyboard-chip',
              'shrink-0 h-7 inline-flex items-center gap-1 px-2',
              'border border-nomi-line rounded-pill bg-nomi-paper',
              'text-caption text-nomi-ink-80 cursor-pointer',
              'hover:border-nomi-ink-20 focus:outline-none focus-visible:border-nomi-accent',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
            type="button"
            title="把当前正文交给 AI 拆成镜头节点"
            disabled={sending || !(selectedText || documentText).trim()}
            onClick={() => launchStoryboardPlanning('🎬 拆镜头')}
          >
            <IconMovie size={13} className="text-nomi-ink-40" />
            <span>拆镜头</span>
          </button>
          <button
            className={cn(
              'workbench-creation-ai__fixation-chip',
              'shrink-0 h-7 inline-flex items-center gap-1 px-2',
              'border border-nomi-line rounded-pill bg-nomi-paper',
              'text-caption text-nomi-ink-80 cursor-pointer',
              'hover:border-nomi-ink-20 focus:outline-none focus-visible:border-nomi-accent',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
            type="button"
            title="把剧本交给 AI，为主要角色/场景建卡并写好身份板提示词"
            disabled={sending || !(selectedText || documentText).trim()}
            onClick={() => launchFixationPlanning('🎭 立角色卡')}
          >
            <IconSparkles size={13} className="text-nomi-ink-40" />
            <span>立角色卡</span>
          </button>
          {sending ? (
            <WorkbenchIconButton
              className={cn(
                'workbench-creation-ai__send',
                'shrink-0 size-7 inline-flex items-center justify-center cursor-pointer',
                'focus-visible:outline-2 focus-visible:outline-workbench-focus focus-visible:outline-offset-2',
              )}
              label="停止"
              aria-label="停止生成"
              onClick={() => cancelRef.current?.()}
              icon={<IconPlayerStopFilled size={13} />}
            />
          ) : (
            <WorkbenchIconButton
              className={cn(
                'workbench-creation-ai__send',
                'shrink-0 size-7 inline-flex items-center justify-center cursor-pointer',
                'disabled:cursor-not-allowed disabled:opacity-[0.48]',
                'focus-visible:outline-2 focus-visible:outline-workbench-focus focus-visible:outline-offset-2',
              )}
              label="发送"
              aria-label="创作 AI 发送"
              disabled={!draft.trim()}
              onClick={() => void send()}
              icon={<IconSend2 size={15} />}
            />
          )}
        </div>
      </footer>
    </aside>
  )
}
