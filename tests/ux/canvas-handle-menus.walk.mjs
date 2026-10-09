import { makeTempDir } from '../../scripts/_test-temp.mjs'
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
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, expectAbsent, proveProbe, screenshotSettled, waitForVisualQuiescence } from './_assert.mjs'
import { findNodeHitPoint, waitForCanvasViewportSettled } from './_canvasHit.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { uiText } from './full-walk/invariants.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const argValue = (flag, fallback) => { const index = process.argv.indexOf(flag); return index > 0 ? process.argv[index + 1] : fallback }
const locale = argValue('--locale', 'zh-CN')
const scheme = argValue('--scheme', 'light')
const tag = `${locale === 'en' ? 'en' : 'zh'}${scheme === 'dark' ? '-dark' : ''}`
const zh = locale !== 'en'
const evidence = path.join(repoRoot, 'docs/evidence/2026-10-08-canvas-handles')
const failShotDir = path.join(repoRoot, '.tmp/walk-fail')
const offscreen = path.join(repoRoot, 'tests/ux/full-walk/offscreenWindow.cjs')

const temp = makeTempDir('nomi-handle-menus-')
const projectsDir = path.join(temp, 'projects')
const projectId = 'handle-menus'
const projectRoot = path.join(projectsDir, projectId)
const assetsDir = path.join(projectRoot, 'assets/generated')
fs.mkdirSync(assetsDir, { recursive: true })
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(evidence, { recursive: true })
fs.mkdirSync(failShotDir, { recursive: true })
execFileSync(ffmpeg.path, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360', '-frames:v', '1', path.join(assetsDir, 'street.png')], { stdio: 'pipe' })
execFileSync(ffmpeg.path, ['-y', '-f', 'lavfi', '-i', 'smptebars=size=640x360', '-frames:v', '1', path.join(assetsDir, 'portrait.png')], { stdio: 'pipe' })
const url = (file) => `nomi-local://asset/${projectId}/assets/generated/${file}`
const media = (id, file) => ({ id: `${id}-result`, type: 'image', url: url(file), createdAt: 1 })

const T = zh
  ? { gen: '镜头 1 · 雨夜街口', asset: '主角定妆照', video: '镜头 3', image: '镜头 2' }
  : { gen: 'Shot 1 · Rainy street', asset: 'Lead portrait', video: 'Shot 3', image: 'Shot 2' }
const nodes = [
  // 画布 1:1（打开后点「重置视图」）时的布局：最左一列离左缘工具条留足一圈「+」的位置，最右一列不进右侧助手面板。
  { id: 'h-gen', kind: 'image', title: T.gen, position: { x: 220, y: 40 }, size: { width: 300, height: 169 }, status: 'success', result: media('h-gen', 'street.png'), history: [media('h-gen', 'street.png')], meta: { imageWidth: 640, imageHeight: 360, previewHeight: 169 } },
  { id: 'h-asset', kind: 'asset', title: T.asset, position: { x: 600, y: 40 }, size: { width: 300, height: 169 }, status: 'success', result: media('h-asset', 'portrait.png'), history: [media('h-asset', 'portrait.png')], meta: { imageWidth: 640, imageHeight: 360, previewHeight: 169, source: 'asset-upload' } },
  { id: 'h-video', kind: 'video', title: T.video, position: { x: 220, y: 330 }, size: { width: 340, height: 191 }, status: 'idle', meta: {} },
  { id: 'h-image', kind: 'image', title: T.image, position: { x: 640, y: 330 }, size: { width: 340, height: 191 }, status: 'idle', meta: {} },
  { id: 'h-text', kind: 'text', title: '', position: { x: 860, y: 560 }, size: { width: 240, height: 200 }, status: 'idle', meta: {} },
  { id: 'h-clip', kind: 'clip', title: '', position: { x: 220, y: 640 }, size: { width: 560, height: 132 }, status: 'idle', meta: {} },
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
    results.push({ name, pass: false, error: String(error?.message ?? error).split('\n').filter(Boolean).slice(0, 8).join(' | ') })
    // 失败截图写到不进库的 .tmp/，不落进 docs/evidence（证据目录只放拍板过的图）。
    await win.screenshot({ path: path.join(failShotDir, `FAIL-${name}-${tag}.png`) }).catch(() => {})
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
  // 配方 / 菜单跑完会把光标放进提示词框；那时 Ctrl+Z 归编辑器（撤字）。像人一样先把焦点从输入框拿走，再撤画布这一步。
  await win.evaluate(() => /** @type {HTMLElement | null} */ (document.activeElement)?.blur?.())
  await win.keyboard.press('Control+z')
  await waitForVisualQuiescence(win)
}

try {
  await win.locator('[data-project-card]', { hasText: project.name }).first().click()
  await expect.poll(() => app.windows().some((page) => /projectId=/.test(page.url())), { timeout: stationTimeout({ operations: 4 }) }).toBe(true)
  win = app.windows().find((page) => /projectId=/.test(page.url()))
  win.setDefaultTimeout(stationTimeout({ operations: 2 }))
  await win.locator('.generation-canvas-v2__stage').waitFor()
  await expect(win.locator('.react-flow__node')).toHaveCount(nodes.length)
  // 打开项目会一次性「摆全貌」（最左一列会贴到左缘工具条底下）；像人一样点「重置视图」回到 1:1。
  await waitForCanvasViewportSettled(win)
  await win.getByRole('button', { name: uiText(zh ? 'zh-CN' : 'en', 'generationCommon.navigation.resetView'), exact: true }).first().click()
  await waitForCanvasViewportSettled(win)
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
    const menuProof = await proveProbe(win.getByTestId('node-derive-menu'), '点一下右「+」出的菜单看得见', 3_000)
    await shot('03-right-menu')
    await win.keyboard.press('Escape')
    await expectAbsent(win.getByTestId('node-derive-menu'), { provenBy: menuProof, message: 'Esc 关掉菜单' })
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
    expect(created.x, 'the new input lands on the left of the video card').toBeLessThan(220)
    await undo()
    await expect.poll(async () => (await store()).nodes.length).toBe(nodes.length)
    expect((await store()).edges).toHaveLength(0)
  })

  // 2026-10-09 用户拍板：文本卡有左环（「这一侧能用才出现」）——收文字和图，不收视频；左「+」按本卡当目标判，新节点落在上游。
  await task('04b-text-card-left-ring-takes-image-and-text', async () => {
    await select('h-text')
    await expect(sourceHandle('h-text', 'left')).toHaveAttribute('data-affordance', 'magnetic')
    await expect(sourceHandle('h-text', 'right')).toHaveAttribute('data-affordance', 'magnetic')
    await clickRing('h-text', 'left')
    const menu = win.getByTestId('node-add-input-menu')
    await expect(menu).toBeVisible({ timeout: 3_000 })
    await expect(menu.getByRole('menuitem', { name: zh ? /^图片/ : /^Image/ })).not.toHaveAttribute('aria-disabled', 'true')
    await expect(menu.getByRole('menuitem', { name: zh ? /^文字|^文本/ : /^Text/ })).not.toHaveAttribute('aria-disabled', 'true')
    await expect(menu.getByRole('menuitem', { name: zh ? /^视频/ : /^Video/ })).toHaveAttribute('aria-disabled', 'true')
    await shot('04b-text-left-menu')
    const imageItem = menu.getByRole('menuitem', { name: zh ? /^图片/ : /^Image/ })
    await imageItem.click()
    await expect.poll(async () => (await store()).edges.length).toBe(1)
    const after = await store()
    const created = after.nodes.find((node) => !nodes.some((seed) => seed.id === node.id))
    expect(created?.kind).toBe('image')
    // 方向 = 新节点是上游（边从新节点指向文本卡），不是下游（bug ②）；落点由 store.addNode 统一避让，这排卡挤，不断言坐标。
    expect(after.edges[0]).toMatchObject({ source: created.id, target: 'h-text' })
    await undo()
    await expect.poll(async () => (await store()).nodes.length).toBe(nodes.length)
    expect((await store()).edges).toHaveLength(0)
  })

  // ═══ 素材选择器上传（真 Electron 真导入路径，V-1133c 补验）：上传成功 → 接线 → Ctrl+Z 一次，节点数和边数都回到初始 ═══
  await task('09-upload-success-connects-and-one-undo', async () => {
    await select('h-video')
    await clickRing('h-video', 'left')
    const menu = win.getByTestId('node-add-input-menu')
    await menu.getByRole('menuitem', { name: zh ? /从素材库/ : /Add from Assets/ }).click()
    const picker = win.getByTestId('asset-picker')
    await expect(picker).toBeVisible()
    await picker.locator('input[type="file"]').setInputFiles(path.join(repoRoot, 'tests/ux/fixtures/test-upload.png'))
    await expect.poll(async () => (await store()).edges.length).toBe(1)
    const after = await store()
    const created = after.nodes.find((node) => !nodes.some((seed) => seed.id === node.id))
    expect(created?.kind).toBe('asset')
    expect(after.edges[0]).toMatchObject({ source: created.id, target: 'h-video' })
    await shot('13-upload-success-connected')
    await win.evaluate(() => document.activeElement?.blur?.())
    await win.keyboard.press('Control+z')
    await expect.poll(async () => (await store()).nodes.length).toBe(nodes.length)
    expect((await store()).edges).toHaveLength(0)
  })

  await task('10-upload-picker-closed-keeps-card-unwired', async () => {
    await select('h-video')
    await clickRing('h-video', 'left')
    const menu = win.getByTestId('node-add-input-menu')
    await menu.getByRole('menuitem', { name: zh ? /从素材库/ : /Add from Assets/ }).click()
    const picker = win.getByTestId('asset-picker')
    await expect(picker).toBeVisible()
    const source = path.join(repoRoot, 'tests/ux/fixtures/test-upload.png')
    const slow = path.join(temp, 'slow-upload.png')
    if (!fs.existsSync(slow)) fs.writeFileSync(slow, Buffer.concat([fs.readFileSync(source), Buffer.alloc(8 * 1024 * 1024)]))
    await picker.locator('input[type="file"]').setInputFiles(slow)
    await win.keyboard.press('Escape')
    await expect.poll(async () => (await store()).nodes.length).toBe(nodes.length + 1)
    const after = await store()
    const created = after.nodes.find((node) => !nodes.some((seed) => seed.id === node.id))
    expect(created?.kind).toBe('asset')
    expect(after.edges).toHaveLength(0)
    await shot('14-upload-picker-closed-unwired')
    await win.evaluate(() => document.activeElement?.blur?.())
    await win.keyboard.press('Control+z')
    await expect.poll(async () => (await store()).nodes.length).toBe(nodes.length)
  })

  await task('05-empty-cards-show-try', async () => {
    await win.evaluate(() => /** @type {any} */ (window).__nomiCanvasStore.getState().selectNodes([]))
    await waitForVisualQuiescence(win)
    for (const [id, kind] of [['h-image', 'image'], ['h-video', 'video'], ['h-text', 'text'], ['h-clip', 'clip']]) {
      await expect(win.locator(`${nodeSel(id)} [data-node-try="${kind}"]`), `${id} shows 试试`).toBeVisible()
      // 「试试」那一行必须单行（中英文都是；文案按最小宽度写短，不靠 JS 动态藏点）：所有动作同一个 top，且不溢出自己的容器。
      const row = await win.locator(`${nodeSel(id)} [data-node-try="${kind}"]`).evaluate((el) => {
        const tops = new Set([...el.querySelectorAll('button')].map((button) => Math.round(button.getBoundingClientRect().top)))
        const frame = el.closest('[data-node-empty-state], .generation-canvas-v2-node')?.getBoundingClientRect()
        const rect = el.getBoundingClientRect()
        return { lines: tops.size, overflow: el.scrollWidth > el.clientWidth + 1, insideFrame: !frame || (rect.left >= frame.left - 1 && rect.right <= frame.right + 1) }
      })
      expect(row, `${id} 动作行单行、不溢出`).toEqual({ lines: 1, overflow: false, insideFrame: true })
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
    const barProof = await proveProbe(bar, '点选模式顶栏看得见')
    await expect(win.locator(`${nodeSel('h-gen')} .generation-canvas-react-flow__node-shell`)).toHaveAttribute('data-pick', 'eligible')
    await expect(win.locator(`${nodeSel('h-video')} .generation-canvas-react-flow__node-shell`)).toHaveAttribute('data-pick', 'ineligible')
    await shot('09-pick-mode')
    await win.keyboard.press('Escape')
    await expectAbsent(bar, { provenBy: barProof, message: 'Esc 退出点选' })
    expect((await store()).edges, 'Esc builds nothing').toHaveLength(0)

    await select('h-video')
    await clickRing('h-video', 'left')
    await win.getByTestId('node-add-input-menu').getByRole('menuitem', { name: zh ? /在画布上点选/ : /Pick on canvas/ }).click()
    await expect(bar).toBeVisible()
    const point = await findNodeHitPoint(win, { nodeSelector: nodeSel('h-gen') })
    await win.mouse.click(point.x, point.y)
    await expectAbsent(bar, { provenBy: barProof, message: '点中一张即退出点选' })
    await expect.poll(async () => (await store()).edges).toEqual([expect.objectContaining({ source: 'h-gen', target: 'h-video' })])
    await undo()
    expect((await store()).edges).toHaveLength(0)
  })

  // 「+」菜单（Claude Design 拍板稿 EmptyStates）：加节点条最后一颗「+」点开 = 「空间」一组；空画布起步行的「更多」是同一个菜单。
  const SPACE_KINDS = ['director', 'model3d', 'panorama', 'whiteboard']
  const spaceKinds = async (menu) => menu.locator('[data-node-kind]').evaluateAll((items) => items.map((item) => item.getAttribute('data-node-kind')))
  await task('07b-toolbar-plus-opens-space-menu', async () => {
    await win.evaluate(() => /** @type {any} */ (window).__nomiCanvasStore.getState().selectNodes([]))
    const plus = win.locator('.generation-canvas-v2-toolbar [data-canvas-add-more="true"]')
    await plus.click()
    const menu = win.locator('.generation-canvas-v2-toolbar__more-menu').first()
    await expect(menu).toBeVisible()
    expect(await spaceKinds(menu)).toEqual(SPACE_KINDS)
    await shot('11-plus-menu-toolbar')
    await win.keyboard.press('Escape')
    await expect(win.locator('.generation-canvas-v2-toolbar__more-menu')).toHaveCount(0)
    await plus.hover()
    await win.waitForTimeout(500)
    await expect(win.locator('.generation-canvas-v2-toolbar__more-menu'), '只悬停不开（点开才出菜单）').toHaveCount(0)
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
    const more = win.locator('[data-empty-canvas-tasks] [data-canvas-add-more="true"]')
    await more.click()
    const moreMenu = win.locator('.generation-canvas-v2-toolbar__more-menu').first()
    await expect(moreMenu).toBeVisible()
    expect(await spaceKinds(moreMenu), '空画布「更多」与加节点条「+」同一个菜单').toEqual(SPACE_KINDS)
    await shot('12-plus-menu-empty-canvas')
    await win.keyboard.press('Escape')
    await expect(win.locator('.generation-canvas-v2-toolbar__more-menu')).toHaveCount(0)
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
