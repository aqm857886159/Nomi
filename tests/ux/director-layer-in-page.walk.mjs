// 导演台收进生成页 · 真机走查（拦发版项；方向检查 docs/plan/2026-10-29-director-layer-in-page.direction-check.md，设计卡 docs/plan/2026-10-29-director-layer-in-page.md ★9）。
//
// 用法（要先 `pnpm run build`）：
//   node tests/ux/director-layer-in-page.walk.mjs [--en] [--sizes=1440x900,1920x1080,1280x720] [--out=<截图目录>] [--only=<小节编号前缀,…>] [--no-perf] [--no-panorama]
// 零额度、不调任何模型、不碰用户真实项目：隔离资料目录 + 新建空白项目；导演台工程是现役编译器编出来的 S1 oracle 计划（同 director-3dbox-shell）。
//
// 用户症状（2026-10-29）：① 打开导演台后画布右侧还有漏出（Agent 是浮窗时白留 assistantWidth+8）；
// ② 点顶栏「创作」「预览」出不去（导演层挂 body、不跟页面走，左栏还被盖住）；③ 小球形态下 Agent 被导演层盖住。
// 改后这里钉的是：导演层就是生成页那一格——
//   · 主指标：导演层矩形 = 页格矩形（3 种 Agent 形态 × 多种窗口尺寸）；
//   · 页格外没有可点的画布、停靠栏不重叠、小球 / 浮窗在导演层之上；
//   · 点创作 / 预览导演层不可见，回生成还在、选中的镜头不变；左栏点得到；
//   · 隐藏时：Esc / 导演台快捷键不被吞、3D 渲染循环停、暗色锁释放；列表视图同理；
//   · 退出路径、回项目库卸载；全景查看器同一挂法。
// 几何和命中测试量的是真实矩形（elementFromPoint），不是「Playwright 点得动」（CDP 合成点击会绕过命中测试）。
// 红灯形状：在没改结构的树（main 的构建）上，上面多数条目红；改后全绿。
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expectAbsent, proveProbe, screenshotSettled } from './_assert.mjs'
import { addCanvasNode, backToLibrary, canvasFitView, canvasZoomPercent, newProjectEntry, railItem, switchWorkspace } from './_shell.mjs'
import { createBlankProject } from '../../evals/lib/isoApp.mjs'
import { enterDirectorView, enterRefine } from './_directorLab.mjs'
import { uiText } from './full-walk/invariants.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { require as tsxRequire } from 'tsx/cjs/api'

const nodeRequire = createRequire(import.meta.url)
const { S1_ORACLE_PLANS } = tsxRequire('../../evals/director/s1OraclePlans.ts', import.meta.url)
const { compileDirectorPlan } = tsxRequire('../../src/workbench/generationCanvas/nodes/director/model/compiler/directorPlanCompiler.ts', import.meta.url)

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const option = (name) => argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
const locale = flag('en') ? 'en' : 'zh-CN'
const SIZES = (option('sizes') ?? '1440x900,1920x1080,1280x720').split(',').map((text) => {
  const [width, height] = text.split('x').map(Number)
  if (!Number.isInteger(width) || !Number.isInteger(height)) throw new Error(`坏的 --sizes：${text}`)
  return { width, height, label: text }
})
const FORMS = ['float', 'dock', 'ball']
const outDir = path.resolve(option('out') ?? path.join(repoRoot, 'tests/ux/shots/director-layer-in-page', locale))
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

const results = []
const report = { locale, sizes: SIZES.map((size) => size.label), geometry: [], perf: null, notes: [], boardCoverage: null }
// 板断言名 = docs/design/boards/2026-10-29/DirectorInPage.board.json 里各元素的 `assertion`（check:board-parity R4：断言名必须出现在 tests/ux 的走查里）。
// 每条检查用第 5 个参数挂到它守的元素上；走查末尾核「每个元素都有检查挂着且全过」（只有按小节 / 开关裁剪过的跑法不核）。
const E = {
  fillsCell: 'board:DirectorInPage/layer.fills-cell',
  noLeak: 'board:DirectorInPage/layer.no-canvas-leak',
  dockBeside: 'board:DirectorInPage/agent.dock-beside',
  floatAbove: 'board:DirectorInPage/agent.float-above',
  ballAbove: 'board:DirectorInPage/agent.ball-above',
  rail: 'board:DirectorInPage/chrome.rail',
  topbar: 'board:DirectorInPage/chrome.topbar',
  awayHides: 'board:DirectorInPage/nav.away-hides',
  backKeeps: 'board:DirectorInPage/nav.back-keeps',
  keysPass: 'board:DirectorInPage/keys.hidden-pass-through',
  renderStops: 'board:DirectorInPage/render.hidden-stops',
  exitOnTop: 'board:DirectorInPage/exit.confirm-on-top',
  isolation: 'board:DirectorInPage/isolation.canvas-untouched',
  libraryUnmount: 'board:DirectorInPage/lifecycle.library-unmount',
  panorama: 'board:DirectorInPage/panorama.same-mount',
  panoramaBack: 'board:DirectorInPage/panorama.back-keeps',
  copy: 'board:DirectorInPage/copy.unchanged',
}
const check = (id, label, ok, detail = '', element = undefined) => {
  results.push({ id, label, ok: Boolean(ok), detail, ...(element ? { element } : {}) })
  console.log(`  ${ok ? '✓' : '✗'} [${id}] ${label}${detail ? ` — ${detail}` : ''}${element ? ` ‹${element.slice('board:DirectorInPage/'.length)}›` : ''}`)
  return Boolean(ok)
}
const note = (text, extra) => {
  report.notes.push(extra === undefined ? text : { text, extra })
  console.log(`  · ${text}${extra === undefined ? '' : ` ${JSON.stringify(extra)}`}`)
}
/** 一个小节抛了就记一条红，不拖死后面的小节（改前的树上不少步骤本来就走不通）。 */
const onlySections = option('only')?.split(',')
const section = async (id, body) => {
  if (onlySections && !id.startsWith('0') && !onlySections.some((prefix) => id.startsWith(prefix))) return
  try {
    await body()
  } catch (error) {
    check(id, '小节本身没跑完', false, String(error?.message ?? error).split('\n')[0].slice(0, 240))
    await win.screenshot({ path: path.join(outDir, `error-${id}.png`) }).catch(() => undefined)
  }
}

const compiled = compileDirectorPlan(S1_ORACLE_PLANS['courtyard-standoff'])
if (!compiled.ok) throw new Error(`courtyard-standoff 编译失败：${compiled.errors.join('; ')}`)

console.log(`\n=== director-layer-in-page · ${locale} · ${SIZES.map((size) => size.label).join(' ')} ===`)
const { app, win, projectsDir } = await launchNomiApp({
  name: `director-layer-in-page-${locale}`,
  viewportSize: SIZES[0],
  initialLocalStorage: {
    'nomi:locale:v1': locale,
    'nomi-color-scheme': 'light',
    'nomi:splash:v1': 'seen',
    'nomi:journey-tour:v1': 'seen',
    'nomi:canvas-gesture-hint:v1': 'seen',
    __nomiE2E: '1',
  },
})
const pageErrors = []
win.on('pageerror', (error) => pageErrors.push(String(error)))
const timeout = stationTimeout({ operations: 2 })

// ── 页内取量 ────────────────────────────────────────────────────────────────────────────────
/** 页里的命中测试归类：点到的那一格到底是谁。 */
const REGION_SOURCE = `
  const regionOf = (el) => {
    if (!el) return 'none'
    if (el.closest('[data-agent-ball]')) return 'agent-ball'
    if (el.closest('[data-agent-float]')) return 'agent-float'
    if (el.closest('[data-assistant-pane]')) return 'agent-dock'
    if (el.closest('[data-testid="director-editor"]')) return 'director'
    if (el.closest('[data-panorama-dialog-panel]') || el.closest('[data-generation-page-layer]')) return 'page-layer'
    const rail = el.closest('[data-shell-rail-item]')
    if (rail) return 'rail:' + rail.getAttribute('data-shell-rail-item')
    if (el.closest('[data-shell-topbar]')) return 'topbar'
    if (el.closest('[data-shell-drawer]')) return 'drawer'
    if (el.closest('[data-generation-canvas-surface]')) return 'canvas'
    if (el.closest('.workbench-generation__canvas')) return 'cell-other'
    return 'other:' + el.tagName.toLowerCase()
  }
  const box = (el) => {
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return { x: +rect.x.toFixed(1), y: +rect.y.toFixed(1), w: +rect.width.toFixed(1), h: +rect.height.toFixed(1), right: +rect.right.toFixed(1), bottom: +rect.bottom.toFixed(1) }
  }
  const shown = (el) => Boolean(el) && el.getClientRects().length > 0
`

