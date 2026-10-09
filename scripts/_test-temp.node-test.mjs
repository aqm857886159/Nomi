import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { cleanupTestTemp, makeTempDir, makeTempDirAsync } from './_test-temp.mjs'

test('shared node:test temp roots are removed synchronously and asynchronously', async () => {
  const syncRoot = makeTempDir('nomi-node-test-sync-')
  const asyncRoot = await makeTempDirAsync('nomi-node-test-async-')
  assert.equal(fs.existsSync(syncRoot), true)
  assert.equal(fs.existsSync(asyncRoot), true)
  cleanupTestTemp(syncRoot)
  cleanupTestTemp(asyncRoot)
  assert.equal(fs.existsSync(syncRoot), false)
  assert.equal(fs.existsSync(asyncRoot), false)
})
