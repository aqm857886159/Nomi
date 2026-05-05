import { describe, expect, it } from 'vitest'
import { createSseEventParser } from '../../src/api/sse'

describe('SSE parser', () => {
  it('parses named JSON events across chunks', () => {
    const parser = createSseEventParser()
    const first = parser.push('event: content\ndata: {"delta":"你')
    const second = parser.push('好"}\n\nevent: done\ndata: {"reason":"finished"}\n\n')

    expect(first).toEqual([])
    expect(second).toEqual([
      { event: 'content', data: '{"delta":"你好"}', id: '', retry: null },
      { event: 'done', data: '{"reason":"finished"}', id: '', retry: null },
    ])
    expect(parser.finish()).toEqual([])
  })

  it('joins multiple data lines with newlines', () => {
    const parser = createSseEventParser()

    expect(parser.push('event: content\ndata: line1\ndata: line2\n\n')).toEqual([
      { event: 'content', data: 'line1\nline2', id: '', retry: null },
    ])
  })
})
