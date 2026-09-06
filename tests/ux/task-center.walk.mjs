// 任务中心 R13 走查 —— Playwright _electron 驱动真 app（隔离 userData 绕开单实例锁）。
// 用法: node tests/ux/task-center.walk.mjs
// 产出: tests/ux/shots/task-center/*.png —— 顶栏按钮三态 + 面板四种队列状态 + 画布「排队中」角标，
//        人眼判断有无溢出/挤压/文案截断/对比度塌陷。
//
// 队列状态经 window.__nomiQueueStore（仅 localStorage.__nomiE2E==='1' 暴露）用**真 store 的真 action**摆出来，
// 渲染的是真组件读真状态；「runner 会不会把状态填成这样」由 generationQueue.test.ts 那几条不变量单测把关。
import { launchNomiApp } from './_launchApp.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/task-center')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const userData = path.join(repoRoot, '.tmp', 'nomi-taskcenter-userdata')
fs.mkdirSync(userData, { recursive: true })

let n = 0
async function snap(win, name) {
  n += 1
  const tag = `${String(n).padStart(2, '0')}-${name}`
  await screenshotSettled(win, { path: path.join(shotsDir, `${tag}.png`) })
  console.log(`  · shot ${tag}`)
  // 面板开着时再裁一张只含面板的：整窗图缩太小，字看不清就等于没人眼验过（R13 眼见链）。
  const box = await win.locator('[role="dialog"][aria-label="任务"]').first().boundingBox().catch(() => null)
  if (box) {
    await screenshotSettled(win, {
      path: path.join(shotsDir, `${tag}--panel.png`),
      clip: { x: Math.max(0, box.x - 4), y: Math.max(0, box.y - 4), width: box.width + 8, height: box.height + 8 },
    })
  }
}

const { app, win } = await launchNomiApp({
  name: 'task-center',
  userDataDir: userData,
  args: ['--no-proxy-server'],
  settleMs: 0,
})

// 压掉首启 splash / 引导旅途 / 手势提示，并开 E2E 桥，然后 reload 让它们生效。
await win.evaluate(() => {
  window.localStorage.setItem('__nomiE2E', '1')
  for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
    window.localStorage.setItem(k, 'seen')
  }
})
await win.reload()
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(2200)

// 进一个项目（库页 → 新建空白项目），否则顶栏在库页不渲染。
for (const label of ['新建空白项目', '开始一个项目']) {
  const el = win.locator('button', { hasText: label }).first()
  if (await el.count()) {
    await el.click({ timeout: 4000 }).catch(() => {})
    break
  }
}
await win.waitForTimeout(2500)
await snap(win, 'project-open-idle-topbar')

const hasBridge = await win.evaluate(() => Boolean(window.__nomiQueueStore))
console.log('  → queue bridge:', hasBridge)
if (!hasBridge) {
  console.error('❌ 队列桥没挂上（顶栏 TaskCenterButton 没渲染？）——后续截图无意义，停。')
  await app.close()
  process.exit(1)
}

// 切到「生成」区：画布 store 的 E2E 桥住 CameraMoveCaptureHost（懒加载，进生成区才挂）。
// 顺带这也是用户真实所在的位置——批量生成就是从这儿发起的。
const genTab = win.locator('button', { hasText: /^生成$/ }).first()
if (await genTab.count()) await genTab.click({ timeout: 5000 }).catch(() => {})
await win.waitForTimeout(2500)
await snap(win, 'generation-area-empty-canvas')

// 用真 UI 加 8 个图片节点（画布左缘工具条）。不走 store 后门——画布 store 的 E2E 桥
// 只在运镜捕获时才挂，且真点按钮本来就更忠实。点法收口在 _canvasRail（结构锚点，不认 i18n 文案）。
try {
  for (let i = 0; i < 8; i += 1) {
    await addCanvasNodeFromRail(win, 'image', { timeout: 4000 })
    await win.waitForTimeout(260)
  }
} catch (error) {
  console.error('❌ 画布左缘加不出图片节点——停。', error?.message || error)
  await app.close()
  process.exit(1)
}
await win.waitForTimeout(900)

