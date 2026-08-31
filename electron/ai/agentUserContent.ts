// 把「文字 prompt + 待发附件」拼成 Vercel AI SDK 的 user message content。
// 纯函数（字节读取由 resolveBytes 回调注入），便于单测。
// 图片 → image part；PDF → file part（按模型能力门控）；其它文档 → 计数提示（S4 抽文本接手）。

export type AgentUserAttachment = {
  url: string
  contentType: string
  fileName: string
  kind: 'image' | 'file'
}

type TextPart = { type: 'text'; text: string }
type ImagePart = { type: 'image'; image: Uint8Array; mimeType?: string }
type FilePart = { type: 'file'; data: Uint8Array; mimeType: string }
export type AgentUserContent = string | Array<TextPart | ImagePart | FilePart>

// 已知支持图片输入（vision）的模型族。meta.supportsImageInput 显式声明优先。
const VISION_MODEL_RE =
  /gpt-4o|gpt-4\.1|gpt-4-vision|chatgpt-4o|o1|o3|o4-mini|claude-3|claude-opus-4|claude-sonnet-4|claude-haiku-4|gemini|llava|qwen.*-?vl|pixtral|internvl|minicpm-v|grok.*vision|vision/i

// 已知支持原生 PDF file part 的模型族（Anthropic claude-3.5+ / OpenAI gpt-4o,4.1,o-系 / Google gemini）。
const PDF_INPUT_MODEL_RE =
  /claude-3-5|claude-3-7|claude-opus-4|claude-sonnet-4|claude-haiku-4|gpt-4o|gpt-4\.1|o1|o3|o4-mini|gemini/i

function metaFlag(meta: unknown, key: string): boolean | undefined {
  if (meta && typeof meta === 'object') {
    const value = (meta as Record<string, unknown>)[key]
    if (typeof value === 'boolean') return value
  }
  return undefined
}

export function modelSupportsImageInput(modelKey: string, modelAlias: string | null | undefined, meta: unknown): boolean {
  const declared = metaFlag(meta, 'supportsImageInput')
  if (typeof declared === 'boolean') return declared
  return VISION_MODEL_RE.test(`${modelKey || ''} ${modelAlias || ''}`.toLowerCase())
}

export function modelSupportsPdfInput(modelKey: string, modelAlias: string | null | undefined, meta: unknown): boolean {
  const declared = metaFlag(meta, 'supportsPdfInput')
  if (typeof declared === 'boolean') return declared
  return PDF_INPUT_MODEL_RE.test(`${modelKey || ''} ${modelAlias || ''}`.toLowerCase())
}

function isPdf(attachment: AgentUserAttachment): boolean {
  return attachment.contentType.toLowerCase().includes('pdf') || attachment.fileName.toLowerCase().endsWith('.pdf')
}

export async function buildAgentUserContent(params: {
  prompt: string
  attachments?: AgentUserAttachment[]
  supportsImageInput: boolean
  supportsPdfInput: boolean
  resolveBytes: (url: string) => Uint8Array | null
  /** 文档（docx/xlsx/csv/txt/md）抽文本，注入 prompt（任何文本模型可用）。 */
  extractText: (attachment: AgentUserAttachment) => Promise<string | null>
}): Promise<AgentUserContent> {
  const { prompt, attachments = [], supportsImageInput, supportsPdfInput, resolveBytes, extractText } = params
  if (!attachments.length) return prompt

  const mediaParts: Array<ImagePart | FilePart> = []
  const docBlocks: string[] = []
  let droppedImages = 0
  let droppedPdfs = 0
  let failedDocs = 0

  for (const att of attachments) {
    if (att.kind === 'image') {
      if (!supportsImageInput) { droppedImages += 1; continue }
      const bytes = resolveBytes(att.url)
      if (!bytes) { droppedImages += 1; continue }
      mediaParts.push({ type: 'image', image: bytes, mimeType: att.contentType })
    } else if (isPdf(att)) {
      if (!supportsPdfInput) { droppedPdfs += 1; continue }
      const bytes = resolveBytes(att.url)
      if (!bytes) { droppedPdfs += 1; continue }
      mediaParts.push({ type: 'file', data: bytes, mimeType: 'application/pdf' })
    } else {
      const text = await extractText(att)
      if (text && text.trim()) docBlocks.push(`〈${att.fileName}〉\n${text.trim()}`)
      else failedDocs += 1
    }
  }

  const notes: string[] = []
  if (droppedImages > 0) {
    notes.push(`（注：${droppedImages} 张图片未发送——当前模型不支持图片输入或读取失败。可在助手里换一个支持图片的模型。）`)
  }
  if (droppedPdfs > 0) {
    notes.push(`（注：${droppedPdfs} 个 PDF 未发送——当前模型不支持 PDF 输入。可换 Claude / GPT-4o / Gemini 等模型。）`)
  }
  if (failedDocs > 0) {
    notes.push(`（注：${failedDocs} 个文档未能读取内容。）`)
  }

  const docSection = docBlocks.length > 0 ? `\n\n[附件文档内容]\n${docBlocks.join('\n\n')}` : ''
  const text = `${[prompt, ...notes].filter(Boolean).join('\n\n')}${docSection}`
  if (!mediaParts.length) return text
  return [{ type: 'text', text }, ...mediaParts]
}
