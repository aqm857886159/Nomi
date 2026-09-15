import test from 'node:test'
import assert from 'node:assert/strict'
import { scorePlanner, scoreLanePlanner } from './c0-r30.mjs'

test('native first write remains wrong after a later successful write; terminal must contain final prose', () => {
  const trace = [
    { role: 'assistant', content: [{ type: 'toolCall', name: 'draft_shots', id: 'bad', arguments: {} }] },
    { role: 'toolResult', toolCallId: 'bad', isError: true },
    { role: 'assistant', content: [{ type: 'toolCall', name: 'draft_shots', id: 'good', arguments: {} }] },
    { role: 'toolResult', toolCallId: 'good', isError: false },
    { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: '完成' }] },
  ]
  assert.equal(scorePlanner(trace, true).firstTool, '0/1 (0%)')
  assert.equal(scorePlanner(trace, true).turns, '1/1 (100%)')
  assert.equal(scorePlanner(trace, false).turns, '0/1 (0%)')
  assert.equal(scorePlanner([...trace, { role: 'assistant', stopReason: 'stop', content: [] }], true).turns, '0/1 (0%)')
})
test('missing native evidence never passes', () => {
  assert.equal(scorePlanner([], false).firstTool, 'N/A (0/0)')
  assert.equal(scorePlanner([], false).turns, '0/1 (0%)')
})

test('native lane scoring preserves failed first calls and requires an actual successful terminal', () => {
  const messages = [
    { role: 'assistant', content: [{ type: 'toolCall', id: 'first' }] },
    { role: 'toolResult', toolCallId: 'first', isError: true },
    { role: 'assistant', content: [{ type: 'toolCall', id: 'retry' }] },
    { role: 'toolResult', toolCallId: 'retry', isError: false },
    { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'done' }] },
  ]
  assert.equal(scoreLanePlanner(messages, true).firstTool, '0/1 (0%)')
  assert.equal(scoreLanePlanner(messages, true).turns, '1/1 (100%)')
  assert.equal(scoreLanePlanner(messages.slice(0, -1), true).turns, '0/1 (0%)')
  assert.equal(scoreLanePlanner(messages, false).turns, '0/1 (0%)')
  assert.equal(scoreLanePlanner([], false).firstTool, 'N/A (0/0)')
})
