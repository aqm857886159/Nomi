// R13 走查：gpt-image-2 在自建中转(code-newcli-com)上现在显示「清晰度」控件 + 存量 catalog 迁移补 paramMap。
// 用法: node tests/ux/param-resolution.walk.mjs
// 隔离 settings/projects（拷贝用户真实数据，迁移只动副本，不碰真实 catalog）。产出截图 + 迁移后 catalog 校验。
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/paramfix')
fs.mkdirSync(shotsDir, { recursive: true })

const settingsDir = '/tmp/nomi-paramfix/settings'
const projectsDir = '/tmp/nomi-paramfix/projects'

let n = 0
const snap = async (win, name) => {
  n += 1
  const tag = `${String(n).padStart(2, '0')}-${name}`
  await win.screenshot({ path: path.join(shotsDir, `${tag}.png`) })
  console.log(`  · shot ${tag}`)
}

const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.', `--user-data-dir=${settingsDir}`],
  cwd: repoRoot,
  env: { ...process.env, NOMI_SETTINGS_DIR: settingsDir, NOMI_PROJECT_ROOT: projectsDir },
})
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(1500)

// 压掉 splash + 引导旅途
await win.evaluate(() => {
  for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) window.localStorage.setItem(k, 'seen')
})
await win.reload()
await win.waitForTimeout(1500)
for (let i = 0; i < 6; i++) {
  const skip = win.locator('button,[role="button"],a', { hasText: /跳过|开始创作|进入|完成/ }).first()
  if (await skip.count()) await skip.click({ timeout: 1200 }).catch(() => {})
  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(350)
}
await snap(win, 'library')

// 打开含 gpt-image-2 节点的项目（界面显示「未命名项目 06/24 11:44」）
const card = win.getByText('未命名项目 06/24 11:44', { exact: false }).first()
console.log('  card count:', await card.count())
if (await card.count()) await card.click({ timeout: 4000 }).catch((e) => console.log('card click err', e.message))
await win.waitForTimeout(3000)
await snap(win, 'canvas')

// 关掉可能挡住的下拉菜单
await win.keyboard.press('Escape').catch(() => {})
await win.mouse.click(20, 300).catch(() => {})
await win.waitForTimeout(500)
// 选中 gpt-image-2 节点 → 内联参数栏出现。按坐标点左侧节点卡中心（画布上可见的「镜头2/图片」节点）。
// 点节点头部（「镜头 2」徽标/标题区）选中——body 占位图区不可选。多点几处覆盖头部。
const vp = win.viewportSize() || { width: 1200, height: 800 }
for (const [fx, fy, name] of [[0.21, 0.23, 'a'], [0.30, 0.23, 'b'], [0.24, 0.26, 'c']]) {
  const nx = Math.round(vp.width * fx)
  const ny = Math.round(vp.height * fy)
  await win.mouse.click(nx, ny).catch(() => {})
  await win.waitForTimeout(700)
  const hit = await win.evaluate(() => document.body.innerText.includes('清晰度') || document.body.innerText.includes('GPT Image'))
  console.log(`  click ${name} at ${nx},${ny} → 含清晰度/GPT Image=${hit}`)
  if (hit) break
}
await snap(win, 'node-selected-parambar')

// 读 DOM 里是否出现「清晰度」控件（archetype 中性化后应有）
const hasResolution = await win.evaluate(() => document.body.innerText.includes('清晰度'))
const hasAspect = await win.evaluate(() => document.body.innerText.includes('比例'))
console.log(`  → 参数栏含「比例」=${hasAspect}  含「清晰度」=${hasResolution}`)

await app.close()

// 校验存量迁移：catalog 应升到 v4 且 code-newcli-com 图像 op 补上 paramMap
const cat = JSON.parse(fs.readFileSync(path.join(settingsDir, 'model-catalog.json'), 'utf8'))
const relay = cat.mappings.find((m) => m.vendorKey === 'code-newcli-com' && m.taskKind === 'text_to_image')
console.log(`\n=== 迁移校验 ===`)
console.log(`catalog version: ${cat.version} (应为 4)`)
console.log(`code-newcli-com 图像 op paramMap:`, JSON.stringify(relay && relay.create && relay.create.paramMap))
console.log(`\n截图在 ${shotsDir}`)
