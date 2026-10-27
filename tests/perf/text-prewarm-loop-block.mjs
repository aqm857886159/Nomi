#!/usr/bin/env node
// 预热「调一次模型」核心时，主进程被同步占住多久（设计卡 docs/plan/2026-10-21-text-tasks-to-pi-ai.md ★7，协调 10-21 要求）。
//
// 为什么量它：pi-ai 入口的装载里，模块解析 / 编译 / 求值是同步的。预热若一口气占住主进程几百毫秒，正好撞上用户打开项目或拖画布，
// 那时所有 IPC 回话都得排队。量的是「最长的那一次阻塞」，不是预热总耗时——总耗时长但切得碎（每段都让出事件循环）不卡人。
//
// 尺子：1ms 定时器链，记相邻两次回调的最大间隔（任何同步阻塞都会撑大它）。Node 里另附 perf_hooks.monitorEventLoopDelay 的 max 对照；
// Electron 主进程的 libuv 由 Chromium 的消息循环代泵，monitorEventLoopDelay 在那里几乎采不到样（实测一次预热只有十几个采样），只认定时器链。
//
// 两种宿主：
//   · 默认（node）：全新 Node 子进程、运行时模块已在，直接调预热入口（dist-electron/ai/modelCallBridge.js 的 prewarmModelCall）。
//   · --electron：真 App（launchNomiApp，隔离 profile）。起来后点开一个约 100 节点的项目，等打开收停，点选一个图片节点（提示词底栏出来），
//     再像真人一样把指针移到底栏的「优化」上——**不替它调预热**，等产品自己的触发（指针移进 / 焦点进文本动作 → 渲染层空闲回调 → nomi:tasks:text:prewarm，
//     src/workbench/api/textActionIntent.ts）；主进程 User Timing 里的「nomi:text-model-prewarm」给出预热那一段，
//     量这一段里定时器链的最大间隔，并记从指针移进到预热开始隔了多久、打开项目期间有没有提前触发。
// 量编译产物：node 宿主先 `pnpm build:electron`，electron 宿主先 `pnpm run build`。零花费、不出网、不碰真实 profile。
//
// 用法：node tests/perf/text-prewarm-loop-block.mjs --runs 10 [--electron] [--label <label>]
// 结果：tests/perf/results/text-prewarm-loop-block-<label>.json，终端打印中位数 / 最大值。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..')
const dist = path.join(repoRoot, 'dist-electron')
const argv = process.argv.slice(2)
const arg = (name, fallback) => { const index = argv.indexOf(`--${name}`); return index >= 0 ? argv[index + 1] : fallback }
const PREWARM_MEASURE = 'nomi:text-model-prewarm'
const round = (value) => Math.round(value * 10) / 10

async function nodeChild() {
  const require = createRequire(import.meta.url)
  require(path.join(dist, 'runtime.js'))
  const { prewarmModelCall } = require(path.join(dist, 'ai', 'modelCallBridge.js'))
  // 先让运行时模块装载造成的阻塞过去，再开表：只量预热这一段。
  await new Promise((resolve) => setTimeout(resolve, 200))
  const histogram = monitorEventLoopDelay({ resolution: 1 })
  histogram.enable()
  let last = performance.now(); let maxGapMs = 0; let stop = false
  const tick = () => { const now = performance.now(); maxGapMs = Math.max(maxGapMs, now - last); last = now; if (!stop) setTimeout(tick, 1) }
  setTimeout(tick, 1)
  const started = performance.now()
  // 点名与本机最常见的接法一致：只接了 OpenAI 兼容（中转站）的文本模型。
  await prewarmModelCall(['openai-compatible'])
  const totalMs = performance.now() - started
  await new Promise((resolve) => setTimeout(resolve, 20))
  histogram.disable()
  stop = true
  process.stdout.write(`${JSON.stringify({ maxBlockMs: round(maxGapMs), histogramMaxMs: round(histogram.max / 1e6), totalMs: Math.round(totalMs) })}\n`)
}

