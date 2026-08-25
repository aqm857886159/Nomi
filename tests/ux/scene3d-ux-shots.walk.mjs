// 导演台冷启动 UX 实况截图（R8 地基）：把冷用户看到的关键状态从真机截下来，
// 供「好用」的可测定义 + 简化/引导样张使用。零额度，隔离 userData。
// 用法：pnpm run build && node tests/ux/scene3d-ux-shots.walk.mjs
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import path from 'node:path'
import os from 'node:os'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { screenshotSettled } from './_assert.mjs'

const outDir = path.join(repoRoot, '.pose-lab')
mkdirSync(outDir, { recursive: true })
const tmp = mkdtempSync(path.join(os.tmpdir(), 'nomi-ux-shots-'))
const projectsDir = path.join(tmp, 'projects')
mkdirSync(projectsDir, { recursive: true })

const { app, win } = await launchNomiApp({
  name: 'scene3d-ux-shots',
  userDataDir: path.join(tmp, 'udata'),
  projectsDir,
  env: { NOMI_E2E_SMOKE: '1' },
  settleMs: 1800,
})
const log = (m) => console.log(m)
const shot = async (win, name) => {
  await screenshotSettled(win, { path: path.join(outDir, `${name}.png`) })
  log(`  📸 ${name}`)
}

try {
  await win.keyboard.press('Escape').catch(() => {})

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
  await win.waitForTimeout(1200)

  const byName = win.getByRole('button', { name: '3D场景', exact: false })
  if ((await byName.count()) > 0) await byName.first().click()
  await win.waitForTimeout(1500)
  const openEmpty = win.getByRole('button', { name: '打开 3D 编辑器', exact: false })
  if ((await openEmpty.count()) > 0) await openEmpty.first().click()
  await win.waitForTimeout(4000)

  // ① 冷用户第一屏
  await shot(win, 'ux-01-editor-default')

  // ② 选中假人（左列表点「假人」行）→ 右侧属性/姿势面板 + 头部「操控」钮
  const manRow = win.getByText('假人', { exact: false }).first()
  if ((await manRow.count()) > 0) await manRow.click()
  await win.waitForTimeout(1000)
  await shot(win, 'ux-02-mannequin-selected')

  // ③ 操控态（possess）→ 底部动作库条
  const possess = win.getByRole('button', { name: '操控', exact: false }).first()
  if ((await possess.count()) > 0) await possess.click()
  await win.waitForTimeout(1500)
  await shot(win, 'ux-03-possess-mode')
  const exit = win.getByRole('button', { name: /退出/, exact: false }).first()
  if ((await exit.count()) > 0) await exit.click()
  await win.waitForTimeout(800)

  // ④ 选中相机 → 相机预览浮窗 + 运镜预设面板
  const camRow = win.getByText('相机1', { exact: true }).first()
  if ((await camRow.count()) > 0) await camRow.click()
  await win.waitForTimeout(1200)
  await shot(win, 'ux-04-camera-selected')

  // ⑤ 底部「添加」菜单展开
  const addBtn = win.locator('button:has-text("添加")').last()
  if ((await addBtn.count()) > 0) await addBtn.click()
  await win.waitForTimeout(800)
  await shot(win, 'ux-05-add-menu-open')

  log('done')
} finally {
  await app.close().catch(() => {})
}
