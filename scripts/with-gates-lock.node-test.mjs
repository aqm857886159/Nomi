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
  await output(second, /前面还有/)
  assert.match(second.lines.join(''), /前面还有 0 个（正在跑：pid=.*worktree-a.*已跑/)
  assert.doesNotMatch(second.lines.join(''), /SECOND/)
  first.stdin.end('\n')
  assert.equal((await first.done)[0], 0)
  assert.equal((await second.done)[0], 0)
  assert.match(second.lines.join(''), /SECOND/)
})

test('five queued workers acquire the lock in ticket order and report queue depth', { timeout: 30000 }, async (t) => {
  const { root, lock } = fixture(t)
  const orderPath = path.join(root, 'acquisition-order.txt')
  const holder = launch(t, lock, root, "print('HOLDER', flush=True); input()")
  await output(holder, /HOLDER/)
  const workers = []
  for (let index = 0; index < 5; index += 1) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 300))
    workers.push(launch(t, lock, root, `import time; open(${JSON.stringify(orderPath)}, 'a').write('FIFO_${index}\\n'); print('FIFO_${index}', flush=True); time.sleep(0.2)`))
  }
  await Promise.all(workers.map((worker) => output(worker, /排队等待/)))
  holder.stdin.end('\n')
  assert.equal((await holder.done)[0], 0)
  assert.deepEqual((await Promise.all(workers.map((worker) => worker.done))).map(([code]) => code), [0, 0, 0, 0, 0])
  const order = fs.readFileSync(orderPath, 'utf8').trim().split(/\r?\n/)
  assert.deepEqual(order, ['FIFO_0', 'FIFO_1', 'FIFO_2', 'FIFO_3', 'FIFO_4'])
  const stderr = workers.map((worker) => worker.lines.join('')).join('')
  assert.match(stderr, /前面还有 [0-4] 个（正在跑：pid=.* cwd=.* 已跑 .* 分钟）；排队等待/)
  assert.match(stderr, /前面还有 [1-4] 个（正在跑：pid=.* cwd=.* 已跑 .* 分钟）；排队等待/)
  assert.deepEqual([...new Set([...stderr.matchAll(/前面还有 (\d+) 个/g)].map((match) => Number(match[1])))].sort((a, b) => a - b), [0, 1, 2, 3, 4])
  assert.deepEqual(fs.readdirSync(`${lock}.queue`).filter((name) => name.startsWith('ticket-')), [])
})

test('a SIGKILLed middle ticket is reclaimed by the kernel and cannot block later tickets', { timeout: 20000 }, async (t) => {
  const { root, lock } = fixture(t)
  const holder = launch(t, lock, root, "print('HOLDER', flush=True); input()")
  await output(holder, /HOLDER/)
  const first = launch(t, lock, root, "import time; print('FIRST_TICKET', flush=True); time.sleep(0.2)")
  await output(first, /排队等待/)
  const middle = launch(t, lock, root, "print('MIDDLE_TICKET', flush=True)")
  await output(middle, /排队等待/)
  const last = launch(t, lock, root, "print('LAST_TICKET', flush=True)")
  await output(last, /排队等待/)
  middle.kill('SIGKILL')
  assert.notEqual((await middle.done)[0], 0)
  holder.stdin.end('\n')
  assert.equal((await holder.done)[0], 0)
  assert.equal((await first.done)[0], 0)
  assert.equal((await last.done)[0], 0)
  assert.match(first.lines.join(''), /FIRST_TICKET/)
  assert.match(last.lines.join(''), /LAST_TICKET/)
})

test('the next admission removes a SIGKILLed ticket file under the queue guard', { timeout: 20000 }, async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX SIGKILL and unlink evidence')
  const { root, lock } = fixture(t)
  const queue = `${lock}.queue`
  const holder = launch(t, lock, root, "print('HOLDER', flush=True); input()")
  await output(holder, /HOLDER/)
  const first = launch(t, lock, root, "print('FIRST_CLEANUP', flush=True)")
  await output(first, /排队等待/)
  const killed = launch(t, lock, root, "print('KILLED_CLEANUP', flush=True)")
  await output(killed, /排队等待/)
  killed.kill('SIGKILL')
  assert.notEqual((await killed.done)[0], 0)
  assert.equal(fs.readdirSync(queue).filter((name) => name === 'ticket-00000000000000000001.lock').length, 1)
  const admission = launch(t, lock, root, "print('ADMISSION_CLEANUP', flush=True)")
  await output(admission, /排队等待/)
  assert.equal(fs.existsSync(path.join(queue, 'ticket-00000000000000000001.lock')), false)
  holder.stdin.end('\n')
  assert.equal((await holder.done)[0], 0)
  assert.equal((await first.done)[0], 0)
  assert.equal((await admission.done)[0], 0)
  assert.deepEqual(fs.readdirSync(queue).filter((name) => name.startsWith('ticket-')), [])
})

