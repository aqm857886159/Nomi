// 走查：画布快捷键对齐 LibTV（2026-09-21，docs/plan/2026-09-21-canvas-shortcut-parity.md）。
//
// 用户拍板：「做对照，缺的都补上」。这条走查按真人的方式逐个按新键，断言**副作用**（节点数、连线数、
// 位置、菜单、确认卡），不是断言键被监听了：
//   ⌘D 复制节点和它们之间的连线（一次撤销）｜⌘L 选两个直接连线｜Tab 在鼠标处打开添加菜单｜
//   ⌥⇧F 整理画布｜⌘Enter 生成所选（单选一张 = 用户自己点的单份生成，不弹确认卡、直接开跑）｜
//   在提示词编辑器里打 v / h / f / Tab：画布什么都不做。
// 帮助面板：新键都写着；zh/en、Agent 面板展开/收起、1800 / 1280 / 最小窗口下整块可见、点得到、行内不重叠
// （2026-09-21 真机：面板被 Agent 收起坞和批量条盖住半截；1280 宽时时间轴胶囊压住帮助按钮；英文「Box select」行重叠）。
//
// 驱动：真实 Electron + 真实键盘/鼠标；项目以磁盘上的 project.json 打开；图片是登记表里真实 4K HEVC 视频抽的帧。
// 零额度：本走查不配任何供应商/密钥，⌘Enter 那一步真的派发，但只会落到「没有可用模型」的错误，不花钱。
//
// 用法：
//   export NOMI_REAL_MEDIA_DIR="/Users/aoqimin/Desktop/视频/"
//   pnpm run build && node tests/ux/canvas-shortcut-parity.walk.mjs [zh-CN|en]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { expect, expectHittable, expectOverlayReachable, screenshotSettled, waitForVisualQuiescence } from './_assert.mjs'
import { findCanvasBlankPoint, findNodeHitPoint, CANVAS_STAGE_SELECTOR } from './_canvasHit.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { requireRealMediaAssets } from './fixtures/realMedia.mjs'
import { createCanvasPerformanceFixture } from './fixtures/canvas-performance-fixture.mjs'

const LOCALE = process.argv[2] === 'en' ? 'en' : 'zh-CN'
const EN = LOCALE === 'en'
const shotsDir = path.join(repoRoot, 'tests/ux/shots/canvas-shortcut-parity', LOCALE)
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

// ── 真实素材（缺即红，不退回合成素材）。
const { assets } = requireRealMediaAssets(['video-4k-hevc-10bit', 'image-4k-png'])
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-shortcut-parity-'))
const PROJECT_ID = 'project-shortcut-parity'
const fixture = createCanvasPerformanceFixture({ projectsDir: path.join(temp, 'projects'), scale: 'empty', projectId: PROJECT_ID, projectName: '快捷键对齐验收' })
const mediaDir = path.join(fixture.projectRoot, 'assets', 'imported')
fs.mkdirSync(mediaDir, { recursive: true })
const frame = path.join(mediaDir, 'frame.png')
execFileSync(ffmpeg.path, ['-y', '-ss', '00:00:05', '-i', assets.get('video-4k-hevc-10bit').file, '-frames:v', '1', frame], { stdio: 'pipe' })
if (fs.statSync(frame).size < assets.get('image-4k-png').spec.minBytes) throw new Error('抽帧过小，多半黑帧')
const frameUrl = `nomi-local://asset/${PROJECT_ID}/assets/imported/frame.png`
const frameResult = { id: 'frame-r1', type: 'image', url: frameUrl, thumbnailUrl: frameUrl, createdAt: 1 }

// 三张卡刻意摆得不齐（⌥⇧F 整理才看得出位置变化）；A → C 一条边（⌘D 要把「之间」的边一起带走）。
const base = { categoryId: 'shots', references: [], runs: [], history: [] }
const nodes = [
  { ...base, id: 'img-a', kind: 'image', title: EN ? 'Street frame' : '街口原片', prompt: '', position: { x: 60, y: 60 }, status: 'success', result: frameResult, history: [frameResult], meta: { imageWidth: 3840, imageHeight: 2160, imageAspectRatio: 16 / 9 } },
  { ...base, id: 'text-b', kind: 'text', title: EN ? 'Brief' : '文案', prompt: EN ? 'Rainy night street' : '雨夜街口', position: { x: 90, y: 380 }, size: { width: 300, height: 220 }, status: 'idle' },
  { ...base, id: 'img-c', kind: 'image', title: EN ? 'Umbrella turn' : '撑伞回头', prompt: EN ? 'She turns back under an umbrella' : '女主撑伞回头', position: { x: 540, y: 20 }, status: 'idle' },
]
const edges = [{ id: 'edge-a-c', source: 'img-a', target: 'img-c', mode: 'reference' }]
fixture.record.payload.generationCanvas = { nodes, edges, groups: [], selectedNodeIds: [] }
fs.writeFileSync(path.join(fixture.projectRoot, '.nomi/project.json'), JSON.stringify(fixture.record))

