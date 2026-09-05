import type { AgentAttachmentPayload, AgentsChatResponseDto } from '../../../api/desktopClient'
import { runWorkbenchAgent, type RunWorkbenchAgentInput, type ToolCallEvent } from '../../ai/workbenchAgentRunner'
import type { AgentChatCapability, AgentChatHistory } from '../../../../electron/harness/agentChatContracts'
import type { CapturedCanvasReadSnapshotHandleWire } from '../../../../electron/shared/surfacePortBinding'
import type { ProjectAgentAttachmentClaim } from '../../../../electron/shared/projectAgentContracts'
import { assertTurnCanWrite } from '../../ai/agentTurnLifecycle'
import type { GenerationCanvasSnapshot, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getAgentCreatableGenerationNodeKinds } from '../model/generationNodeKinds'
import { listAvailableModelsForAgent, formatAvailableModelsForPrompt } from './availableModels'
import { formatCanvasForAgent } from './canvasPromptContext'
import { CANVAS_READ_CAPABILITY, type CanvasReadResult } from '../../../../electron/shared/agentCapabilities/canvasRead'
import {
  assertIssuedCanvasReadResult,
  captureCanvasReadResult,
} from './canvasReadResultSeal'
import { captureCurrentProjectCanvasReadSurfaceBinding } from '../../project/projectCanvasReadSurface'

export type { ToolCallEvent } from '../../ai/workbenchAgentRunner'

type SendGenerationCanvasAgentMessageBase = {
  turnId?: string
  message: string
  /** Concise user-facing transcript text when message contains runtime instructions/context. */
  displayMessage?: string
  selectedNodes: GenerationCanvasNode[]
  projectId?: string
  capability: Extract<AgentChatCapability, 'canvas-agent' | 'canvas-chat' | 'canvas-refine' | 'storyboard'>
  featureKey?: string
  canWrite: () => boolean
  mode?: 'agent' | 'chat' | 'refine'
  /**
   * Optional override for which skill (methodology, never tool authority) the
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
    snapshot: CanvasReadResult
    selectedNodeIds: readonly string[]
  }) => string
  onContent?: (delta: string, text: string) => void
  /**
   * Called whenever the LLM issues a tool call. The caller is responsible
   * for showing UI and calling `event.confirm(...)`. With no executor the
   * shared runner explicitly denies the call; it cannot grant itself authority.
   */
  onToolCall?: (event: ToolCallEvent) => void | Promise<void>
  /** A single approval can expire while the same turn continues streaming. */
  onToolError?: RunWorkbenchAgentInput['onToolError']
  /** Exposes a cancel handle (user "Stop") once the backend session exists. */
  onCancelReady?: (cancel: () => void) => void
  /** 待发附件（图片/PDF 走原生多模态；文档抽文本）。透传给共享 runWorkbenchAgent。 */
  attachments?: AgentAttachmentPayload[]
  attachmentClaims?: readonly ProjectAgentAttachmentClaim[]
}

type SendGenerationCanvasAgentMessageInput = SendGenerationCanvasAgentMessageBase & (
  | {
      /** Main-sealed production snapshot admission captured by the submit owner. */
      capturedCanvasReadSnapshot: CapturedCanvasReadSnapshotHandleWire
      /** The exact canonical object already sealed by the production submit owner. */
      snapshot: CanvasReadResult
    }
  | {
      capturedCanvasReadSnapshot?: never
      snapshot: GenerationCanvasSnapshot | CanvasReadResult
    }
)

export type GenerationCanvasAgentResponse = {
  response: AgentsChatResponseDto
}

/**
 * 静态系统段(token 优化 T2):身份/模式/工具说明/硬约束——会话内 byte 级稳定,
 * 走 systemPrompt 槽让 vendor 自动前缀缓存命中(动态画布快照在用户消息里,见下)。
 */
