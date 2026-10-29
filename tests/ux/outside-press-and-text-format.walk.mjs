import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 2026-10-23 用户实测的两组问题的真机回归（生产构建，先 `pnpm run build`；隔离资料目录、窗口挂屏幕外，零花费）：
//   ① 点外面就收：画布左下「⋯」浮层、左栏抽屉打开后点画布空白处要收起
//      （修前：d3-zoom 在 mousedown 上 stopImmediatePropagation，冒泡的 mousedown 监听收不到）；
//   ② 富文本格式条（画布文本节点的浮条 + 创作区工具栏，一份 buildRichTextActions 两个壳）：
//      按了能看见变化（加粗 / 列表有项目符号）、按钮的按下态跟着光标处的格式走、悬停有提示。
//
// 用法：node tests/ux/outside-press-and-text-format.walk.mjs [--locale en] [--shot]
// 输出：每项一行 PASS / FAIL，任一 FAIL 非零退出；截图写到 tests/ux/shots/outside-press-and-text-format/。
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expect, expectAbsent, proveProbe, readComputedColorChannels } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { CANVAS_ZOOM_BAR, canvasViewOptionsButton, openCanvasViewOptions, openRailDrawer, railDrawer, switchWorkspace } from './_shell.mjs'
import { findCanvasBlankPoint } from './_canvasHit.mjs'
import { uiText } from './full-walk/invariants.mjs'

const localeArg = process.argv.indexOf('--locale')
const locale = localeArg > 0 ? process.argv[localeArg + 1] : 'zh-CN'
// --scheme dark：暗色轨（拍板图要光 / 暗两版截图）；截图名带上 -dark。
const schemeArg = process.argv.indexOf('--scheme')
const scheme = schemeArg > 0 ? process.argv[schemeArg + 1] : 'light'
const tag = scheme === 'dark' ? `${locale}-dark` : locale
const shot = process.argv.includes('--shot')
const label = (key) => uiText(locale, key)
const root = makeTempDir('nomi-outside-press-text-format-')
const projectsDir = path.join(root, 'projects')
const projectId = 'outside-press-text-format'
const projectRoot = path.join(projectsDir, projectId)
const output = path.resolve('tests/ux/shots/outside-press-and-text-format')
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(output, { recursive: true })

const NOTE_ID = 'note'
const paragraph = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const nodes = [{
  id: NOTE_ID, kind: 'text', categoryId: 'shots', title: 'note',
  position: { x: 160, y: 200 }, size: { width: 360, height: 240 }, status: 'idle',
  contentJson: { type: 'doc', content: [paragraph('Rainy platform at night'), paragraph('She turns around')] },
}]
const payload = { workbenchDocument: null, timeline: null, generationCanvas: { nodes, edges: [], groups: [], selectedNodeIds: [], canvasZoom: 1, canvasPan: { x: 0, y: 0 } }, storyboardPlan: null, storyboardPlanCommitted: false }
const project = { id: projectId, name: 'outside-press-text-format', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projectRoot, ...payload, payload }
for (const name of ['project.json', '.nomi/project.json']) fs.writeFileSync(path.join(projectRoot, name), JSON.stringify(project))

const results = []
async function check(name, body) {
  try {
    await body()
    results.push({ name, ok: true })
    console.log(`PASS ${name}`)
  } catch (error) {
    results.push({ name, ok: false, error: String(error?.message ?? error).split('\n')[0] })
    console.log(`FAIL ${name} — ${String(error?.message ?? error).split('\n')[0]}`)
    if (shot) await win.screenshot({ path: path.join(output, `fail-${results.length}-${tag}.png`) })
  }
}

