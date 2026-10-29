// I-3d-ref · 「出成片」之后付费请求里到底带不带预演参考、编号对不对 —— Electron 真机取证（免费）。
//
// 用法（渲染端走构建产物 dist，主进程走 dist-electron；先 `pnpm run build:electron && pnpm run build:renderer`）：
//   NOMI_WALK_LANG=zh-CN node tests/ux/director-reference-attach.walk.mjs
//   NOMI_WALK_LANG=en    node tests/ux/director-reference-attach.walk.mjs
// 编译器 / Seedance mapping 是 TS 源码：经 tsx/cjs/api 的 require 加载，裸 `node` 就能跑（夜跑就是裸 node；
// 静态 import .ts 会在 Node 自带的类型剥离里栽在无扩展名的相对 import 上，2026-10-24 夜跑红过）。
//
// 走的是真实用户路径：隔离资料目录（不碰用户真实资料 / 项目）→ 新建项目 → 生成页 → 画布上的导演台节点 →
// 常驻 Host 离屏渲染整段预演 → 进导演台点「出成片」→ 回画布选中视频节点 → 点节点 ↑ →「开始生成」确认。
// 上游是本机假服务（127.0.0.1）：它**只录请求体、不建任务**（422 当场拒绝 = 没受理、没扣钱）；
// 视频走本机假上传口，所以请求体里的参考视频是假服务发回的网址，按上传顺序能对回「哪一条是预演」。
// 请求体的形状取自真实的 Kie Seedance 2 mapping（SEEDANCE_2_CREATE_OP，只去掉鉴权头），不手抄。
//
// 三个场景（共用一个导演节点和一份预演）：
//   A 无参考视频槽的模型备好预演 → 换成有槽的模型 → 出成片 → 请求带预演、提示词引用 @video1
//   B 已挂好的预演参考被手动删掉 → 生成按文生放行 → 换模型不挂回 → 出成片重新挂上
//   C 视频节点已有一条用户自己的参考视频 → 出成片 → 请求两条、提示词引用 @video2（指向预演那一条）
// 证据落 tests/ux/shots/director-reference-attach/<语言>/：每个场景一张截图 + wire-requests.json（抓到的请求体）。
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { require as tsxRequire } from 'tsx/cjs/api'
import { launchNomiApp, currentCatalogVersion } from './_launchApp.mjs'
import { createBlankProject } from '../../evals/lib/isoApp.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { ensureAgentPanelOpen, newProjectEntry } from './_shell.mjs'
import { bringButtonIntoReach } from './_generateReach.mjs'

const { compileDirectorPlan } = tsxRequire('../../src/workbench/generationCanvas/nodes/director/model/compiler/directorPlanCompiler.ts', import.meta.url)
const { SEEDANCE_2_CREATE_OP, SEEDANCE_2_QUERY_OP } = tsxRequire('../../electron/catalog/kieSeedance.ts', import.meta.url)

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// NOMI_WALK_PAID_LIKE=1：照付费脚本的样子走——Agent 面板开着、点 ↑ 只用真鼠标（不退到 DOM 点击），并量「点击 → 确认框可见」的毫秒数与按钮被谁盖着（协调 10-22 查付费样本点 ↑ 没反应）。
const PAID_LIKE = process.env.NOMI_WALK_PAID_LIKE === '1'
const lang = process.env.NOMI_WALK_LANG === 'en' ? 'en' : 'zh-CN'
const langDir = lang === 'en' ? 'en' : 'zh'
const shotsDir = path.join(repoRoot, 'tests/ux/shots/director-reference-attach', langDir)
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })
// 隔离资料放系统临时目录（不能落回仓库根：macOS / Linux 没有 TEMP，旧写法会在工作树根建 nomi-ref-attach-*）
const tempRoot = path.join(process.env.TEMP || os.tmpdir(), `nomi-ref-attach-${langDir}`)
fs.rmSync(tempRoot, { recursive: true, force: true })
const userDataDir = path.join(tempRoot, 'user-data')
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const capabilityDir = path.join(tempRoot, 'capability')
for (const dir of [userDataDir, settingsDir, projectsDir, capabilityDir]) fs.mkdirSync(dir, { recursive: true })

