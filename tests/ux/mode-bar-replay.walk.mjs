#!/usr/bin/env node
// 方式格真实场景复现（免费：隔离资料 + 本机 APIMart 夹具，一个字节不出网、一分钱不花）。
//   node tests/ux/mode-bar-replay.walk.mjs
// 照用户 2026-11-12 那几幕在真 Electron 里走一遍，每幕点真 ↑，抓夹具真收到的那一笔请求体，和方式格显示的、参考行标为在用的对账：
//   ① 空视频节点：方式格写「文生视频」，能直接发，请求体里没有图；
//   ② 连 1 张图；③ 手选首尾帧（2 张）后连到第 3 张；④ 删回 2 张、删光；
//   ⑤ 从 Seedance 换到可灵 4.0、连着 3 张图；⑥ 老项目（旧版存下的「首尾帧」但没有输入 / 带旧的按槽键）关掉重开：
//      方式格按输入现算、能发，打开这一下不改写存盘文件。
// 每一幕的判法只有一条：请求体里的图（按夹具上传记录认回文件名）= 参考行标为在用的图；方式格的名字决定请求体的形状
// （文生 = 没有图；首尾帧 = 恰好首帧、尾帧两张）。
// 布场景的手势（加图片节点、连线 / 断线、选中）经画布 store 的写口——和拖线是同一个写口；方式格、换模型、↑、确认框都点真界面。
// 夹具对每一笔视频提交回 400（受理那一步就拒），请求体照样记下、节点马上回到可发状态，不必等出片。
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { clickOrFail, expect, expectVisible } from './_assert.mjs'
import { SPEND_DIALOG } from './_paidRun.mjs'
import { createRuntimeWalk, openCanvas } from './agent-runtime-walk-support.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { fileMapper, pageReadComposer, readComposerReferences } from './_composerReferenceRow.mjs'
import { uiText } from './full-walk/invariants.mjs'
import { bringButtonIntoReach } from './_generateReach.mjs'
import { collapseAgentPanel } from './_shell.mjs'

const LOCALE = 'zh-CN'
const MODE = (kind) => uiText(LOCALE, `generationCommon.modeMenu.name.${kind}`)
const FILES = ['a.png', 'b.png', 'c.png', 'old-first.png', 'old-last.png']
const SEEDANCE = { modelKey: 'doubao-seedance-2.0', modelVendor: 'apimart', vendor: 'apimart', archetype: { id: 'seedance-2-apimart', modeId: 't2v', variantId: 'fast' }, duration: 4, resolution: '480p', generate_audio: false }
const MEDIA_NOT_IMAGE = /\.(mp4|mov|webm|mp3|wav|m4a)(\?|$)/i
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const walk = await createRuntimeWalk('mode-bar-replay', { generationProvider: 'apimart', trustFixtureOrigin: true })
walk.fixture.setMediaBehavior(({ kind }) => (kind === 'video' ? { reject: { status: 400, json: { error: { message: 'mode-bar replay fixture: recorded, not accepted' } } } } : undefined))
const scenes = []
let failure
let win
let projectId
let projectRoot
let urlOf
let fileOf

const store = (fn, arg) => win.evaluate(fn, arg)
const composerOf = (id) => win.locator(`[data-node-id="${id}"] .generation-canvas-v2-node__composer`).first()
const modeTrigger = (id) => composerOf(id).locator(`[data-node-composer-footer] button[aria-label="${uiText(LOCALE, 'generationCommon.modeMenu.heading')}"]`)

async function select(id) {
  await store((nodeId) => window.__nomiCanvasStore.getState().selectNode(nodeId), id)
  await expectVisible(composerOf(id), `选中 ${id} 之后它的生成框出现`, stationTimeout({ operations: 2 }))
}
const connect = (source, target) => store(({ s, t }) => window.__nomiCanvasStore.getState().connectNodes(s, t, 'reference'), { s: source, t: target })
const disconnect = (source, target) => store(({ s, t }) => {
  const state = window.__nomiCanvasStore.getState()
  const edge = state.edges.find((candidate) => candidate.source === s && candidate.target === t)
  if (edge) state.disconnectEdge(edge.id)
}, { s: source, t: target })

