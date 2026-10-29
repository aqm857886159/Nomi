import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 真实 Electron：派生节点落点不压邻居（2026-10-18 走查：视频浮条「拆解 ▾ → 镜头表」建出的表压在旁边的图片上）。零花费：只建表，不点「拆解」。
// 走生产构建（先 `pnpm run build`），隔离资料目录，窗口在屏幕外不抢焦点。
//
// 夹具：一个视频节点，右边挨着一排竖版图片（9:16，渲染出来比名义高一大截）——派生节点要找新位置时，
// 名义尺寸看着是空的那一格，实际被竖图盖住。
//
// 断言（用户看得见的事实）：新建出来的派生节点，在屏幕上量到的矩形不与任何别的节点的矩形相交（DOM 实测，不是 store 里的名义尺寸）。
// 用法：node tests/ux/derived-node-placement.walk.mjs [--locale en] [--scheme dark]
// 截图：docs/evidence/2026-10-19-derived-node-placement/derived-node-<zh|en>[-dark].png
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expect, screenshotSettled, waitForVisualQuiescence } from './_assert.mjs'
import { waitForCanvasViewportSettled } from './_canvasHit.mjs'
import { canvasFitView } from './_shell.mjs'
import { stationTimeout } from './_station-budget.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const argValue = (flag, fallback) => { const index = process.argv.indexOf(flag); return index > 0 ? process.argv[index + 1] : fallback }
const locale = argValue('--locale', 'zh-CN')
const scheme = argValue('--scheme', 'light')
const tag = `${locale === 'en' ? 'en' : 'zh'}${scheme === 'dark' ? '-dark' : ''}`
const evidence = path.join(repoRoot, 'docs/evidence/2026-10-19-derived-node-placement')
fs.mkdirSync(evidence, { recursive: true })

const temp = makeTempDir('nomi-derived-placement-')
const projectsDir = path.join(temp, 'projects')
const projectId = 'derived-placement'
const projectRoot = path.join(projectsDir, projectId)
const assetDir = path.join(projectRoot, 'assets', 'imported')
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(assetDir, { recursive: true })
fs.copyFileSync(path.join(repoRoot, 'tests/ux/fixtures/hires-detail-1024x1792.png'), path.join(assetDir, 'portrait.png'))
fs.copyFileSync(path.join(repoRoot, 'tests/ux/fixtures/fixture-video.mp4'), path.join(assetDir, 'clip.mp4'))
const assetUrl = (name) => `nomi-local://asset/${projectId}/assets/imported/${name}`

const portrait = (id, x) => ({
  id, kind: 'image', categoryId: 'shots', prompt: '', title: id, position: { x, y: 160 }, size: { width: 320, height: 180 }, status: 'success',
  result: { id: `${id}-r`, type: 'image', url: assetUrl('portrait.png'), createdAt: 1 },
  meta: { imageWidth: 1024, imageHeight: 1792, imageAspectRatio: 1024 / 1792 },
})
const nodes = [
  { id: 'src-video', kind: 'video', categoryId: 'shots', prompt: '', title: 'src-video', position: { x: 120, y: 160 }, size: { width: 320, height: 180 }, status: 'success',
    result: { id: 'src-video-r', type: 'video', url: assetUrl('clip.mp4'), createdAt: 1, durationSeconds: 2 }, meta: { videoWidth: 640, videoHeight: 360, videoAspectRatio: 16 / 9 } },
  // 视频右侧一排竖图：表默认落点（视频右边 + 80）正压在第一张上。
  portrait('tall-1', 520), portrait('tall-2', 920), portrait('tall-3', 1320), portrait('tall-4', 1720),
]
const payload = { workbenchDocument: null, timeline: null, generationCanvas: { nodes, edges: [], groups: [], selectedNodeIds: [] }, storyboardPlan: null, storyboardPlanCommitted: false }
const project = { id: projectId, name: 'Derived placement', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projectRoot, ...payload, payload }
for (const name of ['project.json', '.nomi/project.json']) fs.writeFileSync(path.join(projectRoot, name), JSON.stringify(project))

