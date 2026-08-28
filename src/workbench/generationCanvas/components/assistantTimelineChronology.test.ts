import { describe, expect, it } from 'vitest'

import type { WorkbenchAiMessage } from '../../ai/workbenchAiTypes'
import { orderAssistantTimelineEntries } from './assistantTimelineChronology'

describe('Assistant timeline chronology', () => {
  it('keeps a pending tool card between pre-tool and post-tool text from one canonical Assistant Item', () => {
    const messages: WorkbenchAiMessage[] = [
      {
        id: 'assistant-a',
        turnId: 'turn-a',
        role: 'assistant',
        content: 'Before tool. After tool.',
        status: 'streaming',
      },
    ]

    expect(orderAssistantTimelineEntries(messages, [
      { key: 'pending-tool-a', anchorMessageId: 'assistant-a', anchorTextOffset: 'Before tool.'.length },
    ])).toEqual([
      { kind: 'message', key: 'assistant-a:0:12', message: messages[0], content: 'Before tool.', terminalSegment: false },
      { kind: 'block', key: 'pending-tool-a' },
      { kind: 'message', key: 'assistant-a:12:24', message: messages[0], content: ' After tool.', terminalSegment: true },
    ])
  })

  it('keeps multiple cards with equal offsets stable and honors zero/end boundaries', () => {
    const messages: WorkbenchAiMessage[] = [
      { id: 'assistant-a', role: 'assistant', content: 'abcd', status: 'done' },
    ]

    expect(orderAssistantTimelineEntries(messages, [
      { key: 'at-end', anchorMessageId: 'assistant-a', anchorTextOffset: 4 },
      { key: 'equal-a', anchorMessageId: 'assistant-a', anchorTextOffset: 2 },
      { key: 'at-zero', anchorMessageId: 'assistant-a', anchorTextOffset: 0 },
      { key: 'equal-b', anchorMessageId: 'assistant-a', anchorTextOffset: 2 },
    ]).map((entry) => entry.kind === 'message' ? `text:${entry.content}` : entry.key)).toEqual([
      'at-zero',
      'text:ab',
      'equal-a',
      'equal-b',
      'text:cd',
      'at-end',
    ])
  })

  it('puts invalid or missing anchors after canonical messages without splitting them', () => {
    const messages: WorkbenchAiMessage[] = [
      { id: 'assistant-a', role: 'assistant', content: 'whole', status: 'done' },
    ]

    expect(orderAssistantTimelineEntries(messages, [
      { key: 'negative', anchorMessageId: 'assistant-a', anchorTextOffset: -1 },
      { key: 'past-end', anchorMessageId: 'assistant-a', anchorTextOffset: 6 },
      { key: 'fractional', anchorMessageId: 'assistant-a', anchorTextOffset: 1.5 },
      { key: 'missing-item', anchorMessageId: 'assistant-missing', anchorTextOffset: 1 },
      { key: 'missing-anchor' },
    ]).map((entry) => entry.kind === 'message' ? `text:${entry.content}` : entry.key)).toEqual([
      'text:whole',
      'negative',
      'past-end',
      'fractional',
      'missing-item',
      'missing-anchor',
    ])
  })

  it('uses Host UTF-16 offsets without corrupting a non-BMP character boundary', () => {
    const content = 'A😀B'
    const messages: WorkbenchAiMessage[] = [
      { id: 'assistant-a', role: 'assistant', content, status: 'done' },
    ]

    expect(orderAssistantTimelineEntries(messages, [
      { key: 'after-emoji', anchorMessageId: 'assistant-a', anchorTextOffset: 'A😀'.length },
    ]).map((entry) => entry.kind === 'message' ? `text:${entry.content}` : entry.key)).toEqual([
      'text:A😀',
      'after-emoji',
      'text:B',
    ])
  })
})
