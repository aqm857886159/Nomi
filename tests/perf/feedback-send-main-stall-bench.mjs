#!/usr/bin/env node
// 一键反馈发送时主进程被占住多久（设计卡 docs/plan/2026-11-01-feedback-delivery.md ★7）。
// 真 Electron、隔离资料、真 IPC、本机接收端，零花费、零外网。量法：一边发送，一边不停做最小的主进程往返
// （和 tests/perf/canvas-scale/workbenchScenarios.mjs 的 startMainSampler 同一把尺子），取最大值：
// 这段时间别的 IPC 最多要等这么久。点发送到卡上变「正在发送」不经过主进程，用户看不到这段，但别的面板看得到。
//
// 最坏规模：今天的日志不到 300 行（每行都顶到写手上限），所以还要再读一份 4MB 的；模型目录约 450KB 且映射全部算相关。
//   · mainRoundTripMax（主指标）：发一份，队列是空的（用户绝大多数时候的样子）；
//   · feedbackQueuedSendRoundTripMax：队列里已有 50 份旧版大小（约 450KB）的报告时再发一份，接收端不答（只看落盘那一下）；
//   · feedbackQueueDrainRoundTripMax：接收端恢复，把这 51 份一条条发完（每送达一份改写一次队列文件）。
// 后两个是离线几个月才可能攒到的规模，只留在原始结果里，不登记、不判预算。
// 接口同 tests/perf/node-json-bench.mjs 的约定：--runs N --out 文件 → { runs, noisy, metrics: { 名字: number[] } }。
import fs from 'node:fs'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as sleep } from 'node:timers/promises'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { launchNomiApp } from '../ux/_launchApp.mjs'

const arg = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1] }
const runs = Number(arg('--runs', 5))
const output = arg('--out', '')
if (!output || !Number.isInteger(runs) || runs < 1) throw new Error('Use --out <result.json> and a positive --runs')

const LOG_BYTES = 4 * 1024 * 1024
/** 日志写手一行的上限（electron/logging/redact.ts 的 MAX_LINE_CHARS）。 */
const LOG_LINE_CHARS = 2000
const QUEUED_REPORTS = 50
const OLD_REPORT_BYTES = 450_000
const CATALOG_BYTES = 450_000

const load = () => os.loadavg()[1]
let noisy = load() >= 10

function logFile(file, lineCount) {
  const at = new Date().toISOString()
  const words = 'free text from an older version of the log writer '.repeat(Math.ceil(LOG_LINE_CHARS / 51))
  const line = `[${at}] WARN  vendor         call vendor=apimart model=seedance-2.5 status=503 ms=1200 attempt=2 req=bench reason=${words}`.slice(0, LOG_LINE_CHARS)
  fs.writeFileSync(file, `${Array.from({ length: lineCount }, () => line).join('\n')}\n`)
}

function seedLogs(logsDir) {
  fs.mkdirSync(logsDir, { recursive: true })
  const now = new Date()
  const day = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
  logFile(path.join(logsDir, `nomi-${day}.1.log`), Math.floor(LOG_BYTES / LOG_LINE_CHARS))
  logFile(path.join(logsDir, `nomi-${day}.log`), 299)
}

// 都是内置家的兄弟连接：自建连接的模型和映射不出门（feedbackCatalog.ts），用自建夹具量到的是一份空目录。
// 兄弟连接还要逐行换 key，是投影最费的一种。
function seedCatalog(settingsDir) {
  const vendors = Array.from({ length: 40 }, (_unused, index) => ({ key: `apimart--bench-${index}`, name: `Bench ${index}`, enabled: true, baseUrlHint: 'https://api.apimart.ai' }))
  const mappings = []
  const filler = 'x'.repeat(200)
  while (JSON.stringify({ vendors, mappings }).length < CATALOG_BYTES) {
    mappings.push({ vendorKey: `apimart--bench-${mappings.length % 40}`, modelKey: `model-${mappings.length}`, stage: 'submit', note: filler })
  }
  const apiKeysByVendor = Object.fromEntries(vendors.map(({ key }) => [key, { vendorKey: key, enabled: true }]))
  fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({ version: 1, vendors, models: [], mappings, apiKeysByVendor }))
}

function seedQueue(queueFile) {
  const filler = 'q'.repeat(OLD_REPORT_BYTES)
  const queuedAt = new Date().toISOString()
  const pending = Array.from({ length: QUEUED_REPORTS }, (_unused, index) => ({
    id: `bench-${index}`,
    queuedAt,
    payload: {
      schemaVersion: 1,
      manifest: { schemaVersion: 1, createdAt: queuedAt, entries: [], excluded: [], totalBytes: filler.length },
      context: { surface: 'unspecified', summary: `bench ${index}` },
      attachments: { 'model-catalog.json': filler },
    },
  }))
  fs.writeFileSync(queueFile, JSON.stringify({ schemaVersion: 1, pending }))
}

