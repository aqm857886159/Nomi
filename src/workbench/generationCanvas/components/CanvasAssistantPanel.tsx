import { IconCornerDownLeft, IconPaperclip, IconPlayerStopFilled, IconSend2, IconX } from '@tabler/icons-react'
import { NomiAILabel, NomiLoadingMark, NomiLogoMark, NomiSelect, WorkbenchButton, WorkbenchIconButton } from '../../../design'
import React from 'react'
import { cn } from '../../../utils/cn'
import {
  sendGenerationCanvasAgentMessage,
  type ToolCallEvent,
} from '../agent/generationCanvasAgentClient'
import { workbenchSessionKey } from '../../ai/workbenchAgentRunner'
import { clearWorkbenchAgentSession } from '../../../api/desktopClient'
import { generationCanvasTools } from '../agent/generationCanvasTools'
import { applyCanvasToolCall } from '../agent/applyCanvasToolCall'
import {
  buildStoryboardPlanningMessage,
  STORYBOARD_PLANNER_SKILL,
  STORYBOARD_PLANNING_EVENT,
  type StoryboardPlanningRequest,
} from '../agent/storyboardLauncher'
import {
  buildFixationPlanningMessage,
  FIXATION_PLANNER_SKILL,
  FIXATION_PLANNING_EVENT,
  type FixationPlanningRequest,
} from '../agent/fixationLauncher'
import AgentPlanCard, { summarizeAgentPlan } from './AgentPlanCard'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { AiReplyActionButton } from '../../ai/AiReplyActionButton'
import { handleAiComposerKeyDown } from '../../ai/aiComposerKeyboard'
import { WorkbenchAiHeaderActions } from '../../ai/WorkbenchAiHeaderActions'
import AssistantModelPicker from '../../ai/AssistantModelPicker'
import { AssistantToolsFold } from '../../ai/AssistantToolsFold'
import { StaleConversationDivider, useStaleConversationBoundary } from '../../ai/staleConversationDivider'
import { narrateTurnStats } from '../../observability/narrate'
import { AttachmentRail } from '../../ai/composer/AttachmentRail'
import { AutoGrowTextarea } from '../../ai/composer/AutoGrowTextarea'
import { COMPOSER_ATTACHMENT_ACCEPT, useComposerAttachments } from '../../ai/composer/useComposerAttachments'
import type { ComposerAttachment } from '../../ai/composer/composerAttachmentTypes'

type PendingToolCall = {
  toolCallId: string
  toolName: string
  args: unknown
  /**
   * Confirm or reject the pending tool call. `overrides` lets the UI
   * patch the args before they are applied — used by the plan card so a
   * user-edited prompt overrides the agent's original suggestion.
   */
  confirm: (
    decision: { ok: true; result?: unknown } | { ok: false; message?: string },
    overrides?: Record<string, unknown>,
  ) => Promise<void>
}

function summarizeToolCall(toolName: string, args: unknown): string {
  const record = (args && typeof args === 'object') ? args as Record<string, unknown> : {}
  if (toolName === 'create_canvas_nodes') {
    const nodes = Array.isArray(record.nodes) ? record.nodes : []
    const summary = typeof record.summary === 'string' ? record.summary : ''
    return `创建 ${nodes.length} 个节点${summary ? `：${summary}` : ''}`
  }
  if (toolName === 'connect_canvas_edges') {
    const edges = Array.isArray(record.edges) ? record.edges : []
    return `连接 ${edges.length} 条边`
  }
  if (toolName === 'set_node_prompt') {
    return `改写节点 ${String(record.nodeId || '')} 的提示词`
  }
  if (toolName === 'delete_canvas_nodes') {
    const ids = Array.isArray(record.nodeIds) ? record.nodeIds : []
    return `删除 ${ids.length} 个节点`
  }
  if (toolName === 'read_canvas_state') {
    return '读取画布当前状态'
  }
  return `${toolName}`
}

type CanvasAssistantPanelProps = {
  defaultCollapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
}

