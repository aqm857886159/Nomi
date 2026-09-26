// R13 走查 —— 后台生成 / 截图热键提交后切项目（PR 802 根因修复的真实入口验收）。
// 用法: node tests/ux/project-switch-background-run.walk.mjs   产出: tests/ux/shots/project-switch-background-run/*.png
//
// 已批准行为：已提交的后台生成属于**原项目**，切项目不取消它；结局落回原项目（原项目不在前台就写它的盘上
// 副本），新项目零副作用。这条走查像真人一样点：项目库新建 A → 画布加图片节点、写提示词 → 批量生成确认 →
// 供应商请求在途时回项目库新建 B → 放行供应商 → B 的画布与盘上文件都不变 → 从项目库回到 A，节点上就是结果。
//
// 诚实边界：供应商是本机 loopback HTTP（不付费、不出网）；UI、付费确认、队列、IPC、结果落盘、项目库都是生产路径。
// 截图热键那段需要 macOS 屏幕录制权限：开发 Electron 没授权时如实记为 skipped，不假装验过。
import fs from 'node:fs'
import crypto from 'node:crypto'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { findCanvasBlankPoint } from './_canvasHit.mjs'
import { clickOrFail, expect, expectAbsent, proveProbe, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const mode = process.env.NOMI_BACKGROUND_MODE || 'single'
if (!['single', 'variants', 'storyboard-first-frame', 'storyboard-batch'].includes(mode)) throw new Error(`Unknown background mode: ${mode}`)
const shotsDir = process.env.NOMI_BACKGROUND_OUT || path.join(repoRoot, `tests/ux/shots/project-switch-background-run-${mode}`)
const expectedRequests = mode === 'variants' ? 3 : mode === 'storyboard-first-frame' ? 2 : mode === 'storyboard-batch' ? 7 : 1
fs.rmSync(shotsDir, { recursive: true, force: true })
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-project-switch-run-'))
const userDataDir = path.join(tempRoot, 'user-data')
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
for (const dir of [shotsDir, userDataDir, settingsDir, projectsDir]) fs.mkdirSync(dir, { recursive: true })

const NOW = '2026-09-17T00:00:00.000Z'
const VENDOR = 'switch-loopback'
const IMAGE_MODEL = 'switch-image'
const VIDEO_MODEL = 'switch-video'
const DESIGN = 'background-original-plan'
const PROMPT = '切项目后仍属于原项目的后台图'
const imageBytes = fs.readFileSync(path.join(repoRoot, 'resources/onboarding-demo/shot-4.jpg'))
const imageDataUrl = `data:image/jpeg;base64,${imageBytes.toString('base64')}`
const videoBytes = fs.readFileSync(path.join(repoRoot, 'tests/ux/fixtures/real-shot-640x360.mp4'))
const videoDataUrl = `data:video/mp4;base64,${videoBytes.toString('base64')}`
let releaseSubsequent = false

// ── loopback 供应商：请求进来先挂住，由走查在「已切到 B」之后才放行 ─────────────
const wireCalls = []
const heldResponses = []
const vendorServer = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    let body = {}
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { body = {} }
    if (req.method !== 'POST' || !['/v1/images/generations', '/v1/videos/generations'].includes(req.url)) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: `No route ${req.method} ${req.url}` } }))
      return
    }
    wireCalls.push({ model: String(body.model || ''), prompt: String(body.prompt || ''), hasFirstFrame: Boolean(body.first_frame), firstFrameSha256: body.first_frame ? crypto.createHash('sha256').update(String(body.first_frame)).digest('hex') : null, route: req.url, at: Date.now() })
    const reply = () => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ url: req.url === '/v1/videos/generations' ? videoDataUrl : imageDataUrl }] }))
    }
    if (releaseSubsequent) reply(); else heldResponses.push(reply)
  })
})
await new Promise((resolve) => vendorServer.listen(0, '127.0.0.1', resolve))
const port = vendorServer.address().port

fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
  version: 8,
  vendors: [{
    key: VENDOR, name: 'Switch Loopback', enabled: true, baseUrlHint: `http://127.0.0.1:${port}`,
    assetIngestion: { strategy: 'inline-base64', accepts: ['image'] },
    authType: 'none', authHeader: null, authQueryParam: null, providerKind: 'openai-compatible',
    createdAt: NOW, updatedAt: NOW,
  }],
  models: [{ modelKey: IMAGE_MODEL, vendorKey: VENDOR, labelZh: '切项目图片', kind: 'image', enabled: true, meta: { archetypeId: 'agnes-image' }, createdAt: NOW, updatedAt: NOW },
    { modelKey: VIDEO_MODEL, vendorKey: VENDOR, labelZh: '切项目视频', kind: 'video', enabled: true,
      meta: { archetypeId: 'minimax-h3-apimart', adapter: { state: 'verified', activeRevision: 'background-video-v1',
        publicationModes: ['image_to_video'], modes: [{ taskKind: 'image_to_video', state: 'verified' }] } },
      createdAt: NOW, updatedAt: NOW }],
  mappings: [{
    id: `${IMAGE_MODEL}-text_to_image`, vendorKey: VENDOR, taskKind: 'text_to_image', modelKey: IMAGE_MODEL,
    name: `${IMAGE_MODEL} text_to_image`, enabled: true,
    create: {
      method: 'POST', path: '/v1/images/generations', headers: { 'Content-Type': 'application/json' },
      body: { model: '{{model.modelKey}}', prompt: '{{request.prompt}}', size: '{{request.params.size}}', extra_body: { response_format: 'url' } },
      response_mapping: { image_url: 'data.0.url' },
      defaultParams: { size: '1024x1024' },
    },
    createdAt: NOW, updatedAt: NOW,
  }, {
    id: `${VIDEO_MODEL}-image_to_video`, vendorKey: VENDOR, taskKind: 'image_to_video', modelKey: VIDEO_MODEL, name: 'Background video fixture', enabled: true,
    create: { method: 'POST', path: '/v1/videos/generations', headers: { 'Content-Type': 'application/json' },
      body: { model: '{{model.modelKey}}', prompt: '{{request.prompt}}', first_frame: '{{request.params.first_frame_image}}' },
      response_mapping: { video_url: 'data.0.url' } }, createdAt: NOW, updatedAt: NOW,
  }],
  apiKeysByVendor: {},
}, null, 2))

const report = { mode, expectedRequests, buildStamp: JSON.parse(fs.readFileSync(path.join(repoRoot, 'dist/build-stamp.json'), 'utf8')), fixture: 'isolated repository seed for legacy original editor; real JPEG/MP4 bytes; remote service loopback', provider: 'loopback-http', paidCalls: 0, wireCalls, screenshots: [], screenshotHotkey: 'not-run', checks: [] }
check(JSON.stringify(report.buildStamp) === JSON.stringify(JSON.parse(fs.readFileSync(path.join(repoRoot, 'dist-electron/build-stamp.json'), 'utf8'))), 'renderer和main构建身份一致')
let shotIndex = 0
report.entry = mode.startsWith('storyboard-') ? 'original-storyboard-batch' : 'original-canvas-generation'
async function snap(win, name) {
  shotIndex += 1
  const file = path.join(shotsDir, `${String(shotIndex).padStart(2, '0')}-${name}.png`)
  await screenshotSettled(win, { path: file })
  report.screenshots.push(file)
  console.log(`  screenshot: ${path.basename(file)}`)
}
function check(condition, message, details = '') {
  if (!condition) throw new Error(`${message}${details ? `: ${details}` : ''}`)
  report.checks.push(message)
  console.log(`  ok: ${message}`)
}

