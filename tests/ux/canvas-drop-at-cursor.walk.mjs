// 走查：拖放图片 / 视频到生成画布，卡片落在「松手的那一点」（2026-09-21）。
//
// 用户原话：「拖放图片/视频到生成画布，不会落在鼠标松手的地方，会偏，有时在视线外」。
// 根因（修在 canvasStageDrop.ts）：落点手算 + 钳到画布坐标 ≥40 + 卡片左上角贴光标。
// 视口一旦平移进负坐标区（用户往右/下拖过画布就是这样），钳制把卡推回 x/y=40——
// 那一点在屏幕上可能根本不在视野里。修复后：内核 screenToFlowPosition 换算、不钳制、
// 卡片中心压在光标下、exactPosition 不避让。
//
// 这条走查证明的是：**真实 Electron 应用 + 真实鼠标平移 + 真实磁盘文件**下，卡片中心就在松手点。
//
// 驱动方式与它的边界（诚实写明）：
//   · 平移：真实鼠标 down/move/up（与 canvas-drag-pan-gestures 同一手法）。
//   · 拖入：OS 级「从 Finder 拖进窗口」无法被 Playwright 自动化——它只能派发 DOM 事件。
//     所以这里派发一次带**真实 File** 的 drop：File 来自 setInputFiles（CDP 把磁盘路径挂到 File 上，
//     与真人从 Finder 拖来的 File 同一种对象，preload 的 webUtils.getPathForFile 拿得到真路径），
//     装进 DataTransfer，在松手点的 elementFromPoint 上派发 dragenter/dragover/drop（带 clientX/Y）。
//     这是 OS 拖入唯一可自动化的方式；它走的是产品真实的 onDrop → handleCanvasStageDrop → 导入落盘整条链。
//   · 素材：登记表（tests/ux/real-media-fixtures.json）里的真实 4K HEVC 视频 + 它派生的 4K PNG，
//     缺素材即红，不退回合成素材。
//
// 用法：
//   export NOMI_REAL_MEDIA_DIR="/Users/aoqimin/Desktop/视频/"
//   pnpm run build && node tests/ux/canvas-drop-at-cursor.walk.mjs [zh-CN|en] [label]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { expect, screenshotSettled } from './_assert.mjs'
import { CANVAS_PANE_SELECTOR, CANVAS_STAGE_SELECTOR, CANVAS_VIEWPORT_TOLERANCE, followArrivalHint } from './_canvasHit.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { requireRealMediaAssets } from './fixtures/realMedia.mjs'

const LOCALE = process.argv[2] === 'en' ? 'en' : 'zh-CN'
const LABEL = process.argv[3] || 'run'
const shotsDir = path.join(repoRoot, 'tests/ux/shots/canvas-drop-at-cursor', `${LABEL}-${LOCALE}`)
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

// ── 真实素材：登记的 4K HEVC 视频 + 照登记表 derivedFrom.how 抽出的 4K PNG（落 tmp，不写用户素材目录）。
// 第二张图（另一时刻的帧）用于「落在已有卡上」那一步——同一文件二次拖入会被当成重复。
const { assets } = requireRealMediaAssets(['video-4k-hevc-10bit', 'image-4k-png'])
const sourceVideo = assets.get('video-4k-hevc-10bit').file
const derivedSpec = assets.get('image-4k-png').spec
const mediaTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-drop-at-cursor-media-'))
const frames = [['frame-a.png', '00:00:05'], ['frame-b.png', '00:00:40']].map(([name, at]) => {
  const file = path.join(mediaTmp, name)
  execFileSync(ffmpeg.path, ['-y', '-ss', at, '-i', sourceVideo, '-frames:v', '1', file], { stdio: 'pipe' })
  const bytes = fs.statSync(file).size
  if (bytes < derivedSpec.minBytes) {
    throw new Error(`抽出来的帧 ${name} 只有 ${bytes} 字节，登记表 image-4k-png 要求 ≥${derivedSpec.minBytes}——多半抽到黑帧`)
  }
  return file
})