function createMessageId(): string {
  return `assistant-message-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// 文字里像「要动画布却没动」的意图特征——配合零工具发射判定「只说不做」，提示换模型。
const AGENT_ACTION_INTENT = /创建|生成|添加|新增|修改|删除|替换|连接|拆镜头|分镜|节点|我将|我会|我来|计划|操作/

export default function CanvasAssistantPanel({
  defaultCollapsed = false,
  onCollapsedChange,
}: CanvasAssistantPanelProps): JSX.Element {
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const edges = useGenerationCanvasStore((state) => state.edges)
  const selectedNodeIds = useGenerationCanvasStore((state) => state.selectedNodeIds)
  const snapshot = React.useMemo(() => generationCanvasTools.read_canvas(), [nodes, edges, selectedNodeIds])
  const selectedNodes = React.useMemo(() => generationCanvasTools.read_selected_nodes(), [nodes, selectedNodeIds])
  const [busy, setBusy] = React.useState(false)
  // Cancel handle for the in-flight agent turn (user "Stop"); set once the
  // backend session exists, cleared when the turn ends.
  const cancelRef = React.useRef<(() => void) | null>(null)
  const [mode, setMode] = React.useState<'agent' | 'chat' | 'refine'>('agent')
  const [pendingToolCalls, setPendingToolCalls] = React.useState<PendingToolCall[]>([])
  const threadBottomRef = React.useRef<HTMLDivElement | null>(null)

  const resolvePending = React.useCallback((
    toolCallId: string,
    decision: { ok: true; result?: unknown } | { ok: false; message?: string },
    overrides?: Record<string, unknown>,
  ) => {
    setPendingToolCalls((current) => {
      const target = current.find((item) => item.toolCallId === toolCallId)
      if (target) void target.confirm(decision, overrides)
      return current.filter((item) => item.toolCallId !== toolCallId)
    })
  }, [])

  // Exposed for the V2 agent client (wired in B6) so the panel can render
  // pending tool calls and forward the user's confirmation back to the IPC
  // session. We surface it via a ref so the call site doesn't have to
  // re-render on every state change.
  const pendingToolCallsRef = React.useRef({
    enqueue: (call: PendingToolCall) => setPendingToolCalls((current) => [...current, call]),
    clear: () => setPendingToolCalls([]),
  })
  const draft = useGenerationCanvasStore((state) => state.generationAiDraft)
  const messages = useGenerationCanvasStore((state) => state.generationAiMessages)
  // S1b 诚实分隔线:气泡有历史而 LLM 记忆为空 → 在历史末尾画「以上对话 AI 已不再记得」。
  const staleBoundaryId = useStaleConversationBoundary(messages.map((message) => message.id))
  const collapsed = useGenerationCanvasStore((state) => state.generationAiCollapsed)
  const setDraft = useGenerationCanvasStore((state) => state.setGenerationAiDraft)
  const setMessages = useGenerationCanvasStore((state) => state.setGenerationAiMessages)
  // 附件用组件本地态（不进 generationCanvasStore——它已是白名单巨壳，不再喂；附件本就 ephemeral，
  // 面板折叠时组件仍挂载，本地态不丢）。
  const [attachments, setAttachments] = React.useState<ComposerAttachment[]>([])
  const setCollapsed = useGenerationCanvasStore((state) => state.setGenerationAiCollapsed)
  const resetConversation = useGenerationCanvasStore((state) => state.resetGenerationAiConversation)

  const {
    isDragging,
    openFilePicker,
    inputRef,
    onInputChange,
    removeAttachment,
    clearAttachments,
    handlePaste,
    dragHandlers,
  } = useComposerAttachments({ attachments, setAttachments })

  React.useEffect(() => {
    if (messages.length === 0 && !draft.trim()) setCollapsed(defaultCollapsed)
  }, [defaultCollapsed, draft, messages.length, setCollapsed])

  React.useEffect(() => {
    onCollapsedChange?.(collapsed)
  }, [collapsed, onCollapsedChange])

  // Keep the newest reply / pending plan card in view. Without this the
  // thread stays scrolled to the top and a fresh reply (or a tool-call card)
  // looks like it landed "above" the conversation.
  React.useEffect(() => {
    if (collapsed) return
    threadBottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, pendingToolCalls, collapsed])

  const appendMessage = React.useCallback((message: { role: 'assistant' | 'user' | 'tool'; content: string; attachments?: ComposerAttachment[] }) => {
    setMessages((current) => [...current, { id: createMessageId(), ...message }])
  }, [setMessages])

  const updateMessage = React.useCallback((id: string, content: string) => {
    setMessages((current) => current.map((message) => (
      message.id === id ? { ...message, content } : message
    )))
  }, [setMessages])

  type SubmitMessageOptions = {
    skill?: { key: string; name: string }
    displayMessage?: string
  }

  const submitAgentMessage = React.useCallback((text: string, options: SubmitMessageOptions = {}) => {
    const readyAttachments = attachments.filter((item) => item.status === 'ready' && item.url)
    if ((!text && !readyAttachments.length) || busy) return
    setDraft('')
    clearAttachments()
    const attachmentPayload = readyAttachments.map((item) => ({
      url: item.url as string,
      contentType: item.contentType,
      fileName: item.fileName,
      kind: item.kind,
    }))
    appendMessage({
      role: 'user',
      content: options.displayMessage || text || '请看这些附件',
      ...(readyAttachments.length ? { attachments: readyAttachments } : {}),
    })
    const assistantMessageId = createMessageId()
    setMessages((current) => [
      ...current,
      { id: assistantMessageId, role: 'assistant', content: '处理中...' },
    ])
    setBusy(true)
    void (async () => {
      let toolActionCount = 0
      // 本轮模型是否发出过任何 tool 调用（含只读）。0 = 模型只回文字、没触发任何操作——
      // 自动选模型撞到不会工具调用的模型时的典型「只说不做」（2026-06-07 走查 P0）。
      let toolEmittedCount = 0
      try {
        const result = await sendGenerationCanvasAgentMessage({
          message: text || '请看这些附件',
          ...(attachmentPayload.length ? { attachments: attachmentPayload } : {}),
          snapshot,
          selectedNodes,
          mode,
          skill: options.skill,
          onContent: (_delta, streamedText) => {
            updateMessage(assistantMessageId, streamedText || '处理中...')
          },
          onCancelReady: (cancel) => {
            cancelRef.current = cancel
          },
          onToolCall: (event: ToolCallEvent) => {
            toolEmittedCount += 1
            // Read-only tools auto-execute without user interaction. Wrap in
            // try/catch so a read failure can't strand the agent loop waiting
            // for a confirm that never comes.
            if (event.toolName === 'read_canvas_state') {
              try {
                const snap = generationCanvasTools.read_canvas()
                void event.confirm({ ok: true, result: snap })
              } catch (error: unknown) {
                void event.confirm({ ok: false, message: error instanceof Error ? error.message : String(error) })
              }
              return
            }
            // Destructive / state-changing tools wait for explicit user
            // approval through the pending tool-call card.
            pendingToolCallsRef.current.enqueue({
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: event.args,
              confirm: async (decision, overrides) => {
                if (decision.ok) {
                  const baseArgs = (event.args && typeof event.args === 'object')
                    ? event.args as Record<string, unknown>
                    : {}
                  const effectiveArgs = overrides ? { ...baseArgs, ...overrides } : baseArgs
                  try {
                    const result = await applyCanvasToolCall(event.toolName, effectiveArgs)
                    toolActionCount += 1
                    // S6-0:把对账的「米」随判决一起带回——effectiveArgs 是合并后全量快照,
                    // overridesDelta 是用户实际改动的字段(无改动则不带,避免空对象进日志)。
                    await event.confirm({
                      ok: true,
                      result,
                      effectiveArgs,
                      ...(overrides ? { overridesDelta: overrides } : {}),
                    })
                  } catch (error: unknown) {
                    const message = error instanceof Error && error.message ? error.message : String(error)
                    await event.confirm({ ok: false, message })
                  }
                } else {
                  await event.confirm(decision)
                }
              },
            })
          },
        })

        const finalText = result.response.text?.trim() || ''
        if (toolActionCount > 0) {
          updateMessage(
            assistantMessageId,
            `${finalText ? finalText + '\n\n' : ''}已执行 ${toolActionCount} 个工具调用。`,
          )
        } else if (toolEmittedCount === 0 && mode === 'agent' && AGENT_ACTION_INTENT.test(finalText)) {
          // 模型只回文字、没发任何工具调用，但话里像是要操作 → 多半是当前模型不擅长工具调用。
          updateMessage(
            assistantMessageId,
            `${finalText}\n\n⚠️ 这一轮 AI 只回复了文字、没有真正动画布。如果你是想生成或修改节点，多半是当前模型不擅长工具调用——点上方「模型」换一个（推荐 GPT / Claude / DeepSeek 系）再试一次。`,
          )
        } else {
          updateMessage(assistantMessageId, finalText || '已完成。')
        }
        // S3 轮次 footer:把本轮 token 用量挂到收尾消息上(渲染见消息体底部 caption)。
        const totalTokens = result.response.usage?.totalTokens
        if (totalTokens) {
          setMessages((prev) => prev.map((message) => (
            message.id === assistantMessageId ? { ...message, turnStats: { totalTokens } } : message
          )))
        }
      } catch (error: unknown) {
        updateMessage(
          assistantMessageId,
          `生成区 Agent 执行失败：${error instanceof Error && error.message ? error.message : '未知错误'}`,
        )
      } finally {
        setBusy(false)
        cancelRef.current = null
      }
    })()
  }, [appendMessage, attachments, busy, clearAttachments, mode, selectedNodes, setDraft, setMessages, snapshot, updateMessage])

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    submitAgentMessage(draft.trim())
  }

  // Listen for "Story → Storyboard" requests dispatched from the creation
  // editor (C2) or the project library "Try Now" hero (C6). The panel
  // expands, drops the user's story into the chat thread, and runs the
  // storyboard-planner skill which will trigger create_canvas_nodes +
  // connect_canvas_edges tool calls.
  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<StoryboardPlanningRequest>).detail
      const storyText = detail?.storyText?.trim() || ''
      if (!storyText) return
      setCollapsed(false)
      const message = buildStoryboardPlanningMessage(storyText)
      submitAgentMessage(message, {
        skill: STORYBOARD_PLANNER_SKILL,
        displayMessage: `🎬 拆镜头\n\n${storyText}`,
      })
    }
    window.addEventListener(STORYBOARD_PLANNING_EVENT, handler as EventListener)
    return () => window.removeEventListener(STORYBOARD_PLANNING_EVENT, handler as EventListener)
  }, [setCollapsed, submitAgentMessage])

  // Tier2 定妆/定景：创作区「💄 定妆」触发 → 跑 fixation planner skill，按剧本建角色/场景卡 +
  // 注入身份板提示词（与 storyboard 同构）。
  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<FixationPlanningRequest>).detail
      const storyText = detail?.storyText?.trim() || ''
      if (!storyText) return
      setCollapsed(false)
      const message = buildFixationPlanningMessage(storyText)
      submitAgentMessage(message, {
        skill: FIXATION_PLANNER_SKILL,
        displayMessage: `💄 定妆\n\n${storyText}`,
      })
    }
    window.addEventListener(FIXATION_PLANNING_EVENT, handler as EventListener)
    return () => window.removeEventListener(FIXATION_PLANNING_EVENT, handler as EventListener)
  }, [setCollapsed, submitAgentMessage])

  const handleNewConversation = React.useCallback(() => {
    setPendingToolCalls([])
    clearAttachments()
    resetConversation()
    // Wipe the shared backend memory so both areas start a fresh thread.
    void clearWorkbenchAgentSession(workbenchSessionKey())
  }, [clearAttachments, resetConversation])

  if (collapsed) {
    return (
      <aside
        className={cn(
          'generation-canvas-v2-assistant',
          'block w-auto h-auto rounded-full',
        )}
        data-collapsed="true"
        aria-label="生成区 AI 启动器"
      >
        <WorkbenchButton
          className={cn(
            'generation-canvas-v2-assistant__launcher',
            'inline-flex items-center gap-2 h-9 pl-[10px] pr-[14px]',
            'border border-nomi-line rounded-full',
            'bg-nomi-paper text-nomi-ink font-[inherit] text-[13px] font-medium',
            'shadow-nomi-sm cursor-pointer',
            'hover:shadow-nomi-md hover:-translate-y-px',
          )}
          onClick={() => setCollapsed(false)}
        >
          <NomiAILabel markSize={18} wordSize={13} suffix="生成" />
        </WorkbenchButton>
      </aside>
    )
  }

  return (
    <aside
      className={cn(
        'generation-canvas-v2-assistant',
        // flexbox 而非 grid-rows-[…minmax(0,1fr)…] 任意值——后者在本环境解析异常，
        // 把工具条行撑成 145px 留出 ~120px 空白（用户反馈"上面空这么大"的真凶）。
        // 宽度撑满外层可拖拽的 grid 列（GenerationWorkspace 把列宽推到 assistantWidth），
        // 之前写死 w-[340px] → 拖宽后右侧一大片空白、header 右簇被 overflow-hidden 裁断 token。
        'relative flex flex-col w-full h-full',
        'max-h-none min-w-0 min-h-0 overflow-hidden',
        'border-0 rounded-none bg-nomi-paper shadow-none',
        'max-[900px]:w-[min(340px,calc(100vw-28px))]',
        'max-[900px]:max-h-[calc(100vh-var(--workbench-topbar-height)-var(--workbench-timeline-height)-32px)]',
        'max-[900px]:border max-[900px]:border-nomi-line max-[900px]:rounded-nomi max-[900px]:shadow-nomi-lg',
      )}
      data-collapsed="false"
      aria-label="生成区 AI 助手"
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
      {/* 头部：Nomi 标 + 「助手」+ 动作（含 token 计数）+ 收起。 */}
      <header className={cn(
        'flex items-center justify-between gap-2 px-3 py-2',
        'border-b border-nomi-line-soft bg-nomi-paper',
      )}>
        <div className={cn('flex items-center gap-2 min-w-0')}>
          <NomiLogoMark size={18} />
          <span className={cn('text-bodySm font-semibold text-nomi-ink')}>助手</span>
        </div>
        <div className={cn('inline-flex items-center gap-2 ml-auto min-w-0')}>
          <WorkbenchAiHeaderActions
            className={cn('generation-canvas-v2-assistant__shared-actions', 'inline-flex items-center flex-nowrap gap-1')}
            actionClassName={cn(
              'size-6 inline-grid place-items-center',
              'p-0 border-0 rounded-nomi-sm bg-transparent text-nomi-ink-60 cursor-pointer',
              'hover:bg-nomi-ink-05 hover:text-nomi-ink',
            )}
            onNewConversation={handleNewConversation}
          />
          <WorkbenchIconButton
            className={cn(
              'size-6 inline-grid place-items-center',
              'p-0 border-0 rounded-nomi-sm bg-transparent text-nomi-ink-60 cursor-pointer',
              'hover:bg-nomi-ink-05 hover:text-nomi-ink',
            )}
            label="收起 AI"
            onClick={() => setCollapsed(true)}
            icon={<IconX size={14} />}
          />
        </div>
      </header>
      <AssistantToolsFold tools={['读画布', '建节点', '设提示词', '连边', '删节点']} />
      <div className={cn('flex flex-1 flex-col gap-3 min-h-0 overflow-auto p-4')}>
        {messages.length === 0 && pendingToolCalls.length === 0 ? (
          <div className={cn(
            'flex flex-1 flex-col items-center justify-center gap-2',
            'max-w-[240px] mx-auto py-6 px-3 text-center',
          )}>
            <div className={cn('text-nomi-ink font-[Fraunces,Inter,serif] text-title font-medium')}>我帮你搭画布</div>
            <div className={cn('text-nomi-ink-60 text-bodySm leading-relaxed')}>
              铺镜头、改提示词、连节点都交给我；出图按节点上的「生成」键。
            </div>
            <div className={cn('flex flex-col gap-1.5 w-full mt-2')}>
              {['列 3 个镜头铺到画布', '给选中的镜头写一版提示词', '把镜头按先后顺序连起来'].map((suggestion) => (
                <WorkbenchButton
                  key={suggestion}
                  className={cn(
                    'w-full min-h-9 py-2 px-3 border border-transparent rounded-nomi',
                    'flex items-center justify-between gap-2 text-left font-normal',
                    'bg-nomi-ink-05 text-nomi-ink-80 cursor-pointer',
                    'hover:border-nomi-line hover:bg-nomi-paper hover:text-nomi-ink',
                  )}
                  onClick={() => submitAgentMessage(suggestion)}
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
              <div
                className={cn(
                  'relative max-w-[90%] py-[10px] px-[14px] rounded-nomi',
                  'bg-nomi-ink-05 text-nomi-ink text-body-sm leading-[1.55] whitespace-pre-wrap',
                  message.role === 'user' && 'self-end rounded-br-[4px]',
                  message.role === 'assistant' && 'self-start rounded-bl-[4px]',
                  message.role === 'tool' && 'self-start bg-nomi-accent-soft text-nomi-accent',
                )}
                data-role={message.role}
              >
                {message.attachments?.length ? (
                  <AttachmentRail attachments={message.attachments} readOnly className={cn('mb-1.5')} />
                ) : null}
                {message.role === 'assistant' && message.content === '处理中...' ? (
                  // 与创作助手一致：消息处理中时左侧显示转动的 N（NomiLoadingMark），而非干巴巴的「处理中...」文字。
                  <NomiLoadingMark size={15} label="处理中" />
                ) : (
                  message.content
                )}
                {message.role !== 'user' && message.content !== '处理中...' ? (
                  <AiReplyActionButton
                    className="generation-canvas-v2-assistant__reply-action"
                    content={message.content}
                  />
                ) : null}
                {message.turnStats?.totalTokens ? (
                  <span className={cn('block mt-1 text-micro text-nomi-ink-40')}>{narrateTurnStats(message.turnStats.totalTokens)}</span>
                ) : null}
              </div>
              {message.id === staleBoundaryId ? <StaleConversationDivider /> : null}
            </React.Fragment>
          ))
        )}
        {pendingToolCalls.length > 0 ? (() => {
          // Aggregate consecutive create_canvas_nodes + connect_canvas_edges
          // pairs into a single storyboard plan card; everything else falls
          // back to the per-call confirmation list below. Rendered at the
          // BOTTOM of the thread so the latest plan sits with the latest reply.
          const plan = summarizeAgentPlan(pendingToolCalls)
          const planCallIds = new Set([plan?.createCallId, plan?.connectCallId].filter(Boolean) as string[])
          const remaining = plan
            ? pendingToolCalls.filter((call) => !planCallIds.has(call.toolCallId))
            : pendingToolCalls
          return (
            <div className={cn('flex flex-col gap-3')}>
              {plan ? (
                <AgentPlanCard plan={plan} resolveCall={resolvePending} />
              ) : null}
              {remaining.length > 0 ? (
                <div
                  className={cn(
                    'flex flex-col gap-2 p-3 rounded-nomi border border-nomi-accent-soft bg-nomi-accent-soft/40',
                  )}
                  data-pending-tool-calls="true"
                  aria-label="待确认的 Agent 工具调用"
                >
                  <div className={cn('text-nomi-accent text-[12px] font-medium uppercase tracking-wider')}>
                    Agent 准备调用工具
                  </div>
                  {remaining.map((call) => (
                    <div
                      key={call.toolCallId}
                      className={cn('flex flex-col gap-2 p-2 rounded-nomi-sm bg-nomi-paper border border-nomi-line-soft')}
                      data-tool-call-id={call.toolCallId}
                    >
                      <div className={cn('text-nomi-ink text-[13px] font-medium')}>{call.toolName}</div>
                      <div className={cn('text-nomi-ink-80 text-caption')}>{summarizeToolCall(call.toolName, call.args)}</div>
                      <details className={cn('text-nomi-ink-60 text-caption')}>
                        <summary className={cn('cursor-pointer select-none')}>查看参数</summary>
                        <pre className={cn('mt-1 max-h-[160px] overflow-auto p-2 rounded-nomi-sm bg-nomi-ink-05 text-[11px] leading-[1.4] whitespace-pre-wrap break-all')}>
                          {JSON.stringify(call.args, null, 2)}
                        </pre>
                      </details>
                      <div className={cn('flex items-center justify-end gap-2 mt-1')}>
                        <WorkbenchButton
                          className={cn(
                            'h-7 px-3 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-nomi-ink-80 text-[12px] cursor-pointer',
                            'hover:bg-nomi-ink-05',
                          )}
                          onClick={() => resolvePending(call.toolCallId, { ok: false, message: 'rejected by user' })}
                        >
                          拒绝
                        </WorkbenchButton>
                        <WorkbenchButton
                          className={cn(
                            'h-7 px-3 rounded-nomi-sm border-0 bg-nomi-ink text-nomi-paper text-[12px] cursor-pointer',
                            'hover:bg-nomi-accent',
                          )}
                          onClick={() => resolvePending(call.toolCallId, { ok: true, result: { confirmed: true } })}
                        >
                          确认
                        </WorkbenchButton>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )
        })() : null}
        <div ref={threadBottomRef} aria-hidden="true" />
      </div>
      <form
        className={cn('grid gap-1 p-3 border-t border-nomi-line-soft bg-nomi-paper')}
        onSubmit={handleSubmit}
      >
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
        <AttachmentRail attachments={attachments} onRemove={removeAttachment} className={cn('mb-1')} />
        <AutoGrowTextarea
          className={cn(
            // 对齐样张 .input：带边框圆角输入盒。
            'min-h-14 px-2 py-2 rounded-nomi',
            'border border-nomi-line focus:border-nomi-accent',
            'bg-nomi-paper text-nomi-ink text-body-sm leading-[1.45]',
            'placeholder:text-nomi-ink-40',
          )}
          aria-label="给生成助手发送消息"
          placeholder="告诉我画布上想怎么搭..."
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => handleAiComposerKeyDown(event, () => {
            event.currentTarget.form?.requestSubmit()
          })}
          onPaste={handlePaste}
        />
        <div className={cn('flex items-center justify-between gap-2')}>
          <div className={cn('flex items-center gap-2 min-w-0')}>
            <WorkbenchIconButton
              type="button"
              className={cn(
                'size-7 grid place-items-center shrink-0',
                'border-0 rounded-nomi-sm bg-transparent text-nomi-ink-60 cursor-pointer',
                'hover:bg-nomi-ink-05 hover:text-nomi-ink',
                'focus-visible:outline-2 focus-visible:outline-workbench-focus focus-visible:outline-offset-2',
              )}
              label="添加附件"
              aria-label="添加附件（也可拖拽 / 粘贴）"
              onClick={openFilePicker}
              icon={<IconPaperclip size={16} />}
            />
            <NomiSelect
              ariaLabel="AI 模式"
              leadingLabel="模式"
              size="sm"
              value={mode}
              options={[
                { value: 'agent', label: 'Agent' },
                { value: 'chat', label: '问答' },
                { value: 'refine', label: '润色' },
              ]}
              onChange={(value) => setMode(value as 'agent' | 'chat' | 'refine')}
            />
            <AssistantModelPicker className="h-7" />
          </div>
          {busy ? (
            <WorkbenchIconButton
              type="button"
              onClick={() => cancelRef.current?.()}
              className={cn(
                'size-7 grid place-items-center',
                'border-0 rounded-full bg-nomi-ink text-nomi-paper cursor-pointer',
                'hover:enabled:bg-nomi-accent',
              )}
              label="停止"
              aria-label="停止生成"
              icon={<IconPlayerStopFilled size={13} />}
            />
          ) : (
            <WorkbenchIconButton
              type="submit"
              className={cn(
                'size-7 grid place-items-center',
                'border-0 rounded-full bg-nomi-ink text-nomi-paper cursor-pointer',
                'hover:enabled:bg-nomi-accent',
                'disabled:bg-nomi-ink-20 disabled:text-nomi-ink-40 disabled:cursor-not-allowed',
              )}
              disabled={!draft.trim() && !attachments.some((item) => item.status === 'ready')}
              label="发送"
              aria-label="生成 AI 发送"
              icon={<IconSend2 size={15} />}
            />
          )}
        </div>
      </form>
    </aside>
  )
}
