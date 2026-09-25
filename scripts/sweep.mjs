#!/usr/bin/env node
import fs from 'node:fs'
import { stationTimeout } from '../tests/ux/_station-budget.mjs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'
import { execFileSync, execFile } from 'node:child_process'
import { createWalkSession, scanFeel } from '../tests/ux/_assert.mjs'
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import { createAgentRuntimeFixture } from '../tests/ux/agent-runtime-fixture.mjs'
import { DOCUMENT } from '../tests/ux/agent-runtime-walk-support.mjs'
import { startEvidence, copyTranscripts, writeJson, saveCase, saveReport, scoreCollectedAgent } from '../tests/ux/g1/sweep-evidence.mjs'
import { prepareRealText, attachRealText } from '../tests/ux/g1/sweep-real.mjs'
import { requireCredential, recordBlocked } from '../tests/ux/g1/credential-precheck.mjs'
import { realNomiProfile } from '../tests/ux/_realProfile.mjs'
import { c0Invocation } from '../tests/ux/g1/sweep-c0.mjs'
import { runSurface } from '../tests/ux/g1/sweep-surfaces.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({ options: { packaged: { type: 'string' }, 'real-text': { type: 'boolean' },
  'planner-model': { type: 'string' }, budget: { type: 'string', default: '3' }, case: { type: 'string' }, help: { type: 'boolean' } } })
