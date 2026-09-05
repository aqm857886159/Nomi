// R13 走查：右键节点弹「节点操作」菜单，且点「复制」真的能复制（2026-08-20 拍板样张 A）。
//
// 来历：群反馈 G1#4968「copy 键是啥呢？ctrl+c 没有用啊」。实测快捷键**是好的**——
// 真问题是画布上一个可见的复制入口都没有：右键节点被写在排除名单里、什么都不弹，
// 节点工具条与多选工具条也都没有复制钮。这条走查钉住修复后的形态。
//
// 判据取**副作用**不取截图：点「复制」再按 mod+V，节点数必须 +1。
// 只断言「菜单弹出来了」是不够的——菜单能弹但动作接错 store 的话照样报绿（本仓栽过：
// 右键菜单点了没反应活过了七道门岗，见 canvas-context-menu-click.walk.mjs 的抬头）。
//
// 同时守住不回归：右键**空白**仍要弹「添加节点」菜单（那条路没被这次改动带坏）。
// 真 Electron + 真构建产物，隔离 userData / projects，全程不发生成请求（零额度）。
// 用法：pnpm run build && node tests/ux/canvas-node-context-menu.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { expectAbsent, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'
import { mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findBlankCanvasPoint } from './_canvasPoints.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/canvas-node-context-menu')
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nomi-node-menu-'))
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
mkdirSync(projectsDir, { recursive: true })
mkdirSync(shotsDir, { recursive: true })

const { app, win: initialWin } = await launchNomiApp({
  name: 'canvas-node-context-menu',
  userDataDir, settingsDir: userDataDir, projectsDir,
  args: ['--no-proxy-server'], settleMs: 0,
})

let passed = 0
function assert(condition, label, detail = '') {
  if (!condition) throw new Error(`WALK FAIL: ${label}${detail ? ` — ${detail}` : ''}`)
  passed += 1
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
}

let win = initialWin
const getWin = () => {
  const live = app.windows().filter((c) => !c.isClosed())
  win = live.find((c) => /projectId=/.test(c.url())) || live[live.length - 1] || win
  return win
}
const snap = async (n) => { await screenshotSettled(getWin(), { path: path.join(shotsDir, n) }); console.log(`  · 截图 ${n}`) }

async function dismissFirstRun() {
  for (let i = 0; i < 6; i += 1) {
    const a = getWin().locator('button, [role="button"], a', { hasText: /跳过|完成|知道了|开始创作|稍后/ }).first()
    if (await a.isVisible().catch(() => false)) await a.click({ timeout: 900 }).catch(() => {})
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(180)
  }
}
async function resize(w, h) {
  const bw = await app.browserWindow(getWin())
  await bw.evaluate((t, s) => { t.setBounds({ x: 0, y: 0, width: s.width, height: s.height }); t.center() }, { width: w, height: h })
  await getWin().waitForTimeout(350)
}

const countNodes = () => getWin().evaluate(() => document.querySelectorAll('.generation-canvas-v2-node').length)

async function findBlankPoint() {
  // 扫描 + 真实鼠标到位复验，见 tests/ux/_canvasPoints.mjs（磁性「+」句柄只在光标下才冒出来）。
  return findBlankCanvasPoint(getWin(), { rows: [0.3, 0.45, 0.6, 0.75], columns: [0.6, 0.7, 0.8, 0.5, 0.4] })
}

try {
  await getWin().waitForLoadState('domcontentloaded')
  await getWin().waitForTimeout(1500)
  await dismissFirstRun()
  await getWin().locator('button, [role="button"]', { hasText: '新建空白项目' }).first().click()
  await getWin().waitForTimeout(2200)
  await dismissFirstRun()
  await resize(1600, 1000)
  await getWin().getByRole('button', { name: '生成', exact: true }).first().click()
  await getWin().locator('.generation-canvas-v2-toolbar').waitFor({ timeout: 8000 })

  // ── 先用「右键空白 → 添加节点」建一个节点（顺带守住这条路没被带坏）──
  const blank = await findBlankPoint()
  assert(Boolean(blank), '找得到画布空白点')
  await getWin().mouse.click(blank.x, blank.y, { button: 'right' })
  await getWin().waitForTimeout(400)
  const addMenu = getWin().locator('.generation-canvas-v2__context-node-menu')
  await expectVisible(addMenu, '右键空白仍弹「添加节点」菜单（未回归）')
  passed += 1
  console.log('  ✓ 右键空白仍弹「添加节点」菜单（未回归）')
  await addMenu.locator('[role="menuitem"]').filter({ hasText: '图片' }).first().click()
  await getWin().waitForTimeout(1000)
  assert(await countNodes() === 1, '建出了 1 个节点', `${await countNodes()}`)

  // ── 右键**节点** → 必须弹「节点操作」菜单（改动前这里什么都不弹）──
  const node = getWin().locator('.generation-canvas-v2-node').first()
  const box = await node.boundingBox()
  await getWin().mouse.click(box.x + box.width / 2, box.y + 10, { button: 'right' })
  await getWin().waitForTimeout(500)
  const nodeMenu = getWin().locator('.generation-canvas-v2__node-context-menu')
  await expectVisible(nodeMenu, '右键节点弹出「节点操作」菜单')
  passed += 1
  console.log('  ✓ 右键节点弹出「节点操作」菜单')
  // 拿到基线：这个选择器**确实找得到**菜单。后面断言「菜单收起」才不是恒真的空话。
  const nodeMenuProbe = await proveProbe(nodeMenu, '节点操作菜单')
  await snap('01-node-menu.png')

  // 菜单里要认得出复制，并且带快捷键提示（这是「用一次就学会」的关键）
  const copyItem = nodeMenu.locator('[role="menuitem"]').filter({ hasText: '复制' }).first()
  await expectVisible(copyItem, '菜单里有「复制」项')
  passed += 1
  console.log('  ✓ 菜单里有「复制」项')
  const copyText = (await copyItem.textContent()) || ''
  assert(/⌘|Ctrl/.test(copyText), '「复制」项右侧标出了快捷键', JSON.stringify(copyText.trim()))

  // ── 判据：点「复制」+ mod+V，节点数必须真的 +1 ──
  const before = await countNodes()
  await copyItem.click()
  await getWin().waitForTimeout(500)
  await getWin().keyboard.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v')
  await getWin().waitForTimeout(1200)
  const after = await countNodes()
  await snap('02-after-copy-paste.png')
  assert(after === before + 1, '点「复制」后粘贴，真的多出一个节点', `${before} → ${after}`)

  // 菜单动作完成后应当收起——用上面那条基线兜底，排除「选择器本来就找不到」的假绿。
  await expectAbsent(nodeMenu, { provenBy: nodeMenuProbe, message: '动作完成后菜单收起' })
  passed += 1
  console.log('  ✓ 动作完成后菜单收起')

  console.log(`\n✅ 节点右键菜单走查通过：${passed} 项`)
} catch (err) {
  console.error(`\n❌ ${err.message}`)
  await snap('99-error.png').catch(() => {})
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
}
