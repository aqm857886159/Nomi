// 每次工具调用里发给领域的每一跳都带同一个「调用标签」（工具名 + 本次调用号）；
// 三条传输都原样转发它，主进程据此给「AI 助手连接」卡记账（mcpUsageRegistry）。
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import { describe, expect, it } from 'vitest'

import { createNomiMcpServer, type McpInvokeOptions } from './mcpProtocol'
import { createTestMcpHost } from './__tests__/mcpHostTestUtils'

async function connect() {
  const seen: Array<{ method: string; options: McpInvokeOptions | undefined }> = []
  const nomi = createNomiMcpServer(createTestMcpHost({
    invoke: async (method, _params, options) => { seen.push({ method, options }); return { ok: true } },
    isAppOpen: () => true,
  }))
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'claude-code', version: '1' })
  await Promise.all([nomi.connect(serverSide), client.connect(clientSide)])
  return { seen, client, close: () => nomi.close() }
}

describe('工具调用标签', () => {
  it('发给领域的那一跳带着工具名和本次调用号；两次调用的号不同', async () => {
    const { seen, client, close } = await connect()
    await client.callTool({ name: 'nomi_project_create', arguments: { name: 'a' } })
    await client.callTool({ name: 'nomi_project_create', arguments: { name: 'b' } })
    expect(seen).toHaveLength(2)
    expect(seen.map((s) => s.options?.call?.tool)).toEqual(['nomi_project_create', 'nomi_project_create'])
    const [first, second] = seen.map((s) => s.options?.call?.id)
    expect(first).toBeTruthy()
    expect(first).not.toBe(second)
    await close()
  })

  it('不是工具调用的请求（列技能）不带标签：它们不算「用了一次工具」', async () => {
    const { seen, client, close } = await connect()
    await client.listResources().catch(() => undefined)
    expect(seen.every((s) => s.options?.call === undefined)).toBe(true)
    await close()
  })
})
