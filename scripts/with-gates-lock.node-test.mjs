import { makeTempDir } from './_test-temp.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const wrapper = fileURLToPath(new URL('./with-gates-lock.py', import.meta.url))
// The repo pins `python3` in package.json, but the Windows installer only ever
// puts `python` (and the `py` launcher) on PATH. Derive it; do not hardcode.
const python = process.platform === 'win32' ? 'python' : 'python3'
// The wrapper's queue notice is Chinese. Python encodes stderr with the console
// codepage, which is GBK on a Chinese Windows box, and Node decodes pipes as
// UTF-8 — so the assertions below would read mojibake. Pin the child's stream
// encoding to what the reader assumes; this is a test-harness decision, the
// wrapper itself must keep matching whatever console a developer really has.
const childEnv = { PYTHONIOENCODING: 'utf-8' }
function fixture(t) {
  const root = makeTempDir('nomi-lock-test-')
  const lock = path.join(root, 'gates.lock')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { root, lock }
}
function launch(t, lock, cwd, source, env = {}) {
  const child = spawn(python, [wrapper, '--', python, '-u', '-c', `import os; print('_LOCK_COMMAND_PID=' + str(os.getpid()), flush=True); ${source}`], {
    cwd, env: { ...process.env, ...childEnv, NOMI_GATES_LOCK_PATH: lock, NOMI_GATES_LOCK_TOKEN: '', ...env },
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

// Loads the wrapper as a module so a probe can call its functions directly;
// the `if __name__ == '__main__'` guard keeps main() out of the way.
const loadWrapper = `import ctypes, importlib.util, json, os, signal, threading, time
_spec = importlib.util.spec_from_file_location('nomi_gates_lock', ${JSON.stringify(wrapper)})
lock = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(lock)
`
async function probe(source, options = {}) {
  const child = spawn(python, ['-c', source], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...childEnv }, ...options })
  let stdout = '', stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const [code] = await once(child, 'close')
  assert.equal(code, 0, `probe exited ${code}\n${stdout}\n${stderr}`)
  return JSON.parse(stdout.trim().split(/\r?\n/).pop())
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
  const source = `import subprocess, sys; sys.exit(subprocess.call([${JSON.stringify(python)}, ${JSON.stringify(wrapper)}, '--', ${JSON.stringify(python)}, '-c', "print('NESTED')"]))`
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
  const nested = `import os, subprocess, sys; os.mkfifo(${JSON.stringify(start)}); os.mkfifo(${JSON.stringify(finish)}); print('READY', flush=True); open(${JSON.stringify(start)}).read(); sys.exit(subprocess.call([${JSON.stringify(python)}, ${JSON.stringify(wrapper)}, '--', ${JSON.stringify(python)}, '-u', '-c', ${JSON.stringify(inner)}]))`
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
  const child = spawn(python, [wrapper, '--command', 'node -p "JSON.stringify(process.argv.slice(1))"', ...values], {
    cwd: root, env: { ...process.env, ...childEnv, NOMI_GATES_LOCK_PATH: lock, NOMI_GATES_LOCK_TOKEN: '' },
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

// Liveness is a read. It answers for real pids and refuses anything that is not
// one, because pid 0 means "my own group" to both kill(2) and the Windows
// console API — the blast radius of a typo is the caller's own session.
test('alive() reads real liveness and refuses non-pid values', { timeout: 15000 }, async () => {
  assert.deepEqual(await probe(`${loadWrapper}
print(json.dumps({
    'self': lock.alive(os.getpid()),
    'missing': lock.alive(99999999),
    'zero': lock.alive(0),
    'negative': lock.alive(-1),
    'bool': lock.alive(True),
    'text': lock.alive('x'),
    'none': lock.alive(None),
    'over_32_bit': lock.alive(2 ** 33),
}))`), {
    self: true, missing: false, zero: false, negative: false,
    bool: false, text: false, none: false, over_32_bit: false,
  })
})

// Regression guard for issue #838, at the level of the write itself: on Windows
// CPython routes os.kill(pid, 0) to GenerateConsoleCtrlEvent(CTRL_C_EVENT, pid),
// so the Windows branch must never reach os.kill at all. A spy that explodes on
// call fails this the moment someone reintroduces the signal-zero shape.
test('windows liveness never calls os.kill', { timeout: 15000, skip: process.platform !== 'win32' && 'POSIX signal-zero is a real read-only probe' }, async () => {
  assert.deepEqual(await probe(`${loadWrapper}
def _exploding_kill(*args, **kwargs):
    raise AssertionError('alive() called os.kill; signal 0 is CTRL_C_EVENT on Windows')

os.kill = _exploding_kill
print(json.dumps({'self': lock.alive(os.getpid()), 'missing': lock.alive(99999999)}))`), { self: true, missing: false })
})

// Observed from the outside, the way the host saw it: a process that shares the
// console watches for Ctrl+C while both lock entry points run against its pid.
// Positive control: this fixture reports ctrl_c=true on the pre-fix wrapper
// (docs/fixes/2026-09-22-gates-lock-alive-probe-windows-ctrl-c.root-cause.json).
test('windows liveness does not interrupt processes sharing the console', { timeout: 20000, skip: process.platform !== 'win32' && 'console control events are Windows-only' }, async () => {
  const observed = await probe(`${loadWrapper}
# detached=true gives this process its own group, which is what a console
# control event targets; that same flag disables Ctrl+C, so re-enable it or a
# stray event would be silently swallowed and the probe would lie green.
ctypes.WinDLL('kernel32', use_last_error=True).SetConsoleCtrlHandler(None, False)
interrupted = threading.Event()
signal.signal(signal.SIGINT, lambda *_: interrupted.set())
owner = {'pid': os.getpid(), 'cwd': os.getcwd(), 'token': 'probe'}
report = {'alive': lock.alive(os.getpid())}
time.sleep(0.3)
report['ctrl_c_after_alive'] = interrupted.is_set()
report['inherited'] = lock.inherited_owner(owner, 'probe')
time.sleep(0.3)
report['ctrl_c_after_inherited_owner'] = interrupted.is_set()
print(json.dumps(report))`, { detached: true })
  assert.deepEqual(observed, {
    alive: true, inherited: true,
    ctrl_c_after_alive: false, ctrl_c_after_inherited_owner: false,
  })
})

// Class gate, not an example gate. The defect is a *shape*: on Windows there
// are no signals, so CPython maps os.kill(pid, 0) onto
// GenerateConsoleCtrlEvent(CTRL_C_EVENT, pid) — it interrupts every process
// sharing the console instead of reading process state (issue #838). On macOS
// and Linux the same line is a correct read-only probe, which is exactly why a
// developer on either platform cannot see the bug. So the rule is checked
// structurally on every platform: a signal-zero probe is legal only after its
// scope has already returned or raised for Windows. Positive control: this goes
// red on the pre-fix wrapper (see the root-cause contract for the run).
test('signal-zero liveness probes are unreachable on windows', { timeout: 15000 }, async () => {
  assert.deepEqual(await probe(`import ast, json, pathlib

def terminates(body):
    if not body:
        return False
    last = body[-1]
    if isinstance(last, (ast.Return, ast.Raise)):
        return True
    if isinstance(last, ast.If):
        return terminates(last.body) and terminates(last.orelse)
    if isinstance(last, ast.Try):
        return terminates(last.body) or terminates(last.finalbody)
    if isinstance(last, (ast.With, ast.AsyncWith)):
        return terminates(last.body)
    return False

def windows_exit(stmt):
    return (isinstance(stmt, ast.If)
            and ast.unparse(stmt.test) in ("os.name == 'nt'", "sys.platform == 'win32'")
            and terminates(stmt.body))

def signal_zero(node):
    return (isinstance(node, ast.Call) and ast.unparse(node.func) == 'os.kill'
            and len(node.args) == 2 and isinstance(node.args[1], ast.Constant)
            and node.args[1].value == 0 and node.args[1].value is not False)

unreachable_on_windows = []
for source in sorted(pathlib.Path(${JSON.stringify(fileURLToPath(new URL('.', import.meta.url)))}).rglob('*.py')):
    tree = ast.parse(source.read_text(encoding='utf-8'))
    parents = {child: parent for parent in ast.walk(tree) for child in ast.iter_child_nodes(parent)}
    guards = {}
    for scope in [tree] + [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]:
        guards[scope] = next((s.end_lineno for s in scope.body if windows_exit(s)), None)
    for node in ast.walk(tree):
        if not signal_zero(node):
            continue
        scope = parents.get(node)
        while scope is not None and not isinstance(scope, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Module)):
            scope = parents.get(scope)
        guard = guards.get(scope)
        if guard is None or node.lineno <= guard:
            unreachable_on_windows.append(source.name + ':' + str(node.lineno) + ' ' + ast.unparse(node))
print(json.dumps(sorted(unreachable_on_windows)))`), [], 'os.kill(pid, 0) is a console interrupt on Windows, not a liveness read. Return or raise for os.name == nt first (see alive() in with-gates-lock.py), or observe the process object.')
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