const { app, win: initialWin, tempRoot } = await launchNomiApp({
  name: `canvas-drop-at-cursor-${LOCALE}`,
  args: ['--no-proxy-server'],
  settleMs: 0,
  initialLocalStorage: {
    'nomi:locale:v1': LOCALE,
    'nomi:splash:v1': 'seen',
    'nomi:journey-tour:v1': 'seen',
    'nomi:canvas-gesture-hint:v1': 'seen',
  },
})

let win = initialWin
const getWin = () => {
  const live = app.windows().filter((candidate) => !candidate.isClosed())
  win = live.find((candidate) => /projectId=/.test(candidate.url())) || live[live.length - 1] || win
  return win
}

const failures = []
const results = []
function check(ok, label, detail) {
  const line = `${label} — ${JSON.stringify(detail)}`
  if (ok) console.log(`  ✓ ${line}`)
  else { console.error(`  ✖ ${line}`); failures.push(line) }
}

async function dismissFirstRun() {
  for (let index = 0; index < 6; index += 1) {
    const action = getWin().locator('button, [role="button"], a', { hasText: /跳过|完成|知道了|开始创作|稍后|^Skip$|^Done$|Got it|Later/ }).first()
    if (await action.isVisible().catch(() => false)) await action.click({ timeout: 900 }).catch(() => {})
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(180)
  }
}

/** 视口真相：React Flow 变换层的 transform + 内核容器原点（屏幕 → 画布换算只认这两样）。 */
async function readViewport() {
  return getWin().evaluate((stageSelector) => {
    const layer = document.querySelector('.react-flow__viewport')
    const flow = document.querySelector('.react-flow').getBoundingClientRect()
    const stage = document.querySelector(stageSelector).getBoundingClientRect()
    const m = new DOMMatrixReadOnly(getComputedStyle(layer).transform)
    return {
      x: m.m41, y: m.m42, zoom: m.a,
      flow: { left: flow.left, top: flow.top },
      stage: { left: stage.left, top: stage.top, right: stage.right, bottom: stage.bottom, width: stage.width, height: stage.height },
    }
  }, CANVAS_STAGE_SELECTOR)
}

const toCanvas = (vp, screen) => ({
  x: (screen.x - vp.flow.left - vp.x) / vp.zoom,
  y: (screen.y - vp.flow.top - vp.y) / vp.zoom,
})

/** 判据是稳定性不是睡够多久：变换层连续 8 次采样（~800ms）一格没动才算停。 */
async function waitViewportStill() {
  let last = ''
  let still = 0
  await expect.poll(async () => {
    const vp = await readViewport()
    const key = `${vp.x.toFixed(1)},${vp.y.toFixed(1)},${vp.zoom.toFixed(4)}`
    still = key === last ? still + 1 : 0
    last = key
    return still >= 8
  }, { message: '画布视口一直在动，没停下来', timeout: stationTimeout(), intervals: [100] }).toBe(true)
}

async function nodeIds() {
  return getWin().evaluate(() => Array.from(document.querySelectorAll('.react-flow__node')).map((n) => n.getAttribute('data-id')))
}

