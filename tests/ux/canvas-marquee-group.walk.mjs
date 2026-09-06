// 框选 →（在框选罩子上）右键 → 建组：一条真实用户任务的端到端走查。
//
// 它证的是什么（2026-09-06 真机取证，取证截图见 tests/ux/shots/group-frame-now/00b2、00b3）：
// shift 拖框选 ≥2 个节点后，React Flow 会在整片选中节点之上铺一层 `nodesselection-rect`。
// 用户此刻要建组，最自然的动作就是在这片刚框好的东西上右键——而修复前那一下会落在罩子上，
// 右键判定取不到 data-node-id，于是被「不是节点 = 空白」吞掉：**选择当场清空、弹出的是
// 「添加节点」菜单**，「建组」这条路凭空消失（实测 nodeMenu 0 / addMenu 1 / selectionToolbar 0）。
//
// 断言的排法（阳性对照在前，避免空洞通过）：
//   ① 真空白右键 → 证明「添加节点」菜单这个探针**确实抓得到东西**（proveProbe）；
//   ② 框选后先证「罩子真的在、且真的盖在节点中心上」——不证这条，后面整段就不在它自称的现场；
//   ③ 在罩子上右键 → 节点菜单出现、添加菜单 expectAbsent(provenBy ①)、选择条仍是「已选 3」、
//      「建组」可点 → 点它 → 组框出现。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import {
  clickOrFail,
  expectAbsent,
  expectCount,
  expectVisible,
  proveProbe,
  screenshotSettled,
  scopedText,
  expect,
} from './_assert.mjs'
import { findCanvasBlankPoint, CANVAS_STAGE_SELECTOR } from './_canvasHit.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/canvas-marquee-group')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-marquee-group-'))
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
fs.mkdirSync(userDataDir, { recursive: true })
fs.mkdirSync(projectsDir, { recursive: true })

const NODE_MENU = '.generation-canvas-v2__node-context-menu'
const ADD_MENU = '.generation-canvas-v2__context-node-menu'
const SELECTION_TOOLBAR = '.generation-canvas-v2__selection-toolbar'
const SELECTION_OVERLAY = '.react-flow__nodesselection-rect'
const GROUP_BOX = '.generation-canvas-v2__group-box'
const NODE_COUNT = 3

const log = (...args) => console.log('  ', ...args)

const { app, win: initialWin } = await launchNomiApp({
  name: 'canvas-marquee-group',
  userDataDir,
  settingsDir: userDataDir,
  projectsDir,
  args: ['--no-proxy-server'],
  settleMs: 0,
})
let win = initialWin
const getWin = () => {
  const live = app.windows().filter((candidate) => !candidate.isClosed())
  win = live.find((candidate) => /projectId=/.test(candidate.url())) || live[live.length - 1] || win
  return win
}

async function snap(name) {
  await screenshotSettled(getWin(), { path: path.join(shotsDir, `${name}.png`) })
  log(`· 截图 ${name}.png`)
}

async function dismissFirstRun() {
  for (let i = 0; i < 6; i += 1) {
    const skip = getWin().locator('button, [role="button"], a', { hasText: /跳过|完成|知道了|开始创作|稍后/ }).first()
    if (await skip.isVisible().catch(() => false)) await skip.click({ timeout: 900 }).catch(() => {})
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(180)
  }
}

/** 右键一下并等菜单安定。走查里所有右键都走它——手写三段 mouse 调用会各自漂。 */
async function rightClickAt(point) {
  await getWin().mouse.move(point.x, point.y)
  await getWin().mouse.down({ button: 'right' })
  await getWin().waitForTimeout(120)
  await getWin().mouse.up({ button: 'right' })
}

async function closeMenus() {
  await getWin().keyboard.press('Escape')
  await expectCount(getWin().locator(`${NODE_MENU}, ${ADD_MENU}`), 0, 'Escape 之后菜单应当收起')
}

async function clearSelection() {
  await closeMenus()
  const blank = await findCanvasBlankPoint(getWin(), { preference: 'bottom' })
  if (!blank) throw new Error('这一屏找不到画布空白点：后面「点空白清选择」这一步无从执行')
  await getWin().mouse.click(blank.x, blank.y)
  await expectCount(getWin().locator(SELECTION_TOOLBAR), 0, '点了空白，选择浮条应当消失')
}

/** stage 内边距：留出足够余量，让框选矩形的起点还能落在节点外的 pane 上。 */
const FIT_MARGIN = 56

