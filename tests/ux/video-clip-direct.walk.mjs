import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 真实 Electron：视频节点「直接剪辑」（2026-10-10 用户拍板「设计没问题」，设计卡 docs/plan/2026-10-10-video-clip-direct.md）。
// 走生产构建（先 `pnpm run build`），隔离资料目录，窗口在屏幕外不抢焦点，零花费：全程本机 ffmpeg，不碰任何服务商。
//
// 素材是**每一帧都写着自己时间**的 12 秒视频（红通道 = 20·t、绿通道 = 小数秒），所以剪出来的片段「从原视频的第几秒开始」
// 可以从像素反推，不靠文件名、不靠 mock；另一条 150 秒的长视频让「剪辑中」停得够久，能看到进度、点取消。
//
// 断言（每条都是用户看得见、点得到的事实）：
//   ① 选中视频 →「剪辑」钮 → 面板贴着节点弹出，入点在最左、出点在最右（读数 = 全长）；
//   ② 真拖入点 / 出点手柄：读数跟着走，保留时长 = 出点 − 入点；拖动时长小牌不是红色；
//   ③ 预览只播保留的这一段（时间读数始终在入点—出点之间，播完回到入点）；
//   ④ 确认 → 旁边多一张连好线的新视频卡，标题带区间；成片时长 = 保留时长、第一帧 = 入点那一秒；原视频文件字节不变；
//   ⑤ 一次 Ctrl+Z：卡和线一起没有；
//   ⑥ 长视频剪辑中：新卡顶上「剪辑中 · N%」+ 取消；点取消 = 卡和线没有、原视频不动；
//   ⑦ 本机失败（源文件被拿走）：新卡变错误卡，只有「重试」没有「换个模型」；放回文件点重试成功；
//   ⑧ 画布缩到 50%：面板不跟着缩小，照常可拖照常可确认。
// 用法：node tests/ux/video-clip-direct.walk.mjs [--locale en] [--scheme dark] [--shots no]
// 截图：docs/evidence/2026-10-10-video-clip-direct/<序号>-<状态>-<zh|en>[-dark].png
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, expectAbsent, proveProbe, screenshotSettled, waitForVisualQuiescence } from './_assert.mjs'
import { findNodeHitPoint, readCanvasViewport, waitForCanvasViewportSettled } from './_canvasHit.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { uiText } from './full-walk/invariants.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const argValue = (flag, fallback) => { const index = process.argv.indexOf(flag); return index > 0 ? process.argv[index + 1] : fallback }
const locale = argValue('--locale', 'zh-CN')
const scheme = argValue('--scheme', 'light')
const tag = `${locale === 'en' ? 'en' : 'zh'}${scheme === 'dark' ? '-dark' : ''}`
const zh = locale !== 'en'
const evidence = path.join(repoRoot, 'docs/evidence/2026-10-10-video-clip-direct')
const failShotDir = path.join(repoRoot, '.tmp/walk-fail')
const offscreen = path.join(repoRoot, 'tests/ux/full-walk/offscreenWindow.cjs')
const withShots = argValue('--shots', 'yes') !== 'no'

const temp = makeTempDir('nomi-video-clip-')
const projectsDir = path.join(temp, 'projects')
const projectId = 'video-clip-direct'
const projectRoot = path.join(projectsDir, projectId)
const importedDir = path.join(projectRoot, 'assets/imported')
fs.mkdirSync(importedDir, { recursive: true })
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(evidence, { recursive: true })
fs.mkdirSync(failShotDir, { recursive: true })

