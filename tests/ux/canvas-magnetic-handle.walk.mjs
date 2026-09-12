// 真实 Electron：磁吸把手的「迁移前设计」验收。
//
// 合同（2026-09-11 用户拍板恢复）：
//   · 未选中的卡片 = 两个 28px 圆点，卡片外侧**没有**捕获指针的带子；
//   · 选中的图片类卡片（且只有它）= 左右各一条 112×168 的带子，加号在带内跟着指针走；
//   · 拖线进入目标卡片外侧热区 → 端点吸到该侧边缘，离开就放开；
//   · 因为同一时刻只有一张卡有带子，卡片之间的连线始终点得到（这条是回归的那一条）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, expectAbsent, proveProbe, screenshotSettled, waitForVisualQuiescence } from './_assert.mjs'
import { findCanvasBlankPoint, findEdgeHitPoint, findNodeHitPoint } from './_canvasHit.mjs'
import { createCanvasPerformanceFixture } from './fixtures/canvas-performance-fixture.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const evidence = path.join(root, 'docs/plan/canvas-magnetic-handle-evidence')
const phase = process.argv.includes('--red') ? 'red' : 'restored'
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-magnetic-'))
const fixture = createCanvasPerformanceFixture({ projectsDir: path.join(temp, 'projects'), scale: 'S', projectName: '磁吸连线验收' })
const images = fixture.record.payload.generationCanvas.nodes.filter((node) => node.kind === 'image').slice(0, 3)
// 目标卡与源卡**只隔 150 画布像素**：这正是被否掉的常驻带子吞掉整条连线的间距。
images.forEach((node, index) => {
  node.position = [{ x: 130, y: 120 }, { x: 130, y: 460 }, { x: 520, y: 120 }][index]
  node.title = ['参考图一', '参考图二', '目标图片'][index]
  node.size = { width: 240, height: 180 }
  node.meta = { ...node.meta, previewHeight: 180, userResized: true }
})
fixture.record.payload.generationCanvas = { nodes: images, edges: [], groups: [], selectedNodeIds: [] }
fs.writeFileSync(path.join(fixture.projectRoot, '.nomi/project.json'), JSON.stringify(fixture.record))
fs.mkdirSync(evidence, { recursive: true })
const results = []
const { app, win: first } = await launchNomiApp({ name: 'canvas-magnetic-handle', projectsDir: fixture.projectsDir, syntheticCredentialStorage: true, settleMs: 0 })
let win = first
const selector = (id) => `.react-flow__node[data-id="${id}"]`
const handle = (id, type, side) => win.locator(`${selector(id)} .react-flow__handle[data-handleid="${type}-${side}"]`)
const magneticBands = (id) => win.locator(`${selector(id)} .generation-canvas-react-flow__handle--magnetic`)

async function blank() {
  const point = await findCanvasBlankPoint(win, { preference: 'bottom' })
  expect(point, 'real RF pane point').not.toBeNull()
  await win.mouse.click(point.x, point.y)
  await waitForVisualQuiescence(win)
}
/** 卡片外侧、距离该侧边 `outset` 像素的那一点（带子存在时落在带内）。 */
async function outsidePoint(id, side, outset = 56) {
  const box = await win.locator(selector(id)).boundingBox()
  expect(box).not.toBeNull()
  const point = { x: side === 'left' ? box.x - outset : box.x + box.width + outset, y: box.y + box.height / 2 }
  const stage = await win.locator('.generation-canvas-v2__stage').boundingBox()
  expect(point.x).toBeGreaterThan(stage.x)
  expect(point.x).toBeLessThan(stage.x + stage.width)
  return point
}
async function select(id) {
  await waitForVisualQuiescence(win)
  let point
  await expect.poll(async () => {
    point = await findNodeHitPoint(win, { nodeSelector: selector(id) })
    return point !== null
  }, { message: `node ${id} is actually hittable after layout` }).toBe(true)
  await win.mouse.click(point.x, point.y)
  await expect(win.locator(selector(id))).toHaveClass(/selected/)
  await waitForVisualQuiescence(win)
}
/** 屏幕点的最顶层元素是谁——「这儿到底归谁」只认这一个判据。 */
async function ownerAt(point) {
  return win.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y)
    return {
      pane: hit?.classList.contains('react-flow__pane') ?? false,
      inHandle: Boolean(hit?.closest('.generation-canvas-react-flow__handle')),
      className: hit ? String(hit.className?.baseVal ?? hit.className ?? '') : null,
    }
  }, point)
}
async function iconCenter(id, side) {
  return handle(id, 'source', side).locator('.generation-canvas-react-flow__handle-icon').evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width, height: rect.height }
  })
}
async function endpoint() {
  return win.locator('.react-flow__connection-path').evaluate((path) => {
    const end = path.getPointAtLength(path.getTotalLength())
    const p = new DOMPoint(end.x, end.y).matrixTransform(path.getScreenCTM())
    return { x: p.x, y: p.y }
  })
}
async function edgesTouchingSide(id, side) {
  return win.evaluate(({ id, side }) => {
    const box = document.querySelector(`.react-flow__node[data-id="${id}"]`).getBoundingClientRect()
    const x = side === 'left' ? box.left : box.right
    const y = box.top + box.height / 2
    return Array.from(document.querySelectorAll('.react-flow__edge .react-flow__edge-path')).filter((edge) => {
      const matrix = edge.getScreenCTM()
      return [0, edge.getTotalLength()].some((length) => {
        const end = edge.getPointAtLength(length)
        const p = new DOMPoint(end.x, end.y).matrixTransform(matrix)
        return Math.hypot(p.x - x, p.y - y) < 3
      })
    }).length
  }, { id, side })
}
async function snap(name) { await screenshotSettled(win, { path: path.join(evidence, `${phase}-${name}.png`) }) }
async function task(name, run) {
  try { await run(); results.push({ name, pass: true }) }
  catch (error) { results.push({ name, pass: false, error: String(error) }); await win.screenshot({ path: path.join(evidence, `${phase}-${name}-failure.png`) }); await win.mouse.up(); await win.keyboard.press('Escape') }
  console.log(JSON.stringify(results.at(-1)))
}

