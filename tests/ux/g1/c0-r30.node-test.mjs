import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scorePlanner } from './c0-r30.mjs'
const event = (type, payload) => ({ type: `agent.${type}`, payload })
const trace = [event('tool.proposed', { toolCallId: 'first' }),
  event('tool.completed', { toolCallId: 'first', ok: false }),
  event('tool.proposed', { toolCallId: 'retry' }), event('tool.completed', { toolCallId: 'retry', ok: true }),
  event('turn.finished', { status: 'ok', finalTextHead: 'done' })]
test('a successful retry does not erase the failed first tool; success also requires domain and closing text', () => {
  assert.equal(scorePlanner(trace, true).firstTool, '0/1 (0%)')
  assert.equal(scorePlanner(trace, true).turns, '1/1 (100%)')
  assert.equal(scorePlanner(trace, false).turns, '0/1 (0%)')
  assert.equal(scorePlanner([...trace, event('turn.finished', { status: 'ok', finalTextHead: '' })], true).turns, '0/1 (0%)')
})
test('no observed tool call stays N/A; an attempted but interrupted planner stays failed', () => {
  assert.equal(scorePlanner([], false).firstTool, 'N/A (0/0)')
  assert.equal(scorePlanner([], false).turns, '0/1 (0%)')
})
