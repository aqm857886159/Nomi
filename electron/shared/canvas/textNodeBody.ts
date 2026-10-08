// 文本节点正文的唯一「读成文字 / 写成文档」口（渲染层与主进程共用）。
//
// 读：下游拼进提示词的、Agent 在 canvas.read 里看到的、界面上以后要显示的，都是同一个 textNodeBody() 的结果——
// 「说的 = 摆的」（铁律⑩）靠它只有一份来保证。
// 写：Agent 写正文（setNodeText）与画布拖入文本都用 tiptapDocFromPlainText 建文档，不各自拼 JSON。
export type TiptapDocShape = { type: 'doc'; content?: unknown[] }

/** 把 Tiptap 文档拍平成纯文本（数据层，不需要 editor）。块级之间用换行分隔。 */
export function docToPlainText(doc?: TiptapDocShape | null): string {
  const walk = (entry: unknown): string => {
    if (!entry || typeof entry !== 'object') return ''
    const node = entry as { text?: string; content?: unknown[] }
    if (typeof node.text === 'string') return node.text
    if (Array.isArray(node.content)) return node.content.map(walk).join('')
    return ''
  }
  if (!doc || !Array.isArray(doc.content)) return ''
  return doc.content
    .map(walk)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

/** 纯文本 → Tiptap 文档：一行一个段落。 */
export function tiptapDocFromPlainText(text: string): TiptapDocShape {
  const lines = text ? text.split(/\r?\n/) : ['']
  return {
    type: 'doc',
    content: lines.map((line) => ({
      type: 'paragraph',
      ...(line ? { content: [{ type: 'text', text: line }] } : {}),
    })),
  }
}

type TextBodySource = {
  contentJson?: TiptapDocShape | null
  result?: { text?: unknown } | null
  prompt?: unknown
}

/** 文本节点「对下游来说的正文」：文档 > 最近一次生成结果文本 > 提示词。 */
export function textNodeBody(node: TextBodySource): string {
  const docText = docToPlainText(node.contentJson)
  if (docText) return docText
  const resultText = typeof node.result?.text === 'string' ? node.result.text.trim() : ''
  if (resultText) return resultText
  return typeof node.prompt === 'string' ? node.prompt.trim() : ''
}
