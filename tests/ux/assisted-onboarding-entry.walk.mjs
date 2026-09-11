// R13 走查 —— 「我想接一个新模型，能不能让我已经在用的 AI 助手替我接」的真实用户旅程（2026-09-11）。
//
// 设计定稿：docs/design/2026-09-11-ai-assisted-onboarding-entry.md
//
// 这条路以前**不存在于用户能走到的地方**：能干这活的卡住在「自动化与权限 → AI 助手连接 → 管理连接」，
// 而且一个字没提「帮我接模型」。本走查证的是它现在在人真会到的那一屏上，而且复制出去的东西是真能用的。
//
// 用法: pnpm run build && node tests/ux/assisted-onboarding-entry.walk.mjs
// 产出: tests/ux/shots/assisted-onboarding-entry/*.png —— 人眼判断每一屏「看得懂要干嘛吗」。
//
// 回归底线（四条，别退回去）：
//   ① 「模型」页落地首屏就看得见这张卡，且排在所有连接区块之前
//   ② 复制出来的东西里必须**同时**有任务提示词与 SKILL.md 正文（少一半助手就不知道怎么调工具）
//   ③ 剪贴板里**不许**出现任何 key 形状的东西——Key 只走 Nomi 本机安全页
//   ④ 复制后按钮变「已复制」，并且三步小示意才出现（不复制的人不用先读教程）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expect, expectVisible, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/assisted-onboarding-entry')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-assisted-onboarding-'))
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
fs.mkdirSync(settingsDir, { recursive: true })
fs.mkdirSync(projectsDir, { recursive: true })

let n = 0
async function snap(target, name) {
  n += 1
  const file = path.join(shotsDir, `${String(n).padStart(2, '0')}-${name}.png`)
  await screenshotSettled(target, { path: file })
  console.log(`  · shot ${String(n).padStart(2, '0')}-${name}`)
}

const { app, win } = await launchNomiApp({
  name: 'assisted-onboarding-entry',
  userDataDir: settingsDir,
  settingsDir,
  projectsDir,
  syntheticCredentialStorage: true,
})

await win.evaluate(() => {
  for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
    window.localStorage.setItem(k, 'seen')
  }
  window.localStorage.setItem('nomi-color-scheme', 'light')
})
await win.reload()
await win.waitForLoadState('domcontentloaded')

const libraryReady = win.getByText('新建空白项目', { exact: false }).first()
await expectVisible(libraryReady, '项目库首页')
for (let i = 0; i < 4; i++) {
  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(200)
}

// ── 旅程：从工作台走通用「设置」入口，像一个不知道路的人那样找 ─────────────────
await clickOrFail(libraryReady, '新建空白项目')
const settingsButton = win.locator('button[aria-label="设置"]')
await expectVisible(settingsButton, '工作台顶栏')
await clickOrFail(settingsButton, '顶栏设置按钮')
await expectVisible(win.locator('[data-settings-dialog]'), '设置弹窗')
await clickOrFail(win.locator('[data-settings-tab-id="models"]'), '设置「模型」页签')
await expectVisible(win.locator('[data-model-settings-page="home"]'), '模型设置首页')
await snap(win, 'models-home')

// ① 卡在顶部，而且排在所有连接区块之前。
const card = win.locator('[data-model-home-assisted-onboarding]')
await expectVisible(card, '① 「用 AI 帮我接入」卡应在模型页落地首屏就可见')
const order = await win.evaluate(() => {
  const page = document.querySelector('[data-model-settings-page="home"]')
  const top = (selector) => {
    const el = page?.querySelector(selector)
    return el ? Math.round(el.getBoundingClientRect().top) : null
  }
  const dialog = document.querySelector('[data-settings-dialog]')?.getBoundingClientRect() ?? null
  const assisted = page?.querySelector('[data-model-home-assisted-onboarding]')?.getBoundingClientRect() ?? null
  return {
    assisted: top('[data-model-home-assisted-onboarding]'),
    adapted: top('[data-model-home-adapted-platforms]'),
    other: top('[data-model-home-other-methods]'),
    clipped: Boolean(assisted && dialog && (assisted.top < dialog.top || assisted.top > dialog.bottom)),
  }
})
console.log('▶ 首屏排序：', JSON.stringify(order))
expect(order.assisted, '① 卡要真的量得到位置').not.toBeNull()
expect(order.clipped, '① 卡不许被设置弹窗裁在窗外').toBe(false)
expect(order.assisted, '① 卡要排在「添加模型服务」之前').toBeLessThan(order.adapted ?? Number.POSITIVE_INFINITY)
expect(order.assisted, '① 卡要排在「其他接入方式」之前').toBeLessThan(order.other ?? Number.POSITIVE_INFINITY)

// 动手前先知道要付出什么（卡点表 ②）：这句 hint 必须在卡上。
await expectVisible(card.getByText('需要一个能装 MCP 的 AI 助手', { exact: false }), '② 卡上要写清前提：需要一个能装 MCP 的助手')

// ── 选 Codex ────────────────────────────────────────────────────────────────
await clickOrFail(card.getByText('Codex', { exact: true }).first(), '宿主分段「Codex」')
await expect(card, '选中的宿主要真的切到 Codex').toHaveAttribute('data-model-home-assisted-onboarding', 'codex')
await snap(win, 'card-codex-selected')

