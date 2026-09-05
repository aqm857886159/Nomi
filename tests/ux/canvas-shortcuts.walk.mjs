// R13 走查：画布 复制/粘贴/撤销/删除后撤销 —— Cmd 与 Ctrl **两套修饰键都得成立**。
//
// 来历（2026-08-19 画布群 #4968/#4982/#4983）：用户报「ctrl+c 没有用」「所有快捷键都不好使」
// 「ctrl+z 也撤销不了」，群里当场判「忘加了」。**这个判断是错的**——
// copySelectedNodes/undo/redo 自 2026-06-12（2a0fea4e）就在，`mod = metaKey || ctrlKey` 双平台都认。
// 真机逐步实测：全部生效。真问题是画布上**没有任何复制入口**（右键节点不弹菜单、
// 两条工具条都没有复制钮），属可发现性，另案解决。
//
// 那为什么还要留这条走查？因为「快捷键悄悄坏掉」是**查不出来的**：
// 它不报错、不留日志，只在用户手里表现为「按了没反应」，而单测跑在 node 环境（无 DOM），
// 证不了真实事件相位与守卫链。这条把「两套修饰键都能用」钉成结构保证——
// 尤其防 useCanvasShortcuts 的三道守卫（编辑焦点 / 画布隐藏 / 文本选区）
// 和 `event.defaultPrevented` 早退被后续改动无意扩大命中面。
//
// 判据是**副作用**不是截图：每步按键前后数节点数量，且**每步前记录选中数**——
// 第一版探针没记选中数，被上一步的空剪贴板串了因果，误报「一半失效」，差点去修一个不存在的 bug。
// 真 Electron + 真构建产物，隔离 userData / projects，全程不发生成请求（零额度）。
// 用法：pnpm run build && node tests/ux/canvas-shortcuts.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { screenshotSettled } from './_assert.mjs'
import { findBlankCanvasPoint } from './_canvasPoints.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/canvas-shortcuts')
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nomi-shortcuts-'))
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
mkdirSync(projectsDir, { recursive: true })
mkdirSync(shotsDir, { recursive: true })

const { app, win: initialWin } = await launchNomiApp({
  name: 'canvas-shortcuts',
  userDataDir, settingsDir: userDataDir, projectsDir,
  args: ['--no-proxy-server'], settleMs: 0,
})
// keyboard.press(`${mod}+v`) emits a real paste event in Electron. Clear the
// user's ambient OS clipboard so this walk exercises the canvas-node fallback,
// not an unrelated URL/image import left by another app or test.
await app.evaluate(({ clipboard }) => clipboard.clear())

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
const snap = async (name) => {
  await screenshotSettled(getWin(), { path: path.join(shotsDir, name) })
  console.log(`  · 截图 ${name}`)
}
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
const countSelected = () => getWin().evaluate(() => Array.from(document.querySelectorAll('.generation-canvas-v2-node'))
  .filter((n) => n.getAttribute('data-selected') === 'true' || n.getAttribute('aria-selected') === 'true' || /selected|ring-nomi-accent/.test(n.className)).length)

async function findBlankPoint() {
  // 扫描 + 真实鼠标到位复验，见 tests/ux/_canvasPoints.mjs（磁性「+」句柄只在光标下才冒出来）。
  return findBlankCanvasPoint(getWin(), { rows: [0.3, 0.45, 0.6, 0.72, 0.85], columns: [0.55, 0.65, 0.75, 0.85, 0.45, 0.35] })
}

async function addNode() {
  const blank = await findBlankPoint()
  if (!blank) throw new Error('找不到画布空白点')
  await getWin().mouse.click(blank.x, blank.y, { button: 'right' })
  await getWin().waitForTimeout(400)
  const menu = getWin().locator('.generation-canvas-v2__context-node-menu')
  await menu.locator('[role="menuitem"]').first().click({ timeout: 5000 })
  await getWin().waitForTimeout(900)
}

async function selectFirstNode() {
  const node = getWin().locator('.generation-canvas-v2-node').first()
  const box = await node.boundingBox()
  await getWin().mouse.click(box.x + box.width / 2, box.y + 12)
  await getWin().waitForTimeout(400)
}

/** 按一次键，返回节点数变化。**按之前**先量选中数，避免拿上一步的残留状态解释这一步。 */
async function press(keys) {
  const before = await countNodes()
  const selected = await countSelected()
  await getWin().keyboard.press(keys)
  await getWin().waitForTimeout(900)
  return { before, after: await countNodes(), selected }
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

  // 两套修饰键都要测：Windows 用户按 Ctrl，mac 用户按 Cmd，`mod = metaKey||ctrlKey` 承诺两者等价。
  for (const mod of ['Meta', 'Control']) {
    console.log(`\n── 修饰键 ${mod} ──`)
    await addNode()
    await selectFirstNode()
    assert(await countSelected() > 0, `${mod}: 节点已选中（复制的前提）`)

    await press(`${mod}+c`)
    const paste = await press(`${mod}+v`)
    assert(paste.after === paste.before + 1, `${mod}+C / ${mod}+V 复制粘贴生效`, `${paste.before} → ${paste.after}`)

    const undo = await press(`${mod}+z`)
    assert(undo.after === undo.before - 1, `${mod}+Z 撤销粘贴生效`, `${undo.before} → ${undo.after}`)

    // 撤销最该保命的场景：误删之后能不能救回来。
    await selectFirstNode()
    const del = await press('Delete')
    assert(del.after === del.before - 1, `${mod}: Delete 删除生效`, `${del.before} → ${del.after}`)
    const undoDel = await press(`${mod}+z`)
    assert(undoDel.after === undoDel.before + 1, `${mod}+Z 撤销删除生效（误删救得回来）`, `${undoDel.before} → ${undoDel.after}`)

    // 清场，让下一轮修饰键从干净状态开始。
    const remaining = await countNodes()
    for (let i = 0; i < remaining; i += 1) {
      await selectFirstNode()
      await press('Delete')
    }
  }

  await snap('01-final.png')
  console.log(`\n✅ 画布快捷键走查通过：${passed} 项`)
} catch (err) {
  console.error(`\n❌ ${err.message}`)
  await snap('99-error.png').catch(() => {})
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
}