const DURATION = 12
const LONG_DURATION = 150
// 每一帧写着自己的时间：R = 20·t（最大 240），G = 小数秒 · 255，B 固定。
execFileSync(ffmpeg.path, [
  '-y', '-f', 'lavfi', '-i', `color=c=black:size=640x360:rate=25:duration=${DURATION}`,
  '-vf', "format=gbrp,geq=r='min(255,T*20)':g='mod(T,1)*255':b=128,format=yuv420p",
  '-c:v', 'libx264', '-g', '25', path.join(importedDir, 'timed.mp4'),
], { stdio: 'pipe' })
fs.copyFileSync(path.join(importedDir, 'timed.mp4'), path.join(importedDir, 'moved.mp4'))
// 长视频：1280x720 testsrc2，让重编码要好几秒——「剪辑中」才有可截的进度、可点的取消。
execFileSync(ffmpeg.path, [
  '-y', '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=30:duration=${LONG_DURATION}`,
  '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '30', '-pix_fmt', 'yuv420p', path.join(importedDir, 'long.mp4'),
], { stdio: 'pipe' })
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const originalHash = sha(path.join(importedDir, 'timed.mp4'))

const url = (file) => `nomi-local://asset/${projectId}/assets/imported/${file}`
const video = (id, file, title, x, y, duration, width, height) => ({
  id, kind: 'video', categoryId: 'shots', prompt: '', title, position: { x, y }, size: { width: 340, height: 191 }, status: 'success',
  result: { id: `${id}-result`, type: 'video', url: url(file), createdAt: 1, durationSeconds: duration },
  meta: { videoWidth: width, videoHeight: height, videoAspectRatio: width / height, videoDuration: duration },
})
const T = zh ? { src: '雨夜街口 · 长镜头', moved: '雨夜街口 · 备份', long: '长镜头 · 150 秒' } : { src: 'Rainy street · Long take', moved: 'Rainy street · Backup', long: 'Long take · 150 s' }
const nodes = [
  video('src-video', 'timed.mp4', T.src, 200, 100, DURATION, 640, 360),
  video('moved-video', 'moved.mp4', T.moved, 200, 560, DURATION, 640, 360),
  video('long-video', 'long.mp4', T.long, 760, 100, LONG_DURATION, 1280, 720),
]
const payload = { workbenchDocument: null, timeline: null, generationCanvas: { nodes, edges: [], groups: [], selectedNodeIds: [] }, storyboardPlan: null, storyboardPlanCommitted: false }
const project = { id: projectId, name: 'Video clip direct', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projectRoot, ...payload, payload }
for (const name of ['project.json', '.nomi/project.json']) fs.writeFileSync(path.join(projectRoot, name), JSON.stringify(project))

const tr = (key) => uiText(locale, key)
const L = {
  trim: tr('generationCommon.videoTrim.toolbar'),
  tcIn: tr('generationCommon.videoTrim.tcIn'),
  tcOut: tr('generationCommon.videoTrim.tcOut'),
  keep: tr('generationCommon.videoTrim.keep'),
  play: tr('generationCommon.videoTrim.play'),
  pause: tr('generationCommon.videoTrim.pause'),
  confirm: tr('generationCommon.videoTrim.confirm'),
  retry: tr('generationCommon.observability.action.retry.main'),
  switchModel: [tr('generationCommon.observability.action.switchModel.main'), tr('generationCommon.observability.action.switchModel.alt')],
  failedTitle: tr('generationCommon.videoTrim.failed'),
  cancel: tr('generationCommon.card.generationCancelAria'),
}

