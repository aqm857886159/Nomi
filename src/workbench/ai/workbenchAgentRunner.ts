import type { AgentAttachmentPayload, AgentsChatResponseDto, AgentChatV2Session, AgentsChatStreamEvent } from '../../api/desktopClient'
import { sendWorkbenchAiMessage, type WorkbenchAiRequest } from './workbenchAiClient'
import { getAssistantModelPref } from './assistantModelPref'
import type { AgentChatCapability, AgentChatHistory, AgentChatToolDecision } from '../../../electron/harness/agentChatContracts'
import type {
  CapturedCanvasReadSnapshotHandleWire,
  SurfacePortBindingWire,
} from '../../../electron/shared/surfacePortBinding'

// 会话键工厂已收口到 agentSessionKey.ts（B1a）。此处 re-export 保持既有 import 路径不破
// （generationCanvasAgentClient / 两面板 / staleConversationDivider / conversationPersistence 仍从这里取）。
export { workbenchSessionKey, type WorkbenchAgentArea } from './agentSessionKey'

/**
 * One shared agent runner for both workbench panels (创作区 + 生成区).
 *
 * The backend engine (`runAgentChatV2`) is identical for both areas; only the
 * explicit capability differs. Skills only supply methods. This runner owns the common
 * plumbing: send the message, stream content back via `onContent`, and surface
 * each LLM tool call as a `ToolCallEvent` whose `confirm` callback feeds the
 * user's decision back into the IPC session so the loop can continue.
 *
 * Read tools are auto-confirmed by the caller; write/destructive tools render a
 * confirmation card and confirm only after the user approves.
 */

export type ToolCallEvent = {
  toolCallId: string
  toolName: string
  args: unknown
  /** This exact call still awaits a decision, independently of its turn's lifetime. */
  isPending: () => boolean
  /** Resolve with the user's decision; main process feeds the result back to the model.
   *  S6-0: ok 分支可带 effectiveArgs/overridesDelta(对账快照+偏好增量),透传至 proposal.approved。
   *  S6-1: ok.silent=只读直通不记 approved;false.denied=gate 拒绝走 gate.denied。
   *  S6-2: ok.proposalId=提议事务标注,approved 事件级字段。 */
  confirm: (decision: AgentChatToolDecision) => Promise<void>
}

export type RunWorkbenchAgentInput = {
  /** Full prompt handed to the model (system context is added by the backend skill). */
  prompt: string
  /** T2 token 优化:会话内稳定的静态段(身份/规则/模型清单/记忆),走 system 槽吃 vendor 前缀缓存。 */
  systemPrompt?: string
  /** Short text shown in the user's chat bubble / thread history. */
  displayPrompt: string
  capability: AgentChatCapability
  history: AgentChatHistory
  featureKey?: string
  selectedNodeIds?: readonly string[]
  /** Domain method and system prompt; never tool authority. */
  skillKey: string
  skillName: string
  projectId?: string
  /** Exact main-issued Surface captured by the domain send entry before its first await. */
  surfaceBinding?: SurfacePortBindingWire
  /** Opaque main-sealed production snapshot; mutually exclusive with live Surface. */
  capturedCanvasReadSnapshot?: CapturedCanvasReadSnapshotHandleWire
  mode?: 'auto' | 'chat'
  /** 待发附件（图片走原生多模态；文件 S4 抽文本）。 */
  attachments?: AgentAttachmentPayload[]
  onContent?: (delta: string, text: string) => void
  /**
   * Called whenever the LLM issues a tool call. The caller shows UI (or
   * auto-executes for read tools) and must invoke `event.confirm(...)`.
   */
  onToolCall?: (event: ToolCallEvent) => void | Promise<void>
  /** Expire a matching approval immediately, even if the model keeps generating. */
  onToolError?: (error: Extract<AgentsChatStreamEvent, { event: 'tool-error' }>['data']) => void
  /** Called once the backend session exists, exposing a cancel handle (user "Stop"). */
  onCancelReady?: (cancel: () => void) => void
}

