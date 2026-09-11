import type { ProjectAgentAttachmentClaim } from '../../../electron/shared/workbenchInput'
import type { AgentAttachmentPayload, AgentsChatResponseDto } from '../../api/desktopClient'

import type { AgentContextSnapshot } from '../../../electron/shared/agentContextSnapshot'
import { LaneCommandFailure } from './lane/laneCommandFailure'
import { laneClient } from './lane/laneClient'
import { getAssistantModelPref } from './assistantModelPref'
import { useAgentUsageStore } from './agentUsageStore'

export const AGENT_LOOP_MODE = { singleShot: 'single-shot', multiTurn: 'multi-turn' } as const
export type AgentLoopMode = (typeof AGENT_LOOP_MODE)[keyof typeof AGENT_LOOP_MODE]

export type SingleShotAgentRequest = {
  featureKey: string
  prompt: string
  displayPrompt: string
  projectId?: string
  /** Only an installed skill's real key; feature attribution belongs to featureKey. */
  skillKey?: string
  systemPrompt?: string
  contextSnapshot?: AgentContextSnapshot
  attachments?: AgentAttachmentPayload[]
  attachmentClaims?: readonly ProjectAgentAttachmentClaim[]
  onCancelReady?: (cancel: () => void) => void
}

/** One isolated request. This entry never opens, clears, or borrows a user lane. */
export async function runSingleShotAgent(request: SingleShotAgentRequest): Promise<AgentsChatResponseDto> {
  if (request.attachments?.length && request.attachments.length !== request.attachmentClaims?.length) {
    throw new Error('agent_attachment_claim_required')
  }
  const requestId = `single-shot-${globalThis.crypto.randomUUID()}`
  const pref = getAssistantModelPref()
  let cancelled = false
  const pending = laneClient.singleShot({
    requestId, prompt: request.prompt, featureKey: request.featureKey,
    ...(request.projectId ? { projectId: request.projectId } : {}),
    context: {
      approvalPolicy: { mode: 'step', spend: 'confirm' },
      ...(request.skillKey === undefined ? {} : { skillKey: request.skillKey }),
      ...(pref ? { model: pref } : {}),
      ...(request.systemPrompt ? { systemPrompt: request.systemPrompt } : {}),
      ...(request.contextSnapshot ? { contextSnapshot: request.contextSnapshot } : {}),
      ...(request.attachmentClaims?.length ? { attachments: request.attachmentClaims } : {}),
    },
  })
  request.onCancelReady?.(() => {
    cancelled = true
    void laneClient.abortSingleShot(requestId)
  })
  const result = await pending
  if (!result.ok) {
    if (cancelled) throw new DOMException('Agent request cancelled', 'AbortError')
    throw new LaneCommandFailure(result.code, result.diagnostic)
  }
  if (!result.singleShot) throw new Error('agent_lane_single_shot_result_missing')
  const projection = result.singleShot
  const usage = {
    promptTokens: projection.usage.inputTokens + projection.usage.cacheReadTokens + projection.usage.cacheWriteTokens,
    completionTokens: projection.usage.outputTokens,
    cachedPromptTokens: projection.usage.cacheReadTokens,
    totalTokens: projection.usage.totalTokens,
    ...(projection.usage.reasoningTokens.state === 'known' ? { reasoningTokens: projection.usage.reasoningTokens.value } : {}),
    ...(projection.usage.cost.state === 'known' ? { costUsd: projection.usage.cost.value } : {}),
  }
  useAgentUsageStore.getState().addUsage(usage)
  const failure = projection.parts.find((part) => part.kind === 'error')
  if (failure?.kind === 'error') throw new Error(failure.text)
  if (projection.parts.some((part) => part.kind === 'tool-call')) throw new Error('single_shot_tools_disabled')
  return {
    id: requestId, status: cancelled ? 'cancelled' : 'finished',
    text: projection.parts.flatMap((part) => part.kind === 'assistant-text' ? [part.text] : []).join(''),
    toolCalls: [], artifacts: [], usage, finishReason: cancelled ? 'aborted' : 'stop',
    ...(cancelled ? { raw: { cancelled: true as const } } : {}),
  }
}