async function nodeRect(id) {
  return getWin().evaluate((nodeId) => {
    const el = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`)
    if (!el) return null
    const r = el.getBoundingClientRect()
    const media = el.querySelector('img, video')
    return {
      left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height,
      cx: r.left + r.width / 2, cy: r.top + r.height / 2,
      media: media ? media.tagName.toLowerCase() : null,
      uploading: Boolean(el.querySelector('[data-generating-placement="import"], [data-progress-reveal]')),
    }
  }, id)
}

/**
 * 在屏幕点 (x, y) 松手放下一个真实磁盘文件。
 * File 由 setInputFiles 挂上（CDP 带磁盘路径），与 Finder 拖来的 File 同一种对象；
 * 事件派发在该点最顶层元素上，冒泡到画布真实的 onDrop。
 */
async function dropRealFile(filePath, point) {
  const page = getWin()
  await page.evaluate(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.setAttribute('data-walk-drop-source', 'true')
    input.style.display = 'none'
    document.body.appendChild(input)
  })
  const source = page.locator('input[data-walk-drop-source="true"]')
  await source.setInputFiles(filePath)
  const target = await page.evaluate(({ x, y }) => {
    const input = document.querySelector('input[data-walk-drop-source="true"]')
    const file = input.files[0]
    const hit = document.elementFromPoint(x, y)
    const dt = new DataTransfer()
    dt.items.add(file)
    const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }
    hit.dispatchEvent(new DragEvent('dragenter', init))
    hit.dispatchEvent(new DragEvent('dragover', init))
    const accepted = !hit.dispatchEvent(new DragEvent('drop', init))
    input.remove()
    return { tag: hit.tagName, className: String(hit.className).slice(0, 80), fileName: file.name, fileSize: file.size, accepted }
  }, point)
  return target
}

/**
 * 在松手点画一个圆圈标记（仅证据截图用，pointer-events:none，拍完即删）。
 * 标记按**画布坐标**投影回此刻的屏幕：放下本身不再挪画布，但卡片中心若被挤出舞台、走过一次边缘提示，
 * 视口就被那一下点击挪过——直接用当时的屏幕坐标会把标记画偏，截图就成了假证据。
 */
async function markDropPoints(rows) {
  const vp = await readViewport()
  const points = rows.map((row) => ({
    x: Math.round(row.dropCanvasRaw.x * vp.zoom + vp.x + vp.flow.left),
    y: Math.round(row.dropCanvasRaw.y * vp.zoom + vp.y + vp.flow.top),
    tag: `${row.tag === '图片' ? 'img' : row.tag === '视频' ? 'video' : 'stack'} release (${row.dropScreen.x},${row.dropScreen.y})`,
  }))
  await getWin().evaluate((list) => {
    for (const { x, y, tag } of list) {
      const mark = document.createElement('div')
      mark.setAttribute('data-walk-drop-mark', 'true')
      mark.style.cssText = `position:fixed;left:${x - 14}px;top:${y - 14}px;width:28px;height:28px;border:3px solid #ff2d55;border-radius:50%;z-index:2147483647;pointer-events:none;box-shadow:0 0 0 2px #fff`
      const label = document.createElement('div')
      label.textContent = tag
      label.style.cssText = `position:fixed;left:${x + 18}px;top:${y - 10}px;font:600 12px/1 system-ui;color:#fff;background:#ff2d55;padding:3px 5px;border-radius:4px;z-index:2147483647;pointer-events:none`
      label.setAttribute('data-walk-drop-mark', 'true')
      document.body.append(mark, label)
    }
  }, points)
}

async function clearMarks() {
  await getWin().evaluate(() => document.querySelectorAll('[data-walk-drop-mark]').forEach((el) => el.remove()))
}

/**
 * 一次放下 + 全部判据。先量状态再动手；落点判据在「卡片出现的第一帧」与「导入安定后」各量一次
 * （导入中卡片会从默认尺寸换成按媒体比例的尺寸——中心偏不偏要两头都看）。
 */
