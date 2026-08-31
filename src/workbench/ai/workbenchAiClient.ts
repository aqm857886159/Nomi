import {
  workbenchAgentsChatStream,
  type AgentAttachmentPayload,
  type AgentChatV2Session,
  type AgentsChatResponseDto,
  type AgentsChatStreamEvent,
} from '../../api/desktopClient'

export type WorkbenchAiRequest = {
  prompt: string
  /** 面板专长层系统提示（会话内 byte 稳定，走 system 槽吃 vendor 前缀缓存）。
   *  后端 runAgentChatV2 把它排在 NOMI_AGENT_IDENTITY 之后、skill 方法论之前。 */
  systemPrompt?: string
  displayPrompt: string
  sessionKey: string
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
  sessionKey: true,
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

export function buildWorkbenchAiPayload(input: WorkbenchAiRequest) {
  return {
    vendor: 'agents',
    prompt: input.prompt,
    ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
    displayPrompt: input.displayPrompt,
    sessionKey: input.sessionKey,
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
    ...(input.agentModelKey ? { agentModelKey: input.agentModelKey, agentVendorKey: input.agentVendorKey } : {}),
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
  }
}

export async function sendWorkbenchAiMessage(
  input: WorkbenchAiRequest,
  handlers: WorkbenchAiStreamHandlers,
): Promise<AgentsChatResponseDto> {
  const payload = buildWorkbenchAiPayload(input)

  let streamedText = ''
  let finalResponse: AgentsChatResponseDto | null = null
  let streamError: Error | null = null

  const terminalReason = await new Promise<'finished' | 'error'>((resolve, reject) => {
    void workbenchAgentsChatStream(payload, {
      onSession: handlers.onSession,
      onEvent: (event) => {
        handlers.onEvent?.(event)
        if (event.event === 'content') {
          const delta = String(event.data.delta || '')
          if (!delta) return
          streamedText += delta
          handlers.onContent?.(delta, streamedText)
          return
        }
        if (event.event === 'result') {
          finalResponse = event.data.response
          return
        }
        if (event.event === 'error') {
          const message = String(event.data.message || '').trim() || 'agents chat stream failed'
          streamError = new Error(message)
          reject(streamError)
          return
        }
        if (event.event === 'done') {
          resolve(event.data.reason)
        }
      },
      onError: reject,
    }).catch(reject)
  })

  if (streamError) throw streamError
  if (terminalReason === 'error') throw new Error('agents chat stream failed')
  if (!finalResponse) throw new Error('agents chat stream ended without result')
  return finalResponse
}
