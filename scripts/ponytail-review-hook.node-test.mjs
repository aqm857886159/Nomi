import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import installer from './install-git-hooks.cjs'
import { fileURLToPath } from 'node:url'
import {
  EMPTY_TREE_SHA,
  MAX_PUSH_RANGES,
  MAX_REVIEW_DIFF_BYTES,
  MAX_REVIEW_REPORT_BYTES,
  PONYTAIL_LOCK_HELD_ENV,
  REVIEW_TIMEOUT_BASE_MS,
  REVIEW_TIMEOUT_DIFF_STEP_BYTES,
  REVIEW_TIMEOUT_DIFF_STEP_MS,
  REVIEW_TIMEOUT_LOAD_MULTIPLIER,
  REVIEW_TIMEOUT_LOAD_THRESHOLD,
  REVIEW_TIMEOUT_MAX_MS,
  buildReviewPrompt,
  classifyReviewOutput,
  collectReviewDiff,
  deferredLogPath,
  isDeferRequested,
  parsePushInput,
  resolveReviewTimeoutMs,
  runPonytailReview,
} from './ponytail-review-hook.mjs'

const repoScriptsDir = path.dirname(fileURLToPath(import.meta.url))

const SHA_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const SHA_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const ZERO = '0000000000000000000000000000000000000000'

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function makeRepository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-ponytail-hook-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  git(root, ['init', '--quiet'])
  git(root, ['config', 'user.email', 'ponytail-test@example.invalid'])
  git(root, ['config', 'user.name', 'Ponytail Test'])
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'initial\n')
  git(root, ['add', 'tracked.txt'])
  git(root, ['commit', '--quiet', '-m', 'fixture'])
  return root
}

function hook(name) {
  const definition = installer.HOOKS.find((candidate) => candidate.name === name)
  assert.ok(definition, `missing ${name} definition`)
  return definition
}

/** A deterministic, incompressible PNG-signed blob of the requested size. */
function pngBytes(size) {
  const buffer = Buffer.allocUnsafe(size)
  for (let i = 0; i < size; i += 1) buffer[i] = (i * 1103515245 + 12345) & 0xff
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return buffer
}

test('pre-push input validates ref ranges, including create and delete', () => {
  assert.deepEqual(parsePushInput(`refs/heads/task ${SHA_B} refs/heads/task ${SHA_A}\n`), [
    { localRef: 'refs/heads/task', localSha: SHA_B, remoteRef: 'refs/heads/task', remoteSha: SHA_A },
  ])
  assert.deepEqual(parsePushInput(`refs/heads/new ${SHA_B} refs/heads/new ${ZERO}\nrefs/heads/old ${ZERO} refs/heads/old ${SHA_A}\n`).map((range) => [range.localSha, range.remoteSha]), [
    [SHA_B, ZERO],
    [ZERO, SHA_A],
  ])
  assert.throws(() => parsePushInput(`refs/heads/task nope refs/heads/task ${SHA_A}`), /Invalid local SHA/)
  assert.throws(() => parsePushInput(`refs/heads/task ${SHA_A} refs/heads/task ${SHA_B} extra`), /Invalid pre-push line/)
})

test('review diff is restricted to staged changes or outgoing ranges', () => {
  const calls = []
  // The binary summary issues its own numstat/raw/cat-file probes; return empty
  // so a text-only fixture keeps producing exactly the text diff.
  const fakeGit = (_root, args) => {
    calls.push(args)
    if (args.includes('--numstat') || args.includes('--raw') || args[0] === 'cat-file') return ''
    return args.includes('--cached') ? 'staged patch' : 'outgoing patch'
  }
  const staged = collectReviewDiff({ repoRoot: '/repo', scope: 'staged', runGit: fakeGit })
  assert.equal(staged.diff, 'staged patch')
  // 按意图断言而不是按调用下标：staged 侧现在会先探一次 MERGE_HEAD（判断这是不是一次合并
  // 提交），`calls[0]` 因此不再是 diff 本身。要钉的不变量是「取的是索引、不是工作区」。
  assert.ok(
    calls.some((args) => args[0] === 'diff' && args.includes('--cached')),
    'staged review must read the index (`git diff --cached`), never the worktree',
  )
  assert.ok(!calls.some((args) => args.includes('--binary')), 'binary payloads must not be requested')

  const pushed = collectReviewDiff({
    repoRoot: '/repo',
    scope: 'push',
    remoteName: 'origin',
    pushInput: `refs/heads/task ${SHA_B} refs/heads/task ${ZERO}`,
    runGit: (_root, args) => {
      if (args[0] === 'for-each-ref') return SHA_A
      if (args[0] === 'rev-list') return args.includes('--parents') ? `${SHA_B} ${SHA_A}` : SHA_B
      return fakeGit(_root, args)
    },
  })
  assert.match(pushed.diff, /1 commit\(s\) not already reachable from origin/)
  assert.match(pushed.diff, /outgoing patch$/)
  assert.ok(calls.some((args) => args[0] === 'show' && args.includes(SHA_B)), 'new refs use authored commits too')
})

test('review input is bounded and rejects excessive push updates', () => {
  assert.throws(
    () => collectReviewDiff({ repoRoot: '/repo', scope: 'staged', runGit: () => 'x'.repeat(MAX_REVIEW_DIFF_BYTES + 1) }),
    /review diff .* limit/,
  )
  const updates = Array.from({ length: MAX_PUSH_RANGES + 1 }, (_, index) =>
    `refs/heads/task-${index} ${SHA_A} refs/heads/task-${index} ${ZERO}`,
  ).join('\n')
  assert.throws(() => parsePushInput(updates), /update count exceeds/)
})

test('multi-megabyte staged input is rejected with guidance instead of ENOBUFS', (t) => {
  const root = makeRepository(t)
  for (const bytes of [7_500_000, 8_500_000]) {
    fs.writeFileSync(path.join(root, 'large.txt'), 'x'.repeat(bytes))
    git(root, ['add', 'large.txt'])
    assert.throws(() => collectReviewDiff({ repoRoot: root, scope: 'staged' }), /按目录拆提交/)
  }
})

