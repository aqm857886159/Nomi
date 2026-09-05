import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import test from 'node:test'

import {
  DeliveryError,
  assertMergedState,
  assertPreflightState,
  classifyIdentity,
  evaluateRequiredChecks,
  inspectDeliveryState,
  listCommitCheckRuns,
  parseCli,
  parseGitHubRepository,
  preflightDelivery,
  runBoundedCommand,
  verifyMergedDelivery,
} from './git-delivery.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..')

function git(cwd, args, options = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', ...options }).trim()
}

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, value)
}

function commit(cwd, message, value) {
  write(path.join(cwd, 'tracked.txt'), value)
  git(cwd, ['add', 'tracked.txt'])
  git(cwd, ['commit', '-m', message])
  return git(cwd, ['rev-parse', 'HEAD'])
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-git-delivery-'))
  const remote = path.join(root, 'remote.git')
  const seed = path.join(root, 'seed')
  const work = path.join(root, 'work')
  git(root, ['init', '--bare', remote])
  git(root, ['init', seed])
  git(seed, ['config', 'user.name', 'Nomi Test'])
  git(seed, ['config', 'user.email', 'nomi-test@example.invalid'])
  const baseSha = commit(seed, 'base', 'base\n')
  git(seed, ['branch', '-M', 'main'])
  git(seed, ['remote', 'add', 'origin', remote])
  git(seed, ['push', '-u', 'origin', 'main'])
  git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  git(root, ['clone', remote, work])
  git(work, ['config', 'user.name', 'Nomi Test'])
  git(work, ['config', 'user.email', 'nomi-test@example.invalid'])
  return {
    root,
    remote,
    seed,
    work,
    baseSha,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  }
}

test('identity classification keeps commit identity separate from tree identity', () => {
  assert.equal(
    classifyIdentity({ headCommit: 'a', headTree: 't1', remoteCommit: 'a', remoteTree: 't1' }),
    'same-commit',
  )
  assert.equal(
    classifyIdentity({ headCommit: 'a', headTree: 't1', remoteCommit: 'b', remoteTree: 't1' }),
    'same-tree-different-commit',
  )
  assert.equal(
    classifyIdentity({ headCommit: 'a', headTree: 't1', remoteCommit: 'b', remoteTree: 't2' }),
    'different-tree',
  )
})

test('documented pnpm argument separator is transparent to delivery commands', () => {
  assert.deepEqual(
    parseCli([
      'verify-merged',
      '--',
      '--expected-sha',
      '0123456789abcdef0123456789abcdef01234567',
      '--remote',
      'upstream',
      '--base',
      'trunk',
      '--ci-timeout-ms',
      '120000',
    ]),
    {
      command: 'verify-merged',
      options: {
        expectedSha: '0123456789abcdef0123456789abcdef01234567',
        remote: 'upstream',
        base: 'trunk',
        ciTimeoutMs: 120000,
      },
    },
  )
})

test('bounded transport terminates one hanging process without retrying it', async () => {
  const startedAt = Date.now()
  await assert.rejects(
    runBoundedCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 40 }),
    (error) => error instanceof DeliveryError && error.code === 'transport_timeout',
  )
  assert(Date.now() - startedAt < 2_000)
})

test('preflight refreshes once and accepts a clean task branch containing remote main', async (t) => {
  const f = fixture()
  t.after(f.cleanup)
  git(f.work, ['switch', '-c', 'codex/delivery-test'])
  commit(f.work, 'task', 'task\n')

  let fetchCount = 0
  const result = await preflightDelivery({
    cwd: f.work,
    fetchRemote: async () => {
      fetchCount += 1
    },
  })

  assert.equal(fetchCount, 1)
  assert.equal(result.branch, 'codex/delivery-test')
  assert.equal(result.remoteBaseIsAncestor, true)
  assert.equal(result.relation, 'different-tree')
})

test('preflight fails closed on protected, dirty, and stale task branches', async (t) => {
  const f = fixture()
  t.after(f.cleanup)

  assert.throws(() => assertPreflightState(inspectDeliveryState({ cwd: f.work })), /protected branch/)

  git(f.work, ['switch', '-c', 'codex/stale-task'])
  write(path.join(f.work, 'untracked.txt'), 'dirty\n')
  assert.throws(() => assertPreflightState(inspectDeliveryState({ cwd: f.work })), /worktree is not clean/)
  fs.rmSync(path.join(f.work, 'untracked.txt'))

  commit(f.seed, 'remote advances', 'remote\n')
  git(f.seed, ['push', 'origin', 'main'])
  await preflightDelivery({ cwd: f.work }).then(
    () => assert.fail('stale task branch should fail'),
    (error) => assert.match(error.message, /does not contain the refreshed remote baseline/),
  )
})

test('merged verification accepts the current origin/main tip', async (t) => {
  const f = fixture()
  t.after(f.cleanup)
  const expectedSha = git(f.work, ['rev-parse', 'origin/main'])

  git(f.work, ['switch', '--detach', expectedSha])
  const mergedState = inspectDeliveryState({ cwd: f.work })
  assert.doesNotThrow(() => assertMergedState(mergedState, { expectedSha }))
  assert.equal(assertMergedState(mergedState, { expectedSha }).verificationRelation, 'tip')
})

