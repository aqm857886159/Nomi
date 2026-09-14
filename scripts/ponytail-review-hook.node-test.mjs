import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import installer from './install-git-hooks.cjs'
import { fileURLToPath } from 'node:url'
import { parsePushInput } from './ponytail-review-hook.mjs'
import { runBranchReview, verifyPushReceipt } from './ponytail-review-branch.mjs'

const repoScriptsDir = path.dirname(fileURLToPath(import.meta.url))
const BASE_REF = 'review-base'

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
  git(root, ['branch', BASE_REF])
  return root
}

function hook(name) {
  const definition = installer.HOOKS.find((candidate) => candidate.name === name)
  assert.ok(definition, `missing ${name} definition`)
  return definition
}

test('pre-push input validates ref ranges, including create and delete', () => {
  const parsed = parsePushInput(`refs/heads/main ${SHA_A} refs/heads/main ${SHA_B}\n\nrefs/heads/next ${SHA_B} refs/heads/next ${ZERO}\n`)
  assert.deepEqual(parsed, [
    { localRef: 'refs/heads/main', localSha: SHA_A, remoteRef: 'refs/heads/main', remoteSha: SHA_B },
    { localRef: 'refs/heads/next', localSha: SHA_B, remoteRef: 'refs/heads/next', remoteSha: ZERO },
  ])
  assert.throws(() => parsePushInput('bad line'), /Invalid pre-push line/)
  assert.throws(() => parsePushInput(`refs/heads/x zz refs/heads/x ${SHA_A}`), /Invalid local SHA/)
})

test('pre-commit 只剩敏感数据扫描：提交时刻不再跑模型评审', () => {
  assert.deepEqual(hook('pre-commit').commands.map(({ target }) => target), ['scripts/check-no-secrets.mjs'])
  const preCommit = installer.renderHookContent(hook('pre-commit'))
  assert.match(preCommit, /exec node "\$ROOT\/scripts\/check-no-secrets\.mjs" "\$@"/)
  assert.doesNotMatch(preCommit, /ponytail/i)
})

test('pre-push 只查收据：一条命令、带 ref 参数、缺文件时安全跳过', () => {
  assert.deepEqual(hook('pre-push').commands.map(({ target }) => target), ['scripts/ponytail-review-hook.mjs'])
  const prePush = installer.renderHookContent(hook('pre-push'))
  assert.match(prePush, /\[ -f "\$ROOT\/scripts\/ponytail-review-hook\.mjs" \] \|\| exit 0/)
  assert.match(prePush, /exec node "\$ROOT\/scripts\/ponytail-review-hook\.mjs" "\$@"/)
  const commitMsg = installer.renderHookContent(hook('commit-msg'))
  assert.match(commitMsg, /check-progress-update\.cjs/)
  assert.doesNotMatch(commitMsg, /ponytail/i)
})

test('钩子没有任何入口能跑模型评审——评审只在 review:branch 里', () => {
  const hookSource = fs.readFileSync(path.join(repoScriptsDir, 'ponytail-review-hook.mjs'), 'utf8')
  assert.doesNotMatch(hookSource, /spawnSync/, '钩子不许再起子进程跑模型')
  assert.doesNotMatch(hookSource, /nomi-ponytail\.lock|with-gates-lock/, '全机评审锁已删除')
})

test('真跑一次生成的 pre-push：无收据被拦，评审过后放行', (t) => {
  const root = makeRepository(t)
  fs.writeFileSync(path.join(root, 'change.txt'), 'pushed\n')
  git(root, ['add', 'change.txt'])
  git(root, ['commit', '--quiet', '-m', 'work'])
  const head = git(root, ['rev-parse', 'HEAD'])
  const script = path.resolve(repoScriptsDir, 'ponytail-review-hook.mjs')
  const pushInput = `refs/heads/task ${head} refs/heads/task ${ZERO}\n`
  const run = () => spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', input: pushInput })

  const blocked = run()
  assert.notEqual(blocked.status, 0)
  assert.match(blocked.stderr, /review:branch/)

  runBranchReview({
    repoRoot: root,
    env: { PONYTAIL_REVIEW_BASE_REF: BASE_REF, PONYTAIL_REVIEW_CODEX_BIN: 'codex', PONYTAIL_REVIEW_REPORT_DIR: path.join(root, 'reports') },
    spawnSyncImpl: (_command, args) => {
      fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], 'Lean already. Ship.\nnet: -0 lines possible.\nPONYTAIL_REVIEW: PASS\n')
      return { status: 0, stdout: '', stderr: '' }
    },
  })

  const allowed = run()
  assert.equal(allowed.status, 0, allowed.stderr)
  assert.match(allowed.stderr, /ponytail-receipt\] ok/)
})

test('空 push 输入不拦：没有 ref 更新就没有要评审的树', (t) => {
  const root = makeRepository(t)
  assert.equal(verifyPushReceipt({ repoRoot: root, ranges: parsePushInput('') }).ok, true)
})

test('linked worktrees get isolated hook paths without touching the base worktree', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-ponytail-linked-'))
  t.after(() => fs.rmSync(base, { recursive: true, force: true }))
  const root = path.join(base, 'repo')
  const linked = path.join(base, 'linked')
  git(base, ['init', '--quiet', root])
  git(root, ['config', 'user.email', 'ponytail-test@example.invalid'])
  git(root, ['config', 'user.name', 'Ponytail Test'])
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'initial\n')
  git(root, ['add', 'tracked.txt'])
  git(root, ['commit', '--quiet', '-m', 'fixture'])
  git(root, ['config', 'extensions.worktreeConfig', 'true'])
  git(root, ['worktree', 'add', '--quiet', '-b', 'linked-branch', linked])

  const installed = installer.installHooks({ repoRoot: linked, logger: { log() {}, warn() {} } })
  assert.equal(installed.skipped, false)
  assert.notEqual(path.resolve(installed.hookDir), path.resolve(root, '.git', 'hooks'))
  assert.equal(fs.existsSync(path.join(installed.hookDir, 'pre-push')), true)
  assert.equal(fs.existsSync(path.join(root, '.git', 'hooks', 'pre-push')), false)
})
