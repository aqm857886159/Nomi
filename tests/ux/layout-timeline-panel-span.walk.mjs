// R13/R16 走查：生成面底部带横贯整个工作区，右侧 AI 面板被它顶上去，右下角不空。
//
// 真实用户任务（2026-09-13 19:27 真机反馈原话）：「打开右侧 AI 栏和中间的时间轴之后页面被
// 切割……不小心点了下面的时间轴收不回去了，本来我记得可以收回，而且排版都错了，怎么右下角
// 缺了一大块，本来不是他在右面通过去吗，另外就是拉上来太大了，这里核心是拖动后面可以预览，
// 主要有两个轨道一个图片一个视频可以预览就行。」
//
// 走的是一个想「边看画布边看时间线」的创作者：开着 Nomi 面板 → 从画布底部把时间轴叫出来
// → 看两条轨（图片 + 视频）够不够看 → 觉得面板挡事就收起面板 → 最后把时间轴也收回去。
// 每一步都量真实矩形，四态各一张截图。零额度：只喂持久化的 timeline 元数据，不生成、不解码媒体。
//
// Run: pnpm run build && node tests/ux/layout-timeline-panel-span.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expect, expectAbsent, proveProbe, screenshotSettled, DEFAULT_TIMEOUT_MS } from './_assert.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/layout-timeline-panel-span')
fs.mkdirSync(shotsDir, { recursive: true })

/**
 * 生产侧真相源是 `timelinePanelBounds.TIMELINE_PANEL_DEFAULT`（由「内边距 + 工具条行 +
 * 标尺行 + 两条主轨行」派生）。这里写死同一个数当**独立**对账：走查从 UI 读 aria-valuenow，
 * 两边都错成同一个值的概率远低于抄同一个常量。
 */
const EXPECTED_DEFAULT_HEIGHT = 230
/** 主窗最小宽（electron/main.ts）之上的一个常规窗口，两态都够宽。 */
const WINDOW = { width: 1440, height: 920 }

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-layout-span-'))
const userDataDir = path.join(root, 'user-data')
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const capabilityDir = path.join(root, 'capability')
for (const dir of [userDataDir, settingsDir, projectsDir, capabilityDir]) fs.mkdirSync(dir, { recursive: true })

const projectId = 'layout-span-walk'
const projectRoot = path.join(projectsDir, projectId)
const projectManifestDir = path.join(projectRoot, '.nomi')
fs.mkdirSync(projectManifestDir, { recursive: true })

const makeClip = (id, label, startFrame, endFrame) => ({
  id,
  type: 'video',
  sourceNodeId: `node-${id}`,
  label,
  startFrame,
  endFrame,
  frameCount: endFrame - startFrame,
  offsetStartFrame: 0,
  offsetEndFrame: 0,
})

const timeline = {
  version: 1,
  fps: 30,
  scale: 1.5,
  playheadFrame: 0,
  tracks: [
    { id: 'imageTrack', type: 'image', label: '图片轨', clips: [] },
    {
      id: 'videoTrack',
      type: 'video',
      label: '视频轨',
      clips: [makeClip('clip-a', '开场远景', 0, 120), makeClip('clip-b', '推门近景', 120, 240)],
    },
    { id: 'audioTrack', type: 'audio', label: '音频轨', clips: [] },
  ],
  textClips: [],
  transitions: [],
}

const workbenchDocument = { version: 1, title: '底部带布局验收片', updatedAt: 1, contentJson: { type: 'doc', content: [] } }
const generationCanvas = { nodes: [], edges: [], selectedNodeIds: [], groups: [] }
const payload = { workbenchDocument, timeline, generationCanvas, storyboardPlan: null, storyboardPlanCommitted: false }
const project = {
  id: projectId,
  name: '底部带布局验收片',
  version: 2,
  createdAt: 1,
  updatedAt: 1,
  savedAt: 1,
  revision: 1,
  lastKnownRootPath: projectRoot,
  workbenchDocument,
  timeline,
  generationCanvas,
  payload,
}
fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2))
fs.writeFileSync(path.join(projectManifestDir, 'project.json'), JSON.stringify(project, null, 2))

