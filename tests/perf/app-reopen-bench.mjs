#!/usr/bin/env node
// 主窗口「叫回」的两个用户操作（主窗口只交给一个主人管：electron/mainWindowPresence.ts）：
//   --op reveal       窗口被藏起后点 Dock 图标（activate）→ 窗口重新可见、不再最小化；
//   --op confirm-exit 点关窗 → 弹确认框 → 点「确认」→ 进程退出（退出码 0）。
// 真 Electron、隔离资料、零花费、零外网。reveal 的计时在主进程里做（emit 前后同一个时钟、setImmediate 轮询可见性），
// 不含 Playwright 往返；confirm-exit 从点确认到进程退出，量的是用户点完到 Nomi 真消失这一段。
// 关窗确认在 E2E 下默认不装，所以仅在主窗口构造那一拍把 NOMI_E2E 置 0 让它装上，下一拍还原（和用户现场一致）。
// 接口同 tests/perf/node-json-bench.mjs 的约定：--runs N --out 文件 → { runs, noisy, metrics: { response: number[] } }。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { launchNomiApp } from '../ux/_launchApp.mjs'

const arg = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1] }
const runs = Number(arg('--runs', 5))
const output = arg('--out', '')
const op = arg('--op', 'reveal')
if (!output || !Number.isInteger(runs) || runs < 1) throw new Error('Use --out <result.json> and a positive --runs')
if (op !== 'reveal' && op !== 'confirm-exit') throw new Error('--op must be reveal or confirm-exit')

const load = () => os.loadavg()[1]
let noisy = load() >= 10

const closeConfirmOn = (dir) => {
  const file = path.join(dir, 'close-confirm-on.cjs')
  fs.writeFileSync(file, [
    "const { app } = require('electron')",
    'let done = false',
    "app.on('browser-window-created', () => {",
    '  if (done) return',
    '  done = true',
    "  process.env.NOMI_E2E = '0'",
    "  setImmediate(() => { process.env.NOMI_E2E = '1' })",
    '})',
    '',
  ].join('\n'))
  return file
}

const SEEN = { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' }

async function revealOnce(instance) {
  const { app } = instance
  return app.evaluate(async ({ app: electronApp, BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
    if (!win) throw new Error('no main window')
    const until = async (predicate, limitMs, what) => {
      const end = performance.now() + limitMs
      while (!predicate()) {
        if (performance.now() > end) throw new Error(`timeout waiting for ${what}`)
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
    // 藏起而不是最小化：macOS 最小化还原自带约 535ms 的系统动画（直接调 win.restore() 对照也是这个数），
    // 量进来就是在量系统动画而不是我们的叫回；藏起来的窗口（关窗确认后藏窗、后台冷启）才是这条路径独有的。
    win.hide()
    await until(() => !win.isVisible(), 3000, 'hidden')
    await new Promise((resolve) => setTimeout(resolve, 300))
    const started = performance.now()
    electronApp.emit('activate')
    const end = started + 5000
    while (!(win.isVisible() && !win.isMinimized())) {
      if (performance.now() > end) throw new Error('window did not become visible within 5s')
      await new Promise((resolve) => setImmediate(resolve))
    }
    return performance.now() - started
  })
}

async function confirmExitOnce(tempRoot) {
  const instance = await launchNomiApp({
    name: 'app-reopen-bench',
    mainRequire: [closeConfirmOn(tempRoot)],
    settleMs: 2000,
    timeout: 60_000,
    initialLocalStorage: SEEN,
  })
  const { app, win } = instance
  const child = app.process()
  let exitCode = null
  let exited = false
  child.on('exit', (code) => { exited = true; exitCode = code })
  try {
    const bw = await app.browserWindow(win)
    await bw.evaluate((w) => w.close())
    const askEnd = Date.now() + 10_000
    while (Date.now() < askEnd && !(await win.evaluate(() => Boolean(document.querySelector('[data-confirm-dialog-confirm]'))).catch(() => false))) await sleep(100)
    const started = performance.now()
    const clicked = await win.evaluate(() => { const el = document.querySelector('[data-confirm-dialog-confirm]'); if (!el) return false; el.click(); return true })
    if (!clicked) throw new Error('close confirmation did not appear')
    while (!exited && performance.now() - started < 10_000) await sleep(5)
    if (!exited) throw new Error('process did not exit within 10s of confirming')
    if (exitCode !== 0) throw new Error(`exit code ${exitCode}`)
    return performance.now() - started
  } finally {
    if (!exited) { try { process.kill(child.pid, 'SIGKILL') } catch { /* already gone */ } }
    await instance.close().catch(() => undefined)
  }
}

const samples = []
let failure
const tempRoot = makeTempDir('nomi-app-reopen-bench-')
try {
  if (op === 'reveal') {
    const instance = await launchNomiApp({ name: 'app-reopen-bench', settleMs: 2000, timeout: 60_000, initialLocalStorage: SEEN })
    try {
      await revealOnce(instance) // 预热：第一次藏起 / 显示带系统初始化，不算进数字里。
      for (let run = 0; run < runs; run += 1) samples.push(await revealOnce(instance))
    } finally {
      await instance.close().catch(() => undefined)
    }
  } else {
    for (let run = 0; run < runs; run += 1) samples.push(await confirmExitOnce(tempRoot))
  }
} catch (error) {
  failure = error
} finally {
  noisy = noisy || load() >= 10
}

const report = {
  scope: op === 'reveal'
    ? 'hidden main window, activate emitted, time until visible and not minimized (measured inside the main process); real Electron, isolated profile'
    : 'close window, confirm quit, time from clicking confirm until the process exits with code 0; real Electron, isolated profile, close confirmation installed',
  op,
  date: new Date().toISOString(),
  machine: `${process.platform} ${process.arch} ${os.cpus()[0]?.model}`,
  node: process.version,
  noisy,
  runs,
  metrics: { response: samples },
  ...(failure ? { failure: failure.message } : {}),
}
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true })
fs.writeFileSync(output, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ op, response: samples, noisy }))
if (failure) { console.error(failure.message); process.exit(1) }
