import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { checkDispatchBrief, roundNumber } from './check-dispatch-brief.mjs'

const GOOD = '范围：只改 src/a。不碰：%APPDATA%。停点：样张出来就停。补还是换：近 14 天修过 0 次；选补。'

describe('派工书检查', () => {
  test('三件都有则通过', () => assert.deepEqual(checkDispatchBrief(GOOD), []))
  test('缺哪件报哪件', () => {
    assert.equal(checkDispatchBrief('范围：x').length, 3)
    assert.match(checkDispatchBrief('范围 不碰 x').join(), /停点/)
  })
  test('缺补还是换一节红；写了过；不适用（原因）也过', () => {
    const base = '范围：只改 a。不碰：b。停点：c。'
    assert.match(checkDispatchBrief(base).join(), /补还是换/)
    assert.deepEqual(checkDispatchBrief(`${base} 补 / 换 / 删：选补，近 14 天 0 次`), [])
    assert.deepEqual(checkDispatchBrief(`${base} 补还是换：不适用（纯调研）`), [])
  })
  test('轮次识别：阿拉伯数字与中文', () => {
    assert.equal(roundNumber('这是第 5 轮修补'), 5)
    assert.equal(roundNumber('第五轮'), 5)
    assert.equal(roundNumber('第十二轮'), 12)
    assert.equal(roundNumber('没有轮次'), 0)
  })
  test('第 3 轮及以上必须引用方向检查复盘；第 2 轮不要求', () => {
    assert.match(checkDispatchBrief(`${GOOD} 第五轮修补`).join(), /第 5 轮/)
    assert.deepEqual(checkDispatchBrief(`${GOOD} 第五轮修补，依据 Direction-Check 复盘 docs/x.md`), [])
    assert.deepEqual(checkDispatchBrief(`${GOOD} 第二轮`), [])
  })
})