const launched = await launchNomiApp({
  name: 'layout-timeline-panel-span',
  userDataDir,
  settingsDir,
  projectsDir,
  capabilityDir,
  timeout: 300_000,
})
const { app } = launched
let win = launched.win
win.on('console', (message) => {
  if (message.type() === 'error') console.log(`[renderer:error] ${message.text()}`)
})
win.on('pageerror', (error) => console.log(`[renderer:pageerror] ${error.message}`))

async function resize(width, height) {
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate(
    (windowRef, bounds) => {
      windowRef.setBounds({ x: 0, y: 0, ...bounds })
      windowRef.center()
    },
    { width, height },
  )
  await win.waitForTimeout(300)
}

/**
 * 量生成面外壳三件（画布 / 助手面板 / 底部带）与工作区容器的真实几何关系。
 *
 * 两个阳性对照，缺一这份量具就可能恒真：
 *   · `selfCheck.covers` —— 「这个点被这块矩形盖住了吗」判据必须把自己中心判成 true；
 *   · `selfCheck.rejects` —— 同一个判据必须把工作区**外面**一个点判成 false。
 * 两条都过，后面「右下角被底部带盖住」才是一句有内容的话（同 timeline-toolbar-row 的写法）。
 *
 * 助手面板按 DOM 包含关系限定在生成面那一棵里：生成面与剪辑面是 keep-alive 同时挂载的，
 * `[data-assistant-pane]` 全窗有两个，不限定就会量到隐藏的那一个（有 DOM 没几何）。
 */
async function measureShellGeometry(win) {
  return win.evaluate(() => {
    const section = document.querySelector('.workbench-generation')
    if (!section) return null
    const box = (element) => {
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, w: rect.width, h: rect.height }
    }
    const covers = (rect, point) => Boolean(rect)
      && point.x >= rect.left - 0.5 && point.x <= rect.right + 0.5
      && point.y >= rect.top - 0.5 && point.y <= rect.bottom + 0.5
    const sectionBox = box(section)
    const canvas = box(section.querySelector('.workbench-generation__canvas'))
    // 停靠态与收起态是两种几何：收起时 AssistantPane 改成 `absolute inset-0` 的浮层
    // （AssistantPane.tsx），而它的定位祖先就是整个工作区 —— 那时它的矩形等于工作区，
    // 拿它判「面板收没收起」永远判不出来。真相源是工作区自己声明的 data-ai-layout。
    const aiLayout = section.getAttribute('data-ai-layout')
    const assistant = aiLayout === 'sidebar' ? box(section.querySelector('[data-assistant-pane]')) : null
    const timelineHost = box(section.querySelector('.workbench-generation__timeline'))
    const timelinePanel = box(section.querySelector('.workbench-generation__timeline .workbench-timeline'))
    const appBarRight = box(document.querySelector('.nomi-appbar__right'))
    const tracks = section.querySelector('.workbench-generation__timeline .workbench-timeline__tracks')
    const trackRows = {}
    for (const id of ['imageTrack', 'videoTrack']) {
      trackRows[id] = box(section.querySelector(`.workbench-generation__timeline [data-track-id="${id}"]`))
    }
    // 右下角与右上角的探针点：贴着工作区边界往里 4px，不取角点本身（边框那一像素不算内容）。
    const bottomRight = { x: sectionBox.right - 4, y: sectionBox.bottom - 4 }
    const bottomLeft = { x: sectionBox.left + 4, y: sectionBox.bottom - 4 }
    const parts = [canvas, assistant, timelineHost].filter(Boolean)
    const coveredBy = (point) => parts.some((rect) => covers(rect, point))
    const intersects = (a, b) => Boolean(a && b) && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      aiLayout,
      section: sectionBox,
      canvas,
      assistant,
      timelineHost,
      timelinePanel,
      appBarRight,
      trackRows,
      tracksViewport: tracks
        ? { top: tracks.getBoundingClientRect().top, bottom: tracks.getBoundingClientRect().top + tracks.clientHeight, scrollTop: tracks.scrollTop }
        : null,
      bottomRightCovered: coveredBy(bottomRight),
      bottomRightInTimeline: covers(timelineHost, bottomRight),
      bottomLeftInTimeline: covers(timelineHost, bottomLeft),
      appBarOverlapsAssistant: intersects(appBarRight, assistant),
      appBarOverlapsTimeline: intersects(appBarRight, timelineHost),
      selfCheck: {
        covers: covers(sectionBox, { x: (sectionBox.left + sectionBox.right) / 2, y: (sectionBox.top + sectionBox.bottom) / 2 }),
        rejects: covers(sectionBox, { x: sectionBox.left - 40, y: sectionBox.top - 40 }),
        intersectsSelf: intersects(sectionBox, sectionBox),
      },
    }
  })
}

