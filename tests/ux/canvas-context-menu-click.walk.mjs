// R13 走查：画布右键菜单**点得动**（2026-08-18 从私有 fork 比对中捞出的回归）。
//
// 病象：右键画布空白 → 弹出「添加节点」菜单 → 点里面任何一项 → 什么都没发生。
// 根因：stage 的 pointerdown **capture** 处理器无条件 `setContextNodeMenu(null)`。
// capture 是 root→target，先于 target 自己的 bubble 处理器，所以菜单上挂的
// `onPointerDown={e => e.stopPropagation()}` 根本来不及拦——菜单在 click 落地前就被卸载了，
// click 没有目标，整条动作静默丢失。
// 同一处早就为「边菜单」写过豁免和注释，却被 `if (!activeEdgeId) return` 挡在后面，
// 只保护了边菜单，节点右键菜单漏在上一行（P2：修了实例没修类）。
//
// 为什么必须走查而不是单测：本仓单测跑在 node 环境（无 DOM、无 jsdom），
// 而这条 bug 的全部要害就在**真实事件相位**——capture 与 bubble 谁先谁后。
// 只有真 Electron 里真的点一下才证得了。
//
// 判据是**副作用**不是截图：点菜单项前后数节点数量，多出一个才算点着了。
// 真 Electron + 真构建产物，隔离 userData / projects，全程不发生成请求（零额度）。
// 用法：pnpm run build && node tests/ux/canvas-context-menu-click.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { expectVisible, expect, screenshotSettled } from './_assert.mjs'
import { mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findBlankCanvasPoint } from './_canvasPoints.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/canvas-context-menu-click')
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nomi-ctx-menu-'))
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
mkdirSync(projectsDir, { recursive: true })
mkdirSync(shotsDir, { recursive: true })

const { app, win: initialWin } = await launchNomiApp({
  name: 'canvas-context-menu-click',
  userDataDir,
  settingsDir: userDataDir,
  projectsDir,
  args: ['--no-proxy-server'],
  settleMs: 0,
})

let passed = 0
function assert(condition, label, detail = '') {
  if (!condition) throw new Error(`WALK FAIL: ${label}${detail ? ` — ${detail}` : ''}`)
  passed += 1
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
}

let win = initialWin
const getWin = () => {
  const live = app.windows().filter((candidate) => !candidate.isClosed())
  win = live.find((candidate) => /projectId=/.test(candidate.url())) || live[live.length - 1] || win
  return win
}

async function snap(name) {
  const file = path.join(shotsDir, name)
  await screenshotSettled(getWin(), { path: file })
  console.log(`  · 截图 ${name}`)
  return file
}

async function dismissFirstRun() {
  for (let index = 0; index < 6; index += 1) {
    const action = getWin().locator('button, [role="button"], a', { hasText: /跳过|完成|知道了|开始创作|稍后/ }).first()
    if (await action.isVisible().catch(() => false)) await action.click({ timeout: 900 }).catch(() => {})
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(180)
  }
}

async function resize(width, height) {
  const browserWindow = await app.browserWindow(getWin())
  await browserWindow.evaluate((target, size) => {
    target.setBounds({ x: 0, y: 0, width: size.width, height: size.height })
    target.center()
  }, { width, height })
  await getWin().waitForTimeout(350)
}

const countNodes = () => getWin().evaluate(() => document.querySelectorAll('.generation-canvas-v2-node').length)

// 找一块「真·空白」：命中 stage 本身、不落在任何节点/工具条/菜单上。
async function findBlankPoint() {
  // 扫描 + 真实鼠标到位复验，见 tests/ux/_canvasPoints.mjs（磁性「+」句柄只在光标下才冒出来）。
  return findBlankCanvasPoint(getWin(), { rows: [0.3, 0.45, 0.6, 0.72, 0.85], columns: [0.55, 0.65, 0.75, 0.85, 0.45, 0.35] })
}

try {
  await getWin().waitForLoadState('domcontentloaded')
  await getWin().waitForTimeout(1500)
  await dismissFirstRun()

  const blankProject = getWin().locator('button, [role="button"]', { hasText: '新建空白项目' }).first()
  await blankProject.waitFor({ timeout: 8000 })
  await blankProject.click()
  await getWin().waitForTimeout(2200)
  await dismissFirstRun()
  await resize(1600, 1000)

  const generation = getWin().getByRole('button', { name: '生成', exact: true }).first()
  await generation.waitFor({ timeout: 8000 })
  await generation.click()
  await getWin().locator('.generation-canvas-v2-toolbar').waitFor({ timeout: 8000 })
  await snap('01-canvas.png')

  // ── 右键空白 → 菜单必须弹出 ───────────────────────────────────────────
  const blank = await findBlankPoint()
  assert(Boolean(blank), '找得到一块画布空白', JSON.stringify(blank))

  const nodesBefore = await countNodes()
  await getWin().mouse.click(blank.x, blank.y, { button: 'right' })
  await getWin().waitForTimeout(400)

  const menu = getWin().locator('.generation-canvas-v2__context-node-menu')
  await expectVisible(menu, '右键空白后「添加节点」菜单弹出')
  passed += 1
  console.log('  ✓ 右键空白后「添加节点」菜单弹出')
  await snap('02-menu-open.png')

  // ── 点菜单项 → 必须真的建出节点（这一条就是本次修复的判据）─────────────
  // 用 role 定位而不是 class：走的正是 isCanvasMenuTarget 认的那套 ARIA 语义。
  const firstItem = menu.locator('[role="menuitem"]').first()
  await expectVisible(firstItem, '菜单里有可点的菜单项')
  const itemLabel = (await firstItem.textContent())?.trim() || '(无文本)'
  await firstItem.click({ timeout: 5000 })
  await getWin().waitForTimeout(900)

  const nodesAfter = await countNodes()
  await snap('03-after-click.png')
  assert(
    nodesAfter === nodesBefore + 1,
    `点「${itemLabel}」真的建出了节点（修复前这一步静默丢失）`,
    `${nodesBefore} → ${nodesAfter}`,
  )

  // 菜单在动作完成后应当收起——证明我们没有把「永不收菜单」当成修法。
  await expect(menu, '动作完成后菜单收起（豁免只针对菜单目标，不是永不收起）')
    .toBeHidden({ timeout: 5000 })
  passed += 1
  console.log('  ✓ 动作完成后菜单收起')

  // ── 反向对照：点真空白仍然要收起菜单 ──────────────────────────────────
  const blank2 = await findBlankPoint()
  assert(Boolean(blank2), '新增节点后仍找得到画布空白', JSON.stringify(blank2))
  await getWin().mouse.click(blank2.x, blank2.y, { button: 'right' })
  await getWin().waitForTimeout(400)
  await expectVisible(menu, '再次右键弹出菜单')
  const blank3 = await findBlankPoint()
  assert(Boolean(blank3), '菜单打开后仍找得到画布空白', JSON.stringify(blank3))
  await getWin().mouse.click(blank3.x, blank3.y)
  await getWin().waitForTimeout(500)
  await expect(menu, '左键点空白仍然收起菜单（没有因为豁免而卡住不收）')
    .toBeHidden({ timeout: 5000 })
  passed += 1
  console.log('  ✓ 左键点空白仍然收起菜单')
  await snap('04-dismiss-on-blank.png')

  console.log(`\n✅ 走查通过：${passed} 条判据`)
} finally {
  await app.close().catch(() => {})
}
