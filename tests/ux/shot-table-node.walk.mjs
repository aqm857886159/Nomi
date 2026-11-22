// 拆解表节点走查（拆解前选模型 · 第一批，2026-10-18）：真 Electron、真点击，中英 × 光暗四轨。
// 用法：pnpm run build && node tests/ux/shot-table-node.walk.mjs [--only zh-light]
// 产出：tests/ux/shots/shot-table-node/<轨>/*.png（人眼对账拍板稿 docs/design/boards/2026-10-18/ShotTableNode.board.json）。
//
// 每一步先断言「到了」再截图：
//  ① 视频浮条「拆解 ▾ → 镜头表」只建表：新表被选中（浮条里的点击不再冒回视频节点）、点边缘「新节点在右侧」框进来，
//     下方拆解栏是「拆解」态、没有任何报价卡（不花钱）
//  ② 选中拆好的表：上方浮条（显示列 · 行高）+ 下方栏（无整表重拆、说明换模型对单镜重拆生效），浮条与下方栏都以节点为中心
//  ③ 行高「+」：标准 → 大，行真的变高；复位
//  ④ 显示列菜单：每列一个勾选项
//  ⑤ 勾两镜：下方栏换成「已选 2 镜 · 取消选择」（10-18 用户：拆完要干嘛交给 Agent，表上不再有「生成 N 镜」）
//  ⑤b 横向滚表：镜号与关键帧两列固定在左，画面列跟着滚走（拍板稿「尺寸与缩放」）
//  ⑥ 表一半在舞台右缘外：浮条仍是一行、整条在舞台里（不为了对着节点中心把自己挤成两行）
//  ⑦a 缩到 45%–80%：中档只留 镜 · 关键帧 · 景别 · 画面
//  ⑦ 缩到 45% 以下：远档卡片（标题 · 镜数 · 关键帧条，拍板稿图 4），不再是表格
// 不点「拆解」——那一下走报价卡、花真钱，真付费单独走（设计卡 ★9 ②）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp, closeNomiApp } from './_launchApp.mjs'
import { expect, expectVisible, expectAbsent, proveProbe, clickOrFail, holdAbsent, screenshotSettled, expectNoCjkInEnglishDom, expectNoRawI18nKeysInDom } from './_assert.mjs'
import { uiText, uiTextPattern } from './full-walk/invariants.mjs'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { createCanvasPerformanceFixture } from './fixtures/canvas-performance-fixture.mjs'
import { canvasFitViewButton } from './_shell.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { findCanvasBlankPoint } from './_canvasHit.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const shotsRoot = path.join(repoRoot, 'tests/ux/shots/shot-table-node')
const TRACKS = [
  { id: 'zh-light', locale: 'zh-CN', scheme: 'light' },
  { id: 'en-dark', locale: 'en', scheme: 'dark' },
  { id: 'zh-dark', locale: 'zh-CN', scheme: 'dark' },
  { id: 'en-light', locale: 'en', scheme: 'light' },
]
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
const READY_TABLE_ID = 'canvas-perf-shot-table'

const zh = (track) => track.locale.startsWith('zh')
const sleep = (page, ms) => page.waitForTimeout(ms)
const nodeHost = (page, id) => page.locator(`.react-flow__node[data-id="${id}"]`)

async function fitView(page) {
  await clickOrFail(canvasFitViewButton(page), 'fit view')
  await sleep(page, 700)
}

/** 鼠标停在 point 上滚轮放大到工作缩放（≥0.95）。 */
async function zoomAt(page, point) {
  await page.mouse.move(point.x, point.y)
  for (let tick = 0; tick < 40; tick += 1) {
    const zoom = await page.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a)
    if (zoom >= 0.95) break
    await page.mouse.wheel(0, -120)
    await sleep(page, 60)
  }
  await sleep(page, 500)
}

/** 鼠标停在 point 上滚轮缩小到远档（< 0.45，拍板稿图 4）。 */
async function zoomOutBelow(page, point, target) {
  await page.mouse.move(point.x, point.y)
  for (let tick = 0; tick < 40; tick += 1) {
    const zoom = await page.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a)
    if (zoom < target) break
    await page.mouse.wheel(0, 120)
    await sleep(page, 60)
  }
  await sleep(page, 500)
}

/** 节点正上方一点的空白画布（滚轮在节点身上会被视频 / 表格自己吃掉，不缩放画布）。 */
async function aboveOf(locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('元素不在屏上')
  return { x: box.x + box.width / 2, y: Math.max(80, box.y - 24) }
}

