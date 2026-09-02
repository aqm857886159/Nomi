import type { AgentAttachmentPayload, AgentsChatResponseDto } from '../../api/desktopClient'
import { runWorkbenchAgent } from './workbenchAgentRunner'

export const AGENT_LOOP_MODE = { singleShot: 'single-shot', multiTurn: 'multi-turn' } as const
export type AgentLoopMode = (typeof AGENT_LOOP_MODE)[keyof typeof AGENT_LOOP_MODE]

export type SingleShotAgentRequest = {
  /** Attribution only; never used as a durable conversation binding. */
  featureKey: string
  prompt: string
  displayPrompt: string
  projectId?: string
  skillKey: string
  skillName: string
  attachments?: AgentAttachmentPayload[]
}

/** One step and zero tools. Ephemeral scope bypasses every persistent lifecycle
 * operation, including clear; it cannot erase an archived UI conversation. */
export async function runSingleShotAgent(request: SingleShotAgentRequest): Promise<AgentsChatResponseDto> {
  return runWorkbenchAgent({
    prompt: request.prompt,
    displayPrompt: request.displayPrompt,
    featureKey: request.featureKey,
    capability: 'single-shot',
    history: { kind: 'ephemeral' },
    ...(request.projectId ? { projectId: request.projectId } : {}),
    skillKey: request.skillKey,
    skillName: request.skillName,
    mode: 'chat',
    ...(request.attachments?.length ? { attachments: request.attachments } : {}),
  })
}
