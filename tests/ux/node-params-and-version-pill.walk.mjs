// 走查：选中节点浮框 / 「2 版」结果托盘 / 删框（2026-09-22 用户真机回归）。
//
// 用户报的三件事：
//   1. 选中图片节点（空的、生成过的都一样）→ 下面的生成浮框整个不出来，参数条自然也没有；
//   2. 点卡上的「2 版」→ 不弹结果托盘，选不了版本、下不了载；
//   3. 编组框删不掉。
// 1、2 是同一个根因：画布上的 `data-dragging` 标记在一次平移后没摘掉，浮框 / 浮条 / 版本托盘统统 `invisible`，
// DOM 都在、就是看不见点不到。卡住它的时序：React Flow 在「滚轮平移」方案（用户在用的 modifier-zoom）下把
// 平移结束回调推迟 150ms，这期间画布里任何一次按下都会让收尾跳过。
// 所以这条走查**先按用户会做的顺序把各种手势都做一遍**（拖平移、平移完立刻点卡/点空白、滚轮平移、模拟触控板平移、
// 拖动中被系统打断、拖动中窗口失焦），每一步之后断言标记已摘掉；再在「刚平移完立刻点」之后验浮框与托盘可见可点。
// 断言只看行为（stage 上的属性、浮层的可见性与命中），不看实现——换成租约模型的实现也必须照样全绿。
//
// 2026-09-22 总合并：实现**确实换成了租约模型**（`beginCanvasDragging(...) → {activate, release, cancel}`，
// 摘旗的最后一道闸是 `canvasDraggingFlag.armGestureEndGuard`：pointerup / pointercancel / 窗口 blur
// 之后等一帧，仍挂着的租约一律收掉）。这条走查一个断言都没改——上面那句「不看实现」就是这么用的：
// 换发动机的那一刀里，它是证明「用户看到的东西没变」的那份证据。
//
// 驱动：真实 Electron + 真实鼠标/键盘/滚轮。两处写明是**模拟**：触控板平移（带 deltaX 的 wheel，ctrlKey=false），
// 系统打断（窗口上派发 pointercancel / blur——Playwright 造不出真的系统打断）。
// 夹具：核心冒烟清单的一员（tests/ux/core-smoke/scenarios.mjs），empty / used 两遍都跑；
// 项目与素材由 tests/ux/core-smoke/fixture.mjs 用真实素材写成 App 自己的项目文件，再从项目库点开。
//
// 用法：
//   pnpm run build && pnpm run test:core-smoke -- --fixture used      （清单里全部场景）
//   pnpm run build && node tests/ux/node-params-and-version-pill.walk.mjs [zh-CN|en] [label]   （单跑，默认 empty）
import fs from 'node:fs'
import path from 'node:path'
import { repoRoot } from './_launchApp.mjs'
import { expect, expectAbsent, expectHittable, proveProbe, screenshotSettled, waitForVisualQuiescence } from './_assert.mjs'
import { findCanvasBlankPoint, findFrameDragHandlePoint, findNodeHitPoint, CANVAS_STAGE_SELECTOR, CANVAS_VIEWPORT_SELECTOR } from './_canvasHit.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { launchCoreSmoke } from './core-smoke/fixture.mjs'

const REQUESTED_LOCALE = process.argv[2] === 'en' ? 'en' : 'zh-CN'
const LABEL = process.argv[3] || 'run'

