import { getDesktopBridge, type DesktopBridge } from '../desktop/bridge'

export function requireDesktopRuntime(feature: string): DesktopBridge {
  const desktop = getDesktopBridge()
  if (!desktop) throw new Error(`${feature} requires the Electron desktop runtime`)
  return desktop
}

// 一条待发附件的「上线」表示（renderer→IPC→electron 透传）。bytes 不进 payload——
// 只带 nomi-local:// URL，electron 主进程按需读字节（readNomiLocalAsset）。
export type AgentAttachmentPayload = {
  url: string
  contentType: string
  fileName: string
  kind: 'image' | 'file'
}

export type AgentsChatRequestDto = {
  vendor?: string
  prompt: string
  displayPrompt?: string
  sessionKey?: string
  canvasProjectId?: string
  canvasFlowId?: string
  chatContext?: unknown
  mode?: 'chat' | 'auto' | string
  temperature?: number
  systemPrompt?: string
  attachments?: AgentAttachmentPayload[]
}

export type AgentUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** vendor 前缀缓存命中的输入 token(命中率=cached/prompt;缺省=vendor 未回报)。 */
  cachedPromptTokens?: number
}

export type AgentsChatResponseDto = {
  id?: string
  text: string
  raw?: unknown
  toolCalls?: unknown[]
  artifacts?: unknown[]
  /** Token usage for this turn (was previously buried in `raw` and dropped). */
  usage?: AgentUsage
  /** SDK 终止原因（'stop' 正常 / 'length' 达输出上限被截断 / 'tool-calls' 等）。
   *  面板据此在「有文本但 finishReason=length」时标「可能被截断」，避免把半截当完整。 */
  finishReason?: string
}

/** Coerce the SDK's loosely-typed usage object into AgentUsage (0-filled). */
export function coerceAgentUsage(raw: unknown): AgentUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const usage: AgentUsage = {
    promptTokens: num(r.promptTokens ?? r.inputTokens),
    completionTokens: num(r.completionTokens ?? r.outputTokens),
    totalTokens: num(r.totalTokens),
    ...(num(r.cachedPromptTokens) > 0 ? { cachedPromptTokens: num(r.cachedPromptTokens) } : {}),
  }
  if (!usage.totalTokens) usage.totalTokens = usage.promptTokens + usage.completionTokens
  if (!usage.promptTokens && !usage.completionTokens && !usage.totalTokens) return undefined
  return usage
}

export type AgentsChatToolStreamPayload = Record<string, unknown>

export type AgentsChatStreamEvent =
  | { event: 'initial'; data: { requestId: string; messageId?: string } }
  | { event: 'content'; data: { delta: string; text: string } }
  | { event: 'tool'; data: AgentsChatToolStreamPayload }
  | { event: 'tool-call'; data: { sessionId: string; toolCallId: string; toolName: string; args: unknown } }
  | { event: 'tool-result'; data: { toolCallId: string; toolName: string; result: unknown } }
  | { event: 'tool-error'; data: { toolCallId: string; toolName: string; message: string } }
  | { event: 'step-finish'; data: { finishReason: string } }
  | { event: 'result'; data: { response: AgentsChatResponseDto } }
  | { event: 'error'; data: { message: string; code?: string } }
  | { event: 'done'; data: { reason: 'finished' | 'error' } }

export type AgentChatV2ToolDecision =
  // S6-0 对账的「米」：effectiveArgs=合并后全量自洽快照(reconcile 逐字段比对用),
  // overridesDelta=用户改了 AI 提议的哪些字段(记忆提炼的最强偏好信号)。二者只进轨迹,
  // 不污染回喂 LLM 的 result(IPC 层只取 result.resolve)。
  // S6-1 silent=只读 allow 自动放行,不记 proposal.approved(§6.1 纯噪声不入)。
  // S6-2 proposalId=提议事务标注(approved 事件挂上它,与画布事件/txn.committed 同键可 join)。
  | { ok: true; result?: unknown; effectiveArgs?: Record<string, unknown>; overridesDelta?: Record<string, unknown>; silent?: boolean; proposalId?: string }
  // S6-1 denied=gate 判定拒绝(非用户拒),走 gate.denied 而非 proposal.rejected。
  | { ok: false; message?: string; denied?: boolean }

export type AgentChatV2Session = {
  sessionId: string
  confirmTool: (toolCallId: string, decision: AgentChatV2ToolDecision) => Promise<void>
  cancel: () => Promise<void>
}

/**
 * Real IPC-stream consumer. Subscribes to `nomi:agents:chatV2:event` and
 * relays each chunk as the existing `AgentsChatStreamEvent` shape so
 * downstream consumers (workbenchAiClient et al) keep working unchanged.
 *
 * Returns a stop function. Calling it cancels the underlying session and
 * unsubscribes the IPC listener.
 */
