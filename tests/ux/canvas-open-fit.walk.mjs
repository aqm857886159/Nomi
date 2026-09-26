// 打开项目时适应一次（useAutoFitOnLoad，2026-09-25 用户拍板保留、09-26 裁定 B 改成必定触发）——冷开与从项目库重开两条路都要摆全貌。
//
// 为什么单独一条走查：「打开时摆全貌」判的是「打开那一刻」的两样输入——内容载入没有、用户有没有留下视角。
// 这两样只要被程序自己的动作提前写脏，适应就会「有时生效」。2026-09-26 抓到的一次：离开项目时 store 清空、
// 画布还停在上个视角，「store → React Flow」同步把它推回 1:1 兜底，那一下的回声被记成「用户留下的视角」，
// 从项目库重开就不再摆全貌（冷开第一次画布本来就在 1:1，同步没东西可推，所以一直绿）。磁吸 / 性能 / 卡片堆叠
// 几条都只开一次项目，抓不到。这里冷开、重开两条路都走，判据是用户眼睛看到的：每张卡都挂出来、并且都在舞台里。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expect } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { waitForCanvasViewportSettled } from './_canvasHit.mjs'
import { createCanvasPerformanceFixture } from './fixtures/canvas-performance-fixture.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shots = path.join(root, 'tests/ux/shots/canvas-open-fit')
fs.rmSync(shots, { recursive: true, force: true })
fs.mkdirSync(shots, { recursive: true })
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-open-fit-'))
const fixture = createCanvasPerformanceFixture({ projectsDir: path.join(temp, 'projects'), scale: 'S', projectName: '打开时适应验收' })
// 留 16 张：1:1 下一屏装不下（后面有断言证明），最小缩放 0.2 之内又装得下——48 张的 S 档在 1600 宽里 0.2 都装不全，
// 那时「每张都在舞台里」量的是缩放下限，不是适应有没有发生。
const canvas = fixture.record.payload.generationCanvas
// 夹具把卡排成一长条（一排 12 张），宽度先撞到 0.2 下限；这里排成 4×4，全貌落在 0.2–1 之间。
const kept = new Set(canvas.nodes.slice(0, 16).map((node) => node.id))
fixture.record.payload.generationCanvas = {
  ...canvas,
  nodes: canvas.nodes.filter((node) => kept.has(node.id)).map((node, index) => ({
    ...node,
    position: { x: 120 + (index % 4) * 460, y: 120 + Math.floor(index / 4) * 380 },
  })),
  edges: canvas.edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target)),
  groups: [],
  selectedNodeIds: [],
}
fs.writeFileSync(path.join(fixture.projectRoot, '.nomi/project.json'), JSON.stringify(fixture.record))
const totalNodes = kept.size
const { app, win: first } = await launchNomiApp({ name: 'canvas-open-fit', projectsDir: fixture.projectsDir, syntheticCredentialStorage: true, settleMs: 0 })
const results = []
let win = first

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
  expect(ok, `${name}：${JSON.stringify(detail)}`).toBe(true)
}

async function libraryWindow() {
  await expect.poll(async () => {
    for (const page of app.windows()) {
      if (await page.locator('[data-project-card]').count().catch(() => 0)) return true
    }
    return false
  }, { message: '项目库出现', timeout: stationTimeout({ operations: 2 }) }).toBe(true)
  for (const page of app.windows()) {
    if (await page.locator('[data-project-card]').count().catch(() => 0)) return page
  }
  throw new Error('项目库窗口不存在')
}

async function openFromLibrary() {
  const library = await libraryWindow()
  await library.locator('[data-project-card]', { hasText: fixture.record.name }).first().click()
  await expect.poll(() => app.windows().some((page) => /projectId=/.test(page.url())), { message: '项目窗口就绪' }).toBe(true)
  win = app.windows().find((page) => /projectId=/.test(page.url()))
  const bw = await app.browserWindow(win)
  await bw.evaluate((window) => {
    window.setBounds({ x: 0, y: 0, width: 1600, height: 1000 })
    window.setIgnoreMouseEvents(true)
  })
  await win.locator('.generation-canvas-v2__stage').waitFor()
}