async function modeCellText(id) {
  const trigger = modeTrigger(id)
  return (await trigger.count()) ? ((await trigger.first().textContent()) ?? '').trim() : null
}

async function shownReferences(id) {
  const snapshot = readComposerReferences(await win.evaluate(pageReadComposer, id))
  const inUse = [...snapshot.slots.map((slot) => ({ key: slot.key, files: slot.srcs.map(fileOf) })), ...snapshot.arrays.map((array) => ({ key: 'array', files: array.srcs.map(fileOf) }))]
  return { inUse, inUseFiles: inUse.flatMap((cell) => cell.files), unused: snapshot.unused.flatMap((cell) => cell.srcs.map(fileOf)) }
}

async function pickMode(id, kind) {
  await bringButtonIntoReach(win, modeTrigger(id).first(), '底栏方式格')
  await clickOrFail(modeTrigger(id).first(), '底栏方式格')
  // 真菜单里每行的名字、有没有图标（2026-11-12 首跑抓到 APIMart Seedance 2.0 两行同叫「图生视频」、两行没图标）。
  await win.locator('[data-nomi-select-dropdown] [role="option"]:visible').first().waitFor({ state: 'visible' })
  const rows = await win.evaluate(() => [...document.querySelectorAll('[data-nomi-select-dropdown] [role="option"]')].filter((el) => el.getBoundingClientRect().width > 0).map((el) => ({
    name: el.querySelector('[data-nomi-select-option-label]')?.textContent?.trim() ?? '',
    icon: Boolean(el.querySelector('svg.tabler-icon:not(.tabler-icon-check)')),
  })))
  walk.report.modeMenuRows = rows
  const names = rows.map((row) => row.name)
  if (new Set(names).size !== names.length || rows.some((row) => !row.icon)) throw new Error(`方式菜单有同名或没图标的行：${JSON.stringify(rows)}`)
  console.log(`  方式菜单：${rows.map((row) => `${row.name}${row.icon ? '' : '（无图标）'}`).join(' / ')}`)
  const option = win.locator('[data-nomi-select-dropdown] [role="option"]:visible').filter({ has: win.locator('[data-nomi-select-option-label]', { hasText: new RegExp(`^${MODE(kind)}$`) }) }).first()
  await clickOrFail(option, `方式菜单「${MODE(kind)}」`)
}

async function pickModel(id, label) {
  const segment = composerOf(id).locator('[data-bar-segment="model-params"]')
  await bringButtonIntoReach(win, segment.locator('button').first(), '底栏模型格')
  await clickOrFail(segment.locator('button').first(), '底栏模型格')
  await clickOrFail(win.locator('[data-nomi-select-dropdown] [role="option"]:visible').filter({ hasText: label }).first(), `模型菜单「${label}」`)
}

/** 夹具收到的那一笔：请求体里每个图片地址按上传记录认回文件名；首尾帧按字段名 / 角色认。 */
function wireOf(record) {
  const body = record?.body ?? {}
  const byUpload = new Map(walk.fixture.uploads.map((upload) => [upload.uploadUrl, (upload.uploadFileNames ?? [])[0] ?? null]))
  const urls = urlsIn(body).filter((url) => !MEDIA_NOT_IMAGE.test(url))
  const files = urls.map((url) => byUpload.get(url) ?? fileOf(url) ?? `other:${url.slice(0, 48)}`)
  const roles = Array.isArray(body.image_with_roles) ? body.image_with_roles.map((item) => item?.role ?? null) : []
  const imageKeys = Object.keys(body).filter((key) => /image/i.test(key))
  return { model: body.model ?? null, files, roles, imageKeys }
}

