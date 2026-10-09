// R13 真机走查：集中设置页 + 自动另存（2026-08-01 用户拍板）。
// 验证链：项目库顶栏齿轮 → 设置页出现（左tab右内容）→ 目录显示预设值 → 开自动另存开关 →
// download-prefs.json 落 autoSaveEnabled=true → 切「通用」tab（占位）→ Esc 关闭。
// 用法：node scripts/settings-autosave-walkthrough.mjs（需先 pnpm build）
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.settings-autosave-walk')
fs.mkdirSync(outDir, { recursive: true })
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-walk-'))
const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-projects-'))
const saveTargetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autosave-target-'))
// 预写 download-prefs.json：给目录一个初值（让设置页目录行显示有值），开关关（走查里开它验证持久化）。
const prefsFile = path.join(settingsDir, 'download-prefs.json')
fs.writeFileSync(prefsFile, JSON.stringify({ autoSaveEnabled: false, autoSaveDir: saveTargetDir }, null, 2))

const { app, win } = await launchNomiApp({
  name: 'settings-autosave',
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

  // 项目库顶栏齿轮
  const gear = win.getByRole('button', { name: '设置', exact: true }).first()
  await gear.waitFor({ timeout: 8000 })
  await gear.click()
  await win.waitForTimeout(700)

  const dialog = win.locator('[role="dialog"][aria-label="设置"]').first()
  const dialogOpen = await dialog.count()
  console.log(`  设置页出现 = ${dialogOpen > 0}`)
  if (dialogOpen === 0) { failed = true; console.error('  ❌ 齿轮没打开设置页') }
  // 目录行应显示预设的 saveTargetDir（basename）
  const bodyText = await win.locator('body').innerText()
  const dirShown = bodyText.includes(path.basename(saveTargetDir))
  console.log(`  目录行显示预设目录 = ${dirShown}`)
  await shot(win, '01-settings-open.png')

  // 开自动另存开关（DesignSwitch = Mantine Switch）：input 是 sr-only，点可见的 track 切换。
  const track = dialog.locator('.mantine-Switch-track').first()
  await track.waitFor({ timeout: 6000 })
  await track.click()
  await win.waitForTimeout(900)
  await shot(win, '02-autosave-on.png')

  // 验证 download-prefs.json 落盘 autoSaveEnabled=true
  const prefs = JSON.parse(fs.readFileSync(prefsFile, 'utf8'))
  console.log(`  download-prefs 落盘：enabled=${prefs.autoSaveEnabled} dir 保留=${prefs.autoSaveDir === saveTargetDir}`)
  if (prefs.autoSaveEnabled !== true) { failed = true; console.error('  ❌ 开关没持久化 enabled=true') }
  if (prefs.autoSaveDir !== saveTargetDir) { failed = true; console.error('  ❌ 目录被开关覆盖丢了') }

  // 切「通用」tab → 占位
  await dialog.getByText('通用', { exact: true }).first().click().catch(() => {})
  await win.waitForTimeout(500)
  await shot(win, '03-general-tab.png')

  // Esc 关闭
  await win.keyboard.press('Escape')
  await win.waitForTimeout(600)
  const stillOpen = await win.locator('[role="dialog"][aria-label="设置"]').count()
  console.log(`  Esc 后关闭 = ${stillOpen === 0}`)
  if (stillOpen !== 0) { failed = true; console.error('  ❌ Esc 没关闭设置页') }

  // studio 入口：新建项目进画布 → studio 顶栏齿轮 → 同一设置页（另一入口）
  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2400)
  await win.keyboard.press('Escape').catch(() => {})
  // 限定 studio 顶栏（.nomi-appbar）——项目库是 hidden 切换不卸载，getByRole first() 会误点隐藏的项目库齿轮。
  const studioGear = win.locator('[data-shell-topbar]').getByRole('button', { name: '设置', exact: true }).first()
  await studioGear.waitFor({ timeout: 8000 })
  await studioGear.click()
  await win.waitForTimeout(700)
  const studioDialog = await win.locator('[role="dialog"][aria-label="设置"]').count()
  console.log(`  studio 顶栏齿轮开设置页 = ${studioDialog > 0}`)
  if (studioDialog === 0) { failed = true; console.error('  ❌ studio 齿轮没开设置页') }
  await shot(win, '04-studio-settings.png')

  console.log(failed ? '\n❌ 走查有断言失败' : '\n✅ 集中设置页走查全过：项目库齿轮→设置页→开关持久化→Esc关闭；studio 顶栏齿轮也能开')
  if (errors.length) console.log('  ⚠️ 页面错误：', errors.slice(0, 5))
} catch (e) {
  failed = true
  console.error('❌ 走查异常：', e)
  try { const w = await app.firstWindow(); await shot(w, 'ERROR.png') } catch { /* noop */ }
} finally {
  await app.close()
}
process.exit(failed ? 1 : 0)
