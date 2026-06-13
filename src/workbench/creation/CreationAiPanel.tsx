import React from 'react'
import { createPortal } from 'react-dom'
import { IconCornerDownLeft, IconCursorText, IconFilePlus, IconMaximize, IconMinimize, IconPaperclip, IconPlayerStopFilled, IconReplace, IconSend2, IconX } from '@tabler/icons-react'
import { NomiLoadingMark, NomiLogoMark, NomiSelect, WorkbenchButton, WorkbenchIconButton } from '../../design'
import { NomiMarkdown } from '../common/NomiMarkdown'
import { cn } from '../../utils/cn'
import { runWorkbenchAgent, workbenchSessionKey, type ToolCallEvent } from '../ai/workbenchAgentRunner'
import { startNewConversation } from '../ai/conversationPersistence'
import { clearWorkbenchAgentSession } from '../../api/desktopClient'
import { AiReplyActionButton } from '../ai/AiReplyActionButton'
import AssistantModelPicker from '../ai/AssistantModelPicker'
import { handleAiComposerKeyDown } from '../ai/aiComposerKeyboard'
import { routeCreationIntent } from './creationIntentRouting'
import type { WorkbenchAiMessage } from '../ai/workbenchAiTypes'
import { WorkbenchAiHeaderActions } from '../ai/WorkbenchAiHeaderActions'
import { MemoryFold } from '../generationCanvas/components/MemoryFold'
import { useWorkbenchStore } from '../workbenchStore'
import { runStoryboardPlanner } from '../generationCanvas/agent/runStoryboardPlanner'
import { requestFixationPlanning } from '../generationCanvas/agent/fixationLauncher'
import {
  buildCreationAiPrompt,
  CREATION_AI_MODES,
  extractWorkbenchDocumentText,
  getCreationAiMode,
  type CreationAiModeId,
} from './creationAiModes'
import { useTransientScrollingClass } from './useTransientScrollingClass'
import { readWindowUrlParam } from '../windowUrlParam'
import { AttachmentRail } from '../ai/composer/AttachmentRail'
import { StaleConversationDivider, useStaleConversationBoundary } from '../ai/staleConversationDivider'
import { narrateTurnStats } from '../observability/narrate'
import { AutoGrowTextarea } from '../ai/composer/AutoGrowTextarea'
import { COMPOSER_ATTACHMENT_ACCEPT, useComposerAttachments } from '../ai/composer/useComposerAttachments'


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

