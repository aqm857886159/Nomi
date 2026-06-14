import type { AgentAttachmentPayload, AgentsChatResponseDto, AgentChatV2Session } from '../../api/desktopClient'
import { sendWorkbenchAiMessage } from './workbenchAiClient'
import { getAssistantModelPref } from './assistantModelPref'
import { useAgentUsageStore } from './agentUsageStore'
import { readWindowUrlParam } from '../windowUrlParam'

/**
 * One shared agent runner for both workbench panels (创作区 + 生成区).
 *
 * The backend engine (`runAgentChatV2`) is identical for both areas; only the
 * tool group differs (selected by skillKey). This runner owns the common
 * plumbing: send the message, stream content back via `onContent`, and surface
 * each LLM tool call as a `ToolCallEvent` whose `confirm` callback feeds the
 * user's decision back into the IPC session so the loop can continue.
 *
 * Read tools are auto-confirmed by the caller; write/destructive tools render a
 * confirmation card and confirm only after the user approves.
 */

export type WorkbenchAgentArea = 'creation' | 'generation'

/**
 * 后端对话记忆键。会话历史(2026-06-14)起按 **area** 隔离:创作区 / 生成区各一份记忆,
 * 翻回各自的历史线程互不串台。仍按 project 隔离,不同项目不漏上下文。
 */
export function workbenchSessionKey(area: WorkbenchAgentArea): string {
  // readWindowUrlParam 兼容 prod 的 hash 路由——只读 search 段曾让打包版全部落 `local` 桶。
  const projectId = readWindowUrlParam('projectId')
  return `nomi:workbench:${projectId || 'local'}:${area}`
}

export type ToolCallEvent = {
  toolCallId: string
  toolName: string
  args: unknown
  /** Resolve with the user's decision; main process feeds the result back to the model.
   *  S6-0: ok 分支可带 effectiveArgs/overridesDelta(对账快照+偏好增量),透传至 proposal.approved。
   *  S6-1: ok.silent=只读直通不记 approved;false.denied=gate 拒绝走 gate.denied。
   *  S6-2: ok.proposalId=提议事务标注,approved 事件级字段。 */
  confirm: (decision:
    | { ok: true; result?: unknown; effectiveArgs?: Record<string, unknown>; overridesDelta?: Record<string, unknown>; silent?: boolean; proposalId?: string }
    | { ok: false; message?: string; denied?: boolean }) => Promise<void>
}

export type RunWorkbenchAgentInput = {
  /** Full prompt handed to the model (system context is added by the backend skill). */
  prompt: string
  /** T2 token 优化:会话内稳定的静态段(身份/规则/模型清单/记忆),走 system 槽吃 vendor 前缀缓存。 */
  systemPrompt?: string
  /** Short text shown in the user's chat bubble / thread history. */
  displayPrompt: string
  /** Shared backend memory key. Both areas use `nomi:workbench:<projectId|local>`. */
  sessionKey: string
  /** Selects the backend tool group + system prompt. */
  skillKey: string
  skillName: string
  projectId?: string
  mode?: 'auto'
  /** 待发附件（图片走原生多模态；文件 S4 抽文本）。 */
  attachments?: AgentAttachmentPayload[]
  onContent?: (delta: string, text: string) => void
  /**
   * Called whenever the LLM issues a tool call. The caller shows UI (or
   * auto-executes for read tools) and must invoke `event.confirm(...)`.
   */
  onToolCall?: (event: ToolCallEvent) => void
  /** Called once the backend session exists, exposing a cancel handle (user "Stop"). */
  onCancelReady?: (cancel: () => void) => void
}

export async function runWorkbenchAgent(input: RunWorkbenchAgentInput): Promise<AgentsChatResponseDto> {
  // 助手模型偏好（用户在助手面板选的）→ 加进 payload，后端 chooseTextModel 优先用它，
  // 否则回退「第一个可用 text 模型」。两个面板都走这里 → 自动生效，无需各自传。
  const pref = getAssistantModelPref()
  const request = {
    prompt: input.prompt,
    ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
    displayPrompt: input.displayPrompt,
    sessionKey: input.sessionKey,
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
  const handlers = {
    onContent: input.onContent,
    onSession: (session: AgentChatV2Session) => {
      activeSession = session
      input.onCancelReady?.(() => {
        void session.cancel()
      })
    },
    onEvent: (event: { event: string; data: Record<string, unknown> | Record<string, never> }) => {
      if (event.event !== 'tool-call') return
      const data = event.data as { toolCallId: string; toolName: string; args: unknown }
      input.onToolCall?.({
        toolCallId: data.toolCallId,
        toolName: data.toolName,
        args: data.args,
        confirm: async (decision) => {
          if (!activeSession) return
          await activeSession.confirmTool(data.toolCallId, decision)
        },
      })
    },
  }

  const response = await sendWorkbenchAiMessage(request, handlers)
  // Accumulate token usage for both panels here (single feed point) so a
  // token/cost readout can render it; previously usage was dropped (audit #8).
  useAgentUsageStore.getState().addUsage(response.usage)
  return response
}