const measure = () => win.evaluate(`(() => {
  ${REGION_SOURCE}
  const cell = document.querySelector('.workbench-generation__canvas')
  const editor = document.querySelector('[data-testid="director-editor"]')
  // 创作 / 分镜 / 预览三页的槽位里也各挂着一份停靠栏（被藏着，没有 client rect）：只认看得见的那份
  const dock = [...document.querySelectorAll('[data-assistant-pane]')].find(shown) ?? null
  const float = document.querySelector('[data-agent-float]')
  const ball = document.querySelector('[data-agent-ball]')
  const cellBox = box(cell)
  const editorBox = shown(editor) ? box(editor) : null
  const hit = (x, y) => regionOf(document.elementFromPoint(x, y))
  const center = (b) => b && ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
  // 导演层之外、页格之内 + 导演层右边一小条：这些点上不许是画布（改前：浮窗时白留的那一条）
  const leaks = []
  if (editorBox && cellBox) {
    const ys = [0.2, 0.5, 0.8].map((f) => cellBox.y + cellBox.h * f)
    const xs = [2, 6, 12, 40, 120, 300].map((dx) => editorBox.right + dx).filter((x) => x < window.innerWidth - 1)
    for (const x of xs) for (const y of ys) { const region = hit(x, y); if (region === 'canvas' || region === 'cell-other') leaks.push({ x: Math.round(x), y: Math.round(y), region }) }
  }
  const railHits = {}
  for (const item of ['docs', 'assets']) {
    const el = document.querySelector('[data-shell-rail-item="' + item + '"]')
    const b = shown(el) ? box(el) : null
    const c = center(b)
    railHits[item] = b ? { box: b, hit: hit(c.x, c.y) } : null
  }
  const modeButtons = {}
  for (const mode of ['creation', 'generation', 'preview']) {
    const el = document.querySelector('[data-shell-stage-center] [data-mode="' + mode + '"]')
    const b = shown(el) ? box(el) : null
    const c = center(b)
    modeButtons[mode] = b ? { hit: hit(c.x, c.y) } : null
  }
  const floatBox = shown(float) ? box(float) : null
  const ballBox = shown(ball) ? box(ball) : null
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    workspaceMode: document.querySelector('[data-workspace-mode]')?.getAttribute('data-workspace-mode') ?? null,
    cell: cellBox,
    editor: editorBox,
    editorInDom: document.querySelectorAll('[data-testid="director-editor"]').length,
    layerInDom: document.querySelectorAll('[data-generation-page-layer]').length,
    dock: shown(dock) ? box(dock) : null,
    float: floatBox,
    ball: ballBox,
    floatCenterHit: floatBox ? hit(center(floatBox).x, center(floatBox).y) : null,
    ballCenterHit: ballBox ? hit(center(ballBox).x, center(ballBox).y) : null,
    leaks,
    railHits,
    modeButtons,
    scheme: document.documentElement.getAttribute('data-mantine-color-scheme'),
    canvasPx: (() => { const canvas = editor?.querySelector('canvas'); return canvas && shown(canvas) ? { w: canvas.clientWidth, h: canvas.clientHeight } : null })(),
  }
})()`)

/** 布局稳定：页格矩形连续 8 帧不变（Agent 形态切换有弹簧动画、窗口缩放有重排）。 */
const settleLayout = async () => {
  await win.evaluate(() => { window.__layoutSettle = undefined })
  await win.waitForFunction(() => {
    const cell = document.querySelector('.workbench-generation__canvas')
    if (!cell || cell.getClientRects().length === 0) return false
    const rect = cell.getBoundingClientRect()
    const key = [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(value * 10)).join(',')
    const previous = window.__layoutSettle
    window.__layoutSettle = { key, count: previous && previous.key === key ? previous.count + 1 : 0 }
    return window.__layoutSettle.count >= 8
  }, null, { polling: 'raf', timeout })
}

// 截图先等视觉安定（确认框的淡入、Agent 弹簧动画走完）；3D 视口一直在画、等不到安定就退回直接截。
const shot = async (name) => {
  const file = path.join(outDir, `${name}.png`)
  await screenshotSettled(win, { path: file }).catch(() => win.screenshot({ path: file }))
  return file
}

const resizeTo = async (size) => {
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((window, next) => window.setContentSize(next.width, next.height), { width: size.width, height: size.height })
  await win.setViewportSize({ width: size.width, height: size.height })
  await win.waitForFunction((next) => window.innerWidth === next.width && window.innerHeight === next.height, { width: size.width, height: size.height }, { timeout })
  await settleLayout()
}

const setAgentForm = async (form) => {
  await win.evaluate((next) => window.__nomiAgentFormStore.getState().setForm('generation', next), form)
  await win.waitForFunction((next) => document.querySelector('[data-shell-agent-layer]')?.getAttribute('data-agent-form') === next, form, { timeout })
  await settleLayout()
}

const near = (a, b, tolerance = 1.5) => a !== null && b !== null && Math.abs(a - b) <= tolerance
const sameRect = (a, b) => Boolean(a && b) && near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h)
const editorVisible = () => win.evaluate(() => { const el = document.querySelector('[data-testid="director-editor"]'); return Boolean(el) && el.getClientRects().length > 0 })
const selectedShot = () => win.evaluate(() => document.querySelector('[data-testid="director-shot-2"]')?.getAttribute('aria-pressed') ?? null)
const viewTitle = () => win.evaluate(() => document.querySelector('[data-testid="director-view-title"]')?.textContent?.trim() ?? null)
const modeButton = (mode) => win.locator(`[data-shell-stage-center] [data-mode="${mode}"]`).first()

/** 文档级键盘探针：捕获不到的键 = 被谁在更早的监听里吃掉了（stopPropagation / stopImmediatePropagation）。 */
const installKeyProbe = () => win.evaluate(() => {
  window.__keyProbeOff?.() // 重装前先摘掉上一份，不然同一个键会被记两遍
  window.__keyProbe = []
  const record = (event) => window.__keyProbe.push({ key: event.key, defaultPrevented: event.defaultPrevented })
  document.addEventListener('keydown', record)
  window.__keyProbeOff = () => document.removeEventListener('keydown', record)
})
const readKeyProbe = () => win.evaluate(() => window.__keyProbe.slice())
const blurFocus = () => win.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })

/** 绘制调用计数（WebGL 的 draw 调用是「渲染循环还在跑」的直接证据，不依赖产品里有没有帧计数器）。 */
const installDrawCounter = () => win.evaluate(() => {
  if (window.__drawCount !== undefined) return
  window.__drawCount = 0
  for (const proto of [window.WebGL2RenderingContext?.prototype, window.WebGLRenderingContext?.prototype]) {
    if (!proto) continue
    for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) {
      const original = proto[name]
      if (typeof original !== 'function') continue
      proto[name] = function patchedDraw(...args) { window.__drawCount += 1; return original.apply(this, args) }
    }
  }
})
const drawCountOver = async (ms) => {
  const before = await win.evaluate(() => window.__drawCount)
  await win.evaluate((span) => new Promise((resolve) => setTimeout(resolve, span)), ms)
  return (await win.evaluate(() => window.__drawCount)) - before
}
const processCpu = () => app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics().map((entry) => ({ type: entry.type, cpu: entry.cpu.percentCPUUsage })))
const cpuOver = async (ms) => {
  await processCpu()
  await win.evaluate((span) => new Promise((resolve) => setTimeout(resolve, span)), ms)
  const rows = await processCpu()
  const sum = (types) => +rows.filter((row) => types.includes(row.type)).reduce((total, row) => total + row.cpu, 0).toFixed(1)
  return { renderer: sum(['Tab']), gpu: sum(['GPU']), all: sum(rows.map((row) => row.type)) }
}