/** 每一态都先过阳性对照，再谈那一态的结论。 */
function assertInstrumentsAlive(geometry, state) {
  expect(geometry, `${state}：量不到生成面外壳几何`).not.toBeNull()
  expect(geometry.selfCheck.covers, `${state}：覆盖判据把自己的中心判成没盖住（量具坏了）`).toBe(true)
  expect(geometry.selfCheck.rejects, `${state}：覆盖判据把工作区外的点判成盖住了（量具恒真）`).toBe(false)
  expect(geometry.selfCheck.intersectsSelf, `${state}：相交判据自身失效`).toBe(true)
  expect(geometry.section.w, `${state}：工作区没有可见宽度`).toBeGreaterThan(400)
}

/** 展开态共有的三条结论：横贯 / 面板被顶上去 / 右下角不空。 */
function assertBottomBandSpans(geometry, state) {
  expect(
    Math.abs(geometry.timelineHost.w - geometry.section.w) <= 1,
    `${state}：底部带没有横贯工作区（timeline.w=${geometry.timelineHost.w} section.w=${geometry.section.w}）`,
  ).toBe(true)
  expect(
    Math.abs(geometry.timelineHost.right - geometry.section.right) <= 1,
    `${state}：底部带右缘没顶到工作区右缘（timeline.right=${geometry.timelineHost.right} section.right=${geometry.section.right}）`,
  ).toBe(true)
  expect(
    Math.abs(geometry.timelineHost.right - geometry.viewport.w) <= 1,
    `${state}：底部带没「在右面通过去」——右缘没到窗口右边（timeline.right=${geometry.timelineHost.right} viewport=${geometry.viewport.w}）`,
  ).toBe(true)
  expect(geometry.bottomRightInTimeline, `${state}：工作区右下角那一块不是底部带（就是用户说的「缺了一大块」）`).toBe(true)
  expect(geometry.bottomLeftInTimeline, `${state}：工作区左下角那一块不是底部带`).toBe(true)
  expect(geometry.bottomRightCovered, `${state}：右下角没有任何一块外壳盖住`).toBe(true)
  expect(geometry.appBarOverlapsTimeline, `${state}：顶栏右侧功能区与底部带相交`).toBe(false)
}

