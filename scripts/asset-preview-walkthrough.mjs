import { makeTempDir } from './_test-temp.mjs'
// R13 真机走查：素材库双击放大预览（#52 群反馈「加个双击放大预览」）。
// 验证链：进画布 → 素材库 tab → 上传一张图 → 双击素材 → 全屏预览 lightbox 出现 → Esc 关闭。
// 用法：node scripts/asset-preview-walkthrough.mjs（需先 pnpm build）
import { launchNomiApp, repoRoot } from '../tests/ux/_launchApp.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const outDir = path.join(repoRoot, '.asset-preview-walk')
fs.mkdirSync(outDir, { recursive: true })
const settingsDir = makeTempDir('asset-preview-settings-')
const projectsDir = makeTempDir('asset-preview-projects-')

// 1x1 红点 png 作上传素材
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const uploadPng = path.join(outDir, 'sample.png')
fs.writeFileSync(uploadPng, TINY_PNG)

const { app, win } = await launchNomiApp({
  name: 'asset-preview',
  settingsDir,
  projectsDir,
  env: { NOMI_RENDERER_URL: 'file://' + path.join(repoRoot, 'dist', 'index.html') },
  settleMs: 1800,
})
const shot = async (win, name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }
const errors = []
let failed = false

try {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1600, height: 1000 })).catch(() => {})
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2200)
  await win.keyboard.press('Escape').catch(() => {})
  await win.getByText('生成', { exact: true }).first().click()
  await win.waitForTimeout(1000)

  // 素材库 tab（默认 asset-library，保险点一下「素材库」）
  const assetTab = win.getByRole('button', { name: /素材库|Asset library/ }).first()
  if (await assetTab.count()) { await assetTab.click().catch(() => {}); await win.waitForTimeout(600) }

  // 上传一张图到**素材库**（不是画布导入）——素材库上传 input 有独特 aria-label「素材文件选择器」
  const fileInput = win.locator('input[aria-label="素材文件选择器"]')
  await fileInput.waitFor({ state: 'attached', timeout: 8000 })
  await fileInput.setInputFiles(uploadPng)
  await win.waitForTimeout(2400)

  // 「全部素材」跨项目、新项目可能未进索引；切「项目素材」直读当前项目（上传落这里）
  const projectTab = win.getByText('项目素材', { exact: false }).first()
  if (await projectTab.count()) { await projectTab.click().catch(() => {}); await win.waitForTimeout(1500) }

  const tile = win.locator('[aria-selected]').filter({ has: win.locator('img') }).first()
  const tileCount = await tile.count()
  console.log(`  上传后素材 tile = ${tileCount}`)
  if (tileCount === 0) { failed = true; console.error('  ❌ 上传的素材没出现在素材库') }
  await shot(win, '01-asset-in-library.png')

  // 双击素材 → 预览 lightbox
  await tile.dblclick()
  await win.waitForTimeout(900)
  const dialog = win.locator('[role="dialog"][aria-label*="放大预览"], [role="dialog"][aria-label*="preview"]').first()
  const previewOpen = await dialog.count()
  console.log(`  双击后预览 lightbox 出现 = ${previewOpen > 0}`)
  if (previewOpen === 0) { failed = true; console.error('  ❌ 双击没弹出预览') }
  await shot(win, '02-preview-open.png')

  // Esc 关闭
  await win.keyboard.press('Escape')
  await win.waitForTimeout(700)
  const stillOpen = await win.locator('[role="dialog"][aria-label*="放大预览"], [role="dialog"][aria-label*="preview"]').count()
  console.log(`  Esc 后预览关闭 = ${stillOpen === 0}`)
  if (stillOpen !== 0) { failed = true; console.error('  ❌ Esc 没关闭预览') }
  await shot(win, '03-closed.png')

  console.log(failed ? '\n❌ 走查有断言失败' : '\n✅ 素材双击预览走查全过：上传→双击→lightbox→Esc 关闭')
  if (errors.length) console.log('  ⚠️ 页面错误：', errors.slice(0, 5))
} catch (e) {
  failed = true
  console.error('❌ 走查异常：', e)
  try { const w = await app.firstWindow(); await shot(w, 'ERROR.png') } catch { /* noop */ }
} finally {
  await app.close()
}
process.exit(failed ? 1 : 0)
