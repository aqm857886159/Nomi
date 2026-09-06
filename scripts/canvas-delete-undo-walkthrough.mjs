// R13 真机走查：多选删除误删安全网（2026-07-24 群反馈「画板编辑多出图，凭直觉 del 把 4 张全删了」）。
// 修复=键盘 del 删多个节点后弹「已删除 N 个 · 撤销」toast，点撤销复用画布 undo 恢复。
// 验证链：加 2 节点 → 全选 → Delete → ① 撤销 toast 出现 + 节点删空 → 点撤销 → ② 节点恢复。
// 用法：node scripts/canvas-delete-undo-walkthrough.mjs（需先 pnpm build）
import { launchNomiApp, repoRoot } from '../tests/ux/_launchApp.mjs'
import { addCanvasNodeFromRail } from '../tests/ux/_canvasRail.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const outDir = path.join(repoRoot, '.canvas-delete-undo-walk')
fs.mkdirSync(outDir, { recursive: true })
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'del-undo-settings-'))
const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'del-undo-projects-'))

const { app, win } = await launchNomiApp({
  name: 'canvas-delete-undo',
  settingsDir,
  projectsDir,
  env: { NOMI_RENDERER_URL: 'file://' + path.join(repoRoot, 'dist', 'index.html') },
  settleMs: 1800,
})
const shot = async (win, name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }
const errors = []
let failed = false

async function addImageNode(win) {
  // 左缘点法收口在 ../tests/ux/_canvasRail.mjs：结构锚点，不认走 i18n 的 aria-label，找不到当场抛。
  await addCanvasNodeFromRail(win, 'image')
  await win.waitForTimeout(700)
}

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

  // 加 2 个图片节点
  await addImageNode(win)
  await addImageNode(win)
  const nodeSel = '[data-kind="image"][data-node-id]'
  await win.waitForTimeout(600)
  const before = await win.locator(nodeSel).count()
  console.log(`  加了 ${before} 个节点`)
  if (before < 2) { failed = true; console.error('  ❌ 期望 ≥2 个节点') }
  await shot(win, '01-two-nodes.png')

  // 点画布空白让焦点离开 composer textarea（否则 del 被放行给文本编辑），再 Cmd+A 全选
  await win.mouse.click(200, 900)
  await win.waitForTimeout(300)
  await win.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
  await win.waitForTimeout(500)

  // Delete → 应删空 + 弹撤销 toast
  await win.keyboard.press('Delete')
  await win.waitForTimeout(900)
  const afterDelete = await win.locator(nodeSel).count()
  const bodyText = await win.locator('body').innerText()
  const hasUndoToast = /已删除\s*\d+\s*个节点/.test(bodyText) && bodyText.includes('撤销')
  console.log(`  删除后节点数=${afterDelete} | 撤销 toast 出现=${hasUndoToast}`)
  await shot(win, '02-deleted-with-undo-toast.png')
  if (afterDelete !== 0) { failed = true; console.error('  ❌ 全选删除后应为 0 个节点') }
  if (!hasUndoToast) { failed = true; console.error('  ❌ 未出现「已删除 N 个节点 · 撤销」toast') }

  // 点撤销 toast（Mantine notification，onClick=undo）→ 节点恢复
  const toast = win.getByText(/已删除\s*\d+\s*个节点/).first()
  if (await toast.count()) {
    await toast.click()
    await win.waitForTimeout(900)
  }
  const afterUndo = await win.locator(nodeSel).count()
  console.log(`  点撤销后节点数=${afterUndo}（期望恢复到 ${before}）`)
  await shot(win, '03-after-undo-restored.png')
  if (afterUndo !== before) { failed = true; console.error(`  ❌ 撤销未恢复节点（${afterUndo} ≠ ${before}）`) }

  console.log(failed ? '\n❌ 走查有断言失败' : '\n✅ 误删安全网走查全过：删多个→撤销 toast→点撤销→节点恢复')
  if (errors.length) console.log('  ⚠️ 页面错误：', errors.slice(0, 5))
} catch (e) {
  failed = true
  console.error('❌ 走查异常：', e)
  try { const w = await app.firstWindow(); await shot(w, 'ERROR.png') } catch { /* noop */ }
} finally {
  await app.close()
}
process.exit(failed ? 1 : 0)
