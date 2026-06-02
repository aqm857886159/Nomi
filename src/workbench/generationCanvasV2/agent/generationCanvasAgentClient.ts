import type { AgentsChatResponseDto } from '../../../api/server'
import { sendWorkbenchAiMessage } from '../../ai/workbenchAiClient'
import type { GenerationCanvasSnapshot, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getAgentCreatableGenerationNodeKinds } from '../model/generationNodeKinds'
import { parseGenerationCanvasAgentPlan } from './generationCanvasAgentPlan'

type SendGenerationCanvasAgentMessageInput = {
  message: string
  snapshot: GenerationCanvasSnapshot
  selectedNodes: GenerationCanvasNode[]
  mode?: 'agent' | 'chat' | 'refine'
  onContent?: (delta: string, text: string) => void
}

export type GenerationCanvasAgentResponse = {
  response: AgentsChatResponseDto
  plan?: ReturnType<typeof parseGenerationCanvasAgentPlan>
}

function stringifyForPrompt(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function buildGenerationCanvasAgentPrompt(input: SendGenerationCanvasAgentMessageInput): string {
  const creatableKinds = getAgentCreatableGenerationNodeKinds().join('|')
  const modeInstruction = input.mode === 'chat'
    ? '当前模式：问答。只回答用户问题，不要输出 generation_canvas_plan，不要创建节点。'
    : input.mode === 'refine'
      ? '当前模式：润色。只改写选中节点的提示词，输出 generation_canvas_plan 时只包含一个节点（对应选中节点），不要创建新节点。'
      : '当前模式：Agent。规划并创建待确认的画布节点。'

  return [
    '你是 Nomi 生成区右侧的 Nomi 生成 Agent。',
    '',
    modeInstruction,
    '',
    '硬约束：',
    '- 你只能规划并创建待确认的画布节点，禁止直接生成图片、视频或调用任何真实生成工具。',
    `- 你必须把用户输入拆成可编辑的 ${creatableKinds} 节点提示词；图片/视频节点默认保持 idle，由用户点击节点上的生成按钮确认后才执行。`,
    '- `semanticScene` 只用于用户明确要求从全景图/图片解析建筑、室内外空间或转 3D 场景；普通分镜、角色、关键帧不要使用它。',
    '- 如果用户要“全景图搭建 3D 场景”，优先规划 `semanticScene`；源图分析完成后再由节点按钮或工具层转换为 `scene3d`。',
    '- 如果用户提供故事、脚本或镜头段落，你应该拆成少量清晰节点，并用边表达文本依据到图片、图片到视频的关系。',
    '- 不要返回 Markdown 说明作为最终产物；必须返回一个 generation_canvas_plan 标签包裹的 JSON。',
    '',
    '返回格式（Agent/润色模式）：',
    `<generation_canvas_plan>{"action":"create_generation_canvas_nodes","summary":"...","nodes":[{"clientId":"n1","kind":"${creatableKinds}","title":"...","prompt":"...","position":{"x":160,"y":260}}],"edges":[{"sourceClientId":"n1","targetClientId":"n2"}]}</generation_canvas_plan>`,
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
  const response = input.onContent
    ? await sendWorkbenchAiMessage(request, { onContent: input.onContent })
    : await sendWorkbenchAiMessage(request)
  return {
    response,
    plan: input.mode === 'chat' ? undefined : parseGenerationCanvasAgentPlan(response.text),
  }
}
