import { makeTempDir } from '../../scripts/_test-temp.mjs'
// MCP 本机 HTTP 直连 · 真 Electron 端到端（设计卡 docs/plan/2026-10-05-mcp-official-sdk.md 第 2 段）。
//
// 起一个**隔离**的真 Nomi（GUI 模式，窗口全挪到屏幕外、不抢焦点），用官方 SDK 的客户端当宿主：
//   H1 直连 http://127.0.0.1:<端口>/mcp 握手 → 列工具 → 调一个不花钱的工具（建项目）→ 读 widget 资源；
//   H2 没带身份 → 同一帧 -32001；Host / Origin 不是本机 → 403（防 DNS 重绑定）；
//   H3 Desktop 转发口：用 Electron 自带的 Node（ELECTRON_RUN_AS_NODE=1，与打包后宿主拉起它的方式相同）跑编译产物，
//      stdio 进、HTTP 出，同样握手 → 列工具 → 建项目。
// 隔离：capability / 项目 / 设置 / userData 全在临时目录；HTTP 端口随机（NOMI_MCP_HTTP_PORT=0），不抢默认端口，
// 不连用户开着的真 Nomi，不碰 ~/.nomi。不调任何模型、不花钱。
// 前置：pnpm run build（走查要 dist/ 与 dist-electron/）。
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { require as tsxRequire } from 'tsx/cjs/api'

import { launchNomiApp } from './_launchApp.mjs'
import { repoRoot } from './_mcpJourney.mjs'

const require = createRequire(import.meta.url)
const { MCP_TOOL_NAMES } = tsxRequire('../../electron/capabilityCore/mcpProtocol.ts', import.meta.url)

const results = []
function check(condition, message) {
  if (!condition) throw new Error(`MCP-HTTP FAIL: ${message}`)
  results.push(message)
  console.log(`✓ ${message}`)
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

function rawStatus(port, headers, body) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers }, (response) => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { text += chunk })
      response.on('end', () => resolve({ status: response.statusCode, text }))
    })
    request.on('error', reject)
    request.end(body)
  })
}

function projectNames(projectsDir) {
  const names = []
  const walk = (dir, depth) => {
    if (depth > 3 || !fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, depth + 1)
      else if (entry.name === 'project.json') {
        try { names.push(JSON.parse(fs.readFileSync(full, 'utf8')).name) } catch { /* 不是我们要的 */ }
      }
    }
  }
  walk(projectsDir, 0)
  return names
}

async function exerciseClient(label, transport, projectsDir) {
  const client = new Client({ name: `nomi-http-e2e-${label}`, version: '1.0.0' })
  await client.connect(transport)
  check(client.getServerVersion()?.name === 'nomi-capability-core', `${label}: 握手成功，对端是 Nomi`)
  const { tools } = await client.listTools()
  check(JSON.stringify(tools.map((tool) => tool.name)) === JSON.stringify(MCP_TOOL_NAMES), `${label}: tools/list 与目录一致（${tools.length} 个工具）`)
  const projectName = `MCP HTTP ${label} ${crypto.randomUUID().slice(0, 8)}`
  const created = await client.callTool({ name: 'nomi_project_create', arguments: { name: projectName } })
  check(created.isError !== true, `${label}: 不花钱的工具（建项目）调用成功`)
  check(projectNames(projectsDir).includes(projectName), `${label}: 项目真的落到了隔离的项目目录`)
  let unknownCode = null
  // unknown-tool-probe：故意调不存在的工具验 -32602，不是忘了跟进面收敛（见 check:mcp-tool-refs）。
  try { await client.callTool({ name: 'nomi_not_a_real_tool', arguments: {} }) } catch (error) { unknownCode = error?.code }
  check(unknownCode === -32602, `${label}: 未知工具回协议级 -32602`)
  return client
}

