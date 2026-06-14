export type WorkbenchDocument = {
  version: 1
  title: string
  contentJson: unknown
  updatedAt: number
}

const STARTER_KIT_MARK_TYPES = new Set(['bold', 'italic', 'strike', 'code'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function clonePlainRecord(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  return { ...value }
}

function normalizeMarks(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) return undefined
  const marks = value.flatMap((mark): Array<Record<string, unknown>> => {
    if (!isRecord(mark) || typeof mark.type !== 'string' || !STARTER_KIT_MARK_TYPES.has(mark.type)) return []
    const next: Record<string, unknown> = { type: mark.type }
    const attrs = clonePlainRecord(mark.attrs)
    if (attrs) next.attrs = attrs
    return [next]
  })
  return marks.length ? marks : undefined
}

function normalizeTextNode(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || value.type !== 'text' || typeof value.text !== 'string' || value.text.length === 0) {
    return null
  }
  const textNode: Record<string, unknown> = { type: 'text', text: value.text }
  const marks = normalizeMarks(value.marks)
  if (marks) textNode.marks = marks
  return textNode
}

function normalizeInlineNodes(value: unknown): Array<Record<string, unknown>> {
  if (!isRecord(value) || typeof value.type !== 'string') return []
  if (value.type === 'text') {
    const text = normalizeTextNode(value)
    return text ? [text] : []
  }
  if (value.type === 'hardBreak') return [{ type: 'hardBreak' }]
  if (!Array.isArray(value.content)) return []
  return value.content.flatMap(normalizeInlineNodes)
}

function normalizeInlineContent(value: unknown): Array<Record<string, unknown>> {
  if (!isRecord(value) || !Array.isArray(value.content)) return []
  return value.content.flatMap(normalizeInlineNodes)
}

function normalizeCodeBlockContent(value: unknown): Array<Record<string, unknown>> {
  return normalizeInlineContent(value).flatMap((node): Array<Record<string, unknown>> => (
    node.type === 'text' ? [{ type: 'text', text: node.text }] : []
  ))
}

function normalizeHeadingAttrs(value: unknown): Record<string, unknown> {
  const attrs = clonePlainRecord(value)
  const rawLevel = Number(attrs?.level)
  const level = Number.isInteger(rawLevel) && rawLevel >= 1 && rawLevel <= 6 ? rawLevel : 1
  return { ...(attrs || {}), level }
}

function normalizeListItems(value: unknown): Array<Record<string, unknown>> {
  if (!isRecord(value) || !Array.isArray(value.content)) return []
  return value.content.flatMap((child): Array<Record<string, unknown>> => {
    if (!isRecord(child) || child.type !== 'listItem') return []
    const blocks = normalizeBlockContent(child)
    return [{
      type: 'listItem',
      content: blocks.length ? blocks : [{ type: 'paragraph' }],
    }]
  })
}

function normalizeBlockNodes(value: unknown): Array<Record<string, unknown>> {
  if (!isRecord(value) || typeof value.type !== 'string') return []
  if (value.type === 'paragraph') return [{ type: 'paragraph', content: normalizeInlineContent(value) }]
  if (value.type === 'heading') {
    return [{ type: 'heading', attrs: normalizeHeadingAttrs(value.attrs), content: normalizeInlineContent(value) }]
  }
  if (value.type === 'codeBlock') return [{ type: 'codeBlock', content: normalizeCodeBlockContent(value) }]
  if (value.type === 'blockquote') {
    const content = normalizeBlockContent(value)
    return [{ type: 'blockquote', content: content.length ? content : [{ type: 'paragraph' }] }]
  }
  if (value.type === 'bulletList' || value.type === 'orderedList') {
    const content = normalizeListItems(value)
    return content.length ? [{ type: value.type, content }] : []
  }
  if (value.type === 'horizontalRule') return [{ type: 'horizontalRule' }]
  const inlineNodes = normalizeInlineNodes(value)
  return inlineNodes.length ? [{ type: 'paragraph', content: inlineNodes }] : []
}

function normalizeBlockContent(value: unknown): Array<Record<string, unknown>> {
  if (!isRecord(value) || !Array.isArray(value.content)) return []
  return value.content.flatMap(normalizeBlockNodes)
}

export function createDefaultWorkbenchContentJson(): unknown {
  return {
    type: 'doc',
    content: [],
  }
}

export function normalizeWorkbenchContentJson(value: unknown): unknown {
  if (!isRecord(value) || value.type !== 'doc') return createDefaultWorkbenchContentJson()
  return {
    type: 'doc',
    content: normalizeBlockContent(value),
  }
}

export function normalizeWorkbenchDocument(input: unknown): WorkbenchDocument {
  if (!isRecord(input)) return createDefaultWorkbenchDocument()
  return {
    version: 1,
    title: typeof input.title === 'string' ? input.title : '',
    contentJson: normalizeWorkbenchContentJson(input.contentJson),
    updatedAt: typeof input.updatedAt === 'number' && Number.isFinite(input.updatedAt) ? input.updatedAt : Date.now(),
  }
}

export type CreationDocumentTools = {
  readFullText: () => string
  readSelectionText: () => string
  insertAtCursor: (content: string) => void
  replaceSelection: (content: string) => void
  appendToEnd: (content: string) => void
}

export type PreviewAspectRatio = '16:9' | '9:16' | '1:1' | '4:5' | '3:4' | '4:3' | '21:9'

export function createDefaultWorkbenchDocument(): WorkbenchDocument {
  return {
    version: 1,
    title: '',
    contentJson: createDefaultWorkbenchContentJson(),
    updatedAt: Date.now(),
  }
}