test('merged verification accepts an expected SHA that is an ancestor of the current tip', async (t) => {
  const f = fixture()
  t.after(f.cleanup)
  const expectedSha = git(f.work, ['rev-parse', 'origin/main'])
  commit(f.seed, 'remote advances', 'remote\n')
  git(f.seed, ['push', 'origin', 'main'])
  git(f.work, ['switch', '--detach', expectedSha])

  const result = await verifyMergedDelivery({
    cwd: f.work,
    expectedSha,
    repository: 'example/nomi',
    listCheckRuns: async () => passedChecks(),
  })
  assert.equal(result.receipt.commitSha, expectedSha)
  assert.equal(result.receipt.tip, git(f.work, ['rev-parse', 'origin/main']))
  assert.equal(result.receipt.relation, 'ancestor')
})

test('merged verification rejects an expected SHA outside the fetched main ancestry', async (t) => {
  const f = fixture()
  t.after(f.cleanup)
  git(f.work, ['switch', '--detach', 'origin/main'])
  const expectedSha = commit(f.work, 'unmerged task commit', 'task\n')
  await assert.rejects(
    verifyMergedDelivery({
      cwd: f.work,
      expectedSha,
      repository: 'example/nomi',
      fetchRemote: async () => {},
      listCheckRuns: async () => passedChecks(),
    }),
    (error) => error instanceof DeliveryError && error.code === 'expected_sha_not_ancestor',
  )
})

function checkRun(name, conclusion, overrides = {}) {
  return {
    id: overrides.id ?? name.length,
    name,
    status: overrides.status ?? 'completed',
    conclusion,
    started_at: overrides.startedAt ?? '2026-08-30T00:00:00Z',
    completed_at: overrides.completedAt ?? '2026-08-30T00:01:00Z',
    details_url: `https://github.com/example/nomi/actions/runs/${overrides.id ?? name.length}`,
    app: { slug: 'github-actions' },
  }
}

const passedChecks = () => [checkRun('Quality Gate', 'success'), checkRun('Mac Package', 'skipped')]

test('GitHub repository parsing accepts canonical HTTPS and SSH remotes only', () => {
  assert.equal(parseGitHubRepository('https://github.com/aqm857886159/Nomi.git'), 'aqm857886159/Nomi')
  assert.equal(parseGitHubRepository('git@github.com:aqm857886159/Nomi.git'), 'aqm857886159/Nomi')
  assert.equal(parseGitHubRepository('ssh://git@github.com/aqm857886159/Nomi.git'), 'aqm857886159/Nomi')
  assert.throws(() => parseGitHubRepository('/tmp/local.git'), /Cannot derive a GitHub repository/)
})

test('required-check evaluation accepts success, skipped, and neutral but not pending or failure', () => {
  assert.equal(evaluateRequiredChecks(passedChecks()).state, 'passed')
  assert.equal(
    evaluateRequiredChecks([checkRun('Quality Gate', 'neutral'), checkRun('Mac Package', 'success')]).state,
    'passed',
  )
  assert.equal(
    evaluateRequiredChecks([checkRun('Quality Gate', null, { status: 'in_progress' }), checkRun('Mac Package', 'skipped')])
      .state,
    'pending',
  )
  assert.equal(evaluateRequiredChecks([checkRun('Quality Gate', 'failure'), checkRun('Mac Package', 'success')]).state, 'failed')
  assert.deepEqual(evaluateRequiredChecks([checkRun('Quality Gate', 'success')]).missing, ['Mac Package'])
  assert.equal(
    evaluateRequiredChecks([
      checkRun('Quality Gate', 'success', { id: 1, startedAt: '2026-08-30T00:00:00Z' }),
      checkRun('Quality Gate', 'failure', { id: 2, startedAt: '2026-08-30T00:02:00Z' }),
      checkRun('Mac Package', 'success'),
    ]).state,
    'failed',
  )
})

test('check-run loader queries the exact commit endpoint and rejects malformed evidence', async () => {
  let invocation
  const runCommand = async (...args) => {
    invocation = args
    return { stdout: JSON.stringify({ check_runs: passedChecks() }) }
  }
  const checks = await listCommitCheckRuns({
    repository: 'example/nomi',
    commitSha: '0123456789abcdef0123456789abcdef01234567',
    runCommand,
  })
  assert.equal(checks.length, 2)
  assert.match(invocation[1].at(-1), /commits\/0123456789abcdef0123456789abcdef01234567\/check-runs/)
  await assert.rejects(
    listCommitCheckRuns({
      repository: 'example/nomi',
      commitSha: '0123456789abcdef0123456789abcdef01234567',
      runCommand: async () => ({ stdout: '{}' }),
    }),
    (error) => error instanceof DeliveryError && error.code === 'invalid_check_response',
  )
})