// ═══ 小节 0：起项目、摆导演台节点、进导演台 ═══════════════════════════════════════════════
let directorId = null
await section('0-setup', async () => {
  await newProjectEntry(win).waitFor({ timeout })
  await createBlankProject(win, projectsDir)
  await switchWorkspace(win, 'generation')
  // 空项目没有「画面」：先走真入口建一张图片卡，导演台节点才有地方落（同 director-3dbox-shell）
  await win.locator('[data-empty-canvas-tasks] [data-add-intent="image"]').first().click({ timeout })
  await addCanvasNode(win, 'director', { timeout })
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore), null, { timeout })
  directorId = await win.evaluate((directorProject) => {
    const state = window.__nomiCanvasStore.getState()
    const node = state.nodes.find((item) => item.kind === 'director')
    state.updateNode(node.id, { title: 'Courtyard', meta: { ...node.meta, directorProject } })
    return node.id
  }, compiled.project)
  await canvasFitView(win, 'fit view')
  await win.locator('[data-testid="director-node"]').first().waitFor({ timeout })
  await installDrawCounter()
  await installKeyProbe()
  // 画布节点外壳的挂载 / 卸载日志（诊断用：哪个节点在切页的哪一刻被画布卸载又挂回，就是这份日志说的）
  await win.evaluate(() => {
    window.__nodeLog = []
    const modeNow = () => document.querySelector('[data-workspace-mode]')?.getAttribute('data-workspace-mode') ?? null
    const record = (kind, element) => {
      if (!(element instanceof Element) || !element.matches('.react-flow__node')) return
      const node = element.getBoundingClientRect()
      const viewport = document.querySelector('.react-flow__renderer')?.getBoundingClientRect()
      window.__nodeLog.push({ at: Math.round(performance.now()), kind, id: element.getAttribute('data-id'), mode: modeNow(),
        node: { left: node.left, top: node.top, right: node.right, bottom: node.bottom },
        viewport: viewport ? { left: viewport.left, top: viewport.top, right: viewport.right, bottom: viewport.bottom } : null })
    }
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.removedNodes.forEach((element) => record('remove', element))
        mutation.addedNodes.forEach((element) => record('add', element))
      }
    }).observe(document.body, { childList: true, subtree: true })
  })
  check('0', '导演台节点已就位', Boolean(directorId), String(directorId))
})

const openDirector = async () => {
  // 点法：节点卡上的「进入」。节点在视口里（fit view 过）；先真点，真点不到（缩得很小被浮件挡住）才退回 JS click——开法不是这份走查要验的东西。
  const open = win.locator(`[data-node-id="${directorId}"] [data-testid="director-node-open"]`).first()
  const clicked = await open.click({ timeout: 4000 }).then(() => true, () => false)
  if (!clicked) {
    note('进入按钮真点不到，退回 JS click', { directorId })
    await open.evaluate((element) => element.click())
  }
  await win.locator('[data-testid="director-editor"]').first().waitFor({ state: 'visible', timeout })
  await win.waitForFunction(() => Boolean(window.__nomiDirectorE2E), null, { timeout })
  await win.locator('[data-testid="director-shot-2"]').first().waitFor({ timeout })
}

// 「导演层卸载了」是一条「不存在」断言：先在它开着的时候证一次探针测得到它（proveProbe），再断言它持续不存在（expectAbsent，
// 降到 0 之后还要保持 800ms，异步再挂回来的鬼影溜不过去）——不用裸的 querySelectorAll(...).length === 0（门岗 check:walkthroughs 的 absence-without-baseline）。
const directorEditor = () => win.locator('[data-testid="director-editor"]')
const proveDirectorOpen = () => proveProbe(directorEditor(), '导演台开着时探针找得到它')
const expectDirectorGone = (message, proof) => expectAbsent(directorEditor(), { provenBy: proof, message }, timeout)
const closeDirectorIfOpen = async () => {
  if (!(await directorEditor().count())) return
  const proof = await proveDirectorOpen()
  await win.locator('[data-testid="director-exit"]').first().click({ timeout })
  await win.locator('[data-confirm-dialog-confirm]').first().click({ timeout })
  await expectDirectorGone('退出确认后导演层卸载', proof)
}

// 对照：没开导演台时点 Agent 小球，输入框拿没拿到焦点（外壳自己的行为；开了导演台以后点小球必须和它一致，不能更差）
let composerFocusControl = null
await section('0-control', async () => {
  await setAgentForm('ball')
  await win.locator('[data-agent-ball]').first().click({ timeout })
  await win.waitForFunction(() => document.querySelector('[data-shell-agent-layer]')?.getAttribute('data-agent-form') === 'float', null, { timeout })
  composerFocusControl = await win.waitForFunction(() => Boolean(document.activeElement?.closest?.('#project-agent-resident')), null, { timeout: 2500 }).then(() => true, () => false)
  note('对照：没开导演台时点小球，输入框拿到焦点', { composerFocusControl })
  await setAgentForm('ball')
})

let opened = false
await section('0-open', async () => {
  await openDirector()
  opened = true
  await win.locator('[data-testid="director-shot-2"]').click({ timeout })
  await win.waitForFunction(() => document.querySelector('[data-testid="director-shot-2"]')?.getAttribute('aria-pressed') === 'true', null, { timeout })
  await settleLayout()
  // 文案不变：页面根的名字仍取自词典（角色从 dialog 换成 region，名字没动）
  const regionLabel = await win.evaluate(() => document.querySelector('[data-testid="director-editor"]')?.getAttribute('aria-label') ?? null)
  const expectedLabel = `${uiText(locale, 'director.editor.aria')} · Courtyard`
  check('0.copy-region', '导演台页面根的名字取自词典（文案不变）', regionLabel === expectedLabel, `${regionLabel} ≟ ${expectedLabel}`, E.copy)
})
if (!opened) {
  await app.close().catch(() => {})
  console.error('\n✗ 进不了导演台，后面的小节都没法跑')
  process.exit(1)
}
const titleBefore = await viewTitle()
note('选中镜头 2', { title: titleBefore })

// ═══ 小节 1：几何矩阵（主指标）═══════════════════════════════════════════════════════════
await section('1-geometry', async () => {
  for (const size of SIZES) {
    await resizeTo(size)
    for (const form of FORMS) {
      await setAgentForm(form)
      const m = await measure()
      const tag = `${size.label}-${form}`
      report.geometry.push({ size: size.label, form, ...m })
      check(`1.${tag}.rect`, `${tag}：导演层矩形 = 页格矩形`, sameRect(m.editor, m.cell), `editor=${JSON.stringify(m.editor)} cell=${JSON.stringify(m.cell)}`, E.fillsCell)
      check(`1.${tag}.leak`, `${tag}：导演层外没有可点的画布（命中测试）`, m.leaks.length === 0, m.leaks.length ? `${m.leaks.length} 个点落在画布上，例 ${JSON.stringify(m.leaks[0])}` : '', E.noLeak)
      if (form === 'dock') check(`1.${tag}.dock`, `${tag}：停靠栏与导演层不重叠`, Boolean(m.dock && m.editor) && m.editor.right <= m.dock.x + 1.5, `editor.right=${m.editor?.right} dock.x=${m.dock?.x}`, E.dockBeside)
      if (form === 'float') check(`1.${tag}.float`, `${tag}：浮窗在导演层之上、点得到`, m.floatCenterHit === 'agent-float', String(m.floatCenterHit), E.floatAbove)
      if (form === 'ball') check(`1.${tag}.ball`, `${tag}：小球在导演层之上、点得到`, m.ballCenterHit === 'agent-ball', String(m.ballCenterHit), E.ballAbove)
      check(`1.${tag}.rail`, `${tag}：左栏「文稿」「素材」命中落在按钮上`, m.railHits.docs?.hit === 'rail:docs' && m.railHits.assets?.hit === 'rail:assets', `docs=${m.railHits.docs?.hit} assets=${m.railHits.assets?.hit}`, E.rail)
      check(`1.${tag}.topbar`, `${tag}：顶栏「创作」「生成」「预览」命中落在顶栏上`, ['creation', 'generation', 'preview'].every((mode) => m.modeButtons[mode]?.hit === 'topbar'), JSON.stringify(m.modeButtons), E.topbar)
      await shot(`${size.label}-${form}-open`)
    }
  }
})

