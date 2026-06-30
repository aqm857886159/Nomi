// 真机走查（R13）：S1「实时操控角色走位 + 动作库」。
// 验：① 选中假人后头部出现「操控」并能进操控态；② 按住 W 假人在地面走位（前后截图看位移）；
// ③ 点动作库「下蹲」假人姿势变（截图人眼判断）；④ 退出操控 → 动作库消失、回编排态。
// 零额度：纯本地 3D 渲染，不碰生成 API。隔离 userData + 项目目录。
// 用法：pnpm run build && node tests/ux/scene3d-character-drive.walk.mjs
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, mkdirSync } from 'node:fs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = path.join(repoRoot, '.character-drive-lab')
mkdirSync(outDir, { recursive: true })
const tmp = mkdtempSync(path.join(os.tmpdir(), 'nomi-chardrive-walk-'))
const projectsDir = path.join(tmp, 'projects')
mkdirSync(projectsDir, { recursive: true })

const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.', `--user-data-dir=${path.join(tmp, 'udata')}`],
  cwd: repoRoot,
  // NOMI_E2E=1 关掉 COOP/COEP cross-origin isolation（否则卡死 Playwright CDP 握手→launch timeout，
  // 见 electron/main.ts:661）；NOMI_E2E_SMOKE=1 走隔离 smoke 项目设置。两个都要。
  env: { ...process.env, NOMI_E2E: '1', NOMI_E2E_SMOKE: '1', NOMI_PROJECTS_DIR: projectsDir },
})

const errors = []
const log = (m) => console.log(m)
const pass = { editorOpen: false, possessEntered: false, moved: false, poseChanged: false, persistsOnCanvasClick: false, exited: false }

