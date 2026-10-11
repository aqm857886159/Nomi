import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const allScales = ['small', 'typical', 'heavy']
const largerScales = ['typical', 'heavy']
export const WORKFLOW_ACTIONS = Object.freeze({
  'project.open': { implemented: true, acceptanceImplemented: false, scales: allScales, description: 'Library card → matching project and rendered, ready canvas; excludes app launch' },
  ...Object.fromEntries(['P1', 'P2', 'D1', 'D2', 'B1', 'B2', 'C1', 'C2', 'C3', 'A1', 'A2', 'A3', 'A4', 'R1', 'R2'].map((id) => [id, {
    implemented: false,
    scales: ['B2', 'C2', 'C3', 'A2', 'A3', 'A4', 'R2'].includes(id) ? largerScales : allScales,
    description: 'Full journey remains planned; see entry-inventory.md. Partial branches were removed.',
  }])),
})

export function parseOptions(argv) {
  const raw = {}
  const keys = new Set(['scale', 'scenario', 'cache', 'runs', 'warmup', 'timeout'])
  for (let index = 0; index < argv.length; index += 1) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(argv[index])
    if (!match || !keys.has(match[1]) || Object.hasOwn(raw, match[1])) throw new Error(`invalid/duplicate option: ${argv[index]}`)
    const value = match[2] ?? argv[++index]
    if (!value || value.startsWith('--')) throw new Error(`missing value: --${match[1]}`)
    raw[match[1]] = value
  }
  const list = (key, fallback, allowed) => {
    const values = String(raw[key] ?? fallback).split(',')
    if (!values.length || values.some((value) => !allowed.includes(value)) || new Set(values).size !== values.length) throw new Error(`invalid --${key}: ${raw[key]}`)
    return values
  }
  const integer = (key, fallback, min) => {
    const value = Number(raw[key] ?? fallback)
    if (!Number.isSafeInteger(value) || value < min) throw new Error(`invalid --${key}: ${raw[key]}`)
    return value
  }
  const options = {
    scales: list('scale', 'small,typical,heavy', allScales),
    scenarios: list('scenario', 'project.open', Object.keys(WORKFLOW_ACTIONS)),
    caches: list('cache', 'cold,hot', ['cold', 'hot']),
    runs: integer('runs', 5, 1), warmup: integer('warmup', 1, 0), launchTimeout: integer('timeout', 60_000, 1_000),
  }
  if (!options.scenarios.some((id) => options.scales.some((scale) => WORKFLOW_ACTIONS[id].scales.includes(scale)))) throw new Error('no applicable scale/scenario cells')
  return options
}

export function percentile(values, p) {
  const numbers = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!numbers.length) return null
  const index = (numbers.length - 1) * p
  const low = Math.floor(index), high = Math.ceil(index)
  return low === high ? numbers[low] : numbers[low] + (numbers[high] - numbers[low]) * (index - low)
}

export function normalizeActionSample(state, expected) {
  const invalid = (reason) => Object.assign(new Error(`invalid measurement: ${reason}`), { probeState: state })
  if (!state || state.documentId !== expected.documentId || state.probeId !== expected.probeId) throw invalid('missing/replaced probe or document (reload)')
  const marks = [state.inputAt, state.feedbackAt, state.contentAt, state.readyAt, state.controlInputAt, state.acknowledgedAt]
  if (marks.some((mark) => !Number.isFinite(mark)) || state.feedbackAt < state.inputAt || state.contentAt < state.feedbackAt || state.readyAt < state.feedbackAt || state.controlInputAt < state.readyAt || state.acknowledgedAt < state.controlInputAt) throw invalid('missing/non-monotonic input or milestone')
  if (state.targetReceipt?.control !== 'project-menu' || state.targetReceipt.expanded !== true || state.targetReceipt.menuVisible !== true) throw invalid('completed target-control receipt missing')
  if (!Array.isArray(state.frames) || !Array.isArray(state.longTasks)) throw invalid('raw probe arrays missing')
  if ([...state.frames, ...state.longTasks].some((entry) => !Number.isFinite(entry.startTime) || !Number.isFinite(entry.duration) || entry.duration < 0)) throw invalid('malformed/non-monotonic raw observation')
  const windowEndAt = Math.max(state.contentAt, state.acknowledgedAt)
  const overlaps = (entry) => Number.isFinite(entry.startTime) && Number.isFinite(entry.duration) && entry.duration >= 0 && entry.startTime < windowEndAt && entry.startTime + entry.duration > state.inputAt
  const duration = (entry) => Math.min(entry.startTime + entry.duration, windowEndAt) - Math.max(entry.startTime, state.inputAt)
  return {
    inputToFeedbackMs: state.feedbackAt - state.inputAt,
    inputToContentMs: state.contentAt - state.inputAt,
    inputToReadyEligibilityMs: state.readyAt - state.inputAt,
    inputToAcknowledgedMs: state.acknowledgedAt - state.inputAt,
    controlResponseMs: state.acknowledgedAt - state.controlInputAt,
    windowEndAt,
    frameTimes: state.frames.filter(overlaps).map(duration),
    longTasks: state.longTasks.filter(overlaps).map(duration),
    rawProbe: state,
  }
}

