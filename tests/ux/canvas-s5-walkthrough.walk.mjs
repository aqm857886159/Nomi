// S5 终验走查（画布拖动性能战役 · R13/R16 真机使用闭环）。
//
// 真实用户任务链路（每步一张证据截图 → outputs/canvas-s5-walkthrough/）：
//   01 空白新项目 → 添加图片节点（节点上屏）
//   02 点选该节点（左右 29px 磁吸把手出现）
//   03 拖动该节点一段（跟手、松手落位）
//   04 再建一个节点并连线（edge 出现）
//   05 拖动画布平移
//
// 断言走 tests/ux/_assert.mjs 的规范信号（节点计数 / 把手可见 / edge 计数）。
// 真 Electron + 真构建产物，隔离 userData / projects，零额度（全程不点生成）。
// 用法：pnpm run build && node tests/ux/canvas-s5-walkthrough.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, expectVisible, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'outputs/canvas-s5-walkthrough')
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nomi-canvas-s5-'))
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
mkdirSync(projectsDir, { recursive: true })
mkdirSync(shotsDir, { recursive: true })

const { app, win: _initialWin } = await launchNomiApp({
  name: 'canvas-s5-walkthrough',
  userDataDir,
  settingsDir: userDataDir,
  projectsDir,
  args: ['--no-proxy-server'],
  settleMs: 0,
  syntheticCredentialStorage: true,
})

let passed = 0
const results = []
function assert(condition, label, detail = '') {
  const ok = Boolean(condition)
  results.push({ label, ok, detail })
  if (!ok) throw new Error(`WALK FAIL: ${label}${detail ? ` — ${detail}` : ''}`)
  passed += 1
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
}

let win = _initialWin
const getWin = () => {
  const live = app.windows().filter((candidate) => !candidate.isClosed())
  win = live.find((candidate) => /projectId=/.test(candidate.url())) || live[live.length - 1] || win
  return win
}

async function resize(width, height) {
  const browserWindow = await app.browserWindow(getWin())
  await browserWindow.evaluate((target, size) => {
    target.setBounds({ x: 0, y: 0, width: size.width, height: size.height })
    target.center()
  }, { width, height })
  await getWin().waitForTimeout(350)
}

async function snap(name) {
  const file = path.join(shotsDir, name)
  await screenshotSettled(getWin(), { path: file })
  console.log(`  · 截图 ${name}`)
  return file
}

async function dismissFirstRun() {
  for (let index = 0; index < 6; index += 1) {
    const action = getWin().locator('button, [role="button"], a', { hasText: /跳过|完成|知道了|开始创作|稍后/ }).first()
    if (await action.isVisible().catch(() => false)) await action.click({ timeout: 900 }).catch(() => {})
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(180)
  }
}

async function readTransform() {
  return getWin().evaluate(() => {
    const layer = document.querySelector('.generation-canvas-v2__canvas')
    const matrix = new DOMMatrixReadOnly(getComputedStyle(layer).transform)
    return { x: matrix.m41, y: matrix.m42, zoom: matrix.a }
  })
}

async function findBlankPoint() {
  return getWin().evaluate(() => {
    const stage = document.querySelector('.generation-canvas-v2__stage')
    const rect = stage.getBoundingClientRect()
    for (const ry of [0.2, 0.28, 0.36, 0.5, 0.64, 0.76, 0.88, 0.12]) {
      for (const rx of [0.62, 0.7, 0.78, 0.86, 0.93, 0.54, 0.42, 0.3, 0.2, 0.12, 0.06]) {
        const x = rect.left + rect.width * rx
        const y = rect.top + rect.height * ry
        const hit = document.elementFromPoint(x, y)
        if (!hit || !stage.contains(hit)) continue
        if (hit.closest('.generation-canvas-v2-node, .generation-canvas-v2-toolbar, .generation-canvas-v2__zoom-bar, .generation-canvas-v2__selection-bounds, .generation-canvas-v2__selection-toolbar, .react-flow__nodesselection, button, input, textarea, [role="menu"], [role="toolbar"], .generation-canvas-v2__edge-hit, .generation-canvas-v2__minimap, .generation-canvas-v2__navigation-stack')) continue
        return { x: Math.round(x), y: Math.round(y) }
      }
    }
    return null
  })
}

