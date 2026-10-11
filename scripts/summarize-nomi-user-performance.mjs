import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { summarizeCell, reportExitCode, validActionSample, percentile } from '../tests/ux/nomi-user-workflow-contract.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Schema2 is immutable historical evidence with different milestone semantics.
// Revalidate its original derivation only to show decoded-content diagnostics.
function validHistoricalSample(sample) {
  const raw = sample?.rawProbe
  if (!sample?.functionalPassed || !sample.assertions?.firstImageDecoded || !sample.assertions?.persistedContentUnchanged || !raw?.documentId || !raw?.probeId || !raw.longTaskSupported) return false
  const marks = [raw.inputAt, raw.visibleAt, raw.readyAt, raw.acknowledgedAt]
  if (marks.some((mark) => !Number.isFinite(mark)) || marks.some((mark, index) => index && mark < marks[index - 1]) || !Array.isArray(raw.frames) || !Array.isArray(raw.longTasks)) return false
  const entries = (values) => values.filter((entry) => Number.isFinite(entry.startTime) && Number.isFinite(entry.duration) && entry.duration >= 0 && entry.startTime >= raw.inputAt && entry.startTime <= raw.acknowledgedAt).map((entry) => Math.min(entry.duration, raw.acknowledgedAt - entry.startTime))
  return sample.inputToVisibleMs === raw.visibleAt - raw.inputAt && sample.inputToReadyMs === raw.readyAt - raw.inputAt && sample.inputToAcknowledgedMs === raw.acknowledgedAt - raw.inputAt && sample.frameTimes?.length > 0 && JSON.stringify(sample.frameTimes) === JSON.stringify(entries(raw.frames)) && JSON.stringify(sample.longTasks) === JSON.stringify(entries(raw.longTasks))
}

export function buildAnalysis(reports) {
  const lines = ['# Nomi user workflow performance analysis', '', 'Coverage is planned / implemented / executed / passed. Node regressions do not execute UI journeys. Cache cells remain separate. Frame/task quantiles pool raw observations within each cell. Loading frames are diagnostics, not active-gesture acceptance.', '',
    'Schema2 reports are historical diagnostics: decoded content and production eligibility were incorrectly paired with first-feedback/interactive budgets. Those budget conclusions withdrawn; original raw statuses and numbers remain unchanged. Document-level Shift is not a target-control response.', '',
    '| Report | Scale | Action | Cache | Status | Feedback p95 ms | Target response p95 ms | Decoded content p95 ms | Eligibility p95 ms | Loading frame p95 / p99 ms | Actions / frames / tasks |',
    '| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |']
  let legacy = 0
  const details = []
  for (const { file, report } of reports) {
    if (![2, 3].includes(report.schemaVersion)) { legacy += 1; continue }
    const historical = report.schemaVersion === 2
    for (const cell of report.cells || []) {
      const invalid = cell.samples?.some((sample) => !(historical ? validHistoricalSample(sample) : validActionSample(sample)))
      const valid = !invalid && ['inconclusive', 'failed_budget', 'passed'].includes(cell.status)
      const samples = valid ? cell.samples || [] : []
      const summary = historical ? summarizeCell({ ...cell, samples: samples.map((sample) => ({ ...sample, inputToContentMs: sample.inputToVisibleMs, inputToReadyEligibilityMs: sample.inputToReadyMs })) }) : summarizeCell({ ...cell, samples })
      const status = invalid ? 'invalid evidence' : historical ? `${cell.status} (historical; budget conclusions withdrawn)` : cell.status === 'passed' && reportExitCode(report) !== 0 ? 'inconclusive (unsupported pass claim)' : cell.status
      lines.push(`| ${file} | ${cell.scale} | ${cell.id} | ${cell.cache} | ${status} | ${summary.feedbackP95 ?? '—'} | ${historical ? '—' : summary.acknowledgedP95 ?? '—'} | ${summary.contentP95 ?? '—'} | ${summary.readyEligibilityP95 ?? '—'} | ${summary.frameP95 ?? '—'} / ${summary.frameP99 ?? '—'}${summary.p99Supported ? '' : ' (unsupported p99)'} | ${summary.actionSamples} / ${summary.frameSamples} / ${summary.longTaskSamples} |`)
      if (cell.reason) details.push('', `Reason (${file}/${cell.scale}/${cell.id}/${cell.cache}): ${cell.reason.replaceAll('\n', ' ').slice(0, 600)}`, '')
      if (cell.acceptanceMissing?.length) details.push('', `Unverified (${file}/${cell.scale}/${cell.id}/${cell.cache}): ${cell.acceptanceMissing.join('; ')}.`, '')
      if (historical && samples.length) details.push('', `Historical document-key diagnostic p95 (${file}/${cell.cache}): ${percentile(samples.map((sample) => sample.inputToAcknowledgedMs), 0.95)}ms; no target-control interactivity claim.`, '')
    }
  }
  lines.push(...details, '', `Legacy reports: ${legacy} — untrusted measurement schema; preserved as historical launch evidence only. Their elapsed times and percentile summaries are never treated as visible latency.`, '', 'No full-product coverage, real hardware baseline or acceptance is claimed.', '')
  return { markdown: lines.join('\n'), exitCode: reports.length && !legacy && reports.every(({ report }) => reportExitCode(report) === 0) ? 0 : 2 }
}

function main() {
  const inputDir = process.argv[2] || path.join(repoRoot, 'docs/evidence/2026-10-10-nomi-user-performance/raw')
  const output = process.argv[3] || path.join(repoRoot, 'docs/evidence/2026-10-10-nomi-user-performance/analysis.md')
  const files = fs.existsSync(inputDir) ? fs.readdirSync(inputDir).filter((file) => file.endsWith('.json')).sort() : []
  const result = buildAnalysis(files.map((file) => ({ file, report: JSON.parse(fs.readFileSync(path.join(inputDir, file), 'utf8')) })))
  fs.writeFileSync(output, result.markdown)
  console.log(JSON.stringify({ output, reports: files.length, acceptanceExitCode: result.exitCode }))
  process.exitCode = result.exitCode
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main()
