import {
  workbenchAgentsChat,
  workbenchAgentsChatStream,
  type AgentsChatResponseDto,
  type AgentsChatStreamEvent,
} from '../../api/server'

export type WorkbenchAiRequest = {
  prompt: string
  displayPrompt: string
  sessionKey: string
  projectId?: string
  flowId?: string
  projectName?: string
  skillKey: string
  skillName: string
  mode?: 'chat' | 'auto'
}

export type WorkbenchAiStreamHandlers = {
  onContent?: (delta: string, text: string) => void
  onEvent?: (event: AgentsChatStreamEvent) => void
}

function buildWorkbenchAiPayload(input: WorkbenchAiRequest) {
  return {
    vendor: 'agents',
    prompt: input.prompt,
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
  }
}

export async function sendWorkbenchAiMessage(
  input: WorkbenchAiRequest,
  handlers?: WorkbenchAiStreamHandlers,
): Promise<AgentsChatResponseDto> {
  const payload = buildWorkbenchAiPayload(input)
  if (!handlers) {
    return workbenchAgentsChat(payload)
  }

  let streamedText = ''
  let finalResponse: AgentsChatResponseDto | null = null
  let streamError: Error | null = null
  let terminalErrored = false

  await new Promise<void>((resolve, reject) => {
    void workbenchAgentsChatStream(payload, {
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
          terminalErrored = event.data.reason === 'error'
          resolve()
        }
      },
      onError: reject,
    }).catch(reject)
  })

  if (streamError) throw streamError
  if (terminalErrored) throw new Error('agents chat stream failed')
  if (!finalResponse) throw new Error('agents chat stream ended without result')
  return finalResponse
}