const run = await launchNomiApp({
  name: 'outside-press-and-text-format', projectsDir, settleMs: 0,
  initialLocalStorage: { 'nomi:locale:v1': locale, 'nomi-color-scheme': scheme, 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' },
})
const win = run.win
win.setDefaultTimeout(stationTimeout({ operations: 2 }))
try {
  const browserWindow = await run.app.browserWindow(win)
  await browserWindow.evaluate((w) => w.setBounds({ x: -32000, y: -32000, width: 1680, height: 1050 }))
  await win.locator('[data-project-card]', { hasText: 'outside-press-text-format' }).first().dblclick()
  await switchWorkspace(win, 'generation')
  const note = win.locator(`[data-node-id="${NOTE_ID}"]`).first()
  await expect(note, '文本节点没出现').toBeVisible()

  // ── ① 点外面就收 ─────────────────────────────────────────────────────────────
  await check('画布「⋯」浮层：点画布空白处收起', async () => {
    await openCanvasViewOptions(win)
    const blank = await findCanvasBlankPoint(win)
    if (!blank) throw new Error('画布上找不到空白点')
    await win.mouse.click(blank.x, blank.y)
    await expect(win.locator('[data-canvas-view-options="true"]').first(), '点空白后「⋯」浮层还在 · board:TextFormatDismiss/dismiss.outside-press').toBeHidden()
    await expect(win.locator(CANVAS_ZOOM_BAR).first(), '缩放簇跟着没了').toBeVisible()
    // 点外面关掉的不把焦点还给「⋯」（还回去它的悬停提示会挂在那儿）；Esc 关闭才还（storyboard-popover-keyboard 管那条）。
    await expect(canvasViewOptionsButton(win), '点空白收起后焦点又落回「⋯」 · board:TextFormatDismiss/dismiss.outside-press').not.toBeFocused()
    if (shot) await win.screenshot({ path: path.join(output, `dismiss-after-${tag}.png`) })
  })
  await check('左栏素材抽屉：点画布空白处收起', async () => {
    await openRailDrawer(win, 'assets')
    // 抽屉是滑入的（Mantine 过渡 160ms）：动画没走完就找空白点，找到的点等抽屉滑到位会被它盖住，
    // 这一下就点在了抽屉里（2026-10-23 英文轨偶发 1/4）。等抽屉上没有在跑的动画再找。
    await expect.poll(() => railDrawer(win, 'assets').evaluate((element) => {
      const panel = element.closest('[role="dialog"]') ?? element
      return panel.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running').length
    }), { message: '抽屉的滑入动画一直没停' }).toBe(0)
    const blank = await findCanvasBlankPoint(win)
    if (!blank) throw new Error('画布上找不到空白点')
    await win.mouse.click(blank.x, blank.y)
    await expect(railDrawer(win, 'assets'), '点空白后抽屉还在 · board:TextFormatDismiss/dismiss.outside-press').toBeHidden()
  })

  // ── ② 画布文本节点的格式条 ─────────────────────────────────────────────────────
  const noteEditor = note.locator('.ProseMirror').first()
  const noteToolbar = note.getByRole('toolbar').first()
  const noteButton = (key) => noteToolbar.getByRole('button', { name: label(key), exact: true })
  await clickOrFail(noteEditor, '点进文本节点正文')
  await expect(noteToolbar, '聚焦正文后格式条没出来').toBeVisible()
  await check('节点格式条：走节点浮条外壳，在可见画布里、编辑时顶替锁 / 复制条', async () => {
    // 画布打开即摆全貌（单节点 300%）：格式条要整条落在顶栏下面，且节点上方只有这一条浮条。
    const stage = await win.locator('.generation-canvas-v2__stage').first().boundingBox()
    const bar = await noteToolbar.boundingBox()
    if (!stage || !bar || bar.y < stage.y) throw new Error(`格式条跑到画布可见区外（bar.y=${bar?.y} stage.y=${stage?.y}） · board:TextFormatDismiss/format.canvas-bar.shell`)
    // 恒定屏幕尺寸：画布放大时格式条不跟着放大（跟着放大的话 300% 下约 120px，现在约 42px）。
    const zoom = await win.locator('.react-flow__viewport').first().evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a)
    if (zoom < 2) throw new Error(`前提不成立：画布没放大到 200% 以上（zoom=${zoom.toFixed(2)}），测不出格式条会不会跟着放大`)
    if (bar.height >= 60) throw new Error(`格式条跟着画布放大了（zoom=${zoom.toFixed(2)}，高 ${bar.height}px，正常约 42px） · board:TextFormatDismiss/format.canvas-bar.shell`)
    await expect(note.locator('[data-node-floating-toolbar="true"]'), '编辑时节点上方不止一条浮条 · board:TextFormatDismiss/format.canvas-bar.shell').toHaveCount(1)
  })
  await win.keyboard.press('ControlOrMeta+A')
  await check('节点格式条：加粗按下去正文变粗、按钮显示按下', async () => {
    await clickOrFail(noteButton('creationAi.selection.bold'), '点加粗')
    await expect(noteEditor.locator('strong').first(), '正文里没有加粗').toBeVisible()
    await expect(noteButton('creationAi.selection.bold'), '加粗后按钮没显示按下 · board:TextFormatDismiss/format.pressed-state').toHaveAttribute('aria-pressed', 'true')
  })
  await check('节点格式条：键盘取消加粗后按钮跟着弹起', async () => {
    const proof = await proveProbe(noteEditor.locator('strong'), '节点正文里有上一步加的粗体')
    await win.keyboard.press('ControlOrMeta+B')
    await expectAbsent(noteEditor.locator('strong'), { provenBy: proof, message: '取消加粗后正文仍有加粗' })
    await expect(noteButton('creationAi.selection.bold'), '取消加粗后按钮还显示按下').not.toHaveAttribute('aria-pressed', 'true')
  })
  await check('节点格式条：无序列表有项目符号', async () => {
    await clickOrFail(noteButton('creationAi.selection.bulletList'), '点无序列表')
    const list = noteEditor.locator('ul').first()
    await expect(list, '没变成列表').toBeVisible()
    await expect.poll(() => list.evaluate((el) => getComputedStyle(el).listStyleType), { message: '列表没有项目符号 · board:TextFormatDismiss/format.list-markers' }).toBe('disc')
  })
  await check('节点格式条：悬停按钮出提示', async () => {
    await noteButton('creationAi.selection.italic').hover()
    await expect(win.getByRole('tooltip', { name: label('creationAi.selection.italic') }).first(), '悬停斜体没出提示 · board:TextFormatDismiss/format.tooltip').toBeVisible()
  })
  if (shot) await win.screenshot({ path: path.join(output, `canvas-text-node-${tag}.png`) })

  // ── ② 创作区工具栏（同一份 actions 的另一个壳）────────────────────────────────────
  await switchWorkspace(win, 'creation')
  const creation = win.locator('[data-creation-editor="true"]').first()
  const creationEditor = creation.locator('.ProseMirror').first()
  const creationButton = (key) => creation.locator('.workbench-editor-toolbar').getByRole('button', { name: label(key), exact: true })
  await clickOrFail(creationEditor, '点进创作区正文')
  await win.keyboard.type('Rainy platform at night')
  await win.keyboard.press('ControlOrMeta+A')
  await check('创作区选区浮条：选中第一行不盖顶部工具栏', async () => {
    const popover = win.locator('.workbench-selection-popover').first()
    await expect(popover, '选中后没出选区浮条').toBeVisible()
    const bar = await creation.locator('.workbench-editor-toolbar').first().boundingBox()
    const box = await popover.boundingBox()
    if (!bar || !box || box.y < bar.y + bar.height) throw new Error(`选区浮条盖住了顶部工具栏（popover.y=${box?.y} toolbar.bottom=${bar ? bar.y + bar.height : null}） · board:TextFormatDismiss/format.selection-popover.placement`)
  })
  await check('创作区工具栏：加粗按下去正文变粗、按钮显示按下', async () => {
    await clickOrFail(creationButton('creationAi.selection.bold'), '点加粗')
    await expect(creationEditor.locator('strong').first(), '正文里没有加粗').toBeVisible()
    await expect(creationButton('creationAi.selection.bold'), '加粗后按钮没显示按下').toHaveAttribute('aria-pressed', 'true')
    // 按钮有颜色过渡：等过渡走完再读，读到的才是停下来的底色。
    await expect.poll(async () => {
      const { channels } = await readComputedColorChannels(creationButton('creationAi.selection.bold'), 'background-color')
      return channels.length >= 4 && channels[3] > 0
    }, { message: '按下态没有底色，看起来和没按一样' }).toBe(true)
  })
  await check('创作区工具栏：键盘取消加粗后按钮跟着弹起', async () => {
    const proof = await proveProbe(creationEditor.locator('strong'), '创作区正文里有上一步加的粗体')
    await win.keyboard.press('ControlOrMeta+B')
    await expectAbsent(creationEditor.locator('strong'), { provenBy: proof, message: '取消加粗后正文仍有加粗' })
    await expect(creationButton('creationAi.selection.bold'), '取消加粗后按钮还显示按下').not.toHaveAttribute('aria-pressed', 'true')
  })
  await check('创作区工具栏：有序 / 无序列表有序号和项目符号', async () => {
    await clickOrFail(creationButton('creationAi.selection.bulletList'), '点无序列表')
    const bullet = creationEditor.locator('ul').first()
    await expect.poll(() => bullet.evaluate((el) => getComputedStyle(el).listStyleType), { message: '无序列表没有项目符号' }).toBe('disc')
    await clickOrFail(creationButton('creationAi.selection.orderedList'), '点有序列表')
    const ordered = creationEditor.locator('ol').first()
    await expect.poll(() => ordered.evaluate((el) => getComputedStyle(el).listStyleType), { message: '有序列表没有序号' }).toBe('decimal')
  })
  await check('创作区工具栏：悬停按钮出提示', async () => {
    await creationButton('creationAi.selection.code').hover()
    await expect(win.getByRole('tooltip', { name: label('creationAi.selection.code') }).first(), '悬停代码没出提示').toBeVisible()
  })
  if (shot) await win.screenshot({ path: path.join(output, `creation-toolbar-${tag}.png`) })
} finally {
  await run.close()
}

fs.writeFileSync(path.join(output, `results-${tag}.json`), JSON.stringify(results, null, 2))
const failed = results.filter((result) => !result.ok)
console.log(`RESULT ${results.length - failed.length}/${results.length} passed`)
if (failed.length > 0) process.exit(1)