async function send(id, label) {
  const before = walk.fixture.videos.length
  const button = composerOf(id).locator('button[data-bar-segment="generate"]').first()
  const disabledReason = await button.getAttribute('title').catch(() => null)
  if (await button.isDisabled()) return { sent: false, disabledReason }
  await bringButtonIntoReach(win, button, `${label} 的 ↑`)
  await clickOrFail(button, `${label} 的 ↑`, { noWaitAfter: true })
  const dialog = win.locator(SPEND_DIALOG)
  if (await dialog.first().waitFor({ state: 'visible', timeout: stationTimeout({ operations: 1 }) }).then(() => true).catch(() => false)) {
    await clickOrFail(dialog.locator('[data-spend-confirm-action="confirm"]'), '确认框「生成」', { noWaitAfter: true })
  }
  const deadline = Date.now() + stationTimeout({ operations: 3 })
  while (walk.fixture.videos.length === before && Date.now() < deadline) await sleep(300)
  if (walk.fixture.videos.length === before) return { sent: false, disabledReason: '点了 ↑，夹具没收到提交' }
  const wire = wireOf(walk.fixture.videos.at(-1))
  // 夹具拒了这一笔：等节点离开「生成中」，下一幕才点得动 ↑。
  const settle = Date.now() + stationTimeout({ operations: 2 })
  while (Date.now() < settle && !(await button.isEnabled().catch(() => false))) await sleep(300)
  return { sent: true, wire }
}

/** 一幕：读方式格、读参考行、点 ↑、对账。expectMode = 用户那一刻该看到的名字（null = 只对账不预设）。 */
async function scene(label, id, { expectMode, expectSent = true }) {
  await sleep(400)
  const cell = await modeCellText(id)
  const shown = await shownReferences(id)
  await walk.snap(label)
  const result = await send(id, label)
  const problems = []
  if (expectMode && cell !== MODE(expectMode)) problems.push(`方式格写「${cell}」，应是「${MODE(expectMode)}」`)
  if (result.sent !== expectSent) problems.push(expectSent ? `没发出去（${result.disabledReason ?? '—'}）` : '不该发出却发了')
  if (result.sent) {
    const sentFiles = [...result.wire.files].sort().join(',')
    if (sentFiles !== [...shown.inUseFiles].sort().join(',')) problems.push(`请求体里的图 [${result.wire.files}] ≠ 参考行标为在用的 [${shown.inUseFiles}]`)
    if (cell === MODE('text') && result.wire.files.length) problems.push('方式格是文生视频，请求体却带了图')
    if (cell === MODE('firstLast')) {
      const firstLastShape = (result.wire.roles.join() === 'first_frame,last_frame') || (result.wire.imageKeys.includes('first_frame_image') && result.wire.imageKeys.includes('last_frame_image'))
      if (!firstLastShape || result.wire.files.length !== 2) problems.push(`方式格是首尾帧，请求体形状是 roles=[${result.wire.roles}] keys=[${result.wire.imageKeys}]`)
    }
    if (shown.unused.some((file) => result.wire.files.includes(file))) problems.push(`淡显未用到的 [${shown.unused}] 进了请求体`)
  }
  const record = { scene: label, modeCell: cell, shownInUse: shown.inUse, shownUnused: shown.unused, sent: result.sent, wire: result.wire ?? null, disabledReason: result.disabledReason ?? null, problems }
  scenes.push(record)
  console.log(`${problems.length ? '✗' : '✓'} ${label} · 方式格「${cell}」· 在用 [${shown.inUseFiles}] · 发出 ${result.sent ? `[${result.wire.files}] roles=[${result.wire.roles}] keys=[${result.wire.imageKeys}]` : '否'}${problems.length ? ` · ${problems.join('；')}` : ''}`)
  return record
}

function urlsIn(value, out = []) {
  if (typeof value === 'string') { if (/^(https?:|data:|nomi-local:|file:)/i.test(value)) out.push(value) }
  else if (Array.isArray(value)) value.forEach((item) => urlsIn(item, out))
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => urlsIn(item, out))
  return out
}

function projectFiles(root) {
  const out = []
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { if (entry.name !== 'assets') visit(full) }
      else if (entry.name.endsWith('.json')) out.push(full)
    }
  }
  visit(root)
  return out
}
/** 两份 JSON 哪些路径不一样（数组按下标；深到叶子）。 */
function jsonDiff(a, b, at = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return []
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return [at || '(root)']
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].flatMap((key) => jsonDiff(a[key], b[key], at ? `${at}.${key}` : key))
}
const hashOf = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

function securityAgent() {
  try { return execFileSync('pgrep', ['-x', 'SecurityAgent'], { encoding: 'utf8' }).trim() || 'none' } catch { return 'none' }
}

