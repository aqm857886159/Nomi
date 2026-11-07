#!/usr/bin/env node
// 卡顿时间线的真 Electron 阳性对照（设计卡 docs/plan/2026-10-31-diagnostics-jank-timeline.md ★9 第 1 / 2 / 3 / 4 / 9 条）：
//   1. 主进程注入一次 1200ms 同步睡眠（stallInject.cjs 经 mainRequire 注入，产品代码里没有测试入口）→ 导出的包里有一行
//      main-stall，时长在 1100–1400ms，标冻结。量不到就红，并明说「量不到」——不换别的办法顶。
//   2. 渲染层在 rAF 里空转 350ms → 一行 renderer-long-frame，带页面和场景。
//   3. 主窗口 unresponsive / responsive 事件各记一行（在主窗口对象上 emit，走产品自己装的监听器）。
//   4. 退出应用、同一份资料重开、再导出：上一次的行还在，清单写「本次启动 0 行」。
//   9. 没开项目导出：不崩，体量数字写原因。
// 零花费、不出网、不碰真实资料（隔离目录）。需要先 `pnpm run build`；窗口在屏幕外（launchNomiApp 默认安静仪表）。
// 用法：node tests/perf/canvas-scale/stallProbe.mjs [--out <结果 JSON>]
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { unzipSync, strFromU8 } from 'fflate'
import { launchNomiApp, closeNomiApp } from '../../ux/_launchApp.mjs'
import { makeTempDir, cleanupTestTemp } from '../../../scripts/_test-temp.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const requireTs = createRequire(import.meta.url)
const { require: tsxRequire } = requireTs('tsx/cjs/api')
const { parseStallRow, STALL_SAMPLE_INTERVAL_MS } = tsxRequire('../../../electron/shared/contracts/stallTimeline.ts', import.meta.url)
const argv = process.argv.slice(2)
const outFile = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : null
const INJECT = path.join(here, 'stallInject.cjs')
const STARTUP_GRACE_SEC = 20 // electron/diagnostics/stallMonitor.ts 的 STALL_STARTUP_GRACE_MS
const READ_INTERVAL_MS = 10_000

