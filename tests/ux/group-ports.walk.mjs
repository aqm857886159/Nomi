// R13 走查 —— 组端口 + 整组运行（SHUO backlog 第 2 项）。
// 用法: node tests/ux/group-ports.walk.mjs   产出: tests/ux/shots/group-ports/*.png
//
// 验的是**用户真会做的那串动作**：编组 → 组标签上点运行 → 从一个节点拉线 → 落到组框上 → 组内每个成员各得一根边。
// 断言不只看 DOM 有没有：边数、组框高亮的 computed 颜色、按钮几何（会不会把标签挤爆）都对账。
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, expectAbsent, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'
import { findConnectionStartPoint, waitForCanvasViewportSettled } from './_canvasHit.mjs'
import { newProjectEntry } from './_shell.mjs'
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/group-ports')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

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
    await expect.poll(() => win.locator('.generation-canvas-v2__group-box').first().evaluate((element) => getComputedStyle(element).borderStyle)).toBe('dashed')
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
  args: ['--no-proxy-server'],
  settleMs: 0,
  initialLocalStorage: { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen' },
})
await newProjectEntry(win).click()
// 项目工作区是实际就绪信号；旧首启弹层不会出现，不能等超时再吞掉。
await win.getByRole('button', { name: '生成', exact: true }).click()

const addImage = win.locator('[aria-label="添加图片节点"]').first()
await addImage.waitFor({ state: 'visible' })
if (!(await addImage.count())) { console.error('❌ 找不到「添加图片节点」'); await app.close(); process.exit(1) }
for (let i = 0; i < 4; i += 1) {
  await addImage.click({ timeout: 4000 })
  await expect.poll(() => win.locator('[data-node-id]').count()).toBeGreaterThanOrEqual(i + 1)
}
await expect.poll(() => win.locator('[data-node-id]').count()).toBeGreaterThanOrEqual(4)

const nodeIds = await win.evaluate(() =>
  Array.from(document.querySelectorAll('[data-node-id]')).map((el) => el.getAttribute('data-node-id')).filter(Boolean))
console.log('  → 节点:', nodeIds.length)
if (nodeIds.length < 4) { console.error('❌ 节点不够'); await app.close(); process.exit(1) }

// ── 编组前 3 个：框选不好控，改用「全选后编组」再把第 4 个移出组太绕；
//    直接全选 4 个编成一组，第 4 个当连线源就用组外新加的第 5 个。
await win.keyboard.press('Control+a')
await expect.poll(() => win.locator('.generation-canvas-v2-node[data-selected="true"]').count()).toBe(4)
const groupBtn = win.locator('[aria-label^="创建分组"]').first()
if (!(await groupBtn.count())) { console.error('❌ 找不到「创建分组」'); await app.close(); process.exit(1) }
await groupBtn.click({ timeout: 4000 })
await expectVisible(win.locator('.generation-canvas-v2__group-box').first(), '组框已生成')
await win.keyboard.press('Escape')
await expect.poll(() => win.locator('.generation-canvas-v2__group-box').count()).toBeGreaterThan(0)
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

// ① 整组运行：点组框后出现一条带文字的组工具条。组选择时旧的模型 / 并发浮条收起，
//    生成入口只保留工具条上的「生成整组」，避免两个批量入口同屏漂移。
const groupClickPoint = await emptyPointInGroup()
check('组框内找得到不压节点的空白点', Boolean(groupClickPoint))
await win.mouse.click(groupClickPoint.x, groupClickPoint.y)
await expectVisible(win.locator('[data-group-toolbar="true"]'), '组工具条已出现')
const selectedText = await win.locator('[data-group-toolbar="true"]').first().textContent().catch(() => '')
console.log('  → 点组框后组工具条:', JSON.stringify(selectedText))
// 组名夹在中间（默认名「组 1」/ 英文「Group 1」），所以认「成员数 4」这个独立节点而不是拼全文。
check('点组框 = 选中全部成员（组工具条出现）', (await win.locator('[data-group-toolbar-count="true"]').first().textContent().catch(() => '') || '').replace(/\s+/g, '').endsWith('·4'), String(selectedText))
check('工具条有「生成整组」', /生成整组/.test(selectedText || ''), String(selectedText))

