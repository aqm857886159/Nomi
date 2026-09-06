// R13 走查 —— 组端口 + 整组运行（SHUO backlog 第 2 项）。
// 用法: node tests/ux/group-ports.walk.mjs   产出: tests/ux/shots/group-ports/*.png
//
// 验的是**用户真会做的那串动作**：编组 → 组标签上点运行 → 从一个节点拉线 → 落到组框上 → 组内每个成员各得一根边。
// 断言不只看 DOM 有没有：边数、组框高亮的 computed 颜色、按钮几何（会不会把标签挤爆）都对账。
import { launchNomiApp } from './_launchApp.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { screenshotSettled } from './_assert.mjs'
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/group-ports')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })
const userData = path.join(repoRoot, '.tmp', 'nomi-groupports-userdata')
fs.rmSync(userData, { recursive: true, force: true })
fs.mkdirSync(userData, { recursive: true })

let n = 0
const fail = []
function check(name, ok, detail) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fail.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
async function snap(win, name, clip) {
  n += 1
  const options = { path: path.join(shotsDir, `${String(n).padStart(2, '0')}-${name}.png`), ...(clip ? { clip } : {}) }
  // The pending connection state is intentionally captured while the pointer is down;
  // its preview line is interactive, so the generic quiescence guard cannot settle it.
  if (name === 'group-drop-target') {
    await win.waitForTimeout(500)
    await win.screenshot(options)
  } else {
    await screenshotSettled(win, options)
  }
  console.log(`  · shot ${String(n).padStart(2, '0')}-${name}`)
}
async function snapNear(win, name, locator, pad = 30) {
  const box = await locator.boundingBox().catch(() => null)
  if (!box) { console.error(`  ⚠️ ${name} 没盒子`); return null }
  await snap(win, name, {
    x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
    width: Math.min(1200, box.width + pad * 2), height: Math.min(800, box.height + pad * 2),
  })
  return box
}

const { app, win } = await launchNomiApp({
  name: 'group-ports',
  userDataDir: userData,
  args: ['--no-proxy-server'],
  settleMs: 0,
})
await win.evaluate(() => {
  window.localStorage.setItem('__nomiE2E', '1')
  for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
    window.localStorage.setItem(k, 'seen')
  }
})
await win.reload()
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(2200)
for (const label of ['新建空白项目', '开始一个项目']) {
  const el = win.locator('button', { hasText: label }).first()
  if (await el.count()) { await el.click({ timeout: 4000 }).catch(() => {}); break }
}
await win
  .locator('div.fixed.inset-0')
  .filter({ hasText: /开始生成/ })
  .last()
  .waitFor({ state: 'visible', timeout: 15_000 })
  .catch(() => {})
const genTab = win.locator('button', { hasText: /^生成$/ }).first()
if (await genTab.count()) await genTab.click({ timeout: 5000 }).catch(() => {})
await win.waitForTimeout(2500)

// 左缘加节点收口在 _canvasRail（结构锚点，不认走 i18n 的 aria-label），找不到当场抛。
try {
  for (let i = 0; i < 4; i += 1) { await addCanvasNodeFromRail(win, 'image', { timeout: 4000 }); await win.waitForTimeout(300) }
} catch (error) { console.error('❌ 画布左缘加不出图片节点', error?.message || error); await app.close(); process.exit(1) }
await win.waitForTimeout(900)

const nodeIds = await win.evaluate(() =>
  Array.from(document.querySelectorAll('[data-node-id]')).map((el) => el.getAttribute('data-node-id')).filter(Boolean))
console.log('  → 节点:', nodeIds.length)
if (nodeIds.length < 4) { console.error('❌ 节点不够'); await app.close(); process.exit(1) }

// ── 编组前 3 个：框选不好控，改用「全选后编组」再把第 4 个移出组太绕；
//    直接全选 4 个编成一组，第 4 个当连线源就用组外新加的第 5 个。
await win.keyboard.press('Control+a')
await win.waitForTimeout(500)
const groupBtn = win.locator('[aria-label^="创建分组"]').first()
if (!(await groupBtn.count())) { console.error('❌ 找不到「创建分组」'); await app.close(); process.exit(1) }
await groupBtn.click({ timeout: 4000 })
await win.waitForTimeout(1000)
await win.keyboard.press('Escape')
await win.waitForTimeout(400)
await snap(win, 'grouped')

// 组框内找一个不压节点的空白点（点组框 = 选中全部成员；压着节点就变成选那一个了）
async function emptyPointInGroup() {
  const gb = await win.locator('.generation-canvas-v2__group-box').first().boundingBox()
  if (!gb) return null
  return win.evaluate((box) => {
    const hit = (x, y) => {
      const stack = document.elementsFromPoint(x, y)
      return stack.some((el) => el.closest('[data-group-id]')) && !stack.some((el) => el.closest('[data-node-id]'))
    }
    for (let dy = 12; dy < box.height - 8; dy += 10) {
      for (let dx = 12; dx < box.width - 8; dx += 10) {
        if (hit(box.x + dx, box.y + dy)) return { x: box.x + dx, y: box.y + dy }
      }
    }
    return null
  }, gb)
}