test('staged binary diff omits base85 payload and carries a byte summary', (t) => {
  const root = makeRepository(t)
  fs.writeFileSync(path.join(root, 'poster.png'), pngBytes(823 * 1024))
  git(root, ['add', 'poster.png'])
  const collected = collectReviewDiff({ repoRoot: root, scope: 'staged' })
  // A real base85 hunk begins with `GIT binary patch` / `literal`; assert neither leaks.
  assert.doesNotMatch(collected.diff, /GIT binary patch/)
  assert.doesNotMatch(collected.diff, /^literal \d+/m)
  assert.match(collected.diff, /Binary files \/dev\/null and b\/poster\.png differ/)
  assert.match(collected.diff, /^BINARY: added poster\.png \(823 KB\)$/m)
  // The size assertion counts the text diff + summary, not the raw image bytes.
  assert.ok(Buffer.byteLength(collected.diff, 'utf8') < 4096, 'binary payload must not inflate the reviewed diff')
})

test('push-range binary diff omits base85 payload and carries a byte summary', (t) => {
  const root = makeRepository(t)
  const base = git(root, ['rev-parse', 'HEAD'])
  fs.writeFileSync(path.join(root, 'clip.png'), pngBytes(512 * 1024))
  git(root, ['add', 'clip.png'])
  git(root, ['commit', '--quiet', '-m', 'add clip'])
  const head = git(root, ['rev-parse', 'HEAD'])
  const collected = collectReviewDiff({
    repoRoot: root,
    scope: 'push',
    pushInput: `refs/heads/main ${head} refs/heads/main ${base}`,
  })
  assert.doesNotMatch(collected.diff, /GIT binary patch/)
  assert.doesNotMatch(collected.diff, /^literal \d+/m)
  assert.match(collected.diff, /Binary files \/dev\/null and b\/clip\.png differ/)
  assert.match(collected.diff, /^BINARY: added clip\.png \(512 KB\)$/m)
})

test('a binary file larger than the text cap no longer fails closed on commit or push', (t) => {
  const root = makeRepository(t)
  const base = git(root, ['rev-parse', 'HEAD'])
  fs.writeFileSync(path.join(root, 'huge.png'), pngBytes(2 * 1024 * 1024))
  git(root, ['add', 'huge.png'])
  const staged = collectReviewDiff({ repoRoot: root, scope: 'staged' })
  assert.match(staged.diff, /^BINARY: added huge\.png \(2\.0 MB\)$/m)
  assert.ok(Buffer.byteLength(staged.diff, 'utf8') <= MAX_REVIEW_DIFF_BYTES, 'pure binary must stay under the text cap')

  git(root, ['commit', '--quiet', '-m', 'add huge'])
  const head = git(root, ['rev-parse', 'HEAD'])
  const pushed = collectReviewDiff({
    repoRoot: root,
    scope: 'push',
    pushInput: `refs/heads/main ${head} refs/heads/main ${base}`,
  })
  assert.match(pushed.diff, /^BINARY: added huge\.png \(2\.0 MB\)$/m)
  assert.ok(Buffer.byteLength(pushed.diff, 'utf8') <= MAX_REVIEW_DIFF_BYTES)
})

test('an oversized text diff still fails closed (discipline regression lock)', (t) => {
  const root = makeRepository(t)
  // One long line whose staged diff clears the 1.5 MB text cap but stays under
  // runGit's maxBuffer, so the size assertion (not an ENOBUFS) is what rejects
  // it — the same guard that still stops giant code diffs from being pushed.
  fs.writeFileSync(path.join(root, 'huge.txt'), `${'x'.repeat(MAX_REVIEW_DIFF_BYTES + 20_000)}\n`)
  git(root, ['add', 'huge.txt'])
  assert.throws(() => collectReviewDiff({ repoRoot: root, scope: 'staged' }), /review diff .* limit/)
})

