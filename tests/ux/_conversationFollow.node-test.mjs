import assert from 'node:assert/strict'
import test from 'node:test'
import { judgeConversationFollow } from './_conversationFollow.mjs'

const frames = (...tail) => [...Array.from({ length: 21 }, () => ({ scrollHeight: 1000, gap: 1 })), ...tail]

test('allows only a height burst whose very next frame recovers; retains raw max and each exception', () => {
  const result = judgeConversationFollow(frames(
    { scrollHeight: 1104, gap: 104 }, { scrollHeight: 1104, gap: 1 },
    { scrollHeight: 1187, gap: 83 }, { scrollHeight: 1187, gap: 70 },
  ))
  assert.equal(result.pass, true)
  assert.equal(result.maxGap, 104)
  assert.equal(result.heightBursts.length, 2)
  assert.deepEqual(result.exceptions, [
    { frame: 21, growth: 104, gap: 104, nextGap: 1 },
    { frame: 23, growth: 83, gap: 83, nextGap: 70 },
  ])
})

test('rejects two consecutive gaps even when both frames have a height burst', () => {
  const result = judgeConversationFollow(frames(
    { scrollHeight: 1104, gap: 104 }, { scrollHeight: 1208, gap: 83 }, { scrollHeight: 1208, gap: 1 },
  ))
  assert.equal(result.pass, false)
  assert.equal(result.exceptions.some(entry => entry.frame === 21), false)
})

test('rejects an unrecovered final burst: removing next-frame recovery must turn this test red', () => {
  assert.equal(judgeConversationFollow(frames({ scrollHeight: 1104, gap: 104 })).pass, false)
})

test('rejects lag without a >70px height burst, including exactly 70px growth', () => {
  for (const scrollHeight of [1000, 1070]) {
    assert.equal(judgeConversationFollow(frames({ scrollHeight, gap: 83 }, { scrollHeight, gap: 1 })).pass, false)
  }
})

test('keeps >20 samples and accepts the original 70px boundary without exceptions', () => {
  assert.equal(judgeConversationFollow(frames().slice(0, 20)).pass, false)
  const result = judgeConversationFollow(frames({ scrollHeight: 1000, gap: 70 }))
  assert.equal(result.pass, true)
  assert.equal(result.exceptions.length, 0)
})
