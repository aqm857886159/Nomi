// 真实规模性能跑器：打开项目分阶段计时（路由表 scale 类 perf-real-scale 的底座，docs/engineering/test-routing.json）。
//
// 量什么：点项目卡 → 画布出现 → 第一张图解码，拆成阶段（产品代码里的 User Timing 打点，开关见
// src/workbench/project/projectOpenTimeline.ts 和 electron/projects/projectOpenTimeline.ts），外加：
//   · 打开期间主进程的写盘调用（tests/ux/perf/openWriteProbe.cjs）——打开项目是读，不该写盘；
//   · 渲染层长任务（PerformanceObserver longtask）；
//   · 进程内存（app.getAppMetrics）。
// 两种打开：cold = 新起 App 后第一次打开（用户每天早上那一下）；reopen = 回项目库再打开同一个项目。
// 项目先用一次「迁移打开」落成稳定态（像用户自己的老项目），之后每轮都是稳定态，不把一次性迁移算进去。
//
// 用法（先 pnpm run build）：
//   node tests/ux/project-open-stages.e2e.mjs <label> [--scale I300] [--runs 5] [--warmup 1] [--exe <打包好的 Nomi.exe>] [--onscreen] [--assert-read-only]
// 结果：tests/ux/perf-results/project-open-<label>.json，终端打印中位数 / p95 表。
// 窗口默认挂屏幕外、不抢焦点；只用临时目录，不碰真实 profile；零花费（不发任何生成请求）。
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp, closeNomiApp } from './_launchApp.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { createCanvasPerformanceFixture } from './fixtures/canvas-performance-fixture.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..')
const args = process.argv.slice(2)
const argValue = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined }
const label = args.find((arg, index) => !arg.startsWith('-') && !args[index - 1]?.startsWith('--')) || 'run'
const scale = argValue('--scale') || 'I300'
const runs = Math.max(1, Number(argValue('--runs') || 5))
const warmup = Math.max(0, Number(argValue('--warmup') || 1))
const executablePath = argValue('--exe')
const onscreen = args.includes('--onscreen')
const assertReadOnly = args.includes('--assert-read-only')
const OPEN_TIMEOUT_MS = 90_000
const SETTLE_AFTER_MEDIA_MS = 3_000

