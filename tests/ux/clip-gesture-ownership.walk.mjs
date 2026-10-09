import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 真实用户任务：在画布剪辑节点里拖片段、拖播放头、拉裁剪手柄，在全局时间轴里拖片段——在画布缩放 50% / 100% / 150% 下各走一遍，
// 并在拖动中被系统打断（pointercancel / 窗口失焦 / 丢失 pointer capture）。
// 零模型额度：隔离项目 + 仓库里的测试图片；屏外窗口、真鼠标（CDP 输入）；不碰真实 Nomi 资料。
// 用法：pnpm run build && node tests/ux/clip-gesture-ownership.walk.mjs
//   环境：CLIP_GESTURE_ZOOMS=50,100,150（默认）  NOMI_WALK_LOCALE=zh-CN|en  NOMI_WALK_SCHEME=light|dark
//         CLIP_GESTURE_SHOTS=<截图目录>  CLIP_GESTURE_ONLY=<卡点编号,逗号分隔，默认全部>
// 对应任务书 docs/plan/2026-10-09-clip-gesture-ownership.md 的 8 个卡点（P1..P8）；每个卡点一步，每个缩放档各跑一遍。
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findCanvasBlankPoint, panCanvasUntilInside, readCanvasViewport, waitForCanvasViewportSettled } from './_canvasHit.mjs'
import { uiText } from './full-walk/invariants.mjs'
import { stationTimeout } from './_station-budget.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ZOOMS = (process.env.CLIP_GESTURE_ZOOMS ?? '50,100,150').split(',').map(Number)
const LOCALE = process.env.NOMI_WALK_LOCALE ?? 'zh-CN'
const SCHEME = process.env.NOMI_WALK_SCHEME ?? 'light'
const SHOT_DIR = process.env.CLIP_GESTURE_SHOTS ?? path.join(repoRoot, '.tmp', 'clip-gesture-shots')
const ONLY = process.env.CLIP_GESTURE_ONLY ? new Set(process.env.CLIP_GESTURE_ONLY.split(',')) : null
fs.mkdirSync(SHOT_DIR, { recursive: true })

const PROJECT_ID = 'clip-gesture-ownership'
const PROJECT_NAME = 'Clip gesture ownership'
const MIN_HIT_PX = 8 // 任务书合同 4：可抓取的东西在屏幕上至少 8px，不随画布缩放变小

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
  const sourceA = image('source-a', 320, 430)
  const sourceB = image('source-b', 560, 430)
  const clipRecords = ['a', 'b', 'c'].map((key, index) => ({ id: `clip-${key}`, sourceNodeId: index === 1 ? sourceB.id : sourceA.id, type: 'image', label: key.toUpperCase(), url: imageUrl, durationSeconds: 4, trimStart: 0, trimEnd: 4 }))
  const clipNode = { id: 'clip-node', kind: 'clip', categoryId: 'shots', title: 'Clip editor', position: { x: 320, y: 180 }, exactPosition: true, size: { width: 520, height: 180 }, status: 'idle', meta: { clip: { nodeRole: 'clip', sourceNodeIds: clipRecords.map((c) => c.id), clips: clipRecords } } }
  const timelineClip = { id: 'timeline-a', type: 'image', sourceNodeId: sourceA.id, label: 'A', startFrame: 0, endFrame: 60, frameCount: 60, offsetStartFrame: 0, offsetEndFrame: 0, url: imageUrl }
  const timeline = { version: 1, fps: 30, scale: 1.5, playheadFrame: 0, tracks: [
    { id: 'imageTrack', type: 'image', label: 'Image', clips: [timelineClip] },
    { id: 'videoTrack', type: 'video', label: 'Video', clips: [] },
    { id: 'audioTrack', type: 'audio', label: 'Audio', clips: [] },
  ], textClips: [], transitions: [] }
  const generationCanvas = { nodes: [sourceA, sourceB, clipNode], edges: [], groups: [], selectedNodeIds: [], canvasZoom: 1, canvasPan: { x: 0, y: 0 } }
  const payload = { workbenchDocument: null, timeline, generationCanvas, storyboardPlan: null, storyboardPlanCommitted: false }
  const project = { id: PROJECT_ID, name: PROJECT_NAME, version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projectRoot, ...payload, payload }
  fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2), 'utf8')
  fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), JSON.stringify(project, null, 2), 'utf8')
  return { projectsDir, projectRoot }
}