// ── 场景自带的最少节点（两种夹具都有）：两版结果卡、空图片卡、带两张卡的编组、空编组框
const base = { prompt: '', categoryId: 'shots', references: [], runs: [] }
const seed = ({ imageResult, imageMeta }) => {
  const v1 = imageResult('stack-v1', 1, 1)
  const v2 = imageResult('stack-v2', 4, 2)
  return {
    nodes: [
      { ...base, id: 'stack', kind: 'image', title: '两个版本', position: { x: 80, y: 80 }, status: 'success', result: v2, history: [v2, v1], meta: imageMeta() },
      { ...base, id: 'empty-image', kind: 'image', title: '空图片', position: { x: 620, y: 80 }, status: 'idle', history: [] },
      ...['frame-m1', 'frame-m2'].map((id, index) => ({
        ...base, id, kind: 'image', title: `框内 ${index + 1}`, groupId: 'frame-rain', position: { x: 120 + index * 420, y: 620 },
        status: 'success', result: imageResult(`${id}-r`, 4, 1), history: [imageResult(`${id}-r`, 4, 1)], meta: imageMeta(),
      })),
    ],
    groups: [
      { id: 'frame-rain', name: '雨夜', categoryId: 'shots', nodeIds: ['frame-m1', 'frame-m2'], frameBounds: { x: 80, y: 520, w: 860, h: 420 }, createdAt: 1, updatedAt: 1 },
      { id: 'frame-empty', name: '空框', categoryId: 'shots', nodeIds: [], frameBounds: { x: 1100, y: 520, w: 420, h: 300 }, createdAt: 1, updatedAt: 1 },
    ],
  }
}

const smoke = await launchCoreSmoke({
  name: 'node-params-pill',
  seed,
  locale: REQUESTED_LOCALE,
  // 用户窗口实测 1440×859（osascript 读的真实窗口外框），内容区 1440×831；used 夹具换成 1280×800 小窗。
  emptyViewport: { width: 1440, height: 831 },
  // 用户真实资料库里就是这一档（Figma 式：滚轮平移、⌘/Ctrl+滚轮缩放）。卡死标记的 150ms 窗口只在这一档出现。
  preferences: { 'nomi.canvasGesture.scheme': 'modifier-zoom' },
})
const { app, tempRoot } = smoke
const LOCALE = smoke.locale
const EN = LOCALE === 'en'
const shotsDir = path.join(repoRoot, 'tests/ux/shots/node-params-and-version-pill', `${LABEL}-${smoke.fixture}-${LOCALE}`)
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const failures = []
function check(ok, label, detail) {
  const line = `${label} — ${JSON.stringify(detail)}`
  if (ok) console.log(`  ✓ ${line}`)
  else { console.error(`  ✖ ${line}`); failures.push(line) }
  return ok
}

let win = smoke.win
const first = win
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const sel = (id) => `.react-flow__node[data-id="${id}"]`
const frameSel = (id) => `.generation-canvas-v2__group-box[data-group-id="${id}"]`
const shot = (name) => screenshotSettled(win, { path: path.join(shotsDir, `${name}.png`) })
const consoleErrors = []
const watchConsole = (page) => page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 400)) })
watchConsole(first)
app.on('window', watchConsole)

const stageDragging = () => win.evaluate((s) => document.querySelector(s)?.getAttribute('data-dragging') ?? null, CANVAS_STAGE_SELECTOR)
async function expectNotDragging(label) {
  let last = null
  try {
    await expect.poll(async () => (last = await stageDragging()), { timeout: 2_000 }).toBeNull()
    check(true, `${label}：画布不再处于拖动态`, { dragging: last })
  } catch {
    check(false, `${label}：画布卡在拖动态（浮框/浮条/托盘都会隐身）`, { dragging: last })
    // 让后面的断言在干净状态下继续：完整拖一次画布（旧实现只有这样才能摘掉）。
    const p = await findCanvasBlankPoint(win, { inset: 80 })
    await win.mouse.move(p.x, p.y); await win.mouse.down(); await win.mouse.move(p.x + 12, p.y, { steps: 3 }); await win.waitForTimeout(250); await win.mouse.up()
    await expect.poll(stageDragging, { timeout: 2_000 }).toBeNull().catch(() => undefined)
  }
}
async function blank() {
  const p = await findCanvasBlankPoint(win, { inset: 80 })
  expect(p, '画布上找不到真空白').not.toBeNull()
  return p
}
async function dragPan(dx, dy, { release = true } = {}) {
  const p = await blank()
  await win.mouse.move(p.x, p.y)
  await win.mouse.down()
  await win.mouse.move(p.x + 2, p.y + 1)
  await win.mouse.move(p.x + dx, p.y + dy, { steps: 8 })
  if (release) await win.mouse.up()
}
async function nodePoint(id) {
  let point = null
  await expect.poll(async () => (point = await findNodeHitPoint(win, { nodeSelector: sel(id) })) !== null, { message: `${id} 卡上找不到一处点得到的地方` }).toBe(true)
  return point
}
/**
 * 把一张卡拖到舞台里人会停的位置：默认中间偏上（浮框钉在卡正下方，偏上给它留出位置）；
 * `alignTop` 时卡顶贴舞台上沿，给浮框留最多的竖向空间。`xFraction` 是卡中心在舞台横向的位置。
 */
