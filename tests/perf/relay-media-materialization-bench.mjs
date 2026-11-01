#!/usr/bin/env node
// Zero-spend transport instrument. Production streaming sink, true loopback HTTP, producer in a child process.
// Transfer/write and cancellation only; decoder/publication are covered by the protocol matrix.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { fork, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { Readable, Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { performance } from 'node:perf_hooks'
import { require as tsxRequire } from 'tsx/cjs/api'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { summarizeRuns } from '../../scripts/perf-scenarios-lib.mjs'

if (process.argv.includes('--server')) {
  const chunk = Buffer.alloc(64 * 1024)
  const sockets = new Set()
  let active = 0, maxConcurrent = 0
  const server = http.createServer((req, res) => {
    const size = Number(new URL(req.url, 'http://fixture').searchParams.get('bytes'))
    if (size > 1024) { active++; maxConcurrent = Math.max(maxConcurrent, active) }
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(size) })
    function* chunks() { for (let left = size; left > 0; left -= chunk.length) yield chunk.subarray(0, Math.min(left, chunk.length)) }
    const source = Readable.from(chunks())
    res.once('close', () => { source.destroy(); if (size > 1024) active-- })
    source.pipe(res)
  })
  server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  process.send({ port: server.address().port })
  process.on('message', (message) => { if (message.kind === 'stats') process.send({ maxConcurrent }) })
  const stop = () => { for (const socket of sockets) socket.destroy(); server.close(() => process.exit(0)) }
  process.once('SIGTERM', stop)
  process.once('disconnect', stop)
} else if (process.argv.includes('--sample')) {
  const root = makeTempDir('relay-media-bench-')
  process.env.NOMI_SETTINGS_DIR = path.join(root, 'settings')
  process.env.NOMI_PROJECTS_DIR = path.join(root, 'projects')
  process.env.NOMI_ELECTRON_USER_DATA_DIR = path.join(root, 'user-data')
  // Identical host imports for both implementations. The control transfer function and
  // dependencies are verified against main by the parent before any samples run.
  const { streamProfileMediaToFile } = tsxRequire('../../electron/capabilityCore/generationOutputMaterializer.ts', import.meta.url)
  const { fetchProviderMedia } = tsxRequire('../../electron/assets/providerMediaFetch.ts', import.meta.url)
  const { PROVIDER_MEDIA_BYTE_CAP } = tsxRequire('../../electron/shared/assets/providerMediaRetrievalBudget.ts', import.meta.url)
  const index = process.argv.indexOf('--sample')
  const [implementation, phase, byteArg, runArg] = process.argv.slice(index + 1)
  const bytes = Number(byteArg), run = Number(runArg)
  const concurrency = implementation === 'relay-parallel' ? 4 : 1
  const producer = fork(fileURLToPath(import.meta.url), ['--server'], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] })
  const metrics = ['rss', 'heapUsed', 'external', 'arrayBuffers']
  let sample
  try {
    const [{ port }] = await once(producer, 'message')
    const baseUrl = `http://127.0.0.1:${port}`
    const smallFetch = async () => {
      if (implementation === 'main-url-buffer') {
        const response = await fetchProviderMedia(`${baseUrl}/?bytes=1024`, { trustedPrivateOrigin: baseUrl, allowContentTypes: ['video/mp4'] })
        if (response.bytes.length !== 1024) throw new Error('Warmup has wrong size')
      } else {
        const response = await fetch(`${baseUrl}/?bytes=1024`)
        if ((await response.arrayBuffer()).byteLength !== 1024) throw new Error('Warmup has wrong size')
      }
    }
    if (phase === 'warm-download') await smallFetch()
    const file = path.join(root, 'download.mp4')
    const files = concurrency === 1 ? [file] : Array.from({ length: concurrency }, (_, i) => path.join(root, `download-${i}.mp4`))
    const controller = new AbortController()
    const initial = process.memoryUsage(), peak = { ...initial }
    const loadBefore = os.loadavg()[1]
    const tick = () => { const now = process.memoryUsage(); for (const key of metrics) peak[key] = Math.max(peak[key], now[key]) }
    const timer = setInterval(tick, 5)
    const start = performance.now()
    let outcome = 'downloaded', afterHeaders = null, received = null
    try {
      if (phase === 'cold-init') { await smallFetch(); outcome = 'initialized' }
      else if (implementation === 'main-url-buffer') {
        try {
          const response = await fetchProviderMedia(`${baseUrl}/?bytes=${bytes}`, { trustedPrivateOrigin: baseUrl, allowContentTypes: ['video/mp4'] })
          tick() // Includes the returned whole-file Buffer before writing.
          await fs.promises.writeFile(file, response.bytes, { flag: 'wx', mode: 0o600 })
        } catch (error) {
          if (bytes <= PROVIDER_MEDIA_BYTE_CAP || !/too large|exceeded/i.test(String(error.message))) throw error
          outcome = 'policy-refused'
        }
      } else if (implementation === 'relay-parallel') {
        const responses = await Promise.all(files.map(() => fetch(`${baseUrl}/?bytes=${bytes}`, { signal: controller.signal })))
        afterHeaders = process.memoryUsage()
        const counts = await Promise.all(responses.map((response, i) => streamProfileMediaToFile(response, files[i], controller.signal)))
        if (counts.some((count) => count !== bytes)) throw new Error('Parallel download has wrong byte count')
        received = counts.reduce((sum, count) => sum + count, 0)
      } else {
        const response = await fetch(`${baseUrl}/?bytes=${bytes}`, { signal: controller.signal })
        afterHeaders = process.memoryUsage()
        if (implementation === 'receive-drain' || implementation === 'byob-drain') {
          received = 0
          let reader
          try { reader = implementation === 'byob-drain' ? response.body.getReader({ mode: 'byob' }) : response.body.getReader() }
          catch (error) {
            if (implementation !== 'byob-drain' || !(error instanceof TypeError)) throw error
            outcome = 'unsupported-byte-reader'; await response.body.cancel()
          }
          if (reader) {
            let buffer = new ArrayBuffer(64 * 1024)
            try {
              while (received < bytes) {
                const { value, done } = await (implementation === 'byob-drain' ? reader.read(new Uint8Array(buffer)) : reader.read())
                if (done) break
                received += value.byteLength
                if (implementation === 'byob-drain') buffer = value.buffer
              }
              await reader.cancel()
              outcome = 'drained'
            } finally { reader.releaseLock() }
          }
        } else if (implementation === 'bridge-drain') {
          received = 0
          const count = new Transform({ transform(chunk, _encoding, callback) { received += chunk.length; callback(null, chunk) } })
          await pipeline(Readable.fromWeb(response.body), count, new Writable({ write(_chunk, _encoding, callback) { callback() } }), { signal: controller.signal })
          outcome = 'drained'
        } else await streamProfileMediaToFile(response, file, controller.signal)
        if (outcome === 'drained' && received !== bytes) throw new Error('Diagnostic drain has wrong size')
      }
      tick()
    } finally { clearInterval(timer) }
    const transferMs = performance.now() - start
    if (outcome === 'downloaded' && files.some((item) => fs.statSync(item).size !== bytes)) throw new Error('streamed file has wrong size')
    for (const item of files) fs.rmSync(item, { force: true })
    const statsReply = once(producer, 'message')
    producer.send({ kind: 'stats' })
    const [producerStats] = await statsReply
    if (phase === 'warm-download' && outcome === 'downloaded' && producerStats.maxConcurrent < concurrency) throw new Error('Downloads did not overlap at the producer')
    let cancelMs = null
    if (implementation === 'relay-stream' && phase === 'warm-download') {
      const cancelFile = path.join(root, 'cancel.mp4'), cancel = new AbortController()
      const response = await fetch(`${baseUrl}/?bytes=${bytes}`, { signal: cancel.signal })
      let abortAt
      // Deliberate cancellation workload, not a UI/network wait.
      const deadline = setTimeout(() => { abortAt = performance.now(); cancel.abort(new DOMException('Benchmark cancellation', 'AbortError')) }, 25)
      let failed = false
      try { await streamProfileMediaToFile(response, cancelFile, cancel.signal) }
      catch (error) { if (!cancel.signal.aborted) throw error; failed = true }
      finally { clearTimeout(deadline); fs.rmSync(cancelFile, { force: true }) }
      if (!failed || !abortAt) throw new Error('cancellation workload completed before cancellation')
      cancelMs = performance.now() - abortAt
    }
    sample = { implementation, phase, bytes, concurrency, producerMaxConcurrent: producerStats.maxConcurrent, receivedBytes: received, run, clientPid: process.pid, freshClient: true,
      warmupBytes: phase === 'warm-download' ? 1024 : 0, outcome,
      memoryMiB: Object.fromEntries(metrics.map((key) => [key, { initial: initial[key] / 1024 ** 2, peak: peak[key] / 1024 ** 2, increase: (peak[key] - initial[key]) / 1024 ** 2, afterHeadersIncrease: afterHeaders ? (afterHeaders[key] - initial[key]) / 1024 ** 2 : null }])),
      transferMs, cancelMs, mainByteCap: implementation === 'main-url-buffer' ? PROVIDER_MEDIA_BYTE_CAP : null,
      loadBefore, loadAfter: os.loadavg()[1] }
  } finally {
    if (producer.exitCode === null) {
      const stopped = once(producer, 'exit')
      producer.kill('SIGTERM') // Only the PID spawned above.
      await stopped
    }
    fs.rmSync(root, { recursive: true, force: true })
  }
  process.send(sample)
  process.disconnect()
} else {
  const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1] }
  const runs = Number(arg('--runs', 5)), output = arg('--out', '')
  const caseName = arg('--case', 'full')
  const cases = { 'single-256': { implementation: 'relay-stream', bytes: 256 * 1024 ** 2 }, 'single-2048': { implementation: 'relay-stream', bytes: 2 * 1024 ** 3 }, 'parallel-256': { implementation: 'relay-parallel', bytes: 256 * 1024 ** 2 } }
  if (caseName !== 'full' && !cases[caseName]) throw new Error('Unknown media measurement case')
  if (!output || !Number.isInteger(runs) || runs < (caseName === 'full' ? 5 : 1)) throw new Error('Use --out <receipt> and a positive --runs (full split requires >=5)')
  const sourceRef = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const controlRef = caseName === 'full' ? execFileSync('git', ['rev-parse', 'origin/main'], { encoding: 'utf8' }).trim() : null
  if (controlRef) execFileSync('git', ['diff', '--quiet', controlRef, '--', 'electron/assets/providerMediaFetch.ts', 'electron/hardenedFetch.ts', 'electron/appFetch.ts', 'electron/shared/assets/providerMediaRetrievalBudget.ts', 'electron/providerNetwork.ts', 'electron/systemProxy.ts', 'electron/networkOutboundPolicy.ts'])
  // Leave admission headroom for the complete batch; every sample still uses 10 as its noisy threshold.
  const admissionLoad5 = 8
  const quietStarted = performance.now()
  let load5 = os.loadavg()[1]
  while (load5 >= admissionLoad5 && performance.now() - quietStarted < 25 * 60 * 1000) {
    console.error(`[quiet-window] load5=${load5}; waiting before any client starts`)
    // Condition-based host admission, bounded by the Mac polling window.
    await new Promise((resolve) => setTimeout(resolve, 30_000))
    load5 = os.loadavg()[1]
  }
  const quietWaitMs = performance.now() - quietStarted
  if (load5 >= admissionLoad5) {
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), noisy: true, status: 'quiet-window-unavailable', load5, admissionLoad5, quietWaitMs, runs, samples: [] }, null, 2))
    console.error(`Quiet window unavailable: load5=${load5}; no performance verdict`)
    process.exit(75)
  }
  const samples = []
  let failure, diagnosticTriggered = false
  const runSample = async (implementation, phase, bytes, run, role = 'measurement') => {
    const child = fork(fileURLToPath(import.meta.url), ['--sample', implementation, phase, String(bytes), String(run)], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
    const sample = await new Promise((resolve, reject) => {
      let received
      child.once('message', (value) => { received = value })
      child.once('error', reject)
      child.once('exit', (code) => code === 0 && received ? resolve(received) : reject(new Error(`Client exited ${code} without a sample`)))
    })
    sample.role = role
    samples.push(sample); console.log(JSON.stringify(sample))
    return sample
  }
  try {
    if (cases[caseName]) {
      const { implementation, bytes } = cases[caseName]
      if (caseName !== 'single-256') {
        for (let run = 0; run < runs; run++) await runSample('relay-stream', 'warm-download', 256 * 1024 ** 2, run, 'reference')
      }
      for (let run = 0; run < runs; run++) await runSample(implementation, 'warm-download', bytes, run)
    } else for (const implementation of ['relay-stream', 'main-url-buffer']) {
      for (const { phase, bytes } of [{ phase: 'cold-init', bytes: 1024 }, { phase: 'warm-download', bytes: 256 * 1024 ** 2 }, { phase: 'warm-download', bytes: 2 * 1024 ** 3 }]) {
        for (let run = 0; run < runs; run++) await runSample(implementation, phase, bytes, run)
      }
    }
    const downloads = samples.filter((s) => s.implementation === 'relay-stream' && s.phase === 'warm-download')
    // Diagnose an observed excess even if a later sample is noisy; never infer a budget pass from that diagnostic.
    diagnosticTriggered = caseName === 'full' && downloads.some((s) => s.memoryMiB.rss.increase > 160)
    if (diagnosticTriggered) {
      for (const implementation of ['receive-drain', 'bridge-drain', 'byob-drain']) {
        for (const bytes of [256 * 1024 ** 2, 2 * 1024 ** 3]) {
          for (let run = 0; run < runs; run++) await runSample(implementation, 'warm-download', bytes, run)
        }
      }
    }
  } catch (error) { failure = error }
  const measured = samples.filter((s) => s.role === 'measurement')
  const references = samples.filter((s) => s.role === 'reference')
  const noisy = samples.some((s) => s.loadBefore >= 10 || s.loadAfter >= 10)
  const referenceRssP95 = summarizeRuns(references.map((s) => s.memoryMiB.rss.increase)).p95
  const measuredRssP95 = summarizeRuns(measured.map((s) => s.memoryMiB.rss.increase)).p95
  let relationships = null
  if (!failure && references.length) {
    const referenceTenths = Math.round(referenceRssP95 * 10), measuredTenths = Math.round(measuredRssP95 * 10)
    relationships = { referenceRssP95, measuredRssP95, sizeDifferenceMiB: Math.abs(measuredTenths - referenceTenths) / 10,
      parallelRatio: measuredRssP95 / referenceRssP95, referenceWithinBudget: referenceTenths > 0 && referenceTenths <= 1600,
      relationWithinBudget: caseName === 'parallel-256' ? measuredTenths <= referenceTenths * 2 : Math.abs(measuredTenths - referenceTenths) <= 320 }
    if (!noisy && runs >= 5 && (!relationships.referenceWithinBudget || !relationships.relationWithinBudget)) failure = new Error(`Media memory relationship budget exceeded: ${JSON.stringify(relationships)}`)
  }
  const report = { scope: 'Split first 1KiB fetch and post-1KiB-warmup transfer/write; fresh client and independent producer each sample; no decode/publication',
    date: new Date().toISOString(), sourceRef, machine: `${process.platform} ${process.arch} ${os.cpus()[0]?.model}`, node: process.version,
    case: caseName, diagnosticTriggered, admissionLoad5, quietWaitMs,
    control: controlRef ? { ref: controlRef, function: 'fetchProviderMedia', sourceUnchanged: true, policy: 'original main byte cap retained; a refused transfer is not a successful-download memory baseline' } : null,
    noisy, runs, samples, relationships,
    ...(caseName !== 'full' ? { metrics: {
      rssMiB: measured.map((s) => s.memoryMiB.rss.increase), heapUsedMiB: measured.map((s) => s.memoryMiB.heapUsed.increase),
      externalMiB: measured.map((s) => s.memoryMiB.external.increase), arrayBuffersMiB: measured.map((s) => s.memoryMiB.arrayBuffers.increase),
      transferMs: measured.map((s) => s.transferMs), ...(measured.every((s) => s.cancelMs !== null) ? { cancelMs: measured.map((s) => s.cancelMs) } : {}),
      ...(references.length ? { referenceRssMiB: references.map((s) => s.memoryMiB.rss.increase) } : {}),
      ...(caseName === 'parallel-256' && referenceRssP95 > 0 ? { memoryGrowthRatio: measured.map((s) => s.memoryMiB.rss.increase / referenceRssP95) } : {}),
    } } : {}),
    ...(failure ? { failure: failure.message } : {}) }
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, JSON.stringify(report, null, 2))
  if (failure) throw failure
}
