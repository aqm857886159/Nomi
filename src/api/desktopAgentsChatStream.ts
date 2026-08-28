import { getDesktopBridge, type DesktopBridge } from '../desktop/bridge'
import type { AgentChatAttachment, AgentChatCanvasReadAdmission, AgentChatErrorCode, AgentChatRequest, AgentChatResponse, AgentChatStartRequest, AgentChatStatus, AgentChatToolDecision, AgentChatUsage } from '../../electron/harness/agentChatContracts'

export function requireDesktopRuntime(feature: string): DesktopBridge {
  const desktop = getDesktopBridge()
  if (!desktop) throw new Error(`Desktop runtime is required for ${feature}`)
  return desktop
}
export type AgentAttachmentPayload = AgentChatAttachment
export type AgentsChatRequestDto = AgentChatRequest
export type AgentsChatResponseDto = AgentChatResponse
export type AgentUsage = AgentChatUsage
export type AgentChatV2ToolDecision = AgentChatToolDecision

/** Native Agent usage is already normalized; tolerate unknown transport input without inventing consumption. */
export function coerceAgentUsage(raw: unknown): AgentUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const rec = raw as Record<string, unknown>
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
  const promptTokens = number(rec.promptTokens)
  const completionTokens = number(rec.completionTokens)
  const cachedPromptTokens = number(rec.cachedPromptTokens)
  const totalTokens = number(rec.totalTokens) || promptTokens + completionTokens
  return { promptTokens, completionTokens, cachedPromptTokens, totalTokens }
}

export type AgentsChatToolStreamPayload = { toolName: string; action: string; stage: 'started' | 'completed' | 'warning' | 'error'; message: string; progress?: number; payload?: unknown }
export type AgentsChatStreamEvent =
  | { event: 'initial'; data: { requestId: string; messageId?: string } }
  | { event: 'content'; data: { delta: string; messageId?: string } }
  | { event: 'tool'; data: AgentsChatToolStreamPayload }
  | { event: 'tool-call'; data: { sessionId: string; toolCallId: string; toolName: string; args: unknown } }
  | { event: 'tool-result'; data: { toolCallId: string; toolName: string; result: unknown; decision?: AgentChatToolDecision } }
  | { event: 'tool-error'; data: { toolCallId: string; toolName: string; message: string; denied?: boolean; cancelled?: boolean } }
  | { event: 'step-finish'; data: { finishReason: string; usage?: AgentUsage } }
  | { event: 'result'; data: { response: AgentsChatResponseDto } }
  | { event: 'error'; data: { message: string; code?: AgentChatErrorCode } }
  | { event: 'done'; data: { reason: AgentChatStatus } }

export type AgentChatV2Session = {
  sessionId: string
  confirmTool: (toolCallId: string, decision: AgentChatToolDecision) => Promise<void>
  cancel: () => Promise<void>
}
export type AgentsChatStreamHandlers = {
  onEvent: (event: AgentsChatStreamEvent) => void
  onOpen?: () => void
  onError?: (error: Error) => void
  onSession?: (session: AgentChatV2Session) => void
}
export type AgentsChatStreamAdmission = AgentChatCanvasReadAdmission

/** Subscribe and publish cancellation synchronously; an ACK is never a stream admission gate. */
export async function openDesktopAgentsChatStream(
  payload: AgentChatRequest,
  handlers: AgentsChatStreamHandlers,
  admission: AgentsChatStreamAdmission = {},
): Promise<() => void> {
  const desktop = requireDesktopRuntime('agents chat')
  const sessionId = `agent-${globalThis.crypto.randomUUID()}`
  let settled = false
  let startDispatched = false
  let cancelRequested = false
  let cancelPromise: Promise<void> | undefined
  let unsubscribe: (() => void) | undefined

  const finish = (reason: AgentChatStatus) => {
    if (settled) return
    settled = true
    unsubscribe?.()
    unsubscribe = undefined
    handlers.onEvent({ event: 'done', data: { reason } })
  }
  const fail = (error: unknown) => {
    if (settled) return
    const actual = error instanceof Error ? error : new Error(String(error))
    handlers.onEvent({ event: 'error', data: { message: actual.message } })
    handlers.onError?.(actual)
    finish('error')
  }
  const requestCancel = () => {
    if (!startDispatched || settled) return Promise.resolve()
    return cancelPromise ??= desktop.agents.cancelChatV2(sessionId).then(() => {}, fail)
  }
  const stop = async () => {
    if (settled) return
    cancelRequested = true
    await requestCancel()
  }

  handlers.onOpen?.()
  handlers.onEvent({ event: 'initial', data: { requestId: sessionId, messageId: sessionId } })
  unsubscribe = desktop.agents.onChatV2Event(sessionId, (event) => {
    if (settled) return
    switch (event.type) {
      case 'content-delta': handlers.onEvent({ event: 'content', data: { delta: event.delta, messageId: sessionId } }); return
      case 'tool-call-pending': handlers.onEvent({ event: 'tool-call', data: { sessionId, toolCallId: event.toolCallId, toolName: event.toolName, args: event.args } }); return
      case 'tool-result': handlers.onEvent({ event: 'tool-result', data: { toolCallId: event.toolCallId, toolName: event.toolName, result: event.result, decision: event.decision } }); return
      case 'tool-error': handlers.onEvent({ event: 'tool-error', data: { toolCallId: event.toolCallId, toolName: event.toolName, message: event.message, denied: event.denied, cancelled: event.cancelled } }); return
      case 'step-finish': handlers.onEvent({ event: 'step-finish', data: { finishReason: event.finishReason, usage: event.usage } }); return
      case 'result': {
        const value = event.result
        const response: AgentChatResponse = { id: value.id, text: value.text, status: value.status,
          toolCalls: value.toolCalls, artifacts: value.artifacts, finishReason: value.finishReason,
          usage: coerceAgentUsage(value.usage) ?? { promptTokens: 0, completionTokens: 0, cachedPromptTokens: 0, totalTokens: 0 },
          ...(value.status === 'cancelled' ? { raw: { cancelled: true } as const } : {}),
        }
        handlers.onEvent({ event: 'result', data: { response } })
        return
      }
      case 'error': handlers.onEvent({ event: 'error', data: { message: event.message, ...(event.code ? { code: event.code } : {}) } }); return
      case 'done': finish(event.reason); return
      case 'warning': return // Recoverable compaction warning, not a terminal/user failure.
      case 'tool-call': return // The registered pending event is the sole host-execution notification.
    }
  })
  if (settled) { unsubscribe(); unsubscribe = undefined }
  handlers.onSession?.({ sessionId, cancel: stop, confirmTool: async (toolCallId, decision) => {
    if (settled || cancelRequested) return
    const reply = await desktop.agents.confirmTool(sessionId, toolCallId, decision)
    if (!reply.ok && !settled && !cancelRequested) throw new Error(reply.error || 'Agent confirmation rejected')
  } })
  try {
    const startRequest: AgentChatStartRequest = admission.capturedCanvasReadSnapshot
      ? { requestId: sessionId, request: payload, capturedCanvasReadSnapshot: admission.capturedCanvasReadSnapshot }
      : admission.surfaceBinding
        ? { requestId: sessionId, request: payload, surfaceBinding: admission.surfaceBinding }
        : { requestId: sessionId, request: payload }
    const starting = desktop.agents.chatV2Start(startRequest)
    startDispatched = true
    if (cancelRequested) void requestCancel()
    const ack = await starting
    if (!settled && ack.sessionId !== sessionId) fail(new Error('Agent start acknowledgement identity mismatch'))
  } catch (error) { fail(error) }
  return () => { void stop() }
}
