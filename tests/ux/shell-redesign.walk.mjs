// 外壳重设计验收截图走查（设计卡 docs/plan/2026-10-08-shell-redesign.md「拍板稿对账」；零额度：只播种已有结果，不触发任何生成）。
// 真 Electron、窗口挪到屏幕外、隔离 profile（userData / 设置 / 项目库都在临时目录），生产构建，没有样张开关。
// 小球「处理中 / 出错 / 等你确认 N」三态用 E2E 桥（localStorage __nomiE2E）写进小球读的那份角标投影——
// 那份投影平时由 ProjectAgentResidentShell 写；这里不跑真 Agent，见设计卡 unverified。
//
// 用法：pnpm run build && node tests/ux/shell-redesign.walk.mjs <输出目录>
//   环境：WALK_LOCALE=zh-CN|en  WALK_SCHEME=light|dark  WALK_SIZE=1280x800|1000x700|1440x900
//         WALK_SHOTS=逗号分隔的屏名（缺省全拍）：library-empty,library,main,canvas-agent,creation-doc,
//         chrome-assets,chrome-rail-collapsed,chrome-ball-running,chrome-ball-failed,chrome-ball-pending,preview-catalog
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expect, expectAbsent, proveProbe, DEFAULT_TIMEOUT_MS, screenshotSettled } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(here, 'shots/shell-redesign')
fs.mkdirSync(outDir, { recursive: true })
const locale = process.env.WALK_LOCALE === 'en' ? 'en' : 'zh-CN'
const scheme = process.env.WALK_SCHEME === 'dark' ? 'dark' : 'light'
const [width, height] = (process.env.WALK_SIZE || '1280x800').split('x').map(Number)
const wanted = process.env.WALK_SHOTS ? new Set(process.env.WALK_SHOTS.split(',').map((value) => value.trim())) : null
const want = (id) => !wanted || wanted.has(id)
const zh = locale !== 'en'
const T = (a, b) => (zh ? a : b)
const tail = `${zh ? 'zh' : 'en'}-${scheme}-${width}`
const shotPath = (name) => path.join(outDir, `${name}-${tail}.png`)

const art = (from, to, w = 320, h = 180) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w * 0.66}" cy="${h * 0.3}" r="${Math.min(w, h) * 0.15}" fill="rgba(255,235,192,.28)"/><path d="M0 ${h * 0.78} Q ${w * 0.28} ${h * 0.58}, ${w * 0.54} ${h * 0.78} T ${w} ${h * 0.7} V ${h} H0Z" fill="rgba(16,20,27,.42)"/></svg>`)

function seedProjects(projectsDir) {
  const projectId = 'shell-redesign'
  const projectRoot = path.join(projectsDir, projectId)
  fs.mkdirSync(projectRoot, { recursive: true })
  const designId = 'design-rain'
  const documentId = 'doc-rain'
  const shots = [
    T('远景，雨后便利店门口，林薇站在雨棚边', 'Wide shot, Lin Wei by the store awning after rain'),
    T('近景，林薇侧脸，水珠沿发梢滑下', 'Close-up, Lin Wei in profile, droplets run from her hair'),
    T('低机位，怀表落在积水里，车灯扫过', 'Low angle, a pocket watch in a puddle as headlights sweep'),
    T('俯拍，霓虹与湿漉漉的车道', 'Top down, neon over the wet lanes'),
    T('中景，林薇转身看向后门', 'Medium shot, Lin Wei turns to the back door'),
    T('特写，手指收紧表链', 'Insert, fingers tighten around the chain'),
  ]
  const tones = [['#384d67', '#111827'], ['#704b45', '#201312'], ['#5d526f', '#1b1726'], ['#506a63', '#162622'], ['#87613e', '#2b1c12'], ['#476274', '#121c26']]
  const titles = zh ? ['雨棚', '侧脸', '怀表', '车道', '转身', '表链'] : ['Awning', 'Profile', 'Watch', 'Lanes', 'Turn', 'Chain']
  const nodes = shots.map((prompt, index) => ({
    id: `shot-${index + 1}`, kind: 'image', title: titles[index], prompt, categoryId: 'shots', shotIndex: index + 1,
    position: { x: 80 + (index % 3) * 420, y: 120 + Math.floor(index / 3) * 360 }, size: { width: 360, height: 203 },
    status: index === 3 ? 'idle' : 'success',
    meta: { storyboardDesignId: designId, shotId: `s${index + 1}`, modelKey: 'gpt-image-2', modelVendor: 'apimart', aspect_ratio: '16:9' },
    ...(index === 3 ? {} : { result: { id: `r${index + 1}`, type: 'image', url: art(...tones[index]), createdAt: index + 1 } }),
  }))
  const design = {
    id: designId, documentId, title: T('雨夜便利店', 'Rainy convenience store'), committed: true, status: 'draft', createdAt: 1, updatedAt: 1, sourceDocumentUpdatedAt: 1,
    plan: { title: T('雨夜便利店', 'Rainy convenience store'), aspectRatio: '16:9', anchors: [], shots: shots.map((prompt, index) => ({ shotId: `s${index + 1}`, index: index + 1, shotKind: 'image', durationSec: 3, anchorIds: [], prompt })) },
  }
  const paragraph = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
  const project = {
    id: projectId, name: T('雨夜来信', 'Rain letter'), version: 1, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
    lastKnownRootPath: projectRoot,
    payload: {
      workbenchDocuments: [{
        id: documentId, version: 1, title: T('剧本', 'Script'), updatedAt: 1,
        contentJson: { type: 'doc', content: [
          paragraph(T('雨停了，便利店的灯还亮着。林薇站在雨棚下，手里攥着一块旧怀表。', 'The rain has stopped; the store lights are still on. Lin Wei stands under the awning holding an old pocket watch.')),
          paragraph(T('一辆车慢慢驶过，车灯扫过积水，表盘上的指针停在三点十分。', 'A car rolls past; its headlights sweep the puddles. The watch hands are stuck at ten past three.')),
        ] },
      }],
      activeDocumentId: documentId,
      timeline: null,
      generationCanvas: { nodes, edges: [], selectedNodeIds: [], groups: [] },
      storyboardDesignsByDocumentId: { [documentId]: [design] },
    },
  }
  fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2))
  const otherRoot = path.join(projectsDir, 'shell-redesign-other')
  fs.mkdirSync(otherRoot, { recursive: true })
  fs.writeFileSync(path.join(otherRoot, 'project.json'), JSON.stringify({ id: 'shell-redesign-other', name: T('天台', 'Rooftop'), version: 1, createdAt: 0, updatedAt: 0, savedAt: 0, revision: 1, lastKnownRootPath: otherRoot, payload: { workbenchDocuments: [], timeline: null, generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] } } }, null, 2))
  return project
}