// ═══ 小节 2：Agent 交互（小球叫出 / 浮窗拖到导演层上面 / 停靠栏拖宽）══════════════════════
await section('2-agent', async () => {
  await resizeTo(SIZES[0])
  await setAgentForm('ball')
  const ballClicked = await win.locator('[data-agent-ball]').first().click({ timeout: 4000 }).then(() => true, () => false)
  if (ballClicked) await win.waitForFunction(() => document.querySelector('[data-shell-agent-layer]')?.getAttribute('data-agent-form') === 'float', null, { timeout: 4000 }).catch(() => undefined)
  const afterBall = await measure()
  check('2.ball-click', '真点小球 → 变浮窗，浮窗在导演层之上', ballClicked && afterBall.floatCenterHit === 'agent-float' && sameRect(afterBall.editor, afterBall.cell), ballClicked ? String(afterBall.floatCenterHit) : '小球点不到（被导演层盖住）', E.ballAbove)
  if (ballClicked) {
    const focused = await win.waitForFunction(() => Boolean(document.activeElement?.closest?.('#project-agent-resident')), null, { timeout: 2500 }).then(() => true, () => false)
    check('2.composer-focus', '点开后 Agent 面板里的输入拿到焦点——和没开导演台时点小球一致', focused === composerFocusControl, `开了导演台：${focused}；没开导演台（对照）：${composerFocusControl}`, E.ballAbove)
    // 浮窗里的输入框：中心点命中在 Agent 面板里（没被导演层盖住）、而且能聚焦
    // 找的是**看得见的那个浮窗**里的输入（创作 / 分镜 / 预览三页的槽位里也各挂着一份 Agent 面板，被藏着；按 id 取第一个会取到藏着的那份）
    const composer = await win.evaluate(() => {
      const root = document.querySelector('[data-agent-float]')
      const input = [...(root?.querySelectorAll('.ProseMirror[contenteditable="true"], textarea') ?? [])].find((element) => element.getClientRects().length > 0)
      if (!root || !input) return { found: false }
      const rect = input.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      input.focus()
      return { found: true, hitInside: Boolean(hit && root.contains(hit)), focusable: Boolean(document.activeElement && root.contains(document.activeElement)) }
    })
    check('2.composer-usable', '浮窗里的输入框点得到（命中在 Agent 面板里）且能聚焦', composer.found && composer.hitInside && composer.focusable, JSON.stringify(composer), E.ballAbove)
  } else {
    check('2.composer-focus', '点开后 Agent 面板里的输入拿到焦点——和没开导演台时点小球一致', false, '小球没点开', E.ballAbove)
    await setAgentForm('float')
  }
  await settleLayout()
  // 浮窗拖到导演层中央：仍在导演层之上、点得到
  const floatBox = (await measure()).float
  if (floatBox) {
    const handleX = floatBox.x + floatBox.w / 2
    const handleY = floatBox.y + 4
    await win.mouse.move(handleX, handleY)
    await win.mouse.down()
    await win.mouse.move(handleX - 380, handleY - 120, { steps: 8 })
    await win.mouse.up()
    await settleLayout()
    const afterDrag = await measure()
    check('2.float-drag', '浮窗拖到导演层上面后仍在导演层之上、点得到', Boolean(afterDrag.float) && afterDrag.floatCenterHit === 'agent-float' && afterDrag.float.x < floatBox.x - 100, `float.x ${floatBox.x} → ${afterDrag.float?.x}，命中 ${afterDrag.floatCenterHit}`, E.floatAbove)
    await shot('agent-float-dragged-over-director')
  } else {
    check('2.float-drag', '浮窗拖到导演层上面后仍在导演层之上、点得到', false, '没有浮窗', E.floatAbove)
  }
  // 停靠栏拖宽 / 变窄：3D 画布跟着页格改尺寸
  await setAgentForm('dock')
  const separator = win.locator('[data-assistant-resize]').filter({ visible: true }).first()
  await separator.focus()
  await win.keyboard.press('End')
  await settleLayout()
  const wide = await measure()
  await win.keyboard.press('Home')
  await settleLayout()
  const narrow = await measure()
  check('2.dock-resize.rect', '停靠栏拖宽 / 变窄后导演层仍 = 页格', sameRect(wide.editor, wide.cell) && sameRect(narrow.editor, narrow.cell) && narrow.cell.w > wide.cell.w + 50, `页格宽 ${wide.cell.w} → ${narrow.cell.w}`, E.fillsCell)
  const cellDelta = narrow.cell.w - wide.cell.w
  check('2.dock-resize.canvas', '停靠栏变宽 / 变窄时 3D 画布跟着页格改尺寸', Boolean(wide.canvasPx && narrow.canvasPx) && Math.abs((narrow.canvasPx.w - wide.canvasPx.w) - cellDelta) <= 3 && cellDelta > 50, `页格宽 ${wide.cell.w} → ${narrow.cell.w}，3D 画布宽 ${wide.canvasPx?.w} → ${narrow.canvasPx?.w}`, E.dockBeside)
  await win.keyboard.press('ArrowLeft')
  await setAgentForm('float')
})

// ═══ 小节 3：画布 | 列表、时间轴面板 ══════════════════════════════════════════════════════════
await section('3-view-and-timeline', async () => {
  await resizeTo(SIZES[0])
  // 生成页「画布 | 列表」：列表开着时导演层跟着藏，切回还在
  await win.locator('[data-generation-view-switcher]').first().click({ timeout })
  await win.waitForFunction(() => document.querySelector('[data-generation-view-switcher]')?.getAttribute('data-generation-view-switcher') === 'list', null, { timeout })
  await settleLayout().catch(() => undefined)
  const hiddenInList = !(await editorVisible())
  check('3.list-hides', '切到列表视图：导演层不可见', hiddenInList, '', E.awayHides)
  await shot('list-view-director-hidden')
  await win.locator('[data-generation-view-switcher]').first().click({ timeout })
  await win.waitForFunction(() => document.querySelector('[data-generation-view-switcher]')?.getAttribute('data-generation-view-switcher') === 'canvas', null, { timeout })
  await settleLayout()
  check('3.list-back', '切回画布：导演层还在，选中的镜头没变', (await editorVisible()) && (await selectedShot()) === 'true' && (await viewTitle()) === titleBefore, `title=${await viewTitle()}`, E.backKeeps)
  // 时间轴窄条展开：页格高度变，导演层跟着，不被盖也不盖它
  const before = await measure()
  const stripClicked = await win.locator('[data-timeline-strip]').first().click({ timeout: 3000 }).then(() => true, () => false)
  if (stripClicked) await settleLayout()
  const expanded = await measure()
  check('3.timeline-expand', '生成页时间轴窄条真点得到，展开后导演层仍 = 页格（页格变矮了）', stripClicked && sameRect(expanded.editor, expanded.cell) && expanded.cell.h < before.cell.h - 40, `${stripClicked ? '' : '窄条点不到（被盖住）；'}页格高 ${before.cell.h} → ${expanded.cell.h}`, E.fillsCell)
  await shot('timeline-expanded')
  // 收回去：后面的小节和截图按时间轴窄条的常态版面走（和 before 截图同一版面）
  await win.locator('[data-timeline-collapse]').first().click({ timeout: 3000 }).catch(() => undefined)
  await win.locator('[data-timeline-strip]').first().waitFor({ state: 'visible', timeout: 4000 }).catch(() => undefined)
  await settleLayout()
})

