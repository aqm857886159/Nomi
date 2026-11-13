#!/usr/bin/env node
// 「这个方式认哪些参数」真窗复现（免费：隔离资料 + 本机 APIMart 夹具，一个字节不出网、一分钱不花）。
//   pnpm build && node tests/ux/mode-params-first-frame.walk.mjs
// 创作者那一幕（设计卡 docs/plan/2026-11-12-mode-params-owner.md 第 8 格）：Wan 3.0 视频节点先用文生选了 9:16，
// 再连一张首帧图——方式现算成首帧，首帧方式不收比例，面板上也没有比例。修前旧的 size 跟着请求发出去；修后不发。
// 删掉首帧图回到文生，9:16 还在（节点上存的值一个不动，主人只在发送时读）。
// 三幕各点一次真 ↑，抓夹具真收到的那一笔请求体：
//   ① 文生 + 9:16：请求体 size = 9:16；
//   ② 连首帧图：请求体没有 size、图走 image_with_roles（first_frame）、generation_type = frame；节点上的 size 还是 9:16；
//   ③ 断开首帧图：请求体 size = 9:16。
// 开跑前先核产物（构建戳 = 现在的源码、产物里有本修复的字面量），不在旧构建上白跑。
// 夹具对每一笔视频提交回 400（受理那一步就拒），请求体照样记下、节点马上回到可发状态，不必等出片。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { clickOrFail, expectVisible } from './_assert.mjs'
import { SPEND_DIALOG, assertPaidBuildReady } from './_paidRun.mjs'
import { createRuntimeWalk, openCanvas } from './agent-runtime-walk-support.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { bringButtonIntoReach } from './_generateReach.mjs'
import { collapseAgentPanel } from './_shell.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// 本修复会原样进主进程产物的字面量：主进程产物（dist-electron）不压缩，主人的函数名原样留在 catalog/taskParams.js 里；
// 修前的构建里没有它（这个主人是本修复新建的）。渲染层产物压缩过，不拿它当标记。
const BUILD_MARKERS = ['effectiveModeParams']
const SIZE = '9:16'
const WAN30 = { modelKey: 'wan3.0-video', modelVendor: 'apimart', vendor: 'apimart', archetype: { id: 'wan-3.0-apimart' }, size: SIZE, resolution: '480P', duration: 2, audio: false }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

assertPaidBuildReady(REPO_ROOT, { markers: BUILD_MARKERS })
const walk = await createRuntimeWalk('mode-params-first-frame', { generationProvider: 'apimart', trustFixtureOrigin: true })
walk.fixture.setMediaBehavior(({ kind }) => (kind === 'video' ? { reject: { status: 400, json: { error: { message: 'mode-params replay fixture: recorded, not accepted' } } } } : undefined))
const scenes = []
let failure
let win

const store = (fn, arg) => win.evaluate(fn, arg)
const composerOf = (id) => win.locator(`[data-node-id="${id}"] .generation-canvas-v2-node__composer`).first()
const storedSize = (id) => store((nodeId) => window.__nomiCanvasStore.getState().nodes.find((node) => node.id === nodeId)?.meta?.size ?? null, id)

async function select(id) {
  await store((nodeId) => window.__nomiCanvasStore.getState().selectNode(nodeId), id)
  await expectVisible(composerOf(id), `选中 ${id} 之后它的生成框出现`, stationTimeout({ operations: 2 }))
}

async function send(id, label) {
  const before = walk.fixture.videos.length
  const button = composerOf(id).locator('button[data-bar-segment="generate"]').first()
  if (await button.isDisabled()) return { sent: false, reason: await button.getAttribute('title').catch(() => null) }
  await bringButtonIntoReach(win, button, `${label} 的 ↑`)
  await clickOrFail(button, `${label} 的 ↑`, { noWaitAfter: true })
  const dialog = win.locator(SPEND_DIALOG)
  if (await dialog.first().waitFor({ state: 'visible', timeout: stationTimeout({ operations: 1 }) }).then(() => true).catch(() => false)) {
    await clickOrFail(dialog.locator('[data-spend-confirm-action="confirm"]'), '确认框「生成」', { noWaitAfter: true })
  }
  const deadline = Date.now() + stationTimeout({ operations: 3 })
  while (walk.fixture.videos.length === before && Date.now() < deadline) await sleep(300)
  if (walk.fixture.videos.length === before) return { sent: false, reason: '点了 ↑，夹具没收到提交' }
  const body = walk.fixture.videos.at(-1)?.body ?? {}
  const settle = Date.now() + stationTimeout({ operations: 2 })
  while (Date.now() < settle && !(await button.isEnabled().catch(() => false))) await sleep(300)
  return { sent: true, body }
}

