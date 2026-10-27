import { makeTempDir } from '../../scripts/_test-temp.mjs'
// R13/R16 走查：「AI 助手连接」卡的连接状态要和真实使用对得上（docs/plan/2026-10-05-mcp-official-sdk.md 第 4 段）。
// 真 Electron，窗口全挪到屏幕外；HOME 指向临时目录（宿主配置只写临时目录，绝不碰真机的 Claude / Codex / Cursor 配置）。
//
// 用户旅程：
//   ① 用户在卡上点「一键接入 Claude Code」→ 状态框是「已写入配置 · 重启后生效」，徽章「等你完成接入」；
//   ② 一个最小的 MCP 客户端（官方 SDK，带上卡写进配置的那组身份）连上本机地址、调一个只读工具（读项目列表）
//      → 卡上变成「正在使用 · 刚刚调用了「读取项目与制作状态」· 这次会话已调用 1 次工具」，徽章「正在使用」，标签圆点绿；
//   ③ 点「测试连接」（Nomi 自己握手一次）→ 框里出现「刚刚测试过：连得上」，而且**不算助手来过**：调用次数仍是 1；
//   ④ 口令错的客户端连不上，也不会让次数增加；
//   ⑤ 同一个客户端断开再重连、再调一次 → 次数累加到 2（账本跨连接，只在 Nomi 重启时清零）。
//
// 用法：node tests/ux/mcp-connection-status.walk.mjs [--shots-out=<dir>]
// 前置：pnpm run build（要 dist/ 与 dist-electron/）。不调模型、不花钱。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { launchNomiApp } from './_launchApp.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { clickOrFail, screenshotSettled } from './_assert.mjs'
import { newProjectEntry, settingsDialog } from './_shell.mjs'
import { repoRoot } from './_mcpJourney.mjs'
import { uiText } from './full-walk/invariants.mjs'

const shotsDir = path.resolve(process.argv.find((arg) => arg.startsWith('--shots-out='))?.split('=').slice(1).join('=')
  || 'tests/ux/shots/mcp-connection-status')
fs.mkdirSync(shotsDir, { recursive: true })
const tempRoot = makeTempDir('nomi-mcp-status-walk-')
const testHome = path.join(tempRoot, 'home')
fs.mkdirSync(path.join(testHome, '.claude'), { recursive: true })
// 空目录不算「装了」：Cursor 的安装痕迹要放一个文件。
fs.mkdirSync(path.join(testHome, '.cursor'), { recursive: true })
fs.writeFileSync(path.join(testHome, '.cursor', 'argv.json'), '{}')
fs.writeFileSync(path.join(testHome, '.claude.json'), JSON.stringify({ mcpServers: {} }, null, 2))
const capabilityDir = path.join(tempRoot, 'capability')
fs.mkdirSync(capabilityDir, { recursive: true })
const token = crypto.randomBytes(24).toString('hex')
fs.writeFileSync(path.join(capabilityDir, 'token'), token, { mode: 0o600 })
const proofFor = (client) => crypto.createHmac('sha256', token).update(`nomi-mcp-client:v1:${client}`).digest('base64url')

async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'))
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`等不到 ${file}（Nomi 没把本机 HTTP 地址写出来）`)
}

async function connectAssistant(url, client, proof) {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { 'x-nomi-mcp-client': client, 'x-nomi-mcp-client-proof': proof } },
  })
  const assistant = new Client({ name: 'claude-code', version: '9.9.9' })
  await assistant.connect(transport)
  return assistant
}

let launched
async function snap(win, name) {
  const target = path.join(shotsDir, `${name}.png`)
  await screenshotSettled(win, { path: target })
  console.log(`shot ${target}`)
}
async function openPanel(win) {
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab: 'automation', section: 'automation' } })))
  const settings = settingsDialog(win)
  await expect(settings).toBeVisible()
  await clickOrFail(settings.locator('[data-settings-action="manage-mcp-connections"]'), 'Manage MCP connections')
  const panel = settings.locator('[data-settings-section="mcp-assistant-connections"]')
  await expect(panel).toBeVisible()
  return panel
}

