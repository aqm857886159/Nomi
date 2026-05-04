import { workbenchAgentsChat, type AgentsChatResponseDto } from '../../api/server'

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

export async function sendWorkbenchAiMessage(input: WorkbenchAiRequest): Promise<AgentsChatResponseDto> {
  return workbenchAgentsChat({
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
  })
}
