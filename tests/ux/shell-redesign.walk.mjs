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
  const setBadge = (status, pending) => win.evaluate(([s, n]) => window.__nomiResidentActivityStore?.getState().setResidentDockBadge(s, n, 0), [status, pending])
  for (const [name, status, pending] of [['chrome-ball-running', 'running', 0], ['chrome-ball-failed', 'failed', 0], ['chrome-ball-pending', 'needs-confirm', 2]]) {
    if (!want(name)) continue
    await setBadge(status, pending)
    await expect(win.locator(`[data-agent-ball="${status === 'needs-confirm' ? 'pending' : status}"]`), `小球没有进入 ${status}`).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    await shoot(win, name)
  }
  await setBadge('idle', 0)

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

  console.log(JSON.stringify({ tail, measures, shots: shotsTaken }))
} finally {
  await close?.().catch(() => {})
  fs.rmSync(root, { recursive: true, force: true })
}