try {
  await win.evaluate(() => {
    localStorage.setItem('nomi-color-scheme', 'light')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
      localStorage.setItem(key, 'seen')
    }
  })
  await win.reload()
  await resize(WINDOW.width, WINDOW.height)

  const projectCard = win.locator('[data-project-card="true"]').filter({ hasText: '底部带布局验收片' }).first()
  await expect(projectCard, '夹具项目卡没出现').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await projectCard.hover()
  await clickOrFail(projectCard.getByRole('button', { name: /继续创作/ }).first(), '打开底部带布局验收片')
  await expect
    .poll(() => app.windows().some((candidate) => /[?&]projectId=/.test(candidate.url())), {
      message: '项目窗口没打开',
      timeout: DEFAULT_TIMEOUT_MS,
    })
    .toBe(true)
  win = app.windows().find((candidate) => /[?&]projectId=/.test(candidate.url())) ?? win
  await win.waitForLoadState('domcontentloaded')
  await resize(WINDOW.width, WINDOW.height)

  await clickOrFail(win.locator('nav.nomi-stepper [data-mode="generation"]').first(), '进入生成画布')

  const panel = win.locator('.workbench-generation__timeline .workbench-timeline').first()
  const capsule = win.locator('.workbench-generation__timeline-handle')
  const assistantPane = win.locator('.workbench-generation [data-assistant-pane]').first()

  // ① 只开面板（时间轴默认收起）：面板拿满内容行，底部带不占高度。
  await expect(assistantPane, '① Nomi 面板没停靠').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await expect(capsule, '① 折叠态底部把手没出现').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  const panelOnly = await measureShellGeometry(win)
  assertInstrumentsAlive(panelOnly, '① 只开面板')
  expect(panelOnly.timelineHost.h, '① 时间轴收起时底部带不该占高度').toBeLessThanOrEqual(1)
  expect(
    Math.abs(panelOnly.assistant.bottom - panelOnly.section.bottom) <= 2,
    `① 时间轴收起时面板应当一路到底（assistant.bottom=${panelOnly.assistant.bottom} section.bottom=${panelOnly.section.bottom}）`,
  ).toBe(true)
  expect(panelOnly.appBarOverlapsAssistant, '① 顶栏右侧功能区被 Nomi 面板压住').toBe(false)
  expect(panelOnly.bottomRightCovered, '① 右下角没有任何一块外壳盖住').toBe(true)
  await screenshotSettled(win, { path: path.join(shotsDir, '01-panel-only.png') })

  // ③ 两个都开（用户报错的那一态）：从画布底部把时间轴叫出来。
  await clickOrFail(capsule, '展开时间轴')
  await expect(panel, '时间轴面板没展开').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  const both = await measureShellGeometry(win)
  assertInstrumentsAlive(both, '③ 两个都开')
  assertBottomBandSpans(both, '③ 两个都开')
  expect(
    both.assistant.bottom <= both.timelineHost.top + 1,
    `③ 面板没被底部带顶上去（assistant.bottom=${both.assistant.bottom} timeline.top=${both.timelineHost.top}）`,
  ).toBe(true)
  expect(
    Math.abs(both.canvas.bottom - both.timelineHost.top) <= 2,
    `③ 画布底边应当与底部带顶边贴合（canvas.bottom=${both.canvas.bottom} timeline.top=${both.timelineHost.top}）`,
  ).toBe(true)
  expect(both.appBarOverlapsAssistant, '③ 顶栏右侧功能区被 Nomi 面板压住').toBe(false)
  // 三块的面积之和 ≈ 工作区面积：没有第四块、也没有空格子。
  const areaOf = (rect) => rect.w * rect.h
  const union = areaOf(both.canvas) + areaOf(both.assistant) + areaOf(both.timelineHost)
  expect(
    Math.abs(union - areaOf(both.section)) / areaOf(both.section) < 0.01,
    `③ 画布+面板+底部带没覆盖满工作区（并集 ${Math.round(union)} vs 工作区 ${Math.round(areaOf(both.section))}）`,
  ).toBe(true)
  console.log('[几何证据] 两个都开', JSON.stringify({ section: both.section, canvas: both.canvas, assistant: both.assistant, timeline: both.timelineHost }))
  await screenshotSettled(win, { path: path.join(shotsDir, '03-both-open.png') })

  // ③b 默认高度：刚展开、一次都没拖过，就该刚好看得见两条主轨。
  const resizeHandle = win.locator('.workbench-generation__timeline [role="separator"][aria-orientation="horizontal"]').first()
  await expect(resizeHandle, '时间轴拖把手没渲染').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await expect(resizeHandle, `③b 默认展开高度应当是派生值 ${EXPECTED_DEFAULT_HEIGHT}`).toHaveAttribute(
    'aria-valuenow',
    String(EXPECTED_DEFAULT_HEIGHT),
    { timeout: DEFAULT_TIMEOUT_MS },
  )
  for (const id of ['imageTrack', 'videoTrack']) {
    const row = both.trackRows[id]
    expect(row, `③b ${id} 没渲染`).not.toBeNull()
    expect(
      row.bottom <= both.tracksViewport.bottom + 1,
      `③b ${id} 被轨道视口裁掉了——默认高度装不下两条主轨（row.bottom=${row.bottom} viewport.bottom=${both.tracksViewport.bottom}）`,
    ).toBe(true)
  }
  expect(both.tracksViewport.scrollTop, '③b 默认态不该已经滚动过（说明内容装不下）').toBe(0)
  console.log('[高度证据] 默认展开高度与两条主轨', JSON.stringify({ height: both.timelineHost.h, tracksViewport: both.tracksViewport, trackRows: both.trackRows }))

  // ② 只开时间轴：收起 Nomi 面板。底部带的宽度**一像素都不许变**（用户说的「跟着左右变动」）。
  await clickOrFail(win.locator('.workbench-generation [data-v4-control="collapse"]').first(), '收起 Nomi 面板')
  await expect(
    win.locator('.workbench-generation').first(),
    '② Nomi 面板没收起（工作区还声明自己是停靠态）',
  ).toHaveAttribute('data-ai-layout', 'overlay', { timeout: DEFAULT_TIMEOUT_MS })
  // 停靠列宽度走 framer-motion 弹簧（ASSISTANT_LAYOUT_SPRING），属性一翻转时画布还在半路上。
  // 等的是**状态判据**「画布已经拿满工作区宽」，不是一段墙钟。
  await expect
    .poll(async () => {
      const probe = await measureShellGeometry(win)
      return Math.round(probe.section.w - probe.canvas.w)
    }, { message: '② 收起面板后画布没拿满工作区宽（弹簧没安定）', timeout: DEFAULT_TIMEOUT_MS })
    .toBeLessThanOrEqual(1)
  const timelineOnly = await measureShellGeometry(win)
  assertInstrumentsAlive(timelineOnly, '② 只开时间轴')
  assertBottomBandSpans(timelineOnly, '② 只开时间轴')
  expect(
    Math.abs(timelineOnly.timelineHost.w - both.timelineHost.w) <= 1,
    `② 底部带宽度随面板开关变了（开面板 ${both.timelineHost.w} → 收面板 ${timelineOnly.timelineHost.w}）`
      + '：这就是「时间轴跟着右侧面板左右变动遮挡左边」',
  ).toBe(true)
  expect(
    Math.abs(timelineOnly.timelineHost.left - both.timelineHost.left) <= 1,
    `② 底部带左缘随面板开关移动了（${both.timelineHost.left} → ${timelineOnly.timelineHost.left}）`,
  ).toBe(true)
  expect(
    timelineOnly.canvas.w > both.canvas.w + 40,
    `② 收起面板后画布没真的变宽（${both.canvas.w} → ${timelineOnly.canvas.w}），这一段就没测到东西`,
  ).toBe(true)
  await screenshotSettled(win, { path: path.join(shotsDir, '02-timeline-only.png') })

  // ④ 收起时间轴：面板内那颗钉住的收起钮点得着，整块让路，底部把手回来。
  const collapseButton = win.locator('.workbench-generation__timeline [data-timeline-collapse]').first()
  await expect(collapseButton, '④ 面板内的收起钮没渲染').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  const collapseBox = await collapseButton.boundingBox()
  const tailBox = await win.locator('.workbench-generation__timeline .workbench-timeline__controls-tail').first().boundingBox()
  expect(collapseBox, '④ 收起钮没有可见几何').not.toBeNull()
  expect(tailBox, '④ 行尾固定槽没有可见几何').not.toBeNull()
  expect(
    collapseBox.x >= tailBox.x - 0.5 && collapseBox.x + collapseBox.width <= tailBox.x + tailBox.width + 0.5,
    `④ 收起钮不在钉住的行尾槽里（钮 ${collapseBox.x}..${collapseBox.x + collapseBox.width} 槽 ${tailBox.x}..${tailBox.x + tailBox.width}）`,
  ).toBe(true)
  const panelProof = await proveProbe(panel, '展开态下时间轴面板在生成画布里')
  await clickOrFail(collapseButton, '点面板内的收起钮')
  await expectAbsent(panel, { provenBy: panelProof, message: '④ 点了收起，时间轴应当整块让路' })
  await expect(capsule, '④ 收起后底部把手应当回来').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  const collapsed = await measureShellGeometry(win)
  assertInstrumentsAlive(collapsed, '④ 收起时间轴')
  expect(collapsed.timelineHost.h, '④ 收起后底部带不该再占高度').toBeLessThanOrEqual(1)
  expect(
    Math.abs(collapsed.canvas.bottom - collapsed.section.bottom) <= 2,
    `④ 收起后画布应当拿回整块高度（canvas.bottom=${collapsed.canvas.bottom} section.bottom=${collapsed.section.bottom}）`,
  ).toBe(true)
  expect(collapsed.bottomRightCovered, '④ 收起后右下角没有任何一块外壳盖住').toBe(true)
  await screenshotSettled(win, { path: path.join(shotsDir, '04-timeline-collapsed.png') })

  console.log(`layout timeline/panel span walkthrough passed; screenshots: ${shotsDir}`)
} finally {
  await app.close().catch(() => undefined)
}
