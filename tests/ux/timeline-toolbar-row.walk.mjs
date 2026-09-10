// R13/R16 走查：时间轴工具条不再盖住内容，面板能一路缩到「只剩头部行」。
//
// 真实用户任务（2026-09-10 真机反馈原话）：「时间轴无法向下缩；右上角的功能栏和下面有遮挡。」
// 走的是一个把画布空间还给自己的创作者：展开时间轴 → 看得清标尺和第一条轨 → 觉得占地方，
// 一路往下拖 → 还是想全收起来 → 在面板里点收起 → 需要时再叫回来。
// 零额度：只喂持久化的 timeline 元数据，不生成、不解码媒体。
// Run: pnpm run build && node tests/ux/timeline-toolbar-row.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expect, expectAbsent, proveProbe, screenshotSettled, DEFAULT_TIMEOUT_MS } from './_assert.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/timeline-toolbar-row')
fs.mkdirSync(shotsDir, { recursive: true })

/** 生产侧的下限真相源是 workbenchStore.TIMELINE_PANEL_MIN；这里写死同一个数当**独立**对账。 */
const EXPECTED_MIN_HEIGHT = 86

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-timeline-toolbar-'))
const userDataDir = path.join(root, 'user-data')
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const capabilityDir = path.join(root, 'capability')
for (const dir of [userDataDir, settingsDir, projectsDir, capabilityDir]) fs.mkdirSync(dir, { recursive: true })

const projectId = 'timeline-toolbar-walk'
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
      clips: [
        makeClip('clip-a', '开场远景', 0, 120),
        makeClip('clip-b', '推门近景', 120, 240),
        makeClip('clip-c', '走入夜色', 240, 360),
      ],
    },
    { id: 'audioTrack', type: 'audio', label: '音频轨', clips: [] },
  ],
  textClips: [],
  transitions: [],
}

const workbenchDocument = { version: 1, title: '时间轴工具条验收片', updatedAt: 1, contentJson: { type: 'doc', content: [] } }
const generationCanvas = { nodes: [], edges: [], selectedNodeIds: [], groups: [] }
const payload = { workbenchDocument, timeline, generationCanvas, storyboardPlan: null, storyboardPlanCommitted: false }
const project = {
  id: projectId,
  name: '时间轴工具条验收片',
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
  name: 'timeline-toolbar-row',
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
 * 量「工具条这一行」和「标尺 / 首轨 / 轨道区」的真实几何关系。
 *
 * `selfCheck` 是相交判据的阳性对照：工具条和它自己必须判成相交。判不出来 = 这把尺子坏了，
 * 那么后面每一句「它们没相交」都是恒真的空话（同 canvas-frame-real-task 的写法）。
 */
async function measureTimelineGeometry(win, sectionSelector) {
  return win.evaluate((selector) => {
    const section = document.querySelector(selector)
    if (!section) return null
    const box = (element) => {
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, w: rect.width, h: rect.height }
    }
    const intersects = (a, b) => Boolean(a && b) && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    const toolbarElement = section.querySelector('[data-timeline-toolbar-row]')
    const tracksElement = section.querySelector('.workbench-timeline__tracks')
    const toolbar = box(toolbarElement)
    const ruler = box(section.querySelector('.workbench-timeline__ruler'))
    const firstTrack = box(section.querySelector('[data-track-id]'))
    const collapseButton = box(section.querySelector('[data-timeline-collapse]'))
    return {
      section: box(section),
      toolbar,
      tracks: box(tracksElement),
      ruler,
      firstTrack,
      collapseButton,
      overlapsRuler: intersects(toolbar, ruler),
      overlapsFirstTrack: intersects(toolbar, firstTrack),
      selfCheck: intersects(toolbar, toolbar),
      toolbarScrollWidth: toolbarElement ? toolbarElement.scrollWidth : 0,
      toolbarClientWidth: toolbarElement ? toolbarElement.clientWidth : 0,
      toolbarScrollLeft: toolbarElement ? toolbarElement.scrollLeft : 0,
      groupCount: section.querySelectorAll('[data-control-scope]').length,
    }
  }, sectionSelector)
}

