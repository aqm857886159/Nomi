import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { makeTempDir, cleanupTestTemp } from './_test-temp.mjs'

const script =
  process.env.NOMI_MAIN_FOLLOW_SCRIPT || fileURLToPath(new URL('./main-checkout-follow.mjs', import.meta.url))
const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
function fixture(t) {
  const dir = makeTempDir('main-follow-')
  t.after(() => cleanupTestTemp(dir))
  const origin = path.join(dir, 'origin.git'),
    seed = path.join(dir, 'seed'),
    main = path.join(dir, 'main')
  git(dir, 'init', '--bare', '--initial-branch=main', origin)
  git(dir, 'clone', origin, seed)
  git(seed, 'config', 'user.name', 'Fixture')
  git(seed, 'config', 'user.email', 'fixture@example.invalid')
  writeFileSync(path.join(seed, 'README.md'), 'base\n')
  git(seed, 'add', 'README.md')
  git(seed, 'commit', '-m', 'base')
  git(seed, 'push', 'origin', 'main')
  git(dir, 'clone', origin, main)
  const before = git(main, 'rev-parse', 'HEAD')
  function advance(file = 'remote.txt') {
    writeFileSync(path.join(seed, file), 'new upstream\n')
    git(seed, 'add', file)
    git(seed, 'commit', '-m', 'advance')
    git(seed, 'push', 'origin', 'main')
    git(main, 'fetch', 'origin', 'main')
    return git(seed, 'rev-parse', 'HEAD')
  }
  return { dir, origin, seed, main, before, advance }
}
function run(root, scriptPath = script) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    timeout: 20000,
  })
}
const output = (r) => `${r.stdout}${r.stderr}`

test('clean behind main follows the remote', (t) => {
  const f = fixture(t),
    after = f.advance()
  git(f.main, 'update-ref', 'refs/remotes/origin/main', f.before)
  const r = run(f.main)
  assert.equal(r.status, 0, output(r))
  assert.equal(git(f.main, 'rev-parse', 'HEAD'), after)
  assert.match(output(r), /已跟上/)
})
for (const tracked of [true, false])
  test(`dirty ${tracked ? 'tracked' : 'untracked'} checkout stays untouched with filenames`, (t) => {
    const f = fixture(t)
    f.advance()
    const file = tracked ? 'README.md' : 'local.txt'
    writeFileSync(path.join(f.main, file), 'local changes\n')
    const r = run(f.main)
    assert.equal(r.status, 0, output(r))
    assert.equal(git(f.main, 'rev-parse', 'HEAD'), f.before)
    assert.equal(readFileSync(path.join(f.main, file), 'utf8'), 'local changes\n')
    assert.match(output(r), /落后 1/)
    assert.ok(output(r).includes(file), output(r))
  })
test('non-main branch stays untouched with warning', (t) => {
  const f = fixture(t)
  f.advance()
  git(f.main, 'switch', '-c', 'topic')
  const r = run(f.main)
  assert.equal(r.status, 0, output(r))
  assert.equal(git(f.main, 'rev-parse', 'HEAD'), f.before)
  assert.equal(git(f.main, 'branch', '--show-current'), 'topic')
  assert.match(output(r), /topic.*落后 1/)
})
test('offline never blocks and reports failure', (t) => {
  const f = fixture(t)
  renameSync(f.origin, f.origin + '.offline')
  const r = run(f.main)
  assert.equal(r.status, 0, output(r))
  assert.equal(git(f.main, 'rev-parse', 'HEAD'), f.before)
  assert.match(output(r), /fetch 失败/)
})
test('linked worktree never updates either checkout', (t) => {
  const f = fixture(t)
  f.advance()
  const worktree = path.join(f.dir, 'worktree')
  git(f.main, 'worktree', 'add', '-b', 'task', worktree, f.before)
  const r = run(worktree)
  assert.equal(r.status, 0, output(r))
  assert.equal(output(r), '')
  assert.equal(git(f.main, 'rev-parse', 'HEAD'), f.before)
  assert.equal(git(worktree, 'rev-parse', 'HEAD'), f.before)
})
test('divergence only warns; ff-only keeps local commit', (t) => {
  const f = fixture(t)
  f.advance()
  git(f.main, 'config', 'user.name', 'Fixture')
  git(f.main, 'config', 'user.email', 'fixture@example.invalid')
  writeFileSync(path.join(f.main, 'local.txt'), 'local\n')
  git(f.main, 'add', 'local.txt')
  git(f.main, 'commit', '-m', 'diverge')
  const before = git(f.main, 'rev-parse', 'HEAD'),
    r = run(f.main)
  assert.equal(r.status, 0, output(r))
  assert.equal(git(f.main, 'rev-parse', 'HEAD'), before)
  assert.match(output(r), /快进/)
})
test('dependency changes ask for install without installing', (t) => {
  const f = fixture(t),
    after = f.advance('pnpm-lock.yaml'),
    r = run(f.main)
  assert.equal(r.status, 0, output(r))
  assert.equal(git(f.main, 'rev-parse', 'HEAD'), after)
  assert.match(output(r), /主仓依赖要装/)
  assert.equal(git(f.main, 'status', '--porcelain'), '')
})
test('existing git lock is retained and never blocks the session', (t) => {
  const f = fixture(t)
  f.advance()
  const lock = path.join(f.main, '.git/index.lock')
  writeFileSync(lock, 'someone else\n')
  const r = run(f.main)
  assert.equal(r.status, 0, output(r))
  assert.equal(git(f.main, 'rev-parse', 'HEAD'), f.before)
  assert.equal(readFileSync(lock, 'utf8'), 'someone else\n')
  assert.match(output(r), /锁|快进/)
})
test('SessionStart registered command reaches the follow boundary', (t) => {
  const f = fixture(t),
    after = f.advance()
  mkdirSync(path.join(f.main, 'scripts/claude-hooks'), { recursive: true })
  // Fixture scripts are ignored so hook loading does not itself dirty the checkout.
  writeFileSync(path.join(f.main, '.git/info/exclude'), 'scripts/\n')
  const hook = fileURLToPath(new URL('./claude-hooks/handoff-read.sh', import.meta.url))
  writeFileSync(path.join(f.main, 'scripts/claude-hooks/handoff-read.sh'), readFileSync(hook))
  writeFileSync(path.join(f.main, 'scripts/main-checkout-follow.mjs'), readFileSync(script))
  const settings = JSON.parse(readFileSync(new URL('../.claude/settings.json', import.meta.url)))
  const command = settings.hooks.SessionStart.flatMap((g) => g.hooks).find((h) =>
    h.command.includes('handoff-read.sh'),
  ).command
  const r = spawnSync(command, {
    shell: true,
    cwd: f.main,
    input: '{}',
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: f.main },
    timeout: 20000,
  })
  assert.equal(r.status, 0, output(r))
  assert.equal(git(f.main, 'rev-parse', 'HEAD'), after)
  assert.match(output(r), /已跟上/)
})
