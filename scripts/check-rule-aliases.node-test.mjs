// check:rule-aliases 的红证（R17：只验过绿的门岗不算门岗）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDefinitions, evaluate, collectReferences } from './check-rule-aliases.mjs'

const L1 = ['| # | 规则 | 一句话 |', '|---|---|---|', '| R5 | 先查别人 | … |', '| R13 | 完成标准 | … |'].join('\n')
const L2 = ['## R5 先查别人', '### R5.2 近邻开源优先', '## R13 完成标准', '## R6 → 见 R5.2（近邻开源）'].join('\n')

const defs = () => parseDefinitions({ l1: L1, l2: L2 })

test('别名在册时不红', () => {
  const refs = collectReferences(() => '看 R6 和 R5.2 和 R13', ['x.md'])
  assert.deepEqual(evaluate({ defs: defs(), references: refs }), [])
})

test('引用了一个没人定义也没别名的号 → 红', () => {
  const refs = collectReferences(() => '照 R29 办', ['x.md'])
  assert.match(evaluate({ defs: defs(), references: refs }).join('\n'), /引用了 R29/)
})

test('引用了不存在的子节 → 红', () => {
  const refs = collectReferences(() => '见 R5.9', ['x.md'])
  assert.match(evaluate({ defs: defs(), references: refs }).join('\n'), /没有 `### R5\.9`/)
})

test('别名指向一个不存在的落点 → 红（别名指空 = 引用悬空）', () => {
  const broken = parseDefinitions({ l1: L1, l2: '## R5 先查别人\n## R6 → 见 R5.7' })
  assert.match(evaluate({ defs: broken, references: [] }).join('\n'), /别名指向 R5\.7/)
})

test('L1 索引里有号、L2 却没有正文 → 红', () => {
  const broken = parseDefinitions({ l1: `${L1}\n| R21 | 根因流程 | … |`, l2: L2 })
  assert.match(evaluate({ defs: broken, references: [] }).join('\n'), /索引里有 R21/)
})

test('保留号（R24 / R27 / R32）不红', () => {
  const refs = collectReferences(() => 'R24 R27 R32', ['x.md'])
  assert.deepEqual(evaluate({ defs: defs(), references: refs }), [])
})
