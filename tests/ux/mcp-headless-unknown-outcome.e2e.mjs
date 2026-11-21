// 创作者关掉 Nomi 之后，外部助手读一个「结果未知」的生成任务，仍要被告知别再发一次。
//
// 真实处境：Nomi 开着时助手发了一镜，供应商收下请求后连接断了（可能已经扣费），这一镜记成「结果未知」。
// 创作者关了 Nomi。助手接着读任务状态——这时回话的是独立进程那个宿主（应用开着时是转给应用回的）。
// 两个宿主必须说同一句：「这一镜结果未知，别再 generate，请用户去后台核对」。
// 应用没开时这个宿主自己发不出去（没有画布可落，拒发），所以害处不是它再发一次，而是助手读到一句
// 「还在等」，回头让用户以为没事，或者等 Nomi 再开时照这句话重新发。
//
// 两段：① 应用开着：发、断线、读——点名了结果未知的镜（基线，证明前提成立）；
//       ② 关掉应用：新连一个独立进程读同一个任务——必须点名同一镜。
// 全程零额度：供应商是本机假服务，收下请求体后直接掐断连接。
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

import crypto from 'node:crypto'

import { launchNomiApp } from './_launchApp.mjs'
import { makeIsolatedDirs, parseToolResult, spawnMcpStdioClient } from './_mcpJourney.mjs'
import { writeFakeApimartCatalog } from './_mcpL2Fixture.mjs'
import { newProjectEntry } from './_shell.mjs'

async function startDroppingProvider() {
  const hits = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      hits.push({ method: req.method, url: req.url, bytes: body.length })
      // 收下了，不回话，掐线：发的人不知道对面有没有处理。
      if (req.method === 'POST') { res.socket?.destroy(); return }
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ code: 404, message: 'unknown fixture route' }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return { origin: `http://127.0.0.1:${port}`, hits, close: () => new Promise((resolve) => server.close(resolve)) }
}

