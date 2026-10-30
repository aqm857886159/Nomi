// Test-only cold process: real modules and pid; only clock/physical fsync are stubbed.
import fs from 'node:fs'
import process from 'node:process'
import os from 'node:os'
import path from 'node:path'
import { mock } from 'node:test'
import { setImmediate as yieldTurn } from 'node:timers/promises'

const input = JSON.parse(process.argv[2])
const root = fs.realpathSync(input.root)
const temp = fs.realpathSync(os.tmpdir())
if (!root.startsWith(temp + path.sep)) throw new Error('save restart fixture must stay inside the test temporary root')
const marker = JSON.parse(fs.readFileSync(path.join(root, '.save-fault-fixture.json'), 'utf8'))
if (marker.id !== input.id) throw new Error('save restart fixture identity mismatch')
const deps = { settingsRoot: path.join(root, 'settings'), defaultProjectsRoot: path.join(root, 'projects') }
const { saveWorkspaceProject } = await import('../../electron/workspace/workspaceRepository.ts')
const { setDurabilityMode } = await import('../../electron/durability.ts')
const { tryAcquireWorkspaceManifestLock } = await import('../../electron/workspace/workspaceManifestLock.ts')
setDurabilityMode('durable')
mock.method(fs, 'fsyncSync', () => {})
mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date(input.nowMs) })
mock.method(Atomics, 'wait', (_array, _index, _value, timeout) => {
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('unbounded sync wait in restart fixture')
  mock.timers.tick(timeout)
  return 'timed-out'
})
try {
  let saved, failure, settled = false
  if (input.mode === 'leave-owner') {
    tryAcquireWorkspaceManifestLock(path.join(deps.defaultProjectsRoot, 'project'))
    process.stdout.write(JSON.stringify({ pid: process.pid, ownerLeft: true }) + '\n')
    process.exit(0)
  }
  const pending = saveWorkspaceProject(input.id, { payload: { text: 'fresh-process' } }, deps)
    .then(value => { saved = value; settled = true }, error => { failure = error; settled = true })
  for (let turn = 0; !settled && turn < 2048; turn++) {
    await yieldTurn()
    mock.timers.tick(10)
  }
  if (!settled) throw new Error('restart save exceeded fake-clock turn bound')
  await pending
  if (failure) throw failure
  const persisted = JSON.parse(fs.readFileSync(path.join(deps.defaultProjectsRoot, 'project', '.nomi', 'project.json'), 'utf8'))
  process.stdout.write(JSON.stringify({ pid: process.pid, saved, persisted }) + '\n')
} catch (error) {
  process.stdout.write(JSON.stringify({ pid: process.pid, error: { name: error.name, code: error.code, message: error.message } }) + '\n')
  process.exitCode = 1
} finally {
  mock.restoreAll()
  mock.timers.reset()
}
