// 真实 Electron：画布左右拉环 / 拉环菜单 / 空节点「试试」/ 在画布上点选（2026-10-08 用户拍板，设计卡
// docs/plan/2026-10-08-canvas-handles.md）。走生产构建（先 `pnpm run build`），隔离资料目录，窗口在屏幕外不抢焦点，
// 零花费：全程不点生成，配方只搭结构。
//
// 断言（每条都是用户看得见、点得到的事实）：
//   · 选中生成类图片卡 → 两侧都有「+」；选中上传素材卡 → 只有右「+」（拍板 ①）；
//   · 点一下「+」（不拖）就出菜单（bug ①）：右「用这个节点生成」、左「给它加输入」；
//   · 视频卡左「+」的「图片」可选，选了 = 新图片节点落成**上游**、连进视频（bug ②）；
//   · 空图片 / 视频 / 文本卡显示「试试」，剪辑空态有「在画布上点选」；点「首帧生视频」只搭结构、一步撤销；
//   · 「在画布上点选」：顶栏出现、可点的卡描边、本卡变灰；点中一张 = 连上；Esc = 什么都不建；
//   · 空画布 = 一排任务卡（与左缘工具条常驻同源）。
// 用法：node tests/ux/canvas-handle-menus.walk.mjs [--locale en] [--scheme dark]
// 截图：docs/evidence/2026-10-08-canvas-handles/<序号>-<状态>-<zh|en>[-dark].png
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, screenshotSettled, waitForVisualQuiescence } from './_assert.mjs'
import { findNodeHitPoint } from './_canvasHit.mjs'
import { stationTimeout } from './_station-budget.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const argValue = (flag, fallback) => { const index = process.argv.indexOf(flag); return index > 0 ? process.argv[index + 1] : fallback }
const locale = argValue('--locale', 'zh-CN')
const scheme = argValue('--scheme', 'light')
const tag = `${locale === 'en' ? 'en' : 'zh'}${scheme === 'dark' ? '-dark' : ''}`
const zh = locale !== 'en'
const evidence = path.join(repoRoot, 'docs/evidence/2026-10-08-canvas-handles')
const offscreen = path.join(repoRoot, 'tests/ux/full-walk/offscreenWindow.cjs')

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-handle-menus-'))
const projectsDir = path.join(temp, 'projects')
const projectId = 'handle-menus'
const projectRoot = path.join(projectsDir, projectId)
const assetsDir = path.join(projectRoot, 'assets/generated')
fs.mkdirSync(assetsDir, { recursive: true })
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(evidence, { recursive: true })
execFileSync(ffmpeg.path, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360', '-frames:v', '1', path.join(assetsDir, 'street.png')], { stdio: 'pipe' })
execFileSync(ffmpeg.path, ['-y', '-f', 'lavfi', '-i', 'smptebars=size=640x360', '-frames:v', '1', path.join(assetsDir, 'portrait.png')], { stdio: 'pipe' })
const url = (file) => `nomi-local://asset/${projectId}/assets/generated/${file}`
const media = (id, file) => ({ id: `${id}-result`, type: 'image', url: url(file), createdAt: 1 })

const T = zh
  ? { gen: '镜头 1 · 雨夜街口', asset: '主角定妆照', video: '镜头 3', image: '镜头 2' }
  : { gen: 'Shot 1 · Rainy street', asset: 'Lead portrait', video: 'Shot 3', image: 'Shot 2' }
const nodes = [
  { id: 'h-gen', kind: 'image', title: T.gen, position: { x: 80, y: 60 }, size: { width: 300, height: 169 }, status: 'success', result: media('h-gen', 'street.png'), history: [media('h-gen', 'street.png')], meta: { imageWidth: 640, imageHeight: 360, previewHeight: 169 } },
  { id: 'h-asset', kind: 'asset', title: T.asset, position: { x: 560, y: 60 }, size: { width: 300, height: 169 }, status: 'success', result: media('h-asset', 'portrait.png'), history: [media('h-asset', 'portrait.png')], meta: { imageWidth: 640, imageHeight: 360, previewHeight: 169, source: 'asset-upload' } },
  { id: 'h-video', kind: 'video', title: T.video, position: { x: 80, y: 420 }, size: { width: 340, height: 191 }, status: 'idle', meta: {} },
  { id: 'h-image', kind: 'image', title: T.image, position: { x: 560, y: 420 }, size: { width: 340, height: 191 }, status: 'idle', meta: {} },
  { id: 'h-text', kind: 'text', title: '', position: { x: 1040, y: 60 }, size: { width: 280, height: 200 }, status: 'idle', meta: {} },
  { id: 'h-clip', kind: 'clip', title: '', position: { x: 80, y: 760 }, size: { width: 560, height: 132 }, status: 'idle', meta: {} },
].map((node) => ({ categoryId: 'shots', prompt: '', ...node }))
const payload = { workbenchDocument: null, timeline: null, generationCanvas: { nodes, edges: [], groups: [], selectedNodeIds: [] }, storyboardPlan: null, storyboardPlanCommitted: false }
const project = { id: projectId, name: 'Handle menus', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projectRoot, ...payload, payload }
for (const name of ['project.json', '.nomi/project.json']) fs.writeFileSync(path.join(projectRoot, name), JSON.stringify(project))

const results = []
const run = await launchNomiApp({
  name: 'canvas-handle-menus', projectsDir, settleMs: 0, mainRequire: [offscreen],
  viewportSize: { width: 1680, height: 1050 },
  initialLocalStorage: { 'nomi:locale:v1': locale, 'nomi-color-scheme': scheme, 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', __nomiE2E: '1' },
})
const { app } = run
let win = run.win
win.setDefaultTimeout(stationTimeout({ operations: 2 }))

const nodeSel = (id) => `.react-flow__node[data-id="${id}"]`
const sourceHandle = (id, side) => win.locator(`${nodeSel(id)} .react-flow__handle[data-handleid="source-${side}"]`)
const store = () => win.evaluate(() => {
  const state = /** @type {any} */ (window).__nomiCanvasStore.getState()
  return { nodes: state.nodes.map((node) => ({ id: node.id, kind: node.kind, x: node.position.x, modeId: node.meta?.archetype?.modeId ?? null })), edges: state.edges.map((edge) => ({ source: edge.source, target: edge.target, mode: edge.mode ?? 'reference' })), selected: state.selectedNodeIds }
})
async function shot(name, target = win) {
  await screenshotSettled(target, { path: path.join(evidence, `${name}-${tag}.png`) })
}
async function task(name, body) {
  try { await body(); results.push({ name, pass: true }) }
  catch (error) {
    results.push({ name, pass: false, error: String(error?.message ?? error).split('\n')[0] })
    await win.screenshot({ path: path.join(evidence, `FAIL-${name}-${tag}.png`) }).catch(() => {})
    await win.keyboard.press('Escape').catch(() => {})
  }
  console.log(JSON.stringify(results.at(-1)))
}
async function select(id) {
  await waitForVisualQuiescence(win)
  let point = null
  await expect.poll(async () => { point = await findNodeHitPoint(win, { nodeSelector: nodeSel(id) }); return point !== null }, { message: `${id} is hittable` }).toBe(true)
  await win.mouse.click(point.x, point.y)
  await expect(win.locator(nodeSel(id))).toHaveClass(/selected/)
  await waitForVisualQuiescence(win)
}
async function clickRing(id, side) {
  const icon = sourceHandle(id, side).locator('.generation-canvas-react-flow__handle-icon')
  const box = await icon.boundingBox()
  expect(box, `${id} ${side} ring is on screen`).not.toBeNull()
  // 纯点击：同一点按下、松开，不移动（xyflow 要移动超过 1px 才算起线）。
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await win.mouse.down()
  await win.mouse.up()
}
async function undo() {
  await win.keyboard.press('Control+z')
  await waitForVisualQuiescence(win)
}

try {
  await win.locator('[data-project-card]', { hasText: project.name }).first().click()
  await expect.poll(() => app.windows().some((page) => /projectId=/.test(page.url())), { timeout: 30_000 }).toBe(true)
  win = app.windows().find((page) => /projectId=/.test(page.url()))
  win.setDefaultTimeout(stationTimeout({ operations: 2 }))
  await win.locator('.generation-canvas-v2__stage').waitFor()
  await expect(win.locator('.react-flow__node')).toHaveCount(nodes.length)
  await waitForVisualQuiescence(win)

  await task('01-generated-card-both-rings', async () => {
    await select('h-gen')
    await expect(sourceHandle('h-gen', 'left')).toHaveAttribute('data-affordance', 'magnetic')
    await expect(sourceHandle('h-gen', 'right')).toHaveAttribute('data-affordance', 'magnetic')
    await shot('01-gen-selected')
  })

  await task('02-asset-right-ring-only', async () => {
    await select('h-asset')
    await expect(sourceHandle('h-asset', 'left')).toHaveAttribute('data-affordance', 'hidden')
    await expect(sourceHandle('h-asset', 'right')).toHaveAttribute('data-affordance', 'magnetic')
    await shot('02-asset-selected')
  })

  await task('03-click-right-ring-opens-derive-menu', async () => {
    await select('h-gen')
    const before = (await store()).nodes.length
    await clickRing('h-gen', 'right')
    await expect(win.getByTestId('node-derive-menu')).toBeVisible({ timeout: 3_000 })
    await shot('03-right-menu')
    await win.keyboard.press('Escape')
    await expect(win.getByTestId('node-derive-menu')).toHaveCount(0)
    expect((await store()).nodes.length, 'Esc closes without creating a node').toBe(before)
  })

  await task('04-left-ring-on-video-adds-image-upstream', async () => {
    await select('h-video')
    await clickRing('h-video', 'left')
    const menu = win.getByTestId('node-add-input-menu')
    await expect(menu).toBeVisible({ timeout: 3_000 })
    const imageItem = menu.getByRole('menuitem', { name: zh ? /^图片/ : /^Image/ })
    await expect(imageItem).not.toHaveAttribute('aria-disabled', 'true')
    await shot('04-left-menu')
    await imageItem.click()
    await expect.poll(async () => (await store()).edges.length).toBe(1)
    const after = await store()
    const created = after.nodes.find((node) => !nodes.some((seed) => seed.id === node.id))
    expect(created?.kind).toBe('image')
    expect(after.edges[0]).toMatchObject({ source: created.id, target: 'h-video' })
    expect(created.x, 'the new input lands on the left of the video card').toBeLessThan(80)
    await undo()
    await expect.poll(async () => (await store()).nodes.length).toBe(nodes.length)
    expect((await store()).edges).toHaveLength(0)
  })

  await task('05-empty-cards-show-try', async () => {
    await win.mouse.click(5, 5).catch(() => {})
    for (const [id, kind] of [['h-image', 'image'], ['h-video', 'video'], ['h-text', 'text'], ['h-clip', 'clip']]) {
      await expect(win.locator(`${nodeSel(id)} [data-node-try="${kind}"]`), `${id} shows 试试`).toBeVisible()
    }
    await shot('05-empty-image', win.locator(nodeSel('h-image')))
    await shot('06-empty-video', win.locator(nodeSel('h-video')))
    await shot('07-empty-text', win.locator(nodeSel('h-text')))
    await shot('08-empty-clip', win.locator(nodeSel('h-clip')))
    await shot('05-empty-cards-canvas')
  })

  await task('06-recipe-first-frame-builds-structure-one-undo', async () => {
    const item = win.locator(`${nodeSel('h-video')} [data-node-try-recipe="video.firstFrame"]`)
    await item.click()
    await expect.poll(async () => (await store()).edges.length).toBe(1)
    const after = await store()
    const created = after.nodes.find((node) => !nodes.some((seed) => seed.id === node.id))
    expect(created?.kind).toBe('image')
    expect(after.edges[0]).toMatchObject({ source: created.id, target: 'h-video', mode: 'first_frame' })
    await undo()
    await expect.poll(async () => (await store()).nodes.length).toBe(nodes.length)
    expect((await store()).edges).toHaveLength(0)
  })

  await task('07-pick-on-canvas', async () => {
    await select('h-video')
    await clickRing('h-video', 'left')
    await win.getByTestId('node-add-input-menu').getByRole('menuitem', { name: zh ? /在画布上点选/ : /Pick on canvas/ }).click()
    const bar = win.locator('[data-canvas-pick-bar]')
    await expect(bar).toBeVisible()
    await expect(win.locator(`${nodeSel('h-gen')} .generation-canvas-react-flow__node-shell`)).toHaveAttribute('data-pick', 'eligible')
    await expect(win.locator(`${nodeSel('h-video')} .generation-canvas-react-flow__node-shell`)).toHaveAttribute('data-pick', 'ineligible')
    await shot('09-pick-mode')
    await win.keyboard.press('Escape')
    await expect(bar).toHaveCount(0)
    expect((await store()).edges, 'Esc builds nothing').toHaveLength(0)

    await select('h-video')
    await clickRing('h-video', 'left')
    await win.getByTestId('node-add-input-menu').getByRole('menuitem', { name: zh ? /在画布上点选/ : /Pick on canvas/ }).click()
    await expect(bar).toBeVisible()
    const point = await findNodeHitPoint(win, { nodeSelector: nodeSel('h-gen') })
    await win.mouse.click(point.x, point.y)
    await expect(bar).toHaveCount(0)
    await expect.poll(async () => (await store()).edges).toEqual([expect.objectContaining({ source: 'h-gen', target: 'h-video' })])
    await undo()
    expect((await store()).edges).toHaveLength(0)
  })

  await task('08-empty-canvas-task-cards', async () => {
    await win.evaluate(() => /** @type {any} */ (window).__nomiCanvasStore.getState().selectNodes([]))
    await win.evaluate(() => {
      const state = /** @type {any} */ (window).__nomiCanvasStore.getState()
      state.selectNodes(state.nodes.map((node) => node.id))
      state.deleteSelectedNodes()
    })
    const cards = win.locator('[data-empty-canvas-tasks] [data-add-intent]')
    await expect(cards.first()).toBeVisible()
    expect(await cards.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-add-intent')))).toEqual(['image', 'video', 'audio', 'text', 'clip', 'import-file'])
    await shot('10-empty-canvas')
  })
} finally {
  await run.close().catch(() => {})
}

const failed = results.filter((result) => !result.pass)
console.log(`\nWALK canvas-handle-menus [${tag}] ${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  for (const failure of failed) console.error(`  ✗ ${failure.name} — ${failure.error}`)
  process.exit(1)
}
