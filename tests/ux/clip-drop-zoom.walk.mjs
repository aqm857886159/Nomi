import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 真实用户任务（第二片）：把素材从画布节点 / 素材库拖进剪辑节点的时间轴，窄片段在缩小的画布里也点得中，拖到轴边缘自动滚动；
// 并且全局时间轴的裁剪手柄悬停即用、预览区取景拖动被打断后回到拖之前。画布缩放 50 / 100 / 150% 各一遍。
// 零模型额度：隔离项目 + 仓库里的测试图片；屏外窗口、真鼠标（CDP 输入，原生拖放也由它驱动）；不碰真实 Nomi 资料。
// 用法：pnpm run build && node tests/ux/clip-drop-zoom.walk.mjs
//   环境：CLIP_DROP_ZOOMS=50,100,150（默认）  NOMI_WALK_LOCALE=zh-CN|en  NOMI_WALK_SCHEME=light|dark
//         CLIP_DROP_SHOTS=<截图目录>  CLIP_DROP_ONLY=<步骤编号，逗号分隔：P4,P5,P6A,P6B,D1,G1,O1,V>
// 步骤对应任务书卡点：P4 素材拖进剪辑节点、P5 拖放把手不靠悬停、P6A 窄片段点击下限、P6B 边缘自动滚动；G1 / O1 是第一片留下的同类入口。
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findCanvasBlankPoint, panCanvasUntilInside, waitForCanvasViewportSettled } from './_canvasHit.mjs'
import { stationTimeout } from './_station-budget.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ZOOMS = (process.env.CLIP_DROP_ZOOMS ?? '50,100,150').split(',').map(Number)
const LOCALE = process.env.NOMI_WALK_LOCALE ?? 'zh-CN'
const SCHEME = process.env.NOMI_WALK_SCHEME ?? 'light'
const SHOT_DIR = process.env.CLIP_DROP_SHOTS ?? path.join(repoRoot, '.tmp', 'clip-drop-shots')
const ONLY = process.env.CLIP_DROP_ONLY ? new Set(process.env.CLIP_DROP_ONLY.split(',')) : null
fs.mkdirSync(SHOT_DIR, { recursive: true })

const PROJECT_ID = 'clip-drop-zoom'
const PROJECT_NAME = 'Clip drop zoom'
const MIN_CLIP_HIT_PX = 24 // 设计卡：窄片段的可点击宽度在屏幕上至少这么宽

