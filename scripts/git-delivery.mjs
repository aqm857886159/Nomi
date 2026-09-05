import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const DEFAULT_FETCH_TIMEOUT_MS = 45_000
export const DEFAULT_CI_EVIDENCE_TIMEOUT_MS = 30 * 60_000
export const DEFAULT_CI_POLL_INTERVAL_MS = 10_000
export const REQUIRED_MERGED_CHECKS = Object.freeze(['Quality Gate', 'Mac Package'])
const ACCEPTED_CHECK_CONCLUSIONS = new Set(['success', 'skipped', 'neutral'])
const MAX_TRANSPORT_OUTPUT_CHARS = 256 * 1024
const SHA_PATTERN = /^[0-9a-f]{40}$/i

export class DeliveryError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'DeliveryError'
    this.code = code
    this.details = details
  }
}

function boundedAppend(current, chunk) {
  const combined = `${current}${chunk}`
  return combined.length <= MAX_TRANSPORT_OUTPUT_CHARS ? combined : combined.slice(-MAX_TRANSPORT_OUTPUT_CHARS)
}

export function runBoundedCommand(
  command,
  args,
  { cwd = process.cwd(), env = process.env, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, spawnProcess = spawn } = {},
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new DeliveryError('invalid_timeout', `Transport timeout must be positive; received ${timeoutMs}`)
  }

  return new Promise((resolve, reject) => {
    const detached = process.platform !== 'win32'
    const child = spawnProcess(command, args, {
      cwd,
      env,
      detached,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let spawnError = null
    let timedOut = false
    let forceKillTimer = null

    child.stdout?.on('data', (chunk) => {
      stdout = boundedAppend(stdout, chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr = boundedAppend(stderr, chunk)
    })
    child.once('error', (error) => {
      spawnError = error
    })

    const signalChild = (signal) => {
      try {
        if (detached && child.pid) process.kill(-child.pid, signal)
        else child.kill(signal)
      } catch {
        try {
          child.kill(signal)
        } catch {
          /* process already exited */
        }
      }
    }

    const timeout = setTimeout(() => {
      timedOut = true
      signalChild('SIGTERM')
      forceKillTimer = setTimeout(() => signalChild('SIGKILL'), 1_000)
      forceKillTimer.unref?.()
    }, timeoutMs)
    timeout.unref?.()

    child.once('close', (exitCode, signal) => {
      clearTimeout(timeout)
      if (forceKillTimer) clearTimeout(forceKillTimer)
      const details = {
        command,
        args,
        cwd,
        timeoutMs,
        exitCode,
        signal,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      }
      if (timedOut) {
        reject(
          new DeliveryError(
            'transport_timeout',
            `Command exceeded ${timeoutMs}ms and was terminated after one attempt`,
            details,
          ),
        )
      } else if (spawnError) {
        reject(new DeliveryError('transport_spawn_failed', spawnError.message, details))
      } else if (exitCode !== 0) {
        reject(
          new DeliveryError(
            'transport_failed',
            `Command failed once with exit code ${exitCode}; no automatic retry was used`,
            details,
          ),
        )
      } else {
        resolve(details)
      }
    })
  })
}

function gitOutput(cwd, args) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    const stderr = String(error?.stderr || '').trim()
    throw new DeliveryError(
      'git_state_failed',
      `Cannot inspect Git state with: git ${args.join(' ')}${stderr ? `\n${stderr}` : ''}`,
      { cwd, args },
    )
  }
}

function gitStatus(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) {
    throw new DeliveryError('git_state_failed', result.error.message, { cwd, args })
  }
  return {
    exitCode: result.status ?? 1,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  }
}

