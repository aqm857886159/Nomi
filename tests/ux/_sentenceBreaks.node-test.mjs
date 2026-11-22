import assert from 'node:assert/strict'
import test from 'node:test'
import { badBreaks } from './_sentenceBreaks.mjs'

test('只在句子之间换行：不报', () => {
  assert.deepEqual(badBreaks(['这次约 1.95 积分（$0.195）。', '按 APIMart 公开价估，出完按 APIMart 实际扣费记。']), [])
  assert.deepEqual(badBreaks(['About 1.95 credits ($0.195) this time.', 'Estimated at the APIMart public rate; recorded at the actual APIMart charge once done.']), [])
  assert.deepEqual(badBreaks(['一整句不折行。']), [])
})

test('断在词中间 / 句子中间：报（样本照约价分支当前头屏上读到的断法）', () => {
  assert.equal(badBreaks(['这次约 1.95 积分（$0.195）。按', 'APIMart 公开价估，出完按 APIMart 实', '际扣费记。']).length, 2)
  assert.equal(badBreaks(['About 1.95 credits ($0.195) this', 'time.']).length, 1)
  assert.equal(badBreaks(['About 1.', '95 credits']).length, 1)
})