test('a queued SIGINT exits non-zero without disturbing the remaining ticket order', { timeout: 20000 }, async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX signal delivery in the queue test')
  const { root, lock } = fixture(t)
  const holder = launch(t, lock, root, "print('HOLDER', flush=True); input()")
  await output(holder, /HOLDER/)
  const first = launch(t, lock, root, "print('FIRST_CANCEL', flush=True)")
  await output(first, /排队等待/)
  const cancelled = launch(t, lock, root, "print('CANCELLED', flush=True)")
  await output(cancelled, /排队等待/)
  const last = launch(t, lock, root, "print('LAST_CANCEL', flush=True)")
  await output(last, /排队等待/)
  cancelled.kill('SIGINT')
  assert.notEqual((await cancelled.done)[0], 0)
  holder.stdin.end('\n')
  assert.equal((await holder.done)[0], 0)
  assert.equal((await first.done)[0], 0)
  assert.equal((await last.done)[0], 0)
  assert.match(first.lines.join(''), /FIRST_CANCEL/)
  assert.match(last.lines.join(''), /LAST_CANCEL/)
  assert.doesNotMatch(cancelled.lines.join(''), /CANCELLED/)
})

test('the main lock inode survives queue setup and release', { timeout: 10000 }, async (t) => {
  if (process.platform === 'win32') return t.skip('inode identity is POSIX evidence')
  const { root, lock } = fixture(t)
  const child = launch(t, lock, root, "print('INODE', flush=True)")
  await output(child, /INODE/)
  const before = fs.statSync(lock).ino
  assert.equal((await child.done)[0], 0)
  const after = fs.statSync(lock).ino
  assert.equal(after, before)
  assert.equal(fs.statSync(`${lock}.queue`).isDirectory(), true)
})