// 节点 id 从 DOM 上读（真实渲染出来的那些），不依赖任何 store 后门。
const nodeIds = await win.evaluate(() =>
  Array.from(document.querySelectorAll('[data-node-id]'))
    .map((el) => el.getAttribute('data-node-id'))
    .filter(Boolean),
)
console.log('  → nodes:', nodeIds.length)
if (nodeIds.length < 8) {
  console.error('❌ 节点没加够（读到', nodeIds.length, '个）——后续状态摆不出来，停。')
  await app.close()
  process.exit(1)
}
await snap(win, 'canvas-with-nodes')

// ① 批量跑到一半：前 2 个跑着、中间 2 个成/败、剩下排队（含第 2 波）。
await win.evaluate((ids) => {
  const queue = window.__nomiQueueStore
  queue.setState({ entries: [], batches: {} })
  const batchId = queue.getState().enqueueBatch([ids.slice(0, 6), ids.slice(6)])
  queue.getState().markRunning(batchId, ids[0])
  queue.getState().markRunning(batchId, ids[1])
  queue.getState().markRunning(batchId, ids[2])
  queue.getState().markSettled(batchId, ids[2], 'success')
  queue.getState().markRunning(batchId, ids[3])
  queue.getState().markSettled(batchId, ids[3], 'error', { error: '内容审核未通过 · 换个说法或换模型' })
}, nodeIds)
await win.waitForTimeout(700)
await snap(win, 'topbar-busy-badge')
// 顶栏右栏裁近看：任务按钮必须和同栏设置/模型接入/导出一个解剖（30px 高、15/1.8 图标）。
{
  const bar = await win.locator('.nomi-appbar__right').first().boundingBox().catch(() => null)
  if (bar) {
    await screenshotSettled(win, {
      path: path.join(shotsDir, '04b-topbar-right-zoom.png'),
      clip: { x: Math.max(0, bar.x - 8), y: Math.max(0, bar.y - 8), width: bar.width + 16, height: bar.height + 16 },
    })
    console.log('  · shot 04b-topbar-right-zoom')
  }
  // 直接定位角标本身再往外扩一圈——按 [data-node-id] 裁会撞上小地图等浮层（走查踩过）。
  // 挑一个没被左侧导航列/底部时间轴压住的角标（默认节点位置会有几个正好落在浮层底下）。
  const badges = await win.locator('[aria-label="排队中"]').all()
  let badge = null
  for (const candidate of badges) {
    const box = await candidate.boundingBox().catch(() => null)
    // y>90 躲开顶栏、y<620 躲开底部时间轴；有的节点默认位置会滑到视口外，跳过它们。
    if (box && box.y > 90 && box.y < 620) { badge = box; break }
  }
  if (badge) {
    await screenshotSettled(win, {
      path: path.join(shotsDir, '04c-canvas-queued-node.png'),
      clip: { x: Math.max(0, badge.x - 14), y: Math.max(0, badge.y - 14), width: 300, height: 190 },
    })
    console.log('  · shot 04c-canvas-queued-node')
  } else {
    console.error('  ⚠️ 画布上没找到「排队中」角标')
  }
}

// 打开面板。
await win.locator('[aria-label="任务"]').first().click({ timeout: 5000 })
await win.waitForTimeout(700)
await snap(win, 'panel-mid-batch')

// 画布上的「排队中」角标（第 2 波那些节点）。
const queuedBadges = await win.locator('text=排队中').count()
console.log('  → 画布/面板「排队中」出现次数:', queuedBadges)

// 失败行必须真的是红的（截图里靠肉眼分辨深浅不可靠，直接读 computed color 对账 --workbench-danger）。
const failColor = await win.evaluate(() => {
  const panel = document.querySelector('[role="dialog"][aria-label="任务"]')
  const line = Array.from(panel?.querySelectorAll('div') ?? []).find((el) =>
    el.textContent?.trim().startsWith('内容审核未通过'),
  )
  const danger = getComputedStyle(document.documentElement).getPropertyValue('--workbench-danger').trim()
  return { text: line ? getComputedStyle(line).color : null, dangerToken: danger }
})
console.log('  → 失败行颜色:', JSON.stringify(failColor))