test('prompt carries the skill trigger, exact scope, and diff delimiter', () => {
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

test('review output classification accepts clean and findings reports only', () => {
  assert.equal(classifyReviewOutput('net: -0 lines possible.\nPONYTAIL_REVIEW: PASS'), 'pass')
  assert.equal(classifyReviewOutput('finding: remove wrapper\nnet: -3 lines possible.\nPONYTAIL_REVIEW: FINDINGS'), 'findings')
  assert.equal(classifyReviewOutput('Lean already. Ship.\nnet: -0 lines possible.\nPONYTAIL_REVIEW: PASS'), 'pass')
  assert.equal(classifyReviewOutput('PONYTAIL_REVIEW: PASS\nnet: -0 lines possible.'), 'unknown')
  assert.equal(classifyReviewOutput('net: -0 lines possible.\nPONYTAIL_REVIEW: PASS\nPONYTAIL_REVIEW: PASS'), 'unknown')
  assert.equal(classifyReviewOutput('Lean already. Ship.\nnet: -0 lines possible.'), 'unknown')
  assert.equal(classifyReviewOutput('Lean already. Ship.\nnet: -2 lines possible.\nPONYTAIL_REVIEW: PASS'), 'unknown')
  assert.equal(classifyReviewOutput('finding: remove wrapper\nLean already. Ship.\nnet: -0 lines possible.\nPONYTAIL_REVIEW: PASS'), 'unknown')
  assert.equal(classifyReviewOutput('model stopped before producing a report'), 'unknown')
})

function fakeRunner({ report = '', status = 0, error = undefined } = {}) {
  const calls = []
  const spawnSyncImpl = (command, args, options) => {
    calls.push({ command, args, options })
    const outputIndex = args.indexOf('--output-last-message')
    if (outputIndex >= 0 && fs.existsSync(args[outputIndex + 1])) {
      calls.at(-1).reportMode = fs.statSync(args[outputIndex + 1]).mode & 0o777
    }
    if (report) {
      const reportPath = args[outputIndex + 1]
      fs.writeFileSync(reportPath, report)
    }
    return { status, stdout: '', stderr: '', error }
  }
  return { calls, spawnSyncImpl }
}

test('runner invokes one read-only ephemeral Codex turn and accepts findings', () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-ponytail-report-'))
  const fake = fakeRunner({ report: 'finding: remove wrapper\nnet: -3 lines possible.\nPONYTAIL_REVIEW: FINDINGS' })
  const result = runPonytailReview({
    repoRoot: '/repo',
    scope: 'staged',
    env: { PONYTAIL_REVIEW_REPORT_DIR: reportDir, PONYTAIL_REVIEW_CODEX_BIN: 'codex' },
    runGit: () => 'patch',
    spawnSyncImpl: fake.spawnSyncImpl,
  })
  fs.rmSync(reportDir, { recursive: true, force: true })
  assert.equal(result.ok, true)
  assert.equal(result.status, 'findings')
  assert.equal(fs.existsSync(result.reportPath), false, 'ephemeral report must be removed after the run')
  assert.equal(fs.existsSync(path.dirname(result.reportPath)), false, 'ephemeral report directory must be removed after the run')
  assert.doesNotMatch(result.output, /finding: remove wrapper/)
  assert.equal(fake.calls.length, 1)
  assert.equal(fake.calls[0].reportMode, 0o600)
  assert.deepEqual(fake.calls[0].args.slice(0, 10), [
    '--ask-for-approval', 'never', '--cd', '/repo',
    'exec', '--ephemeral', '--sandbox', 'read-only', '--ignore-rules', '--output-last-message',
  ])
  assert.deepEqual(fake.calls[0].options.stdio, ['pipe', 'ignore', 'ignore'])
  assert.equal(fake.calls[0].options.env.PONYTAIL_REVIEW_HOOK, '1')
  assert.match(fake.calls[0].options.input, /PONYTAIL_REVIEW/)
})

test('runner fails closed on missing result, non-zero exit, and timeout', () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-ponytail-report-'))
  const env = { PONYTAIL_REVIEW_REPORT_DIR: reportDir, PONYTAIL_REVIEW_CODEX_BIN: 'codex' }
  const malformed = runPonytailReview({ repoRoot: '/repo', scope: 'staged', env, runGit: () => 'patch', spawnSyncImpl: fakeRunner().spawnSyncImpl })
  assert.equal(malformed.ok, false)
  assert.equal(malformed.status, 'invalid_review')

  const failed = runPonytailReview({ repoRoot: '/repo', scope: 'staged', env, runGit: () => 'patch', spawnSyncImpl: fakeRunner({ status: 1, report: 'codex failed' }).spawnSyncImpl })
  assert.equal(failed.ok, false)
  assert.equal(failed.status, 'runner_failed')

  const timeout = runPonytailReview({ repoRoot: '/repo', scope: 'staged', env, runGit: () => 'patch', spawnSyncImpl: fakeRunner({ error: { code: 'ETIMEDOUT' } }).spawnSyncImpl })
  assert.equal(timeout.ok, false)
  assert.match(timeout.reason, /timed out/)
  fs.rmSync(reportDir, { recursive: true, force: true })
})

test('runner ignores echoed stdout when the report file is absent', () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-ponytail-report-'))
  const result = runPonytailReview({
    repoRoot: '/repo',
    scope: 'staged',
    env: { PONYTAIL_REVIEW_REPORT_DIR: reportDir, PONYTAIL_REVIEW_CODEX_BIN: 'codex' },
    runGit: () => 'patch',
    spawnSyncImpl: (_command, _args, options) => ({ status: 0, stdout: options.input, stderr: '' }),
  })
  fs.rmSync(reportDir, { recursive: true, force: true })
  assert.equal(result.ok, false)
  assert.equal(result.status, 'invalid_review')
  assert.equal(fs.existsSync(path.dirname(result.reportPath)), false, 'ephemeral report directory must be removed after the run')
})

test('runner diagnostics never echo report or process output', () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-ponytail-report-'))
  const secret = 'sk-live-secret-must-not-appear-in-logs'
  const fake = fakeRunner({ report: `finding: ${secret}\nnet: -1 lines possible.\nPONYTAIL_REVIEW: FINDINGS` })
  const result = runPonytailReview({
    repoRoot: '/repo',
    scope: 'staged',
    env: { PONYTAIL_REVIEW_REPORT_DIR: reportDir, PONYTAIL_REVIEW_CODEX_BIN: 'codex' },
    runGit: () => 'patch',
    spawnSyncImpl: (command, args, options) => {
      const response = fake.spawnSyncImpl(command, args, options)
      return { ...response, stdout: secret, stderr: `error: ${secret}` }
    },
  })
  assert.equal(result.ok, true)
  assert.doesNotMatch(result.output, new RegExp(secret))
  assert.match(result.output, /^report=\d+B stdout=\d+B stderr=\d+B$/)
  assert.equal(fs.existsSync(path.dirname(result.reportPath)), false)
  fs.rmSync(reportDir, { recursive: true, force: true })
})

test('runner removes the ephemeral report when the child runner throws', () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-ponytail-report-'))
  assert.throws(() => runPonytailReview({
    repoRoot: '/repo',
    scope: 'staged',
    env: { PONYTAIL_REVIEW_REPORT_DIR: reportDir, PONYTAIL_REVIEW_CODEX_BIN: 'codex' },
    runGit: () => 'patch',
    spawnSyncImpl: () => { throw new Error('runner exploded') },
  }), /runner exploded/)
  const leftovers = fs.readdirSync(reportDir)
  assert.deepEqual(leftovers, [], 'runner failure must not leave an ephemeral report directory')
  fs.rmSync(reportDir, { recursive: true, force: true })
})

test('runner rejects an oversized report before reading it and still cleans up', () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-ponytail-report-'))
  assert.throws(() => runPonytailReview({
    repoRoot: '/repo',
    scope: 'staged',
    env: { PONYTAIL_REVIEW_REPORT_DIR: reportDir, PONYTAIL_REVIEW_CODEX_BIN: 'codex' },
    runGit: () => 'patch',
    spawnSyncImpl: (_command, args) => {
      fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], 'x'.repeat(MAX_REVIEW_REPORT_BYTES + 1))
      return { status: 0, stdout: '', stderr: '' }
    },
  }), /review report .* limit/)
  assert.deepEqual(fs.readdirSync(reportDir), [])
  fs.rmSync(reportDir, { recursive: true, force: true })
})

