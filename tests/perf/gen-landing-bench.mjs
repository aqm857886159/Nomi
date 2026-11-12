#!/usr/bin/env node
// 生成落地·8 张同时（设计卡 docs/plan/2026-11-12-gen-landing-stall-cut1.md ★7）。
// 创作者那一刻：60 张图的画布上一次点了 8 张图，图陆续落地的那几秒主进程不能被「每张图的记账」占住。
// 真 Electron、隔离资料、屏幕外窗口；假上游起在 127.0.0.1（网络闸只放行本机），图是本脚本用打包自带的 ffmpeg 现做的 4096² PNG。
// 零花费、零外网。每一轮：新建 8 张图片卡逐张点「生成」（点生成段）→ 等 2 秒 → 假上游同时放行 8 张，到 8 张卡都成功、图都解出来再多量 1.5 秒（落地段）。
// 主进程仪表 tests/perf/gen-landing/landingCounters.cjs 记三个确定性计数和事件循环延迟最大值：
//   · landingDirManifestReads：落地段里为找项目目录而读项目文件（.nomi/project.json）的次数；
//   · landingSyncIpcCalls：点生成段 + 落地段里渲染层发往主进程的同步 IPC 次数（全部通道）；
//   · landingReceiptRereads：落地段里回执为算哈希整读产物文件的次数；
//   · landingSyncWork（主指标）= 上面三个之和，硬预算 0；landingMainStallMaxMs：落地段主进程事件循环延迟最大值（毫秒，只作参考）。
// 用法：node tests/perf/gen-landing-bench.mjs --runs 3 --out <结果.json> [--conc 8] [--scale I60]
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { launchNomiApp, closeNomiApp } from '../ux/_launchApp.mjs'
import { createCanvasPerformanceFixture } from '../ux/fixtures/canvas-performance-fixture.mjs'
import { createAgentRuntimeFixture, FIXTURE_VENDOR } from '../ux/agent-runtime-fixture.mjs'
import { findCanvasBlankPoint, revealArrivals } from '../ux/_canvasHit.mjs'
import { addCanvasNode } from '../ux/_shell.mjs'
import { uiText } from '../ux/full-walk/invariants.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const arg = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1] }
const runs = Number(arg('--runs', 3))
const output = arg('--out', '')
const conc = Number(arg('--conc', 8))
const scale = arg('--scale', 'I60')
if (!output || !Number.isInteger(runs) || runs < 1 || !Number.isInteger(conc) || conc < 1) throw new Error('Use --out <result.json> and positive --runs / --conc')

const load = () => Math.round(os.loadavg()[0] * 10) / 10
const tempRoot = makeTempDir('nomi-gen-landing-bench-')

// ── 图：4096² PNG，带噪声（压不小，大小和真实 4K 出图同一个量级）──
const ffmpeg = createRequire(import.meta.url)('@ffmpeg-installer/ffmpeg').path
const mediaFile = path.join(tempRoot, 'landing-4096.png')
const made = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=4096x4096,noise=alls=40:allf=t', '-frames:v', '1', mediaFile])
if (made.status !== 0) throw new Error(`ffmpeg could not make the landing image: ${made.stderr}`)
const mediaBytes = fs.readFileSync(mediaFile)

