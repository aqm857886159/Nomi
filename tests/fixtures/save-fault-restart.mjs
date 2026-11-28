// Test-only cold process: real modules and pid; only clock/physical fsync are stubbed.
import fs from 'node:fs'
import process from 'node:process'
import os from 'node:os'
import path from 'node:path'
import { mock } from 'node:test'

const input = JSON.parse(process.argv[2])
const root = fs.realpathSync(input.root)
const temp = fs.realpathSync(os.tmpdir())
if (!root.startsWith(temp + path.sep)) throw new Error('save restart fixture must stay inside the test temporary root')
const marker = JSON.parse(fs.readFileSync(path.join(root, '.save-fault-fixture.json'), 'utf8'))
if (marker.id !== input.id) throw new Error('save restart fixture identity mismatch')
const deps = { settingsRoot: path.join(root, 'settings'), defaultProjectsRoot: path.join(root, 'projects') }
const realSetImmediate = globalThis.setImmediate.bind(globalThis)
mock.method(fs, 'fsyncSync', () => {})
mock.method(fs, 'fsync', (_fd, callback) => { callback(null) })
mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date(input.nowMs) })
const fakeSetTimeout = globalThis.setTimeout.bind(globalThis)
const fakeClearTimeout = globalThis.clearTimeout.bind(globalThis)
const activeFakeTimers = new Map()
let settled = false
let pumpScheduled = false
let fakeTicks = 0
let rejectTurnBound
const turnBoundExceeded = new Promise((_resolve, reject) => { rejectTurnBound = reject })

function scheduleFakeClockPump() {
  if (pumpScheduled || settled) return
  pumpScheduled = true
  realSetImmediate(() => {
    pumpScheduled = false
    if (settled || activeFakeTimers.size === 0) return
    fakeTicks += 1
    if (fakeTicks > 16384) {
      settled = true
      rejectTurnBound(new Error('restart save exceeded fake-clock turn bound'))
      return
    }
    let minDue = Infinity
    for (const dueAt of activeFakeTimers.values()) {
      if (dueAt < minDue) minDue = dueAt
    }
    mock.timers.tick(Math.max(1, minDue - Date.now()))
    if (!settled && activeFakeTimers.size > 0) scheduleFakeClockPump()
  })
}

globalThis.setTimeout = ((callback, delay, ...args) => {
  let handle
  const dueAt = Date.now() + Math.max(0, Number(delay) || 0)
  const wrapped = (...cbArgs) => {
    activeFakeTimers.delete(handle)
    return typeof callback === 'function' ? callback(...cbArgs) : undefined
  }
  handle = fakeSetTimeout(wrapped, delay, ...args)
  activeFakeTimers.set(handle, dueAt)
  scheduleFakeClockPump()
  return handle
})
globalThis.clearTimeout = ((handle) => {
  activeFakeTimers.delete(handle)
  return fakeClearTimeout(handle)
})
const { saveWorkspaceProject } = await import('../../electron/workspace/workspaceRepository.ts')
const { setDurabilityMode } = await import('../../electron/durability.ts')
const { tryAcquireWorkspaceManifestLock } = await import('../../electron/workspace/workspaceManifestLock.ts')
setDurabilityMode('durable')
mock.method(Atomics, 'wait', (_array, _index, _value, timeout) => {
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('unbounded sync wait in restart fixture')
  mock.timers.tick(timeout)
  return 'timed-out'
})
try {
  if (input.mode === 'leave-owner') {
    tryAcquireWorkspaceManifestLock(path.join(deps.defaultProjectsRoot, 'project'))
    process.stdout.write(JSON.stringify({ pid: process.pid, ownerLeft: true }) + '\n')
    process.exit(0)
  }
  const saved = await Promise.race([
    saveWorkspaceProject(input.id, { payload: { text: 'fresh-process' } }, deps).finally(() => { settled = true }),
    turnBoundExceeded,
  ])
  const persisted = JSON.parse(fs.readFileSync(path.join(deps.defaultProjectsRoot, 'project', '.nomi', 'project.json'), 'utf8'))
  process.stdout.write(JSON.stringify({ pid: process.pid, saved, persisted }) + '\n')
} catch (error) {
  settled = true
  process.stdout.write(JSON.stringify({ pid: process.pid, error: { name: error.name, code: error.code, message: error.message } }) + '\n')
  process.exitCode = 1
} finally {
  mock.restoreAll()
  mock.timers.reset()
}
