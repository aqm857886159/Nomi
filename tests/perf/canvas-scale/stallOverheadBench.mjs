#!/usr/bin/env node
// 场景 main-stall-monitor-overhead 的量具：主进程卡顿监视器空闲时的开销（设计卡 ★7）。
// 真 Electron、隔离资料、窗口在屏幕外；同一个进程里把监视器关、开各量 60 秒，取差。为了抵消启动尾巴等随时间漂移的东西，
// 每种状态拆成两段 30 秒、按 关-开-开-关 / 开-关-关-开 轮流排（ABBA），各状态合计 60 秒：
//   · stallMonitorCpuMsPerSec    = 开 − 关 的主进程 CPU（process.cpuUsage 用户 + 内核），单位「每秒毫秒」：1 个百分点 = 每秒 10ms，预算 ≤0.2 个百分点 = ≤2.0。
//                                  登记表的统计函数只留一位小数，用百分点表示 0.2 以下分不出档，所以换了单位
//   · stallMonitorWakeupsPerSec  = 开 − 关 的每秒空闲唤醒（app.getAppMetrics 的 Browser 进程；Windows 上这个读数恒为 0，写 null）
//   · stallMonitorQuietWrites    = 两个空闲窗口里时间线文件的写盘次数（预算 0）；末尾注入一次 300ms 停顿，必须看到写盘计数 ≥1，
//                                  否则这一轮作废（窗内计数防空断言：docs/lessons/complexity-invariants-need-counters-not-wall-clock.md）。
// 关 / 开靠 stallInject.cjs 拿到产品创建的那份直方图后 disable() / enable()，产品代码里没有任何开关。
// 用法：node tests/perf/canvas-scale/stallOverheadBench.mjs --runs 5 --label x [--window-sec 60]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp, closeNomiApp } from '../../ux/_launchApp.mjs'
import { makeTempDir, cleanupTestTemp } from '../../../scripts/_test-temp.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../..')
const argv = process.argv.slice(2)
const arg = (name, fallback) => { const index = argv.indexOf(`--${name}`); return index >= 0 ? argv[index + 1] : fallback }
const RUNS = Number(arg('runs', 5))
const LABEL = arg('label', 'local')
const WINDOW_SEC = Number(arg('window-sec', 60)) // 每种状态合计多少秒；拆成两段
const SLOT_SEC = WINDOW_SEC / 2
const SETTLE_UPTIME_SEC = 45 // 主进程跑到这么久再开始量：启动尾巴（项目库加载、渲染层初始化）已过
const INJECT = path.join(here, 'stallInject.cjs')
const STARTUP_GRACE_SEC = 20
const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 主进程里读一次：累计 CPU（微秒）、Browser 进程的空闲唤醒读数、时间线写盘计数。 */
const readCounters = (app) => app.evaluate(({ app: electronApp }) => {
  const browser = electronApp.getAppMetrics().find((metric) => metric.type === 'Browser')
  const usage = process.cpuUsage()
  return { cpuMicros: usage.user + usage.system, wakeups: browser?.cpu.idleWakeupsPerSecond ?? 0, writes: globalThis.__nomiStallProbe.timelineWrites() }
})

async function measureSlot(app, enabled) {
  await app.evaluate((_electron, on) => globalThis.__nomiStallProbe.setMonitorEnabled(on), enabled)
  await sleep(3000) // 切换后让开关稳定一下
  const startedAt = Date.now()
  const before = await readCounters(app)
  await sleep(SLOT_SEC * 1000)
  const after = await readCounters(app)
  return { cpuMicros: after.cpuMicros - before.cpuMicros, wallMicros: (Date.now() - startedAt) * 1000, wakeups: after.wakeups, writes: after.writes - before.writes }
}

/** ABBA：两种状态各两段，按顺序量完后各自汇总成一个读数（CPU 按总耗时 / 总墙钟算，唤醒取两段的均值）。 */
async function measureConditions(app, order) {
  const sums = { on: { cpuMicros: 0, wallMicros: 0, wakeups: 0, slots: 0, writes: 0 }, off: { cpuMicros: 0, wallMicros: 0, wakeups: 0, slots: 0, writes: 0 } }
  for (const enabled of order) {
    const slot = await measureSlot(app, enabled)
    const bucket = sums[enabled ? 'on' : 'off']
    bucket.cpuMicros += slot.cpuMicros; bucket.wallMicros += slot.wallMicros; bucket.wakeups += slot.wakeups; bucket.slots += 1; bucket.writes += slot.writes
  }
  const summarize = (bucket) => ({ cpuPct: (bucket.cpuMicros / bucket.wallMicros) * 100, wakeups: bucket.wakeups / bucket.slots, writes: bucket.writes })
  return { on: summarize(sums.on), off: summarize(sums.off) }
}

