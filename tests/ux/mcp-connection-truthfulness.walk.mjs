// R13/R16 走查：MCP 连接状态必须说真话（docs/plan/2026-09-14-mcp-connection-truthfulness.md）。
// 固定跑本分支开发构建；HOME 指向临时目录（宿主配置写在 HOME 下，绝不能碰真机）。
//
// 用户旅程，四件此前都在说谎的事：
//   ① 只是打开「设置 → 自动化与权限 → 管理连接」两次，宿主配置**一个字节都不许变**（此前读路径写盘）；
//   ② 没装的助手不出现在一键列表里，目录也不会被凭空建出来（此前 pi 是 stub 假项）；
//   ③ 配置里的 NOMI_SETTINGS_DIR 指向一个已删除的 profile → 卡上说「配置需要更新」而不是绿灯，
//      「升级接入」一键指回当前 profile（此前照样判绿，助手连上的是空白 Nomi）；
//   ④ 「其他客户端 · 复制通用配置」进剪贴板的是**不带身份**的条目（此前带着 Claude Code 的签名）；
//   ⑤ 「允许自动发起制作」开关就在客户端卡里，翻它改的是 automationPolicy.trustedHosts。
//
// 用法：node tests/ux/mcp-connection-truthfulness.walk.mjs [--shots-out=<dir>]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { expect } from '@playwright/test'
import { launchNomiApp } from './_launchApp.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { clickOrFail, screenshotSettled } from './_assert.mjs'

const shotsDir = path.resolve(process.argv.find((arg) => arg.startsWith('--shots-out='))?.split('=').slice(1).join('=')
  || 'tests/ux/shots/mcp-connection-truthfulness')
fs.mkdirSync(shotsDir, { recursive: true })
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcp-truth-walk-'))
const testHome = path.join(tempRoot, 'home')
// 安装痕迹：Claude Code / Codex / Cursor 「已安装」，WorkBuddy 没装。
for (const marker of ['.claude', '.codex', '.cursor']) fs.mkdirSync(path.join(testHome, marker), { recursive: true })
const claudeJson = path.join(testHome, '.claude.json')
const codexToml = path.join(testHome, '.codex', 'config.toml')
const cursorJson = path.join(testHome, '.cursor', 'mcp.json')
const workbuddyDir = path.join(testHome, '.workbuddy')
// 已有内容：别人的 server + Claude Code 自己的字段，必须原样保留。
fs.writeFileSync(claudeJson, JSON.stringify({ oauthAccount: { keep: 'me' }, mcpServers: { other: { command: '/fixture/other' } } }, null, 2))
fs.writeFileSync(codexToml, '[mcp_servers.other]\ncommand = "x"\n\n[projects."/Users/example"]\ntrust_level = "trusted"\n')
const digest = (file) => (fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : 'absent')
const digests = () => ({ claude: digest(claudeJson), codex: digest(codexToml), cursor: digest(cursorJson), workbuddy: fs.existsSync(workbuddyDir) })

let launched
async function snap(win, name) {
  const target = path.join(shotsDir, `${name}.png`)
  await screenshotSettled(win, { path: target })
  console.log(`shot ${target}`)
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
  return { settings, panel }
}
async function closeSettings(win) {
  await clickOrFail(win.locator('[data-settings-overlay="true"]').getByRole('button', { name: /关闭|Close/ }).last(), 'Close settings')
  await expect(win.locator('[data-settings-overlay="true"]')).toBeHidden()
}
const trustedHosts = (win) => win.evaluate(async () => (await window.nomiDesktop.settings.automationPolicy.get()).trustedHosts)