async function electronOnce() {
  const { launchNomiApp, closeNomiApp } = await import('../ux/_launchApp.mjs')
  const { makeTempDir, cleanupTestTemp } = await import('../../scripts/_test-temp.mjs')
  const { createCanvasPerformanceFixture } = await import('../ux/fixtures/canvas-performance-fixture.mjs')
  const root = makeTempDir('nomi-text-prewarm-')
  const projectsDir = path.join(root, 'projects')
  const userDataDir = path.join(root, 'user-data')
  fs.mkdirSync(userDataDir, { recursive: true })
  const fixture = createCanvasPerformanceFixture({ projectsDir, scale: 'MIMG', projectId: 'project-text-prewarm', projectName: 'ZZ 预热量具', withProjectIdentity: true })
  const { app, win } = await launchNomiApp({
    name: 'text-prewarm-loop-block', userDataDir, settingsDir: userDataDir, projectsDir, settleMs: 900,
    args: ['--no-proxy-server', '--disable-features=CalculateNativeWinOcclusion'],
    mainRequire: [path.join(repoRoot, 'tests', 'ux', '_quietWalk.cjs')],
    initialLocalStorage: { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' },
  })
  try {
    // 主进程里挂定时器链：记每一次超过 10ms 的间隔（结束时刻 + 长度），交给下面按预热那一段去截。
    await app.evaluate(() => {
      const probe = { gaps: [], stop: false }
      globalThis.__nomiPrewarmGapProbe = probe
      let last = performance.now()
      const tick = () => { const now = performance.now(); if (now - last > 10) probe.gaps.push({ endAt: now, gapMs: now - last }); last = now; if (!probe.stop) setTimeout(tick, 1) }
      setTimeout(tick, 1)
    })
    const card = win.locator(`[data-project-card][data-project-id="${fixture.record.id}"]`).first()
    await card.waitFor({ timeout: 30_000 })
    await card.click()
    // 打开收停，点选一个图片节点、底栏（带优化 / 翻译）挂上：只挂上、不碰，预热不该开火。
    const node = win.locator('.react-flow__node').first()
    await node.waitFor({ timeout: 30_000 })
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    await node.click()
    const optimize = win.locator('.generation-canvas-v2-node__composer [data-prompt-tool="optimize"]:visible').first()
    await optimize.waitFor({ timeout: 30_000 })
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    const firedOnMount = await app.evaluate((_electron, name) => performance.getEntriesByName(name).length > 0, PREWARM_MEASURE)
    const hoverAt = await app.evaluate(() => performance.now())
    await optimize.hover()
    const deadline = Date.now() + 30_000
    let measure = null
    while (!measure && Date.now() < deadline) {
      measure = await app.evaluate((_electron, name) => {
        const entry = performance.getEntriesByName(name)[0]
        return entry ? { startTime: entry.startTime, duration: entry.duration, protocols: entry.detail?.protocols ?? null } : null
      }, PREWARM_MEASURE)
      if (!measure) await new Promise((resolve) => setTimeout(resolve, 200))
    }
    if (!measure) throw new Error('指针移到「优化」上 30 秒内没有触发文本模型预热')
    await new Promise((resolve) => setTimeout(resolve, 100))
    const gaps = await app.evaluate(() => { const probe = globalThis.__nomiPrewarmGapProbe; probe.stop = true; return probe.gaps })
    const end = measure.startTime + measure.duration
    const during = gaps.filter((gap) => gap.endAt - gap.gapMs < end && gap.endAt > measure.startTime)
    return {
      maxBlockMs: round(Math.max(0, ...during.map((gap) => gap.gapMs))),
      totalMs: Math.round(measure.duration),
      firedOnMount,
      hoverToPrewarmMs: Math.round(measure.startTime - hoverAt),
      protocols: measure.protocols,
    }
  } finally {
    await closeNomiApp(app)
    try { cleanupTestTemp(root) } catch (error) { console.warn(`临时目录没删干净（不影响这一轮的数）：${root}：${error.message}`) }
  }
}

function percentile(sorted, p) {
  const index = (sorted.length - 1) * p
  const low = Math.floor(index)
  const high = Math.ceil(index)
  return round(sorted[low] + (sorted[high] - sorted[low]) * (index - low))
}

async function main() {
  if (!fs.existsSync(path.join(dist, 'ai', 'modelCallBridge.js'))) throw new Error('dist-electron 不在：先跑 pnpm build:electron（electron 宿主先 pnpm run build）')
  const runs = Number(arg('runs', '10'))
  const inElectron = argv.includes('--electron')
  const label = arg('label', inElectron ? 'electron' : 'node')
  const samples = []
  for (let index = 0; index < runs; index += 1) {
    let sample
    if (inElectron) sample = await electronOnce()
    else {
      const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child'], { cwd: repoRoot, encoding: 'utf8' })
      if (result.status !== 0) throw new Error(`child failed: ${result.stderr}`)
      sample = JSON.parse(result.stdout.trim().split('\n').at(-1))
    }
    samples.push(sample)
    console.log(`run ${index + 1}/${runs}: 最长阻塞 ${sample.maxBlockMs}ms，预热总耗时 ${sample.totalMs}ms${sample.hoverToPrewarmMs === undefined ? '' : `，${sample.firedOnMount ? '⚠ 打开项目时就触发了；' : ''}指针移进后 ${sample.hoverToPrewarmMs}ms 开始预热（装了 ${(sample.protocols || []).join(' / ') || '只装核心'}）`}${sample.histogramMaxMs === undefined ? '' : `（直方图对照 ${sample.histogramMaxMs}ms）`}`)
  }
  const blocks = samples.map((sample) => sample.maxBlockMs).sort((a, b) => a - b)
  const totals = samples.map((sample) => sample.totalMs).sort((a, b) => a - b)
  const summary = {
    maxBlockMs: { median: percentile(blocks, 0.5), max: blocks.at(-1) },
    totalMs: { median: percentile(totals, 0.5), max: totals.at(-1) },
  }
  const out = path.join(repoRoot, 'tests/perf/results', `text-prewarm-loop-block-${label}.json`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, `${JSON.stringify({ label, runs, host: inElectron ? 'electron-main' : 'node', samples, summary }, null, 2)}\n`)
  console.log(`\n最长阻塞：中位 ${summary.maxBlockMs.median}ms，最大 ${summary.maxBlockMs.max}ms；预热总耗时：中位 ${summary.totalMs.median}ms，最大 ${summary.totalMs.max}ms → ${path.relative(repoRoot, out)}`)
}

if (argv.includes('--child')) await nodeChild()
else await main()