async function readNodeFit() {
  return getWin().evaluate(({ stageSelector, margin }) => {
    const stage = document.querySelector(stageSelector)?.getBoundingClientRect()
    const nodes = Array.from(document.querySelectorAll('.generation-canvas-v2-node')).map((el) => el.getBoundingClientRect())
    if (!stage || nodes.length === 0) return null
    const union = nodes.reduce((acc, r) => ({
      x1: Math.min(acc.x1, r.x), y1: Math.min(acc.y1, r.y),
      x2: Math.max(acc.x2, r.right), y2: Math.max(acc.y2, r.bottom),
    }), { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity })
    return {
      fits: union.x1 >= stage.left + margin && union.y1 >= stage.top + margin
        && union.x2 <= stage.right - margin && union.y2 <= stage.bottom - margin,
      union,
      stage: { x: stage.x, y: stage.y, w: stage.width, h: stage.height },
    }
  }, { stageSelector: CANVAS_STAGE_SELECTOR, margin: FIT_MARGIN })
}

async function zoomOutUntilNodesFit() {
  for (let step = 0; step < 10; step += 1) {
    const fit = await readNodeFit()
    if (fit?.fits) {
      log(`· 节点已全部收进视口（第 ${step} 次缩放后）`)
      return fit
    }
    const blank = await findCanvasBlankPoint(getWin(), { preference: 'default' })
    const at = blank ?? { x: fit.stage.x + fit.stage.w / 2, y: fit.stage.y + fit.stage.h / 2 }
    await getWin().mouse.move(at.x, at.y)
    await getWin().mouse.wheel(0, 240)
    await getWin().waitForTimeout(220)
  }
  const fit = await readNodeFit()
  expect(
    fit?.fits,
    `缩了 10 次仍装不下全部节点（union=${JSON.stringify(fit?.union)} stage=${JSON.stringify(fit?.stage)}）：`
      + '框选选不全，这趟走查证不了任何事，必须报红而不是继续。',
  ).toBe(true)
  return fit
}

