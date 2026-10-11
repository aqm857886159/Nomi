import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { summarizeCell, reportExitCode, validActionSample } from '../tests/ux/nomi-user-workflow-contract.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export function buildAnalysis(reports) {
  const lines = ['# Nomi user workflow performance analysis', '', 'Coverage is planned / implemented / executed / passed. Node regressions do not execute UI journeys. Each cache cell remains separate; quantiles pool raw frame/task distributions within that cell only.', '', '| Report | Scale | Action | Cache | Status | Visible p95 ms | Ready p95 ms | Frame p95 ms | Frame p99 ms | Actions / frames / tasks |', '| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |']
  let legacy = 0
  const details = []
  for (const { file, report } of reports) {
    if (report.schemaVersion !== 2) { legacy += 1; continue }
    for (const cell of report.cells || []) {
      const invalid = cell.samples?.some((sample) => !validActionSample(sample))
      const valid = !invalid && ['inconclusive', 'failed_budget', 'passed'].includes(cell.status)
      const summary = summarizeCell({ ...cell, samples: valid ? cell.samples : [] })
      lines.push(`| ${file} | ${cell.scale} | ${cell.id} | ${cell.cache} | ${invalid ? 'invalid evidence' : cell.status === 'passed' && reportExitCode(report) !== 0 ? 'inconclusive (unsupported pass claim)' : cell.status} | ${summary.visibleP95 ?? '—'} | ${summary.readyP95 ?? '—'} | ${summary.frameP95 ?? '—'} | ${summary.frameP99 ?? '—'}${summary.p99Supported ? '' : ' (unsupported)'} | ${summary.actionSamples} / ${summary.frameSamples} / ${summary.longTaskSamples} |`)
      if (cell.reason) details.push('', `Reason (${file}/${cell.scale}/${cell.id}/${cell.cache}): ${cell.reason.replaceAll('\n', ' ').slice(0, 600)}`, '')
      if (cell.acceptanceMissing?.length) details.push('', `Unverified (${file}/${cell.scale}/${cell.id}/${cell.cache}): ${cell.acceptanceMissing.join('; ')}.`, '')
    }
  }
  lines.push(...details, '', `Legacy reports: ${legacy} — untrusted measurement schema; preserved as historical launch evidence only. Their elapsed times and percentile summaries are never treated as visible latency.`, '', 'No production optimization, full-product coverage, real hardware baseline or acceptance is claimed.', '')
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