async function runZoom(zoomPercent) {
  const root = makeTempDir('nomi-clip-gesture-')
  const settingsDir = path.join(root, 'settings')
  const { projectsDir, projectRoot } = buildProject(root)
  const persisted = () => {
    const data = JSON.parse(fs.readFileSync(path.join(projectRoot, '.nomi', 'project.json'), 'utf8'))
    return data.payload ?? data
  }
  const launched = await launchNomiApp({
    name: `clip-gesture-${zoomPercent}`, userDataDir: settingsDir, settingsDir, projectsDir,
    settleMs: 1200, args: ['--disable-gpu'], viewportSize: { width: 1280, height: 933 },
    mainRequire: [path.join(repoRoot, 'tests/ux/_offscreenWindows.cjs')],
    initialLocalStorage: { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', 'nomi-color-scheme': SCHEME, 'nomi:locale:v1': LOCALE },
  })
  const { app, win } = launched
  win.setDefaultTimeout(stationTimeout({ operations: 1 }))
  // 屏外窗口只收 CDP 送来的输入，真实光标一律忽略——别人动一下鼠标不会插进按屏幕像素算的拖拽里。
  await (await app.browserWindow(win)).evaluate((window) => window.setIgnoreMouseEvents(true))
  const z = zoomPercent
  const box = async (locator) => locator.boundingBox().catch(() => null)
  const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
  const snap = async (name) => win.screenshot({ path: path.join(SHOT_DIR, `${LOCALE}-${SCHEME}-z${z}-${name}.png`) })
  try {
    await win.waitForLoadState('domcontentloaded')
    const card = win.locator('[data-project-card]', { hasText: PROJECT_NAME }).first()
    await card.waitFor({ state: 'visible', timeout: stationTimeout({ operations: 1 }) })
    await card.dblclick()
    await win.locator('nav.nomi-stepper [data-mode="generation"]').first().click()
    const node = win.locator('[data-clip-node="true"][data-node-id="clip-node"]')
    await node.waitFor({ state: 'visible', timeout: stationTimeout({ operations: 1 }) })
    await waitForCanvasViewportSettled(win)

    // 缩放像用户一样用缩放条的滑块（界面唯一的精确缩放入口）。
    const slider = win.getByRole('slider', { name: uiText(LOCALE, 'generationCommon.navigation.zoomRatio') })
    await slider.fill(String(z))
    const viewport = await waitForCanvasViewportSettled(win)
    const zoom = viewport.zoom
    if (Math.abs(zoom - z / 100) > 0.02) throw new Error(`缩放没到 ${z}%：${JSON.stringify(viewport)}`)
    // 先把下方的素材节点（选中它时参数浮板在它下面，不会盖住剪辑节点）、再把剪辑节点拖进舞台（两个都要能被真鼠标点到）。
    for (const target of [win.locator('[data-node-id="source-a"]'), node]) {
      const pan = await panCanvasUntilInside(win, target, { margin: { left: 40, right: 16, top: 16, bottom: 90 } })
      if (!pan.ok) throw new Error(`节点拖不进舞台：${JSON.stringify(pan)}`)
      await waitForCanvasViewportSettled(win)
    }

    const clip = (key) => node.locator(`[data-clip-id="clip-clip-${key}"]`)
    const playhead = node.getByTestId('clip-node-playhead')
    const nodeRect = async () => box(node)
    const viewportNow = async () => readCanvasViewport(win)
    const clipState = async (key) => clip(key).evaluate((el) => ({
      start: Number(el.getAttribute('data-persisted-start-frame')),
      end: Number(el.getAttribute('data-persisted-end-frame')),
      selected: el.getAttribute('data-selected'),
      dragging: el.getAttribute('data-dragging'),
      resizing: el.getAttribute('data-resizing'),
    }))
    // 每一步都从同一个起点开始：节点没选中，播放头停在轨道起点（0 帧，只压着第一个片段的左缘 4px）。
    // 播放头压在哪，哪里就归播放头抓（合同 4），所以被测的片段 B / C 的身体不能被上一步留下的播放头盖住。
    const deselectAll = async () => {
      const lane = node.getByTestId('clip-node-media-lane')
      const laneBox = await box(lane)
      if (laneBox) {
        await win.mouse.click(laneBox.x + 1, laneBox.y - 14 * zoom) // 标尺行（轨道上沿往上 14 设计像素）：点一下 = 把播放头放回 0 帧
        await win.waitForTimeout(150)
        await win.keyboard.press('Escape') // 收起 scrub 展开的预览浮层
        await win.waitForTimeout(150)
      }
      const blank = await findCanvasBlankPoint(win, { inset: 60 })
      await win.mouse.click(blank.x, blank.y)
      await win.waitForTimeout(150)
      await win.keyboard.press('Escape')
    }
    // 记录最近一次指针 id，用来向 window 派发「系统打断」事件（真实打断来自系统，这里用同类事件复现）。
    await win.evaluate(() => {
      window.addEventListener('pointerdown', (event) => { window.__lastPointerId = event.pointerId }, true)
    })
    const interrupt = async (kind, targetSelector) => win.evaluate(({ kind: k, selector }) => {
      const pointerId = window.__lastPointerId ?? 1
      if (k === 'pointercancel') window.dispatchEvent(new PointerEvent('pointercancel', { pointerId, bubbles: true, pointerType: 'mouse' }))
      else if (k === 'blur') window.dispatchEvent(new Event('blur'))
      else if (k === 'lostpointercapture') document.querySelector(selector)?.releasePointerCapture(pointerId)
    }, { kind, selector: targetSelector })
    const dragFrom = async (from, dx, { steps = 10 } = {}) => {
      await win.mouse.move(from.x, from.y)
      await win.mouse.down()
      await win.mouse.move(from.x + dx, from.y, { steps })
      await win.waitForTimeout(120)
    }
    const release = async () => { await win.mouse.up(); await win.waitForTimeout(300) }

    // ───────── V 外观取证（不判对错）：手柄「悬停即现」是这次唯一的可见变化，改前改后各截一张节点 ─────────
    if (wanted('V')) {
      await deselectAll()
      const cBox = await box(clip('c'))
      await win.mouse.move(center(cBox).x, center(cBox).y)
      await win.waitForTimeout(250)
      await node.screenshot({ path: path.join(SHOT_DIR, `${LOCALE}-${SCHEME}-z${z}-v1-hover-unselected.png`) })
      await win.mouse.click(center(cBox).x, center(cBox).y)
      await win.waitForTimeout(250)
      await win.keyboard.press('Escape') // 收起点击片段展开的预览浮层，只留节点本身
      await win.mouse.move(center(cBox).x, center(cBox).y)
      await win.waitForTimeout(250)
      await node.screenshot({ path: path.join(SHOT_DIR, `${LOCALE}-${SCHEME}-z${z}-v2-selected.png`) })
      const bBox = await box(clip('b'))
      await win.mouse.move(center(bBox).x, center(bBox).y)
      await win.waitForTimeout(250)
      await node.screenshot({ path: path.join(SHOT_DIR, `${LOCALE}-${SCHEME}-z${z}-v3-hover-other-clip.png`) })
      record('V', z, '外观取证截图已落盘', true, { dir: SHOT_DIR })
    }

    // ───────── P2 未选中节点里按住片段：按下那一刻节点与片段都被选中，然后能直接拖 ─────────
    if (wanted('P2')) {
      await deselectAll()
      const before = await clipState('c')
      const nodeSelectedBefore = await node.getAttribute('data-selected')
      const cBox = await box(clip('c'))
      await win.mouse.move(center(cBox).x, center(cBox).y)
      await win.mouse.down()
      await win.waitForTimeout(150)
      const nodeSelectedAtDown = await node.getAttribute('data-selected')
      const clipSelectedAtDown = (await clipState('c')).selected
      await win.mouse.move(center(cBox).x + 40, center(cBox).y, { steps: 8 })
      await win.waitForTimeout(100)
      const draggingMid = (await clipState('c')).dragging
      await release()
      const after = await clipState('c')
      record('P2', z, '按下即选中节点与片段，并能直接拖', nodeSelectedBefore === 'false' && nodeSelectedAtDown === 'true' && clipSelectedAtDown === 'true' && draggingMid === 'true' && after.start > before.start,
        { nodeSelectedBefore, nodeSelectedAtDown, clipSelectedAtDown, draggingMid, startBefore: before.start, startAfter: after.start })
    }

    // ───────── P3 裁剪手柄：不用先选中，悬停即可用；屏幕上至少 8px 宽 ─────────
    if (wanted('P3')) {
      await deselectAll()
      const before = await clipState('c')
      const cBox = await box(clip('c'))
      await win.mouse.move(center(cBox).x, center(cBox).y)
      await win.waitForTimeout(150)
      const handle = clip('c').locator('[data-clip-handle-edge="right"]')
      const handleCount = await handle.count()
      const hb = handleCount ? await box(handle) : null
      if (hb) {
        await win.mouse.move(center(hb).x, center(hb).y)
        await win.mouse.down()
        await win.mouse.move(center(hb).x - 10, center(hb).y, { steps: 6 })
        await win.waitForTimeout(120)
      }
      const resizingMid = hb ? (await clipState('c')).resizing : null
      await snap('p3-trim-while-unselected')
      if (hb) await release()
      const after = await clipState('c')
      record('P3', z, '未选中片段上悬停即有手柄、拖得动、屏幕宽度不小于 8px',
        Boolean(hb) && hb.width >= MIN_HIT_PX - 0.5 && resizingMid === 'right' && after.end < before.end,
        { handleCount, handleScreenWidth: hb?.width ?? null, resizingMid, endBefore: before.end, endAfter: after.end })
    }

    // ───────── P1 播放头压在片段上：拖的是播放头，不是片段，也不打开预览 ─────────
    if (wanted('P1')) {
      await deselectAll()
      const bBox = await box(clip('b'))
      // 像用户一样先点片段 B 的中段，播放头落在 B 上。
      await win.mouse.click(center(bBox).x, center(bBox).y)
      await win.waitForTimeout(250)
      await win.keyboard.press('Escape')
      await win.waitForTimeout(150)
      const phBefore = await box(playhead)
      const bBeforeState = await clipState('b')
      const bBox2 = await box(clip('b'))
      const phX = center(phBefore).x
      const startY = center(bBox2).y
      const insideClip = phX > bBox2.x && phX < bBox2.x + bBox2.width
      await win.mouse.move(phX, startY)
      await win.mouse.down()
      await win.mouse.move(phX + 30, startY, { steps: 6 })
      const draggingMid = (await clipState('b')).dragging
      await win.mouse.move(phX + 60, startY, { steps: 6 })
      await win.waitForTimeout(150)
      const phMid = await box(playhead)
      await release()
      const bAfterState = await clipState('b')
      const movedPx = center(phMid).x - phX
      record('P1', z, '压在片段上的播放头可拖（scrub），片段不动',
        insideClip && draggingMid === 'false' && movedPx > 30 && bAfterState.start === bBeforeState.start && bAfterState.end === bBeforeState.end,
        { insideClip, draggingMid, playheadMovedScreenPx: Math.round(movedPx), startBefore: bBeforeState.start, startAfter: bAfterState.start })
    }

    // ───────── P7 拖动中被系统打断：画布内片段 / 裁剪 / 播放头，干净结束、回到拖之前 ─────────
    if (wanted('P7')) {
      for (const kind of ['pointercancel', 'blur', 'lostpointercapture']) {
        await deselectAll()
        const before = await clipState('c')
        const cBox = await box(clip('c'))
        const from = center(cBox)
        await dragFrom(from, 40)
        const draggingBefore = (await clipState('c')).dragging
        await interrupt(kind, '[data-testid="clip-node-clip"][data-clip-id="clip-clip-c"]')
        await win.mouse.move(from.x + 41, from.y) // 浏览器在下一个指针事件前才派发 lostpointercapture
        await win.waitForTimeout(100)
        const draggingAfter = (await clipState('c')).dragging
        await win.mouse.move(from.x + 90, from.y, { steps: 6 })
        await win.waitForTimeout(100)
        const draggingAfterMove = (await clipState('c')).dragging
        await release()
        const after = await clipState('c')
        record('P7', z, `画布片段拖动被 ${kind} 打断后干净结束并回到拖之前`,
          draggingBefore === 'true' && draggingAfter === 'false' && draggingAfterMove === 'false' && after.start === before.start,
          { draggingBefore, draggingAfter, draggingAfterMove, startBefore: before.start, startAfter: after.start })
      }
      // 拖播放头被打断：之后鼠标再移动，播放头不再跟着走。
      await deselectAll()
      const lane = node.getByTestId('clip-node-media-lane')
      const laneBox = await box(lane)
      const aBox = await box(clip('a'))
      const sy = laneBox.y + 3
      const sx = Math.min(laneBox.x + laneBox.width - 20, aBox.x + aBox.width * 0.6)
      await win.mouse.move(sx, sy)
      await win.mouse.down()
      await win.mouse.move(sx + 25, sy, { steps: 5 })
      await interrupt('pointercancel', '[data-testid="clip-node-axis-content"]')
      await win.waitForTimeout(100)
      const phAtInterrupt = await box(playhead)
      await win.mouse.move(sx + 70, sy, { steps: 5 })
      await win.waitForTimeout(150)
      const phAfter = await box(playhead)
      await release()
      record('P7', z, '拖播放头被 pointercancel 打断后不再跟随鼠标', Math.abs(center(phAfter).x - center(phAtInterrupt).x) < 2,
        { atInterrupt: Math.round(center(phAtInterrupt).x), afterMove: Math.round(center(phAfter).x) })
    }

    // ───────── P8 手势所有权：每种按法只有一位接管（节点位置 / 画布视口 / 片段 / 播放头 各归其主）─────────
    if (wanted('P8')) {
      await deselectAll()
      const viewportBefore = await viewportNow()
      const nodeBefore = await nodeRect()
      const cBox = await box(clip('c'))
      const phBox = await box(playhead)
      const owners = {}
      // 片段身体
      const cState0 = await clipState('c')
      await dragFrom(center(cBox), 30)
      const midC = await clipState('c')
      await release()
      owners.clipBody = { clipDragging: midC.dragging === 'true', nodeMoved: Math.abs((await nodeRect()).x - nodeBefore.x) > 1, panned: Math.abs((await viewportNow()).x - viewportBefore.x) > 0.5 }
      // 空白轨道
      const lane = node.getByTestId('clip-node-media-lane')
      const laneBox = await box(lane)
      const bx = laneBox.x + laneBox.width - 24
      const ph0 = center(await box(playhead)).x
      await win.mouse.move(bx, laneBox.y + 4)
      await win.mouse.down()
      await win.mouse.move(bx - 60, laneBox.y + 4, { steps: 6 })
      const ph1 = center(await box(playhead)).x
      await release()
      owners.blankLane = { playheadMoved: Math.abs(ph1 - ph0) > 5, nodeMoved: Math.abs((await nodeRect()).x - nodeBefore.x) > 1, panned: Math.abs((await viewportNow()).x - viewportBefore.x) > 0.5 }
      // 节点标题栏（唯一应该挪动节点的地方）
      const header = node.getByTestId('clip-node-drag-handle')
      const hb = await box(header)
      const nodeBeforeHeader = await nodeRect()
      await win.mouse.move(hb.x + 24, hb.y + hb.height / 2)
      await win.mouse.down()
      await win.mouse.move(hb.x + 24 + 50, hb.y + hb.height / 2 + 20, { steps: 8 })
      await release()
      const nodeAfterHeader = await nodeRect()
      owners.header = { nodeMoved: Math.abs(nodeAfterHeader.x - nodeBeforeHeader.x) > 5, panned: Math.abs((await viewportNow()).x - viewportBefore.x) > 0.5 }
      // 别的节点正选着时，在剪辑节点里按住片段：选中权交给剪辑节点（原来那个被取消），别的节点纹丝不动。
      const source = win.locator('[data-node-id="source-a"]')
      const sourceBox = await box(source)
      if (sourceBox) {
        // 拖播放头会按设计展开预览浮层，盖在素材节点上；先像用户一样 Esc 收起，再去点素材节点。
        await win.keyboard.press('Escape')
        await win.waitForTimeout(250)
        await win.mouse.click(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
        for (let attempt = 0; attempt < 20 && (await source.getAttribute('data-selected')) !== 'true'; attempt += 1) await win.waitForTimeout(100)
        const sourceSelectedBefore = await source.getAttribute('data-selected')
        const sourceBeforeDrag = await box(source)
        const cBox2 = await box(clip('c'))
        await dragFrom(center(cBox2), 25)
        await release()
        const sourceAfterDrag = await box(source)
        owners.otherNodeSelected = {
          sourceSelectedBefore,
          sourceSelectedAfter: await source.getAttribute('data-selected'),
          clipNodeSelectedAfter: await node.getAttribute('data-selected'),
          sourceMoved: Math.abs(sourceAfterDrag.x - sourceBeforeDrag.x) > 1 || Math.abs(sourceAfterDrag.y - sourceBeforeDrag.y) > 1,
        }
      }
      const handoff = owners.otherNodeSelected
      record('P8', z, '按在片段 / 空白轨道上只动片段 / 播放头，不挪节点不平移画布；按在标题栏才挪节点；别的节点选着时选中权交给剪辑节点',
        owners.clipBody.clipDragging && !owners.clipBody.nodeMoved && !owners.clipBody.panned
        && owners.blankLane.playheadMoved && !owners.blankLane.nodeMoved && !owners.blankLane.panned
        && owners.header.nodeMoved && !owners.header.panned
        && Boolean(handoff) && handoff.sourceSelectedBefore === 'true' && handoff.sourceSelectedAfter === 'false' && handoff.clipNodeSelectedAfter === 'true' && !handoff.sourceMoved,
        { owners, startC: cState0.start, hadPlayheadBox: Boolean(phBox) })
      await snap('p8-ownership')
    }

    // ───────── P7（全局时间轴）：片段拖动被系统打断后不卡在拖动中，回到拖之前 ─────────
    if (wanted('P7')) {
      await win.locator('nav.nomi-stepper [data-mode="preview"]').first().click()
      const globalClip = win.locator('[data-testid="timeline-clip"]').first()
      await globalClip.waitFor({ state: 'visible', timeout: stationTimeout({ operations: 1 }) })
      await win.waitForTimeout(500)
      for (const kind of ['pointercancel', 'blur', 'lostpointercapture']) {
        const gb = await box(globalClip)
        const from = center(gb)
        await dragFrom(from, 60)
        const draggingBefore = await globalClip.getAttribute('data-dragging')
        await interrupt(kind, '[data-testid="timeline-clip"]')
        await win.mouse.move(from.x + 61, from.y) // 同上：先给浏览器一个真实指针事件去派发 lostpointercapture
        await win.waitForTimeout(100)
        const draggingAfter = await globalClip.getAttribute('data-dragging')
        await win.mouse.move(from.x + 120, from.y, { steps: 6 })
        await win.waitForTimeout(100)
        const draggingAfterMove = await globalClip.getAttribute('data-dragging')
        const midBox = await box(globalClip)
        await release()
        const afterBox = await box(globalClip)
        record('P7', z, `全局时间轴片段拖动被 ${kind} 打断后干净结束并回到拖之前`,
          draggingBefore === 'true' && draggingAfter === 'false' && draggingAfterMove === 'false' && Math.abs(afterBox.x - gb.x) < 1.5 && Math.abs(midBox.x - gb.x) < 1.5,
          { draggingBefore, draggingAfter, draggingAfterMove, xBefore: Math.round(gb.x), xAfter: Math.round(afterBox.x) })
      }
      await win.locator('nav.nomi-stepper [data-mode="generation"]').first().click()
      await node.waitFor({ state: 'visible', timeout: stationTimeout({ operations: 1 }) })
    }
    await snap('end')
    void persisted
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
