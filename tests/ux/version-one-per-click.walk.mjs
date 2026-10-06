#!/usr/bin/env node
// 走查：节点 ↑ 按一次只出一版（2026-10-06 用户拍板删掉「每次生成几个」之后的守门）。
//
// 守的那件事：生成浮框里的 ×N 下拉删了以后，节点上按一次 ↑，供应商**恰收一次**媒体请求、节点上多**一版**，
// 编号接着涨；再按一次，再多一版。不是零（按了没反应），也不是 N（残留的连发把钱花 N 遍）。
// 验收线（V-1050）只核过代码，这里用回环供应商在真 App 里数请求。
//
// 零付费：节点的模型就是夹具那家回环供应商（目录里 baseUrlHint 指向 agent-runtime-fixture.mjs 起的真 HTTP 回环服务），
// 请求不出本机。窗口不接宿主鼠标；IPC、落盘全是真的。
// 不用内置 apimart 档案（paidGenerationRoute）：画布直生那条路按目录里的 baseUrlHint 发请求，不认夹具的 loopback 口子，
// 会打到真实域名（夹具 key 是假的，回 401、不花钱，但出站本身就不该有）——已报协调会话。
//
// 用法：pnpm run build && node tests/ux/version-one-per-click.walk.mjs [zh-CN|en]
import { DEFAULT_TIMEOUT_MS, expect } from './_assert.mjs'
import { findNodeHitPoint } from './_canvasHit.mjs'
import { FIXTURE_IMAGE_MODEL, FIXTURE_VENDOR } from './agent-runtime-fixture.mjs'
import { launchCoreSmoke } from './core-smoke/fixture.mjs'

const LOCALE = process.argv[2] === 'en' ? 'en' : 'zh-CN'
const NODE_ID = 'one-per-click'
const base = { categoryId: 'shots', references: [], runs: [] }

const smoke = await launchCoreSmoke({
  name: 'version-one-per-click',
  locale: LOCALE,
  emptyViewport: { width: 1280, height: 800 },
  needs: ['loopbackProvider'],
  seed: () => ({
    nodes: [{
      ...base, id: NODE_ID, kind: 'image', title: 'one per click', prompt: '一个悬浮的六棱柱，柔和的演播室灯光',
      position: { x: 160, y: 160 }, status: 'idle', history: [],
      meta: { modelVendor: FIXTURE_VENDOR, modelKey: FIXTURE_IMAGE_MODEL },
    }, {
      // 远处一张空卡：只为让「适应视图」缩到能同时看见节点和它下面的生成浮框（单张卡会被放大到占满画布）。
      ...base, id: 'far-away', kind: 'image', title: 'far away', prompt: '', position: { x: 1800, y: 1400 }, status: 'idle', history: [],
    }],
    edges: [], groups: [],
  }),
})
const fixture = smoke.needs.loopbackProvider
const nodeSelector = `.react-flow__node[data-id="${NODE_ID}"]`

/** 读盘上的节点（落盘才算数，不读 store）。 */
async function diskNode(win) {
  const project = await win.evaluate(async (projectId) => window.nomiDesktop?.projects?.read?.(projectId) ?? null, smoke.project.projectId).catch(() => null)
  const fromBridge = project?.payload?.generationCanvas?.nodes?.find((node) => node.id === NODE_ID)
  if (fromBridge) return fromBridge
  const fs = await import('node:fs')
  const path = await import('node:path')
  const record = JSON.parse(fs.readFileSync(path.join(smoke.project.projectRoot, '.nomi', 'project.json'), 'utf8'))
  return record.payload.generationCanvas.nodes.find((node) => node.id === NODE_ID)
}

/** 一次 ↑：如果弹了花费确认卡就点确认（用户自己点的单张按设计可以不弹）。 */
async function pressGenerateOnce(win) {
  const hit = await findNodeHitPoint(win, { nodeSelector })
  expect(hit, '节点上要找得到一处点得到的地方').not.toBeNull()
  await win.mouse.move(hit.x, hit.y)
  await win.mouse.down()
  await win.waitForTimeout(60)
  await win.mouse.up()
  // 截一帧：生成浮框是延迟挂载（useDeferredValue），窗口不接宿主输入时 Chromium 不主动出帧，不截就一直挂不上。
  await win.screenshot()
  const send = win.locator('button[data-bar-segment="generate"]').first()
  await expect(send, '选中节点后生成浮框里有 ↑').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await expect(send, '↑ 可以按').toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS })
  await send.click()
  const confirm = win.locator('[data-spend-confirm-action="confirm"]').first()
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
}

let failure = null
try {
  const win = await smoke.openProject()
  await win.locator(nodeSelector).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  // 生成浮框里不再有「每次生成几个」那一段。
  expect(await win.locator('[data-bar-segment="variants"]').count(), '「每次生成几个」下拉已删').toBe(0)
  expect(fixture.images, '开局一次媒体请求都没有').toHaveLength(0)

  await pressGenerateOnce(win)
  await expect.poll(async () => (await diskNode(win))?.status, { timeout: DEFAULT_TIMEOUT_MS, message: '第一次 ↑ 之后节点要真的出图' }).toBe('success')
  await win.waitForTimeout(1_500) // 「恰一次」不是「至少一次」：连发残留会在这段时间里现形。
  expect(fixture.images, '按一次 ↑ = 供应商恰收一次媒体请求').toHaveLength(1)
  let node = await diskNode(win)
  expect(node.history?.map((entry) => entry.versionNo), '节点上恰好一版，第 1 版').toEqual([1])

  await pressGenerateOnce(win)
  await expect.poll(async () => (await diskNode(win))?.history?.length, { timeout: DEFAULT_TIMEOUT_MS, message: '第二次 ↑ 之后节点多一版' }).toBe(2)
  await win.waitForTimeout(1_500)
  expect(fixture.images, '再按一次 ↑ = 再恰收一次（累计 2）').toHaveLength(2)
  node = await diskNode(win)
  expect(node.history?.map((entry) => entry.versionNo), '新的一版接着编号、最新在前').toEqual([2, 1])
  expect(node.resultVersionMax, '节点记着出过的最大号').toBe(2)
  console.log(`[version-one-per-click] ${LOCALE} 通过：两次 ↑ → 媒体请求 ${fixture.images.length} 次，版本 ${node.history.map((entry) => entry.versionNo).join(',')}`)
} catch (error) {
  failure = error
} finally {
  await smoke.close()
}
if (failure) {
  console.error(failure)
  process.exitCode = 1
}
