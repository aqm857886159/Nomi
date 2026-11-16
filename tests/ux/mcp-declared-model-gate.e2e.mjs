// 外部 Agent 交卡后正式生成走到确认 · 真 Electron 端到端，两个真实装配各走一遍（设计卡 docs/plan/2026-11-16-external-agent-gate-reach-confirm.md）。
//
// 用户那次：Agent 在内置 APIMart 上交了一张卡登记新视频模型，草稿建得了，预览说「Unknown model」、过门说没就绪，
// 重启 Nomi 才认。两个宿主以前在启动时各拍一份模型表交给门；现在每次工具调用在入口取一次目录。
//
// 这里先把两个宿主都起来，**之后**才交卡，全程不重启：
//   A 应用内宿主（appIntegration，本机 HTTP 直连）：存密钥 → 交卡 → 起草 → 预览 → 过门 → Nomi 窗口弹确认卡；
//   B stdio 宿主（mcpStdioServer，和 A 同时开着）：再交一张卡 → 起草 → 预览 → 过门 → 同一个窗口弹确认卡。
// 两张确认卡都由脚本点「取消」，不点确认：不发任何生成请求。假密钥只在隔离目录里，测试网闸开着，出不了这台机器。
// 前置：pnpm run build。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

import { launchNomiApp } from './_launchApp.mjs'
import { makeIsolatedDirs, parseToolResult, repoRoot, spawnMcpStdioClient } from './_mcpJourney.mjs'
import { newProjectEntry } from './_shell.mjs'

const dirs = makeIsolatedDirs('nomi-declared-model-gate-')
const shotsDir = process.env.NOMI_WALK_EVIDENCE_DIR || path.join(repoRoot, 'tests/ux/shots/mcp-declared-model-gate')
fs.mkdirSync(shotsDir, { recursive: true })
const FAKE_KEY = 'sk-walk-fake-key-not-real-0000'
const SOURCE = 'https://docs.example.test/api'

function videoCard(modelKey) {
  return JSON.stringify({
    provider: { baseUrl: 'https://api.apimart.ai', authType: 'bearer', authHeader: 'Authorization' },
    sources: [{ url: SOURCE, evidence: 'POST /v1/videos -> {task_id}' }],
    assetIngestion: { strategy: 'none', sourceUrl: SOURCE },
    models: [{ modelKey, labelZh: modelKey, kind: 'video', modes: [{
      taskKind: 'text_to_video', delivery: 'asynchronous',
      create: { method: 'POST', path: '/v1/videos', body: { prompt: '{{request.prompt}}' }, response_mapping: { task_id: 'task_id', status: 'status' }, provider_meta_mapping: { task_id: 'task_id' } },
      query: { method: 'GET', path: '/v1/videos/{{providerMeta.task_id}}', response_mapping: { task_id: 'task_id', status: 'status', video_url: 'video_url' } },
      statusMapping: { failed: ['error'] }, sourceUrls: [SOURCE],
    }] }],
  })
}

function proofFor(token, client) {
  return crypto.createHmac('sha256', token).update(`nomi-mcp-client:v1:${client}`).digest('base64url')
}

async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'))
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`等不到 ${file}（Nomi 没把本机 HTTP 地址写出来）`)
}

let passed = 0
const log = []
const check = (condition, message, detail) => {
  log.push({ ok: Boolean(condition), message, ...(detail === undefined ? {} : { detail }) })
  if (!condition) throw new Error(`DECLARED MODEL GATE FAIL: ${message}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`)
  passed += 1
  console.log(`  ✓ ${message}`)
}

