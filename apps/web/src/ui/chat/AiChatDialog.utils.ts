import type { Node } from '@xyflow/react'
import { normalizeStoryboardSelectionContext, type StoryboardSelectionContext } from '@tapcanvas/storyboard-selection-protocol'
import type { ChatMessage, ChatTodoItem } from './AiChatDialog.types'

const AUTO_SCROLL_BOTTOM_THRESHOLD_MIN_PX = 72
const AUTO_SCROLL_BOTTOM_THRESHOLD_MAX_PX = 160
const AUTO_SCROLL_BOTTOM_THRESHOLD_RATIO = 0.18
const SELECTED_NODE_TEXT_PREVIEW_MAX_CHARS = 1200

export function formatNowTime(): string {
  try {
    const d = new Date()
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  } catch {
    return ''
  }
}

export function formatMessageTime(input: string): string {
  const raw = String(input || '').trim()
  if (!raw) return formatNowTime()
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return formatNowTime()
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

export function clipChatPreview(value: string, maxChars: number): string {
  const normalized = String(value || '').trim()
  if (!normalized) return ''
  if (normalized.length <= maxChars) return normalized
  if (maxChars <= 1) return normalized.slice(0, maxChars)
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readNodeDataRecord(node: Node | null | undefined): Record<string, unknown> {
  return asRecord(node?.data) ?? {}
}

function normalizeComparableKind(value: unknown): string {
  return readTrimmedString(value).toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function readFiniteNodeNumberField(node: Node, field: string): number | null {
  const data = node.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const value = (data as Record<string, unknown>)[field]
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return null
  return Math.trunc(numeric)
}

function readLatestNodeTextResult(node: Node): string | null {
  const data = asRecord(node.data)
  if (!data) return null
  const textResults = Array.isArray(data.textResults) ? data.textResults : []
  const latest = textResults.length > 0 ? asRecord(textResults[textResults.length - 1]) : null
  if (!latest) return null
  const text = typeof latest.text === 'string' ? latest.text.trim() : ''
  return text || null
}

function readImageUrlFromCanvasNode(node: Node | undefined): string {
  if (!node) return ''
  const data = asRecord(node.data)
  if (!data) return ''
  const imageUrl = typeof data.imageUrl === 'string' ? data.imageUrl.trim() : ''
  if (imageUrl) return imageUrl
  return ''
}

function readStoryboardSelectionContextFromCanvasNode(node: Node | undefined): StoryboardSelectionContext | null {
  if (!node) return null
  const data = asRecord(node.data)
  if (!data) return null
  return normalizeStoryboardSelectionContext(data.storyboardSelectionContext)
}

function readCurrentCanvasNodeImageResult(node: Node | undefined): { shotNo: number | null; storyboardShotPrompt: string | null; prompt: string | null; storyboardScript: string | null; storyboardSelectionContext: StoryboardSelectionContext | null } | null {
  if (!node) return null
  const data = asRecord(node.data)
  if (!data) return null
  const imageResults = Array.isArray(data.imageResults) ? data.imageResults : []
  if (!imageResults.length) return null
  const primaryIndexRaw = typeof data.imagePrimaryIndex === 'number' ? data.imagePrimaryIndex : Number(data.imagePrimaryIndex)
  const primaryIndex =
    Number.isFinite(primaryIndexRaw) && primaryIndexRaw >= 0 && primaryIndexRaw < imageResults.length
      ? Math.trunc(primaryIndexRaw)
      : 0
  const record = asRecord(imageResults[primaryIndex])
  if (!record) return null
  const shotNoRaw = typeof record.shotNo === 'number' ? record.shotNo : Number(record.shotNo)
  return {
    shotNo: Number.isFinite(shotNoRaw) && shotNoRaw > 0 ? Math.trunc(shotNoRaw) : null,
    storyboardShotPrompt: typeof record.storyboardShotPrompt === 'string' && record.storyboardShotPrompt.trim() ? record.storyboardShotPrompt.trim() : null,
    prompt: typeof record.prompt === 'string' && record.prompt.trim() ? record.prompt.trim() : null,
    storyboardScript: typeof record.storyboardScript === 'string' && record.storyboardScript.trim() ? record.storyboardScript.trim() : null,
    storyboardSelectionContext: normalizeStoryboardSelectionContext(record.storyboardSelectionContext),
  }
}

export function extractLatestTodoBlock(content: string): { markdownText: string; todoItems: ChatTodoItem[] } {
  const raw = String(content || '')
  if (!raw.trim()) return { markdownText: '', todoItems: [] }
  const marker = '\nTodo\n'
  const normalized = raw.startsWith('Todo\n') ? `\n${raw}` : raw
  const startIndex = normalized.lastIndexOf(marker)
  if (startIndex < 0) return { markdownText: raw.trim(), todoItems: [] }
  const todoText = normalized.slice(startIndex + 1).trim()
  const todoLines = todoText.split('\n')
  if (todoLines[0] !== 'Todo') return { markdownText: raw.trim(), todoItems: [] }
  const todoItems: ChatTodoItem[] = []
  for (const line of todoLines.slice(1)) {
    const trimmed = line.trim()
    if (!trimmed || /^\(\d+\/\d+\s+done\)$/i.test(trimmed) || /^note:/i.test(trimmed)) continue
    const match = trimmed.match(/^\[( |>|x)\]\s+(.+)$/i)
    if (!match) continue
    todoItems.push({
      status: match[1] === 'x' ? 'completed' : match[1] === '>' ? 'in_progress' : 'pending',
      content: match[2]!.trim(),
    })
  }
  if (!todoItems.length) return { markdownText: raw.trim(), todoItems: [] }
  const markdownText = normalized.slice(0, startIndex).trim()
  return { markdownText, todoItems }
}

export function summarizeThinkingText(content: string): string {
  const raw = String(content || '').trim()
  if (!raw) return '正在处理你的请求'
  const { todoItems } = extractLatestTodoBlock(raw)
  if (todoItems.length > 0) {
    const completedCount = todoItems.filter((item) => item.status === 'completed').length
    const activeItem = todoItems.find((item) => item.status === 'in_progress')
    if (activeItem) return `正在执行：${activeItem.content}`
    return `正在整理任务清单（${completedCount}/${todoItems.length}）`
  }
  const firstLine = raw.split('\n').map((line) => line.trim()).find(Boolean)
  return firstLine || '正在处理你的请求'
}

export function dedupeProgressLines(lines: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    const normalized = String(line || '').trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out.slice(-4)
}

export function readSelectedCanvasNodeContext(node: Node): {
  nodeId: string
  label: string
  kind: string | null
  textPreview: string | null
  imageUrl: string | null
  sourceUrl: string | null
  bookId: string | null
  chapterId: string | null
  shotNo: number | null
  hasInlinePromptText: boolean
  hasUpstreamTextEvidence: boolean
  hasDownstreamComposeVideo: boolean
  storyboardSelectionContext: StoryboardSelectionContext | null
} | null {
  const normalizedNodeId = String(node?.id || '').trim()
  if (!normalizedNodeId) return null
  const data = readNodeDataRecord(node)
  const label = typeof data.label === 'string' && data.label.trim() ? data.label.trim() : normalizedNodeId
  const kind = typeof data.kind === 'string' && data.kind.trim() ? data.kind.trim() : null
  const storyboardSelectionContext = readStoryboardSelectionContextFromCanvasNode(node)
  const selectedImageResult = readCurrentCanvasNodeImageResult(node)
  return {
    nodeId: normalizedNodeId,
    label,
    kind,
    textPreview: clipChatPreview(
      String(
        storyboardSelectionContext?.shotPrompt
          || selectedImageResult?.storyboardShotPrompt
          || selectedImageResult?.storyboardScript
          || readTrimmedString(data.prompt)
          || readTrimmedString(data.text)
          || readTrimmedString(data.content)
          || readLatestNodeTextResult(node)
          || '',
      ),
      SELECTED_NODE_TEXT_PREVIEW_MAX_CHARS,
    ) || null,
    imageUrl: readImageUrlFromCanvasNode(node) || storyboardSelectionContext?.imageUrl || null,
    sourceUrl: readTrimmedString(data.sourceUrl) || null,
    bookId: readTrimmedString(data.sourceBookId) || readTrimmedString(data.bookId) || storyboardSelectionContext?.sourceBookId || null,
    chapterId: readTrimmedString(data.chapterId) || null,
    shotNo: readFiniteNodeNumberField(node, 'shotNo') ?? selectedImageResult?.shotNo ?? storyboardSelectionContext?.shotNo ?? null,
    hasInlinePromptText: Boolean(
      storyboardSelectionContext?.shotPrompt
      || selectedImageResult?.storyboardShotPrompt
      || selectedImageResult?.prompt
      || selectedImageResult?.storyboardScript
      || readTrimmedString(data.prompt)
      || readTrimmedString(data.text)
      || readTrimmedString(data.content),
    ),
    hasUpstreamTextEvidence: false,
    hasDownstreamComposeVideo: false,
    storyboardSelectionContext,
  }
}

export function formatTurnVerdictSummary(verdict: { status: 'satisfied' | 'partial' | 'failed'; reasons: string[] } | null | undefined): string | null {
  if (!verdict || verdict.status === 'satisfied') return null
  const prefix = verdict.status === 'failed' ? '结构失败' : '部分完成'
  return `${prefix}：${verdict.reasons.join('；')}`
}
