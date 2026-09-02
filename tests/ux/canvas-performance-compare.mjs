// Compare two canvas benchmark JSON files. Lower is better unless noted.
// Usage: node tests/ux/canvas-performance-compare.mjs baseline.json candidate.json
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const positional = args.filter((arg) => !arg.startsWith('-'))
const argValue = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
if (positional.length < 2 || args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node tests/ux/canvas-performance-compare.mjs <baseline.json> <candidate.json> [--max-regression 0.10] [--noise-floor 0.05] [--output report.json]')
  process.exit(positional.length < 2 ? 1 : 0)
}

const maxRegression = Number(argValue('--max-regression') || 0.10)
const noiseFloor = Number(argValue('--noise-floor') || 0.05)
const outputPath = argValue('--output')
const readResult = (file) => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'))
const baseline = readResult(positional[0])
const candidate = readResult(positional[1])

const METRICS = {
  coldFirstCanvasMs: { field: 'median', direction: 'lower', absoluteNoise: 50 },
  fps: { field: 'median', direction: 'higher', absoluteNoise: 5 },
  frameGapP95Ms: { field: 'p95', direction: 'lower', absoluteNoise: 4 },
  maxFrameGapMs: { field: 'p95', direction: 'lower', absoluteNoise: 10 },
  longTaskMs: { field: 'p95', direction: 'lower', absoluteNoise: 10 },
  longTaskP95Ms: { field: 'p95', direction: 'lower', absoluteNoise: 10 },
  layoutCount: { field: 'median', direction: 'lower', absoluteNoise: 2 },
  recalcStyleCount: { field: 'median', direction: 'lower', absoluteNoise: 5 },
  scriptDurationMs: { field: 'median', direction: 'lower', absoluteNoise: 20 },
  layoutDurationMs: { field: 'median', direction: 'lower', absoluteNoise: 2 },
  jsHeapUsedMB: { field: 'median', direction: 'lower', absoluteNoise: 8 },
  // Independent Electron launches vary with Chromium/OS process accounting; report it, but gate leaks via reloadHeapDeltaMB.
  rendererWorkingSetMB: { field: 'median', direction: 'lower', absoluteNoise: 64, advisory: true },
  reloadHeapDeltaMB: { field: 'p95', direction: 'lower', absoluteNoise: 5 },
}

function changeRatio(before, after, direction) {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null
  if (before === 0) return after === 0 ? 0 : null
  return direction === 'higher' ? (before - after) / before : (after - before) / Math.abs(before)
}

const comparisons = []
const missingScenarios = []
for (const [scenario, baseSummary] of Object.entries(baseline.summary || {})) {
  const nextSummary = candidate.summary?.[scenario]
  if (!nextSummary) {
    missingScenarios.push(scenario)
    continue
  }
  for (const [metric, config] of Object.entries(METRICS)) {
    const before = baseSummary.metrics?.[metric]?.[config.field]
    const after = nextSummary.metrics?.[metric]?.[config.field]
    const ratio = changeRatio(before, after, config.direction)
    if (ratio === null) continue
    const absoluteChange = Math.abs(after - before)
    const outsideAbsoluteNoise = absoluteChange >= config.absoluteNoise
    const classification = ratio > maxRegression && outsideAbsoluteNoise
      ? config.advisory ? 'advisory-regression' : 'regression'
      : ratio < -maxRegression && outsideAbsoluteNoise
        ? 'improvement'
        : Math.abs(ratio) < noiseFloor || !outsideAbsoluteNoise
          ? 'noise'
          : 'watch'
    comparisons.push({
      scenario,
      metric,
      statistic: config.field,
      before,
      after,
      absoluteChange: Math.round(absoluteChange * 10) / 10,
      changePct: Math.round(ratio * 1000) / 10,
      classification,
    })
  }
}

const hardFailures = Object.entries(candidate.summary || {}).flatMap(([scenario, summary]) =>
  (summary.verdict?.hardFailures || []).map((failure) => ({ scenario, ...failure })),
)
// advisory budget checks (e.g. maxFrameGapMs) are recorded for visibility
// but do not gate the compare run. See PERFORMANCE_BUDGETS comment in
// canvas-performance-benchmark.e2e.mjs for rationale.
const budgetFailures = Object.entries(candidate.summary || {}).flatMap(([scenario, summary]) =>
  (summary.verdict?.budgetChecks || [])
    .filter((check) => !check.pass && !check.advisory)
    .map((check) => ({ scenario, ...check })),
)
const regressions = comparisons.filter((item) => item.classification === 'regression')
const advisoryRegressions = comparisons.filter((item) => item.classification === 'advisory-regression')
const improvements = comparisons.filter((item) => item.classification === 'improvement')
const report = {
  baseline: { label: baseline.label, commit: baseline.commit },
  candidate: { label: candidate.label, commit: candidate.commit },
  thresholds: { maxRegression, noiseFloor },
  pass:
    missingScenarios.length === 0 &&
    hardFailures.length === 0 &&
    budgetFailures.length === 0 &&
    regressions.length === 0,
  missingScenarios,
  hardFailures,
  budgetFailures,
  regressions,
  advisoryRegressions,
  improvements,
  comparisons,
}

console.log(`Canvas performance: ${baseline.label} -> ${candidate.label}`)
for (const item of comparisons.filter((entry) => entry.classification !== 'noise')) {
  console.log(`${item.classification.padEnd(11)} ${item.scenario} ${item.metric}.${item.statistic}: ${item.before} -> ${item.after} (${item.changePct}%)`)
}
console.log(`Result: ${report.pass ? 'PASS' : 'FAIL'}; ${improvements.length} improvements, ${regressions.length} regressions, ${budgetFailures.length} budget failures, ${hardFailures.length} hard failures`)

if (outputPath) {
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true })
  fs.writeFileSync(path.resolve(outputPath), JSON.stringify(report, null, 2))
}
if (!report.pass) process.exitCode = 1