try {
  await getWin().waitForLoadState('domcontentloaded')
  await dismissFirstRun()
  await clickOrFail(getWin().locator('button, [role="button"]', { hasText: '新建空白项目' }), '新建空白项目')
  await dismissFirstRun()
  await clickOrFail(getWin().getByRole('button', { name: '生成', exact: true }), '生成（进画布）')
  await expectVisible(getWin().locator('.generation-canvas-v2-toolbar').first(), '画布工具条应当出现')

  // ── 布置现场：3 个节点，足够框选、也足够让「建组」可用（阈值是 ≥2）──
  // 左缘工具条只走共享点法（_canvasRail.mjs）：常驻位与「更多」里的种类由它自己分辨，找不到就抛。
  for (const kind of ['text', 'image', 'image']) {
    await addCanvasNodeFromRail(getWin(), kind)
  }
  await expectCount(getWin().locator('.generation-canvas-v2-node'), NODE_COUNT, `画布上应当有 ${NODE_COUNT} 个节点`)
  await clickOrFail(getWin().locator('[aria-label="适应视图"]'), '适应视图')
  await clearSelection()
  // 「适应视图」不放大到 1 以上，三张卡在默认缩放下装不进视口；装不下 = React Flow 的框选
  // （SelectionMode.Full）永远选不全，那一步会以「框选没框住」的形式报红，把人引向错误的方向。
  // 所以先用真实的滚轮缩放把它们收进来，收不进来就 fail-closed。
  await zoomOutUntilNodesFit()
  await snap('00-nodes-ready')

  // ── ① 阳性对照：真空白右键**确实**会弹「添加节点」菜单 ──
  // 没有这一步，后面「罩子上右键没弹添加菜单」就和「探针根本没生效」在观测上完全一样。
  const blankPoint = await findCanvasBlankPoint(getWin(), { preference: 'bottom' })
  if (!blankPoint) throw new Error('找不到画布空白点，阳性对照无从建立')
  await rightClickAt(blankPoint)
  const addMenuProof = await proveProbe(getWin().locator(ADD_MENU), '真空白右键会弹「添加节点」菜单')
  await snap('01-blank-right-click-add-menu')
  await closeMenus()

  // ── ② 框选：shift + 在 pane 上拉一个罩住全部节点的矩形 ──
  const stage = await getWin().evaluate((selector) => {
    const rect = document.querySelector(selector).getBoundingClientRect()
    return { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
  }, CANVAS_STAGE_SELECTOR)
  const nodeBoxes = await getWin().evaluate(() => Array.from(document.querySelectorAll('.generation-canvas-v2-node')).map((el) => {
    const rect = el.getBoundingClientRect()
    return { id: el.getAttribute('data-node-id'), x: rect.x, y: rect.y, w: rect.width, h: rect.height }
  }))
  const union = nodeBoxes.reduce((acc, box) => ({
    x1: Math.min(acc.x1, box.x), y1: Math.min(acc.y1, box.y),
    x2: Math.max(acc.x2, box.x + box.w), y2: Math.max(acc.y2, box.y + box.h),
  }), { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity })
  const start = { x: Math.max(stage.x + 6, union.x1 - 36), y: Math.max(stage.y + 6, union.y1 - 36) }
  const end = { x: Math.min(stage.x + stage.w - 6, union.x2 + 36), y: Math.min(stage.y + stage.h - 6, union.y2 + 36) }
  const startIsBlank = await getWin().evaluate(
    ({ point, paneSelector }) => document.elementFromPoint(point.x, point.y)?.matches(paneSelector) ?? false,
    { point: start, paneSelector: '.react-flow__pane' },
  )
  expect(startIsBlank, `框选起点 ${JSON.stringify(start)} 不在画布 pane 上：这一拖不会是框选，整趟走查失去意义`).toBe(true)
  await getWin().keyboard.down('Shift')
  await getWin().mouse.move(start.x, start.y)
  await getWin().mouse.down()
  await getWin().mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 10 })
  await getWin().mouse.move(end.x, end.y, { steps: 10 })
  await getWin().mouse.up()
  await getWin().keyboard.up('Shift')

  const toolbar = getWin().locator(SELECTION_TOOLBAR).first()
  await expectVisible(toolbar, '框选之后应当出现选择浮条')
  const selectedText = await scopedText(toolbar)
  expect(selectedText, `框选没把 ${NODE_COUNT} 个节点都框住（浮条：${selectedText}）`).toContain(`已选 ${NODE_COUNT} 个`)

  // ── ③ 证明「我确实站在报告里那个现场」：罩子在，而且它就压在节点中心上 ──
  // 这一条不成立的话，后面的右键根本没落在罩子上，绿灯只是绕过了被测物（而不是修好了它）。
  await expectVisible(getWin().locator(SELECTION_OVERLAY).first(), '框选完成后 React Flow 应当铺出选中集罩子')
  const overlayHit = await getWin().evaluate(() => {
    const node = document.querySelector('.generation-canvas-v2-node')
    if (!node) return null
    const rect = node.getBoundingClientRect()
    const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    const top = document.elementFromPoint(point.x, point.y)
    return {
      point,
      onOverlay: Boolean(top?.closest('.react-flow__nodesselection, .react-flow__nodesselection-rect')),
      onNode: Boolean(top?.closest('.generation-canvas-v2-node')),
    }
  })
  expect(overlayHit, '取不到节点中心点：现场不成立').not.toBe(null)
  expect(
    overlayHit.onOverlay && !overlayHit.onNode,
    `节点中心的最顶层元素不是选中集罩子（onOverlay=${overlayHit?.onOverlay} onNode=${overlayHit?.onNode}）：`
      + '这一版 React Flow 没铺罩子，或罩子换了类名——那么这趟走查证不了报告里的那个 bug，必须报红。',
  ).toBe(true)
  await snap('02-marquee-selection-overlay')

  // ── ④ 在罩子上右键：这就是修复前断掉的那一下 ──
  await rightClickAt(overlayHit.point)
  await expectVisible(
    getWin().locator(NODE_MENU).first(),
    '在框选罩子上右键应当弹「节点操作」菜单——修复前这里弹的是「添加节点」菜单',
  )
  await expectAbsent(getWin().locator(ADD_MENU), {
    provenBy: addMenuProof,
    message: '在框选罩子上右键不该被当成「点空白」而弹出「添加节点」菜单',
  })
  await expectVisible(toolbar, '右键不该清掉刚框好的选择——浮条必须还在')
  const toolbarAfterRightClick = await scopedText(toolbar)
  expect(
    toolbarAfterRightClick,
    `右键之后选择被改动了（浮条：${toolbarAfterRightClick}）：修复前这里会被 clearSelection() 清空`,
  ).toContain(`已选 ${NODE_COUNT} 个`)
  const groupItem = getWin().locator(`${NODE_MENU} [role="menuitem"]`).filter({ hasText: '建组' }).first()
  await expectVisible(groupItem, '菜单里应当有「建组」')
  expect(
    await groupItem.isDisabled(),
    '「建组」被置灰：选中数应当还是 3（置灰意味着右键把多选打断成了单选或清空）',
  ).toBe(false)
  await snap('03-node-menu-on-selection-overlay')

  // ── ⑤ 真的把组建出来：用户任务闭环 ──
  await clickOrFail(groupItem, '建组')
  await expectVisible(getWin().locator(GROUP_BOX).first(), '点了「建组」之后画布上应当出现组框')
  const groupLabel = getWin().locator('.generation-canvas-v2__group-box-label').first()
  await expectVisible(groupLabel, '组框应当带头部胶囊（组名 + 计数）')
  const labelText = await scopedText(groupLabel)
  expect(labelText, `组头计数不是 ${NODE_COUNT}（读到「${labelText}」）：建出来的组没把框选的三个都收进去`).toContain(String(NODE_COUNT))
  await clearSelection()
  await snap('04-grouped')

  log('✅ 框选 → 罩子上右键 → 建组 全程通过')
} catch (error) {
  console.error('❌ 走查中断:', error?.message || error)
  try { await snap('zz-error-state') } catch {}
  await app.close()
  process.exit(1)
}
await app.close()
console.log('✅ canvas-marquee-group 走查完成 →', shotsDir)
