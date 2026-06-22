import type { AgentAttachmentPayload, AgentsChatResponseDto } from '../../../api/desktopClient'
import { runWorkbenchAgent, workbenchSessionKey, type ToolCallEvent } from '../../ai/workbenchAgentRunner'
import type { GenerationCanvasSnapshot, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getAgentCreatableGenerationNodeKinds } from '../model/generationNodeKinds'
import { applyCanvasToolCall } from './applyCanvasToolCall'
import { evaluateGate } from './gate'
import { buildLockGateContext } from './lockGateContext'
import { listAvailableModelsForAgent, formatAvailableModelsForPrompt } from './availableModels'
import { formatCanvasForAgent } from './canvasPromptContext'

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

/**
 * 静态系统段(token 优化 T2):身份/模式/工具说明/硬约束——会话内 byte 级稳定,
 * 走 systemPrompt 槽让 vendor 自动前缀缓存命中(动态画布快照在用户消息里,见下)。
 */
function buildStaticAgentSystemPrompt(mode: SendGenerationCanvasAgentMessageInput['mode']): string {
  const creatableKinds = getAgentCreatableGenerationNodeKinds().join('|')
  const modeInstruction =
    mode === 'chat'
      ? '当前模式：问答。只用自然语言回答用户问题，不要调用任何工具。'
      : mode === 'refine'
        ? '当前模式：润色。只能调用 set_node_prompt 改写选中节点的提示词，不要创建或删除节点。'
        : '当前模式：Agent。你应当主动调用工具来达成用户的目标。'

  // 身份/产品认知/语言/输出铁律由后端共享的 NOMI_AGENT_IDENTITY 注入（单一真相源）；
  // 这里只声明本面专长——「你在生成画布工作」+ 可用工具 + 硬约束。
  return [
    '你现在在「生成画布」工作：把用户的想法落成画布上的节点、引用边和真实生成任务。',
    '',
    modeInstruction,
    '',
    '你可以调用以下工具（详细 schema 由系统注入）：',
    '- read_canvas_state：读取当前画布（紧凑行格式：id | 类型 | 标题 | 状态 | prompt 摘要，附引用边与选中）。',
    '- propose_storyboard_plan：把一段故事规划成结构化「分镜方案」（跨镜头一致的锚 + 镜头），先给用户在创作区审阅/修改，不碰画布、不花钱（分镜规划师技能用；确认后才由系统落画布）。',
    `- create_canvas_nodes：在画布上创建一批待用户确认的节点，并用 edges 字段一并提交这些节点之间的引用边（每个节点必须给定 clientId、kind=${creatableKinds} 之一、title、prompt；建议再给 modelKey + 可选 modeId + params 以指定模型和比例/清晰度等参数，取值见下方「可用模型」清单）。`,
    '- connect_canvas_edges：仅用于给画布上已有节点补连引用边（后续编辑场景）；新计划的边必须放在 create_canvas_nodes 的 edges 字段里，不要拆成两次调用。',
    '- run_generation_batch：为已有节点启动真实生成（花费额度，用户必须确认）。nodeIds 用画布上下文里的真实 id 或本轮 create 的 clientId；系统按依赖波次调度（参考先生成）。返回受理回执，生成进度用户在画布上看。',
    '- set_node_prompt：改写一个已有节点的 prompt（润色模式专用）。',
    '- delete_canvas_nodes：删除一个或多个已有节点（破坏性，需要用户确认）。',
    '- create_staging_reference：用 3D 灰模摆出「谁站哪·朝向谁·做什么动作·从哪个机位拍」，离屏出一张站位参考图并自动连到镜头作 composition_ref——锁死视频模型最易崩的站位/动作/身份。词表外的站位/构图用 customBlocking 自由描述（不渲图、追加进关键帧 prompt）。',
    '- create_camera_move：用 3D 相机轨迹摆出该镜的「运镜」（绕/推/拉/升降/横移/弧线），离屏渲成一段运镜小片并自动喂给镜头的视频节点作运镜参考——锁死文字描述不住的镜头运动。词表外的运镜（眩晕变焦/甩镜/复合）用 customMove 自由描述（不渲小片、追加进视频 prompt）。',
    '',
    '硬约束：',
    '- 当某个镜头满足任一条件时，为它调用 create_staging_reference：① 有两个及以上角色且彼此有空间关系（面对面/一前一后/包围…）；② 有具体肢体动作（下跪/坐下/蹲/指向/拥抱…）；③ 导演指定了机位（仰拍/俯拍/侧面/顶视）。普通单人说话镜头不需要。shotClientId 要指向该镜头的「关键帧图片节点」（喂 i2v 的首帧那张），不要指向视频节点——视频模型没有构图槽，站位参考要去引导首帧关键帧、视频才会继承。',
    '- 当某个镜头有明确的运镜意图（绕/环绕/推近/拉远/升降/横移跟拍/弧线…）时，为它调用 create_camera_move；静止/锁定机位、或单人说话的固定镜头不要调。shotClientId 必须指向该镜头的「视频节点」（运镜参考喂的是 i2v 的运镜，由视频模型继承），不要指向关键帧图片节点。',
    '- 工具的 enum/词表是精确首选（确定性渲 3D 参考）；用户意图不在词表内时（如眩晕变焦 dolly-zoom、甩镜 whip-pan、复合/连续运镜、「照搬这段参考片的运镜」，或词表外的站位/构图），别硬塞最近的词——用 customMove / customBlocking 自由描述（走 prompt 引导，精度略低但不会错），并在回复里诚实告知这是 prompt 引导、未渲精确参考。',
    '- 同一个计划的节点与边必须在一次 create_canvas_nodes 调用里一起提交（nodes + edges）——用户对整个计划只确认一次，拆开会造成重复审批。',
    '- 拆镜头默认建 kind=video 节点（分镜产物就是视频，与创作区主链路一致）；只有用户明确要「只要图 / 先出关键画面 / 静帧」时才建 kind=image。',
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
function buildGenerationCanvasUserMessage(input: SendGenerationCanvasAgentMessageInput, modelsBlock: string): string {
  return [
    '当前画布：',
    formatCanvasForAgent(input.snapshot, input.selectedNodes),
    ...(modelsBlock ? ['', modelsBlock] : []),
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
  // S6-1/S6-2:auto 路径同样过 gate(此前完全绕过)——只读直通 silent;写操作代用户点头,
  // 但仍走提议事务(proposalId 贯穿、txn 事件入账,与面板路径同一台账)。
  const decision = evaluateGate({ kind: 'tool-call', toolName, args }, buildLockGateContext())
  if (decision.outcome === 'deny') {
    await confirm({ ok: false, message: decision.reason, denied: true })
    return
  }
  if (decision.outcome === 'allow') {
    try {
      const result = await applyCanvasToolCall(toolName, args)
      await confirm({ ok: true, result, silent: true })
    } catch (error: unknown) {
      const message = error instanceof Error && error.message ? error.message : String(error)
      await confirm({ ok: false, message })
    }
    return
  }
  // 付费守卫（红队洞 5）：ask（costy/写）绝不在「无 onToolCall」的 auto 路径静默放行——
  // 否则谁忘传 onToolCall 就是一条 AI 静默烧钱的雷。这里直接拒绝，要求走真人确认 UI（生产面板）。
  await confirm({
    ok: false,
    denied: true,
    message: '该操作需用户在确认面板批准后才能执行（自动放行路径已禁用）',
  })
}

export async function sendGenerationCanvasAgentMessage(
  input: SendGenerationCanvasAgentMessageInput,
): Promise<GenerationCanvasAgentResponse> {
  // bug①:可用模型清单——必须留在用户消息里贴着请求(见 buildGenerationCanvasUserMessage 注)。
  let modelsBlock = ''
  try {
    modelsBlock = formatAvailableModelsForPrompt(await listAvailableModelsForAgent())
  } catch { /* 静默退回无清单 */ }
  const prompt = input.buildPrompt
    ? input.buildPrompt({ message: input.message, snapshot: input.snapshot, selectedNodes: input.selectedNodes })
    : buildGenerationCanvasUserMessage(input, modelsBlock)
  // 静态段(身份/规则)进 system,会话内 byte 稳定 → vendor 自动前缀缓存命中。
  // 项目记忆已下沉到后端 runAgentChatV2 的单一注入点(创作区/生成区共享 block),这里不再各自注入。
  const staticSystemPrompt = buildStaticAgentSystemPrompt(input.mode)

  const response = await runWorkbenchAgent({
    prompt,
    ...(input.buildPrompt ? {} : { systemPrompt: staticSystemPrompt }),
    displayPrompt: input.message,
    sessionKey: workbenchSessionKey('generation'),
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