export default function CreationAiPanel({ onCollapse }: { onCollapse?: () => void } = {}): JSX.Element {
  const [sending, setSending] = React.useState(false)
  // 项目记忆卡刷新键:每完成一轮(sending true→false)+1,触发记忆重取(本轮可能提炼新事实)。
  const [memoryRefreshKey, setMemoryRefreshKey] = React.useState(0)
  const prevSendingRef = React.useRef(sending)
  React.useEffect(() => {
    if (prevSendingRef.current && !sending) setMemoryRefreshKey((key) => key + 1)
    prevSendingRef.current = sending
  }, [sending])
  // 放大/全屏对话：把整块面板移到 body 级居中浮层（仿 Scene3D 全屏 portal）。
  const [expanded, setExpanded] = React.useState(false)
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
  // S1b 诚实分隔线:气泡有历史而 LLM 记忆为空 → 在历史末尾画「以上对话 AI 已不再记得」。
  const staleBoundaryId = useStaleConversationBoundary(messages.map((message) => message.id))
  const attachments = useWorkbenchStore((state) => state.creationAiAttachments)
  const error = useWorkbenchStore((state) => state.creationAiError)
  const setModeId = useWorkbenchStore((state) => state.setCreationAiModeId)
  const setDraft = useWorkbenchStore((state) => state.setCreationAiDraft)
  const setMessages = useWorkbenchStore((state) => state.setCreationAiMessages)
  const setAttachments = useWorkbenchStore((state) => state.setCreationAiAttachments)
  const setError = useWorkbenchStore((state) => state.setCreationAiError)
  const setWorkspaceMode = useWorkbenchStore((state) => state.setWorkspaceMode)

  const {
    isDragging,
    openFilePicker,
    inputRef,
    onInputChange,
    removeAttachment,
    clearAttachments,
    handlePaste,
    dragHandlers,
  } = useComposerAttachments({ attachments, setAttachments, onError: setError })

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
    const assistantId = `creation_ai_assistant_${now + 1}`
    setMessages((prev) => [
      ...prev,
      { id: `creation_ai_user_${now}`, role: 'user', content: displayPrompt },
      { id: assistantId, role: 'assistant', content: '正在拆镜头，整理分镜方案…', status: 'pending' as const },
    ])
    setDraft('')
    setError('')
    // 流程 A：就地跑规划师（不切到生成区）。产出 propose_storyboard_plan 落创作 store →
    // 主列展开分镜方案编辑器；规划阶段全程免费、不碰画布（runStoryboardPlanner 的 onToolCall 守卫）。
    setSending(true)
    void (async () => {
      try {
        const { text } = await runStoryboardPlanner({
          storyText,
          onContent: (streamed) =>
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: streamed || '正在拆镜头…', status: 'streaming' as const } : m))),
          onCancelReady: (cancel) => {
            cancelRef.current = cancel
          },
        })
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: text || '分镜方案已生成，请在左侧审阅、修改后确认落画布。', status: 'done' as const } : m,
          ),
        )
      } catch (error: unknown) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `拆镜头失败：${error instanceof Error && error.message ? error.message : '未知错误'}`, status: 'error' as const }
              : m,
          ),
        )
      } finally {
        setSending(false)
        cancelRef.current = null
      }
    })()
  }, [documentText, selectedText, setDraft, setError, setMessages])

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
      { id: `creation_ai_assistant_${now + 1}`, role: 'assistant', content: '已切到生成区，正在让 AI 按剧本为角色/场景定妆。', status: 'done' as const },
    ])
    setDraft('')
    setError('')
    setWorkspaceMode('generation')
    window.setTimeout(() => {
      requestFixationPlanning({ storyText, source: 'creation-ai-panel' })
    }, 60)
  }, [documentText, selectedText, setDraft, setError, setMessages, setWorkspaceMode])

  const send = React.useCallback(async (textOverride?: string) => {
    if (sending) return
    const userRequest = (textOverride ?? draft).trim()
    const readyAttachments = attachments.filter((item) => item.status === 'ready' && item.url)
    if (!userRequest && !selectedText && !documentText && !readyAttachments.length) return
    // 对话驱动（删固定 chip，用户拍板 2026-06-13）：自然语言意图 → 甩给画布 agent。
    const intent = routeCreationIntent(userRequest)
    if (intent === 'storyboard') {
      launchStoryboardPlanning(userRequest || '🎬 拆镜头')
      return
    }
    if (intent === 'fixation') {
      launchFixationPlanning(userRequest || '🎭 立角色卡')
      return
    }
    const prompt = buildCreationAiPrompt({ mode: activeMode, userRequest })
    const displayPrompt = userRequest || (readyAttachments.length ? '请看这些附件' : `${activeMode.label}：处理当前文稿`)
    const attachmentPayload = readyAttachments.map((item) => ({
      url: item.url as string,
      contentType: item.contentType,
      fileName: item.fileName,
      kind: item.kind,
    }))
    const userMessage: WorkbenchAiMessage = {
      id: `creation_ai_user_${Date.now()}`,
      role: 'user',
      content: displayPrompt,
      ...(readyAttachments.length ? { attachments: readyAttachments } : {}),
    }
    const pendingId = `creation_ai_assistant_${Date.now() + 1}`
    setMessages((prev) => [...prev, userMessage, { id: pendingId, role: 'assistant', content: '', status: 'pending' as const }])
    setDraft('')
    clearAttachments()
    setError('')
    setSending(true)
    try {
      const response = await runWorkbenchAgent({
        prompt,
        displayPrompt,
        ...(attachmentPayload.length ? { attachments: attachmentPayload } : {}),
        sessionKey: workbenchSessionKey(),
        projectId: readWindowUrlParam('projectId'),
        skillKey: `workbench.creation.${activeMode.id}`,
        skillName: activeMode.title,
        onContent: (_delta, streamedText) => {
          setMessages((prev) => prev.map((message) => (
            message.id === pendingId ? { ...message, content: streamedText, status: 'streaming' as const } : message
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
      const totalTokens = response.usage?.totalTokens
      setMessages((prev) => prev.map((message) => (
        message.id === pendingId
          ? { ...message, content: reply, status: 'done' as const, ...(totalTokens ? { turnStats: { totalTokens } } : {}) }
          : message
      )))
    } catch (err) {
      const message = err instanceof Error ? err.message : '创作 AI 调用失败'
      setError(message)
      setMessages((prev) => prev.map((item) => (
        item.id === pendingId ? { ...item, content: `（错误）${message}`, status: 'error' as const } : item
      )))
    } finally {
      setSending(false)
      cancelRef.current = null
    }
  }, [activeMode, attachments, clearAttachments, documentText, draft, launchStoryboardPlanning, selectedText, sending, setDraft, setError, setMessages])

  // 通用创作动作，贴 Nomi 视频创作调性、不绑小说题材（旧的「悬疑开场/童话语气」在产品/宣传项目里调性错配）。
  const suggestions = React.useMemo(() => [
    '给我一个开头',
    '把这段写得更有画面感',
    '梳理成分镜脚本',
  ], [])

  const handleNewConversation = React.useCallback(() => {
    setPendingToolCalls([])
    // 会话历史:归档当前线程(不销毁),建空活动线程,清面板消息投影。
    startNewConversation('creation')
    // 清 session 态(draft/附件/error 不落盘,不入线程)。
    setDraft('')
    clearAttachments()
    setError('')
    // 新对话 = 模型上下文也归零(切回旧线程时由 S2 重灌)。
    void clearWorkbenchAgentSession(workbenchSessionKey())
  }, [clearAttachments, setDraft, setError])

  const panelBody = (
    <aside
      className={cn(
        'workbench-creation-ai',
        'relative grid grid-rows-[44px_auto_minmax(0,1fr)_auto_auto]',
        '[grid-template-areas:"header"_"tools"_"messages"_"error"_"composer"]',
        'min-w-0 min-h-0 overflow-hidden',
        expanded && 'h-[86vh] w-[min(760px,92vw)] rounded-nomi-lg border border-nomi-line bg-nomi-paper shadow-nomi-lg',
      )}
      aria-label="AI 创作区"
      {...dragHandlers}
    >
      {isDragging ? (
        <div
          className={cn(
            'absolute inset-1.5 z-10 flex flex-col items-center justify-center gap-2 pointer-events-none',
            'rounded-nomi border-2 border-dashed border-nomi-accent bg-nomi-accent-soft',
            'text-bodySm font-semibold text-nomi-accent',
          )}
          aria-hidden="true"
        >
          <IconPaperclip size={26} stroke={1.5} />
          <div>拖到这里添加附件</div>
          <div className={cn('text-micro font-normal text-nomi-ink-60')}>图片 / PDF / Word / Excel / txt · 单个上限 30MB</div>
        </div>
      ) : null}
      <header
        className={cn(
          'workbench-creation-ai__header',
          '[grid-area:header] flex items-center justify-between gap-[10px] min-w-0',
        )}
      >
        {/* 头部：Nomi 标 + 「助手」+ 动作（含 token 计数）。 */}
        <div className={cn('workbench-creation-ai__title', 'inline-flex items-center gap-2 min-w-0')}>
          <NomiLogoMark size={18} />
          {/* 审计 A14：与入口词「创作」一致，不再裸叫「助手」 */}
          <span className={cn('text-bodySm font-semibold text-nomi-ink')}>创作助手</span>
        </div>
        <div className={cn('inline-flex items-center gap-2 ml-auto min-w-0')}>
          <WorkbenchAiHeaderActions
            area="creation"
            className={cn('inline-flex items-center flex-nowrap gap-1')}
            actionClassName={cn(
              'size-6 inline-grid place-items-center shrink-0',
              'p-0 border-0 rounded-nomi-sm bg-transparent text-nomi-ink-60 cursor-pointer',
              'hover:bg-nomi-ink-05 hover:text-nomi-ink',
              'focus-visible:outline-2 focus-visible:outline-workbench-focus focus-visible:outline-offset-2',
            )}
            onNewConversation={handleNewConversation}
          />
          <WorkbenchIconButton
            className={cn(
              'size-6 inline-grid place-items-center shrink-0',
              'p-0 border-0 rounded-nomi-sm bg-transparent text-nomi-ink-60 cursor-pointer',
              'hover:bg-nomi-ink-05 hover:text-nomi-ink',
              'focus-visible:outline-2 focus-visible:outline-workbench-focus focus-visible:outline-offset-2',
            )}
            label={expanded ? '缩小' : '放大对话'}
            aria-label={expanded ? '缩小创作助手' : '放大创作助手'}
            onClick={() => setExpanded((value) => !value)}
            icon={expanded ? <IconMinimize size={15} /> : <IconMaximize size={15} />}
          />
          {onCollapse ? (
            <WorkbenchIconButton
              className={cn(
                'size-6 inline-grid place-items-center shrink-0',
                'p-0 border-0 rounded-nomi-sm bg-transparent text-nomi-ink-60 cursor-pointer',
                'hover:bg-nomi-ink-05 hover:text-nomi-ink',
                'focus-visible:outline-2 focus-visible:outline-workbench-focus focus-visible:outline-offset-2',
              )}
              label="收起助手"
              aria-label="收起创作助手"
              onClick={onCollapse}
              icon={<IconX size={15} />}
            />
          ) : null}
        </div>
      </header>

      <div className={cn('[grid-area:tools]')}>
        {/* 对齐画布助手:项目记忆「AI 记得 N 条」(N=0 不渲染);删工具条(与记忆条重复的灰杠)。 */}
        <MemoryFold refreshKey={memoryRefreshKey} />
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
          <div className={cn(
            'flex h-full flex-col items-center justify-center gap-2',
            'max-w-[240px] mx-auto py-6 px-3 text-center',
          )}>
            <div className={cn('text-nomi-ink font-[Fraunces,Inter,serif] text-title font-medium')}>需要一点灵感？</div>
            <div className={cn('text-nomi-ink-60 text-bodySm leading-relaxed')}>
              告诉 AI 你想写什么，它会给你一个开头。
            </div>
            <div className={cn('flex flex-col gap-1.5 w-full mt-2')}>
              {suggestions.map((suggestion) => (
                <WorkbenchButton
                  key={suggestion}
                  className={cn(
                    'w-full min-h-9 py-2 px-3 border border-transparent rounded-nomi',
                    'flex items-center justify-between gap-2 text-left font-normal',
                    'bg-nomi-ink-05 text-nomi-ink-80 cursor-pointer',
                    'hover:border-nomi-line hover:bg-nomi-paper hover:text-nomi-ink',
                  )}
                  onClick={() => void send(suggestion)}
                >
                  <span className={cn('min-w-0')}>{suggestion}</span>
                  <IconCornerDownLeft size={13} className={cn('shrink-0 text-nomi-ink-40')} />
                </WorkbenchButton>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <React.Fragment key={message.id}>
            <article
              className={cn(
                'workbench-creation-ai__message',
                `workbench-creation-ai__message--${message.role}`,
                'p-[10px_11px] whitespace-pre-wrap',
              )}
            >
              <div className={cn('workbench-creation-ai__message-content', 'whitespace-normal')}>
                {message.attachments?.length ? (
                  <AttachmentRail attachments={message.attachments} readOnly className={cn('mb-1.5')} />
                ) : null}
                {message.role === 'assistant' && message.status === 'pending' ? (
                  <div className={cn('flex items-center gap-2')}>
                    <NomiLoadingMark size={14} label="处理中" />
                    {message.content ? (
                      <span className={cn('text-nomi-ink-60 text-[13px] leading-snug')}>{message.content}</span>
                    ) : null}
                  </div>
                ) : (
                  <NomiMarkdown compact>{message.content}</NomiMarkdown>
                )}
                {message.role === 'assistant' && message.status === 'streaming' ? (
                  <span className={cn('inline-flex gap-[3px] mt-1.5')} aria-hidden>
                    {[0, 1, 2].map((i) => (
                      <span key={i} className={cn('block w-1 h-1 rounded-full bg-nomi-ink-40 animate-pulse')} style={{ animationDelay: `${i * 150}ms` }} />
                    ))}
                  </span>
                ) : null}
                {message.role === 'assistant' && (!message.status || message.status === 'done') && !message.content.startsWith('（错误）') ? (
                  <AiReplyActionButton
                    className="workbench-creation-ai__reply-action"
                    content={message.content}
                  />
                ) : null}
                {message.turnStats?.totalTokens ? (
                  <span className={cn('block mt-1 text-micro text-nomi-ink-40')}>{narrateTurnStats(message.turnStats.totalTokens)}</span>
                ) : null}
              </div>
            </article>
            {message.id === staleBoundaryId ? <StaleConversationDivider /> : null}
            </React.Fragment>
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
                <div className={cn('workbench-creation-ai__tool-call-head', 'inline-flex items-center gap-[6px] text-nomi-accent text-caption font-medium')}>
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
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={COMPOSER_ATTACHMENT_ACCEPT}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={onInputChange}
        />
        <AttachmentRail attachments={attachments} onRemove={removeAttachment} className={cn('mb-2')} />
        <AutoGrowTextarea
          className={cn('workbench-creation-ai__input', 'min-h-14')}
          value={draft}
          placeholder="拆成镜头、做成视频、立张角色卡，或问我任何事…"
          aria-label="创作 AI 输入"
          // tour 锚点从已删的「拆镜头」chip 迁到输入框——引导改为「教用对话触发」。
          data-tour="storyboard-cta"
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => handleAiComposerKeyDown(event, () => void send())}
          onPaste={handlePaste}
        />
        <div className={cn('workbench-creation-ai__actions', 'flex items-center justify-between')}>
          {/* 左侧：附件 + 模式 + 模型选择 */}
          <div className={cn('flex items-center gap-1.5 flex-1 min-w-0')}>
            <WorkbenchIconButton
              className={cn(
                'workbench-creation-ai__attach',
                'shrink-0 size-7 inline-flex items-center justify-center cursor-pointer',
                'text-nomi-ink-60 hover:text-nomi-ink',
                'focus-visible:outline-2 focus-visible:outline-workbench-focus focus-visible:outline-offset-2',
              )}
              label="添加附件"
              aria-label="添加附件（也可拖拽 / 粘贴）"
              onClick={openFilePicker}
              icon={<IconPaperclip size={16} />}
            />
            <NomiSelect
              ariaLabel="创作模式"
              leadingLabel="模式"
              size="sm"
              title={activeMode.description}
              value={activeMode.id}
              options={CREATION_AI_MODES.map((mode) => ({ value: mode.id, label: mode.shortLabel }))}
              onChange={(value) => setModeId(value as CreationAiModeId)}
            />
            <AssistantModelPicker />
          </div>
          {/* 拆镜头 / 立角色卡 不再做固定执行 chip（用户拍板：对话驱动）——
              用户在输入框直接说「拆成 6 个镜头」「把这个故事做成视频」「给主角立张定妆卡」即可，
              意图由 send() 的 pattern 路由给画布 agent（发现性靠 placeholder + tour 引导）。 */}
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

  if (!expanded || typeof document === 'undefined') return panelBody
  // portal 到 body 会脱离 .workbench-shell 作用域 → 所有 --workbench-* token 失效（面板背景/
  // 蒙层全透明）。带上 workbench-shell 类把 token 作用域接回来（同 Scene3D 全屏壳做法）。
  return createPortal(
    <div
      className={cn('workbench-shell', 'fixed inset-0 z-[200] grid place-items-center bg-[var(--workbench-backdrop)] p-4')}
      onClick={(event) => {
        if (event.target === event.currentTarget) setExpanded(false)
      }}
    >
      {panelBody}
    </div>,
    document.body,
  )
}