export function buildStaticAgentSystemPrompt(
  mode: SendGenerationCanvasAgentMessageInput['mode'],
  surface: 'generation' | 'timeline' = 'generation',
): string {
  const creatableKinds = getAgentCreatableGenerationNodeKinds().join('|')
  const modeInstruction =
    mode === 'chat'
      ? '当前模式：问答。只用自然语言回答用户问题，不要调用任何工具。'
      : mode === 'refine'
        ? '当前模式：润色。只能调用 set_node_prompt 改写选中节点的提示词，不要创建或删除节点。'
        : '当前模式：Agent。你应当主动调用工具来达成用户的目标。'

  // 身份/产品认知/语言/输出铁律由后端共享的 NOMI_AGENT_IDENTITY 注入（单一真相源）；
  // 这里只声明本面专长——生成画布或预览时间线 + 可用工具 + 硬约束。
  const surfaceInstruction = surface === 'timeline'
    ? '你现在在「预览·时间线」工作：先读取真实时间线与素材，再把用户目标拆成可审阅的剪辑计划；批准后才写入或导出。'
    : '你现在在「生成画布」工作：把用户的想法落成画布上的节点、引用边和真实生成任务。'
  return [
    'Timeline editing tools are available in Agent mode: read_timeline, inspect_timeline_range, get_media, inspect_media, search_media, inspect_source_range, read_waveform, propose_edit_plan, apply_edit_plan, undo_timeline_edit, export_timeline, inspect_export_job, verify_render, and cancel_export_job. Use project-scoped media ids returned by search_media/get_media; technical inspection and waveform reads are local and never expose file paths. Read the timeline revision first; propose before apply. Timeline apply/undo and export start/cancel require user approval; inspect_export_job and verify_render are read-only.',
    surfaceInstruction,
    '',
    modeInstruction,
    '',
    '你可以调用以下工具（详细 schema 由系统注入）：',
    `- ${CANVAS_READ_CAPABILITY.aliases.pi}：读取当前画布（紧凑行格式：id | 类型 | 标题 | 状态 | prompt 摘要，附引用边与选中）。`,
    '- propose_storyboard_plan：把一段故事规划成结构化「分镜方案」（跨镜头一致的锚 + 镜头），先给用户在创作区审阅/修改，不碰画布、不花钱（分镜规划师技能用；确认后才由系统落画布）。',
    `- create_canvas_nodes：在画布上创建一批待用户确认的节点，并用 edges 字段一并提交这些节点之间的引用边（每个节点必须给定 clientId、kind=${creatableKinds} 之一、title、prompt；建议再给 modelKey + 可选 modeId + params 以指定模型和比例/清晰度等参数，取值见下方「可用模型」清单）。`,
    '- connect_canvas_edges：仅用于给画布上已有节点补连引用边（后续编辑场景）；新计划的边必须放在 create_canvas_nodes 的 edges 字段里，不要拆成两次调用。',
    '- set_node_prompt：改写一个已有节点的 prompt（润色模式专用）。',
    '- delete_canvas_nodes：删除一个或多个已有节点（破坏性，需要用户确认）。',
    '- create_staging_reference：用 3D 灰模摆出「谁站哪·朝向谁·做什么动作·从哪个机位拍」，离屏出一张站位参考图并自动连到镜头作 composition_ref——锁死视频模型最易崩的站位/动作/身份。词表外的站位/构图用 customBlocking 自由描述（不渲图、追加进关键帧 prompt）。',
    '- create_camera_move：用 3D 相机轨迹摆出该镜的「运镜」（绕/推/拉/升降/横移/弧线/眩晕变焦），离屏渲成一段运镜小片并自动喂给镜头的视频节点作运镜参考——锁死文字描述不住的镜头运动。词表外的运镜（甩镜/手持跟拍/复合）用 customMove 自由描述（不渲小片、追加进视频 prompt）。',
    '',
    '硬约束：',
    '- 当某个镜头满足任一条件时，为它调用 create_staging_reference：① 有两个及以上角色且彼此有空间关系（面对面/一前一后/包围…）；② 有具体肢体动作（下跪/坐下/蹲/指向/拥抱…）；③ 导演指定了机位（仰拍/俯拍/侧面/顶视）。普通单人说话镜头不需要。shotClientId 要指向该镜头的「关键帧图片节点」（喂 i2v 的首帧那张），不要指向视频节点——视频模型没有构图槽，站位参考要去引导首帧关键帧、视频才会继承。',
    '- 当某个镜头有明确的运镜意图（绕/环绕/推近/拉远/升降/横移跟拍/弧线…）时，为它调用 create_camera_move；静止/锁定机位、或单人说话的固定镜头不要调。shotClientId 必须指向该镜头的「视频节点」（运镜参考喂的是 i2v 的运镜，由视频模型继承），不要指向关键帧图片节点。',
    '- 工具的 enum/词表是精确首选（确定性渲 3D 参考）；用户意图不在词表内时（如甩镜 whip-pan、手持跟拍、复合/连续运镜、「照搬这段参考片的运镜」，或词表外的站位/构图），别硬塞最近的词——用 customMove / customBlocking 自由描述（走 prompt 引导，精度略低但不会错），并在回复里诚实告知这是 prompt 引导、未渲精确参考。',
    '- 同一个计划的节点与边必须在一次 create_canvas_nodes 调用里一起提交（nodes + edges）——用户对整个计划只确认一次，拆开会造成重复审批。',
    '- 拆镜头默认建 kind=video 节点（分镜产物就是视频，与创作区主链路一致）；只有用户明确要「只要图 / 先出关键画面 / 静帧」时才建 kind=image。',
    '- 用户说「生成/做一张图/头像/视频/文案」等自然表达时，不要拒绝或要求用户改写格式：把目标落成对应的 image/video/text 节点，写入同语言的可直接生成 prompt，并沿用设置里的默认模型与参数。明确要求立即生成时，先创建并确认节点，再交给现有生成面板和费用确认，不要虚构已经生成。',
    '- 相邻镜头默认**不连**时序链：视频→视频的首尾帧接力当前未实现，连了也是裸跑；镜头连贯靠共享角色卡/场景卡参考，不靠镜头间连线。只有用户明确说「按顺序连起来 / 串成时序链」时，才把 n1→n2→n3 的引用边（mode=reference）一并写进同一次 create_canvas_nodes 的 edges 字段（不要用 connect_canvas_edges 另开一轮）。',
    '- 你写进节点 prompt 字段的提示词，也要用与用户相同的语言（用户用中文就写中文提示词），不要固定用英文。',
    '- 用户必须先在 UI 上确认你的每一次工具调用，再实际生效。',
    '- 节点创建出来默认是 idle 状态，用户会自己点生成按钮，不要假定节点会立即出图。',
    '- 节点的 prompt 字段必须是高质量提示词，语言与用户保持一致；按 create_canvas_nodes 里 prompt 字段说明的结构化骨架组织，不要写成一句流水账。',
    '- 在调用工具之前，可以先用自然语言简短说明你的计划。',
  ].join('\n')
}