export async function runWorkbenchAgent(input: RunWorkbenchAgentInput): Promise<AgentsChatResponseDto> {
  if (input.surfaceBinding && input.capturedCanvasReadSnapshot) {
    throw new Error('canvas read admission must be unique')
  }
  // 助手模型偏好（用户在助手面板选的）→ 加进 payload，后端 chooseTextModel 优先用它，
  // 否则回退「第一个可用 text 模型」。两个面板都走这里 → 自动生效，无需各自传。
  const pref = getAssistantModelPref()
  // 显式标注类型:让 TS 的 excess property check 对这个字面量生效。曾漏 systemPrompt——
  // 无标注时 request 是变量,结构化子类型允许多带字段,于是它一路传到 buildWorkbenchAiPayload
  // 被静默丢弃、typecheck 全绿。标注后任何「传了但 DTO 没声明」的字段当场编译报错。
  const request: WorkbenchAiRequest = {
    prompt: input.prompt,
    ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
    displayPrompt: input.displayPrompt,
    capability: input.capability,
    history: input.history,
    featureKey: input.featureKey,
    selectedNodeIds: input.selectedNodeIds,
    projectId: input.projectId || '',
    flowId: '',
    projectName: '',
    skillKey: input.skillKey,
    skillName: input.skillName,
    mode: input.mode || ('auto' as const),
    ...(pref ? { agentModelKey: pref.modelKey, agentVendorKey: pref.vendorKey } : {}),
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
  }

  let activeSession: AgentChatV2Session | null = null
  const pendingCalls = new Map<string, object>()
  let ended = false
  const expireAll = () => { ended = true; pendingCalls.clear() }
  const handlers = {
    onContent: input.onContent,
    onSession: (session: AgentChatV2Session) => {
      activeSession = session
      input.onCancelReady?.(() => {
        expireAll()
        void session.cancel().catch(() => {})
      })
    },
    onEvent: (event: AgentsChatStreamEvent) => {
      if (event.event === 'tool-error' || event.event === 'tool-result') {
        pendingCalls.delete(event.data.toolCallId)
        if (event.event === 'tool-error') input.onToolError?.(event.data)
        return
      }
      if (event.event === 'result' || event.event === 'done' || event.event === 'error') {
        expireAll()
        return
      }
      if (event.event !== 'tool-call' || ended) return
      const data = event.data
      const identity = {}
      pendingCalls.set(data.toolCallId, identity)
      const isPending = () => !ended && pendingCalls.get(data.toolCallId) === identity
      const confirm: ToolCallEvent['confirm'] = async (decision) => {
        if (!isPending()) throw new DOMException('Agent tool call is no longer pending', 'AbortError')
        // Claim synchronously, before IPC awaits. Local mutations run before
        // confirm; a second confirmation must never consume the same approval.
        pendingCalls.delete(data.toolCallId)
        if (!activeSession) throw new Error('Agent tool arrived without a session')
        await activeSession.confirmTool(data.toolCallId, decision)
      }
      if (!input.onToolCall) {
        void confirm({ ok: false, denied: true, message: 'This request has no tool handler' }).catch(() => {})
        return
      }
      const call: ToolCallEvent = {
        toolCallId: data.toolCallId,
        toolName: data.toolName,
        args: data.args,
        isPending,
        confirm,
      }
      const rejectFailedView = (error: unknown) => {
        // A timeout/Stop may already have settled the pending tool while its view was awaiting.
        void confirm({ ok: false, message: error instanceof Error ? error.message : String(error) }).catch(() => {})
      }
      try {
        void Promise.resolve(input.onToolCall(call)).catch(rejectFailedView)
      } catch (error) { rejectFailedView(error) }
    },
  }

  try {
    return await sendWorkbenchAiMessage(
      request,
      handlers,
      input.capturedCanvasReadSnapshot
        ? { capturedCanvasReadSnapshot: input.capturedCanvasReadSnapshot }
        : input.surfaceBinding
          ? { surfaceBinding: input.surfaceBinding }
          : {},
    )
  } finally {
    expireAll()
  }
}