/** 用户看到的全貌：项目里每张卡都挂出来（没被虚拟化成「屏外」），且每张卡都整块落在舞台里。 */
async function readWholeView() {
  const viewport = await waitForCanvasViewportSettled(win)
  const view = await win.evaluate(() => {
    const stage = document.querySelector('.generation-canvas-v2__stage').getBoundingClientRect()
    const cards = [...document.querySelectorAll('.react-flow__node')].map((node) => node.getBoundingClientRect())
    const outside = cards.filter((box) => box.left < stage.left - 1 || box.top < stage.top - 1 || box.right > stage.right + 1 || box.bottom > stage.bottom + 1).length
    return { mounted: cards.length, outside }
  })
  return { ...view, zoom: Math.round(viewport.zoom * 1000) / 1000 }
}

try {
  await win.evaluate(() => {
    localStorage.setItem('nomi:splash:v1', 'seen')
    localStorage.setItem('nomi:journey-tour:v1', 'seen')
    localStorage.setItem('nomi:canvas-gesture-hint:v1', 'seen')
  })
  await win.reload()

  // ① 冷开：从项目库第一次打开。
  await openFromLibrary()
  await expect.poll(async () => (await readWholeView()).mounted, { message: `冷开后 ${totalNodes} 张卡全部挂出` }).toBe(totalNodes)
  const cold = await readWholeView()
  await win.screenshot({ path: path.join(shots, '01-cold-open.png') })
  check('冷开：全部卡片都在舞台里（摆了全貌）', cold.mounted === totalNodes && cold.outside === 0 && cold.zoom < 0.95, cold)

  // 用户开始干活：回到 1:1。之后离开项目、再从项目库打开。
  await win.getByRole('button', { name: '重置视图', exact: true }).first().click()
  const working = await waitForCanvasViewportSettled(win)
  check('重置视图回到 100%', Math.abs(working.zoom - 1) < 0.001, { zoom: working.zoom })
  const beforeReopen = await readWholeView()
  check('1:1 下看不到全部卡片（后面的「摆了全貌」才有意义）', beforeReopen.mounted < totalNodes || beforeReopen.outside > 0, beforeReopen)

  // 离开时视口不在 1:1：用户点「适应视图」看全貌后走人（这是真正坏过的那条路——停在 1:1 离开时同步没有东西要推，
  // 抓不到）。2026-09-26：离开时 store 清空、画布还停在这里，「store → React Flow」同步把它推回 1:1 兜底，
  // 回声把 1:1 记成了「用户留下的视角」，重开时适应就按「有记忆」保留了它。
  await win.getByRole('button', { name: '适应视图', exact: true }).first().click()
  const leaving = await waitForCanvasViewportSettled(win)
  check('离开前视口不在 1:1（点了「适应视图」）', Math.abs(leaving.zoom - 1) > 0.05, { zoom: leaving.zoom })

  // ② 重开：返回项目库，再点同一个项目。
  await win.getByRole('button', { name: '返回项目库', exact: true }).first().click()
  await openFromLibrary()
  await expect.poll(async () => (await readWholeView()).mounted, { message: `重开后 ${totalNodes} 张卡全部挂出（没摆全貌时只挂视野里那几张）` }).toBe(totalNodes)
  const reopened = await readWholeView()
  await win.screenshot({ path: path.join(shots, '02-reopened.png') })
  check('从项目库重开：全部卡片都在舞台里（摆了全貌）', reopened.mounted === totalNodes && reopened.outside === 0 && reopened.zoom < 0.95, reopened)

  fs.writeFileSync(path.join(shots, 'report.json'), JSON.stringify({ totalNodes, results }, null, 2) + '\n')
  console.log('\n✅ 全部达标')
} finally {
  await app.close().catch(() => undefined)
  fs.rmSync(temp, { recursive: true, force: true })
}
