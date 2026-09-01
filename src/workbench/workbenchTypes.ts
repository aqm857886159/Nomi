export type WorkbenchDocument = {
  /** 文档稳定 id（crypto.randomUUID）。多文档侧栏据此切换/定位。 */
  id: string
  version: 1
  title: string
  contentJson: unknown
  updatedAt: number
}

import type { DocumentAnchorRef, PreconditionSet, TargetRef } from '../../electron/shared/capabilityTargeting'

/** A storyboard design belongs to one draft, while a draft may keep many designs. */
export const STORYBOARD_DESIGN_STATUSES = ['draft', 'committed', 'stale'] as const
export type StoryboardDesignStatus = typeof STORYBOARD_DESIGN_STATUSES[number]

export type StoryboardDesign = {
  id: string
  documentId: string
  title: string
  plan: import('./generationCanvas/agent/storyboardPlan').StoryboardPlan
  committed: boolean
  status: StoryboardDesignStatus
  sourceDocumentUpdatedAt: number
  createdAt: number
  updatedAt: number
}

// 行内 mark 白名单：StarterKit 基础 4 个 + 创作编辑器新增的 highlight。
// 不在名单里的 mark 读盘时丢弃，防止未知/过期 mark 污染文档结构。
const STARTER_KIT_MARK_TYPES = new Set(['bold', 'italic', 'strike', 'code', 'highlight'])

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

function normalizeTaskItems(value: unknown): Array<Record<string, unknown>> {
  if (!isRecord(value) || !Array.isArray(value.content)) return []
  return value.content.flatMap((child): Array<Record<string, unknown>> => {
    if (!isRecord(child) || child.type !== 'taskItem') return []
    const blocks = normalizeBlockContent(child)
    const checked = child.attrs && isRecord(child.attrs) ? child.attrs.checked === true : false
    return [{
      type: 'taskItem',
      attrs: { checked },
      content: blocks.length ? blocks : [{ type: 'paragraph' }],
    }]
  })
}

function normalizeTableCell(value: unknown, type: 'tableCell' | 'tableHeader'): Array<Record<string, unknown>> {
  if (!isRecord(value) || !Array.isArray(value.content)) return []
  const blocks = normalizeBlockContent(value)
  return [{ type, content: blocks.length ? blocks : [{ type: 'paragraph' }] }]
}

function normalizeTableRows(value: unknown): Array<Record<string, unknown>> {
  if (!isRecord(value) || !Array.isArray(value.content)) return []
  return value.content.flatMap((child): Array<Record<string, unknown>> => {
    if (!isRecord(child) || child.type !== 'tableRow' || !Array.isArray(child.content)) return []
    const cells = child.content.flatMap((cell) => {
      if (!isRecord(cell)) return []
      if (cell.type === 'tableCell') return normalizeTableCell(cell, 'tableCell')
      if (cell.type === 'tableHeader') return normalizeTableCell(cell, 'tableHeader')
      return []
    })
    return cells.length ? [{ type: 'tableRow', content: cells }] : []
  })
}

function normalizeTable(value: unknown): Array<Record<string, unknown>> {
  const rows = normalizeTableRows(value)
  return rows.length ? [{ type: 'table', content: rows }] : []
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
  if (value.type === 'taskList') {
    const content = normalizeTaskItems(value)
    return content.length ? [{ type: 'taskList', content }] : []
  }
  if (value.type === 'table') return normalizeTable(value)
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
    id: typeof input.id === 'string' && input.id.trim() ? input.id.trim() : mintDocumentId(),
    version: 1,
    title: typeof input.title === 'string' ? input.title : '',
    contentJson: normalizeWorkbenchContentJson(input.contentJson),
    updatedAt: typeof input.updatedAt === 'number' && Number.isFinite(input.updatedAt) ? input.updatedAt : Date.now(),
  }
}

/** 生成文档稳定 id（renderer 运行时可用；测试注入 node 环境则回退计数）。 */
export function mintDocumentId(): string {
  if (typeof globalThis.crypto !== 'undefined' && 'randomUUID' in globalThis.crypto) {
    return `doc-${globalThis.crypto.randomUUID()}`
  }
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function mintStoryboardDesignId(): string {
  if (typeof globalThis.crypto !== 'undefined' && 'randomUUID' in globalThis.crypto) {
    return `storyboard-${globalThis.crypto.randomUUID()}`
  }
  return `storyboard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export type CreationDocumentTools = {
  readFullText: () => string
  readSelectionText: () => string
  readState: () => Readonly<{ revision: number; contentHash: string; anchor: DocumentAnchorRef }>
  applyDocumentWrite: (input: Readonly<{
    operation: 'insert' | 'replace' | 'append'
    content: string
    target: TargetRef
    preconditions: PreconditionSet
  }>) => Readonly<{ applied: true; revision: number; contentHash: string }>
  insertAtCursor: (content: string) => void
  replaceSelection: (content: string) => void
  appendToEnd: (content: string) => void
}

export type PreviewAspectRatio = '16:9' | '9:16' | '1:1' | '4:5' | '3:4' | '4:3' | '21:9'

export function createDefaultWorkbenchDocument(): WorkbenchDocument {
  return {
    id: mintDocumentId(),
    version: 1,
    title: '',
    contentJson: createDefaultWorkbenchContentJson(),
    updatedAt: Date.now(),
  }
}
