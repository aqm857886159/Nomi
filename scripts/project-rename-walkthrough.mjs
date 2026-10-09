import { makeTempDir } from './_test-temp.mjs'
// R13 真机走查：项目库列表双击改名（#888，群反馈「现在需要点击去才能改名字」）。
// 验证链：项目库 → 双击项目名 → 变输入框 → 改名 Enter → 卡片名更新 + 磁盘 project.json name 改了。
// 用法：node scripts/project-rename-walkthrough.mjs（需先 pnpm build）
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.project-rename-walk')
fs.mkdirSync(outDir, { recursive: true })
const settingsDir = makeTempDir('rename-settings-')
const projectsDir = makeTempDir('rename-projects-')

const { app, win } = await launchNomiApp({
  name: 'project-rename',
  settingsDir,
  projectsDir,
  env: { NOMI_RENDERER_URL: 'file://' + path.join(repoRoot, 'dist', 'index.html') },
})
const shot = async (win, name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }
const errors = []
let failed = false

try {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1600, height: 1000 })).catch(() => {})
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await win.waitForTimeout(1800)

  // 建一个项目再回到项目库（让列表里有卡片可改名）
  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2200)
  await win.keyboard.press('Escape').catch(() => {})
  // 回项目库（顶栏「项目库」）
  await win.getByText('项目库', { exact: false }).first().click()
  await win.waitForTimeout(1200)

  // 找项目卡片的名字（默认名「未命名项目 …」）
  const nameCell = win.locator('.truncate').filter({ hasText: /未命名项目|Untitled/ }).first()
  await nameCell.waitFor({ timeout: 8000 })
  const originalName = (await nameCell.innerText()).trim()
  console.log(`  原项目名：「${originalName}」`)
  await shot(win, '01-library-before.png')

  // 双击进入 inline 编辑
  await nameCell.dblclick()
  await win.waitForTimeout(500)
  const input = win.locator('input[aria-label*="重命名"], input[aria-label*="Rename"]').first()
  const editing = await input.count()
  console.log(`  双击后出现改名输入框 = ${editing > 0}`)
  if (editing === 0) { failed = true; console.error('  ❌ 双击没进入编辑态') }
  await shot(win, '02-editing.png')

  // 全选清空 + 输入新名 + Enter
  const NEW_NAME = '我的新项目名'
  await input.fill(NEW_NAME)
  await win.waitForTimeout(200)
  await input.press('Enter')
  await win.waitForTimeout(1000)

  // 卡片名应更新
  const updatedCell = win.locator('.truncate').filter({ hasText: NEW_NAME }).first()
  const nameUpdated = await updatedCell.count()
  console.log(`  卡片名更新为「${NEW_NAME}」= ${nameUpdated > 0}`)
  if (nameUpdated === 0) { failed = true; console.error('  ❌ 卡片名未更新') }
  await shot(win, '03-renamed.png')

  // 磁盘断言：project.json 的 name 改了、内容还在（payload 有 generationCanvas）
  await win.waitForTimeout(600)
  const projFiles = fs.readdirSync(projectsDir, { recursive: true }).filter((f) => String(f).endsWith('project.json'))
  let diskName = '', hasCanvas = false
  for (const f of projFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(projectsDir, String(f)), 'utf8'))
    if (data?.name) { diskName = String(data.name); hasCanvas = Boolean(data?.payload?.generationCanvas) }
  }
  console.log(`  磁盘 project.json name=「${diskName}」内容(generationCanvas)在=${hasCanvas}`)
  if (diskName !== NEW_NAME) { failed = true; console.error('  ❌ 磁盘 name 未改') }
  if (!hasCanvas) { failed = true; console.error('  ❌ payload 内容丢失！') }

  console.log(failed ? '\n❌ 走查有断言失败' : '\n✅ 项目库双击改名走查全过：双击→编辑→改名→卡片+磁盘都更新，内容不丢')
  if (errors.length) console.log('  ⚠️ 页面错误：', errors.slice(0, 5))
} catch (e) {
  failed = true
  console.error('❌ 走查异常：', e)
  try { const w = await app.firstWindow(); await shot(w, 'ERROR.png') } catch { /* noop */ }
} finally {
  await app.close()
}
process.exit(failed ? 1 : 0)