const results = []
const record = (point, zoom, name, pass, detail = {}) => {
  const item = { point, zoom, name, pass: Boolean(pass), ...detail }
  results.push(item)
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${point} @${zoom}% ${name} ${JSON.stringify(detail)}`)
  return item.pass
}
const wanted = (point) => !ONLY || ONLY.has(point)

function buildProject(root) {
  const projectsDir = path.join(root, 'projects')
  const projectRoot = path.join(projectsDir, `project-${PROJECT_ID}`)
  const generatedDir = path.join(projectRoot, 'assets', 'generated')
  fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
  fs.mkdirSync(generatedDir, { recursive: true })
  fs.copyFileSync(path.join(repoRoot, 'tests/ux/fixtures/test-upload.png'), path.join(generatedDir, 'fixture.png'))
  const imageUrl = `nomi-local://asset/${encodeURIComponent(PROJECT_ID)}/assets/generated/fixture.png`
  const image = (id, x, y) => ({ id, kind: 'image', categoryId: 'shots', title: id, position: { x, y }, exactPosition: true, size: { width: 200, height: 140 }, status: 'success', result: { id: `${id}-result`, type: 'image', url: imageUrl, createdAt: 1 } })
  const sourceA = image('source-a', 320, -90)
  const solid = (key, index) => ({ id: `clip-${key}`, sourceNodeId: sourceA.id, type: 'image', label: key.toUpperCase(), url: imageUrl, durationSeconds: 4, trimStart: 0, trimEnd: 4 })
  const seedClips = ['a', 'b', 'c'].map(solid)
  const clipNode = { id: 'clip-node', kind: 'clip', categoryId: 'shots', title: 'Clip editor', position: { x: 320, y: 180 }, exactPosition: true, size: { width: 520, height: 180 }, status: 'idle', meta: { clip: { nodeRole: 'clip', sourceNodeIds: seedClips.map((c) => c.id), clips: seedClips } } }
  // 稀疏节点：12 个 1 秒片段，每 3 秒一个、片段之间留空。1 秒在 30 秒视窗里只有 13 个设计像素宽（远小于 24 屏幕像素的点击下限），总长 34 秒，轴可横向滚动。
  const sparseClips = Array.from({ length: 12 }, (_, index) => ({
    id: `s${index}`, sourceNodeId: sourceA.id, type: 'image', label: `S${index}`, url: imageUrl, durationSeconds: 1, trimStart: 0, trimEnd: 1,
    timelineStartFrame: index * 90, timelineEndFrame: index * 90 + 30, offsetStartFrame: 0, offsetEndFrame: 0,
  }))
  const sparseNode = { id: 'clip-sparse', kind: 'clip', categoryId: 'shots', title: 'Sparse clips', position: { x: 320, y: 430 }, exactPosition: true, size: { width: 520, height: 180 }, status: 'idle', meta: { clip: { nodeRole: 'clip', sourceNodeIds: sparseClips.map((c) => c.id), clips: sparseClips } } }
  const timelineClip = (id, start, label) => ({ id, type: 'image', sourceNodeId: sourceA.id, label, startFrame: start, endFrame: start + 60, frameCount: 60, offsetStartFrame: 0, offsetEndFrame: 0, url: imageUrl })
  const timeline = { version: 1, fps: 30, scale: 1.5, playheadFrame: 0, tracks: [
    { id: 'imageTrack', type: 'image', label: 'Image', clips: [timelineClip('timeline-a', 0, 'A'), timelineClip('timeline-b', 90, 'B')] },
    { id: 'videoTrack', type: 'video', label: 'Video', clips: [] },
    { id: 'audioTrack', type: 'audio', label: 'Audio', clips: [] },
  ], textClips: [], transitions: [] }
  const generationCanvas = { nodes: [sourceA, clipNode, sparseNode], edges: [], groups: [], selectedNodeIds: [], canvasZoom: 1, canvasPan: { x: 0, y: 0 } }
  const payload = { workbenchDocument: null, timeline, generationCanvas, storyboardPlan: null, storyboardPlanCommitted: false }
  const project = { id: PROJECT_ID, name: PROJECT_NAME, version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projectRoot, ...payload, payload }
  fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2), 'utf8')
  fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), JSON.stringify(project, null, 2), 'utf8')
  return { projectsDir }
}

