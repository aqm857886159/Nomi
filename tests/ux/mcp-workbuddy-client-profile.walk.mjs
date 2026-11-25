import { makeTempDir } from '../../scripts/_test-temp.mjs'
// R13/R16: Pi 客户端走查的 WorkBuddy 版本，固定跑本分支开发构建。
// 用户旅程：设置 → MCP → 一键接入 → 重开仍配置 → 撤销。
// 只在隔离 HOME 里跑。以前的 --real-workbuddy 把用户真实的 ~/.workbuddy 链进来、写完再还原——走查不碰用户真实资料
// （scripts/check-test-temp-static.node-test.mjs 拦），真宿主上的核对归 tests/system/mcp-real-client.mjs。
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { launchNomiApp } from './_launchApp.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { clickOrFail, screenshotSettled } from './_assert.mjs'
import { closeSettings, ensureAgentPanelOpen, newProjectEntry, openSettings } from './_shell.mjs'
import { uiTextWith } from './full-walk/invariants.mjs'
import { assertOutsideRepo } from './uiDriverOptions.mjs'

const tempRoot = makeTempDir('nomi-mcp-workbuddy-walk-')
const shotsDir = assertOutsideRepo(makeTempDir('nomi-mcp-workbuddy-evidence-'))
process.env.EVIDENCE_DIR = shotsDir
const testHome = path.join(tempRoot, 'home')
fs.mkdirSync(testHome)
const workbuddyDir = path.join(testHome, '.workbuddy')
fs.mkdirSync(workbuddyDir)
const configPath = path.join(workbuddyDir, 'mcp.json')
const internalPath = path.join(workbuddyDir, '.mcp.json')
fs.writeFileSync(configPath, JSON.stringify({ mcpServers: {
  chatcut_desktop: { command: '/fixture/chatcut', env: { CHATCUT_FIXTURE: 'preserve-me' } },
} }, null, 2))
fs.writeFileSync(internalPath, '{"internal":"do-not-touch"}')
const snapshot = (file) => fs.existsSync(file) ? fs.readFileSync(file) : null
const beforeInternal = snapshot(internalPath)
const before = JSON.parse(fs.readFileSync(configPath, 'utf8'))
assert(!before.mcpServers?.nomi, 'This walk requires no pre-existing nomi entry; leave existing connections untouched')
let launched
async function snap(win, name) {
  await screenshotSettled(win, { path: path.join(shotsDir, `${name}.png`) })
}
async function openMcpPanel(win) {
  const settings = await openSettings(win, { tab: 'automation' })
  await clickOrFail(settings.locator('[data-settings-action="manage-mcp-connections"]'), 'Manage MCP connections')
  const panel = settings.locator('[data-settings-section="mcp-assistant-connections"]')
  await expect(panel).toBeVisible()
  const clients = panel.getByRole('radiogroup')
  await clickOrFail(clients.locator('label').filter({ hasText: 'WorkBuddy' }), 'WorkBuddy client')
  await expect(clients.getByRole('radio', { name: /WorkBuddy/ })).toBeChecked()
  return panel
}
const clientCopy = (key) => uiTextWith('zh-CN', `onboardingProviders.assistant.${key}`, { client: 'WorkBuddy' })
const connectButton = (panel) => panel.getByRole('button', { name: clientCopy('connect'), exact: true })
const writtenStatus = (panel) => panel.locator('[data-assistant-status="written"]').getByText(clientCopy('box.writtenTitle'), { exact: true })
try {
  launched = await launchNomiApp({
    name: 'mcp-workbuddy-client-profile', tempRoot,
    // Windows 的主目录看 USERPROFILE 不看 HOME（同 mcp-connection-status）：只换 HOME，App 在 Windows 上读写的是真机配置。
    env: { HOME: testHome, USERPROFILE: testHome, APPDATA: path.join(testHome, 'AppData', 'Roaming') }, settleMs: 0,
    initialLocalStorage: {
      'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen',
      'nomi:canvas-gesture-hint:v1': 'seen', 'nomi.onboarding.scene3dCoach.v1': 'seen',
      'nomi:locale:v1': 'zh-CN', 'nomi-color-scheme': 'light',
    },
  })
  const { win } = launched
  await win.setViewportSize({ width: 1180, height: 820 })
  await clickOrFail(newProjectEntry(win), 'New blank project')
  await ensureAgentPanelOpen(win)
  let panel = await openMcpPanel(win)
  const connect = connectButton(panel)
  await expect(connect).toBeVisible()
  await snap(win, 'zh-light-workbuddy-before-connect')
  await clickOrFail(connect, 'Connect WorkBuddy')
  await expect(writtenStatus(panel)).toBeVisible({ timeout: stationTimeout({ operations: 1 }) })
  const after = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const { nomi, ...others } = after.mcpServers
  assert.deepEqual(others, before.mcpServers || {}, 'existing servers were changed')
  const info = await win.evaluate(() => window.nomiDesktop.capability.mcpInfo())
  assert.deepEqual(nomi, JSON.parse(info.clients.workbuddy.snippet).mcpServers.nomi)
  assert.equal(nomi.env.NOMI_MCP_CLIENT, 'workbuddy')
  assert.equal(info.clients.workbuddy.installed, true)
  assert.equal(info.clients.workbuddy.appInstalled, true)
  assert.deepEqual(snapshot(internalPath), beforeInternal)
  await snap(win, 'zh-light-workbuddy-after-connect')
  // 真关闭设置再打开，避免只看安装回调的临时状态。
  await closeSettings(win)
  panel = await openMcpPanel(win)
  await expect(writtenStatus(panel)).toBeVisible({ timeout: stationTimeout({ operations: 1 }) })
  await snap(win, 'zh-light-workbuddy-reopened')
  await clickOrFail(panel.getByRole('button', { name: clientCopy('disconnect'), exact: true }), 'Disconnect WorkBuddy')
  await clickOrFail(panel.locator('[data-assistant-revoke-confirm]'), 'Confirm disconnect')
  await expect(connectButton(panel)).toBeVisible()
  assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')), before)
  console.log('MCP WORKBUDDY PROFILE WALK PASS: existing servers, snippet, signed identity, reopened state')
} finally {
  // 先关 App 再删临时目录，免得晚到的 IPC 往删了一半的目录里写。
  if (launched) await launched.close()
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