const SEED_POSITION = { stack: { x: 80, y: 80 }, 'empty-image': { x: 620, y: 80 } }
async function panCardToStageCentre(id, { xFraction = 0.5, alignTop = false } = {}) {
  const clamp = (v) => Math.max(-250, Math.min(250, Math.round(v)))
  for (let step = 0; step < 6; step += 1) {
    const delta = await win.evaluate(({ stageSelector, nodeSelector, viewportSelector, flow, xFraction, alignTop }) => {
      const stage = document.querySelector(stageSelector)?.getBoundingClientRect()
      if (!stage) return null
      const rendered = document.querySelector(nodeSelector)?.getBoundingClientRect()
      let cx
      let cy
      let top
      if (rendered) {
        cx = (rendered.left + rendered.right) / 2
        cy = (rendered.top + rendered.bottom) / 2
        top = rendered.top
      } else {
        // 画布只渲染视野里的卡（onlyRenderVisibleElements）：整张出屏时按夹具流坐标 + 眼前视口算大概位置，拖进来后再精确量。
        const layer = document.querySelector(viewportSelector)
        const origin = layer?.parentElement?.getBoundingClientRect()
        if (!layer || !origin || !flow) return null
        const m = new DOMMatrixReadOnly(getComputedStyle(layer).transform)
        cx = origin.left + m.m41 + (flow.x + 120) * m.a
        cy = origin.top + m.m42 + (flow.y + 90) * m.a
        top = origin.top + m.m42 + flow.y * m.a
      }
      return {
        dx: stage.left + stage.width * xFraction - cx,
        dy: alignTop ? stage.top + 16 - top : stage.top + stage.height * 0.3 - cy,
      }
    }, { stageSelector: CANVAS_STAGE_SELECTOR, nodeSelector: sel(id), viewportSelector: CANVAS_VIEWPORT_SELECTOR, flow: SEED_POSITION[id] ?? null, xFraction, alignTop })
    if (!delta || (Math.abs(delta.dx) < 24 && Math.abs(delta.dy) < 24)) return
    // 一次最多拖 250px（真人一把也就这么远），拖完重量再拖，不会一把拖出窗口。
    await dragPan(clamp(delta.dx), clamp(delta.dy))
    await win.waitForTimeout(120)
  }
}
/** 真人的一次点击：按下后停 60ms 再抬（Playwright 的 down/up 是同一帧，d3 会把它当成拖动尾巴吞掉 click）。 */
async function humanClick(p) {
  await win.mouse.move(p.x, p.y)
  await win.mouse.down()
  await win.waitForTimeout(60)
  await win.mouse.up()
}
async function fitView() {
  await win.getByLabel(EN ? 'Fit view' : '适应视图', { exact: true }).first().click()
  await waitForVisualQuiescence(win)
}
/** 浮层「真的看得见」：Playwright 的 isVisible 把 `visibility:hidden`（`invisible` 的 DOM 仍在）与零尺寸都算不可见。 */
const overlayVisible = (locator) => locator.first().isVisible()