const checks = []
const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`) }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function exportBundle(app, win, zipPath) {
  await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, zipPath)
  const result = await win.evaluate(() => window.nomiDesktop.settings.diagnostics.exportBundle())
  if (!result?.ok) throw new Error(`导出诊断包失败：${JSON.stringify(result)}`)
  const files = unzipSync(new Uint8Array(fs.readFileSync(zipPath)))
  const manifest = JSON.parse(strFromU8(files['manifest.json']))
  const rows = files['stall-timeline.jsonl'] ? strFromU8(files['stall-timeline.jsonl']).split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []
  return { files, manifest, rows, text: Object.values(files).map((bytes) => strFromU8(bytes)).join('\n') }
}

const root = makeTempDir('nomi-stall-probe-')
let first
let second
let missingTileSignals = null
try {
  const launch = (name) => launchNomiApp({
    name, tempRoot: root, mainRequire: [INJECT], settleMs: 900,
    initialLocalStorage: { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' },
  })

  // ── 第一次启动：注入停顿、长帧、窗口无响应，然后导出 ────────────────────────────────────────
  let { app, win } = await launch('stall-probe-1')
  const histograms = await app.evaluate(() => globalThis.__nomiStallProbe.histograms())
  check(`注入包到了产品创建的那份直方图（间隔 ${STALL_SAMPLE_INTERVAL_MS}ms）`, histograms.length === 1 && histograms[0].resolution === STALL_SAMPLE_INTERVAL_MS, JSON.stringify(histograms))
  // 缺块次数（瓦片内存超限）有没有生产环境低开销的信号：只查「有哪些现成口子」，不开 tracing、不加启动参数。
  const entryTypes = await win.evaluate(() => [...PerformanceObserver.supportedEntryTypes])
  const processMetricKeys = await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics().map((metric) => ({ type: metric.type, keys: Object.keys(metric), cpuKeys: Object.keys(metric.cpu ?? {}), memoryKeys: Object.keys(metric.memory ?? {}) })))
  missingTileSignals = { entryTypes, processMetricKeys }
  check('缺块次数：渲染层可观察的条目类型里没有瓦片 / 棋盘格 / 光栅类', !entryTypes.some((type) => /tile|checker|raster/i.test(type)), entryTypes.join(','))
  const uptime = await app.evaluate(() => globalThis.__nomiStallProbe.processUptimeSec())
  await sleep(Math.max(0, (STARTUP_GRACE_SEC + 2 - uptime) * 1000)) // 过了启动宽限期才注入：启动期的读数产品本来就丢弃

  const writesBefore = await app.evaluate(() => globalThis.__nomiStallProbe.timelineWrites())
  check('注入前写盘次数 = 0（安静时不写）', writesBefore === 0, `writes=${writesBefore}`)
  await app.evaluate(() => { globalThis.__nomiStallProbe.sleep(1200) })
  await win.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => { const end = performance.now() + 350; while (performance.now() < end); resolve(null) })))
  await app.evaluate(({ BrowserWindow }) => {
    const target = BrowserWindow.getAllWindows()[0]
    target.emit('unresponsive')
    setTimeout(() => target.emit('responsive'), 300)
  })
  // 等到：下一次 10 秒读数写下 main-stall + 渲染层 5 秒轮询把长帧报上来（以盘上文件为准，不按墙钟猜）。
  const deadline = Date.now() + READ_INTERVAL_MS + 8_000
  let bundle
  while (Date.now() < deadline) {
    await sleep(1_000)
    bundle = await exportBundle(app, win, path.join(root, 'bundle-1.zip'))
    const kinds = new Set(bundle.rows.map((row) => row.kind))
    if (['main-stall', 'renderer-long-frame', 'window-unresponsive', 'window-responsive'].every((kind) => kinds.has(kind))) break
  }
  first = bundle
  const stall = bundle.rows.filter((row) => row.kind === 'main-stall').sort((a, b) => b.ms - a.ms)[0]
  check('1. main-stall：有这一行', Boolean(stall), stall ? '' : '量不到：1200ms 同步睡眠没有进时间线（monitorEventLoopDelay 在这个 Electron 主进程里没量到，或读数被丢）')
  check('1. main-stall：时长在 1100–1400ms 且标冻结', stall && stall.ms >= 1100 && stall.ms <= 1400 && stall.frozen === true, stall ? `ms=${stall.ms} frozen=${stall.frozen}` : '')
  const frame = bundle.rows.find((row) => row.kind === 'renderer-long-frame')
  check('2. renderer-long-frame：≥200ms，带页面 / 生成中 / 节点数档位', frame && frame.ms >= 200 && frame.page === 'library' && frame.generating === false && frame.nodes === '0', JSON.stringify(frame ?? null))
  const kinds = bundle.rows.map((row) => row.kind)
  check('3. window-unresponsive 与 window-responsive 都写进去了', kinds.includes('window-unresponsive') && kinds.includes('window-responsive'))
  const responsive = bundle.rows.find((row) => row.kind === 'window-responsive')
  check('3. window-responsive 带无响应时长（≈300ms）', responsive && responsive.ms >= 250 && responsive.ms <= 2000, JSON.stringify(responsive ?? null))
  check('清单：时间线 recorded，rows ≥ 4', bundle.manifest.stallTimeline.state === 'recorded' && bundle.manifest.stallTimeline.rows >= 4, JSON.stringify(bundle.manifest.stallTimeline))
  check('9. 没开项目导出不崩，体量数字写原因', bundle.manifest.projectSize.available === false && bundle.manifest.projectSize.reason === 'no-active-project', JSON.stringify(bundle.manifest.projectSize))
  check('清单带显卡 / 屏幕 / 窗口', bundle.manifest.hardware.displays.length >= 1 && bundle.manifest.hardware.window?.width > 0, JSON.stringify(bundle.manifest.hardware.window))
  check('每一行都过白名单；包里没有本机路径', bundle.rows.every((row) => parseStallRow(row) !== null) && !bundle.text.includes(root) && !bundle.text.includes(process.env.HOME ?? '\u0000'))
  await closeNomiApp(app)

  // ── 重启：同一份资料，上一次的记录还在 ──────────────────────────────────────────────────────
  ;({ app, win } = await launch('stall-probe-2'))
  second = await exportBundle(app, win, path.join(root, 'bundle-2.zip'))
  const survived = second.rows.find((row) => row.kind === 'main-stall')
  check('4. 重启后再导出：上一次的 main-stall 还在', Boolean(survived) && second.rows.length >= first.rows.length, `rows=${second.rows.length}（上次 ${first.rows.length}）`)
  check('4. 清单：本次启动 0 行、仍是 recorded', second.manifest.stallTimeline.state === 'recorded' && second.manifest.stallTimeline.rowsThisSession === 0, JSON.stringify(second.manifest.stallTimeline))
  await closeNomiApp(app)

  // ── 三态里剩下的两态，各用一份全新资料在真 Electron 里走一遍 ───────────────────────────────────
  const launchFresh = (name, freshRoot, env = {}) => launchNomiApp({
    name, tempRoot: freshRoot, mainRequire: [INJECT], settleMs: 900, env,
    initialLocalStorage: { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' },
  })
  const freshRoots = [makeTempDir('nomi-stall-probe-fresh-'), makeTempDir('nomi-stall-probe-off-')]
  try {
    ;({ app, win } = await launchFresh('stall-probe-3', freshRoots[0]))
    const fresh = await exportBundle(app, win, path.join(freshRoots[0], 'bundle-3.zip'))
    check('5/8. 新装（盘上没有时间线文件，等同旧版升级上来）导出不崩：本次没记到、文件 absent', fresh.manifest.stallTimeline.state === 'none-this-session' && fresh.manifest.stallTimeline.file === 'absent' && fresh.rows.length === 0, JSON.stringify(fresh.manifest.stallTimeline))
    check('5. 清单明着写「本次没记到」，excluded 写明原因', fresh.manifest.stallTimeline.note.includes('本次没记到') && fresh.manifest.excluded.some((item) => item.what === 'stall-timeline.jsonl' && item.why === 'none-this-session'))
    await closeNomiApp(app)
    ;({ app, win } = await launchFresh('stall-probe-4', freshRoots[1], { NOMI_STALL_PROBE_FAIL_HISTOGRAM: '1' }))
    const off = await exportBundle(app, win, path.join(freshRoots[1], 'bundle-4.zip'))
    check('5. 监视器起不来：清单写「停顿监视器未运行」+ install-failed，导出不崩', off.manifest.stallTimeline.state === 'monitor-not-running' && off.manifest.stallTimeline.reason === 'install-failed' && off.manifest.stallTimeline.note.includes('停顿监视器未运行'), JSON.stringify(off.manifest.stallTimeline))
    await closeNomiApp(app)
  } finally {
    freshRoots.forEach((freshRoot) => cleanupTestTemp(freshRoot))
  }
} catch (error) {
  check('探针自己没出错', false, error instanceof Error ? error.stack ?? error.message : String(error))
} finally {
  cleanupTestTemp(root)
}

const failed = checks.filter((item) => !item.ok)
const result = { checks, passed: checks.length - failed.length, failed: failed.length, firstRows: first?.rows ?? null, firstManifestStallTimeline: first?.manifest.stallTimeline ?? null, firstHardware: first?.manifest.hardware ?? null, missingTileSignals }
if (outFile) fs.writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`)
console.log(`\nstallProbe：${result.passed} 项通过，${result.failed} 项失败`)
process.exit(failed.length ? 1 : 0)