/** 一幕：点 ↑、读夹具收到的请求体、按这一幕的判据对账。 */
async function scene(label, id, judge) {
  await sleep(400)
  await walk.snap(label)
  const result = await send(id, label)
  const stored = await storedSize(id)
  const problems = result.sent ? judge(result.body, stored) : [`没发出去（${result.reason ?? '—'}）`]
  const wire = result.sent ? { model: result.body.model ?? null, size: result.body.size ?? null, hasSize: Object.hasOwn(result.body, 'size'), generation_type: result.body.generation_type ?? null, roles: Array.isArray(result.body.image_with_roles) ? result.body.image_with_roles.map((item) => item?.role ?? null) : [], keys: Object.keys(result.body).sort() } : null
  scenes.push({ scene: label, storedSize: stored, wire, problems })
  console.log(`${problems.length ? '✗' : '✓'} ${label} · 节点存的 size ${stored} · 请求体 ${wire ? JSON.stringify({ size: wire.hasSize ? wire.size : '（没有）', generation_type: wire.generation_type, roles: wire.roles }) : '没发出'}${problems.length ? ` · ${problems.join('；')}` : ''}`)
}

function securityAgent() {
  try { return execFileSync('pgrep', ['-x', 'SecurityAgent'], { encoding: 'utf8' }).trim() || 'none' } catch { return 'none' }
}

try {
  walk.report.buildMarkers = BUILD_MARKERS
  walk.report.securityAgentBefore = securityAgent()
  ;({ win } = await walk.start({ first: true }))
  await win.evaluate(() => window.localStorage.setItem('__nomiE2E', '1'))
  await win.reload({ waitUntil: 'domcontentloaded' })
  const { projectId, projectRoot } = await walk.newProject()
  await openCanvas(win)
  await collapseAgentPanel(win)
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore), null, { timeout: stationTimeout({ operations: 2 }) })

  const assetDir = path.join(projectRoot, 'assets', 'imported')
  fs.mkdirSync(assetDir, { recursive: true })
  execFileSync(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=s=832x480:r=1', '-frames:v', '1', '-y', path.join(assetDir, 'first.png')], { stdio: 'pipe' })
  const frame = await store(({ url }) => {
    const state = window.__nomiCanvasStore.getState()
    const id = state.addNode({ kind: 'image', title: 'first.png', prompt: '', position: { x: -520, y: 0 }, meta: { imageWidth: 832, imageHeight: 480 } }).id
    const result = { id: 'first-r', type: 'image', url, createdAt: 1 }
    state.updateNode(id, { status: 'success', result, history: [result] })
    return id
  }, { url: `nomi-local://asset/${projectId}/assets/imported/first.png` })
  const v = await store(({ meta }) => window.__nomiCanvasStore.getState().addNode({ kind: 'video', title: '方式参数复现', prompt: '海边清晨，镜头缓慢推近', position: { x: 0, y: 0 }, meta }).id, { meta: WAN30 })
  await select(v)

  await scene('01-t2v-size-9x16', v, (body) => (body.size === SIZE ? [] : [`文生请求体 size 是 ${JSON.stringify(body.size)}，应是 ${SIZE}`]))

  await store(({ s, t }) => window.__nomiCanvasStore.getState().connectNodes(s, t, 'first_frame'), { s: frame, t: v })
  await select(v)
  await scene('02-first-frame-connected', v, (body, stored) => [
    ...(Object.hasOwn(body, 'size') ? [`首帧请求体还带着 size=${JSON.stringify(body.size)}（首帧方式不收比例）`] : []),
    ...(body.generation_type === 'frame' ? [] : [`generation_type 是 ${JSON.stringify(body.generation_type)}，应是 frame`]),
    ...(Array.isArray(body.image_with_roles) && body.image_with_roles.map((item) => item?.role).join() === 'first_frame' ? [] : [`image_with_roles 不是一张 first_frame：${JSON.stringify(body.image_with_roles)}`]),
    ...(stored === SIZE ? [] : [`节点上存的 size 变成了 ${JSON.stringify(stored)}（主人不许写回）`]),
  ])

  await store(({ s, t }) => {
    const state = window.__nomiCanvasStore.getState()
    const edge = state.edges.find((candidate) => candidate.source === s && candidate.target === t)
    if (edge) state.disconnectEdge(edge.id)
  }, { s: frame, t: v })
  await select(v)
  await scene('03-back-to-t2v', v, (body) => (body.size === SIZE ? [] : [`回到文生后请求体 size 是 ${JSON.stringify(body.size)}，应还是 ${SIZE}`]))

  walk.report.scenes = scenes
  walk.report.fixtureVideoCreates = walk.fixture.videos.length
  const red = scenes.filter((item) => item.problems.length)
  if (red.length) throw new Error(`复现没过：${red.map((item) => `${item.scene}：${item.problems.join('；')}`).join(' | ')}`)
  walk.report.verified = scenes.map((item) => item.scene)
} catch (error) {
  failure = error
  walk.report.scenes = scenes
  process.exitCode = 1
} finally {
  walk.report.securityAgentAfter = securityAgent()
  console.log(`SecurityAgent 前 ${walk.report.securityAgentBefore} / 后 ${walk.report.securityAgentAfter}`)
  await walk.finish(failure)
}
