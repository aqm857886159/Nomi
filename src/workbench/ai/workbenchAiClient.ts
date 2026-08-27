import {
  workbenchAgentsChatStream,
  type AgentAttachmentPayload,
  type AgentChatV2Session,
  type AgentsChatResponseDto,
  type AgentsChatStreamEvent,
} from '../../api/desktopClient'
import type { AgentChatCapability, AgentChatErrorCode, AgentChatHistory, AgentChatStatus } from '../../../electron/harness/agentChatContracts'
import { useAgentUsageStore } from './agentUsageStore'

export type WorkbenchAiRequest = {
  prompt: string
  /** 面板专长层系统提示（会话内 byte 稳定，走 system 槽吃 vendor 前缀缓存）。
   *  后端 runAgentChatV2 把它排在 NOMI_AGENT_IDENTITY 之后、skill 方法论之前。 */
  systemPrompt?: string
  displayPrompt: string
  capability: AgentChatCapability
  history: AgentChatHistory
  featureKey?: string
  selectedNodeIds?: readonly string[]
  projectId?: string
  flowId?: string
  projectName?: string
  skillKey: string
  skillName: string
  mode?: 'chat' | 'auto'
  /** 助手模型偏好（用户选的）：透传给后端 chooseTextModel 优先用。 */
  agentModelKey?: string
  agentVendorKey?: string
  /** 待发附件（图片走原生多模态；文件 S4 抽文本）。 */
  attachments?: AgentAttachmentPayload[]
}

/**
 * payload 必须覆盖的请求字段清单——单一真相源，测试据此逐项验证「真的上了 wire」。
 *
 * 类型是 Record<keyof WorkbenchAiRequest, true>，而本文件在 tsconfig.app.json 的检查范围内
 * （测试文件被 exclude 掉、不参与 typecheck，所以这道闸必须放在源码侧才有效）：
 * 往 WorkbenchAiRequest 加字段却不在这里登记 = 编译当场报错，逼你回 buildWorkbenchAiPayload 补转发。
 */
export const WORKBENCH_AI_REQUEST_FIELDS: Record<keyof WorkbenchAiRequest, true> = {
  prompt: true,
  systemPrompt: true,
  displayPrompt: true,
  capability: true,
  history: true,
  featureKey: true,
  selectedNodeIds: true,
  projectId: true,
  flowId: true,
  projectName: true,
  skillKey: true,
  skillName: true,
  mode: true,
  agentModelKey: true,
  agentVendorKey: true,
  attachments: true,
}

export type WorkbenchAiStreamHandlers = {
  onContent?: (delta: string, text: string) => void
  onEvent?: (event: AgentsChatStreamEvent) => void
  onSession?: (session: AgentChatV2Session) => void
}

export class WorkbenchAiError extends Error {
  constructor(message: string, readonly code?: AgentChatErrorCode) {
    super(message)
    this.name = 'WorkbenchAiError'
  }
}

export function buildWorkbenchAiPayload(input: WorkbenchAiRequest) {
  return {
    vendor: 'agents',
    prompt: input.prompt,
    ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
    displayPrompt: input.displayPrompt,
    capability: input.capability,
    history: input.history,
    ...(input.featureKey ? { featureKey: input.featureKey } : {}),
    ...(input.selectedNodeIds !== undefined ? { selectedNodeIds: [...input.selectedNodeIds] } : {}),
    ...(input.projectId ? { canvasProjectId: input.projectId } : {}),
    ...(input.flowId ? { canvasFlowId: input.flowId } : {}),
    chatContext: {
      ...(input.projectName ? { currentProjectName: input.projectName } : {}),
      skill: {
        key: input.skillKey,
        name: input.skillName,
      },
    },
    mode: input.mode || 'auto',
    temperature: 0.7,
    ...(input.agentModelKey ? { agentModelKey: input.agentModelKey } : {}),
    ...(input.agentVendorKey ? { agentVendorKey: input.agentVendorKey } : {}),
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
  }
}

export async function sendWorkbenchAiMessage(
  input: WorkbenchAiRequest,
  handlers: WorkbenchAiStreamHandlers,
): Promise<AgentsChatResponseDto> {
  const payload = buildWorkbenchAiPayload(input)

  let streamedText = ''
  const outcome: { response?: AgentsChatResponseDto; error?: Error } = {}
  let settled = false
  const observe = (work: () => void) => {
    try { work() } catch (error) { console.warn('Agent view observer failed', error) }
  }

  const terminalReason = await new Promise<AgentChatStatus>((resolve, reject) => {
    void workbenchAgentsChatStream(payload, {
      onSession: (session) => observe(() => handlers.onSession?.(session)),
      onEvent: (event) => {
        if (settled) return
        if (event.event === 'content') {
          const delta = String(event.data.delta || '')
          streamedText += delta
          if (delta) observe(() => handlers.onContent?.(delta, streamedText))
        } else if (event.event === 'result') {
          outcome.response = event.data.response
        } else if (event.event === 'error') {
          const message = String(event.data.message || '').trim() || 'agents chat stream failed'
          outcome.error = new WorkbenchAiError(message, event.data.code)
        } else if (event.event === 'done') {
          settled = true
          resolve(event.data.reason)
        }
        // View callbacks are observers; they cannot veto actual result/usage settlement.
        observe(() => handlers.onEvent?.(event))
      },
      onError: (error) => { outcome.error = error },
    }).catch(reject)
  })

  // Stable final consumption is counted once for all six callers, including errors and Stop.
  if (outcome.response) useAgentUsageStore.getState().addUsage(outcome.response.usage)
  if (terminalReason === 'error') throw outcome.error ?? new Error('agents chat stream failed')
  if (terminalReason !== 'cancelled' && outcome.error) throw outcome.error
  if (!outcome.response) throw new Error('agents chat stream ended without result')
  return outcome.response
}