try {
  launched = await launchNomiApp({
    name: 'mcp-connection-truthfulness', tempRoot,
    env: { HOME: testHome }, settleMs: 0,
    initialLocalStorage: {
      'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen',
      'nomi:canvas-gesture-hint:v1': 'seen', 'nomi.onboarding.scene3dCoach.v1': 'seen',
      'nomi:locale:v1': 'zh-CN', 'nomi-color-scheme': 'light',
    },
  })
  const { app, win } = launched
  await win.setViewportSize({ width: 1180, height: 820 })
  await clickOrFail(win.getByRole('button', { name: /新建空白项目|New blank project/ }), 'New blank project')
  await expect(win.getByText(/创作助手|Creative assistant/).first()).toBeVisible({ timeout: stationTimeout({ operations: 1 }) })

  // ① 读路径零写盘：开两次，字节不变；③ 没装的 WorkBuddy 不在列表、目录没被建出来。
  const before = digests()
  let { panel } = await openMcpPanel(win)
  await expect(panel.getByText('Claude Code', { exact: true }).last()).toBeVisible()
  await expect(panel.getByText('WorkBuddy', { exact: true })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: /一键接入 Claude Code|Connect to Claude Code/ })).toBeVisible()
  await snap(win, 'zh-light-01-before-connect')
  await closeSettings(win)
  ;({ panel } = await openMcpPanel(win))
  await expect(panel.getByRole('button', { name: /一键接入 Claude Code|Connect to Claude Code/ })).toBeVisible()
  assert.deepEqual(digests(), before, 'opening the MCP page must not write any host config')
  assert.equal(before.workbuddy, false, 'undetected client must not get a directory created')

  // ④ 通用配置不带身份。
  await clickOrFail(panel.locator('[data-assistant-generic-copy]'), 'Copy generic configuration')
  await expect(panel.locator('[data-assistant-generic-copy]')).toHaveText(/已复制|Copied/)
  const generic = JSON.parse(await app.evaluate(({ clipboard }) => clipboard.readText()))
  assert.ok(generic.mcpServers?.nomi?.command, 'generic snippet must be an mcpServers.nomi entry')
  assert.equal(generic.mcpServers.nomi.env.NOMI_MCP_CLIENT, undefined, 'generic snippet must carry no client identity')
  assert.equal(generic.mcpServers.nomi.env.NOMI_MCP_CLIENT_PROOF, undefined, 'generic snippet must carry no client proof')
  await snap(win, 'zh-light-02-generic-copied')

  // 接入 Claude Code（HOME 是临时目录，写的是临时文件）：别人的字段原样保留；⑤ 开关就在卡里。
  await clickOrFail(panel.getByRole('button', { name: /一键接入 Claude Code|Connect to Claude Code/ }), 'Connect Claude Code')
  await expect(panel.getByText(/已连通 Claude Code|Connected to Claude Code/)).toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
  const afterConnect = JSON.parse(fs.readFileSync(claudeJson, 'utf8'))
  assert.deepEqual(afterConnect.oauthAccount, { keep: 'me' })
  assert.deepEqual(afterConnect.mcpServers.other, { command: '/fixture/other' })
  assert.equal(afterConnect.mcpServers.nomi.env.NOMI_MCP_CLIENT, 'claude')
  assert.equal(digest(codexToml), before.codex, 'connecting Claude Code must not touch the Codex config')
  const trustRow = panel.locator('[data-assistant-trust-row="claude"]')
  await expect(trustRow).toBeVisible()
  const trustSwitch = trustRow.locator('input[type="checkbox"]')
  await expect(trustSwitch).toBeChecked()
  await snap(win, 'zh-light-03-connected-trusted')
  await clickOrFail(trustRow.locator('label').first(), 'Trust switch (off)')
  await expect.poll(() => trustedHosts(win), { timeout: stationTimeout({ operations: 1 }) }).not.toContain('claude')
  await expect(trustSwitch).not.toBeChecked()
  await snap(win, 'zh-light-04-connected-untrusted')
  await clickOrFail(trustRow.locator('label').first(), 'Trust switch (on)')
  await expect.poll(() => trustedHosts(win), { timeout: stationTimeout({ operations: 1 }) }).toContain('claude')
  await closeSettings(win)

  // ② 配置指向已删除的 profile → 不是绿灯，是「需要更新」；升级接入指回当前 profile。
  const written = JSON.parse(fs.readFileSync(claudeJson, 'utf8'))
  const currentProfile = written.mcpServers.nomi.env.NOMI_SETTINGS_DIR
  written.mcpServers.nomi.env.NOMI_SETTINGS_DIR = path.join(tempRoot, 'deleted-profile-20260913')
  fs.writeFileSync(claudeJson, JSON.stringify(written, null, 2))
  ;({ panel } = await openMcpPanel(win))
  await expect(panel.locator('[data-assistant-broken="launcher-stale"]')).toBeVisible()
  await expect(panel.getByText(/已连通 Claude Code|Connected to Claude Code/)).toHaveCount(0)
  await snap(win, 'zh-light-05-stale-profile')
  await clickOrFail(panel.getByRole('button', { name: /升级接入 Claude Code|Upgrade Claude Code connection/ }), 'Upgrade connection')
  await expect(panel.getByText(/已连通 Claude Code|Connected to Claude Code/)).toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
  assert.equal(JSON.parse(fs.readFileSync(claudeJson, 'utf8')).mcpServers.nomi.env.NOMI_SETTINGS_DIR, currentProfile)
  await snap(win, 'zh-light-06-repaired')

  // 撤销：别人的字段回到原样。
  await clickOrFail(panel.getByRole('button', { name: /撤销接入|Remove connection/ }), 'Disconnect Claude Code')
  await expect(panel.getByRole('button', { name: /一键接入 Claude Code|Connect to Claude Code/ })).toBeVisible()
  const afterDisconnect = JSON.parse(fs.readFileSync(claudeJson, 'utf8'))
  assert.deepEqual(afterDisconnect, { oauthAccount: { keep: 'me' }, mcpServers: { other: { command: '/fixture/other' } } })
  assert.equal(fs.existsSync(workbuddyDir), false)
  console.log('MCP CONNECTION TRUTHFULNESS WALK PASS: no writes on read, undetected client hidden, stale profile not green, generic snippet unsigned, trust switch inline')
} finally {
  if (launched) await launched.close()
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