// ② 点「取消排队的 N 个」。
const cancelAll = win.locator('button', { hasText: /取消排队的/ }).first()
if (await cancelAll.count()) {
  await cancelAll.click({ timeout: 4000 })
  await win.waitForTimeout(700)
  await snap(win, 'panel-after-cancel-queued')
  const remainingQueued = await win.evaluate(
    () => window.__nomiQueueStore.getState().entries.filter((e) => e.state === 'queued').length,
  )
  console.log('  → 取消后仍排队:', remainingQueued, '(应为 0)')
} else {
  console.error('  ⚠️ 没找到「取消排队的 N 个」按钮')
}

// ③ 刹车横幅。
await win.evaluate((ids) => {
  const queue = window.__nomiQueueStore
  queue.setState({ entries: [], batches: {} })
  const batchId = queue.getState().enqueueBatch([ids])
  for (const id of ids.slice(0, 3)) {
    queue.getState().markRunning(batchId, id)
    queue.getState().markSettled(batchId, id, 'error', { error: '上游模型不可用' })
  }
}, nodeIds)
await win.waitForTimeout(700)
await snap(win, 'panel-brake-banner')

// ④ 全部跑完 + 有失败（顶栏按钮转提醒色）。
await win.evaluate((ids) => {
  const queue = window.__nomiQueueStore
  queue.setState({ entries: [], batches: {} })
  const batchId = queue.getState().enqueueBatch([ids])
  ids.forEach((id, index) => {
    queue.getState().markRunning(batchId, id)
    queue.getState().markSettled(batchId, id, index % 4 === 3 ? 'error' : 'success', {
      ...(index % 4 === 3 ? { error: '模型任务执行失败' } : {}),
      countsTowardBrake: false,
    })
  })
  queue.getState().finishBatch(batchId)
}, nodeIds)
await win.waitForTimeout(700)
await snap(win, 'panel-all-done-with-failures')

// ⑤ 空态。
await win.evaluate(() => window.__nomiQueueStore.setState({ entries: [], batches: {} }))
await win.waitForTimeout(600)
await snap(win, 'panel-empty')

// ⑥ 翻到亮色再看一眼（前面几步跑在夜里自动暗的暗色下，亮色的对比度/红色可读性得单独验）。
await win.evaluate(() => window.localStorage.setItem('nomi-color-scheme', 'light'))
await win.reload()
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(2500)
await win.evaluate((ids) => {
  const queue = window.__nomiQueueStore
  if (!queue) return
  queue.setState({ entries: [], batches: {} })
  const batchId = queue.getState().enqueueBatch([ids.slice(0, 5), ids.slice(5)])
  queue.getState().markRunning(batchId, ids[0])
  queue.getState().markRunning(batchId, ids[1])
  queue.getState().markSettled(batchId, ids[1], 'error', { error: '内容审核未通过 · 换个说法或换模型' })
}, nodeIds)
await win.waitForTimeout(600)
const darkBtn = win.locator('[aria-label="任务"]').first()
if (await darkBtn.count()) {
  await darkBtn.click({ timeout: 5000 }).catch(() => {})
  await win.waitForTimeout(700)
}
await snap(win, 'panel-light-mode')

// 几何对账：面板不该越出视口，行文字不该横向溢出。
const geometry = await win.evaluate(() => {
  const panel = document.querySelector('[role="dialog"][aria-label="任务"]')
  if (!panel) return { found: false }
  const rect = panel.getBoundingClientRect()
  return {
    found: true,
    withinViewport: rect.right <= window.innerWidth + 1 && rect.bottom <= window.innerHeight + 1 && rect.top >= 0,
    overflowX: panel.scrollWidth > panel.clientWidth + 1,
    rect: { top: Math.round(rect.top), right: Math.round(rect.right), width: Math.round(rect.width), height: Math.round(rect.height) },
  }
})
console.log('  → 面板几何:', JSON.stringify(geometry))

await app.close()
console.log(`\n✅ 走查截图已出：${shotsDir}（下一步必须自己 Read 每张图人眼判断）`)