/** 一个宿主的整条路：存密钥 → 交卡 → 起草 → 预览 → 过门 → 窗口弹确认卡 → 点取消。 */
async function walkHost(label, call, window, projectId, modelKey, shot) {
  const opened = await call('nomi_session_open', { bootstrap: { mode: 'current_project' } })
  const leaseHandle = opened.json?.leaseHandle || opened.outcome?.leaseHandle
  check(typeof leaseHandle === 'string', `${label}: 拿到当前项目句柄`, opened.text.slice(0, 600))
  const keyed = await call('nomi_model_setup', { action: 'set_key', vendorKey: 'apimart', apiKey: FAKE_KEY })
  check(!keyed.isError, `${label}: 存 APIMart 密钥`, keyed.text.slice(0, 300))
  const submitted = await call('nomi_model_setup', { action: 'submit_declaration', vendorKey: 'apimart', declaration: videoCard(modelKey) })
  check(!submitted.isError, `${label}: 在内置 APIMart 上交卡登记 ${modelKey}`, submitted.text.slice(0, 400))

  const candidate = { candidateId: `declared-${label}`, revision: 1, moduleId: 'generation.single-shot', providerId: 'apimart', modelId: modelKey, mode: 'text_to_video', prompt: '一只纸船在湖面上，晨光', parameters: {}, references: [] }
  const created = await call('nomi_operation_plan', { leaseHandle, projectId, candidate })
  const operationId = created.json?.operation?.operationId || created.outcome?.operation?.operationId
  check(typeof operationId === 'string', `${label}: 起草成功（不重启）`, created.text.slice(0, 400))
  const preview = await call('nomi_operation_preview', { leaseHandle, projectId, operationId })
  check(!preview.isError && !/Unknown model/i.test(preview.text), `${label}: 预览认得刚交卡的模型（修前这里是「Unknown model」）`, preview.text.slice(0, 400))

  const gatePromise = call('nomi_operation_gate', { phase: 'request', leaseHandle, projectId, operationId }, { timeoutMs: 120_000 })
  const card = window.locator('[data-spend-confirm-dialog]').filter({ hasText: modelKey })
  const raced = await Promise.race([
    card.waitFor({ timeout: 30_000 }).then(() => 'card'),
    gatePromise.then((gate) => ({ gate })),
  ])
  if (raced !== 'card') check(false, `${label}: 过门走到确认卡（修前这里说「没就绪 · configured_provider」）`, raced.gate.text.slice(0, 600))
  check(await card.count() === 1, `${label}: 过门走到确认卡，卡上写着 ${modelKey}（修前这里说「没就绪 · configured_provider」）`)
  await window.screenshot({ path: path.join(shotsDir, `${shot}-confirm-card.png`) })
  await card.locator('[data-spend-confirm-action="cancel"]').click()
  const gate = await gatePromise
  check(!/configured_provider|Unknown model/i.test(gate.text), `${label}: 点取消后门如实收尾，没有回到「没就绪」`, gate.text.slice(0, 400))
  await card.waitFor({ state: 'detached', timeout: 10_000 })
  return { gate: gate.text.slice(0, 400) }
}

let gui
let stdio
let http
let exitCode = 0
const summary = {}
try {
  gui = await launchNomiApp({
    name: 'mcp-declared-model-gate',
    userDataDir: dirs.userDataDir,
    settingsDir: dirs.settingsDir,
    projectsDir: dirs.projectsDir,
    capabilityDir: dirs.capabilityDir,
    syntheticCredentialStorage: true,
    env: { NOMI_CAPABILITY_DIR: dirs.capabilityDir, NOMI_MCP_HTTP_PORT: '0' },
    args: ['--disable-gpu', '--disable-software-rasterizer'],
    settleMs: 0,
  })
  const window = gui.win
  await newProjectEntry(window).click()
  await window.waitForFunction(() => window.location.hash.includes('projectId='), undefined, { timeout: 10_000 })
  const projectId = await window.evaluate(() => new URLSearchParams(window.location.hash.split('?')[1] || '').get('projectId'))
  check(Boolean(projectId), '隔离的 Nomi 窗口打开了一个新项目')
  const token = fs.readFileSync(path.join(dirs.capabilityDir, 'token'), 'utf8').trim()

  // 两个宿主都先起来，再交卡。
  const endpoint = await waitForFile(path.join(dirs.capabilityDir, 'mcp-http.json'), 60_000)
  const transport = new StreamableHTTPClientTransport(new URL(endpoint.url), {
    requestInit: { headers: { 'x-nomi-mcp-client': 'codex', 'x-nomi-mcp-client-proof': proofFor(token, 'codex') } },
  })
  http = new Client({ name: 'declared-model-gate-inapp', version: 'e2e' })
  await http.connect(transport)
  check(http.getServerVersion()?.name === 'nomi-capability-core', '应用内宿主（本机 HTTP）握手成功')
  stdio = spawnMcpStdioClient({
    ...dirs,
    clientInfo: { name: 'declared-model-gate-stdio', version: 'e2e' },
    capabilities: {},
    env: { NOMI_MCP_CLIENT: 'codex', NOMI_MCP_CLIENT_PROOF: proofFor(token, 'codex'), NOMI_TEST_NETWORK_GUARD: '1' },
  })
  check(Boolean((await stdio.initialize())?.result), 'stdio 宿主握手成功（与应用内宿主同时开着）')

  const callHttp = async (name, args, { timeoutMs = 60_000 } = {}) => parseToolResult(await http.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs }))
  const callStdio = async (name, args, opts) => parseToolResult(await stdio.callTool(name, args, opts))
  summary.inApp = await walkHost('应用内宿主', callHttp, window, projectId, 'muse-video-x', '01-inapp')
  summary.stdio = await walkHost('stdio 宿主', callStdio, window, projectId, 'muse-video-y', '02-stdio')
  console.log(`\nDECLARED MODEL GATE PASS: ${passed} 条断言；两个宿主都不重启走到确认卡，都点了取消，生成请求 0。`)
} catch (error) {
  console.error(`✗ ${error?.stack || error}`)
  exitCode = 1
} finally {
  fs.writeFileSync(path.join(shotsDir, 'journey.json'), JSON.stringify({ passed, exitCode, log, summary }, null, 2))
  await stdio?.terminate().catch(() => undefined)
  await http?.close().catch(() => undefined)
  await gui?.app?.close().catch(() => undefined)
  setTimeout(() => process.exit(exitCode), 300)
}
