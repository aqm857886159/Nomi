import { describe, expect, it } from 'vitest'

import { MAX_MCP_LINE_BYTES, parseMcpStdioLine } from './mcpStdioLine'

describe('MCP stdio line boundary', () => {
  it('rejects malformed and oversized lines while ignoring blanks', () => {
    expect(parseMcpStdioLine('   ')).toEqual({ kind: 'blank' })
    expect(parseMcpStdioLine('{not json')).toEqual({ kind: 'parse-error' })
    const oversized = parseMcpStdioLine('x'.repeat(MAX_MCP_LINE_BYTES + 1))
    expect(oversized.kind).toBe('oversized')
  })

  it('parses a valid unicode JSON-RPC line by UTF-8 byte length', () => {
    const parsed = parseMcpStdioLine(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping', note: '你好' }))
    expect(parsed).toEqual({ kind: 'message', value: { jsonrpc: '2.0', id: 7, method: 'ping', note: '你好' } })
  })
})
