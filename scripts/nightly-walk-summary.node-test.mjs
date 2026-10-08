import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeRows } from './nightly-walk-summary.mjs'

test('nightly summary separates skipped exit 125 from failures', () => {
  const { failed, skipped, markdown } = summarizeRows([
    { walk: 'a.walk.mjs', status: 0, seconds: 3, log: 'a.log' },
    { walk: 'b.walk.mjs', status: 125, seconds: 2, log: 'b.log' },
    { walk: 'c.walk.mjs', status: 124, seconds: 600, log: 'c.log' },
  ])
  assert.deepEqual(skipped.map((row) => row.walk), ['b.walk.mjs'])
  assert.deepEqual(failed.map((row) => row.walk), ['c.walk.mjs'])
  assert.match(markdown, /2\/3 passed; 1 failed; 1 skipped/)
  assert.match(markdown, /b\.walk\.mjs \| skipped/)
  assert.match(markdown, /c\.walk\.mjs \| failed \(124\)/)
})