const dataOf = (result) => {
  const parsed = parseToolResult(result)
  return { ...(parsed.outcome || {}), ...(parsed.json || {}), __text: parsed.text, __isError: parsed.isError }
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const dirs = makeIsolatedDirs('nomi-headless-unknown-')
let provider
let gui
let mcp
let exitCode = 0
let passed = 0
const check = (condition, message) => {
  if (!condition) throw new Error(`HEADLESS-UNKNOWN FAIL: ${message}`)
  passed += 1
  console.log(`  ✓ ${message}`)
}
const proofFor = (token, client) => crypto.createHmac('sha256', token).update(`nomi-mcp-client:v1:${client}`).digest('base64url')
const fixtureEnv = (origin) => ({
  NOMI_E2E_PRODUCTION_FIXTURE: '1', NOMI_E2E_FIXTURE_BASE_URL: origin, NOMI_E2E_FIXTURE_API_KEY: 'semantic-fixture-key',
  NOMI_TEST_NETWORK_GUARD: '1', NO_PROXY: '127.0.0.1,localhost',
})
const readOperation = async (client, args) => {
  const read = dataOf(await client.callTool('nomi_read', { target: 'operation', ...args }))
  return { nextAction: read.nextAction, unknownShots: read.unknownShots, executionState: read.executionState, text: read.__text.slice(0, 300) }
}

try {
  provider = await startDroppingProvider()
  writeFakeApimartCatalog(dirs.settingsDir, dirs.userDataDir, provider.origin, { withKey: false })

  // ── ① 应用开着 ──
  gui = await launchNomiApp({
    name: 'mcp-headless-unknown-outcome',
    userDataDir: dirs.userDataDir, settingsDir: dirs.settingsDir, projectsDir: dirs.projectsDir, capabilityDir: dirs.capabilityDir,
    env: { NOMI_CAPABILITY_DIR: dirs.capabilityDir, ...fixtureEnv(provider.origin) },
    args: ['--disable-gpu', '--disable-software-rasterizer'], settleMs: 0, syntheticCredentialStorage: true,
  })
  await newProjectEntry(gui.win).click()
  await gui.win.waitForFunction(() => window.location.hash.includes('projectId='), undefined, { timeout: 10_000 })
  await gui.win.waitForTimeout(1_000)
  const token = fs.readFileSync(path.join(dirs.capabilityDir, 'token'), 'utf8').trim()
  const clientEnv = { ...fixtureEnv(provider.origin), NOMI_MCP_CLIENT: 'codex', NOMI_MCP_CLIENT_PROOF: proofFor(token, 'codex') }
  const spawnClient = (name) => spawnMcpStdioClient({
    ...dirs, clientInfo: { name, version: 'e2e' }, capabilities: { elicitation: {} },
    syntheticCredentialStorage: true, captureStderr: true, env: clientEnv,
  })

  mcp = spawnClient('unknown-outcome-app-open')
  await mcp.initialize()
  const opened = dataOf(await mcp.callTool('nomi_session_open', { bootstrap: { mode: 'current_project' } }))
  const leaseHandle = opened.leaseHandle
  const projectId = opened.projectId
  check(Boolean(leaseHandle && projectId), '应用开着：拿到会话句柄')
  const candidate = {
    candidateId: 'unknown-outcome', revision: 1, moduleId: 'generation.single-shot', providerId: 'apimart', modelId: 'gpt-image-2', mode: 'text_to_image',
    prompt: '一只纸鹤停在窗台，晨光', parameters: { aspectRatio: '1:1' }, references: [],
  }
  const created = dataOf(await mcp.callTool('nomi_operation_plan', { leaseHandle, projectId, candidate }))
  const operationId = created.operation?.operationId
  check(Boolean(operationId), '建了草稿')
  await mcp.callTool('nomi_operation_preview', { leaseHandle, projectId, operationId })
  const gate = dataOf(await mcp.callTool('nomi_operation_gate', { phase: 'request', leaseHandle, projectId, operationId }, { timeoutMs: 90_000 }).catch((error) => ({ structuredContent: { nomiOutcome: { swallowed: String(error) } } })))
  console.log('  gate 回话 =', JSON.stringify({ started: gate.started, nextAction: gate.nextAction, swallowed: gate.swallowed, text: (gate.__text || '').slice(0, 200) }))

  // 基线：应用开着时读得到「结果未知」——这是前提，不成立后面的断言就是空的（轮询到它出现，最多 60 秒）。
  let whileOpen = {}
  for (let attempt = 0; attempt < 60; attempt += 1) {
    whileOpen = await readOperation(mcp, { leaseHandle, projectId, operationId })
    if (Array.isArray(whileOpen.unknownShots) && whileOpen.unknownShots.length > 0) break
    await delay(1_000)
  }
  console.log('  供应商收到 =', JSON.stringify(provider.hits))
  console.log('  应用开着时读任务 =', JSON.stringify(whileOpen))
  check(provider.hits.some((hit) => hit.method === 'POST'), '供应商确实收到了这次提交（然后断线）')
  check(Array.isArray(whileOpen.unknownShots) && whileOpen.unknownShots.length === 1 && whileOpen.nextAction === 'ask_user_to_check_provider_do_not_generate',
    '基线：应用开着时，读任务点名了结果未知的那一镜，下一步是「请用户去后台核对，别再 generate」')

  // ── ② 创作者关掉 Nomi ──
  await mcp.terminate().catch(() => undefined)
  mcp = null
  await gui.app.close()
  gui = null
  await delay(1_500)

  mcp = spawnClient('unknown-outcome-app-closed')
  await mcp.initialize()
  const projects = dataOf(await mcp.callTool('nomi_read', { target: 'projects' }))
  const row = (projects.projects || []).find((item) => item.id === projectId)
  check(Boolean(row?.projectSelectionHandle), '应用关着：独立进程列得出这个项目')
  const reopened = dataOf(await mcp.callTool('nomi_session_open', { projectSelectionHandle: row.projectSelectionHandle }))
  check(Boolean(reopened.leaseHandle), '应用关着：拿到会话句柄')
  const whileClosed = await readOperation(mcp, { leaseHandle: reopened.leaseHandle, projectId, operationId })
  console.log('  应用关着时读任务 =', JSON.stringify(whileClosed))
  check(Array.isArray(whileClosed.unknownShots) && whileClosed.unknownShots.length === 1, `应用关着：读任务点名了结果未知的那一镜（实测 unknownShots=${JSON.stringify(whileClosed.unknownShots)}）`)
  check(whileClosed.nextAction === 'ask_user_to_check_provider_do_not_generate', `应用关着：下一步是「请用户去后台核对，别再 generate」（实测 ${whileClosed.nextAction}）`)

  console.log(`\nHEADLESS-UNKNOWN PASS: ${passed} 断言。`)
} catch (error) {
  console.error(`✗ ${error?.stack || error}`)
  if (mcp?.stderrText) console.error("  独立进程 stderr 尾部 =", String(mcp.stderrText()).slice(-1500))
  exitCode = 1
} finally {
  await mcp?.terminate().catch(() => undefined)
  await gui?.app?.close().catch(() => undefined)
  await provider?.close().catch(() => undefined)
  setTimeout(() => process.exit(exitCode), 300)
}