test('installer emits one Ponytail runner for commit and push and preserves security order', (t) => {
  const names = installer.HOOKS.map(({ name }) => name)
  assert.deepEqual(names, ['commit-msg', 'pre-commit', 'pre-push'])

  const commitMsg = installer.renderHookContent(hook('commit-msg'))
  assert.match(commitMsg, /check-progress-update\.cjs/)
  assert.doesNotMatch(commitMsg, /ponytail-review-hook/)

  const preCommit = installer.renderHookContent(hook('pre-commit'))
  const secretIndex = preCommit.indexOf('check-no-secrets.mjs')
  const ponytailIndex = preCommit.indexOf('ponytail-review-hook.mjs')
  assert.ok(secretIndex >= 0 && ponytailIndex > secretIndex, 'secret guard must run before review to avoid sending secrets to the model')
  assert.match(preCommit, /exec node "\$ROOT\/scripts\/ponytail-review-hook\.mjs" "--scope" "staged"/)

  const prePush = installer.renderHookContent(hook('pre-push'))
  assert.match(prePush, /\[ -f "\$ROOT\/scripts\/ponytail-review-hook\.mjs" \] \|\| exit 0/)
  assert.match(prePush, /exec node "\$ROOT\/scripts\/ponytail-review-hook\.mjs" "--scope" "push" "\$@"/)
  assert.doesNotMatch(prePush, /check-no-secrets\.mjs/)

  const root = makeRepository(t)
  const result = installer.installHooks({ repoRoot: root, logger: { log() {}, warn() {} } })
  assert.deepEqual(result.installed, names)
  for (const name of names) {
    const filePath = path.join(root, '.git', 'hooks', name)
    assert.equal(fs.readFileSync(filePath, 'utf8'), installer.renderHookContent(hook(name)))
    assert.notEqual(fs.statSync(filePath).mode & 0o111, 0, `${name} must be executable`)
  }
})

