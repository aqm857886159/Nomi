import { require as tsxRequire } from 'tsx/cjs/api'
// MCP 测试网 L1：真实 in-Electron stdio 进程的协议握手回归。
// 零额度、无窗口断言；只走 initialize/tools/list/tools/call/notification framing。
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeIsolatedDirs, spawnMcpStdioClient, parseToolResult } from './_mcpJourney.mjs'
import { measureMcpToolsListPayload, measureMcpToolsListPayloadByLocale } from '../../scripts/mcp-payload.mjs'

// 面收敛（surface-16-collapse）：拉分支时存在的 42 个 API 镜像塌成 15 个按对象归并的工具。nomi_intake_brief 从
// MCP 目录移除（无外部 MCP 消费者，内部 capability 保留）。并线 main 后 **+4 个 M2 语义编辑工具**
// （nomi_timeline_read/edit · nomi_export_job · nomi_media_query，main #16290f6e 收敛后新增的独立对象，原样保留、
// 未并入 nomi_read/collapse，续裁见 PR body）→ 面数与 payload 不再手抄：随源码目录与棘轮 json 派生（ratchet 只减不增仍由 check:mcp-payload 守）。
// 三个锚全部派生自真相源（手抄版三次被有意扩容撞红：#337 波、#360 slice-3；教训见
// docs/fixes/2026-09-02-stale-hand-copied-surface-baseline.root-cause.json）：
// 名单 ← 源码目录 MCP_TOOL_NAMES；只读表 ← catalog annotations.readOnlyHint；载荷 ← 棘轮 json（check:mcp-payload 单一真相）。
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASELINE_PAYLOAD_BYTES = JSON.parse(fs.readFileSync(path.join(repoRoot, 'scripts', 'mcp-payload-baseline.json'), 'utf8')).maxBytes
const { MCP_TOOL_NAMES } = tsxRequire('../../electron/capabilityCore/mcpProtocol.ts', import.meta.url)
const { MCP_TOOL_RESOLVER } = tsxRequire('../../electron/capabilityCore/mcpToolCatalog.ts', import.meta.url)
// C5 的 stderr 锚也派生自真相源：这条诊断的事件名由两条启动路（Electron stdio server /
// 裸 Node launcher）共用一个常量，手抄一句散文的结局是改了代码这里静默漂成假绿。
const { MCP_TRANSPORT_ERROR_EVENT } = tsxRequire('../../electron/capabilityCore/mcpStdioDiagnostics.ts', import.meta.url)
const { SUPPORTED_PROTOCOL_VERSIONS } = tsxRequire('../../electron/capabilityCore/mcpProtocol.ts', import.meta.url)
const { LANE_MODEL_TOOL_CATALOG, LANE_DEFERRED_TOOL_CATALOG } = tsxRequire('../../electron/agentLane/laneToolCatalog.ts', import.meta.url)
const { toPublishedJsonSchema } = tsxRequire('../../electron/shared/agentCapabilities/modelVisibleJsonSchema.ts', import.meta.url)
const LANE_TOOLS = [...LANE_MODEL_TOOL_CATALOG, ...LANE_DEFERRED_TOOL_CATALOG]
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
  for (const client of ['claude', 'workbuddy']) {
    const denied = spawnMcpStdioClient({ ...makeIsolatedDirs('nomi-mcp-denied-'),
      clientInfo: { name: client, version: '1' }, capabilities: {}, captureStderr: true,
      env: { NOMI_MCP_CLIENT: client, NOMI_MCP_CLIENT_PROOF: 'invalid-proof' },
    })
    try {
      for (const method of ['initialize', 'tools/list', 'resources/list', 'prompts/list']) {
        const response = await denied.rpc(method, { protocolVersion: '2025-11-25', clientInfo: { name: client, version: '1' } }, 10_000)
        check(response.error?.code === -32001 && response.error?.data?.code === 'mcp_connection_unauthenticated',
          `C51 ${client} ${method} rejects an unverified client with the stable authentication code`)
      }
      check(!denied.childExited(), 'C51 rejection keeps stdio framing alive')
    } finally { await denied.terminate() }
  }
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
    // 协议层换官方 SDK 后（设计卡 docs/plan/2026-10-05-mcp-official-sdk.md「行为差异」）：按规范回我们支持的最高版本，
    // 由客户端决定断不断；不支持的版本绝不被原样协商成功。
    check(badVersion.result?.protocolVersion === SUPPORTED_PROTOCOL_VERSIONS[0], 'C1 unsupported version is never echoed; the newest supported version is offered')

    // C2 · 工具名单/载荷/title/只读注解——三个锚全部派生自真相源，注释里**不写死个数**
    //（手抄的个数三次撞红：#337 波、#360 slice-3，以及 2026-09-05 这行自己就已经陈旧了）。
    const listed = await mcp.rpc('tools/list', {}, 10_000)
    const tools = listed.result?.tools || []
    const names = tools.map((tool) => tool.name)
    check(names.length === TOOL_NAMES.length && JSON.stringify(names) === JSON.stringify(TOOL_NAMES), `C2 tools/list matches the ${TOOL_NAMES.length}-tool declared catalog`)
    check(tools.every((tool) => typeof tool.title === 'string' && tool.title.length > 0), 'C2 every MCP tool carries a human title')
    // 内部面是 `edit_timeline(revision, …)`；对外 `plan` 字段的 owner 是契约上的 `timelineEditPlanModelSchema`（同一份）。
    const { timelineEditPlanModelSchema } = tsxRequire('../../electron/shared/agentCapabilities/timelineRead.ts', import.meta.url)
    const { $schema: _dialect, ...planSchema } = toPublishedJsonSchema(timelineEditPlanModelSchema)
    assert.deepEqual(tools.find(tool => tool.name === 'nomi_timeline_edit').inputSchema.properties.plan, planSchema,
      'C51 external timeline plan is the complete lane schema, including action and bounds')
    check(true, 'C51 timeline write schema is projected from the lane catalog')
    // Run 家族不上模型面（设计正本 §5.3）：对外 brief 字段的 owner 是 productionRunDescriptors 那份 schema。
    const { productionRunToolDescriptors } = tsxRequire('../../electron/shared/agentCapabilities/productionRunDescriptors.ts', import.meta.url)
    const runSchema = toPublishedJsonSchema(productionRunToolDescriptors.start_production_run.parameters)
    for (const field of ['goal', 'audience', 'channel', 'tone', 'durationSeconds', 'sellingPoints']) {
      assert.deepEqual(tools.find(tool => tool.name === 'nomi_run_start').inputSchema.properties.brief.properties[field], runSchema.properties[field], `C51 production ${field} is the lane schema`)
    }
    const { generationPlanInputSchema } = tsxRequire('../../electron/shared/agentCapabilities/generationPlanSchemas.ts', import.meta.url)
    const create = toPublishedJsonSchema(generationPlanInputSchema.options[1].omit({ operation: true }))
    for (const [field, schema] of Object.entries(create.properties)) {
      assert.deepEqual(tools.find(tool => tool.name === 'nomi_operation_plan').inputSchema.properties[field], schema, `C51 generation ${field} is the lane schema`)
    }
    const readOnly = tools.filter((tool) => tool.annotations?.readOnlyHint === true).map((tool) => tool.name)
    check(JSON.stringify(readOnly) === JSON.stringify(READ_ONLY_TOOL_NAMES), 'C2 readOnlyHint is exactly nomi_read + nomi_operation_preview + M2 read tools')
    const payloadBytesByLocale = measureMcpToolsListPayloadByLocale(MCP_TOOL_RESOLVER.list())
    const payloadBytes = measureMcpToolsListPayload(MCP_TOOL_RESOLVER.list())
    console.log(`  payload bytes=${payloadBytes} (zh-CN=${payloadBytesByLocale['zh-CN']}, en=${payloadBytesByLocale.en}) baseline=${BASELINE_PAYLOAD_BYTES}`)
    check(payloadBytes <= BASELINE_PAYLOAD_BYTES, 'C2 tools/list payload is within ratchet budget')

    // C3 · protocol error vs recoverable tool execution error.
    // unknown-tool-probe：故意调不存在的工具验 -32602，不是忘了跟进面收敛（见 check:mcp-tool-refs）。
    const unknown = await mcp.rpc('tools/call', { name: 'nomi_not_a_real_tool', arguments: {} }, 10_000)
    check(unknown.error?.code === -32602, 'C3 unknown tool returns -32602')
    // nomi_canvas_edit：不属于任何 operation 分支的参数仍触发 schema 校验拒绝。
    const badArgs = await mcp.rpc('tools/call', { name: 'nomi_canvas_edit', arguments: { action: 'add_nodes', nodes: [] } }, 10_000)
    check(badArgs.result?.isError === true, 'C3 invalid tool arguments return isError')
    check(badArgs.result?.structuredContent?.nomiOutcome?.errorCode === 'capability_input_invalid', 'C3 invalid arguments include diagnostic code')

    // C4 · cancel a real long-poll call and require no response for that request.
    // 建项目/起 Run/长轮询全走收敛面：nomi_project_create / nomi_run_start / nomi_read(target=run_events)。
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

    // C5 · stdio 分帧归 SDK 的 StdioServerTransport：非 JSON 行跳过、连接照常；读缓冲超上限（10 MiB）即报错并关连接。
    mcp.child.stdin.write('not-json' + String.fromCharCode(10))
    const afterGarbage = await mcp.rpc('ping', {}, 10_000)
    check(afterGarbage.result !== undefined && !mcp.childExited(), 'C5 a malformed line is skipped and the stdio server keeps answering')
    // 超限后服务端按设计关连接、进程退出，我们这一侧再往它的 stdin 写就会收到 EPIPE——那正是「连接已关」的证据，
    // 不是测试失败；不接住它，Node 会把这个流错误当未处理异常把整个走查进程打死（2026-10-05 CI 首跑就是这么红的）。
    let stdinClosedByServer = false
    mcp.child.stdin.on('error', (error) => { if (error?.code === 'EPIPE') stdinClosedByServer = true; else throw error })
    mcp.child.stdin.write('x'.repeat(11 * 1024 * 1024))
    for (let waited = 0; waited < 10_000 && !mcp.childExited(); waited += 100) await new Promise((resolve) => setTimeout(resolve, 100))
    // stderr 是**宿主协议面**（stdout 整条给了 JSON-RPC），所以断言连前缀一起钉。
    const errorLine = mcp.stderrText().split(String.fromCharCode(10)).find((line) => line.includes(MCP_TRANSPORT_ERROR_EVENT)) || ''
    check(errorLine.includes('[nomi:mcp]'), 'C5 an oversized read buffer is reported on stderr')
    check(Boolean(mcp.childExited()), `C5 the stdio server closes the connection and exits instead of buffering without bound (stdin EPIPE seen: ${stdinClosedByServer})`)

    console.log('MCP-L1 PASS: C1/C2/C3/C4/C5 green; C6 declaration green (change-source notification is covered by the A1 unit contract).')
  } finally {
    await mcp.terminate()
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1 })