test('merged verification records exact-SHA CI evidence once and reuses its receipt', async (t) => {
  const f = fixture()
  t.after(f.cleanup)
  const expectedSha = git(f.work, ['rev-parse', 'origin/main'])
  git(f.work, ['switch', '--detach', expectedSha])

  let queries = 0
  const listCheckRuns = async ({ commitSha }) => {
    queries += 1
    assert.equal(commitSha, expectedSha)
    return passedChecks()
  }
  const options = {
    cwd: f.work,
    expectedSha,
    repository: 'example/nomi',
    fetchRemote: async () => {},
    listCheckRuns,
  }
  const first = await verifyMergedDelivery(options)
  const second = await verifyMergedDelivery(options)

  assert.equal(first.reused, false)
  assert.equal(second.reused, true)
  assert.equal(queries, 1)
  assert.equal(first.receipt.kind, 'exact-sha-ci-evidence')
  assert.equal(first.receipt.commitSha, expectedSha)
  assert.equal(first.receipt.treeSha, git(f.work, ['rev-parse', `${expectedSha}^{tree}`]))
  assert.deepEqual(first.receipt.checks.map(({ name, conclusion }) => ({ name, conclusion })), [
    { name: 'Quality Gate', conclusion: 'success' },
    { name: 'Mac Package', conclusion: 'skipped' },
  ])
  assert.match(first.receiptPath, /nomi-delivery.*ci-evidence\.json$/)
})

test('merged verification waits for missing checks and never converts a failed check into a receipt', async (t) => {
  const f = fixture()
  t.after(f.cleanup)
  const expectedSha = git(f.work, ['rev-parse', 'origin/main'])
  git(f.work, ['switch', '--detach', expectedSha])

  let query = 0
  const waiting = await verifyMergedDelivery({
    cwd: f.work,
    expectedSha,
    repository: 'example/nomi',
    fetchRemote: async () => {},
    listCheckRuns: async () => (++query === 1 ? [checkRun('Quality Gate', 'success')] : passedChecks()),
    sleep: async () => {},
    pollIntervalMs: 1,
  })
  assert.equal(waiting.receipt.checks.length, 2)
  fs.rmSync(waiting.receiptPath)

  await assert.rejects(
    verifyMergedDelivery({
      cwd: f.work,
      expectedSha,
      repository: 'example/nomi',
      fetchRemote: async () => {},
      listCheckRuns: async () => [checkRun('Quality Gate', 'failure'), checkRun('Mac Package', 'success')],
    }),
    (error) => error instanceof DeliveryError && error.code === 'required_checks_failed',
  )
  assert.equal(fs.existsSync(waiting.receiptPath), false)
})

test('merged verification fails closed when required checks remain incomplete', async (t) => {
  const f = fixture()
  t.after(f.cleanup)
  const expectedSha = git(f.work, ['rev-parse', 'origin/main'])
  git(f.work, ['switch', '--detach', expectedSha])

  await assert.rejects(
    verifyMergedDelivery({
      cwd: f.work,
      expectedSha,
      repository: 'example/nomi',
      fetchRemote: async () => {},
      listCheckRuns: async () => [
        checkRun('Quality Gate', null, { status: 'in_progress' }),
        checkRun('Mac Package', 'skipped'),
      ],
      ciTimeoutMs: 1,
      pollIntervalMs: 1,
      sleep: async () => {},
    }),
    (error) => error instanceof DeliveryError && error.code === 'required_checks_timeout',
  )
})

test('evidence lock prevents concurrent collectors for one merged SHA', async (t) => {
  const f = fixture()
  t.after(f.cleanup)
  const expectedSha = git(f.work, ['rev-parse', 'origin/main'])
  git(f.work, ['switch', '--detach', expectedSha])

  let releaseFirst
  const firstQuery = new Promise((resolve) => {
    releaseFirst = resolve
  })
  const options = {
    cwd: f.work,
    expectedSha,
    repository: 'example/nomi',
    fetchRemote: async () => {},
    listCheckRuns: async () => {
      await firstQuery
      return passedChecks()
    },
  }
  const first = verifyMergedDelivery(options)
  await new Promise((resolve) => setImmediate(resolve))
  await assert.rejects(
    verifyMergedDelivery(options),
    (error) => error instanceof DeliveryError && error.code === 'evidence_in_progress',
  )
  releaseFirst()
  await first
})

test('canonical delivery source has no REST object reconstruction escape path', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'scripts/git-delivery.mjs'), 'utf8')
  assert.doesNotMatch(source, /api\.github\.com|\/compare\/|hash-object[^\n]*commit|commit-tree|runProfile|full-local/)
  assert.match(source, /commits\/\$\{commitSha\}\/check-runs/)

  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  assert.equal(pkg.scripts['delivery:preflight'], 'node scripts/git-delivery.mjs preflight')
  assert.equal(pkg.scripts['delivery:verify-merged'], 'node scripts/git-delivery.mjs verify-merged')
  assert.match(pkg.scripts['check:git-delivery'], /git-delivery\.node-test\.mjs/)
  assert.match(pkg.scripts['gates:contracts'], /check:git-delivery/)
})