// ① 整组运行：**本来就有**，入口是「点组框 → 全部成员被选中 → 选择浮条『生成 N 个』」。
//    这里验的是它确实好使，**以及同屏只有这一个生成动作**——2026-08-02 我在组标签上加过第二个 ▶，
//    与浮条上的「生成 N 个」同屏并存（相距约 600px），是并行版，已删。这条断言就是防它复发。
const groupClickPoint = await emptyPointInGroup()
check('组框内找得到不压节点的空白点', Boolean(groupClickPoint))
await win.mouse.click(groupClickPoint.x, groupClickPoint.y)
await win.waitForTimeout(900)
const selectedText = await win.locator('.generation-canvas-v2__selection-toolbar').first().textContent().catch(() => '')
console.log('  → 点组框后选择浮条:', JSON.stringify(selectedText))
check('点组框 = 选中全部成员（整组运行的现成入口）', /已选\s*4\s*个/.test(selectedText || ''), String(selectedText))
check('浮条上有「生成选中 4 个」', /生成选中\s*4\s*个/.test(selectedText || ''), String(selectedText))

// 反并行版断言：整屏只应有**一个**「生成」动作，组标签上不许再挂第二个。
const generateAffordances = await win.evaluate(() => ({
  onGroupLabel: document.querySelectorAll('[data-group-run]').length,
  runAll: document.querySelectorAll('[data-storyboard-run-all]').length,
}))
console.log('  → 同屏生成动作:', JSON.stringify(generateAffordances))
check('组标签上没有第二个运行钮（并行版已删，防复发）', generateAffordances.onGroupLabel === 0, JSON.stringify(generateAffordances))
check('生成动作全屏只有一个（就是选择浮条那个）', generateAffordances.runAll === 1, JSON.stringify(generateAffordances))
{
  const box = await win.locator('.generation-canvas-v2__group-box-label').first().boundingBox().catch(() => null)
  if (box) await snap(win, 'group-label-no-run-button', { x: Math.max(0, box.x - 14), y: Math.max(0, box.y - 14), width: 420, height: 120 })
}

// ② 走浮条那条路跑整组：应当进现成的批量确认卡，张数 = 组成员数。
await win.locator('[data-storyboard-run-all]').first().click({ timeout: 5000 })
// 等真实条件（确认卡出现），不是盲等固定毫秒：机器慢一点 sleep 就不够，读到空却报绿。
// 超时不抛——下面的 check 仍要把「读到什么」打出来，保留这条走查的失败可读性。
await win
  .locator('div.fixed.inset-0')
  .filter({ hasText: /开始生成/ })
  .last()
  .waitFor({ state: 'visible', timeout: 15_000 })
  .catch(() => {})
await snap(win, 'after-run-group')
const confirmCard = await win.evaluate(() => {
  const veil = Array.from(document.querySelectorAll('.fixed.inset-0')).find((element) => element.textContent?.includes('开始生成'))
  return veil ? veil.textContent?.replace(/\s+/g, ' ').trim() ?? '' : null
})
console.log('  → 确认卡:', JSON.stringify(confirmCard))
check('整组运行走现成的批量确认卡', typeof confirmCard === 'string' && /开始生成/.test(confirmCard), String(confirmCard))
check('确认卡张数 = 组成员数 4', /生成\s*4\s*张/.test(confirmCard || ''), String(confirmCard))

const cancelBtn = win.locator('button', { hasText: /^取消$/ }).first()
if (await cancelBtn.count()) await cancelBtn.click({ timeout: 4000 }).catch(() => {})
await win.waitForTimeout(1200)
const veilGone = await win.evaluate(() => !Array.from(document.querySelectorAll('.fixed.inset-0')).some((element) => element.textContent?.includes('开始生成')))
check('取消后确认卡收掉', veilGone)

// ③ 连到组：加一个组外节点 → 从它拉线 → 组框应变成可落点（虚线 + 加深底色）
await win.waitForTimeout(800)
await addCanvasNodeFromRail(win, 'image', { timeout: 4000 })
await win.waitForTimeout(900)
const allIds = await win.evaluate(() =>
  Array.from(document.querySelectorAll('[data-node-id]')).map((el) => el.getAttribute('data-node-id')))
