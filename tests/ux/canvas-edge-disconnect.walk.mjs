import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 真实 Electron：连线中点的「模式胶囊 + 模式菜单」已删（用户 10-08：「删掉连线中间的标签吗，没有作用」「连线之间的标签似乎没用」）。
// 断言：点线 = 选中并高亮、不弹菜单；悬停 / 选中出一个只有图标的「×」，点了真断开；选中边按 Delete 断开、节点不受影响。
// 用法：node tests/ux/canvas-edge-disconnect.walk.mjs [--locale en] [--scheme dark]
// 截图：docs/evidence/2026-10-08-canvas-handles/edge-<序号>-<状态>-<zh|en>[-dark].png
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, expectAbsent, proveProbe, screenshotSettled, waitForVisualQuiescence } from './_assert.mjs'
import { findCanvasBlankPoint, findEdgeHitPoint, findNodeHitPoint, waitForCanvasViewportSettled } from './_canvasHit.mjs'
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

const temp = makeTempDir('nomi-edge-disconnect-')
const projectsDir = path.join(temp, 'projects')
const projectId = 'edge-disconnect'
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
  { id: 'h-gen', kind: 'image', title: T.gen, position: { x: 220, y: 60 }, size: { width: 300, height: 169 }, status: 'success', result: media('h-gen', 'street.png'), history: [media('h-gen', 'street.png')], meta: { imageWidth: 640, imageHeight: 360, previewHeight: 169 } },
  { id: 'h-asset', kind: 'asset', title: T.asset, position: { x: 220, y: 330 }, size: { width: 300, height: 169 }, status: 'success', result: media('h-asset', 'portrait.png'), history: [media('h-asset', 'portrait.png')], meta: { imageWidth: 640, imageHeight: 360, previewHeight: 169, source: 'asset-upload' } },
  { id: 'h-video', kind: 'video', title: T.video, position: { x: 700, y: 190 }, size: { width: 340, height: 191 }, status: 'idle', meta: {} },
].map((node) => ({ categoryId: 'shots', prompt: '', ...node }))
const edges = [
  { id: 'e-gen', source: 'h-gen', target: 'h-video', mode: 'reference' },
  { id: 'e-asset', source: 'h-asset', target: 'h-video', mode: 'reference' },
]
const payload = { workbenchDocument: null, timeline: null, generationCanvas: { nodes, edges, groups: [], selectedNodeIds: [] }, storyboardPlan: null, storyboardPlanCommitted: false }
const project = { id: projectId, name: 'Edge disconnect', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projectRoot, ...payload, payload }
for (const name of ['project.json', '.nomi/project.json']) fs.writeFileSync(path.join(projectRoot, name), JSON.stringify(project))

