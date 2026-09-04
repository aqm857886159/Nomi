/* global console, process */

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { REAL_USER_TEST_MANIFEST } from '../tests/system/real-user-test-gates.mjs'

export const DIMENSIONS = Object.freeze(['H', 'B', 'E', 'T', 'N'])
const PROVIDERS = new Set(['loopback', 'live'])
const EVIDENCE_STATUSES = new Set(['required', 'not-applicable', 'pending-review', 'blocked'])
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function commandLabel(command) {
  return [command.command, ...command.args].join(' ')
}

function resolveCommand(command) {
  return process.platform === 'win32' && command === 'pnpm' ? 'pnpm.cmd' : command
}

export function validateManifest(manifest, { root = ROOT } = {}) {
  const errors = []
  if (!isRecord(manifest) || manifest.schemaVersion !== 1) errors.push('manifest schemaVersion must be 1')
  if (JSON.stringify(manifest?.dimensions) !== JSON.stringify(DIMENSIONS))
    errors.push('manifest dimensions must be H/B/E/T/N in stable order')
  if (!Array.isArray(manifest?.journeys) || manifest.journeys.length === 0)
    errors.push('manifest must contain at least one journey')

  const ids = new Set()
  const capabilities = new Set()
  for (const entry of manifest?.journeys ?? []) {
    if (!isRecord(entry)) {
      errors.push('journey entry must be an object')
      continue
    }
    if (!entry.id) errors.push('journey id is required')
    if (ids.has(entry.id)) errors.push(`duplicate id: ${entry.id}`)
    ids.add(entry.id)
    if (!entry.capability) errors.push(`${entry.id}: capability is required`)
    if (capabilities.has(entry.capability)) errors.push(`duplicate capability: ${entry.capability}`)
    capabilities.add(entry.capability)

    const command = entry.command
    if (
      !isRecord(command) ||
      typeof command.command !== 'string' ||
      !Array.isArray(command.args) ||
      command.args.length === 0
    ) {
      errors.push(`${entry.id}: command needs command and non-empty args`)
    } else {
      for (const file of command.args.filter((argument) => /^(?:electron|scripts|tests|src)\//.test(argument))) {
        if (!fs.existsSync(path.join(root, file))) errors.push(`${entry.id}: missing referenced file ${file}`)
      }
    }
    for (const provider of ['loopback', 'live']) {
      const state = entry.provider?.[provider]
      if (!isRecord(state) || !['loopback', 'live', 'blocked'].includes(state.state))
        errors.push(`${entry.id}: provider.${provider}.state is invalid`)
      if (state?.state === 'blocked' && !state.reason)
        errors.push(`${entry.id}: blocked provider.${provider} needs reason`)
    }
    for (const dimension of DIMENSIONS) {
      const item = entry.dimensions?.[dimension]
      if (!isRecord(item)) errors.push(`${entry.id}: missing ${dimension}`)
      else if (!['ready', 'blocked'].includes(item.status))
        errors.push(`${entry.id}:${dimension}: status must be ready or blocked`)
      else if (!item.evidence && item.status === 'ready')
        errors.push(`${entry.id}:${dimension}: ready entry needs evidence`)
      else if (item.status === 'blocked' && !item.reason)
        errors.push(`${entry.id}:${dimension}: blocked entry needs reason`)
    }
    for (const name of ['persistence', 'restart', 'visual']) {
      const item = entry[name]
      if (!isRecord(item) || !EVIDENCE_STATUSES.has(item.status)) errors.push(`${entry.id}: ${name} status is invalid`)
      if (item?.status === 'blocked' && !item.reason) errors.push(`${entry.id}: blocked ${name} needs reason`)
      if (item?.status === 'required' && !item.evidence) errors.push(`${entry.id}: required ${name} needs evidence`)
      if (item?.status === 'not-applicable' && !item.reason)
        errors.push(`${entry.id}: not-applicable ${name} needs reason`)
    }
  }
  return { errors, dimensions: [...DIMENSIONS], capabilities: [...capabilities] }
}

export function selectJourneys(manifest, { capability = 'all', provider = 'loopback' } = {}) {
  if (!PROVIDERS.has(provider)) throw new Error(`unknown provider: ${provider}`)
  if (typeof capability !== 'string' || capability.trim() === '') throw new Error('capability selection is empty')
  const requested =
    capability === 'all'
      ? null
      : new Set(
          capability
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        )
  const known = new Set(manifest.journeys.map((journey) => journey.capability))
  if (requested) {
    const unknown = [...requested].filter(
      (item) => !known.has(item) && !manifest.journeys.some((journey) => journey.id === item),
    )
    if (unknown.length) throw new Error(`unknown capability: ${unknown.join(', ')}`)
  }
  const selected = manifest.journeys.filter(
    (journey) => !requested || requested.has(journey.capability) || requested.has(journey.id),
  )
  if (selected.length === 0) throw new Error(`capability selection is empty: ${capability}`)
  return selected
}

function executeCommand({ root, command, env }) {
  const result = spawnSync(resolveCommand(command.command), command.args, {
    cwd: root,
    env: { ...env },
    encoding: 'utf8',
    timeout: 30 * 60 * 1000,
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === 'win32' && command.command.endsWith('.cmd'),
  })
  return {
    status: result.error?.code === 'ETIMEDOUT' ? 'failed' : result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status ?? 1,
    signal: result.signal ?? null,
    error: result.error?.message ?? null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function projectEvidence(entry, provider, execution) {
  const resultStatus = execution.status === 'passed' ? 'passed' : 'failed'
  const dimensions = Object.fromEntries(
    DIMENSIONS.map((dimension) => {
      const item = entry.dimensions[dimension]
      return [dimension, item.status === 'blocked' ? { ...item } : { ...item, status: resultStatus }]
    }),
  )
  const projectLifecycle = (item) => (item.status === 'required' ? { ...item, status: resultStatus } : { ...item })
  const hasBlockedEvidence = [...Object.values(entry.dimensions), entry.persistence, entry.restart, entry.visual].some(
    (item) => item.status === 'blocked',
  )
  return {
    id: entry.id,
    capability: entry.capability,
    command: entry.command,
    boundaryMock: entry.boundaryMock,
    provider: entry.provider,
    selectedProvider: entry.provider[provider],
    execution,
    dimensions,
    persistence: projectLifecycle(entry.persistence),
    restart: projectLifecycle(entry.restart),
    visual: { ...entry.visual },
    status: hasBlockedEvidence ? 'blocked' : execution.status === 'passed' ? 'passed' : 'failed',
  }
}

function blockedEvidence(entry, provider) {
  const selected = entry.provider[provider]
  const blocked = { status: 'blocked', reason: selected.reason, evidence: selected.evidence ?? null }
  return {
    id: entry.id,
    capability: entry.capability,
    command: entry.command,
    boundaryMock: entry.boundaryMock,
    provider: entry.provider,
    selectedProvider: selected,
    execution: { status: 'blocked', exitCode: 2, error: selected.reason, stdout: '', stderr: '' },
    dimensions: Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, { ...blocked }])),
    persistence: { ...blocked },
    restart: { ...blocked },
    visual: { ...blocked },
    status: 'blocked',
  }
}

