// 模型设置面板 R13 走查 —— 已接入 / 已适配平台 / 其他接入方式 三段分层（2026-08-26 重写）。
// 用法: node tests/ux/model-onboarding.walk.mjs
// 产出: tests/ux/shots/onboarding/*.png —— 人眼判断分层、下钻、暗色。
//
// 2026-08-26 重写的原因（别再照着旧版改）：这条走查原本拍的是「方案2 分组折叠」那版抽屉
// （接入生成模型 / 有即梦会员？/ 接入编程助手 三个可折叠组头）。8d54ad4a「unify model
// management in settings」把面板重做成了设置页里的一页，那三个组头连同 AvailableGroup.tsx
// 一起变成**死代码**（全仓无人 import，对应 i18n key 无人使用），入口文案也从「模型接入」
// 改成「模型」。旧版于是①点不开面板②后面三步全是空点，四张截图字节完全相同——而它没有
// 任何断言，exit 仍是 0。所以这里除了改选择器，还加了「每张截图必须和上一张不一样」的断言：
// 走查的价值是取证，四张一模一样的图不是证据。
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { screenshotSettled } from './_assert.mjs'
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/onboarding')
fs.mkdirSync(shotsDir, { recursive: true })
const userData = path.join(repoRoot, '.tmp', 'nomi-onboarding-userdata')
fs.rmSync(userData, { recursive: true, force: true }) // 干净新用户态
fs.mkdirSync(userData, { recursive: true })

let n = 0
const shots = []
const failures = []
async function snap(win, name) {
  n += 1
  const tag = `${String(n).padStart(2, '0')}-${name}`
  const file = path.join(shotsDir, `${tag}.png`)
  await screenshotSettled(win, { path: file })
  // 取证纪律：一张和上一张字节相同 = 这一步啥也没发生（旧版四张全同还 exit 0 的那个坑）。
  // 只比**相邻**两张：一步点下去画面纹丝不动 = 这步是空点。不做全局去重——
  // 明暗对照那两张本来就可能各自回到之前出现过的样子（默认主题按时间自动定），
  // 全局比会把「亮→暗」这种正当的往返误判成空点。
  const bytes = fs.readFileSync(file)
  const prev = shots[shots.length - 1]
  const same = prev && prev.bytes.equals(bytes)
  if (same) failures.push(`${tag} 与上一张 ${prev.tag} 完全相同——这一步没产生任何可见变化`)
  shots.push({ tag, bytes })
  console.log(`  · shot ${tag}${same ? ' ❌ 与上一张相同' : ''}`)
}

// 入口锚点用 data-testid，不认文案：2026-08-15 的 8d54ad4a「模型接入」改名成「模型」，
// 这条走查因此在 main 上静默红了十来天（check:walkthroughs 是静态检查，不执行走查，门岗照样绿）。
// 且这个入口是**二选一**的——缺文本模型时右上弱入口隐藏、改由状态条「接入文本模型」承担
// （ProjectLibraryPage.tsx:157 showModelEntry = !textModelMissing），两颗共用同一个 testid。
async function openPanel(win) {
  const trigger = win.locator('[data-testid="open-model-settings"]').first()
  if (await trigger.count()) await trigger.click({ timeout: 4000 }).catch(() => {})
  await win.waitForTimeout(800)
  // 开没开也不认标题文案（标题现在是「模型」，随时会再改）——认结构标记。
  return (await win.locator('[data-model-settings-page]').count()) > 0
}

const { app, win } = await launchNomiApp({
  name: 'model-onboarding',
  userDataDir: userData,
})

// 清场：跳过 splash + 引导旅途。
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
  await win.waitForTimeout(350)
}

// 注意：本机 catalog 在隔离 userData 内，但即梦登录态/编程助手 MCP 配置在 userData 外（全局），
// 故本机通常有「已接入」项（即梦/编程助手）。不写 vendor key（避免污染 + 非必要）。
console.log('— 默认态：模型设置首页三段分层（已接入 / 已适配平台 / 其他接入方式）—')
if (!(await openPanel(win))) { console.log('  ✗ 面板没打开'); await app.close(); process.exit(1) }
await win.waitForTimeout(900) // 等异步即梦状态落定 + loaded 门
const sections = await win.evaluate(() => ({
  connected: Boolean(document.querySelector('[data-model-home-connected]')),
  adapted: Boolean(document.querySelector('[data-model-home-adapted-platforms]')),
  otherMethods: Boolean(document.querySelector('[data-model-home-other-methods]')),
  available: [...document.querySelectorAll('[data-model-home-available]')].map((el) => el.getAttribute('data-model-home-available')),
}))
console.log(`  · 分区：${JSON.stringify(sections)}`)
// 首页至少要有「可接入平台」这一段，否则这张图没有取证价值。
if (!sections.adapted && !sections.otherMethods) failures.push('模型设置首页既没有「已适配平台」也没有「其他接入方式」')
// 正着写「至少列出 1 个」，不写 `=== 0`：后者是「不存在」断言，探针失效时也会成立
// （check:walkthroughs 拦的正是这族）。这里要的本就是存在性，正着写既准确又不用进基线。
if (sections.available.length < 1) failures.push('首页一个可接入 vendor 都没列出')
await snap(win, 'home-sections')

console.log('— 下钻：点第一个可接入平台 → 连接页 —')
const firstVendor = win.locator('[data-model-home-available]').first()
if (await firstVendor.count()) {
  await firstVendor.click({ timeout: 2500 }).catch(() => {})
  await win.waitForTimeout(700)
}
// 已适配平台走的是「已知 vendor」连接页 = platformConnect（KnownVendorKeyConnectPage.tsx:68，
// 页类型枚举见 ModelSettingsPageSurface.tsx:15）；自定义 API 才是 add/script。
const page = await win.evaluate(() => document.querySelector('[data-model-settings-page]')?.getAttribute('data-model-settings-page') || '')
console.log(`  · 当前页 = ${page}`)
if (page !== 'platformConnect') failures.push(`点可接入平台后应进入 platformConnect 页，实际停在「${page || '无'}」`)
await snap(win, 'connection-page')

// 明暗两张必须真的一明一暗。默认主题按本地时间自动定（天黑自动暗），夜里跑时「切到 dark」
// 其实是原地不动——旧版第 4 张和第 1 张字节相同正是栽在这。所以两张都**显式**指定主题。
for (const scheme of ['light', 'dark']) {
  console.log(`— ${scheme === 'light' ? '亮色' : '暗色'} —`)
  await win.evaluate((value) => window.localStorage.setItem('nomi-color-scheme', value), scheme)
  await win.reload()
  await win.waitForTimeout(1300)
  for (let i = 0; i < 4; i++) { await win.keyboard.press('Escape').catch(() => {}); await win.waitForTimeout(300) }
  if (!(await openPanel(win))) { failures.push(`${scheme} 下面板没打开`); continue }
  await win.waitForTimeout(700)
  // 真相源见 src/theme/colorScheme.ts:58-60（dataset.nomiColorScheme），别认 class。
  const actual = await win.evaluate(() => document.documentElement.dataset.nomiColorScheme || '')
  console.log(`  · 实际主题 = ${actual}`)
  if (actual !== scheme) failures.push(`要求 ${scheme}，实际渲染成 ${actual}`)
  await snap(win, `${scheme}-home`)
}

console.log(`\nDone. ${n} shots → ${path.relative(repoRoot, shotsDir)}`)
if (failures.length) {
  console.log('\n=== 失败 ===')
  for (const f of failures) console.log(`  ❌ ${f}`)
}
await app.close()
process.exit(failures.length ? 1 : 0)
