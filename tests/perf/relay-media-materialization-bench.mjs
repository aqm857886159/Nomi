#!/usr/bin/env node
// Zero-spend transport instrument. Production streaming sink, true loopback HTTP, producer in a child process.
// Transfer/write and cancellation only; decoder/publication are covered by the protocol matrix.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { performance } from 'node:perf_hooks'
import { require as tsxRequire } from 'tsx/cjs/api'
import { makeTempDir } from '../../scripts/_test-temp.mjs'

if (process.argv.includes('--server')) {
  const chunk = Buffer.alloc(64 * 1024)
  const sockets = new Set()
  const server = http.createServer((req, res) => {
    const size = Number(new URL(req.url, 'http://fixture').searchParams.get('bytes'))
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(size) })
    function* chunks() { for (let left = size; left > 0; left -= chunk.length) yield chunk.subarray(0, Math.min(left, chunk.length)) }
    const source = Readable.from(chunks())
    res.once('close', () => source.destroy())
    source.pipe(res)
  })
  server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  process.send({ port: server.address().port })
  const stop = () => { for (const socket of sockets) socket.destroy(); server.close(() => process.exit(0)) }
  process.once('SIGTERM', stop)
  process.once('disconnect', stop)
} else {
  const { streamProfileMediaToFile } = tsxRequire('../../electron/capabilityCore/generationOutputMaterializer.ts', import.meta.url)
  const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1] }
  const runs = Number(arg('--runs', 5))
  const output = arg('--out', '')
  if (!output || !Number.isInteger(runs) || runs < 5) throw new Error('Use --out <receipt> --runs >=5')
  const root = makeTempDir('relay-media-bench-')
  const producer = fork(fileURLToPath(import.meta.url), ['--server'], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] })
  const samples = []
  try {
    const [{ port }] = await once(producer, 'message')
    const baseUrl = `http://127.0.0.1:${port}`
    for (const bytes of [256 * 1024 ** 2, 2 * 1024 ** 3]) {
      for (let run = 0; run < runs; run++) {
        const file = path.join(root, `download-${bytes}-${run}.mp4`)
        const controller = new AbortController()
        const initialRss = process.memoryUsage().rss
        let peak = initialRss
        const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss) }, 5)
        const start = performance.now()
        try {
          const response = await fetch(`${baseUrl}/?bytes=${bytes}`, { signal: controller.signal })
          await streamProfileMediaToFile(response, file, controller.signal)
        } finally { clearInterval(timer) }
        const diskMs = performance.now() - start
        if (fs.statSync(file).size !== bytes) throw new Error('streamed file has wrong size')
        fs.rmSync(file)
        const cancelFile = path.join(root, `cancel-${bytes}-${run}.mp4`)
        const cancel = new AbortController()
        const response = await fetch(`${baseUrl}/?bytes=${bytes}`, { signal: cancel.signal })
        let abortAt
        // Deliberate cancellation workload, not a wait for a UI/network condition.
        const deadline = setTimeout(() => { abortAt = performance.now(); cancel.abort(new DOMException('Benchmark cancellation', 'AbortError')) }, 25)
        let failed = false
        try { await streamProfileMediaToFile(response, cancelFile, cancel.signal) }
        catch (error) { if (!cancel.signal.aborted) throw error; failed = true }
        finally { clearTimeout(deadline); fs.rmSync(cancelFile, { force: true }) }
        if (!failed || !abortAt) throw new Error('cancellation workload completed before it was cancelled')
        const sample = { bytes, run, peakAdditionalRssMiB: (peak - initialRss) / 1024 ** 2, diskMs, cancelMs: performance.now() - abortAt, load5: os.loadavg()[1] }
        samples.push(sample)
        console.log(JSON.stringify(sample))
      }
    }
  } finally {
    if (producer.exitCode === null) {
      const stopped = once(producer, 'exit')
      producer.kill('SIGTERM') // This PID was spawned above, never a process-name or group kill.
      await stopped
    }
    fs.rmSync(root, { recursive: true, force: true })
  }
  const report = { scope: 'HTTP transfer to file, production sink; producer in separate process; no decode/publication timing', date: new Date().toISOString(), machine: `${process.platform} ${process.arch} ${os.cpus()[0]?.model}`, noisy: samples.some((s) => s.load5 >= 5), runs, samples }
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, JSON.stringify(report, null, 2))
}
