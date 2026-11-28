// 本机 HTTP 直连里「助手连上了」的记账边界：只有口令验过的真助手握手才记；口令错、没带身份、
// Nomi 自己的连接测试（nomi-verify）都不记——否则「测试连接」会让卡片误以为助手来过。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MCP_VERIFY_PROBE_NAME, mcpHttpIdentityHeaders } from './mcpHttpEndpoint'
import { startMcpHttpServer, type McpHttpServerHandle } from './mcpHttpServer'
import { createNomiMcpServer } from './mcpProtocol'
import { createTestMcpHost } from './__tests__/mcpHostTestUtils'
import { ensureToken, signMcpClient } from './security'

let capabilityDir: string
let server: McpHttpServerHandle
const connected = vi.fn<(client: string, name: string | undefined) => void>()

beforeEach(async () => {
  connected.mockReset()
  capabilityDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcp-http-usage-'))
  vi.stubEnv('NOMI_CAPABILITY_DIR', capabilityDir)
  ensureToken()
  server = await startMcpHttpServer({
    port: 0,
    onClientConnected: connected,
    sessionFor: (identity) => createNomiMcpServer(createTestMcpHost({
      invoke: async () => ({}),
      isAppOpen: () => true,
      getAuthenticatedClient: () => identity.connection.authenticatedClient,
    })),
  })
})

afterEach(async () => {
  await server.close()
  vi.unstubAllEnvs()
})

const initialize = (name: string) => JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name, version: '1' } } })
const post = (body: string, headers: Record<string, string>) => fetch(server.url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
  body,
})
const identity = (client: string) => mcpHttpIdentityHeaders(client, signMcpClient(client) ?? '')

describe('HTTP 握手记账', () => {
  it('口令验过的助手握手 → 记一次，带上它的自报名', async () => {
    expect((await post(initialize('claude-code'), identity('claude'))).status).toBe(200)
    expect(connected).toHaveBeenCalledWith('claude', 'claude-code')
  })

  it('断线后重连 → 再记一次（账本里计数不清零，由账本决定）', async () => {
    await (await post(initialize('claude-code'), identity('claude'))).text()
    await (await post(initialize('claude-code'), identity('claude'))).text()
    expect(connected).toHaveBeenCalledTimes(2)
  })

  it('口令错 / 没带身份 → 一次都不记', async () => {
    await (await post(initialize('claude-code'), mcpHttpIdentityHeaders('claude', 'not-a-proof'))).text()
    await (await post(initialize('claude-code'), {})).text()
    expect(connected).not.toHaveBeenCalled()
  })

  it('自报名冒充别的助手也没用：记在口令认出的那个 key 名下', async () => {
    await (await post(initialize('cursor'), identity('claude'))).text()
    expect(connected).toHaveBeenCalledWith('claude', 'cursor')
  })

  it('Nomi 自己的连接测试（nomi-verify）不算助手来过', async () => {
    await (await post(initialize(MCP_VERIFY_PROBE_NAME), identity('claude'))).text()
    expect(connected).not.toHaveBeenCalled()
  })
})
