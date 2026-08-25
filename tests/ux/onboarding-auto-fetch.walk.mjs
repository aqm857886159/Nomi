// R13 走查 —— 接模型「失焦自动拉取」+ ByteString 人话（2026-06-27）。
// 对着忠实 mock new-api（零额度）驱动真实弹窗：填地址+Key 失焦 → 自动拉取 → 列表出现 → 保存可点；
// 再粘带全角字符的 key 测连接 → 显示人话而非原始 ByteString。
// 用法: pnpm run build && node tests/ux/onboarding-auto-fetch.walk.mjs
// 产出: tests/ux/shots/onboarding-auto-fetch/*.png —— 人眼判断。
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { screenshotSettled } from './_assert.mjs'
const shotsDir = path.join(repoRoot, 'tests/ux/shots/onboarding-auto-fetch')
fs.mkdirSync(shotsDir, { recursive: true })

const MOCK_PORT = 8798
const MOCK_BASE = `http://localhost:${MOCK_PORT}`
const mock = spawn(process.execPath, [path.join(repoRoot, 'tests/transport-spike/newapi-mock.mjs')], {
  env: { ...process.env, NEWAPI_MOCK_PORT: String(MOCK_PORT) }, stdio: 'inherit',
})
await new Promise((r) => setTimeout(r, 800))

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-autofetch-'))
const results = []
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`) }
let n = 0
const snap = async (win, name) => { n += 1; const tag = `${String(n).padStart(2, '0')}-${name}`; await screenshotSettled(win, { path: path.join(shotsDir, `${tag}.png`) }); console.log(`  · shot ${tag}`) }

const { app, win } = await launchNomiApp({
  name: 'onboarding-auto-fetch',
  userDataDir: userData,
  args: ['--disable-gpu'],
})

try {
  await win.evaluate(() => {
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) window.localStorage.setItem(k, 'seen')
  })
  await win.reload()
  await win.waitForTimeout(1200)
  for (let i = 0; i < 6; i++) {
    const skip = win.locator('button, [role="button"], a', { hasText: /跳过|开始创作|进入|完成/ }).first()
    if (await skip.count()) await skip.click({ timeout: 1200 }).catch(() => {})
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(300)
  }

  // 打开模型接入面板 → 「添加模型 / 中转站」打开弹窗。
  const panelTrigger = win.locator('button', { hasText: '模型接入' }).first()
  if (await panelTrigger.count()) await panelTrigger.click({ timeout: 4000 }).catch(() => {})
  await win.waitForTimeout(900)
  await snap(win, 'panel-open')
  // 「接入生成模型」组可能因有已接入项而默认收起 → 先展开露出添加按钮。
  const genHeader = win.locator('button', { hasText: '接入生成模型' }).first()
  if (await genHeader.count()) { await genHeader.click({ timeout: 2500 }).catch(() => {}); await win.waitForTimeout(500) }
  const addBtn = win.locator('button', { hasText: '添加模型 / 中转站' }).first()
  if (!(await addBtn.count())) { check('找到「添加模型/中转站」入口', false); throw new Error('入口未找到') }
  await addBtn.click({ timeout: 3000 })
  await win.waitForTimeout(700)
  check('弹窗打开', (await win.locator('text=添加一个 AI 模型').count()) > 0)

  // 选 new-api 中转。
  await win.locator('button', { hasText: 'new-api 中转' }).first().click({ timeout: 3000 })
  await win.waitForTimeout(400)
  // 验证：动手前是「重新拉取」（P1 删旧：不再有「拉取可用模型」）。
  check('按钮已是「重新拉取」', (await win.locator('text=重新拉取').count()) > 0)
  check('旧「拉取可用模型」已删', (await win.locator('text=拉取可用模型').count()) === 0)
  await snap(win, 'wizard-newapi-empty')

  // 填地址 + Key，失焦触发自动拉取。
  await win.locator('input[placeholder="https://api.openai.com/v1"]').first().fill(MOCK_BASE)
  await win.locator('input[placeholder="sk-..."]').first().fill('sk-mock')
  // 失焦：点弹窗标题（不点任何按钮），模拟用户填完移走焦点。
  await win.locator('text=添加一个 AI 模型').first().click({ timeout: 2000 }).catch(() => {})
  // 等自动拉取出结果（最多 ~8s）。
  let populated = false
  for (let i = 0; i < 16; i++) {
    await win.waitForTimeout(500)
    if ((await win.locator('text=已添加').count()) > 0 || (await win.locator('text=/拉到 \\d+ 个/').count()) > 0) { populated = true; break }
  }
  check('失焦自动拉取已出模型（没点任何按钮）', populated)
  await snap(win, 'auto-fetch-success')

  // 全部加入（2026-06-27 拍板，反转「只导认得的」）：mock 的 7 个 id 即使 Nomi 不认得也全加入 → 不再有折叠。
  check('不再有「Nomi 暂不认识的」折叠（全加入）', (await win.locator('text=/Nomi 暂不认识的模型/').count()) === 0)
  check('拉到的 id 直接成行（gpt-4o 已在列表）', (await win.locator('text=gpt-4o').count()) > 0)
  // 拉到即全加入 → 保存直接可点（无需任何手点）。
  const saveBtn = win.locator('button', { hasText: /^保存$|仍要保存|确认保存/ }).last()
  const saveDisabled = await saveBtn.isDisabled().catch(() => true)
  check('自动拉取后保存直接可点（零手点，置灰解除）', !saveDisabled)

  // ByteString：粘带全角字符的 key → 测试连接 → 人话而非原始报错。
  const keyInput = win.locator('input[placeholder="sk-..."]').first()
  await keyInput.fill('')
  await keyInput.fill('衣sk-badkey')
  await win.locator('button', { hasText: '测试连接' }).first().click({ timeout: 3000 })
  await win.waitForTimeout(2500)
  const bodyText = await win.locator('body').innerText()
  const hasRawByteString = /Cannot convert argument to a ByteString/i.test(bodyText)
  const hasHumanMsg = /密钥含非法字符|重新粘贴密钥/.test(bodyText)
  check('不再露原始 ByteString 报错', !hasRawByteString)
  check('显示人话「密钥含非法字符」', hasHumanMsg)
  await snap(win, 'bytestring-human-message')
} catch (err) {
  check('走查异常', false, String(err?.message || err))
} finally {
  await app.close().catch(() => undefined)
  mock.kill()
}

const pass = results.filter((r) => r.ok).length
console.log(`\n═══ 接模型自动拉取 R13：${pass}/${results.length} 通过 ═══  shots → ${path.relative(repoRoot, shotsDir)}`)
process.exit(pass === results.length ? 0 : 1)
