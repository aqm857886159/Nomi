// 走查：修饰键松开事件丢了，画布不许以为它还按着（2026-10-10 用户在 Mac 开发版上报）。
//
// 用户原话：「点击节点有时候不能拖动 而是直接似乎编组了 就是点击两个 直接显示编组什么东西」。
// 机制：React Flow 的 selectionKeyCode / multiSelectionKeyCode（我们都配成 Shift）靠 keydown / keyup 成对记「按着没」，
// 只在窗口 blur / contextmenu 时清零。松开那一下没送到 document / window 时（macOS ⌘⇧4 截图把按键交给系统截图层、
// 输入法吞键、或者焦点在 keyup 时进了一个 stopPropagation 的编辑区），它就一直以为 Shift 按着：
//   · 点卡 → Pane 的捕获阶段把这一下当成「框选起手」吃掉 → 卡拖不动；
//   · 零尺寸框按 Partial 语义选中脚下那张、且多选键「按着」不清旧选择 → 点第二张就是「已选 2 个 · 编组」。
//
// 复现方式：用 CDP 发一个**可信**的 Shift keydown、不发 keyup（＝系统吞掉了松开），然后用不带修饰键的真鼠标点。
// Playwright 自己的 keyboard.down 会让后续鼠标事件带上 shiftKey，所以这里不用它，直接走 CDP——鼠标事件的修饰位才是真的「没按」。
// 阳性对照：真按着 Shift（Playwright keyboard.down）点两张，仍然得是两张都选中——修复不能把多选本身弄没。
//
// 判据是副作用：选中数（data-selected）与节点有没有被拖动（屏幕位置变化），不是截图。
// 用法：pnpm run build && node tests/ux/canvas-stuck-modifier.walk.mjs
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp, closeNomiApp } from './_launchApp.mjs'
import { expect, expectAbsent, proveProbe } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { findNodeHitPoint, findCanvasBlankPoint } from './_canvasHit.mjs'
import { createCanvasPerformanceFixture } from './fixtures/canvas-performance-fixture.mjs'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { fileURLToPath } from 'node:url'

const FIRST_RUN_SEEN = Object.freeze({
  'nomi:splash:v1': 'seen',
  'nomi:journey-tour:v1': 'seen',
  'nomi:canvas-gesture-hint:v1': 'seen',
})
const SELECTED = '.generation-canvas-v2-node[data-selected="true"]'
const SELECTION_TOOLBAR = '.generation-canvas-v2__selection-toolbar'
const nodeSelector = (id) => `.generation-canvas-v2-node[data-node-id=${JSON.stringify(id)}]`

const tempRoot = makeTempDir('nomi-stuck-modifier-')
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
fs.mkdirSync(userDataDir, { recursive: true })
const fixture = createCanvasPerformanceFixture({ projectsDir, scale: 'REALIMG', projectId: 'stuck-modifier', projectName: 'ZZ 修饰键卡住' })

