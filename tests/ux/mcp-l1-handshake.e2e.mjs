// MCP 测试网 L1：真实 in-Electron stdio 进程的协议握手回归。
// 零额度、无窗口断言；只走 initialize/tools/list/tools/call/notification framing。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { makeIsolatedDirs, spawnMcpStdioClient, parseToolResult } from './_mcpJourney.mjs'

// 2026-09-02 M2 slice-2：+4 semantic editing tools (nomi_timeline_read/edit,
// nomi_export_job, nomi_media_query) — deliberate L1 surface growth, snapshot
// and byte budget recalibrated in the same diff (docs/plan/2026-09-02-m2-editing-semantic-slices.md).
const BASELINE_PAYLOAD_BYTES = 25_341
const TOOL_NAMES = [
  'nomi_session_open', 'nomi_get_generation_context', 'nomi_operation_create', 'nomi_submit_generation_plan',
  'nomi_preview_execution', 'nomi_request_generation_gate', 'nomi_decide_generation_gate', 'nomi_start_generation',
  'nomi_operation_read', 'nomi_cancel_generation', 'nomi_reconcile_generation', 'nomi_integration_begin',
  'nomi_integration_open_credentials', 'nomi_integration_discover', 'nomi_integration_select',
  'nomi_integration_request_confirmation', 'nomi_integration_submit_workflow', 'nomi_integration_resolve_input',
  'nomi_integration_start', 'nomi_integration_get', 'nomi_integration_cancel', 'nomi_list_projects',
  'nomi_create_project', 'nomi_list_models', 'nomi_read_canvas', 'nomi_timeline_read', 'nomi_timeline_edit',
  'nomi_export_job', 'nomi_media_query', 'nomi_add_nodes', 'nomi_connect_nodes',
  'nomi_set_node_prompt', 'nomi_delete_nodes', 'nomi_start_playbook', 'nomi_get_run', 'nomi_subscribe_run',
  'nomi_get_artifact', 'nomi_read_artifact', 'nomi_request_script_revision', 'nomi_request_storyboard_revision',
  'nomi_review_artifact', 'nomi_materialize_storyboard', 'nomi_control_run', 'nomi_decide_gate', 'nomi_intake_brief',
  'nomi_import_asset',
]

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

    // C2 · exact current 46-tool snapshot and byte budget.
    const listed = await mcp.rpc('tools/list', {}, 10_000)
    const tools = listed.result?.tools || []
    const names = tools.map((tool) => tool.name)
    check(names.length === 46 && JSON.stringify(names) === JSON.stringify(TOOL_NAMES), 'C2 tools/list matches current 46-tool snapshot')
    const payloadBytes = Buffer.byteLength(JSON.stringify({
      tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    }))
    console.log(`  payload bytes=${payloadBytes} baseline=${BASELINE_PAYLOAD_BYTES}`)
    check(payloadBytes <= BASELINE_PAYLOAD_BYTES, 'C2 tools/list payload is within ratchet budget')

    // C3 · protocol error vs recoverable tool execution error.
    const unknown = await mcp.rpc('tools/call', { name: 'nomi_not_a_real_tool', arguments: {} }, 10_000)
    check(unknown.error?.code === -32602, 'C3 unknown tool returns -32602')
    const badArgs = await mcp.rpc('tools/call', { name: 'nomi_add_nodes', arguments: { nodes: [] } }, 10_000)
    check(badArgs.result?.isError === true, 'C3 invalid tool arguments return isError')
    check(badArgs.result?.structuredContent?.nomiOutcome?.errorCode === 'capability_input_invalid', 'C3 invalid arguments include diagnostic code')

    // C4 · cancel a real long-poll call and require no response for that request.
    const project = await mcp.callTool('nomi_create_project', { name: 'MCP L1 cancellation fixture' }, { timeoutMs: 10_000 })
    const projectId = parseToolResult(project).json?.id || parseToolResult(project).json?.projectId || ''
    const started = await mcp.callTool('nomi_start_playbook', {
      projectId, playbook: 'brand.promo', brief: { goal: 'L1 cancellation fixture' },
    }, { timeoutMs: 10_000 })
    const runId = started?.structuredContent?.nomiOutcome?.runId || ''
    check(Boolean(projectId && runId), 'C4 created a real project/run before cancellation')
    const cancelledRequestId = mcp.nextRequestId()
    const cancelledResponse = mcp.rpc('tools/call', {
      name: 'nomi_subscribe_run', arguments: { projectId, runId, afterCursor: 999999, waitMs: 25_000 },
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
