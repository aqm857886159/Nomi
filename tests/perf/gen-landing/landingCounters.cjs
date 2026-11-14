// 生成落地量具的主进程仪表（经 launchNomiApp 的 mainRequire 在主入口之前装上；只进隔离资料，不进产品）。
// 设计卡 docs/plan/2026-11-12-gen-landing-stall-cut1.md ★7。三个确定性计数 + 一把事件循环尺子：
//   · dirManifestReads：读项目清单（.nomi/project.json）而调用栈里有 resolveWorkspaceProjectDir 的次数（「为找目录而读项目文件」）；
//   · syncIpc：渲染层发来的同步 IPC（webContents 的 ipc-message-sync），按通道记；
//   · receiptRereads：落地回执（canvasLocalArtifactReceipt）里整读产物文件的次数；
//   · 主进程事件循环延迟（monitorEventLoopDelay，10ms 分辨率）的最大值。
// 计数靠包一层 fs.readFileSync：主进程产物按属性取 fs.readFileSync，装在主入口之前就能看到每一次调用。
'use strict'
/* eslint-disable */
const fs = require('node:fs')
const path = require('node:path')
const { monitorEventLoopDelay } = require('node:perf_hooks')
const { app } = require('electron')

const MANIFEST_TAIL = `${path.sep}.nomi${path.sep}project.json`
const ASSETS_SEGMENT = `${path.sep}assets${path.sep}`
let phase = null
let counts = null
let hist = null

function fresh() {
  return { dirManifestReads: 0, manifestReads: 0, receiptRereads: 0, syncIpc: {} }
}

function stackHas(name) {
  const limit = Error.stackTraceLimit
  Error.stackTraceLimit = 40
  const holder = {}
  Error.captureStackTrace(holder)
  Error.stackTraceLimit = limit
  return String(holder.stack).includes(name)
}

const originalReadFileSync = fs.readFileSync
fs.readFileSync = function countedReadFileSync(file, ...rest) {
  if (phase && typeof file === 'string') {
    if (file.endsWith(MANIFEST_TAIL)) {
      counts.manifestReads += 1
      if (stackHas('resolveWorkspaceProjectDir')) counts.dirManifestReads += 1
    } else if (file.includes(ASSETS_SEGMENT) && stackHas('canvasLocalArtifactReceipt')) {
      counts.receiptRereads += 1
    }
  }
  return originalReadFileSync.call(this, file, ...rest)
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('ipc-message-sync', (_ipcEvent, channel) => {
    if (!phase) return
    counts.syncIpc[channel] = (counts.syncIpc[channel] || 0) + 1
  })
})

globalThis.__genLandingCounters = {
  start(name) {
    phase = name
    counts = fresh()
    hist = monitorEventLoopDelay({ resolution: 10 })
    hist.enable()
    return name
  },
  stop() {
    const result = { phase, ...counts, mainStallMaxMs: hist ? Math.round(hist.max / 1e5) / 10 : null }
    if (hist) hist.disable()
    hist = null
    phase = null
    counts = null
    return result
  },
}
