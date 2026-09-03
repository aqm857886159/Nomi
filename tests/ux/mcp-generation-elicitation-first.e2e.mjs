// P4 S3a — elicitation 优先：自声明 elicitation 的客户端确认生成 → **0 张 GUI 卡**（含多镜确认卡）→ 生成真的开始。
//
// 铁律（§3.8）：客户端声明 elicitation → 确认弹在客户端内，Nomi 主窗**不弹任何卡**。多镜确认卡（S3a）
// 只经 confirmGenerationInNomi 这条 GUI 兜底路径弹出（capabilityApplyHandler.confirmGenerationGateForAgent）；
// 而 elicitation 分支（mcpProtocol.ts:274）在**读 display.shots 之前**就抢先接管，根本不会走到渲染层。
// 所以「elicitation 客户端 → 0 GUI 卡」这条不变量对单镜/多镜卡是同一条——多镜卡与单镜卡共用这条兜底门。
//
// Phase B 额外断言（2026-09-03 补，连通盲区）：「gate 返回 confirmed」和「生成真的开始」是两件事。
// 历史上两次分别在两个方向各栽一次（PR #429 / verifyClientGenerationConfirmation 漏接），两次都全绿过单测。
// 本断言直接把「nomi_operation_gate 返回 started:true」钉进走查，让这条盲区再也没有空间存活。
//
// 两阶段（expectAbsent 需阳性基线，_assert.mjs 在签名上强制）：
//   Phase A 基线：**不声明** elicitation 的客户端驱动真 gate → GUI 确认卡真的会浮（proveProbe 证探针活）。
//   Phase B 不变量：**声明** elicitation 的客户端驱动真 gate → 客户端内自动确认 → expectAbsent 断言 0 张 GUI 卡 → started 断言生成进入 execute。
// 全程零额度（provider fixture），不跑真生成。
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

import { launchNomiApp } from './_launchApp.mjs'
import { makeIsolatedDirs, parseToolResult, repoRoot, spawnMcpStdioClient } from './_mcpJourney.mjs'
import { writeFakeApimartCatalog } from './_mcpL2Fixture.mjs'
import { expectAbsent, proveProbe } from './_assert.mjs'

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