const failures = []
const results = {}
function check(ok, label, detail) {
  const line = `${label} — ${JSON.stringify(detail)}`
  if (ok) console.log(`  ✓ ${line}`)
  else { console.error(`  ✖ ${line}`); failures.push(line) }
  return ok
}

const { app, win: first, mainLogTail } = await launchNomiApp({
  name: `canvas-shortcut-parity-${LOCALE}`,
  projectsDir: fixture.projectsDir,
  syntheticCredentialStorage: true,
  settleMs: 0,
  initialLocalStorage: {
    'nomi:locale:v1': LOCALE,
    'nomi:splash:v1': 'seen',
    'nomi:journey-tour:v1': 'seen',
    'nomi:canvas-gesture-hint:v1': 'seen',
  },
})
let win = first
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const sel = (id) => `.react-flow__node[data-id="${id}"]`
const shot = (name) => screenshotSettled(win, { path: path.join(shotsDir, `${name}.png`) })
// 画布只渲染视口里的卡（onlyRenderVisibleElements）：数卡 / 数边 / 读位置之前先点「适应视图」把全部卡框进来，
// 否则数到的是「此刻看得见几张」而不是「画布上有几张」。
async function fitAll() {
  await win.getByRole('button', { name: EN ? 'Fit view' : '适应视图', exact: true }).first().click()
  await waitForVisualQuiescence(win)
}
async function nodeIds() {
  await fitAll()
  return win.evaluate(() => Array.from(document.querySelectorAll('.react-flow__node')).map((n) => n.getAttribute('data-id')))
}
async function edgeCount() {
  await fitAll()
  return win.evaluate(() => document.querySelectorAll('.react-flow__edge').length)
}
async function positions() {
  await fitAll()
  return win.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('.react-flow__node')).map((n) => {
    const m = new DOMMatrixReadOnly(getComputedStyle(n).transform)
    return [n.getAttribute('data-id'), { x: Math.round(m.m41), y: Math.round(m.m42) }]
  })))
}
async function nodeVisibleInStage(id) {
  return win.evaluate(({ selector, stageSelector }) => {
    const node = document.querySelector(selector)
    const stage = document.querySelector(stageSelector)
    if (!node || !stage) return false
    const a = node.getBoundingClientRect()
    const b = stage.getBoundingClientRect()
    return a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom
  }, { selector: sel(id), stageSelector: CANVAS_STAGE_SELECTOR })
}

async function clickBlank() {
  const point = await findCanvasBlankPoint(win, { preference: 'bottom' })
  expect(point, '画布上找不到真空白').not.toBeNull()
  await win.mouse.click(point.x, point.y)
  await waitForVisualQuiescence(win)
  return point
}
async function clickNode(id, { shift = false } = {}) {
  let point = null
  await expect.poll(async () => {
    point = await findNodeHitPoint(win, { nodeSelector: sel(id) })
    return point !== null
  }, { message: `${id} 卡上找不到一处点得到的地方` }).toBe(true)
  if (shift) await win.keyboard.down('Shift')
  await win.mouse.click(point.x, point.y)
  if (shift) await win.keyboard.up('Shift')
  await expect(win.locator(sel(id)), `${id} 点了没选中`).toHaveClass(/selected/)
  await waitForVisualQuiescence(win)
}
async function undoOnce() {
  await win.keyboard.press(`${MOD}+z`)
  await waitForVisualQuiescence(win)
}
// 内容区尺寸：原生窗口会被显示器夹住，Chromium 的内容几何也得一起绑（与 _launchApp 同法）。
async function resize(width, height) {
  const bw = await app.browserWindow(win)
  await bw.evaluate((window, size) => window.setContentSize(size.width, size.height), { width, height })
  await win.setViewportSize({ width, height })
  await expect.poll(() => win.evaluate(() => `${innerWidth}x${innerHeight}`), { message: `窗口没改到 ${width}x${height}` }).toBe(`${width}x${height}`)
  await waitForVisualQuiescence(win)
}
async function setAgentPanel(expanded) {
  const panel = win.locator('[data-v4-panel]')
  // 面板挂载与首屏动画期间点不中开关：点一下、等一下，直到状态真的变了（像人一样再点一次）。
  await expect.poll(async () => {
    const isOpen = await panel.isVisible().catch(() => false)
    if (isOpen === expanded) return isOpen
    const toggle = expanded ? win.locator('[data-agent-dock-reason="resident-collapsed"]').first() : win.locator('[data-v4-control="collapse"]').first()
    await toggle.click({ timeout: 2000 }).catch(() => {})
    await win.waitForTimeout(500)
    return panel.isVisible().catch(() => false)
  }, { message: `Agent 面板没能${expanded ? '展开' : '收起'}`, timeout: stationTimeout() }).toBe(expanded)
  await waitForVisualQuiescence(win)
}