async function dropAndMeasure({ tag, file, point, existingId = null }) {
  const before = await nodeIds()
  const vpBefore = await readViewport()
  const canvasPoint = toCanvas(vpBefore, point)
  const existingBefore = existingId ? await nodeRect(existingId) : null
  const hit = await dropRealFile(file, point)
  let newId = null
  await expect.poll(async () => {
    newId = (await nodeIds()).find((id) => !before.includes(id)) ?? null
    return Boolean(newId)
  }, { message: `${tag}：放下后画布上没出现新卡（onDrop 没接住）`, timeout: stationTimeout(), intervals: [50] }).toBe(true)
  const first = await nodeRect(newId)
  // 等导入安定：媒体元素出现且导入层撤掉，再多等视口停稳。
  await expect.poll(async () => {
    const r = await nodeRect(newId)
    return Boolean(r && r.media && !r.uploading)
  }, { message: `${tag}：导入迟迟没完成（卡上一直没有媒体或导入层一直挂着）`, timeout: stationTimeout({ operations: 4 }), intervals: [250] }).toBe(true)
  await waitViewportStill()
  const settled = await nodeRect(newId)
  const vpAfter = await readViewport()
  const existingAfter = existingId ? await nodeRect(existingId) : null
  const round = (n) => Math.round(n)
  const row = {
    tag,
    file: path.basename(file),
    hit,
    dropScreen: point,
    dropCanvas: { x: round(canvasPoint.x), y: round(canvasPoint.y) },
    dropCanvasRaw: canvasPoint,
    viewportBefore: { x: round(vpBefore.x), y: round(vpBefore.y), zoom: vpBefore.zoom },
    viewportAfter: { x: round(vpAfter.x), y: round(vpAfter.y), zoom: vpAfter.zoom },
    first: { cx: round(first.cx), cy: round(first.cy), w: round(first.width), h: round(first.height), dx: round(first.cx - point.x), dy: round(first.cy - point.y) },
    settled: { cx: round(settled.cx), cy: round(settled.cy), w: round(settled.width), h: round(settled.height), dx: round(settled.cx - point.x), dy: round(settled.cy - point.y), media: settled.media },
    existingMoved: existingBefore && existingAfter
      ? { dx: round(existingAfter.left - existingBefore.left), dy: round(existingAfter.top - existingBefore.top) }
      : null,
    newId,
  }
  results.push(row)
  console.log(`DROP ${JSON.stringify(row)}`)

  const stage = vpAfter.stage
  const rectOf = (r) => ({ l: round(r.left), t: round(r.top), r: round(r.right), b: round(r.bottom) })
  // ① 卡片出现的那一帧：落点判据（用户松手那一刻看到卡落在哪）。
  check(first.left <= point.x && point.x <= first.right && first.top <= point.y && point.y <= first.bottom,
    `${tag}·出现第一帧：卡片屏幕框包含松手点`, { point, rect: rectOf(first) })
  check(Math.abs(first.cx - point.x) < first.width * 0.15 && Math.abs(first.cy - point.y) < first.height * 0.15,
    `${tag}·出现第一帧：卡片中心距松手点 < 宽高的 15%`, row.first)
  // ② 导入安定后：松手点仍压在卡上。
  check(settled.left <= point.x && point.x <= settled.right && settled.top <= point.y && point.y <= settled.bottom,
    `${tag}·导入安定后：卡片屏幕框仍包含松手点`, { point, rect: rectOf(settled) })
  // 安定后中心漂移只记录不判红：媒体真实比例回填后卡片尺寸会变（见报告 FINDING）。
  const drift = { dx: row.settled.dx, dy: row.settled.dy, w: row.settled.w, h: row.settled.h }
  if (Math.abs(drift.dx) >= drift.w * 0.15 || Math.abs(drift.dy) >= drift.h * 0.15) console.log(`FINDING ${tag}：导入安定后卡片中心偏离松手点 ${JSON.stringify(drift)}`)
  // ③ 视口：一格不许动（2026-09-25 用户拍板「程序不再主动平移 / 缩放画布」）。以前这里允许「为露全出界的新卡
  //    平移，量不超过出界量 + 32px 留白」——那段露出平移已经删了，所以任何平移 / 缩放都是回归。
  const shift = { x: Math.abs(vpAfter.x - vpBefore.x), y: Math.abs(vpAfter.y - vpBefore.y), zoom: Math.abs(vpAfter.zoom - vpBefore.zoom) }
  check(shift.x <= CANVAS_VIEWPORT_TOLERANCE.px && shift.y <= CANVAS_VIEWPORT_TOLERANCE.px && shift.zoom <= CANVAS_VIEWPORT_TOLERANCE.zoom,
    `${tag}：放下之后画布一格不动（不平移、不缩放）`, { shift: { x: round(shift.x), y: round(shift.y), zoom: shift.zoom } })
  // ④ 看不看得见：卡片中心压在松手点上、松手点在舞台里，所以按产品「看见了」的判据（中心在可见区里，
  //    canvasArrivalModel.ts isNodeSeen）它总是看得见、不出边缘提示；靠舞台边松手时出界的那一截就留在舞台外
  //    （FINDING 记下不判红——不再有平移去补齐它，这是拍板后的设计）。只有媒体比例回填把中心挤出了舞台，
  //    才轮到边缘提示：那时它必须出现、方向对，点一下卡片完整进舞台（判据在 _canvasHit.mjs followArrivalHint）。
  const settledInside = settled.left >= stage.left - 1 && settled.right <= stage.right + 1 && settled.top >= stage.top - 1 && settled.bottom <= stage.bottom + 1
  const settledSeen = settled.cx >= stage.left && settled.cx <= stage.right && settled.cy >= stage.top && settled.cy <= stage.bottom
  if (settledInside) {
    check(true, `${tag}·导入安定后：卡片完整位于舞台可视区内`, { rect: rectOf(settled), stage: rectOf(stage) })
  } else if (settledSeen) {
    check(true, `${tag}·导入安定后：卡片中心在舞台可视区内（产品判「看见了」，不出边缘提示）`, { rect: rectOf(settled), stage: rectOf(stage) })
    console.log(`FINDING ${tag}：卡片有一截在舞台外（松手点靠边），画布不再替用户平移补齐 ${JSON.stringify({ rect: rectOf(settled), stage: rectOf(stage) })}`)
  } else {
    try {
      const followed = await followArrivalHint(getWin(), { knownIds: before, label: `${tag}·卡片中心出了舞台` })
      check(followed.ids.includes(newId), `${tag}·卡片中心出了舞台：边缘提示指得到它，点一下完整进舞台`, { side: followed.side, ids: followed.ids })
    } catch (error) {
      check(false, `${tag}·卡片中心出了舞台：边缘提示指得到它，点一下完整进舞台`, String(error?.message || error).slice(0, 400))
    }
  }
  if (existingId) {
    // 旧卡「不被推走」按画布坐标判：屏幕位移扣掉视口位移后必须为 0。
    const canvasMoved = {
      dx: round(row.existingMoved.dx - (vpAfter.x - vpBefore.x)),
      dy: round(row.existingMoved.dy - (vpAfter.y - vpBefore.y)),
    }
    row.existingCanvasMoved = canvasMoved
    check(canvasMoved.dx === 0 && canvasMoved.dy === 0, `${tag}：被压住的那张旧卡在画布上原地不动`, canvasMoved)
  }
  return row
}

