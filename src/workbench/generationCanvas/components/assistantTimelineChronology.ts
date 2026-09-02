import type { WorkbenchAiMessage } from '../../ai/workbenchAiTypes'
import type { CanvasAssistantTimelineAnchor } from '../agent/canvasAssistantTimelineAnchor'

export type AssistantTimelineBlockAnchor = Readonly<{ key: string }> & Partial<CanvasAssistantTimelineAnchor>

export type AssistantTimelineChronologyEntry =
  | Readonly<{
      kind: 'message'
      key: string
      message: WorkbenchAiMessage
      content: string
      terminalSegment: boolean
    }>
  | Readonly<{ kind: 'block'; key: string }>

/** Assistant Items stay canonical; these segments exist only for render order. */
export function orderAssistantTimelineEntries(
  messages: readonly WorkbenchAiMessage[],
  blocks: readonly AssistantTimelineBlockAnchor[],
): AssistantTimelineChronologyEntry[] {
  const messageIds = new Set(messages.map((message) => message.id))
  const anchored = new Map<string, AssistantTimelineBlockAnchor[]>()
  const tail: AssistantTimelineBlockAnchor[] = []
  for (const block of blocks) {
    if (block.anchorMessageId && messageIds.has(block.anchorMessageId)) {
      const current = anchored.get(block.anchorMessageId) ?? []
      current.push(block)
      anchored.set(block.anchorMessageId, current)
    } else {
      tail.push(block)
    }
  }

  const entries: AssistantTimelineChronologyEntry[] = []
  for (const message of messages) {
    const messageBlocks = anchored.get(message.id) ?? []
    const splitBlocks =
      message.role === 'assistant'
        ? messageBlocks.filter(
            (block) =>
              Number.isInteger(block.anchorTextOffset) &&
              (block.anchorTextOffset as number) >= 0 &&
              (block.anchorTextOffset as number) <= message.content.length,
          )
        : []
    const afterMessage = messageBlocks.filter((block) => !splitBlocks.includes(block))
    if (splitBlocks.length === 0) {
      entries.push({ kind: 'message', key: message.id, message, content: message.content, terminalSegment: true })
    } else {
      const byOffset = new Map<number, AssistantTimelineBlockAnchor[]>()
      for (const block of splitBlocks) {
        const offset = block.anchorTextOffset as number
        const current = byOffset.get(offset) ?? []
        current.push(block)
        byOffset.set(offset, current)
      }
      let cursor = 0
      const messageEntryIndexes: number[] = []
      for (const [offset, offsetBlocks] of [...byOffset.entries()].sort(([left], [right]) => left - right)) {
        if (offset > cursor) {
          messageEntryIndexes.push(entries.length)
          entries.push({
            kind: 'message',
            key: `${message.id}:${cursor}:${offset}`,
            message,
            content: message.content.slice(cursor, offset),
            terminalSegment: false,
          })
        }
        entries.push(...offsetBlocks.map((block) => ({ kind: 'block' as const, key: block.key })))
        cursor = offset
      }
      if (cursor < message.content.length) {
        messageEntryIndexes.push(entries.length)
        entries.push({
          kind: 'message',
          key: `${message.id}:${cursor}:${message.content.length}`,
          message,
          content: message.content.slice(cursor),
          terminalSegment: true,
        })
      } else if (messageEntryIndexes.length > 0) {
        const lastIndex = messageEntryIndexes.at(-1) as number
        const last = entries[lastIndex]
        if (last.kind === 'message') entries[lastIndex] = { ...last, terminalSegment: true }
      }
    }
    entries.push(...afterMessage.map((block) => ({ kind: 'block' as const, key: block.key })))
  }
  entries.push(...tail.map((block) => ({ kind: 'block' as const, key: block.key })))
  return entries
}
