#!/usr/bin/env node
// 「发送前按方式核输入」真窗复现（免费：隔离资料 + 本机 APIMart 夹具，一个字节不出网、一分钱不花）。
//   pnpm build && node tests/ux/archetype-batch1-samples.walk.mjs
// 设计卡 docs/plan/2026-11-14-mode-input-check.md ★9 的反例，按创作者那一幕摆（中文浅色、英文暗色各一轮）：
//   ① MiniMax H3-Max 多模态参考，只连一段声音：↑ 置灰、提示写着要配图或视频；夹具一笔都没收到。再连一张图，↑ 亮起（正对照）。
//   ② 可灵 4.0 Flash 全能参考，连一张图、节点上存着「保留原声」（老工程 / Agent 写的）：存的值回到 auto，参数面板「声音」没有「保留原声」；
//      点 ↑，夹具收到的请求体 audio_setting 不是 origin。再连一段参考视频，「保留原声」出现（正对照）；选上它再断开视频，存的值回到 auto。
//   ③ 绕过界面直接给主进程一单（和 MCP / 旧批次一样走 tasks:run）：可灵 4.0 Flash 视频编辑没有源视频、H3-Max 只有参考音频——
//      主进程在付费闸之前拒，拒收原话按槽名说清缺什么；夹具一笔都没收到。
// 开跑前先核产物（构建戳 = 现在的源码、产物里有本修复的字面量），不在旧构建上白跑。
// 夹具对每一笔视频提交回 400（受理那一步就拒），请求体照样记下、节点马上回到可发状态，不必等出片。
// 截图：NOMI_SHOTS_OUT（绝对路径）给了就把每幕的截图另抄一份过去（证据目录用），不给只留在走查自己的产物目录。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { clickOrFail, expect, expectHidden, expectVisible, screenshotSettled } from './_assert.mjs'
import { SPEND_DIALOG, assertPaidBuildReady } from './_paidRun.mjs'
import { createRuntimeWalk, openCanvas } from './agent-runtime-walk-support.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { bringButtonIntoReach } from './_generateReach.mjs'
import { backToLibrary, collapseAgentPanel } from './_shell.mjs'
import { pickModeByName, readModeCell } from './_modeMenu.mjs'
import { require as tsxRequire } from 'tsx/cjs/api'
import { uiText } from './full-walk/invariants.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// 主进程产物（dist-electron）不压缩：拒收机读码和判定函数名原样留在产物里；修前的构建里都没有。
const BUILD_MARKERS = ['mode_input_missing', 'validateModeConstraints']
// 主进程文案按键取（不抄词典原文）；档案槽名的中文就是 desktopT 里的 slotKind 中文。
const { desktopT } = tsxRequire('../../electron/desktopStrings.ts', import.meta.url)
const DESKTOP_LOCALE = { zh: 'zh-CN', en: 'en' }
const OUT = process.env.NOMI_SHOTS_OUT && path.isAbsolute(process.env.NOMI_SHOTS_OUT) ? process.env.NOMI_SHOTS_OUT : null
if (OUT) fs.mkdirSync(OUT, { recursive: true })
const H3MAX = { modelKey: 'MiniMax-H3-Max', modelVendor: 'apimart', vendor: 'apimart', archetype: { id: 'minimax-h3-max', modeId: 'ref' } }
const KLING = { modelKey: 'kling-v4-flash', modelVendor: 'apimart', vendor: 'apimart', archetype: { id: 'kling-v4-flash', modeId: 'ref' }, audio_setting: 'origin', duration: 5 }
const ORIGIN_LABEL = { zh: '保留原声', en: 'Keep original audio' }
const ROUNDS = [{ locale: 'zh-CN', lang: 'zh', scheme: 'light' }, { locale: 'en', lang: 'en', scheme: 'dark' }]
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

assertPaidBuildReady(REPO_ROOT, { markers: BUILD_MARKERS })
const walk = await createRuntimeWalk('archetype-batch1-samples', { generationProvider: 'apimart', trustFixtureOrigin: true })
walk.fixture.setMediaBehavior(({ kind }) => (kind === 'video' ? { reject: { status: 400, json: { error: { message: 'mode-input replay fixture: recorded, not accepted' } } } } : undefined))
const scenes = []
let failure
let win