test('generated pre-push exits safely when the optional runner is absent', (t) => {
  const root = makeRepository(t)
  const hookPath = path.join(root, '.git', 'hooks', 'pre-push')
  fs.writeFileSync(hookPath, installer.renderHookContent(hook('pre-push')))
  fs.chmodSync(hookPath, 0o755)
  const result = spawnSync(hookPath, [], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  assert.equal(result.status, 0, result.stderr)
})

test('generated runner executes against a real staged diff with a fake Codex binary', (t) => {
  const root = makeRepository(t)
  const fakeCodex = path.join(root, 'fake-codex.cjs')
  fs.writeFileSync(fakeCodex, [
    '#!/usr/bin/env node',
    "const fs = require('node:fs')",
    "const index = process.argv.indexOf('--output-last-message')",
    "fs.writeFileSync(process.argv[index + 1], 'net: -0 lines possible.\\nPONYTAIL_REVIEW: PASS\\n')",
  ].join('\n') + '\n')
  fs.chmodSync(fakeCodex, 0o755)
  fs.writeFileSync(path.join(root, 'change.txt'), 'staged\n')
  git(root, ['add', 'change.txt'])
  const script = path.resolve('scripts/ponytail-review-hook.mjs')
  // 用隔离锁路径：测试不许去抢真实的 /tmp/nomi-ponytail.lock，否则套件会和别的
  // worktree 上正在跑的真评审互相排队（并行跑才炸的那一族）。
  const lockPath = path.join(root, 'ponytail.lock')
  const result = spawnSync(process.execPath, [script, '--scope', 'staged'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PONYTAIL_REVIEW_CODEX_BIN: fakeCodex, NOMI_PONYTAIL_LOCK_PATH: lockPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(`${result.stdout}\n${result.stderr}`, /ponytail-review/)
  // 真跑一次就必须证明它走了串行锁：锁文件是 with-gates-lock.py 建的，不是本测试建的。
  assert.equal(fs.existsSync(lockPath), true, '真实调用必须经过全机串行锁')
})

test('linked worktrees get isolated hook paths without touching the base worktree', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-ponytail-linked-'))
  t.after(() => fs.rmSync(base, { recursive: true, force: true }))
  const root = path.join(base, 'repo')
  const linked = path.join(base, 'linked')
  git(base, ['init', '--quiet', root])
  git(root, ['config', 'user.email', 'ponytail-test@example.invalid'])
  git(root, ['config', 'user.name', 'Ponytail Test'])
  git(root, ['config', 'extensions.worktreeConfig', 'true'])
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'initial\n')
  git(root, ['add', 'tracked.txt'])
  git(root, ['commit', '--quiet', '-m', 'fixture'])
  git(root, ['worktree', 'add', '--quiet', '-b', 'linked', linked])

  const result = installer.installHooks({ repoRoot: linked, logger: { log() {}, warn() {} } })
  const expectedHookDir = path.join(git(linked, ['rev-parse', '--git-dir']), 'hooks')
  assert.deepEqual(result.installed, ['commit-msg', 'pre-commit', 'pre-push'])
  assert.equal(result.hookDir, expectedHookDir)
  assert.equal(git(linked, ['config', '--worktree', '--get', 'core.hooksPath']), expectedHookDir)
  assert.equal(fs.existsSync(path.join(root, '.git', 'hooks', 'pre-push')), false)
})

// ── 评审单元 = 「本次作者写的」，不是「本次携带的」（2026-09-02 根因修复）────────────────
//
// 起因：一条落后主线的任务分支追平 main 时，钩子连着三次挡下交付——
// 先是 ENOBUFS（当时上限 1.5MB，端点 diff 2.85MB），上限提到 8MB 后改成 Codex 侧
// runner_failed（2.85MB ≈ 七八十万 token，模型吃不下）。提上限只是把失败点从 git 的
// 缓冲区挪到模型的上下文窗口，没碰到根因。
//
// 根因：评审范围用**端点差**算——push 用 `remoteSha..localSha`、staged 用 index↔HEAD。
// base 一动（rebase / 追平 merge / force-push），端点差就把 base 漂移的全部内容卷进来；
// 那些不是本次作者写的，而且**已经在主线上被同一道闸审过一次**。实测同一次合并：
// 端点差 2.85MB，其中真正该审的只有 0.37MB。
//
// 更糟的是它顺带放过了最该抓的东西：那次合并里真正由人做的决定是冲突解析
// （门岗链取并集、测试文件括号），而我在这两处**都写错了**——一处静默吞掉一个门岗、
// 一处吞掉两层收尾括号让整个测试文件零执行。scope 错了，于是既跑不动又抓不到。

/** 造一个「分支落后主线，主线上堆了大量与我无关的改动」的真实仓库。 */
function makeDivergedRepository(t) {
  const root = makeRepository(t)
  const base = git(root, ['rev-parse', 'HEAD'])
  // 主线：一堆别人的改动（体量刻意做大，代表 base 漂移）。
  git(root, ['checkout', '--quiet', '-b', 'mainline'])
  fs.writeFileSync(path.join(root, 'mainline-drift.txt'), 'MAINLINE-DRIFT\n'.repeat(4000))
  git(root, ['add', 'mainline-drift.txt'])
  git(root, ['commit', '--quiet', '-m', 'mainline drift'])
  const mainlineTip = git(root, ['rev-parse', 'HEAD'])
  // 让 resolveNewRefBase / 新逻辑找得到「远端默认分支」。
  git(root, ['update-ref', 'refs/remotes/origin/mainline', mainlineTip])
  git(root, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/mainline'])
  // 我的分支：从 base 岔出去，只写一行。
  git(root, ['checkout', '--quiet', '-b', 'task', base])
  fs.writeFileSync(path.join(root, 'mine.txt'), 'MY-OWN-WORK\n')
  git(root, ['add', 'mine.txt'])
  git(root, ['commit', '--quiet', '-m', 'my work'])
  return { root, base, mainlineTip, taskTip: git(root, ['rev-parse', 'HEAD']) }
}

test('追平 merge 后推送：只审我写的，不把主线漂移卷进来', (t) => {
  const { root, taskTip } = makeDivergedRepository(t)
  const pushedTip = taskTip // 远端已有的 tip
  // 真实场景：本地又写了一个新提交，然后为了追平主线做了一次 merge，最后一起推。
  fs.writeFileSync(path.join(root, 'later.txt'), 'LATER-WORK\n')
  git(root, ['add', 'later.txt'])
  git(root, ['commit', '--quiet', '-m', 'later work'])
  git(root, ['merge', '--quiet', '--no-edit', 'mainline'])
  const merged = git(root, ['rev-parse', 'HEAD'])

  const collected = collectReviewDiff({
    repoRoot: root,
    scope: 'push',
    pushInput: `refs/heads/task ${merged} refs/heads/task ${pushedTip}`,
    remoteName: 'origin',
  })

  assert.match(collected.diff, /LATER-WORK/, '本次新写的提交必须在评审范围里')
  assert.doesNotMatch(
    collected.diff,
    /MAINLINE-DRIFT/,
    '主线漂移不该进评审范围：它不是本次作者写的，且已在主线上审过一次',
  )
})

test('rebase 后 force-push：只审我写的，不把主线漂移卷进来', (t) => {
  const { root } = makeDivergedRepository(t)
  const oldRemoteTip = git(root, ['rev-parse', 'HEAD']) // 远端上那个基于旧 base 的 tip
  git(root, ['rebase', '--quiet', 'mainline'])
  const rebasedTip = git(root, ['rev-parse', 'HEAD'])
  assert.notEqual(rebasedTip, oldRemoteTip, 'rebase 应当重写了历史，否则这条测试没测到东西')

  const collected = collectReviewDiff({
    repoRoot: root,
    scope: 'push',
    pushInput: `refs/heads/task ${rebasedTip} refs/heads/task ${oldRemoteTip}`,
    remoteName: 'origin',
  })

  assert.match(collected.diff, /MY-OWN-WORK/, '我自己写的必须在评审范围里')
  assert.doesNotMatch(collected.diff, /MAINLINE-DRIFT/, 'force-push 的端点差会卷进整段主线漂移')
})

test('普通快进推送不受影响：范围仍是远端 tip → 本地 tip（不因修复而变宽）', (t) => {
  const { root, mainlineTip } = makeDivergedRepository(t)
  git(root, ['checkout', '--quiet', 'task'])
  const pushedTip = git(root, ['rev-parse', 'HEAD'])
  fs.writeFileSync(path.join(root, 'second.txt'), 'SECOND-COMMIT\n')
  git(root, ['add', 'second.txt'])
  git(root, ['commit', '--quiet', '-m', 'second'])
  const head = git(root, ['rev-parse', 'HEAD'])

  const collected = collectReviewDiff({
    repoRoot: root,
    scope: 'push',
    pushInput: `refs/heads/task ${head} refs/heads/task ${pushedTip}`,
    remoteName: 'origin',
  })

  assert.match(collected.diff, /SECOND-COMMIT/, '新提交要审')
  assert.doesNotMatch(collected.diff, /MY-OWN-WORK/, '已推送过的提交不该被重审——范围不许因修复而变宽')
  assert.ok(mainlineTip, 'fixture sanity')
})

test('合并提交的 staged 评审：只剩冲突解析与我的改动，不含被合入分支带来的内容', (t) => {
  const { root } = makeDivergedRepository(t)
  // 制造一次真冲突：两边都动 tracked.txt。
  git(root, ['checkout', '--quiet', 'mainline'])
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'MAINLINE-SIDE\n')
  git(root, ['commit', '--quiet', '-am', 'mainline edits tracked'])
  const mainlineTip = git(root, ['rev-parse', 'HEAD'])
  git(root, ['update-ref', 'refs/remotes/origin/mainline', mainlineTip])
  git(root, ['checkout', '--quiet', 'task'])
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'TASK-SIDE\n')
  git(root, ['commit', '--quiet', '-am', 'task edits tracked'])

  const merge = spawnSync('git', ['merge', '--no-commit', '--no-ff', 'mainline'], { cwd: root, encoding: 'utf8' })
  assert.notEqual(merge.status, 0, '这条测试的前提是真冲突；没冲突就没测到东西')
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'RESOLVED-BY-HAND\n')
  git(root, ['add', 'tracked.txt'])

  const collected = collectReviewDiff({ repoRoot: root, scope: 'staged' })
  assert.match(collected.diff, /RESOLVED-BY-HAND/, '冲突解析是本次唯一由人做的决定，必须审')
  assert.doesNotMatch(collected.diff, /MAINLINE-DRIFT/, '被合入分支带来的内容不该进评审范围')
})