/** 真人手势：按住把手拖。不灌 store、不调 setter。 */
async function dragHandleBy(win, handle, deltaX, deltaY) {
  const boundingBox = await handle.boundingBox()
  if (!boundingBox) throw new Error('拖把手没有可见几何——它是这条走查的操作入口，量不到就没得测')
  const x = boundingBox.x + boundingBox.width / 2
  const y = boundingBox.y + boundingBox.height / 2
  await win.mouse.move(x, y)
  await win.mouse.down()
  for (let step = 1; step <= 12; step += 1) {
    await win.mouse.move(x + (deltaX * step) / 12, y + (deltaY * step) / 12)
  }
  await win.mouse.up()
}

const GENERATION_TIMELINE = '.workbench-generation__timeline .workbench-timeline'
const PREVIEW_TIMELINE = '.workbench-preview .workbench-timeline'

try {
  await win.evaluate(() => {
    localStorage.setItem('nomi-color-scheme', 'light')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
      localStorage.setItem(key, 'seen')
    }
  })
  await win.reload()
  await resize(1440, 920)

  const projectCard = win.locator('[data-project-card="true"]').filter({ hasText: '时间轴工具条验收片' }).first()
  await expect(projectCard, '夹具项目卡没出现').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await projectCard.hover()
  await clickOrFail(projectCard.getByRole('button', { name: /继续创作/ }).first(), '打开时间轴工具条验收片')
  await expect
    .poll(() => app.windows().some((candidate) => /[?&]projectId=/.test(candidate.url())), {
      message: '项目窗口没打开',
      timeout: DEFAULT_TIMEOUT_MS,
    })
    .toBe(true)
  win = app.windows().find((candidate) => /[?&]projectId=/.test(candidate.url())) ?? win
  await win.waitForLoadState('domcontentloaded')
  await resize(1440, 920)

  await clickOrFail(win.locator('nav.nomi-stepper [data-mode="generation"]').first(), '进入生成画布')

  // ① 默认收起态：画布底部那颗胶囊是唯一入口——先证明它在，再点开。
  const capsule = win.locator('.workbench-generation__timeline-handle')
  await expect(capsule, '折叠态底部把手没出现').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await clickOrFail(capsule, '展开时间轴')

  const panel = win.locator(GENERATION_TIMELINE).first()
  await expect(panel, '时间轴面板没展开').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await expect(panel.locator('[data-timeline-toolbar-row]'), '工具条头部行没渲染').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })

  // ② 默认高度下：工具条与标尺、首轨都不许相交。
  const openGeometry = await measureTimelineGeometry(win, GENERATION_TIMELINE)
  expect(openGeometry, '量不到时间轴几何').not.toBeNull()
  expect(openGeometry.selfCheck, '相交判据自身失效（阳性对照没通过），后面的「不相交」都不作数').toBe(true)
  expect(openGeometry.groupCount, '三簇 legend 分组必须原样保留').toBe(3)
  expect(openGeometry.ruler, '标尺没渲染').not.toBeNull()
  expect(openGeometry.firstTrack, '首轨没渲染').not.toBeNull()
  expect(openGeometry.overlapsRuler, '工具条压住了标尺').toBe(false)
  expect(openGeometry.overlapsFirstTrack, '工具条压住了第一条轨道').toBe(false)
  expect(
    openGeometry.tracks.top >= openGeometry.toolbar.bottom - 0.5,
    `轨道区必须排在工具条行之下：toolbar.bottom=${openGeometry.toolbar.bottom} tracks.top=${openGeometry.tracks.top}`,
  ).toBe(true)
  await screenshotSettled(win, { path: path.join(shotsDir, '01-toolbar-row-open.png') })

  // ③ 一路往下拖：缩到「只剩头部行」，工具条仍整条在面板里、轨道区不溢出。
  const handle = win.locator('.workbench-generation__timeline [role="separator"][aria-orientation="horizontal"]').first()
  await expect(handle, '拖把手没渲染').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await dragHandleBy(win, handle, 0, 420)
  await expect(handle, `把手应当能一路缩到下限 ${EXPECTED_MIN_HEIGHT}`).toHaveAttribute(
    'aria-valuenow',
    String(EXPECTED_MIN_HEIGHT),
    { timeout: DEFAULT_TIMEOUT_MS },
  )

  const minGeometry = await measureTimelineGeometry(win, GENERATION_TIMELINE)
  console.log('[几何证据] 缩到下限时的真实矩形', JSON.stringify({ section: minGeometry.section, toolbar: minGeometry.toolbar, tracks: minGeometry.tracks, ruler: minGeometry.ruler }))
  expect(minGeometry.selfCheck, '最小态相交判据自身失效').toBe(true)
  expect(minGeometry.section.h, '最小态面板高度对不上下限').toBeLessThanOrEqual(EXPECTED_MIN_HEIGHT + 1)
  expect(minGeometry.toolbar.h, '最小态工具条塌成了 0 高').toBeGreaterThan(20)
  expect(
    minGeometry.toolbar.bottom <= minGeometry.section.bottom + 0.5,
    `最小态工具条被挤出面板：toolbar.bottom=${minGeometry.toolbar.bottom} section.bottom=${minGeometry.section.bottom}`,
  ).toBe(true)
  expect(
    minGeometry.tracks.top >= minGeometry.toolbar.bottom - 0.5,
    '最小态轨道区跑到了工具条上面',
  ).toBe(true)
  expect(minGeometry.overlapsRuler, '最小态工具条压住了标尺').toBe(false)
  await screenshotSettled(win, { path: path.join(shotsDir, '02-collapsed-to-toolbar-row.png') })

  // ④ 面板内的收起钮：点一下整块让路，再点底部胶囊叫回来，高度记得住。
  const panelProof = await proveProbe(panel, '展开态下时间轴面板在生成画布里')
  await clickOrFail(win.locator('[data-timeline-collapse]').first(), '面板内收起时间轴')
  await expectAbsent(panel, { provenBy: panelProof, message: '点了收起，时间轴面板应当整块让路' })
  await expect(capsule, '收起后底部把手应当回来').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await screenshotSettled(win, { path: path.join(shotsDir, '03-collapsed-capsule.png') })

  await clickOrFail(capsule, '再次展开时间轴')
  await expect(panel, '再次展开失败').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await expect(handle, '展开后应当回到收起前那个高度').toHaveAttribute(
    'aria-valuenow',
    String(EXPECTED_MIN_HEIGHT),
    { timeout: DEFAULT_TIMEOUT_MS },
  )
  await screenshotSettled(win, { path: path.join(shotsDir, '04-reexpanded.png') })

  // ⑤ 把 Nomi 面板拖宽，剪辑面的时间轴跟着变窄：工具条整行放不下时**横向滚动**，
  //    簇内不换行、行尾那簇仍然够得着。（生成画布的时间轴是 col-span-full，宽度不随
  //    助手面板变；真正会被挤窄的是剪辑面那一份，所以这一段在剪辑面量。）
  await clickOrFail(win.locator('nav.nomi-stepper [data-mode="preview"]').first(), '进入剪辑面')
  const previewPanel = win.locator(PREVIEW_TIMELINE).first()
  await expect(previewPanel, '剪辑面时间轴没出现').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  const wideGeometry = await measureTimelineGeometry(win, PREVIEW_TIMELINE)
  expect(wideGeometry.selfCheck, '剪辑面相交判据自身失效').toBe(true)
  expect(wideGeometry.overlapsRuler, '剪辑面工具条压住了标尺').toBe(false)
  expect(wideGeometry.overlapsFirstTrack, '剪辑面工具条压住了第一条轨道').toBe(false)
  expect(
    wideGeometry.toolbarScrollWidth <= wideGeometry.toolbarClientWidth + 1,
    `宽窗下工具条本不该溢出：scrollWidth=${wideGeometry.toolbarScrollWidth} clientWidth=${wideGeometry.toolbarClientWidth}`,
  ).toBe(true)

  // 生成画布与剪辑面是 keep-alive 同时挂载的，两边各有一个助手把手；不限定在剪辑面那一侧，
  // `.first()` 会挑中隐藏的那个（它有 DOM 但没有几何）。
  const assistantHandle = win.locator('#editing-surface-assistant [role="separator"][aria-orientation="vertical"]').first()
  await expect(assistantHandle, '助手宽度把手没渲染').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await dragHandleBy(win, assistantHandle, -420, 0)
  const squeezed = await measureTimelineGeometry(win, PREVIEW_TIMELINE)
  expect(
    squeezed.toolbar.w < wideGeometry.toolbar.w - 40,
    `拖宽助手后时间轴没有真的变窄（前 ${wideGeometry.toolbar.w} → 后 ${squeezed.toolbar.w}），这一段就没测到东西`,
  ).toBe(true)
  expect(squeezed.toolbar.h, '挤窄后工具条换行了（行高被撑高）').toBeLessThan(wideGeometry.toolbar.h + 8)
  expect(squeezed.overlapsRuler, '挤窄后工具条压住了标尺').toBe(false)
  expect(squeezed.overlapsFirstTrack, '挤窄后工具条压住了第一条轨道').toBe(false)
  expect(
    squeezed.toolbarScrollWidth <= squeezed.toolbarClientWidth + 1,
    `用户能到达的最窄配置（最小窗 1100 + 助手拖到上限）下，三簇本来就该一行放得下：`
      + `scrollWidth=${squeezed.toolbarScrollWidth} clientWidth=${squeezed.toolbarClientWidth}`,
  ).toBe(true)
  await screenshotSettled(win, { path: path.join(shotsDir, '05-squeezed-toolbar-still-one-row.png') })

  // ⑥ 横向滚动这层安全网：用户拖不到那么窄（主窗 minWidth=1100，electron/main.ts:283），
  //    所以这一步**拿仪器**把这一行压到 320px，证明放不下时它是「滚」而不是「换行 / 裁掉」。
  //    320 = 「装得下最宽的那一簇（视图，约 186px）+ 行尾的 ? 钮」但装不下三簇的宽度；
  //    再窄就连一簇都放不下，那时「够得着」本来就不成立，量到的会是量具的毛病不是产品的。
  //    改的是量具（临时行内宽度），不是产品状态；量完当场还原并复核。
  const safetyNet = await win.evaluate((selector) => {
    const row = document.querySelector(`${selector} [data-timeline-toolbar-row]`)
    const style = getComputedStyle(row)
    const before = { height: row.getBoundingClientRect().height, overflowX: style.overflowX, flexWrap: style.flexWrap }
    const shrinkResistant = Array.from(row.querySelectorAll('[data-control-scope]'))
      .every((group) => getComputedStyle(group).flexShrink === '0')
    row.style.width = '320px'
    const squeezedHeight = row.getBoundingClientRect().height
    const scrollable = row.scrollWidth > row.clientWidth
    row.scrollLeft = row.scrollWidth
    const rowRect = row.getBoundingClientRect()
    const groups = row.querySelectorAll('[data-control-scope]')
    const last = groups[groups.length - 1].getBoundingClientRect()
    const lastReachable = last.left >= rowRect.left - 0.5 && last.right <= rowRect.right + 0.5
    const scrollLeft = row.scrollLeft
    row.style.width = ''
    return { before, shrinkResistant, squeezedHeight, scrollable, lastReachable, scrollLeft, groupCount: groups.length }
  }, PREVIEW_TIMELINE)
  expect(safetyNet.before.overflowX, '工具条行没开横向滚动').toBe('auto')
  expect(safetyNet.before.flexWrap, '工具条行允许换行了（簇会被拆到第二行）').toBe('nowrap')
  expect(safetyNet.shrinkResistant, '有簇会被压扁（flex-shrink 不是 0）').toBe(true)
  expect(safetyNet.groupCount, '三簇 legend 分组必须原样保留').toBe(3)
  expect(safetyNet.scrollable, '压到 320px 后没有产生横向滚动（说明被裁掉或换行了）').toBe(true)
  expect(safetyNet.squeezedHeight, '压窄后行高被撑高 = 换行了').toBeLessThanOrEqual(safetyNet.before.height + 1)
  expect(safetyNet.scrollLeft, '横向滚动没生效').toBeGreaterThan(0)
  expect(safetyNet.lastReachable, '滚到行尾后最后一簇仍然够不着').toBe(true)

  const restored = await measureTimelineGeometry(win, PREVIEW_TIMELINE)
  expect(restored.toolbar.w, '量具没还原干净').toBeGreaterThan(300)

  console.log(`timeline toolbar row walkthrough passed; screenshots: ${shotsDir}`)
} finally {
  await app.close().catch(() => undefined)
}