const store = (fn, arg) => win.evaluate(fn, arg)
const composerOf = (id) => win.locator(`[data-node-id="${id}"] .generation-canvas-v2-node__composer`).first()
const generateOf = (id) => composerOf(id).locator('button[data-bar-segment="generate"]').first()
const panel = () => win.locator('[data-agent-parameter-panel]').first()
const storedMeta = (id, key) => store(({ nodeId, k }) => window.__nomiCanvasStore.getState().nodes.find((node) => node.id === nodeId)?.meta?.[k] ?? null, { nodeId: id, k: key })

async function select(id) {
  await store((nodeId) => window.__nomiCanvasStore.getState().selectNode(nodeId), id)
  await expectVisible(composerOf(id), `选中 ${id} 之后它的生成框出现`, stationTimeout({ operations: 2 }))
}

async function shot(round, name) {
  const file = path.join(walk.outputDir, `${round}-${name}.png`)
  await screenshotSettled(win, { path: file })
  if (OUT) fs.copyFileSync(file, path.join(OUT, `${round}-${name}.png`))
  return file
}

/** 开参数面板，截一张、读面板文字，收起。 */
async function panelText(id, round, name) {
  await clickOrFail(composerOf(id).locator('[data-parameter-summary]').first(), `${round}：${name} 打开参数面板`)
  await expectVisible(panel(), `${round}：${name} 参数面板出现`)
  await sleep(300)
  const file = await shot(round, name)
  const text = await panel().innerText()
  await win.keyboard.press('Escape')
  await expectHidden(panel(), `${round}：${name} 参数面板收起`, stationTimeout({ operations: 1 }))
  return { text, file }
}

