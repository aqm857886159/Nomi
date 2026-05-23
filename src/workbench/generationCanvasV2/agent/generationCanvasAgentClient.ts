import type { AgentsChatResponseDto, AgentChatV2Session } from '../../../api/server'
import { sendWorkbenchAiMessage } from '../../ai/workbenchAiClient'
import type { GenerationCanvasSnapshot, GenerationCanvasNode, GenerationNodeKind } from '../model/generationCanvasTypes'
import { getAgentCreatableGenerationNodeKinds, getGenerationNodeDefaultTitle } from '../model/generationNodeKinds'
import { generationCanvasTools, type CreateGenerationNodeToolInput } from './generationCanvasTools'

export type ToolCallEvent = {
  toolCallId: string
  toolName: string
  args: unknown
  /** Resolve with the user's decision; main process feeds the result back to the model. */
  confirm: (decision: { ok: true; result?: unknown } | { ok: false; message?: string }) => Promise<void>
}

type SendGenerationCanvasAgentMessageInput = {
  message: string
  snapshot: GenerationCanvasSnapshot
  selectedNodes: GenerationCanvasNode[]
  mode?: 'agent' | 'chat' | 'refine'
  onContent?: (delta: string, text: string) => void
  /**
   * Called whenever the LLM issues a tool call. The caller is responsible
   * for showing UI and calling `event.confirm(...)`. If `auto` is set, the
   * client will auto-confirm or auto-execute on the user's behalf.
   */
  onToolCall?: (event: ToolCallEvent) => void
}

export type GenerationCanvasAgentResponse = {
  response: AgentsChatResponseDto
}

function stringifyForPrompt(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function buildGenerationCanvasAgentPrompt(input: SendGenerationCanvasAgentMessageInput): string {
  const creatableKinds = getAgentCreatableGenerationNodeKinds().join('|')
  const modeInstruction = input.mode === 'chat'
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
    `- create_canvas_nodes：在画布上创建一批待用户确认的节点（每个节点必须给定 clientId、kind=${creatableKinds} 之一、title、prompt、position）。`,
    '- connect_canvas_edges：把多个节点之间用引用边连起来；sourceClientId / targetClientId 引用同一轮 create_canvas_nodes 里的 clientId，或 read_canvas_state 返回的真实节点 id。',
    '- set_node_prompt：改写一个已有节点的 prompt（润色模式专用）。',
    '- delete_canvas_nodes：删除一个或多个已有节点（破坏性，需要用户确认）。',
    '',
    '硬约束：',
    '- 用户必须先在 UI 上确认你的每一次工具调用，再实际生效。',
    '- 节点创建出来默认是 idle 状态，用户会自己点生成按钮，不要假定节点会立即出图。',
    '- 节点的 prompt 字段必须是用英文写成的高质量提示词。',
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

type CreateNodesArgs = {
  summary?: string
  nodes: Array<{
    clientId: string
    kind: GenerationNodeKind
    title: string
    prompt: string
    position: { x: number; y: number }
  }>
}

type ConnectEdgesArgs = {
  edges: Array<{ sourceClientId: string; targetClientId: string }>
}

/**
 * Default tool-call executor. Translates each tool invocation into a real
 * mutation against the in-renderer `generationCanvasTools` store, and
 * returns the resulting structured data back to the LLM. This is the
 * "auto-execute" path used when the host doesn't supply its own
 * `onToolCall` handler.
 */
async function defaultExecuteToolCall(event: ToolCallEvent): Promise<void> {
  const { toolName, args, confirm } = event
  try {
    if (toolName === 'read_canvas_state') {
      const snapshot = generationCanvasTools.read_canvas()
      await confirm({ ok: true, result: snapshot })
      return
    }
    if (toolName === 'create_canvas_nodes') {
      const payload = args as CreateNodesArgs
      const inputs: CreateGenerationNodeToolInput[] = (payload.nodes || []).map((node, index) => ({
        kind: node.kind,
        title: node.title || `${getGenerationNodeDefaultTitle(node.kind)} ${index + 1}`,
        prompt: node.prompt || '',
        position: node.position || { x: 160 + index * 340, y: 260 + (index % 2) * 220 },
      }))
      const created = generationCanvasTools.create_nodes(inputs)
      const clientIdToNodeId: Record<string, string> = {}
      ;(payload.nodes || []).forEach((node, index) => {
        if (node.clientId && created[index]) clientIdToNodeId[node.clientId] = created[index].id
      })
      await confirm({
        ok: true,
        result: {
          createdNodeIds: created.map((node) => node.id),
          clientIdToNodeId,
        },
      })
      return
    }
    if (toolName === 'connect_canvas_edges') {
      const payload = args as ConnectEdgesArgs
      const edges = (payload.edges || [])
        .map((edge) => ({ source: edge.sourceClientId, target: edge.targetClientId }))
        .filter((edge) => edge.source && edge.target)
      if (edges.length > 0) generationCanvasTools.connect_nodes(edges)
      await confirm({ ok: true, result: { connectedCount: edges.length } })
      return
    }
    if (toolName === 'set_node_prompt') {
      const payload = args as { nodeId: string; prompt: string }
      const node = generationCanvasTools.update_node_prompt(payload.nodeId, payload.prompt)
      await confirm({
        ok: Boolean(node),
        ...(node ? { result: { nodeId: node.id } } : { message: 'node_not_found' }),
      })
      return
    }
    if (toolName === 'delete_canvas_nodes') {
      // Not yet implemented as a renderer-side mutation; reject gracefully so
      // the agent can adapt rather than silently no-op.
      await confirm({ ok: false, message: 'delete_canvas_nodes is not yet implemented' })
      return
    }
    await confirm({ ok: false, message: `unknown tool ${toolName}` })
  } catch (error: unknown) {
    const message = error instanceof Error && error.message ? error.message : String(error)
    await confirm({ ok: false, message })
  }
}

export async function sendGenerationCanvasAgentMessage(
  input: SendGenerationCanvasAgentMessageInput,
): Promise<GenerationCanvasAgentResponse> {
  const request = {
    prompt: buildGenerationCanvasAgentPrompt(input),
    displayPrompt: input.message,
    sessionKey: 'nomi:generation:local',
    projectId: '',
    flowId: '',
    projectName: '',
    skillKey: 'workbench.generation.canvas-planner',
    skillName: '生成区节点规划',
    mode: 'auto' as const,
  }

  let activeSession: AgentChatV2Session | null = null
  const handlers = {
    onContent: input.onContent,
    onSession: (session: AgentChatV2Session) => {
      activeSession = session
    },
    onEvent: (event: { event: string; data: Record<string, unknown> | Record<string, never> }) => {
      if (event.event === 'tool-call') {
        const data = event.data as { toolCallId: string; toolName: string; args: unknown }
        const toolCallEvent: ToolCallEvent = {
          toolCallId: data.toolCallId,
          toolName: data.toolName,
          args: data.args,
          confirm: async (decision) => {
            if (!activeSession) return
            await activeSession.confirmTool(data.toolCallId, decision)
          },
        }
        if (input.onToolCall) {
          input.onToolCall(toolCallEvent)
        } else {
          // No host UI provided — auto-execute on the renderer.
          void defaultExecuteToolCall(toolCallEvent)
        }
      }
    },
  }

  const response = await sendWorkbenchAiMessage(request, handlers)
  return { response }
}