/** 隔离资料里的时间线文件 → 行（只有白名单字段，可以直接进结果文件）。读不到给空数组。 */
function readTimelineRows(root) {
  try {
    const text = fs.readFileSync(path.join(root, 'user-data', 'logs', 'nomi-stall-timeline.log'), 'utf8')
    return text.split('\n').map((line) => line.replace(/^\[[^\]]*\]\s?/, '')).filter((line) => line.startsWith('{')).map((line) => JSON.parse(line))
  } catch { return [] }
}

async function oneRun(runIndex) {
  const root = makeTempDir('nomi-stall-overhead-')
  try {
    const { app } = await launchNomiApp({
      name: 'stall-overhead', tempRoot: root, mainRequire: [INJECT], settleMs: 900,
      initialLocalStorage: { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' },
    })
    try {
      const histograms = await app.evaluate(() => globalThis.__nomiStallProbe.histograms())
      if (histograms.length !== 1) throw new Error(`注入没包到产品的直方图：${JSON.stringify(histograms)}`)
      const uptime = await app.evaluate(() => globalThis.__nomiStallProbe.processUptimeSec())
      await sleep(Math.max(0, (Math.max(STARTUP_GRACE_SEC + 2, SETTLE_UPTIME_SEC) - uptime) * 1000)) // 启动期读数产品会丢弃，启动尾巴也要过去；窗口里才是稳态
      const onFirst = runIndex % 2 === 1
      const results = await measureConditions(app, onFirst ? [true, false, false, true] : [false, true, true, false])
      // 空闲窗口里写下过什么：真有 ≥100ms 的停顿（机器忙、别的进程抢走了 CPU）时写盘是对的，要看清楚是哪一行，不是一概当缺陷。
      const quietRows = readTimelineRows(root)
      // 防空断言：监视器打开着，注入一次 300ms 停顿，写盘计数必须涨——否则「0 次写盘」只是计数器坏了。
      await app.evaluate(() => globalThis.__nomiStallProbe.setMonitorEnabled(true))
      await sleep(1500) // 直方图刚打开时第一次触发只记起点、不记间隔：停顿要等它采过两次以后再注入，否则注入的那一次读不到
      const writesBefore = await app.evaluate(() => globalThis.__nomiStallProbe.timelineWrites())
      await app.evaluate(() => { globalThis.__nomiStallProbe.sleep(300) })
      let counterAlive = false
      for (let waited = 0; waited < 14_000 && !counterAlive; waited += 1000) {
        await sleep(1000)
        counterAlive = (await app.evaluate(() => globalThis.__nomiStallProbe.timelineWrites())) > writesBefore
      }
      const isWindows = process.platform === 'win32'
      return {
        run: runIndex,
        order: onFirst ? 'on-first' : 'off-first',
        resolutionMs: histograms[0].resolution,
        windowSec: WINDOW_SEC,
        cpuOffPct: round(results.off.cpuPct),
        cpuOnPct: round(results.on.cpuPct),
        cpuDeltaPct: round(results.on.cpuPct - results.off.cpuPct),
        cpuDeltaMsPerSec: round((results.on.cpuPct - results.off.cpuPct) * 10, 2),
        wakeOff: isWindows ? null : round(results.off.wakeups, 1),
        wakeOn: isWindows ? null : round(results.on.wakeups, 1),
        wakeupsDelta: isWindows ? null : round(results.on.wakeups - results.off.wakeups, 1),
        quietWrites: results.on.writes + results.off.writes,
        quietRows,
        counterAlive,
      }
    } finally {
      await closeNomiApp(app)
    }
  } finally {
    cleanupTestTemp(root)
  }
}

const samples = []
for (let run = 0; run < RUNS; run += 1) {
  const sample = await oneRun(run)
  samples.push(sample)
  console.log(JSON.stringify(sample))
}
const payload = { label: LABEL, platform: process.platform, arch: process.arch, samples }
const outFile = path.join(repoRoot, 'tests/perf/results', `stall-overhead-${LABEL}.json`)
fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`)
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null }
console.log(`\nstall-overhead：CPU 增量中位 ${median(samples.map((s) => s.cpuDeltaPct))} 个百分点；写盘次数合计 ${samples.reduce((n, s) => n + s.quietWrites, 0)}；计数器存活 ${samples.filter((s) => s.counterAlive).length}/${samples.length}`)
process.exit(samples.every((s) => s.counterAlive) ? 0 : 1)