test('unopenable queue state fails closed instead of falling back to lock polling', { timeout: 10000 }, async (t) => {
  const { root, lock } = fixture(t)
  fs.writeFileSync(`${lock}.queue`, 'not a directory')
  const child = launch(t, lock, root, "print('SHOULD_NOT_RUN', flush=True)")
  assert.notEqual((await child.done)[0], 0)
  assert.doesNotMatch(child.lines.join(''), /SHOULD_NOT_RUN/)
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

test('a nested token with a different cwd takes a ticket and waits for the outer owner', { timeout: 15000 }, async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX inherited stdout and signal semantics')
  const { root, lock } = fixture(t)
  const other = path.join(root, 'other-cwd')
  const marker = path.join(root, 'different-cwd.marker')
  fs.mkdirSync(other)
  const nested = `open(${JSON.stringify(marker)}, 'w').write('nested'); print('DIFFERENT_CWD', flush=True)`
  const source = `import os, subprocess, time; subprocess.Popen([${JSON.stringify(python)}, ${JSON.stringify(wrapper)}, '--', ${JSON.stringify(python)}, '-u', '-c', ${JSON.stringify(nested)}], cwd=${JSON.stringify(other)}); time.sleep(0.25); print('OUTER_MARKER=' + str(os.path.exists(${JSON.stringify(marker)})), flush=True)`
  const child = launch(t, lock, root, source)
  await output(child, /OUTER_MARKER=False/)
  assert.equal((await child.done)[0], 0)
  assert.match(child.lines.join(''), /DIFFERENT_CWD/)
  assert.equal(fs.readFileSync(marker, 'utf8'), 'nested')
})

test('killed wrapper cannot release lock while its inherited child still runs', { timeout: 15000 }, async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX inherited flock descriptor')
  const { root, lock } = fixture(t)
  const first = launch(t, lock, root, `import os; os.mkfifo(${JSON.stringify(path.join(root, "release"))}); print("CHILD", flush=True); open(${JSON.stringify(path.join(root, "release"))}).read()`)
  await output(first, /CHILD/)
  first.kill('SIGKILL')
  const second = launch(t, lock, root, "print('TAKEOVER', flush=True)")
  await output(second, /前面还有/)
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
  await output(second, /前面还有/)
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

test('execute installs SIGTERM handling before spawning the child', { timeout: 15000 }, async () => {
  const observed = await probe(`${loadWrapper}
import sys, tempfile

fd, path = tempfile.mkstemp()
os.close(fd)
try:
    with open(path, 'w+') as file:
        lock.ensure_lock_byte(file)
        real_popen = lock.subprocess.Popen
        observed = {}

        def hooked_popen(*args, **kwargs):
            child = real_popen(*args, **kwargs)
            observed['handler_installed'] = signal.getsignal(signal.SIGTERM) is not signal.SIG_DFL
            return child

        lock.subprocess.Popen = hooked_popen
        owner = {'pid': os.getpid(), 'cwd': os.getcwd(), 'token': 'probe'}
        observed['code'] = lock.execute([sys.executable, '-c', 'pass'], False, file, 'probe', owner)
finally:
    os.unlink(path)
print(json.dumps(observed))`)
  assert.deepEqual(observed, { handler_installed: true, code: 0 })
})

test('a SIGTERM during Popen is deferred until the child group can be killed', { timeout: 15000 }, async () => {
  const observed = await probe(`${loadWrapper}
import sys, tempfile

fd, path = tempfile.mkstemp()
os.close(fd)
try:
    with open(path, 'w+') as file:
        lock.ensure_lock_byte(file)
        assert lock.try_lock(file)
        real_popen = lock.subprocess.Popen
        observed = {}

        def hooked_popen(*args, **kwargs):
            child = real_popen(*args, **kwargs)
            observed['pid'] = child.pid
            if os.name == 'nt':
                signal.raise_signal(signal.SIGTERM)  # os.kill(SIGTERM) calls TerminateProcess on Windows, bypassing Python handlers.
            else:
                os.kill(os.getpid(), signal.SIGTERM)
            return child

        lock.subprocess.Popen = hooked_popen
        owner = {'pid': os.getpid(), 'cwd': os.getcwd(), 'token': 'probe'}
        observed['code'] = lock.execute(
            [sys.executable, '-c', 'import time; time.sleep(2)'],
            False,
            file,
            'probe',
            owner,
        )
        observed['child_alive'] = lock.alive(observed['pid'])
        if os.name == 'nt':
            observed['group_alive'] = None  # Windows has no POSIX process group. Child liveness is checked above.
        else:
            try:
                os.killpg(observed['pid'], 0)
            except ProcessLookupError:
                observed['group_alive'] = False
            else:
                observed['group_alive'] = True
        lock.unlock(file)
    takeover = real_popen(
        [sys.executable, ${JSON.stringify(wrapper)}, '--', sys.executable, '-c', "print('TAKEOVER', flush=True)"],
        env={**os.environ, 'NOMI_GATES_LOCK_PATH': path, 'NOMI_GATES_LOCK_TOKEN': ''},
        stdout=lock.subprocess.PIPE,
        stderr=lock.subprocess.PIPE,
        text=True,
    )
    stdout, stderr = takeover.communicate(timeout=10)
    observed['takeover_code'] = takeover.returncode
    observed['takeover_output'] = stdout
finally:
    os.unlink(path)
print(json.dumps(observed))`)
  assert.equal(observed.code, process.platform === 'win32' ? 1 : 143)
  assert.equal(observed.child_alive, false)
  assert.equal(observed.group_alive, process.platform === 'win32' ? null : false)
  assert.equal(observed.takeover_code, 0, observed.takeover_output)
  assert.match(observed.takeover_output, /TAKEOVER/)
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
    if (['gates', 'gates:full', 'gates:contracts', 'test', 'check:design-lab'].includes(name)
      || name.startsWith('test:system') || name.startsWith('design-lab:walk:')
      || /\.(?:e2e|walk|visual)\.mjs\b|(?:real-user-test-gates|canvas-real-suite|eval-journey)\.mjs/.test(command)) {
      assert.match(command, /^python3 scripts\/with-gates-lock\.py /, name)
    }
  }
})

// Real native handles: deletion must follow close on every platform, not only on NTFS.
test('dead ticket reclamation closes its native handle before unlink and preserves live tickets',async()=>{
 const observed=await probe(`${loadWrapper}
import tempfile
with tempfile.TemporaryDirectory() as root:
    queue = os.path.join(root, 'queue')
    lock.ensure_queue_dir(queue)
    with lock.ticket_file(queue, 0):
        pass
    live = lock.ticket_file(queue, 1)
    assert lock.try_lock(live)
    opened = []
    actual_open = lock.ticket_file
    actual_remove = lock.remove_ticket
    def tracked_open(*args, **kwargs):
        file = actual_open(*args, **kwargs)
        opened.append((lock.ticket_path(args[0], args[1]), file))
        return file
    def checked_remove(path):
        assert all(file.closed for name, file in opened if name == path), 'ticket handle still open at unlink'
        actual_remove(path)
    lock.ticket_file = tracked_open
    lock.remove_ticket = checked_remove
    lock.cleanup_dead_tickets(queue)
    dead_removed = not os.path.exists(lock.ticket_path(queue, 0))
    live_preserved = os.path.exists(lock.ticket_path(queue, 1))
    lock.unlock(live)
    live.close()
    lock.cleanup_dead_tickets(queue)
    print(json.dumps({'dead_removed': dead_removed, 'live_preserved': live_preserved, 'tickets': lock.ticket_numbers(queue)}))`)
 assert.deepEqual(observed,{dead_removed:true,live_preserved:true,tickets:[]})
})