const queueLength = (queueFile) => {
  try { return JSON.parse(fs.readFileSync(queueFile, 'utf8')).pending.length } catch { return 0 }
}

// 接收端：ok 立刻回编号；hang 收了不答。
const receiver = { mode: 'ok', accepted: 0, sequence: 0, lastFeedbackBytes: 0 }
const server = createServer((request, response) => {
  let bytes = 0
  request.on('data', (chunk) => { bytes += chunk.length })
  request.on('end', () => {
    if (request.url === '/v1/feedback') receiver.lastFeedbackBytes = bytes
    if (request.url === '/v1/feedback' && receiver.mode === 'hang') return
    receiver.accepted += 1
    receiver.sequence += 1
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: true, ref: 'bench', id: `NF-1101-${String(receiver.sequence).padStart(4, '0')}` }))
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

function startSampler(app) {
  const samples = []
  let running = true
  const loop = (async () => {
    while (running) {
      const started = performance.now()
      await app.evaluate(() => 1).catch(() => undefined)
      samples.push(performance.now() - started)
      await sleep(5)
    }
  })()
  return async () => {
    running = false
    await loop
    return samples.length ? Math.max(...samples) : 0
  }
}

const REQUEST = { surface: 'generation', summary: 'bench', includeContent: false, provider: 'apimart' }
const send = (win) => win.evaluate((request) => window.nomiDesktop.feedback.send(request), REQUEST)

const metrics = { mainRoundTripMax: [], feedbackQueuedSendRoundTripMax: [], feedbackQueueDrainRoundTripMax: [] }
const idle = []
let failure
const tempRoot = makeTempDir('nomi-feedback-send-bench-')
const logsDir = path.join(tempRoot, 'logs')
seedLogs(logsDir)
const instance = await launchNomiApp({
  name: 'feedback-send-bench',
  tempRoot,
  env: { NOMI_INTAKE_ENDPOINT: `http://127.0.0.1:${server.address().port}`, NOMI_INTAKE_TOKEN: 'bench-token', NODE_ENV: 'production' },
  initialLocalStorage: { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' },
})
const { app, win, settingsDir } = instance
const queueFile = path.join(settingsDir, 'intake-queue-feedback.json')

try {
  await app.evaluate(({ app: electronApp }, dir) => electronApp.setAppLogsPath(dir), logsDir)
  seedCatalog(settingsDir)
  // 预热：第一次组包要载模块，不算进数字里。
  await send(win)
  // 目录要真的进了包，否则量的不是最坏规模（投影改过一次，这个夹具就悄悄变成了一份空目录）。
  if (receiver.lastFeedbackBytes < CATALOG_BYTES * 0.8) throw new Error(`The report carried only ${receiver.lastFeedbackBytes} bytes, so this is not the worst case`)

  for (let run = 0; run < runs; run += 1) {
    const idleStop = startSampler(app)
    await sleep(1000)
    idle.push(await idleStop())

    receiver.mode = 'ok'
    let stop = startSampler(app)
    const result = await send(win)
    metrics.mainRoundTripMax.push(await stop())
    if (result?.ok !== true || result.queued) throw new Error(`Send did not reach the receiver: ${JSON.stringify(result)}`)

    seedQueue(queueFile)
    receiver.mode = 'hang'
    stop = startSampler(app)
    await send(win)
    metrics.feedbackQueuedSendRoundTripMax.push(await stop())

    receiver.mode = 'ok'
    stop = startSampler(app)
    // 接收端恢复后下一份送达会把队列带走：等它走完，一次最多等一个重试周期。
    await send(win)
    for (let waited = 0; waited < 600 && queueLength(queueFile) > 0; waited += 1) await sleep(500)
    metrics.feedbackQueueDrainRoundTripMax.push(await stop())
    if (queueLength(queueFile) > 0) throw new Error('The queue did not drain')
  }
} catch (error) {
  failure = error
} finally {
  noisy = noisy || load() >= 10
  await instance.close().catch(() => undefined)
  server.closeAllConnections?.()
  server.close()
}

const report = {
  scope: `299 capped log lines plus a ${LOG_BYTES} byte rolled log, ${CATALOG_BYTES} byte catalog; send with an empty queue, then with ${QUEUED_REPORTS} queued ${OLD_REPORT_BYTES} byte reports; main process round trip through real Electron`,
  date: new Date().toISOString(),
  machine: `${process.platform} ${process.arch} ${os.cpus()[0]?.model}`,
  node: process.version,
  noisy,
  runs,
  idleRoundTripMax: idle,
  metrics,
  ...(failure ? { failure: failure.message } : {}),
}
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true })
fs.writeFileSync(output, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ...metrics, idle, noisy }))
if (failure) { console.error(failure.message); process.exit(1) }