// 反并行版断言：整屏只应有**一个**「生成」动作，组标签上不许再挂第二个。
const generateAffordances = await win.evaluate(() => ({
  onGroupLabel: document.querySelectorAll('[data-group-run]').length,
}))
console.log('  → 同屏生成动作:', JSON.stringify(generateAffordances))
check('组标签上没有第二个运行钮（并行版已删，防复发）', generateAffordances.onGroupLabel === 0, JSON.stringify(generateAffordances))
// 批量生成只剩组工具条上的「生成整组」：旧的框选浮条（含「生成选中 N 个」）选中整组时不出现。
const groupToolbarProof = await proveProbe(win.locator('[data-group-toolbar="true"]'), '组工具条在屏上（证明同屏探针是活的）')
await expectAbsent(win.locator('.generation-canvas-v2__selection-toolbar'), { provenBy: groupToolbarProof, message: '选中整组后不出旧的框选浮条' })
check('同屏只有一个批量生成入口「生成整组」', (await win.getByRole('button', { name: '生成整组', exact: true }).count()) === 1)
{
  const box = await win.locator('.generation-canvas-v2__group-box-label').first().boundingBox().catch(() => null)
  if (box) await snap(win, 'group-label-no-run-button', { x: Math.max(0, box.x - 14), y: Math.max(0, box.y - 14), width: 420, height: 120 })
}

// ② 走组工具条那条路跑整组：仍进现成的批量确认卡，张数 = 组成员数。
await win.getByRole('button', { name: '生成整组', exact: true }).click()
// 等真实条件（确认卡出现），不是盲等固定毫秒：机器慢一点 sleep 就不够，读到空却报绿。
// 超时不抛——下面的 check 仍要把「读到什么」打出来，保留这条走查的失败可读性。
await win
  .locator('div.fixed.inset-0')
  .filter({ hasText: /开始生成/ })
  .last()
  .waitFor({ state: 'visible' })
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
await expect.poll(() => win.locator('[data-group-toolbar="true"]').count()).toBeGreaterThan(0)
const veilGone = await win.evaluate(() => !Array.from(document.querySelectorAll('.fixed.inset-0')).some((element) => element.textContent?.includes('开始生成')))
check('取消后确认卡收掉', veilGone)

// ③ 连到组：加一个组外节点 → 从它拉线 → 组框应变成可落点（虚线 + 加深底色）
await addImage.click({ timeout: 4000 })
await expect.poll(() => win.locator('[data-node-id]').count()).toBeGreaterThanOrEqual(5)
const allIds = await win.evaluate(() =>
  Array.from(document.querySelectorAll('[data-node-id]')).map((el) => el.getAttribute('data-node-id')))
const srcId = allIds[allIds.length - 1]
console.log('  → 连线源:', srcId)
// 先「适应视图」：组框比视口还大时它的标签在视口外，截图就拍不到改动区（R13 眼见链第四问）。
const fitBtn = win.locator('[aria-label="适应视图"]').first()
if (await fitBtn.count()) { await fitBtn.click({ timeout: 4000 }).catch(() => {}); await waitForCanvasViewportSettled(win) }
await win.locator(`[data-node-id="${srcId}"]`).first().click({ timeout: 4000 })
await expect.poll(() => win.locator(`.react-flow__node[data-id="${srcId}"] .generation-canvas-react-flow__handle`).count()).toBeGreaterThan(0)
// 用**真手势**：从磁吸连接点按下 → 拖到组框空白处 → 松手。这条路走的是 React Flow 的 onConnectEnd，
// 和「点一下连接点再点目标」的 click 路是两条，必须两条都真的通（走查第一版就是漏了 pointerup 那条）。
const handle = win.locator(`.react-flow__node[data-id="${srcId}"] .generation-canvas-react-flow__handle[data-side="right"]`).last()
check('找得到连接点', await handle.count() > 0)
// 按人按的地方起线：卡外那颗「+」圈，不是 1px 测量锚点（见 _canvasHit.mjs findConnectionStartPoint）。
const hb = await findConnectionStartPoint(win, { handleSelector: `.react-flow__node[data-id="${srcId}"] .generation-canvas-react-flow__handle--source[data-side="right"]` })
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
await win.mouse.move(hb.x, hb.y)
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
}, { x: hb.x, y: hb.y })
check('连接点中心命中 React Flow 握把', hitHandle.handle?.nodeId === srcId, JSON.stringify({ box: hb, ...hitHandle }))
await win.mouse.down()
await win.mouse.move(dropPoint.x, dropPoint.y, { steps: 12 })
  await expect.poll(() => win.locator('.generation-canvas-v2__group-box').first().evaluate((element) => getComputedStyle(element).borderStyle)).toBe('dashed')

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
// 等到边数稳定在「+4」再读（默认 poll 时限）：只等「比原来多」会在第一根边出现时就读数（CI 满载时 10-07 读到 +1 误红，重跑即过）。
// 等不到也不抛，交给下面的 check 记下实得几根。
await expect.poll(() => win.locator('.generation-canvas-v2__edge-path').count()).toBeGreaterThanOrEqual(edgesBefore + 4).catch(() => {})
const edgesAfter = await win.locator('.generation-canvas-v2__edge-path').count()
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
