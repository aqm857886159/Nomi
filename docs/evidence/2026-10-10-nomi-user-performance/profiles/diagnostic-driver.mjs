import fs from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { runCell, measureProjectOpen, redact } from '/workspace/Nomi/tests/ux/nomi-user-workflow-performance.e2e.mjs'
import { launchNomiApp } from '/workspace/Nomi/tests/ux/_launchApp.mjs'
const root = '/workspace/Nomi'
const out = path.join(root, 'docs/evidence/2026-10-10-nomi-user-performance/profiles')
fs.mkdirSync(out, { recursive: true })
const traced = process.argv.includes('--trace')
const id = `${traced ? 'trace' : 'stages'}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`
const artifact = (name, value, compress = false) => {
  const file = path.join(out, `${id}-${name}${compress ? '.gz' : ''}`)
  const data = JSON.stringify(redact(value))
  fs.writeFileSync(file, compress ? gzipSync(data) : data, { flag: 'wx' })
  return { file: path.relative(root, file), sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') }
}
const report = { diagnostic: true, schemaVersion: 1, id, generatedAt: new Date().toISOString(), traced,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceHashes: Object.fromEntries(['tests/ux/nomi-user-workflow-contract.mjs', 'tests/ux/nomi-user-workflow-probe.mjs', 'tests/ux/nomi-user-workflow-performance.e2e.mjs', 'tests/ux/fixtures/nomi-user-workflow-fixture.mjs'].map((file) => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')])),
  environment: { platform: process.platform, display: process.env.DISPLAY, viewport: '1280x933', electron: '43.4.1' },
  limits: 'Profiling adds overhead. Not baseline or acceptance. Main and renderer clocks separate. End collection follows frozen action marks; profile interval includes profiler transport around input.', cells: [] }
for (const cache of ['cold', 'hot']) {
  let logPath, cdp, traceEvents, traceComplete
  const cell = await runCell({ id: 'project.open', scale: 'small', cache }, { warmup: 0, runs: traced ? 1 : 2, launchTimeout: 15000 }, {
    launch: async (config) => {
      logPath = config.env.NOMI_WALK_NET_LOG
      return launchNomiApp({ ...config, initialLocalStorage: { 'nomi:perf-marks': '1' },
        env: { ...config.env, NOMI_PERF_MARKS: '1' },
        mainRequire: [...config.mainRequire, path.join(root, 'tests/ux/perf/openWriteProbe.cjs'), path.join(root, 'tests/ux/perf/openModuleProbe.cjs'), ...(traced ? ['/tmp/nomi-main-cpu-probe.cjs'] : [])] })
    },
    measure: async (instance, fixture) => {
      const sample = await measureProjectOpen(instance, fixture, {
        beforeInput: async ({ app, win }) => {
          await app.evaluate(() => {
            for (const entry of performance.getEntries()) if (entry.name.startsWith('nomi:open:main:')) { performance.clearMarks(entry.name); performance.clearMeasures(entry.name) }
            globalThis.__nomiOpenWriteProbe.arm(); globalThis.__nomiOpenModuleProbe.arm()
          })
          if (!traced) return
          cdp = await app.context().newCDPSession(win)
          traceEvents = []
          cdp.on('Tracing.dataCollected', ({ value }) => traceEvents.push(...value))
          traceComplete = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve))
          await cdp.send('Tracing.start', { categories: 'devtools.timeline,v8.execute,blink.user_timing', options: 'sampling-frequency=1000' })
          await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }); await cdp.send('Profiler.start')
          await app.evaluate(async () => { await globalThis.__nomiDiagnosticCpu.arm() })
        },
        afterSnapshot: async ({ app, win }, state) => {
          const rendererStages = await win.evaluate(() => performance.getEntries().filter((entry) => entry.name.startsWith('nomi:open:')).map(({ name, entryType, startTime, duration }) => ({ name, entryType, startTime, duration })))
          const main = await app.evaluate(() => ({ stages: performance.getEntriesByType('measure').filter((entry) => entry.name.startsWith('nomi:open:main:')).map(({ name, startTime, duration }) => ({ name, startTime, duration })), writes: globalThis.__nomiOpenWriteProbe.take(), modules: globalThis.__nomiOpenModuleProbe.take() }))
          const files = {}
          if (traced) {
            files.rendererCpu = artifact(`${cache}-renderer.cpuprofile`, (await cdp.send('Profiler.stop')).profile)
            files.mainCpu = artifact(`${cache}-main.cpuprofile`, await app.evaluate(async () => globalThis.__nomiDiagnosticCpu.take()))
            await cdp.send('Tracing.end'); await traceComplete
            files.trace = artifact(`${cache}-trace.json`, { traceEvents }, true)
            await cdp.detach()
          }
          const guards = fs.readFileSync(logPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
          const loaded = guards.find((entry) => entry.kind === 'guard-loaded')
          if (!['fetch', 'http', 'https', 'socket', 'chromium'].every((layer) => loaded?.layers?.includes(layer)) || guards.some((entry) => entry.kind === 'guard-error')) throw new Error('diagnostic guard incomplete')
          return { diagnostic: true, rendererStages, main, artifacts: files, frozenMarks: state,
            guard: { layers: loaded.layers, blockedAttempts: guards.filter((entry) => entry.kind === 'blocked').length } }
        },
      })
      return sample
    },
  })
  report.cells.push(cell)
  console.log(JSON.stringify(redact({ cache, status: cell.status, reason: cell.reason, summary: cell.summary, diagnostics: cell.samples.map((sample) => sample.diagnostics) })))
}
console.log(JSON.stringify(artifact('receipt.json', report)))
if (report.cells.some((cell) => ['failed', 'invalid', 'blocked_environment'].includes(cell.status))) process.exitCode = 1
