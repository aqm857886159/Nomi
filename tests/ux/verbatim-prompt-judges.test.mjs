import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { collectPrompts, judgeExpansion, judgeVerbatim, normalizeForVerbatim, summarize } from './verbatim-prompt-judges.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const CASES = JSON.parse(fs.readFileSync(path.join(here, 'agent-verbatim-prompt.cases.json'), 'utf8')).cases

test('用例表：≥12 句，中英各半，一半给原文一半让 Agent 写，id 不重复', () => {
  assert.ok(CASES.length >= 12)
  assert.equal(new Set(CASES.map((item) => item.id)).size, CASES.length)
  const count = (predicate) => CASES.filter(predicate).length
  assert.equal(count((item) => item.lang === 'zh'), count((item) => item.lang === 'en'))
  assert.equal(count((item) => item.kind === 'verbatim'), count((item) => item.kind === 'expand'))
  for (const item of CASES) {
    assert.ok(item.turns.length >= 1)
    if (item.kind === 'verbatim') assert.ok(item.expected, `${item.id} 缺 expected`)
    else assert.ok(item.seed, `${item.id} 缺 seed`)
  }
})

test('用例表：原文就在用户最后一轮的话里，逐字（判据的「原文」不是另写的）', () => {
  for (const item of CASES.filter((entry) => entry.kind === 'verbatim')) {
    assert.ok(item.turns.at(-1).includes(item.expected), `${item.id}：最后一轮没有逐字包含 expected`)
  }
})

test('阳性对照：用户 11-07 那例（落下的是加了氛围和风格词的句子）必判为扩写，不是逐字', () => {
  const v1 = CASES.find((item) => item.id === 'V1')
  const seen = '一只黑猫坐在窗台上，阳光洒落，温暖宁静的氛围，写实摄影风格'
  const verdict = judgeVerbatim(v1.expected, [seen])
  assert.equal(verdict.exact, false)
  assert.equal(verdict.expanded, true)
})

test('阴性对照：原句落下（含末尾句号、成对引号）判为逐字', () => {
  const v1 = CASES.find((item) => item.id === 'V1')
  assert.equal(judgeVerbatim(v1.expected, ['一只黑猫坐在窗台上']).exact, true)
  assert.equal(judgeVerbatim(v1.expected, ['一只黑猫坐在窗台上。']).exact, true)
  assert.equal(judgeVerbatim('海边的白色灯塔', ['「海边的白色灯塔」']).exact, true)
})

test('换了一个字、翻译了、少了一半，都不算逐字，也不算扩写', () => {
  assert.equal(judgeVerbatim('一只黑猫坐在窗台上', ['一只黑猫蹲在窗台上']).exact, false)
  assert.equal(judgeVerbatim('一只黑猫坐在窗台上', ['A black cat sits on the windowsill']).exact, false)
  assert.equal(judgeVerbatim('a black cat on a windowsill', ['a black cat']).exact, false)
  assert.equal(judgeVerbatim('一只黑猫坐在窗台上', ['一只黑猫坐在窗台上，写实摄影风格']).exact, false)
})

test('没落下任何提示词的轮次单列，不冒充逐字', () => {
  const verdict = judgeVerbatim('x', [])
  assert.equal(verdict.wrotePrompt, false)
  assert.equal(verdict.exact, false)
})

test('该扩写：落一句原话判为没扩写（矫枉过正的阳性对照）；落具体画面判为扩写', () => {
  assert.equal(judgeExpansion('深夜的便利店', ['深夜的便利店']).expanded, false)
  assert.equal(judgeExpansion('深夜的便利店', ['深夜的便利店。']).expanded, false)
  assert.equal(judgeExpansion('深夜的便利店', ['深夜的便利店，暖黄灯光从玻璃门透出，货架整齐，店员靠在收银台边打盹，门外有细雨']).expanded, true)
  assert.equal(judgeExpansion('a cat', ['a cat']).expanded, false)
  assert.equal(judgeExpansion('a cat', ['a sleek black cat in a dim alley, rim light, shallow depth of field']).expanded, true)
})

test('collectPrompts：起草 / 改草稿 / 关键帧里任意深度的 prompt 都收，空串不收', () => {
  const args = { operationId: 'op-1', shots: [{ title: 'a', prompt: '甲', storyboard: { keyframe: { enabled: true, prompt: '乙' } } }, { prompt: '  ' }] }
  assert.deepEqual(collectPrompts(args).sort(), ['乙', '甲'])
  assert.deepEqual(collectPrompts(undefined), [])
})

test('summarize：分子分母分开报，没写提示词的轮次单列', () => {
  const rows = [
    { kind: 'verbatim', verdict: { exact: true, expanded: false, wrotePrompt: true } },
    { kind: 'verbatim', verdict: { exact: false, expanded: true, wrotePrompt: true } },
    { kind: 'verbatim', verdict: { exact: false, expanded: false, wrotePrompt: false } },
    { kind: 'expand', verdict: { expanded: true, wrotePrompt: true } },
    { kind: 'expand', verdict: { expanded: false, wrotePrompt: true } },
  ]
  assert.deepEqual(summarize(rows), {
    verbatimRate: '1/3', verbatimExpandedRate: '1/3', verbatimNoPrompt: '1/3', expandWhenAskedRate: '1/2', expandNoPrompt: '0/2',
  })
})

test('normalizeForVerbatim 只放过空白、一层引号、末尾句号', () => {
  assert.equal(normalizeForVerbatim('  「a b」。 '), 'a b')
  assert.equal(normalizeForVerbatim('a, b'), 'a, b')
})
