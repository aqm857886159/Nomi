// MCP 测试网 L1：真实 in-Electron stdio 进程的协议握手回归。
// 零额度、无窗口断言；只走 initialize/tools/list/tools/call/notification framing。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { makeIsolatedDirs, spawnMcpStdioClient, parseToolResult } from './_mcpJourney.mjs'

// 面收敛（surface-16-collapse）：拉分支时存在的 42 个 API 镜像塌成 15 个按对象归并的工具。nomi_intake_brief 从
// MCP 目录移除（无外部 MCP 消费者，内部 capability 保留）。并线 main 后 **+4 个 M2 语义编辑工具**
// （nomi_timeline_read/edit · nomi_export_job · nomi_media_query，main #16290f6e 收敛后新增的独立对象，原样保留、
// 未并入 nomi_read/collapse，续裁见 PR body）→ 面数与 payload 不再手抄：随编译目录与棘轮 json 派生（ratchet 只减不增仍由 check:mcp-payload 守）。
// 三个锚全部派生自真相源（手抄版三次被有意扩容撞红：#337 波、#360 slice-3；教训见
// docs/fixes/2026-09-02-stale-hand-copied-surface-baseline.root-cause.json）：
// 名单 ← 编译目录 MCP_TOOL_NAMES；只读表 ← catalog annotations.readOnlyHint；载荷 ← 棘轮 json（check:mcp-payload 单一真相）。
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..')
const BASELINE_PAYLOAD_BYTES = JSON.parse(fs.readFileSync(path.join(repoRoot, 'scripts', 'mcp-payload-baseline.json'), 'utf8')).maxBytes
const { MCP_TOOL_NAMES } = await import('../../dist-electron/capabilityCore/mcpProtocol.js')
const { MCP_TOOL_RESOLVER, SEMANTIC_EDITING_TOOL_NAMES } = await import('../../dist-electron/capabilityCore/mcpToolCatalog.js')
const TOOL_NAMES = [...MCP_TOOL_NAMES]
const READ_ONLY_TOOL_NAMES = MCP_TOOL_RESOLVER.list().filter((tool) => tool.annotations?.readOnlyHint === true).map((tool) => tool.name)

function check(condition, message) {
  if (!condition) throw new Error(`MCP-L1 FAIL: ${message}`)
  console.log(`✓ ${message}`)
}

function proofFor(token, client = 'codex') {
  return crypto.createHmac('sha256', token).update(`nomi-mcp-client:v1:${client}`).digest('base64url')
}