const measures = {}
const shotsTaken = []

async function launch(label, projectsDir, root) {
  return launchNomiApp({
    name: `shell-redesign-${label}-${tail}`,
    tempRoot: root,
    projectsDir,
    args: ['--disable-gpu'],
    timeout: 300000,
    settleMs: 1200,
    viewportSize: { width, height },
    mainRequire: [path.join(here, '_offscreenWindows.cjs')],
    initialLocalStorage: {
      'nomi:splash:v1': 'seen',
      'nomi:journey-tour:v1': 'seen',
      'nomi:canvas-gesture-hint:v1': 'seen',
      'nomi-color-scheme': scheme,
      'nomi:locale:v1': locale,
      __nomiE2E: '1',
    },
  })
}

async function box(win, selector) {
  return win.evaluate((sel) => {
    const element = document.querySelector(sel)
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return { x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) }
  }, selector)
}

async function shoot(win, name) {
  if (!want(name)) return
  await win.waitForTimeout(400)
  const file = shotPath(name)
  await screenshotSettled(win, { path: file })
  shotsTaken.push(path.basename(file))
}

// ── 1. 空项目库（LibraryEmpty 板）──
if (want('library-empty')) {
  const root = makeTempDir('nomi-shell-redesign-empty-')
  const projectsDir = path.join(root, 'projects')
  fs.mkdirSync(projectsDir, { recursive: true })
  let close
  try {
    const launched = await launch('empty', projectsDir, root)
    close = launched.close
    const win = launched.win
    await expect(win.locator('[data-shell-topbar]'), '空项目库没有 40px 顶栏').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    await expect(win.locator('[data-library-tab-button="projects"]'), '项目库没有页签').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    measures.libraryEmpty = { topbar: await box(win, '[data-shell-topbar]'), rail: await box(win, '[data-shell-rail]') }
    await shoot(win, 'library-empty')
  } finally {
    await close?.().catch(() => {})
    fs.rmSync(root, { recursive: true, force: true })
  }
}

