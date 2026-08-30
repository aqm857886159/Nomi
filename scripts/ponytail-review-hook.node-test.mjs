import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  EMPTY_TREE_SHA,
  buildReviewPrompt,
  classifyReviewOutput,
  collectReviewDiff,
  parsePushInput,
  runPonytailReview,
} from './ponytail-review-hook.mjs'

const SHA_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const SHA_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const ZERO = '0000000000000000000000000000000000000000'

test('pre-push input is parsed as validated ref ranges', () => {
  assert.deepEqual(parsePushInput(`refs/heads/task ${SHA_B} refs/heads/task ${SHA_A}\n`), [
    { localRef: 'refs/heads/task', localSha: SHA_B, remoteRef: 'refs/heads/task', remoteSha: SHA_A },
  ])
  assert.throws(() => parsePushInput(`refs/heads/task nope refs/heads/task ${SHA_A}`), /Invalid local SHA/)
})

test('review diff is restricted to staged changes or outgoing ranges', () => {
  const calls = []
  const fakeGit = (_root, args) => {
    calls.push(args)
    return args[1] === '--cached' ? 'staged patch' : 'outgoing patch'
  }
  const staged = collectReviewDiff({ repoRoot: '/repo', scope: 'staged', runGit: fakeGit })
  assert.equal(staged.diff, 'staged patch')
  assert.match(calls[0].join(' '), /--cached/)

  const pushed = collectReviewDiff({
    repoRoot: '/repo',
    scope: 'push',
    pushInput: `refs/heads/task ${SHA_B} refs/heads/task ${ZERO}`,
    runGit: fakeGit,
  })
  assert.equal(pushed.diff, `### refs/heads/task (${SHA_B}) → refs/heads/task (${ZERO})\noutgoing patch`)
  assert.equal(calls[1][4], `${EMPTY_TREE_SHA}..${SHA_B}`)
})

test('prompt carries the host mapping, exact scope, and diff digest', () => {
  const prompt = buildReviewPrompt({
    scope: 'staged',
    description: 'staged changes',
    diff: '+const answer = 42',
    diffHash: '1234',
  })
  assert.match(prompt, /\/ponytail-review/)
  assert.match(prompt, /@ponytail-review/)
  assert.match(prompt, /Scope: staged/)
  assert.match(prompt, /Diff SHA-256: 1234/)
  assert.match(prompt, /BEGIN REVIEW DIFF/)
  assert.match(prompt, /const answer = 42/)
})

test('review output classification distinguishes clean, findings, and malformed runs', () => {
  assert.equal(classifyReviewOutput('PONYTAIL_REVIEW: PASS\nLean already. Ship.'), 'pass')
  assert.equal(classifyReviewOutput('PONYTAIL_REVIEW: FINDINGS\nnet: -12 lines possible.'), 'findings')
  assert.equal(classifyReviewOutput('Lean already. Ship.\nnet: -0 lines possible.'), 'unknown')
  assert.equal(classifyReviewOutput('model stopped before producing a report'), 'unknown')
})

function fakeRunner({ report, status = 0, error = undefined } = {}) {
  const calls = []
  const spawnSyncImpl = (command, args, options) => {
    calls.push({ command, args, options })
    if (report !== undefined) {
      const reportPath = args[args.indexOf('--output-last-message') + 1]
      fs.writeFileSync(reportPath, report)
    }
    return { status, stdout: '', stderr: '', error }
  }
  return { calls, spawnSyncImpl }
}

test('runner invokes Codex once with read-only ephemeral settings and accepts findings as evidence', () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-ponytail-test-'))
  const fake = fakeRunner({ report: 'PONYTAIL_REVIEW: FINDINGS\nnet: -3 lines possible.' })
  const result = runPonytailReview({
    repoRoot: '/repo',
    scope: 'staged',
    env: { PONYTAIL_REVIEW_REPORT_DIR: reportDir, PONYTAIL_REVIEW_CODEX_BIN: 'codex' },
    runGit: () => 'patch',
    spawnSyncImpl: fake.spawnSyncImpl,
  })
  assert.equal(result.ok, true)
  assert.equal(result.status, 'findings')
  assert.equal(fake.calls.length, 1)
  assert.deepEqual(fake.calls[0].args.slice(0, 8), [
    '--ask-for-approval', 'never', '--sandbox', 'read-only', '--cd', '/repo', 'exec', '--ephemeral',
  ])
  assert.equal(fake.calls[0].options.env.PONYTAIL_REVIEW_REPORT_DIR, reportDir)
  assert.match(fake.calls[0].options.input, /PONYTAIL_REVIEW/)
})

test('runner fails closed on missing result or Codex failure', () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-ponytail-test-'))
  const missing = fakeRunner()
  const malformed = runPonytailReview({
    repoRoot: '/repo',
    scope: 'staged',
    env: { PONYTAIL_REVIEW_REPORT_DIR: reportDir, PONYTAIL_REVIEW_CODEX_BIN: 'codex' },
    runGit: () => 'patch',
    spawnSyncImpl: missing.spawnSyncImpl,
  })
  assert.equal(malformed.ok, false)
  assert.equal(malformed.status, 'invalid_review')

  const failed = fakeRunner({ status: 1, report: 'codex failed' })
  const failure = runPonytailReview({
    repoRoot: '/repo',
    scope: 'staged',
    env: { PONYTAIL_REVIEW_REPORT_DIR: reportDir, PONYTAIL_REVIEW_CODEX_BIN: 'codex' },
    runGit: () => 'patch',
    spawnSyncImpl: failed.spawnSyncImpl,
  })
  assert.equal(failure.ok, false)
  assert.equal(failure.status, 'runner_failed')
})