try {
  await getWin().waitForLoadState('domcontentloaded')
  await dismissFirstRun()

  const blankProject = getWin().locator('button, [role="button"]', { hasText: LOCALE === 'en' ? 'New blank project' : '新建空白项目' }).first()
  await expect(blankProject, '首页上找不到「新建空白项目」').toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
  await blankProject.click()
  await dismissFirstRun()
  const generation = getWin().getByRole('button', { name: LOCALE === 'en' ? 'Generate' : '生成', exact: true }).first()
  await expect(generation, '顶部找不到「生成」工作区切换').toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
  await generation.click()
  const stage = getWin().locator(`${CANVAS_STAGE_SELECTOR}`).first()
  await expect(stage, '生成画布舞台没渲染').toBeVisible({ timeout: stationTimeout() })
  await expect(getWin().locator('[data-nomi-generation-canvas-import-target="true"]').first(), '生成画布没进到可导入状态').toBeVisible({ timeout: stationTimeout() })
  await waitViewportStill()
  await screenshotSettled(getWin(), { path: path.join(shotsDir, '00-canvas-ready.png') })

  // ── 先量：放下点定在舞台 70%/60%（图）与 35%/45%（视频）。
  const vp0 = await readViewport()
  const pointAt = (vp, rx, ry) => ({ x: Math.round(vp.stage.left + vp.stage.width * rx), y: Math.round(vp.stage.top + vp.stage.height * ry) })
  console.log('VIEWPORT-INITIAL', JSON.stringify({ x: vp0.x, y: vp0.y, zoom: vp0.zoom, stage: vp0.stage, topLeftCanvas: toCanvas(vp0, { x: vp0.stage.left, y: vp0.stage.top }) }))

  // ── 真实鼠标平移：空白处左键拖向右下，直到两个放下点都落在画布负坐标区（旧代码会把卡钳到 40 的地方）。
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const vp = await readViewport()
    const imgCanvas = toCanvas(vp, pointAt(vp, 0.7, 0.6))
    if (imgCanvas.x < -60 && imgCanvas.y < -60) break
    const start = pointAt(vp, 0.12, 0.15)
    const hitIsPane = await getWin().evaluate(({ x, y, pane }) => Boolean(document.elementFromPoint(x, y)?.matches(pane)), { ...start, pane: CANVAS_PANE_SELECTOR })
    expect(hitIsPane, `平移起手点 ${JSON.stringify(start)} 不在画布空白上（被浮层盖住），平移会变成别的手势`).toBe(true)
    await getWin().mouse.move(start.x, start.y)
    await getWin().mouse.down()
    await getWin().mouse.move(start.x + Math.round(vp.stage.width * 0.55), start.y + Math.round(vp.stage.height * 0.5), { steps: 18 })
    await getWin().mouse.up()
    await waitViewportStill()
  }
  const vpPanned = await readViewport()
  const topLeft = toCanvas(vpPanned, { x: vpPanned.stage.left, y: vpPanned.stage.top })
  const imagePoint = pointAt(vpPanned, 0.7, 0.6)
  const videoPoint = pointAt(vpPanned, 0.35, 0.45)
  console.log('VIEWPORT-PANNED', JSON.stringify({ x: vpPanned.x, y: vpPanned.y, zoom: vpPanned.zoom, topLeftCanvas: topLeft, imageCanvas: toCanvas(vpPanned, imagePoint), videoCanvas: toCanvas(vpPanned, videoPoint) }))
  expect(topLeft.x < 0 && topLeft.y < 0, `前提：平移后舞台左上角应在画布负坐标区，实测 ${JSON.stringify(topLeft)}`).toBe(true)
  expect(toCanvas(vpPanned, imagePoint).x < 40 && toCanvas(vpPanned, videoPoint).x < 40,
    '前提：两个放下点都应落在旧钳制线（画布 x<40）以内，否则这趟证明不了「钳制」那条根因').toBe(true)

  const image = await dropAndMeasure({ tag: '图片', file: frames[0], point: imagePoint })
  const video = await dropAndMeasure({ tag: '视频', file: sourceVideo, point: videoPoint })
  await markDropPoints([image, video])
  await screenshotSettled(getWin(), { path: path.join(shotsDir, '01-image-video-release-points.png') })
  await clearMarks()
  // 落在已有卡上：松手点就是图片卡此刻的中心，新卡必须压在这里，而不是被避让推开。
  const onCard = await nodeRect(image.newId)
  const onCardPoint = { x: Math.round(onCard.cx), y: Math.round(onCard.cy) }
  const stacked = await dropAndMeasure({ tag: '压在已有卡上', file: frames[1], point: onCardPoint, existingId: image.newId })
  await markDropPoints([stacked])
  await screenshotSettled(getWin(), { path: path.join(shotsDir, '02-stacked-release-point.png') })
  await clearMarks()
} catch (error) {
  failures.push(`走查中途异常：${String(error?.message || error).slice(0, 600)}`)
  console.error('WALK ERROR:', String(error?.stack || error).slice(0, 3000))
  await getWin().screenshot({ path: path.join(shotsDir, 'zz-error.png') }).catch(() => {})
} finally {
  fs.writeFileSync(path.join(shotsDir, 'results.json'), JSON.stringify({ locale: LOCALE, label: LABEL, results, failures }, null, 2))
  await app.close().catch(() => {})
  fs.rmSync(mediaTmp, { recursive: true, force: true })
  // 隔离 profile 里有一份 1.38 GB 的导入副本，跑完即清，别把磁盘吃满。
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`\n✖ 拖放落点走查未通过（${failures.length} 条）：`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`\n✓ 拖放落点走查通过（${LOCALE}）`)