// ── 一份短预演（6 秒，两镜；预演上限 10 秒）：与 directorProduce 测试同一份计划 ──
const PLAN = {
  scene: { environment: 'day', template: 'room', tags: ['书房'] },
  actors: [
    { id: 'reader', kind: 'person', desc: '读者', placement: { relation: 'at', ref: 's1-room-floor' } },
    { id: 'friend', kind: 'person', desc: '朋友', placement: { relation: 'in_front_of', ref: 'reader' } },
  ],
  shots: [
    { id: 'wide', window: [0, 3], transitionIn: 'cut', subject: 'reader', size: '全景', angle: 'front', height: 'eye', move: { kind: 'static' } },
    { id: 'close', window: [3, 6], transitionIn: 'cut', subject: 'friend', size: '中景', angle: 'three_quarter', height: 'eye', move: { kind: 'push_in' } },
  ],
}
const compiled = compileDirectorPlan(PLAN)
if (!compiled.ok) throw new Error(`计划编译失败：${compiled.errors.join('; ')}`)
const project = compiled.project

// ── 本机假上游：只录请求，不建任务 ──
const VENDOR = 'fake-kie'
const SLOT_MODEL = 'bytedance/seedance-2'
const NO_SLOT_MODEL = 'google/veo-3.1'
const NOW = '2026-10-21T00:00:00.000Z'
const wire = []
const uploads = []
const readBody = (req) => new Promise((resolve) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks))) })
const server = http.createServer(async (req, res) => {
  const body = await readBody(req)
  if (req.method === 'POST' && req.url === '/upload') {
    const head = body.subarray(0, Math.min(body.length, 600)).toString('latin1')
    const id = uploads.length + 1
    const upload = { id, filename: /filename="([^"]*)"/.exec(head)?.[1] ?? '', bytes: body.length, contentType: /Content-Type: ([^\r\n]+)/i.exec(head.slice(head.indexOf('filename')))?.[1] ?? '', url: `http://127.0.0.1:${server.address().port}/files/up-${id}.mp4` }
    uploads.push(upload)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ url: upload.url }))
    return
  }
  if (req.method === 'POST' && req.url === '/api/v1/jobs/createTask') {
    let json = {}
    try { json = JSON.parse(body.toString('utf8')) } catch { /* 记原文 */ }
    wire.push({ at: new Date().toISOString(), path: req.url, body: json })
    res.writeHead(422, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ code: 422, msg: 'fake upstream records the request and refuses on purpose: no task was created' }))
    return
  }
  if (req.method === 'GET' && req.url?.startsWith('/files/')) { res.writeHead(200, { 'content-type': 'video/mp4' }); res.end(Buffer.alloc(16)); return }
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: `no route ${req.method} ${req.url}` }))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const base = `http://127.0.0.1:${port}`
const USER_CLIP = `${base}/files/user-clip.mp4`

const createOp = { ...SEEDANCE_2_CREATE_OP, headers: { 'Content-Type': 'application/json' } }
const queryOp = { ...SEEDANCE_2_QUERY_OP, headers: {} }
const mapping = (modelKey, taskKind, create) => ({ id: `${VENDOR}-${modelKey}-${taskKind}`, vendorKey: VENDOR, taskKind, modelKey, name: `${modelKey} ${taskKind}`, enabled: true, create, query: queryOp, createdAt: NOW, updatedAt: NOW })
fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
  version: currentCatalogVersion(),
  vendors: [{
    key: VENDOR, name: 'Fake Kie', enabled: true, baseUrlHint: base, authType: 'none', authHeader: null, authQueryParam: null, providerKind: 'openai-compatible',
    assetIngestion: { strategy: 'upload-multipart', endpoint: `${base}/upload`, urlPath: 'url', accepts: ['image', 'video', 'audio'], visibility: 'provider-private', requiresConsent: false },
    createdAt: NOW, updatedAt: NOW,
  }],
  models: [
    { modelKey: SLOT_MODEL, vendorKey: VENDOR, labelZh: '假 Seedance（有参考视频槽）', kind: 'video', enabled: true, meta: { archetypeId: 'seedance-2' }, createdAt: NOW, updatedAt: NOW },
    { modelKey: NO_SLOT_MODEL, vendorKey: VENDOR, labelZh: '假 Veo（无参考视频槽）', kind: 'video', enabled: true, meta: { archetypeId: 'veo-3.1' }, createdAt: NOW, updatedAt: NOW },
  ],
  mappings: [
    mapping(SLOT_MODEL, 'text_to_video', createOp),
    mapping(SLOT_MODEL, 'image_to_video', createOp),
    mapping(NO_SLOT_MODEL, 'text_to_video', { method: 'POST', path: '/api/v1/jobs/createTask', headers: { 'Content-Type': 'application/json' }, body: { model: '{{model.modelKey}}', input: { prompt: '{{request.prompt}}' } } }),
  ],
  apiKeysByVendor: {},
}, null, 2))