const consoleErrors = []
const watchConsole = (page) => page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 400))
})
watchConsole(first)
app.on('window', watchConsole)

try {
  await app.context().addInitScript(() => { localStorage.setItem('__nomiE2E', '1') })
  await win.locator('[data-project-card]', { hasText: fixture.record.name }).click({ timeout: stationTimeout({ operations: 2 }) })
  await expect.poll(() => app.windows().some((page) => /projectId=/.test(page.url())), { timeout: stationTimeout() }).toBe(true)
  win = app.windows().find((page) => /projectId=/.test(page.url()))
  const bw = await app.browserWindow(win)
  await bw.evaluate((window) => window.setIgnoreMouseEvents(true))
  await resize(1280, 900)
  // 快捷键各步在 Agent 面板收起时做（舞台最宽）；帮助面板那一段再逐个布局切换。
  await setAgentPanel(false)
  await win.locator(CANVAS_STAGE_SELECTOR).waitFor({ timeout: stationTimeout() })
  for (const node of nodes) await expect(win.locator(sel(node.id)), `${node.id} 没渲染出来`).toBeVisible({ timeout: stationTimeout() })
  await expect(win.locator(`${sel('img-a')} img`).first(), '真实帧没显示').toBeVisible({ timeout: stationTimeout() })
  await waitForVisualQuiescence(win)
  await shot('00-canvas-ready')

  // ═══ ⌘D：选 A + C（中间有一条边）→ 多两张卡、多一条边（副本之间），原件不动；⌘Z 一次回到原样 ═══
  {
    await clickBlank()
    await clickNode('img-a')
    await clickNode('img-c', { shift: true })
    const beforeIds = await nodeIds()
    const beforeEdges = await edgeCount()
    const beforePos = await positions()
    await win.keyboard.press(`${MOD}+d`)
    await waitForVisualQuiescence(win)
    // 副本（复制后的选区）不用任何操作就在视口里——整簇避让把它推远了，视口得跟过去。
    const copies = await win.evaluate(() => Array.from(document.querySelectorAll('.react-flow__node.selected')).map((n) => n.getAttribute('data-id')))
    const copiesVisible = copies.length === 2 && (await Promise.all(copies.map(nodeVisibleInStage))).every(Boolean)
    check(copiesVisible, '⌘D·两张副本不用手动找，就完整出现在视口里', { copies })
    await shot('01-cmd-d-duplicated')
    await expect.poll(async () => (await nodeIds()).length, { message: '⌘D 后没多出两张卡' }).toBe(beforeIds.length + 2)
    const afterPos = await positions()
    check(await edgeCount() === beforeEdges + 1, '⌘D·两张副本之间的连线一起复制（不带到选区外的边）', { before: beforeEdges, after: await edgeCount() })
    check(['img-a', 'img-c'].every((id) => afterPos[id].x === beforePos[id].x && afterPos[id].y === beforePos[id].y), '⌘D·原件原地不动', { beforePos, afterPos })
    await undoOnce()
    check((await nodeIds()).length === beforeIds.length && await edgeCount() === beforeEdges, '⌘D 后 ⌘Z 一次撤掉整份复制', { nodes: (await nodeIds()).length, edges: await edgeCount() })
  }

  // ═══ ⌘L：选文案 B + 图 C → 连一条 B→C；⌘Z 撤掉 ═══
  {
    await clickBlank()
    await clickNode('text-b')
    await clickNode('img-c', { shift: true })
    const before = await edgeCount()
    await win.keyboard.press(`${MOD}+l`)
    await expect.poll(edgeCount, { message: '⌘L 后没多出连线' }).toBe(before + 1)
    const edge = await win.evaluate(() => Array.from(document.querySelectorAll('.react-flow__edge')).map((e) => e.getAttribute('data-id') || e.getAttribute('aria-label') || e.className.baseVal || ''))
    results.connectEdges = edge
    check(true, '⌘L·选中两个时连线', { before, after: before + 1 })
    await shot('02-cmd-l-connected')
    await undoOnce()
    check(await edgeCount() === before, '⌘L 后 ⌘Z 撤掉连线', { edges: await edgeCount() })
  }

  // ═══ Tab：鼠标停在空白处 → 添加节点菜单出现在鼠标旁；选第一项 → 多一张卡；⌘Z ═══
  {
    await clickBlank()
    const before = (await nodeIds()).length
    const point = await findCanvasBlankPoint(win)
    await win.mouse.click(point.x, point.y)
    await win.mouse.move(point.x, point.y)
    results.tabFocus = await win.evaluate(() => {
      const el = document.activeElement
      return el ? `${el.tagName}.${String(el.className).slice(0, 60)}[role=${el.getAttribute('role')}]` : null
    })
    await win.keyboard.press('Tab')
    const menu = win.locator('.generation-canvas-v2__context-node-menu')
    await expect(menu, 'Tab 后没弹出添加节点菜单').toBeVisible({ timeout: stationTimeout() })
    const box = await menu.boundingBox()
    const distance = Math.hypot(box.x - point.x, box.y - point.y)
    check(distance < 240, 'Tab·菜单出现在鼠标旁（不是固定角落）', { pointer: point, menu: { x: Math.round(box.x), y: Math.round(box.y) }, distance: Math.round(distance) })
    await shot('03-tab-add-menu')
    await menu.locator('[role="menuitem"]').first().click()
    await expect.poll(async () => (await nodeIds()).length, { message: '从 Tab 菜单选第一项后没新建卡' }).toBe(before + 1)
    check(true, 'Tab·菜单选第一项新建一张卡', { before, after: before + 1 })
    await undoOnce()
    check((await nodeIds()).length === before, 'Tab 新建后 ⌘Z 撤掉', { nodes: (await nodeIds()).length })
  }

  // ═══ ⌥⇧F：整理画布（与左下「整理」按钮同一动作）；⌘Z 回到原位置 ═══
  {
    await clickBlank()
    const before = await positions()
    await win.keyboard.press('Alt+Shift+KeyF')
    await expect.poll(async () => JSON.stringify(await positions()) !== JSON.stringify(before), { message: '⌥⇧F 后卡片位置没变' }).toBe(true)
    await waitForVisualQuiescence(win)
    check(true, '⌥⇧F·整理画布改变了排布', { before, after: await positions() })
    // 正向读那颗按钮自己的开关态（先证明按钮在，再读它是 false），不数「不存在」。
    const frameToolButton = win.getByRole('button', { name: EN ? 'Draw Frame' : '画框', exact: true }).first()
    await expect(frameToolButton, '左下「画框」按钮没找到，读不了它的开关态').toBeVisible()
    const frameToolPressed = await frameToolButton.getAttribute('aria-pressed')
    check(frameToolPressed === 'false', '⌥⇧F 没有顺手把「画框」工具（裸 F）打开', { frameToolPressed })
    await shot('04-alt-shift-f-tidy')
    await undoOnce()
    check(JSON.stringify(await positions()) === JSON.stringify(before), '⌥⇧F 后 ⌘Z 回到原位置', {})
  }

  // ═══ ⌘Enter：单选 C → 与浮条「生成」同一个入口，直接开跑、不弹确认卡 ═══
  // 用户自己点的单份生成不弹付费确认卡（2026-09-25 拍板，判据按份数不按入口）；若中间弹卡而不点，
  // 请求永远发不出去——下面 img-c 离开 idle（queued / running，或本走查无供应商时落到 error）就是证据。
  {
    await clickBlank()
    await clickNode('img-c')
    const statusOf = () => win.evaluate(() => {
      const node = document.querySelector('.react-flow__node[data-id="img-c"] [data-node-id]')
      return node?.getAttribute('data-status') ?? null
    })
    const statusBefore = await statusOf()
    check(statusBefore === 'idle', '⌘Enter 之前 img-c 是空闲态', { statusBefore })
    await win.keyboard.press(`${MOD}+Enter`)
    let statusAfter = statusBefore
    const started = await expect.poll(async () => {
      statusAfter = await statusOf()
      return ['queued', 'running', 'success', 'error'].includes(statusAfter)
    }, { timeout: stationTimeout() }).toBe(true).then(() => true, () => false)
    const confirm = win.locator('[data-spend-confirm-dialog]')
    const cardShown = await confirm.isVisible().catch(() => false)
    await shot('05-cmd-enter-started')
    check(started, '⌘Enter·单选一张直接开跑（走浮条「生成」同一个入口，节点离开空闲态）', { statusBefore, statusAfter })
    check(!cardShown, '⌘Enter·单份生成不弹付费确认卡', { cardShown })
    if (cardShown) await win.keyboard.press('Escape') // 已判红；收掉卡，别让后面的步骤全被它挡住
  }

  // ═══ 在提示词编辑器里打 v / h / f / Tab：画布不新建、不开菜单、不开画框 ═══
  {
    await clickBlank()
    // 提示词编辑器 = 选中卡后弹出的 composer 里那一栏（画布上最常打字的地方）。
    await clickNode('img-c')
    const editor = win.locator('[data-node-composer-prompt] [contenteditable="true"]').first()
    await expect(editor, '选中图片卡后没出现提示词编辑器').toBeVisible({ timeout: stationTimeout() })
    const before = (await nodeIds()).length
    await clickNode('img-c')
    await expectHittable(editor, '提示词编辑器（没被底部浮层盖住）')
    await editor.click()
    results.editorFocus = await win.evaluate(() => {
      const el = document.activeElement
      return el ? `${el.tagName}[contenteditable=${el.getAttribute('contenteditable')}] ${String(el.className).slice(0, 50)}` : null
    })
    await win.keyboard.press('End')
    // 按真人速度打（每键 150ms）：快速连打会被受控编辑器的旧回声吞字——那是另一条在修的 bug
    // （fix/composer-overlap-and-dropped-keys-20260921），这里要验的是「画布不抢键」，不把两件事搅在一起。
    await win.keyboard.type(' vhf', { delay: 150 })
    await win.keyboard.press('Tab')
    await waitForVisualQuiescence(win)
    const text = await editor.innerText().catch(() => '')
    const menuOpen = await win.locator('.generation-canvas-v2__context-node-menu').isVisible().catch(() => false)
    check(text.includes('vhf'), '编辑器·字母照常进了文本框', { text: text.slice(-24) })
    check(!menuOpen, '编辑器·Tab 没有弹出画布的添加菜单', { menuOpen })
    check((await nodeIds()).length === before, '编辑器·打字没有触发任何画布动作', { before, after: (await nodeIds()).length })
    await shot('06-typing-in-editor')
    await win.keyboard.press('Escape')
    await clickBlank()
  }

  // ═══ 帮助面板：新键都写着；各布局下整块可见、按钮点得到、行内不重叠 ═══
  const helpButton = () => win.getByRole('button', { name: EN ? 'Canvas controls' : '画布操作', exact: true }).first()
  const expectedRows = ['modG', 'modShiftG', 'modL', 'modD', 'modEnter', 'tab', 'optShiftF', 'frameKey', 'modPlusMinus', 'modZ', 'modShiftZ', 'modX', 'altDrag']
  const layouts = [
    { name: '1280-agent-open', width: 1280, height: 900, agent: true },
    { name: '1280-agent-collapsed', width: 1280, height: 900, agent: false },
    { name: 'min-agent-open', width: 1100, height: 720, agent: true },
    { name: 'min-agent-collapsed', width: 1100, height: 720, agent: false },
  ]
  results.help = []
  // 两种底部浮层状态都要过：没选中 = 「生成全部」批量条横在底排上方（2026-09-21 1280 宽实拍里把时间轴胶囊
  // 挤到帮助按钮上的就是它）；选中一张 = 选择浮条 + composer。
  for (const layout of layouts.flatMap((entry) => [{ ...entry, selection: 'none' }, { ...entry, selection: 'one' }])) {
    await resize(layout.width, layout.height)
    await setAgentPanel(layout.agent)
    await fitAll()
    if (layout.selection === 'one') await clickNode('img-c')
    else await clickBlank()
    layout.name = `${layout.name}-${layout.selection}`
    const row = { layout: layout.name }
    try {
      await expectHittable(helpButton(), `画布操作帮助按钮（${layout.name}）`)
      row.buttonHittable = true
    } catch (error) {
      row.buttonHittable = false
      check(false, `帮助按钮点得到（${layout.name}）`, String(error.message).split('\n')[0])
      await shot(`07-help-button-covered-${layout.name}`)
      results.help.push(row)
      continue
    }
    await helpButton().click()
    const panel = win.getByRole('dialog', { name: EN ? 'Canvas controls help' : '画布操作帮助', exact: true })
    try {
      const reach = await expectOverlayReachable(panel, `画布操作帮助面板（${layout.name}）`)
      row.reach = `${reach.hits}/${reach.samples}`
    } catch (error) {
      row.reach = 'blocked'
      check(false, `帮助面板整块可见、不被遮挡（${layout.name}）`, String(error.message).split('\n').slice(0, 2).join(' '))
    }
    const rows = await panel.evaluate((el) => Array.from(el.querySelectorAll('[data-canvas-controls-help-row]')).map((rowEl) => {
      const [label, kbd] = rowEl.children
      const a = label.getBoundingClientRect()
      const b = kbd.getBoundingClientRect()
      const scrollable = el.scrollHeight > el.clientHeight + 1
      return { key: rowEl.getAttribute('data-canvas-controls-help-row'), overlap: a.right > b.left + 0.5 && a.bottom > b.top && a.top < b.bottom, kbdClipped: kbd.scrollWidth > kbd.clientWidth + 1, scrollable }
    }))
    const missing = expectedRows.filter((key) => !rows.some((r) => r.key === key))
    const overlapped = rows.filter((r) => r.overlap || r.kbdClipped).map((r) => r.key)
    row.rows = rows.length
    row.scrollable = rows[0]?.scrollable ?? false
    check(missing.length === 0, `帮助面板写着所有新键（${layout.name}）`, { missing })
    check(overlapped.length === 0, `帮助面板每行说明与键位不重叠（${layout.name}）`, { overlapped })
    await shot(`07-help-${layout.name}`)
    await win.keyboard.press('Escape')
    await expect(panel).toBeHidden({ timeout: stationTimeout() })
    results.help.push(row)
  }
  const helpText = await (async () => {
    await resize(1280, 900)
    await helpButton().click()
    const panel = win.getByRole('dialog', { name: EN ? 'Canvas controls help' : '画布操作帮助', exact: true })
    const text = await panel.innerText()
    await win.keyboard.press('Escape')
    return text
  })()
  const mac = process.platform === 'darwin'
  const tidyGlyph = mac ? '⌥ ⇧ F' : 'Alt Shift F'
  check(helpText.includes(tidyGlyph) && helpText.includes(mac ? '⌘ D' : 'Ctrl D'), '帮助面板按平台显示修饰键字形', { tidyGlyph })
} catch (error) {
  failures.push(`走查中途异常：${String(error?.message || error).slice(0, 600)}`)
  console.error('WALK ERROR:', String(error?.stack || error).slice(0, 3000))
  await win.screenshot({ path: path.join(shotsDir, 'zz-error.png') }).catch(() => {})
} finally {
  fs.writeFileSync(path.join(shotsDir, 'results.json'), JSON.stringify({ locale: LOCALE, results, failures, consoleErrors }, null, 2))
  if (failures.length) {
    console.error('CONSOLE ERRORS', JSON.stringify(consoleErrors.slice(-8), null, 1))
    console.error('MAIN LOG TAIL\n' + mainLogTail().slice(-30).join('\n'))
  }
  await app.close().catch(() => {})
  fs.rmSync(temp, { recursive: true, force: true })
}
if (failures.length) {
  console.error(`\n❌ ${failures.length} 条不通过`)
  process.exit(1)
}
console.log(`\n✅ 画布快捷键对齐走查通过（${LOCALE}）`)