const results = []
const run = await launchNomiApp({
  name: 'derived-node-placement', projectsDir, settleMs: 0, viewportSize: { width: 1680, height: 1050 },
  initialLocalStorage: { 'nomi:locale:v1': locale, 'nomi-color-scheme': scheme, 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', __nomiE2E: '1' },
})
const { app } = run
let win = run.win
win.setDefaultTimeout(stationTimeout({ operations: 2 }))
async function task(name, body) {
  try { await body(); results.push({ name, pass: true }) } catch (error) {
    results.push({ name, pass: false, error: String(error?.message ?? error).split('\n').filter(Boolean).slice(0, 8).join(' | ') })
    await win.screenshot({ path: path.join(repoRoot, '.tmp', `FAIL-derived-placement-${name}-${tag}.png`) }).catch(() => {})
  }
  console.log(JSON.stringify(results.at(-1)))
}

/** 屏幕上每张节点卡实测的矩形（DOM，不是 store 名义尺寸）。 */
const measureCards = () => win.evaluate(() => [...document.querySelectorAll('.generation-canvas-v2-node[data-node-id]')].map((el) => {
  const rect = (el.querySelector('article') ?? el).getBoundingClientRect()
  return { id: el.getAttribute('data-node-id'), x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}))
const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

try {
  await win.locator('[data-project-card]', { hasText: project.name }).first().click()
  await expect.poll(() => app.windows().some((page) => /projectId=/.test(page.url())), { timeout: stationTimeout({ operations: 4 }) }).toBe(true)
  win = app.windows().find((page) => /projectId=/.test(page.url()))
  win.setDefaultTimeout(stationTimeout({ operations: 2 }))
  await win.locator('.generation-canvas-v2__stage').waitFor()
  await waitForCanvasViewportSettled(win)
  await canvasFitView(win, 'fit view before picking the video')
  await waitForCanvasViewportSettled(win)
  await waitForVisualQuiescence(win)

  let tableId = ''
  await task('01-build-table-from-video-toolbar', async () => {
    await clickOrFail(win.locator('article[data-node-id="src-video"], [data-node-id="src-video"] article').first(), 'select the source video', { position: { x: 40, y: 20 } })
    await clickOrFail(win.locator('button[data-toolbar-action-menu="break-down"]').first(), 'open break-down menu')
    await clickOrFail(win.locator('[data-menu-item="shot-table"]').first(), 'pick shot table')
    tableId = await win.waitForFunction(() => {
      const state = window.__nomiCanvasStore?.getState()
      return state?.nodes.find((node) => node.kind === 'shot_table')?.id ?? null
    }, undefined, { timeout: stationTimeout() }).then((handle) => handle.jsonValue())
    expect(tableId).toBeTruthy()
  })
  await task('02-derived-table-overlaps-no-neighbour', async () => {
    // 新表可能落在屏外：画布约定不自动挪视口，边缘出「新节点在…」提示，点它才框进来。
    const arrival = win.locator('[data-canvas-arrival-hint]')
    if (await arrival.count()) await clickOrFail(arrival.first(), 'go to the new table')
    await waitForCanvasViewportSettled(win)
    await canvasFitView(win, 'fit everything so every card is measurable')
    await waitForCanvasViewportSettled(win)
    await waitForVisualQuiescence(win)
    const cards = await measureCards()
    const table = cards.find((card) => card.id === tableId)
    if (!table) throw new Error(`新表没渲染出来：${JSON.stringify(cards.map((card) => card.id))}`)
    const hits = cards.filter((card) => card.id !== tableId && intersects(table, card))
    if (hits.length) throw new Error(`新表压到了 ${hits.map((card) => card.id).join(', ')}；表 ${JSON.stringify(table)}；被压 ${JSON.stringify(hits)}`)
    await screenshotSettled(win, { path: path.join(evidence, `derived-node-${tag}.png`) })
  })
} finally {
  await app.close().catch(() => {})
}
const failed = results.filter((result) => !result.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed (${tag})`)
process.exit(failed.length ? 1 : 0)
