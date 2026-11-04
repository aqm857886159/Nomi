// 卡顿时间线的量具注入（mainRequire，主进程入口之前加载；注法同 ipcProbe.cjs）。产品代码里不留任何测试入口：
//   · 注入同步睡眠（阳性对照：证明 monitorEventLoopDelay 在 Electron 主进程里真的量得到）；
//   · 拿到产品创建的那份直方图的引用，量具可以在同一个进程里把监视器开 / 关做 A/B（空闲开销场景）；
//   · 数时间线文件的写盘次数（无停顿时必须为 0）。
// 不进产品构建：只有量具经 launchNomiApp({ mainRequire }) 挂上。
'use strict'
/* global require, process */
/* eslint-disable @typescript-eslint/no-require-imports -- 量具经 mainRequire 注入、在主进程入口之前以 CommonJS 加载，只能用 require */
const perfHooks = require('node:perf_hooks')
const fs = require('node:fs')

const histograms = []
const originalMonitor = perfHooks.monitorEventLoopDelay
perfHooks.monitorEventLoopDelay = function monitorEventLoopDelayProbe(...args) {
  // 量具开关：让产品的监视器「起不来」，走一遍清单里的「监视器没运行」（真 Electron，产品代码里没有这个开关）。
  if (process.env.NOMI_STALL_PROBE_FAIL_HISTOGRAM === '1') throw new Error('probe: histogram unavailable')
  const histogram = originalMonitor.apply(this, args)
  histograms.push({ histogram, resolution: args[0]?.resolution })
  return histogram
}

let timelineWrites = 0
const originalAppend = fs.appendFileSync
fs.appendFileSync = function appendFileSyncProbe(file, ...rest) {
  if (String(file).includes('nomi-stall-timeline')) timelineWrites += 1
  return originalAppend.call(this, file, ...rest)
}

globalThis.__nomiStallProbe = {
  /** 主线程同步睡眠 ms 毫秒（Atomics.wait，不吃 CPU）。 */
  sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) },
  /** 主线程空转 ms 毫秒（吃 CPU）。 */
  spin(ms) { const end = Date.now() + ms; while (Date.now() < end); },
  /** 产品创建了几份直方图、间隔各是多少——证明注入真的包到了产品的那次调用。 */
  histograms: () => histograms.map((item) => ({ resolution: item.resolution })),
  setMonitorEnabled(on) { for (const item of histograms) { if (on) item.histogram.enable(); else item.histogram.disable() } },
  timelineWrites: () => timelineWrites,
  processUptimeSec: () => process.uptime(),
}