// ═══ 小节 4：切页（创作 / 预览）、隐藏时的键盘与渲染、暗色锁、左栏 ═══════════════════════
await section('4-navigation', async () => {
  await resizeTo(SIZES[0])
  await setAgentForm('float')
  const visibleScheme = (await measure()).scheme
  note('导演台开着时的整体配色', { scheme: visibleScheme })
  // 导演台开着：左栏点得到（真点一次，抽屉真开）
  const docsRail = railItem(win, 'docs')
  const railClicked = await docsRail.click({ timeout: 2500 }).then(() => true, () => false)
  const drawerOpened = railClicked && (await win.locator('[data-shell-drawer="docs"]').first().waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false))
  check('4.rail-click', '导演台开着时，真点左栏「文稿」→ 抽屉打开', drawerOpened, railClicked ? '点到了' : '点不到（被盖住）', E.rail)
  if (drawerOpened) {
    await shot('rail-docs-drawer-open')
    await docsRail.click({ timeout: 2500 }).catch(() => {})
    await win.locator('[data-shell-drawer="docs"]').first().waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {})
  }
  await settleLayout()

  // 隐藏前先数一轮「看得见时」的渲染与 CPU
  const visibleDraws = flag('no-perf') ? null : await drawCountOver(2000)
  const visibleCpu = flag('no-perf') ? null : await cpuOver(2000)

  for (const target of ['creation', 'preview']) {
    await modeButton(target).click({ timeout })
    await win.waitForFunction((mode) => document.querySelector('[data-shell-stage-center] [data-mode="' + mode + '"]')?.getAttribute('aria-current') === 'page', target, { timeout })
    // 等切页落定：目标页的槽位可见、生成页槽位被藏
    await win.waitForFunction((mode) => document.querySelector('[data-workspace-mode]')?.getAttribute('data-workspace-mode') === mode, target, { timeout })
    const m = await measure()
    check(`4.${target}.hidden`, `点「${target === 'creation' ? '创作' : '预览'}」→ 导演层不可见`, m.editor === null, m.editor ? `导演层还在 ${JSON.stringify(m.editor)}` : '', E.awayHides)
    check(`4.${target}.scheme`, `在${target === 'creation' ? '创作' : '预览'}页，整体配色回到用户自己的（暗色锁释放）`, m.scheme === 'light', `scheme=${m.scheme}`, E.awayHides)
    await shot(`nav-${target}`)
  }

  // 隐藏时的键盘：Esc 和导演台快捷键（工具 1 / 2 / 3、Delete / Backspace、⌘Z）不被吞（预览页 / 创作页自己的处理照常拿得到）
  await blurFocus()
  await installKeyProbe()
  for (const key of ['1', '2', '3', 'Delete', 'Backspace', 'Escape', 'Meta+z']) await win.keyboard.press(key)
  const probe = await readKeyProbe()
  const keysSeen = probe.map((entry) => entry.key)
  check('4.hidden-esc', '导演台藏着时，Esc 没被它吞掉（文档级监听拿得到）', keysSeen.includes('Escape'), `收到 ${JSON.stringify(keysSeen)}`, E.keysPass)
  check('4.hidden-hotkey', '导演台藏着时，导演台快捷键（1 2 3 / Delete / Backspace / ⌘Z）全部到得了文档级监听，Backspace 也没被 preventDefault', ['1', '2', '3', 'Delete', 'Backspace', 'z'].every((key) => keysSeen.includes(key)) && probe.some((entry) => entry.key === 'Backspace' && entry.defaultPrevented === false), `收到 ${JSON.stringify(probe)}`, E.keysPass)
  const confirmOpen = await win.locator('[data-confirm-dialog-surface]').first().isVisible().catch(() => false)
  check('4.hidden-no-exit-confirm', '在创作 / 预览页按 Esc 不会弹出藏着的导演台的退出确认', !confirmOpen, '', E.keysPass)
  if (confirmOpen) await win.locator('[data-confirm-dialog-cancel]').first().click({ timeout: 3000 }).catch(() => {})

  // 隐藏时渲染循环停：绘制调用清零、CPU 回落
  if (!flag('no-perf')) {
    const hiddenDraws = await drawCountOver(2000)
    const hiddenCpu = await cpuOver(2000)
    report.perf = { visible: { draws2s: visibleDraws, cpu: visibleCpu }, hiddenOnPreviewPage: { draws2s: hiddenDraws, cpu: hiddenCpu } }
    check('4.hidden-render-stops', '导演台藏着时 3D 渲染循环停（2 秒内 WebGL 绘制调用 = 0）', hiddenDraws === 0, `看得见时 2 秒 ${visibleDraws} 次，藏着时 ${hiddenDraws} 次；CPU（渲染进程 / GPU）${JSON.stringify(visibleCpu)} → ${JSON.stringify(hiddenCpu)}`, E.renderStops)
  }

  // 回生成：导演台原样还在
  await modeButton('generation').click({ timeout })
  await win.waitForFunction(() => document.querySelector('[data-workspace-mode]')?.getAttribute('data-workspace-mode') === 'generation', null, { timeout })
  await settleLayout()
  const back = await measure()
  check('4.back.visible', '点回「生成」→ 导演层可见且 = 页格', sameRect(back.editor, back.cell), JSON.stringify(back.editor), E.backKeeps)
  check('4.back.state', '切回来选中的镜头没变、标题没变', (await selectedShot()) === 'true' && (await viewTitle()) === titleBefore, `shot2 pressed=${await selectedShot()} title=${await viewTitle()}`, E.backKeeps)
  check('4.back.scheme', '切回来导演台的暗色锁重新生效', back.scheme === 'dark', `scheme=${back.scheme}`, E.backKeeps)
  if (!flag('no-perf')) {
    const resumedDraws = await drawCountOver(1500)
    check('4.back.render-resumes', '切回来 3D 渲染循环恢复', resumedDraws > 0, `1.5 秒 ${resumedDraws} 次绘制`, E.renderStops)
    report.perf = { ...(report.perf ?? {}), resumed: { draws1500ms: resumedDraws } }
  }
  await shot('nav-back-generation')
})

// ═══ 小节 4b：录运镜到一半切走 → 本次录制被放弃（和 Esc 同语义），不在后台悄悄继续 ═══════════════
await section('4b-record', async () => {
  await resizeTo(SIZES[0])
  await setAgentForm('float')
  await enterRefine(win)
  // 进机位视角（小窗里的「进入视角」）→ 点 HUD 里的「录制运镜」→ 钮变成「完成录制」= 正在录
  await win.getByTestId('director-pip').getByRole('button', { name: uiText(locale, 'director.camera.enterPov') }).first().click({ timeout })
  const hud = win.getByTestId('director-pov-hud').first()
  await hud.waitFor({ state: 'visible', timeout })
  const recordButton = hud.getByRole('button', { name: uiText(locale, 'director.camera.recordMotion') }).first()
  const finishButton = hud.getByRole('button', { name: uiText(locale, 'director.camera.finishRecording') }).first()
  await recordButton.click({ timeout })
  await finishButton.waitFor({ state: 'visible', timeout })
  // 切去创作、过一会儿再回生成（录制要是在后台继续，钮会一直是「完成录制」）
  await modeButton('creation').click({ timeout })
  await win.waitForFunction(() => document.querySelector('[data-workspace-mode]')?.getAttribute('data-workspace-mode') === 'creation', null, { timeout })
  await win.waitForTimeout(800)
  await modeButton('generation').click({ timeout })
  await win.waitForFunction(() => document.querySelector('[data-workspace-mode]')?.getAttribute('data-workspace-mode') === 'generation', null, { timeout })
  await settleLayout()
  await hud.waitFor({ state: 'visible', timeout })
  const stillRecording = await finishButton.isVisible().catch(() => false)
  const canRecordAgain = await recordButton.isVisible().catch(() => false)
  check('4b.record-cancelled', '录运镜到一半切去创作再回来：本次录制已放弃（钮回到「录制运镜」，不在后台继续）', !stillRecording && canRecordAgain, `完成录制钮还在：${stillRecording}；录制运镜钮在：${canRecordAgain}`, E.awayHides)
  await shot('record-cancelled-after-return')
  // 收尾：退出机位视角、回导演视图（后面的小节从导演视图起跑）
  await hud.getByRole('button', { name: uiText(locale, 'director.camera.exitPov') }).first().click({ timeout }).catch(() => undefined)
  await enterDirectorView(win)
})

