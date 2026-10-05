import fs from 'node:fs'
import path from 'node:path'
import { createMcpProtocol } from '../electron/capabilityCore/mcpProtocol'
import { MCP_TOOL_RESOLVER } from '../electron/capabilityCore/mcpToolCatalog'
import { measureMcpToolsListPayload, measureMcpToolsListPayloadByLocale } from './mcp-payload.mjs'

type Frame = { result?: unknown }
const baselinePath = path.resolve('scripts/mcp-payload-baseline.json')
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as { maxBytes?: number }
const maxBytes = baseline.maxBytes
if (!Number.isInteger(maxBytes) || (maxBytes as number) <= 0) throw new Error(`Invalid MCP payload baseline: ${baselinePath}`)
const maxBytesValue = maxBytes as number

/**
 * 抬基线必须逐条记账（2026-09-21）。
 *
 * ── 它在挡什么 ─────────────────────────────────────────────────────────────────
 * 棘轮本来的意思是「散文会悄悄长，能力要有意长」。但它唯一的执行手段是一个数字加一段
 * 自由散文（`baseline.reason`），于是每次超了都可以「按实际值抬一次、在散文末尾补一句」
 * ——那段散文今天已经长到没人逐条读得完，也没有任何机器判据能确认某一次涨的字节**买到了什么**。
 * 挤字节和加能力在这个门岗眼里长得一模一样。
 *
 * 现在：基线高于锚点的每一个字节，都必须落在 `scripts/mcp-payload-ledger.json` 的一条记账上，
 * 写清**哪个工具、多少字节、凭哪条用户拍板、为什么这不是散文漂移**。链条首尾相接，末条等于当前基线。
 */
type PayloadRaise = { tool?: unknown; bytes?: unknown; fromBytes?: unknown; toBytes?: unknown; decision?: unknown; why?: unknown }
const ledgerPath = path.resolve('scripts/mcp-payload-ledger.json')
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) as { anchorBytes?: number; raises?: PayloadRaise[] }
const anchorBytes = ledger.anchorBytes
if (!Number.isInteger(anchorBytes) || (anchorBytes as number) <= 0) throw new Error(`Invalid MCP payload ledger anchor: ${ledgerPath}`)
const raises = Array.isArray(ledger.raises) ? ledger.raises : []

function assertLedgerExplainsBaseline(toolNames: ReadonlySet<string>): void {
  const problems: string[] = []
  let cursor = anchorBytes as number
  raises.forEach((raise, index) => {
    const label = `raises[${index}]`
    const tool = typeof raise.tool === 'string' ? raise.tool.trim() : ''
    const from = raise.fromBytes
    const to = raise.toBytes
    const bytes = raise.bytes
    const decision = typeof raise.decision === 'string' ? raise.decision.trim() : ''
    const why = typeof raise.why === 'string' ? raise.why.trim() : ''
    if (!tool) problems.push(`${label}: 缺 tool（抬基线必须点名是哪个工具涨的）`)
    else if (!toolNames.has(tool)) problems.push(`${label}: tool "${tool}" 不在当前工具面上`)
    if (!Number.isInteger(from) || from !== cursor) problems.push(`${label}: fromBytes 必须接上一条（应为 ${cursor}，实为 ${String(from)}）`)
    if (!Number.isInteger(to) || (to as number) <= cursor) problems.push(`${label}: toBytes 必须大于 fromBytes`)
    if (Number.isInteger(from) && Number.isInteger(to) && bytes !== (to as number) - (from as number)) {
      problems.push(`${label}: bytes 必须等于 toBytes - fromBytes`)
    }
    if (!decision) problems.push(`${label}: 缺 decision（凭哪条用户拍板／哪份根因合同）`)
    if (why.length < 40) problems.push(`${label}: why 太短——要写清这不是散文漂移，而是什么能力买来的`)
    if (Number.isInteger(to)) cursor = to as number
  })
  if (cursor !== maxBytes) {
    problems.push(`账本末条是 ${cursor}，当前基线是 ${maxBytes}：基线高出锚点的每一个字节都要有一条记账（抬基线不许只改数字）`)
  }
  if (problems.length) {
    throw new Error(`MCP payload ledger incomplete:\n  - ${problems.join('\n  - ')}`)
  }
}

const frames: Frame[] = []
const protocol = createMcpProtocol({ send: (message) => frames.push(message as Frame), invoke: async () => ({}), isAppOpen: () => false })

async function run(): Promise<void> {
  try {
    protocol.handleIncoming({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    // 协议层是官方 SDK，处理每一帧都是异步的：让事件循环转到有响应为止（最多几圈）。
    for (let round = 0; round < 20 && !frames.some((frame) => frame.result !== undefined); round += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    if (!frames.some((frame) => frame.result !== undefined)) throw new Error('MCP tools/list returned no result')
    const payloadBytesByLocale = measureMcpToolsListPayloadByLocale(MCP_TOOL_RESOLVER.list())
    const actualBytes = measureMcpToolsListPayload(MCP_TOOL_RESOLVER.list())
    console.log(`MCP tools/list payload: ${actualBytes} bytes (zh-CN ${payloadBytesByLocale['zh-CN']}, en ${payloadBytesByLocale.en}; ratchet max ${maxBytes})`)
    assertLedgerExplainsBaseline(new Set((MCP_TOOL_RESOLVER.list() as unknown as { name?: unknown }[])
      .map((tool) => (typeof tool.name === 'string' ? tool.name : ''))))
    if (actualBytes > maxBytesValue) {
      throw new Error(`MCP payload ratchet failed: ${actualBytes} > ${maxBytesValue}`)
    }
    console.log('MCP payload ratchet passed: baseline may only decrease')
  } finally {
    protocol.dispose()
  }
}

run().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
