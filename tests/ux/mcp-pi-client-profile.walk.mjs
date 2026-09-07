// R13/R16 走查：在设置里给 **Pi**（pi coding agent）一键接入 MCP。
//
// 为什么单开一条而不是并进 mcp-client-activation：那条走的是**已安装的打包版**
// （`/Applications/Nomi.app`），验的是「真机上那份配置还连不连得上」；这条验的是
// **本分支新加的客户端档**——落点对不对、内容是不是和 Claude Code 同源。两件事的被测对象
// 不是同一个二进制，混在一起会出现「代码改了但走查跑的是旧 app」的假绿
//（教训：mcp-fixes-need-repackaged-app）。所以这条固定跑**开发构建**。
//
// 断言的是三件会让用户白点一次的事：
//   ① 落点：pi-mcp-adapter 2.32.1 README 明写它自动读标准共享配置 `~/.config/mcp/mcp.json`；
//      写错地方 = 点了「一键接入」但 pi 里什么都没有。
//   ② 同源：pi 拿到的启动条目必须就是 Claude Code 那份的投影，只有客户端身份不同。
//   ③ 不碰 `~/.pi`：那是 adapter 自己的 override 层，第三方应用往里写会盖住用户的覆盖。
//
// HOME 指向临时目录（MCP 配置写在 HOME 下，绝不能碰真机）。
// 用法：node tests/ux/mcp-pi-client-profile.walk.mjs [--shots-out=<dir>]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'
import { screenshotSettled } from './_assert.mjs'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Usage: node tests/ux/mcp-pi-client-profile.walk.mjs [options]