async function runZoom(zoomPercent) {
  const root = makeTempDir('nomi-clip-drop-')
  const settingsDir = path.join(root, 'settings')
  const { projectsDir } = buildProject(root)
  const launched = await launchNomiApp({
    name: `clip-drop-${zoomPercent}`, userDataDir: settingsDir, settingsDir, projectsDir,
    settleMs: 1200, args: ['--disable-gpu'], viewportSize: { width: 1280, height: 933 },
    mainRequire: [path.join(repoRoot, 'tests/ux/_offscreenWindows.cjs')],
    initialLocalStorage: { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', 'nomi-color-scheme': SCHEME, 'nomi:locale:v1': LOCALE },
  })
  const { app, win } = launched
  win.setDefaultTimeout(stationTimeout({ operations: 1 }))
  await (await app.browserWindow(win)).evaluate((window) => window.setIgnoreMouseEvents(true))
  const z = zoomPercent
  const box = async (locator) => locator.boundingBox().catch(() => null)
  const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
  const wait = (ms) => win.waitForTimeout(ms)
  try {
    await win.waitForLoadState('domcontentloaded')
    const card = win.locator('[data-project-card]', { hasText: PROJECT_NAME }).first()
    await card.waitFor({ state: 'visible', timeout: stationTimeout({ operations: 1 }) })
    await card.dblclick()
    await win.locator('nav.nomi-stepper [data-mode="generation"]').first().click()
    const node = win.locator('[data-clip-node="true"][data-node-id="clip-node"]')
    const sparse = win.locator('[data-clip-node="true"][data-node-id="clip-sparse"]')
    const source = win.locator('[data-node-id="source-a"]').first()
    await node.waitFor({ state: 'visible', timeout: stationTimeout({ operations: 1 }) })
    await waitForCanvasViewportSettled(win)
    await canvasSetZoomPercent(win, z)
    const viewport = await waitForCanvasViewportSettled(win)
    if (Math.abs(viewport.zoom - z / 100) > 0.02) throw new Error(`缩放没到 ${z}%：${JSON.stringify(viewport)}`)
    const bring = async (...targets) => {
      for (const target of targets) {
        const pan = await panCanvasUntilInside(win, target, { margin: { left: 40, right: 16, top: 16, bottom: 90 } })
        if (!pan.ok) throw new Error(`节点拖不进舞台：${JSON.stringify(pan)}`)
        await waitForCanvasViewportSettled(win)
      }
    }
    const blankClick = async () => {
      const blank = await findCanvasBlankPoint(win, { inset: 60 })
      await win.mouse.click(blank.x, blank.y)
      await wait(150)
      await win.keyboard.press('Escape')
    }
    const clips = (host) => host.locator('[data-testid="clip-node-clip"]')
    const clipRows = async (host) => host.evaluate((el) => Array.from(el.querySelectorAll('[data-testid="clip-node-clip"]'))
      .map((c) => ({ id: c.getAttribute('data-clip-id'), start: Number(c.getAttribute('data-persisted-start-frame')), end: Number(c.getAttribute('data-persisted-end-frame')) }))
      .sort((a, b) => a.start - b.start))

    // ───────── V 外观取证：手柄悬停 / 选中的节点截图（不判对错）─────────
    if (wanted('V')) {
      await bring(node)
      await blankClick()
      const cBox = await box(clips(node).nth(2))
      await win.mouse.move(center(cBox).x, center(cBox).y)
      await wait(300)
      await node.screenshot({ path: path.join(SHOT_DIR, `${LOCALE}-${SCHEME}-z${z}-v1-hover-unselected.png`) })
      await win.mouse.click(center(cBox).x, center(cBox).y)
      await wait(300)
      await win.keyboard.press('Escape')
      await win.mouse.move(center(cBox).x, center(cBox).y)
      await wait(300)
      await node.screenshot({ path: path.join(SHOT_DIR, `${LOCALE}-${SCHEME}-z${z}-v2-selected.png`) })
      record('V', z, '外观取证截图已落盘', true, { dir: SHOT_DIR })
    }

    // 拖放的驱动方式（诚实说明）：Electron 里 Playwright 的鼠标只能触发到 dragstart，后续的 dragenter / dragover / drop
    // 不会送进页面（原生拖放由系统接管）。所以「拖出」这一半是真的——真鼠标按在把手上拖，真的 dragstart 处理函数把真载荷写进
    // DataTransfer，这里把它原样收下；「落下」这一半用同一份载荷、同一组 MIME 派发 dragenter / dragover / drop 事件，
    // 事件落在真实的屏幕坐标上（先按坐标取最顶层元素再派发，所以被谁挡住就是谁收到）。
    const grabRealPayload = async (notch) => {
      // 真鼠标按在把手上拖，确认 dragstart 真的发生在把手上；载荷由把手自己的 dragstart 处理函数写出
      // （Electron 里真拖的 dataTransfer 读不到内容，所以对同一个把手再派发一次 dragstart 取载荷）。
      await win.evaluate(() => {
        window.__dragStartTarget = null
        window.addEventListener('dragstart', (event) => { window.__dragStartTarget = event.target?.getAttribute?.('draggable') === 'true' ? 'draggable' : 'other' }, true)
      })
      await win.mouse.move(center(await box(source)).x, center(await box(source)).y)
      await wait(300)
      const nb = await box(notch)
      await win.mouse.move(center(nb).x, center(nb).y)
      await win.mouse.down()
      await win.mouse.move(center(nb).x + 5, center(nb).y + 25, { steps: 4 })
      await win.mouse.move(center(nb).x + 40, center(nb).y + 90, { steps: 10 })
      await wait(300)
      const startedOnNotch = (await win.evaluate(() => window.__dragStartTarget)) === 'draggable'
      await win.mouse.up()
      await wait(200)
      const grab = await notch.evaluate((el) => {
        const dt = new DataTransfer()
        el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
        return Object.fromEntries(Array.from(dt.types).map((type) => [type, dt.getData(type)]))
      })
      await blankClick() // 取完载荷收起素材节点被选中时浮出的参数面板（它会盖住下面的剪辑节点）
      return startedOnNotch ? grab : null
    }
    const sendDrag = async (grab, point, type) => win.evaluate(({ grabbed, at, kind }) => {
      const dt = new DataTransfer()
      for (const [mime, data] of Object.entries(grabbed)) if (mime !== 'text/plain') dt.setData(mime, data)
      const target = document.elementFromPoint(at.x, at.y)
      const event = new DragEvent(kind, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: at.x, clientY: at.y })
      target?.dispatchEvent(event)
      return { prevented: event.defaultPrevented, caret: Boolean(document.querySelector('[data-testid="clip-node-drop-caret"]')) }
    }, { grabbed: grab, at: point, kind: type })
    const dragThrough = async (grab, point, { drop }) => {
      await sendDrag(grab, point, 'dragenter')
      await sendDrag(grab, { x: point.x - 2, y: point.y }, 'dragover')
      await sendDrag(grab, point, 'dragover')
      await wait(200)
      const over = await sendDrag(grab, point, 'dragover')
      const caretBox = await box(node.getByTestId('clip-node-drop-caret'))
      if (drop) await sendDrag(grab, point, 'drop')
      await wait(900)
      return { over, caretBox }
    }

    // ───────── D1 拖放进行中画布浮层不吃命中：选中素材节点（参数浮板盖住剪辑节点）→ 拖它的把手 → 落点最顶层回到剪辑轴，插入成功；拖完浮板恢复可点 ─────────
    if (wanted('D1')) {
      await bring(source, node)
      await blankClick()
      const notch = source.locator('[draggable="true"]').first()
      // 载荷：对同一个把手派发一次 dragstart 取出（处理函数写的真载荷），再派发 dragend 把这次演示性的拖放收掉。
      const grab = await notch.evaluate((el) => {
        const dt = new DataTransfer()
        el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
        const payload = Object.fromEntries(Array.from(dt.types).map((type) => [type, dt.getData(type)]))
        el.dispatchEvent(new DragEvent('dragend', { bubbles: true }))
        return payload
      })
      const stageEl = win.locator('.generation-canvas-v2__stage').first()
      const sb = await box(source)
      await win.mouse.click(center(sb).x, center(sb).y) // 选中素材节点：参数浮板在它下面展开
      await wait(900)
      const before = await clipRows(node)
      const bBox = await box(clips(node).nth(1))
      const target = { x: bBox.x + bBox.width * 0.25, y: bBox.y + bBox.height / 2 }
      const topAt = (point) => win.evaluate(({ x, y }) => {
        const hit = document.elementFromPoint(x, y)
        return { inAxis: Boolean(hit?.closest('[data-testid="clip-node-axis-content"]')), inComposer: Boolean(hit?.closest('.generation-canvas-v2-node__composer')) }
      }, point)
      const coveredBefore = await topAt(target)
      // 拖放开始：对把手派发 dragstart（真实鼠标按下后接着拖会让 React Flow 同时开始拖节点，松手时按旧快照回写、冲掉落下的片段——
      // 那是走查驱动方式的副作用，真实的原生拖放不产生 mouseup；真鼠标拖出一半已由 P5 覆盖）。
      const startDrag = () => notch.evaluate((el) => el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })))
      await startDrag()
      await wait(300)
      const flagDuring = await stageEl.getAttribute('data-drop-active')
      await win.screenshot({ path: path.join(SHOT_DIR, `${LOCALE}-${SCHEME}-z${z}-d1-during-drag.png`) }) // 拖放期间浮板还在原处（只是不吃命中），外观不变
      const topDuring = await topAt(target)
      await dragThrough(grab, target, { drop: true })
      const flagAfter = await stageEl.getAttribute('data-drop-active')
      const after = await clipRows(node)
      const inserted = after.find((row) => !before.some((old) => old.id === row.id))
      const composer = win.locator('.generation-canvas-v2-node__composer-card').first()
      const cb = await box(composer)
      const composerBack = cb ? await win.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.generation-canvas-v2-node__composer')), { x: cb.x + cb.width / 2, y: cb.y + Math.min(cb.height - 4, 30) }) : false
      record('D1', z, '素材节点选中、参数浮板盖在剪辑片段上：拖放期间落点最顶层是剪辑轴，插入成功，拖完浮板恢复可点',
        coveredBefore.inComposer && !coveredBefore.inAxis && flagDuring === 'true' && topDuring.inAxis && Boolean(inserted) && inserted.start === before[1].start && flagAfter === null && composerBack,
        { coveredBefore, flagDuring, topDuring, insertedStart: inserted?.start ?? null, flagAfter, composerBack })
      // 取消：dragend / Esc 之后旗摘掉、浮板恢复可点。
      const cancelled = {}
      await startDrag(); await wait(200)
      cancelled.raised = await stageEl.getAttribute('data-drop-active')
      await notch.evaluate((el) => el.dispatchEvent(new DragEvent('dragend', { bubbles: true })))
      cancelled.afterDragend = await stageEl.getAttribute('data-drop-active')
      await startDrag(); await wait(200)
      await win.keyboard.press('Escape'); await wait(150)
      cancelled.afterEscape = await stageEl.getAttribute('data-drop-active')
      record('D1', z, '拖放被取消（dragend / Esc）后旗摘掉', cancelled.raised === 'true' && cancelled.afterDragend === null && cancelled.afterEscape === null, cancelled)
      await blankClick()
    }

    // ───────── P5 拖放把手不靠悬停：鼠标还在别处时，把手那一点上最顶层就是把手（不是下面的预览层）；真拖能发出载荷 ─────────
    if (wanted('P5')) {
      await bring(source, node)
      await blankClick()
      const blank = await findCanvasBlankPoint(win, { inset: 60 })
      await win.mouse.move(blank.x, blank.y)
      await wait(300)
      const notch = source.locator('[draggable="true"]').first()
      const nb = await box(notch)
      const top = nb ? await win.evaluate(({ x, y }) => {
        const hit = document.elementFromPoint(x, y)
        return { isNotch: Boolean(hit?.closest('[draggable="true"]')), tag: hit?.tagName ?? null }
      }, center(nb)) : null
      const grab = await grabRealPayload(notch)
      record('P5', z, '没悬停时，拖放把手那一点最顶层是把手本身；真鼠标拖它能发出画布节点载荷', Boolean(nb) && top?.isNotch === true && Boolean(grab && Object.keys(grab).some((mime) => mime.includes('generation-node'))), { box: nb ? { w: Math.round(nb.width), h: Math.round(nb.height) } : null, top, mimes: grab ? Object.keys(grab) : null })
    }

    // ───────── P4 素材拖进剪辑节点：落点显示插入指示，松手在落点追加 / 插入 ─────────
    if (wanted('P4')) {
      await bring(source, node)
      await blankClick()
      const notch = source.locator('[draggable="true"]').first()
      const grab = await grabRealPayload(notch)
      if (!grab) throw new Error('真拖没有发出载荷（dragstart 没触发）')
      const before = await clipRows(node)
      const bBox = await box(clips(node).nth(1))
      const target = { x: bBox.x + bBox.width * 0.25, y: bBox.y + bBox.height / 2 }
      const first = await dragThrough(grab, target, { drop: false })
      const laneBox = await box(node.getByTestId('clip-node-media-lane'))
      const caretOk = Boolean(first.caretBox) && Boolean(laneBox) && first.caretBox.height >= laneBox.height * 0.8 && Math.abs(center(first.caretBox).x - bBox.x) <= Math.max(6, 6 * (z / 100))
      await sendDrag(grab, target, 'drop')
      await wait(900)
      const after = await clipRows(node)
      const inserted = after.find((row) => !before.some((old) => old.id === row.id))
      record('P4', z, '画布素材拖进剪辑节点：落点出插入指示，松手插在片段 B 之前', first.over.prevented && after.length === before.length + 1 && caretOk && inserted && inserted.start === before[1].start && after[2].start >= inserted.end,
        { prevented: first.over.prevented, caretOk, caretX: first.caretBox ? Math.round(center(first.caretBox).x) : null, bLeftX: Math.round(bBox.x), before: before.map((r) => r.start), after: after.map((r) => r.start), insertedStart: inserted?.start ?? null })

      // 拖到空白处（所有片段之后）：追加，不压在任何片段上；同一份素材再拖一次也能入轴。
      const lb = await box(node.getByTestId('clip-node-media-lane'))
      const tail = { x: lb.x + lb.width - 12, y: lb.y + lb.height / 2 }
      const countBefore = (await clipRows(node)).length
      await dragThrough(grab, tail, { drop: true })
      const rows = await clipRows(node)
      const last = rows.at(-1)
      const prev = rows.at(-2)
      record('P4', z, '拖到最后一个片段之后：追加在末尾，不重叠（同一份素材可再次入轴）', rows.length === countBefore + 1 && last.start >= prev.end, { count: rows.length, lastStart: last?.start, prevEnd: prev?.end })

      // 素材库的拖出载荷（ASSET_LIBRARY_DRAG_MIME，origin 指向本项目的真实文件）落进剪辑节点。
      const libGrab = { 'application/x-nomi-asset-ref': JSON.stringify([{ kind: 'image', name: 'library-image', renderUrl: await clips(node).first().locator('img').first().getAttribute('src'), origin: { source: 'project', projectId: PROJECT_ID, relativePath: 'assets/generated/fixture.png' } }]) }
      const libBefore = (await clipRows(node)).length
      const axisBox = await box(node.getByTestId('clip-node-axis-content'))
      const libPoint = { x: axisBox.x + axisBox.width * 0.2, y: axisBox.y + axisBox.height * 0.6 }
      const lib = await dragThrough(libGrab, libPoint, { drop: true })
      const libAfter = (await clipRows(node)).length
      record('P4', z, '素材库载荷落进剪辑节点：接收口接收、出插入指示、追加一个片段', lib.over.prevented && Boolean(lib.caretBox) && libAfter === libBefore + 1, { prevented: lib.over.prevented, caret: Boolean(lib.caretBox), libBefore, libAfter })
    }

    // ───────── P6A 窄片段点击下限：片段外侧 1 屏幕像素也算点中它（不是拖播放头）─────────
    if (wanted('P6A')) {
      await bring(sparse)
      await blankClick()
      const target = clips(sparse).nth(3)
      const tb = await box(target)
      const idBefore = await target.getAttribute('data-clip-id')
      const startBefore = Number(await target.getAttribute('data-persisted-start-frame'))
      const pressX = tb.x - 1
      const y = center(tb).y
      await win.mouse.move(pressX, y)
      await win.mouse.down()
      await win.mouse.move(pressX + 30, y, { steps: 8 })
      await wait(120)
      const dragging = await target.getAttribute('data-dragging')
      await win.mouse.up()
      await wait(400)
      const startAfter = Number(await sparse.locator(`[data-clip-id="${idBefore}"]`).getAttribute('data-persisted-start-frame'))
      record('P6A', z, `窄片段（屏幕宽 ${Math.round(tb.width)}px < ${MIN_CLIP_HIT_PX}px）外侧 1px 按下能拖动它`, dragging === 'true' && startAfter > startBefore, { screenWidth: Math.round(tb.width), dragging, startBefore, startAfter })
    }

    // ───────── P6B 拖到时间轴边缘自动滚动 ─────────
    if (wanted('P6B')) {
      await bring(sparse)
      await blankClick()
      const axis = sparse.getByTestId('clip-node-axis-content').locator('..')
      const ab = await box(axis)
      const scrollBefore = await axis.evaluate((el) => el.scrollLeft)
      const first = clips(sparse).nth(1)
      const fb = await box(first)
      const startBefore = Number(await first.getAttribute('data-persisted-start-frame'))
      const id = await first.getAttribute('data-clip-id')
      // 片段太窄（13 设计像素）、整个身体都是手柄，从左侧命中垫上按下去拖整个片段。
      const grabX = fb.x - 1
      await win.mouse.move(grabX, center(fb).y)
      await win.mouse.down()
      await win.mouse.move(grabX + 20, center(fb).y, { steps: 4 })
      await win.mouse.move(ab.x + ab.width - 6, center(fb).y, { steps: 10 })
      await wait(900)
      const scrollMid = await axis.evaluate((el) => el.scrollLeft)
      await win.mouse.up()
      await wait(400)
      const startAfter = Number(await sparse.locator(`[data-clip-id="${id}"]`).getAttribute('data-persisted-start-frame'))
      record('P6B', z, '片段拖到轴右边缘停住，轴自动向右滚动，片段跟着走远', scrollMid > scrollBefore + 20 && startAfter > startBefore + 30, { scrollBefore, scrollMid, startBefore, startAfter })
    }

    // ───────── G1 / O1 预览页：全局时间轴手柄悬停即用；预览取景拖动被打断后回到拖之前 ─────────
    if (wanted('G1') || wanted('O1')) {
      await win.locator('nav.nomi-stepper [data-mode="preview"]').first().click()
      const globalClips = win.locator('[data-testid="timeline-clip"]')
      await globalClips.nth(1).waitFor({ state: 'visible', timeout: stationTimeout({ operations: 1 }) })
      await wait(500)
      if (wanted('G1')) {
        const second = globalClips.nth(1)
        const selectedBefore = await second.getAttribute('data-selected')
        const sb = await box(second)
        await win.mouse.move(center(sb).x, center(sb).y)
        await wait(250)
        const handle = second.locator('.workbench-timeline-clip__handle--right')
        const handleCount = await handle.count()
        const hb = handleCount ? await box(handle) : null
        const opacity = handleCount ? Number(await handle.evaluate((el) => getComputedStyle(el).opacity)) : 0
        if (hb) {
          await win.mouse.move(center(hb).x, center(hb).y)
          await win.mouse.down()
          await win.mouse.move(center(hb).x + 25, center(hb).y, { steps: 6 })
          await wait(120)
          await win.mouse.up()
          await wait(300)
        }
        const sa = await box(second)
        record('G1', z, '全局时间轴：未选中片段悬停即显出右手柄并能拉长', selectedBefore === 'false' && Boolean(hb) && opacity > 0.99 && sa.width > sb.width + 10, { selectedBefore, handleCount, opacity, widthBefore: Math.round(sb.width), widthAfter: Math.round(sa.width) })
      }
      if (wanted('O1')) {
        const stage = win.locator('.workbench-preview-player__stage').first()
        const stb = await box(stage)
        const media = stage.locator('img, video').first()
        const readStyle = async () => media.evaluate((el) => el.getAttribute('style') ?? '')
        const styleBefore = await readStyle()
        await win.evaluate(() => { window.addEventListener('pointerdown', (e) => { window.__lastPointerId = e.pointerId }, true) })
        const from = center(stb)
        await win.mouse.move(from.x, from.y)
        await win.mouse.down()
        await win.mouse.move(from.x + 40, from.y + 20, { steps: 6 })
        await wait(150)
        const styleMid = await readStyle()
        await win.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: window.__lastPointerId ?? 1, bubbles: true, pointerType: 'mouse' })))
        await win.mouse.move(from.x + 41, from.y + 21)
        await wait(250)
        const styleAfter = await readStyle()
        await win.mouse.up()
        await wait(250)
        const styleEnd = await readStyle()
        record('O1', z, '预览取景拖动被 pointercancel 打断后回到拖之前', styleMid !== styleBefore && styleAfter === styleBefore && styleEnd === styleBefore, { moved: styleMid !== styleBefore, restored: styleAfter === styleBefore, stayed: styleEnd === styleBefore })
      }
    }
  } finally {
    await app.close().catch(() => {})
  }
}

for (const zoomPercent of ZOOMS) {
  try {
    await runZoom(zoomPercent)
  } catch (error) {
    record('walk', zoomPercent, '走查本身中断', false, { message: error?.message })
  }
}
const failed = results.filter((item) => !item.pass)
console.log(`RESULT ${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.log(`FAILED ${failed.map((item) => `${item.point}@${item.zoom}`).join(' ')}`)
  process.exit(1)
}