async function startSemanticProvider() {
  const hits = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      hits.push({ method: req.method, url: req.url })
      let payload
      if (req.method === 'POST' && req.url === '/v1/images/generations') payload = { code: 200, data: [{ task_id: 'elicit-task-1' }] }
      else if (req.method === 'GET' && req.url === '/v1/tasks/elicit-task-1') payload = { code: 200, data: { status: 'succeeded', result: { images: [{ id: 'elicit-out-1', url: PNG_DATA_URL }] } } }
      else payload = { code: 404, message: 'unknown fixture route' }
      res.writeHead(payload.code === 200 ? 200 : 404, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return { origin: `http://127.0.0.1:${port}`, hits, close: () => new Promise((resolve) => server.close(resolve)) }
}

function proofFor(token, client) {
  return crypto.createHmac('sha256', token).update(`nomi-mcp-client:v1:${client}`).digest('base64url')
}

/** Drive one real gate from a fresh MCP client with the given capabilities; returns the in-flight gate promise. */
async function driveGate(dirs, token, { capabilities, clientName, providerOrigin }) {
  const mcp = spawnMcpStdioClient({
    ...dirs,
    clientInfo: { name: clientName, version: 'e2e' },
    capabilities,
    syntheticCredentialStorage: true,
    env: {
      NOMI_E2E_PRODUCTION_FIXTURE: '1', NOMI_E2E_APIMART_BASE_URL: providerOrigin,
      NOMI_E2E_APIMART_API_KEY: 'semantic-fixture-key',
      NOMI_MCP_GENERATION_SINGLE_SHOT_V1: '1', NOMI_MCP_GENERATION_SINGLE_SHOT_E1_V1: '1',
      NOMI_MCP_CLIENT: 'codex', NOMI_MCP_CLIENT_PROOF: proofFor(token, 'codex'),
    },
  })
  await mcp.initialize()
  const opened = parseToolResult(await mcp.callTool('nomi_session_open', { bootstrap: { mode: 'current_project' } }))
  const leaseHandle = opened.json?.leaseHandle || opened.outcome?.leaseHandle
  const projectId = opened.json?.projectId || opened.outcome?.projectId
  const candidate = {
    candidateId: `elicit-${clientName}`, revision: 1, moduleId: 'generation.single-shot', providerId: 'apimart', modelId: 'gpt-image-2', mode: 'text_to_image',
    prompt: '一只纸鹤停在窗台，晨光', parameters: { aspectRatio: '1:1' }, references: [],
  }
  const created = parseToolResult(await mcp.callTool('nomi_operation_plan', { leaseHandle, projectId, candidate }))
  const operationId = created.json?.operation?.operationId || created.outcome?.operation?.operationId
  await mcp.callTool('nomi_operation_preview', { leaseHandle, projectId, operationId })
  const gatePromise = mcp.callTool('nomi_operation_gate', { phase: 'request', leaseHandle, projectId, operationId }, { timeoutMs: 90_000 }).catch((e) => ({ swallowed: String(e) }))
  return { mcp, gatePromise }
}

const dirs = makeIsolatedDirs('nomi-elicit-first-')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/mcp-generation-elicitation-first')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

let gui
let provider
let mcpA
let mcpB
let exitCode = 0
let passed = 0
const check = (condition, message) => {
  if (!condition) throw new Error(`ELICITATION-FIRST FAIL: ${message}`)
  passed += 1
  console.log(`  ✓ ${message}`)
}

try {
  provider = await startSemanticProvider()
  const seededCatalog = writeFakeApimartCatalog(dirs.settingsDir, dirs.userDataDir, provider.origin, { withKey: false })
  seededCatalog.models = seededCatalog.models.map((model) => model.modelKey === 'gpt-image-2'
    ? { ...model, pricing: { cost: 0, enabled: true, specCosts: [] } }
    : model)
  fs.writeFileSync(path.join(dirs.settingsDir, 'model-catalog.json'), JSON.stringify(seededCatalog), 'utf8')
  gui = await launchNomiApp({
    name: 'mcp-generation-elicitation-first',
    userDataDir: dirs.userDataDir, settingsDir: dirs.settingsDir, projectsDir: dirs.projectsDir, capabilityDir: dirs.capabilityDir,
    env: {
      NOMI_CAPABILITY_DIR: dirs.capabilityDir, NOMI_E2E_PRODUCTION_FIXTURE: '1',
      NOMI_E2E_APIMART_BASE_URL: provider.origin, NOMI_E2E_APIMART_API_KEY: 'semantic-fixture-key',
      NOMI_MCP_GENERATION_SINGLE_SHOT_V1: '1', NOMI_MCP_GENERATION_SINGLE_SHOT_E1_V1: '1',
    },
    args: ['--disable-gpu', '--disable-software-rasterizer'], settleMs: 0, syntheticCredentialStorage: true,
  })
  const win = gui.win
  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForFunction(() => window.location.hash.includes('projectId='), undefined, { timeout: 10_000 })
  await win.waitForTimeout(1_000)
  const token = fs.readFileSync(path.join(dirs.capabilityDir, 'token'), 'utf8').trim()

  // 任意生成确认卡的定位器（单镜与多镜共用这条 GUI 兜底门；标题都含「允许 Nomi 生成」）。
  const gateCard = win.locator('.fixed.inset-0').filter({ hasText: '允许 Nomi 生成' })

  // ── Phase A 基线：不声明 elicitation → GUI 卡真的会浮（证探针活）。──
  const a = await driveGate(dirs, token, { capabilities: {}, clientName: 'no-elicit-client', providerOrigin: provider.origin })
  mcpA = a.mcp
  const probe = await proveProbe(gateCard, '不声明 elicitation 的客户端会让 Nomi 弹一张 GUI 确认卡', 20_000)
  check(true, '基线成立：非 elicitation 客户端 → GUI 生成确认卡确实浮出（探针活）')
  await win.screenshot({ path: path.join(shotsDir, '01-baseline-gui-card.png') })
  // 收掉这张卡（点背景关闭 = 未确认返回），让 Phase B 从干净现场开始。
  await gateCard.locator('button').filter({ hasText: '忽略' }).first().click().catch(() => {})
  await gateCard.waitFor({ state: 'detached', timeout: 8_000 }).catch(() => {})
  await a.gatePromise.catch(() => {})
  await mcpA.terminate().catch(() => {})
  mcpA = null

  // ── Phase B 不变量：声明 elicitation → 客户端内自动确认 → 0 张 GUI 卡 → 生成真的开始。──
  // 2026-09-03 加：「gate 返回 confirmed」和「生成真的开始」是两件事。
  // 历史上有过两次误改：① PR #429 删 clientAttestation → gate 返回 human_approval_required；
  // ② 本次修法前 verifyClientGenerationConfirmation 两装配点都没接 → 同样回 human_approval_required。
  // 本断言连通「确认面返回值」与「生成是否开始」，专门盯住这条盲区（同 mcpGenerationConfirmation.test.ts 注释）。
  const b = await driveGate(dirs, token, { capabilities: { elicitation: {} }, clientName: 'elicit-client', providerOrigin: provider.origin })
  mcpB = b.mcp
  // 给 elicitation 往返 + 「若要弹卡也早该弹了」留足时间：等 gate promise 落地（elicitation 客户端自动 accept）。
  const gateResult = await b.gatePromise
  check(Boolean(gateResult), 'elicitation 客户端的 gate 请求已返回（在客户端内完成确认往返）')
  check(b.mcp.elicitationCount() >= 1, 'elicitation 客户端确实收到并处理了 elicitation/create（在客户端内确认）')
  // 关键断言（补盲区）：gate 确认后生成真的进入 execute——不是退回 human_approval_required。
  // parseToolResult 兼容 json / outcome 两种投影形状。
  const gateResultParsed = parseToolResult(gateResult)
  const gateStarted = gateResultParsed.json?.started ?? gateResultParsed.outcome?.started
  check(Boolean(gateStarted), 'elicitation 客户端确认后生成进入 execute（不返回 human_approval_required）')
  // 关键断言：整条 elicitation 流程走完，Nomi 主窗一张 GUI 卡都没弹（多镜确认卡走同一门，同样不弹）。
  await expectAbsent(gateCard, { provenBy: probe, message: 'elicitation 客户端确认时，Nomi 不该弹任何 GUI 生成确认卡（含多镜卡）' })
  check(true, '不变量成立：elicitation 客户端确认多镜/单镜计划时 0 张 GUI 卡')
  await win.screenshot({ path: path.join(shotsDir, '02-elicitation-no-card.png') })
  const cardCount = await gateCard.count()
  check(cardCount === 0, `确证 GUI 卡计数 = 0（实测 ${cardCount}）`)

  console.log(`\nELICITATION-FIRST PASS: ${passed} 断言；elicitation 抢先接管，0 GUI 卡，生成进入 execute。`)
  console.log('  截图 →', shotsDir)
} catch (error) {
  console.error(`✗ ${error?.stack || error}`)
  exitCode = 1
} finally {
  await mcpA?.terminate().catch(() => undefined)
  await mcpB?.terminate().catch(() => undefined)
  await provider?.close().catch(() => undefined)
  await gui?.app?.close().catch(() => undefined)
  setTimeout(() => process.exit(exitCode), 300)
}
