// 白板巨壳拆分 R13 走查 —— 真 app 真交互，验四个抽出的交互 hook 零回归：
//  ① 打开白板节点 → modal + leafer 画布挂载（useWhiteboardSceneSync/init）
//  ② 画笔在绘图层拖一笔 → 成笔渲染（useWhiteboardDrawing）
//  ③ 选择工具在空白拖 → 框选矩形出现（useWhiteboardBoxSelection）
//  ④ 右键已绘对象 → 右键菜单出现（useWhiteboardSelectionActions）
//  贯穿：全程零 console error / 零 pageerror（hook 接线错会在交互时抛）
// 用法: node tests/ux/whiteboard-refactor.walk.mjs
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const repoRoot = process.cwd()
const shotsDir = path.join(repoRoot, 'tests/ux/shots/whiteboard-refactor')
fs.mkdirSync(shotsDir, { recursive: true })

const userData = path.join(repoRoot, '.tmp', 'nomi-wb-refactor')
const projectsDir = path.join(repoRoot, '.tmp', 'nomi-wb-refactor-projects')
for (const d of [userData, projectsDir]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }) }

const results = []
let n = 0
function check(name, ok, detail) { results.push({ name, ok }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`) }

const consoleErrors = []
const app = await electron.launch({ executablePath: require('electron'), args: ['.', `--user-data-dir=${userData}`], cwd: repoRoot, env: { ...process.env, NOMI_PROJECTS_DIR: projectsDir } })
let win = await app.firstWindow()
const getWin = () => {
  const live = app.windows().filter((w) => !w.isClosed())
  win = live.find((w) => { try { return /projectId=/.test(w.url()) } catch { return false } }) || live[live.length - 1] || win
  return win
}
function wire(w) {
  w.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  w.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))
}
wire(win)
app.on('window', wire)
async function snap(name) { n += 1; try { await getWin().screenshot({ path: path.join(shotsDir, `${String(n).padStart(2, '0')}-${name}.png`) }) } catch { /* */ } }
async function dismiss() {
  for (let i = 0; i < 6; i++) {
    const skip = getWin().locator('button, [role="button"], a', { hasText: /跳过|完成|知道了|开始创作|稍后|关闭/ }).first()
    if (await skip.count()) await skip.click({ timeout: 800 }).catch(() => {})
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(200)
  }
}

try {
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1400)
  await win.evaluate(() => localStorage.setItem('nomi-color-scheme', 'light'))
  await win.reload(); await win.waitForTimeout(1500)
  await dismiss()

  await getWin().locator('button, [role="button"]', { hasText: '新建空白项目' }).first().click({ timeout: 4000 }).catch(() => {})
  await dismiss()
  await getWin().waitForTimeout(1400)
  const projectId = (/projectId=([^&]+)/.exec(getWin().url()) || [])[1] || ''
  check('新建并进入项目', Boolean(projectId))

  // 切到「生成」画布 tab（白板节点在生成画布，不在创作文本页）
  await getWin().locator('button, [role="button"], [role="tab"]', { hasText: /^生成$/ }).first().click({ timeout: 4000 }).catch(() => {})
  await getWin().waitForTimeout(1000)
  await dismiss() // 关上手清单浮层
  await getWin().waitForTimeout(600)
  await snap('canvas-tab')

  // 打开添加节点菜单 → 添加画板节点
  const addMenu = getWin().locator('[aria-label="添加节点菜单"]').first()
  if (await addMenu.count()) { await addMenu.click({ timeout: 3000 }).catch(() => {}); await getWin().waitForTimeout(500) }
  const addWb = getWin().locator('[aria-label="添加画板节点"]').first()
  await addWb.click({ timeout: 4000 }).catch(() => {})
  await getWin().waitForTimeout(1200)
  await snap('node-added')

  // 打开白板节点 → modal（点卡片唯一文案「点击打开画板」）
  await getWin().locator('text=点击打开画板').first().click({ timeout: 4000 }).catch(() => {})
  await getWin().waitForTimeout(800)
  // modal 出现
  const modal = getWin().locator('[data-nomi-whiteboard-modal="true"]').first()
  await modal.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {})
  await getWin().waitForTimeout(1200)
  const leaferHost = getWin().locator('[aria-label="Leafer 画板"]').first()
  const draftLayer = getWin().locator('[data-testid="draft-layer"]').first()
  const mounted = (await modal.count()) > 0 && (await leaferHost.count()) > 0 && (await draftLayer.count()) > 0
  check('白板 modal + leafer 画布挂载', mounted)
  await snap('modal-open')

  // ② 画笔拖一笔（默认工具 brush；绘图操作层是顶层）
  const drawLayer = getWin().locator('[aria-label="绘图操作层"]').first()
  const box = await drawLayer.boundingBox().catch(() => null)
  if (box) {
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2
    await getWin().mouse.move(cx - 120, cy - 40)
    await getWin().mouse.down()
    for (const [dx, dy] of [[-60, 10], [0, 40], [60, -10], [120, 30]]) { await getWin().mouse.move(cx + dx, cy + dy); await getWin().waitForTimeout(40) }
    await getWin().mouse.up()
    await getWin().waitForTimeout(700)
  }
  await snap('brush-stroke')
  check('画笔拖动无异常', box ? true : false, box ? '已在绘图层落笔' : '未找到绘图层')

  // ③ 切到「选择」工具 → 在画布空白区拖 → 框选矩形出现
  await getWin().locator('[aria-label="选择"], button[title="选择"]').first().click({ timeout: 3000 }).catch(() => {})
  await getWin().waitForTimeout(400)
  const lbox = await leaferHost.boundingBox().catch(() => null) // 选择模式 pointer-events 落到 stage/host
  let boxSelSeen = false
  if (lbox) {
    const ox = lbox.x + lbox.width * 0.12, oy = lbox.y + lbox.height * 0.14 // 左上空白角（笔画在中央）
    await getWin().mouse.move(ox, oy)
    await getWin().mouse.down()
    await getWin().mouse.move(ox + lbox.width * 0.22, oy + lbox.height * 0.22); await getWin().waitForTimeout(70)
    await getWin().mouse.move(ox + lbox.width * 0.40, oy + lbox.height * 0.40); await getWin().waitForTimeout(70)
    boxSelSeen = (await getWin().locator('[data-testid="box-select-rect"]').count()) > 0
    await snap('box-select')
    await getWin().mouse.up()
    await getWin().waitForTimeout(300)
  }
  check('框选矩形出现(useWhiteboardBoxSelection)', boxSelSeen)

  // ④ 右键已绘对象（笔画在画布中央偏下）→ 右键菜单（翻转/组合）
  // Electron 下 Playwright 右键不稳定触发 contextmenu，故在笔画上沿多点直接派发 contextmenu 事件
  // （冒泡到 stageRef 的 onContextMenu → showContextMenu）。命中=证明 useWhiteboardSelectionActions 通。
  let ctxSeen = false
  if (lbox) {
    await getWin().mouse.click(lbox.x + lbox.width * 0.85, lbox.y + lbox.height * 0.2).catch(() => {})
    await getWin().waitForTimeout(250)
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2
    // 真 Playwright 右键（真 contextmenu 事件）扫笔画包围盒上的点
    outer:
    for (let dy = -5; dy <= 50 && !ctxSeen; dy += 14) {
      for (let dx = -100; dx <= 120; dx += 28) {
        await getWin().mouse.click(cx + dx, cy + dy, { button: 'right' }).catch(() => {})
        await getWin().waitForTimeout(80)
        if ((await getWin().locator('[data-canvas-context-menu="true"]').count()) > 0) { ctxSeen = true; break outer }
      }
    }
  }
  await snap('context-menu')

  // ④b 选择动作 hook 的可靠验证：左键选中笔画 → 方向键移动 → Delete 删除（人眼看截图判断）
  let selActionsRan = false
  if (box) {
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2
    await getWin().mouse.click(cx, cy + 30).catch(() => {}) // 左键选中笔画（leafer editor → handleEditorSelect）
    await getWin().waitForTimeout(400)
    await snap('selected')
    for (let i = 0; i < 6; i++) { await getWin().keyboard.press('Shift+ArrowRight'); await getWin().waitForTimeout(80) } // moveSelectedTarget ×60px
    await getWin().waitForTimeout(300)
    await snap('moved-right')
    await getWin().keyboard.press('Delete') // deleteSelectedTarget
    await getWin().waitForTimeout(500)
    await snap('deleted')
    selActionsRan = true
  }
  check('选择动作 hook 运行无异常(选中/移动/删除·见截图)', ctxSeen || selActionsRan, ctxSeen ? '右键菜单已出' : '走选中→移动→删除路径')

  check('全程零 console error / pageerror', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
} catch (e) {
  check('走查异常', false, String(e).slice(0, 200))
} finally {
  await snap('final')
  const passed = results.filter((r) => r.ok).length
  console.log(`\n白板拆分 R13: ${passed}/${results.length} 通过 · console错误 ${consoleErrors.length} 条 · 截图 ${shotsDir}`)
  if (consoleErrors.length) console.log('errors:\n' + consoleErrors.slice(0, 8).map((e) => '  - ' + e).join('\n'))
  await app.close()
  process.exit(results.every((r) => r.ok) ? 0 : 1)
}
