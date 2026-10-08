import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { readLiveWalkInstances, registerWalkInstance, registerWalkProcess } from './_walkInstances.mjs'
import { countNomiProcesses, waitForOtherNomiToExit } from './full-walk/launch.mjs'

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-walk-instances-test-'))
}

test('ignores user-installed and unregistered zombie processes', () => {
  const registryDir = fixture()
  const live = readLiveWalkInstances({
    worktree: process.cwd(),
    registryDir,
    isProcessAlive: () => { throw new Error('unregistered processes must never be inspected') },
  })
  assert.deepEqual(live, [])
})

test('wait population includes another walk registered in the same worktree', () => {
  const registryDir = fixture()
  const registration = registerWalkInstance({ pid: 1234, worktree: process.cwd(), registryDir })
  const live = readLiveWalkInstances({ worktree: process.cwd(), registryDir, isProcessAlive: (pid) => pid === 1234 })
  assert.equal(live.length, 1)
  assert.equal(live[0].pid, 1234)
  registration.cleanup()
})

test('stale registration is removed when its process has exited', () => {
  const registryDir = fixture()
  const registration = registerWalkInstance({ pid: 5678, worktree: process.cwd(), registryDir })
  assert.deepEqual(readLiveWalkInstances({ worktree: process.cwd(), registryDir, isProcessAlive: () => false }), [])
  assert.equal(fs.existsSync(registration.file), false)
})

test('registrations from another worktree do not block this walk', () => {
  const registryDir = fixture()
  const registration = registerWalkInstance({ pid: 9012, worktree: path.join(process.cwd(), 'other-worktree'), registryDir })
  const live = readLiveWalkInstances({ worktree: process.cwd(), registryDir, isProcessAlive: () => true })
  assert.deepEqual(live, [])
  registration.cleanup()
})

test('full-walk count and wait use the registered same-worktree set', async () => {
  const registryDir = fixture()
  const registration = registerWalkInstance({ pid: 3456, worktree: process.cwd(), registryDir })
  const isProcessAlive = (pid) => pid === 3456
  assert.equal(countNomiProcesses({ registryDir, isProcessAlive }), 1)
  await assert.rejects(
    waitForOtherNomiToExit({ registryDir, isProcessAlive, pollMs: 0, maxWaitMs: 0 }),
    /同一 worktree 一直有 1 个走查实例/,
  )
  registration.cleanup()
})

test('real process path fails closed when pid or once is missing', () => {
  assert.throws(
    () => registerWalkProcess({ pid: 1234 }, { worktree: process.cwd(), name: 'missing-handle' }),
    /\[missing-handle\].*without pid\/once/,
  )
})

test('test-only opt-in explicitly permits an untracked process double', () => {
  const registration = registerWalkProcess({}, { worktree: process.cwd(), name: 'explicit-double', allowUntrackedProcessForTest: true })
  assert.equal(registration.file, null)
  registration.cleanup()
})
