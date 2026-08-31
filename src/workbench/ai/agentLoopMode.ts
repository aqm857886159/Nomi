// Agent 循环模式的显式声明（B1d）——把此前隐式的「单次 vs 多轮」约定类型化，
// 由框架据此托管清会话时机，替换各处手抄的 boilerplate。
//
// 现状两条链路：
//   · single-shot：mode:'chat'，无工具的一次性文本/多模态产出（方向候选 / 剧本初稿 / 镜级校验）。
//     铁律「每次独立=先清会话再发」原本在 3 个文件里各抄一遍；这里收进 runSingleShotAgent 一个入口。
//   · multi-turn：mode:'auto'|'agent'，带工具的多轮 loop（创作区 / 生成画布助手），会话历史跨轮累积，
//     由 runWorkbenchAgent / sendGenerationCanvasAgentMessage 承载（本文件不介入，仅声明其模式名）。

import { sendWorkbenchAiMessage } from './workbenchAiClient'
import { getAssistantModelPref } from './assistantModelPref'
import { safeClearAgentSession } from './agentSessionKey'
import type { AgentAttachmentPayload, AgentsChatResponseDto } from '../../api/desktopClient'

/** 循环模式常量（类型化声明，供入口显式标注自己是哪一种）。 */
export const AGENT_LOOP_MODE = {
  /** 单次：清会话 → 一次 chat 产出，不留历史（本文件的 runSingleShotAgent）。 */
  singleShot: 'single-shot',
  /** 多轮：带工具 loop，历史跨轮累积（runWorkbenchAgent / 生成画布 agent）。 */
  multiTurn: 'multi-turn',
} as const

export type AgentLoopMode = (typeof AGENT_LOOP_MODE)[keyof typeof AGENT_LOOP_MODE]

export type SingleShotAgentRequest = {
  /** 该单次任务的独立会话键（用 agentSessionKey.ts 的工厂产出）。 */
  sessionKey: string
  /** 完整 prompt。 */
  prompt: string
  /** 聊天气泡/线程里显示的短文本。 */
  displayPrompt: string
  projectId?: string
  skillKey: string
  skillName: string
  /** 多模态附件（如 shot-verify 喂首帧图）。 */
  attachments?: AgentAttachmentPayload[]
}

/**
 * 跑一次单次（single-shot）agent：**先清会话**（框架托管的清会话时机）→ 无工具 chat 产出。
 * 助手模型偏好自动附加。返回底层响应原样。
 *
 * 收口 3 处（方向 / 剧本 / 镜级校验）此前各自手抄的「clear → sendWorkbenchAiMessage(mode:'chat', +pref)」，
 * 行为逐字节等价（请求字段原样透传，mode 恒 'chat'，pref 与附件按原逻辑条件附加）。
 */
export async function runSingleShotAgent(request: SingleShotAgentRequest): Promise<AgentsChatResponseDto> {
  // 单次铁律：每次独立，先清会话，避免上一轮/别处上下文污染本次产出。
  await safeClearAgentSession(request.sessionKey)
  const pref = getAssistantModelPref()
  return sendWorkbenchAiMessage(
    {
      prompt: request.prompt,
      displayPrompt: request.displayPrompt,
      sessionKey: request.sessionKey,
      ...(request.projectId ? { projectId: request.projectId } : {}),
      skillKey: request.skillKey,
      skillName: request.skillName,
      mode: 'chat',
      ...(pref ? { agentModelKey: pref.modelKey, agentVendorKey: pref.vendorKey } : {}),
      ...(request.attachments?.length ? { attachments: request.attachments } : {}),
    },
    {},
  )
}
