// 自定义 MCP 客户端 UI 走查（R13：截图 + 人眼判断）。
// 验证：
//   ① 设置 → 自动化与权限 → MCP 页能进入
//   ② 「自定义客户端」折叠卡渲染，能展开
//   ③ 「新增自定义客户端」表单字段齐全（名称/格式/key/路径）
//   ④ 「提示词一键配置」兜底可见
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { screenshotSettled, expectVisible } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-custom-mcp-'))
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const capabilityDir = path.join(tempRoot, 'capability')
for (const dir of [settingsDir, projectsDir, capabilityDir]) fs.mkdirSync(dir, { recursive: true })
const shotsDir = path.join(repoRoot, 'tests', 'ux', 'shots', 'custom-mcp-client')
fs.mkdirSync(shotsDir, { recursive: true })

const { app, win } = await launchNomiApp({
  name: 'custom-mcp-client',
  tempRoot,
  settingsDir,
  projectsDir,
  env: { NOMI_CAPABILITY_DIR: capabilityDir },
  settleMs: 1500,
})

const findings = []
function record(name, ok, detail) {
  findings.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name} — ${detail}`)
}
async function shot(name) {
  await screenshotSettled(win, { path: path.join(shotsDir, `${name}.png`) })
}
async function closeApp() {
  await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 8000))])
}

try {
  // 进入设置
  const settingsBtn = win.getByRole('button', { name: '设置', exact: true }).first()
  await expectVisible(settingsBtn, '设置按钮未出现')
  await settingsBtn.click()
  await win.waitForTimeout(600)

  // 切到「自动化与权限」tab（可能叫「自动化」或英文）
  const autoTab = win.getByText(/自动化|Automation/).first()
  await expectVisible(autoTab, '自动化 tab 未出现')
  await autoTab.click()
  await win.waitForTimeout(400)

  // 进入 MCP 连接管理页
  const mcpEntry = win.getByText(/AI 助手连接|AI agent connections/).first()
  await expectVisible(mcpEntry, 'MCP 连接入口未出现')
  // 点「管理连接」按钮
  const manageBtn = win.getByText(/管理连接|Manage connections/).first()
  if (await manageBtn.isVisible().catch(() => false)) {
    await manageBtn.click()
    await win.waitForTimeout(600)
  }

  // 验证「自定义客户端」卡片
  const customCard = win.getByText(/自定义客户端|Custom clients/).first()
  record('自定义客户端卡', (await customCard.count()) > 0, `count=${await customCard.count()}`)

  // 展开卡片（点卡片头）
  const cardHeader = customCard
  await cardHeader.click().catch(() => {})
  await win.waitForTimeout(400)

  // 「新增自定义客户端」按钮
  const addBtn = win.getByText(/新增自定义客户端|Add custom client/).first()
  record('新增按钮', (await addBtn.count()) > 0, `count=${await addBtn.count()}`)

  // 点新增，展开表单
  await addBtn.click().catch(() => {})
  await win.waitForTimeout(400)

  // 表单字段
  const nameField = win.getByPlaceholder(/WorkBuddy|e\.g\./).first()
  record('名称字段', (await nameField.count()) > 0, `count=${await nameField.count()}`)
  const pathField = win.getByPlaceholder(/\.tool\/mcp\.json|\.workbuddy/).first()
  record('路径字段', (await pathField.count()) > 0, `count=${await pathField.count()}`)

  await shot('01-custom-client-form')

  // 关闭表单，看「提示词一键配置」
  const cancelBtn = win.getByText(/取消|Cancel/).first()
  await cancelBtn.click().catch(() => {})
  await win.waitForTimeout(300)
  const copyPrompt = win.getByText(/复制提示词|Copy prompt/).first()
  record('提示词一键配置', (await copyPrompt.count()) > 0, `count=${await copyPrompt.count()}`)

  await shot('02-custom-client-list')

  console.log(JSON.stringify(findings, null, 2))
  const failed = findings.filter((f) => !f.ok)
  await closeApp()
  if (failed.length) {
    console.log(`\n${failed.length} 项未通过。截图在 ${shotsDir}`)
    process.exit(1)
  }
  console.log(`\n全部 ${findings.length} 项通过。截图在 ${shotsDir}`)
} catch (error) {
  await win.screenshot({ path: path.join(shotsDir, 'failure.png') }).catch(() => {})
  console.log(JSON.stringify(findings, null, 2))
  console.error(error)
  await closeApp()
  process.exit(1)
}