try {
  launched = await launchNomiApp({
    name: 'mcp-connection-status', tempRoot, capabilityDir,
    // Windows 的主目录看 USERPROFILE 不看 HOME：两个都指临时目录，否则配置会解析到真机主目录（然后被隔离保护拒绝写入）。
    env: { HOME: testHome, USERPROFILE: testHome, APPDATA: path.join(testHome, 'AppData', 'Roaming'), NOMI_MCP_HTTP_PORT: '0' }, settleMs: 0,
    mainRequire: [path.join(repoRoot, 'tests', 'ux', '_quietWalk.cjs')],
    initialLocalStorage: {
      'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen',
      'nomi:canvas-gesture-hint:v1': 'seen', 'nomi.onboarding.scene3dCoach.v1': 'seen',
      'nomi:locale:v1': 'zh-CN', 'nomi-color-scheme': 'light',
    },
  })
  const { win } = launched
  await win.setViewportSize({ width: 1180, height: 820 })
  await clickOrFail(newProjectEntry(win), 'Open a blank project')
  await expect(win.getByText(/创作助手|Creative assistant/).first()).toBeVisible({ timeout: stationTimeout({ operations: 1 }) })
  const endpoint = await waitForFile(path.join(capabilityDir, 'mcp-http.json'), 60_000)

  // ① 接入：写了配置，助手还没来过。
  let panel = await openPanel(win)
  await clickOrFail(panel.getByRole('button', { name: /一键接入 Claude Code|Connect to Claude Code/ }), 'Connect Claude Code')
  const written = panel.locator('[data-assistant-status="written"]')
  await expect(written).toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
  await expect(written).toContainText(/重启 Claude Code 后生效|Restart Claude Code/)
  await expect(panel.locator('[data-assistant-dot="yellow"]').first()).toBeVisible() // board:McpConnectionStatus/status.client-dot
  await expect(written).toContainText(/配置能用：\d+ 个工具可用/) // board:McpConnectionStatus/box.written
  await expect(panel.getByText(uiText('zh-CN', 'onboardingProviders.assistant.status.pending'), { exact: true })).toBeVisible() // board:McpConnectionStatus/status.header-badge
  await expect(panel.locator('[data-assistant-open-nomi-first]')).toBeVisible() // board:McpConnectionStatus/footer.open-nomi-first
  await snap(win, 'zh-light-01-written')

  // ② 助手来了：连上、调一个只读工具。
  const assistant = await connectAssistant(endpoint.url, 'claude', proofFor('claude'))
  const read = await assistant.callTool({ name: 'nomi_read', arguments: { target: 'projects' } })
  assert.notEqual(read.isError, true, 'the read-only tool call must succeed')
  const using = panel.locator('[data-assistant-status="using"]')
  await expect(using).toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
  await expect(using).toContainText('刚刚调用了「读取项目与制作状态」') // board:McpConnectionStatus/box.using
  await expect(panel.getByText(uiText('zh-CN', 'onboardingProviders.assistant.status.using'), { exact: true }).first()).toBeVisible()
  await expect(using).toContainText('这次会话已调用 1 次工具')
  await expect(panel.locator('[data-assistant-dot="green"]').first()).toBeVisible()
  await snap(win, 'zh-light-02-using')

  // ③ 测试连接：Nomi 自己握手，不算助手来过。
  await clickOrFail(panel.locator('[data-assistant-test]'), 'Run the connection test')
  await expect(panel.locator('[data-assistant-test-result]')).toBeVisible({ timeout: stationTimeout({ operations: 2 }) }) // board:McpConnectionStatus/test.connection
  await expect(using).toContainText('这次会话已调用 1 次工具')
  await snap(win, 'zh-light-03-test-ok')

  // ④ 口令错：连不上，次数不变。
  let rejected = false
  try { await connectAssistant(endpoint.url, 'claude', 'not-a-proof') } catch { rejected = true }
  assert.equal(rejected, true, 'a client with a wrong proof must not connect')
  await expect(using).toContainText('这次会话已调用 1 次工具')

  // ⑤ 断开再重连：次数累加。
  await assistant.close()
  const again = await connectAssistant(endpoint.url, 'claude', proofFor('claude'))
  await again.callTool({ name: 'nomi_read', arguments: { target: 'projects' } })
  await expect(using).toContainText('这次会话已调用 2 次工具', { timeout: stationTimeout({ operations: 2 }) })
  await again.close()

  // 宿主自己还要批准一次的 Cursor：接入后是「等你在 Cursor 里打开」，没有「重启」一句。
  await clickOrFail(panel.locator('label', { hasText: 'Cursor' }).first(), 'Select Cursor tab')
  await clickOrFail(panel.getByRole('button', { name: /一键接入 Cursor|Connect to Cursor/ }), 'Connect Cursor')
  const approval = panel.locator('[data-assistant-status="host-approval"]')
  await expect(approval).toBeVisible({ timeout: stationTimeout({ operations: 2 }) }) // board:McpConnectionStatus/box.host-approval
  await expect(approval).not.toContainText('重启')
  await snap(win, 'zh-light-03b-cursor-host-approval')
  await clickOrFail(panel.locator('label', { hasText: 'Claude Code' }).first(), 'Select Claude Code tab')

  // 英文暗色各一张：同一个状态，换语言换配色。
  await win.evaluate(() => { window.localStorage.setItem('nomi:locale:v1', 'en'); window.localStorage.setItem('nomi-color-scheme', 'dark') })
  await win.reload()
  await expect(win.getByRole('navigation', { name: /Switch workspace|切换工作区/ })).toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
  panel = await openPanel(win)
  await expect(panel.locator('[data-assistant-status="using"], [data-assistant-status="recent"]')).toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
  await snap(win, 'en-dark-04-after-reconnect')
  console.log('MCP CONNECTION STATUS WALK PASS: written -> using (real tool call) -> test connection not counted -> bad proof not counted -> reconnect accumulates')
} finally {
  if (launched) await launched.close()
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