// ═══ 小节 5：导演台里按 Delete / 滚轮不碰画布 ═════════════════════════════════════════════
await section('5-isolation', async () => {
  const nodeCountBefore = await win.evaluate(() => window.__nomiCanvasStore.getState().nodes.length)
  const zoomBefore = await canvasZoomPercent(win).catch(() => null)
  await win.evaluate((id) => window.__nomiCanvasStore.getState().selectNode(id), directorId)
  await win.locator('[data-testid="director-editor"]').click({ position: { x: 40, y: 200 }, force: true })
  await win.keyboard.press('Delete')
  const viewport = win.locator('[data-testid="director-viewport"]').first()
  const box = await viewport.boundingBox()
  if (box) {
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await win.mouse.wheel(0, -240)
  }
  await settleLayout()
  const nodeCountAfter = await win.evaluate(() => window.__nomiCanvasStore.getState().nodes.length)
  const zoomAfter = await canvasZoomPercent(win).catch(() => null)
  check('5.delete', '导演台里按 Delete 不删画布节点', nodeCountAfter === nodeCountBefore, `节点 ${nodeCountBefore} → ${nodeCountAfter}`, E.isolation)
  check('5.wheel', '导演台视口里滚轮不缩放后面的画布', zoomBefore === null || zoomAfter === null || zoomBefore === zoomAfter, `缩放 ${zoomBefore} → ${zoomAfter}`, E.isolation)
})

// ═══ 小节 5b：导演台自己的对话框（设置 / 帮助）仍在最上面，Esc 只收对话框 ═══════════════════════
await section('5b-dialogs', async () => {
  await resizeTo(SIZES[0])
  await setAgentForm('float')
  await enterRefine(win)
  await win.getByTestId('director-view-menu').click({ timeout })
  const prefs = win.getByRole('button', { name: uiText(locale, 'director.viewMenu.prefs') }).first()
  await prefs.click({ timeout })
  const dialog = win.getByTestId('director-settings-dialog')
  await dialog.waitFor({ state: 'visible', timeout })
  const onTop = await win.evaluate(() => {
    const dialogEl = document.querySelector('[data-testid="director-settings-dialog"]')
    const floatEl = document.querySelector('[data-agent-float]')
    const railEl = document.querySelector('[data-shell-rail-item="docs"]')
    const center = (el) => { const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] }
    const hitDialog = dialogEl ? document.elementFromPoint(...center(dialogEl)) : null
    const hitFloat = floatEl ? document.elementFromPoint(...center(floatEl)) : null
    const hitRail = railEl ? document.elementFromPoint(...center(railEl)) : null
    return {
      dialogOnTop: Boolean(hitDialog && dialogEl.contains(hitDialog)),
      // 对话框的遮罩盖住 Agent 浮窗和左栏（全局模态层级 > 页格内的层与 Agent 层）：这两处中心点命中的不能还是浮窗 / 左栏按钮
      floatCovered: !(hitFloat && hitFloat.closest('[data-agent-float]')),
      railCovered: !(hitRail && hitRail.closest('[data-shell-rail-item]')),
    }
  })
  check('5b.settings-on-top', '导演台设置对话框在最上面：在导演层、Agent 浮窗、左栏之上', onTop.dialogOnTop && onTop.floatCovered && onTop.railCovered, JSON.stringify(onTop), E.exitOnTop)
  await shot('director-settings-dialog')
  await win.keyboard.press('Escape')
  const closed = await dialog.waitFor({ state: 'hidden', timeout: 4000 }).then(() => true, () => false)
  check('5b.esc-closes-dialog-only', 'Esc 只收设置对话框：导演台还开着、没弹退出确认', closed && (await editorVisible()) && !(await win.locator('[data-confirm-dialog-surface]').first().isVisible().catch(() => false)), '', E.exitOnTop)
  await enterDirectorView(win)
})

// ═══ 小节 6：退出路径（← 和 Esc → 确认框在最上面 → 退出）、两个节点先后打开 ═══════════════
await section('6-exit', async () => {
  const confirmOnTop = () => win.evaluate(`(() => {
    ${REGION_SOURCE}
    const surface = document.querySelector('[data-confirm-dialog-surface]')
    if (!surface || surface.getClientRects().length === 0) return null
    const b = box(surface)
    const el = document.elementFromPoint(b.x + b.w / 2, b.y + b.h / 2)
    return { inDialog: Boolean(el && surface.contains(el)), box: b }
  })()`)
  // 导演台这会儿开着：先证探针测得到它，后面「卸载了」的断言才有基线
  const exitProof = await proveDirectorOpen()
  // ← 退出
  await win.locator('[data-testid="director-exit"]').first().click({ timeout })
  await win.locator('[data-confirm-dialog-surface]').first().waitFor({ state: 'visible', timeout })
  const arrow = await confirmOnTop()
  check('6.arrow-confirm', '点 ← 弹出退出确认，确认框在导演层和 Agent 之上', Boolean(arrow?.inDialog), JSON.stringify(arrow), E.exitOnTop)
  // 文案不变：确认框的标题 / 正文 / 按钮都取自词典（用 textContent，不吃 CSS 的大小写变换；标题在 Mantine 模态的头里、在 surface 之外，所以读 root）
  const confirmText = await win.locator('[data-confirm-dialog]').first().evaluate((element) => element.textContent ?? '')
  const copyKeys = ['director.editor.exitConfirmTitle', 'director.editor.exitConfirmMessage', 'director.editor.exitConfirmOk']
  const missingCopy = copyKeys.filter((key) => !confirmText.includes(uiText(locale, key)))
  check('6.copy-exit-confirm', '退出确认框的标题 / 正文 / 确认钮取自词典（文案不变）', missingCopy.length === 0, missingCopy.length ? `缺 ${missingCopy.join('、')}；框内文字：${confirmText.slice(0, 120)}` : '', E.copy)
  await shot('exit-confirm')
  await win.locator('[data-confirm-dialog-cancel]').first().click({ timeout })
  await win.locator('[data-confirm-dialog-surface]').first().waitFor({ state: 'hidden', timeout })
  check('6.cancel-stays', '确认框点取消：导演台还开着', await editorVisible(), '', E.exitOnTop)
  // Esc 退出（焦点放回导演台里，Esc 走壳的捕获期监听）
  await win.locator('[data-testid="director-viewport"]').first().click({ position: { x: 30, y: 30 }, force: true })
  // Esc 归属链：模式 → 清工具 + 选择 → 退机位视角 → 退出确认；最多按四下，每下之后看一眼确认框
  let escPresses = 0
  while (escPresses < 4 && !(await win.locator('[data-confirm-dialog-surface]').first().isVisible().catch(() => false))) {
    await win.keyboard.press('Escape')
    escPresses += 1
    await win.waitForTimeout(250)
  }
  await win.locator('[data-confirm-dialog-surface]').first().waitFor({ state: 'visible', timeout: 3000 }).catch(() => undefined)
  check('6.esc-confirm', `Esc 归属链走完（按了 ${escPresses} 下）→ 弹出退出确认`, await win.locator('[data-confirm-dialog-surface]').first().isVisible().catch(() => false), '', E.exitOnTop)
  await win.locator('[data-confirm-dialog-confirm]').first().click({ timeout })
  const unmounted = await expectDirectorGone('确认后导演层卸载', exitProof).then(() => true, () => false)
  check('6.exit', '确认后导演层卸载（降到 0 之后还持续没有，不是此刻恰好没看见）', unmounted, '', E.exitOnTop)
  // 再开一次（同一个节点）：页格里始终最多一层
  await openDirector()
  check('6.reopen', '再进导演台：页格里恰好一层', (await measure()).editorInDom === 1, '', E.exitOnTop)
  await win.locator('[data-testid="director-exit"]').first().click({ timeout })
  await win.locator('[data-confirm-dialog-confirm]').first().click({ timeout })
  await expectDirectorGone('再退出后导演层卸载', exitProof)
  // 第二个导演台节点先后打开
  // 经加节点条建第二个导演台节点（应用把它放进视口、渲染并量过尺寸；直接 addNode 到视口外的位置它不会渲染，「适应视图」也会漏掉它），再把同一份工程写进去
  // 前面把 Agent 浮窗拖到了画布中间，正好盖住底部的加节点条（浮窗在画布之上是对的）：收成小球，加节点条才点得到
  await setAgentForm('ball')
  await addCanvasNode(win, 'director', { timeout })
  const secondId = await win.evaluate(({ directorProject, firstId }) => {
    const state = window.__nomiCanvasStore.getState()
    const node = state.nodes.find((item) => item.kind === 'director' && item.id !== firstId)
    state.updateNode(node.id, { title: 'Second', meta: { ...node.meta, directorProject } })
    return node.id
  }, { directorProject: compiled.project, firstId: directorId })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await win.locator(`[data-node-id="${secondId}"]`).count()) break
    await canvasFitView(win, 'fit view (two director nodes)')
    await win.waitForFunction((id) => Boolean(document.querySelector('[data-node-id="' + id + '"]')), secondId, { timeout: 4000 }).catch(() => undefined)
  }
  const secondOpen = win.locator(`[data-node-id="${secondId}"] [data-testid="director-node-open"]`).first()
  await secondOpen.waitFor({ state: 'visible', timeout })
  const secondClicked = await secondOpen.click({ timeout: 4000 }).then(() => true, () => false)
  if (!secondClicked) await secondOpen.evaluate((element) => element.click())
  await win.locator('[data-testid="director-editor"]').first().waitFor({ state: 'visible', timeout })
  const second = await measure()
  check('6.second-node', '第二个导演台节点先后打开：页格里恰好一层且 = 页格', second.editorInDom === 1 && sameRect(second.editor, second.cell), '', E.fillsCell)
  await win.locator('[data-testid="director-exit"]').first().click({ timeout })
  await win.locator('[data-confirm-dialog-confirm]').first().click({ timeout })
  await expectDirectorGone('第二个导演台退出后卸载', exitProof)
})

