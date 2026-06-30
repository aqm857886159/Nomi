// 拉取模型 → 第二屏勾选确认 R13 走查（2026-06-29）。
// 用法: NOMI_E2E=1 node tests/ux/model-pick-confirm.walk.mjs
// 产出: tests/ux/shots/pick-confirm/*.png —— 人眼判断：来源名称字段 / 模型空态 / 第二屏分组勾选 /
//        手填 id 自动按 文本·图片·视频·配音 归类 / 回表单「已选 N 个」摘要。
// 不需要真 relay：手填 id 走的是 candidate→picker→summary 同一条管线，guessKinds 本机纯启发式。
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/pick-confirm')
fs.mkdirSync(shotsDir, { recursive: true })
const userData = path.join(repoRoot, '.tmp', 'nomi-pick-confirm-userdata')
fs.rmSync(userData, { recursive: true, force: true })
fs.mkdirSync(userData, { recursive: true })

let n = 0
async function snap(win, name) {
  n += 1
  const tag = `${String(n).padStart(2, '0')}-${name}`
  await win.screenshot({ path: path.join(shotsDir, `${tag}.png`) })
  console.log(`  · shot ${tag}`)
}

const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.', `--user-data-dir=${userData}`],
  cwd: repoRoot,
  env: { ...process.env, NOMI_E2E: '1' },
})
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(1500)

await win.evaluate(() => {
  for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
    window.localStorage.setItem(k, 'seen')
  }
})
await win.reload()
await win.waitForTimeout(1200)
for (let i = 0; i < 6; i++) {
  const skip = win.locator('button, [role="button"], a', { hasText: /跳过|开始创作|进入|完成/ }).first()
  if (await skip.count()) await skip.click({ timeout: 1200 }).catch(() => {})
  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(300)
}

// 开「模型接入」面板
const panel = win.locator('button', { hasText: '模型接入' }).first()
if (await panel.count()) await panel.click({ timeout: 4000 }).catch(() => {})
await win.waitForTimeout(700)

// 展开「接入生成模型」（有已接入时默认收起）
const grp = win.locator('text=接入生成模型').first()
if (await grp.count()) await grp.click({ timeout: 2000 }).catch(() => {})
await win.waitForTimeout(400)

// 点「添加模型 / 中转站」开 wizard
const addBtn = win.locator('button', { hasText: '添加模型 / 中转站' }).first()
await addBtn.click({ timeout: 4000 })
await win.waitForTimeout(700)
console.log('— 第一屏：来源名称字段 + 模型「拉取」空态 —')
await snap(win, 'form-empty')

// 选 new-api 预设（自定义中转），填来源名称 + 假地址 + 假 key
const relayChip = win.locator('button', { hasText: /new-?api/i }).first()
if (await relayChip.count()) await relayChip.click().catch(() => {})
await win.waitForTimeout(300)

// 来源名称：按 placeholder 定位
const srcInput = win.getByPlaceholder('如：TOAPI 中转')
if (await srcInput.count()) { await srcInput.fill('TOAPI 中转'); }
const baseInput = win.getByPlaceholder(/api\.openai\.com|可留空/).first()
if (await baseInput.count()) { await baseInput.fill('https://toapis.com/v1') }
const keyInput = win.getByPlaceholder('sk-...').first()
if (await keyInput.count()) { await keyInput.fill('sk-faketestkey1234567890') }
await win.keyboard.press('Tab') // blur → 自动拉取（假地址会失败）
await win.waitForTimeout(2500)
console.log('— 自动拉取（假地址失败）→ 端点没列出态 + 手动选择入口 —')
await snap(win, 'form-fetch-empty')

// 进第二屏：手动选择 / 选择模型
const toPicker = win.locator('button', { hasText: /手动选择|选择模型/ }).first()
await toPicker.click({ timeout: 4000 })
await win.waitForTimeout(600)
console.log('— 第二屏：空池 + 手填 id 入口 —')
await snap(win, 'picker-empty')

// 手填四类 id，验证自动归类到 文本/图片/视频/配音
const manual = win.getByPlaceholder(/没列出来的/).first()
for (const id of ['gpt-5.5', 'flux-2-flex', 'kling-v3', 'doubao-tts-2.0', 'deepseek-v4-pro']) {
  await manual.fill(id)
  await manual.press('Enter')
  await win.waitForTimeout(500)
}
await win.waitForTimeout(600)
console.log('— 第二屏：五个 id 自动按 文本·图片·视频·配音 分组，默认全勾（手填即选） —')
await snap(win, 'picker-grouped')

// 取消一个（点 gpt-5.5 行）测试勾选交互 + 计数
const row = win.locator('button', { hasText: 'deepseek-v4-pro' }).first()
if (await row.count()) await row.click().catch(() => {})
await win.waitForTimeout(400)
console.log('— 取消一个 → 计数 / 按钮数字应 -1 —')
await snap(win, 'picker-toggled')

// 确认添加 → 回第一屏摘要
const addModels = win.locator('button', { hasText: /添加 \d+ 个模型/ }).first()
await addModels.click({ timeout: 4000 })
await win.waitForTimeout(700)
console.log('— 回第一屏：已选 N 个 + 每行 id+类型下拉+删除 —')
await snap(win, 'form-summary')

await app.close()
console.log(`\n✓ 走查完成，${n} 张截图在 ${shotsDir}`)
