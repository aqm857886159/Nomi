// Real Electron + real MCP semantic single-shot journey.
//
// This is intentionally a zero-credit provider fixture: the point is to prove
// the user-facing confirmation surface and the durable Run/Artifact handoff,
// not to spend a real provider budget.  The client does not advertise
// elicitation, so the same challenge must appear once in the open Nomi window.
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

import { launchNomiApp } from './_launchApp.mjs'
import { makeIsolatedDirs, parseToolResult, repoRoot, spawnMcpStdioClient } from './_mcpJourney.mjs'
import { writeIsolatedCatalog } from './_mcpJourney.mjs'

const dirs = makeIsolatedDirs('nomi-semantic-gui-fallback-')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/mcp-generation-single-shot-gui-fallback')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

async function startSemanticProvider() {
  const hits = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      hits.push({ method: req.method, url: req.url, body })
      let payload
      if (req.method === 'POST' && req.url === '/v1/images/generations') {
        payload = { code: 200, data: [{ task_id: 'semantic-task-1' }] }
      } else if (req.method === 'GET' && req.url === '/v1/tasks/semantic-task-1') {
        payload = {
          code: 200,
          data: {
            status: 'succeeded',
            result: { images: [{ id: 'semantic-output-1', url: PNG_DATA_URL }] },
          },
        }
      } else {
        payload = { code: 404, message: 'unknown fixture route' }
      }
      const encoded = JSON.stringify(payload)
      res.writeHead(payload.code === 200 ? 200 : 404, { 'content-type': 'application/json' })
      res.end(encoded)
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return {
    origin: `http://127.0.0.1:${address.port}`,
    hits,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

function configureSemanticCatalog(settingsDir, origin) {
  writeIsolatedCatalog(settingsDir, origin)
  const filePath = path.join(settingsDir, 'model-catalog.json')
  const catalog = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  catalog.vendors.find((vendor) => vendor.key === 'apimart').baseUrlHint = origin
  catalog.models.push({
    modelKey: 'gpt-image-2', vendorKey: 'apimart', labelZh: '语义图片模型', kind: 'image', enabled: true,
    onboarding: { addedVia: 'manual', addedAt: new Date().toISOString(), fields: [{ key: 'aspectRatio', displayName: '比例', type: 'select', options: [{ value: '1:1', label: '1:1' }] }] },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  })
  catalog.mappings.push({
    id: 'semantic-apimart-image', vendorKey: 'apimart', modelKey: 'gpt-image-2', taskKind: 'text-to-image', name: 'semantic image', enabled: true,
    create: { method: 'POST', path: '/v1/images/generations', body: {} }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  })
  catalog.apiKeysByVendor.apimart = { vendorKey: 'apimart', apiKey: 'semantic-fixture-key', enc: 'plain', enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  fs.writeFileSync(filePath, JSON.stringify(catalog), 'utf8')
}

function proofFor(token, client) {
  return crypto.createHmac('sha256', token).update(`nomi-mcp-client:v1:${client}`).digest('base64url')
}

let gui
let mcp
let provider
let exitCode = 0
let passed = 0
const check = (condition, message) => {
  if (!condition) throw new Error(`SEMANTIC GUI FALLBACK FAIL: ${message}`)
  passed += 1
  console.log(`  ✓ ${message}`)
}

try {
  provider = await startSemanticProvider()
  configureSemanticCatalog(dirs.settingsDir, provider.origin)
  gui = await launchNomiApp({
    name: 'mcp-generation-single-shot-gui-fallback',
    userDataDir: dirs.userDataDir,
    settingsDir: dirs.settingsDir,
    projectsDir: dirs.projectsDir,
    env: {
      NOMI_CAPABILITY_DIR: dirs.capabilityDir,
      NOMI_MCP_GENERATION_SINGLE_SHOT_V1: '1',
      NOMI_MCP_GENERATION_SINGLE_SHOT_E1_V1: '1',
    },
    args: ['--disable-gpu', '--disable-software-rasterizer'],
    settleMs: 0,
  })
  const window = gui.win
  await window.getByText('新建空白项目', { exact: false }).first().click()
  await window.waitForFunction(() => window.location.hash.includes('projectId='), undefined, { timeout: 10_000 })
  const projectId = await window.evaluate(() => new URLSearchParams(window.location.hash.split('?')[1] || '').get('projectId'))
  check(Boolean(projectId), '当前 Nomi 窗口打开了隔离项目')

  const token = fs.readFileSync(path.join(dirs.capabilityDir, 'token'), 'utf8').trim()
  mcp = spawnMcpStdioClient({
    ...dirs,
    clientInfo: { name: 'Codex semantic GUI fallback', version: 'e2e' },
    capabilities: {},
    env: {
      NOMI_MCP_GENERATION_SINGLE_SHOT_V1: '1',
      NOMI_MCP_GENERATION_SINGLE_SHOT_E1_V1: '1',
      NOMI_MCP_CLIENT: 'codex',
      NOMI_MCP_CLIENT_PROOF: proofFor(token, 'codex'),
    },
  })
  check(Boolean((await mcp.initialize())?.result), 'MCP stdio 与当前 GUI 建立真实握手')

  const opened = parseToolResult(await mcp.callTool('nomi_session_open', {
    bootstrap: { mode: 'current_project', clientSessionNonce: 'semantic-gui-fallback-session' },
  }))
  const leaseHandle = opened.json?.leaseHandle || opened.outcome?.leaseHandle
  check(typeof leaseHandle === 'string' && leaseHandle.length > 20, '一次 session/open 返回可复用的当前项目句柄')
  check(Array.isArray(opened.json?.effectiveScope) && opened.json.effectiveScope.includes('create'), '句柄默认包含零额度规划权限，不要求用户再复制第二个句柄')

  const candidate = {
    candidateId: 'semantic-gui-candidate', revision: 1, moduleId: 'generation.single-shot', providerId: 'apimart', modelId: 'gpt-image-2', mode: 'text-to-image',
    prompt: '一张纸船在湖面上，柔和晨光', parameters: { aspectRatio: '1:1' }, references: [],
  }
  const created = parseToolResult(await mcp.callTool('nomi_operation_plan', { leaseHandle, projectId, candidate }))
  const operationId = created.json?.operation?.operationId || created.outcome?.operation?.operationId
  check(typeof operationId === 'string' && operationId.length > 0, '创建语义单镜草稿且没有触达 provider')
  const preview = parseToolResult(await mcp.callTool('nomi_operation_preview', { leaseHandle, projectId, operationId }))
  check(preview.json?.contract?.providerId === 'apimart' && preview.json?.contract?.modelId === 'gpt-image-2', '预览显示真实目录中的 provider/model')
  check(provider.hits.length === 0, '创建/预览阶段 provider 请求数保持为 0')

  // Let the renderer finish its normal project-persistence tick before the
  // challenge is sealed; a human never experiences a confirmation racing the
  // first project-open write.
  await window.waitForTimeout(1_000)
  const gatePromise = mcp.callTool('nomi_operation_gate', { phase: 'request', leaseHandle, projectId, operationId }, { timeoutMs: 90_000 })
  const gateCard = window.locator('.fixed.inset-0').filter({ hasText: '允许 Nomi 生成这一镜？' })
  await gateCard.waitFor({ timeout: 20_000 })
  check(await gateCard.count() === 1, '不支持 elicitation 的客户端只看到一张 Nomi 语义确认卡')
  const cardText = await gateCard.innerText()
  check(cardText.includes('apimart/gpt-image-2') && cardText.includes('一张纸船'), '确认卡写清模型和这一镜要做什么')
  await window.screenshot({ path: path.join(shotsDir, '01-semantic-gate.png') })
  await gateCard.locator('button').filter({ hasText: '确认生成' }).click()
  const started = parseToolResult(await gatePromise)
  check(!started.isError, '用户在 Nomi 点一次后，原 MCP 请求继续完成')
  check(provider.hits.filter((hit) => hit.method === 'POST').length === 1, '确认后只提交一次 provider 请求')

  const approved = started.outcome?.approved || started.json?.approved || {}
  const upgradedLease = typeof approved.leaseHandle === 'string' ? approved.leaseHandle : leaseHandle
  const reconciled = parseToolResult(await mcp.callTool('nomi_operation_control', { action: 'reconcile', leaseHandle: upgradedLease, projectId, operationId, outcome: 'found' }, { timeoutMs: 90_000 }))
  check(!reconciled.isError, '同一 Run 通过查询恢复，而不是再次提交')
  check(provider.hits.filter((hit) => hit.method === 'POST').length === 1 && provider.hits.filter((hit) => hit.method === 'GET').length === 1, '恢复只查询一次且没有重复扣费提交')
  check(Boolean(reconciled.outcome?.artifactId || reconciled.json?.artifactId || reconciled.json?.artifact?.artifactId), '终态结果落成可持久化 Artifact')

  await window.screenshot({ path: path.join(shotsDir, '02-semantic-complete.png') })
  console.log(`\nSEMANTIC GUI FALLBACK PASS: ${passed} assertions; provider POST=1, GET=1, real quota=0.`)
  console.log('  screenshots →', shotsDir)
} catch (error) {
  console.error(`✗ ${error?.stack || error}`)
  exitCode = 1
} finally {
  await mcp?.terminate().catch(() => undefined)
  await provider?.close().catch(() => undefined)
  await gui?.app?.close().catch(() => undefined)
  setTimeout(() => process.exit(exitCode), 300)
}