test('追平 merge 的冲突解析必须进评审——它是这次合并里唯一由人做的决定', (t) => {
  const { root } = makeDivergedRepository(t)
  git(root, ['symbolic-ref', '--delete', 'refs/remotes/origin/HEAD'])
  // 两边都改同一行 → 制造真冲突，然后手工解析成第三种内容。
  git(root, ['checkout', '--quiet', 'mainline'])
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'MAINLINE-SIDE\n')
  git(root, ['commit', '--quiet', '-am', 'mainline edits tracked'])
  git(root, ['update-ref', 'refs/remotes/origin/mainline', git(root, ['rev-parse', 'HEAD'])])
  git(root, ['checkout', '--quiet', 'task'])
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'TASK-SIDE\n')
  git(root, ['commit', '--quiet', '-am', 'task edits tracked'])
  const pushedTip = git(root, ['rev-parse', 'HEAD'])

  const merge = spawnSync('git', ['merge', '--no-commit', '--no-ff', 'mainline'], { cwd: root, encoding: 'utf8' })
  assert.notEqual(merge.status, 0, '前提是真冲突；没冲突这条就没测到东西')
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'RESOLVED-BY-HAND\n')
  git(root, ['add', 'tracked.txt'])
  git(root, ['commit', '--quiet', '--no-edit'])
  const merged = git(root, ['rev-parse', 'HEAD'])

  const collected = collectReviewDiff({
    repoRoot: root,
    scope: 'push',
    pushInput: `refs/heads/task ${merged} refs/heads/task ${pushedTip}`,
    remoteName: 'origin',
  })

  assert.match(collected.diff, /diff --cc tracked.txt/)
  assert.match(collected.diff, /RESOLVED-BY-HAND/, '冲突解析是这次合并唯一由人做的决定，漏了它这道闸就白设')
  assert.doesNotMatch(collected.diff, /MAINLINE-DRIFT|MY-OWN-WORK/, '被合入的主线内容不该进评审')
})


test('origin tracking refs without HEAD exclude 2MB mainline in a temporary worktree', (t) => {
  const root = makeRepository(t)
  const base = git(root, ['rev-parse', 'HEAD'])
  fs.writeFileSync(path.join(root, 'upstream.txt'), 'UPSTREAM-ONLY\n'.repeat(160000))
  git(root, ['add', '.'])
  git(root, ['commit', '--quiet', '-m', 'upstream'])
  git(root, ['update-ref', 'refs/remotes/origin/main', git(root, ['rev-parse', 'HEAD'])])
  const worktree = path.join(root, 'task-worktree')
  git(root, ['worktree', 'add', '--quiet', '-b', 'task', worktree, base])
  fs.writeFileSync(path.join(worktree, 'mine.txt'), 'BRANCH-DELTA\n')
  git(worktree, ['add', 'mine.txt'])
  git(worktree, ['commit', '--quiet', '-m', 'task delta'])
  git(worktree, ['merge', '--quiet', '--no-edit', 'refs/remotes/origin/main'])
  const localSha = git(worktree, ['rev-parse', 'HEAD'])
  for (const remoteSha of [base, ZERO]) {
    const { diff } = collectReviewDiff({ repoRoot: worktree, scope: 'push', remoteName: 'origin',
      pushInput: `refs/heads/task ${localSha} refs/heads/task ${remoteSha}` })
    assert.ok(!diff.includes('UPSTREAM-ONLY'), `mainline leaked: ${Buffer.byteLength(diff)} bytes`)
    assert.match(diff, /BRANCH-DELTA/)
    assert.ok(Buffer.byteLength(diff) < 2000)
  }
})

test('commit traversal errors block review instead of becoming an empty patch', () => {
  assert.throws(() => collectReviewDiff({ repoRoot: '/repo', scope: 'push',
    pushInput: `refs/heads/task ${SHA_B} refs/heads/task ${SHA_A}`,
    runGit: (_root, args) => {
      if (args[0] === 'for-each-ref') return SHA_A
      if (args[0] === 'rev-list') throw new Error('Git object missing')
      return ''
    } }), /Git object missing/)
})

test('oversized authored commit blocks before runner with directory splitting instructions', () => {
  assert.throws(() => runPonytailReview({ repoRoot: '/repo', scope: 'push',
    pushInput: `refs/heads/task ${SHA_B} refs/heads/task ${SHA_A}`,
    runGit: (_root, args) => {
      if (args[0] === 'for-each-ref') return SHA_A
      if (args[0] === 'rev-list') return args.includes('--parents') ? `${SHA_B} ${SHA_A}` : SHA_B
      return 'x'.repeat(MAX_REVIEW_DIFF_BYTES + 1)
    }, spawnSyncImpl: () => assert.fail('oversized commit must not launch the runner') }),
  /commit b{40}.*按目录拆提交/)
})


test('individually bounded commits exceeding the total cap require batched push', () => {
  assert.throws(() => collectReviewDiff({ repoRoot: '/repo', scope: 'push',
    pushInput: `refs/heads/task ${SHA_B} refs/heads/task ${SHA_A}`,
    runGit: (_root, args) => {
      if (args[0] === 'for-each-ref') return SHA_A
      if (args[0] === 'rev-list') return `${SHA_A}\n${SHA_B}`
      if (args[0] === 'show') return 'x'.repeat(80_000)
      return ''
    } }), /分批 push/)
})