// ═══ 小节 7：全景查看器（同类）══════════════════════════════════════════════════════════════
if (!flag('no-panorama')) {
  await section('7-panorama', async () => {
    await closeDirectorIfOpen()
    const ffmpeg = nodeRequire('@ffmpeg-installer/ffmpeg').path
    const png = path.join(outDir, 'panorama-fixture.png')
    const made = spawnSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=2048x1024:rate=1', '-frames:v', '1', png], { timeout: 120_000 })
    if (made.status !== 0) throw new Error(`全景夹具编码失败：${made.stderr?.toString().slice(-300)}`)
    const imageUrl = `data:image/png;base64,${fs.readFileSync(png).toString('base64')}`
    fs.rmSync(png, { force: true })
    // 走加节点条建全景节点（和用户一样：应用把它放进视口里、渲染并量过尺寸），再往节点上写一张等距柱状图。
    // 经 store 直接 addNode 到视口外的位置没用：画布只渲染视口里的节点，没渲染就没量过尺寸，「适应视图」会把它漏掉。
    await addCanvasNode(win, 'panorama', { timeout })
    const panoramaId = await win.evaluate((url) => {
      const state = window.__nomiCanvasStore.getState()
      const node = state.nodes.find((item) => item.kind === 'panorama')
      state.updateNode(node.id, { title: 'Pano', meta: { ...node.meta, imageUrl: url } })
      return node.id
    }, imageUrl)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await win.locator(`[data-node-id="${panoramaId}"]`).count()) break
      await canvasFitView(win, 'fit view (panorama)')
      await win.waitForFunction((id) => Boolean(document.querySelector('[data-node-id="' + id + '"]')), panoramaId, { timeout: 4000 }).catch(() => undefined)
    }
    const viewer = win.locator(`[data-node-id="${panoramaId}"] [data-panorama-viewer-id]`).first()
    const seen = await viewer.waitFor({ state: 'visible', timeout }).then(() => true, () => false)
    if (!seen) {
      const diagnostics = await win.evaluate((id) => {
        const node = document.querySelector('[data-node-id="' + id + '"]')
        const stored = window.__nomiCanvasStore.getState().nodes.find((item) => item.id === id)
        return {
          nodeInDom: Boolean(node),
          html: node ? node.outerHTML.slice(0, 600) : null,
          storedKind: stored?.kind ?? null,
          storedPosition: stored?.position ?? null,
          metaImageUrlLength: String(stored?.meta?.imageUrl ?? '').length,
          renderKind: stored?.renderKind ?? null,
          domNodes: [...document.querySelectorAll('.generation-canvas-v2-node[data-node-id], [data-testid="director-node"]')].map((el) => el.getAttribute('data-node-id') + ':' + el.getAttribute('data-kind')),
          storeNodes: window.__nomiCanvasStore.getState().nodes.map((item) => item.id + ':' + item.kind + '@' + JSON.stringify(item.position)),
          viewportTransform: document.querySelector('.react-flow__viewport')?.style.transform ?? null,
        }
      }, panoramaId)
      note('全景节点没渲染出查看器', diagnostics)
      throw new Error('全景节点里没有 [data-panorama-viewer-id]')
    }
    await viewer.locator('button').first().evaluate((element) => element.click())
    const panel = win.locator('[data-panorama-dialog-panel]').first()
    await panel.waitFor({ state: 'visible', timeout })
    await settleLayout()
    const open = await win.evaluate(`(() => {
      ${REGION_SOURCE}
      const panel = document.querySelector('[data-panorama-dialog-panel]')
      const cell = document.querySelector('.workbench-generation__canvas')
      const layer = panel?.parentElement
      const railDocs = document.querySelector('[data-shell-rail-item="docs"]')
      const c = railDocs ? box(railDocs) : null
      return { panel: box(panel), layer: box(layer), cell: box(cell), railHit: c ? regionOf(document.elementFromPoint(c.x + c.w / 2, c.y + c.h / 2)) : null }
    })()`)
    check('7.layer-rect', '全景查看器的层 = 页格矩形', sameRect(open.layer, open.cell), `layer=${JSON.stringify(open.layer)} cell=${JSON.stringify(open.cell)}`, E.panorama)
    check('7.rail', '全景查看器开着时左栏点得到', open.railHit === 'rail:docs', String(open.railHit), E.panorama)
    await shot('panorama-open')
    // 三次快照（开着 / 在创作页 / 回生成）：看查看器的实例（viewerIds 是组件挂载时的 useId，重挂会换）、面板与页内层是不是「藏着」还是「没了」、画布视口有没有被挪
    const panoSnapshot = () => win.evaluate(() => ({
      viewerIds: [...document.querySelectorAll('[data-panorama-viewer-id]')].map((element) => element.getAttribute('data-panorama-viewer-id')),
      panels: document.querySelectorAll('[data-panorama-dialog-panel]').length,
      layers: [...document.querySelectorAll('[data-generation-page-layer]')].map((element) => element.getAttribute('data-page-layer-active')),
      transform: document.querySelector('.react-flow__viewport')?.style.transform ?? null,
      nodes: document.querySelectorAll('[data-node-id]').length,
      mode: document.querySelector('[data-workspace-mode]')?.getAttribute('data-workspace-mode') ?? null,
      // 节点上存的那张图（门岗页切换时项目会落盘，图可能被换成落盘后的地址；看它有没有变、是不是一瞬间空过）
      storedImage: (() => {
        const node = window.__nomiCanvasStore.getState().nodes.find((item) => item.kind === 'panorama')
        const url = String(node?.result?.url || node?.meta?.imageUrl || '')
        return { head: url.slice(0, 24), length: url.length, hasResult: Boolean(node?.result?.url) }
      })(),
    }))
    const snapOpen = await panoSnapshot()
    // 在节点外壳和查看器上各打一个标记：回来后标记还在 = 同一个 DOM 元素没被重挂；外壳在、查看器没了 = 查看器子树在节点里被重挂
    await win.evaluate((id) => {
      document.querySelector('[data-node-id="' + id + '"]')?.setAttribute('data-walk-marker', 'node')
      document.querySelector('[data-panorama-viewer-id]')?.setAttribute('data-walk-marker', 'viewer')
    }, panoramaId)
    await modeButton('creation').click({ timeout })
    await win.waitForFunction(() => document.querySelector('[data-workspace-mode]')?.getAttribute('data-workspace-mode') === 'creation', null, { timeout })
    const hiddenOnCreation = !(await panel.isVisible().catch(() => false))
    const snapAway = await panoSnapshot()
    check('7.hidden', '点「创作」→ 全景查看器不可见（藏着，不是没了：面板和页内层还在 DOM 里）', hiddenOnCreation && snapAway.panels === 1 && snapAway.layers[0] === 'false', JSON.stringify(snapAway), E.panorama)
    await shot('panorama-nav-creation')
    await modeButton('generation').click({ timeout })
    await win.waitForFunction(() => document.querySelector('[data-workspace-mode]')?.getAttribute('data-workspace-mode') === 'generation', null, { timeout })
    await settleLayout()
    const snapBack = await panoSnapshot()
    const markers = await win.evaluate((id) => ({
      nodeKept: document.querySelector('[data-node-id="' + id + '"]')?.getAttribute('data-walk-marker') === 'node',
      viewerKept: document.querySelector('[data-panorama-viewer-id]')?.getAttribute('data-walk-marker') === 'viewer',
    }), panoramaId)
    const nodeLog = await win.evaluate(() => window.__nodeLog)
    note('画布节点外壳的挂载 / 卸载日志（at = 毫秒）', nodeLog.slice(-24))
    const backVisible = await panel.isVisible().catch(() => false)
    check('7.back', '点回「生成」后全景查看器还开着，即使节点外壳被卸载重挂', backVisible && snapBack.panels === 1 && snapBack.layers[0] === 'true' && snapBack.storedImage.length === snapOpen.storedImage.length, JSON.stringify({ open: snapOpen, away: snapAway, back: snapBack, markers }), E.panoramaBack)
    await win.waitForFunction(() => {
      const panel = document.querySelector('[data-panorama-dialog-panel]')?.getBoundingClientRect()
      const canvas = document.querySelector('[data-panorama-dialog-panel] canvas')?.getBoundingClientRect()
      return Boolean(panel && canvas && Math.abs(panel.width - canvas.width) <= 2 && Math.abs(panel.height - canvas.height) <= 2)
    }, null, { timeout: 4000 }).catch(() => {})
    const canvasSize = await panel.evaluate((element) => {
      const canvas = element.querySelector('canvas')?.getBoundingClientRect()
      const box = element.getBoundingClientRect()
      return { panel: { width: box.width, height: box.height }, canvas: canvas ? { width: canvas.width, height: canvas.height } : null }
    })
    check('7.canvas-fills', '节点重挂后全景画面铺满面板，没有旧尺寸造成的黑边', Boolean(canvasSize.canvas && Math.abs(canvasSize.panel.width - canvasSize.canvas.width) <= 2 && Math.abs(canvasSize.panel.height - canvasSize.canvas.height) <= 2), JSON.stringify(canvasSize), E.panoramaBack)
    await shot('panorama-back-generation')
    // 关闭：Esc（藏着再回来之后，Esc 监听要重新接上）
    await win.keyboard.press('Escape')
    await win.waitForFunction(() => !document.querySelector('[data-panorama-dialog-panel]'), null, { timeout: 4000 }).then(
      () => check('7.esc-close', 'Esc 关闭全景查看器', true, '', E.panorama),
      () => check('7.esc-close', 'Esc 关闭全景查看器', false, '还在', E.panorama),
    )
  })
}