try {
  win = await smoke.openProject()
  await expect(win.locator(sel('stack')), '项目打开后看不到两版卡').toBeVisible({ timeout: stationTimeout() })
  await fitView()
  await shot('00-canvas-ready')

  // ═══ G 各种手势之后，拖动态都必须收干净 ═══
  await dragPan(90, 30)
  await expectNotDragging('G1 拖动平移松手')
  await fitView()

  // G2（用户报的那一下）：平移松手后立刻点卡（远小于 150ms）。
  await dragPan(-70, 20)
  const p2 = await nodePoint('empty-image')
  await humanClick(p2)
  await expectNotDragging('G2 平移后 150ms 内点卡')
  await fitView()

  await dragPan(60, -20)
  const b3 = await blank()
  await humanClick(b3)
  await expectNotDragging('G3 平移后 150ms 内点空白')

  const b4 = await blank()
  await win.mouse.move(b4.x, b4.y)
  for (let i = 0; i < 5; i += 1) { await win.mouse.wheel(0, 40); await win.waitForTimeout(16) }
  await expectNotDragging('G4 滚轮平移')

  // 模拟触控板双指平移：带横向分量的 wheel、不按 Ctrl（按 Ctrl 的 wheel 是捏合缩放）。
  for (let i = 0; i < 5; i += 1) { await win.mouse.wheel(30, -25); await win.waitForTimeout(16) }
  await expectNotDragging('G5 触控板平移（模拟：deltaX+deltaY 的 wheel，ctrlKey=false）')

  // 平移刚松手、又立刻接上滚轮（触控板用户常见：拖完手指一抬就滑）。
  await dragPan(50, 40)
  for (let i = 0; i < 3; i += 1) { await win.mouse.wheel(0, 30); await win.waitForTimeout(10) }
  await expectNotDragging('G6 平移后 150ms 内接滚轮')
  await fitView()

  // 拖动中被系统打断（模拟：窗口上派发 pointercancel）。
  await dragPan(80, 0, { release: false })
  await win.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })))
  await win.mouse.up()
  await expectNotDragging('G7 拖动中 pointercancel（模拟）')

  // 拖动中窗口失焦（模拟：window blur）。
  await dragPan(-80, 0, { release: false })
  await win.evaluate(() => window.dispatchEvent(new FocusEvent('blur')))
  await win.mouse.up()
  await expectNotDragging('G8 拖动中窗口失焦（模拟）')
  await fitView()

  // ═══ P 平移完立刻点卡之后：浮框 / 参数条 / 「2 版」托盘都看得见、点得到 ═══
  // 平移量 = 把这张卡挪到舞台中间（人会停在的位置）。2026-09-25 起浮框钉在节点正下方、定宽 560、
  // 被挡就挡：卡贴着舞台边时浮框本来就会伸出去，那一截点不到是拍板的结果，不是这条要测的东西。
  await panCardToStageCentre('empty-image')
  const pe = await nodePoint('empty-image')
  await humanClick(pe)
  await expect(win.locator(sel('empty-image')), '空图片卡没选中').toHaveClass(/selected/)
  const emptyComposer = win.locator(`${sel('empty-image')} .generation-canvas-v2-node__composer-card`)
  await expect.poll(() => overlayVisible(emptyComposer), { timeout: 3_000 }).toBe(true).catch(() => undefined)
  check(await overlayVisible(emptyComposer), 'P1 空图片卡选中后生成浮框看得见', {})
  const emptyFooter = win.locator(`${sel('empty-image')} [data-node-composer-footer]`)
  const footerFirstButton = emptyFooter.locator('button').first()
  // 被挡就挡（09-25 拍板）：浮框是屏幕定尺寸（宽 560），1280×800 带 Agent 面板时舞台只剩约 800×480，
  // 底栏常压在左缘工具条 / 左下小地图 / 右下画面小窗上。像用户一样挪画布：卡顶贴舞台上沿，横向换几个位置，
  // 直到底栏第一颗按钮真的点得到——每挪一次浮框都要重新出现，这本身也是「平移后浮框看得见」的复核。
  const footerHittable = () => footerFirstButton.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const at = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return rect.width > 0 && Boolean(at) && (at === el || el.contains(at))
  }).catch(() => false)
  for (const xFraction of [0.5, 0.62, 0.4, 0.72]) {
    if (await footerHittable()) break
    await panCardToStageCentre('empty-image', { xFraction, alignTop: true })
    await expect.poll(footerHittable, { timeout: 1_500 }).toBe(true).catch(() => undefined)
  }
  check(await overlayVisible(emptyFooter), 'P1 参数条（浮框底栏）看得见', {})
  try {
    await expectHittable(footerFirstButton, 'P1 参数条第一颗按钮')
    check(true, 'P1 参数条按钮点得到（elementFromPoint 命中它自己）', {})
  } catch (error) { check(false, 'P1 参数条按钮点得到', String(error.message).split('\n')[0]) }
  await shot('01-empty-image-composer')

  // P1 为露出底栏把画布往上拖过一截，两版卡可能已在舞台外；程序不再替人把卡挪回来（09-25），人会自己拖回来。
  await panCardToStageCentre('stack')
  const ps = await nodePoint('stack')
  await humanClick(ps)
  await expect(win.locator(sel('stack')), '两版卡没选中').toHaveClass(/selected/)
  const stackComposer = win.locator(`${sel('stack')} .generation-canvas-v2-node__composer-card`)
  await expect.poll(() => overlayVisible(stackComposer), { timeout: 3_000 }).toBe(true).catch(() => undefined)
  check(await overlayVisible(stackComposer), 'P2 生成过的卡选中后生成浮框看得见', {})
  check(await overlayVisible(win.locator(`${sel('stack')} [data-node-floating-toolbar="true"]`)), 'P2 卡上浮条看得见', {})
  const pill = win.locator(sel('stack')).getByRole('button', { name: EN ? '2 versions' : '2 版', exact: true })
  try { await expectHittable(pill, 'P3「2 版」胶囊') ; check(true, 'P3「2 版」胶囊点得到', {}) } catch (error) { check(false, 'P3「2 版」胶囊点得到', String(error.message).split('\n')[0]) }
  await pill.click()
  const tray = win.locator('[data-node-result-stack="stack"]')
  await expect.poll(() => overlayVisible(tray), { timeout: 3_000 }).toBe(true).catch(() => undefined)
  check(await overlayVisible(tray), 'P3 点「2 版」弹出结果托盘（看得见）', {})
  await shot('02-version-tray')
  const setV1 = tray.locator('[data-result-stack-item="stack-v1"] button').first()
  try {
    await expectHittable(setV1, 'P4 第 1 版缩略图')
    await setV1.click()
    await expect(tray.locator('[data-result-stack-item="stack-v1"]')).toHaveAttribute('data-current', 'true', { timeout: 3_000 })
    check(true, 'P4 在托盘里切到第 1 版', {})
  } catch (error) { check(false, 'P4 在托盘里切到第 1 版', String(error.message).split('\n')[0]) }
  const downloadPath = path.join(tempRoot, 'downloads', 'version-2.png')
  fs.mkdirSync(path.dirname(downloadPath), { recursive: true })
  await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, downloadPath)
  const downloadButton = tray.locator('[data-result-stack-item="stack-v2"]').getByRole('button', { name: EN ? 'Download this version' : '下载这一版' })
  try {
    await expectHittable(downloadButton, 'P5 下载这一版')
    await downloadButton.click()
    await expect.poll(() => fs.existsSync(downloadPath) && fs.statSync(downloadPath).size > 0, { timeout: stationTimeout() }).toBe(true)
    check(true, 'P5 下载这一版写出非空文件', { bytes: fs.statSync(downloadPath).size })
  } catch (error) { check(false, 'P5 下载这一版写出非空文件', String(error.message).split('\n')[0]) }
  await pill.click()
  await expect.poll(() => overlayVisible(tray), { timeout: 3_000 }).toBe(false).catch(() => undefined)

  // ═══ F 删框 ═══
  const countOf = (selector) => win.locator(selector).count()
  /** 「删掉了」＝先证明探针此刻找得到它，再断言它消失（expectAbsent 的签名强制这一步，免得死选择器报绿）。 */
  const expectGone = async (selector, label) => {
    try {
      await expectAbsent(win.locator(selector), { provenBy: proofs.get(selector), message: label })
      return true
    } catch (error) { check(false, label, String(error.message).split('\n')[0]); return false }
  }
  const proofs = new Map()
  const prove = async (selector, label) => proofs.set(selector, await proveProbe(win.locator(selector), label))
  const MEMBERS = `${sel('frame-m1')}, ${sel('frame-m2')}`
  const undo = async () => { await win.keyboard.press(`${MOD}+z`); await waitForVisualQuiescence(win) }
  const clickFrame = async (id) => {
    const p = await findFrameDragHandlePoint(win, { frameSelector: frameSel(id) })
    expect(p, `框 ${id} 上找不到点得到的框边`).not.toBeNull()
    await win.mouse.click(p.x, p.y)
    await waitForVisualQuiescence(win)
    return p
  }
  // 先点空白取消选中：选中的那张卡的浮框钉在它正下方、不再躲开别的东西，会盖住框边（09-25 拍板「被挡就挡」）。
  await humanClick(await blank())
  await fitView()
  await prove(frameSel('frame-rain'), '删之前框在画布上')
  await prove(MEMBERS, '删之前框里的两张卡在画布上')
  await clickFrame('frame-rain')
  await win.keyboard.press('Delete')
  await waitForVisualQuiescence(win)
  check(await expectGone(frameSel('frame-rain'), 'F1 选中框按 Delete：框删掉') && await expectGone(MEMBERS, 'F1 选中框按 Delete：框里的卡一起删掉'),
    'F1 选中框按 Delete：框和里面的卡一起删掉', {})
  await shot('03-frame-deleted')
  await undo()
  check(await countOf(frameSel('frame-rain')) === 1 && await countOf(`${sel('frame-m1')}, ${sel('frame-m2')}`) === 2, 'F1 ⌘Z 一次全部回来', {})

  await clickFrame('frame-empty')
  check(await win.locator(frameSel('frame-empty')).getAttribute('data-frame-selected') === 'true', 'F2 点空框：框本身被选中', {})
  const stillSelected = await win.locator('.react-flow__node.selected').evaluateAll((els) => els.map((el) => el.getAttribute('data-id')))
  check(stillSelected.join(',') === '', 'F2 点空框：之前选中的卡不再被选着（Delete 不会误删别处）', {})
  await shot('04-empty-frame-selected')
  await prove(frameSel('frame-empty'), '删之前空框在画布上')
  await win.keyboard.press('Backspace')
  await waitForVisualQuiescence(win)
  check(await expectGone(frameSel('frame-empty'), 'F2 选中空框按 Backspace 删掉'), 'F2 选中空框按 Backspace 删掉', {})
  check(await countOf(sel('stack')) === 1 && await countOf(sel('empty-image')) === 1, 'F2 别的卡一张没少', {})
  await undo()
  check(await countOf(frameSel('frame-empty')) === 1, 'F2 ⌘Z 空框回来', {})

  const fp = await findFrameDragHandlePoint(win, { frameSelector: frameSel('frame-rain') })
  await win.mouse.click(fp.x, fp.y, { button: 'right' })
  const menuDelete = win.locator('[data-frame-menu="true"]').getByRole('menuitem', { name: EN ? /^Delete/ : /^删除/ })
  try {
    await expectHittable(menuDelete, 'F3 框菜单「删除」')
    await shot('05-frame-menu-delete')
    await menuDelete.click()
    await waitForVisualQuiescence(win)
    check(await expectGone(frameSel('frame-rain'), 'F3 框菜单「删除」：框删掉') && await expectGone(MEMBERS, 'F3 框菜单「删除」：框里的卡一起删'), 'F3 框菜单「删除」：框和里面的卡一起删', {})
    await undo()
    check(await countOf(frameSel('frame-rain')) === 1 && await countOf(`${sel('frame-m1')}, ${sel('frame-m2')}`) === 2, 'F3 ⌘Z 一次全部回来', {})
  } catch (error) { check(false, 'F3 框菜单「删除」', String(error.message).split('\n')[0]) }
  await shot('06-end')
} catch (error) {
  failures.push(`走查中断：${String(error?.stack || error).split('\n').slice(0, 3).join(' | ')}`)
  await shot('zz-crash').catch(() => undefined)
} finally {
  fs.writeFileSync(path.join(shotsDir, 'results.json'), JSON.stringify({ locale: LOCALE, label: LABEL, fixture: smoke.fixture, failures, consoleErrors }, null, 2))
  await smoke.close()
}
if (failures.length) {
  console.error(`\n✖ ${failures.length} 条失败：\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log(`\n✓ node-params-and-version-pill [${smoke.fixture} · ${LOCALE}] 全部通过，截图：${shotsDir}`)