async function main() {
  const tempRoot = makeTempDir('nomi-mcp-http-e2e-')
  const capabilityDir = path.join(tempRoot, 'capability')
  fs.mkdirSync(capabilityDir, { recursive: true })
  const token = crypto.randomBytes(24).toString('hex')
  fs.writeFileSync(path.join(capabilityDir, 'token'), token, { mode: 0o600 })

  const nomi = await launchNomiApp({
    name: 'mcp-http-direct',
    tempRoot,
    capabilityDir,
    env: { NOMI_MCP_HTTP_PORT: '0' },
    mainRequire: [path.join(repoRoot, 'tests', 'ux', '_offscreenWindows.cjs')],
    settleMs: 500,
  })
  try {
    // 系统会把过远的坐标夹到它允许的最小值（Windows 上约 -16384），所以按「和任何一块屏幕都不相交」判，不按具体数字判。
    const placement = await nomi.app.evaluate(({ BrowserWindow, screen }) => {
      const displays = screen.getAllDisplays().map((display) => display.bounds)
      const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
      return BrowserWindow.getAllWindows().map((win) => ({ bounds: win.getBounds(), onScreen: displays.some((display) => intersects(win.getBounds(), display)) }))
    })
    check(placement.length > 0 && placement.every((item) => !item.onScreen), `Nomi 的窗口都不在任何一块屏幕上（${JSON.stringify(placement.map((item) => item.bounds))}），不打扰正在用电脑的人`)
    const endpoint = await waitForFile(path.join(capabilityDir, 'mcp-http.json'), 60_000)
    check(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(endpoint.url), `Nomi 只在 127.0.0.1 上开了 MCP 端点（${endpoint.url}）`)

    // H1 · 宿主直连
    const direct = new StreamableHTTPClientTransport(new URL(endpoint.url), {
      requestInit: { headers: { 'x-nomi-mcp-client': 'codex', 'x-nomi-mcp-client-proof': proofFor(token, 'codex') } },
    })
    const directClient = await exerciseClient('直连', direct, nomi.projectsDir)
    const widget = await directClient.readResource({ uri: 'ui://nomi/live-draft.html' })
    check(widget.contents?.[0]?.mimeType === 'text/html;profile=mcp-app', '直连: MCP Apps 活面板资源可读')
    await direct.terminateSession()
    await directClient.close()

    // H2 · 认人与防重绑定
    const initialize = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'anon', version: '1' } } })
    const baseHeaders = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
    const anonymous = await rawStatus(endpoint.port, baseHeaders, initialize)
    check(JSON.parse(anonymous.text)?.error?.code === -32001, '没带身份 → -32001（与 stdio 同一帧）')
    const signed = { ...baseHeaders, 'x-nomi-mcp-client': 'codex', 'x-nomi-mcp-client-proof': proofFor(token, 'codex') }
    const rebound = await rawStatus(endpoint.port, { ...signed, host: `evil.example:${endpoint.port}` }, initialize)
    check(rebound.status === 403, 'Host 不是本机（DNS 重绑定）→ 403')
    const webOrigin = await rawStatus(endpoint.port, { ...signed, origin: 'https://evil.example' }, initialize)
    check(webOrigin.status === 403, '网页来源 Origin → 403')

    // H3 · Desktop 转发口（Electron 自带 Node 跑编译产物，与打包后宿主拉起它的方式相同）
    const forwarder = new StdioClientTransport({
      command: require('electron'),
      args: [path.join(repoRoot, 'dist-electron', 'capabilityCore', 'mcpHttpForwarder.js')],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NOMI_CAPABILITY_DIR: capabilityDir,
        NOMI_MCP_CLIENT: 'claude',
        NOMI_MCP_CLIENT_PROOF: proofFor(token, 'claude'),
      },
      stderr: 'pipe',
    })
    const forwardedClient = await exerciseClient('Desktop 转发口', forwarder, nomi.projectsDir)
    await forwardedClient.close()

    console.log(`MCP-HTTP PASS: ${results.length} 条断言`)
  } finally {
    await nomi.close()
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1 })