async function main() {
  const dirs = makeIsolatedDirs('nomi-mcp-l1-')
  const token = crypto.randomBytes(24).toString('hex')
  fs.writeFileSync(path.join(dirs.capabilityDir, 'token'), token, { mode: 0o600 })
  const mcp = spawnMcpStdioClient({
    ...dirs,
    clientInfo: { name: 'Codex MCP L1', version: '1.0.0' },
    capabilities: {},
    env: { NOMI_MCP_CLIENT: 'codex', NOMI_MCP_CLIENT_PROOF: proofFor(token) },
    captureStderr: true,
  })
  try {
    // C1 · supported and rejected protocol versions.
    const init = await mcp.rpc('initialize', {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Codex MCP L1', version: '1.0.0' },
    }, 10_000)
    check(init.result?.protocolVersion === '2025-11-25', 'C1 supported protocol version is echoed')
    check(init.result?.capabilities?.tools?.listChanged === true, 'C6 A1 declares tools.listChanged')
    const badVersion = await mcp.rpc('initialize', {
      protocolVersion: '1999-01-01', capabilities: {}, clientInfo: { name: 'Codex MCP L1', version: '1.0.0' },
    }, 10_000)
    check(badVersion.error?.code === -32602, 'C1 unsupported version returns -32602')
    check(Array.isArray(badVersion.error?.data?.supported), 'C1 unsupported version includes supported array')

    // C2 · exact current 19-tool snapshot (15 收敛 + 4 M2 语义编辑)、byte budget、title、read-only annotations。
    const listed = await mcp.rpc('tools/list', {}, 10_000)
    const tools = listed.result?.tools || []
    const names = tools.map((tool) => tool.name)
    check(names.length === TOOL_NAMES.length && JSON.stringify(names) === JSON.stringify(TOOL_NAMES), `C2 tools/list matches the ${TOOL_NAMES.length}-tool declared catalog`)
    // 收敛族必须带人读 title；M2 语义编辑工具沿用 capability 层已发布形态（暂无 title，A 线统一补）——
    // 范围从 catalog 导出的 SEMANTIC_EDITING_TOOL_NAMES 派生，不手抄排除规则（手抄漏项正是 slice-3 撞红的原因）。
    const collapsedTitled = tools.filter((tool) => !SEMANTIC_EDITING_TOOL_NAMES.includes(tool.name))
    check(collapsedTitled.every((tool) => typeof tool.title === 'string' && tool.title.length > 0), 'C2 every collapsed tool carries a human title')
    const readOnly = tools.filter((tool) => tool.annotations?.readOnlyHint === true).map((tool) => tool.name)
    check(JSON.stringify(readOnly) === JSON.stringify(READ_ONLY_TOOL_NAMES), 'C2 readOnlyHint is exactly nomi_read + nomi_operation_preview + M2 read tools')
    const payloadBytes = Buffer.byteLength(JSON.stringify({
      tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    }))
    console.log(`  payload bytes=${payloadBytes} baseline=${BASELINE_PAYLOAD_BYTES}`)
    check(payloadBytes <= BASELINE_PAYLOAD_BYTES, 'C2 tools/list payload is within ratchet budget')

    // C3 · protocol error vs recoverable tool execution error.
    // unknown-tool-probe：故意调不存在的工具验 -32602，不是忘了跟进面收敛（见 check:mcp-tool-refs）。
    const unknown = await mcp.rpc('tools/call', { name: 'nomi_not_a_real_tool', arguments: {} }, 10_000)
    check(unknown.error?.code === -32602, 'C3 unknown tool returns -32602')
    // 面收敛：nomi_add_nodes → nomi_canvas_edit(action=add_nodes)。空 nodes 仍触发 schema 校验拒绝。
    const badArgs = await mcp.rpc('tools/call', { name: 'nomi_canvas_edit', arguments: { action: 'add_nodes', nodes: [] } }, 10_000)
    check(badArgs.result?.isError === true, 'C3 invalid tool arguments return isError')
    check(badArgs.result?.structuredContent?.nomiOutcome?.errorCode === 'capability_input_invalid', 'C3 invalid arguments include diagnostic code')

    // C4 · cancel a real long-poll call and require no response for that request.
    // 面收敛：nomi_create_project→nomi_project_create；nomi_start_playbook→nomi_run_start；nomi_subscribe_run→nomi_read(target=run_events)。
    const project = await mcp.callTool('nomi_project_create', { name: 'MCP L1 cancellation fixture' }, { timeoutMs: 10_000 })
    const projectId = parseToolResult(project).json?.id || parseToolResult(project).json?.projectId || ''
    const started = await mcp.callTool('nomi_run_start', {
      projectId, playbook: 'brand.promo', brief: { goal: 'L1 cancellation fixture' },
    }, { timeoutMs: 10_000 })
    const runId = started?.structuredContent?.nomiOutcome?.runId || ''
    check(Boolean(projectId && runId), 'C4 created a real project/run before cancellation')
    const cancelledRequestId = mcp.nextRequestId()
    const cancelledResponse = mcp.rpc('tools/call', {
      name: 'nomi_read', arguments: { target: 'run_events', projectId, runId, afterCursor: 999999, waitMs: 25_000 },
    }, 2_000)
    mcp.notify('notifications/cancelled', { requestId: cancelledRequestId, reason: 'L1 test cancellation' })
    let cancellationRejected = false
    try { await cancelledResponse } catch { cancellationRejected = true }
    check(cancellationRejected, 'C4 cancelled request does not return a response')
    check(!mcp.childExited(), 'C4 cancellation keeps stdio server alive')

    // C5 · oversized line is dropped; the next malformed JSON line gets -32700.
    const oversized = 'x'.repeat(5 * 1024 * 1024)
    mcp.child.stdin.write(`${oversized}\n`)
    mcp.child.stdin.write('not-json\n')
    await new Promise((resolve) => setTimeout(resolve, 150))
    check(mcp.stderrText().includes('dropped an oversized stdin line'), 'C5 oversized line is dropped with a stderr log')
    check(mcp.messages().some((message) => message.error?.code === -32700), 'C5 malformed line returns -32700 parse error')
    check(!mcp.childExited(), 'C5 malformed input does not kill stdio server')

    console.log('MCP-L1 PASS: C1/C2/C3/C4/C5 green; C6 declaration green (change-source notification is covered by the A1 unit contract).')
  } finally {
    await mcp.terminate()
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1 })