async function nodeInfo() {
  return getWin().evaluate(() =>
    Array.from(document.querySelectorAll('.generation-canvas-v2-node')).map((node) => ({
      id: node.getAttribute('data-node-id'),
      kind: node.getAttribute('data-kind'),
      selected: node.getAttribute('data-selected') === 'true',
      rect: (() => { const r = node.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } })(),
    })),
  )
}

async function addNode(kind) {
  await getWin().locator(`.generation-canvas-v2-toolbar [data-node-kind="${kind}"]`).first().click()
  await getWin().waitForTimeout(700)
}

async function edgeCount() {
  return getWin().evaluate(() => document.querySelectorAll('.react-flow__edge, .generation-canvas-v2__edge-path').length)
}

const pageErrors = []
_initialWin.on('pageerror', (error) => pageErrors.push(String(error)))

try {
  await getWin().waitForLoadState('domcontentloaded')
  await getWin().waitForTimeout(1700)
  await getWin().evaluate(() => {
    localStorage.setItem('__nomiE2E', '1')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1']) localStorage.setItem(key, 'seen')
  })
  await getWin().reload()
  await getWin().waitForLoadState('domcontentloaded')
  await getWin().waitForTimeout(1600)
  await resize(1600, 1000)
  await dismissFirstRun()

  // 占位 key：让内置图像/视频模型出现，连线能算出真实 mode（全程不点生成、零额度）。
  await getWin().evaluate(() =>
    window.nomiDesktop?.modelCatalog?.upsertVendorApiKey('kie', { apiKey: 'nomi-e2e-placeholder', enabled: true }),
  )
  await getWin().reload()
  await getWin().waitForLoadState('domcontentloaded')
  await getWin().waitForTimeout(1500)
  await dismissFirstRun()

  // ── 空白新项目 ─────────────────────────────────────────────────────────
  const blankProject = getWin().locator('button, [role="button"]', { hasText: '新建空白项目' }).first()
  await blankProject.waitFor({ timeout: 8000 })
  await blankProject.click()
  await getWin().waitForTimeout(2200)
  await dismissFirstRun()
  await resize(1600, 1000)

  const generation = getWin().getByRole('button', { name: '生成', exact: true }).first()
  await generation.waitFor({ timeout: 8000 })
  await generation.click()
  await getWin().locator('.generation-canvas-v2-toolbar').waitFor({ timeout: 8000 })

  // ── 步骤 01：添加图片节点（节点上屏）───────────────────────────────────
  await addNode('image')
  let nodes = await nodeInfo()
  assert(nodes.length === 1, '添加图片节点后画布上恰有 1 个节点', JSON.stringify(nodes.map((n) => n.kind)))
  assert(nodes[0].kind === 'image', '该节点是图片节点', nodes[0].kind)
  await expectVisible(getWin().locator('.generation-canvas-v2-node').first(), '图片节点已上屏可见')
  await snap('01-create.png')

  // ── 步骤 02：点选该节点 → 左右 29px 磁吸把手出现 ───────────────────────
  const node0 = getWin().locator('.generation-canvas-v2-node').first()
  await node0.click({ position: { x: 24, y: 12 } })
  await getWin().waitForTimeout(350)
  nodes = await nodeInfo()
  assert(nodes[0].selected, '点一下节点会选中它')

  // 磁吸把手（左右各一）：R23 React Flow 单内核后，live 把手是 __handle--source.--magnetic，
  // 选中图片节点(primarySelection)后 affordance='magnetic'，两侧各浮出一个 28px 的 IconPlus 磁吸把手。
  const handles = getWin().locator('.generation-canvas-react-flow__handle--source.generation-canvas-react-flow__handle--magnetic')
  await expect(handles, '选中图片节点后左右磁吸把手都出现').toHaveCount(2, { timeout: 5000 })
  const handleFacts = await getWin().evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.generation-canvas-react-flow__handle--source.generation-canvas-react-flow__handle--magnetic'))
    return btns.map((b) => {
      const icon = b.querySelector('.generation-canvas-react-flow__handle-icon')
      const r = icon ? icon.getBoundingClientRect() : { width: 0, height: 0 }
      const cs = icon ? getComputedStyle(icon) : null
      const hasPlus = Boolean(icon && icon.querySelector('svg'))
      return {
        side: b.getAttribute('data-side'),
        visible: r.width > 0 && r.height > 0 && (cs ? cs.visibility !== 'hidden' && Number(cs.opacity) > 0.01 : false),
        hasPlus,
        iconW: Math.round(r.width),
        iconH: Math.round(r.height),
      }
    })
  })
  const leftH = handleFacts.find((h) => h.side === 'left')
  const rightH = handleFacts.find((h) => h.side === 'right')
  assert(leftH && rightH, '左右两侧各有一个磁吸把手', JSON.stringify(handleFacts.map((h) => h.side)))
  assert(leftH.visible && rightH.visible, '左右把手图标都可见', JSON.stringify(handleFacts))
  assert(leftH.hasPlus && rightH.hasPlus, '左右把手都是「+」连线图标（磁吸态）', JSON.stringify(handleFacts.map((h) => h.hasPlus)))
  // 渲染盒 = 28px base + 2px 边框，取整到 29px（任务规格「29px」量的就是这个可见盒）。
  assert(
    leftH.iconW === 29 && leftH.iconH === 29 && rightH.iconW === 29 && rightH.iconH === 29,
    '磁吸把手图标是 29px 见方（左右磁吸；live 渲染盒 29px = 28px CSS + 边框）',
    JSON.stringify({ left: [leftH.iconW, leftH.iconH], right: [rightH.iconW, rightH.iconH] }),
  )
  await snap('02-select-handles.png')

  // ── 步骤 03：拖动该节点一段（跟手、松手落位）─────────────────────────
  const beforeDrag = (await nodeInfo())[0].rect
  const grabX = beforeDrag.x + Math.round(beforeDrag.w / 2)
  const grabY = beforeDrag.y + 16
  await getWin().mouse.move(grabX, grabY)
  await getWin().mouse.down()
  // 分步拖动，中途采一帧证明「跟手」：拖到一半时节点应已跟着走。
  await getWin().mouse.move(grabX + 90, grabY + 60, { steps: 12 })
  const midRect = (await nodeInfo())[0].rect
  await getWin().mouse.move(grabX + 180, grabY + 120, { steps: 12 })
  await snap('03-drag.png')
  await getWin().mouse.up()
  await getWin().waitForTimeout(300)
  const afterDrag = (await nodeInfo())[0].rect
  assert(
    midRect.x > beforeDrag.x + 20 && midRect.y > beforeDrag.y + 15,
    '拖动中途节点已跟手移动（不是松手才跳）',
    `mid Δ=(${midRect.x - beforeDrag.x}, ${midRect.y - beforeDrag.y})`,
  )
  assert(
    afterDrag.x > beforeDrag.x + 120 && afterDrag.y > beforeDrag.y + 80,
    '松手后节点落在拖动终点附近（落位）',
    `final Δ=(${afterDrag.x - beforeDrag.x}, ${afterDrag.y - beforeDrag.y})`,
  )

  // ── 步骤 04：再建一个节点并连线（edge 出现）──────────────────────────
  const edgesBefore = await edgeCount()
  assert(edgesBefore === 0, '连线前画布上没有边', String(edgesBefore))
  await addNode('video')
  await getWin().waitForTimeout(500)
  nodes = await nodeInfo()
  assert(nodes.length === 2, '再建一个节点后画布上有 2 个节点', JSON.stringify(nodes.map((n) => n.kind)))

  // 用真实用户路径连线：选中源节点让磁吸把手浮出 → 从源右把手拖到目标节点。
  // live 把手（R23）：命中区 __handle-hit（112px 宽带）、图标 __handle-icon。
  const source = nodes[0]
  const target = nodes[1]
  const handleCenter = (nodeId, side) => getWin().evaluate(({ id, wantSide }) => {
    // 把手在 __node-shell 层，与 .generation-canvas-v2-node 同属 React Flow 的 .react-flow__node[data-id] 包裹。
    // 所以从卡片往上找到那个包裹，再在包裹内取源把手。
    const card = document.querySelector(`.generation-canvas-v2-node[data-node-id="${id}"]`)
    const wrapper = card?.closest('.react-flow__node') || document.querySelector(`.react-flow__node[data-id="${id}"]`)
    if (!wrapper) return null
    const src = Array.from(wrapper.querySelectorAll('.generation-canvas-react-flow__handle--source'))
    const pick = src.find((h) => h.getAttribute('data-side') === wantSide) || src[0]
    if (!pick) return null
    // 用图标中心作为可点锚（磁吸图标始终在把手静止位）；退回 hit 区中心或 handle 自身。
    const icon = pick.querySelector('.generation-canvas-react-flow__handle-icon')
    const hit = pick.querySelector('.generation-canvas-react-flow__handle-hit')
    const el = icon || hit || pick
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return null
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  }, { id: nodeId, wantSide: side })

  await getWin().mouse.click(source.rect.x + Math.round(source.rect.w / 2), source.rect.y + 14)
  await getWin().waitForTimeout(350)
  const startHandle = await handleCenter(source.id, 'right')
  assert(Boolean(startHandle), '拿得到源节点右侧磁吸把手坐标', JSON.stringify(startHandle))
  // 真实拖拽连线：从源右把手拖到目标节点中心（React Flow 连线手势）。
  await getWin().mouse.move(startHandle.x, startHandle.y)
  await getWin().mouse.down()
  await getWin().mouse.move((startHandle.x + target.rect.x) / 2, (startHandle.y + target.rect.y) / 2, { steps: 8 })
  await getWin().mouse.move(target.rect.x + Math.round(target.rect.w / 2), target.rect.y + Math.round(target.rect.h / 2), { steps: 14 })
  await getWin().waitForTimeout(180)
  await getWin().mouse.up()
  await getWin().waitForTimeout(600)
  let edgesAfter = await edgeCount()
  if (edgesAfter <= edgesBefore) {
    // 兜底：点击式连线（点源右把手进入待连 → 点目标左把手完成）。
    await getWin().mouse.click(source.rect.x + Math.round(source.rect.w / 2), source.rect.y + 14)
    await getWin().waitForTimeout(300)
    const srcAgain = await handleCenter(source.id, 'right')
    if (srcAgain) { await getWin().mouse.click(srcAgain.x, srcAgain.y); await getWin().waitForTimeout(350) }
    const tgtHandle = await handleCenter(target.id, 'left')
    if (tgtHandle) { await getWin().mouse.click(tgtHandle.x, tgtHandle.y); await getWin().waitForTimeout(600) }
    edgesAfter = await edgeCount()
  }
  assert(edgesAfter >= 1, '连线后画布上出现了 edge', `edges ${edgesBefore} → ${edgesAfter}`)
  await snap('04-connect.png')

  // ── 步骤 05：拖动画布平移 ───────────────────────────────────────────────
  // 先点空白取消选中，免得把手/浮层挡住空白拖拽。
  const blankForClear = await findBlankPoint()
  if (blankForClear) { await getWin().mouse.click(blankForClear.x, blankForClear.y); await getWin().waitForTimeout(250) }
  const panBefore = await readTransform()
  const blank = await findBlankPoint()
  assert(Boolean(blank), '找得到一块画布空白用于平移', JSON.stringify(blank))
  await getWin().mouse.move(blank.x, blank.y)
  await getWin().mouse.down()
  await getWin().mouse.move(blank.x - 160, blank.y - 100, { steps: 16 })
  await snap('05-pan.png')
  await getWin().mouse.up()
  await getWin().waitForTimeout(250)
  const panAfter = await readTransform()
  assert(
    Math.round(panAfter.x - panBefore.x) <= -120 && Math.round(panAfter.y - panBefore.y) <= -70,
    '拖动空白 = 画布平移（变换跟着鼠标走）',
    `Δ=(${Math.round(panAfter.x - panBefore.x)}, ${Math.round(panAfter.y - panBefore.y)})`,
  )
  assert(panAfter.zoom === panBefore.zoom, '平移不改变缩放')

  assert(pageErrors.length === 0, '全程无页面错误', pageErrors.slice(0, 3).join(' | '))

  console.log(`\n✅ S5 走查全部通过：${passed} 条断言，截图在 outputs/canvas-s5-walkthrough/`)
} catch (error) {
  console.error(`\n❌ S5 走查失败：${error.message}`)
  try { await screenshotSettled(getWin(), { path: path.join(shotsDir, 'FAIL.png') }).catch(() => getWin().screenshot({ path: path.join(shotsDir, 'FAIL.png') })) } catch { /* best effort */ }
  console.error('已通过断言：', results.filter((r) => r.ok).map((r) => r.label).join(' | ') || '(无)')
  if (pageErrors.length) console.error('页面错误：', pageErrors.slice(0, 5).join('\n'))
  await app.close()
  process.exit(1)
}

await app.close()
process.exit(0)
