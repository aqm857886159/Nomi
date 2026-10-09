import { makeTempDir } from '../../scripts/_test-temp.mjs'
// R13/R16: Pi 客户端走查的 WorkBuddy 版本，固定跑本分支开发构建。
// 用户旅程：设置 → MCP → 一键接入 → 重开仍配置 → 撤销。
// 默认隔离 HOME；--real-workbuddy 仅把 .workbuddy 映射到真实目录，finally 字节级还原。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { expect } from '@playwright/test'
import { launchNomiApp } from './_launchApp.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { clickOrFail, screenshotSettled } from './_assert.mjs'

const real = process.argv.includes('--real-workbuddy')
const shotsDir = path.resolve(process.argv.find((arg) => arg.startsWith('--shots-out='))?.split('=').slice(1).join('=')
  || 'tests/ux/shots/mcp-workbuddy-client-profile')
fs.mkdirSync(shotsDir, { recursive: true })
const tempRoot = makeTempDir('nomi-mcp-workbuddy-walk-')
const testHome = path.join(tempRoot, 'home')
fs.mkdirSync(testHome)
const workbuddyDir = path.join(testHome, '.workbuddy')
if (real) fs.symlinkSync(path.join(os.homedir(), '.workbuddy'), workbuddyDir)
else fs.mkdirSync(workbuddyDir)
const configPath = path.join(workbuddyDir, 'mcp.json')
const internalPath = path.join(workbuddyDir, '.mcp.json')
const backupPath = `${configPath}.nomi-backup`
if (!real) {
  fs.writeFileSync(configPath, JSON.stringify({ mcpServers: {
    chatcut_desktop: { command: '/fixture/chatcut', env: { CHATCUT_FIXTURE: 'preserve-me' } },
  } }, null, 2))
  fs.writeFileSync(internalPath, '{"internal":"do-not-touch"}')
}
const snapshot = (file) => fs.existsSync(file) ? fs.readFileSync(file) : null
const beforeBytes = snapshot(configPath)
const beforeBackup = snapshot(backupPath)
const beforeInternal = snapshot(internalPath)
const before = beforeBytes ? JSON.parse(beforeBytes.toString()) : {}
assert(!before.mcpServers?.nomi, 'This walk requires no pre-existing nomi entry; leave existing connections untouched')
let launched
async function snap(win, name) {
  await screenshotSettled(win, { path: path.join(shotsDir, `${name}.png`) })
}
async function openMcpPanel(win) {
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-settings', {
    detail: { tab: 'automation', section: 'automation' },
  })))
  const settings = win.locator('[data-settings-overlay="true"]')
  await expect(settings).toBeVisible()
  await clickOrFail(settings.locator('[data-settings-action="manage-mcp-connections"]'), 'Manage MCP connections')
  const panel = settings.locator('[data-settings-section="mcp-assistant-connections"]')
  await expect(panel).toBeVisible()
  await clickOrFail(panel.getByText('WorkBuddy', { exact: true }).last(), 'WorkBuddy client')
  return panel
}
try {
  launched = await launchNomiApp({
    name: 'mcp-workbuddy-client-profile', tempRoot,
    env: { HOME: testHome }, settleMs: 0,
    initialLocalStorage: {
      'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen',
      'nomi:canvas-gesture-hint:v1': 'seen', 'nomi.onboarding.scene3dCoach.v1': 'seen',
      'nomi:locale:v1': 'zh-CN', 'nomi-color-scheme': 'light',
    },
  })
  const { win } = launched
  await win.setViewportSize({ width: 1180, height: 820 })
  await clickOrFail(win.getByRole('button', { name: /新建空白项目|New blank project/ }), 'New blank project')
  await expect(win.getByText(/创作助手|Creative assistant/).first()).toBeVisible({ timeout: stationTimeout({ operations: 1 }) })
  let panel = await openMcpPanel(win)
  const connect = panel.getByRole('button', { name: /一键接入 WorkBuddy|Connect WorkBuddy/ })
  await expect(connect).toBeVisible()
  await snap(win, 'zh-light-workbuddy-before-connect')
  await clickOrFail(connect, 'Connect WorkBuddy')
  await expect(panel.getByText(/已写入 WorkBuddy 配置|已连通 WorkBuddy|Connected to WorkBuddy/)).toBeVisible({ timeout: stationTimeout({ operations: 1 }) })
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
  await clickOrFail(win.locator('[data-settings-overlay="true"]').getByRole('button', { name: /关闭|Close/ }).last(), 'Close settings')
  panel = await openMcpPanel(win)
  await expect(panel.getByText(/已写入 WorkBuddy 配置|已连通 WorkBuddy|Connected to WorkBuddy/)).toBeVisible({ timeout: stationTimeout({ operations: 1 }) })
  await snap(win, 'zh-light-workbuddy-reopened')
  if (real) {
    execFileSync('open', ['-a', 'WorkBuddy'])
    // 用户明确指定的真机启动观察窗口，不作 UI 成功判据。
    execFileSync('/bin/sleep', ['5'])
    execFileSync('screencapture', ['-x', path.join(shotsDir, 'workbuddy-main-screen.png')])
    console.log('WORKBUDDY REAL: main-window screenshot captured; plugin navigation remains a manual observation')
  } else {
    await clickOrFail(panel.getByRole('button', { name: /撤销接入|Disconnect/ }), 'Disconnect WorkBuddy')
    await expect(panel.getByRole('button', { name: /一键接入 WorkBuddy|Connect WorkBuddy/ })).toBeVisible()
    assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')), before)
  }
  console.log('MCP WORKBUDDY PROFILE WALK PASS: existing servers, snippet, signed identity, reopened state')
} finally {
  // 先关测试进程，避免还原后晚到的 IPC 写入覆盖还原结果。
  if (launched) await launched.close()
  if (real) {
    const current = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    delete current.mcpServers?.nomi
    assert.deepEqual(current, before, 'Other configuration changed during validation; refusing to overwrite it')
    if (beforeBytes) fs.writeFileSync(configPath, beforeBytes)
    else fs.rmSync(configPath, { force: true })
    if (beforeBackup) fs.writeFileSync(backupPath, beforeBackup)
    else fs.rmSync(backupPath, { force: true })
    assert.deepEqual(snapshot(configPath), beforeBytes)
    // WorkBuddy 启动后会重写自己的内部代理文件；只在启动前验证 Nomi 没动它。
    console.log('RESTORE PASS: ~/.workbuddy/mcp.json byte diff empty; Nomi left internal .mcp.json untouched before host launch')
  }
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
