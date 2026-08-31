import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EvidenceRecorder, JourneyBlocked, JourneyFailure } from './evidence.mjs'
import { startFixtureServer } from './fixture-server.mjs'
import { assertCaseRegistry, JOURNEY_CASES } from './journey-cases.mjs'
import { MODEL_ACCESS_JOURNEYS } from './manifest.mjs'
import { launchJourneyUi } from './ui-driver.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../..')

function timestamp() {
  return new Date().toISOString().replaceAll(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}

function outputRoot() {
  return process.env.NOMI_MODEL_ACCESS_OUTPUT_ROOT || path.join(repoRoot, '.tmp/model-access-journeys', timestamp())
}

function fixtureFault(journeyId) {
  if (journeyId !== 'J15') return {}
  const html = '<!doctype html><title>gateway dashboard</title><h1>not a model list</h1>'
  return {
    '/models': { status: 200, raw: html, contentType: 'text/html' },
    '/v1/models': { status: 200, raw: html, contentType: 'text/html' },
  }
}

function requiredPhases(journeyId) {
  if (journeyId === 'J15') return ['entry', 'observed', 'rendered']
  if (['J02', 'J03', 'J08', 'J09', 'J10', 'J13', 'J14'].includes(journeyId)) return ['entry', 'persisted', 'observed', 'executed', 'rendered']
  const phases = ['entry', 'persisted', 'observed', 'executed', 'rendered']
  if (['J05', 'J07', 'J12', 'J16'].includes(journeyId)) phases.push('recovered')
  return phases
}

function validateCompletion(recorder) {
  const passed = new Set(recorder.report.spans.filter((span) => span.status === 'PASS').map((span) => span.phase))
  const missing = requiredPhases(recorder.journey.id).filter((phase) => !passed.has(phase))
  if (missing.length) throw new Error(`Journey case returned without required PASS evidence: ${missing.join(', ')}`)
}

export async function runJourneys(journeys, { root = outputRoot() } = {}) {
  assertCaseRegistry(MODEL_ACCESS_JOURNEYS)
  fs.mkdirSync(root, { recursive: true })
  const reports = []
  for (const journey of journeys) {
    const recorder = new EvidenceRecorder({ journey, outputRoot: root })
    let fixture
    let ui
    let error
    try {
      fixture = await startFixtureServer({ repoRoot, fault: fixtureFault(journey.id) })
      ui = await launchJourneyUi({ journey, recorder })
      await JOURNEY_CASES[journey.id](journey, ui, fixture, recorder)
      validateCompletion(recorder)
      reports.push(recorder.finish('PASS'))
      console.log(`PASS ${journey.id} ${journey.title}`)
    } catch (caught) {
      error = caught
      const status = caught instanceof JourneyBlocked ? 'BLOCKED' : caught instanceof JourneyFailure ? 'FAIL' : 'HARNESS_ERROR'
      reports.push(recorder.finish(status, caught))
      console.log(`${status} ${journey.id} ${journey.title}: ${caught?.message || String(caught)}`)
    } finally {
      if (fixture) recorder.attachRequests(fixture.requests)
      if (ui) {
        for (const diagnostic of ui.diagnostics) recorder.diagnostic(diagnostic)
        await ui.close()
      }
      if (fixture) await fixture.close()
      recorder.flush()
    }
    if (error && process.env.NOMI_MODEL_ACCESS_FAIL_FAST === '1') break
  }
  writeSummary(root, reports)
  return { root, reports }
}

function writeSummary(root, reports) {
  const counts = Object.fromEntries(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN', 'HARNESS_ERROR'].map((status) => [status, reports.filter((report) => report.status === status).length]))
  const summary = { schemaVersion: 1, generatedAt: new Date().toISOString(), counts, reports: reports.map((report) => ({ journeyId: report.journeyId, title: report.title, requirement: report.requirement, status: report.status, durationMs: report.durationMs, error: report.error })) }
  fs.writeFileSync(path.join(root, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  const rows = reports.map((report) => `| ${report.journeyId} | ${report.requirement} | ${report.status} | ${report.error?.code || ''} | ${String(report.error?.message || '').replaceAll('|', '\\|')} |`)
  fs.writeFileSync(path.join(root, 'summary.md'), [
    '# Model Access Journey Report', '',
    `Generated: ${summary.generatedAt}`, '',
    `PASS ${counts.PASS} / FAIL ${counts.FAIL} / BLOCKED ${counts.BLOCKED} / HARNESS_ERROR ${counts.HARNESS_ERROR}`, '',
    '| Journey | Requirement | Status | Code | Detail |', '|---|---|---|---|---|', ...rows, '',
  ].join('\n'))
}

export async function runJourneyFile(fileName) {
  const owned = MODEL_ACCESS_JOURNEYS.filter((journey) => journey.script === fileName)
  if (owned.length === 0) throw new Error(`No journeys own ${fileName}`)
  const result = await runJourneys(owned)
  const failed = result.reports.some((report) => report.status === 'FAIL' || report.status === 'HARNESS_ERROR')
  if (failed) process.exitCode = 1
  return result
}

function selectedJourneys(args) {
  const requested = args.filter((arg) => /^J\d+$/i.test(arg)).map((arg) => arg.toUpperCase())
  if (requested.length === 0 || args.includes('--all')) return MODEL_ACCESS_JOURNEYS
  const selected = MODEL_ACCESS_JOURNEYS.filter((journey) => requested.includes(journey.id))
  const unknown = requested.filter((id) => !selected.some((journey) => journey.id === id))
  if (unknown.length) throw new Error(`Unknown journey ids: ${unknown.join(', ')}`)
  return selected
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runJourneys(selectedJourneys(process.argv.slice(2)))
  if (result.reports.some((report) => report.status === 'FAIL' || report.status === 'HARNESS_ERROR')) process.exitCode = 1
  console.log(`Report: ${path.relative(repoRoot, result.root)}`)
}

