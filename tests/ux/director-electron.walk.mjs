// 导演台切换门 · Electron 真机走查（docs/plan/2026-09-03-director-cutover-gate.md §7 C7）。
// 用法: node tests/ux/director-electron.walk.mjs   （隔离 userData + 临时 projects；零额度，不碰任何生成 API）
// 走的是真实用户任务，不是功能探索：
//   ① 项目库「新建空白项目」→ 生成区 → 工具栏加 图片 / 视频 / 导演台 三个节点 → 「进入导演台」→ 全屏壳
//   ② 放一个角色 + 正面中景机位 → Ctrl+Shift+P 截图（真桌面桥落盘 PNG）→ 产出弹层「发送到画布」→ 退出
//      → 磁盘上的项目多一个 image 节点（meta.source=director）+ 一条 director→image reference 边
//   ③ 导演台时间轴 → POV 录制运镜 → 「录制 MP4」→ 常驻 Host 离屏采帧 → ffmpeg 拼 mp4（真 IPC）
//      → director 节点 outputs.videos 里出现桌面资产句柄（当前产品入口；不再依赖已移除的「运镜」芯片）
//   ④ 用 E2E 桥往画布塞一个带 stagingAutoCapture 的 director 节点（模拟 create_staging_reference 的下半场）
//      → StagingCaptureHost 离屏出图 → image 节点（stagingComposition）+ reference / composition_ref 两条边
//   ⑤ 关闭 App → 同隔离目录冷启动 → 从项目库重开，核对导演场景、PNG/MP4 引用及连边
// 证据 = 磁盘上的 .nomi/project.json（终态真相源，不信页面自述）+ 截图人眼核对（tests/ux/shots/director/electron/）。
// 项目走真实「新建空白项目」而不是手播种 project.json：新架构下手播种的项目没有 project agent host，打不开（project_agent_unavailable）。
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { applyColorSchemeForShot, clickOrFail, expect, expectAbsent, expectHidden, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'
import { addCameraPreset, addTrack, placeCharacter } from './_directorLab.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'
import { createBlankProject, prepareIsolation, readProjectPayload } from '../../evals/lib/isoApp.mjs'
import { stationTimeout } from './_station-budget.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/director/electron')
fs.mkdirSync(shotsDir, { recursive: true })
// 每次走查一个新隔离目录：上一轮 Electron 若还没完全退出会锁住旧目录（Windows rm EPERM）
const iso = prepareIsolation(path.join(repoRoot, '.tmp', `director-electron-walk-${Date.now().toString(36)}`), { requireCatalog: false })

let projectDir = null
/** 落盘画布（终态真相源）。 */
function readCanvas() {
  const record = projectDir ? readProjectPayload(projectDir) : null
  const canvas = record?.payload?.generationCanvas ?? record?.generationCanvas
  return { nodes: canvas?.nodes ?? [], edges: canvas?.edges ?? [] }
}
const hasEdge = (edges, from, to, mode) => edges.some((edge) => edge.source === from && edge.target === to && (!mode || edge.mode === mode))

// 读真实窗口截图中的 PiP 画面，不能以 DOM 可见或主视口骨骼就绪代替小窗已渲染。
async function countPipCharacterPixels(page) {
  const bytes = await page.getByTestId('director-pip').locator(':scope > div').nth(1).screenshot()
  return page.evaluate(async (base64) => {
    const shot = new Image()
    shot.src = `data:image/png;base64,${base64}`
    await shot.decode()
    const canvas = document.createElement('canvas')
    canvas.width = shot.width; canvas.height = shot.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.drawImage(shot, 0, 0)
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data
    let characterPixels = 0
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] > 50 && data[index] > data[index + 1] * 1.4 && data[index] > data[index + 2] * 1.2) characterPixels += 1
    }
    return characterPixels
  }, bytes.toString('base64'))
}