try {
  walk.report.securityAgentBefore = securityAgent()
  ;({ win } = await walk.start({ first: true }))
  await win.evaluate(() => window.localStorage.setItem('__nomiE2E', '1'))
  await win.reload({ waitUntil: 'domcontentloaded' })
  const created = await walk.newProject()
  ;({ projectId, projectRoot } = created)
  await openCanvas(win)
  await collapseAgentPanel(win)
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore), null, { timeout: stationTimeout({ operations: 2 }) })

  const assetDir = path.join(projectRoot, 'assets', 'imported')
  fs.mkdirSync(assetDir, { recursive: true })
  urlOf = (file) => `nomi-local://asset/${projectId}/assets/imported/${file}`
  FILES.forEach((file, index) => execFileSync(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=s=832x480:r=1,hue=h=${index * 60}`, '-frames:v', '1', '-y', path.join(assetDir, file)], { stdio: 'pipe' }))
  fileOf = fileMapper(FILES, urlOf)

  // 三张图片节点（已出图）+ 一个空视频节点（最后加，加完就是选中的那个）。
  const imageIds = {}
  for (const [index, file] of ['a.png', 'b.png', 'c.png'].entries()) {
    // addNode 不收 result：先建，再把「已出图」写上（和生成落地写的是同一组字段）。
    imageIds[file] = await store(({ url, title, y }) => {
      const state = window.__nomiCanvasStore.getState()
      const id = state.addNode({ kind: 'image', title, prompt: '', position: { x: -520, y }, meta: { imageWidth: 832, imageHeight: 480 } }).id
      const result = { id: `${title}-r`, type: 'image', url, createdAt: 1 }
      state.updateNode(id, { status: 'success', result, history: [result] })
      return id
    }, { url: urlOf(file), title: file, y: index * 260 })
  }
  const v = await store(({ meta }) => window.__nomiCanvasStore.getState().addNode({ kind: 'video', title: '方式格复现', prompt: '海边清晨，镜头缓慢推近', position: { x: 0, y: 0 }, meta }).id, { meta: SEEDANCE })
  await select(v)

  // ① 空视频节点
  await scene('01-empty-node', v, { expectMode: 'text' })
  // ② 连 1 张图
  await connect(imageIds['a.png'], v); await select(v)
  await scene('02-one-image', v, { expectMode: null })
  // ③ 连第 2 张、手选首尾帧，再连第 3 张
  await connect(imageIds['b.png'], v); await select(v)
  await pickMode(v, 'firstLast')
  await scene('03a-picked-first-last-two', v, { expectMode: 'firstLast' })
  await connect(imageIds['c.png'], v); await select(v)
  await scene('03b-third-image', v, { expectMode: 'reference' })
  // ④ 删回 2 张（不跳回）、删光（回文生）
  await disconnect(imageIds['c.png'], v); await select(v)
  await scene('04a-removed-back-to-two', v, { expectMode: 'reference' })
  await disconnect(imageIds['a.png'], v); await disconnect(imageIds['b.png'], v); await select(v)
  await scene('04b-removed-all', v, { expectMode: 'text' })
  // ⑤ 连着 3 张从 Seedance 换到可灵 4.0
  for (const file of ['a.png', 'b.png', 'c.png']) await connect(imageIds[file], v)
  await select(v)
  await pickModel(v, '可灵 4.0')
  await expect.poll(() => store((id) => window.__nomiCanvasStore.getState().nodes.find((node) => node.id === id)?.meta?.modelKey ?? null, v), { message: '换成可灵 4.0' }).toBe('kling-v4')
  await scene('05-kling4-three-images', v, { expectMode: null })

  // ⑥ 老项目：旧版存下的两种节点——「首尾帧」但没有任何输入（用户 11-12 那一幕）；带旧按槽键（firstFrameUrl / lastFrameUrl）的首尾帧。
  const oldEmpty = await store(({ meta }) => window.__nomiCanvasStore.getState().addNode({ kind: 'video', title: '老项目·没输入', prompt: '老项目里的空镜头', position: { x: 600, y: 0 }, meta }).id,
    { meta: { ...SEEDANCE, archetype: { ...SEEDANCE.archetype, modeId: 'firstlast' } } })
  const oldLegacy = await store(({ meta }) => window.__nomiCanvasStore.getState().addNode({ kind: 'video', title: '老项目·旧键', prompt: '老项目里的首尾帧镜头', position: { x: 600, y: 400 }, meta }).id,
    { meta: { ...SEEDANCE, archetype: { ...SEEDANCE.archetype, modeId: 'firstlast' }, firstFrameUrl: urlOf('old-first.png'), lastFrameUrl: urlOf('old-last.png') } })
  await sleep(3000)
  const { name } = created
  await walk.stopApp()
  const filesWithOld = projectFiles(projectRoot).filter((file) => fs.readFileSync(file, 'utf8').includes(oldEmpty))
  expect(filesWithOld.length, '老节点落盘了').toBeGreaterThan(0)
  const onDisk = JSON.parse(fs.readFileSync(filesWithOld[0], 'utf8'))
  const findNode = (value, id) => {
    if (!value || typeof value !== 'object') return null
    if (value.id === id && value.kind) return value
    for (const child of Object.values(value)) { const hit = findNode(child, id); if (hit) return hit }
    return null
  }
  walk.report.oldProjectOnDisk = { empty: findNode(onDisk, oldEmpty)?.meta ?? null, legacy: findNode(onDisk, oldLegacy)?.meta ?? null }
  const hashesBefore = Object.fromEntries(filesWithOld.map((file) => [file, hashOf(file)]))
  const jsonBefore = Object.fromEntries(filesWithOld.map((file) => [file, JSON.parse(fs.readFileSync(file, 'utf8'))]))

  ;({ win } = await walk.start())
  const card = win.locator('[data-project-card="true"]').filter({ hasText: name })
  await expect(card).toBeVisible(); await card.hover()
  await clickOrFail(card.getByRole('button', { name: /继续创作/ }), '打开老项目')
  await win.waitForFunction((id) => location.href.includes(`projectId=${encodeURIComponent(id)}`), projectId)
  await openCanvas(win)
  await collapseAgentPanel(win)
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore), null, { timeout: stationTimeout({ operations: 2 }) })
  await select(oldEmpty)
  await sleep(4000)
  // 判的是「打开这一下不改写老节点存的方式」：两个老节点的 meta（存着的方式偏好、旧的按槽键）字节不变。
  // 文件别处变了照记：项目的保存时间 / 版本号，画布载入时 main 上本来就有的规整（节点补 renderKind、出图补 versionNo），不是方式这条线写的。
  const changed = Object.entries(hashesBefore).filter(([file, hash]) => hashOf(file) !== hash).map(([file]) => path.relative(projectRoot, file))
  const changedPaths = Object.entries(jsonBefore).flatMap(([file, before]) => jsonDiff(before, JSON.parse(fs.readFileSync(file, 'utf8'))).map((at) => `${path.relative(projectRoot, file)}:${at}`))
  const nodesAfter = JSON.parse(fs.readFileSync(filesWithOld[0], 'utf8'))
  const oldNodesKept = [oldEmpty, oldLegacy].every((id) => JSON.stringify(findNode(onDisk, id)?.meta) === JSON.stringify(findNode(nodesAfter, id)?.meta))
  walk.report.oldProjectOpen = { filesTouched: changed, changedPaths: changedPaths.slice(0, 40), oldNodesKept }
  scenes.push({ scene: '06-old-project-open-no-rewrite', problems: oldNodesKept ? [] : [`打开老项目就改写了老节点：${changedPaths.filter((at) => at.includes('nodes')).slice(0, 8).join('、')}`] })
  console.log(`${oldNodesKept ? '✓' : '✗'} 06-old-project-open-no-rewrite · 老节点 meta 字节不变 ${oldNodesKept} · 文件里变了的路径 [${changedPaths.slice(0, 12).join('、')}]`)
  await scene('06a-old-firstlast-no-inputs', oldEmpty, { expectMode: 'text' })
  await select(oldLegacy)
  await scene('06b-old-legacy-slot-keys', oldLegacy, { expectMode: null })

  walk.report.scenes = scenes
  walk.report.fixtureVideoCreates = walk.fixture.videos.length
  walk.report.fixtureUploads = walk.fixture.uploads.map((upload) => upload.uploadFileNames ?? [])
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