// ═══ 小节 7b：导演台节点位于视口边缘，切页后仍开着 ════════════════════════════════════
await section('7b-director-edge', async () => {
  await openDirector()
  const edge = await win.evaluate((id) => {
    const viewport = document.querySelector('.react-flow__renderer')?.getBoundingClientRect()
    const transform = document.querySelector('.react-flow__viewport')?.style.transform ?? ''
    const match = transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\) scale\(([-\d.]+)\)/)
    if (!viewport || !match) return null
    const [, tx, ty, zoom] = match.map(Number)
    const position = { x: (viewport.width - 130 - tx) / zoom, y: (180 - ty) / zoom }
    window.__nomiCanvasStore.getState().updateNode(id, { position })
    return { viewportRight: viewport.right, expectedLeft: viewport.right - 130 }
  }, directorId)
  await win.waitForFunction(({ id, expectedLeft }) => {
    const rect = document.querySelector('[data-node-id="' + id + '"]')?.getBoundingClientRect()
    return Boolean(rect && Math.abs(rect.left - expectedLeft) < 12)
  }, { id: directorId, expectedLeft: edge?.expectedLeft }, { timeout })
  await modeButton('creation').click({ timeout })
  await win.waitForFunction(() => document.querySelector('[data-workspace-mode]')?.getAttribute('data-workspace-mode') === 'creation', null, { timeout })
  await modeButton('generation').click({ timeout })
  await win.waitForFunction(() => document.querySelector('[data-workspace-mode]')?.getAttribute('data-workspace-mode') === 'generation', null, { timeout })
  await settleLayout()
  const edgeBack = await editorVisible()
  const edgeRect = await win.locator(`[data-node-id="${directorId}"]`).first().evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, right: rect.right }
  }).catch(() => null)
  check('7b.edge-back', '导演台节点放在视口边缘，切创作再回来仍开着', Boolean(edge && edgeRect && edgeRect.left >= edge.expectedLeft - 12 && edgeRect.left <= edge.viewportRight && edgeBack), JSON.stringify({ edge, edgeRect, edgeBack }), E.backKeeps)
  await shot('director-edge-back-generation')
  await closeDirectorIfOpen()
})

// ═══ 小节 8：开着导演台回项目库 → 导演层卸载 ═════════════════════════════════════════════
await section('8-library', async () => {
  await openDirector()
  // 导演台和它的页内层这会儿都在：先证两个探针测得到，回库后才能断言「都没了」
  const editorProof = await proveDirectorOpen()
  const layerLocator = win.locator('[data-generation-page-layer]')
  const layerProof = await proveProbe(layerLocator, '导演台开着时探针找得到它的页内层')
  await backToLibrary(win, { label: 'back to library from open director', timeout })
  await newProjectEntry(win).waitFor({ timeout })
  const editorGone = await expectDirectorGone('回项目库后导演层卸载', editorProof).then(() => true, () => false)
  const layerGone = await expectAbsent(layerLocator, { provenBy: layerProof, message: '回项目库后页内层卸载' }, timeout).then(() => true, () => false)
  check('8.library-unmount', '开着导演台回项目库：导演层和页内层都卸载（DOM 里持续没有）', editorGone && layerGone, `导演层卸载=${editorGone} 页内层卸载=${layerGone}`, E.libraryUnmount)
})

// 渲染层的未捕获异常条数（不是界面元素的「不存在」断言，是 JS 错误计数）
check('9.no-page-errors', '渲染层没有未捕获的页面异常', !pageErrors.length, pageErrors.slice(0, 3).join(' | '))
// 板元素覆盖：17 个元素每个都有检查挂着、且挂着的全过（裁剪过的跑法——--only / --no-perf / --no-panorama——缺的小节不算它的错，不核）
if (!onlySections && !flag('no-perf') && !flag('no-panorama')) {
  report.boardCoverage = {}
  for (const [name, element] of Object.entries(E)) {
    const linked = results.filter((entry) => entry.element === element)
    const passed = linked.filter((entry) => entry.ok).length
    report.boardCoverage[element] = { passed, total: linked.length }
    check(`10.coverage.${name}`, `板元素 ${element.slice('board:DirectorInPage/'.length)}：有检查挂着且全过`, linked.length > 0 && passed === linked.length, `${passed}/${linked.length}`)
  }
}
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ ...report, results }, null, 2))
await app.close().catch(() => {})

const failed = results.filter((entry) => !entry.ok)
console.log(`\n=== ${locale}：${results.length - failed.length}/${results.length} 过 ===`)
if (failed.length) {
  console.error(`✗ ${failed.length} 条没过：\n  ${failed.map((entry) => `[${entry.id}] ${entry.label}`).join('\n  ')}`)
  process.exitCode = 1
} else {
  console.log('✅ 导演台收进生成页走查通过（截图要人眼 Read 过才算数）')
}
