// 真机走查（R13）：底部工具条「不再需要横向滚动」+「添加菜单」重做后对账。
// 验：① 编辑器底部条 scrollWidth ≤ clientWidth（窄窗也不溢出/不滚动）；
//     ② 点「添加」弹菜单（几何/假人/灯光/相机）；③ 点「几何模型」级联出子菜单；
//     ④ 点菜单外收起。零额度纯本地渲染。
// 用法：pnpm run build && node tests/ux/scene3d-toolbar-fit.walk.mjs
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, mkdirSync } from 'node:fs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = path.join(repoRoot, '.scene3d-toolbar-lab')
mkdirSync(outDir, { recursive: true })
const tmp = mkdtempSync(path.join(os.tmpdir(), 'nomi-toolbar-walk-'))
const projectsDir = path.join(tmp, 'projects')
mkdirSync(projectsDir, { recursive: true })

const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.', `--user-data-dir=${path.join(tmp, 'udata')}`],
  cwd: repoRoot,
  env: { ...process.env, NOMI_E2E: '1', NOMI_E2E_SMOKE: '1', NOMI_PROJECTS_DIR: projectsDir },
})

const log = (m) => console.log(m)
const pass = { editorOpen: false, noScroll: false, menuOpen: false, cascadeOpen: false, closedOutside: false }

try {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1800)
  // 窄窗压测：复现用户那种左右面板挤掉中间画布的窄场景
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    if (w) w.setBounds({ width: 1100, height: 720 })
  }).catch(() => {})
  await win.waitForTimeout(400)

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
  await win.waitForTimeout(4000)
  const editor = win.locator('[aria-label="3D 场景编辑器"]')
  pass.editorOpen = (await editor.count()) > 0
  await win.screenshot({ path: path.join(outDir, '01-editor-default.png') })
  log(`  ${pass.editorOpen ? '✓' : '✗'} 编辑器打开`)

  // ① 底部条不溢出
  const fit = await win.locator('[role="toolbar"]').first().evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  })).catch(() => null)
  pass.noScroll = !!fit && fit.scrollWidth <= fit.clientWidth + 1
  log(`  ${pass.noScroll ? '✓' : '✗'} 底部条不滚动 ${JSON.stringify(fit)}`)

  // ② 点「添加」弹菜单
  const addBtn = win.getByRole('button', { name: '添加', exact: true }).first()
  if ((await addBtn.count()) > 0) await addBtn.click()
  await win.waitForTimeout(400)
  const addMenu = win.locator('[role="menu"][aria-label="添加 3D 节点"]')
  pass.menuOpen = (await addMenu.count()) > 0
  await win.screenshot({ path: path.join(outDir, '02-add-menu.png') })
  log(`  ${pass.menuOpen ? '✓' : '✗'} 添加菜单弹出`)

  // ③ 级联「几何模型」
  const geo = win.getByRole('menuitem', { name: '几何模型', exact: false }).first()
  if ((await geo.count()) > 0) await geo.click()
  await win.waitForTimeout(400)
  const geoMenu = win.locator('[role="menu"][aria-label="添加几何模型"]')
  pass.cascadeOpen = (await geoMenu.count()) > 0
  await win.screenshot({ path: path.join(outDir, '03-geometry-cascade.png') })
  log(`  ${pass.cascadeOpen ? '✓' : '✗'} 几何模型级联`)

  // ④ 点菜单外收起
  await win.mouse.click(550, 300)
  await win.waitForTimeout(400)
  pass.closedOutside = (await win.locator('[role="menu"][aria-label="添加 3D 节点"]').count()) === 0
  await win.screenshot({ path: path.join(outDir, '04-closed.png') })
  log(`  ${pass.closedOutside ? '✓' : '✗'} 点外收起`)
} catch (e) {
  log(`✗ 异常：${String(e)}`)
} finally {
  const ok = Object.values(pass).every(Boolean)
  log(`\n结果：${JSON.stringify(pass)} → ${ok ? '全过' : '有挂'}`)
  await app.close()
  process.exit(ok ? 0 : 1)
}
