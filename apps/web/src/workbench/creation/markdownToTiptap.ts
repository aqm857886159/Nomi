type TiptapTextNode = {
  type: 'text'
  text: string
  marks?: Array<{ type: string }>
}

type TiptapNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: Array<TiptapNode | TiptapTextNode>
}

function textNode(text: string, marks?: Array<{ type: string }>): TiptapTextNode | null {
  if (!text) return null
  return marks?.length ? { type: 'text', text, marks } : { type: 'text', text }
}

function parseInlineMarkdown(input: string): TiptapTextNode[] {
  const nodes: TiptapTextNode[] = []
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*|_[^_]+_)/g
  let lastIndex = 0
  for (const match of input.matchAll(pattern)) {
    const index = match.index ?? 0
    const raw = match[0]
    const before = input.slice(lastIndex, index)
    const beforeNode = textNode(before)
    if (beforeNode) nodes.push(beforeNode)
    if ((raw.startsWith('**') && raw.endsWith('**')) || (raw.startsWith('__') && raw.endsWith('__'))) {
      const node = textNode(raw.slice(2, -2), [{ type: 'bold' }])
      if (node) nodes.push(node)
    } else if (raw.startsWith('`') && raw.endsWith('`')) {
      const node = textNode(raw.slice(1, -1), [{ type: 'code' }])
      if (node) nodes.push(node)
    } else if ((raw.startsWith('*') && raw.endsWith('*')) || (raw.startsWith('_') && raw.endsWith('_'))) {
      const node = textNode(raw.slice(1, -1), [{ type: 'italic' }])
      if (node) nodes.push(node)
    }
    lastIndex = index + raw.length
  }
  const restNode = textNode(input.slice(lastIndex))
  if (restNode) nodes.push(restNode)
  return nodes
}

function paragraph(text: string): TiptapNode {
  return { type: 'paragraph', content: parseInlineMarkdown(text) }
}

function listItem(text: string): TiptapNode {
  return { type: 'listItem', content: [paragraph(text)] }
}

function flushParagraph(buffer: string[], nodes: TiptapNode[]) {
  const text = buffer.join(' ').trim()
  if (text) nodes.push(paragraph(text))
  buffer.length = 0
}

export function markdownToTiptapContent(markdown: string): TiptapNode[] {
  const source = String(markdown || '').replace(/\r\n/g, '\n').trim()
  if (!source) return []
  const nodes: TiptapNode[] = []
  const paragraphBuffer: string[] = []
  const lines = source.split('\n')
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) {
      flushParagraph(paragraphBuffer, nodes)
      index += 1
      continue
    }

    if (trimmed.startsWith('```')) {
      flushParagraph(paragraphBuffer, nodes)
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index])
        index += 1
      }
      nodes.push({
        type: 'codeBlock',
        content: codeLines.length ? [{ type: 'text', text: codeLines.join('\n') }] : undefined,
      })
      index += 1
      continue
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      flushParagraph(paragraphBuffer, nodes)
      nodes.push({
        type: 'heading',
        attrs: { level: Math.min(3, headingMatch[1].length) },
        content: parseInlineMarkdown(headingMatch[2].trim()),
      })
      index += 1
      continue
    }

    const quoteMatch = trimmed.match(/^>\s?(.*)$/)
    if (quoteMatch) {
      flushParagraph(paragraphBuffer, nodes)
      const quoteLines: string[] = [quoteMatch[1]]
      index += 1
      while (index < lines.length) {
        const next = lines[index].trim()
        const nextQuote = next.match(/^>\s?(.*)$/)
        if (!nextQuote) break
        quoteLines.push(nextQuote[1])
        index += 1
      }
      nodes.push({ type: 'blockquote', content: [paragraph(quoteLines.join(' ').trim())] })
      continue
    }

    const bulletMatch = trimmed.match(/^[-*+]\s+(.+)$/)
    if (bulletMatch) {
      flushParagraph(paragraphBuffer, nodes)
      const items: TiptapNode[] = []
      while (index < lines.length) {
        const itemMatch = lines[index].trim().match(/^[-*+]\s+(.+)$/)
        if (!itemMatch) break
        items.push(listItem(itemMatch[1].trim()))
        index += 1
      }
      nodes.push({ type: 'bulletList', content: items })
      continue
    }

    const orderedMatch = trimmed.match(/^\d+[.)]\s+(.+)$/)
    if (orderedMatch) {
      flushParagraph(paragraphBuffer, nodes)
      const items: TiptapNode[] = []
      while (index < lines.length) {
        const itemMatch = lines[index].trim().match(/^\d+[.)]\s+(.+)$/)
        if (!itemMatch) break
        items.push(listItem(itemMatch[1].trim()))
        index += 1
      }
      nodes.push({ type: 'orderedList', content: items })
      continue
    }

    if (/^---+$/.test(trimmed)) {
      flushParagraph(paragraphBuffer, nodes)
      nodes.push({ type: 'horizontalRule' })
      index += 1
      continue
    }

    paragraphBuffer.push(trimmed)
    index += 1
  }

  flushParagraph(paragraphBuffer, nodes)
  return nodes
}
