// 验 WebGL 上下文丢失恢复：开编辑器→强制 loseContext()(画布应变空)→restoreContext()
// (demand 模式靠我们的 invalidate 重绘→假人应回来)。人眼看三张截图。
// 用法：pnpm run build && node tests/ux/scene3d-context-loss-recovery.walk.mjs
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import path from 'node:path'
import os from 'node:os'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { screenshotSettled } from './_assert.mjs'

const outDir = path.join(repoRoot, '.scene3d-ctxloss-lab')
mkdirSync(outDir, { recursive: true })
const tmp = mkdtempSync(path.join(os.tmpdir(), 'nomi-ctxloss-walk-'))
const projectsDir = path.join(tmp, 'projects')
mkdirSync(projectsDir, { recursive: true })

const { app, win } = await launchNomiApp({
  name: 'scene3d-context-loss-recovery',
  userDataDir: path.join(tmp, 'udata'),
  projectsDir,
  env: { NOMI_E2E_SMOKE: '1' },
  settleMs: 1800,
})

const log = (m) => console.log(m)
const pass = { editorOpen: false, lostBlank: false, recovered: false }

try {
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
  const byName = win.getByRole('button', { name: '3D场景', exact: false })
  if ((await byName.count()) > 0) await byName.first().click()
  await win.waitForTimeout(2000)
  const openEmpty = win.getByRole('button', { name: '打开 3D 编辑器', exact: false })
  if ((await openEmpty.count()) > 0) await openEmpty.first().click()
  await win.waitForTimeout(4500)
  pass.editorOpen = (await win.locator('[aria-label="3D 场景编辑器"] canvas').count()) > 0
  await screenshotSettled(win, { path: path.join(outDir, 'c-01-before.png') })
  log(`  ${pass.editorOpen ? '✓' : '✗'} 编辑器打开`)

  // 强制丢失上下文
  const lostOk = await win.evaluate(() => {
    const canvas = document.querySelector('[aria-label="3D 场景编辑器"] canvas')
    if (!canvas) return false
    const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl')
    const ext = ctx && ctx.getExtension('WEBGL_lose_context')
    if (!ext) return false
    window.__nomiLoseCtxExt = ext
    ext.loseContext()
    return true
  })
  await win.waitForTimeout(1200)
  await screenshotSettled(win, { path: path.join(outDir, 'c-02-lost.png') })
  log(`  loseContext 调用 ${lostOk ? '成功' : '失败'} → 看 c-02 是否变空`)

  // 恢复上下文（真机里浏览器自动补发；测试用扩展手动触发 restored）
  await win.evaluate(() => {
    const ext = window.__nomiLoseCtxExt
    if (ext) ext.restoreContext()
  })
  await win.waitForTimeout(2500)
  await screenshotSettled(win, { path: path.join(outDir, 'c-03-recovered.png') })
  log('  restoreContext 调用 → 看 c-03 假人是否回来')
} catch (e) {
  log(`✗ 异常：${String(e)}`)
} finally {
  await app.close()
  process.exit(0)
}
