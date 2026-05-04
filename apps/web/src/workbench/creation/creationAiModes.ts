import type { CreationDocumentAction, CreationDocumentActionType, WorkbenchDocument } from '../workbenchTypes'

export type CreationAiModeId =
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
  prompt: string
}

export const CREATION_AI_MODES: CreationAiMode[] = [
  {
    id: 'story',
    label: '写故事',
    shortLabel: '故事',
    title: '故事开发',
    description: '从主题、片段或选区扩展为可拍的故事梗概。',
    prompt: [
      '你是短视频故事开发助手。基于用户输入、当前文稿和选区，产出可继续制作的视频故事方案。',
      '输出包括：核心梗、故事梗概、主角画像、核心冲突、情绪曲线、一句话卖点。',
      '保持内容具体、可视化，避免空泛方法论。',
    ].join('\n'),
  },
  {
    id: 'script',
    label: '写剧本',
    shortLabel: '剧本',
    title: '剧本创作',
    description: '按镜头、对白、OS/VO 和字幕格式生成剧本。',
    prompt: [
      '你是 AI 视频短剧编剧。把材料改写成标准剧本。',
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
      '你是 AI 视频素材规划师。基于故事或剧本拆分视觉资产。',
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
      '你是 Seedance 分镜导演。把当前故事或剧本拆成可生成视频的分镜脚本。',
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
      '你是 Seedance 2.0 提示词专家。输出可直接用于视频生成的中文时间轴提示词。',
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
      '你是 AI 视频分镜审校。检查当前文稿的问题并给出可直接修改的结果。',
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

export function appendPlainTextToWorkbenchDocument(document: WorkbenchDocument, text: string): WorkbenchDocument {
  const normalized = String(text || '').trim()
  if (!normalized) return document
  const currentJson = normalizeDocJson(document.contentJson)
  const appendedNodes = normalized.split(/\n{2,}/).map((block) => ({
    type: 'paragraph',
    content: [{ type: 'text', text: block.replace(/\n/g, ' ').trim() }],
  }))
  return {
    ...document,
    contentJson: {
      ...currentJson,
      content: [...currentJson.content, ...appendedNodes],
    },
    updatedAt: Date.now(),
  }
}

const CREATION_DOCUMENT_ACTION_TYPES: CreationDocumentActionType[] = [
  'insert_at_cursor',
  'replace_selection',
  'append_to_end',
]

function normalizeActionType(value: unknown): CreationDocumentActionType | null {
  if (CREATION_DOCUMENT_ACTION_TYPES.includes(value as CreationDocumentActionType)) return value as CreationDocumentActionType
  if (value === 'insert_cursor') return 'insert_at_cursor'
  if (value === 'append') return 'append_to_end'
  if (value === 'replace') return 'replace_selection'
  return null
}

function extractJsonCandidate(text: string): string {
  const trimmed = String(text || '').trim()
  if (!trimmed) return ''
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1)
  return ''
}

export function parseCreationDocumentAction(reply: string): CreationDocumentAction | null {
  const jsonCandidate = extractJsonCandidate(reply)
  if (!jsonCandidate) return null
  try {
    const parsed = JSON.parse(jsonCandidate) as Record<string, unknown>
    const type = normalizeActionType(parsed.type)
    const content = typeof parsed.content === 'string' ? parsed.content.trim() : ''
    if (!type || !content) return null
    return { type, content }
  } catch {
    return null
  }
}

export function createFallbackCreationDocumentAction(reply: string): CreationDocumentAction | null {
  const content = String(reply || '').trim()
  if (!content || content === '处理中...' || content.startsWith('（错误）')) return null
  return { type: 'append_to_end', content }
}

export function getCreationDocumentActionLabel(type: CreationDocumentActionType): string {
  if (type === 'insert_at_cursor') return '插入到光标'
  if (type === 'replace_selection') return '替换选区'
  return '追加到文末'
}

function normalizeDocJson(value: unknown): { type: 'doc'; content: unknown[] } {
  if (!value || typeof value !== 'object') return { type: 'doc', content: [] }
  const record = value as { type?: unknown; content?: unknown }
  return {
    type: 'doc',
    content: Array.isArray(record.content) ? record.content : [],
  }
}

export function buildCreationAiPrompt(input: {
  mode: CreationAiMode
  userRequest: string
  documentText: string
  selectedText: string
}): string {
  const request = input.userRequest.trim()
  const selectedText = input.selectedText.trim()
  const documentText = input.documentText.trim()
  return [
    input.mode.prompt,
    '',
    'documentTools 协议：',
    '- 可用工具：read_full_text、read_selection、insert_at_cursor、replace_selection、append_to_end、write_document、generate_storyboard_node、generate_asset_node。',
    '- 默认不要直接改文档；如需写入，返回 action，由用户点击应用后前端再写入。',
    '- 如果用户明确要求写入文档、插入、替换或追加，必须返回对应 action；前端不会基于用户原文猜测写入位置。',
    '- 如果需要改文档，只输出一个 JSON 对象：{"type":"insert_at_cursor|replace_selection|append_to_end","content":"..."}。',
    '- 有明确选区且任务是改写/润色时优先使用 replace_selection；要求续写或补充时使用 insert_at_cursor；整理完整结果时使用 append_to_end。',
    '- 不要输出模型内部推理链路。',
    '',
    '当前任务：',
    request || `请按“${input.mode.label}”模式处理当前材料。`,
    '',
    selectedText ? `当前选区：\n${selectedText}` : '当前选区：无',
    '',
    documentText ? `当前创作文稿：\n${documentText}` : '当前创作文稿：空',
    '',
    '输出要求：',
    '内容必须具体可用于视频创作；如果返回 JSON，content 内只放最终正文，不写使用说明。',
  ].join('\n')
}