const PREFIX = 'nomi:open:'
const MAIN_PREFIX = 'nomi:open:main:'
const FIRST_RUN_SEEN = { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' }

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-open-stages-'))
const projectsDir = path.join(root, 'projects')
const userDataDir = path.join(root, 'user-data')
fs.mkdirSync(userDataDir, { recursive: true })
const fixture = createCanvasPerformanceFixture({ projectsDir, scale, projectId: `project-open-stages-${scale.toLowerCase()}`, projectName: `ZZ 打开分阶段 ${scale}` })
// 夹具是测试直接写的盘，没有 App 建项目时就会落下的项目身份（主清单 + 备份）。不补的话，启动时后台补身份会改写清单，
// 和项目库首次核对同步基线撞车，卡片显示「发现另一台电脑的项目更新」、点了不打开。用户的真实项目生来就有身份。
{
  const manifestPath = path.join(fixture.projectRoot, '.nomi', 'project.json')
  const settled = { ...JSON.parse(fs.readFileSync(manifestPath, 'utf8')), immutableProjectUuid: crypto.randomUUID(), projectGeneration: 1 }
  fs.writeFileSync(manifestPath, `${JSON.stringify(settled, null, 1)}
`)
  fs.writeFileSync(path.join(fixture.projectRoot, '.nomi', 'project.backup.json'), `${JSON.stringify(settled, null, 1)}
`)
}

async function launch() {
  return launchNomiApp({
    name: 'project-open-stages',
    ...(executablePath ? { executablePath } : {}),
    userDataDir,
    settingsDir: userDataDir,
    projectsDir,
    // Windows 把屏幕外窗口判成被遮挡、停掉渲染帧；关掉遮挡判定，量到的才是真的。
    args: ['--no-proxy-server', ...(onscreen ? [] : ['--disable-features=CalculateNativeWinOcclusion'])],
    mainRequire: [path.join(here, 'perf', 'openWriteProbe.cjs'), ...(onscreen ? [] : [path.join(here, '_offscreenWindows.cjs')])],
    initialLocalStorage: { ...FIRST_RUN_SEEN, 'nomi:perf-marks': '1' },
    env: { NOMI_PERF_MARKS: '1' },
    settleMs: 900,
  })
}

async function pollUntil(page, predicate, arg, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await page.evaluate(predicate, arg).catch(() => false)) return
    if (Date.now() > deadline) {
      const seen = await page.evaluate(() => performance.getEntries().filter((entry) => entry.name.startsWith('nomi:open:')).map((entry) => entry.name)).catch((error) => String(error))
      const shot = path.join(os.tmpdir(), `project-open-stages-timeout-${Date.now()}.png`)
      await page.screenshot({ path: shot }).catch(() => {})
      throw new Error(`打开项目超时（${timeoutMs}ms）；已记到的阶段：${JSON.stringify(seen)}；截图：${shot}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

async function openOnce(app, page, kind) {
  const card = page.locator(`[data-project-card][data-project-id="${fixture.record.id}"]`).first()
  await card.waitFor({ timeout: stationTimeout({ operations: 2 }) })
  await new Promise((resolve) => setTimeout(resolve, 1_000))
  await page.evaluate(() => {
    window.__openLongTasks = []
    window.__openLongTaskObserver?.disconnect()
    window.__openLongTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__openLongTasks.push(Math.round(entry.duration))
    })
    window.__openLongTaskObserver.observe({ type: 'longtask' })
  })
  await app.evaluate((_electron, prefix) => {
    for (const entry of performance.getEntriesByType('measure')) if (entry.name.startsWith(prefix)) performance.clearMeasures(entry.name)
    globalThis.__nomiOpenWriteProbe.arm()
  }, MAIN_PREFIX)
  const clickedAt = Date.now()
  await card.click()
  await pollUntil(page, (prefix) => ['first-media-decoded', 'flow-nodes-mounted']
    .every((moment) => performance.getEntriesByName(`${prefix}to:${moment}`).length > 0), PREFIX, OPEN_TIMEOUT_MS)
  const clickToMediaMs = Date.now() - clickedAt
  await new Promise((resolve) => setTimeout(resolve, SETTLE_AFTER_MEDIA_MS))
  const writes = await app.evaluate(() => globalThis.__nomiOpenWriteProbe.take())
  const main = await app.evaluate((_electron, prefix) => performance.getEntriesByType('measure')
    .filter((entry) => entry.name.startsWith(prefix))
    .map((entry) => ({ name: entry.name.slice(prefix.length), ms: entry.duration })), MAIN_PREFIX)
  const renderer = await page.evaluate((prefix) => ({
    measures: performance.getEntriesByType('measure').filter((entry) => entry.name.startsWith(prefix))
      .map((entry) => ({ name: entry.name.slice(prefix.length), ms: entry.duration })),
    longTasks: window.__openLongTasks || [],
  }), PREFIX)
  const metrics = await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics()
    .map((metric) => ({ type: metric.type, workingSetKB: metric.memory?.workingSetSize ?? null })))
  const stages = {}
  for (const { name, ms } of renderer.measures) stages[name] = (stages[name] || 0) + ms
  for (const { name, ms } of main) stages[`main:${name}`] = (stages[`main:${name}`] || 0) + ms
  return {
    kind,
    clickToMediaMs,
    stages,
    longTaskCount: renderer.longTasks.length,
    longTaskMs: renderer.longTasks.reduce((sum, value) => sum + value, 0),
    writes: summarizeWrites(writes),
    workingSetMB: Math.round(metrics.reduce((sum, metric) => sum + (metric.workingSetKB || 0), 0) / 1024),
  }
}

function summarizeWrites(events) {
  const shortTarget = (target) => target.startsWith('fd:') ? target : target.split(/[\\/]/).slice(-2).join('/').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, '*')
  const byOp = {}
  for (const event of events) byOp[event.op] = (byOp[event.op] || 0) + 1
  return {
    total: events.length,
    fsync: (byOp.fsyncSync || 0) + (byOp.fdatasyncSync || 0),
    byOp,
    targets: [...new Set(events.filter((event) => !event.target.startsWith('fd:')).map((event) => `${event.op} ${shortTarget(event.target)}`))],
    firstFrames: events.slice(0, 40).map((event) => ({ op: event.op, target: shortTarget(event.target), frames: event.frames })),
  }
}

async function backToLibrary(page) {
  const back = page.getByRole('button', { name: /返回项目库|Back to projects/ }).first()
  await back.click()
}

function percentile(sorted, p) {
  if (!sorted.length) return null
  const index = (sorted.length - 1) * p
  const low = Math.floor(index)
  const high = Math.ceil(index)
  return Math.round((sorted[low] + (sorted[high] - sorted[low]) * (index - low)) * 10) / 10
}

function summarize(samples) {
  const keys = new Set(['clickToMediaMs', 'longTaskMs', 'writes.total', 'writes.fsync', 'workingSetMB'])
  for (const sample of samples) for (const key of Object.keys(sample.stages)) keys.add(`stages.${key}`)
  const read = (sample, key) => key.split('.').reduce((value, part) => value?.[part], sample) ?? (key.startsWith('stages.') ? null : 0)
  const out = {}
  for (const key of keys) {
    const values = samples.map((sample) => read(sample, key)).filter((value) => typeof value === 'number').sort((a, b) => a - b)
    out[key] = { n: values.length, median: percentile(values, 0.5), p95: percentile(values, 0.95) }
  }
  return out
}

const results = { label, scale, runs, warmup, executable: executablePath || 'dev-electron', platform: process.platform, startedAt: new Date().toISOString(), fixture: fixture.summary, samples: [] }
try {
  // 迁移打开：夹具是测试写的，第一次打开会走一次性迁移（补身份、补字段）。用户自己的老项目早就是稳定态。
  {
    const { app, win } = await launch()
    try { results.migrationOpen = await openOnce(app, win, 'migration') } finally { await closeNomiApp(app) }
  }
  for (let index = 0; index < warmup + runs; index += 1) {
    const { app, win } = await launch()
    try {
      const cold = await openOnce(app, win, 'cold')
      await backToLibrary(win)
      const reopen = await openOnce(app, win, 'reopen')
      if (index >= warmup) results.samples.push(cold, reopen)
      console.log(`run ${index + 1}/${warmup + runs}${index < warmup ? '（预热，不计）' : ''}: cold ${cold.clickToMediaMs}ms（写盘 ${cold.writes.total}，fsync ${cold.writes.fsync}） · reopen ${reopen.clickToMediaMs}ms（写盘 ${reopen.writes.total}，fsync ${reopen.writes.fsync}）`)
    } finally {
      await closeNomiApp(app)
    }
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

results.summary = {
  cold: summarize(results.samples.filter((sample) => sample.kind === 'cold')),
  reopen: summarize(results.samples.filter((sample) => sample.kind === 'reopen')),
}
const outDir = path.join(repoRoot, 'tests/ux/perf-results')
fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, `project-open-${label}.json`)
fs.writeFileSync(outFile, `${JSON.stringify(results, null, 1)}\n`)

const rows = [...new Set([...Object.keys(results.summary.cold), ...Object.keys(results.summary.reopen)])].sort()
console.log(`\n| 指标 | cold 中位数 | cold p95 | reopen 中位数 | reopen p95 |\n|---|---:|---:|---:|---:|`)
for (const key of rows) {
  const cold = results.summary.cold[key] || {}
  const reopen = results.summary.reopen[key] || {}
  console.log(`| ${key} | ${cold.median ?? '-'} | ${cold.p95 ?? '-'} | ${reopen.median ?? '-'} | ${reopen.p95 ?? '-'} |`)
}
console.log(`\n结果：${outFile}`)

if (assertReadOnly) {
  const offenders = results.samples.filter((sample) => sample.writes.fsync > 0)
  if (offenders.length) {
    console.error(`\n打开稳定态项目仍在 fsync（读路径在写盘）：${offenders.map((sample) => `${sample.kind}:${sample.writes.fsync}`).join('，')}`)
    console.error(JSON.stringify(offenders[0].writes.firstFrames.filter((event) => /fsync/.test(event.op)).slice(0, 5), null, 1))
    process.exitCode = 1
  }
}