const report = { lang, startedAt: new Date().toISOString(), checks: [], scenarios: {}, deletionPaths: [] }
const check = (name, ok, detail = '') => {
  report.checks.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) throw new Error(`检查没过：${name}${detail ? `（${detail}）` : ''}`)
}

const { app, win } = await launchNomiApp({
  name: `director-reference-attach-${langDir}`,
  tempRoot, userDataDir, settingsDir, projectsDir, capabilityDir,
  settleMs: 0,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  initialLocalStorage: { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', __nomiE2E: '1', 'nomi:locale:v1': lang },
  env: { NOMI_RENDERER_URL: `file://${path.join(repoRoot, 'dist/index.html')}`, NOMI_DISABLE_AUTO_UPDATE: '1' },
})
const pageErrors = []
win.on('pageerror', (error) => pageErrors.push(String(error)))
const shot = async (name) => { const file = path.join(shotsDir, `${name}.png`); await win.screenshot({ path: file }); console.log(`  screenshot: ${path.relative(repoRoot, file)}`); return file }
const store = (fn, arg) => win.evaluate(fn, arg)
const nodeById = (id) => store((nodeId) => window.__nomiCanvasStore.getState().nodes.find((n) => n.id === nodeId) ?? null, id)
const waitFor = async (label, predicate, timeout = 60_000) => {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`等待超时：${label}`)
    await win.waitForTimeout(400)
  }
}
// 其它非删除按钮允许用同一 DOM onClick 入口完成走查；删除入口单独只接受真实鼠标点击。
const clickOrDom = async (locator) => {
  try { await locator.click({ timeout: 4000 }) } catch { await locator.evaluate((element) => element.click()) }
}
// 参考条的 × 是用户删除参考的真实入口，最终调用 NodeParameterControls → removeFromArray。
// 本轮不允许 DOM/onClick fallback：真鼠标命中失败就是走查失败，避免把“真实入口不可达”记成通过。
const removeReferenceLikeUser = async (nodeId) => {
  const remove = win.locator(`[data-node-id="${nodeId}"] [data-asset-tile="video"] [data-asset-tile-remove="true"]`).first()
  if (await remove.count() !== 1) throw new Error(`镜头 ${nodeId} 没有唯一的参考视频删除按钮`)
  // × 只在 tile hover/focus 时显现；先把鼠标放到 tile，再走 Playwright 真鼠标点击。
  await remove.locator('xpath=..').hover()
  await remove.click({ timeout: 4000 })
  report.deletionPaths.push({ nodeId, path: 'real-mouse: AssetTile [data-asset-tile-remove="true"]' })
  await waitFor(`镜头 ${nodeId} 的参考删除完成`, async () => !((await nodeById(nodeId))?.meta?.referenceVideoUrls ?? []).length, 5000)
}
const modelPatch = (modelKey, archetypeId, modeId) => ({ modelKey, modelVendor: VENDOR, vendor: VENDOR, archetype: { id: archetypeId, modeId } })

