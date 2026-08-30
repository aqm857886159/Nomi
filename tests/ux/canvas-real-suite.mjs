import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const DEFAULT_CANVAS_SCENARIO_TIMEOUT_MS = 8 * 60_000
export const PERFORMANCE_CANVAS_SCENARIO_TIMEOUT_MS = 20 * 60_000
export const MAX_CANVAS_SCENARIO_LOG_BYTES = 32 * 1024 * 1024

export const CRITICAL_CANVAS_SCENARIOS = [
  { id: 'gestures', script: 'tests/ux/canvas-drag-pan-gestures.walk.mjs' },
  { id: 'group-ports', script: 'tests/ux/group-ports.walk.mjs' },
  { id: 'card-stack-persistence', script: 'tests/ux/canvas-card-stack.walk.mjs' },
  { id: 'read-only-reload', script: 'tests/ux/react-flow-read-only.walk.mjs' },
]

export const FULL_CANVAS_SCENARIOS = [
  ...CRITICAL_CANVAS_SCENARIOS,
  { id: 'shortcuts', script: 'tests/ux/canvas-shortcuts.walk.mjs' },
  { id: 'node-context-menu', script: 'tests/ux/canvas-node-context-menu.walk.mjs' },
  { id: 'blank-context-menu', script: 'tests/ux/canvas-context-menu-click.walk.mjs' },
  { id: 'batch-production', script: 'tests/ux/canvas-batch-production.walk.mjs' },
  { id: 'selection-toolbar', script: 'tests/ux/selection-toolbar-vendor.walk.mjs' },
  { id: 'group-baseline', script: 'tests/ux/group-baseline.walk.mjs' },
  { id: 'group-reference-direction', script: 'tests/ux/group-reference-direction.walk.mjs' },
  { id: 'canvas-landing', script: 'tests/ux/p4-s5-canvas-landing.e2e.mjs' },
  { id: 'canvas-reconcile', script: 'tests/ux/p4-s5-canvas-reconcile.e2e.mjs' },
]

export const PERFORMANCE_CANVAS_SCENARIOS = [
  {
    id: 'medium-canvas-performance',
    script: 'tests/ux/canvas-performance-benchmark.e2e.mjs',
    args: ['validation-gate', '--scale', 'M', '--runs', '1'],
    timeoutMs: PERFORMANCE_CANVAS_SCENARIO_TIMEOUT_MS,
  },
]

export function scenariosForProfile(profile) {
  if (profile === 'critical') return CRITICAL_CANVAS_SCENARIOS
  if (profile === 'full') return FULL_CANVAS_SCENARIOS
  if (profile === 'performance') return PERFORMANCE_CANVAS_SCENARIOS
  throw new Error(`unknown canvas suite profile: ${profile}`)
}

function text(value) {
  if (value === undefined || value === null) return ''
  return Buffer.isBuffer(value) ? value.toString('utf8') : String(value)
}

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
}

export function summarizeCanvasScenarioFailure({ error, stdout, stderr }) {
  const lines = stripAnsi([text(error), text(stderr), text(stdout)].filter(Boolean).join('\n'))
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
  const marker = lines.findIndex((line) => /WALK FAIL|(?:^|\s)(?:Error|TimeoutError):|❌|ELIFECYCLE|\bFAIL\b/.test(line))
  const relevant = marker >= 0 ? lines.slice(Math.max(0, marker - 2), marker + 10) : lines.slice(-12)
  return relevant.join('\n').slice(0, 4000) || 'scenario exited without an error message'
}

function scenarioLogPath(outputDir, scenarioId) {
  if (!outputDir) return null
  const safeId = scenarioId.replace(/[^a-zA-Z0-9._-]+/g, '-')
  return path.join(outputDir, `${safeId}.log`)
}

export function runCanvasScenario(scenario, {
  cwd = repoRoot,
  env = process.env,
  spawnProcess = spawnSync,
  timeoutMs,
  outputDir,
  stdoutWriter = process.stdout,
  stderrWriter = process.stderr,
} = {}) {
  const resolvedTimeoutMs = timeoutMs ?? scenario.timeoutMs ?? DEFAULT_CANVAS_SCENARIO_TIMEOUT_MS
  const startedAt = Date.now()
  const child = spawnProcess(process.execPath, [scenario.script, ...(scenario.args || [])], {
    cwd,
    env,
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: MAX_CANVAS_SCENARIO_LOG_BYTES,
    timeout: resolvedTimeoutMs,
    killSignal: 'SIGKILL',
  })
  const stdout = text(child.stdout)
  const stderr = text(child.stderr)
  if (stdout) stdoutWriter.write(stdout)
  if (stderr) stderrWriter.write(stderr)
  const timedOut = child.error?.code === 'ETIMEDOUT'
  if (timedOut) console.error(`[canvas] ${scenario.id} exceeded ${resolvedTimeoutMs}ms and was terminated`)
  const exitCode = child.status ?? 1
  const error = child.error ? String(child.error.message || child.error) : null
  const absoluteLogPath = scenarioLogPath(outputDir, scenario.id)
  if (absoluteLogPath) {
    fs.mkdirSync(path.dirname(absoluteLogPath), { recursive: true })
    const command = [process.execPath, scenario.script, ...(scenario.args || [])].map((arg) => JSON.stringify(arg)).join(' ')
    fs.writeFileSync(absoluteLogPath, [
      `$ ${command}`,
      stdout ? `\n[stdout]\n${stdout.trimEnd()}` : '',
      stderr ? `\n[stderr]\n${stderr.trimEnd()}` : '',
      error ? `\n[spawn error]\n${error}` : '',
      '',
    ].filter((chunk) => chunk !== '').join('\n'))
  }
  return {
    id: scenario.id,
    script: scenario.script,
    args: scenario.args || [],
    exitCode,
    signal: child.signal,
    timedOut,
    timeoutMs: resolvedTimeoutMs,
    error,
    logPath: absoluteLogPath ? path.relative(cwd, absoluteLogPath).split(path.sep).join('/') : null,
    failureSummary: exitCode === 0 ? null : summarizeCanvasScenarioFailure({ error, stdout, stderr }),
    durationMs: Date.now() - startedAt,
  }
}

export function runCanvasSuite(profile, { cwd = repoRoot, env = process.env } = {}) {
  const outputDir = path.join(cwd, 'outputs', 'canvas-acceptance', profile)
  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })
  const results = []

  for (const scenario of scenariosForProfile(profile)) {
    console.log(`\n[canvas:${profile}] ${scenario.id}`)
    results.push(runCanvasScenario(scenario, { cwd, env, outputDir }))
  }

  const summary = {
    profile,
    passed: results.filter((result) => result.exitCode === 0).length,
    failed: results.filter((result) => result.exitCode !== 0).length,
    results,
  }
  fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2))
  return summary
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const summary = runCanvasSuite(process.argv[2] || 'critical')
    console.log(`\ncanvas-${summary.profile}: ${summary.failed === 0 ? 'PASS' : 'FAIL'} (${summary.passed}/${summary.results.length})`)
    process.exit(summary.failed === 0 ? 0 : 1)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