export async function openDesktopAgentsChatStream(
  payload: AgentsChatRequestDto,
  handlers: {
    onEvent: (event: AgentsChatStreamEvent) => void
    onOpen?: () => void
    onError?: (error: Error) => void
    onSession?: (session: AgentChatV2Session) => void
  },
): Promise<() => void> {
  const desktop = requireDesktopRuntime('agents chat')

  let aborted = false
  let streamedText = ''
  let sessionId: string | null = null
  let unsubscribe: (() => void) | null = null

  handlers.onOpen?.()
  const requestId = `desktop-${Date.now()}`
  const messageId = `message-${Date.now()}`
  handlers.onEvent({ event: 'initial', data: { requestId, messageId } })

  const stop = async (): Promise<void> => {
    if (aborted) return
    aborted = true
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
    // We just unsubscribed, so the backend's own `result`/`done` events (it
    // emits them after the AbortController fires) will be dropped. Without a
    // terminal event here the awaiting consumer (sendWorkbenchAiMessage) never
    // resolves → the panel's `sending/busy` flag is stuck true forever → the
    // Stop button never reverts and the spinner spins on. So synthesize a
    // terminal `result` (carrying whatever streamed so far) + `done` to settle
    // the whole await chain. These calls bypass the `aborted` guard because
    // they go straight to `handlers.onEvent`, not through the IPC listener.
    handlers.onEvent({
      event: 'result',
      data: {
        response: {
          id: `agent-cancelled-${Date.now()}`,
          text: streamedText || '（已停止生成）',
          raw: { cancelled: true },
          toolCalls: [],
          artifacts: [],
        },
      },
    })
    handlers.onEvent({ event: 'done', data: { reason: 'finished' } })
    if (sessionId) {
      try { await desktop.agents.cancelChatV2(sessionId) } catch { /* noop */ }
    }
  }

  try {
    const start = await desktop.agents.chatV2Start(payload)
    sessionId = start.sessionId

    unsubscribe = desktop.agents.onChatV2Event(sessionId, (rawEvent) => {
      if (aborted) return
      const evt = rawEvent as { type: string } & Record<string, unknown>
      switch (evt.type) {
        case 'content-delta': {
          const delta = String(evt.delta || '')
          if (!delta) return
          streamedText += delta
          handlers.onEvent({ event: 'content', data: { delta, text: streamedText } })
          return
        }
        case 'tool-call-pending': {
          handlers.onEvent({
            event: 'tool-call',
            data: {
              sessionId: sessionId!,
              toolCallId: String(evt.toolCallId),
              toolName: String(evt.toolName),
              args: evt.args,
            },
          })
          return
        }
        case 'tool-result': {
          handlers.onEvent({
            event: 'tool-result',
            data: {
              toolCallId: String(evt.toolCallId),
              toolName: String(evt.toolName),
              result: evt.result,
            },
          })
          return
        }
        case 'tool-error': {
          handlers.onEvent({
            event: 'tool-error',
            data: {
              toolCallId: String(evt.toolCallId),
              toolName: String(evt.toolName),
              message: String(evt.message || 'tool failed'),
            },
          })
          return
        }
        case 'step-finish': {
          handlers.onEvent({ event: 'step-finish', data: { finishReason: String(evt.finishReason || 'unknown') } })
          return
        }
        case 'result': {
          const inner = (evt.result as { id?: string; text?: string; usage?: unknown; finishReason?: string }) || {}
          const response: AgentsChatResponseDto = {
            id: typeof inner.id === 'string' ? inner.id : `agent-${Date.now()}`,
            text: typeof inner.text === 'string' ? inner.text : streamedText,
            raw: evt.result,
            toolCalls: [],
            artifacts: [],
            usage: coerceAgentUsage(inner.usage),
            ...(typeof inner.finishReason === 'string' ? { finishReason: inner.finishReason } : {}),
          }
          handlers.onEvent({ event: 'result', data: { response } })
          return
        }
        case 'error': {
          const message = String(evt.message || 'agent error')
          handlers.onError?.(new Error(message))
          handlers.onEvent({ event: 'error', data: { message } })
          return
        }
        case 'done': {
          const reason = (evt.reason === 'error' ? 'error' : 'finished') as 'finished' | 'error'
          handlers.onEvent({ event: 'done', data: { reason } })
          if (unsubscribe) {
            unsubscribe()
            unsubscribe = null
          }
          return
        }
      }
    })

    handlers.onSession?.({
      sessionId,
      confirmTool: async (toolCallId, decision) => {
        if (!sessionId) return
        await desktop.agents.confirmTool(sessionId, toolCallId, decision)
      },
      cancel: stop,
    })
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error))
    handlers.onError?.(err)
    handlers.onEvent({ event: 'error', data: { message: err.message } })
    handlers.onEvent({ event: 'done', data: { reason: 'error' } })
  }

  return () => {
    void stop()
  }
}

export type AgentsChatStreamHandlers = {
  onEvent: (event: AgentsChatStreamEvent) => void
  onOpen?: () => void
  onError?: (error: Error) => void
  onSession?: (session: AgentChatV2Session) => void
}