const results = []
const run = await launchNomiApp({
  name: 'canvas-edge-disconnect', projectsDir, settleMs: 0, mainRequire: [offscreen],
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

const edgeHit = (id) => win.locator(`.generation-canvas-v2__edge[data-edge-id="${id}"] .generation-canvas-v2__edge-hit`)
const xButton = () => win.locator('.generation-canvas-v2__edge-control button[data-edge-disconnect]')
async function edgePoint(id) {
  let point = null
  await expect.poll(async () => {
    point = await findEdgeHitPoint(win, { edgeSelector: `.generation-canvas-v2__edge[data-edge-id="${id}"] .generation-canvas-v2__edge-hit`, withinSelector: '.generation-canvas-v2__stage', margins: { left: 140, top: 100, right: 20, bottom: 20 } })
    return point !== null
  }, { message: `${id} has a clickable point` }).toBe(true)
  return point
}
async function blankClick() {
  const blank = await findCanvasBlankPoint(win)
  expect(blank, 'canvas has a blank point').not.toBeNull()
  await win.mouse.click(blank.x, blank.y)
  await waitForVisualQuiescence(win)
}

try {
  await win.locator('[data-project-card]', { hasText: project.name }).first().click()
  await expect.poll(() => app.windows().some((page) => /projectId=/.test(page.url())), { timeout: stationTimeout({ operations: 4 }) }).toBe(true)
  win = app.windows().find((page) => /projectId=/.test(page.url()))
  win.setDefaultTimeout(stationTimeout({ operations: 2 }))
  await win.locator('.generation-canvas-v2__stage').waitFor()
  await expect(win.locator('.react-flow__node')).toHaveCount(nodes.length)
  await waitForCanvasViewportSettled(win)
  await win.getByRole('button', { name: uiText(zh ? 'zh-CN' : 'en', 'generationCommon.navigation.resetView'), exact: true }).first().click()
  await waitForCanvasViewportSettled(win)
  await waitForVisualQuiescence(win)

  await task('01-click-line-selects-no-pill-no-menu', async () => {
    const point = await edgePoint('e-gen')
    await win.mouse.click(point.x, point.y)
    await waitForVisualQuiescence(win)
    await expect(win.locator('.generation-canvas-v2__edge[data-edge-id="e-gen"]')).toHaveAttribute('data-active', 'true')
    const xProof = await proveProbe(xButton(), '选中一条线后中点出「×」', 3_000)
    await expect(win.locator('.generation-canvas-v2__edge-tag-pill')).toHaveCount(0)
    await expect(win.locator('.generation-canvas-react-flow__edge-menu')).toHaveCount(0)
    await expect(xButton()).toHaveCount(1)
    expect(await xButton().textContent(), '「×」只有图标、没有文字').toBe('')
    expect(await xButton().getAttribute('aria-label')).toContain(uiText(zh ? 'zh-CN' : 'en', 'generationCommon.canvas.edge.disconnect').split('{{')[0])
    void xProof
    // Claude Design 拍板稿 Edges：选中 / 悬停这一条线 = 深灰（ink-60）略粗，不是强调色（强调色只给「选中节点的连线」）。
    const stroke = await win.evaluate(() => {
      const path = document.querySelector('.generation-canvas-v2__edge[data-edge-id="e-gen"] .generation-canvas-v2__edge-path')
      const probe = document.createElement('span')
      probe.style.color = 'var(--nomi-ink-60)'
      document.body.appendChild(probe)
      const ink60 = getComputedStyle(probe).color
      probe.remove()
      const style = path ? getComputedStyle(path) : null
      return { stroke: style?.stroke, ink60, width: style?.strokeWidth, opacity: style?.strokeOpacity }
    })
    expect(stroke.stroke, JSON.stringify(stroke)).toBe(stroke.ink60)
    await shot('edge-03-selected-x')
  })

  await task('02-selected-node-lines-and-hover-x', async () => {
    await blankClick()
    await select('h-video')
    await shot('edge-01-node-selected-lines')
    await blankClick()
    const point = await edgePoint('e-asset')
    await win.mouse.move(point.x, point.y)
    await expect(xButton()).toHaveCount(1)
    await shot('edge-02-hover-x')
  })

  await task('03-click-x-disconnects-and-undo-restores', async () => {
    await blankClick()
    const point = await edgePoint('e-gen')
    await win.mouse.move(point.x, point.y)
    await expect(xButton()).toHaveCount(1)
    await xButton().click()
    await expect.poll(async () => (await store()).edges.map((e) => e.source)).toEqual(['h-asset'])
    await undo()
    await expect.poll(async () => (await store()).edges.length).toBe(2)
  })

  await task('04-delete-key-on-selected-edge-keeps-nodes', async () => {
    await select('h-gen') // 先选着一个节点：点线要把节点选择换成这条线，Delete 才归线
    const point = await edgePoint('e-asset')
    await win.mouse.click(point.x, point.y)
    await waitForVisualQuiescence(win)
    await win.keyboard.press('Delete')
    await waitForVisualQuiescence(win)
    const after = await store()
    expect(after.edges.map((e) => e.source), 'Delete 断开了选中的那条线').toEqual(['h-gen'])
    expect(after.nodes.map((n) => n.id).sort(), 'Delete 没有删节点').toEqual(['h-asset', 'h-gen', 'h-video'])
    await undo()
    await expect.poll(async () => (await store()).edges.length).toBe(2)
  })
} finally {
  await run.close().catch(() => {})
}

const failed = results.filter((result) => !result.pass)
console.log(`\nWALK canvas-edge-disconnect [${tag}] ${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  for (const failure of failed) console.error(`  ✗ ${failure.name} — ${failure.error}`)
  process.exit(1)
}