try {
  const win = await app.firstWindow()
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  win.on('pageerror', (e) => errors.push(String(e)))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1800)
  // 关开屏介绍（每次跑用全新 userData → splash 必出，会拦点击）。优先点「跳过」，兜底 Escape。
  const splashSkip = win.locator('[data-splash-skip="true"]').first()
  if ((await splashSkip.count()) > 0) await splashSkip.click().catch(() => {})
  await win.keyboard.press('Escape').catch(() => {})
  await win.locator('.nomi-splash').first().waitFor({ state: 'detached', timeout: 6000 }).catch(() => {})

  // 开项目
  const card = win.locator('[data-project-card]').first()
  if ((await card.count()) > 0) await card.click()
  else {
    const blank = win.getByText('新建空白项目', { exact: false }).first()
    if ((await blank.count()) > 0) await blank.click()
  }
  await win.waitForTimeout(2500)
  await win.keyboard.press('Escape').catch(() => {})

  // 进生成画布
  const genTab = win.getByRole('button', { name: '生成', exact: false }).first()
  if ((await genTab.count()) > 0) await genTab.click()
  await win.waitForTimeout(1500)

  // 加 3D 节点
  const byName = win.getByRole('button', { name: '3D场景', exact: false })
  if ((await byName.count()) > 0) await byName.first().click()
  else {
    const cube = win.locator('[title*="3D"], [aria-label*="3D"]')
    if ((await cube.count()) > 0) await cube.first().click()
  }
  await win.waitForTimeout(2000)

  // 开编辑器
  const openEmpty = win.getByRole('button', { name: '打开 3D 编辑器', exact: false })
  if ((await openEmpty.count()) > 0) await openEmpty.first().click()
  await win.waitForTimeout(4000)
  const editor = win.locator('[aria-label="3D 场景编辑器"]')
  pass.editorOpen = (await editor.count()) > 0
  await win.screenshot({ path: path.join(outDir, 'cd-01-editor-open.png') })
  log(`  ${pass.editorOpen ? '✓' : '✗'} 编辑器打开`)

  // 把 header「速度」滑块拉到高档（验 run 动画触发 + 走得够快）
  const speed = win.locator('input[type="range"]').first()
  if ((await speed.count()) > 0) {
    await speed.evaluate((el) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(el, String(el.max || 16))
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await win.waitForTimeout(300)
  }

  // 选第一个假人（默认场景已有一个）
  const firstMan = win.getByText('假人', { exact: true }).first()
  if ((await firstMan.count()) > 0) { await firstMan.click(); await win.waitForTimeout(800) }

  // 点头部「操控」（选中单个假人才出现）
  const possessBtn = win.getByRole('button', { name: '操控', exact: false }).first()
  const possessCount = await possessBtn.count()
  if (possessCount > 0) { await possessBtn.click(); await win.waitForTimeout(1000) }
  const actionBar = win.locator('[aria-label="角色操控动作库"]')
  pass.possessEntered = (await actionBar.count()) > 0
  await win.screenshot({ path: path.join(outDir, 'cd-02-possessed-before-move.png') })
  log(`  ${pass.possessEntered ? '✓' : '✗'} 进入操控态（操控钮 count=${possessCount}，动作库出现=${pass.possessEntered}）`)

  // 把相机拖到接近水平的侧视角（possess 下 OrbitControls 仍可用，拖拽=转视角，不掉出操控），
  // 否则默认俯视看不清腿。再滚轮拉近一点。
  const canvasBox = await win.locator('canvas').first().boundingBox()
  if (canvasBox) {
    const cx0 = canvasBox.x + canvasBox.width * 0.5
    const cy0 = canvasBox.y + canvasBox.height * 0.45
    await win.mouse.move(cx0, cy0)
    await win.mouse.down()
    await win.mouse.move(cx0, cy0 - 150, { steps: 14 }) // 上拖 → 视角放平到侧视
    await win.mouse.up()
    await win.waitForTimeout(300)
    await win.mouse.move(cx0, cy0)
    await win.mouse.wheel(0, -320) // 拉近看清腿
    await win.waitForTimeout(400)
  }
  await win.screenshot({ path: path.join(outDir, 'cd-walk-sideview.png') })

  // 按住 W 走一段。键盘监听在 window 上，无需点画布聚焦。
  // 关键(动画切片)：按住期间隔 ~450ms 连截 3 帧，看腿是否在不同 stride 相位（真迈腿 vs 平移滑行）。
  await win.keyboard.down('KeyW')
  await win.waitForTimeout(500)
  await win.screenshot({ path: path.join(outDir, 'cd-walk-stride-a.png') })
  await win.waitForTimeout(450)
  await win.screenshot({ path: path.join(outDir, 'cd-walk-stride-b.png') })
  await win.waitForTimeout(450)
  await win.screenshot({ path: path.join(outDir, 'cd-walk-stride-c.png') })
  await win.keyboard.up('KeyW')
  await win.waitForTimeout(600)
  await win.screenshot({ path: path.join(outDir, 'cd-03-after-walk-W.png') })
  const stillPossessedAfterMove = (await win.locator('[aria-label="角色操控动作库"]').count()) > 0
  pass.moved = stillPossessedAfterMove // 位移靠 cd-02 vs cd-03 人眼判断；操控态须仍在
  log(`  ${pass.moved ? '✓' : '✗'} 按住 W 走位后仍在操控态（看 cd-02 vs cd-03 假人是否前移）`)

  // 动作库点「下蹲」（姿势变化人眼判断）
  const squat = win.getByRole('button', { name: '下蹲', exact: false }).first()
  const squatCount = await squat.count()
  if (squatCount > 0) { await squat.click(); await win.waitForTimeout(1500) }
  await win.screenshot({ path: path.join(outDir, 'cd-04-action-squat.png') })
  pass.poseChanged = squatCount > 0
  log(`  ${pass.poseChanged ? '✓' : '✗'} 点动作库「下蹲」（count=${squatCount}，看 cd-04 是否蹲下）`)

  // 回归（R13 实测修复）：点空白画布清选 → 操控态应仍在（不再随手点一下就掉出）
  await win.mouse.click(700, 320).catch(() => {})
  await win.waitForTimeout(600)
  pass.persistsOnCanvasClick = (await win.locator('[aria-label="角色操控动作库"]').count()) > 0
  await win.screenshot({ path: path.join(outDir, 'cd-04b-after-canvas-click.png') })
  log(`  ${pass.persistsOnCanvasClick ? '✓' : '✗'} 点空白画布后操控态仍在（修复回归）`)

  // 退出操控 → 动作库应消失
  const exitBtn = win.locator('[title="退出操控"]').first()
  if ((await exitBtn.count()) > 0) { await exitBtn.click(); await win.waitForTimeout(900) }
  const barGone = (await win.locator('[aria-label="角色操控动作库"]').count()) === 0
  pass.exited = barGone
  await win.screenshot({ path: path.join(outDir, 'cd-05-exited.png') })
  log(`  ${pass.exited ? '✓' : '✗'} 退出操控（动作库消失=${barGone}）`)

  log('\n═══ 结果 ═══')
  log(`  编辑器可开:      ${pass.editorOpen ? '✓' : '✗'}`)
  log(`  进入操控态:      ${pass.possessEntered ? '✓' : '✗'}`)
  log(`  执行走位:        ${pass.moved ? '✓(看图)' : '✗'}`)
  log(`  动作库切姿势:    ${pass.poseChanged ? '✓(看图)' : '✗'}`)
  log(`  点空白仍操控:    ${pass.persistsOnCanvasClick ? '✓' : '✗'}`)
  log(`  退出回编排态:    ${pass.exited ? '✓' : '✗'}`)
  log(errors.length ? `\nconsole errors:\n  ${errors.slice(0, 8).join('\n  ')}` : '\nno console errors')
  const ok = pass.editorOpen && pass.possessEntered && pass.moved && pass.poseChanged && pass.persistsOnCanvasClick && pass.exited
  await app.close()
  process.exit(ok ? 0 : 1)
} catch (err) {
  log(`\nFAIL: ${err?.message || err}`)
  try { const win = await app.firstWindow(); await win.screenshot({ path: path.join(outDir, 'cd-FAIL.png') }) } catch {}
  await app.close().catch(() => undefined)
  process.exit(1)
}