export function validActionSample(sample) {
  try {
    if (!sample?.functionalPassed || !sample.assertions?.firstImageDecoded || !sample.assertions?.persistedContentUnchanged || !sample.assertions?.targetControlResponse || !sample.rawProbe?.documentId || !sample.rawProbe?.probeId || !sample.rawProbe.longTaskSupported) return false
    const rebuilt = normalizeActionSample(sample.rawProbe, sample.rawProbe)
    return ['inputToFeedbackMs', 'inputToContentMs', 'inputToReadyEligibilityMs', 'inputToAcknowledgedMs', 'controlResponseMs', 'windowEndAt', 'frameTimes', 'longTasks'].every((key) => JSON.stringify(sample[key]) === JSON.stringify(rebuilt[key])) && sample.frameTimes.length > 0
  } catch { return false }
}

export function summarizeCell(cell) {
  const samples = cell.samples || []
  const frames = samples.flatMap((sample) => sample.frameTimes || [])
  const tasks = samples.flatMap((sample) => sample.longTasks || [])
  return {
    cache: cell.cache, actionSamples: samples.length, frameSamples: frames.length, longTaskSamples: tasks.length,
    feedbackP95: percentile(samples.map((sample) => sample.inputToFeedbackMs), 0.95),
    contentP95: percentile(samples.map((sample) => sample.inputToContentMs), 0.95),
    readyEligibilityP95: percentile(samples.map((sample) => sample.inputToReadyEligibilityMs), 0.95),
    acknowledgedP95: percentile(samples.map((sample) => sample.inputToAcknowledgedMs), 0.95),
    controlResponseP95: percentile(samples.map((sample) => sample.controlResponseMs), 0.95),
    frameP95: percentile(frames, 0.95), frameP99: percentile(frames, 0.99), longTaskP95: percentile(tasks, 0.95),
    maxLongTask: tasks.length ? Math.max(...tasks) : null,
    droppedFrameRatio: frames.length ? frames.filter((duration) => duration > 50).length / frames.length : null,
    // Quantile interpolation exists at any n; <100 frames cannot support even
    // one upper-percentile observation. This floor is not a confidence claim.
    p99Supported: frames.length >= 100,
  }
}

export function applyCellVerdict(cell, options) {
  const summary = summarizeCell(cell)
  const tier = { small: [100, 500, 33, 50, 0.02, 80], typical: [120, 700, 33, 67, 0.03, 80], heavy: [150, 1000, 50, 100, 0.05, 100] }[cell.scale]
  const keys = ['feedbackP95', 'acknowledgedP95', 'frameP95', 'frameP99', 'droppedFrameRatio', 'longTaskP95']
  cell.summary = summary
  cell.budgets = Object.fromEntries(keys.map((key, index) => [key, { value: summary[key], ceiling: tier[index], verdict: summary[key] === null || (cell.id === 'project.open' && ['frameP95', 'frameP99', 'droppedFrameRatio'].includes(key)) || (key === 'frameP99' && !summary.p99Supported) ? 'unverified' : summary[key] <= tier[index] ? 'within' : 'exceeded' }]))
  cell.acceptanceMissing = ['active-gesture frame metrics (project.open is a discrete click)', 'main long-task probe', 'CPU action-window distribution', 'memory/teardown residual', ...(!summary.p99Supported ? ['p99 sample support (<100 frames)'] : []), ...(options.runs < 5 || options.warmup < 1 ? ['fixed 1+5 protocol'] : [])]
  cell.passed = false
  cell.status = Object.values(cell.budgets).some((budget) => budget.verdict === 'exceeded') || summary.maxLongTask > 200 ? 'failed_budget' : 'inconclusive'
  return cell
}

export function reportExitCode(report) {
  return report.schemaVersion === 3 && report.options?.warmup >= 1 && Array.isArray(report.cells) && report.cells.length > 0 && report.cells.every((cell) => WORKFLOW_ACTIONS[cell.id]?.acceptanceImplemented === true && cell.status === 'passed' && cell.implemented === true && cell.executed === true && cell.passed === true && cell.samples?.length >= 5 && cell.samples.every(validActionSample) && cell.acceptanceMissing?.length === 0) ? 0 : 2
}

export function writeReport(directory, report) {
  fs.mkdirSync(directory, { recursive: true })
  const timestamp = report.generatedAt.replace(/[:.]/g, '-')
  const output = path.join(directory, `nomi-user-workflow-${timestamp}-${randomUUID()}.json`)
  fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: 'wx' })
  return output
}