/** 拖空白画布把 article 的上沿带到舞台中上部、水平居中（真人就是这么平移的；不碰视口 API）。 */
async function panIntoView(page, article) {
  const stage = await page.locator('.generation-canvas-v2__stage').boundingBox()
  const box = await article.boundingBox()
  if (!stage || !box) throw new Error('舞台或节点不在屏上')
  const dx = (stage.x + stage.width / 2) - (box.x + box.width / 2)
  const dy = (stage.y + 180) - box.y
  const start = await findCanvasBlankPoint(page)
  if (!start) throw new Error('找不到画布空白起手点')
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 12 })
  await page.mouse.up()
  await sleep(page, 500)
}

/** 浮条 / 下方栏的水平中心与节点中心差多少像素（拍板评论：上下参数框要居中）。 */
async function centerOffset(page, nodeId, selector) {
  return page.evaluate(({ id, sel }) => {
    const host = document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`)
    const article = host?.querySelector('article')
    const bar = host?.querySelector(sel)
    if (!article || !bar) return null
    const a = article.getBoundingClientRect()
    const b = bar.getBoundingClientRect()
    return Math.round(Math.abs((a.left + a.width / 2) - (b.left + b.width / 2)))
  }, { id: nodeId, sel: selector })
}

async function shot(page, dir, name) {
  await screenshotSettled(page, { path: path.join(dir, `${name}.png`) })
  console.log(`    📸 ${name}`)
}

async function walkTrack(track) {
  const dir = path.join(shotsRoot, track.id)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const tempRoot = makeTempDir(`nomi-shot-table-walk-${track.id}-`)
  const projectsDir = path.join(tempRoot, 'projects')
  fs.mkdirSync(projectsDir, { recursive: true })
  const fixture = createCanvasPerformanceFixture({ projectsDir, scale: 'T12', withProjectIdentity: true })
  const { app, win: page } = await launchNomiApp({
    name: `shot-table-walk-${track.id}`,
    projectsDir,
    timeout: 120_000,
    viewportSize: { width: 1600, height: 1000 },
    initialLocalStorage: {
      'nomi:locale:v1': track.locale,
      'nomi-color-scheme': track.scheme,
      'nomi:splash:v1': 'seen',
      'nomi:journey-tour:v1': 'seen',
      'nomi:canvas-gesture-hint:v1': 'seen',
      __nomiE2E: '1',
    },
    env: { NOMI_DISABLE_AUTO_UPDATE: '1' },
  })
  try {
    await expect(page.locator('html')).toHaveAttribute('data-theme', track.scheme)
    await clickOrFail(page.locator('[data-project-card]', { hasText: fixture.record.name }).first(), 'open fixture project')
    await page.locator('.generation-canvas-v2__stage').waitFor({ timeout: stationTimeout({ operations: 4 }) })
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length > 0, undefined, { timeout: stationTimeout({ operations: 4 }) })
    await fitView(page)

    // ① 视频浮条「拆解 ▾ → 镜头表」：只建表
    // 第一个视频已经有表（「镜头表」对它是选中已有的表），走第二个、还没拆过的视频。
    const freshVideoId = await page.evaluate((readyId) => {
      const nodes = window.__nomiCanvasStore.getState().nodes
      const used = nodes.find((node) => node.id === readyId).meta.shotTable.source.sourceNodeId
      return nodes.find((node) => node.kind === 'video' && node.id !== used)?.id
    }, READY_TABLE_ID)
    if (!freshVideoId) throw new Error('夹具里没有还没拆过的视频')
    const video = page.locator(`article[data-node-id="${freshVideoId}"]`)
    await zoomAt(page, await aboveOf(video))
    await clickOrFail(video, 'select video node', { position: { x: 40, y: 20 } })
    await clickOrFail(page.locator('button[data-toolbar-action-menu="break-down"]').first(), 'open break-down menu')
    await clickOrFail(page.locator('[data-menu-item="shot-table"]').first(), 'pick shot table')
    const created = await page.waitForFunction((readyId) => {
      const state = window.__nomiCanvasStore?.getState()
      const table = state?.nodes.find((node) => node.kind === 'shot_table' && node.id !== readyId)
      return table && state.selectedNodeIds.length === 1 && state.selectedNodeIds[0] === table.id ? table.id : null
    }, READY_TABLE_ID, { timeout: stationTimeout() }).then((handle) => handle.jsonValue())
    const createdStatus = await page.evaluate((id) => window.__nomiCanvasStore.getState().nodes.find((node) => node.id === id).meta.shotTable.source.status, created)
    if (createdStatus !== 'idle') throw new Error(`新建的拆解表应是待拆（idle），实际 ${createdStatus}`)
    // 新表落在源视频右边，可能在屏外：画布约定是不自动挪视口，边缘出「新节点在右侧」，点它才框进来（useCanvasArrivalHint）。
    const arrival = page.locator('[data-canvas-arrival-hint]')
    if (await arrival.count()) await clickOrFail(arrival.first(), 'go to new table')
    await sleep(page, 700)
    const idleBar = nodeHost(page, created).locator('[data-shot-table-composer="deconstruct"]')
    await expectVisible(idleBar, '新表下方拆解栏')
    await expect(idleBar.getByTestId('shot-table-restart-deconstruction')).toHaveText(zh(track) ? '拆解' : /Deconstruct/)
    await holdAbsent(page.locator('[data-spend-confirm-dialog]'), '建表不弹报价卡')
    // 首行：拆这条视频：<名> · m:ss（视频节点量出时长后才有；拍板稿图 1）
    await expect(idleBar.getByTestId('shot-table-source-line')).toContainText(/\d+:\d\d$/)
    await sleep(page, 400)
    await shot(page, dir, '01-new-table-idle')

    // ② 选中拆好的表：浮条 + 下方栏，都以节点为中心
    await fitView(page)
    // 远档时表只剩卡片、没有头条（拍板稿图 4）：先对着整张卡放大，到了近档再点头条。
    await zoomAt(page, await aboveOf(nodeHost(page, READY_TABLE_ID).locator('article')))
    const readyHeader = nodeHost(page, READY_TABLE_ID).locator('article header')
    await panIntoView(page, nodeHost(page, READY_TABLE_ID).locator('article'))
    await clickOrFail(readyHeader, 'select ready table', { position: { x: 300, y: 20 } })
    const host = nodeHost(page, READY_TABLE_ID)
    await expectVisible(host.locator('[data-node-floating-toolbar]'), '拆解表上方浮条')
    await expectVisible(host.locator('[data-shot-table-composer="deconstruct"]'), '拆解表下方栏')
    // 拆完的表不给整表重拆（会盖掉改过的格子，canRestartDeconstruction），换模型对单镜「重拆」生效——下方栏要把这句说出来。
    const composerProof = await proveProbe(host.locator('[data-shot-table-composer="deconstruct"] button'), '拆解栏里的按钮测得到')
    await expectAbsent(host.getByTestId('shot-table-restart-deconstruction'), { provenBy: composerProof, message: '拆完的表不给整表重拆' })
    await expect(host.locator('[data-shot-table-composer]')).toContainText(zh(track) ? '整表不重拆' : 'not re-run')
    const toolbarOffset = await centerOffset(page, READY_TABLE_ID, '[data-node-floating-toolbar]')
    const composerOffset = await centerOffset(page, READY_TABLE_ID, '[data-shot-table-composer]')
    console.log(`    · 居中偏差：浮条 ${toolbarOffset}px · 下方栏 ${composerOffset}px`)
    if (toolbarOffset > 2 || composerOffset > 2) throw new Error(`浮条 / 下方栏没以节点为中心（${toolbarOffset}px / ${composerOffset}px）`)
    if (!zh(track)) await expectNoCjkInEnglishDom(page, { message: '英文轨拆解表界面里有中文', allowSelectors: ['article[data-kind="shot_table"] tbody', 'article[data-kind="shot_table"] header', '[data-shot-table-composer] .truncate', 'article[data-kind="image"]', 'article[data-kind="video"]'] })
    await expectNoRawI18nKeysInDom(page, { message: '拆解表界面里有未翻译的 key' })
    await shot(page, dir, '02-ready-selected')

    // ③ 行高：标准 → 大
    const rowHeight = host.locator('[data-shot-table-row-height]')
    await expect(rowHeight).toHaveAttribute('data-shot-table-row-height', 'standard')
    const before = await host.locator('[data-shot-table-row]').first().evaluate((row) => row.offsetHeight)
    await clickOrFail(rowHeight.locator('button').last(), 'row taller')
    await expect(rowHeight).toHaveAttribute('data-shot-table-row-height', 'large')
    const after = await host.locator('[data-shot-table-row]').first().evaluate((row) => row.offsetHeight)
    if (!(after > before)) throw new Error(`行高「+」后行没变高（${before} → ${after}）`)
    await shot(page, dir, '03-row-height-large')
    await clickOrFail(rowHeight.locator('button').first(), 'row shorter')
    await expect(rowHeight).toHaveAttribute('data-shot-table-row-height', 'standard')

    // ④ 显示列菜单
    await clickOrFail(host.locator('button[data-toolbar-action-menu="shot-table-columns"]').first(), 'open columns menu')
    const columnItems = page.locator('[data-menu-item^="column-"]')
    await expectVisible(columnItems.first(), '显示列菜单项')
    if ((await columnItems.count()) < 6) throw new Error(`显示列菜单只有 ${await columnItems.count()} 项`)
    await shot(page, dir, '04-columns-menu')
    await page.keyboard.press('Escape')
    await sleep(page, 200)

    // ⑤ 勾两镜：下方栏换成「已选 2 镜 · 取消选择」
    const boxes = host.locator('[data-shot-table-row] input[type="checkbox"]')
    await clickOrFail(boxes.nth(0), 'check row 1')
    await clickOrFail(boxes.nth(1), 'check row 2')
    const selectionBar = host.locator('[data-shot-table-composer="selection"]')
    await expectVisible(selectionBar, '勾选态下方栏')
    await expect(selectionBar).toContainText(zh(track) ? '已选 2 镜' : '2 shots selected')
    await expect(selectionBar.getByRole('button')).toHaveCount(1)
    await shot(page, dir, '05-rows-selected')
    await clickOrFail(selectionBar.getByRole('button', { name: uiText(track.locale, 'shotTable.node.clearSelection') }), 'clear row selection')

    // ⑤b 横向滚表：镜号与关键帧固定在左，后面的列滚走
    const firstRow = host.locator('[data-shot-table-row]').first()
    const pinned = firstRow.locator('td').nth(2)
    const scrolling = firstRow.locator('td').nth(4)
    const [pinnedBefore, scrollingBefore] = [await pinned.boundingBox(), await scrolling.boundingBox()]
    await host.locator('table').evaluate((table) => { table.parentElement.scrollLeft = 240 })
    await sleep(page, 200)
    const [pinnedAfter, scrollingAfter] = [await pinned.boundingBox(), await scrolling.boundingBox()]
    if (Math.abs(pinnedAfter.x - pinnedBefore.x) > 1) throw new Error(`横向滚表时关键帧列跟着动了（${Math.round(pinnedBefore.x)} → ${Math.round(pinnedAfter.x)}）`)
    if (scrollingBefore.x - scrollingAfter.x < 100) throw new Error('表没有横向滚动——量不出固定列')
    await shot(page, dir, '05b-scrolled-pinned')
    await host.locator('table').evaluate((table) => { table.parentElement.scrollLeft = 0 })

    // ⑥ 表一半在舞台右缘外（用户 10-18 截图：浮条被挤成两行）：浮条仍是一行、整条在舞台里
    const stageBox = await page.locator('.generation-canvas-v2__stage').boundingBox()
    const tableBox = await host.locator('article').boundingBox()
    const start = await findCanvasBlankPoint(page)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x + (stageBox.x + stageBox.width - 120) - (tableBox.x + tableBox.width / 2), start.y, { steps: 12 })
    await page.mouse.up()
    await sleep(page, 400)
    await clickOrFail(host.locator('article header'), 'select table at right edge', { position: { x: 60, y: 20 } })
    const bar = host.locator('[data-node-floating-toolbar]')
    await expectVisible(bar, '贴右缘时的浮条')
    await sleep(page, 300)
    const barBox = await bar.boundingBox()
    if (barBox.height > 48) throw new Error(`贴右缘时浮条折成了多行（高 ${Math.round(barBox.height)}px）`)
    if (barBox.x + barBox.width > stageBox.x + stageBox.width + 1) throw new Error('贴右缘时浮条出了舞台')
    await shot(page, dir, '06-right-edge-toolbar')

    // ⑦a 中档（45%–80%）：只留 镜 · 关键帧 · 景别 · 画面（+ 勾选与状态）
    await zoomOutBelow(page, await findCanvasBlankPoint(page), 0.7)
    await expect(host.locator('article')).toHaveAttribute('data-density', 'compact')
    await expect(host.locator('thead th')).toHaveCount(6)
    await shot(page, dir, '07a-mid-columns')

    // ⑦ 缩到远档：卡片代替表格，写着镜数、带关键帧条
    await zoomOutBelow(page, await findCanvasBlankPoint(page), 0.4)
    const farCard = host.locator('[data-testid="shot-table-far-card"]')
    await expectVisible(farCard, '远档卡片')
    await expect(host.locator('[data-shot-table-row]')).toHaveCount(0)
    await expect(farCard).toContainText(new RegExp(uiTextPattern(uiText(track.locale, 'shotTable.count'))))
    await farCard.locator('img, .h-5.w-9').first().waitFor({ state: 'visible' }).catch(() => { throw new Error('远档卡片没有关键帧条') })
    await shot(page, dir, '07-far-card')
    console.log(`  ✓ ${track.id}`)
  } finally {
    await closeNomiApp(app)
  }
}

for (const track of TRACKS.filter((item) => !only || item.id === only)) {
  console.log(`▶ ${track.id}`)
  await walkTrack(track)
}
console.log(`截图：${path.relative(repoRoot, shotsRoot)}`)