// ── 假上游：提交即受理，查询一直「running」，放行后回图地址 ──
const jobs = []
let released = new Set()
const server = http.createServer(async (request, response) => {
  if (request.url.startsWith('/media/')) {
    response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': mediaBytes.length })
    response.end(mediaBytes)
    return
  }
  response.setHeader('Content-Type', 'application/json')
  if (request.method === 'POST') {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const job = { id: `landing-${jobs.length}`, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    jobs.push(job)
    response.end(JSON.stringify({ id: job.id, status: 'running' }))
    return
  }
  const job = jobs.find((candidate) => request.url.endsWith(`/${candidate.id}`))
  if (!job) { response.writeHead(404).end('{}'); return }
  const done = released.has(job.id)
  response.end(JSON.stringify({ id: job.id, status: done ? 'succeeded' : 'running', ...(done ? { url: `http://127.0.0.1:${server.address().port}/media/${job.id}.png` } : {}) }))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const userDataDir = path.join(tempRoot, 'userData')
for (const dir of [settingsDir, projectsDir, userDataDir]) fs.mkdirSync(dir, { recursive: true })
const seed = await createAgentRuntimeFixture({ rootDir: repoRoot, settingsDir })
await seed.close()
const catalogFile = path.join(settingsDir, 'model-catalog.json')
const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'))
catalog.vendors[0].baseUrlHint = `http://127.0.0.1:${server.address().port}`
catalog.models = catalog.models.filter((model) => model.kind === 'image')
catalog.mappings = [['agent-runtime-image', 'text_to_image'], ['agent-runtime-image', 'image_edit']].map(([modelKey, taskKind]) => ({
  id: `${modelKey}-${taskKind}`, vendorKey: FIXTURE_VENDOR, modelKey, taskKind, enabled: true, name: 'Landing loopback',
  create: { method: 'POST', path: '/jobs', headers: { 'Content-Type': 'application/json' }, body: { model: '{{model.modelKey}}', prompt: '{{request.prompt}}' }, response_mapping: { task_id: 'id', status: 'status' }, provider_meta_mapping: { task_id: 'id' } },
  query: { method: 'GET', path: '/jobs/{{providerMeta.task_id}}', response_mapping: { task_id: 'id', status: 'status', image_url: 'url' } },
}))
fs.writeFileSync(catalogFile, JSON.stringify(catalog))
const fixture = createCanvasPerformanceFixture({ projectsDir, scale, withProjectIdentity: true })

const metrics = { landingSyncWork: [], landingDirManifestReads: [], landingSyncIpcCalls: [], landingReceiptRereads: [], landingMainStallMaxMs: [] }
const samples = []
let failure
let app
const loads = [load()]
try {
  const launched = await launchNomiApp({
    name: 'gen-landing-bench', projectsDir, settingsDir, userDataDir, timeout: 120_000, viewportSize: { width: 1600, height: 1000 }, settleMs: 1200,
    args: ['--no-proxy-server', '--disable-features=CalculateNativeWinOcclusion'],
    mainRequire: [path.join(repoRoot, 'scripts', 'walkthrough-network-guard.cjs'), path.join(repoRoot, 'tests', 'perf', 'gen-landing', 'landingCounters.cjs')],
    initialLocalStorage: { 'nomi:locale:v1': 'zh-CN', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', __nomiE2E: '1' },
    env: { NOMI_DISABLE_AUTO_UPDATE: '1', NOMI_TEST_NETWORK_GUARD: '1' },
  })
  app = launched.app
  const page = launched.win
  const card = page.locator('[data-project-card]', { hasText: fixture.record.name }).first()
  await card.waitFor({ timeout: 30_000 })
  await card.click()
  await page.waitForTimeout(1200)
  const resume = page.locator('[data-project-card]', { hasText: fixture.record.name }).getByText(uiText('zh-CN', 'library.continueCreating')).first()
  if (await resume.count().catch(() => 0)) await resume.click().catch(() => {})
  await page.locator('.generation-canvas-v2__stage').waitFor({ timeout: 60_000 })
  await page.waitForTimeout(4000)
  const generate = uiText('zh-CN', 'generationCommon.composer.generateAsset')
  const blankClick = async () => { const point = await findCanvasBlankPoint(page).catch(() => null); if (point) await page.mouse.click(point.x, point.y).catch(() => {}) }

  for (let run = 0; run < runs; run += 1) {
    released = new Set()
    const before = jobs.length
    const nodeIdsBefore = await page.evaluate(() => (window.__nomiCanvasStore?.getState().nodes ?? []).map((node) => node.id))
    await app.evaluate(() => globalThis.__genLandingCounters.start('submit'))
    for (let index = 0; index < conc; index += 1) {
      const queued = jobs.length
      await addCanvasNode(page, 'image')
      await revealArrivals(page).catch(() => false)
      const editor = page.locator('[data-composer-host="canvas"] .ProseMirror[contenteditable="true"]:visible').first()
      await editor.waitFor({ timeout: 20_000 })
      await editor.fill(`landing ${run}-${index}: a lighthouse on a cliff at dawn, wide shot`)
      await page.locator('[data-composer-host="canvas"]').getByRole('button', { name: generate, exact: true }).first().click()
      const deadline = Date.now() + 30_000
      while (Date.now() < deadline && jobs.length <= queued) await sleep(20)
      if (jobs.length <= queued) throw new Error(`run ${run} card ${index + 1}: the loopback upstream never received the job`)
    }
    const submit = await app.evaluate(() => globalThis.__genLandingCounters.stop())
    const mine = jobs.slice(before).map((job) => job.id)
    const newNodeIds = await page.evaluate((previous) => (window.__nomiCanvasStore?.getState().nodes ?? []).map((node) => node.id).filter((id) => !previous.includes(id)), nodeIdsBefore)
    await page.keyboard.press('Escape').catch(() => {})
    await sleep(2000)

    await app.evaluate(() => globalThis.__genLandingCounters.start('landing'))
    const startedAt = Date.now()
    for (const id of mine) released.add(id)
    let landedMs = null
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      const state = await page.evaluate((ids) => {
        const nodes = (window.__nomiCanvasStore?.getState().nodes ?? []).filter((node) => ids.includes(node.id))
        const images = ids.map((id) => { const element = document.querySelector(`.react-flow__node[data-id="${id}"] img`); return element ? element.complete && element.naturalWidth > 0 : null })
        return { success: nodes.filter((node) => node.status === 'success').length, failed: nodes.filter((node) => node.status === 'error' || node.status === 'failed').length, imagesReady: images.every((ready) => ready !== false) }
      }, newNodeIds)
      if (state.failed) throw new Error(`run ${run}: ${state.failed} cards failed to land`)
      if (state.success >= newNodeIds.length && state.imagesReady) { landedMs = Date.now() - startedAt; break }
      await blankClick()
      await sleep(150)
    }
    if (landedMs === null) throw new Error(`run ${run}: the ${conc} cards did not all land within 120 s`)
    await sleep(1500)
    const landing = await app.evaluate(() => globalThis.__genLandingCounters.stop())
    const syncIpcCalls = [submit, landing].reduce((sum, window) => sum + Object.values(window.syncIpc).reduce((a, b) => a + b, 0), 0)
    metrics.landingDirManifestReads.push(landing.dirManifestReads)
    metrics.landingSyncIpcCalls.push(syncIpcCalls)
    metrics.landingReceiptRereads.push(landing.receiptRereads)
    metrics.landingSyncWork.push(landing.dirManifestReads + syncIpcCalls + landing.receiptRereads)
    metrics.landingMainStallMaxMs.push(landing.mainStallMaxMs)
    // 项目文件多大（老项目会更大；落地段里每多读它一次就多一份这么大的同步解析）。
    const projectFileBytes = fs.statSync(path.join(fixture.projectRoot, '.nomi', 'project.json')).size
    samples.push({ run, load1: load(), cards: newNodeIds.length, landedMs, projectFileBytes, submit, landing })
    loads.push(load())
    console.log(`[gen-landing] run ${run} load=${load()} landed=${landedMs}ms dirReads=${landing.dirManifestReads} (manifestReads ${landing.manifestReads}) syncIpc=${syncIpcCalls} ${JSON.stringify({ ...submit.syncIpc, ...landing.syncIpc })} receiptRereads=${landing.receiptRereads} projectFile=${projectFileBytes}B mainStallMax=${landing.mainStallMaxMs}ms submitStallMax=${submit.mainStallMaxMs}ms`)
    await sleep(800)
  }
} catch (error) {
  failure = error
} finally {
  await closeNomiApp(app).catch(() => {})
  server.closeAllConnections?.()
  server.close()
}

const report = {
  scope: `${scale} canvas, ${conc} image cards generated one by one then released together; ${mediaBytes.length} byte 4096x4096 PNG from a loopback upstream; real Electron main process`,
  date: new Date().toISOString(),
  machine: `${process.platform} ${process.arch} ${os.cpus()[0]?.model} x${os.cpus().length} / ${Math.round(os.totalmem() / 1024 ** 3)}GB`,
  node: process.version,
  // 三个计数是确定性的，与负载无关；毫秒受负载影响，load1 ≥ 10 记为有噪声。
  noisy: loads.some((value) => value >= 10),
  loads,
  runs,
  metrics,
  samples,
  ...(failure ? { failure: failure.message } : {}),
}
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true })
fs.writeFileSync(output, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ...metrics, loads }))
if (failure) { console.error(failure.stack || failure.message); process.exit(1) }