async function currentProjectId(win) {
  return win.evaluate(() => {
    const url = new URL(location.href)
    return url.searchParams.get('projectId') ?? new URLSearchParams(url.hash.split('?')[1] ?? '').get('projectId')
  })
}
async function projectRoot(win, projectId) {
  const summaries = await win.evaluate(() => window.nomiDesktop.projects.listAsync())
  const root = summaries.find((item) => item.id === projectId)?.rootPath
  check(Boolean(root) && !path.relative(projectsDir, root).startsWith('..'), `项目 ${projectId} 落在隔离项目目录里`)
  return root
}
function readCanvas(root) {
  const file = path.join(root, '.nomi', 'project.json')
  const canvas = JSON.parse(fs.readFileSync(file, 'utf8')).payload.generationCanvas
  if (!canvas || !Array.isArray(canvas.nodes) || !Array.isArray(canvas.edges)) throw new Error(`Missing or invalid persisted generationCanvas: ${file}`)
  return canvas
}
function canvasSha256(canvas) {
  const normalize = value => Array.isArray(value) ? value.map(normalize)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value
  return crypto.createHash('sha256').update(JSON.stringify(normalize(canvas))).digest('hex')
}
/** 项目媒体文件的路径→SHA-256；.nomi 中的完整画布另由 canvasSha256 验证。 */
function mediaFiles(root) {
  const out = {}
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      const rel = path.relative(root, full)
      if (rel === '.nomi') continue
      if (entry.isDirectory()) walk(full)
      else out[rel] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')
    }
  }
  walk(root)
  return out
}

async function newBlankProject(win) {
  await clickOrFail(win.getByRole('button', { name: /^新建空白项目/ }).first(), '新建空白项目')
  await expect.poll(() => currentProjectId(win), { message: '新建后地址栏带上新项目 id', timeout: stationTimeout({ operations: 2 }) }).toMatch(/^project-/)
  await clickOrFail(win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }), '切到生成区')
  await expect(win.locator('.generation-canvas-v2__stage')).toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
  return currentProjectId(win)
}
async function backToLibrary(win) {
  await clickOrFail(win.getByRole('button', { name: '返回项目库', exact: true }), '返回项目库')
  await expect(win.getByRole('button', { name: /^新建空白项目/ }).first()).toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
}
async function openFromLibrary(win, projectId) {
  const card = win.locator(`[data-project-card="true"][data-project-id="${projectId}"]`)
  await expect(card, '项目库里看得见原项目卡片').toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
  await card.hover()
  await clickOrFail(card.getByRole('button', { name: /继续创作/ }), '继续创作原项目')
  await expect.poll(() => currentProjectId(win), { message: '回到原项目', timeout: stationTimeout({ operations: 2 }) }).toBe(projectId)
}