const failures = []
function check(ok, label, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

let app = null
try {
  let page
  ;({ app, win: page } = await launchNomiApp({
    name: 'canvas-stuck-modifier',
    userDataDir,
    settingsDir: userDataDir,
    projectsDir,
    // 窗口挂屏幕外、不抢焦点（在用户正在用的电脑上跑）；Windows 会把屏幕外窗口判成被遮挡而停帧，一并关掉遮挡判定。
    args: ['--no-proxy-server', '--disable-features=CalculateNativeWinOcclusion'],
    mainRequire: [path.join(path.dirname(fileURLToPath(import.meta.url)), '_quietWalk.cjs')],
    initialLocalStorage: FIRST_RUN_SEEN,
    settleMs: 900,
    env: { NOMI_DISABLE_CAPABILITY_CORE: '1' },
  }))
  const browserWindow = await app.browserWindow(page)
  await browserWindow.evaluate((target) => target.setSize(1600, 1000))
  const card = page.locator(`[data-project-card][data-project-id="${fixture.record.id}"]`).first()
  await card.waitFor({ timeout: stationTimeout() })
  await card.click()
  await expect.poll(() => {
    page = app.windows().find((candidate) => /projectId=/.test(candidate.url())) || page
    return page.url()
  }, { timeout: stationTimeout({ operations: 2 }) }).toContain('projectId=')
  await expect.poll(() => page.locator('.generation-canvas-v2-node').count(), { timeout: stationTimeout({ operations: 2 }) }).toBeGreaterThanOrEqual(3)

  const ids = await page.locator('.generation-canvas-v2-node').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-node-id')))
  const [idA, idB, idC] = ids
  const hit = async (id) => {
    const point = await findNodeHitPoint(page, { nodeSelector: nodeSelector(id) })
    if (!point) throw new Error(`卡 ${id} 上找不到可点的点`)
    return point
  }
  const selected = page.locator(SELECTED)
  const selectionToolbar = page.locator(SELECTION_TOOLBAR)
  const selectedIds = () => selected.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-node-id')))
  const nodeSelected = (id) => page.locator(`${nodeSelector(id)}[data-selected="true"]`)
  // 等两帧：React 提交 + 一次绘制之后再读屏幕上的样子。
  const settleFrames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const cdp = await app.context().newCDPSession(page)
  // 可信的 Shift 按下，不跟松开：等于「松开那一下被系统 / 输入法 / 别的监听吞掉了」。
  const pressShiftWithoutRelease = () => cdp.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16, modifiers: 8,
  })

  // ① 阳性对照：真按着 Shift 点两张 → 两张都选中、出多选浮条（多选本身得在；同时证明下面「不出浮条」的探针看得见浮条）。
  // 间歇红（CI 上偶发「点两张后没出多选浮条」）取证：记下每次按下真正落在谁身上、点之前命中测试给的点、点完的选中集，
  // 探针失败时连同截图一起打出来——下一次红就能直接看出第二下是被谁截走、还是选中没叠上。不改判据。
  await page.evaluate(() => {
    window.__pointerLog = []
    window.addEventListener('pointerdown', (e) => {
      const t = e.target instanceof Element ? e.target : null
      window.__pointerLog.push({ shift: e.shiftKey, x: Math.round(e.clientX), y: Math.round(e.clientY), tag: t?.tagName, cls: String(t?.className ?? '').slice(0, 90), node: t?.closest('.generation-canvas-v2-node')?.getAttribute('data-node-id') ?? null, action: t?.closest('[data-toolbar-action]')?.getAttribute('data-toolbar-action') ?? null })
    }, true)
  })
  let selectionProof
  let toolbarProof
  const hitPoints = []
  await page.keyboard.down('Shift')
  for (const id of [idA, idB]) { const point = await hit(id); hitPoints.push({ id, ...point }); await page.mouse.click(point.x, point.y) }
  await page.keyboard.up('Shift')
  try {
    selectionProof = await proveProbe(selected, '按着 Shift 点两张后画布上有选中的卡')
    toolbarProof = await proveProbe(selectionToolbar, '按着 Shift 点两张后出「已选 N 个」多选浮条')
  } catch (error) {
    const evidence = { hitPoints, pointerdowns: await page.evaluate(() => window.__pointerLog).catch(() => null), selected: await selectedIds().catch(() => null) }
    console.log('FLAKE-EVIDENCE', JSON.stringify(evidence))
    await page.screenshot({ path: path.join(tempRoot, 'baseline-fail.png') }).then(() => console.log(`FLAKE-EVIDENCE screenshot: ${path.join(tempRoot, 'baseline-fail.png')}`)).catch(() => {})
    throw error
  }
  await expect.poll(selectedIds).toEqual([idA, idB])
  check(true, '阳性对照：按着 Shift 点两张 = 两张都选中，多选浮条出现')
  const clearSelection = async () => {
    const blank = await findCanvasBlankPoint(page)
    if (!blank) throw new Error('找不到画布空白点')
    await page.mouse.click(blank.x, blank.y)
    await expectAbsent(selected, { provenBy: selectionProof, message: '点空白清掉选择' })
  }

  // ② 松开丢了：点 A，再「按下 Shift 不松」，再用不带修饰键的鼠标点 B → 只能选中 B。
  await clearSelection()
  { const point = await hit(idA); await page.mouse.click(point.x, point.y) }
  await expect(nodeSelected(idA)).toHaveCount(1)
  await pressShiftWithoutRelease()
  // 用户截完图回来：先挪鼠标，看着画布去点第二张。点哪儿要按挪过鼠标之后屏幕上的样子找（选中卡的连接把手会伸到邻卡上）。
  {
    const blank = await findCanvasBlankPoint(page)
    if (blank) await page.mouse.move(blank.x, blank.y, { steps: 4 })
    await settleFrames()
    const point = await hit(idB)
    await page.mouse.click(point.x, point.y)
  }
  await expect(nodeSelected(idB)).toHaveCount(1)
  await settleFrames()
  const afterStuck = await selectedIds()
  check(afterStuck.length === 1 && afterStuck[0] === idB, 'Shift 松开丢失后，不带修饰键点第二张只选中它', JSON.stringify(afterStuck))
  try {
    await expectAbsent(selectionToolbar, { provenBy: toolbarProof, message: '不出现「已选 2 个 · 编组」浮条' })
    check(true, '不出现「已选 2 个 · 编组」浮条')
  } catch (error) {
    check(false, '不出现「已选 2 个 · 编组」浮条', String(error?.message || error).split('\n')[0])
  }

  // ③ 松开丢了还要拖得动：按下 Shift 不松，再用不带修饰键的鼠标拖 C → C 跟着走。
  await clearSelection()
  await pressShiftWithoutRelease()
  const before = await page.locator(nodeSelector(idC)).boundingBox()
  const start = await hit(idC)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(start.x + step * 10, start.y + step * 6)
    await settleFrames()
  }
  await page.mouse.up()
  await settleFrames()
  const after = await page.locator(nodeSelector(idC)).boundingBox()
  const moved = before && after ? Math.hypot(after.x - before.x, after.y - before.y) : 0
  check(moved > 60, 'Shift 松开丢失后，不带修饰键拖卡 = 卡跟着走（不是拉出框选）', `moved=${Math.round(moved)}px`)
} finally {
  await closeNomiApp(app)
  fs.rmSync(tempRoot, { recursive: true, force: true })
}

if (failures.length) {
  console.error(`\ncanvas-stuck-modifier: FAIL (${failures.length})`)
  process.exit(1)
}
console.log('\ncanvas-stuck-modifier: PASS')