/** 动态用户消息(每轮重建):紧凑画布上下文 + 模型清单 + 用户请求。
 *  模型清单必须贴着请求(实测挪进 system 前部后 modelKey 服从性掉穿,smoke 0/5)。 */
function buildGenerationCanvasUserMessage(message: string, canvas: CanvasReadResult, modelsBlock: string): string {
  return [
    '当前画布：',
    formatCanvasForAgent(canvas),
    ...(modelsBlock ? ['', modelsBlock] : []),
    '',
    '用户请求：',
    message,
  ].join('\n')
}

export async function sendGenerationCanvasAgentMessage(
  request: SendGenerationCanvasAgentMessageInput,
): Promise<GenerationCanvasAgentResponse> {
  // Everything that owns the turn is captured before catalog I/O. UI changes
  // afterwards cannot retarget its project, thread, mode or refine selection.
  let canvas: CanvasReadResult
  let selectedNodeIds: readonly string[]
  let capturedCanvasReadSnapshot: CapturedCanvasReadSnapshotHandleWire | undefined
  let surfaceBinding: ReturnType<typeof captureCurrentProjectCanvasReadSurfaceBinding> = null
  if (request.capturedCanvasReadSnapshot) {
    assertIssuedCanvasReadResult(request.snapshot)
    canvas = request.snapshot
    selectedNodeIds = Object.freeze([...canvas.selectedNodeIds])
    capturedCanvasReadSnapshot = Object.freeze({ ...request.capturedCanvasReadSnapshot })
  } else {
    selectedNodeIds = Object.freeze(request.selectedNodes.map((node) => node.id))
    canvas = captureCanvasReadResult({ ...request.snapshot, selectedNodeIds })
    surfaceBinding = captureCurrentProjectCanvasReadSurfaceBinding()
  }
  const {
    snapshot: _snapshot,
    selectedNodes: _selectedNodes,
    capturedCanvasReadSnapshot: _capturedCanvasReadSnapshot,
    ...requestWithoutCanvas
  } = request
  const input = {
    ...requestWithoutCanvas,
    skill: request.skill ? { ...request.skill } : undefined,
    attachments: request.attachments?.map((attachment) => ({ ...attachment })),
  }
  assertTurnCanWrite(input.canWrite)
  // bug①:可用模型清单——必须留在用户消息里贴着请求(见 buildGenerationCanvasUserMessage 注)。
  let modelsBlock = ''
  try {
    modelsBlock = formatAvailableModelsForPrompt(await listAvailableModelsForAgent())
  } catch { /* 静默退回无清单 */ }
  assertTurnCanWrite(input.canWrite)
  const prompt = input.buildPrompt
    ? input.buildPrompt({ message: input.message, snapshot: canvas, selectedNodeIds: canvas.selectedNodeIds })
    : buildGenerationCanvasUserMessage(input.message, canvas, modelsBlock)
  // 静态段(身份/规则)进 system,会话内 byte 稳定 → vendor 自动前缀缓存命中。
  // 项目记忆已下沉到后端 runAgentChatV2 的单一注入点(创作区/生成区共享 block),这里不再各自注入。
  const staticSystemPrompt = buildStaticAgentSystemPrompt(input.mode)

  const response = await runWorkbenchAgent({
    ...(input.turnId ? { turnId: input.turnId } : {}),
    prompt,
    ...(input.buildPrompt ? {} : { systemPrompt: staticSystemPrompt }),
    displayPrompt: input.displayMessage ?? input.message,
    capability: input.capability,
    projectId: input.projectId,
    ...(surfaceBinding ? { surfaceBinding } : {}),
    ...(capturedCanvasReadSnapshot ? { capturedCanvasReadSnapshot } : {}),
    featureKey: input.featureKey,
    selectedNodeIds,
    mode: input.mode === 'chat' ? 'chat' : 'auto',
    skillKey: input.skill?.key || 'workbench.generation.canvas-planner',
    skillName: input.skill?.name || '生成区节点规划',
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    ...(input.attachmentClaims?.length ? { attachmentClaims: input.attachmentClaims } : {}),
    onContent: input.onContent,
    onCancelReady: input.onCancelReady,
    onToolCall: input.onToolCall,
    onToolError: input.onToolError,
  })

  return { response }
}
