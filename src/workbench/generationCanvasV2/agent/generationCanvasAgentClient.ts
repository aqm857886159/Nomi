import type { AgentAttachmentPayload, AgentsChatResponseDto } from '../../../api/desktopClient'
import { runWorkbenchAgent, workbenchSessionKey, type ToolCallEvent } from '../../ai/workbenchAgentRunner'
import type { GenerationCanvasSnapshot, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getAgentCreatableGenerationNodeKinds } from '../model/generationNodeKinds'
import { applyCanvasToolCall } from './applyCanvasToolCall'
import { listAvailableModelsForAgent, formatAvailableModelsForPrompt } from './availableModels'

export type { ToolCallEvent } from '../../ai/workbenchAgentRunner'

type SendGenerationCanvasAgentMessageInput = {
  message: string
  snapshot: GenerationCanvasSnapshot
  selectedNodes: GenerationCanvasNode[]
  mode?: 'agent' | 'chat' | 'refine'
  /**
   * Optional override for which skill (system prompt + tool whitelist) the
   * agent loads. Defaults to the generation-canvas planner. The Story to
   * Storyboard demo uses `workbench.storyboard.planner`.
   */
  skill?: { key: string; name: string }
  /**
   * Optional override for the prompt builder. When set, the agent uses the
   * caller-provided prompt verbatim instead of the default canvas-planner
   * prompt. Useful when a skill already defines the full system prompt and
   * we just want to forward the user's raw story text.
   */
  buildPrompt?: (input: {
    message: string
    snapshot: GenerationCanvasSnapshot
    selectedNodes: GenerationCanvasNode[]
  }) => string
  onContent?: (delta: string, text: string) => void
  /**
   * Called whenever the LLM issues a tool call. The caller is responsible
   * for showing UI and calling `event.confirm(...)`. If `auto` is set, the
   * client will auto-confirm or auto-execute on the user's behalf.
   */
  onToolCall?: (event: ToolCallEvent) => void
  /** Exposes a cancel handle (user "Stop") once the backend session exists. */
  onCancelReady?: (cancel: () => void) => void
  /** 待发附件（图片/PDF 走原生多模态；文档抽文本）。透传给共享 runWorkbenchAgent。 */
  attachments?: AgentAttachmentPayload[]
}

export type GenerationCanvasAgentResponse = {
  response: AgentsChatResponseDto
}

function stringifyForPrompt(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function buildGenerationCanvasAgentPrompt(input: SendGenerationCanvasAgentMessageInput): string {
  const creatableKinds = getAgentCreatableGenerationNodeKinds().join('|')
  const modeInstruction =
    input.mode === 'chat'
      ? '当前模式：问答。只用自然语言回答用户问题，不要调用任何工具。'
      : input.mode === 'refine'
        ? '当前模式：润色。只能调用 set_node_prompt 改写选中节点的提示词，不要创建或删除节点。'
        : '当前模式：Agent。你应当主动调用工具来达成用户的目标。'

  return [
    '你是 Nomi 生成区右侧的 Nomi 生成 Agent。',
    '',
    modeInstruction,
    '',
    '你可以调用以下工具（详细 schema 由系统注入）：',
    '- read_canvas_state：读取当前画布所有节点和边。',
    `- create_canvas_nodes：在画布上创建一批待用户确认的节点（每个节点必须给定 clientId、kind=${creatableKinds} 之一、title、prompt、position；建议再给 modelKey + 可选 modeId + params 以指定模型和比例/清晰度等参数，取值见下方「可用模型」清单）。`,
    '- connect_canvas_edges：把多个节点之间用引用边连起来；sourceClientId / targetClientId 引用同一轮 create_canvas_nodes 里的 clientId，或 read_canvas_state 返回的真实节点 id。',
    '- set_node_prompt：改写一个已有节点的 prompt（润色模式专用）。',
    '- delete_canvas_nodes：删除一个或多个已有节点（破坏性，需要用户确认）。',
    '',
    '硬约束：',
    '- 你写进节点 prompt 字段的提示词，也要用与用户相同的语言（用户用中文就写中文提示词），不要固定用英文。',
    '- 用户必须先在 UI 上确认你的每一次工具调用，再实际生效。',
    '- 节点创建出来默认是 idle 状态，用户会自己点生成按钮，不要假定节点会立即出图。',
    '- 节点的 prompt 字段必须是高质量提示词，语言与用户保持一致。',
    '- 在调用工具之前，可以先用自然语言简短说明你的计划。',
    '',
    '当前生成画布快照：',
    stringifyForPrompt(input.snapshot),
    '',
    '当前选中节点：',
    stringifyForPrompt(input.selectedNodes),
    '',
    '用户请求：',
    input.message,
  ].join('\n')
}

/**
 * Default tool-call executor used when the host doesn't supply its own
 * `onToolCall` handler ("auto-execute" path). Delegates to the shared
 * `applyCanvasToolCall` (single source of truth) and maps the result/throw
 * onto the LLM confirmation channel.
 */
async function defaultExecuteToolCall(event: ToolCallEvent): Promise<void> {
  const { toolName, args, confirm } = event
  try {
    const result = await applyCanvasToolCall(toolName, args)
    await confirm({ ok: true, result })
  } catch (error: unknown) {
    const message = error instanceof Error && error.message ? error.message : String(error)
    await confirm({ ok: false, message })
  }
}

export async function sendGenerationCanvasAgentMessage(
  input: SendGenerationCanvasAgentMessageInput,
): Promise<GenerationCanvasAgentResponse> {
  const basePrompt = input.buildPrompt
    ? input.buildPrompt({ message: input.message, snapshot: input.snapshot, selectedNodes: input.selectedNodes })
    : buildGenerationCanvasAgentPrompt(input)
  // bug①：注入「可用模型清单」，让 agent 能为每个节点建议 modelKey/modeId/params。
  // 失败（catalog 未就绪等）不阻断对话——退回无清单的基础 prompt。
  let prompt = basePrompt
  try {
    const modelsBlock = formatAvailableModelsForPrompt(await listAvailableModelsForAgent())
    if (modelsBlock) prompt = `${basePrompt}\n\n${modelsBlock}`
  } catch {
    // 静默退回 basePrompt
  }

  const response = await runWorkbenchAgent({
    prompt,
    displayPrompt: input.message,
    sessionKey: workbenchSessionKey(),
    skillKey: input.skill?.key || 'workbench.generation.canvas-planner',
    skillName: input.skill?.name || '生成区节点规划',
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    onContent: input.onContent,
    onCancelReady: input.onCancelReady,
    onToolCall: (event) => {
      if (input.onToolCall) {
        input.onToolCall(event)
      } else {
        // No host UI provided, auto-execute on the renderer.
        void defaultExecuteToolCall(event)
      }
    },
  })

  return { response }
}