// ── 复制 ────────────────────────────────────────────────────────────────────
// 先把剪贴板打成一个哨兵值：读到它 = 复制根本没发生（不是「读不到」）。
await win.evaluate(() => navigator.clipboard.writeText('__nomi_walk_cleared__').catch(() => {}))
await clickOrFail(card.locator('[data-assisted-onboarding-copy]'), '「复制指引」按钮')

// ④ 按钮变「已复制」，三步小示意此刻才出现。
await expect(
  card.locator('[data-assisted-onboarding-copy]'),
  '④ 复制后按钮要变成「已复制」态',
).toHaveAttribute('data-assisted-onboarding-copy', 'copied')
await expectVisible(card.getByText('已复制', { exact: true }), '④ 按钮文案要变成「已复制」')
await expectVisible(card.locator('[data-assisted-onboarding-next-steps]'), '④ 复制之后才出现的三步小示意')
await snap(win, 'card-copied')

const clip = await win.evaluate(() => navigator.clipboard.readText().catch(() => '')).catch(() => '')
expect(clip, '复制没有真的写进剪贴板（还是哨兵值）').not.toBe('__nomi_walk_cleared__')
expect(clip.length, '剪贴板是空的——复制这一步根本没发生').toBeGreaterThan(200)

// ② 任务提示词 + SKILL.md 正文，两半都要在。
expect(clip, '② 剪贴板里缺任务提示词').toContain('接进 Nomi')
expect(clip, '② 剪贴板里缺技能文件的路径').toContain('nomi-add-model/SKILL.md')
const skillBody = fs.readFileSync(path.join(repoRoot, 'agent-skills/nomi-add-model/SKILL.md'), 'utf8').trim()
expect(clip, '② 剪贴板里的 SKILL.md 必须是仓库里那一份的**原文**，不是摘要').toContain(skillBody)
// 正文得真的把工具契约讲清楚，否则助手拿到也不知道怎么调。
for (const needle of ['nomi_integration', 'begin', 'open_credentials', 'propose', 'confirm', 'start', 'cancel']) {
  expect(clip, `② 技能正文里缺 ${needle}`).toContain(needle)
}

// ③ 一个 key 形状的东西都不许有。
expect(clip, '③ 剪贴板里出现了 sk- 开头的串').not.toMatch(/\bsk-[A-Za-z0-9]{6,}/)
expect(clip.toLowerCase(), '③ 剪贴板里出现了 apiKey 字样').not.toContain('apikey')
expect(clip.toLowerCase(), '③ 剪贴板里出现了 api_key 字样').not.toContain('api_key')
// Codex 不是「其它」：MCP 配置片段不该跟着来（那三家由 Nomi 一键写入）。
expect(clip, 'Codex 段不该带 MCP 配置片段').not.toContain('mcpServers')
console.log(`  ✓ 剪贴板 ${clip.length} 字：任务提示词 + SKILL.md 原文，零凭据`)

// ── 「看看会复制什么」：用户能自己看一眼再决定粘不粘 ──────────────────────────
await clickOrFail(card.locator('[data-assisted-onboarding-preview]'), '「看看会复制什么」折叠行')
const preview = card.locator('[data-assisted-onboarding-skill-preview]')
await expectVisible(preview, '展开后要看得到 SKILL.md 原文')
const previewText = await preview.innerText()
expect(previewText, '预览里的正文要和复制出去的是同一份').toContain('nomi_integration')
await snap(win, 'card-preview-open')

// ── 「其它」宿主：这时才该带上 MCP 配置片段，且里面的 command 是本机现算的 ────────
await clickOrFail(card.getByText('其它', { exact: true }).first(), '宿主分段「其它」')
await win.evaluate(() => navigator.clipboard.writeText('__nomi_walk_cleared__').catch(() => {}))
await clickOrFail(card.locator('[data-assisted-onboarding-copy]'), '「复制指引」按钮（其它宿主）')
const otherClip = await win.evaluate(() => navigator.clipboard.readText().catch(() => '')).catch(() => '')
expect(otherClip, '「其它」段应带上 MCP 配置片段').toContain('mcpServers')
expect(otherClip, '「其它」段仍要带任务提示词与技能文件').toContain('nomi-add-model/SKILL.md')
expect(otherClip, '③ 「其它」段也不许带凭据').not.toMatch(/\bsk-[A-Za-z0-9]{6,}/)
const server = JSON.parse(otherClip.slice(otherClip.indexOf('{"mcpServers"') >= 0
  ? otherClip.indexOf('{"mcpServers"')
  : otherClip.indexOf('{\n  "mcpServers"')).split('\n```')[0])
expect(typeof server.mcpServers.nomi.command, 'MCP 片段里的 command 必须是本机现算出来的真实路径').toBe('string')
expect(server.mcpServers.nomi.command.length, 'command 不能是空串（那说明它是个常量占位）').toBeGreaterThan(0)
await snap(win, 'card-other-host')

console.log('\n✅ 走查通过：入口在人会到的那一屏、复制出去的两半都在、剪贴板零凭据、复制后才给三步图')
await app.close()