export function buildReport({ provider, summary, journeys }) {
  const resultStatus = summary.status ?? (summary.ok ? 'passed' : 'failed')
  const lines = [
    '# Real user test gates',
    '',
    `Result: **${resultStatus.toUpperCase()}** · provider=${provider} · selected=${summary.selected} · passed=${summary.passed} · failed=${summary.failed} · blocked=${summary.blocked}`,
    '',
    '| Journey | Provider | Live | H | B | E | T | N | Persistence | Restart | Visual |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ]
  for (const entry of journeys) {
    const selectedProvider = entry.provider[provider]
    const dimensionStatus = DIMENSIONS.map((dimension) => entry.dimensions[dimension].status)
    lines.push(
      `| ${entry.id} | ${selectedProvider.state} | ${entry.provider.live.state} | ${dimensionStatus.join(' | ')} | ${entry.persistence.status} | ${entry.restart.status} | ${entry.visual.status} |`,
    )
  }
  lines.push('', '## Executed command evidence', '')
  for (const entry of journeys) {
    lines.push(
      `- ${entry.id}: **${entry.execution.status}** · \`${commandLabel(entry.command)}\` · exit ${entry.execution.exitCode}`,
    )
    if (entry.execution.error) lines.push(`  - error: ${entry.execution.error}`)
    if (entry.provider.live.state === 'blocked')
      lines.push(`  - live provider: blocked — ${entry.provider.live.reason}`)
  }
  lines.push('', 'Visual statuses are evidence states only; `pending-review` is not visual acceptance.', '')
  return `${lines.join('\n')}\n`
}

export async function runRealUserGates({
  manifest = REAL_USER_TEST_MANIFEST,
  root = ROOT,
  provider = 'loopback',
  capability = 'all',
  env = process.env,
  runDir = path.join(root, 'tests/system/runs', `${new Date().toISOString().replaceAll(':', '-')}-real-user-journeys`),
  execute = (command) => executeCommand({ root, command, env }),
} = {}) {
  const validation = validateManifest(manifest, { root })
  if (validation.errors.length) throw new Error(`Invalid real user test manifest:\n${validation.errors.join('\n')}`)
  const selected = selectJourneys(manifest, { capability, provider })
  fs.mkdirSync(runDir, { recursive: true })
  const journeys = []
  for (const entry of selected) {
    const providerState = entry.provider[provider]
    if (providerState.state === 'blocked') {
      journeys.push(blockedEvidence(entry, provider))
      continue
    }
    const execution = await execute(entry.command, { root, env, journey: entry })
    fs.writeFileSync(path.join(runDir, `${entry.id}.stdout.log`), execution.stdout ?? '')
    fs.writeFileSync(path.join(runDir, `${entry.id}.stderr.log`), execution.stderr ?? '')
    journeys.push(projectEvidence(entry, provider, execution))
  }
  const summary = {
    status: journeys.some((entry) => entry.status === 'failed')
      ? 'failed'
      : journeys.some((entry) => entry.status === 'blocked')
        ? 'blocked'
        : 'passed',
    selected: journeys.length,
    passed: journeys.filter((entry) => entry.status === 'passed').length,
    failed: journeys.filter((entry) => entry.status === 'failed').length,
    blocked: journeys.filter((entry) => entry.status === 'blocked').length,
  }
  summary.ok = summary.failed === 0 && summary.blocked === 0
  const report = { schemaVersion: 1, provider, capability, summary, journeys }
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(report, null, 2))
  fs.writeFileSync(path.join(runDir, 'report.md'), buildReport(report))
  return { ...report, runDir, exitCode: summary.failed ? 1 : summary.blocked ? 2 : 0 }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2)
  const providerArg = args.indexOf('--provider')
  const capabilityArg = args.indexOf('--capability')
  const provider = providerArg >= 0 ? args[providerArg + 1] : process.env.NOMI_REAL_USER_PROVIDER || 'loopback'
  const capability = capabilityArg >= 0 ? args[capabilityArg + 1] : 'all'
  try {
    const result = await runRealUserGates({ provider, capability })
    console.log(
      `real-user-test-gates ${result.summary.status.toUpperCase()}: ${result.summary.passed} passed, ${result.summary.failed} failed, ${result.summary.blocked} blocked`,
    )
    console.log(`report: ${path.relative(process.cwd(), path.join(result.runDir, 'report.md'))}`)
    process.exit(result.exitCode)
  } catch (error) {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exit(1)
  }
}