const pageErrors = []
const { app, win } = await launchNomiApp({
  name: 'project-switch-background-run',
  userDataDir, settingsDir, projectsDir,
  settleMs: 0,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  initialLocalStorage: { '__nomiE2E': '1', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' },
  env: { NOMI_RENDERER_URL: `file://${path.join(repoRoot, 'dist/index.html')}` },
})
win.on('pageerror', (error) => pageErrors.push(String(error)))

try {
  // ── 幕一 · 项目 A：真人点出一个图片节点并提交生成 ───────────────────────────────
  const projectA = await newBlankProject(win)
  const rootA = await projectRoot(win, projectA)
  let nodeId
  if (mode.startsWith('storyboard-')) {
    await backToLibrary(win)
    await win.evaluate(async ({ projectId, designId, imageModel, videoModel, vendor, prompt, firstFrame }) => {
      const record = await window.nomiDesktop.projects.readAsync(projectId)
      const documentId = record.payload.activeDocumentId
      const shots = Array.from({ length: firstFrame ? 1 : 7 }, (_, index) => ({
        index: index + 1, shotId: `approved-shot-${index + 1}`, shotKind: firstFrame ? 'video' : 'image',
        durationSec: 4, anchorIds: [], prompt: `${prompt} 第${index + 1}镜`,
        modelKey: firstFrame ? videoModel : imageModel, modelVendor: vendor, modeId: firstFrame ? 'first' : 't2i',
        ...(firstFrame ? { keyframe: { enabled: true, prompt: `${prompt} 首帧`, modelKey: imageModel, modelVendor: vendor, modeId: 't2i' } } : {}),
      }))
      const plan = { title: '原分镜后台接续验收', anchors: [], shots }
      record.payload.storyboardDesignsByDocumentId = { [documentId]: [{ id: designId, documentId,
        title: plan.title, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 1, createdAt: 1, updatedAt: 1 }] }
      await window.nomiDesktop.projects.save(projectId, record)
    }, { projectId: projectA, designId: DESIGN, imageModel: IMAGE_MODEL, videoModel: VIDEO_MODEL, vendor: VENDOR, prompt: PROMPT, firstFrame: mode === 'storyboard-first-frame' })
    await openFromLibrary(win, projectA)
    await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '原创作工作区')
    await clickOrFail(win.locator(`[data-storyboard-id="${DESIGN}"]`), '原分镜方案')
    await expect(win.locator('[data-storyboard-editor="true"]')).toBeVisible()
    if (mode === 'storyboard-first-frame') {
      await expect(win.locator('[data-storyboard-row="1"] [data-storyboard-ref-slot="first_frame"]'),
        '仅图生视频模型也在原编辑器显示首帧参考槽').toBeVisible()
    }
    await snap(win, 'original-editor-before-approval')
    const action = win.locator('[data-storyboard-batch="true"]')
    await expect(action, '原批量入口允许生成已有首帧计划的镜头').toBeEnabled()
    await clickOrFail(action, '原分镜批量生成动作')
  } else {
    await clickOrFail(win.locator('[aria-label="添加图片节点"]').first(), '添加图片节点')
    const nodeA = win.locator('[data-kind="image"][data-node-id]').last()
    await expect(nodeA).toBeVisible({ timeout: stationTimeout() })
    nodeId = await nodeA.getAttribute('data-node-id')
    const editor = win.locator(`[data-node-id="${nodeId}"] div[contenteditable="true"]`).last()
    await editor.click()
    await editor.fill(PROMPT)
    if (mode === 'variants') {
      await clickOrFail(win.locator('[aria-label="每次生成几个"]'), '原参数条生成数量')
      await clickOrFail(win.getByRole('option', { name: '3 个', exact: true }), '选择三次')
      await clickOrFail(win.locator('[data-composer-host="canvas"] [data-bar-segment="generate"]'), '原参数条生成')
    } else {
      const blank = await findCanvasBlankPoint(win)
      check(Boolean(blank), '画布上找得到空白处取消选择')
      await win.mouse.click(blank.x, blank.y)
      const generateAll = win.locator('[data-batch-scope="all"]')
      await expect(generateAll, '有待生成节点时出现批量生成入口').toBeVisible({ timeout: stationTimeout() })
      await clickOrFail(generateAll, '生成全部')
    }
  }
  if (mode === 'single') {
    // 用户自己点的单份生成不弹付费确认卡（2026-09-25 拍板，判据按份数不按入口；画布上只有这一张待生成）；
    // 若中间弹卡而不点，请求永远发不出去——下面供应商收到 1 次请求、节点进入 queued/running 就是证据。
    report.spendConfirmation = 'not-shown: single user-initiated run'
    report.quoteText = null
  } else {
    report.spendConfirmation = 'shown'
    const spend = win.locator('div.fixed.inset-0').filter({ hasText: /开始生成/ }).last()
    await expect(spend, '提交前先看报价确认').toBeVisible({ timeout: stationTimeout() })
    report.quoteText = await spend.innerText()
    if (expectedRequests > 1) check(new RegExp(`${expectedRequests}\\s*(张|个|项|次|份)`).test(report.quoteText), '确认卡明确覆盖本次全部执行数量', report.quoteText)
    if (mode === 'storyboard-first-frame') {
      const nodes = await win.evaluate(() => window.__nomiCanvasStore.getState().nodes)
      const bound = nodes.filter(node => node.meta?.storyboardDesignId === DESIGN)
      report.confirmedInputs = bound.map(node => ({ id: node.id, kind: node.kind, prompt: node.prompt, meta: node.meta }))
      check(bound.length === 2 && bound.some(node => node.kind === 'image' && node.meta?.modelKey === IMAGE_MODEL
        && node.meta?.modelVendor === VENDOR && node.meta?.archetype?.modeId === 't2i')
        && bound.some(node => node.kind === 'video' && node.meta?.modelKey === VIDEO_MODEL
          && node.meta?.modelVendor === VENDOR && node.meta?.archetype?.modeId === 'first'),
      '确认前原首帧与视频节点使用指定模型和模式', JSON.stringify(report.confirmedInputs))
    }
    await snap(win, 'original-confirmation')
    await clickOrFail(spend.getByRole('button', { name: '生成', exact: true }), '确认生成')
  }
  await expect.poll(() => wireCalls.length, { message: '供应商收到请求（挂住未回）', timeout: stationTimeout({ operations: 2 }) }).toBe(mode === 'storyboard-batch' ? 6 : 1)
  const expectedNodes = mode === 'variants' ? 1 : expectedRequests
  await expect.poll(() => readCanvas(rootA).nodes.filter(node => mode.startsWith('storyboard-')
    ? node.meta?.storyboardDesignId === DESIGN : node.id === nodeId).length,
  { message: '原动作创建的全部绑定节点已持久化', timeout: stationTimeout({ operations: 2 }) }).toBe(expectedNodes)
  const initialGraph = readCanvas(rootA)
  const approvedNodeIds = mode.startsWith('storyboard-') ? initialGraph.nodes.filter(node => node.meta?.storyboardDesignId === DESIGN).map(node => node.id) : [nodeId]
  report.projectA = projectA
  report.approvedNodeIds = approvedNodeIds
  if (!nodeId) nodeId = initialGraph.nodes.find(node => approvedNodeIds.includes(node.id) && node.kind === 'image')?.id ?? approvedNodeIds[0]
  check(approvedNodeIds.length === (mode === 'variants' ? 1 : expectedRequests), '原动作创建预期数量的绑定节点')
  check(wireCalls[0].prompt.includes(PROMPT), '请求就是 A 节点的提示词')
  if (!mode.startsWith('storyboard-')) await expect(win.locator(`[data-node-id="${nodeId}"]`)).toHaveAttribute('data-status', /queued|running/)
  await snap(win, 'a-generation-in-flight')

  // ── 幕二 · 请求在途时切到新项目 B ───────────────────────────────────────────────
  await backToLibrary(win)
  const projectB = await newBlankProject(win)
  check(projectB !== projectA, '切到的是另一个项目')
  const rootB = await projectRoot(win, projectB)
  const bNodesProbe = await proveProbe(win.locator('.generation-canvas-v2__stage'), 'B 的画布舞台已渲染（节点缺席断言有信号）')
  const bDocument = await win.evaluate(() => window.__nomiCanvasStore.getState().readDocumentSnapshot())
  await expect.poll(() => readCanvas(rootB), { message: 'B 初始化自动保存完成后再放行 A 的供应商响应' }).toMatchObject(bDocument)
  const bCanvasBefore = readCanvas(rootB)
  report.projectB = projectB
  report.bCanvasBefore = bCanvasBefore
  report.bCanvasSha256Before = canvasSha256(bCanvasBefore)
  const bFilesBefore = mediaFiles(rootB)

  // 放行供应商：结果必须回 A，不能落进正打开的 B。
  releaseSubsequent = true
  heldResponses.splice(0).forEach((release) => release())
  await expect.poll(() => wireCalls.length, { message: '已批准后续请求继续执行', timeout: stationTimeout({ operations: expectedRequests + 2 }) }).toBe(expectedRequests)
  await expect.poll(() => readCanvas(rootA).nodes.filter(node => approvedNodeIds.includes(node.id)).every(node => node.status === 'success' && (node.runs ?? []).filter(run => run.status === 'success').length === (mode === 'variants' ? 3 : 1)), { message: '全部批准结果落原项目', timeout: stationTimeout({ operations: expectedRequests + 2 }) }).toBe(true)
  const completedNodes = readCanvas(rootA).nodes.filter(node => approvedNodeIds.includes(node.id))
  check(completedNodes.length === approvedNodeIds.length && completedNodes.every(node => node.runs.every(run => run.projectId === projectA)), '所有执行记录归原项目A')
  report.completed = completedNodes.map(node => ({ id: node.id, kind: node.kind, result: node.result, runs: node.runs }))
  await expect.poll(() => readCanvas(rootA).nodes.find((node) => node.id === nodeId)?.status,
    { message: 'A 在后台（盘上副本）收到成功结局', timeout: stationTimeout({ operations: 4 }) }).toBe('success')
  const deliveredA = readCanvas(rootA).nodes.find((node) => node.id === nodeId)
  const resultUrl = String(deliveredA?.result?.url || '')
  check(Boolean(resultUrl) && !resultUrl.startsWith('data:'), 'A 节点结果已本地化为项目素材', resultUrl.slice(0, 80))
  const aFiles = Object.keys(mediaFiles(rootA))
  check(aFiles.some((file) => /\.(jpe?g|png|webp)$/i.test(file)), 'A 项目目录里有这张图', aFiles.join(','))

  await expectAbsent(win.locator('.react-flow__node'), { provenBy: bNodesProbe, message: 'B 画布上没有冒出任何节点' })
  report.bCanvasAfter = readCanvas(rootB)
  report.bCanvasSha256After = canvasSha256(report.bCanvasAfter)
  check(report.bCanvasSha256After === report.bCanvasSha256Before, 'B 的盘上完整画布 SHA-256 零变化')
  check(JSON.stringify(mediaFiles(rootB)) === JSON.stringify(bFilesBefore), 'B 项目媒体文件零变化')
  check(wireCalls.length === expectedRequests, '执行次数与确认数量一致，切项目没有重发或少发')
  check(wireCalls.every(call => call.prompt.includes(PROMPT)), '全部请求只使用原项目A的提示词')
  if (mode === 'storyboard-first-frame') {
    const video = completedNodes.find(node => node.kind === 'video')
    const frame = completedNodes.find(node => node.meta?.storyboardKeyframe === true)
    check(Boolean(video && frame && readCanvas(rootA).edges.some(edge => edge.source === frame.id && edge.target === video.id && edge.mode === 'first_frame')), '原首帧节点稳定绑定原视频节点')
    check(wireCalls.some(call => call.route === '/v1/videos/generations' && call.firstFrameSha256 === crypto.createHash('sha256').update(imageDataUrl).digest('hex')), '供应商实际收到同批首帧JPEG字节')
    check(Object.keys(mediaFiles(rootA)).some(file => /\.mp4$/i.test(file)), '真实MP4响应字节本地化到A')
  }
  await snap(win, 'b-untouched-after-a-result')

  // ── 幕三 · 回到 A：节点上就是结果 ───────────────────────────────────────────────
  await backToLibrary(win)
  await openFromLibrary(win, projectA)
  await clickOrFail(win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }), '切到生成区')
  await expect(win.locator(`[data-node-id="${nodeId}"]`), '回到 A 节点显示成功').toHaveAttribute('data-status', 'success', { timeout: stationTimeout({ operations: 2 }) })
  await expect(win.locator(`[data-node-id="${nodeId}"] img`).first(), 'A 节点上看得见生成图').toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
  await snap(win, 'a-result-on-return')

  // ── 幕四 · 截图热键：A 里抓屏后切到 B，截图不落 B ─────────────────────────────
  const screenAccess = mode !== 'single' ? 'not-in-this-mode' : await app.evaluate(async ({ systemPreferences }) => {
    try { return process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted' } catch { return 'unknown' }
  })
  if (screenAccess !== 'granted') {
    report.screenshotHotkey = mode === 'single' ? `skipped: screen recording permission is ${screenAccess} for the development Electron binary` : 'not-run: this mode verifies approved generation continuation only'
    console.log(`  · ${report.screenshotHotkey}`)
  } else {
    const aFilesBefore = new Set(Object.keys(mediaFiles(rootA)))
    await win.evaluate(() => window.nomiDesktop.screenshot.e2eCapture())
    const crop = win.locator('[data-screenshot-crop]')
    await expect(crop, 'A 里抓屏弹出选区面板').toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
    const aNewFiles = Object.keys(mediaFiles(rootA)).filter((file) => !aFilesBefore.has(file))
    check(aNewFiles.some((file) => /screenshot-\d+\.png$/.test(file)), '整屏原图落进 A 的素材', aNewFiles.join(','))
    const cropProbe = await proveProbe(crop, '选区面板在 A 里确实可见')
    await win.keyboard.press('Escape')
    await expectAbsent(crop, { provenBy: cropProbe, message: 'Esc 关闭选区面板' })
    await backToLibrary(win)
    await openFromLibrary(win, projectB)
    await clickOrFail(win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }), '切到生成区')
    await expectAbsent(crop, { provenBy: cropProbe, message: 'B 里不会弹出 A 的选区面板' })
    check(canvasSha256(readCanvas(rootB)) === report.bCanvasSha256Before && JSON.stringify(mediaFiles(rootB)) === JSON.stringify(bFilesBefore), '截图后切到 B：B 完整画布与媒体文件仍零变化')
    // 抓屏在途时就切项目：不等 e2eCapture 返回，立刻回项目库打开 B。无论抓屏赶在切走前还是后完成，
    // B 都不能弹面板、不能多文件；A 是否多一张原图只记录不判定（取决于 desktopCapturer 快慢）。
    await backToLibrary(win)
    await openFromLibrary(win, projectA)
    await clickOrFail(win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }), '切到生成区')
    const aBeforeRace = new Set(Object.keys(mediaFiles(rootA)))
    const inFlightCapture = win.evaluate(() => window.nomiDesktop.screenshot.e2eCapture().then(() => 'ok', (error) => String(error)))
    await backToLibrary(win)
    await openFromLibrary(win, projectB)
    report.screenshotRaceCaptureResult = await inFlightCapture
    await clickOrFail(win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }), '切到生成区')
    await expectAbsent(crop, { provenBy: cropProbe, message: '抓屏在途切到 B：B 里不弹选区面板' })
    check(canvasSha256(readCanvas(rootB)) === report.bCanvasSha256Before && JSON.stringify(mediaFiles(rootB)) === JSON.stringify(bFilesBefore), '抓屏在途切到 B：B 完整画布与媒体文件零变化')
    report.screenshotRaceNewFilesInA = Object.keys(mediaFiles(rootA)).filter((file) => !aBeforeRace.has(file))
    report.screenshotHotkey = 'passed'
    await snap(win, 'b-after-screenshot-in-a')
  }

  check(wireCalls.length === expectedRequests, '返回原项目未产生新请求')
  if (mode.startsWith('storyboard-')) {
    await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '返回原分镜工作区')
    await clickOrFail(win.locator(`[data-storyboard-id="${DESIGN}"]`), '返回原方案')
    await expect(win.locator('[data-storyboard-editor="true"]')).toBeVisible()
    await snap(win, 'original-editor-results-on-return')
  }
  check(pageErrors.length === 0, '页面无 pageerror', pageErrors.join(' | '))
  report.result = 'passed'
  console.log('PROJECT SWITCH BACKGROUND RUN WALK: PASS')
} catch (error) {
  report.result = 'failed'
  report.error = String(error?.stack || error)
  await win.screenshot({ path: path.join(shotsDir, 'failure.png') }).catch(() => {})
  throw error
} finally {
  heldResponses.splice(0).forEach((release) => release())
  fs.writeFileSync(path.join(shotsDir, 'report.json'), JSON.stringify(report, null, 2))
  await app.close().catch(() => {})
  await new Promise((resolve) => vendorServer.close(resolve))
}