Options:
  --shots-out=<dir>  Extra directory to copy the screenshots into
  -h, --help         Show this help`)
  process.exit(0)
}
const shotsOut = process.argv.find((arg) => arg.startsWith('--shots-out='))?.slice('--shots-out='.length) || null
const shotsDir = path.join(repoRoot, 'tests', 'ux', 'shots', 'mcp-pi-client-profile')
fs.mkdirSync(shotsDir, { recursive: true })
if (shotsOut) fs.mkdirSync(shotsOut, { recursive: true })

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcp-pi-walk-'))
const testHome = path.join(tempRoot, 'home')
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const capabilityDir = path.join(tempRoot, 'capability')
for (const dir of [testHome, settingsDir, projectsDir, capabilityDir]) fs.mkdirSync(dir, { recursive: true })

// pi-mcp-adapter 的标准共享用户全局配置（README 2.32.1「File Layout」表）。
const piConfigPath = path.join(testHome, '.config', 'mcp', 'mcp.json')
const claudeConfigPath = path.join(testHome, '.claude.json')

function assert(condition, message) {
  if (!condition) throw new Error(`MCP PI PROFILE WALK FAIL: ${message}`)
}

async function snap(win, name) {
  const target = path.join(shotsDir, `${name}.png`)
  await screenshotSettled(win, { path: target })
  if (shotsOut) fs.copyFileSync(target, path.join(shotsOut, `${name}.png`))
  console.log(`shot ${target}`)
}

async function prepareWindow(win) {
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1_200)
  await win.evaluate(() => {
    for (const key of [
      'nomi:splash:v1',
      'nomi:journey-tour:v1',
      'nomi:canvas-gesture-hint:v1',
      'nomi.onboarding.scene3dCoach.v1',
    ]) window.localStorage.setItem(key, 'seen')
    window.localStorage.setItem('nomi:locale:v1', 'zh-CN')
    window.localStorage.setItem('nomi-color-scheme', 'light')
  })
  await win.reload()
  await win.waitForTimeout(1_200)
  for (let index = 0; index < 5; index += 1) {
    const skip = win.locator('button, [role="button"], a').filter({ hasText: /跳过|开始创作|进入|完成|Skip|Start|Enter|Done/ }).first()
    if (await skip.count()) await skip.click({ timeout: 700 }).catch(() => {})
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(180)
  }
}

async function ensureWorkbench(win) {
  const settings = win.locator('[data-settings-overlay="true"]')
  if (await settings.count()) {
    const close = settings.getByRole('button', { name: /关闭|Close/ }).last()
    if (await close.count()) await close.click()
  }
  const blankProject = win.getByRole('button', { name: /新建空白项目|New blank project/ }).first()
  if (await blankProject.count()) {
    await blankProject.click({ noWaitAfter: true })
    await win.getByText(/创作助手|Creative assistant/).first().waitFor({ state: 'visible', timeout: 8_000 })
  }
}

async function openMcpPanel(win) {
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-settings', {
    detail: { tab: 'automation', section: 'automation' },
  })))
  const settings = win.locator('[data-settings-overlay="true"]')
  await settings.waitFor({ state: 'visible', timeout: 8_000 })
  const manage = settings.locator('[data-settings-action="manage-mcp-connections"]')
  await manage.waitFor({ state: 'visible', timeout: 8_000 })
  await manage.click()
  const panel = settings.locator('[data-settings-section="mcp-assistant-connections"]')
  await panel.waitFor({ state: 'visible', timeout: 8_000 })
  await win.waitForTimeout(800)
  return panel
}

// 「模型接入 → AI 助手连接（MCP）」二级面板里这张卡是**默认展开**的（卡头按钮 disabled、无
// aria-expanded）——所以这里不做展开，只等分段控件出现。等错东西会变成 60s 静默超时。
async function waitForAssistantCard(win, panel) {
  const segment = panel.getByText('Claude Code', { exact: true }).last()
  await segment.waitFor({ state: 'visible', timeout: 10_000 })
  const text = await panel.innerText()
  assert(/AI 助手|AI agents/.test(text), `assistant card is missing; panel text=${text.slice(0, 400)}`)
  await win.waitForTimeout(300)
}

async function selectClient(win, panel, label) {
  const choice = panel.getByText(label, { exact: true }).last()
  await choice.scrollIntoViewIfNeeded()
  await choice.click()
  await win.waitForTimeout(450)
}

const { app, win } = await launchNomiApp({
  name: 'mcp-pi-client-profile',
  settingsDir,
  projectsDir,
  capabilityDir,
  userDataDir: path.join(tempRoot, 'user-data'),
  env: { HOME: testHome, NOMI_CAPABILITY_DIR: capabilityDir },
  settleMs: 0,
})

let passed = false
try {
  await win.setViewportSize({ width: 1180, height: 820 })
  await prepareWindow(win)
  await ensureWorkbench(win)
  const panel = await openMcpPanel(win)
  await waitForAssistantCard(win, panel)

  // ── 接入前 ───────────────────────────────────────────────────────────
  assert(!fs.existsSync(piConfigPath), `pi config already existed before the walk: ${piConfigPath}`)
  await selectClient(win, panel, 'Pi')

  const beforeText = await panel.innerText()
  // 前置步骤必须写在卡上：pi 不带 MCP，只写配置用户还是用不上。
  assert(
    beforeText.includes('pi install npm:pi-mcp-adapter'),
    `pi adapter prerequisite command is missing from the card; text=${beforeText.slice(0, 400)}`,
  )
  const connectButton = panel.locator('button').filter({ hasText: /一键接入 Pi|Connect Pi/ }).first()
  assert(await connectButton.count(), 'one-click connect action for Pi is missing')
  await snap(win, 'zh-light-pi-before-connect')

  // ── 一键接入 ─────────────────────────────────────────────────────────
  await connectButton.click()
  await win.waitForTimeout(1_400)

  // ① 落点
  assert(fs.existsSync(piConfigPath), `Pi connect did not write ${piConfigPath}`)
  const piConfig = JSON.parse(fs.readFileSync(piConfigPath, 'utf8'))
  const piEntry = piConfig?.mcpServers?.nomi
  assert(piEntry, `written file has no mcpServers.nomi: ${JSON.stringify(piConfig).slice(0, 300)}`)
  assert(piEntry.env?.NOMI_MCP_CLIENT === 'pi', `entry is not signed as pi: ${piEntry.env?.NOMI_MCP_CLIENT}`)
  assert(typeof piEntry.env?.NOMI_MCP_CLIENT_PROOF === 'string' && piEntry.env.NOMI_MCP_CLIENT_PROOF.length > 0,
    'pi entry carries no client proof')

  // ③ 不碰 ~/.pi（adapter 的 override 层）
  assert(!fs.existsSync(path.join(testHome, '.pi')), 'connecting Pi touched ~/.pi, which belongs to the adapter')

  const afterText = await panel.innerText()
  assert(/已写入 Pi 配置|已连通 Pi|Pi configuration written|Connected to Pi/.test(afterText),
    `card did not report the Pi connection; text=${afterText.slice(0, 400)}`)
  // 撤销接入不会卸载适配器，所以接入之后前置说明仍要在。
  assert(afterText.includes('pi install npm:pi-mcp-adapter'), 'adapter prerequisite disappeared after connecting')
  await snap(win, 'zh-light-pi-after-connect')

  // ② 同源：Claude Code 走同一条路径，条目除身份外必须逐字段相同。
  await selectClient(win, panel, 'Claude Code')
  const claudeConnect = panel.locator('button').filter({ hasText: /一键接入 Claude Code|Connect Claude Code/ }).first()
  assert(await claudeConnect.count(), 'one-click connect action for Claude Code is missing')
  await claudeConnect.click()
  await win.waitForTimeout(1_400)
  assert(fs.existsSync(claudeConfigPath), `Claude Code connect did not write ${claudeConfigPath}`)
  const claudeEntry = JSON.parse(fs.readFileSync(claudeConfigPath, 'utf8'))?.mcpServers?.nomi
  assert(claudeEntry, 'Claude Code config has no mcpServers.nomi')
  assert(piEntry.command === claudeEntry.command, `command differs: ${piEntry.command} vs ${claudeEntry.command}`)
  assert(JSON.stringify(piEntry.args) === JSON.stringify(claudeEntry.args),
    `args differ: ${JSON.stringify(piEntry.args)} vs ${JSON.stringify(claudeEntry.args)}`)
  const identity = ['NOMI_MCP_CLIENT', 'NOMI_MCP_CLIENT_PROOF']
  const strip = (env) => JSON.stringify(Object.fromEntries(
    Object.entries(env || {}).filter(([key]) => !identity.includes(key)).sort(([a], [b]) => a.localeCompare(b)),
  ))
  assert(strip(piEntry.env) === strip(claudeEntry.env),
    `env differs beyond client identity:\n  pi=${strip(piEntry.env)}\n  claude=${strip(claudeEntry.env)}`)
  assert(claudeEntry.env?.NOMI_MCP_CLIENT === 'claude', 'Claude Code entry lost its own identity')

  passed = true
  console.log('MCP PI PROFILE WALK PASS')
} finally {
  const closed = app.close().then(() => true).catch(() => false)
  if (!(await Promise.race([closed, new Promise((resolve) => setTimeout(() => resolve(false), 8_000))]))) {
    const child = app.process()
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}

if (!passed) process.exitCode = 1
