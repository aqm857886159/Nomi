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
  const pattern = /(==[^=]+==|\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*|_[^_]+_)/g
  let lastIndex = 0
  for (const match of input.matchAll(pattern)) {
    const index = match.index ?? 0
    const raw = match[0]
    const before = input.slice(lastIndex, index)
    const beforeNode = textNode(before)
    if (beforeNode) nodes.push(beforeNode)
    if (raw.startsWith('==') && raw.endsWith('==')) {
      const node = textNode(raw.slice(2, -2), [{ type: 'highlight' }])
      if (node) nodes.push(node)
    } else if ((raw.startsWith('**') && raw.endsWith('**')) || (raw.startsWith('__') && raw.endsWith('__'))) {
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

function taskItem(text: string, checked: boolean): TiptapNode {
  return { type: 'taskItem', attrs: { checked }, content: [paragraph(text)] }
}

function flushParagraph(buffer: string[], nodes: TiptapNode[]) {
  const text = buffer.join(' ').trim()
  if (text) nodes.push(paragraph(text))
  buffer.length = 0
}

function parseTaskItems(lines: string[], start: number): { items: TiptapNode[]; next: number } {
  const items: TiptapNode[] = []
  let index = start
  while (index < lines.length) {
    const itemMatch = lines[index].trim().match(/^[-*+]\s+\[([ xX])\]\s+(.+)$/)
    if (!itemMatch) break
    items.push(taskItem(itemMatch[2].trim(), itemMatch[1].toLowerCase() === 'x'))
    index += 1
  }
  return { items, next: index }
}

// 把一行表格分隔行 `| --- | --- |` 解析成对齐标记，用于判断某列是否为表头分隔。返回列数或 null。
function parseTableDelimiter(line: string): number | null {
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
  if (cells.length === 0) return null
  if (!cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell))) return null
  return cells.length
}

function parseTableRow(line: string, isHeader: boolean): TiptapNode {
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
  return {
    type: 'tableRow',
    content: cells.map((cell) => ({
      type: isHeader ? 'tableHeader' : 'tableCell',
      content: [{ type: 'paragraph', content: parseInlineMarkdown(cell) }],
    })),
  }
}

// 尝试把以 `|` 开头的连续行解析成 GFM 表格：第一行表头 + 第二行 `---` 分隔 + 后续数据行。
// 返回 { rows, next }；若第二行不是分隔行，返回 null（让调用方按普通段落处理）。
function tryParseTable(lines: string[], start: number): { rows: TiptapNode[]; next: number } | null {
  const delimiter = start + 1 < lines.length ? parseTableDelimiter(lines[start + 1]) : null
  if (delimiter === null) return null
  const rows: TiptapNode[] = [parseTableRow(lines[start], true)]
  let index = start + 2
  while (index < lines.length) {
    const trimmed = lines[index].trim()
    if (!trimmed || !trimmed.startsWith('|')) break
    rows.push(parseTableRow(lines[index], false))
    index += 1
  }
  return { rows, next: index }
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
      // 待办列表优先于普通无序列表：`- [ ]` 是 bulletMatch 的子集，先识别成 taskList。
      const tasks = parseTaskItems(lines, index)
      if (tasks.items.length > 0) {
        nodes.push({ type: 'taskList', content: tasks.items })
        index = tasks.next
        continue
      }
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

    // GFM 表格：以 `|` 开头的行 + 第二行 `---` 分隔。
    if (trimmed.startsWith('|')) {
      flushParagraph(paragraphBuffer, nodes)
      const table = tryParseTable(lines, index)
      if (table) {
        nodes.push({ type: 'table', content: table.rows })
        index = table.next
        continue
      }
      paragraphBuffer.push(trimmed)
      index += 1
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
