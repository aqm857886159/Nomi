import fs from 'node:fs'
import path from 'node:path'
import { createMcpProtocol } from '../electron/capabilityCore/mcpProtocol'
import { MCP_TOOL_RESOLVER } from '../electron/capabilityCore/mcpToolCatalog'
import { measureMcpToolsListPayload, measureMcpToolsListPayloadByLocale } from './mcp-payload.mjs'

type Frame = { result?: unknown }
const baselinePath = path.resolve('scripts/mcp-payload-baseline.json')
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as { maxBytes?: number }
const maxBytes = baseline.maxBytes
if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw new Error(`Invalid MCP payload baseline: ${baselinePath}`)

const frames: Frame[] = []
const protocol = createMcpProtocol({ send: (message) => frames.push(message as Frame), invoke: async () => ({}), isAppOpen: () => false })

async function run(): Promise<void> {
  try {
    protocol.handleIncoming({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    await new Promise<void>((resolve) => setImmediate(resolve))
    if (!frames.some((frame) => frame.result !== undefined)) throw new Error('MCP tools/list returned no result')
    const payloadBytesByLocale = measureMcpToolsListPayloadByLocale(MCP_TOOL_RESOLVER.list())
    const actualBytes = measureMcpToolsListPayload(MCP_TOOL_RESOLVER.list())
    console.log(`MCP tools/list payload: ${actualBytes} bytes (zh-CN ${payloadBytesByLocale['zh-CN']}, en ${payloadBytesByLocale.en}; ratchet max ${maxBytes})`)
    if (actualBytes > maxBytes) {
      throw new Error(`MCP payload ratchet failed: ${actualBytes} > ${maxBytes}`)
    }
    console.log('MCP payload ratchet passed: baseline may only decrease')
  } finally {
    protocol.dispose()
  }
}

run().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
