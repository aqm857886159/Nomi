import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 真实 Electron：视频节点「截帧」（当前帧 / 首帧 / 尾帧）——2026-10-10 用户拍板「设计没问题」，设计卡 docs/plan/2026-10-09-video-node-next.md。
// 走生产构建（先 `pnpm run build`），隔离资料目录，窗口在屏幕外不抢焦点，零花费：全程本机 ffmpeg，不碰任何服务商。
//
// 素材是**每一帧都写着自己时间**的 12 秒视频（红通道 = 时间 × 20，绿通道 = 秒的小数部分 × 255），所以「截出来的是哪一帧」
// 可以从像素反推，不靠文件名、不靠 mock。
//
// 断言（每条都是用户看得见、点得到的事实）：
//   ① 播放头停在 7.2 秒 → 截帧菜单第一项「当前帧」旁边写着 0:07.2；
//   ② 点它 → 旁边多一张图片卡、连着线；那张图的像素 = 7.2 秒那一帧（不是首帧、不是 7.0）；原视频没动；
//   ③ 新卡带来源：meta.sourceVideoNodeId / sourceTime=7.2；
//   ④ 按一次 Ctrl+Z：卡和线一起没有；
//   ⑤ 本机失败（视频文件坏了）：新卡是错误卡，**没有「换个模型」**，只有「重试」；一次 Ctrl+Z 撤干净；
//   ⑥ 首帧 / 尾帧照旧（像素 ≈ 0 秒 / 最后一刻），同时证明 ② 的像素探针真的在区分时间。
// 用法：node tests/ux/video-frame-capture.walk.mjs [--locale en] [--scheme dark]
// 截图：docs/evidence/2026-10-10-video-frame-capture/<序号>-<状态>-<zh|en>[-dark].png
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, screenshotSettled, waitForVisualQuiescence } from './_assert.mjs'
import { findNodeHitPoint, waitForCanvasViewportSettled } from './_canvasHit.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { uiText } from './full-walk/invariants.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const argValue = (flag, fallback) => { const index = process.argv.indexOf(flag); return index > 0 ? process.argv[index + 1] : fallback }
const locale = argValue('--locale', 'zh-CN')
const scheme = argValue('--scheme', 'light')
const tag = `${locale === 'en' ? 'en' : 'zh'}${scheme === 'dark' ? '-dark' : ''}`
const zh = locale !== 'en'
const evidence = path.join(repoRoot, 'docs/evidence/2026-10-10-video-frame-capture')
const failShotDir = path.join(repoRoot, '.tmp/walk-fail')
const offscreen = path.join(repoRoot, 'tests/ux/full-walk/offscreenWindow.cjs')
const only = argValue('--shots', 'yes') !== 'no'

const temp = makeTempDir('nomi-video-frame-')
const projectsDir = path.join(temp, 'projects')
const projectId = 'video-frame-capture'
const projectRoot = path.join(projectsDir, projectId)
const importedDir = path.join(projectRoot, 'assets/imported')
fs.mkdirSync(importedDir, { recursive: true })
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(evidence, { recursive: true })
fs.mkdirSync(failShotDir, { recursive: true })

const DURATION = 12
// 每一帧写着自己的时间：R = 20·t（最大 240），G = 小数秒 · 255，B 固定。
execFileSync(ffmpeg.path, [
  '-y', '-f', 'lavfi', '-i', `color=c=black:size=640x360:rate=25:duration=${DURATION}`,
  '-vf', "format=gbrp,geq=r='min(255,T*20)':g='mod(T,1)*255':b=128,format=yuv420p",
  '-c:v', 'libx264', '-g', '25', path.join(importedDir, 'timed.mp4'),
], { stdio: 'pipe' })
// 第二份一模一样的视频：播放器加载完之后把它的源文件拿走——卡上还能播（浏览器已经缓存），但本机 ffmpeg 读不到了 = 一次真实的「本机处理失败」。
fs.copyFileSync(path.join(importedDir, 'timed.mp4'), path.join(importedDir, 'moved.mp4'))
const url = (file) => `nomi-local://asset/${projectId}/assets/imported/${file}`
const video = (id, file, title, x, y) => ({
  id, kind: 'video', categoryId: 'shots', prompt: '', title, position: { x, y }, size: { width: 340, height: 191 }, status: 'success',
  result: { id: `${id}-result`, type: 'video', url: url(file), createdAt: 1, durationSeconds: DURATION },
  meta: { videoWidth: 640, videoHeight: 360, videoAspectRatio: 16 / 9, videoDuration: DURATION },
})
const T = zh ? { src: '雨夜街口 · 长镜头', moved: '雨夜街口 · 备份' } : { src: 'Rainy street · Long take', moved: 'Rainy street · Backup' }
const nodes = [video('src-video', 'timed.mp4', T.src, 200, 150), video('moved-video', 'moved.mp4', T.moved, 200, 480)]
const payload = { workbenchDocument: null, timeline: null, generationCanvas: { nodes, edges: [], groups: [], selectedNodeIds: [] }, storyboardPlan: null, storyboardPlanCommitted: false }
const project = { id: projectId, name: 'Video frame capture', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projectRoot, ...payload, payload }
for (const name of ['project.json', '.nomi/project.json']) fs.writeFileSync(path.join(projectRoot, name), JSON.stringify(project))

