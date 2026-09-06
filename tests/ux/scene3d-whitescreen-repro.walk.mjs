// 复现白屏：开编辑器(默认1假人)→加第2个假人→看画布是否还在渲染 + 抓全部 console/page 错误。
// 用法：pnpm run build && node tests/ux/scene3d-whitescreen-repro.walk.mjs
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import path from 'node:path'
import os from 'node:os'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { screenshotSettled } from './_assert.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'

const outDir = path.join(repoRoot, '.scene3d-whitescreen-lab')
mkdirSync(outDir, { recursive: true })
const tmp = mkdtempSync(path.join(os.tmpdir(), 'nomi-white-walk-'))
const projectsDir = path.join(tmp, 'projects')
mkdirSync(projectsDir, { recursive: true })

const { app, win } = await launchNomiApp({
  name: 'scene3d-whitescreen-repro',
  userDataDir: path.join(tmp, 'udata'),
  projectsDir,
  env: { NOMI_E2E_SMOKE: '1' },
  settleMs: 1800,
})

const log = (m) => console.log(m)
const consoleErrors = []
const pageErrors = []
let ok = false

try {
  win.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  win.on('pageerror', (e) => pageErrors.push(String(e?.stack || e)))

  const splashSkip = win.locator('[data-splash-skip="true"]').first()
  if ((await splashSkip.count()) > 0) await splashSkip.click().catch(() => {})
  await win.keyboard.press('Escape').catch(() => {})
  await win.locator('.nomi-splash').first().waitFor({ state: 'detached', timeout: 6000 }).catch(() => {})

  const card = win.locator('[data-project-card]').first()
  if ((await card.count()) > 0) await card.click()
  else {
    const blank = win.getByText('新建空白项目', { exact: false }).first()
    if ((await blank.count()) > 0) await blank.click()
  }
  await win.waitForTimeout(2500)
  await win.keyboard.press('Escape').catch(() => {})

  const genTab = win.getByRole('button', { name: '生成', exact: false }).first()
  if ((await genTab.count()) > 0) await genTab.click()
  await win.waitForTimeout(1500)

  // 3D 场景自 2026-09-06「第三档」起住在左缘的「更多」里。（原来那个
  // `name: '3D场景'` 的按名选择器少一个空格，本来就选不中——软守卫把它藏了很久。）
  await addCanvasNodeFromRail(win, 'scene3d')
  await win.waitForTimeout(2000)

  const openEmpty = win.getByRole('button', { name: '打开 3D 编辑器', exact: false })
  if ((await openEmpty.count()) > 0) await openEmpty.first().click()
  await win.waitForTimeout(4500)

  const editor = win.locator('[aria-label="3D 场景编辑器"]')
  const canvasGone = async () => (await editor.locator('canvas').count()) === 0
  const initialCanvasGone = await canvasGone()
  log(`  默认(1假人) canvas 不见? ${initialCanvasGone}  err=${consoleErrors.length}/${pageErrors.length}`)
  await screenshotSettled(win, { path: path.join(outDir, 'w-01-default.png') })

  // 加第 2 个假人：旧条直接点「假人」按钮；新条点「添加」→「假人」→「单个假人」
  const addToggle = win.getByRole('button', { name: '添加', exact: true }).first()
  if ((await addToggle.count()) > 0) {
    await addToggle.click(); await win.waitForTimeout(300)
    const charRow = win.getByRole('menuitem', { name: '假人', exact: false }).first()
    if ((await charRow.count()) > 0) { await charRow.click(); await win.waitForTimeout(300) }
    const single = win.getByRole('menuitem', { name: '单个假人', exact: false }).first()
    if ((await single.count()) > 0) await single.click()
  } else {
    const charBtn = win.getByRole('button', { name: '假人', exact: false }).first()
    if ((await charBtn.count()) > 0) { await charBtn.click(); await win.waitForTimeout(300) }
    const single = win.getByText('单个假人', { exact: false }).first()
    if ((await single.count()) > 0) await single.click()
  }
  await win.waitForTimeout(3500)

  const twoMannequinCanvasGone = await canvasGone()
  log(`  加第2假人后 canvas 不见? ${twoMannequinCanvasGone}  err=${consoleErrors.length}/${pageErrors.length}`)
  await screenshotSettled(win, { path: path.join(outDir, 'w-02-two-mannequins.png') })

  // 关编辑器 → 重开（走「从磁盘恢复已存场景」路径，跟用户的 2 假人场景一致）
  const closeBtn = editor.locator('[title="退出 3D 场景"]').first()
  await closeBtn.waitFor({ state: 'visible', timeout: 5000 })
  await closeBtn.click()
  await editor.waitFor({ state: 'hidden', timeout: 5000 })
  await win.waitForTimeout(1500)
  const reopen = win.getByRole('button', { name: '打开 3D 编辑器', exact: false }).first()
  if ((await reopen.count()) === 0) {
    // 双击 3D 节点重开
    const node = win.locator('[data-node-kind="scene3d"], [data-testid*="scene3d"]').first()
    if ((await node.count()) > 0) await node.dblclick()
  } else await reopen.click()
  await win.waitForTimeout(4500)
  const reopenedCanvasGone = await canvasGone()
  log(`  重开编辑器后 canvas 不见? ${reopenedCanvasGone}  err=${consoleErrors.length}/${pageErrors.length}`)
  await screenshotSettled(win, { path: path.join(outDir, 'w-03-reopened.png') })

  log('\n=== console errors ===')
  consoleErrors.slice(0, 20).forEach((e) => log('  • ' + e.slice(0, 300)))
  log('=== page errors ===')
  pageErrors.slice(0, 20).forEach((e) => log('  • ' + e.slice(0, 500)))
  ok = !initialCanvasGone && !twoMannequinCanvasGone && !reopenedCanvasGone
    && consoleErrors.length === 0 && pageErrors.length === 0
  log(`\n${ok ? '✓ PASS' : '✗ FAIL'}：3D 双假人场景与重开流程无白屏、无脚本错误`)
} catch (e) {
  log(`✗ 异常：${String(e)}`)
} finally {
  await app.close().catch(() => undefined)
  process.exit(ok ? 0 : 1)
}