const srcId = allIds[allIds.length - 1]
console.log('  → 连线源:', srcId)
// 先「适应视图」：组框比视口还大时它的标签在视口外，截图就拍不到改动区（R13 眼见链第四问）。
const fitBtn = win.locator('[aria-label="适应视图"]').first()
if (await fitBtn.count()) { await fitBtn.click({ timeout: 4000 }).catch(() => {}); await win.waitForTimeout(1200) }
await win.locator(`[data-node-id="${srcId}"]`).first().click({ timeout: 4000 })
await win.waitForTimeout(800)
// 用**真手势**：从磁吸连接点按下 → 拖到组框空白处 → 松手。这条路走的是 pointerup（useDragToConnect），
// 和「点一下连接点再点目标」的 click 路是两条，必须两条都真的通（走查第一版就是漏了 pointerup 那条）。
const handle = win.locator(`.react-flow__node[data-id="${srcId}"] .generation-canvas-react-flow__handle[data-side="right"]`).last()
check('找得到连接点', await handle.count() > 0)
const hb = await handle.boundingBox()
const gbox0 = await win.locator('.generation-canvas-v2__group-box').first().boundingBox()
if (!hb || !gbox0) { console.error('❌ 连接点/组框没盒子'); await app.close(); process.exit(1) }
// 落点必须是**组框内、且没压着任何节点**的空白：压着节点是「连那一个」（节点优先，这是设计），
// 随手猜坐标会连成 1 根然后误判成 bug。这里扫一遍真实元素栈找一个真空白点。
const dropPoint = await win.evaluate((gb) => {
  const inside = (x, y) => {
    const stack = document.elementsFromPoint(x, y)
    return stack.some((el) => el.closest('[data-group-id]')) && !stack.some((el) => el.closest('[data-node-id]'))
  }
  for (let dy = 12; dy < gb.height - 8; dy += 10) {
    for (let dx = 12; dx < gb.width - 8; dx += 10) {
      const x = gb.x + dx; const y = gb.y + dy
      if (inside(x, y)) return { x, y }
    }
  }
  return null
}, gbox0)
check('组框内找得到不压节点的空白落点', Boolean(dropPoint), JSON.stringify(dropPoint))
if (!dropPoint) { await app.close(); process.exit(1) }
await win.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
const hitHandle = await win.evaluate(({ x, y }) => {
  const hit = document.elementFromPoint(x, y)?.closest('.generation-canvas-react-flow__handle')
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    point: { x, y },
    stack: document.elementsFromPoint(x, y).slice(0, 8).map((element) => ({
      tag: element.tagName,
      className: element.className?.toString() || '',
      nodeId: element.closest('.react-flow__node')?.getAttribute('data-id') || null,
    })),
    handle: hit ? {
      nodeId: hit.closest('.react-flow__node')?.getAttribute('data-id'),
      handleId: hit.getAttribute('data-handleid'),
      handleType: hit.getAttribute('data-nodeid') ? hit.className.toString() : null,
    } : null,
  }
}, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 })
check('连接点中心命中 React Flow 握把', hitHandle.handle?.nodeId === srcId, JSON.stringify({ box: hb, ...hitHandle }))
await win.mouse.down()
await win.mouse.move(dropPoint.x, dropPoint.y, { steps: 12 })
await win.waitForTimeout(500)

const pendingStyle = await win.evaluate(() => {
  const box = document.querySelector('.generation-canvas-v2__group-box')
  if (!box) return null
  const cs = getComputedStyle(box)
  return { borderStyle: cs.borderStyle, bg: cs.backgroundColor, cursor: cs.cursor, aria: box.getAttribute('aria-label') }
})
console.log('  → 待连时组框:', JSON.stringify(pendingStyle))
check('有线待连时组框变成可落点（虚线边）', pendingStyle?.borderStyle === 'dashed', JSON.stringify(pendingStyle))
check('可落点时 aria 说清「连到哪、几个」', /连到/.test(pendingStyle?.aria || ''), pendingStyle?.aria)
// 组框比视口还大 → 整框裁出来看不清；改裁它左上角那块（标签 + 边框），字才认得出（R13 眼见链）。
{
  const gb = await win.locator('.generation-canvas-v2__group-box').first().boundingBox()
  if (gb) await snap(win, 'group-drop-target', { x: Math.max(0, gb.x - 12), y: Math.max(0, gb.y - 12), width: 420, height: 190 })
}

// ④ 松手落到组上 → 组内每个成员各一根边
const edgesBefore = await win.evaluate(() => document.querySelectorAll('.generation-canvas-v2__edge-path').length)
await win.mouse.up()
await win.waitForTimeout(1600)
const edgesAfter = await win.evaluate(() => document.querySelectorAll('.generation-canvas-v2__edge-path').length)
console.log(`  → 边数 ${edgesBefore} → ${edgesAfter}`)
check('连到组后组内 4 个成员各得一根边', edgesAfter - edgesBefore === 4, `实得 ${edgesAfter - edgesBefore}`)
await snap(win, 'after-connect-to-group')

const restored = await win.evaluate(() => {
  const box = document.querySelector('.generation-canvas-v2__group-box')
  return box ? getComputedStyle(box).borderStyle : null
})
check('连完组框恢复常态（不再是虚线）', restored !== 'dashed', String(restored))

await app.close()
console.log(fail.length ? `\n❌ ${fail.length} 条不达标:\n - ${fail.join('\n - ')}` : '\n✅ 全部达标')
process.exit(fail.length ? 1 : 0)