/** 点一次真 ↑（有确认框就点「生成」），等夹具收到那一笔。 */
async function send(id, label) {
  const before = walk.fixture.videos.length
  const button = generateOf(id)
  if (await button.isDisabled()) return { sent: false, reason: await button.locator('xpath=..').getAttribute('title').catch(() => null) }
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

function record(round, scene, facts, problems) {
  scenes.push({ round, scene, ...facts, problems })
  console.log(`${problems.length ? '✗' : '✓'} ${round} · ${scene} · ${JSON.stringify(facts).slice(0, 400)}${problems.length ? ` · ${problems.join('；')}` : ''}`)
}

/** 直接给主进程一单（tasks:run，和 MCP / 旧批次同一个口），收拒收原话。 */
async function probeMainProcess(payload) {
  return store(async (input) => {
    try { await window.nomiDesktop.tasks.run(input); return { refused: false } } catch (error) { return { refused: true, message: String(error?.message ?? error) } }
  }, payload)
}

function makeAssets(projectRoot) {
  const dir = path.join(projectRoot, 'assets', 'imported')
  fs.mkdirSync(dir, { recursive: true })
  const run = (args) => execFileSync(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', ...args], { stdio: 'pipe' })
  run(['-f', 'lavfi', '-i', 'testsrc=s=1024x1024:r=1', '-frames:v', '1', '-y', path.join(dir, 'ref.png')])
  run(['-f', 'lavfi', '-i', 'testsrc=s=1280x720:r=24:d=5', '-pix_fmt', 'yuv420p', '-y', path.join(dir, 'ref.mp4')])
  run(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-y', path.join(dir, 'voice.wav')])
}

async function addMediaNode(projectId, kind, file, x, y) {
  return store(({ k, url, px, py, name }) => {
    const state = window.__nomiCanvasStore.getState()
    const id = state.addNode({ kind: k, title: name, prompt: '', position: { x: px, y: py }, meta: k === 'image' ? { imageWidth: 1024, imageHeight: 1024 } : {} }).id
    const result = { id: `${id}-r`, type: k, url, createdAt: 1 }
    state.updateNode(id, { status: 'success', result, history: [result] })
    return id
  }, { k: kind, url: `nomi-local://asset/${projectId}/assets/imported/${file}`, px: x, py: y, name: file })
}

const connect = (s, t) => store(({ source, target }) => window.__nomiCanvasStore.getState().connectNodes(source, target, 'reference'), { source: s, target: t })
const disconnect = (s, t) => store(({ source, target }) => {
  const state = window.__nomiCanvasStore.getState()
  const edge = state.edges.find((candidate) => candidate.source === source && candidate.target === target)
  if (edge) state.disconnectEdge(edge.id)
}, { source: s, target: t })

// 可灵 4.0 Flash 的「全能参考」在方式菜单里用档案自己的名字（英文轨是 Omni reference，不是四类词典里的 Reference）。
const KLING_REF_NAME = { zh: uiText('zh-CN', 'generationCommon.modeMenu.name.reference'), en: 'Omni reference' }

async function ensureMode(id, lang, round) {
  const want = KLING_REF_NAME[lang]
  if ((await readModeCell(composerOf(id), lang)) !== want) await pickModeByName(win, composerOf(id), lang, want)
  await expect.poll(() => readModeCell(composerOf(id), lang), { message: `${round}：方式格是「${want}」`, timeout: stationTimeout({ operations: 1 }) }).toBe(want)
}

async function runRound({ locale, lang, scheme }) {
  const round = `${lang}-${scheme}`
  await win.evaluate(({ l, s }) => { localStorage.setItem('nomi-color-scheme', s); localStorage.setItem('nomi:locale:v1', l); localStorage.setItem('__nomiE2E', '1') }, { l: locale, s: scheme })
  await win.reload({ waitUntil: 'domcontentloaded' })
  if (win.url().includes('projectId')) await backToLibrary(win)
  const { projectId, projectRoot } = await walk.newProject()
  await openCanvas(win)
  await collapseAgentPanel(win)
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore), null, { timeout: stationTimeout({ operations: 2 }) })
  await expect(win.locator('html'), `${round}：界面是${scheme === 'dark' ? '暗' : '浅'}色`).toHaveAttribute('data-theme', scheme)
  makeAssets(projectRoot)
  const image = await addMediaNode(projectId, 'image', 'ref.png', -560, -160)
  const video = await addMediaNode(projectId, 'video', 'ref.mp4', -560, 160)
  const voice = await addMediaNode(projectId, 'audio', 'voice.wav', -560, 420)

  // ① H3-Max：只连声音。
  const h3 = await store(({ meta }) => window.__nomiCanvasStore.getState().addNode({ kind: 'video', title: 'H3-Max', prompt: '雨夜街头，人物回头', position: { x: 0, y: -200 }, meta }).id, { meta: H3MAX })
  await connect(voice, h3)
  await select(h3)
  await sleep(600)
  {
    const before = walk.fixture.videos.length
    const button = generateOf(h3)
    const disabled = await button.isDisabled()
    const title = await button.locator('xpath=..').getAttribute('title').catch(() => null)
    const file = await shot(round, '01-h3max-audio-only')
    const problems = []
    if (!disabled) problems.push('只连声音时 ↑ 没有置灰')
    if (!title) problems.push('置灰的 ↑ 上没有说明')
    if (walk.fixture.videos.length !== before) problems.push('夹具收到了提交')
    record(round, '01-h3max-audio-only', { disabled, title, file }, problems)
  }
  await connect(image, h3)
  await select(h3)
  await sleep(600)
  record(round, '01b-h3max-audio-plus-image', { enabled: await generateOf(h3).isEnabled() }, (await generateOf(h3).isEnabled()) ? [] : ['连上图之后 ↑ 还是灰的'])

  // ② 可灵 4.0 Flash 全能参考：一张图 + 存着「保留原声」。
  const kling = await store(({ meta }) => window.__nomiCanvasStore.getState().addNode({ kind: 'video', title: 'Kling 4.0 Flash', prompt: '人物沿街慢走，镜头跟随', position: { x: 0, y: 260 }, meta }).id, { meta: KLING })
  await connect(image, kling)
  await select(kling)
  await ensureMode(kling, lang, round)
  await sleep(600)
  {
    const stored = await storedMeta(kling, 'audio_setting')
    const { text, file } = await panelText(kling, round, '02-kling-ref-image-no-origin')
    const result = await send(kling, `${round} 可灵全能参考（一张图）`)
    const problems = []
    if (stored === 'origin') problems.push('节点上存的还是 origin')
    if (text.includes(ORIGIN_LABEL[lang])) problems.push(`面板「声音」里还有「${ORIGIN_LABEL[lang]}」`)
    if (!result.sent) problems.push(`没发出去（${result.reason ?? '—'}）`)
    else if (result.body.audio_setting === 'origin') problems.push('请求体 audio_setting = origin')
    record(round, '02-kling-ref-image-no-origin', { stored, panelHasOrigin: text.includes(ORIGIN_LABEL[lang]), wire: result.sent ? { audio_setting: result.body.audio_setting ?? '（没有）', nsfw_check: result.body.nsfw_check ?? '（没有）', keys: Object.keys(result.body).sort() } : null, file }, problems)
  }
  await connect(video, kling)
  await select(kling)
  await ensureMode(kling, lang, round)
  await sleep(600)
  {
    const { text, file } = await panelText(kling, round, '02b-kling-ref-with-video')
    await store(({ id }) => window.__nomiCanvasStore.getState().updateNode(id, { meta: { ...window.__nomiCanvasStore.getState().nodes.find((node) => node.id === id).meta, audio_setting: 'origin' } }), { id: kling })
    await sleep(400)
    const chosen = await storedMeta(kling, 'audio_setting')
    await disconnect(video, kling)
    await select(kling)
    await sleep(800)
    const after = await storedMeta(kling, 'audio_setting')
    const problems = []
    if (!text.includes(ORIGIN_LABEL[lang])) problems.push(`连了参考视频，面板里却没有「${ORIGIN_LABEL[lang]}」`)
    if (chosen !== 'origin') problems.push(`选上「保留原声」没存住（${chosen}）`)
    if (after === 'origin') problems.push('断开视频后存的还是 origin')
    record(round, '02b-kling-ref-with-video-then-disconnect', { panelHasOrigin: text.includes(ORIGIN_LABEL[lang]), chosen, afterDisconnect: after, file }, problems)
  }

  // ③ 绕过界面直接给主进程。
  for (const [name, extras, expectWord] of [
    ['03-main-kling-edit-no-video', { modelKey: 'kling-v4-flash', archetype: { id: 'kling-v4-flash', modeId: 'edit' }, projectId }, desktopT('modeInput.slotKind.source_video', {}, DESKTOP_LOCALE[lang])],
    ['03-main-h3max-audio-only', { modelKey: 'MiniMax-H3-Max', archetype: { id: 'minimax-h3-max', modeId: 'ref' }, referenceAudioUrls: ['https://assets.example.com/voice.mp3'], projectId }, desktopT('modeInput.slotKind.audio_ref', {}, DESKTOP_LOCALE[lang])],
  ]) {
    const before = walk.fixture.videos.length
    const result = await probeMainProcess({ vendor: 'apimart', request: { kind: 'image_to_video', prompt: '人物回头', extras } })
    const problems = []
    if (!result.refused) problems.push('主进程没拒')
    else if (!result.message.includes(expectWord)) problems.push(`拒收原话里没有「${expectWord}」：${result.message}`)
    if (walk.fixture.videos.length !== before) problems.push('夹具收到了提交')
    record(round, name, { message: result.message ?? null, fixtureDelta: walk.fixture.videos.length - before }, problems)
  }
}

try {
  walk.report.buildMarkers = BUILD_MARKERS
  ;({ win } = await walk.start({ first: true }))
  for (const round of ROUNDS) await runRound(round)
  walk.report.scenes = scenes
  walk.report.fixtureVideoCreates = walk.fixture.videos.length
  const red = scenes.filter((item) => item.problems.length)
  if (red.length) throw new Error(`复现没过：${red.map((item) => `${item.round}/${item.scene}：${item.problems.join('；')}`).join(' | ')}`)
  walk.report.verified = scenes.map((item) => `${item.round}/${item.scene}`)
} catch (error) {
  failure = error
  walk.report.scenes = scenes
  process.exitCode = 1
  if (win) await walk.snap('blocked').catch(() => {})
} finally {
  await walk.finish(failure)
}