// ── 2. 有项目的一轮 ──
const root = makeTempDir('nomi-shell-redesign-')
const projectsDir = path.join(root, 'projects')
fs.mkdirSync(projectsDir, { recursive: true })
const project = seedProjects(projectsDir)
let close
try {
  const launched = await launch('full', projectsDir, root)
  close = launched.close
  const win = launched.win
  const card = win.locator('[data-project-card]', { hasText: project.name }).first()
  await expect(card, '项目卡没有出现').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  measures.library = { topbar: await box(win, '[data-shell-topbar]'), main: await box(win, '.nomi-library-page__main') }
  await shoot(win, 'library')

  // 功能全表 #47（#1136 验收复核）：项目卡的删除入口、双击改名、打开项目文件夹，在新项目库页原样可用。
  if (want('check-parity')) {
    // 按身份定位（改名时名字变成输入框的值，按文字找会丢）。
    const other = win.locator('[data-project-card][data-project-id="shell-redesign-other"]')
    await other.hover()
    await clickOrFail(other.getByRole('button', { name: T('删除项目 天台', 'Delete project Rooftop'), exact: false }).first(), '#47 项目卡悬停出删除钮')
    const confirmCancel = win.locator('[data-confirm-dialog-cancel]').first()
    await expect(confirmCancel, '#47 删除要先出确认卡').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    await clickOrFail(confirmCancel, '#47 确认卡取消（不真删）')
    await other.getByText(T('天台', 'Rooftop'), { exact: true }).dblclick()
    const renameInput = other.locator('input[type="text"]').first()
    await expect(renameInput, '#47 双击名字没进改名').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    await renameInput.fill(T('天台·改名', 'Rooftop renamed'))
    await renameInput.press('Enter')
    await expect(other, '#47 改名没生效').toContainText(T('天台·改名', 'Rooftop renamed'), { timeout: DEFAULT_TIMEOUT_MS })
    const mainCard = win.locator('[data-project-card][data-project-id="shell-redesign"]')
    await mainCard.hover()
    await expect(mainCard.getByRole('button', { name: T('打开项目文件夹', 'Open project folder'), exact: false }).first(), '#48 打开项目文件夹入口不在').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    measures.parity = { ...(measures.parity ?? {}), projectCard: 'delete-confirm, dblclick-rename, reveal-folder' }
    await shoot(win, 'check-parity-project-card')
    await win.mouse.move(5, 300)
  }

  await card.hover()
  await clickOrFail(card.getByRole('button', { name: /继续创作|Continue/ }).first(), '打开走查项目')
  await win.waitForFunction(() => /projectId=/.test(location.href), undefined, { timeout: DEFAULT_TIMEOUT_MS })
  await expect(win.locator('[data-agent-ball]'), '画布页默认不是小球').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await win.waitForTimeout(1200)

  // Main 板：画布 + 小球 + 底边时间轴窄条
  measures.main = {
    topbar: await box(win, '[data-shell-topbar]'),
    rail: await box(win, '[data-shell-rail]'),
    canvas: await box(win, '.workbench-generation__canvas'),
    strip: await box(win, '[data-timeline-strip]'),
    ball: await box(win, '[data-agent-ball]'),
  }
  await shoot(win, 'main')

  // Chrome 板：小球三态（显示态注入，见文件头）
  const setBadge = (status, pending, unread = 0) => win.evaluate(([s, n, u]) => window.__nomiResidentActivityStore?.getState().setResidentDockBadge(s, n, u), [status, pending, unread])
  for (const [name, status, pending] of [['chrome-ball-running', 'running', 0], ['chrome-ball-failed', 'failed', 0], ['chrome-ball-pending', 'needs-confirm', 2]]) {
    if (!want(name)) continue
    await setBadge(status, pending)
    await expect(win.locator(`[data-agent-ball="${status === 'needs-confirm' ? 'pending' : status}"]`), `小球没有进入 ${status}`).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    await shoot(win, name)
  }
  // 未读点（10-08 协调拍板：旧顶栏角标的未读数不能丢）：空闲 + 3 条未读 = 右上强调色小点，悬停名字带「3 条新消息」。
  if (want('chrome-ball-unread')) {
    await setBadge('idle', 0, 3)
    const unreadBall = win.locator('[data-agent-ball="idle"][data-agent-dock-unread="3"]')
    await expect(unreadBall, '小球没有接住未读').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    await expect(unreadBall.locator('[data-dot-mark]'), '有未读却没冒点').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    await expect(unreadBall, '悬停名字没说有几条新消息').toHaveAttribute('title', zh ? /3 条新消息/ : /New messages: 3/)
    await shoot(win, 'chrome-ball-unread')
    // 等你确认优先：同时在时只出胶囊，不叠点。
    await setBadge('needs-confirm', 1, 4)
    await expect(win.locator('[data-agent-ball="pending"]'), '等你确认没有压过未读').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    const dotProof = await proveProbe(win.locator('[data-agent-ball] [data-dot-mark], [data-agent-ball="pending"]'), '小球在场（判点之前先证探针活着）')
    await expectAbsent(win.locator('[data-agent-ball] [data-dot-mark]'), { provenBy: dotProof, message: '胶囊时还叠了未读点' })
  }
  await setBadge('idle', 0)

  // 事实测量（协调 10-08 问）：靠底节点的生成框和底边时间轴窄条重叠多少像素。
  // 新外壳里窄条是画布下面独立的一格，画布元素到窄条顶边为止；生成框伸出画布下沿的部分被画布裁掉，不会画到窄条上。
  if (want('check-bottom-composer')) {
    const rects = () => win.evaluate(() => {
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), h: Math.round(b.height) } }
      const composer = [...document.querySelectorAll('[data-composer-host="node"], [data-composer-host]')].find((el) => el.getClientRects().length > 0 && el.closest('.workbench-generation__canvas'))
      const node = document.querySelector('.react-flow__node[data-id="shot-5"]')
      const strip = document.querySelector('[data-timeline-strip]')
      const canvas = document.querySelector('.workbench-generation__canvas')
      const cr = r(composer); const sr = r(strip); const cv = r(canvas)
      // 视觉上压到窄条的像素 = 生成框可见部分（被画布裁剪后）与窄条的交叠；被藏在画布下沿以下的像素另记。
      const visibleBottom = cr && cv ? Math.min(cr.bottom, cv.bottom) : null
      return {
        node: r(node), composer: cr, strip: sr, canvas: cv,
        overlapWithStripPx: cr && sr ? Math.max(0, Math.min(visibleBottom, sr.bottom) - Math.max(cr.top, sr.top)) : null,
        hiddenBelowCanvasPx: cr && cv ? Math.max(0, cr.bottom - cv.bottom) : null,
      }
    })
    await clickOrFail(win.locator('.react-flow__node[data-id="shot-5"]'), '选中第 5 镜（下排）')
    await expect(win.locator('.workbench-generation__canvas [data-composer-host]').first(), '选中后生成框没出来').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    await win.waitForTimeout(400)
    const asIs = await rects()
    // 把这镜拖到靠底：节点下沿离窄条 24px（左键拖空白处平移画布）。
    const dy = (asIs.canvas?.bottom ?? 0) - (asIs.node?.bottom ?? 0) - 24
    const from = { x: (asIs.canvas?.left ?? 0) + 330, y: (asIs.canvas?.top ?? 0) + 40 }
    await win.mouse.move(from.x, from.y)
    await win.mouse.down()
    await win.mouse.move(from.x, from.y + dy, { steps: 10 })
    await win.mouse.up()
    await win.waitForTimeout(500)
    const nearBottom = await rects()
    measures.bottomComposer = { asIs, nearBottom }
    expect(nearBottom.overlapWithStripPx ?? 0, '生成框画到了时间轴窄条上').toBe(0)
    await shoot(win, 'check-bottom-composer')
    await win.keyboard.press('Escape')
  }

  // CanvasAgent 板：点小球 = 浮窗
  if (want('canvas-agent') || want('chrome-assets') || want('chrome-rail-collapsed')) {
    await clickOrFail(win.locator('[data-agent-ball]'), '点小球打开浮窗')
    await expect(win.locator('[data-agent-float="generation"] [data-v4-panel]'), '浮窗没有打开').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    await win.waitForTimeout(700)
    measures.float = await box(win, '[data-agent-float="generation"]')
    await shoot(win, 'canvas-agent')
    await clickOrFail(win.locator('[data-agent-form-to="ball"]').first(), '浮窗收成小球')

    // Chrome 板：素材抽屉
    await clickOrFail(win.locator('[data-shell-rail-item="assets"]'), '点左栏素材')
    await expect(win.locator('[data-shell-drawer="assets"]'), '素材抽屉没打开').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    await win.waitForTimeout(600)
    measures.assetDrawer = await box(win, '[data-shell-drawer="assets"]')
    await shoot(win, 'chrome-assets')
    await win.keyboard.press('Escape')
    await win.waitForTimeout(300)

    // Chrome 板：左栏收起
    await clickOrFail(win.locator('[data-shell-rail-collapse]'), '收起左栏')
    await expect(win.locator('[data-shell-rail-expand]'), '收起后顶栏没有「展开左栏」').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    await shoot(win, 'chrome-rail-collapsed')
    await clickOrFail(win.locator('[data-shell-rail-expand]'), '展开左栏')
  }

  // 协调裁决第 11 项：抽屉右边缘拖宽（键盘同一个把手：→ 每次 +16，宽度记在 shellLayoutStore）。
  if (want('check-drawer-resize')) {
    await clickOrFail(win.locator('[data-shell-rail-item="assets"]'), '点左栏素材（量拖宽）')
    await expect(win.locator('[data-shell-drawer="assets"]'), '素材抽屉没打开').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    await win.waitForTimeout(400)
    const before = await box(win, '[data-shell-drawer="assets"]')
    const handle = win.locator('[data-shell-drawer-resize]')
    const grip = await handle.boundingBox()
    if (!grip) throw new Error('抽屉右缘没有拖宽把手')
    await win.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
    await win.mouse.down()
    await win.mouse.move(grip.x + grip.width / 2 + 80, grip.y + grip.height / 2, { steps: 8 })
    await win.mouse.up()
    await win.waitForTimeout(400)
    const after = await box(win, '[data-shell-drawer="assets"]')
    measures.drawerResize = { before: before?.w, after: after?.w }
    expect((after?.w ?? 0) - (before?.w ?? 0), '拖抽屉右缘 80px，抽屉没变宽').toBeGreaterThan(60)
    await shoot(win, 'check-drawer-resize')
    await win.keyboard.press('Escape')
    await win.waitForTimeout(300)
  }

  // 协调裁决第 37 项：Mod+J 打开 Agent 并聚焦输入框；Mod+\ 停靠 ↔ 小球。
  if (want('check-shortcuts')) {
    await expect(win.locator('[data-agent-ball]'), '快捷键前应是小球').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    await win.locator('.workbench-generation__canvas').click({ position: { x: 500, y: 60 } })
    await win.keyboard.press('Control+J')
    await expect(win.locator('[data-agent-float="generation"] [data-v4-panel]'), 'Ctrl+J 没有打开 Agent').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    await expect.poll(() => win.evaluate(() => Boolean(document.activeElement?.closest('#project-agent-resident') && document.activeElement?.tagName === 'TEXTAREA')),
      { message: 'Ctrl+J 打开后焦点不在 Agent 输入框', timeout: stationTimeout() }).toBe(true)
    await shoot(win, 'check-mod-j')
    await win.keyboard.press('Control+\\')
    await expect(win.locator('[data-agent-ball]'), 'Ctrl+\\ 没把浮窗收成小球').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    const ballProof = await proveProbe(win.locator('[data-agent-ball]'), '切停靠前小球确实在')
    await win.keyboard.press('Control+\\')
    await expect(win.locator('[data-shell-agent-layer][data-agent-form="dock"]'), 'Ctrl+\\ 没把小球切到停靠').toBeAttached({ timeout: DEFAULT_TIMEOUT_MS })
    await expectAbsent(win.locator('[data-agent-ball]'), { provenBy: ballProof, message: '停靠后小球还在' })
    await shoot(win, 'check-mod-backslash-dock')
    await win.keyboard.press('Control+\\')
    await expect(win.locator('[data-agent-ball]'), '再按 Ctrl+\\ 没回到小球').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  }

  // 协调裁决第 57 项：浮窗窄时头部按钮收进「⋯」（线程 / 历史与形态三选一都在里面）。
  if (want('check-float-compact')) {
    await win.evaluate(() => {
      const store = window.__nomiAgentFormStore?.getState()
      store?.setFloatRect('generation', { x: 600, y: 200, width: 320, height: 460 })
      store?.setForm('generation', 'float')
    })
    await expect(win.locator('[data-agent-float="generation"] [data-v4-panel]'), '窄浮窗没有打开').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    const more = win.locator('[data-agent-float="generation"] [data-v4-control="more"]')
    await expect(more, '浮窗 320 宽时头部没有收进「⋯」').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    await clickOrFail(more, '点「⋯」')
    await expect(win.getByRole('menuitem').first(), '「⋯」菜单没有展开').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    await shoot(win, 'check-float-compact')
    await win.keyboard.press('Escape')
    await win.evaluate(() => {
      const store = window.__nomiAgentFormStore?.getState()
      store?.setForm('generation', 'ball')
    })
  }

  // CreationDoc 板：创作页 + 文稿抽屉 + 停靠 Agent
  if (want('creation-doc')) {
    await clickOrFail(win.locator('.nomi-stepper__step[data-mode="creation"]'), '切到创作')
    await expect(win.locator('[data-creation-document-switcher]'), '编辑器工具条没有文稿名 ▾').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    await clickOrFail(win.locator('[data-shell-rail-item="docs"]'), '点左栏文稿')
    await expect(win.locator('[data-creation-resource-tree="true"]'), '文稿抽屉里没有文稿树').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    await win.waitForTimeout(800)
    measures.creation = { drawer: await box(win, '[data-shell-drawer="docs"]'), agent: await box(win, '[data-v4-panel]') }
    await shoot(win, 'creation-doc')
    await win.keyboard.press('Escape')
  }

  // 剪辑页「目录」抽屉：镜头可拖进时间轴 / 点击追加（协调裁决第 32 项）
  if (want('preview-catalog')) {
    await clickOrFail(win.locator('.nomi-stepper__step[data-mode="preview"]'), '切到预览')
    await win.waitForTimeout(1200)
    await clickOrFail(win.locator('[data-shell-rail-item="catalog"]'), '点左栏目录')
    await expect(win.locator('[data-shell-drawer-shots]'), '剪辑页目录抽屉没有镜头格').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    await win.waitForTimeout(800)
    await shoot(win, 'preview-catalog')
    // 点抽屉里的镜头 = 追加到时间轴末尾（原 PreviewSourcePanel「镜头」页签同一个动作）。
    if (want('check-preview-append')) {
      const clips = win.locator('[data-testid="timeline-clip"]')
      const before = await clips.count()
      await clickOrFail(win.locator('[data-shell-drawer-shots] [data-testid="preview-source-shot"]').first(), '点抽屉里的镜头 1')
      await expect.poll(() => clips.count(), { message: '点抽屉镜头后时间轴没多一段', timeout: stationTimeout() }).toBe(before + 1)
      measures.previewAppend = { before, after: await clips.count() }
      await shoot(win, 'check-preview-append')
    }
  }

  // ── #1136 验收复核：其余 5 行（中文轨跑，文案按中文找）──
  if (want('check-parity') && zh) {
    const parity = measures.parity ?? (measures.parity = {})
    // #35 剪辑页布局菜单：顶栏右簇「剪辑布局」图标钮（窄于 1440 只剩图标 + ▾）。
    await clickOrFail(win.locator('.nomi-stepper__step[data-mode="preview"]'), '#35 切到剪辑页')
    await win.waitForTimeout(800)
    const layoutTrigger = win.locator('[data-shell-topbar] button[aria-label="布局"]').first()
    await clickOrFail(layoutTrigger, '#35 顶栏剪辑布局菜单')
    const layoutMenu = win.locator('[data-shell-topbar] [role="menu"][aria-label="布局"]').first()
    await expect(layoutMenu, '#35 布局菜单没打开').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    const panelToggles = await layoutMenu.locator('[role="menuitemcheckbox"]').count()
    const presets = await layoutMenu.locator('[role="menuitemradio"]').count()
    expect(panelToggles, '#35 面板显隐项不在').toBeGreaterThan(0)
    expect(presets, '#35 布局预设不在').toBeGreaterThan(0)
    await expect(layoutMenu.locator('[role="menuitem"]').last(), '#35 恢复默认不在').toBeVisible()
    const firstToggle = layoutMenu.locator('[role="menuitemcheckbox"]').first()
    const checkedBefore = await firstToggle.getAttribute('aria-checked')
    await clickOrFail(firstToggle, '#35 切一个面板显隐')
    await expect(firstToggle, '#35 面板显隐点了没变').not.toHaveAttribute('aria-checked', checkedBefore ?? '')
    await shoot(win, 'check-parity-layout-menu')
    await clickOrFail(layoutMenu.locator('[role="menuitem"]').last(), '#35 恢复默认')
    parity.layoutMenu = { panelToggles, presets }

    // #44 / #45 时间轴：回生成页点窄条 ^ 展开，工具条、右键、拖播放头都在（上一步剪辑页已追加了一段）。
    await clickOrFail(win.locator('.nomi-stepper__step[data-mode="generation"]'), '#44 回生成页')
    // 时间轴有片段后可能已经是展开态（窄条只在收起时出现）；收起着就点窄条 ^ 展开。
    const strip = win.locator('[data-timeline-strip]')
    await win.waitForTimeout(600)
    if (await strip.isVisible().catch(() => false)) await clickOrFail(strip, '#44 点窄条展开时间轴')
    const panel = win.locator('.workbench-generation__timeline .workbench-timeline').first()
    await expect(panel, '#44 窄条展开后没有时间轴面板').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    const toolbar = panel.locator('[data-timeline-toolbar-row]')
    const labels = await toolbar.locator('button').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') || ''))
    for (const want of [/在播放头处分割/, /创建副本/, /^删除$/, /AI 拼片/, /撤销时间轴编辑/, /重做时间轴编辑/, /吸附/, /缩小时间轴/, /重置缩放/, /放大时间轴/]) {
      expect(labels.some((label) => want.test(label)), `#44 时间轴工具条缺「${want.source}」（实际：${labels.join(' / ')}）`).toBe(true)
    }
    const clip = panel.locator('[data-testid="timeline-clip"]').first()
    await clickOrFail(clip, '#44 选中片段')
    await expect(toolbar.locator('button[aria-label="在播放头处分割"]'), '#44 选中片段后分割仍不可用').toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS })
    await clip.click({ button: 'right' })
    const contextMenu = win.locator('[data-testid="timeline-context-menu"]')
    await expect(contextMenu, '#45 片段右键菜单没出来').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    const contextItems = await contextMenu.getByRole('menuitem').count()
    await shoot(win, 'check-parity-timeline')
    await win.keyboard.press('Escape')
    const playhead = panel.locator('.workbench-timeline__playhead').first()
    const before = await playhead.evaluate((node) => Math.round(node.getBoundingClientRect().left))
    const ruler = await panel.locator('.workbench-timeline__ruler-content').first().boundingBox()
    if (!ruler) throw new Error('#45 时间轴标尺不在')
    // 按住 Shift 拖（关吸附）：只有一段片段时吸附会把播放头吸回片段边，量不出「拖得动」。
    await win.keyboard.down('Shift')
    await win.mouse.move(ruler.x + 40, ruler.y + ruler.height / 2)
    await win.mouse.down()
    await win.mouse.move(ruler.x + 220, ruler.y + ruler.height / 2, { steps: 8 })
    await win.mouse.up()
    await win.keyboard.up('Shift')
    const after = await playhead.evaluate((node) => Math.round(node.getBoundingClientRect().left))
    expect(Math.abs(after - before), `#45 拖标尺播放头没动（before=${before} after=${after} ruler=${JSON.stringify(ruler)}）`).toBeGreaterThan(40)
    parity.timeline = { toolbar: labels.length, contextItems, playheadMoved: after - before }
    await clickOrFail(panel.locator('[data-timeline-collapse]').first(), '#44 收起时间轴')

    // #11 抽屉右缘拖宽：六个抽屉都能拖，关掉再开宽度还在。
    const drawerWidths = {}
    for (const item of ['docs', 'catalog', 'assets', 'flows', 'skills', 'prompts']) {
      await clickOrFail(win.locator(`[data-shell-rail-item="${item}"]`), `#11 打开 ${item} 抽屉`)
      const drawer = win.locator(`[data-shell-drawer="${item}"]`)
      await expect(drawer, `#11 ${item} 抽屉没打开`).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
      await win.waitForTimeout(250)
      const w0 = (await drawer.boundingBox())?.width ?? 0
      const grip = await win.locator('[data-shell-drawer-resize]').boundingBox()
      if (!grip) throw new Error(`#11 ${item} 抽屉右缘没有拖宽把手`)
      await win.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
      await win.mouse.down()
      await win.mouse.move(grip.x + grip.width / 2 + 48, grip.y + grip.height / 2, { steps: 6 })
      await win.mouse.up()
      await win.waitForTimeout(200)
      const w1 = (await drawer.boundingBox())?.width ?? 0
      await clickOrFail(win.locator(`[data-shell-rail-item="${item}"]`), `#11 关掉 ${item} 抽屉`)
      await win.waitForTimeout(300)
      await clickOrFail(win.locator(`[data-shell-rail-item="${item}"]`), `#11 再开 ${item} 抽屉`)
      await expect(drawer, `#11 ${item} 抽屉没再打开`).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
      await win.waitForTimeout(250)
      const w2 = (await drawer.boundingBox())?.width ?? 0
      drawerWidths[item] = { w0: Math.round(w0), w1: Math.round(w1), reopened: Math.round(w2) }
      expect(w1 - w0, `#11 ${item} 拖右缘没变宽`).toBeGreaterThan(30)
      expect(Math.abs(w2 - w1), `#11 ${item} 关掉再开宽度没记住`).toBeLessThan(2)
      await clickOrFail(win.locator(`[data-shell-rail-item="${item}"]`), `#11 收起 ${item} 抽屉`)
      await win.waitForTimeout(250)
    }
    parity.drawerWidths = drawerWidths

    // #13 目录里的拖拽：节点拖进分组、分组重排（抽屉是浮层，拖动不能被「点外面收起」打断）。
    await win.evaluate(() => {
      const store = window.__nomiCanvasStore?.getState()
      store?.createGroup('shots', '走查组甲', { nodeIds: ['shot-1'] })
      store?.createGroup('shots', '走查组乙')
    })
    await clickOrFail(win.locator('[data-shell-rail-item="catalog"]'), '#13 打开目录抽屉')
    const catalog = win.locator('[data-shell-drawer="catalog"]')
    await expect(catalog.locator('button[title="走查组乙"]'), '#13 目录里没有走查组').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    const groupIds = () => win.evaluate(() => (window.__nomiCanvasStore?.getState().groups ?? []).filter((group) => group.name.startsWith('走查组')).map((group) => ({ name: group.name, nodeIds: group.nodeIds })))
    await catalog.locator('button[data-node-id="shot-2"]').dragTo(catalog.locator('button[title="走查组乙"]'))
    await expect.poll(async () => JSON.stringify(await groupIds()), { message: '#13 节点拖进分组没生效', timeout: stationTimeout() }).toContain('"name":"走查组乙","nodeIds":["shot-2"]')
    await expect(catalog, '#13 拖动时抽屉被「点外面收起」关掉了').toBeVisible()
    const orderBefore = (await groupIds()).map((group) => group.name).join(',')
    await catalog.locator('button[title="走查组乙"]').dragTo(catalog.locator('button[title="走查组甲"]'))
    await expect.poll(async () => (await groupIds()).map((group) => group.name).join(','), { message: '#13 分组重排没生效', timeout: stationTimeout() }).not.toBe(orderBefore)
    parity.catalogDnD = { groups: await groupIds() }
    await shoot(win, 'check-parity-catalog-dnd')
    await clickOrFail(win.locator('[data-shell-rail-item="catalog"]'), '#13 收起目录抽屉')

    // #16 素材文件夹：项目素材页签里新建 / 拖进 / 打开 / 删除文件夹。
    await clickOrFail(win.locator('[data-shell-rail-item="assets"]'), '#16 打开素材抽屉')
    const assets = win.locator('[data-shell-drawer="assets"]')
    await clickOrFail(assets.getByRole('tab', { name: '项目素材' }), '#16 切到项目素材')
    await clickOrFail(assets.locator('button[aria-label="新建文件夹"]'), '#16 新建文件夹')
    const nameInput = assets.locator('input[aria-label="新文件夹名称"]')
    await nameInput.fill('走查文件夹')
    await nameInput.press('Enter')
    const folderTile = assets.locator('[role="button"][aria-label="打开文件夹 走查文件夹"]')
    await expect(folderTile, '#16 新建的文件夹没出现').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    const assetTile = assets.locator('div[draggable="true"]').first()
    await expect(assetTile, '#16 项目素材里没有可拖的素材').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    await assetTile.dragTo(folderTile)
    await expect(folderTile, '#16 拖进文件夹后计数没变').toContainText('1', { timeout: stationTimeout() })
    await clickOrFail(folderTile, '#16 打开文件夹')
    const back = assets.locator('button[aria-label="返回全部项目素材"]')
    await expect(back, '#16 进文件夹后没有返回钮').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    await shoot(win, 'check-parity-asset-folder')
    await clickOrFail(back, '#16 回到全部项目素材')
    await folderTile.hover()
    await clickOrFail(assets.locator('button[aria-label="删除 走查文件夹"]'), '#16 删除文件夹')
    await clickOrFail(win.locator('[data-confirm-dialog-confirm]').first(), '#16 确认删除文件夹')
    const folderProof = await proveProbe(assets.getByRole('tab', { name: '项目素材' }), '素材抽屉还开着（判文件夹没了之前先证探针活着）')
    await expectAbsent(folderTile, { provenBy: folderProof, message: '#16 删除后文件夹还在' })
    await expect(assets, '#16 确认卡关掉后素材抽屉被收起了').toBeVisible()
    parity.assetFolders = 'create, drag-in, open, back, delete'
    await clickOrFail(win.locator('[data-shell-rail-item="assets"]'), '#16 收起素材抽屉')
  }

  // ── #1136 重验「看不出」的行：补夹具、真点通（中文轨）──
  if (want('check-parity2') && zh) {
    const parity2 = measures.parity2 = {}
    const nodeCount = () => win.evaluate(() => window.__nomiCanvasStore?.getState().nodes.length ?? -1)
    const rectOf = (locator) => locator.evaluate((node) => { const r = node.getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom) } })
    const viewport = await win.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
    await clickOrFail(win.locator('.nomi-stepper__step[data-mode="generation"]'), '回生成页')
    await win.waitForTimeout(600)

    // #43 底边窄条 ^ 展开时间轴、再收回窄条。
    const strip = win.locator('[data-timeline-strip]')
    const timelinePanel = win.locator('.workbench-generation__timeline .workbench-timeline').first()
    if (await timelinePanel.isVisible().catch(() => false)) await clickOrFail(timelinePanel.locator('[data-timeline-collapse]').first(), '#43 先收起时间轴')
    await clickOrFail(strip, '#43 点窄条 ^ 展开时间轴')
    await expect(timelinePanel, '#43 窄条展开后没有时间轴面板').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    await clickOrFail(timelinePanel.locator('[data-timeline-collapse]').first(), '#43 收起时间轴')
    await expect(strip, '#43 收起后窄条没回来').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    parity2.timelineStrip = 'expand → collapse'

    // #39 加节点、#40 更多菜单、#42 缩放。
    const before39 = await nodeCount()
    await addCanvasNodeFromRail(win, 'image')
    await expect.poll(nodeCount, { message: '#39 左栏加图片节点没生效', timeout: stationTimeout() }).toBe(before39 + 1)
    await win.keyboard.press('Escape')
    await clickOrFail(win.locator('[data-canvas-add-more="true"]').first(), '#40 打开「更多」')
    const moreMenu = win.locator('.generation-canvas-v2-toolbar__more-menu').first()
    await expect(moreMenu, '#40 「更多」菜单没展开').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    const moreKinds = await moreMenu.locator('[data-node-kind]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-node-kind')))
    expect(moreKinds.includes('director'), `#40 「更多」里没有导演台（${moreKinds.join(',')}）`).toBe(true)
    await shoot(win, 'check-parity2-canvas-more')
    await win.keyboard.press('Escape')
    await win.mouse.click(700, 80)
    const scaleOf = () => win.evaluate(() => { const t = getComputedStyle(document.querySelector('.react-flow__viewport')).transform; const m = /matrix\(([^,]+)/.exec(t); return m ? Number(m[1]) : 1 })
    const scale0 = await scaleOf()
    const zoomRange = win.locator('input[aria-label="缩放比例"]').first()
    await zoomRange.focus()
    for (let i = 0; i < 4; i += 1) await win.keyboard.press('ArrowRight')
    await expect.poll(scaleOf, { message: '#42 缩放滑杆没改变画布缩放', timeout: stationTimeout() }).not.toBe(scale0)
    await clickOrFail(win.getByRole('button', { name: '适应视图' }).first(), '#42 适应视图')
    parity2.canvas = { added: 'image', moreKinds, zoomFrom: scale0, zoomTo: await scaleOf() }

    // #14 素材拖进画布、双击全屏预览；#50 素材全屏预览不被外壳裁切。
    await clickOrFail(win.locator('[data-shell-rail-item="assets"]'), '#14 打开素材抽屉')
    const assets = win.locator('[data-shell-drawer="assets"]')
    const tile = assets.locator('div[draggable="true"]').first()
    await expect(tile, '#14 素材抽屉里没有可拖的素材').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    const before14 = await nodeCount()
    await tile.dragTo(win.locator('.react-flow__pane').first(), { targetPosition: { x: 900, y: 360 } })
    await expect.poll(nodeCount, { message: '#14 素材拖进画布没有落成节点', timeout: stationTimeout() }).toBe(before14 + 1)
    await tile.dblclick()
    const preview = win.locator('[data-asset-preview-dialog="true"]').first()
    await expect(preview, '#14 双击素材没打开全屏预览').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    const previewRect = await rectOf(preview)
    expect(previewRect.top >= 40 - 1 && previewRect.bottom >= viewport.height - 1, `#50 素材全屏预览被裁切或压住顶栏（${JSON.stringify(previewRect)}）`).toBe(true)
    // 全屏预览要压在抽屉上面：在抽屉占的那块点一下，命中的必须是预览（层级合同：applicationModal 9000 > floatingPanel 4000）。
    const previewOnTop = await win.evaluate(() => Boolean(document.elementFromPoint(160, 300)?.closest('[data-asset-preview-dialog]')))
    expect(previewOnTop, '#50 素材全屏预览被左栏抽屉压在下面').toBe(true)
    await shoot(win, 'check-parity2-asset-preview')
    await win.keyboard.press('Escape')
    const previewProof = await proveProbe(assets, '素材抽屉还在（判预览关掉之前先证探针活着）')
    await expectAbsent(preview, { provenBy: previewProof, message: '#14 Esc 关不掉素材预览' })
    parity2.assets = { dragToCanvas: true, previewRect }
    await clickOrFail(win.locator('[data-shell-rail-item="assets"]'), '#14 收起素材抽屉')

    // #50 导演台全屏浮层从 40px 顶栏下开始、铺满到底。
    await addCanvasNodeFromRail(win, 'director')
    await clickOrFail(win.locator('[data-testid="director-node-open"]').first(), '#50 进入导演台')
    const director = win.locator('[data-testid="director-editor"]')
    await expect(director, '#50 导演台没打开').toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
    const directorRect = await rectOf(director)
    expect(directorRect.top >= 40 - 1 && directorRect.bottom >= viewport.height - 1 && directorRect.left <= 1, `#50 导演台浮层被裁切或压住顶栏（${JSON.stringify(directorRect)}）`).toBe(true)
    await shoot(win, 'check-parity2-director')
    await clickOrFail(win.locator('[data-testid="director-exit"]').first(), '#50 导演台左上「退出」')
    await clickOrFail(win.locator('[data-confirm-dialog-confirm]').first(), '#50 确认退出导演台')
    const canvasProof = await proveProbe(win.locator('.workbench-generation__canvas'), '画布在（判导演台关掉之前先证探针活着）')
    await expectAbsent(director, { provenBy: canvasProof, message: '#50 退出导演台后浮层还在' })
    parity2.director = directorRect

    // #3 顶栏项目菜单改名：Enter 生效、Esc 放弃。
    const projectMenu = win.locator('[data-shell-project-menu]')
    await clickOrFail(projectMenu, '#3 打开项目菜单')
    await clickOrFail(win.getByRole('menuitem', { name: '重命名' }), '#3 菜单 · 重命名')
    const nameInput = win.locator('[data-shell-topbar] input[aria-label]').first()
    await nameInput.fill('雨夜来信·改名')
    await nameInput.press('Enter')
    await expect(projectMenu, '#3 Enter 改名没生效').toHaveAttribute('title', '雨夜来信·改名', { timeout: stationTimeout() })
    await clickOrFail(projectMenu, '#3 再开项目菜单')
    await clickOrFail(win.getByRole('menuitem', { name: '重命名' }), '#3 菜单 · 重命名（这次 Esc）')
    await win.locator('[data-shell-topbar] input[aria-label]').first().fill('不该生效的名字')
    await win.locator('[data-shell-topbar] input[aria-label]').first().press('Escape')
    await expect(projectMenu, '#3 Esc 没有放弃改名').toHaveAttribute('title', '雨夜来信·改名')
    parity2.projectRename = 'enter-commits, escape-cancels'

    // #22 / #23 文稿与方案：新建、改名、删除、复制、从文稿建方案。
    await clickOrFail(win.locator('[data-shell-rail-item="docs"]'), '#22 打开文稿抽屉')
    const docs = win.locator('[data-shell-drawer="docs"]')
    const docRows = docs.locator('[data-document-row]')
    const docs0 = await docRows.count()
    await clickOrFail(docs.getByRole('button', { name: '新建一篇原稿' }), '#22 新建文稿')
    await expect.poll(() => docRows.count(), { message: '#22 新建文稿没多一行', timeout: stationTimeout() }).toBe(docs0 + 1)
    const newDoc = docRows.last()
    await newDoc.locator('[data-document-id] [data-document-title]').dblclick()
    const docRename = docs.locator('input[aria-label="原稿标题"]').first()
    await docRename.fill('走查文稿')
    await docRename.press('Enter')
    await expect(newDoc, '#22 文稿改名没生效').toContainText('走查文稿', { timeout: stationTimeout() })
    await newDoc.locator('[data-document-id]').first().click({ button: 'right' })
    await clickOrFail(win.locator('[data-creation-resource-menu="document"] [data-resource-action="delete"]'), '#22 右键 · 删除文稿')
    await clickOrFail(win.locator('[data-confirm-dialog-confirm]').first(), '#22 确认删除文稿')
    await expect.poll(() => docRows.count(), { message: '#22 删除文稿没少一行', timeout: stationTimeout() }).toBe(docs0)
    const plans = docs.locator('[data-storyboard-row]')
    const plans0 = await plans.count()
    await docs.locator('[data-storyboard-id="design-rain"]').click({ button: 'right' })
    await clickOrFail(win.locator('[data-creation-resource-menu="storyboard"] [data-resource-action="duplicate"]'), '#23 右键 · 复制方案')
    await expect.poll(() => plans.count(), { message: '#23 复制方案没多一行', timeout: stationTimeout() }).toBe(plans0 + 1)
    const copy = plans.last()
    await copy.locator('[data-storyboard-id]').click({ button: 'right' })
    await clickOrFail(win.locator('[data-creation-resource-menu="storyboard"] [data-resource-action="rename"]'), '#23 右键 · 改名方案')
    const planRename = copy.locator('input').first()
    await planRename.fill('走查方案')
    await planRename.press('Enter')
    await expect(copy, '#23 方案改名没生效').toContainText('走查方案', { timeout: stationTimeout() })
    await copy.locator('[data-storyboard-id]').click({ button: 'right' })
    await clickOrFail(win.locator('[data-creation-resource-menu="storyboard"] [data-resource-action="delete"]'), '#23 右键 · 删除方案')
    // 删方案走「撤销 toast」不弹确认卡（现役行为）；万一弹了也点掉——下面的行数断言才是判据。
    const planConfirm = win.locator('[data-confirm-dialog-confirm]').first()
    if (await planConfirm.isVisible().catch(() => false)) await clickOrFail(planConfirm, '#23 确认删除方案')
    await expect.poll(() => plans.count(), { message: '#23 删除方案没少一行', timeout: stationTimeout() }).toBe(plans0)
    await clickOrFail(docs.locator('[data-add-storyboard]').first(), '#23 从文稿新建方案')
    await expect.poll(() => plans.count(), { message: '#23 从文稿新建方案没多一行', timeout: stationTimeout() }).toBe(plans0 + 1)
    await shoot(win, 'check-parity2-docs')
    parity2.docs = { newDoc: true, renameDoc: true, deleteDoc: true, duplicatePlan: true, renamePlan: true, deletePlan: true, newPlan: true }
    if (await docs.isVisible().catch(() => false)) await clickOrFail(win.locator('[data-shell-rail-item="docs"]'), '#22 收起文稿抽屉')

    // #37 剪辑页面板布局 Cmd+Z：切掉一个面板，Cmd+Z 回来。
    await clickOrFail(win.locator('.nomi-stepper__step[data-mode="preview"]'), '#37 切到剪辑页')
    await win.waitForTimeout(800)
    const layoutTrigger = win.locator('[data-shell-topbar] button[aria-label="布局"]').first()
    const layoutMenu = win.locator('[data-shell-topbar] [role="menu"][aria-label="布局"]').first()
    await clickOrFail(layoutTrigger, '#37 打开布局菜单')
    const toggle = layoutMenu.locator('[role="menuitemcheckbox"]').first()
    const checked0 = await toggle.getAttribute('aria-checked')
    await clickOrFail(toggle, '#37 切掉一个面板')
    await win.keyboard.press('Escape')
    await win.locator('.workbench-preview-player__control-bar').first().click({ position: { x: 300, y: 20 } })
    // 布局撤销绑的是 metaKey（现役：PreviewWorkspace 只认 Cmd+Z；Windows 上 Ctrl+Z 归时间轴撤销，main 上同样如此）。
    await win.keyboard.press('Meta+z')
    await clickOrFail(layoutTrigger, '#37 再开布局菜单看')
    await expect(layoutMenu.locator('[role="menuitemcheckbox"]').first(), '#37 Cmd+Z 没撤回面板布局').toHaveAttribute('aria-checked', checked0 ?? 'true')
    await win.keyboard.press('Escape')
    parity2.layoutUndo = 'toggle → cmd+z restored'

    // #33 播放控件：播放 / 暂停、逐帧、静音、全屏。
    const bar = win.locator('.workbench-preview-player__control-bar').first()
    await clickOrFail(bar.getByRole('button', { name: '播放' }), '#33 播放')
    await expect(bar.getByRole('button', { name: '暂停' }), '#33 播放后没变暂停').toBeVisible({ timeout: stationTimeout() })
    await clickOrFail(bar.getByRole('button', { name: '暂停' }), '#33 暂停')
    const timeText = () => bar.locator('[data-control-scope="transport"] span').first().innerText()
    const t0 = await timeText()
    await clickOrFail(bar.getByRole('button', { name: '下一帧' }), '#33 下一帧')
    await clickOrFail(bar.getByRole('button', { name: '下一帧' }), '#33 下一帧')
    await clickOrFail(bar.getByRole('button', { name: '上一帧' }), '#33 上一帧')
    await clickOrFail(bar.getByRole('button', { name: '静音' }), '#33 静音')
    await expect(bar.getByRole('button', { name: '取消静音' }), '#33 静音后没变取消静音').toBeVisible()
    await clickOrFail(bar.getByRole('button', { name: '取消静音' }), '#33 取消静音')
    await clickOrFail(bar.getByRole('button', { name: '全屏' }), '#33 全屏')
    await expect.poll(() => win.evaluate(() => Boolean(document.fullscreenElement)), { message: '#33 全屏没进去', timeout: stationTimeout() }).toBe(true)
    await win.evaluate(() => document.exitFullscreen?.())
    parity2.player = { timeBeforeStep: t0, timeAfterStep: await timeText() }

    // #34 文字层：加一条字幕、在画面上拖动、双击改字。
    await clickOrFail(bar.getByRole('button', { name: '添加文字' }), '#34 打开「文字」')
    await clickOrFail(bar.getByRole('menuitem', { name: '字幕' }), '#34 加字幕')
    // 新加的字幕直接进编辑态（现役：addText 后立刻 setEditingTextId），先写一句再拖。
    const firstEditor = win.locator('.workbench-preview-player textarea').first()
    await expect(firstEditor, '#34 加字幕后没进编辑').toBeVisible({ timeout: stationTimeout() })
    await firstEditor.fill('第一句字幕')
    await firstEditor.press('Enter')
    // 刚加的字幕是选中态（带四角框，内层 title=拖动移动 · 四角缩放 · 双击改字）；没选中时是 __text-box。
    const target = win.locator('.workbench-preview-player [title="拖动移动 · 四角缩放 · 双击改字"], .workbench-preview-player__text-box').first()
    await expect(target, '#34 加字幕后画面上没有文字层').toBeVisible({ timeout: stationTimeout() })
    const box0 = await target.boundingBox()
    if (!box0) throw new Error('#34 文字层没有几何')
    await win.mouse.move(box0.x + box0.width / 2, box0.y + box0.height / 2)
    await win.mouse.down()
    await win.mouse.move(box0.x + box0.width / 2 + 60, box0.y + box0.height / 2 - 40, { steps: 8 })
    await win.mouse.up()
    const box1 = await target.boundingBox()
    expect(Math.abs((box1?.x ?? 0) - box0.x) + Math.abs((box1?.y ?? 0) - box0.y), '#34 文字层拖不动').toBeGreaterThan(20)
    // 选中态（四角框）里双击才改字：先确保是选中态那一格，再双击它的文字。
    const selectedText = win.locator('.workbench-preview-player [title="拖动移动 · 四角缩放 · 双击改字"]').first()
    if (!(await selectedText.isVisible().catch(() => false))) await target.click()
    await expect(selectedText, '#34 点文字层没进选中态').toBeVisible({ timeout: stationTimeout() })
    await selectedText.dblclick()
    const textEditor = win.locator('.workbench-preview-player textarea').first()
    await expect(textEditor, '#34 双击文字层没进编辑').toBeVisible({ timeout: stationTimeout() })
    await textEditor.fill('走查字幕')
    await textEditor.press('Enter')
    await expect(win.locator('.workbench-preview-player').getByText('走查字幕').first(), '#34 改字没生效').toBeVisible({ timeout: stationTimeout() })
    await shoot(win, 'check-parity2-preview-text')
    parity2.textLayer = { moved: { dx: Math.round((box1?.x ?? 0) - box0.x), dy: Math.round((box1?.y ?? 0) - box0.y) }, edited: '走查字幕' }
  }

  console.log(JSON.stringify({ tail, measures, shots: shotsTaken }))
} finally {
  await close?.().catch(() => {})
  fs.rmSync(root, { recursive: true, force: true })
}
