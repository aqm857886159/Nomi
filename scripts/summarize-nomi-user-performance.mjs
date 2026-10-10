import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const inputDir = process.argv[2] || path.join(repoRoot, 'docs', 'evidence', '2026-10-10-nomi-user-performance', 'raw')
const output = process.argv[3] || path.join(repoRoot, 'docs', 'evidence', '2026-10-10-nomi-user-performance', 'analysis.md')

function percentile(values, p) {
  const numbers = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!numbers.length) return null
  const index = (numbers.length - 1) * p
  const low = Math.floor(index)
  const high = Math.ceil(index)
  return low === high ? numbers[low] : numbers[low] + (numbers[high] - numbers[low]) * (index - low)
}

const files = fs.existsSync(inputDir) ? fs.readdirSync(inputDir).filter((file) => file.endsWith('.json')).sort() : []
const reports = files.map((file) => JSON.parse(fs.readFileSync(path.join(inputDir, file), 'utf8')))
const rows = []
for (const report of reports) {
  for (const scale of report.scales || []) {
    for (const scenario of scale.scenarios || []) {
      const samples = scenario.samples || []
      rows.push({
        scale: scale.scale,
        scenario: scenario.id,
        status: scenario.status,
        visibleP95: percentile(samples.map((sample) => sample.elapsedMs), 0.95),
        frameP95: percentile(samples.map((sample) => sample.frameP95), 0.95),
        frameP99: percentile(samples.map((sample) => sample.frameP99), 0.99),
        longTaskP95: percentile(samples.map((sample) => sample.longTaskP95), 0.95),
        droppedRatioP95: percentile(samples.map((sample) => sample.droppedFrameRatio), 0.95),
        reason: scenario.reason || '',
      })
    }
  }
}
const blocked = rows.filter((row) => row.status === 'blocked')
const measured = rows.filter((row) => row.status === 'measured')
const lines = [
  '# Nomi user workflow performance analysis',
  '',
  `Generated from ${files.length} raw report${files.length === 1 ? '' : 's'} in \`${inputDir.replace(repoRoot, '<repo>')}\`.`,
  '',
  'The matrix and budgets in `scenario-matrix-and-budget.md` are fixed before measurement. A blocked row has no timing value and cannot be compared with a budget.',
  '',
  '| Scale | Scenario | Status | Visible/action p95 (ms) | Frame p95 (ms) | Frame p99 (ms) | Long task p95 (ms) | Dropped p95 |',
  '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
]
for (const row of rows) {
  lines.push(`| ${row.scale} | ${row.scenario} | ${row.status} | ${row.visibleP95 ?? '—'} | ${row.frameP95 ?? '—'} | ${row.frameP99 ?? '—'} | ${row.longTaskP95 ?? '—'} | ${row.droppedRatioP95 == null ? '—' : `${(row.droppedRatioP95 * 100).toFixed(2)}%`} |`)
}
lines.push('', `Measured rows: ${measured.length}; blocked rows: ${blocked.length}.`)
if (blocked.length) {
  lines.push('', '## Blocked rows', '')
  const reasons = new Map()
  for (const row of blocked) {
    const key = `${row.scale}|${row.reason || 'unspecified'}`
    reasons.set(key, (reasons.get(key) || { scale: row.scale, reason: row.reason || 'unspecified', count: 0 }))
    reasons.get(key).count += 1
  }
  for (const item of reasons.values()) lines.push(`- ${item.scale}: ${item.count} rows — ${item.reason.replaceAll('\n', ' ').slice(0, 280)}`)
}
lines.push('', '## Interpretation', '', '- Model/network wait is represented by `fixture.agent` and must be read separately from UI timing.', '- No production optimization is claimed until a display-capable runner produces baseline samples for the same matrix.', '')
fs.writeFileSync(output, `${lines.join('\n')}\n`)
console.log(JSON.stringify({ output, reports: files.length, measured: measured.length, blocked: blocked.length }, null, 2))
