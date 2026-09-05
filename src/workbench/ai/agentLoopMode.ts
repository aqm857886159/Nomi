import type { AgentAttachmentPayload, AgentsChatResponseDto } from '../../api/desktopClient'
import type { ProjectAgentAttachmentClaim } from '../../../electron/shared/projectAgentContracts'
import { getAssistantModelPref } from './assistantModelPref'
import { projectAgentClient } from './projectAgentClient'
import { projectAgentProjectionStore } from './projectAgentProjectionStore'

export const AGENT_LOOP_MODE = { singleShot: 'single-shot', multiTurn: 'multi-turn' } as const
export type AgentLoopMode = (typeof AGENT_LOOP_MODE)[keyof typeof AGENT_LOOP_MODE]

const EMPTY_SINGLE_SHOT_USAGE = Object.freeze({
  promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedPromptTokens: 0,
}) as unknown as AgentsChatResponseDto['usage']

export type SingleShotAgentRequest = {
  /** Attribution only; never used as a durable conversation binding. */
  featureKey: string
  prompt: string
  displayPrompt: string
  projectId?: string
  skillKey: string
  skillName: string
  attachments?: AgentAttachmentPayload[]
  /** Main-resolved asset identities for ephemeral multimodal requests. */
  attachmentClaims?: readonly ProjectAgentAttachmentClaim[]
}

/**
 * One step and zero tools, and **no trace in the user's project conversation**.
 *
 * 2026-09-05：这类调用（判官 / 方向规划）以前和用户正常聊天走同一条 Host 回合流水线，于是机器提示词
 * 「你是资深影视分镜审片…」作为 user item 落在用户的活动线程上——面板照原样渲染，还会变成下一轮
 * 对话的 prior 上下文。现在走 Host 的临时执行路：同一套运行时、同一套附件 claim 准入，
 * 但不排队、不落账本、不写快照（盘上 hostRevision 前后不变）。
 * Host 侧对称 fail-closed：single-shot 若又被当成 Host 回合排进来会被直接拒绝。
 */
export async function runSingleShotAgent(request: SingleShotAgentRequest): Promise<AgentsChatResponseDto> {
  const snapshot = projectAgentProjectionStore.getState().snapshot
  const subscriptionId = projectAgentProjectionStore.getState().subscriptionId
  if (!snapshot || !subscriptionId) throw new Error('project_agent_unavailable')
  if (request.projectId && request.projectId !== snapshot.binding.projectId) throw new Error('project_binding_stale')
  const pref = getAssistantModelPref()
  const response = await projectAgentClient.runEphemeral(
    subscriptionId,
    {
      prompt: request.prompt,
      displayPrompt: request.displayPrompt,
      capability: 'single-shot',
      history: { kind: 'ephemeral' },
      featureKey: request.featureKey,
      projectId: snapshot.binding.projectId,
      skillKey: request.skillKey,
      skillName: request.skillName,
      chatContext: { skill: { key: request.skillKey, name: request.skillName } },
      mode: 'chat',
      ...(pref ? { agentModelKey: pref.modelKey, agentVendorKey: pref.vendorKey } : {}),
      ...(request.attachments?.length ? { attachments: request.attachments.map((item) => ({ ...item })) } : {}),
    },
    request.attachmentClaims ?? [],
  )
  return {
    id: `single-shot-${globalThis.crypto.randomUUID()}`,
    status: 'finished',
    text: response.text,
    toolCalls: [],
    artifacts: [],
    usage: (response.usage as AgentsChatResponseDto['usage']) ?? EMPTY_SINGLE_SHOT_USAGE,
    finishReason: 'stop',
  }
}
