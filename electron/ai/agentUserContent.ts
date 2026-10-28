import { mediaKindFromContentType } from '../assets/mediaTypes'
import { builtinCatalogModelKeys } from '../catalog/seedBuiltins'
import type { Model } from '../catalog/types'
import { mentionUrlsInOrder, numberPromptReferences, projectPromptForSend } from '../shared/storyboard/promptMentions'
// 把「文字 prompt + 待发附件」拼成 Vercel AI SDK 的 user message content。
// 纯函数（字节读取由 resolveBytes 回调注入），便于单测。
// 图片 → image part（只有「不能读图」才不发）；PDF → file part（按模型能力门控）；其它文档 → 计数提示（S4 抽文本接手）。

export type AgentUserAttachment = {
  /** Main-resolved original identity; never accept renderer URLs as references. */
  assetId?: string
  url: string
  contentType: string
  fileName: string
  kind: 'image' | 'file'
}

type TextPart = { type: 'text'; text: string }
type ImagePart = { type: 'image'; image: Uint8Array; mimeType?: string }
type FilePart = { type: 'file'; data: Uint8Array; mimeType: string; fileName: string }
export type AgentUserContent = string | Array<TextPart | ImagePart | FilePart>

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

/** 这一行模型能不能读图：能 / 不能 / 不知道。 */
export type ImageInputSupport = 'supported' | 'unsupported' | 'unknown'

/**
 * 「这一行能不能读图」的唯一判据——只认声明，不按名字猜（设计卡 docs/plan/2026-10-27-vision-capability-declared.md）。
 *   · `meta.supportsImageInput` 是布尔 → 就是它（种子行由 seedBuiltins 对账写入，Antigravity 行由能力验证写入）；
 *   · 没声明、且**这一行**是内置目录种子 → 不能：内置能读图的行都已声明 true。按行的身份判，不按 vendor 判——
 *     用户在内置 vendor 下自己加的型号、兄弟连接拉来的行都不是种子行；
 *   · 其余没声明（自配、中转、本地、内置 vendor 下自加的行）→ 不知道。
 * 「不知道」由每扇门按自己的语义处理：Agent 车道照发（让真后端说话），带图选型排在能与不能之间，拆解只拒「不能」。
 * 2026-10-27 之前没声明的行一律拿名字撞一条写死的正则，撞不上就当不能：新型号和用户自起名的中转模型附图被静默丢掉。
 */
export function modelImageInputSupport(model: Pick<Model, 'vendorKey' | 'modelKey' | 'meta'>): ImageInputSupport {
  const declared = metaFlag(model.meta, 'supportsImageInput')
  if (declared !== undefined) return declared ? 'supported' : 'unsupported'
  return builtinCatalogModelKeys(model.vendorKey).has(model.modelKey) ? 'unsupported' : 'unknown'
}

export function modelSupportsPdfInput(modelKey: string, modelAlias: string | null | undefined, meta: unknown): boolean {
  const declared = metaFlag(meta, 'supportsPdfInput')
  if (typeof declared === 'boolean') return declared
  return PDF_INPUT_MODEL_RE.test(`${modelKey || ''} ${modelAlias || ''}`.toLowerCase())
}

function isPdf(attachment: AgentUserAttachment): boolean {
  return attachment.contentType.toLowerCase().includes('pdf') || attachment.fileName.toLowerCase().endsWith('.pdf')
}

function mediaReferences(attachments: readonly AgentUserAttachment[]) {
  return attachments.flatMap(attachment => {
    const kind = mediaKindFromContentType(attachment.contentType)
    return attachment.assetId && (kind === 'image' || kind === 'video' || kind === 'audio')
      ? [{attachment, url:attachment.url, kind}] : []
  })
}

/** Canonical main-resolved URLs bind each inline instruction to its exact original. */
export function projectAgentPromptForSend(prompt: string, attachments: readonly AgentUserAttachment[]): string {
  const references = numberPromptReferences(mediaReferences(attachments))
  if (mentionUrlsInOrder(prompt).some(url=>!references.some(reference=>reference.url===url))) throw new Error('project_agent_attachment_invalid')
  return projectPromptForSend(prompt,references)
}

export async function buildAgentUserContent(params: {
  prompt: string
  attachments?: AgentUserAttachment[]
  /** 由 `modelImageInputSupport` 给出；只有「不能」才不发图。 */
  imageInput: ImageInputSupport
  supportsPdfInput: boolean
  resolveBytes: (url: string) => Uint8Array | null
  /** 文档（docx/xlsx/csv/txt/md）抽文本，注入 prompt（任何文本模型可用）。 */
  extractText: (attachment: AgentUserAttachment) => Promise<string | null>
}): Promise<AgentUserContent> {
  const { prompt, attachments = [], imageInput, supportsPdfInput, resolveBytes, extractText } = params
  if (!attachments.length) return prompt

  const mediaAttachments = mediaReferences(attachments)
  const ordered = numberPromptReferences(mediaAttachments)
  const references = mediaAttachments.map(({attachment:att},index) => ({ reference:`@${ordered[index].kind}${ordered[index].index}`, assetId: att.assetId, name: att.fileName, contentType: att.contentType }))
  const referenceBlock = references.length ? `\n\n[Selected original media references]\n${JSON.stringify(references)}\nThese assetIds identify the exact user-selected originals. Reuse them as generation references when requested. Video/audio have not been watched or listened to: look_at_media reads technical facts only; do not invent their visible or audible content.` : ''
  const mediaParts: Array<ImagePart | FilePart> = []
  const docBlocks: string[] = []
  let droppedImages = 0
  let droppedPdfs = 0
  let failedDocs = 0

  for (const att of attachments) {
    if (/^(video|audio)\//.test(att.contentType)) {
      // Lane supports text/images. Preserve executable original references rather
      // than silently trying to extract an audiovisual file as a document.
      if (!att.assetId) throw new Error('project_agent_attachment_invalid')
      continue
    }
    if (att.kind === 'image') {
      // 「不知道」照发：真后端收得下就看图，拒图就走现有 Agent 错误面——不替它把图先丢了。
      if (imageInput === 'unsupported') { droppedImages += 1; continue }
      const bytes = resolveBytes(att.url)
      if (!bytes) { droppedImages += 1; continue }
      mediaParts.push({ type: 'image', image: bytes, mimeType: att.contentType })
    } else if (isPdf(att)) {
      if (!supportsPdfInput) { droppedPdfs += 1; continue }
      const bytes = resolveBytes(att.url)
      if (!bytes) { droppedPdfs += 1; continue }
      mediaParts.push({ type: 'file', data: bytes, mimeType: 'application/pdf', fileName: att.fileName })
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
  const text = `${[prompt, ...notes].filter(Boolean).join('\n\n')}${docSection}${referenceBlock}`
  if (!mediaParts.length) return text
  return [{ type: 'text', text }, ...mediaParts]
}