test('new ref binary summary never compares against an unrelated origin branch tip', (t) => {
  const root = makeRepository(t)
  const base = git(root, ['rev-parse', 'HEAD'])
  git(root, ['checkout', '--quiet', '-b', 'unrelated'])
  fs.writeFileSync(path.join(root, 'unrelated.png'), pngBytes(1024))
  git(root, ['add', 'unrelated.png'])
  git(root, ['commit', '--quiet', '-m', 'unrelated image'])
  git(root, ['update-ref', 'refs/remotes/origin/aaa-unrelated', git(root, ['rev-parse', 'HEAD'])])
  git(root, ['update-ref', 'refs/remotes/origin/main', base])
  git(root, ['checkout', '--quiet', '-b', 'task', base])
  fs.writeFileSync(path.join(root, 'mine.png'), pngBytes(2048))
  git(root, ['add', 'mine.png'])
  git(root, ['commit', '--quiet', '-m', 'task image'])
  const head = git(root, ['rev-parse', 'HEAD'])
  const { diff } = collectReviewDiff({ repoRoot: root, scope: 'push',
    pushInput: `refs/heads/task ${head} refs/heads/task ${ZERO}` })
  assert.doesNotMatch(diff, /unrelated.png/)
  assert.match(diff, /BINARY: added mine.png/)
})

test('staged conflict review uses AUTO_MERGE without re-reviewing a huge authored branch', (t) => {
  const { root } = makeDivergedRepository(t)
  git(root, ['checkout', '--quiet', 'mainline'])
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'UPSTREAM-SIDE\n')
  git(root, ['commit', '--quiet', '-am', 'upstream conflict'])
  git(root, ['checkout', '--quiet', 'task'])
  fs.writeFileSync(path.join(root, 'already-reviewed.txt'), 'ALREADY-REVIEWED\n'.repeat(15000))
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'TASK-SIDE\n')
  git(root, ['add', '.'])
  git(root, ['commit', '--quiet', '-m', 'large reviewed branch'])
  assert.notEqual(spawnSync('git', ['merge', '--no-commit', 'mainline'], { cwd: root }).status, 0)
  assert.match(git(root, ['rev-parse', '--verify', 'AUTO_MERGE^{tree}']), /^[0-9a-f]{40}$/)
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'RESOLUTION-ONLY\n')
  fs.writeFileSync(path.join(root, 'manual.txt'), 'EXTRA-STAGED-DECISION\n')
  git(root, ['add', 'tracked.txt', 'manual.txt'])
  const { diff } = collectReviewDiff({ repoRoot: root, scope: 'staged' })
  assert.match(diff, /RESOLUTION-ONLY/)
  assert.match(diff, /EXTRA-STAGED-DECISION/)
  assert.doesNotMatch(diff, /ALREADY-REVIEWED|MAINLINE-DRIFT|MY-OWN-WORK/)
  assert.ok(Buffer.byteLength(diff) < 2000)
})

test('clean merge without AUTO_MERGE still reviews manually staged changes', (t) => {
  const { root } = makeDivergedRepository(t)
  git(root, ['merge', '--quiet', '--no-commit', 'mainline'])
  fs.writeFileSync(path.join(root, 'manual.txt'), 'MANUAL-CLEAN-MERGE\n')
  git(root, ['add', 'manual.txt'])
  const { diff } = collectReviewDiff({ repoRoot: root, scope: 'staged' })
  assert.match(diff, /MANUAL-CLEAN-MERGE/)
})

// ── 自适应超时 / 全机串行锁 / 提交阶段留痕延后（2026-09-11，R25 三条）──────────
// 起因见 docs/fixes/2026-09-11-ponytail-timeout-starvation.root-cause.json：
// 写死的 180s 墙钟在 20+ worktree 并跑时变成「机器忙不忙」的抽签，一晚拦了十几次正确提交。

test('review timeout derives from diff size and machine load, and is capped', () => {
  const at = (diffBytes, loadAverage) => resolveReviewTimeoutMs({ diffBytes, loadAverage })
  // 空闲机器 + 小 diff = 基线。
  assert.equal(at(0, 0), REVIEW_TIMEOUT_BASE_MS)
  assert.equal(at(REVIEW_TIMEOUT_DIFF_STEP_BYTES - 1, 0), REVIEW_TIMEOUT_BASE_MS)
  // 每满一档 diff 加一档时间（向下取整，不给未满的档提前发钱）。
  assert.equal(at(REVIEW_TIMEOUT_DIFF_STEP_BYTES, 0), REVIEW_TIMEOUT_BASE_MS + REVIEW_TIMEOUT_DIFF_STEP_MS)
  assert.equal(at(REVIEW_TIMEOUT_DIFF_STEP_BYTES * 3, 0), REVIEW_TIMEOUT_BASE_MS + REVIEW_TIMEOUT_DIFF_STEP_MS * 3)
  // 负载阈值是严格大于：正好等于阈值不加成，否则空闲机器也会被放大。
  assert.equal(at(0, REVIEW_TIMEOUT_LOAD_THRESHOLD), REVIEW_TIMEOUT_BASE_MS)
  assert.equal(
    at(0, REVIEW_TIMEOUT_LOAD_THRESHOLD + 0.1),
    Math.round(REVIEW_TIMEOUT_BASE_MS * REVIEW_TIMEOUT_LOAD_MULTIPLIER),
  )
  // 上限封顶：再长就不是超时问题而是 runner 坏了，该走延后账本。
  assert.equal(at(REVIEW_TIMEOUT_DIFF_STEP_BYTES * 100, 16), REVIEW_TIMEOUT_MAX_MS)
  assert.ok(at(REVIEW_TIMEOUT_DIFF_STEP_BYTES * 100, 16) <= REVIEW_TIMEOUT_MAX_MS)
  // 非法/缺失输入退回基线，绝不退回 0（0 = spawnSync 立刻杀掉子进程）。
  assert.equal(resolveReviewTimeoutMs(), REVIEW_TIMEOUT_BASE_MS)
  assert.equal(at(Number.NaN, Number.NaN), REVIEW_TIMEOUT_BASE_MS)
  assert.equal(at(-1, -1), REVIEW_TIMEOUT_BASE_MS)
})

test('runner passes the derived timeout, not a constant, to the Codex spawn', () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-ponytail-report-'))
  const fake = fakeRunner({ report: 'Lean already. Ship.' })
  const bigDiff = 'x'.repeat(REVIEW_TIMEOUT_DIFF_STEP_BYTES * 2)
  runPonytailReview({
    repoRoot: '/repo',
    scope: 'staged',
    env: {
      PONYTAIL_REVIEW_REPORT_DIR: reportDir,
      PONYTAIL_REVIEW_CODEX_BIN: 'codex',
      [PONYTAIL_LOCK_HELD_ENV]: '1',
    },
    runGit: () => bigDiff,
    loadAverage: () => 0,
    spawnSyncImpl: fake.spawnSyncImpl,
  })
  fs.rmSync(reportDir, { recursive: true, force: true })
  assert.equal(
    fake.calls[0].options.timeout,
    REVIEW_TIMEOUT_BASE_MS + REVIEW_TIMEOUT_DIFF_STEP_MS * 2,
  )
})