const tr = (key) => uiText(locale, key)
const L = {
  capture: tr('generationCommon.videoToolbar.captureFrame'),
  current: tr('generationCommon.videoToolbar.currentFrame'),
  first: tr('generationCommon.videoToolbar.firstFrame'),
  last: tr('generationCommon.videoToolbar.lastFrame'),
  retry: tr('generationCommon.observability.action.retry.main'),
  // 失败卡的标题 = 失败文案第一行（人话），不是一句泛泛的「失败」。
  failedTitle: tr('generationCommon.node.extractFrame.failed').replace('{{frame}}', tr('generationCommon.node.extractFrame.current').replace('{{time}}', '0:07.2')),
  switchModel: [tr('generationCommon.observability.action.switchModel.main'), tr('generationCommon.observability.action.switchModel.alt')],
}

const results = []
const run = await launchNomiApp({
  name: 'video-frame-capture', projectsDir, settleMs: 0, mainRequire: [offscreen],
  viewportSize: { width: 1680, height: 1050 },
  initialLocalStorage: { 'nomi:locale:v1': locale, 'nomi-color-scheme': scheme, 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', __nomiE2E: '1' },
})
const { app } = run
let win = run.win
win.setDefaultTimeout(stationTimeout({ operations: 2 }))

const nodeSel = (id) => `.react-flow__node[data-id="${id}"]`
const snapshot = () => win.evaluate(() => {
  const state = /** @type {any} */ (window).__nomiCanvasStore.getState()
  return {
    nodes: state.nodes.map((node) => ({ id: node.id, kind: node.kind, status: node.status, title: node.title, error: node.error, resultUrl: node.result?.url ?? null, meta: node.meta ?? {} })),
    edges: state.edges.map((edge) => ({ source: edge.source, target: edge.target })),
  }
})
async function shot(name) {
  if (!only) return
  await screenshotSettled(win, { path: path.join(evidence, `${name}-${tag}.png`) })
}
async function task(name, body) {
  try { await body(); results.push({ name, pass: true }) } catch (error) {
    results.push({ name, pass: false, error: String(error?.message ?? error).split('\n').filter(Boolean).slice(0, 8).join(' | ') })
    await win.screenshot({ path: path.join(failShotDir, `FAIL-${name}-${tag}.png`) }).catch(() => {})
    await win.keyboard.press('Escape').catch(() => {})
  }
  console.log(JSON.stringify(results.at(-1)))
}
async function resetView() {
  // 落卡会把视口移向新卡（FOCUS 事件，老行为）；像人一样点「重置视图」回来再选下一张。
  await win.getByRole('button', { name: uiText(locale, 'generationCommon.navigation.resetView'), exact: true }).first().click()
  await waitForCanvasViewportSettled(win)
  await waitForVisualQuiescence(win)
}
async function select(id) {
  await resetView()
  let point = null
  await expect.poll(async () => { point = await findNodeHitPoint(win, { nodeSelector: nodeSel(id) }); return point !== null }, { message: `${id} is hittable` }).toBe(true)
  await win.mouse.click(point.x, point.y)
  await expect(win.locator(nodeSel(id))).toHaveClass(/selected/)
  await waitForVisualQuiescence(win)
}
async function undo() {
  await win.evaluate(() => /** @type {HTMLElement | null} */ (document.activeElement)?.blur?.())
  await win.keyboard.press('Control+z')
  await waitForVisualQuiescence(win)
}
/** 把卡里那个 <video> 的播放头停到 `seconds`，等 seeked（和用户拖进度条停下是同一个可观察状态）。 */
async function parkPlayhead(id, seconds) {
  await expect.poll(() => win.evaluate((nodeId) => document.querySelector(`[data-node-id="${nodeId}"] video`)?.readyState ?? 0, id), { message: 'video mounted' }).toBeGreaterThanOrEqual(1)
  await win.evaluate(async ({ nodeId, seconds: target }) => {
    const element = /** @type {HTMLVideoElement} */ (document.querySelector(`[data-node-id="${nodeId}"] video`))
    element.pause()
    await new Promise((resolve) => { element.addEventListener('seeked', resolve, { once: true }); element.currentTime = target })
  }, { nodeId: id, seconds })
}
/** 一张截出来的图的「时间」：从像素反推（R 给整秒的粗值，G 给小数秒）。 */
function timeOfFrame(imageUrl) {
  const match = /^nomi-local:\/\/asset\/([^/]+)\/(.+)$/.exec(imageUrl)
  if (!match) throw new Error(`not a project asset url: ${imageUrl}`)
  const file = path.join(projectsDir, decodeURIComponent(match[1]), ...match[2].split('/').map(decodeURIComponent))
  const raw = execFileSync(ffmpeg.path, ['-v', 'error', '-i', file, '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 20 })
  const [r, g] = [raw[0], raw[1]]
  const fraction = g / 255
  return Math.round(r / 20 - fraction) + fraction
}
const menuItem = (name) => win.getByRole('menuitem', { name: new RegExp(`^${name}`) })
const captureButton = () => win.locator('[data-node-floating-toolbar]').getByRole('button', { name: L.capture, exact: true }).first()

try {
  await win.locator('[data-project-card]', { hasText: project.name }).first().click()
  await expect.poll(() => app.windows().some((page) => /projectId=/.test(page.url())), { timeout: stationTimeout({ operations: 4 }) }).toBe(true)
  win = app.windows().find((page) => /projectId=/.test(page.url()))
  win.setDefaultTimeout(stationTimeout({ operations: 2 }))
  await win.locator('.generation-canvas-v2__stage').waitFor()
  await expect(win.locator('.react-flow__node')).toHaveCount(nodes.length)
  await waitForCanvasViewportSettled(win)
  await resetView()

  let capturedUrl = ''
  await task('01-menu-shows-playhead-time', async () => {
    await select('src-video')
    await parkPlayhead('src-video', 7.2)
    await captureButton().click()
    await expect(menuItem(L.current)).toBeVisible()
    await expect(menuItem(L.current)).toContainText('0:07.2')
    await expect(menuItem(L.first)).toBeVisible()
    await expect(menuItem(L.last)).toBeVisible()
    await shot('01-frame-menu')
  })

  await task('02-current-frame-lands-beside-with-edge-and-is-the-7.2s-frame', async () => {
    await menuItem(L.current).click()
    await expect.poll(async () => (await snapshot()).nodes.length, { message: 'new card appears' }).toBe(nodes.length + 1)
    const state = await snapshot()
    const card = state.nodes.find((node) => !nodes.some((seed) => seed.id === node.id))
    if (!card) throw new Error('no new card')
    expect(card.kind).toBe('image')
    expect(card.status).toBe('success')
    expect(card.title).toContain('0:07.2')
    expect(state.edges).toEqual([{ source: 'src-video', target: card.id }])
    expect(card.meta.sourceVideoNodeId).toBe('src-video')
    expect(card.meta.sourceTime).toBe(7.2)
    capturedUrl = card.resultUrl
    const seconds = timeOfFrame(capturedUrl)
    // 0.1 秒 = R 差 2 个灰阶；留 ±0.06 的编码误差，足以分开 7.0 / 7.2 / 7.4。
    if (Math.abs(seconds - 7.2) > 0.06) throw new Error(`the captured pixels say ${seconds.toFixed(2)}s, expected 7.2s`)
    const source = state.nodes.find((node) => node.id === 'src-video')
    expect(source.status).toBe('success')
    expect(source.resultUrl).toBe(url('timed.mp4'))
    await resetView() // 落卡把视口移向新卡，截图前像人一样点「重置视图」，让原视频和新卡同屏
    await shot('02-frame-done')
  })

  await task('03-one-undo-removes-card-and-edge', async () => {
    await undo()
    const state = await snapshot()
    expect(state.nodes.map((node) => node.id).sort()).toEqual(['moved-video', 'src-video'])
    expect(state.edges).toEqual([])
  })

  await task('04-first-and-last-frame-unchanged-and-probe-discriminates', async () => {
    await select('src-video')
    await captureButton().click()
    await menuItem(L.first).click()
    await expect.poll(async () => (await snapshot()).nodes.length).toBe(nodes.length + 1)
    let state = await snapshot()
    const first = state.nodes.find((node) => node.title.toLowerCase().includes(L.first.toLowerCase()))
    if (!first) throw new Error('first-frame card missing')
    const firstSeconds = timeOfFrame(first.resultUrl)
    if (firstSeconds > 0.1) throw new Error(`first frame reads ${firstSeconds.toFixed(2)}s`)
    // 探针活着：同一台探针对 7.2 秒那张读出 7.2、对首帧读出 0——它确实在区分时间。
    expect(Math.abs(timeOfFrame(capturedUrl) - firstSeconds)).toBeGreaterThan(7)
    await select('src-video')
    await captureButton().click()
    await menuItem(L.last).click()
    await expect.poll(async () => (await snapshot()).nodes.length).toBe(nodes.length + 2)
    state = await snapshot()
    const last = state.nodes.find((node) => node.title.toLowerCase().includes(L.last.toLowerCase()))
    if (!last) throw new Error('last-frame card missing')
    const lastSeconds = timeOfFrame(last.resultUrl)
    if (lastSeconds < DURATION - 0.3) throw new Error(`last frame reads ${lastSeconds.toFixed(2)}s`)
    expect(state.edges.filter((edge) => edge.source === 'src-video')).toHaveLength(2)
    await undo()
    await undo()
    state = await snapshot()
    expect(state.nodes.map((node) => node.id).sort()).toEqual(['moved-video', 'src-video'])
  })

  const movedFile = path.join(importedDir, 'moved.mp4')
  const hiddenFile = path.join(importedDir, 'moved.hidden')
  /** 播放头停在 7.2 → 把源文件拿走 → 截当前帧：返回新长出的错误卡。 */
  async function captureWithMissingSource() {
    await select('moved-video')
    await parkPlayhead('moved-video', 7.2)
    if (fs.existsSync(movedFile)) fs.renameSync(movedFile, hiddenFile)
    await captureButton().click()
    await menuItem(L.current).click()
    await expect.poll(async () => (await snapshot()).nodes.length, { timeout: stationTimeout({ operations: 3 }) }).toBe(nodes.length + 1)
    const state = await snapshot()
    return { state, card: state.nodes.find((node) => !nodes.some((seed) => seed.id === node.id)) }
  }

  await task('05-local-failure-card-has-retry-only', async () => {
    const { state, card } = await captureWithMissingSource()
    expect(card.status).toBe('error')
    expect(card.resultUrl).toBeNull()
    expect(state.edges).toEqual([{ source: 'moved-video', target: card.id }])
    const alert = win.locator(`${nodeSel(card.id)} [role="alert"]`)
    await expect(alert).toBeVisible()
    await expect(alert.getByRole('button', { name: L.retry })).toBeVisible()
    await expect(win.locator(nodeSel(card.id))).toContainText(L.failedTitle)
    for (const label of L.switchModel) await expect(alert.getByText(label, { exact: true })).toHaveCount(0)
    await resetView()
    await shot('11-frame-failed')
    // 原视频没动：节点还是成功态、结果没变。
    const source = state.nodes.find((node) => node.id === 'moved-video')
    expect(source.status).toBe('success')
    expect(source.resultUrl).toBe(url('moved.mp4'))
  })

  await task('06-failure-card-one-undo', async () => {
    await undo()
    const state = await snapshot()
    expect(state.nodes.map((node) => node.id).sort()).toEqual(['moved-video', 'src-video'])
    expect(state.edges).toEqual([])
  })

  await task('07-retry-on-the-failure-card-redoes-the-same-second', async () => {
    const { card } = await captureWithMissingSource()
    expect(card.status).toBe('error')
    fs.renameSync(hiddenFile, movedFile)
    const alert = win.locator(`${nodeSel(card.id)} [role="alert"]`)
    await alert.getByRole('button', { name: L.retry }).click()
    await expect.poll(async () => (await snapshot()).nodes.find((node) => node.id === card.id)?.status, { timeout: stationTimeout({ operations: 3 }) }).toBe('success')
    const done = (await snapshot()).nodes.find((node) => node.id === card.id)
    const seconds = timeOfFrame(done.resultUrl)
    if (Math.abs(seconds - 7.2) > 0.06) throw new Error(`the retried frame reads ${seconds.toFixed(2)}s, expected 7.2s`)
    await expect(win.locator(`${nodeSel(card.id)} [role="alert"]`)).toHaveCount(0)
  })
} finally {
  await app.close().catch(() => {})
}

const failed = results.filter((result) => !result.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed (${tag})`)
process.exit(failed.length ? 1 : 0)