try {
  await newProjectEntry(win).waitFor({ timeout: stationTimeout({ operations: 4 }) })
  await createBlankProject(win, projectsDir)
  await win.getByRole('button', { name: lang === 'en' ? 'Generate' : '生成', exact: true }).first().click({ timeout: stationTimeout({ operations: 2 }) })
  if (PAID_LIKE) await ensureAgentPanelOpen(win)
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore), null, { timeout: stationTimeout({ operations: 2 }) })

  // 导演节点 + 三个视频镜头（A 无槽模型 / B 有槽模型 / C 有槽模型 + 用户自己的一条参考视频）。预演先指向 A。
  const ids = await store(({ directorProject, noSlot, slot, userClip, title, prompt }) => {
    const state = window.__nomiCanvasStore.getState()
    const director = state.addNode({ kind: 'director', title, prompt: '', position: { x: 0, y: 0 }, select: false })
    const add = (title, prompt, y, meta) => state.addNode({ kind: 'video', title, prompt, position: { x: 200, y }, select: false, meta })
    const a = add(title + ' A', prompt, -380, noSlot)
    const b = add(title + ' B', prompt, 0, slot)
    const c = add(title + ' C', prompt, 380, { ...slot, archetype: { ...slot.archetype, modeId: 'omni' }, referenceVideoUrls: [userClip] })
    const d = add(title + ' D', prompt, 760, noSlot)
    window.__nomiCanvasStore.getState().updateNode(director.id, { title, meta: { ...director.meta, directorProject, directorPreview: { status: 'rendering', revision: 'manual:e2e-1', targetNodeId: a.id, updatedAt: Date.now() } } })
    return { director: director.id, a: a.id, b: b.id, c: c.id, d: d.id }
  }, { directorProject: project, noSlot: modelPatch(NO_SLOT_MODEL, 'veo-3.1', 't2v'), slot: modelPatch(SLOT_MODEL, 'seedance-2', 't2v'), userClip: USER_CLIP, title: lang === 'en' ? 'Study preview' : '书房预演', prompt: lang === 'en' ? 'Two people talk in the study' : '书房里两人对话' })
  report.ids = ids

  // ── 等 Host 离屏渲染整段预演并挂到镜头 A（A 的模型没有参考视频槽 → 预演退成文字描述）──
  const readyDirector = await waitFor('预演渲染完成（ready）', async () => {
    const director = await nodeById(ids.director)
    return director?.meta?.directorPreview?.status === 'ready' ? director : null
  }, 180_000)
  const previewUrl = readyDirector.meta.directorPreview.videoUrl
  report.previewUrl = previewUrl
  const nodeA0 = await nodeById(ids.a)
  check('A：无槽模型备好的预演退成文字描述（提示词有预演运镜行，没有参考视频）', readyDirector.meta.directorPreview.attach === 'prompt_only' && /3D-BOX 预演运镜：/.test(nodeA0.prompt) && !(nodeA0.meta.referenceVideoUrls ?? []).length, JSON.stringify({ attach: readyDirector.meta.directorPreview.attach }))

  // ── 小工具：进导演台点「出成片」→ 回画布、选中该视频节点 ──
  const produce = async (targetId, label) => {
    await win.keyboard.press('Escape').catch(() => {})
    // 画布按当前分类分屏：新节点落在「场景」里，走真入口的聚焦事件（同画布边缘「N 个新节点」角标）切过去并居中
    // 节点可能在视口外（画布不替人挪视野）：按钮在 DOM 里，走它自己的点击处理函数（和鼠标点同一个 onClick）。
    await store((id) => window.dispatchEvent(new CustomEvent('nomi-focus-generation-node', { detail: { nodeId: id } })), ids.director)
    const openButton = win.locator('[data-testid="director-node-open"]').first()
    await openButton.waitFor({ state: 'attached', timeout: stationTimeout({ operations: 2 }) })
    await openButton.evaluate((element) => element.click())
    await win.locator('[data-testid="director-editor"]').waitFor({ timeout: stationTimeout({ operations: 4 }) })
    await waitFor(`${label}：出成片按钮可点`, () => win.locator('[data-testid="director-produce-main"]').isEnabled().catch(() => false), 60_000)
    await clickOrDom(win.locator('[data-testid="director-produce-main"]'))
    await waitFor(`${label}：回到画布并选中视频节点`, () => store((id) => {
      const state = window.__nomiCanvasStore.getState()
      return !document.querySelector('[data-testid="director-editor"]') && state.selectedNodeIds.includes(id)
    }, targetId), 30_000)
    await win.waitForTimeout(1200)
  }
  const retarget = (targetId) => store(({ director, target }) => {
    const state = window.__nomiCanvasStore.getState()
    const node = state.nodes.find((item) => item.id === director)
    state.updateNode(director, { meta: { ...node.meta, directorPreview: { ...node.meta.directorPreview, targetNodeId: target, updatedAt: Date.now() } } })
  }, { director: ids.director, target: targetId })
  const spendAndCapture = async (nodeId, label) => {
    const before = wire.length
    const generateButton = win.locator(`[data-node-id="${nodeId}"] button[data-bar-segment="generate"]`).first()
    let clickedAt = Date.now()
    if (PAID_LIKE) {
      const hit = await bringButtonIntoReach(win, generateButton, `${label}：↑`)
      report.latency = { ...(report.latency ?? {}), [label]: { hit } }
      clickedAt = Date.now()
      await generateButton.click({ timeout: stationTimeout({ operations: 2 }), noWaitAfter: true }) // 只用真鼠标：点不到就红
    } else await clickOrDom(generateButton)
    const dialog = win.locator('div.fixed.inset-0').filter({ hasText: lang === 'en' ? /Start generating|Generate/ : /开始生成/ }).last()
    await dialog.waitFor({ timeout: PAID_LIKE ? stationTimeout({ turns: 1 }) : stationTimeout({ operations: 1 }) })
    if (PAID_LIKE) { report.latency[label].dialogMs = Date.now() - clickedAt; console.log(`  · ${label}：点击 → 确认框可见 ${report.latency[label].dialogMs} ms`) }
    await shot(`${label}-spend-confirm`)
    await dialog.getByRole('button', { name: lang === 'en' ? /^Generate$/ : /^生成$/ }).click()
    await waitFor(`${label}：假上游收到请求`, () => wire.length > before, 60_000)
    return wire[wire.length - 1]
  }
  const refsOf = (call) => {
    const input = call.body?.input ?? {}
    const key = Object.keys(input).find((k) => k.trim() === 'reference_video_urls')
    return { videos: key ? input[key] : undefined, prompt: String(input.prompt ?? '') }
  }

  // ── 场景 A：无槽 → 有槽（换模型）→ 出成片 ──
  await store(({ id, patch }) => { const state = window.__nomiCanvasStore.getState(); state.updateNode(id, { meta: { ...state.nodes.find((n) => n.id === id).meta, ...patch } }) }, { id: ids.a, patch: modelPatch(SLOT_MODEL, 'seedance-2', 't2v') })
  await produce(ids.a, 'A')
  const nodeA1 = await nodeById(ids.a)
  check('A：换成有槽模型后出成片 → 预演作为参考视频重新挂上', (nodeA1.meta.referenceVideoUrls ?? []).includes(previewUrl), JSON.stringify(nodeA1.meta.referenceVideoUrls))
  await shot('A-node-after-produce')
  const callA = await spendAndCapture(ids.a, 'A')
  const a = refsOf(callA)
  report.scenarios.A = { videos: a.videos, prompt: a.prompt }
  check('A：请求里带着预演参考（一条，且是假上传口发回的预演网址）', Array.isArray(a.videos) && a.videos.length === 1 && uploads.some((u) => u.url === a.videos[0]), JSON.stringify({ videos: a.videos, uploads: uploads.map((u) => ({ id: u.id, filename: u.filename, bytes: u.bytes })) }))
  check('A：请求提示词里的引用是 @video1', /@video1 /.test(a.prompt) && !/@[Vv]ideo2/.test(a.prompt), a.prompt)

  // ── 场景 B：已挂好的预演参考被手动删掉 → 按文生放行 → 换模型不挂回 → 出成片恢复 ──
  await retarget(ids.b)
  await produce(ids.b, 'B1')
  const nodeB1 = await nodeById(ids.b)
  check('B：出成片后镜头 B 挂上预演', (nodeB1.meta.referenceVideoUrls ?? []).includes(previewUrl))
  await removeReferenceLikeUser(ids.b)
  await win.waitForTimeout(1500)
  const nodeBAfterDelete = await nodeById(ids.b)
  const bDeleteButton = win.locator(`[data-node-id="${ids.b}"] button[data-bar-segment="generate"]`).first()
  const bDeleteTitle = await bDeleteButton.getAttribute('title')
  check('B：删掉唯一预演参考后 1.5 秒内参考为空、B3 回文生、@ 和运镜句清掉、attached 标记保留', !((nodeBAfterDelete.meta.referenceVideoUrls ?? []).length) && nodeBAfterDelete.meta.cameraMoveAttachedUrl === previewUrl && nodeBAfterDelete.meta.archetype?.modeId === 't2v' && !/@\[asset:[^\]]+\]/.test(nodeBAfterDelete.prompt ?? '') && !/跟随这段参考视频的运镜/.test(nodeBAfterDelete.prompt ?? ''), JSON.stringify({ refs: nodeBAfterDelete.meta.referenceVideoUrls, mode: nodeBAfterDelete.meta.archetype?.modeId, attached: nodeBAfterDelete.meta.cameraMoveAttachedUrl, prompt: nodeBAfterDelete.prompt }))
  check('B：删除后生成钮可点且没有花钱闸理由', await bDeleteButton.isEnabled(), JSON.stringify({ disabled: await bDeleteButton.isDisabled(), title: bDeleteTitle }))
  await shot('B-node-after-delete')
  // Cmd+Z 必须把删除产生的全部字段一次恢复；随后再用真实鼠标删除，继续完成主路径。
  const stage = win.locator('.generation-canvas-v2__stage').first()
  const stageBox = await stage.boundingBox()
  if (!stageBox) throw new Error('找不到画布视口，无法把 Cmd+Z 交给画布快捷键 owner')
  await win.mouse.click(stageBox.x + Math.min(40, stageBox.width / 2), stageBox.y + Math.min(40, stageBox.height / 2))
  await win.keyboard.press('Meta+z')
  await waitFor('B：Cmd+Z 恢复预演参考', async () => ((await nodeById(ids.b))?.meta?.referenceVideoUrls ?? []).includes(previewUrl), 5000)
  const nodeBUndo = await nodeById(ids.b)
  check('B：Cmd+Z 同步恢复 @、运镜句与退出事实', /@\[asset:[^\]]+\]/.test(nodeBUndo.prompt ?? '') && /跟随这段参考视频的运镜/.test(nodeBUndo.prompt ?? '') && !nodeBUndo.meta.directorPreviewDismissedUrl, JSON.stringify({ prompt: nodeBUndo.prompt, dismissed: nodeBUndo.meta.directorPreviewDismissedUrl }))
  // 让同一真实导演台入口重新把镜头带回视口；预演已挂好时这是 kept，不会新增或改写参考。
  await produce(ids.b, 'B-undo-focus')
  await removeReferenceLikeUser(ids.b)
  await win.waitForTimeout(1500)
  // 有槽 → 无槽 → 有槽：已退出的 URL 不得被模型对账器挂回。
  await store(({ id, patch }) => { const state = window.__nomiCanvasStore.getState(); state.updateNode(id, { meta: { ...state.nodes.find((n) => n.id === id).meta, ...patch } }) }, { id: ids.b, patch: modelPatch(NO_SLOT_MODEL, 'veo-3.1', 't2v') })
  await win.waitForTimeout(1500)
  const bNoSlot = await nodeById(ids.b)
  check('B：删后换无槽模型不挂回、没有预演运镜文字', !(bNoSlot.meta.referenceVideoUrls ?? []).length && !/3D-BOX 预演运镜：/.test(bNoSlot.prompt ?? ''), JSON.stringify({ refs: bNoSlot.meta.referenceVideoUrls, prompt: bNoSlot.prompt }))
  await store(({ id, patch }) => { const state = window.__nomiCanvasStore.getState(); state.updateNode(id, { meta: { ...state.nodes.find((n) => n.id === id).meta, ...patch } }) }, { id: ids.b, patch: modelPatch(SLOT_MODEL, 'seedance-2', 't2v') })
  await win.waitForTimeout(1500)
  const bSlotAfterSwitch = await nodeById(ids.b)
  const bSlotButton = win.locator(`[data-node-id="${ids.b}"] button[data-bar-segment="generate"]`).first()
  check('B：再换回有槽模型仍不挂回、生成钮可点', !(bSlotAfterSwitch.meta.referenceVideoUrls ?? []).length && !/3D-BOX 预演运镜：/.test(bSlotAfterSwitch.prompt ?? '') && await bSlotButton.isEnabled(), JSON.stringify({ refs: bSlotAfterSwitch.meta.referenceVideoUrls, prompt: bSlotAfterSwitch.prompt }))
  const callBDelete = await spendAndCapture(ids.b, 'B-delete')
  const bDeleteRequest = refsOf(callBDelete)
  check('B：删除后的 ↑ 确认请求没有参考视频和运镜句', !bDeleteRequest.videos?.length && !/跟随这段参考视频的运镜/.test(bDeleteRequest.prompt) && !/3D-BOX 预演运镜：/.test(bDeleteRequest.prompt), JSON.stringify(bDeleteRequest))
  await produce(ids.b, 'B2')
  const nodeB2 = await nodeById(ids.b)
  check('B：再出成片 → 预演参考重新挂上', (nodeB2.meta.referenceVideoUrls ?? []).includes(previewUrl), JSON.stringify(nodeB2.meta.referenceVideoUrls))
  await shot('B-node-after-reattach')
  const callB = await spendAndCapture(ids.b, 'B')
  const b = refsOf(callB)
  report.scenarios.B = { deletedRequest: bDeleteRequest, videos: b.videos, prompt: b.prompt }
  check('B：请求里带着预演参考', Array.isArray(b.videos) && b.videos.length === 1 && uploads.some((u) => u.url === b.videos[0]), JSON.stringify(b.videos))

  // ── 场景 C：节点已有用户自己的一条参考视频 → 出成片 → 预演排第二、提示词引用 @video2 ──
  await retarget(ids.c)
  await produce(ids.c, 'C')
  await shot('C-node-after-produce')
  const callC = await spendAndCapture(ids.c, 'C')
  const c = refsOf(callC)
  report.scenarios.C = { videos: c.videos, prompt: c.prompt }
  check('C：请求里两条参考视频，用户自己的在前、预演在后', Array.isArray(c.videos) && c.videos.length === 2 && c.videos[0] === USER_CLIP && uploads.some((u) => u.url === c.videos[1]), JSON.stringify(c.videos))
  check('C：请求提示词里的引用是 @video2（指向预演那一条，不是第一条用户片）', /@video2 /.test(c.prompt) && !/@[Vv]ideo1 /.test(c.prompt), c.prompt)
  await shot('C-final')

  // ── 场景 D：无槽模型上出成片（预演退成文字）→ 换成有槽模型 → **直接点 ↑**（不再点出成片）→ 请求照样带预演 ──
  await retarget(ids.d)
  await produce(ids.d, 'D1')
  const nodeD1 = await nodeById(ids.d)
  check('D：无槽模型上出成片 → 预演退成文字描述，没有参考视频', !(nodeD1.meta.referenceVideoUrls ?? []).length && /3D-BOX 预演运镜：/.test(nodeD1.prompt))
  await store(({ id, patch }) => { const state = window.__nomiCanvasStore.getState(); state.updateNode(id, { meta: { ...state.nodes.find((n) => n.id === id).meta, ...patch } }) }, { id: ids.d, patch: modelPatch(SLOT_MODEL, 'seedance-2', 't2v') })
  await waitFor('D：换模型后挂接对账器自动重挂预演参考', async () => ((await nodeById(ids.d)).meta.referenceVideoUrls ?? []).includes(previewUrl), 30_000)
  await store((id) => window.dispatchEvent(new CustomEvent('nomi-focus-generation-node', { detail: { nodeId: id, select: true } })), ids.d)
  await shot('D-node-after-model-switch')
  const callD = await spendAndCapture(ids.d, 'D')
  const dd = refsOf(callD)
  report.scenarios.D = { videos: dd.videos, prompt: dd.prompt }
  check('D：换模型后直接点 ↑，请求里带着预演参考', Array.isArray(dd.videos) && dd.videos.length === 1 && uploads.some((u) => u.url === dd.videos[0]), JSON.stringify(dd.videos))
  check('D：请求提示词里的引用是 @video1', /@video1 /.test(dd.prompt), dd.prompt)

  check('渲染端没有抛错', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  report.uploads = uploads
  report.wire = wire
  fs.writeFileSync(path.join(shotsDir, 'wire-requests.json'), JSON.stringify(report, null, 2))
  console.log(`✓ director-reference-attach (${lang}) 通过，证据在 ${path.relative(repoRoot, shotsDir)}`)
} catch (error) {
  await win.screenshot({ path: path.join(shotsDir, 'failure.png') }).catch(() => {})
  report.error = String(error?.message ?? error)
  report.uploads = uploads
  report.wire = wire
  fs.writeFileSync(path.join(shotsDir, 'wire-requests.json'), JSON.stringify(report, null, 2))
  throw error
} finally {
  await app.close().catch(() => {})
  server.close()
}