let shotIndex = 0
const failures = []
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
  return ok
}
const consoleErrors = []
const { app, win } = await launchNomiApp({ name: 'director-electron', userDataDir: iso.chromiumDir, settingsDir: iso.settingsDir, projectsDir: iso.projectsDir })
const snap = async (label) => {
  shotIndex += 1
  const file = path.join(shotsDir, `${String(shotIndex).padStart(2, '0')}-${label}.png`)
  await screenshotSettled(win, { path: file })
  console.log(`  · shot ${path.relative(repoRoot, file)}`)
}
win.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
win.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.stack || error.message}`))
// 半路断言失败：把渲染层 console error 一起吐出来并关掉 App（别留孤儿 Electron 占单实例锁，下一次走查会被它顶回项目库）
process.on('unhandledRejection', async (error) => {
  console.error(error?.stack || String(error))
  if (consoleErrors.length) console.error(`renderer console errors (${consoleErrors.length}):\n  ${consoleErrors.slice(0, 8).join('\n  ')}`)
  await app.close().catch(() => {})
  process.exit(1)
})
await win.evaluate(() => {
  for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) window.localStorage.setItem(key, 'seen')
  window.localStorage.setItem('__nomiE2E', '1')
})
await win.reload()
await expectVisible(win.getByText('新建空白项目', { exact: false }).first(), '项目库没起来', stationTimeout({ operations: 4 }))
const libraryEntry = win.getByText('新建空白项目', { exact: false }).first()
const libraryProof = await proveProbe(libraryEntry, '项目库的新建入口')
await snap('library')

// ① 新建空白项目 → 生成区 → 工具栏三个节点
projectDir = await createBlankProject(win, iso.projectsDir)
console.log(`  · project ${path.relative(repoRoot, projectDir)}`)
// createBlankProject 在项目目录落盘那一刻就返回，工作台可能还没渲染：先等「生成」页签真出现再点，别把点击吞掉
const generateTab = win.getByRole('button', { name: '生成', exact: true }).first()
await expectVisible(generateTab, '新建项目后工作台没打开（没有「生成」页签）', stationTimeout({ operations: 4 }))
await clickOrFail(generateTab, '顶栏·生成页签')
const boardCta = win.locator('button[aria-label^="新建一个"][aria-label$="节点"]').first()
if (await boardCta.count()) await boardCta.click({ timeout: stationTimeout() }).catch(() => {})
await win.keyboard.press('Escape').catch(() => {})
await win.mouse.click(60, 520).catch(() => {}) // 收起「上手 4 步」浮层
// 点法收口在 _canvasRail：加号自 2026-09-06「第三档」起 5 常驻 + 「更多」，导演台住「更多」里；找不到当场抛（不再按 aria-label 直点）
await addCanvasNodeFromRail(win, 'image')
await addCanvasNodeFromRail(win, 'video')
const directorPlacement = await addCanvasNodeFromRail(win, 'director')
check('① 导演台节点在左缘「更多」里上架', directorPlacement === 'more', directorPlacement)
const directorCard = win.locator('[data-testid="director-node"]').first()
await expectVisible(directorCard, '点了添加，画布上没出 director 节点卡')
// 三个节点是连点三下加出来的，落盘节奏不定：轮询磁盘直到三种节点都在（不拿 revision 静默当完成）
let seeded = []
await expect.poll(() => {
  seeded = readCanvas().nodes
  return [...new Set(seeded.map((node) => node.kind))].sort()
}, { timeout: stationTimeout({ operations: 2 }), intervals: [1000] }).toEqual(['director', 'image', 'video'])
const IMAGE_ID = seeded.find((node) => node.kind === 'image')?.id ?? null
const VIDEO_ID = seeded.find((node) => node.kind === 'video')?.id ?? null
const DIRECTOR_ID = seeded.find((node) => node.kind === 'director')?.id ?? null
check('① 三个节点落盘（image / video / director）', Boolean(IMAGE_ID && VIDEO_ID && DIRECTOR_ID), seeded.map((node) => node.kind).join(','))
await snap('canvas')

// 进导演台
await clickOrFail(win.locator('[data-testid="director-node-open"]').first(), '节点卡·进入导演台')
const editor = win.locator('[data-testid="director-editor"]')
await expectVisible(editor, '全屏导演台没打开', stationTimeout({ operations: 2 }))
await win.waitForFunction(() => Boolean(window.__nomiDirectorE2E), null, { timeout: stationTimeout({ operations: 4 }) })
await expectVisible(win.getByTestId('director-pip'), '导演台画中画没渲染出来', stationTimeout({ operations: 4 }))
check('① 进入全屏导演台', true)
await snap('editor-open')

// ② 放角色 + 机位 → 截图 → 发送到画布 → 退出
const lab = {
  page: win,
  bridge: (method, ...args) => win.evaluate(([name, list]) => {
    const bridge = window.__nomiDirectorE2E
    return bridge && typeof bridge[name] === 'function' ? bridge[name](...list) : null
  }, [method, args]),
}
// 刚进编辑器视口要过几帧才能投影：等取证桥真能把世界原点投到画布像素（不是 sleep）
await win.waitForFunction(() => {
  const bridge = window.__nomiDirectorE2E
  const point = bridge && typeof bridge.projectPoint === 'function' ? bridge.projectPoint(0, 0, 0) : null
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y))
}, null, { timeout: stationTimeout({ operations: 2 }) })
await placeCharacter(lab, 'female', 0, 0)
const characterRow = win.locator('[data-testid="director-outliner-row"]', { hasText: '角色' }).first()
await expectVisible(characterRow, '大纲里没出现放下的角色')
await clickOrFail(characterRow, '大纲·角色行（机位预设相对选中主体）')
await addCameraPreset(lab, '正面中景')
await expectVisible(win.locator('[data-testid="director-outliner-row"]', { hasText: '正面中景' }).first(), '大纲里没出现机位（预设机位叫预设名）')
await expect.poll(() => countPipCharacterPixels(win), { timeout: stationTimeout() }).toBeGreaterThan(100)
await snap('scene-built')
// 本次生成的真实 Electron renderer：新建路径片段后检查双主题下的选中配色，避免只在 devlab 验样式。
const characterName = (await characterRow.innerText()).trim()
await addTrack(lab, characterName)
const pathClip = win.locator('[data-clip-id][title^="路径片段"]').first()
await expectVisible(pathClip, '给角色添加轨道后没有路径片段')
await pathClip.click()
const originalTheme = await win.evaluate(() => document.documentElement.getAttribute('data-mantine-color-scheme'))
// 浏览器可以把白色序列化为 OKLCH；以最终像素通道断言，不依赖颜色字符串格式。
const readPathClipColors = () => pathClip.evaluate(element => {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const rgba = value => {
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = value
    context.fillRect(0, 0, 1, 1)
    return Array.from(context.getImageData(0, 0, 1, 1).data)
  }
  return {
    label: rgba(getComputedStyle(element.querySelector('span')).color),
    border: rgba(getComputedStyle(element).borderTopColor),
    background: rgba(getComputedStyle(element).backgroundColor),
  }
})
const selectedPathColors = { label: [255, 255, 255, 255], border: [255, 255, 255, 255], background: [0, 132, 209, 255] }
for (const theme of ['light', 'dark']) {
  await applyColorSchemeForShot(win, theme)
  await win.mouse.move(0, 0)
  await expect.poll(readPathClipColors).toEqual(selectedPathColors)
  await pathClip.hover()
  await expect.poll(readPathClipColors).toEqual(selectedPathColors)
  await snap(`clip-colors-${theme}`)
  check(`② ${theme} 主题：选中片段白字白边、悬停保持不透明底色`, true)
}
await applyColorSchemeForShot(win, originalTheme)
// The production binding uses the platform's primary modifier: ⌘ on macOS, Ctrl elsewhere.
await win.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P')
const screenshotToast = win.locator('[role="alert"], [role="status"]', { hasText: '已截图' }).first()
await expectVisible(screenshotToast, '按 Ctrl+Shift+P 后没有「已截图」提示（桌面落盘桥没工作？）', stationTimeout({ operations: 2 }))
check('② 截图经桌面桥落盘', true)
await clickOrFail(win.getByRole('button', { name: /^产出 1$/ }), '时间轴·产出 1')
await snap('outputs-open')
await clickOrFail(win.locator('[aria-label="发送到画布"]').first(), '产出弹层·发送到画布')
await expectVisible(win.locator('[role="alert"], [role="status"]', { hasText: '已发送到画布' }).first(), '没有「已发送到画布」提示')
await snap('outputs-sent')
await clickOrFail(win.locator('[data-testid="director-exit"]').first(), '顶栏·退出')
const confirmExit = win.locator('[data-confirm-dialog-confirm="true"]').last()
if (await confirmExit.isVisible().catch(() => false)) await confirmExit.click()
await expectHidden(editor, '点退出后全屏壳还在')
await snap('back-to-canvas')
const sent = await expect.poll(() => {
  const { nodes, edges } = readCanvas()
  const shot = nodes.find((node) => node.kind === 'image' && node.meta?.source === 'director')
  return Boolean(shot && shot.result?.url && hasEdge(edges, DIRECTOR_ID, shot.id, 'reference'))
}, { timeout: stationTimeout({ operations: 2 }), intervals: [1000] }).toBe(true).then(() => true, () => false)
check('② 截图落成画布 image 节点 + reference 边（磁盘）', sent)

// ③ 当前产品入口：回到原导演台，进入节目机位，用真实鼠标录一段运镜，再从时间轴录 MP4。
// 「运镜」composer 芯片已从视频/图片节点移除；以真实 Director 时间轴入口覆盖同一条桌面编码链路。
await clickOrFail(win.locator(`[data-node-id="${DIRECTOR_ID}"]`).getByTestId('director-node-open'), '画布·重开导演台')
await expectVisible(win.getByTestId('director-editor'), '时间轴录制前导演台没有重开')
// 机位刚创建时不一定已在时间轴；沿用户可见的「添加轨道」入口把它挂上，避免只在内存里录一段孤立 POV。
await clickOrFail(win.getByTestId('director-timeline-tracks-header').getByRole('button', { name: /添加轨道/ }), '时间轴·添加机位轨道')
const trackPopover = win.locator('[role="dialog"]').last()
await clickOrFail(trackPopover.getByText('正面中景', { exact: true }), '时间轴·添加正面中景轨道')
await expectVisible(win.getByTestId('director-timeline-track').filter({ hasText: '正面中景' }).first(), '正面中景没有进入时间轴')
const reopenedPip = win.getByTestId('director-pip')
await clickOrFail(reopenedPip.getByRole('button', { name: '进入视角' }), '画中画·进入视角（时间轴录制）')
await expectVisible(win.getByTestId('director-pov-hud'), '时间轴录制前没有进入节目机位')
const povRecordButton = win.getByTestId('director-pov-hud').getByRole('button', { name: /录制运镜/ })
await clickOrFail(povRecordButton, 'POV·录制运镜')
await expectVisible(win.getByTestId('director-pov-hud').getByRole('status'), 'POV 没进入录制状态')
await win.mouse.move(600, 300)
await win.mouse.down()
for (let index = 1; index <= 20; index += 1) {
  await win.mouse.move(600 + index * 10, 300 + index * 2)
  await win.waitForTimeout(80)
}
await win.mouse.up()
await win.waitForTimeout(600)
await clickOrFail(win.getByTestId('director-pov-hud').getByRole('button', { name: '完成录制' }), 'POV·完成录制')
await clickOrFail(win.getByTestId('director-pov-hud').getByRole('button', { name: '退出机位' }), 'HUD·退出机位（时间轴录制）')
await expectHidden(win.getByTestId('director-pov-hud'), '退出节目机位后 POV HUD 还在')
const recordButton = win.getByTestId('director-timeline-header').getByRole('button', { name: '录制 MP4', exact: true })
await clickOrFail(recordButton, '时间轴·录制 MP4')
await expectVisible(win.getByTestId('director-timeline-header').getByText(/录制中 \d+ \/ \d+ 帧/), '录制 MP4 没进入真实采样状态')
await snap('recording-progress')
const recordedVideo = await expect.poll(() => {
  const { nodes } = readCanvas()
  const videos = nodes.find((node) => node.id === DIRECTOR_ID)?.meta?.directorProject?.outputs?.videos ?? []
  return videos.find((video) => typeof video.assetUrl === 'string' && video.assetUrl.length > 0 && !/^(data|blob):/.test(video.assetUrl)) ?? null
}, { timeout: stationTimeout({ operations: 30 }), intervals: [3000] }).toBeTruthy().then(() => true, () => false)
check('③ 时间轴录制 MP4 经过桌面桥落盘为 durable asset', recordedVideo, recordedVideo ? '' : JSON.stringify(readCanvas().nodes.find((node) => node.id === DIRECTOR_ID)?.meta?.directorProject?.outputs))
await snap('timeline-video-done')
// 录制完成后路径片段仍保持选中；先清掉时间轴选择，再走顶栏退出确认，避免指针被检查器层吞掉。
await win.keyboard.press('Escape').catch(() => {})
await clickOrFail(win.locator('[data-testid="director-exit"]').first(), '顶栏·退出（时间轴录制后）')
const timelineConfirmExit = win.locator('[data-confirm-dialog-confirm="true"]').last()
if (await timelineConfirmExit.isVisible().catch(() => false)) await timelineConfirmExit.click()
else {
  await win.keyboard.press('Escape')
  await expectVisible(timelineConfirmExit, '时间轴录制后没有出现退出确认')
  await timelineConfirmExit.click()
}
await expectHidden(win.getByTestId('director-editor'), '时间轴录制后导演台没有退出')

// ④ 站位参考：塞一个带 stagingAutoCapture 的 director 节点（工程直接借运镜参考那份），Host 出图 + 连边
const stagingNodeId = await win.evaluate((targetId) => {
  const store = window.__nomiCanvasStore
  if (!store) return null
  const state = store.getState()
  const source = state.nodes.find((node) => node.kind === 'director' && node.meta?.directorProject)
  if (!source) return null
  const created = state.addNode({
    kind: 'director',
    title: '站位参考',
    prompt: '',
    position: { x: 120, y: 620 },
    meta: { directorProject: source.meta.directorProject, stagingAutoCapture: { targetNodeId: targetId } },
  })
  return created.id
}, IMAGE_ID)
check('④ E2E 桥能塞入待出图的 director 节点', Boolean(stagingNodeId))
const staged = stagingNodeId
  ? await expect.poll(() => {
    const { nodes, edges } = readCanvas()
    const shot = nodes.find((node) => node.kind === 'image' && node.meta?.stagingComposition === true)
    const staging = nodes.find((node) => node.id === stagingNodeId)
    return Boolean(shot && staging && !staging.meta?.stagingAutoCapture && hasEdge(edges, stagingNodeId, shot.id, 'reference') && hasEdge(edges, shot.id, IMAGE_ID, 'composition_ref'))
  }, { timeout: stationTimeout({ operations: 8 }), intervals: [2000] }).toBe(true).then(() => true, () => false)
  : false
check('④ 站位参考离屏出图 → image 节点 + reference / composition_ref 边（磁盘）', staged)
await snap('staging-done')

// 真锁把保存保持在途；连续返回不能绕过第一次正在等待的持久化回执。
const { acquireWorkspaceManifestLock, releaseWorkspaceManifestLock } = createRequire(import.meta.url)(path.join(repoRoot, 'dist-electron/workspace/workspaceManifestLock.js'))
const beforeLeaveIds = readCanvas().nodes.map((node) => node.id)
const heldLease = await acquireWorkspaceManifestLock(projectDir, { ownerId: 'director-walk-leave-proof' })
try {
  await clickOrFail(win.locator('[data-node-kind="image"]').first(), '返回前添加待保存图片节点')
  await expect.poll(() => win.evaluate(() => window.__nomiCanvasStore?.getState().nodes.length)).toBe(beforeLeaveIds.length + 1)
  await win.getByRole('button', { name: '返回项目库', exact: true }).dblclick()
  await expectAbsent(libraryEntry, { provenBy: libraryProof, message: '保存持锁等待时双击返回不能提前进入项目库' })
  await expectVisible(win.getByRole('button', { name: '生成', exact: true }), '保存等待期间工作台应保持打开')
} finally {
  releaseWorkspaceManifestLock(heldLease)
}
await expectVisible(libraryEntry, '锁释放且保存完成后没有返回项目库', stationTimeout({ operations: 2 }))
const afterLeave = readCanvas()
expect(afterLeave.nodes).toHaveLength(beforeLeaveIds.length + 1)
expect(afterLeave.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(beforeLeaveIds))
check('⑤ 保存等待期间双击返回仍保留工作台，释放锁后保存完成再返回库', true)

// 冷启动从磁盘恢复，不能用同一个 store 的内存证明保存成功。
const savedCanvas = readCanvas()
await app.close()
const restarted = await launchNomiApp({ name: 'director-electron-reopen', userDataDir: iso.chromiumDir, settingsDir: iso.settingsDir, projectsDir: iso.projectsDir })
try {
  const reopened = restarted.win
  reopened.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  reopened.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.stack || error.message}`))
  const projectCard = reopened.locator('[data-project-card="true"]')
  await expect(projectCard).toHaveCount(1, { timeout: stationTimeout({ operations: 2 }) })
  await projectCard.press('Enter')
  await clickOrFail(reopened.getByRole('button', { name: '生成', exact: true }), '冷启动重开生成区')
  const expectedNodes = savedCanvas.nodes.map((node) => expect.objectContaining({
    id: node.id,
    kind: node.kind,
    ...(node.kind === 'director' ? { meta: expect.objectContaining({
      directorProject: node.meta.directorProject,
      ...(node.meta.cameraMoveVideo ? { cameraMoveVideo: node.meta.cameraMoveVideo } : {}),
    }) } : {}),
    ...(node.result?.url ? { result: expect.objectContaining({ url: node.result.url }) } : {}),
  }))
  let restored = null
  await expect.poll(async () => {
    restored = await reopened.evaluate(() => {
      const state = window.__nomiCanvasStore?.getState()
      return { nodes: state?.nodes ?? [], edges: state?.edges ?? [] }
    })
    return restored
  }, { timeout: stationTimeout({ operations: 2 }) }).toEqual({ nodes: expect.arrayContaining(expectedNodes), edges: savedCanvas.edges })
  expect(restored.nodes).toHaveLength(savedCanvas.nodes.length)
  await clickOrFail(reopened.getByRole('button', { name: '适应视图' }).first(), '冷启动画布适应视图')
  const sentImageId = savedCanvas.nodes.find((node) => node.meta?.source === 'director' && node.kind === 'image').id
  const restoredImage = reopened.locator(`[data-node-id="${sentImageId}"] img`).first()
  await expectVisible(restoredImage, '冷启动后导演截图没有在画布显示')
  await expect.poll(() => restoredImage.evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true)
  await screenshotSettled(reopened, { path: path.join(shotsDir, '13-saved-reopened.png') })
  await clickOrFail(reopened.locator(`[data-node-id="${DIRECTOR_ID}"]`).getByTestId('director-node-open'), '冷启动重开原导演场景')
  await expectVisible(reopened.getByTestId('director-outliner-row').filter({ hasText: '角色' }).first(), '冷启动后导演角色未恢复')
  await expectVisible(reopened.getByTestId('director-outliner-row').filter({ hasText: '正面中景' }).first(), '冷启动后机位未恢复')
  const savedCharacter = savedCanvas.nodes.find((node) => node.id === DIRECTOR_ID).meta.directorProject.scenes
    .flatMap((scene) => scene.objects).find((object) => object.type === 'character')
  await reopened.waitForFunction((id) => {
    const extent = window.__nomiDirectorE2E?.boneExtentByEntity(id)
    return extent && extent.maxY - extent.minY > 1
  }, savedCharacter.id)
  await expect.poll(() => countPipCharacterPixels(reopened), { timeout: stationTimeout() }).toBeGreaterThan(100)
  await screenshotSettled(reopened, { path: path.join(shotsDir, '14-director-reopened.png') })
  check('⑤ 冷启动重开保留导演场景、PNG/MP4引用与连边', true)
} finally {
  await restarted.app.close()
}
check('无 console error', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '))
console.log(`\n截图在 ${shotsDir}`)
if (failures.length) {
  console.error(`✗ director-electron：${failures.length} 项失败 —— ${failures.join(' / ')}`)
  process.exit(1)
}
console.log('✓ director-electron：全部通过')