if (values.help) {
  console.log('pnpm run sweep [--packaged /absolute/Nomi.app] [--budget 3] [--case C0] [--real-text] [--planner-model gpt-5-nano|deepseek-v4-pro]')
  process.exit(0)
}
const budgetCny = Number(values.budget)
if (!Number.isFinite(budgetCny) || budgetCny < 0 || budgetCny > 3) throw Error('Sweep budget must be 0–3 CNY')
if (values['planner-model'] && (!values['real-text'] || values.case !== 'C0')) throw Error('--planner-model requires --real-text --case C0')
const runId = new Date().toISOString().replaceAll(':', '-'), directory = path.join(root, 'artifacts/sweep', runId)
fs.mkdirSync(directory, { recursive: true })
const cases = JSON.parse(fs.readFileSync(path.join(root, 'tests/ux/g1/cases.json'), 'utf8'))
const runs = [], skipped = []
let credentialBlock
if (values.case && !cases.some(c => c.id === values.case)) throw Error(`Unknown case: ${values.case}`)
const sourceFiles = ['scripts/sweep.mjs', 'tests/ux/_assert.mjs', 'tests/ux/_station-budget.mjs', 'tests/ux/_collect.mjs', ...fs.readdirSync(path.join(root, 'tests/ux/g1')).filter(f => /\.(mjs|json)$/.test(f)).map(f => `tests/ux/g1/${f}`)]
writeJson(path.join(directory, 'source-files.json'), Object.fromEntries(sourceFiles.map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')])))
writeJson(path.join(directory, 'run.json'), { runId, sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), budgetCny, mode: values['real-text'] ? 'real-text' : 'loopback', packaged: values.packaged ?? null })
for (const entry of cases) for (const input of entry.inputs) {
  const id = `${entry.id}-${input.id}`
  if (values.case && values.case !== entry.id) continue
  if (input.status !== 'runnable-now') { skipped.push({ id, status: input.status, reason: input.reason }); continue }
  const target = path.join(directory, id), profile = path.join(target, 'profile')
  fs.mkdirSync(target, { recursive: true })
  const record = { id, surface: input.surface, costCny: 0, stations: [], deviations: [] }
  runs.push(record)
  let launched, fixture, evidence, projectId, real, billingVerified = false
  const realText = values['real-text'] && ['agent-panel', 'storyboard'].includes(input.surface) && Boolean(input.text)
  const ledgerPath = path.join(directory, 'real-budget-ledger.json')
  const priorBilled = fs.existsSync(ledgerPath) ? (JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).billedCny ?? 0) : 0
  const priorReserved = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).reservedCny : 0
  const payload = async () => projectId ? (await launched.win.evaluate(id => window.nomiDesktop.projects.readAsync(id), projectId)).payload : null
  const walk = createWalkSession({ mode: 'collect', cost: () => fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).reservedCny : 0, capture: row => evidence?.capture(row), persist: w => {
    Object.assign(record, { stations: w.stations, deviations: w.deviations }); saveCase(target, w)
  } })
  const station = (id, expected, fn) => walk.station({ id, surface: input.surface, expected }, fn)
  console.log(`SWEEP ${id}`)
  const needsCredential = realText || (input.executor === 'c0' && values['real-text'])
  if (needsCredential) {
    try {
      if (credentialBlock) throw Object.assign(Error('CREDENTIAL_BLOCKED'), { receipt: credentialBlock })
      requireCredential(realNomiProfile().catalogPath, target)
    } catch (error) {
      if (!error.receipt) throw error
      credentialBlock = error.receipt
      writeJson(path.join(target, 'credential-precheck.json'), credentialBlock)
      recordBlocked(target, record, credentialBlock, input.executor === 'c0' ? ['00','01','02','03','04','05','06','07'] : ['launch','input','agent','storyboard','agent-evidence','feel'])
      saveReport(directory, runs, skipped, budgetCny)
      continue
    }
  }
  if (input.executor === 'c0') {
    let childError
    try {
      const child = c0Invocation({ root, target, directory, realText: values['real-text'],
        plannerModel: values['planner-model'], budgetCny, packaged: values.packaged })
      await promisify(execFile)(process.execPath, child.args, { cwd: root, env: child.env, maxBuffer: 1024 * 1024 })
    } catch (error) { childError = error }
    for (const key of ['stations', 'deviations']) if (fs.existsSync(path.join(target, `${key}.json`))) record[key] = JSON.parse(fs.readFileSync(path.join(target, `${key}.json`), 'utf8'))
    const childReport = path.join(target, 'report.json')
    if (fs.existsSync(childReport)) {
      const result = JSON.parse(fs.readFileSync(childReport, 'utf8'))
      Object.assign(record, { result: result.result, credentialPrecheck: result.credentialPrecheck, costCny: result.costCny, reservedCny: result.reservedCny, mediaMode: result.mediaMode, plannerModel: result.plannerModel })
    }
    if (record.result === 'blocked') credentialBlock = record.credentialPrecheck
    Object.assign(walk, { stations: record.stations, deviations: record.deviations })
    if (childError) walk.record(Error(`C0 child failed: ${childError.code ?? 'unknown'}`), { id: 'c0-process', surface: 'storyboard' })
    if (!fs.existsSync(path.join(target, 'trace.zip'))) fs.writeFileSync(path.join(target, 'trace-unavailable.md'), 'C0 tracing did not finish; see deviations.json.\n')
    saveReport(directory, runs, skipped, budgetCny)
    continue
  }
  try {
    if (realText) real = await prepareRealText(profile)
    else fixture = await createAgentRuntimeFixture({ rootDir: root, settingsDir: path.join(profile, 'settings') })
    let executablePath = values.packaged
    if (executablePath?.endsWith('.app')) executablePath = path.join(executablePath, 'Contents/MacOS/Nomi')
    launched = await launchNomiApp({ name: id, tempRoot: profile, capabilityDir: path.join(profile, 'capability'), settleMs: 0,
      // 真文本：凭据钥匙（Windows 的 Local State）已被 prepareIsolation 种进 iso.chromiumDir，App 必须就从那份 userData 起。
      ...(real ? { userDataDir: real.iso.chromiumDir, settingsDir: real.iso.settingsDir } : {}),
      ...(executablePath ? { executablePath } : {}),
      env: { NOMI_RENDERER_URL: '', VITE_DEV_SERVER_URL: '', NOMI_DESKTOP_DEV: '', NOMI_E2E_PRODUCTION_FIXTURE: '0', NOMI_DISABLE_AUTO_UPDATE: '1' } })
    // Before collect: blocked credentials cannot become a failed/repaired station.
    if (real) await attachRealText(launched, { profile, quote: real.quote, ledgerPath, budgetCny, requestsPath: path.join(target, 'model-requests.json') })
    await station('launch', '独立 profile 启动真实 Electron', async () => {
      evidence = await startEvidence({ ...launched, directory: target, payload })
      launched.win.setDefaultTimeout(stationTimeout())
      await launched.win.evaluate(() => {
        localStorage.setItem('nomi:locale:v1', 'zh-CN')
        for (const key of ['nomi:splash:v1','nomi:journey-tour:v1','nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
      })
      await launched.win.reload({ waitUntil: 'domcontentloaded' })
      await launched.win.getByRole('button', { name: /^新建空白项目/ }).click()
      await launched.win.locator(DOCUMENT).waitFor()
      const projects = await launched.win.evaluate(() => window.nomiDesktop.projects.listAsync())
      projectId = projects[0].id
    })
    await runSurface({ walk, win: launched?.win, input, fixture, realText, directory: target, payload, projectId })
    if (launched && input.surface === 'mcp') await (await import('../tests/ux/g1/sweep-mcp.mjs')).inspectMcp({ profile, directory: target, projectId, packaged: values.packaged, input, walk })
    await station('agent-evidence', '原生转录、请求与工具结果可复盘', async () => {
      // Request bodies are original provider input; authentication headers are never copied.
      if (fixture) writeJson(path.join(target, 'model-requests.json'), fixture.requests.map(r => ({ path: r.path, body: r.body })))
      const files = copyTranscripts(profile, target)
      const agentAttempt = ['agent-panel','storyboard'].includes(input.surface) && Boolean(input.text)
      const tools = JSON.parse(fs.readFileSync(path.join(target, 'tools.json'), 'utf8'))
      writeJson(path.join(target, 'r30.json'), scoreCollectedAgent({ tools, stations: walk.stations, deviations: walk.deviations,
        stationId: 'agent', population: realText ? 'real-text' : 'loopback', attempted: agentAttempt }))
      if (agentAttempt && !files.length) throw Error('当前旧运行时没有 pi 原生 JSONL；请求已存，原生转录缺失')
    })
    await station('feel', '复用 main 的体感扫描', async () => {
      writeJson(path.join(target, 'feel.json'), await scanFeel(launched.win, { label: id }))
    })

  } catch (error) {
    if (error.code === 'CREDENTIAL_BLOCKED') {
      credentialBlock = error.receipt
      recordBlocked(target, record, credentialBlock, ['launch','input','agent','storyboard','agent-evidence','feel'])
      Object.assign(walk, { stations: record.stations, deviations: record.deviations })
    } else walk.record(error, { id: 'assembly', surface: input.surface, reachedViaRepair: false })
  }
  finally {
    try {
      if (real && launched && record.result !== 'blocked') for (const error of await launched.app.evaluate(async () => globalThis.__sweepDispatch?.drainResponses() ?? [])) {
        walk.record(Error(`Response evidence failed: ${error.file}: ${error.message}`), { id: 'response-evidence', surface: input.surface })
      }
    } catch (error) { walk.record(error, { id: 'response-evidence', surface: input.surface }) }
    try { if (real && launched && record.result !== 'blocked') { await launched.app.evaluate(async () => globalThis.__sweepDispatch.snapshot()); billingVerified = true } }
    catch (e) { walk.record(Error('SWEEP_BILLING_UNAVAILABLE'), { id: 'billing', surface: input.surface }) }
    try { if (evidence) await evidence.stop() } catch (e) { walk.record(e, { id: 'trace-stop', surface: input.surface }) }
    try { if (launched && record.result !== 'blocked') await launched.close() } catch (e) { walk.record(e, { id: 'close', surface: input.surface }) }
    try { if (fixture) await fixture.close() } catch (e) { walk.record(e, { id: 'fixture-close', surface: input.surface }) }
    if (real && record.result !== 'blocked' && fs.existsSync(ledgerPath)) {
      const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
      record.reservedCny = ledger.reservedCny - priorReserved
      record.costCny = billingVerified && Number.isFinite(ledger.billedCny) ? ledger.billedCny - priorBilled : null
      record.costBasis = 'provider token balance delta; shared-token concurrent usage may be included'
      writeJson(path.join(target, 'cost.json'), { costCny: record.costCny, reservedCny: record.reservedCny, basis: record.costBasis })
      fs.rmSync(path.join(profile, 'settings'), { recursive: true, force: true })
    }
    if (realText) fs.rmSync(path.join(profile, 'settings'), { recursive: true, force: true })
    if (!fs.existsSync(path.join(target, 'trace.zip'))) fs.writeFileSync(path.join(target, 'trace-unavailable.md'), 'Electron/tracing did not start or failed; see deviations.json.\n')
    saveCase(target, walk)
    saveReport(directory, runs, skipped, budgetCny)
  }
}
saveReport(directory, runs, skipped, budgetCny)
console.log(`SWEEP_REPORT ${path.join(directory, 'report.md')}`)
// Completed collection can contain product failures; consumers must inspect deviations, not exit status.
