import { describe, expect, it } from 'vitest'

import { genericMcpSnippet } from './mcpGenericSnippet'

describe('genericMcpSnippet', () => {
  it('不带任何客户端身份：环境变量形式和请求头形式的 id / proof 都被剥掉', () => {
    const signed = {
      command: 'node',
      args: ['launcher.js'],
      env: { NOMI_MCP_STDIO: '1', NOMI_MCP_CLIENT: 'claude', NOMI_MCP_CLIENT_PROOF: 'secret-proof' },
      url: 'http://127.0.0.1:47173/mcp',
      headers: { 'x-nomi-mcp-client': 'claude', 'x-nomi-mcp-client-proof': 'secret-proof' },
    } as never
    const text = genericMcpSnippet(signed)
    expect(text).not.toMatch(/secret-proof|x-nomi-mcp-client|NOMI_MCP_CLIENT|"headers"/)
    expect(JSON.parse(text).mcpServers.nomi.command).toBe('node')
  })
})