export async function fetchRemoteBase({
  cwd = process.cwd(),
  remote = 'origin',
  base = 'main',
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  runCommand = runBoundedCommand,
} = {}) {
  const refspec = `refs/heads/${base}:refs/remotes/${remote}/${base}`
  return runCommand('git', ['fetch', '--no-tags', remote, refspec], {
    cwd,
    timeoutMs,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
}

export function classifyIdentity({ headCommit, headTree, remoteCommit, remoteTree }) {
  if (headCommit === remoteCommit) return 'same-commit'
  if (headTree === remoteTree) return 'same-tree-different-commit'
  return 'different-tree'
}

export function inspectDeliveryState({ cwd = process.cwd(), remote = 'origin', base = 'main' } = {}) {
  const repoRoot = gitOutput(cwd, ['rev-parse', '--show-toplevel'])
  const remoteRef = `${remote}/${base}`
  const headCommit = gitOutput(cwd, ['rev-parse', 'HEAD'])
  const headTree = gitOutput(cwd, ['rev-parse', 'HEAD^{tree}'])
  const remoteCommit = gitOutput(cwd, ['rev-parse', remoteRef])
  const remoteTree = gitOutput(cwd, ['rev-parse', `${remoteRef}^{tree}`])
  const branchResult = gitStatus(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  const ancestry = gitStatus(cwd, ['merge-base', '--is-ancestor', remoteRef, 'HEAD'])
  if (![0, 1].includes(ancestry.exitCode)) {
    throw new DeliveryError('git_state_failed', `Cannot compare HEAD with ${remoteRef}`, ancestry)
  }
  const commonDir = gitOutput(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  const dirtyPaths = gitOutput(cwd, ['status', '--porcelain'])

  return {
    repoRoot,
    commonDir,
    branch: branchResult.exitCode === 0 ? branchResult.stdout : null,
    remote,
    base,
    remoteRef,
    headCommit,
    headTree,
    remoteCommit,
    remoteTree,
    relation: classifyIdentity({ headCommit, headTree, remoteCommit, remoteTree }),
    remoteBaseIsAncestor: ancestry.exitCode === 0,
    clean: dirtyPaths === '',
    dirtyPaths: dirtyPaths ? dirtyPaths.split(/\r?\n/) : [],
  }
}

export function assertPreflightState(state, { protectedBranches = ['main', 'master', state.base] } = {}) {
  if (!state.branch) {
    throw new DeliveryError(
      'detached_preflight',
      'Delivery preflight requires a named task branch, not detached HEAD',
      state,
    )
  }
  if (new Set(protectedBranches).has(state.branch)) {
    throw new DeliveryError('protected_branch', `Delivery work cannot start on protected branch ${state.branch}`, state)
  }
  if (!state.clean) {
    throw new DeliveryError(
      'dirty_worktree',
      `Delivery preflight failed because the worktree is not clean: ${state.dirtyPaths.join(', ')}`,
      {
        ...state,
      },
    )
  }
  if (!state.remoteBaseIsAncestor) {
    throw new DeliveryError(
      'stale_task_branch',
      `Task branch ${state.branch} does not contain the refreshed remote baseline ${state.remoteRef}`,
      state,
    )
  }
  return state
}

export function assertMergedState(state, { expectedSha, cwd = state.repoRoot } = {}) {
  if (!SHA_PATTERN.test(String(expectedSha || ''))) {
    throw new DeliveryError(
      'invalid_expected_sha',
      'Merged verification requires an explicit full 40-character commit SHA',
    )
  }
  if (!state.clean) {
    throw new DeliveryError('dirty_worktree', 'Merged verification requires a clean worktree', state)
  }
  const expectedCommit = gitStatus(cwd, ['cat-file', '-e', `${expectedSha}^{commit}`])
  if (expectedCommit.exitCode !== 0) {
    throw new DeliveryError(
      'missing_expected_sha',
      `Expected merged commit is not available locally: ${expectedSha}`,
      { ...state, expectedSha, expectedCommit },
    )
  }
  const ancestry = gitStatus(cwd, ['merge-base', '--is-ancestor', expectedSha, state.remoteRef])
  if (![0, 1].includes(ancestry.exitCode)) {
    throw new DeliveryError(
      'git_state_failed',
      `Cannot compare expected merged commit with ${state.remoteRef}`,
      { ...state, expectedSha, ancestry },
    )
  }
  if (ancestry.exitCode !== 0) {
    throw new DeliveryError(
      'expected_sha_not_ancestor',
      `${state.remoteRef} does not contain expected merged commit ${expectedSha}; observed tip ${state.remoteCommit}`,
      { ...state, expectedSha, ancestry },
    )
  }
  return {
    ...state,
    expectedSha,
    verificationRelation: state.remoteCommit === expectedSha ? 'tip' : 'ancestor',
  }
}

export async function preflightDelivery({
  cwd = process.cwd(),
  remote = 'origin',
  base = 'main',
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  fetchRemote = fetchRemoteBase,
} = {}) {
  await fetchRemote({ cwd, remote, base, timeoutMs })
  return assertPreflightState(inspectDeliveryState({ cwd, remote, base }))
}

export function parseGitHubRepository(remoteUrl) {
  const value = String(remoteUrl || '').trim().replace(/\.git$/, '')
  const match = value.match(/^(?:https?:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+)$/i)
  if (!match) {
    throw new DeliveryError('unsupported_remote', `Cannot derive a GitHub repository from remote URL: ${remoteUrl}`)
  }
  return match[1]
}

function checkValue(check, snakeName, camelName) {
  return check?.[snakeName] ?? check?.[camelName] ?? null
}

function checkOrder(check) {
  return Date.parse(
    checkValue(check, 'started_at', 'startedAt') ||
      checkValue(check, 'completed_at', 'completedAt') ||
      '1970-01-01T00:00:00.000Z',
  )
}

function receiptCheck(check) {
  return {
    id: check.id ?? null,
    name: check.name,
    status: check.status,
    conclusion: check.conclusion ?? null,
    startedAt: checkValue(check, 'started_at', 'startedAt'),
    completedAt: checkValue(check, 'completed_at', 'completedAt'),
    detailsUrl: checkValue(check, 'details_url', 'detailsUrl'),
    htmlUrl: checkValue(check, 'html_url', 'htmlUrl'),
    app: check.app?.slug ?? check.app ?? null,
  }
}

export function evaluateRequiredChecks(checkRuns, requiredNames = REQUIRED_MERGED_CHECKS) {
  const checks = []
  const missing = []
  const pending = []
  const failed = []
  for (const name of requiredNames) {
    const candidates = checkRuns.filter((check) => check?.name === name).sort((left, right) => checkOrder(right) - checkOrder(left))
    const check = candidates[0]
    if (!check) {
      missing.push(name)
      continue
    }
    const projected = receiptCheck(check)
    checks.push(projected)
    if (check.status !== 'completed') pending.push(projected)
    else if (!ACCEPTED_CHECK_CONCLUSIONS.has(check.conclusion)) failed.push(projected)
  }
  return {
    state: failed.length > 0 ? 'failed' : missing.length > 0 || pending.length > 0 ? 'pending' : 'passed',
    checks,
    missing,
    pending,
    failed,
  }
}

export async function listCommitCheckRuns({
  repository,
  commitSha,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  runCommand = runBoundedCommand,
} = {}) {
  const response = await runCommand(
    'gh',
    [
      'api',
      '--method',
      'GET',
      '-H',
      'Accept: application/vnd.github+json',
      '-H',
      'X-GitHub-Api-Version: 2022-11-28',
      `/repos/${repository}/commits/${commitSha}/check-runs?per_page=100`,
    ],
    { timeoutMs, env: { ...process.env, GH_PROMPT_DISABLED: '1' } },
  )
  let payload
  try {
    payload = JSON.parse(response.stdout)
  } catch (error) {
    throw new DeliveryError('invalid_check_response', `Cannot parse GitHub check-runs response: ${error.message}`)
  }
  if (!Array.isArray(payload?.check_runs)) {
    throw new DeliveryError('invalid_check_response', 'GitHub check-runs response did not contain check_runs')
  }
  return payload.check_runs
}

export async function waitForRequiredChecks({
  repository,
  commitSha,
  timeoutMs = DEFAULT_CI_EVIDENCE_TIMEOUT_MS,
  requestTimeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_CI_POLL_INTERVAL_MS,
  requiredNames = REQUIRED_MERGED_CHECKS,
  listCheckRuns = listCommitCheckRuns,
  nowMs = () => Date.now(),
  sleep = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)),
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new DeliveryError('invalid_ci_timeout', 'CI evidence timeout and poll interval must be positive')
  }
  const deadline = nowMs() + timeoutMs
  while (true) {
    const checkRuns = await listCheckRuns({ repository, commitSha, timeoutMs: requestTimeoutMs })
    const evaluation = evaluateRequiredChecks(checkRuns, requiredNames)
    if (evaluation.state === 'passed') return evaluation
    if (evaluation.state === 'failed') {
      throw new DeliveryError('required_checks_failed', `Required checks failed for ${commitSha}`, evaluation)
    }
    const remainingMs = deadline - nowMs()
    if (remainingMs <= 0) {
      throw new DeliveryError(
        'required_checks_timeout',
        `Required checks did not complete for ${commitSha} within ${timeoutMs}ms`,
        evaluation,
      )
    }
    await sleep(Math.min(pollIntervalMs, remainingMs))
  }
}

function receiptPathFor(state, commitSha = state.expectedSha || state.headCommit) {
  return path.join(state.commonDir, 'nomi-delivery', 'merged-main', commitSha, 'ci-evidence.json')
}

function readReceipt(receiptPath) {
  if (!fs.existsSync(receiptPath)) return null
  try {
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'))
    return receipt?.schemaVersion === 3 && receipt?.kind === 'exact-sha-ci-evidence' && Array.isArray(receipt.checks)
      ? receipt
      : null
  } catch (error) {
    throw new DeliveryError('invalid_receipt', `Cannot read validation receipt ${receiptPath}: ${error.message}`, {
      receiptPath,
    })
  }
}

function writeReceipt(receiptPath, receipt) {
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true })
  const temporaryPath = `${receiptPath}.${process.pid}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`)
  fs.renameSync(temporaryPath, receiptPath)
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function acquireEvidenceLock(receiptPath, startedAt) {
  const lockPath = `${receiptPath}.lock`
  fs.mkdirSync(path.dirname(lockPath), { recursive: true })
  const lock = { pid: process.pid, hostname: os.hostname(), startedAt }
  const create = () => {
    const descriptor = fs.openSync(lockPath, 'wx')
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(lock)}\n`)
    } finally {
      fs.closeSync(descriptor)
    }
  }
  try {
    create()
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    let existing = null
    try {
      existing = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    } catch {
      /* malformed lock fails closed */
    }
    const staleLocalLock = existing?.hostname === os.hostname() && !processIsAlive(existing?.pid)
    if (!staleLocalLock) {
      throw new DeliveryError('evidence_in_progress', `CI evidence collection is already running: ${lockPath}`, {
        lockPath,
        lock: existing,
      })
    }
    fs.rmSync(lockPath)
    create()
  }
  return { release: () => fs.rmSync(lockPath, { force: true }) }
}

export async function verifyMergedDelivery({
  cwd = process.cwd(),
  expectedSha,
  remote = 'origin',
  base = 'main',
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  ciTimeoutMs = DEFAULT_CI_EVIDENCE_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_CI_POLL_INTERVAL_MS,
  repository,
  now = () => new Date(),
  fetchRemote = fetchRemoteBase,
  listCheckRuns = listCommitCheckRuns,
  sleep,
} = {}) {
  await fetchRemote({ cwd, remote, base, timeoutMs })
  const state = assertMergedState(inspectDeliveryState({ cwd, remote, base }), { expectedSha, cwd })
  const receiptPath = receiptPathFor(state, expectedSha)
  const existing = readReceipt(receiptPath)
  if (
    existing &&
    existing.commitSha === expectedSha &&
    existing.tip === state.remoteCommit &&
    existing.relation === state.verificationRelation &&
    existing.treeSha === gitOutput(cwd, ['rev-parse', `${expectedSha}^{tree}`]) &&
    evaluateRequiredChecks(existing.checks).state === 'passed'
  ) {
    return { state, receiptPath, receipt: existing, reused: true }
  }

  const evidenceLock = acquireEvidenceLock(receiptPath, now().toISOString())
  try {
    const resolvedRepository = repository || parseGitHubRepository(gitOutput(cwd, ['remote', 'get-url', remote]))
    const evidence = await waitForRequiredChecks({
      repository: resolvedRepository,
      commitSha: expectedSha,
      timeoutMs: ciTimeoutMs,
      requestTimeoutMs: timeoutMs,
      pollIntervalMs,
      listCheckRuns,
      ...(sleep ? { sleep } : {}),
    })
    const receipt = {
      schemaVersion: 3,
      kind: 'exact-sha-ci-evidence',
      commitSha: expectedSha,
      treeSha: gitOutput(cwd, ['rev-parse', `${expectedSha}^{tree}`]),
      remoteRef: state.remoteRef,
      tip: state.remoteCommit,
      relation: state.verificationRelation,
      repository: resolvedRepository,
      observedAt: now().toISOString(),
      requiredChecks: [...REQUIRED_MERGED_CHECKS],
      checks: evidence.checks,
    }
    writeReceipt(receiptPath, receipt)
    return { state, receiptPath, receipt, reused: false }
  } finally {
    evidenceLock.release()
  }
}

export function parseCli(argv) {
  const [command, ...args] = argv
  const options = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--') continue
    if (arg === '--expected-sha') options.expectedSha = args[++index]
    else if (arg === '--remote') options.remote = args[++index]
    else if (arg === '--base') options.base = args[++index]
    else if (arg === '--timeout-ms') options.timeoutMs = Number(args[++index])
    else if (arg === '--ci-timeout-ms') options.ciTimeoutMs = Number(args[++index])
    else throw new DeliveryError('unknown_argument', `Unknown delivery argument: ${arg}`)
  }
  return { command, options }
}

function printableState(state) {
  return {
    branch: state.branch,
    remoteRef: state.remoteRef,
    headCommit: state.headCommit,
    headTree: state.headTree,
    remoteCommit: state.remoteCommit,
    remoteTree: state.remoteTree,
    relation: state.relation,
    remoteBaseIsAncestor: state.remoteBaseIsAncestor,
    clean: state.clean,
  }
}

export async function runDeliveryCommand(argv = process.argv.slice(2), { cwd = process.cwd() } = {}) {
  const { command, options } = parseCli(argv)
  if (command === 'preflight') {
    const state = await preflightDelivery({ cwd, ...options })
    return { stage: 'preflight', state: printableState(state) }
  }
  if (command === 'verify-merged') {
    const result = await verifyMergedDelivery({ cwd, ...options })
    return {
      stage: 'verify-merged',
      state: printableState(result.state),
      reused: result.reused,
      receiptPath: result.receiptPath,
      receipt: result.receipt,
    }
  }
  throw new DeliveryError(
    'unknown_command',
    'Usage: pnpm run delivery:preflight OR pnpm run delivery:verify-merged -- --expected-sha <40-char-sha> [--ci-timeout-ms <milliseconds>]',
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDeliveryCommand()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      const payload =
        error instanceof DeliveryError
          ? { error: error.code, message: error.message, details: error.details }
          : { error: 'unexpected_error', message: error instanceof Error ? error.message : String(error) }
      console.error(JSON.stringify(payload, null, 2))
      process.exitCode = 1
    })
}
