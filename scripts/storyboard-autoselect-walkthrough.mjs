// R13 真机走查（B2 · 拆镜头落画布即自动全选，样张拍板 2026-07-29）：
// 写故事 → 拆镜头（图片分镜）→ 真 planner → 确认落画布 → 断言：切到生成区 + 这批镜头已被
// 自动全选 → 既有多选浮条「生成 N 个」直接浮现（批量入口零学习成本）。不点生成（零图片额度，
// 只花 planner 文本额度几分钱）。用法：pnpm build 后 node scripts/storyboard-autoselect-walkthrough.mjs
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import { realNomiProfile, seedRealCredentials } from '../tests/ux/_realProfile.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, mkdtempSync, existsSync } from 'node:fs'
import os from 'node:os'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.batch-walk')
mkdirSync(outDir, { recursive: true })
const shot = async (win, name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }

const isolatedSettings = path.join(os.tmpdir(), 'nomi-sb-walk-settings')
const isolatedProjects = path.join(os.tmpdir(), 'nomi-sb-walk-projects')
mkdirSync(isolatedSettings, { recursive: true })
mkdirSync(isolatedProjects, { recursive: true })
// 与启动器默认同形（每次新 tempRoot/user-data），只是先建出来：凭据钥匙（Windows 的 Local State）要在起 App 前种进去。
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'storyboard-autoselect-'))
const userDataDir = path.join(tempRoot, 'user-data')
const devCatalog = realNomiProfile().catalogPath
if (!existsSync(devCatalog)) { console.log('✗ 缺 dev catalog'); process.exit(1) }
seedRealCredentials({ settingsDir: isolatedSettings, userDataDir })

const STORY = '清晨的渔村码头，少年阿澈把一只旧木箱搬上小船。他回头望了一眼岸边的灯塔，咬咬牙解开缆绳。海面起雾，船影渐渐消失在白色雾气里。'

const { app, win } = await launchNomiApp({
  name: 'storyboard-autoselect',
  tempRoot,
  userDataDir,
  settingsDir: isolatedSettings,
  projectsDir: isolatedProjects,
})
const errors = []
let failed = false
try {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1680, height: 1020 })).catch(() => {})
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await win.waitForTimeout(1800)

  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2500)

  const editor = win.locator('[aria-label="创作文档编辑区"]')
  await editor.first().waitFor({ timeout: 10000 })
  await editor.first().click()
  await editor.first().fill(STORY).catch(async () => { await win.keyboard.insertText(STORY) })
  await win.waitForTimeout(600)

  const expand = win.locator('[aria-label="展开创作助手"]')
  if ((await expand.count()) > 0) { await expand.first().click(); await win.waitForTimeout(600) }
  const input = win.locator('[aria-label="创作 AI 输入"]')
  await input.first().waitFor({ timeout: 8000 })
  await input.first().fill('拆镜头')
  await win.locator('[aria-label="创作 AI 发送"]').first().click()
  const card = win.locator('[data-action-card="storyboard"]')
  await card.first().waitFor({ timeout: 15000 })
  // 图片分镜（最便宜路径；B2 行为与模式无关）
  const imgChip = card.first().getByText('图片分镜', { exact: false })
  if ((await imgChip.count()) > 0) { await imgChip.first().click(); await win.waitForTimeout(400) }

  await win.locator('[data-action-run="storyboard"]').first().click()
  console.log('  ⏳ 等 planner 拆镜头（真 LLM ≤180s）…')
  const confirmBtn = win.getByRole('button', { name: '确认落画布', exact: false })
  await confirmBtn.first().waitFor({ timeout: 180000 })
  await win.waitForTimeout(800)
  await shot(win, 'b2-01-plan-editor.png')

  await confirmBtn.first().click()
  console.log('  ⏳ 落画布…')
  await win.waitForTimeout(4000)
  await shot(win, 'b2-02-landed-autoselected.png') // 验：生成区 + 镜头卡带选中描边 + 浮条「生成 N 个」

  // 硬断言：既有多选浮条自动浮现（自动全选生效），且「生成 N 个」N≥2
  const runAll = win.locator('[data-storyboard-run-all="true"]')
  const visible = (await runAll.count()) > 0
  let label = ''
  if (visible) label = (await runAll.first().innerText()).trim()
  console.log(`  浮条: visible=${visible} label=「${label}」`)
  const n = Number((label.match(/生成\s*(\d+)\s*个/) || [])[1] || 0)
  if (!visible || n < 2) { console.log('  ✗ 落画布后没有自动全选/浮条未现'); failed = true }
  else console.log(`  ✓ 落画布即自动全选 ${n} 个，浮条「生成 ${n} 个」直接可点`)

  console.log('\n=== 页面错误(' + errors.length + ') ===')
  for (const e of errors.slice(0, 8)) console.log('  ✗ ' + e.slice(0, 200))
} finally {
  await app.close().catch(() => {})
}
if (failed) { console.log('WALKTHROUGH: FAIL'); process.exit(1) }
console.log('WALKTHROUGH: PASS')
