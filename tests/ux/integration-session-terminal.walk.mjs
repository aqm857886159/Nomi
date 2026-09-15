// R13 真机走查 —— 接入验证会话的终态与逃生口，看界面（2026-09-15）。
//
// 前置：先跑 `source ~/.nomi-secrets.env && node tests/ux/integration-session-terminal.e2e.mjs`。
// 那条 e2e 用**真 key + DeepSeek 官方 OpenAI 兼容端点**在隔离 profile
// `artifacts/integration-session-terminal/profile-arm-a` 里真的跑完了一次认证；
// 本走查就用那份真实结果起界面，人眼判断「接完之后界面上看得见它已经连上了」。
//
// 用法: node tests/ux/integration-session-terminal.walk.mjs
// 产出: tests/ux/shots/integration-session-terminal/*.png
//
// 为什么这条走查不自己点「接入」：这次改的是主进程的会话状态机，界面是它的下游。
// 界面要证的只有一件事——真实跑完的终态在界面上如实显示出来了（而不是一直转圈）。
// 会话状态机本身的证据在那条 e2e 的 17 条断言和 artifacts/ 里的 JSON 现场。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expectVisible, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/integration-session-terminal')
const profile = path.join(repoRoot, 'artifacts/integration-session-terminal/profile-arm-a')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

if (!fs.existsSync(path.join(profile, 'model-catalog.json'))) {
  throw new Error(
    `没有真实认证过的隔离 profile：${profile}\n`
    + '先跑 `source ~/.nomi-secrets.env && node tests/ux/integration-session-terminal.e2e.mjs`',
  )
}

let n = 0
const shots = []
const failures = []
async function snap(win, name) {
  n += 1
  const tag = `${String(n).padStart(2, '0')}-${name}`
  const file = path.join(shotsDir, `${tag}.png`)
  await screenshotSettled(win, { path: file })
  const bytes = fs.readFileSync(file)
  const prev = shots[shots.length - 1]
  if (prev && prev.bytes.equals(bytes)) failures.push(`${tag} 与上一张 ${prev.tag} 字节相同——这一步是空点`)
  shots.push({ tag, bytes })
  console.log(`  · shot ${tag}`)
}

const { app, win } = await launchNomiApp({
  name: 'integration-session-terminal',
  settingsDir: profile,
  settleMs: 1800,
})

try {
  await win.locator('button', { hasText: /跳过/ }).first().click({ timeout: 4000 }).catch(() => {})
  await win.waitForTimeout(800)
  await clickOrFail(win.locator('[data-testid="open-model-settings"]').first(), '连接模型入口')
  await win.waitForTimeout(1500)
  await expectVisible(win.locator('[data-model-settings-page]').first(), '模型设置页')
  // 真机那次认证的结果：DeepSeek 连接出现在「已接入」里，而不是一直转圈。
  await expectVisible(win.locator('[data-model-home-connected]').first(), '「已接入」分组（真实认证落终态的界面证据）')
  await snap(win, 'model-settings-deepseek-connected')

  // 免费自检那条路（本轮新覆盖的窗口）在界面上的入口：本地 ComfyUI。
  const others = win.locator('[data-model-home-action="other-ways"]').first()
  if (await others.count()) { await others.click().catch(() => {}); await win.waitForTimeout(900) }
  await expectVisible(win.locator('[data-model-home-available="comfyui-local"]').first(), '本地 ComfyUI 行（免费自检那条路）')
  await snap(win, 'other-ways-comfyui-free-selfcheck')

  await clickOrFail(win.locator('[data-model-home-connection="deepseek"], [data-model-home-connected] button').first(), '已接入的连接详情')
  await win.waitForTimeout(1400)
  await snap(win, 'deepseek-connection-detail')
} finally {
  await app.close()
}

if (failures.length) {
  for (const line of failures) console.log(`✗ ${line}`)
  process.exit(1)
}
console.log(`\n✓ ${shots.length} 张截图 → ${shotsDir}`)
