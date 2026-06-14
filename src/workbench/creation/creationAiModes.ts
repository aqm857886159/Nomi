import type { WorkbenchDocument } from '../workbenchTypes'

export type CreationAiModeId =
  | 'general'
  | 'story'
  | 'script'
  | 'assets'
  | 'storyboard'
  | 'seedance'
  | 'review'

export type CreationAiMode = {
  id: CreationAiModeId
  label: string
  shortLabel: string
  title: string
  description: string
  /**
   * 仅本模式的「专长层」：当前任务是什么 + 领域格式/方法论。
   * 身份「我是谁」、产品/流程认知、输出铁律、语言规则由后端共享的 NOMI_AGENT_IDENTITY
   * 统一注入（单一真相源），各模式不再各自声明「你是 X 助手」。
   */
  prompt: string
  /** 纯问答模式：不套创作任务框定、不注入 documentTools 写文档协议。 */
  chatOnly?: boolean
}

export const CREATION_AI_MODES: CreationAiMode[] = [
  {
    id: 'general',
    label: '通用问答',
    shortLabel: '通用',
    title: '通用助手',
    description: '像普通 AI 一样直接回答，不强制套创作模板、不写入文稿。',
    prompt: '本轮是通用问答：直接、简洁地回答用户的问题或请求。不要强行套用任何创作模板，也不要主动改写文稿。',
    chatOnly: true,
  },
  {
    id: 'story',
    label: '写故事',
    shortLabel: '故事',
    title: '故事开发',
    description: '从主题、片段或选区扩展为可拍的故事梗概。',
    prompt: [
      '本轮任务：故事开发。基于用户输入、当前文稿和选区，产出可继续制作的视频故事方案。',
      '输出包括：核心梗、故事梗概、主角画像、核心冲突、情绪曲线、一句话卖点。',
    ].join('\n'),
  },
  {
    id: 'script',
    label: '写剧本',
    shortLabel: '剧本',
    title: '剧本创作',
    description: '按镜头、对白、OS/VO 和字幕格式生成剧本。',
    prompt: [
      '本轮任务：剧本创作。把材料改写成标准剧本。',
      '剧本正文必须使用镜头格式：每个镜头以“△ ”开头，包含景别、运镜、光线、氛围、动作和声音。',
      '对白使用“角色名（情绪/OS/VO）：内容”。需要字幕时使用“【字幕：xxx】”。',
      '输出优先给可直接粘贴进创作区的剧本正文。',
    ].join('\n'),
  },
  {
    id: 'assets',
    label: '素材规划',
    shortLabel: '素材',
    title: '角色/场景/道具',
    description: '拆出角色、场景、道具，并生成生图提示词。',
    prompt: [
      '本轮任务：素材规划。基于故事或剧本拆分视觉资产。',
      '按角色 C01-C99、场景 S01-S99、道具 P01-P99 编号。',
      '每个资产输出名称、用途、视觉标记、生成提示词。所有提示词保持同一视觉风格前缀。',
      '角色必须有可区分的颜色、轮廓或配件标记。',
    ].join('\n'),
  },
  {
    id: 'storyboard',
    label: '写分镜',
    shortLabel: '分镜',
    title: '分镜脚本',
    description: '把剧本拆成 15 秒一集的时间轴分镜。',
    prompt: [
      '本轮任务：分镜脚本。把当前故事或剧本拆成可生成视频的分镜脚本。',
      '每集包含：素材上传清单、Seedance Prompt、尾帧描述。',
      '15秒分镜按 0-3秒、3-6秒、6-9秒、9-12秒、12-15秒 拆分。',
      '每段写清楚主体、动作、镜头运动、情绪、光线、转场和声音。',
    ].join('\n'),
  },
  {
    id: 'seedance',
    label: '提示词',
    shortLabel: '提示词',
    title: 'Seedance 提示词',
    description: '生成可复制到 Seedance 2.0 的最终提示词。',
    prompt: [
      '本轮任务：Seedance 2.0 提示词。输出可直接用于视频生成的时间轴提示词。',
      '格式：风格描述、15秒、画幅、整体氛围；然后按 0-3秒/3-6秒/6-9秒/9-12秒/12-15秒写画面。',
      '使用明确运镜词：推镜头、拉镜头、摇镜头、移镜头、跟镜头、环绕镜头、升降镜头、希区柯克变焦、一镜到底、手持晃动。',
      '如果是续集，保留“将@视频1延长15s”的开头，并说明 @图片/@视频 引用用途。',
      '避免过长堆砌，优先清晰可执行。',
    ].join('\n'),
  },
  {
    id: 'review',
    label: '审校优化',
    shortLabel: '审校',
    title: '连续性审校',
    description: '检查资产引用、时间轴、情绪弧和敏感风险。',
    prompt: [
      '本轮任务：连续性审校。检查当前文稿的问题并给出可直接修改的结果。',
      '重点检查：资产引用是否对应、15秒时间轴是否完整、剧集尾帧和下一集开场是否连续、镜头语言是否具体、情绪弧是否成立、提示词是否过长或可能触发敏感风险。',
      '先列问题，再给修订版。不要输出泛泛建议。',
    ].join('\n'),
  },
]

export function getCreationAiMode(modeId: unknown): CreationAiMode {
  return CREATION_AI_MODES.find((mode) => mode.id === modeId) || CREATION_AI_MODES[0]
}

export function extractWorkbenchDocumentText(document: WorkbenchDocument | null | undefined): string {
  return extractTextFromTiptapNode(document?.contentJson).trim()
}

function extractTextFromTiptapNode(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const record = node as { text?: unknown; content?: unknown }
  const ownText = typeof record.text === 'string' ? record.text : ''
  const children = Array.isArray(record.content)
    ? record.content.map(extractTextFromTiptapNode).filter(Boolean).join('\n')
    : ''
  return [ownText, children].filter(Boolean).join(ownText && children ? '\n' : '')
}

export function buildCreationAiPrompt(input: {
  mode: CreationAiMode
  userRequest: string
}): string {
  const request = input.userRequest.trim()
  // 通用问答：纯聊天，不写文档；文稿/选区如有需要由模型用 read_* 工具自取。
  if (input.mode.chatOnly) {
    return [
      input.mode.prompt,
      '',
      '需要时可调用 read_full_text 读取当前文稿、read_selection 读取选区作为上下文；本模式不要改写文档。',
      '',
      '用户问题：',
      request || '（用户未输入文字，请礼貌询问需要什么帮助）',
    ].join('\n')
  }
  return [
    input.mode.prompt,
    '',
    '工具使用规则（真实工具调用，用户会在卡片上确认每一次写入）：',
    '- 读取上下文：需要现有正文时调用 read_full_text；只针对选中片段操作时调用 read_selection。不要假设你已经知道文稿内容，先读再写。',
    '- 写入文档：改写/润色选中片段用 replace_selection；在光标处续写或补充用 insert_at_cursor；交付完整结果追加到文末用 append_to_end。',
    '- 写入工具的 content 字段只放最终正文，不要写使用说明或解释。',
    '- 只有用户明确要求写入/插入/替换/追加时才调用写入工具；否则用自然语言回答即可。',
    '',
    '当前任务：',
    request || `请按“${input.mode.label}”模式处理当前材料。`,
  ].join('\n')
}