try {
  await app.context().addInitScript(() => {
    localStorage.setItem('__nomiE2E', '1')
    localStorage.setItem('nomi:splash:v1', 'seen')
    localStorage.setItem('nomi:journey-tour:v1', 'seen')
  })
  await win.reload() // library only, before opening a project
  await win.locator('[data-project-card]', { hasText: fixture.record.name }).click()
  await expect.poll(() => app.windows().some((page) => /projectId=/.test(page.url()))).toBe(true)
  win = app.windows().find((page) => /projectId=/.test(page.url()))
  const bw = await app.browserWindow(win)
  await bw.evaluate((window) => {
    window.setBounds({ x: 0, y: 0, width: 1800, height: 1100 })
    // Ignore unrelated physical cursor motion on this shared desktop; CDP still drives real input.
    window.setIgnoreMouseEvents(true)
  })
  await win.locator('.generation-canvas-v2__stage').waitFor()
  await expect(win.locator('.react-flow__node')).toHaveCount(3)

  // 先证明「带子看得见」，之后的缺席断言才有意义（expectAbsent 需要阳性对照）。
  await select(images[0].id)
  const bandProof = await proveProbe(magneticBands(images[0].id).first(), '选中卡片的磁吸带子可观测')

  await task('01-unselected-dots', async () => {
    await blank()
    await expectAbsent(win.locator('.react-flow__node.selected'), { provenBy: bandProof, message: '点空白后没有选中的卡片' })
    // 逐对列出「卡片 × 侧别」：目标图片的右外侧在 1280 宽的窗口里已经出了舞台
    // （outsidePoint 会 fail-closed 报错），所以只走舞台内真的能 hover 到的那些侧。
    const probes = [
      [images[0].id, 'left'], [images[0].id, 'right'],
      [images[1].id, 'left'], [images[1].id, 'right'],
      [images[2].id, 'left'],
    ]
    for (const id of [images[0].id, images[1].id, images[2].id]) {
      await expectAbsent(magneticBands(id), { provenBy: bandProof, message: `未选中的卡片没有磁吸带子：${id}` })
    }
    for (const [id, side] of probes) {
      const source = handle(id, 'source', side)
      await expect(source, '未选中时是圆点把手').toHaveAttribute('data-affordance', 'dot')
      const box = await source.boundingBox()
      expect(Math.round(box.width), '圆点把手 28px 宽').toBe(28)
      expect(Math.round(box.height), '圆点把手 28px 高').toBe(28)
      // 迁移前 left-[-14px]/right-[-14px]：把手正中压在卡片那条边上。
      const card = await win.locator(selector(id)).boundingBox()
      const edgeX = side === 'left' ? card.x : card.x + card.width
      expect(Math.abs(box.x + box.width / 2 - edgeX), '圆点中心贴在卡片边上').toBeLessThan(2)
      // 关键回归判据：卡片外侧 56px 处没有任何把手捕获指针，那儿还是画布。
      const outside = await outsidePoint(id, side)
      const owner = await ownerAt(outside)
      expect(owner.inHandle, `未选中卡片外侧不该有带子：${id}/${side} → ${owner.className}`).toBe(false)
      expect(owner.pane, `未选中卡片外侧仍是画布：${id}/${side} → ${owner.className}`).toBe(true)
    }
    await snap('01-unselected-dots')
  })

  await task('02-selected-band-follows', async () => {
    await select(images[0].id)
    await expect(magneticBands(images[0].id), '选中的图片卡左右各一条带子').toHaveCount(2)
    for (const side of ['left', 'right']) {
      const hit = handle(images[0].id, 'source', side).locator('.generation-canvas-react-flow__handle-hit')
      const box = await hit.boundingBox()
      expect(Math.round(box.width), '带子 112px 宽').toBe(112)
      expect(Math.round(box.height), '带子 168px 高（min(168, 卡高+28)）').toBe(168)
    }
    // 加号跟着指针走：在带内取一个**不是静止位**的点，图标中心要追上来。
    const card = await win.locator(selector(images[0].id)).boundingBox()
    const follow = { x: card.x + card.width + 78, y: card.y + card.height / 2 - 46 }
    await win.mouse.move(follow.x - 30, follow.y + 20)
    await win.mouse.move(follow.x, follow.y, { steps: 8 })
    const hit = handle(images[0].id, 'source', 'right').locator('.generation-canvas-react-flow__handle-hit')
    await expect(hit, '指针在带内时图标进入跟随态').toHaveAttribute('data-following', 'true')
    const icon = handle(images[0].id, 'source', 'right').locator('.generation-canvas-react-flow__handle-icon')
    await expect(icon).toHaveCSS('opacity', '1')
    await expect(icon).toHaveCSS('width', '29px')
    await expect(icon).toHaveCSS('height', '29px')
    await expect(icon.locator('svg')).toHaveCount(1)
    await expect.poll(async () => {
      const center = await iconCenter(images[0].id, 'right')
      return Math.hypot(center.x - follow.x, center.y - follow.y)
    }, { message: '加号中心追到指针' }).toBeLessThan(2)
    await snap('02-selected-band-follows')
    // 指针移回卡片正文：仍在卡上 hover，所以加号还露着（0.82），但回到静止位——距卡片边 28px。
    await win.mouse.move(card.x + card.width / 2, card.y + card.height / 2)
    await expect(hit).not.toHaveAttribute('data-following', 'true')
    await expect(icon, '只 hover 卡片时加号半露').toHaveCSS('opacity', '0.82')
    await expect.poll(async () => {
      const center = await iconCenter(images[0].id, 'right')
      return Math.abs(center.x - (card.x + card.width) - 28)
    }, { message: '加号收回静止位（离边 28px）' }).toBeLessThan(2)
  })

  await task('03-drag-snaps-to-target', async () => {
    await select(images[0].id)
    const from = await outsidePoint(images[0].id, 'right', 56)
    // 24px：既在目标外侧热区里，又在源卡自己那条 112px 带子之外（482 < 496），
    // 而且超过 React Flow 默认 connectionRadius=20——吸住它的只能是外侧热区。
    const to = await outsidePoint(images[2].id, 'left', 24)
    await win.mouse.move(from.x, from.y)
    await win.mouse.down()
    await win.mouse.move(to.x, to.y, { steps: 24 })
    const target = handle(images[2].id, 'target', 'left')
    const box = await win.locator(selector(images[2].id)).boundingBox()
    const anchor = { x: box.x, y: box.y + box.height / 2 }
    const distance = async (point) => { const p = await endpoint(); return Math.hypot(p.x - point.x, p.y - point.y) }
    // `data-snapped` 是唯一意思为「端点此刻是我的」的属性；`data-active` 整段拖拽对每个候选都为真。
    await expect(target, '进入目标外侧热区后端点归它').toHaveAttribute('data-snapped', 'true')
    await expect.poll(() => distance(anchor), { message: '端点吸到该侧卡片边' }).toBeLessThan(3)
    await snap('03-drag-snaps-to-target')
    // 离开热区就放开，回来再吸——反向那句必须真的能清掉。
    const outside = { x: to.x, y: to.y - 140 }
    await win.mouse.move(outside.x, outside.y, { steps: 8 })
    await expect(target, '离开热区后端点还给指针').not.toHaveAttribute('data-snapped', 'true')
    await expect.poll(() => distance(outside)).toBeLessThan(3)
    await win.mouse.move(to.x, to.y, { steps: 8 })
    await expect(target).toHaveAttribute('data-snapped', 'true')
    const before = await win.locator('.react-flow__edge').count()
    await win.mouse.up()
    await expect(win.locator('.react-flow__edge')).toHaveCount(before + 1)
    await expect.poll(() => edgesTouchingSide(images[2].id, 'left')).toBe(1)
  })

  await task('04-close-edge-stays-clickable', async () => {
    await blank()
    const left = await win.locator(selector(images[0].id)).boundingBox()
    const right = await win.locator(selector(images[2].id)).boundingBox()
    const gap = right.x - (left.x + left.width)
    // 被否掉的常驻带子版在这个间距下整条线 99 个采样点没有一个可达（两侧带子各 112px 把它盖满）。
    expect(gap, `两卡间距（屏幕像素）：${Math.round(gap)}`).toBeGreaterThan(0)
    expect(gap, `两卡间距（屏幕像素）：${Math.round(gap)}`).toBeLessThan(224)
    const point = await findEdgeHitPoint(win)
    expect(point, '连线上存在真的点得到的点').not.toBeNull()
    await win.mouse.click(point.x, point.y)
    await expect(win.locator('.generation-canvas-react-flow__edge-label').first(), '点连线打开连线模式药丸').toBeVisible()
    await snap('04-close-edge-stays-clickable')
  })
} finally {
  fs.writeFileSync(path.join(evidence, `${phase}-results.json`), JSON.stringify(results, null, 2))
  await app.close()
}
if (results.length !== 4 || results.some((result) => !result.pass)) process.exitCode = 1
