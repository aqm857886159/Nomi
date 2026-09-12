import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const wrapper = fileURLToPath(new URL('./with-gates-lock.py', import.meta.url))
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-lock-test-'))
  const lock = path.join(root, 'gates.lock')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { root, lock }
}
function launch(t, lock, cwd, source, env = {}) {
  const child = spawn('python3', [wrapper, '--', 'python3', '-u', '-c', `import os; print('_LOCK_COMMAND_PID=' + str(os.getpid()), flush=True); ${source}`], {
    cwd, env: { ...process.env, NOMI_GATES_LOCK_PATH: lock, NOMI_GATES_LOCK_TOKEN: '', ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.lines = []
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (b) => {
    child.lines.push(b.toString())
    child.emit('output')
  })
  child.done = once(child, 'close')
  t.after(async () => {
    if (process.platform !== 'win32') {
      const pid = child.lines.join('').match(/_LOCK_COMMAND_PID=(\d+)/)?.[1]
      if (pid) { try { process.kill(-Number(pid), 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error } }
    }
    if (child.exitCode === null) child.kill('SIGTERM')
    await child.done
  })
  return child
}
async function output(child, pattern) {
  while (!pattern.test(child.lines.join(''))) {
    assert.equal(child.exitCode, null, child.lines.join(''))
    await Promise.race([once(child, 'output'), child.done.then(() => { throw new Error(child.lines.join('')) })])
  }
}

test('two worktree directories serialize and the waiter reports owner then takes over', { timeout: 15000 }, async (t) => {
  const { root, lock } = fixture(t)
  const firstDir = path.join(root, 'worktree-a')
  const secondDir = path.join(root, 'worktree-b')
  fs.mkdirSync(firstDir); fs.mkdirSync(secondDir)
  const first = launch(t, lock, firstDir, "print('FIRST', flush=True); input()")
  await output(first, /FIRST/)
  const second = launch(t, lock, secondDir, "print('SECOND', flush=True)")
  await output(second, /另一棵 worktree/)
  assert.match(second.lines.join(''), /pid=.*worktree-a.*已跑/)
  assert.doesNotMatch(second.lines.join(''), /SECOND/)
  first.stdin.end('\n')
  assert.equal((await first.done)[0], 0)
  assert.equal((await second.done)[0], 0)
  assert.match(second.lines.join(''), /SECOND/)
})

test('dead holder metadata does not prevent acquisition and failure exit is preserved', { timeout: 10000 }, async (t) => {
  const { root, lock } = fixture(t)
  fs.writeFileSync(lock, JSON.stringify({ pid: 99999999, cwd: '/dead', started: 0, token: 'dead' }))
  const child = launch(t, lock, root, 'raise SystemExit(7)')
  assert.equal((await child.done)[0], 7)
})

test('nested wrapper inherits verified ownership without self-deadlock', { timeout: 10000 }, async (t) => {
  const { root, lock } = fixture(t)
  const source = `import subprocess, sys; sys.exit(subprocess.call(['python3', ${JSON.stringify(wrapper)}, '--', 'python3', '-c', "print('NESTED')"]))`
  const child = launch(t, lock, root, source)
  assert.equal((await child.done)[0], 0)
  assert.match(child.lines.join(''), /NESTED/)
})

test('killed wrapper cannot release lock while its inherited child still runs', { timeout: 15000 }, async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX inherited flock descriptor')
  const { root, lock } = fixture(t)
  const first = launch(t, lock, root, `import os; os.mkfifo(${JSON.stringify(path.join(root, "release"))}); print("CHILD", flush=True); open(${JSON.stringify(path.join(root, "release"))}).read()`)
  await output(first, /CHILD/)
  first.kill('SIGKILL')
  const second = launch(t, lock, root, "print('TAKEOVER', flush=True)")
  await output(second, /另一棵 worktree/)
  assert.doesNotMatch(second.lines.join(''), /TAKEOVER/)
  fs.writeFileSync(path.join(root, 'release'), 'release')
  assert.equal((await second.done)[0], 0)
})


test('owner death allows later nested foreground validation while keeping outsiders queued', { timeout: 15000 }, async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX inherited flock descriptor')
  const { root, lock } = fixture(t)
  const start = path.join(root, 'start-nested')
  const finish = path.join(root, 'finish-nested')
  const inner = `print('AFTER_OWNER_DEATH', flush=True); open(${JSON.stringify(finish)}).read()`
  const nested = `import os, subprocess, sys; os.mkfifo(${JSON.stringify(start)}); os.mkfifo(${JSON.stringify(finish)}); print('READY', flush=True); open(${JSON.stringify(start)}).read(); sys.exit(subprocess.call(['python3', ${JSON.stringify(wrapper)}, '--', 'python3', '-u', '-c', ${JSON.stringify(inner)}]))`
  const first = launch(t, lock, root, nested)
  await output(first, /READY/)
  first.kill('SIGKILL')
  fs.writeFileSync(start, 'start')
  await output(first, /AFTER_OWNER_DEATH/)
  const second = launch(t, lock, root, "print('OUTSIDER', flush=True)")
  await output(second, /另一棵 worktree/)
  assert.doesNotMatch(second.lines.join(''), /OUTSIDER/)
  fs.writeFileSync(finish, 'finish')
  await first.done
  assert.equal((await second.done)[0], 0)
})

test('shell command forwards extra arguments without interpreting quotes or metacharacters', { timeout: 10000 }, async (t) => {
  const { root, lock } = fixture(t)
  const values = ['--', 'two words', 'quote"value', '$(exit 9)', 'semi;colon']
  const child = spawn('python3', [wrapper, '--command', 'node -p "JSON.stringify(process.argv.slice(1))"', ...values], {
    cwd: root, env: { ...process.env, NOMI_GATES_LOCK_PATH: lock, NOMI_GATES_LOCK_TOKEN: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  const [code] = await once(child, 'close')
  assert.equal(code, 0)
  assert.deepEqual(JSON.parse(stdout), values.slice(1))
})

test('termination reaches the foreground process group and releases the lock', { timeout: 10000 }, async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX signal exit status')
  const { root, lock } = fixture(t)
  const first = launch(t, lock, root, "print('RUNNING', flush=True); input()")
  await output(first, /RUNNING/)
  first.kill('SIGTERM')
  assert.equal((await first.done)[0], 143)
  const second = launch(t, lock, root, "print('RELEASED', flush=True)")
  assert.equal((await second.done)[0], 0)
  assert.match(second.lines.join(''), /RELEASED/)
})

// Entry-point coverage is behavioral admission's companion: a new walkthrough
// must not silently bypass the machine owner while its peers queue.
test('heavy npm entrypoints all use the shared machine lock', () => {
  const { scripts } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  for (const [name, command] of Object.entries(scripts)) {
    if (['gates', 'gates:full', 'gates:contracts', 'test', 'check:design-lab', 'design-lab:update'].includes(name)
      || name.startsWith('test:system') || name.startsWith('design-lab:walk:')
      || /\.(?:e2e|walk|visual)\.mjs\b|(?:real-user-test-gates|canvas-real-suite|eval-journey)\.mjs/.test(command)) {
      assert.match(command, /^python3 scripts\/with-gates-lock\.py /, name)
    }
  }
})