test('machine-wide Ponytail lock admits one review and bounds the queue wait', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-ponytail-lock-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const helper = path.join(repoScriptsDir, 'with-gates-lock.py')
  const lockPath = path.join(dir, 'nomi-ponytail.lock')
  const env = { ...process.env, NOMI_GATES_LOCK_PATH: lockPath }
  delete env.NOMI_GATES_LOCK_TOKEN

  // 无人占用 → 立刻拿到锁并跑完。
  const free = spawnSync('python3', [helper, '--wait-timeout', '30', '--label', '测试锁', '--', 'true'],
    { env, encoding: 'utf8' })
  assert.equal(free.status, 0, free.stderr)

  // 有人占用 → 另一棵树排队，超过 --wait-timeout 就 fail-closed（非零），而不是硬闯。
  // `env -u` 清掉 token 并换 cwd，才算「另一棵 worktree」而不是前台继承。
  const contended = spawnSync('python3', [
    helper, '--', 'env', '-u', 'NOMI_GATES_LOCK_TOKEN',
    'python3', helper, '--wait-timeout', '1', '--label', '测试锁', '--', 'true',
  ], { cwd: dir, env, encoding: 'utf8' })
  assert.notEqual(contended.status, 0, '第二个评审必须排队等锁，等不到就拦，不许并跑')
  assert.match(contended.stderr, /测试锁/)
})

test('deferred review keeps the secrets scan, ledgers the skip, and lets the commit through', (t) => {
  const root = makeRepository(t)
  const env = { PONYTAIL_REVIEW_DEFER: '1' }
  const outcome = runPonytailReview({
    repoRoot: root,
    scope: 'staged',
    env,
    spawnSyncImpl: () => assert.fail('deferred review must not spawn the runner'),
  })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.status, 'deferred')

  const logPath = deferredLogPath(root, env)
  assert.equal(logPath, path.join(root, '.claude', 'ponytail-deferred.log'))
  const row = fs.readFileSync(logPath, 'utf8').trim()
  // 格式逐字对齐 .claude/push-bypass.log：时间|种类|branch|sha|worktree|reason|状态
  assert.match(
    row,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\|deferred\|branch=[^|]*\|sha=[0-9a-f]{40}\|worktree=[^|]+\|reason=[^|]+\|reviewed=no$/,
  )
  // git 给的是 realpath（macOS 的 /var → /private/var）；账本记 git 的那个，和 push-bypass.log 一致。
  assert.ok(row.includes(`worktree=${fs.realpathSync(root)}`))

  // 追加而不是覆盖：第二次延后必须留下第二行。
  runPonytailReview({ repoRoot: root, scope: 'staged', env, spawnSyncImpl: () => assert.fail('no runner') })
  assert.equal(fs.readFileSync(logPath, 'utf8').trim().split('\n').length, 2)
})

test('push scope never defers: outgoing diff is the last local gate', (t) => {
  const root = makeRepository(t)
  const env = { PONYTAIL_REVIEW_DEFER: '1', [PONYTAIL_LOCK_HELD_ENV]: '1', PONYTAIL_REVIEW_CODEX_BIN: 'codex' }
  assert.equal(isDeferRequested({ scope: 'staged', env }), true)
  assert.equal(isDeferRequested({ scope: 'push', env }), false)
  assert.equal(isDeferRequested({ scope: 'staged', env: {} }), false)
  assert.equal(fs.existsSync(deferredLogPath(root, env)), false)
})

test('the Claude shim self-limits under the hook budget it is handed, not a second constant', async () => {
  // 壳曾写死 165s/175s 去压 180s 常量。墙钟改成派生后，那份常量会在大 diff 上把评审
  // 提前砍掉——正好复刻这次要修的假超时。壳必须从 PONYTAIL_REVIEW_TIMEOUT_MS 反推。
  const { resolveTimeout } = await import('./ponytail-review-claude-shim.mjs')
  assert.equal(resolveTimeout({ PONYTAIL_REVIEW_TIMEOUT_MS: String(REVIEW_TIMEOUT_MAX_MS) }), REVIEW_TIMEOUT_MAX_MS - 15_000)
  assert.equal(resolveTimeout({ PONYTAIL_REVIEW_TIMEOUT_MS: String(REVIEW_TIMEOUT_BASE_MS) }), REVIEW_TIMEOUT_BASE_MS - 15_000)
  // 缺预算（壳被手工调用）退回基线，绝不退回 0 或无限。
  assert.equal(resolveTimeout({}), REVIEW_TIMEOUT_BASE_MS - 15_000)
  // 人工 override 只能往小调，不许越过钩子的预算。
  assert.equal(resolveTimeout({ PONYTAIL_REVIEW_TIMEOUT_MS: '180000', PONYTAIL_REVIEW_CLAUDE_TIMEOUT_MS: '900000' }), REVIEW_TIMEOUT_BASE_MS - 15_000)
})

test('the derived budget reaches the runner environment', () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-ponytail-report-'))
  const fake = fakeRunner({ report: 'Lean already. Ship.' })
  runPonytailReview({
    repoRoot: '/repo',
    scope: 'staged',
    env: { PONYTAIL_REVIEW_REPORT_DIR: reportDir, PONYTAIL_REVIEW_CODEX_BIN: 'codex', [PONYTAIL_LOCK_HELD_ENV]: '1' },
    runGit: () => 'patch',
    loadAverage: () => 0,
    spawnSyncImpl: fake.spawnSyncImpl,
  })
  fs.rmSync(reportDir, { recursive: true, force: true })
  assert.equal(fake.calls[0].options.env.PONYTAIL_REVIEW_TIMEOUT_MS, String(REVIEW_TIMEOUT_BASE_MS))
})
