import fs from 'node:fs'
import path from 'node:path'
import { createMcpProtocol } from '../electron/capabilityCore/mcpProtocol'

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
    const result = frames.find((frame) => frame.result !== undefined)?.result as { tools?: Array<Record<string, unknown>> } | undefined
    const tools = Array.isArray(result?.tools) ? result.tools : []
    const actualBytes = Buffer.byteLength(JSON.stringify({
      tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    }))
    console.log(`MCP tools/list payload: ${actualBytes} bytes (ratchet max ${maxBytes})`)
    if (actualBytes > maxBytes) {
      throw new Error(`MCP payload ratchet failed: ${actualBytes} > ${maxBytes}`)
    }
    console.log('MCP payload ratchet passed: baseline may only decrease')
  } finally {
    protocol.dispose()
  }
}

run().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
