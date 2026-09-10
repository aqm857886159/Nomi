import { test } from 'node:test'
import assert from 'node:assert/strict'
import { taskCharge } from './cover-budget.mjs'
test('shared account activity does not become a task charge', () => {
  assert.deepEqual(taskCharge({ cost: 0.0085, before: 100, after: 100.029442, reserveCny: 0.136 }), {
    actualUsd: 0.0085, actualCnyCeiling: 0.068, balanceDelta: 100.029442 - 100,
  })
})
test('missing, invalid or above-reservation task cost fails closed', () => {
  for (const cost of [undefined, NaN, -1, Infinity, 0.03]) assert.throws(() => taskCharge({ cost, before: 1, after: 2, reserveCny: 0.136 }))
})