const results = []
const run = await launchNomiApp({
  name: 'video-clip-direct', projectsDir, settleMs: 0, mainRequire: [offscreen],
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
    nodes: state.nodes.map((node) => ({ id: node.id, kind: node.kind, status: node.status, title: node.title, error: node.error, resultUrl: node.result?.url ?? null, progress: node.progress ?? null, meta: node.meta ?? {} })),
    edges: state.edges.map((edge) => ({ source: edge.source, target: edge.target })),
  }
})
async function shot(name) {
  if (!withShots) return
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
const trimButton = () => win.locator('[data-node-floating-toolbar]').getByRole('button', { name: L.trim, exact: true }).first()
const panel = () => win.locator('[data-video-clip-panel]')
const clipEl = () => panel().locator('[data-testid="clip-node-clip"]')
const handle = (edge) => panel().locator(`[data-clip-handle-edge="${edge}"]`)
/** 面板贴着节点下沿、有半个屏幕高：被测的那张卡放在画布左上，别的卡挪到屏外（像人把它拖到顺手的位置）。 */
async function place(id) {
  await win.evaluate((target) => {
    const store = /** @type {any} */ (window).__nomiCanvasStore
    store.getState().nodes.forEach((node, index) => {
      if (node.kind !== 'video' || !['src-video', 'moved-video', 'long-video'].includes(node.id)) return
      store.getState().updateNode(node.id, { position: node.id === target ? { x: 200, y: 100 } : { x: 200 + index * 400, y: 1800 } })
    })
  }, id)
  await waitForVisualQuiescence(win)
}
async function openPanel(id) {
  await place(id)
  await select(id)
  await trimButton().click()
  await expect(panel()).toBeVisible()
  // 播放器读到时长之后，出点才会放到最右：等读数不再是 0:00.0。
  await expect.poll(async () => (await readouts()).out).toBeGreaterThan(1)
}
/** 读数（入点 / 出点 / 保留，秒）。 */
async function readouts() {
  const text = await panel().innerText()
  const pick = (label) => {
    const match = new RegExp(`${label}\\s*(?:(\\d+):(\\d\\d\\.\\d)|(\\d+\\.\\d)s)`).exec(text.replace(/\n/g, ' '))
    if (!match) return NaN
    return match[3] ? Number(match[3]) : Number(match[1]) * 60 + Number(match[2])
  }
  return { in: pick(L.tcIn), out: pick(L.tcOut), keep: pick(L.keep) }
}
async function dragHandle(edge, seconds, { release = true } = {}) {
  const box = await handle(edge).boundingBox()
  const clip = await clipEl().boundingBox()
  const now = await readouts()
  const pxPerSecond = clip.width / (now.out - now.in)
  const x0 = box.x + box.width / 2
  const y0 = box.y + box.height / 2
  await win.mouse.move(x0, y0)
  await win.mouse.down()
  const steps = 8
  for (let step = 1; step <= steps; step += 1) await win.mouse.move(x0 + (seconds * pxPerSecond * step) / steps, y0)
  if (release) await win.mouse.up()
}
const metaOf = (state, id) => state.nodes.find((node) => node.id === id)
const newCards = (state) => state.nodes.filter((node) => !nodes.some((seed) => seed.id === node.id))
function localPath(assetUrl) {
  const match = /^nomi-local:\/\/asset\/([^/]+)\/(.+)$/.exec(assetUrl)
  if (!match) throw new Error(`not a project asset url: ${assetUrl}`)
  return path.join(projectsDir, decodeURIComponent(match[1]), ...match[2].split('/').map(decodeURIComponent))
}
/** 一张图 / 一段视频第一帧的「时间」：从像素反推（R 给整秒的粗值，G 给小数秒）。 */
function timeOfFirstFrame(file) {
  const raw = execFileSync(ffmpeg.path, ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 20 })
  const fraction = raw[1] / 255
  return Math.round(raw[0] / 20 - fraction) + fraction
}
function durationOf(file) {
  const out = spawnSync(ffmpeg.path, ['-i', file], { encoding: 'utf8' }).stderr
  const match = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(out)
  if (!match) throw new Error(`cannot read duration of ${file}`)
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

try {
  await win.locator('[data-project-card]', { hasText: project.name }).first().click()
  await expect.poll(() => app.windows().some((page) => /projectId=/.test(page.url())), { timeout: stationTimeout({ operations: 4 }) }).toBe(true)
  win = app.windows().find((page) => /projectId=/.test(page.url()))
  win.setDefaultTimeout(stationTimeout({ operations: 2 }))
  await win.locator('.generation-canvas-v2__stage').waitFor()
  await expect(win.locator('.react-flow__node')).toHaveCount(nodes.length)
  await waitForCanvasViewportSettled(win)
  await resetView()

  await task('01-panel-opens-beside-node-with-full-range', async () => {
    await openPanel('src-video')
    const r = await readouts()
    expect(r.in).toBe(0)
    expect(Math.abs(r.out - DURATION)).toBeLessThan(0.15)
    expect(Math.abs(r.keep - DURATION)).toBeLessThan(0.15)
    // 面板贴着节点下沿、水平居中（不是全屏弹窗、不进全局时间轴）
    const node = await win.locator(nodeSel('src-video')).boundingBox()
    const box = await panel().boundingBox()
    expect(box.y).toBeGreaterThan(node.y + node.height - 4)
    expect(Math.abs(box.x + box.width / 2 - (node.x + node.width / 2))).toBeLessThan(40)
    await shot('03-clip-open')
  })

  let range = { in: 0, out: 0 }
  await task('02-drag-handles-readouts-follow-and-tag-is-not-red', async () => {
    const before = await readouts()
    await dragHandle('left', 3, { release: false })
    // 按住不放：读数跟着走；拖动时长小牌存在且不是红色（用户 10-10 拍板改中性色）
    await expect.poll(async () => (await readouts()).in, { message: 'in readout follows the drag' }).toBeGreaterThan(before.in + 1.5)
    const tagColor = await win.evaluate(() => {
      const tagEl = Array.from(document.querySelectorAll('[data-video-clip-panel] span')).find((el) => /^[+-]\d+\.\ds · \d+\.\ds$/.test((el.textContent || '').trim()))
      if (!tagEl) return null
      const c = getComputedStyle(tagEl).backgroundColor
      return c
    })
    if (tagColor === null) throw new Error('the resize tag is not on screen while dragging')
    const channels = (tagColor.match(/-?\d*\.?\d+/g) ?? []).map(Number)
    // 红色（--nomi-snap-tag = oklch(.45 .18 30)）在 rgb 里 R 明显大于 G / B；中性色三通道相近。
    if (channels.length >= 3 && channels[0] - Math.max(channels[1], channels[2]) > 40) throw new Error(`resize tag is still red: ${tagColor}`)
    await shot('04-clip-drag-in')
    await win.mouse.up()
    await dragHandle('right', -3)
    const r = await readouts()
    expect(r.in).toBeGreaterThan(1.5)
    expect(r.out).toBeLessThan(DURATION - 1.5)
    expect(Math.abs(r.keep - (r.out - r.in))).toBeLessThan(0.15)
    range = { in: r.in, out: r.out }
  })

  await task('03-preview-plays-only-the-kept-part', async () => {
    const timeText = () => panel().locator('[data-video-clip-time]').innerText()
    const parse = (text) => { const m = /(\d+):(\d\d\.\d)/.exec(text); return Number(m[1]) * 60 + Number(m[2]) }
    await win.getByRole('button', { name: L.play, exact: true }).click()
    const seen = []
    const started = Date.now()
    await expect.poll(async () => { seen.push(parse(await timeText())); return Date.now() - started > 900 }, { timeout: stationTimeout({ operations: 1 }) }).toBe(true)
    await shot('05-clip-preview')
    // 播完（保留段只有几秒）：按钮回到「播放」，所有读数都在入点—出点之间
    await expect(win.getByRole('button', { name: L.play, exact: true })).toBeVisible({ timeout: (range.out - range.in + 3) * 1000 })
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(range.in - 0.15)
    expect(Math.max(...seen)).toBeLessThanOrEqual(range.out + 0.25)
  })

  let cardId = ''
  await task('04-confirm-makes-a-connected-card-with-the-kept-range', async () => {
    const hashBefore = sha(path.join(importedDir, 'timed.mp4'))
    await win.getByRole('button', { name: L.confirm, exact: true }).click()
    await expect(panel()).toHaveCount(0)
    await expect.poll(async () => newCards(await snapshot())[0]?.status, { timeout: stationTimeout({ operations: 4 }) }).toBe('success')
    const state = await snapshot()
    const card = newCards(state)[0]
    cardId = card.id
    expect(card.kind).toBe('video')
    expect(state.edges).toEqual([{ source: 'src-video', target: card.id }])
    expect(card.title).toContain(zh ? '剪辑' : 'Trim')
    expect(card.meta.sourceVideoNodeId).toBe('src-video')
    const file = localPath(card.resultUrl)
    const keep = range.out - range.in
    if (Math.abs(durationOf(file) - keep) > 0.25) throw new Error(`clip is ${durationOf(file).toFixed(2)}s, expected ${keep.toFixed(1)}s`)
    const start = timeOfFirstFrame(file)
    if (Math.abs(start - range.in) > 0.15) throw new Error(`clip starts at source second ${start.toFixed(2)}, expected ${range.in.toFixed(1)}`)
    expect(metaOf(state, 'src-video').resultUrl).toBe(url('timed.mp4'))
    expect(sha(path.join(importedDir, 'timed.mp4'))).toBe(hashBefore)
    expect(hashBefore).toBe(originalHash)
    await resetView()
    await shot('06-clip-done')
  })

  await task('05-one-undo-removes-card-and-edge', async () => {
    await undo()
    const state = await snapshot()
    expect(state.nodes.map((node) => node.id).sort()).toEqual(['long-video', 'moved-video', 'src-video'])
    expect(state.edges).toEqual([])
  })

  await task('06-long-video-shows-progress-and-cancel-removes-the-card', async () => {
    const trimFiles = () => { const found = []; const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, entry.name); if (entry.isDirectory()) walk(p); else if (/^trim-/.test(entry.name)) found.push(p) } }; walk(projectRoot); return found.sort() }
    const filesBefore = trimFiles()
    await openPanel('long-video')
    await win.getByRole('button', { name: L.confirm, exact: true }).click()
    await expect.poll(async () => newCards(await snapshot())[0]?.status, { timeout: stationTimeout({ operations: 1 }) }).toBe('running')
    const card = newCards(await snapshot())[0]
    const cardLocator = win.locator(nodeSel(card.id))
    // 顶条：「剪辑中 · N%」+ 取消
    const runningText = tr('generationCommon.videoTrim.starting')
    await expect(cardLocator).toContainText(runningText)
    await expect.poll(async () => (await snapshot()).nodes.find((node) => node.id === card.id)?.progress?.percent ?? 0, { timeout: stationTimeout({ operations: 2 }) }).toBeGreaterThan(0)
    await resetView()
    await shot('07-clip-running')
    const cancelButton = cardLocator.getByRole('button', { name: L.cancel })
    await proveProbe(cancelButton, '剪辑中的新卡上有「取消」')
    await cancelButton.click()
    await expect.poll(async () => newCards(await snapshot()).length, { timeout: stationTimeout({ operations: 1 }) }).toBe(0)
    const state = await snapshot()
    expect(state.edges).toEqual([])
    expect(metaOf(state, 'long-video').status).toBe('success')
    // 取消 = 当没发生过：项目里没有留下任何剪出来的文件
    expect(trimFiles()).toEqual(filesBefore)
  })

  const movedFile = path.join(importedDir, 'moved.mp4')
  const hiddenFile = path.join(importedDir, 'moved.hidden')
  await task('07-local-failure-card-has-retry-only-and-retry-works', async () => {
    await openPanel('moved-video')
    // 预览播放器把整段读进来之后再拿走源文件（卡上还能预览，本机 ffmpeg 读不到了 = 真实的本机失败）
    await expect.poll(() => win.evaluate(() => { const v = document.querySelector('[data-video-clip-panel] video'); return v ? (v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0) : 0 }), { timeout: stationTimeout({ operations: 1 }) }).toBeGreaterThan(DURATION - 0.5)
    // Windows 上播放器还握着文件时改名会 EBUSY：等它放手（预览读完之后通常几百毫秒内）
    await expect.poll(() => { try { fs.renameSync(movedFile, hiddenFile); return true } catch (error) { if (error?.code === 'EBUSY' || error?.code === 'EPERM') return false; throw error } }, { timeout: stationTimeout({ operations: 1 }) }).toBe(true)
    await win.getByRole('button', { name: L.confirm, exact: true }).click()
    await expect.poll(async () => newCards(await snapshot())[0]?.status, { timeout: stationTimeout({ operations: 4 }) }).toBe('error')
    const card = newCards(await snapshot())[0]
    const alert = win.locator(`${nodeSel(card.id)} [role="alert"]`)
    const proof = await proveProbe(alert.getByRole('button', { name: L.retry }), '失败卡里有「重试」按钮')
    await expect(win.locator(nodeSel(card.id))).toContainText(L.failedTitle)
    for (const label of L.switchModel) await expectAbsent(alert.getByText(label, { exact: true }), { provenBy: proof, message: `本机处理失败卡不该有「${label}」` })
    await resetView()
    await shot('12-trim-failed')
    fs.renameSync(hiddenFile, movedFile)
    await alert.getByRole('button', { name: L.retry }).click()
    await expect.poll(async () => (await snapshot()).nodes.find((node) => node.id === card.id)?.status, { timeout: stationTimeout({ operations: 4 }) }).toBe('success')
    const done = (await snapshot()).nodes.find((node) => node.id === card.id)
    expect(newCards(await snapshot())).toHaveLength(1)
    if (!(durationOf(localPath(done.resultUrl)) > 1)) throw new Error('retried clip is empty')
    await expectAbsent(win.locator(`${nodeSel(card.id)} [role="alert"]`), { provenBy: proof, message: '重试成功后失败卡应当消失' })
  })

  await task('08-zoom-50-panel-keeps-its-size-and-still-works', async () => {
    const cardsBefore = newCards(await snapshot()).length // 上一步（重试成功）的那张卡还在：这里只数新增的
    await place('src-video')
    await select('src-video')
    // 缩到 50%：画布底栏的缩放滑杆
    const sliderSelector = `input[type="range"][aria-label="${tr('generationCommon.navigation.zoomRatio')}"]`
    const slider = win.locator(sliderSelector).first()
    await slider.waitFor()
    await win.evaluate((selector) => {
      const input = /** @type {HTMLInputElement} */ (document.querySelector(selector))
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, '50')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }, sliderSelector)
    await waitForCanvasViewportSettled(win)
    const viewport = await readCanvasViewport(win)
    if (viewport.zoom > 0.6) throw new Error(`canvas zoom is ${viewport.zoom}, not scaled down`)
    // 缩放后节点可能偏离，重新点中它
    let point = null
    await expect.poll(async () => { point = await findNodeHitPoint(win, { nodeSelector: nodeSel('src-video') }); return point !== null }).toBe(true)
    await win.mouse.click(point.x, point.y)
    await expect(trimButton()).toBeVisible()
    await shot('13-zoom50-toolbar')
    await trimButton().click()
    await expect(panel()).toBeVisible()
    await expect.poll(async () => (await readouts()).out).toBeGreaterThan(1)
    const box = await panel().boundingBox()
    if (Math.abs(box.width - 480) > 6) throw new Error(`panel is ${box.width}px wide at zoom ${viewport.zoom}, expected 480`)
    await dragHandle('left', 2)
    expect((await readouts()).in).toBeGreaterThan(0.8)
    await shot('14-zoom50-clip')
    await win.getByRole('button', { name: L.confirm, exact: true }).click()
    await expect.poll(async () => newCards(await snapshot()).length, { timeout: stationTimeout({ operations: 4 }) }).toBe(cardsBefore + 1)
    await expect.poll(async () => newCards(await snapshot()).filter((node) => node.status === 'success').length, { timeout: stationTimeout({ operations: 4 }) }).toBe(cardsBefore + 1)
  })
} finally {
  await app.close().catch(() => {})
}

const failed = results.filter((result) => !result.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed (${tag})`)
process.exit(failed.length ? 1 : 0)
